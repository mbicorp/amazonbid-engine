/**
 * bidEngine アトリビューション遅延対策関数のテスト
 *
 * 以下の関数をテスト:
 * - isRecentPerformanceGood(): 直近3日が好調かどうかを判定
 * - shouldBeNoConversion(): NO_CONVERSION判定（アトリビューション遅延対策版）
 * - shouldBeAcosHigh(): ACOS高すぎ判定（アトリビューション遅延対策版）
 * - applyRecentGoodSafetyValve(): ダウンアクションに対する安全弁
 */

// 外部モジュールをモック化（テスト時にインポートエラーを回避）
jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
  })),
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234"),
}));

import {
  isRecentPerformanceGood,
  shouldBeNoConversion,
  shouldBeAcosHigh,
  applyRecentGoodSafetyValve,
  KeywordMetrics,
  ATTRIBUTION_DELAY_CONFIG,
} from "../src/engine/bidEngine";
import { getEventBidPolicy } from "../src/event";

// =============================================================================
// テストヘルパー
// =============================================================================

/**
 * テスト用のKeywordMetricsを作成
 */
function createKeywordMetrics(
  overrides: Partial<KeywordMetrics> = {}
): KeywordMetrics {
  return {
    asin: "B0XXXXXXXX",
    keywordId: "kw-001",
    keywordText: "test keyword",
    matchType: "BROAD",
    campaignId: "camp-001",
    adGroupId: "ag-001",
    currentBid: 100,
    currentAcos: 0.25,

    // 7日フル集計（アップ判定用）
    impressions7d: 1000,
    clicks7d: 50,
    conversions7d: 5,
    spend7d: 5000,
    sales7d: 20000,
    ctr7d: 0.05,
    cvr7d: 0.10,

    // 直近3日除外集計（ダウン判定用）
    impressions7dExclRecent: 700,
    clicks7dExclRecent: 35,
    conversions7dExclRecent: 3,
    spend7dExclRecent: 3500,
    sales7dExclRecent: 12000,
    ctr7dExclRecent: 0.05,
    cvr7dExclRecent: 0.086,
    acos7dExclRecent: 0.29,

    // 直近3日のみ（安全弁判定用）
    impressionsLast3d: 300,
    clicksLast3d: 15,
    conversionsLast3d: 2,
    spendLast3d: 1500,
    salesLast3d: 8000,
    ctrLast3d: 0.05,
    cvrLast3d: 0.133,
    acosLast3d: 0.19,

    // 30日集計（長期トレンド確認用）
    impressions30d: 4000,
    clicks30d: 200,
    conversions30d: 20,
    spend30d: 20000,
    sales30d: 80000,
    ctr30d: 0.05,
    cvr30d: 0.10,
    acos30d: 0.25,

    // オーガニック順位情報
    organicRank: 10,
    organicRankTrend: -2,
    organicRankZone: "MID",

    ...overrides,
  };
}

// =============================================================================
// isRecentPerformanceGood テスト
// =============================================================================

describe("isRecentPerformanceGood", () => {
  describe("直近3日に注文がある場合", () => {
    it("注文が1件以上あれば好調と判定", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 1,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(true);
    });

    it("注文が複数件でも好調と判定", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 5,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(true);
    });
  });

  describe("注文がゼロの場合のCVR比較", () => {
    it("CVRが1.2倍以上なら好調と判定", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.12, // 0.10 * 1.2 = 0.12
        cvr7dExclRecent: 0.10,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(true);
    });

    it("CVRが1.2倍未満なら好調でないと判定", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.11, // 0.10 * 1.1 = 0.11 < 0.12
        cvr7dExclRecent: 0.10,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(false);
    });

    it("cvrLast3dがnullなら好調でないと判定", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: null,
        cvr7dExclRecent: 0.10,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(false);
    });

    it("cvr7dExclRecentがnullなら好調でないと判定", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.12,
        cvr7dExclRecent: null,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(false);
    });

    it("cvr7dExclRecentがゼロなら好調でないと判定", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.12,
        cvr7dExclRecent: 0,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(false);
    });
  });

  describe("完全に不調な場合", () => {
    it("注文ゼロかつCVR低下なら好調でないと判定", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05, // 0.10の半分
        cvr7dExclRecent: 0.10,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(false);
    });
  });
});

// =============================================================================
// shouldBeNoConversion テスト
// =============================================================================

describe("shouldBeNoConversion", () => {
  const { MIN_CLICKS_FOR_DOWN, NO_CONVERSION_MAX_ORDERS_30D } =
    ATTRIBUTION_DELAY_CONFIG;

  describe("通常モード（イベントポリシーなし）", () => {
    it("すべての条件を満たす場合はtrue", () => {
      const metrics = createKeywordMetrics({
        clicks7dExclRecent: MIN_CLICKS_FOR_DOWN + 5, // 条件1: 十分なクリック
        conversions7dExclRecent: 0, // 条件2: 注文ゼロ
        conversions30d: NO_CONVERSION_MAX_ORDERS_30D, // 条件3: 30日でも少ない
      });
      expect(shouldBeNoConversion(metrics)).toBe(true);
    });

    it("クリック数が不足している場合はfalse", () => {
      const metrics = createKeywordMetrics({
        clicks7dExclRecent: MIN_CLICKS_FOR_DOWN - 1, // 条件1: 不足
        conversions7dExclRecent: 0,
        conversions30d: 0,
      });
      expect(shouldBeNoConversion(metrics)).toBe(false);
    });

    it("直近3日除外で注文がある場合はfalse", () => {
      const metrics = createKeywordMetrics({
        clicks7dExclRecent: MIN_CLICKS_FOR_DOWN + 5,
        conversions7dExclRecent: 1, // 条件2: 注文あり
        conversions30d: 0,
      });
      expect(shouldBeNoConversion(metrics)).toBe(false);
    });

    it("30日で注文が多い場合はfalse", () => {
      const metrics = createKeywordMetrics({
        clicks7dExclRecent: MIN_CLICKS_FOR_DOWN + 5,
        conversions7dExclRecent: 0,
        conversions30d: NO_CONVERSION_MAX_ORDERS_30D + 1, // 条件3: 30日では売れている
      });
      expect(shouldBeNoConversion(metrics)).toBe(false);
    });
  });

  describe("イベントモード（BIG_SALE_DAY）", () => {
    it("allowNoConversionDown=falseの場合は常にfalse", () => {
      const metrics = createKeywordMetrics({
        clicks7dExclRecent: MIN_CLICKS_FOR_DOWN + 5,
        conversions7dExclRecent: 0,
        conversions30d: 0,
      });
      const eventPolicy = getEventBidPolicy("BIG_SALE_DAY");
      expect(shouldBeNoConversion(metrics, eventPolicy)).toBe(false);
    });
  });

  describe("イベントモード（BIG_SALE_PREP）", () => {
    it("allowNoConversionDown=trueの場合は通常通り判定", () => {
      const metrics = createKeywordMetrics({
        clicks7dExclRecent: MIN_CLICKS_FOR_DOWN + 5,
        conversions7dExclRecent: 0,
        conversions30d: 0,
      });
      const eventPolicy = getEventBidPolicy("BIG_SALE_PREP");
      // BIG_SALE_PREPはallowNoConversionDown=trueなので通常判定
      expect(shouldBeNoConversion(metrics, eventPolicy)).toBe(true);
    });
  });
});

// =============================================================================
// shouldBeAcosHigh テスト
// =============================================================================

describe("shouldBeAcosHigh", () => {
  const {
    DOWN_ACOS_MULTIPLIER_7D_EXCL,
    DOWN_ACOS_MULTIPLIER_30D,
  } = ATTRIBUTION_DELAY_CONFIG;

  const targetAcos = 0.25;

  describe("通常モード（イベントポリシーなし）", () => {
    it("両方の条件を満たす場合はtrue", () => {
      // 7日除外: 0.25 * 1.2 = 0.30 → 0.35 > 0.30 ✓
      // 30日: 0.25 * 1.05 = 0.2625 → 0.30 > 0.2625 ✓
      const metrics = createKeywordMetrics({
        acos7dExclRecent: 0.35,
        acos30d: 0.30,
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(true);
    });

    it("7日除外ACOSだけ高い場合はfalse", () => {
      const metrics = createKeywordMetrics({
        acos7dExclRecent: 0.35, // 高い
        acos30d: 0.20, // 低い（0.2625未満）
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);
    });

    it("30日ACOSだけ高い場合はfalse", () => {
      const metrics = createKeywordMetrics({
        acos7dExclRecent: 0.25, // 低い（0.30未満）
        acos30d: 0.35, // 高い
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);
    });

    it("両方のACOSが低い場合はfalse", () => {
      const metrics = createKeywordMetrics({
        acos7dExclRecent: 0.20,
        acos30d: 0.20,
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);
    });

    it("acos7dExclRecentがnullの場合はfalse", () => {
      const metrics = createKeywordMetrics({
        acos7dExclRecent: null,
        acos30d: 0.35,
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);
    });

    it("acos30dがnullの場合はfalse", () => {
      const metrics = createKeywordMetrics({
        acos7dExclRecent: 0.35,
        acos30d: null,
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);
    });
  });

  describe("イベントモード（BIG_SALE_DAY）", () => {
    it("乗数が緩和されて判定が緩くなる", () => {
      const eventPolicy = getEventBidPolicy("BIG_SALE_DAY");
      // BIG_SALE_DAYでは乗数が上がる（判定が緩くなる）
      // 通常なら高すぎと判定される値でも、イベント時は許容
      const metrics = createKeywordMetrics({
        acos7dExclRecent: 0.35, // 通常なら高い
        acos30d: 0.30, // 通常なら高い
      });

      // 通常モードではtrue
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(true);

      // BIG_SALE_DAYモードでは乗数が上がっているため、同じACOSでもfalseになる可能性
      // eventPolicy.acosHighMultiplierFor7dExcl = 1.5
      // eventPolicy.acosHighMultiplierFor30d = 1.2
      // 7日除外: 0.25 * 1.5 = 0.375 → 0.35 < 0.375 なのでfalse
      expect(shouldBeAcosHigh(metrics, targetAcos, eventPolicy)).toBe(false);
    });
  });

  describe("イベントモード（BIG_SALE_PREP）", () => {
    it("乗数が少し緩和される", () => {
      const eventPolicy = getEventBidPolicy("BIG_SALE_PREP");
      // BIG_SALE_PREPでも乗数が上がる
      const metrics = createKeywordMetrics({
        acos7dExclRecent: 0.35,
        acos30d: 0.30,
      });

      // BIG_SALE_PREPモード
      // eventPolicy.acosHighMultiplierFor7dExcl = 1.3
      // eventPolicy.acosHighMultiplierFor30d = 1.1
      // 7日除外: 0.25 * 1.3 = 0.325 → 0.35 > 0.325 ✓
      // 30日: 0.25 * 1.1 = 0.275 → 0.30 > 0.275 ✓
      expect(shouldBeAcosHigh(metrics, targetAcos, eventPolicy)).toBe(true);
    });
  });
});

// =============================================================================
// applyRecentGoodSafetyValve テスト
// =============================================================================

describe("applyRecentGoodSafetyValve", () => {
  describe("アップ/KEEPアクション", () => {
    it("STRONG_UPはそのまま返す", () => {
      const metrics = createKeywordMetrics();
      expect(applyRecentGoodSafetyValve("STRONG_UP", metrics)).toBe("STRONG_UP");
    });

    it("MILD_UPはそのまま返す", () => {
      const metrics = createKeywordMetrics();
      expect(applyRecentGoodSafetyValve("MILD_UP", metrics)).toBe("MILD_UP");
    });

    it("KEEPはそのまま返す", () => {
      const metrics = createKeywordMetrics();
      expect(applyRecentGoodSafetyValve("KEEP", metrics)).toBe("KEEP");
    });
  });

  describe("ダウンアクション - 直近好調な場合", () => {
    it("STOPがMILD_DOWNに緩和される", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 1, // 直近好調
      });
      expect(applyRecentGoodSafetyValve("STOP", metrics)).toBe("MILD_DOWN");
    });

    it("STRONG_DOWNがMILD_DOWNに緩和される", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 1, // 直近好調
      });
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics)).toBe("MILD_DOWN");
    });

    it("MILD_DOWNはそのまま", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 1, // 直近好調
      });
      expect(applyRecentGoodSafetyValve("MILD_DOWN", metrics)).toBe("MILD_DOWN");
    });
  });

  describe("ダウンアクション - 直近不調な場合", () => {
    it("STOPはそのまま", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05, // 低い
        cvr7dExclRecent: 0.10,
      });
      expect(applyRecentGoodSafetyValve("STOP", metrics)).toBe("STOP");
    });

    it("STRONG_DOWNはそのまま", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05,
        cvr7dExclRecent: 0.10,
      });
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics)).toBe("STRONG_DOWN");
    });

    it("MILD_DOWNはそのまま", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05,
        cvr7dExclRecent: 0.10,
      });
      expect(applyRecentGoodSafetyValve("MILD_DOWN", metrics)).toBe("MILD_DOWN");
    });
  });

  describe("イベントモード（BIG_SALE_DAY）- 強いダウン禁止", () => {
    const eventPolicy = getEventBidPolicy("BIG_SALE_DAY");

    it("STOPがMILD_DOWNに強制変換（直近不調でも）", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05,
        cvr7dExclRecent: 0.10,
      });
      expect(applyRecentGoodSafetyValve("STOP", metrics, eventPolicy)).toBe(
        "MILD_DOWN"
      );
    });

    it("STRONG_DOWNがMILD_DOWNに強制変換（直近不調でも）", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05,
        cvr7dExclRecent: 0.10,
      });
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics, eventPolicy)).toBe(
        "MILD_DOWN"
      );
    });

    it("MILD_DOWNはそのまま", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05,
        cvr7dExclRecent: 0.10,
      });
      expect(applyRecentGoodSafetyValve("MILD_DOWN", metrics, eventPolicy)).toBe(
        "MILD_DOWN"
      );
    });
  });

  describe("イベントモード（BIG_SALE_PREP）- 強いダウン許可", () => {
    const eventPolicy = getEventBidPolicy("BIG_SALE_PREP");

    it("直近不調ならSTOPはそのまま（allowStrongDown=true）", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05,
        cvr7dExclRecent: 0.10,
      });
      expect(applyRecentGoodSafetyValve("STOP", metrics, eventPolicy)).toBe("STOP");
    });

    it("直近好調ならSTOPはMILD_DOWNに緩和", () => {
      const metrics = createKeywordMetrics({
        conversionsLast3d: 1, // 直近好調
      });
      expect(applyRecentGoodSafetyValve("STOP", metrics, eventPolicy)).toBe(
        "MILD_DOWN"
      );
    });
  });
});

// =============================================================================
// 統合テスト: 複合シナリオ
// =============================================================================

describe("統合テスト: アトリビューション遅延対策の複合シナリオ", () => {
  describe("シナリオ1: 直近3日で注文急増（アトリビューション遅延の典型パターン）", () => {
    it("7日フルでは悪く見えるが、直近好調なのでダウンを緩和すべき", () => {
      const metrics = createKeywordMetrics({
        // 7日フル: 悪く見える
        conversions7d: 2,
        cvr7d: 0.04,
        // 7日除外: もっと悪い（直近3日のCV除くと）
        conversions7dExclRecent: 0,
        cvr7dExclRecent: 0,
        acos7dExclRecent: null, // CVゼロなのでACOSなし
        // 直近3日: 好調！
        conversionsLast3d: 2,
        cvrLast3d: 0.133,
        acosLast3d: 0.15,
        // 30日: 普通
        conversions30d: 10,
        acos30d: 0.25,
      });

      // 直近好調と判定されるべき
      expect(isRecentPerformanceGood(metrics)).toBe(true);

      // NO_CONVERSION判定: 7dExclRecentで注文ゼロだが、直近好調なので安全弁が効く
      // STRONG_DOWN/STOPはMILD_DOWNに緩和
      expect(applyRecentGoodSafetyValve("STOP", metrics)).toBe("MILD_DOWN");
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics)).toBe("MILD_DOWN");
    });
  });

  describe("シナリオ2: 本当にパフォーマンスが悪い場合", () => {
    it("直近も悪いならダウンを維持すべき", () => {
      const metrics = createKeywordMetrics({
        // 7日フル: 悪い
        conversions7d: 0,
        cvr7d: 0,
        // 7日除外: 悪い
        conversions7dExclRecent: 0,
        cvr7dExclRecent: 0,
        acos7dExclRecent: null,
        // 直近3日: 悪い
        conversionsLast3d: 0,
        cvrLast3d: 0,
        acosLast3d: null,
        // 30日: 悪い
        conversions30d: 1,
        acos30d: 0.50,
        // クリックは十分
        clicks7dExclRecent: 20,
      });

      // 直近不調と判定されるべき
      expect(isRecentPerformanceGood(metrics)).toBe(false);

      // NO_CONVERSION判定: すべての条件を満たす
      expect(shouldBeNoConversion(metrics)).toBe(true);

      // ダウンはそのまま維持
      expect(applyRecentGoodSafetyValve("STOP", metrics)).toBe("STOP");
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics)).toBe("STRONG_DOWN");
    });
  });

  describe("シナリオ3: セール当日のパフォーマンス低下", () => {
    it("イベントモードで強いダウンを抑制すべき", () => {
      const metrics = createKeywordMetrics({
        // セール当日は一時的にACOSが悪化しがち
        acos7dExclRecent: 0.35, // 通常時は 0.25 * 1.2 = 0.30 を超えるので高すぎ
        acos30d: 0.28, // 通常時は 0.25 * 1.05 = 0.2625 を超えるので高すぎ
        conversionsLast3d: 0,
        cvrLast3d: 0.03,
        cvr7dExclRecent: 0.08,
      });

      const eventPolicy = getEventBidPolicy("BIG_SALE_DAY");

      // 直近不調でも、イベントモードで強制的にMILD_DOWNに
      expect(applyRecentGoodSafetyValve("STOP", metrics, eventPolicy)).toBe(
        "MILD_DOWN"
      );

      // ACOS高すぎ判定も緩和される
      const targetAcos = 0.25;
      // 通常モードでは高すぎ判定
      // 7日除外: 0.35 > 0.25 * 1.2 = 0.30 → true
      // 30日: 0.28 > 0.25 * 1.05 = 0.2625 → true
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(true);
      // イベントモード（BIG_SALE_DAY）では乗数が上がり許容される
      // 7日除外: 0.35 > 0.25 * 1.5 = 0.375 → false
      // 30日: 0.28 > 0.25 * 1.15 = 0.2875 → false
      // 両方falseなので結果はfalse
      expect(shouldBeAcosHigh(metrics, targetAcos, eventPolicy)).toBe(false);
    });
  });
});

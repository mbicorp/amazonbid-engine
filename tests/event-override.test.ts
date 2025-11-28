/**
 * Event Override テスト
 *
 * イベントモード別の入札ポリシーが正しく動作することを検証
 */

import {
  EventMode,
  EventBidPolicy,
  getEventBidPolicy,
  isValidEventMode,
  EVENT_POLICY_NONE,
  EVENT_POLICY_BIG_SALE_PREP,
  EVENT_POLICY_BIG_SALE_DAY,
  getEffectiveEventBidPolicy,
} from "../src/event";

// bidEngine.ts の関数をテストするため、モジュールモックを設定
jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    dataset: jest.fn(),
  })),
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid-1234"),
}));

// モック後にインポート
import {
  shouldBeAcosHigh,
  shouldBeNoConversion,
  applyRecentGoodSafetyValve,
  KeywordMetrics,
} from "../src/engine/bidEngine";

// =============================================================================
// テスト用ヘルパー
// =============================================================================

/**
 * デフォルトのキーワードメトリクスを作成
 */
function createDefaultMetrics(overrides: Partial<KeywordMetrics> = {}): KeywordMetrics {
  return {
    asin: "B000TEST01",
    keywordId: "kw001",
    keywordText: "test keyword",
    matchType: "BROAD",
    campaignId: "camp001",
    adGroupId: "ag001",
    currentBid: 100,
    currentAcos: 0.25,
    impressions7d: 1000,
    clicks7d: 50,
    conversions7d: 5,
    spend7d: 5000,
    sales7d: 20000,
    ctr7d: 0.05,
    cvr7d: 0.10,
    impressions7dExclRecent: 700,
    clicks7dExclRecent: 35,
    conversions7dExclRecent: 3,
    spend7dExclRecent: 3500,
    sales7dExclRecent: 14000,
    ctr7dExclRecent: 0.05,
    cvr7dExclRecent: 0.086,
    acos7dExclRecent: 0.25,
    impressionsLast3d: 300,
    clicksLast3d: 15,
    conversionsLast3d: 2,
    spendLast3d: 1500,
    salesLast3d: 6000,
    ctrLast3d: 0.05,
    cvrLast3d: 0.133,
    acosLast3d: 0.25,
    impressions30d: 4000,
    clicks30d: 200,
    conversions30d: 20,
    spend30d: 20000,
    sales30d: 80000,
    ctr30d: 0.05,
    cvr30d: 0.10,
    acos30d: 0.25,
    organicRank: null,
    organicRankTrend: null,
    organicRankZone: null,
    ...overrides,
  };
}

// =============================================================================
// EventMode型・バリデーション テスト
// =============================================================================

describe("EventMode 型とバリデーション", () => {
  describe("isValidEventMode", () => {
    it("有効なEventModeを認識する", () => {
      expect(isValidEventMode("NONE")).toBe(true);
      expect(isValidEventMode("BIG_SALE_PREP")).toBe(true);
      expect(isValidEventMode("BIG_SALE_DAY")).toBe(true);
    });

    it("無効な値を拒否する", () => {
      expect(isValidEventMode("INVALID")).toBe(false);
      expect(isValidEventMode("")).toBe(false);
      expect(isValidEventMode(null)).toBe(false);
      expect(isValidEventMode(undefined)).toBe(false);
      expect(isValidEventMode(123)).toBe(false);
    });
  });

  describe("getEventBidPolicy", () => {
    it("NONEモードでデフォルトポリシーを返す", () => {
      const policy = getEventBidPolicy("NONE");
      expect(policy).toEqual(EVENT_POLICY_NONE);
      expect(policy.maxBidUpMultiplier).toBe(1.3);
      expect(policy.maxBidDownMultiplier).toBe(0.7);
      expect(policy.allowStrongDown).toBe(true);
      expect(policy.allowNoConversionDown).toBe(true);
    });

    it("BIG_SALE_PREPモードでセール準備ポリシーを返す", () => {
      const policy = getEventBidPolicy("BIG_SALE_PREP");
      expect(policy).toEqual(EVENT_POLICY_BIG_SALE_PREP);
      expect(policy.maxBidUpMultiplier).toBe(1.4);
      expect(policy.maxBidDownMultiplier).toBe(0.85);
      expect(policy.acosHighMultiplierFor7dExcl).toBe(1.3);
      expect(policy.allowStrongDown).toBe(true);
    });

    it("BIG_SALE_DAYモードでセール当日ポリシーを返す", () => {
      const policy = getEventBidPolicy("BIG_SALE_DAY");
      expect(policy).toEqual(EVENT_POLICY_BIG_SALE_DAY);
      expect(policy.maxBidUpMultiplier).toBe(1.5);
      expect(policy.maxBidDownMultiplier).toBe(0.9);
      expect(policy.acosHighMultiplierFor7dExcl).toBe(1.5);
      expect(policy.acosHighMultiplierFor30d).toBe(1.15);
      expect(policy.allowStrongDown).toBe(false);
      expect(policy.allowNoConversionDown).toBe(false);
    });
  });

  describe("getEffectiveEventBidPolicy", () => {
    it("カスタムポリシーがない場合、デフォルトを返す", () => {
      const policy = getEffectiveEventBidPolicy("BIG_SALE_DAY");
      expect(policy).toEqual(EVENT_POLICY_BIG_SALE_DAY);
    });

    it("カスタムポリシーをマージする", () => {
      const customPolicies = {
        BIG_SALE_DAY: {
          maxBidUpMultiplier: 2.0,
        },
      };
      const policy = getEffectiveEventBidPolicy("BIG_SALE_DAY", customPolicies);
      expect(policy.maxBidUpMultiplier).toBe(2.0);
      expect(policy.maxBidDownMultiplier).toBe(0.9); // デフォルトを保持
      expect(policy.allowStrongDown).toBe(false); // デフォルトを保持
    });
  });
});

// =============================================================================
// ACOS判定へのイベントオーバーライド テスト
// =============================================================================

describe("shouldBeAcosHigh - イベントオーバーライド対応", () => {
  const targetAcos = 0.20; // 20%

  it("NONEモード: 従来通りの判定閾値を使用", () => {
    // ACOS 7d excl = 25%, 30d = 22%
    // NONEの閾値: 7d excl > 20% * 1.2 = 24% AND 30d > 20% * 1.05 = 21%
    const metrics = createDefaultMetrics({
      acos7dExclRecent: 0.25, // 25% > 24% ✓
      acos30d: 0.22,          // 22% > 21% ✓
    });
    const policy = getEventBidPolicy("NONE");
    expect(shouldBeAcosHigh(metrics, targetAcos, policy)).toBe(true);
  });

  it("BIG_SALE_DAYモード: 閾値が緩和されACOS_HIGH判定されにくくなる", () => {
    // 同じメトリクスでも、BIG_SALE_DAYでは閾値が緩い
    // BIG_SALE_DAYの閾値: 7d excl > 20% * 1.5 = 30% AND 30d > 20% * 1.15 = 23%
    const metrics = createDefaultMetrics({
      acos7dExclRecent: 0.25, // 25% < 30% ✗
      acos30d: 0.22,          // 22% < 23% ✗
    });
    const policy = getEventBidPolicy("BIG_SALE_DAY");
    expect(shouldBeAcosHigh(metrics, targetAcos, policy)).toBe(false);
  });

  it("BIG_SALE_DAYモード: 非常に高いACOSの場合のみACOS_HIGH判定", () => {
    // 閾値を超える高いACOS
    const metrics = createDefaultMetrics({
      acos7dExclRecent: 0.35, // 35% > 30% ✓
      acos30d: 0.25,          // 25% > 23% ✓
    });
    const policy = getEventBidPolicy("BIG_SALE_DAY");
    expect(shouldBeAcosHigh(metrics, targetAcos, policy)).toBe(true);
  });

  it("BIG_SALE_PREPモード: 中間の閾値を使用", () => {
    // BIG_SALE_PREPの閾値: 7d excl > 20% * 1.3 = 26% AND 30d > 20% * 1.1 = 22%
    const metrics = createDefaultMetrics({
      acos7dExclRecent: 0.27, // 27% > 26% ✓
      acos30d: 0.23,          // 23% > 22% ✓
    });
    const policy = getEventBidPolicy("BIG_SALE_PREP");
    expect(shouldBeAcosHigh(metrics, targetAcos, policy)).toBe(true);
  });

  it("イベントポリシーがundefinedの場合、デフォルト閾値を使用", () => {
    const metrics = createDefaultMetrics({
      acos7dExclRecent: 0.25,
      acos30d: 0.22,
    });
    // eventPolicy を渡さない
    expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(true);
  });
});

// =============================================================================
// NO_CONVERSION判定へのイベントオーバーライド テスト
// =============================================================================

describe("shouldBeNoConversion - イベントオーバーライド対応", () => {
  it("NONEモード: 従来通りNO_CONVERSION判定を行う", () => {
    const metrics = createDefaultMetrics({
      clicks7dExclRecent: 15,     // 10以上
      conversions7dExclRecent: 0, // 0
      conversions30d: 1,          // 1以下
    });
    const policy = getEventBidPolicy("NONE");
    expect(shouldBeNoConversion(metrics, policy)).toBe(true);
  });

  it("BIG_SALE_DAYモード: NO_CONVERSION判定が無効化される", () => {
    const metrics = createDefaultMetrics({
      clicks7dExclRecent: 15,
      conversions7dExclRecent: 0,
      conversions30d: 1,
    });
    const policy = getEventBidPolicy("BIG_SALE_DAY");
    // allowNoConversionDown = false なので常にfalse
    expect(shouldBeNoConversion(metrics, policy)).toBe(false);
  });

  it("BIG_SALE_PREPモード: NO_CONVERSION判定は有効", () => {
    const metrics = createDefaultMetrics({
      clicks7dExclRecent: 15,
      conversions7dExclRecent: 0,
      conversions30d: 1,
    });
    const policy = getEventBidPolicy("BIG_SALE_PREP");
    // allowNoConversionDown = true なので判定を実行
    expect(shouldBeNoConversion(metrics, policy)).toBe(true);
  });

  it("イベントポリシーがundefinedの場合、通常の判定を行う", () => {
    const metrics = createDefaultMetrics({
      clicks7dExclRecent: 15,
      conversions7dExclRecent: 0,
      conversions30d: 1,
    });
    expect(shouldBeNoConversion(metrics)).toBe(true);
  });
});

// =============================================================================
// 強いダウンの抑制テスト
// =============================================================================

describe("applyRecentGoodSafetyValve - イベントオーバーライド対応", () => {
  const metrics = createDefaultMetrics({
    conversionsLast3d: 0, // 直近3日に注文なし（好調ではない）
    cvrLast3d: 0.05,
    cvr7dExclRecent: 0.10,
  });

  it("NONEモード: 直近好調でなければSTRONG_DOWNはそのまま", () => {
    const policy = getEventBidPolicy("NONE");
    expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics, policy)).toBe("STRONG_DOWN");
    expect(applyRecentGoodSafetyValve("STOP", metrics, policy)).toBe("STOP");
  });

  it("BIG_SALE_DAYモード: STRONG_DOWNがMILD_DOWNに抑制される", () => {
    const policy = getEventBidPolicy("BIG_SALE_DAY");
    // allowStrongDown = false なので強いダウンは抑制
    expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics, policy)).toBe("MILD_DOWN");
    expect(applyRecentGoodSafetyValve("STOP", metrics, policy)).toBe("MILD_DOWN");
  });

  it("BIG_SALE_DAYモード: MILD_DOWNはそのまま", () => {
    const policy = getEventBidPolicy("BIG_SALE_DAY");
    expect(applyRecentGoodSafetyValve("MILD_DOWN", metrics, policy)).toBe("MILD_DOWN");
  });

  it("BIG_SALE_DAYモード: アップ系アクションは変更なし", () => {
    const policy = getEventBidPolicy("BIG_SALE_DAY");
    expect(applyRecentGoodSafetyValve("STRONG_UP", metrics, policy)).toBe("STRONG_UP");
    expect(applyRecentGoodSafetyValve("MILD_UP", metrics, policy)).toBe("MILD_UP");
    expect(applyRecentGoodSafetyValve("KEEP", metrics, policy)).toBe("KEEP");
  });

  it("BIG_SALE_PREPモード: 強いダウンは許可される", () => {
    const policy = getEventBidPolicy("BIG_SALE_PREP");
    // allowStrongDown = true なのでそのまま
    expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics, policy)).toBe("STRONG_DOWN");
    expect(applyRecentGoodSafetyValve("STOP", metrics, policy)).toBe("STOP");
  });

  it("直近好調の場合は従来通りの安全弁も適用", () => {
    const goodMetrics = createDefaultMetrics({
      conversionsLast3d: 2, // 直近3日に注文あり（好調）
    });
    const policy = getEventBidPolicy("NONE");
    // 直近好調なので、強いダウンは緩和
    expect(applyRecentGoodSafetyValve("STRONG_DOWN", goodMetrics, policy)).toBe("MILD_DOWN");
    expect(applyRecentGoodSafetyValve("STOP", goodMetrics, policy)).toBe("MILD_DOWN");
  });
});

// =============================================================================
// 入札額上下限のクリッピングテスト（概念的検証）
// =============================================================================

describe("EventBidPolicy 入札額制限の仕様確認", () => {
  it("NONEモード: maxBidUpMultiplier=1.3, maxBidDownMultiplier=0.7", () => {
    const policy = getEventBidPolicy("NONE");
    const currentBid = 100;
    const maxBid = currentBid * policy.maxBidUpMultiplier;
    const minBid = currentBid * policy.maxBidDownMultiplier;
    expect(maxBid).toBe(130);
    expect(minBid).toBe(70);
  });

  it("BIG_SALE_DAYモード: maxBidUpMultiplier=1.5, maxBidDownMultiplier=0.9", () => {
    const policy = getEventBidPolicy("BIG_SALE_DAY");
    const currentBid = 100;
    const maxBid = currentBid * policy.maxBidUpMultiplier;
    const minBid = currentBid * policy.maxBidDownMultiplier;
    expect(maxBid).toBe(150); // より大きくアップ可能
    expect(minBid).toBe(90);  // ダウン幅が抑制される
  });

  it("BIG_SALE_PREPモード: maxBidUpMultiplier=1.4, maxBidDownMultiplier=0.85", () => {
    const policy = getEventBidPolicy("BIG_SALE_PREP");
    const currentBid = 100;
    const maxBid = currentBid * policy.maxBidUpMultiplier;
    const minBid = currentBid * policy.maxBidDownMultiplier;
    expect(maxBid).toBe(140);
    expect(minBid).toBe(85);
  });
});

// =============================================================================
// 統合シナリオテスト
// =============================================================================

describe("イベントオーバーライド 統合シナリオ", () => {
  const targetAcos = 0.20;

  describe("シナリオ: プライムデー当日（BIG_SALE_DAY）", () => {
    const policy = getEventBidPolicy("BIG_SALE_DAY");

    it("ACOSがやや高くてもダウン判定されない", () => {
      // 通常時ならACOS_HIGH判定されるケース
      const metrics = createDefaultMetrics({
        acos7dExclRecent: 0.26, // 26% (通常時なら超過)
        acos30d: 0.22,          // 22% (通常時なら超過)
      });
      expect(shouldBeAcosHigh(metrics, targetAcos, policy)).toBe(false);
    });

    it("コンバージョンがなくてもダウン判定されない", () => {
      const metrics = createDefaultMetrics({
        clicks7dExclRecent: 20,
        conversions7dExclRecent: 0,
        conversions30d: 0,
      });
      expect(shouldBeNoConversion(metrics, policy)).toBe(false);
    });

    it("どうしてもダウンする場合はMILD_DOWNに抑制", () => {
      const metrics = createDefaultMetrics();
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics, policy)).toBe("MILD_DOWN");
      expect(applyRecentGoodSafetyValve("STOP", metrics, policy)).toBe("MILD_DOWN");
    });
  });

  describe("シナリオ: セール準備期間（BIG_SALE_PREP）", () => {
    const policy = getEventBidPolicy("BIG_SALE_PREP");

    it("ACOS判定の閾値がやや緩和される", () => {
      const metrics = createDefaultMetrics({
        acos7dExclRecent: 0.25, // 25% (通常時なら超過だが準備期間は許容)
        acos30d: 0.21,          // 21% (通常時なら超過だが準備期間は許容)
      });
      // BIG_SALE_PREP閾値: 7d > 26%, 30d > 22%
      expect(shouldBeAcosHigh(metrics, targetAcos, policy)).toBe(false);
    });

    it("NO_CONVERSION判定は有効", () => {
      const metrics = createDefaultMetrics({
        clicks7dExclRecent: 20,
        conversions7dExclRecent: 0,
        conversions30d: 1,
      });
      expect(shouldBeNoConversion(metrics, policy)).toBe(true);
    });

    it("強いダウンは許可される（直近不調の場合）", () => {
      // 直近3日が不調なメトリクス（好調判定されないようにする）
      const metrics = createDefaultMetrics({
        conversionsLast3d: 0, // 直近に注文なし
        cvrLast3d: 0.05,      // CVRも低い
        cvr7dExclRecent: 0.10,
      });
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics, policy)).toBe("STRONG_DOWN");
    });
  });

  describe("シナリオ: 通常日（NONE）", () => {
    const policy = getEventBidPolicy("NONE");

    it("従来通りの判定を行う", () => {
      const highAcosMetrics = createDefaultMetrics({
        acos7dExclRecent: 0.25,
        acos30d: 0.22,
      });
      expect(shouldBeAcosHigh(highAcosMetrics, targetAcos, policy)).toBe(true);

      const noConvMetrics = createDefaultMetrics({
        clicks7dExclRecent: 15,
        conversions7dExclRecent: 0,
        conversions30d: 1,
      });
      expect(shouldBeNoConversion(noConvMetrics, policy)).toBe(true);
    });
  });
});

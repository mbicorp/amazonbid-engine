/**
 * アトリビューション遅延対策のテスト
 *
 * Amazon広告のアトリビューション遅延（特に直近3日分のコンバージョン欠損）に対する
 * 入札ダウン判定の安全弁が正しく機能することを確認するテスト
 */

// BigQuery と uuid をモック
jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
  })),
}));

jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid"),
}));

import {
  KeywordMetrics,
  ATTRIBUTION_DELAY_CONFIG,
  isRecentPerformanceGood,
  shouldBeNoConversion,
  shouldBeAcosHigh,
  applyRecentGoodSafetyValve,
} from "../src/engine/bidEngine";

/**
 * テスト用のデフォルトKeywordMetricsを生成
 */
function createDefaultMetrics(overrides: Partial<KeywordMetrics> = {}): KeywordMetrics {
  return {
    asin: "B0TESTXXXX",
    keywordId: "kw-001",
    keywordText: "テストキーワード",
    matchType: "EXACT",
    campaignId: "camp-001",
    adGroupId: "ag-001",
    currentBid: 100,
    currentAcos: 0.25, // 25%

    // 7日フル集計
    impressions7d: 1000,
    clicks7d: 50,
    conversions7d: 5,
    spend7d: 5000,
    sales7d: 20000,
    ctr7d: 0.05,
    cvr7d: 0.10,

    // 直近3日除外集計
    impressions7dExclRecent: 600,
    clicks7dExclRecent: 30,
    conversions7dExclRecent: 3,
    spend7dExclRecent: 3000,
    sales7dExclRecent: 12000,
    ctr7dExclRecent: 0.05,
    cvr7dExclRecent: 0.10,
    acos7dExclRecent: 0.25,

    // 直近3日のみ
    impressionsLast3d: 400,
    clicksLast3d: 20,
    conversionsLast3d: 2,
    spendLast3d: 2000,
    salesLast3d: 8000,
    ctrLast3d: 0.05,
    cvrLast3d: 0.10,
    acosLast3d: 0.25,

    // 30日集計
    impressions30d: 4000,
    clicks30d: 200,
    conversions30d: 20,
    spend30d: 20000,
    sales30d: 80000,
    ctr30d: 0.05,
    cvr30d: 0.10,
    acos30d: 0.25,

    // オーガニック順位
    organicRank: null,
    organicRankTrend: null,
    organicRankZone: null,

    ...overrides,
  };
}

describe("アトリビューション遅延対策", () => {
  describe("ATTRIBUTION_DELAY_CONFIG", () => {
    it("緩衝期間は3日に設定されている", () => {
      expect(ATTRIBUTION_DELAY_CONFIG.SAFE_WINDOW_DAYS).toBe(3);
    });

    it("ダウン判定用の閾値が適切に設定されている", () => {
      expect(ATTRIBUTION_DELAY_CONFIG.MIN_CLICKS_FOR_DOWN).toBe(10);
      expect(ATTRIBUTION_DELAY_CONFIG.DOWN_ACOS_MULTIPLIER_7D_EXCL).toBe(1.2);
      expect(ATTRIBUTION_DELAY_CONFIG.DOWN_ACOS_MULTIPLIER_30D).toBe(1.05);
      expect(ATTRIBUTION_DELAY_CONFIG.NO_CONVERSION_MAX_ORDERS_30D).toBe(1);
    });

    it("直近3日好調判定の閾値が適切に設定されている", () => {
      expect(ATTRIBUTION_DELAY_CONFIG.RECENT_GOOD_CVR_RATIO).toBe(1.2);
      expect(ATTRIBUTION_DELAY_CONFIG.REDUCED_DOWN_RATE).toBe(-0.15);
    });
  });

  describe("isRecentPerformanceGood", () => {
    it("直近3日に注文がある場合は好調と判定", () => {
      const metrics = createDefaultMetrics({
        conversionsLast3d: 1,
        cvrLast3d: 0.05,
        cvr7dExclRecent: 0.10, // 直近3日のCVRは悪いが、注文があるので好調
      });
      expect(isRecentPerformanceGood(metrics)).toBe(true);
    });

    it("直近3日に注文がなくてもCVRが良ければ好調と判定", () => {
      const metrics = createDefaultMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.15, // CVR 15%
        cvr7dExclRecent: 0.10, // CVR 10% → 1.5倍なので好調
      });
      expect(isRecentPerformanceGood(metrics)).toBe(true);
    });

    it("直近3日に注文がなくCVRも改善していない場合は好調でないと判定", () => {
      const metrics = createDefaultMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.08, // CVR 8%
        cvr7dExclRecent: 0.10, // CVR 10% → 0.8倍なので好調でない
      });
      expect(isRecentPerformanceGood(metrics)).toBe(false);
    });

    it("CVRがnullの場合は注文数のみで判定", () => {
      const metrics = createDefaultMetrics({
        conversionsLast3d: 0,
        cvrLast3d: null,
        cvr7dExclRecent: null,
      });
      expect(isRecentPerformanceGood(metrics)).toBe(false);
    });
  });

  describe("shouldBeNoConversion", () => {
    it("直近3日除外でクリックが多く注文ゼロ、かつ30日でも注文が少ない場合はNO_CONVERSION", () => {
      const metrics = createDefaultMetrics({
        clicks7dExclRecent: 30, // 閾値10以上
        conversions7dExclRecent: 0,
        conversions30d: 1, // 閾値1以下
      });
      expect(shouldBeNoConversion(metrics)).toBe(true);
    });

    it("直近3日除外でクリックが少ない場合はNO_CONVERSIONでない", () => {
      const metrics = createDefaultMetrics({
        clicks7dExclRecent: 5, // 閾値10未満
        conversions7dExclRecent: 0,
        conversions30d: 0,
      });
      expect(shouldBeNoConversion(metrics)).toBe(false);
    });

    it("直近3日除外で注文がある場合はNO_CONVERSIONでない", () => {
      const metrics = createDefaultMetrics({
        clicks7dExclRecent: 30,
        conversions7dExclRecent: 1, // 注文あり
        conversions30d: 1,
      });
      expect(shouldBeNoConversion(metrics)).toBe(false);
    });

    it("30日で注文が多い場合はNO_CONVERSIONでない（一時的な不調の可能性）", () => {
      const metrics = createDefaultMetrics({
        clicks7dExclRecent: 30,
        conversions7dExclRecent: 0,
        conversions30d: 5, // 閾値1より多い
      });
      expect(shouldBeNoConversion(metrics)).toBe(false);
    });
  });

  describe("shouldBeAcosHigh", () => {
    const targetAcos = 0.20; // 目標ACOS 20%

    it("7日除外版と30日版の両方でACOSが高い場合はACOS_HIGH", () => {
      const metrics = createDefaultMetrics({
        acos7dExclRecent: 0.30, // 30% > 20% * 1.2 = 24%
        acos30d: 0.25, // 25% > 20% * 1.05 = 21%
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(true);
    });

    it("7日除外版だけACOSが高く、30日版は目標内の場合はACOS_HIGHでない", () => {
      const metrics = createDefaultMetrics({
        acos7dExclRecent: 0.30, // 30% > 24%
        acos30d: 0.18, // 18% < 21%
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);
    });

    it("30日版だけACOSが高く、7日除外版は目標内の場合はACOS_HIGHでない", () => {
      const metrics = createDefaultMetrics({
        acos7dExclRecent: 0.20, // 20% < 24%
        acos30d: 0.30, // 30% > 21%
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);
    });

    it("ACOSがnullの場合はACOS_HIGHでない", () => {
      const metrics = createDefaultMetrics({
        acos7dExclRecent: null,
        acos30d: 0.30,
      });
      expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);
    });
  });

  describe("applyRecentGoodSafetyValve", () => {
    it("アップ系アクションはそのまま返す", () => {
      const goodMetrics = createDefaultMetrics({ conversionsLast3d: 1 });
      expect(applyRecentGoodSafetyValve("STRONG_UP", goodMetrics)).toBe("STRONG_UP");
      expect(applyRecentGoodSafetyValve("MILD_UP", goodMetrics)).toBe("MILD_UP");
    });

    it("KEEPアクションはそのまま返す", () => {
      const goodMetrics = createDefaultMetrics({ conversionsLast3d: 1 });
      expect(applyRecentGoodSafetyValve("KEEP", goodMetrics)).toBe("KEEP");
    });

    it("直近3日が好調な場合、STOPはMILD_DOWNに緩和", () => {
      const goodMetrics = createDefaultMetrics({ conversionsLast3d: 1 });
      expect(applyRecentGoodSafetyValve("STOP", goodMetrics)).toBe("MILD_DOWN");
    });

    it("直近3日が好調な場合、STRONG_DOWNはMILD_DOWNに緩和", () => {
      const goodMetrics = createDefaultMetrics({ conversionsLast3d: 1 });
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", goodMetrics)).toBe("MILD_DOWN");
    });

    it("直近3日が好調な場合でも、MILD_DOWNはそのまま", () => {
      const goodMetrics = createDefaultMetrics({ conversionsLast3d: 1 });
      expect(applyRecentGoodSafetyValve("MILD_DOWN", goodMetrics)).toBe("MILD_DOWN");
    });

    it("直近3日が不調な場合、ダウン系アクションはそのまま", () => {
      const badMetrics = createDefaultMetrics({
        conversionsLast3d: 0,
        cvrLast3d: 0.05,
        cvr7dExclRecent: 0.10, // CVR悪化
      });
      expect(applyRecentGoodSafetyValve("STOP", badMetrics)).toBe("STOP");
      expect(applyRecentGoodSafetyValve("STRONG_DOWN", badMetrics)).toBe("STRONG_DOWN");
      expect(applyRecentGoodSafetyValve("MILD_DOWN", badMetrics)).toBe("MILD_DOWN");
    });
  });

  describe("シナリオテスト", () => {
    describe("ケース1: 直近3日はほぼノーデータだが、その前4日で成績が悪い", () => {
      it("従来同様、NO_CONVERSIONによるダウンが発生する", () => {
        const metrics = createDefaultMetrics({
          // 7日フル: 直近3日含めてもクリック多い
          clicks7d: 40,
          conversions7d: 0,

          // 直近3日除外: 十分なクリックで注文ゼロ
          clicks7dExclRecent: 30, // 閾値10以上
          conversions7dExclRecent: 0,

          // 直近3日: ほぼノーデータ
          clicksLast3d: 10,
          conversionsLast3d: 0,
          cvrLast3d: null,

          // 30日: 長期でも注文が少ない
          conversions30d: 1, // 閾値1以下
        });

        expect(shouldBeNoConversion(metrics)).toBe(true);
        expect(isRecentPerformanceGood(metrics)).toBe(false);

        // 安全弁は適用されない（直近が好調でないため）
        expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics)).toBe("STRONG_DOWN");
      });
    });

    describe("ケース2: 直近3日でコンバージョンが付き始めたが、7dExclRecentだけ見るとまだ悪い", () => {
      it("強いダウンは抑えられ、軽めのダウンで止まる", () => {
        const metrics = createDefaultMetrics({
          // 直近3日除外: クリック多いが注文ゼロ（見かけ上悪い）
          clicks7dExclRecent: 30,
          conversions7dExclRecent: 0,
          acos7dExclRecent: null, // 売上ゼロでACOS計算不可

          // 直近3日: 注文が付き始めた！
          clicksLast3d: 10,
          conversionsLast3d: 1, // 注文あり
          cvrLast3d: 0.10,

          // 30日: 長期でもある程度の注文がある
          conversions30d: 5, // 閾値1より多い → NO_CONVERSIONにならない
        });

        // NO_CONVERSION条件を満たさない（30日で注文があるため）
        expect(shouldBeNoConversion(metrics)).toBe(false);

        // 直近3日は好調
        expect(isRecentPerformanceGood(metrics)).toBe(true);

        // STRONG_DOWNはMILD_DOWNに緩和される
        expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics)).toBe("MILD_DOWN");
      });
    });

    describe("ケース3: 7日間ずっと悪い（直近3日も含めて悪い）", () => {
      it("従来通り、しっかりしたダウンが入る", () => {
        const targetAcos = 0.20;

        const metrics = createDefaultMetrics({
          // 7日フル: 悪い
          clicks7d: 50,
          conversions7d: 0,
          currentAcos: 0.50, // 50%

          // 直近3日除外: 悪い
          clicks7dExclRecent: 30,
          conversions7dExclRecent: 0,
          acos7dExclRecent: 0.50, // 50% > 20% * 1.2 = 24%

          // 直近3日: 悪い
          clicksLast3d: 20,
          conversionsLast3d: 0, // 注文なし
          cvrLast3d: null,

          // 30日: 長期でも悪い
          conversions30d: 0,
          acos30d: 0.45, // 45% > 20% * 1.05 = 21%
        });

        // NO_CONVERSION条件を満たす
        expect(shouldBeNoConversion(metrics)).toBe(true);

        // ACOS_HIGH条件を満たす
        expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(true);

        // 直近3日は好調でない
        expect(isRecentPerformanceGood(metrics)).toBe(false);

        // ダウンアクションはそのまま（緩和されない）
        expect(applyRecentGoodSafetyValve("STRONG_DOWN", metrics)).toBe("STRONG_DOWN");
        expect(applyRecentGoodSafetyValve("STOP", metrics)).toBe("STOP");
      });
    });

    describe("ケース4: 7日フルでは悪く見えるが、直近3日除外+30日では問題ない", () => {
      it("アトリビューション遅延の可能性が高いのでダウンを見送る", () => {
        const targetAcos = 0.20;

        const metrics = createDefaultMetrics({
          // 7日フル: 悪く見える（直近3日のCV未計上の影響）
          clicks7d: 50,
          conversions7d: 2, // 少ない
          currentAcos: 0.40, // 40%

          // 直近3日除外: 実は問題ない
          clicks7dExclRecent: 30,
          conversions7dExclRecent: 2, // 注文あり → NO_CONVERSIONでない
          acos7dExclRecent: 0.22, // 22% < 24% → ACOS_HIGHでない

          // 直近3日: CV計上が遅れている可能性
          clicksLast3d: 20,
          conversionsLast3d: 0, // まだ計上されていない
          cvrLast3d: 0,

          // 30日: 実は問題ない
          conversions30d: 10, // 注文あり
          acos30d: 0.20, // 20% < 21% → ACOS_HIGHでない
        });

        // NO_CONVERSION条件を満たさない
        expect(shouldBeNoConversion(metrics)).toBe(false);

        // ACOS_HIGH条件を満たさない
        expect(shouldBeAcosHigh(metrics, targetAcos)).toBe(false);

        // → ダウン判定は見送られ、KEEPになるべき
        // （computeRecommendation内でKEEPに戻される）
      });
    });
  });
});

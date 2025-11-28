/**
 * バックテスト計算ロジックのテスト
 *
 * シミュレーション計算、判定精度評価、集計ロジックの検証
 */

import {
  simulateKeywordDay,
  evaluateDecisionCorrectness,
  aggregateByDay,
  calculateDecisionAccuracy,
  toTimeSeriesEntries,
  calculateImprovement,
  calculateDaysBetween,
  isValidDateRange,
} from "../src/backtest/backtest-calculator";
import {
  HistoricalRecommendation,
  HistoricalPerformance,
  SimulatedResult,
  DEFAULT_BACKTEST_PARAMETERS,
} from "../src/backtest/types";

// =============================================================================
// テストヘルパー
// =============================================================================

/**
 * テスト用のHistoricalRecommendationを作成
 */
function createRecommendation(
  overrides: Partial<HistoricalRecommendation> = {}
): HistoricalRecommendation {
  return {
    recommendationId: "rec-001",
    executionId: "exec-001",
    date: "2024-01-15",
    asin: "B0XXXXXXXX",
    keywordId: "kw-001",
    keywordText: "テストキーワード",
    matchType: "EXACT",
    campaignId: "campaign-001",
    adGroupId: "adgroup-001",
    oldBid: 100,
    newBid: 120,
    bidChange: 20,
    bidChangePercent: 20,
    targetAcos: 0.25,
    currentAcos: 0.30,
    reasonCode: "ACOS_HIGH",
    reasonDetail: "ACOSが目標より高い",
    isApplied: false,
    actualBid: 100,
    ...overrides,
  };
}

/**
 * テスト用のHistoricalPerformanceを作成
 */
function createPerformance(
  overrides: Partial<HistoricalPerformance> = {}
): HistoricalPerformance {
  return {
    date: "2024-01-15",
    asin: "B0XXXXXXXX",
    keywordId: "kw-001",
    campaignId: "campaign-001",
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    spend: 5000,
    sales: 15000,
    ctr: 0.05,
    cvr: 0.10,
    cpc: 100,
    acos: 0.333,
    avgBid: 100,
    avgRank: 5,
    ...overrides,
  };
}

// =============================================================================
// simulateKeywordDay テスト
// =============================================================================

describe("simulateKeywordDay", () => {
  describe("入札増加のシミュレーション", () => {
    it("入札20%増でインプレッション10%増を予測（弾力性0.5）", () => {
      const rec = createRecommendation({
        oldBid: 100,
        newBid: 120,
      });
      const perf = createPerformance({
        impressions: 1000,
        clicks: 50,
        conversions: 5,
        spend: 5000,
        sales: 15000,
      });

      const result = simulateKeywordDay(rec, perf, DEFAULT_BACKTEST_PARAMETERS);

      // bidChangeRate = (120 - 100) / 100 = 0.2
      // impressionMultiplier = 1 + 0.2 * 0.5 = 1.1
      expect(result.simulated.impressions).toBe(1100);
      expect(result.bidChangeRate).toBeCloseTo(0.2, 2);
    });

    it("CTRは維持され、クリックはインプレッションに比例", () => {
      const rec = createRecommendation({
        oldBid: 100,
        newBid: 120,
      });
      const perf = createPerformance({
        impressions: 1000,
        clicks: 50,
        conversions: 5,
      });

      const result = simulateKeywordDay(rec, perf, DEFAULT_BACKTEST_PARAMETERS);

      // クリック = シミュレーションインプレッション * CTR
      const expectedClicks = Math.round(1100 * 0.05);
      expect(result.simulated.clicks).toBe(expectedClicks);
    });

    it("CVRは維持され、コンバージョンはクリックに比例", () => {
      const rec = createRecommendation({
        oldBid: 100,
        newBid: 120,
      });
      const perf = createPerformance({
        impressions: 1000,
        clicks: 50,
        conversions: 5,
        cvr: 0.10,
      });

      const result = simulateKeywordDay(rec, perf, DEFAULT_BACKTEST_PARAMETERS);

      // CVR維持設定ならCVRは変わらない
      const simulatedClicks = result.simulated.clicks;
      const expectedConversions = Math.round(simulatedClicks * 0.10);
      expect(result.simulated.conversions).toBe(expectedConversions);
    });
  });

  describe("入札減少のシミュレーション", () => {
    it("入札20%減でインプレッション10%減を予測", () => {
      const rec = createRecommendation({
        oldBid: 100,
        newBid: 80,
      });
      const perf = createPerformance({
        impressions: 1000,
      });

      const result = simulateKeywordDay(rec, perf, DEFAULT_BACKTEST_PARAMETERS);

      // bidChangeRate = (80 - 100) / 100 = -0.2
      // impressionMultiplier = 1 + (-0.2) * 0.5 = 0.9
      expect(result.simulated.impressions).toBe(900);
    });

    it("CPCも減少し広告費が下がる", () => {
      const rec = createRecommendation({
        oldBid: 100,
        newBid: 80,
      });
      const perf = createPerformance({
        impressions: 1000,
        clicks: 50,
        cpc: 100,
        spend: 5000,
      });

      const result = simulateKeywordDay(rec, perf, DEFAULT_BACKTEST_PARAMETERS);

      // 入札減少により広告費が減少することを確認
      expect(result.simulated.spend).toBeLessThan(perf.spend);
    });
  });

  describe("入札変更なしのシミュレーション", () => {
    it("入札変更なしなら実績と同じ値", () => {
      const rec = createRecommendation({
        oldBid: 100,
        newBid: 100,
      });
      const perf = createPerformance({
        impressions: 1000,
        clicks: 50,
        conversions: 5,
        spend: 5000,
        sales: 15000,
      });

      const result = simulateKeywordDay(rec, perf, DEFAULT_BACKTEST_PARAMETERS);

      expect(result.simulated.impressions).toBe(perf.impressions);
      expect(result.simulated.clicks).toBe(perf.clicks);
      expect(result.simulated.conversions).toBe(perf.conversions);
    });
  });

  describe("実績値の保持", () => {
    it("実績値が正しく保持される", () => {
      const rec = createRecommendation();
      const perf = createPerformance({
        impressions: 1234,
        clicks: 56,
        conversions: 7,
        spend: 8900,
        sales: 25000,
      });

      const result = simulateKeywordDay(rec, perf, DEFAULT_BACKTEST_PARAMETERS);

      expect(result.actual.impressions).toBe(1234);
      expect(result.actual.clicks).toBe(56);
      expect(result.actual.conversions).toBe(7);
      expect(result.actual.spend).toBe(8900);
      expect(result.actual.sales).toBe(25000);
    });
  });
});

// =============================================================================
// evaluateDecisionCorrectness テスト
// =============================================================================

describe("evaluateDecisionCorrectness", () => {
  describe("入札UP判定の評価", () => {
    it("売上5%以上増加で正解", () => {
      const rec = createRecommendation({ newBid: 120, oldBid: 100 });
      const actual = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };
      const simulated = { impressions: 1100, clicks: 55, conversions: 6, spend: 5500, sales: 11000, acos: 0.5 };

      const result = evaluateDecisionCorrectness(rec, actual, simulated);

      expect(result.action).toBe("MILD_UP");
      expect(result.wasCorrect).toBe(true);
    });

    it("売上増加なしで不正解", () => {
      const rec = createRecommendation({ newBid: 120, oldBid: 100 });
      const actual = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };
      const simulated = { impressions: 1100, clicks: 55, conversions: 5, spend: 5500, sales: 10000, acos: 0.55 };

      const result = evaluateDecisionCorrectness(rec, actual, simulated);

      expect(result.action).toBe("MILD_UP");
      expect(result.wasCorrect).toBe(false);
    });
  });

  describe("入札DOWN判定の評価", () => {
    it("広告費5%以上削減で正解", () => {
      // bidChangePercent = -15 → MILD_DOWN
      const rec = createRecommendation({ newBid: 85, oldBid: 100, bidChangePercent: -15 });
      const actual = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };
      const simulated = { impressions: 900, clicks: 45, conversions: 5, spend: 4500, sales: 10000, acos: 0.45 };

      const result = evaluateDecisionCorrectness(rec, actual, simulated);

      expect(result.action).toBe("MILD_DOWN");
      expect(result.wasCorrect).toBe(true);
    });

    it("広告費削減せずに売上減で不正解", () => {
      // bidChangePercent = -15 → MILD_DOWN
      const rec = createRecommendation({ newBid: 85, oldBid: 100, bidChangePercent: -15 });
      const actual = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };
      const simulated = { impressions: 900, clicks: 45, conversions: 4, spend: 4900, sales: 8000, acos: 0.6125 };

      const result = evaluateDecisionCorrectness(rec, actual, simulated);

      expect(result.action).toBe("MILD_DOWN");
      expect(result.wasCorrect).toBe(false);
    });
  });

  describe("入札KEEP判定の評価", () => {
    it("ACOS変動3pt以内で正解", () => {
      // bidChangePercent = 0 → KEEP
      const rec = createRecommendation({ newBid: 100, oldBid: 100, bidChangePercent: 0 });
      const actual = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };
      const simulated = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };

      const result = evaluateDecisionCorrectness(rec, actual, simulated);

      expect(result.action).toBe("KEEP");
      expect(result.wasCorrect).toBe(true);
    });
  });

  describe("アクション判定", () => {
    it("入札25%以上増はSTRONG_UP", () => {
      // bidChangePercent = 30 → STRONG_UP
      const rec = createRecommendation({ newBid: 130, oldBid: 100, bidChangePercent: 30 });
      const actual = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };
      const simulated = { impressions: 1200, clicks: 60, conversions: 7, spend: 6000, sales: 14000, acos: 0.43 };

      const result = evaluateDecisionCorrectness(rec, actual, simulated);

      expect(result.action).toBe("STRONG_UP");
    });

    it("入札25%以上減はSTRONG_DOWN", () => {
      // bidChangePercent = -30 → STRONG_DOWN
      const rec = createRecommendation({ newBid: 70, oldBid: 100, bidChangePercent: -30 });
      const actual = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };
      const simulated = { impressions: 800, clicks: 40, conversions: 4, spend: 3000, sales: 8000, acos: 0.375 };

      const result = evaluateDecisionCorrectness(rec, actual, simulated);

      expect(result.action).toBe("STRONG_DOWN");
    });

    it("入札60%以上減はSTOP", () => {
      // bidChangePercent = -70 → STOP
      const rec = createRecommendation({ newBid: 30, oldBid: 100, bidChangePercent: -70 });
      const actual = { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 10000, acos: 0.5 };
      const simulated = { impressions: 0, clicks: 0, conversions: 0, spend: 0, sales: 0, acos: null };

      const result = evaluateDecisionCorrectness(rec, actual, simulated);

      expect(result.action).toBe("STOP");
    });
  });
});

// =============================================================================
// aggregateByDay テスト
// =============================================================================

describe("aggregateByDay", () => {
  it("同じ日のデータを集計", () => {
    const results: SimulatedResult[] = [
      {
        date: "2024-01-15",
        asin: "B0XXXXXXXX",
        keywordId: "kw-001",
        campaignId: "campaign-001",
        actualBid: 100,
        recommendedBid: 120,
        bidChangeRate: 0.2,
        actual: { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 15000, acos: 0.333 },
        simulated: { impressions: 1100, clicks: 55, conversions: 6, spend: 5500, sales: 18000, acos: 0.306 },
        decision: { action: "MILD_UP", wasCorrect: true, correctnessReason: "売上増加" },
      },
      {
        date: "2024-01-15",
        asin: "B0YYYYYYYY",
        keywordId: "kw-002",
        campaignId: "campaign-001",
        actualBid: 100,
        recommendedBid: 80,
        bidChangeRate: -0.2,
        actual: { impressions: 500, clicks: 25, conversions: 3, spend: 2500, sales: 9000, acos: 0.278 },
        simulated: { impressions: 450, clicks: 23, conversions: 3, spend: 2200, sales: 9000, acos: 0.244 },
        decision: { action: "MILD_DOWN", wasCorrect: true, correctnessReason: "広告費削減" },
      },
    ];

    const aggregates = aggregateByDay(results);

    expect(aggregates.length).toBe(1);
    expect(aggregates[0].date).toBe("2024-01-15");

    const dayData = aggregates[0];
    expect(dayData.actual.spend).toBe(7500);
    expect(dayData.actual.sales).toBe(24000);
    expect(dayData.simulated.spend).toBe(7700);
    expect(dayData.simulated.sales).toBe(27000);
    expect(dayData.decisionsCount).toBe(2);
    expect(dayData.correctDecisions).toBe(2);
  });

  it("複数日のデータを日別に分離", () => {
    const results: SimulatedResult[] = [
      {
        date: "2024-01-15",
        asin: "B0XXXXXXXX",
        keywordId: "kw-001",
        campaignId: "campaign-001",
        actualBid: 100,
        recommendedBid: 120,
        bidChangeRate: 0.2,
        actual: { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 15000, acos: 0.333 },
        simulated: { impressions: 1100, clicks: 55, conversions: 6, spend: 5500, sales: 18000, acos: 0.306 },
        decision: { action: "MILD_UP", wasCorrect: true, correctnessReason: "" },
      },
      {
        date: "2024-01-16",
        asin: "B0XXXXXXXX",
        keywordId: "kw-001",
        campaignId: "campaign-001",
        actualBid: 120,
        recommendedBid: 120,
        bidChangeRate: 0,
        actual: { impressions: 1200, clicks: 60, conversions: 6, spend: 6000, sales: 18000, acos: 0.333 },
        simulated: { impressions: 1200, clicks: 60, conversions: 6, spend: 6000, sales: 18000, acos: 0.333 },
        decision: { action: "KEEP", wasCorrect: true, correctnessReason: "" },
      },
    ];

    const aggregates = aggregateByDay(results);

    expect(aggregates.length).toBe(2);
    expect(aggregates.some(a => a.date === "2024-01-15")).toBe(true);
    expect(aggregates.some(a => a.date === "2024-01-16")).toBe(true);
  });
});

// =============================================================================
// calculateDecisionAccuracy テスト
// =============================================================================

describe("calculateDecisionAccuracy", () => {
  it("全体の正解率を計算", () => {
    const results: SimulatedResult[] = [
      {
        date: "2024-01-15",
        asin: "B0XXXXXXXX",
        keywordId: "kw-001",
        campaignId: "campaign-001",
        actualBid: 100,
        recommendedBid: 120,
        bidChangeRate: 0.2,
        actual: { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 15000, acos: 0.333 },
        simulated: { impressions: 1100, clicks: 55, conversions: 6, spend: 5500, sales: 18000, acos: 0.306 },
        decision: { action: "MILD_UP", wasCorrect: true, correctnessReason: "" },
      },
      {
        date: "2024-01-15",
        asin: "B0YYYYYYYY",
        keywordId: "kw-002",
        campaignId: "campaign-001",
        actualBid: 100,
        recommendedBid: 80,
        bidChangeRate: -0.2,
        actual: { impressions: 500, clicks: 25, conversions: 3, spend: 2500, sales: 9000, acos: 0.278 },
        simulated: { impressions: 450, clicks: 23, conversions: 2, spend: 2200, sales: 6000, acos: 0.367 },
        decision: { action: "MILD_DOWN", wasCorrect: false, correctnessReason: "" },
      },
    ];

    const accuracy = calculateDecisionAccuracy(results);

    expect(accuracy.totalDecisions).toBe(2);
    expect(accuracy.correctDecisions).toBe(1);
    expect(accuracy.accuracyRate).toBeCloseTo(0.5, 2);
  });

  it("アクション別の正解率を計算", () => {
    const results: SimulatedResult[] = [
      {
        date: "2024-01-15",
        asin: "B0XXXXXXXX",
        keywordId: "kw-001",
        campaignId: "campaign-001",
        actualBid: 100,
        recommendedBid: 120,
        bidChangeRate: 0.2,
        actual: { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 15000, acos: 0.333 },
        simulated: { impressions: 1100, clicks: 55, conversions: 6, spend: 5500, sales: 18000, acos: 0.306 },
        decision: { action: "MILD_UP", wasCorrect: true, correctnessReason: "" },
      },
      {
        date: "2024-01-16",
        asin: "B0XXXXXXXX",
        keywordId: "kw-001",
        campaignId: "campaign-001",
        actualBid: 100,
        recommendedBid: 115,
        bidChangeRate: 0.15,
        actual: { impressions: 1000, clicks: 50, conversions: 5, spend: 5000, sales: 15000, acos: 0.333 },
        simulated: { impressions: 1075, clicks: 54, conversions: 5, spend: 5200, sales: 15000, acos: 0.347 },
        decision: { action: "MILD_UP", wasCorrect: false, correctnessReason: "" },
      },
    ];

    const accuracy = calculateDecisionAccuracy(results);

    expect(accuracy.byAction.MILD_UP.total).toBe(2);
    expect(accuracy.byAction.MILD_UP.correct).toBe(1);
    expect(accuracy.byAction.MILD_UP.rate).toBeCloseTo(0.5, 2);
  });
});

// =============================================================================
// calculateImprovement テスト
// =============================================================================

describe("calculateImprovement", () => {
  it("改善率を正しく計算", () => {
    const actual = { spend: 100000, sales: 300000, acos: 0.333, roas: 3.0 };
    const simulated = { spend: 90000, sales: 300000, acos: 0.30, roas: 3.33 };

    const improvement = calculateImprovement(actual, simulated, 0.3);

    expect(improvement.spendDiff).toBe(-10000);
    expect(improvement.spendDiffPercent).toBeCloseTo(-10, 1);
    // acosDiff = actual - simulated = 0.333 - 0.30 = 0.033 (positive means improvement)
    expect(improvement.acosDiff).toBeCloseTo(0.033, 2);
    expect(improvement.roasDiff).toBeCloseTo(0.33, 2);
  });

  it("推定利益改善額を計算", () => {
    const actual = { spend: 100000, sales: 300000, acos: 0.333, roas: 3.0 };
    const simulated = { spend: 100000, sales: 330000, acos: 0.303, roas: 3.3 };
    const profitMargin = 0.3;

    const improvement = calculateImprovement(actual, simulated, profitMargin);

    // 売上増加分 * 利益率 = 30000 * 0.3 = 9000
    expect(improvement.estimatedProfitGain).toBeCloseTo(9000, 0);
  });
});

// =============================================================================
// toTimeSeriesEntries テスト
// =============================================================================

describe("toTimeSeriesEntries", () => {
  it("DailyAggregateを時系列エントリに変換", () => {
    const aggregates: import("../src/backtest/types").DailyAggregate[] = [
      {
        date: "2024-01-15",
        actual: { spend: 4000, sales: 12000, conversions: 4, acos: 0.333, roas: 3 },
        simulated: { spend: 4400, sales: 14000, conversions: 5, acos: 0.314, roas: 3.18 },
        decisionsCount: 2,
        correctDecisions: 2,
      },
      {
        date: "2024-01-16",
        actual: { spend: 5000, sales: 15000, conversions: 5, acos: 0.333, roas: 3 },
        simulated: { spend: 5500, sales: 18000, conversions: 6, acos: 0.306, roas: 3.27 },
        decisionsCount: 1,
        correctDecisions: 1,
      },
    ];

    const entries = toTimeSeriesEntries(aggregates);

    expect(entries.length).toBe(2);
    // toTimeSeriesEntriesは入力の順序を維持
    expect(entries[0].date).toBe("2024-01-15");
    expect(entries[1].date).toBe("2024-01-16");
    expect(entries[0].actualSpend).toBe(4000);
    expect(entries[0].simulatedSpend).toBe(4400);
  });
});

// =============================================================================
// calculateDaysBetween テスト
// =============================================================================

describe("calculateDaysBetween", () => {
  it("日数を正しく計算", () => {
    expect(calculateDaysBetween("2024-01-01", "2024-01-01")).toBe(1);
    expect(calculateDaysBetween("2024-01-01", "2024-01-07")).toBe(7);
    expect(calculateDaysBetween("2024-01-01", "2024-01-31")).toBe(31);
  });

  it("月をまたぐ場合も正しく計算", () => {
    expect(calculateDaysBetween("2024-01-30", "2024-02-02")).toBe(4);
  });
});

// =============================================================================
// isValidDateRange テスト
// =============================================================================

describe("isValidDateRange", () => {
  it("有効な期間でtrue", () => {
    expect(isValidDateRange("2024-01-01", "2024-01-31")).toBe(true);
    // 2024は閏年で366日なので365日以内に収まるのは12/30まで
    expect(isValidDateRange("2024-01-01", "2024-12-30")).toBe(true);
  });

  it("開始日が終了日より後でfalse", () => {
    expect(isValidDateRange("2024-01-31", "2024-01-01")).toBe(false);
  });

  it("365日を超えるとfalse", () => {
    expect(isValidDateRange("2024-01-01", "2025-01-02")).toBe(false);
    // 2024は閏年で366日
    expect(isValidDateRange("2024-01-01", "2024-12-31")).toBe(false);
  });

  it("365日以内ならtrue", () => {
    // 2024-01-01 〜 2024-12-30 = 365日
    expect(isValidDateRange("2024-01-01", "2024-12-30")).toBe(true);
  });
});

/**
 * SEOローンチ評価モジュールのテスト
 */

import {
  KeywordCoreRole,
  CoreKeywordType,
  SeoLaunchStatus,
  KeywordConfigExtended,
  KeywordRankSummary,
  SeoLaunchConfig,
  DEFAULT_SEO_LAUNCH_CONFIG,
  evaluateKeywordSeoStatus,
  summarizeAsinSeoLaunchProgress,
  decideLaunchExit,
  decideLaunchExitWithScaling,
  LaunchExitThresholds,
  DEFAULT_LAUNCH_EXIT_THRESHOLDS,
  LaunchExitBaseThresholds,
  DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
  computeLaunchExitThresholdsForAsin,
  aggregateKeywordRankMetrics,
  KeywordRankMetrics,
  AsinSeoLaunchProgress,
} from "../../src/lifecycle/seo-launch-evaluator";
import { InvestmentState, AsinLossBudgetMetrics } from "../../src/analytics/lossBudgetEvaluator";

// =============================================================================
// evaluateKeywordSeoStatus テスト
// =============================================================================

describe("evaluateKeywordSeoStatus", () => {
  const baseKeyword: KeywordConfigExtended = {
    keywordId: "kw-001",
    asin: "B00TEST123",
    keyword: "テストキーワード",
    coreRole: KeywordCoreRole.CORE,
    coreType: CoreKeywordType.MIDDLE,
    targetRankMin: 1,
    targetRankMax: 5,
  };

  const baseRankSummary: KeywordRankSummary = {
    keywordId: "kw-001",
    asin: "B00TEST123",
    periodStart: "2025-01-01",
    periodEnd: "2025-01-30",
    currentRank: 3,
    bestRankWindow: 2,
    avgRankWindow: 4,
    impressionsTotal: 1000,
    clicksTotal: 50,
    ordersTotal: 5,
    costTotal: 10000,
    revenueTotal: 50000,
    daysWithRankData: 25,
    firstRankedDate: "2025-01-05",
  };

  const targetCpa = 5000;

  describe("ACHIEVED判定", () => {
    it("目標順位到達でACHIEVED", () => {
      const result = evaluateKeywordSeoStatus(
        baseKeyword,
        baseRankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.ACHIEVED);
      expect(result.reason).toContain("目標順位");
      expect(result.currentRank).toBe(3);
    });

    it("インプレッション不足ではACHIEVEDにならない", () => {
      const summary: KeywordRankSummary = {
        ...baseRankSummary,
        impressionsTotal: 100, // 不足
      };

      const result = evaluateKeywordSeoStatus(
        baseKeyword,
        summary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.ACTIVE);
    });

    it("順位が目標外ではACHIEVEDにならない", () => {
      const summary: KeywordRankSummary = {
        ...baseRankSummary,
        currentRank: 10, // 目標外
      };

      const result = evaluateKeywordSeoStatus(
        baseKeyword,
        summary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.ACTIVE);
    });
  });

  describe("GAVE_UP判定", () => {
    it("十分試したが順位が悪い場合GAVE_UP", () => {
      const summary: KeywordRankSummary = {
        ...baseRankSummary,
        currentRank: 50,
        bestRankWindow: 30, // 20位より悪い
        clicksTotal: 300, // 十分なクリック
        costTotal: 60000, // 目標CPA×10倍以上
        daysWithRankData: 45, // 30日以上
        ordersTotal: 2,
      };

      const result = evaluateKeywordSeoStatus(
        baseKeyword,
        summary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.GAVE_UP);
      expect(result.reason).toContain("目標達成困難");
    });

    it("CVRとACOSが悪い場合GAVE_UP", () => {
      // CVR <= 2% かつ ACOS >= 100% の場合にGAVE_UP
      // CVR = orders / clicks = 5 / 300 = 1.67%
      // ACOS = cost / revenue = 60000 / 25000 = 2.4 (240%)
      const summary: KeywordRankSummary = {
        ...baseRankSummary,
        currentRank: 15,
        bestRankWindow: 12,
        clicksTotal: 300,
        costTotal: 60000,
        ordersTotal: 5, // CVR 1.67% (< maxCvrForGiveUp 2%)
        revenueTotal: 25000, // 低売上 → ACOS 240% (> maxAcosForGiveUp 100%)
        daysWithRankData: 40,
      };

      const result = evaluateKeywordSeoStatus(
        baseKeyword,
        summary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      // bestRankWindow=12は maxBestRankForGiveUp=20より良いので順位による GAVE_UP にはならない
      // しかし、CVR=1.67%でmaxCvrForGiveUp=2%以下、かつACOS=240%でmaxAcosForGiveUp=100%以上
      // ACOS = cost / revenue = 60000 / 25000 = 2.4 (240%)（標準的なACOS定義）
      // パフォーマンスが悪いためGAVE_UPになる
      expect(result.status).toBe(SeoLaunchStatus.GAVE_UP);
      expect(result.reason).toContain("CVR");
      expect(result.reason).toContain("ACOS");
    });
  });

  describe("ACTIVE判定", () => {
    it("試行中はACTIVE", () => {
      const summary: KeywordRankSummary = {
        ...baseRankSummary,
        currentRank: 15,
        bestRankWindow: 10,
        clicksTotal: 100, // まだ試行中
        costTotal: 20000,
        daysWithRankData: 20,
      };

      const result = evaluateKeywordSeoStatus(
        baseKeyword,
        summary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.ACTIVE);
      expect(result.reason).toContain("継続中");
    });

    it("COREでないキーワードは評価対象外でACTIVE", () => {
      const supportKeyword: KeywordConfigExtended = {
        ...baseKeyword,
        coreRole: KeywordCoreRole.SUPPORT,
      };

      const result = evaluateKeywordSeoStatus(
        supportKeyword,
        baseRankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.ACTIVE);
      expect(result.reason).toContain("コアキーワードではない");
    });
  });
});

// =============================================================================
// summarizeAsinSeoLaunchProgress テスト
// =============================================================================

describe("summarizeAsinSeoLaunchProgress", () => {
  const asin = "B00TEST123";

  const keywords: KeywordConfigExtended[] = [
    { keywordId: "kw-001", asin, keyword: "KW1", coreRole: KeywordCoreRole.CORE, targetRankMax: 5 },
    { keywordId: "kw-002", asin, keyword: "KW2", coreRole: KeywordCoreRole.CORE, targetRankMax: 5 },
    { keywordId: "kw-003", asin, keyword: "KW3", coreRole: KeywordCoreRole.CORE, targetRankMax: 5 },
    { keywordId: "kw-004", asin, keyword: "KW4", coreRole: KeywordCoreRole.SUPPORT, targetRankMax: 10 },
  ];

  it("進捗率を正しく計算する", () => {
    const statusResults = [
      { keywordId: "kw-001", status: SeoLaunchStatus.ACHIEVED, reason: "", currentRank: 3, targetRankMax: 5, bestRank: 2, clicksTotal: 100, costTotal: 5000 },
      { keywordId: "kw-002", status: SeoLaunchStatus.GAVE_UP, reason: "", currentRank: 30, targetRankMax: 5, bestRank: 25, clicksTotal: 300, costTotal: 60000 },
      { keywordId: "kw-003", status: SeoLaunchStatus.ACTIVE, reason: "", currentRank: 10, targetRankMax: 5, bestRank: 8, clicksTotal: 50, costTotal: 10000 },
    ];

    const progress = summarizeAsinSeoLaunchProgress(asin, keywords, statusResults);

    expect(progress.totalCoreKeywords).toBe(3);
    expect(progress.achievedCount).toBe(1);
    expect(progress.gaveUpCount).toBe(1);
    expect(progress.activeCount).toBe(1);
    expect(progress.completionRatio).toBeCloseTo(2 / 3, 5);
    expect(progress.successRatio).toBeCloseTo(1 / 3, 5);
  });

  it("コアキーワードがない場合", () => {
    const noCorKeywords: KeywordConfigExtended[] = [
      { keywordId: "kw-001", asin, keyword: "KW1", coreRole: KeywordCoreRole.SUPPORT, targetRankMax: 10 },
    ];

    const progress = summarizeAsinSeoLaunchProgress(asin, noCorKeywords, []);

    expect(progress.totalCoreKeywords).toBe(0);
    expect(progress.completionRatio).toBe(0);
  });
});

// =============================================================================
// decideLaunchExit テスト
// =============================================================================

describe("decideLaunchExit", () => {
  const asin = "B00TEST123";

  const baseProgress: AsinSeoLaunchProgress = {
    asin,
    totalCoreKeywords: 10,
    achievedCount: 5,
    gaveUpCount: 2,
    activeCount: 3,
    completionRatio: 0.7,
    successRatio: 0.5,
    keywordStatuses: [],
  };

  const baseLossBudget: AsinLossBudgetMetrics = {
    asin,
    lifecycleStage: "LAUNCH_HARD",
    g: 0.55,
    tOpt: 0.15,
    sales: 100000,
    adCost: 20000,
    targetNetMarginMid: 0.40,
    targetNetProfit: 40000,
    actualNetProfit: 35000,
    profitGap: 5000,
    lossBudgetMultiple: 2.5,
    lossBudgetStage: 100000,
    ratioStage: 0.05,
    investmentState: InvestmentState.SAFE,
    periodStart: "2025-01-01",
    periodEnd: "2025-01-30",
    calculationNote: "",
  };

  describe("緊急終了（lossBudget超過）", () => {
    it("BREACH状態で緊急終了", () => {
      const breachLossBudget: AsinLossBudgetMetrics = {
        ...baseLossBudget,
        investmentState: InvestmentState.BREACH,
        ratioStage: 1.1,
      };

      const decision = decideLaunchExit(
        asin,
        "LAUNCH_HARD",
        30,
        1000,
        30,
        { ...baseProgress, completionRatio: 0.3 }, // SEO未完でも
        breachLossBudget,
        DEFAULT_LAUNCH_EXIT_THRESHOLDS
      );

      expect(decision.shouldExitLaunch).toBe(true);
      expect(decision.isEmergencyExit).toBe(true);
      expect(decision.reasonCodes).toContain("LOSS_BUDGET_EMERGENCY");
      expect(decision.recommendedNextStage).toBe("GROW");
    });

    it("emergencyLossRatioThreshold超過で緊急終了", () => {
      const highRatioLossBudget: AsinLossBudgetMetrics = {
        ...baseLossBudget,
        investmentState: InvestmentState.LIMIT,
        ratioStage: 1.3, // threshold 1.2超過
      };

      const decision = decideLaunchExit(
        asin,
        "LAUNCH_HARD",
        30,
        1000,
        30,
        baseProgress,
        highRatioLossBudget,
        DEFAULT_LAUNCH_EXIT_THRESHOLDS
      );

      expect(decision.shouldExitLaunch).toBe(true);
      expect(decision.isEmergencyExit).toBe(true);
    });
  });

  describe("通常終了（SEO完了 + 時間/データ条件）", () => {
    it("SEO完了率達成 + 日数条件で通常終了", () => {
      const decision = decideLaunchExit(
        asin,
        "LAUNCH_HARD",
        50, // 45日以上
        2000,
        50,
        baseProgress, // 70%達成
        baseLossBudget,
        DEFAULT_LAUNCH_EXIT_THRESHOLDS
      );

      expect(decision.shouldExitLaunch).toBe(true);
      expect(decision.isEmergencyExit).toBe(false);
      expect(decision.reasonCodes).toContain("CORE_COMPLETION");
      expect(decision.reasonCodes).toContain("DAYS_OR_DATA");
    });

    it("SEO完了率達成 + クリック条件で通常終了", () => {
      const decision = decideLaunchExit(
        asin,
        "LAUNCH_SOFT",
        30, // 日数は未達
        3000, // クリックは達成
        50,
        baseProgress,
        baseLossBudget,
        DEFAULT_LAUNCH_EXIT_THRESHOLDS
      );

      expect(decision.shouldExitLaunch).toBe(true);
      expect(decision.isEmergencyExit).toBe(false);
    });

    it("SEO完了率達成 + 注文条件で通常終了", () => {
      const decision = decideLaunchExit(
        asin,
        "LAUNCH_SOFT",
        30,
        1000,
        100, // 注文は達成
        baseProgress,
        baseLossBudget,
        DEFAULT_LAUNCH_EXIT_THRESHOLDS
      );

      expect(decision.shouldExitLaunch).toBe(true);
      expect(decision.isEmergencyExit).toBe(false);
    });
  });

  describe("継続判定", () => {
    it("SEO未完で継続", () => {
      const lowProgress: AsinSeoLaunchProgress = {
        ...baseProgress,
        completionRatio: 0.5, // 70%未満
      };

      const decision = decideLaunchExit(
        asin,
        "LAUNCH_HARD",
        50,
        3000,
        100,
        lowProgress,
        baseLossBudget,
        DEFAULT_LAUNCH_EXIT_THRESHOLDS
      );

      expect(decision.shouldExitLaunch).toBe(false);
      expect(decision.reasonCodes).toContain("NOT_READY");
      expect(decision.reasonMessage).toContain("SEO完了率");
    });

    it("試行条件未達で継続", () => {
      const decision = decideLaunchExit(
        asin,
        "LAUNCH_HARD",
        20, // 日数未達
        500, // クリック未達
        20, // 注文未達
        baseProgress,
        baseLossBudget,
        DEFAULT_LAUNCH_EXIT_THRESHOLDS
      );

      expect(decision.shouldExitLaunch).toBe(false);
      expect(decision.reasonMessage).toContain("試行条件未達");
    });

    it("LAUNCH期でない場合は判定対象外", () => {
      const decision = decideLaunchExit(
        asin,
        "GROW",
        50,
        3000,
        100,
        baseProgress,
        baseLossBudget,
        DEFAULT_LAUNCH_EXIT_THRESHOLDS
      );

      expect(decision.shouldExitLaunch).toBe(false);
      expect(decision.reasonMessage).toContain("LAUNCH期ではない");
    });
  });

  describe("カスタム閾値", () => {
    it("厳しい閾値で継続になる", () => {
      const strictThresholds: LaunchExitThresholds = {
        ...DEFAULT_LAUNCH_EXIT_THRESHOLDS,
        minCoreCompletionRatio: 0.9, // 90%必要
      };

      const decision = decideLaunchExit(
        asin,
        "LAUNCH_HARD",
        50,
        3000,
        100,
        baseProgress, // 70%しか達成していない
        baseLossBudget,
        strictThresholds
      );

      expect(decision.shouldExitLaunch).toBe(false);
    });
  });
});

// =============================================================================
// aggregateKeywordRankMetrics テスト
// =============================================================================

describe("aggregateKeywordRankMetrics", () => {
  it("日次データから集計サマリーを作成", () => {
    const metrics: KeywordRankMetrics[] = [
      { asin: "B00TEST", keywordId: "kw-001", date: "2025-01-25", organicRank: 5, impressions: 100, clicks: 10, orders: 1, cost: 1000, revenue: 5000 },
      { asin: "B00TEST", keywordId: "kw-001", date: "2025-01-26", organicRank: 4, impressions: 120, clicks: 12, orders: 2, cost: 1200, revenue: 10000 },
      { asin: "B00TEST", keywordId: "kw-001", date: "2025-01-27", organicRank: 3, impressions: 150, clicks: 15, orders: 1, cost: 1500, revenue: 5000 },
      { asin: "B00TEST", keywordId: "kw-001", date: "2025-01-28", organicRank: 3, impressions: 130, clicks: 13, orders: 2, cost: 1300, revenue: 10000 },
      { asin: "B00TEST", keywordId: "kw-001", date: "2025-01-29", organicRank: 2, impressions: 140, clicks: 14, orders: 1, cost: 1400, revenue: 5000 },
    ];

    const summaries = aggregateKeywordRankMetrics(
      metrics,
      "2025-01-01",
      "2025-01-30",
      7
    );

    const summary = summaries.get("kw-001");
    expect(summary).toBeDefined();
    expect(summary!.impressionsTotal).toBe(640);
    expect(summary!.clicksTotal).toBe(64);
    expect(summary!.ordersTotal).toBe(7);
    expect(summary!.bestRankWindow).toBe(2);
    expect(summary!.daysWithRankData).toBe(5);
    // 直近7日間の平均
    expect(summary!.currentRank).toBeCloseTo((5 + 4 + 3 + 3 + 2) / 5, 1);
  });

  it("圏外のみの場合", () => {
    const metrics: KeywordRankMetrics[] = [
      { asin: "B00TEST", keywordId: "kw-002", date: "2025-01-28", organicRank: null, impressions: 100, clicks: 5, orders: 0, cost: 500, revenue: 0 },
      { asin: "B00TEST", keywordId: "kw-002", date: "2025-01-29", organicRank: null, impressions: 120, clicks: 6, orders: 0, cost: 600, revenue: 0 },
    ];

    const summaries = aggregateKeywordRankMetrics(
      metrics,
      "2025-01-01",
      "2025-01-30",
      7
    );

    const summary = summaries.get("kw-002");
    expect(summary).toBeDefined();
    expect(summary!.currentRank).toBeNull();
    expect(summary!.bestRankWindow).toBeNull();
    expect(summary!.daysWithRankData).toBe(0);
  });
});

// =============================================================================
// computeLaunchExitThresholdsForAsin テスト（ASIN固有スケーリング）
// =============================================================================

describe("computeLaunchExitThresholdsForAsin", () => {
  const baseThresholds = DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS;

  describe("volumeScale計算", () => {
    it("基準日販数と同じ場合、volumeScale=1.0", () => {
      // avgDailySales30d = 20, refDailySales = 20
      const computed = computeLaunchExitThresholdsForAsin(
        "B00TEST123",
        baseThresholds,
        20 // refDailySalesと同じ
      );

      expect(computed.volumeScale).toBe(1.0);
      expect(computed.minAsinClicksTotal).toBe(2500); // base × 1.0
      expect(computed.minAsinOrdersTotal).toBe(80); // base × 1.0
    });

    it("高日販ASINでvolumeScale=2.0（上限）", () => {
      // avgDailySales30d = 100, refDailySales = 20 → volumeRaw = 5.0
      // clamp(5.0, 0.5, 2.0) = 2.0
      const computed = computeLaunchExitThresholdsForAsin(
        "B00HIGH",
        baseThresholds,
        100
      );

      expect(computed.volumeScale).toBe(2.0);
      expect(computed.minAsinClicksTotal).toBe(5000); // 2500 × 2.0
      expect(computed.minAsinOrdersTotal).toBe(160); // 80 × 2.0
    });

    it("低日販ASINでvolumeScale=0.5（下限）", () => {
      // avgDailySales30d = 5, refDailySales = 20 → volumeRaw = 0.25
      // clamp(0.25, 0.5, 2.0) = 0.5
      const computed = computeLaunchExitThresholdsForAsin(
        "B00LOW",
        baseThresholds,
        5
      );

      expect(computed.volumeScale).toBe(0.5);
      expect(computed.minAsinClicksTotal).toBe(1250); // 2500 × 0.5
      expect(computed.minAsinOrdersTotal).toBe(40); // 80 × 0.5
    });

    it("中間の日販数で適切にスケーリング", () => {
      // avgDailySales30d = 30, refDailySales = 20 → volumeRaw = 1.5
      // clamp(1.5, 0.5, 2.0) = 1.5
      const computed = computeLaunchExitThresholdsForAsin(
        "B00MID",
        baseThresholds,
        30
      );

      expect(computed.volumeScale).toBe(1.5);
      expect(computed.minAsinClicksTotal).toBe(3750); // 2500 × 1.5
      expect(computed.minAsinOrdersTotal).toBe(120); // 80 × 1.5
    });
  });

  describe("スケーリングされない項目", () => {
    it("minLaunchDaysはスケーリングされない", () => {
      const lowVolume = computeLaunchExitThresholdsForAsin("B00LOW", baseThresholds, 5);
      const highVolume = computeLaunchExitThresholdsForAsin("B00HIGH", baseThresholds, 100);

      expect(lowVolume.minLaunchDays).toBe(45);
      expect(highVolume.minLaunchDays).toBe(45);
    });

    it("minCoreCompletionRatioはスケーリングされない", () => {
      const lowVolume = computeLaunchExitThresholdsForAsin("B00LOW", baseThresholds, 5);
      const highVolume = computeLaunchExitThresholdsForAsin("B00HIGH", baseThresholds, 100);

      expect(lowVolume.minCoreCompletionRatio).toBe(0.7);
      expect(highVolume.minCoreCompletionRatio).toBe(0.7);
    });

    it("emergencyLossRatioThresholdはスケーリングされない", () => {
      const lowVolume = computeLaunchExitThresholdsForAsin("B00LOW", baseThresholds, 5);
      const highVolume = computeLaunchExitThresholdsForAsin("B00HIGH", baseThresholds, 100);

      expect(lowVolume.emergencyLossRatioThreshold).toBe(1.2);
      expect(highVolume.emergencyLossRatioThreshold).toBe(1.2);
    });
  });

  describe("カスタムベース閾値", () => {
    it("カスタム設定でスケーリング", () => {
      const customBase: LaunchExitBaseThresholds = {
        baseMinLaunchDays: 60,
        baseMinAsinClicksTotal: 3000,
        baseMinAsinOrdersTotal: 100,
        minCoreCompletionRatio: 0.8,
        emergencyLossRatioThreshold: 1.5,
        refDailySales: 10, // 基準を10に変更
        minVolumeScale: 0.3,
        maxVolumeScale: 3.0,
      };

      // avgDailySales30d = 30, refDailySales = 10 → volumeRaw = 3.0
      // clamp(3.0, 0.3, 3.0) = 3.0
      const computed = computeLaunchExitThresholdsForAsin(
        "B00CUSTOM",
        customBase,
        30
      );

      expect(computed.volumeScale).toBe(3.0);
      expect(computed.minLaunchDays).toBe(60);
      expect(computed.minAsinClicksTotal).toBe(9000); // 3000 × 3.0
      expect(computed.minAsinOrdersTotal).toBe(300); // 100 × 3.0
      expect(computed.minCoreCompletionRatio).toBe(0.8);
      expect(computed.emergencyLossRatioThreshold).toBe(1.5);
    });
  });
});

// =============================================================================
// decideLaunchExitWithScaling テスト
// =============================================================================

describe("decideLaunchExitWithScaling", () => {
  const asin = "B00TEST123";

  const baseProgress: AsinSeoLaunchProgress = {
    asin,
    totalCoreKeywords: 10,
    achievedCount: 5,
    gaveUpCount: 2,
    activeCount: 3,
    completionRatio: 0.7,
    successRatio: 0.5,
    keywordStatuses: [],
  };

  const baseLossBudget: AsinLossBudgetMetrics = {
    asin,
    lifecycleStage: "LAUNCH_HARD",
    g: 0.55,
    tOpt: 0.15,
    sales: 100000,
    adCost: 20000,
    targetNetMarginMid: 0.40,
    targetNetProfit: 40000,
    actualNetProfit: 35000,
    profitGap: 5000,
    lossBudgetMultiple: 2.5,
    lossBudgetStage: 100000,
    ratioStage: 0.05,
    investmentState: InvestmentState.SAFE,
    periodStart: "2025-01-01",
    periodEnd: "2025-01-30",
    calculationNote: "",
  };

  it("高日販ASINで高い閾値を使用", () => {
    // avgDailySales30d = 50 → volumeScale = 2.0 (上限)
    // minAsinClicksTotal = 5000, minAsinOrdersTotal = 160
    const computed = computeLaunchExitThresholdsForAsin(
      asin,
      DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      50
    );

    const decision = decideLaunchExitWithScaling(
      asin,
      "LAUNCH_HARD",
      50,
      4000, // 5000未満 → クリック条件未達
      100, // 160未満 → 注文条件未達
      baseProgress,
      baseLossBudget,
      computed
    );

    // 日数は50日で45日以上なので達成
    expect(decision.shouldExitLaunch).toBe(true);
    expect(decision.volumeScale).toBe(2.0);
    expect(decision.thresholdsUsed?.minAsinClicksTotal).toBe(5000);
    expect(decision.thresholdsUsed?.minAsinOrdersTotal).toBe(160);
  });

  it("低日販ASINで低い閾値を使用して終了", () => {
    // avgDailySales30d = 5 → volumeScale = 0.5 (下限)
    // minAsinClicksTotal = 1250, minAsinOrdersTotal = 40
    const computed = computeLaunchExitThresholdsForAsin(
      asin,
      DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      5
    );

    const decision = decideLaunchExitWithScaling(
      asin,
      "LAUNCH_HARD",
      30, // 日数未達
      1500, // 1250以上 → クリック条件達成
      30, // 40未満 → 注文条件未達
      baseProgress,
      baseLossBudget,
      computed
    );

    expect(decision.shouldExitLaunch).toBe(true);
    expect(decision.volumeScale).toBe(0.5);
    expect(decision.thresholdsUsed?.minAsinClicksTotal).toBe(1250);
  });

  it("結果にvolumeScaleとthresholdsUsedが含まれる", () => {
    const computed = computeLaunchExitThresholdsForAsin(
      asin,
      DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      20
    );

    const decision = decideLaunchExitWithScaling(
      asin,
      "LAUNCH_HARD",
      50,
      3000,
      100,
      baseProgress,
      baseLossBudget,
      computed
    );

    expect(decision.volumeScale).toBe(1.0);
    expect(decision.thresholdsUsed).toBeDefined();
    expect(decision.thresholdsUsed?.minLaunchDays).toBe(45);
    expect(decision.thresholdsUsed?.minAsinClicksTotal).toBe(2500);
    expect(decision.thresholdsUsed?.minAsinOrdersTotal).toBe(80);
    expect(decision.thresholdsUsed?.minCoreCompletionRatio).toBe(0.7);
    expect(decision.thresholdsUsed?.emergencyLossRatioThreshold).toBe(1.2);
  });

  it("緊急終了でもスケーリング情報が含まれる", () => {
    const computed = computeLaunchExitThresholdsForAsin(
      asin,
      DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      30
    );

    const breachLossBudget: AsinLossBudgetMetrics = {
      ...baseLossBudget,
      investmentState: InvestmentState.BREACH,
      ratioStage: 1.5,
    };

    const decision = decideLaunchExitWithScaling(
      asin,
      "LAUNCH_HARD",
      20,
      500,
      10,
      { ...baseProgress, completionRatio: 0.3 },
      breachLossBudget,
      computed
    );

    expect(decision.shouldExitLaunch).toBe(true);
    expect(decision.isEmergencyExit).toBe(true);
    expect(decision.volumeScale).toBe(1.5);
    expect(decision.thresholdsUsed).toBeDefined();
  });
});

// =============================================================================
// evaluateLaunchExitForAsin テスト（統合関数）
// =============================================================================

import {
  evaluateLaunchExitForAsin,
  EvaluateLaunchExitForAsinParams,
} from "../../src/lifecycle/seo-launch-evaluator";

describe("evaluateLaunchExitForAsin", () => {
  const asin = "B00TEST123";

  const baseProgress: AsinSeoLaunchProgress = {
    asin,
    totalCoreKeywords: 10,
    achievedCount: 5,
    gaveUpCount: 2,
    activeCount: 3,
    completionRatio: 0.7,
    successRatio: 0.5,
    keywordStatuses: [],
  };

  const baseLossBudget: AsinLossBudgetMetrics = {
    asin,
    lifecycleStage: "LAUNCH_HARD",
    g: 0.55,
    tOpt: 0.15,
    sales: 100000,
    adCost: 20000,
    targetNetMarginMid: 0.40,
    targetNetProfit: 40000,
    actualNetProfit: 35000,
    profitGap: 5000,
    lossBudgetMultiple: 2.5,
    lossBudgetStage: 100000,
    ratioStage: 0.05,
    investmentState: InvestmentState.SAFE,
    periodStart: "2025-01-01",
    periodEnd: "2025-01-30",
    calculationNote: "",
  };

  describe("通常終了", () => {
    it("completionRatio + 日数/クリック/注文がすべて閾値を満たし、lossBudgetも健全な場合 → shouldExitLaunch=true, isEmergencyExit=false", () => {
      const params: EvaluateLaunchExitForAsinParams = {
        asin,
        lifecycleStage: "LAUNCH_HARD",
        daysSinceLaunch: 50,
        asinClicksTotal: 3000,
        asinOrdersTotal: 100,
        avgDailySales30d: 20, // volumeScale = 1.0
        progress: baseProgress,
        lossBudget: baseLossBudget,
        baseThresholds: DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      };

      const result = evaluateLaunchExitForAsin(params);

      expect(result.decision.shouldExitLaunch).toBe(true);
      expect(result.decision.isEmergencyExit).toBe(false);
      expect(result.decision.recommendedNextStage).toBe("GROW");
      expect(result.decision.reasonCodes).toContain("CORE_COMPLETION");
      expect(result.decision.reasonCodes).toContain("DAYS_OR_DATA");
      expect(result.thresholds.volumeScale).toBe(1.0);
      expect(result.progress.completionRatio).toBe(0.7);
    });
  });

  describe("緊急終了", () => {
    it("completionRatioは低いが、lossBudget ratioStageがemergencyLossRatioThresholdを超える場合 → shouldExitLaunch=true, isEmergencyExit=true", () => {
      const breachLossBudget: AsinLossBudgetMetrics = {
        ...baseLossBudget,
        investmentState: InvestmentState.BREACH,
        ratioStage: 1.5, // emergencyLossRatioThreshold(1.2)を超過
      };

      const lowProgress: AsinSeoLaunchProgress = {
        ...baseProgress,
        completionRatio: 0.3, // SEO完了率は低い
      };

      const params: EvaluateLaunchExitForAsinParams = {
        asin,
        lifecycleStage: "LAUNCH_HARD",
        daysSinceLaunch: 30,
        asinClicksTotal: 500,
        asinOrdersTotal: 20,
        avgDailySales30d: 20,
        progress: lowProgress,
        lossBudget: breachLossBudget,
        baseThresholds: DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      };

      const result = evaluateLaunchExitForAsin(params);

      expect(result.decision.shouldExitLaunch).toBe(true);
      expect(result.decision.isEmergencyExit).toBe(true);
      expect(result.decision.reasonCodes).toContain("LOSS_BUDGET_EMERGENCY");
    });
  });

  describe("継続", () => {
    it("completionRatioも日数/データも不足し、lossBudgetも健全な場合 → shouldExitLaunch=false", () => {
      const lowProgress: AsinSeoLaunchProgress = {
        ...baseProgress,
        completionRatio: 0.4, // 70%未満
      };

      const params: EvaluateLaunchExitForAsinParams = {
        asin,
        lifecycleStage: "LAUNCH_HARD",
        daysSinceLaunch: 20, // 45日未満
        asinClicksTotal: 500, // 2500未満
        asinOrdersTotal: 20, // 80未満
        avgDailySales30d: 20,
        progress: lowProgress,
        lossBudget: baseLossBudget,
        baseThresholds: DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      };

      const result = evaluateLaunchExitForAsin(params);

      expect(result.decision.shouldExitLaunch).toBe(false);
      expect(result.decision.reasonCodes).toContain("NOT_READY");
    });
  });

  describe("日販数によるスケーリング", () => {
    it("高日販ASINでは閾値が高くなる", () => {
      const params: EvaluateLaunchExitForAsinParams = {
        asin,
        lifecycleStage: "LAUNCH_HARD",
        daysSinceLaunch: 50,
        asinClicksTotal: 4000, // 5000未満
        asinOrdersTotal: 100, // 160未満
        avgDailySales30d: 60, // volumeScale = 2.0 (上限)
        progress: baseProgress,
        lossBudget: baseLossBudget,
        baseThresholds: DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      };

      const result = evaluateLaunchExitForAsin(params);

      // 日数条件は達成(50>=45)しているので終了
      expect(result.decision.shouldExitLaunch).toBe(true);
      expect(result.thresholds.volumeScale).toBe(2.0);
      expect(result.thresholds.minAsinClicksTotal).toBe(5000);
      expect(result.thresholds.minAsinOrdersTotal).toBe(160);
    });

    it("低日販ASINでは閾値が低くなる", () => {
      const params: EvaluateLaunchExitForAsinParams = {
        asin,
        lifecycleStage: "LAUNCH_HARD",
        daysSinceLaunch: 30,
        asinClicksTotal: 1300, // 1250以上 → クリック条件達成
        asinOrdersTotal: 30,
        avgDailySales30d: 5, // volumeScale = 0.5 (下限)
        progress: baseProgress,
        lossBudget: baseLossBudget,
        baseThresholds: DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      };

      const result = evaluateLaunchExitForAsin(params);

      expect(result.decision.shouldExitLaunch).toBe(true);
      expect(result.thresholds.volumeScale).toBe(0.5);
      expect(result.thresholds.minAsinClicksTotal).toBe(1250);
      expect(result.thresholds.minAsinOrdersTotal).toBe(40);
    });
  });

  describe("progressの引き継ぎ", () => {
    it("入力したprogressがそのまま結果に含まれる", () => {
      const params: EvaluateLaunchExitForAsinParams = {
        asin,
        lifecycleStage: "LAUNCH_HARD",
        daysSinceLaunch: 50,
        asinClicksTotal: 3000,
        asinOrdersTotal: 100,
        avgDailySales30d: 20,
        progress: baseProgress,
        lossBudget: baseLossBudget,
        baseThresholds: DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
      };

      const result = evaluateLaunchExitForAsin(params);

      expect(result.progress).toBe(baseProgress);
      expect(result.progress.asin).toBe(asin);
      expect(result.progress.totalCoreKeywords).toBe(10);
    });
  });
});

/**
 * Dayparting (時間帯別入札最適化) テスト
 */

import {
  // 型
  HourOfDay,
  DayOfWeek,
  DaypartingMode,
  ConfidenceLevel,
  HourClassification,
  HourlyPerformanceMetrics,
  HourlyAnalysisResult,
  HourlyBidMultiplier,
  DaypartingConfig,
  DaypartingFeedbackRecord,
  // 定数
  DAYPARTING_CONSTANTS,
  VALID_DAYPARTING_MODES,
  VALID_CONFIDENCE_LEVELS,
  VALID_HOUR_CLASSIFICATIONS,
  // 設定
  GLOBAL_DAYPARTING_DEFAULTS,
  CONFIDENCE_SAMPLE_THRESHOLDS,
  CONFIDENCE_MULTIPLIER_FACTORS,
  CLASSIFICATION_BASE_MULTIPLIERS,
  createDaypartingConfig,
  validateDaypartingConfig,
  determineConfidenceLevel,
  determineClassification,
  // 統計
  normalCdf,
  tCdf,
  standardError,
  oneSampleTTest,
  calculateMeanAndStd,
  analyzeHourlyPerformance,
  calculateRecommendedMultiplier,
  filterSignificantHours,
  generateAnalysisSummary,
  // 乗数計算
  calculateMultipliers,
  getMultiplierForCurrentTime,
  applyMultiplierToBid,
  calculateMultiplierDiff,
  generateDefaultMultipliers,
  mergeMultipliers,
  deactivateMultipliers,
  // 安全機構
  performSafetyCheck,
  detectLossExceeded,
  detectPerformanceDrop,
  createRollbackInfo,
  executeRollback,
  applyGradualChange,
  applyGradualChanges,
  DEFAULT_SAFETY_CHECK_CONFIG,
  // フィードバック
  createFeedbackRecord,
  createFeedbackFromMultiplier,
  evaluateFeedback,
  calculateHourlySuccessRates,
  calculateMultiplierRangeSuccessRates,
  DEFAULT_SUCCESS_CRITERIA,
  // メトリクス収集
  calculateOverallAverages,
  aggregateMetricsByHour,
  getHourAndDayOfWeek,
  formatHour,
  formatDayOfWeek,
} from "../src/dayparting";

// =============================================================================
// 型定義テスト
// =============================================================================

describe("型定義", () => {
  test("VALID_DAYPARTING_MODES", () => {
    expect(VALID_DAYPARTING_MODES).toContain("OFF");
    expect(VALID_DAYPARTING_MODES).toContain("SHADOW");
    expect(VALID_DAYPARTING_MODES).toContain("APPLY");
    expect(VALID_DAYPARTING_MODES.length).toBe(3);
  });

  test("VALID_CONFIDENCE_LEVELS", () => {
    expect(VALID_CONFIDENCE_LEVELS).toContain("HIGH");
    expect(VALID_CONFIDENCE_LEVELS).toContain("MEDIUM");
    expect(VALID_CONFIDENCE_LEVELS).toContain("LOW");
    expect(VALID_CONFIDENCE_LEVELS).toContain("INSUFFICIENT");
    expect(VALID_CONFIDENCE_LEVELS.length).toBe(4);
  });

  test("VALID_HOUR_CLASSIFICATIONS", () => {
    expect(VALID_HOUR_CLASSIFICATIONS).toContain("PEAK");
    expect(VALID_HOUR_CLASSIFICATIONS).toContain("GOOD");
    expect(VALID_HOUR_CLASSIFICATIONS).toContain("AVERAGE");
    expect(VALID_HOUR_CLASSIFICATIONS).toContain("POOR");
    expect(VALID_HOUR_CLASSIFICATIONS).toContain("DEAD");
    expect(VALID_HOUR_CLASSIFICATIONS.length).toBe(5);
  });

  test("DAYPARTING_CONSTANTS", () => {
    expect(DAYPARTING_CONSTANTS.HOURS_PER_DAY).toBe(24);
    expect(DAYPARTING_CONSTANTS.DAYS_PER_WEEK).toBe(7);
    expect(DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER).toBe(1.0);
  });
});

// =============================================================================
// 設定テスト
// =============================================================================

describe("設定", () => {
  test("createDaypartingConfig - デフォルト値で作成", () => {
    const config = createDaypartingConfig("B001", "campaign1");

    expect(config.asin).toBe("B001");
    expect(config.campaignId).toBe("campaign1");
    expect(config.adGroupId).toBeNull();
    expect(config.mode).toBe(GLOBAL_DAYPARTING_DEFAULTS.mode);
    expect(config.enabled).toBe(GLOBAL_DAYPARTING_DEFAULTS.enabled);
    expect(config.maxMultiplier).toBe(GLOBAL_DAYPARTING_DEFAULTS.maxMultiplier);
    expect(config.minMultiplier).toBe(GLOBAL_DAYPARTING_DEFAULTS.minMultiplier);
  });

  test("createDaypartingConfig - オーバーライドで作成", () => {
    const config = createDaypartingConfig("B001", "campaign1", "adgroup1", {
      mode: "APPLY",
      enabled: true,
      maxMultiplier: 1.5,
    });

    expect(config.adGroupId).toBe("adgroup1");
    expect(config.mode).toBe("APPLY");
    expect(config.enabled).toBe(true);
    expect(config.maxMultiplier).toBe(1.5);
  });

  test("validateDaypartingConfig - 有効な設定", () => {
    const config = createDaypartingConfig("B001", "campaign1");
    const result = validateDaypartingConfig(config);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("validateDaypartingConfig - 無効な設定", () => {
    const config = createDaypartingConfig("B001", "campaign1", null, {
      maxMultiplier: 0.5, // 1.0未満は無効
      minMultiplier: 1.5, // 1.0より大きいは無効
    });

    const result = validateDaypartingConfig(config);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("determineConfidenceLevel - 高信頼度", () => {
    const level = determineConfidenceLevel(100, 0.01);
    expect(level).toBe("HIGH");
  });

  test("determineConfidenceLevel - 中信頼度", () => {
    const level = determineConfidenceLevel(50, 0.05);
    expect(level).toBe("MEDIUM");
  });

  test("determineConfidenceLevel - 低信頼度", () => {
    const level = determineConfidenceLevel(30, 0.10);
    expect(level).toBe("LOW");
  });

  test("determineConfidenceLevel - 不十分", () => {
    const level = determineConfidenceLevel(10, 0.5);
    expect(level).toBe("INSUFFICIENT");
  });

  test("determineClassification - PEAK", () => {
    const classification = determineClassification(1.5);
    expect(classification).toBe("PEAK");
  });

  test("determineClassification - GOOD", () => {
    const classification = determineClassification(1.15);
    expect(classification).toBe("GOOD");
  });

  test("determineClassification - AVERAGE", () => {
    const classification = determineClassification(1.0);
    expect(classification).toBe("AVERAGE");
  });

  test("determineClassification - POOR", () => {
    const classification = determineClassification(0.8);
    expect(classification).toBe("POOR");
  });

  test("determineClassification - DEAD", () => {
    const classification = determineClassification(0.5);
    expect(classification).toBe("DEAD");
  });
});

// =============================================================================
// 統計関数テスト
// =============================================================================

describe("統計関数", () => {
  test("normalCdf - 標準正規分布", () => {
    // z=0 で 0.5
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    // z=1.96 で約0.975 (95%信頼区間)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    // z=-1.96 で約0.025
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });

  test("tCdf - t分布（大きい自由度）", () => {
    // 自由度が大きいと正規分布に近づく
    // df > 100 で正規分布への近似を使用
    expect(tCdf(0, 101)).toBeCloseTo(0.5, 2);
    expect(tCdf(1.96, 101)).toBeCloseTo(0.975, 2);
  });

  test("tCdf - t分布（中程度の自由度）", () => {
    // df=100 は不完全ベータ関数で計算
    expect(tCdf(0, 100)).toBeCloseTo(0.5, 2);
    // t=2.0, df=30 で約0.973
    expect(tCdf(2.0, 30)).toBeGreaterThan(0.97);
  });

  test("standardError - 標準誤差", () => {
    const se = standardError(10, 100);
    expect(se).toBe(1); // 10 / sqrt(100) = 1
  });

  test("standardError - n=1の場合", () => {
    const se = standardError(10, 1);
    expect(se).toBe(Infinity);
  });

  test("oneSampleTTest - 有意差あり", () => {
    const result = oneSampleTTest(10, 5, 2, 30);
    expect(result.tStat).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.degreesOfFreedom).toBe(29);
  });

  test("oneSampleTTest - 有意差なし", () => {
    const result = oneSampleTTest(5, 5, 2, 30);
    expect(result.tStat).toBeCloseTo(0, 5);
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  test("calculateMeanAndStd - 正常ケース", () => {
    const values = [2, 4, 6, 8, 10];
    const { mean, std } = calculateMeanAndStd(values);
    expect(mean).toBe(6);
    expect(std).toBeCloseTo(3.162, 2);
  });

  test("calculateMeanAndStd - 空配列", () => {
    const { mean, std } = calculateMeanAndStd([]);
    expect(mean).toBe(0);
    expect(std).toBe(0);
  });

  test("calculateMeanAndStd - 単一要素", () => {
    const { mean, std } = calculateMeanAndStd([5]);
    expect(mean).toBe(5);
    expect(std).toBe(0);
  });
});

// =============================================================================
// 分析テスト
// =============================================================================

describe("分析", () => {
  const createMockMetrics = (hour: HourOfDay, cvr: number, roas: number): HourlyPerformanceMetrics => ({
    asin: "B001",
    campaignId: "campaign1",
    adGroupId: "adgroup1",
    hour,
    dayOfWeek: 0,
    impressions: 1000,
    clicks: 100,
    conversions: cvr * 100,
    spend: 1000,
    sales: roas * 1000,
    ctr: 0.1,
    cvr,
    acos: 1 / roas,
    roas,
    cpc: 10,
    dataPoints: 10,
    periodStart: new Date(),
    periodEnd: new Date(),
  });

  test("analyzeHourlyPerformance - 基本動作", () => {
    const metrics: HourlyPerformanceMetrics[] = [];

    // 各時間帯に複数のデータポイントを追加
    for (let h = 0; h < 24; h++) {
      for (let i = 0; i < 5; i++) {
        const cvr = h === 20 ? 0.1 : 0.05; // 20時はCVRが高い
        const roas = h === 20 ? 4 : 2;
        metrics.push(createMockMetrics(h as HourOfDay, cvr, roas));
      }
    }

    const results = analyzeHourlyPerformance(metrics);

    expect(results.length).toBe(24);

    // 20時は相対パフォーマンスが高いはず
    const hour20 = results.find(r => r.hour === 20);
    expect(hour20).toBeDefined();
    expect(hour20!.relativeCvrPerformance).toBeGreaterThan(1);
  });

  test("filterSignificantHours - 有意な時間帯のみ抽出", () => {
    const results: HourlyAnalysisResult[] = [
      {
        hour: 10,
        dayOfWeek: null,
        meanCvr: 0.1,
        stdCvr: 0.01,
        meanRoas: 3,
        stdRoas: 0.5,
        sampleSize: 100,
        overallMeanCvr: 0.08,
        overallMeanRoas: 2.5,
        relativeCvrPerformance: 1.25,
        relativeRoasPerformance: 1.2,
        tStatCvr: 3,
        pValueCvr: 0.01,
        tStatRoas: 2,
        pValueRoas: 0.03,
        confidence: "HIGH",
        classification: "GOOD",
        recommendedMultiplier: 1.1,
      },
      {
        hour: 3,
        dayOfWeek: null,
        meanCvr: 0.02,
        stdCvr: 0.005,
        meanRoas: 1,
        stdRoas: 0.5,
        sampleSize: 10,
        overallMeanCvr: 0.08,
        overallMeanRoas: 2.5,
        relativeCvrPerformance: 0.25,
        relativeRoasPerformance: 0.4,
        tStatCvr: -1,
        pValueCvr: 0.3,
        tStatRoas: -2,
        pValueRoas: 0.2,
        confidence: "INSUFFICIENT",
        classification: "DEAD",
        recommendedMultiplier: 1.0,
      },
    ];

    const significant = filterSignificantHours(results, "LOW");
    expect(significant.length).toBe(1);
    expect(significant[0].hour).toBe(10);
  });

  test("generateAnalysisSummary - サマリー生成", () => {
    const results: HourlyAnalysisResult[] = [
      {
        hour: 20,
        dayOfWeek: null,
        meanCvr: 0.1,
        stdCvr: 0.01,
        meanRoas: 4,
        stdRoas: 0.5,
        sampleSize: 100,
        overallMeanCvr: 0.05,
        overallMeanRoas: 2,
        relativeCvrPerformance: 2,
        relativeRoasPerformance: 2,
        tStatCvr: 5,
        pValueCvr: 0.001,
        tStatRoas: 4,
        pValueRoas: 0.001,
        confidence: "HIGH",
        classification: "PEAK",
        recommendedMultiplier: 1.2,
      },
      {
        hour: 3,
        dayOfWeek: null,
        meanCvr: 0.01,
        stdCvr: 0.005,
        meanRoas: 0.5,
        stdRoas: 0.2,
        sampleSize: 100,
        overallMeanCvr: 0.05,
        overallMeanRoas: 2,
        relativeCvrPerformance: 0.2,
        relativeRoasPerformance: 0.25,
        tStatCvr: -5,
        pValueCvr: 0.001,
        tStatRoas: -6,
        pValueRoas: 0.001,
        confidence: "HIGH",
        classification: "DEAD",
        recommendedMultiplier: 0.7,
      },
    ];

    const summary = generateAnalysisSummary(results);

    expect(summary.peakHours).toContain(20);
    expect(summary.deadHours).toContain(3);
    expect(summary.significantCount).toBe(2);
    expect(summary.highConfidenceCount).toBe(2);
  });

  test("calculateRecommendedMultiplier - HIGH信頼度", () => {
    const multiplier = calculateRecommendedMultiplier(1.3, "HIGH", "PEAK");
    expect(multiplier).toBeGreaterThan(1.0);
    expect(multiplier).toBeLessThanOrEqual(1.2);
  });

  test("calculateRecommendedMultiplier - INSUFFICIENT信頼度", () => {
    const multiplier = calculateRecommendedMultiplier(1.5, "INSUFFICIENT", "PEAK");
    expect(multiplier).toBe(1.0); // 信頼度不足なので1.0
  });
});

// =============================================================================
// 乗数計算テスト
// =============================================================================

describe("乗数計算", () => {
  test("calculateMultipliers - 基本動作", () => {
    const analysisResults: HourlyAnalysisResult[] = [
      {
        hour: 20,
        dayOfWeek: null,
        meanCvr: 0.1,
        stdCvr: 0.01,
        meanRoas: 4,
        stdRoas: 0.5,
        sampleSize: 100,
        overallMeanCvr: 0.05,
        overallMeanRoas: 2,
        relativeCvrPerformance: 2,
        relativeRoasPerformance: 2,
        tStatCvr: 5,
        pValueCvr: 0.001,
        tStatRoas: 4,
        pValueRoas: 0.001,
        confidence: "HIGH",
        classification: "PEAK",
        recommendedMultiplier: 1.2,
      },
    ];

    const config = createDaypartingConfig("B001", "campaign1");
    const result = calculateMultipliers(analysisResults, config);

    expect(result.multipliers.length).toBe(1);
    expect(result.multipliers[0].hour).toBe(20);
    expect(result.multipliers[0].multiplier).toBeGreaterThanOrEqual(config.minMultiplier);
    expect(result.multipliers[0].multiplier).toBeLessThanOrEqual(config.maxMultiplier);
  });

  test("getMultiplierForCurrentTime - 完全一致", () => {
    const multipliers: HourlyBidMultiplier[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: 3,
        multiplier: 1.2,
        confidence: "HIGH",
        classification: "PEAK",
        effectiveFrom: new Date(),
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = getMultiplierForCurrentTime(multipliers, 20, 3);
    expect(result).toBeDefined();
    expect(result!.multiplier).toBe(1.2);
  });

  test("getMultiplierForCurrentTime - 時間帯のみ一致", () => {
    const multipliers: HourlyBidMultiplier[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null, // 全曜日
        multiplier: 1.15,
        confidence: "MEDIUM",
        classification: "GOOD",
        effectiveFrom: new Date(),
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = getMultiplierForCurrentTime(multipliers, 20, 5);
    expect(result).toBeDefined();
    expect(result!.multiplier).toBe(1.15);
  });

  test("applyMultiplierToBid - 通常ケース", () => {
    const adjusted = applyMultiplierToBid(100, 1.2);
    expect(adjusted).toBe(120);
  });

  test("applyMultiplierToBid - 下限クリップ", () => {
    const adjusted = applyMultiplierToBid(100, 0.001, 10);
    expect(adjusted).toBe(10);
  });

  test("applyMultiplierToBid - 上限クリップ", () => {
    const adjusted = applyMultiplierToBid(100, 100, 1, 500);
    expect(adjusted).toBe(500);
  });

  test("generateDefaultMultipliers - 24時間分", () => {
    const config = createDaypartingConfig("B001", "campaign1");
    const multipliers = generateDefaultMultipliers(config, false);

    expect(multipliers.length).toBe(24);
    multipliers.forEach(m => {
      expect(m.multiplier).toBe(1.0);
      expect(m.dayOfWeek).toBeNull();
    });
  });

  test("mergeMultipliers - 上書き", () => {
    const existing: HourlyBidMultiplier[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null,
        multiplier: 1.0,
        confidence: "INSUFFICIENT",
        classification: "AVERAGE",
        effectiveFrom: new Date(),
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const updates: HourlyBidMultiplier[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null,
        multiplier: 1.2,
        confidence: "HIGH",
        classification: "PEAK",
        effectiveFrom: new Date(),
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const merged = mergeMultipliers(existing, updates);
    expect(merged.length).toBe(1);
    expect(merged[0].multiplier).toBe(1.2);
  });

  test("calculateMultiplierDiff - 変更検出", () => {
    const oldM: HourlyBidMultiplier[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null,
        multiplier: 1.0,
        confidence: "INSUFFICIENT",
        classification: "AVERAGE",
        effectiveFrom: new Date(),
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const newM: HourlyBidMultiplier[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null,
        multiplier: 1.2,
        confidence: "HIGH",
        classification: "PEAK",
        effectiveFrom: new Date(),
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const diff = calculateMultiplierDiff(newM, oldM);
    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0].diff).toBeCloseTo(0.2, 2);
  });
});

// =============================================================================
// 安全機構テスト
// =============================================================================

describe("安全機構", () => {
  test("performSafetyCheck - 安全な場合", () => {
    const multiplier: HourlyBidMultiplier = {
      asin: "B001",
      campaignId: "campaign1",
      adGroupId: null,
      hour: 20,
      dayOfWeek: null,
      multiplier: 1.1,
      confidence: "HIGH",
      classification: "GOOD",
      effectiveFrom: new Date(),
      effectiveTo: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const config = createDaypartingConfig("B001", "campaign1");

    const result = performSafetyCheck(multiplier, config, [], []);

    expect(result.isSafe).toBe(true);
    expect(result.recommendedAction).toBe("APPLY");
  });

  test("performSafetyCheck - 乗数が範囲外", () => {
    const multiplier: HourlyBidMultiplier = {
      asin: "B001",
      campaignId: "campaign1",
      adGroupId: null,
      hour: 20,
      dayOfWeek: null,
      multiplier: 2.0, // maxMultiplierを超過
      confidence: "HIGH",
      classification: "PEAK",
      effectiveFrom: new Date(),
      effectiveTo: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const config = createDaypartingConfig("B001", "campaign1", null, {
      maxMultiplier: 1.3,
    });

    const result = performSafetyCheck(multiplier, config, [], []);

    expect(result.isSafe).toBe(true); // 警告はあるが安全
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.adjustedMultiplier).toBe(1.3);
  });

  test("createRollbackInfo - ロールバック情報作成", () => {
    const multipliers: HourlyBidMultiplier[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null,
        multiplier: 1.2,
        confidence: "HIGH",
        classification: "PEAK",
        effectiveFrom: new Date(),
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const rollback = createRollbackInfo("B001", "campaign1", "Test rollback", multipliers);

    expect(rollback.rollbackId).toContain("rollback_");
    expect(rollback.asin).toBe("B001");
    expect(rollback.reason).toBe("Test rollback");
    expect(rollback.previousMultipliers.length).toBe(1);
  });

  test("executeRollback - 乗数リセット", () => {
    const multipliers: HourlyBidMultiplier[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null,
        multiplier: 1.2,
        confidence: "HIGH",
        classification: "PEAK",
        effectiveFrom: new Date(),
        effectiveTo: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const result = executeRollback(multipliers);

    expect(result.length).toBe(1);
    expect(result[0].multiplier).toBe(1.0);
    expect(result[0].isActive).toBe(true);
  });

  test("applyGradualChange - 段階的変化", () => {
    const result = applyGradualChange(1.0, 1.2, 0.05);
    expect(result).toBe(1.05);
  });

  test("applyGradualChange - 大きな変化を制限", () => {
    const result = applyGradualChange(1.0, 1.5, 0.05);
    expect(result).toBe(1.05); // 0.5ではなく0.05に制限
  });
});

// =============================================================================
// フィードバックテスト
// =============================================================================

describe("フィードバック", () => {
  test("createFeedbackRecord - 作成", () => {
    const feedback = createFeedbackRecord({
      asin: "B001",
      campaignId: "campaign1",
      adGroupId: null,
      hour: 20,
      dayOfWeek: null,
      appliedMultiplier: 1.2,
      cvrBefore: 0.05,
      roasBefore: 2.0,
      clicksBefore: 100,
      conversionsBefore: 5,
    });

    expect(feedback.feedbackId).toContain("feedback_");
    expect(feedback.asin).toBe("B001");
    expect(feedback.appliedMultiplier).toBe(1.2);
    expect(feedback.evaluated).toBe(false);
  });

  test("evaluateFeedback - 成功", () => {
    const feedback = createFeedbackRecord({
      asin: "B001",
      campaignId: "campaign1",
      adGroupId: null,
      hour: 20,
      dayOfWeek: null,
      appliedMultiplier: 1.2,
      cvrBefore: 0.05,
      roasBefore: 2.0,
      clicksBefore: 100,
      conversionsBefore: 5,
    });

    const evaluated = evaluateFeedback(feedback, {
      cvrAfter: 0.06, // 改善
      roasAfter: 2.2, // 改善
      clicksAfter: 120,
      conversionsAfter: 7,
    });

    expect(evaluated.evaluated).toBe(true);
    expect(evaluated.isSuccess).toBe(true);
    expect(evaluated.successScore).toBeGreaterThan(0);
  });

  test("evaluateFeedback - 失敗（大きな悪化）", () => {
    const feedback = createFeedbackRecord({
      asin: "B001",
      campaignId: "campaign1",
      adGroupId: null,
      hour: 20,
      dayOfWeek: null,
      appliedMultiplier: 1.2,
      cvrBefore: 0.05,
      roasBefore: 2.0,
      clicksBefore: 100,
      conversionsBefore: 5,
    });

    const evaluated = evaluateFeedback(feedback, {
      cvrAfter: 0.02, // 大幅悪化
      roasAfter: 0.8, // 大幅悪化
      clicksAfter: 50,
      conversionsAfter: 1,
    });

    expect(evaluated.evaluated).toBe(true);
    expect(evaluated.isSuccess).toBe(false);
  });

  test("calculateHourlySuccessRates - 集計", () => {
    const feedbacks: DaypartingFeedbackRecord[] = [
      {
        feedbackId: "1",
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null,
        appliedMultiplier: 1.2,
        appliedAt: new Date(),
        evaluatedAt: new Date(),
        cvrBefore: 0.05,
        roasBefore: 2.0,
        clicksBefore: 100,
        conversionsBefore: 5,
        cvrAfter: 0.06,
        roasAfter: 2.2,
        clicksAfter: 120,
        conversionsAfter: 7,
        isSuccess: true,
        successScore: 0.8,
        evaluated: true,
      },
      {
        feedbackId: "2",
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: null,
        hour: 20,
        dayOfWeek: null,
        appliedMultiplier: 1.2,
        appliedAt: new Date(),
        evaluatedAt: new Date(),
        cvrBefore: 0.05,
        roasBefore: 2.0,
        clicksBefore: 100,
        conversionsBefore: 5,
        cvrAfter: 0.04,
        roasAfter: 1.8,
        clicksAfter: 80,
        conversionsAfter: 3,
        isSuccess: false,
        successScore: 0,
        evaluated: true,
      },
    ];

    const rates = calculateHourlySuccessRates(feedbacks);
    const hour20 = rates.get(20);

    expect(hour20).toBeDefined();
    expect(hour20!.count).toBe(2);
    expect(hour20!.successRate).toBe(0.5);
  });
});

// =============================================================================
// ユーティリティテスト
// =============================================================================

describe("ユーティリティ", () => {
  test("getHourAndDayOfWeek", () => {
    const date = new Date("2024-01-15T14:30:00"); // 月曜日 14:30
    const { hour, dayOfWeek } = getHourAndDayOfWeek(date);

    expect(hour).toBe(14);
    expect(dayOfWeek).toBe(1); // 月曜日
  });

  test("formatHour", () => {
    expect(formatHour(0)).toBe("00:00");
    expect(formatHour(9)).toBe("09:00");
    expect(formatHour(20)).toBe("20:00");
  });

  test("formatDayOfWeek", () => {
    expect(formatDayOfWeek(0)).toBe("日");
    expect(formatDayOfWeek(1)).toBe("月");
    expect(formatDayOfWeek(6)).toBe("土");
  });

  test("calculateOverallAverages", () => {
    const metrics: HourlyPerformanceMetrics[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: "adgroup1",
        hour: 10,
        dayOfWeek: 1,
        impressions: 1000,
        clicks: 100,
        conversions: 10,
        spend: 500,
        sales: 1000,
        ctr: 0.1,
        cvr: 0.1,
        acos: 0.5,
        roas: 2,
        cpc: 5,
        dataPoints: 7,
        periodStart: new Date(),
        periodEnd: new Date(),
      },
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: "adgroup1",
        hour: 20,
        dayOfWeek: 1,
        impressions: 2000,
        clicks: 200,
        conversions: 20,
        spend: 1000,
        sales: 2000,
        ctr: 0.1,
        cvr: 0.1,
        acos: 0.5,
        roas: 2,
        cpc: 5,
        dataPoints: 7,
        periodStart: new Date(),
        periodEnd: new Date(),
      },
    ];

    const result = calculateOverallAverages(metrics);

    expect(result.totalImpressions).toBe(3000);
    expect(result.totalClicks).toBe(300);
    expect(result.totalConversions).toBe(30);
    expect(result.meanCvr).toBe(0.1); // 30/300
    expect(result.meanRoas).toBe(2); // 3000/1500
  });

  test("aggregateMetricsByHour", () => {
    const metrics: HourlyPerformanceMetrics[] = [
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: "adgroup1",
        hour: 10,
        dayOfWeek: 1,
        impressions: 1000,
        clicks: 100,
        conversions: 10,
        spend: 500,
        sales: 1000,
        ctr: 0.1,
        cvr: 0.1,
        acos: 0.5,
        roas: 2,
        cpc: 5,
        dataPoints: 7,
        periodStart: new Date(),
        periodEnd: new Date(),
      },
      {
        asin: "B001",
        campaignId: "campaign1",
        adGroupId: "adgroup1",
        hour: 10, // 同じ時間帯
        dayOfWeek: 2,
        impressions: 500,
        clicks: 50,
        conversions: 5,
        spend: 250,
        sales: 500,
        ctr: 0.1,
        cvr: 0.1,
        acos: 0.5,
        roas: 2,
        cpc: 5,
        dataPoints: 7,
        periodStart: new Date(),
        periodEnd: new Date(),
      },
    ];

    const aggregated = aggregateMetricsByHour(metrics);
    const hour10 = aggregated.get(10);

    expect(hour10).toBeDefined();
    expect(hour10!.impressions).toBe(1500);
    expect(hour10!.clicks).toBe(150);
    expect(hour10!.conversions).toBe(15);
    expect(hour10!.cvr).toBe(0.1);
  });
});

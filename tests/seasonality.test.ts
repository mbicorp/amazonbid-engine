/**
 * 季節性予測機能 - ユニットテスト
 */

// uuid モジュールをモック（ESM問題回避）
jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-12345678"),
}));

// BigQueryをモック
jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: jest.fn().mockImplementation(() => ({
    dataset: jest.fn().mockReturnValue({
      table: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue([]),
      }),
    }),
    query: jest.fn().mockResolvedValue([[]]),
    createQueryJob: jest.fn().mockResolvedValue([{
      getQueryResults: jest.fn().mockResolvedValue([[]]),
      metadata: { statistics: { query: { numDmlAffectedRows: "0" } } },
    }]),
  })),
}));

import {
  // Config
  SUPPLEMENT_CATEGORY_HINTS,
  detectCategoryFromKeyword,
  getCategoryHint,
  getCategoryHintForKeyword,
  createSeasonalityConfigFromEnv,
  validateSeasonalityConfig,
  DEFAULT_SEASONALITY_CONFIG,

  // Peak Detection
  calculateMonthlyStats,
  calculateBaseline,
  detectPeaksFromStats,
  generatePeaksFromCategoryHint,
  mergePeaks,
  calculateDaysUntilNextPeak,
  isInPrePeakPeriod,
  calculateBidMultiplier,
  generateAdjustmentReason,

  // Predictor
  predictSeasonality,
  isPredictionValid,
  isPredictionConfident,
  shouldAdjustBid,
  formatPredictionForDebug,

  // Types
  SeasonalityConfig,
  PeakInfo,
  MonthlyVolumeStats,
  SeasonalityPrediction,
} from "../src/seasonality";
import { SearchVolumeEstimate, HistoricalSearchVolumeData } from "../src/jungle-scout/types";

// =============================================================================
// テストデータ
// =============================================================================

/**
 * モック検索ボリュームデータを生成
 */
function createMockSearchVolumeEstimates(
  monthlyVolumes: Record<number, number>,
  years: number = 2
): SearchVolumeEstimate[] {
  const estimates: SearchVolumeEstimate[] = [];
  const currentYear = new Date().getFullYear();

  for (let y = 0; y < years; y++) {
    const year = currentYear - y;
    for (let month = 1; month <= 12; month++) {
      const baseVolume = monthlyVolumes[month] || 1000;
      // 年ごとに若干のばらつきを追加
      const volume = baseVolume + Math.floor(Math.random() * 200) - 100;

      estimates.push({
        date: `${year}-${String(month).padStart(2, "0")}-15`,
        estimated_exact_search_volume: volume,
        estimated_broad_search_volume: volume * 1.5,
      });
    }
  }

  return estimates;
}

/**
 * ダイエット系の検索ボリュームパターン（1月と5月にピーク）
 */
const DIET_VOLUME_PATTERN: Record<number, number> = {
  1: 15000,  // ピーク（正月明け）
  2: 10000,
  3: 8000,
  4: 9000,
  5: 14000,  // ピーク（GW前）
  6: 8000,
  7: 7000,
  8: 6000,
  9: 7000,
  10: 7000,
  11: 8000,
  12: 9000,
};

/**
 * 花粉症系の検索ボリュームパターン（2-4月にピーク）
 */
const ALLERGY_VOLUME_PATTERN: Record<number, number> = {
  1: 5000,
  2: 18000,  // ピーク開始
  3: 25000,  // ピーク（最大）
  4: 15000,  // ピーク終了
  5: 6000,
  6: 4000,
  7: 3000,
  8: 3000,
  9: 3000,
  10: 4000,
  11: 4000,
  12: 4500,
};

// =============================================================================
// カテゴリ検出テスト
// =============================================================================

describe("Category Detection", () => {
  describe("detectCategoryFromKeyword", () => {
    it("should detect diet category", () => {
      expect(detectCategoryFromKeyword("ダイエット サプリ")).toBe("diet");
      expect(detectCategoryFromKeyword("脂肪燃焼")).toBe("diet");
      expect(detectCategoryFromKeyword("diet supplement")).toBe("diet");
    });

    it("should detect allergy category", () => {
      expect(detectCategoryFromKeyword("花粉症 サプリ")).toBe("allergy");
      expect(detectCategoryFromKeyword("じゃばら")).toBe("allergy");
    });

    it("should detect immune category", () => {
      expect(detectCategoryFromKeyword("免疫 サプリ")).toBe("immune");
      expect(detectCategoryFromKeyword("ビタミンC 1000mg")).toBe("immune");
    });

    it("should detect protein category", () => {
      expect(detectCategoryFromKeyword("プロテイン ホエイ")).toBe("protein");
      expect(detectCategoryFromKeyword("BCAA サプリ")).toBe("protein");
    });

    it("should detect gaba category", () => {
      expect(detectCategoryFromKeyword("GABA サプリ")).toBe("gaba");
      expect(detectCategoryFromKeyword("睡眠 サプリ")).toBe("gaba");
    });

    it("should return null for unknown keywords", () => {
      expect(detectCategoryFromKeyword("電池 充電器")).toBeNull();
      expect(detectCategoryFromKeyword("スマホケース")).toBeNull();
    });
  });

  describe("getCategoryHintForKeyword", () => {
    it("should return category hint for matching keyword", () => {
      const hint = getCategoryHintForKeyword("ダイエット サプリ");
      expect(hint).not.toBeNull();
      expect(hint?.category).toBe("diet");
      expect(hint?.expectedPeakMonths).toEqual([1, 5]);
    });

    it("should return null for non-matching keyword", () => {
      const hint = getCategoryHintForKeyword("電池 充電器");
      expect(hint).toBeNull();
    });
  });
});

// =============================================================================
// 月別統計テスト
// =============================================================================

describe("Monthly Stats Calculation", () => {
  describe("calculateMonthlyStats", () => {
    it("should calculate monthly averages correctly", () => {
      const estimates = createMockSearchVolumeEstimates(DIET_VOLUME_PATTERN, 2);
      const stats = calculateMonthlyStats(estimates);

      expect(stats).toHaveLength(12);
      expect(stats[0].month).toBe(1); // January
      expect(stats[0].sampleCount).toBe(2);
      // 1月は約15000のはず
      expect(stats[0].avgVolume).toBeGreaterThan(14000);
      expect(stats[0].avgVolume).toBeLessThan(16000);
    });

    it("should handle empty estimates", () => {
      const stats = calculateMonthlyStats([]);

      expect(stats).toHaveLength(12);
      stats.forEach((stat) => {
        expect(stat.avgVolume).toBe(0);
        expect(stat.sampleCount).toBe(0);
      });
    });
  });

  describe("calculateBaseline", () => {
    it("should calculate average across all months", () => {
      const stats: MonthlyVolumeStats[] = [
        { month: 1, avgVolume: 1000, stdDev: 100, sampleCount: 2 },
        { month: 2, avgVolume: 2000, stdDev: 200, sampleCount: 2 },
        { month: 3, avgVolume: 3000, stdDev: 300, sampleCount: 2 },
      ];

      const baseline = calculateBaseline(stats);
      expect(baseline).toBe(2000); // (1000 + 2000 + 3000) / 3
    });

    it("should ignore months with no samples", () => {
      const stats: MonthlyVolumeStats[] = [
        { month: 1, avgVolume: 1000, stdDev: 100, sampleCount: 2 },
        { month: 2, avgVolume: 0, stdDev: 0, sampleCount: 0 },
        { month: 3, avgVolume: 3000, stdDev: 300, sampleCount: 2 },
      ];

      const baseline = calculateBaseline(stats);
      expect(baseline).toBe(2000); // (1000 + 3000) / 2
    });
  });
});

// =============================================================================
// ピーク検出テスト
// =============================================================================

describe("Peak Detection", () => {
  describe("detectPeaksFromStats", () => {
    it("should detect peaks for diet pattern (January and May)", () => {
      const estimates = createMockSearchVolumeEstimates(DIET_VOLUME_PATTERN, 3);
      const stats = calculateMonthlyStats(estimates);
      const peaks = detectPeaksFromStats(stats, DEFAULT_SEASONALITY_CONFIG);

      // 1月と5月がピークとして検出されるはず
      const peakMonths = peaks.map((p) => p.month);
      expect(peakMonths).toContain(1);
      expect(peakMonths).toContain(5);
    });

    it("should detect peaks for allergy pattern (March)", () => {
      const estimates = createMockSearchVolumeEstimates(ALLERGY_VOLUME_PATTERN, 3);
      const stats = calculateMonthlyStats(estimates);
      const peaks = detectPeaksFromStats(stats, DEFAULT_SEASONALITY_CONFIG);

      // 3月が最大ピークとして検出されるはず
      const peakMonths = peaks.map((p) => p.month);
      expect(peakMonths).toContain(3);
    });

    it("should return empty array for flat pattern", () => {
      // ノイズなしの完全にフラットなデータを手動で作成
      const stats: MonthlyVolumeStats[] = [];
      for (let m = 1; m <= 12; m++) {
        stats.push({
          month: m,
          avgVolume: 5000, // 全月同じ
          stdDev: 0,
          sampleCount: 3,
        });
      }

      const peaks = detectPeaksFromStats(stats, DEFAULT_SEASONALITY_CONFIG);

      // フラットなパターンではピークなし
      expect(peaks.length).toBe(0);
    });
  });

  describe("generatePeaksFromCategoryHint", () => {
    it("should generate peaks from category hint", () => {
      const hint = SUPPLEMENT_CATEGORY_HINTS.diet;
      const peaks = generatePeaksFromCategoryHint(hint);

      expect(peaks).toHaveLength(2); // diet has [1, 5]
      expect(peaks[0].month).toBe(1);
      expect(peaks[1].month).toBe(5);
      expect(peaks[0].fromCategoryHint).toBe(true);
      expect(peaks[0].confidence).toBe(hint.confidence);
    });
  });

  describe("mergePeaks", () => {
    it("should merge JS peaks and category hints", () => {
      const jsPeaks: PeakInfo[] = [
        {
          month: 1,
          confidence: 0.7,
          predictedPeakDate: new Date(),
          fromCategoryHint: false,
          volumeMultiplier: 1.5,
        },
      ];

      const categoryPeaks: PeakInfo[] = [
        {
          month: 1,
          confidence: 0.85,
          predictedPeakDate: new Date(),
          fromCategoryHint: true,
          volumeMultiplier: 1.3,
        },
        {
          month: 5,
          confidence: 0.85,
          predictedPeakDate: new Date(),
          fromCategoryHint: true,
          volumeMultiplier: 1.3,
        },
      ];

      const merged = mergePeaks(jsPeaks, categoryPeaks, DEFAULT_SEASONALITY_CONFIG);

      // 1月は両方のソースで一致 → 信頼度が上がる
      const jan = merged.find((p) => p.month === 1);
      expect(jan).toBeDefined();
      expect(jan!.confidence).toBeGreaterThan(0.7);

      // 5月はカテゴリヒントのみ
      const may = merged.find((p) => p.month === 5);
      expect(may).toBeDefined();
      expect(may!.fromCategoryHint).toBe(true);
    });
  });
});

// =============================================================================
// Pre-peak期間テスト
// =============================================================================

describe("Pre-peak Period", () => {
  describe("calculateDaysUntilNextPeak", () => {
    it("should calculate days until next peak", () => {
      const now = new Date();
      const futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + 20);

      const peaks: PeakInfo[] = [
        {
          month: futureDate.getMonth() + 1,
          confidence: 0.8,
          predictedPeakDate: futureDate,
          fromCategoryHint: false,
          volumeMultiplier: 1.5,
        },
      ];

      const days = calculateDaysUntilNextPeak(peaks);
      expect(days).toBeGreaterThanOrEqual(19);
      expect(days).toBeLessThanOrEqual(21);
    });

    it("should return null for empty peaks", () => {
      const days = calculateDaysUntilNextPeak([]);
      expect(days).toBeNull();
    });
  });

  describe("isInPrePeakPeriod", () => {
    const config = DEFAULT_SEASONALITY_CONFIG;

    it("should return true for days within pre-peak range", () => {
      expect(isInPrePeakPeriod(7, config)).toBe(true);   // 下限
      expect(isInPrePeakPeriod(15, config)).toBe(true);  // 中間
      expect(isInPrePeakPeriod(30, config)).toBe(true);  // 上限
    });

    it("should return false for days outside pre-peak range", () => {
      expect(isInPrePeakPeriod(6, config)).toBe(false);   // 下限未満
      expect(isInPrePeakPeriod(31, config)).toBe(false);  // 上限超過
      expect(isInPrePeakPeriod(null, config)).toBe(false); // null
    });
  });

  describe("calculateBidMultiplier", () => {
    const config = DEFAULT_SEASONALITY_CONFIG;

    it("should return 1.0 for null daysUntilPeak", () => {
      const multiplier = calculateBidMultiplier(null, config);
      expect(multiplier).toBe(1.0);
    });

    it("should return 1.0 outside pre-peak period", () => {
      const multiplier = calculateBidMultiplier(35, config);
      expect(multiplier).toBe(1.0);
    });

    it("should increase multiplier as peak approaches", () => {
      const multiplierFar = calculateBidMultiplier(30, config);
      const multiplierMid = calculateBidMultiplier(15, config);
      const multiplierNear = calculateBidMultiplier(7, config);

      expect(multiplierFar).toBeGreaterThanOrEqual(1.0);
      expect(multiplierMid).toBeGreaterThan(multiplierFar);
      expect(multiplierNear).toBeGreaterThan(multiplierMid);
      expect(multiplierNear).toBeLessThanOrEqual(config.maxMultiplier);
    });
  });
});

// =============================================================================
// 予測生成テスト
// =============================================================================

describe("Prediction Generation", () => {
  describe("predictSeasonality", () => {
    it("should generate prediction with JS data", () => {
      const estimates = createMockSearchVolumeEstimates(DIET_VOLUME_PATTERN, 2);
      const jsData: HistoricalSearchVolumeData = {
        type: "historical_search_volume",
        id: "test",
        attributes: {
          keyword: "ダイエット サプリ",
          country: "jp",
          estimates,
        },
      };

      const prediction = predictSeasonality("ダイエット サプリ", jsData);

      expect(prediction.keyword).toBe("ダイエット サプリ");
      expect(prediction.dataSource).toBe("COMBINED"); // JSデータ + カテゴリヒント
      expect(prediction.predictedPeaks.length).toBeGreaterThan(0);
      expect(prediction.monthlyStats.length).toBe(12);
    });

    it("should generate prediction with category hint only", () => {
      const prediction = predictSeasonality("ダイエット サプリ", null);

      expect(prediction.dataSource).toBe("CATEGORY_HINT");
      expect(prediction.categoryHint).toBe("diet");
      expect(prediction.predictedPeaks.length).toBe(2); // 1月と5月
    });

    it("should generate empty prediction for unknown keyword", () => {
      const prediction = predictSeasonality("電池 充電器", null);

      expect(prediction.dataSource).toBe("CATEGORY_HINT");
      expect(prediction.predictedPeaks.length).toBe(0);
      expect(prediction.currentMultiplier).toBe(1.0);
    });
  });

  describe("isPredictionValid", () => {
    it("should return true for non-expired prediction", () => {
      const prediction: SeasonalityPrediction = {
        keyword: "test",
        predictedPeaks: [],
        daysUntilNextPeak: null,
        isPrePeakPeriod: false,
        currentMultiplier: 1.0,
        adjustmentReason: "",
        dataSource: "CATEGORY_HINT",
        confidenceScore: 0.5,
        monthlyStats: [],
        baselineVolume: 0,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000), // Tomorrow
      };

      expect(isPredictionValid(prediction)).toBe(true);
    });

    it("should return false for expired prediction", () => {
      const prediction: SeasonalityPrediction = {
        keyword: "test",
        predictedPeaks: [],
        daysUntilNextPeak: null,
        isPrePeakPeriod: false,
        currentMultiplier: 1.0,
        adjustmentReason: "",
        dataSource: "CATEGORY_HINT",
        confidenceScore: 0.5,
        monthlyStats: [],
        baselineVolume: 0,
        generatedAt: new Date(Date.now() - 86400000 * 10), // 10 days ago
        expiresAt: new Date(Date.now() - 86400000), // Yesterday
      };

      expect(isPredictionValid(prediction)).toBe(false);
    });
  });

  describe("shouldAdjustBid", () => {
    const config = DEFAULT_SEASONALITY_CONFIG;

    it("should return true when all conditions are met", () => {
      const prediction: SeasonalityPrediction = {
        keyword: "test",
        predictedPeaks: [],
        daysUntilNextPeak: 15,
        isPrePeakPeriod: true,
        currentMultiplier: 1.2,
        adjustmentReason: "",
        dataSource: "COMBINED",
        confidenceScore: 0.8,
        monthlyStats: [],
        baselineVolume: 1000,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };

      expect(shouldAdjustBid(prediction, config)).toBe(true);
    });

    it("should return false when not in pre-peak period", () => {
      const prediction: SeasonalityPrediction = {
        keyword: "test",
        predictedPeaks: [],
        daysUntilNextPeak: 50,
        isPrePeakPeriod: false,
        currentMultiplier: 1.0,
        adjustmentReason: "",
        dataSource: "COMBINED",
        confidenceScore: 0.8,
        monthlyStats: [],
        baselineVolume: 1000,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };

      expect(shouldAdjustBid(prediction, config)).toBe(false);
    });

    it("should return false when confidence is too low", () => {
      const prediction: SeasonalityPrediction = {
        keyword: "test",
        predictedPeaks: [],
        daysUntilNextPeak: 15,
        isPrePeakPeriod: true,
        currentMultiplier: 1.2,
        adjustmentReason: "",
        dataSource: "CATEGORY_HINT",
        confidenceScore: 0.3, // Below threshold
        monthlyStats: [],
        baselineVolume: 1000,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };

      expect(shouldAdjustBid(prediction, config)).toBe(false);
    });
  });
});

// =============================================================================
// 設定バリデーションテスト
// =============================================================================

describe("Config Validation", () => {
  describe("validateSeasonalityConfig", () => {
    it("should pass for valid config", () => {
      const errors = validateSeasonalityConfig(DEFAULT_SEASONALITY_CONFIG);
      expect(errors).toHaveLength(0);
    });

    it("should fail for invalid prePeakDaysMin", () => {
      const config: SeasonalityConfig = {
        ...DEFAULT_SEASONALITY_CONFIG,
        prePeakDaysMin: 0,
      };

      const errors = validateSeasonalityConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("prePeakDaysMin"))).toBe(true);
    });

    it("should fail for invalid maxMultiplier", () => {
      const config: SeasonalityConfig = {
        ...DEFAULT_SEASONALITY_CONFIG,
        maxMultiplier: 3.0, // Too high
      };

      const errors = validateSeasonalityConfig(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("maxMultiplier"))).toBe(true);
    });

    it("should fail for invalid confidenceThreshold", () => {
      const config: SeasonalityConfig = {
        ...DEFAULT_SEASONALITY_CONFIG,
        confidenceThreshold: 1.5, // Out of range
      };

      const errors = validateSeasonalityConfig(config);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// デバッグ出力テスト
// =============================================================================

describe("Debug Output", () => {
  describe("formatPredictionForDebug", () => {
    it("should format prediction for human readability", () => {
      const prediction = predictSeasonality("ダイエット サプリ", null);
      const formatted = formatPredictionForDebug(prediction);

      expect(formatted).toContain("Seasonality Prediction");
      expect(formatted).toContain("ダイエット サプリ");
      expect(formatted).toContain("Peaks");
      expect(formatted).toContain("Current Status");
    });
  });
});

// =============================================================================
// カテゴリヒント網羅性テスト
// =============================================================================

describe("Category Hints Coverage", () => {
  it("should have all expected supplement categories", () => {
    const expectedCategories = [
      "diet",
      "immune",
      "allergy",
      "uv",
      "nmn",
      "gaba",
      "vitamin_d",
      "protein",
      "gift",
    ];

    for (const category of expectedCategories) {
      expect(SUPPLEMENT_CATEGORY_HINTS[category]).toBeDefined();
      expect(SUPPLEMENT_CATEGORY_HINTS[category].expectedPeakMonths.length).toBeGreaterThan(0);
    }
  });

  it("should have valid confidence scores", () => {
    for (const category of Object.keys(SUPPLEMENT_CATEGORY_HINTS)) {
      const hint = SUPPLEMENT_CATEGORY_HINTS[category];
      expect(hint.confidence).toBeGreaterThanOrEqual(0);
      expect(hint.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("should have valid peak months (1-12)", () => {
    for (const category of Object.keys(SUPPLEMENT_CATEGORY_HINTS)) {
      const hint = SUPPLEMENT_CATEGORY_HINTS[category];
      for (const month of hint.expectedPeakMonths) {
        expect(month).toBeGreaterThanOrEqual(1);
        expect(month).toBeLessThanOrEqual(12);
      }
    }
  });
});

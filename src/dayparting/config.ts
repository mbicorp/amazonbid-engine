/**
 * Dayparting (時間帯別入札最適化) - 設定
 */

import {
  DaypartingConfig,
  DaypartingMode,
  HourOfDay,
  ConfidenceLevel,
  HourClassification,
  DAYPARTING_CONSTANTS,
} from "./types";

// =============================================================================
// デフォルト設定
// =============================================================================

/**
 * グローバルデフォルト設定
 */
export const GLOBAL_DAYPARTING_DEFAULTS = {
  /** デフォルト動作モード */
  mode: "SHADOW" as DaypartingMode,
  /** デフォルトで無効 */
  enabled: false,
  /** 最大乗数 */
  maxMultiplier: 1.3,
  /** 最小乗数 */
  minMultiplier: 0.7,
  /** 有意水準 */
  significanceLevel: 0.05,
  /** 最小サンプルサイズ */
  minSampleSize: 30,
  /** 分析対象期間（日数） */
  analysisWindowDays: 14,
  /** 日次最大損失許容額 */
  maxDailyLoss: 5000,
  /** ロールバック閾値 */
  rollbackThreshold: 0.15,
} as const;

/**
 * 信頼度別のサンプルサイズ閾値
 */
export const CONFIDENCE_SAMPLE_THRESHOLDS: Record<ConfidenceLevel, number> = {
  HIGH: DAYPARTING_CONSTANTS.HIGH_CONFIDENCE_MIN_SAMPLES,
  MEDIUM: DAYPARTING_CONSTANTS.MEDIUM_CONFIDENCE_MIN_SAMPLES,
  LOW: DAYPARTING_CONSTANTS.LOW_CONFIDENCE_MIN_SAMPLES,
  INSUFFICIENT: 0,
};

/**
 * 信頼度別の最大乗数調整係数
 * 信頼度が低いほど乗数の変動を抑える
 */
export const CONFIDENCE_MULTIPLIER_FACTORS: Record<ConfidenceLevel, number> = {
  HIGH: 1.0,      // 100% - フル適用
  MEDIUM: 0.7,    // 70% - やや抑制
  LOW: 0.4,       // 40% - 大幅抑制
  INSUFFICIENT: 0, // 0% - 適用しない
};

/**
 * 分類別の基本乗数
 */
export const CLASSIFICATION_BASE_MULTIPLIERS: Record<HourClassification, number> = {
  PEAK: 1.2,      // +20%
  GOOD: 1.1,      // +10%
  AVERAGE: 1.0,   // 変更なし
  POOR: 0.85,     // -15%
  DEAD: 0.7,      // -30%
};

/**
 * 分類判定の相対パフォーマンス閾値
 */
export const CLASSIFICATION_THRESHOLDS: Record<HourClassification, { min: number; max: number }> = {
  PEAK: { min: DAYPARTING_CONSTANTS.PEAK_RELATIVE_THRESHOLD, max: Infinity },
  GOOD: { min: DAYPARTING_CONSTANTS.GOOD_RELATIVE_THRESHOLD, max: DAYPARTING_CONSTANTS.PEAK_RELATIVE_THRESHOLD },
  AVERAGE: { min: DAYPARTING_CONSTANTS.POOR_RELATIVE_THRESHOLD, max: DAYPARTING_CONSTANTS.GOOD_RELATIVE_THRESHOLD },
  POOR: { min: DAYPARTING_CONSTANTS.DEAD_RELATIVE_THRESHOLD, max: DAYPARTING_CONSTANTS.POOR_RELATIVE_THRESHOLD },
  DEAD: { min: 0, max: DAYPARTING_CONSTANTS.DEAD_RELATIVE_THRESHOLD },
};

/**
 * 有意水準に対応するp値閾値
 */
export const SIGNIFICANCE_P_VALUES = {
  /** 99%信頼区間 */
  VERY_HIGH: 0.01,
  /** 95%信頼区間 */
  HIGH: 0.05,
  /** 90%信頼区間 */
  MEDIUM: 0.10,
  /** 80%信頼区間 */
  LOW: 0.20,
} as const;

// =============================================================================
// 時間帯パターン
// =============================================================================

/**
 * 一般的なECサイトの時間帯パターン（参考値）
 * 実際のデータに基づいて学習するが、初期値として使用
 */
export const TYPICAL_EC_HOUR_PATTERNS: Record<HourOfDay, HourClassification> = {
  0: "DEAD",     // 深夜
  1: "DEAD",
  2: "DEAD",
  3: "DEAD",
  4: "DEAD",
  5: "POOR",
  6: "POOR",     // 早朝
  7: "AVERAGE",
  8: "AVERAGE",
  9: "GOOD",     // 朝の通勤時間
  10: "AVERAGE",
  11: "AVERAGE",
  12: "GOOD",    // 昼休み
  13: "AVERAGE",
  14: "AVERAGE",
  15: "AVERAGE",
  16: "AVERAGE",
  17: "AVERAGE",
  18: "GOOD",    // 帰宅時間
  19: "GOOD",
  20: "PEAK",    // ゴールデンタイム
  21: "PEAK",
  22: "GOOD",
  23: "AVERAGE",
};

/**
 * 曜日別の補正係数（参考値）
 * 0=日曜, 6=土曜
 */
export const TYPICAL_DAY_OF_WEEK_FACTORS: Record<number, number> = {
  0: 1.1,  // 日曜: 少し高め
  1: 0.95, // 月曜: やや低め
  2: 0.95, // 火曜
  3: 1.0,  // 水曜
  4: 1.0,  // 木曜
  5: 1.05, // 金曜: 週末前で少し高め
  6: 1.1,  // 土曜: 高め
};

// =============================================================================
// BigQueryテーブル設定
// =============================================================================

/**
 * BigQueryテーブルID
 */
export const DAYPARTING_BIGQUERY_TABLES = {
  /** 時間帯別メトリクス */
  HOURLY_METRICS: "dayparting_hourly_metrics",
  /** 入札乗数設定 */
  MULTIPLIERS: "dayparting_multipliers",
  /** 設定テーブル */
  CONFIGS: "dayparting_configs",
  /** フィードバック */
  FEEDBACK: "dayparting_feedback",
  /** 日次サマリー */
  DAILY_SUMMARY: "dayparting_daily_summary",
  /** ロールバック履歴 */
  ROLLBACKS: "dayparting_rollbacks",
} as const;

// =============================================================================
// 環境変数キー
// =============================================================================

/**
 * 環境変数キー
 */
export const DAYPARTING_ENV_KEYS = {
  /** 動作モード */
  MODE: "DAYPARTING_MODE",
  /** 有効/無効 */
  ENABLED: "DAYPARTING_ENABLED",
  /** 最大乗数 */
  MAX_MULTIPLIER: "DAYPARTING_MAX_MULTIPLIER",
  /** 最小乗数 */
  MIN_MULTIPLIER: "DAYPARTING_MIN_MULTIPLIER",
  /** 有意水準 */
  SIGNIFICANCE_LEVEL: "DAYPARTING_SIGNIFICANCE_LEVEL",
  /** 最小サンプルサイズ */
  MIN_SAMPLE_SIZE: "DAYPARTING_MIN_SAMPLE_SIZE",
  /** 分析対象期間 */
  ANALYSIS_WINDOW_DAYS: "DAYPARTING_ANALYSIS_WINDOW_DAYS",
  /** 日次最大損失 */
  MAX_DAILY_LOSS: "DAYPARTING_MAX_DAILY_LOSS",
  /** ロールバック閾値 */
  ROLLBACK_THRESHOLD: "DAYPARTING_ROLLBACK_THRESHOLD",
} as const;

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 環境変数からDayparting設定を読み込む
 */
export function loadDaypartingConfigFromEnv(): Partial<DaypartingConfig> {
  const config: Partial<DaypartingConfig> = {};

  // モード
  const modeEnv = process.env[DAYPARTING_ENV_KEYS.MODE];
  if (modeEnv && ["OFF", "SHADOW", "APPLY"].includes(modeEnv)) {
    config.mode = modeEnv as DaypartingMode;
  }

  // 有効/無効
  const enabledEnv = process.env[DAYPARTING_ENV_KEYS.ENABLED];
  if (enabledEnv !== undefined) {
    config.enabled = enabledEnv.toLowerCase() === "true";
  }

  // 数値パラメータ
  const maxMultiplier = parseFloat(process.env[DAYPARTING_ENV_KEYS.MAX_MULTIPLIER] || "");
  if (!isNaN(maxMultiplier)) {
    config.maxMultiplier = maxMultiplier;
  }

  const minMultiplier = parseFloat(process.env[DAYPARTING_ENV_KEYS.MIN_MULTIPLIER] || "");
  if (!isNaN(minMultiplier)) {
    config.minMultiplier = minMultiplier;
  }

  const significanceLevel = parseFloat(process.env[DAYPARTING_ENV_KEYS.SIGNIFICANCE_LEVEL] || "");
  if (!isNaN(significanceLevel)) {
    config.significanceLevel = significanceLevel;
  }

  const minSampleSize = parseInt(process.env[DAYPARTING_ENV_KEYS.MIN_SAMPLE_SIZE] || "", 10);
  if (!isNaN(minSampleSize)) {
    config.minSampleSize = minSampleSize;
  }

  const analysisWindowDays = parseInt(process.env[DAYPARTING_ENV_KEYS.ANALYSIS_WINDOW_DAYS] || "", 10);
  if (!isNaN(analysisWindowDays)) {
    config.analysisWindowDays = analysisWindowDays;
  }

  const maxDailyLoss = parseFloat(process.env[DAYPARTING_ENV_KEYS.MAX_DAILY_LOSS] || "");
  if (!isNaN(maxDailyLoss)) {
    config.maxDailyLoss = maxDailyLoss;
  }

  const rollbackThreshold = parseFloat(process.env[DAYPARTING_ENV_KEYS.ROLLBACK_THRESHOLD] || "");
  if (!isNaN(rollbackThreshold)) {
    config.rollbackThreshold = rollbackThreshold;
  }

  return config;
}

/**
 * デフォルト設定と環境変数設定をマージ
 */
export function createDaypartingConfig(
  asin: string,
  campaignId: string,
  adGroupId: string | null = null,
  overrides: Partial<DaypartingConfig> = {}
): DaypartingConfig {
  const envConfig = loadDaypartingConfigFromEnv();
  const now = new Date();

  return {
    asin,
    campaignId,
    adGroupId,
    mode: overrides.mode ?? envConfig.mode ?? GLOBAL_DAYPARTING_DEFAULTS.mode,
    enabled: overrides.enabled ?? envConfig.enabled ?? GLOBAL_DAYPARTING_DEFAULTS.enabled,
    maxMultiplier: overrides.maxMultiplier ?? envConfig.maxMultiplier ?? GLOBAL_DAYPARTING_DEFAULTS.maxMultiplier,
    minMultiplier: overrides.minMultiplier ?? envConfig.minMultiplier ?? GLOBAL_DAYPARTING_DEFAULTS.minMultiplier,
    significanceLevel: overrides.significanceLevel ?? envConfig.significanceLevel ?? GLOBAL_DAYPARTING_DEFAULTS.significanceLevel,
    minSampleSize: overrides.minSampleSize ?? envConfig.minSampleSize ?? GLOBAL_DAYPARTING_DEFAULTS.minSampleSize,
    analysisWindowDays: overrides.analysisWindowDays ?? envConfig.analysisWindowDays ?? GLOBAL_DAYPARTING_DEFAULTS.analysisWindowDays,
    maxDailyLoss: overrides.maxDailyLoss ?? envConfig.maxDailyLoss ?? GLOBAL_DAYPARTING_DEFAULTS.maxDailyLoss,
    rollbackThreshold: overrides.rollbackThreshold ?? envConfig.rollbackThreshold ?? GLOBAL_DAYPARTING_DEFAULTS.rollbackThreshold,
    createdAt: overrides.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * 設定のバリデーション
 */
export function validateDaypartingConfig(config: DaypartingConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 必須フィールド
  if (!config.asin) {
    errors.push("asin is required");
  }
  if (!config.campaignId) {
    errors.push("campaignId is required");
  }

  // モード
  if (!["OFF", "SHADOW", "APPLY"].includes(config.mode)) {
    errors.push(`Invalid mode: ${config.mode}`);
  }

  // 乗数範囲
  if (config.maxMultiplier < 1.0) {
    errors.push(`maxMultiplier must be >= 1.0, got ${config.maxMultiplier}`);
  }
  if (config.maxMultiplier > 2.0) {
    errors.push(`maxMultiplier must be <= 2.0, got ${config.maxMultiplier}`);
  }
  if (config.minMultiplier > 1.0) {
    errors.push(`minMultiplier must be <= 1.0, got ${config.minMultiplier}`);
  }
  if (config.minMultiplier < 0.1) {
    errors.push(`minMultiplier must be >= 0.1, got ${config.minMultiplier}`);
  }
  if (config.minMultiplier >= config.maxMultiplier) {
    errors.push(`minMultiplier (${config.minMultiplier}) must be < maxMultiplier (${config.maxMultiplier})`);
  }

  // 有意水準
  if (config.significanceLevel <= 0 || config.significanceLevel >= 1) {
    errors.push(`significanceLevel must be between 0 and 1, got ${config.significanceLevel}`);
  }

  // サンプルサイズ
  if (config.minSampleSize < 1) {
    errors.push(`minSampleSize must be >= 1, got ${config.minSampleSize}`);
  }

  // 分析期間
  if (config.analysisWindowDays < 1 || config.analysisWindowDays > 90) {
    errors.push(`analysisWindowDays must be between 1 and 90, got ${config.analysisWindowDays}`);
  }

  // 損失許容額
  if (config.maxDailyLoss < 0) {
    errors.push(`maxDailyLoss must be >= 0, got ${config.maxDailyLoss}`);
  }

  // ロールバック閾値
  if (config.rollbackThreshold <= 0 || config.rollbackThreshold >= 1) {
    errors.push(`rollbackThreshold must be between 0 and 1, got ${config.rollbackThreshold}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 信頼度を判定
 */
export function determineConfidenceLevel(sampleSize: number, pValue: number): ConfidenceLevel {
  // サンプルサイズが不足している場合
  if (sampleSize < CONFIDENCE_SAMPLE_THRESHOLDS.LOW) {
    return "INSUFFICIENT";
  }

  // p値が有意でない場合
  if (pValue > SIGNIFICANCE_P_VALUES.LOW) {
    return "INSUFFICIENT";
  }

  // サンプルサイズとp値の両方を考慮
  if (sampleSize >= CONFIDENCE_SAMPLE_THRESHOLDS.HIGH && pValue <= SIGNIFICANCE_P_VALUES.VERY_HIGH) {
    return "HIGH";
  }

  if (sampleSize >= CONFIDENCE_SAMPLE_THRESHOLDS.MEDIUM && pValue <= SIGNIFICANCE_P_VALUES.HIGH) {
    return "MEDIUM";
  }

  if (sampleSize >= CONFIDENCE_SAMPLE_THRESHOLDS.LOW && pValue <= SIGNIFICANCE_P_VALUES.MEDIUM) {
    return "LOW";
  }

  return "INSUFFICIENT";
}

/**
 * 相対パフォーマンスから分類を判定
 */
export function determineClassification(relativePerformance: number): HourClassification {
  if (relativePerformance >= CLASSIFICATION_THRESHOLDS.PEAK.min) {
    return "PEAK";
  }
  if (relativePerformance >= CLASSIFICATION_THRESHOLDS.GOOD.min) {
    return "GOOD";
  }
  if (relativePerformance >= CLASSIFICATION_THRESHOLDS.AVERAGE.min) {
    return "AVERAGE";
  }
  if (relativePerformance >= CLASSIFICATION_THRESHOLDS.POOR.min) {
    return "POOR";
  }
  return "DEAD";
}

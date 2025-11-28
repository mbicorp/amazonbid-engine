/**
 * 自適応型Eスコア最適化システム - 設定
 */

import {
  AdaptiveEScoreConfig,
  EScoreWeights,
  LearnedWeights,
  AdaptiveWeightConfig,
} from "./types";

// =============================================================================
// デフォルト設定
// =============================================================================

/**
 * デフォルトの重み設定
 */
export const DEFAULT_WEIGHTS: { NORMAL: EScoreWeights; S_MODE: EScoreWeights } = {
  NORMAL: {
    performance: 0.40, // 成果 40%
    efficiency: 0.40,  // 効率 40%
    potential: 0.20,   // ポテンシャル 20%
  },
  S_MODE: {
    performance: 0.55, // 成果 55% - セール時は売上重視
    efficiency: 0.25,  // 効率 25%
    potential: 0.20,   // ポテンシャル 20%
  },
};

/**
 * ブランドタイプ別のデフォルト重み
 */
export const DEFAULT_BRAND_WEIGHTS: Record<string, EScoreWeights> = {
  BRAND: {
    performance: 0.50, // 自社ブランドは成果重視
    efficiency: 0.30,
    potential: 0.20,
  },
  CONQUEST: {
    performance: 0.35, // 競合ブランドは効率重視
    efficiency: 0.45,
    potential: 0.20,
  },
  GENERIC: {
    performance: 0.40,
    efficiency: 0.40,
    potential: 0.20,
  },
};

/**
 * 季節別のデフォルト重み
 */
export const DEFAULT_SEASON_WEIGHTS: Record<string, EScoreWeights> = {
  Q1: { performance: 0.40, efficiency: 0.40, potential: 0.20 },
  Q2: { performance: 0.40, efficiency: 0.40, potential: 0.20 },
  Q3: { performance: 0.45, efficiency: 0.35, potential: 0.20 }, // 夏セール
  Q4: { performance: 0.50, efficiency: 0.30, potential: 0.20 }, // 年末商戦
};

/**
 * 自適応Eスコアシステムのデフォルト設定
 */
export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveEScoreConfig = {
  // 学習パラメータ
  learningRate: 0.03,           // 学習率 3%
  minDataForLearning: 100,      // 最小学習データ数
  learningWindowDays: 7,        // 過去7日間のデータを使用

  // 重みの制約
  constraints: {
    bounds: {
      performance: { min: 0.25, max: 0.65 },  // 成果は25%〜65%
      efficiency: { min: 0.20, max: 0.55 },   // 効率は20%〜55%
      potential: { min: 0.10, max: 0.35 },    // ポテンシャルは10%〜35%
    },
    maxDeltaPerUpdate: 0.05,  // 1回の更新で最大5%変動
  },

  // ロールバック閾値
  rollbackThresholds: {
    successRateDrop: 0.20,        // 成功率20%低下でロールバック
    acosDegradation: 0.30,        // ACOS30%悪化でロールバック
    monitoringPeriodHours: 24,    // 24時間監視
  },

  // デフォルト重み（フォールバック用）
  defaultWeights: DEFAULT_WEIGHTS,

  // Eスコアランク閾値
  rankThresholds: {
    S: 80,  // 80以上 = Sランク
    A: 60,  // 60以上 = Aランク
    B: 40,  // 40以上 = Bランク
    C: 20,  // 20以上 = Cランク
    // 20未満 = Dランク
  },
};

// =============================================================================
// 初期化ヘルパー
// =============================================================================

/**
 * LearnedWeightsの初期値を生成
 */
export function createInitialLearnedWeights(weights: EScoreWeights): LearnedWeights {
  return {
    weights: { ...weights },
    initialWeights: { ...weights },
    dataCount: 0,
    lastUpdated: new Date(),
    accuracy: 0,
    version: 1,
  };
}

/**
 * AdaptiveWeightConfigの初期値を生成
 */
export function createInitialAdaptiveConfig(): AdaptiveWeightConfig {
  return {
    byMode: {
      NORMAL: createInitialLearnedWeights(DEFAULT_WEIGHTS.NORMAL),
      S_MODE: createInitialLearnedWeights(DEFAULT_WEIGHTS.S_MODE),
    },
    byBrandType: {
      BRAND: createInitialLearnedWeights(DEFAULT_BRAND_WEIGHTS.BRAND),
      CONQUEST: createInitialLearnedWeights(DEFAULT_BRAND_WEIGHTS.CONQUEST),
      GENERIC: createInitialLearnedWeights(DEFAULT_BRAND_WEIGHTS.GENERIC),
    },
    bySeason: {
      Q1: createInitialLearnedWeights(DEFAULT_SEASON_WEIGHTS.Q1),
      Q2: createInitialLearnedWeights(DEFAULT_SEASON_WEIGHTS.Q2),
      Q3: createInitialLearnedWeights(DEFAULT_SEASON_WEIGHTS.Q3),
      Q4: createInitialLearnedWeights(DEFAULT_SEASON_WEIGHTS.Q4),
    },
  };
}

// =============================================================================
// アクション別の期待値設定
// =============================================================================

/**
 * アクション別の成功判定基準
 */
export const ACTION_SUCCESS_CRITERIA = {
  STRONG_UP: {
    // 期待: 売上大幅増、CVR維持、ACOS微増許容
    excellent: { salesChange: 0.15, cvrChange: -0.05 },
    good: { salesChange: 0.05, cvrChange: -0.10 },
    acceptable: { salesChange: 0, acosChange: 0.20 },
  },
  MILD_UP: {
    // 期待: 売上増、効率維持
    excellent: { salesChange: 0.08, acosChange: 0.05 },
    good: { salesChange: 0.03, acosChange: 0.10 },
    acceptable: { salesChange: 0, acosChange: 0.15 },
  },
  KEEP: {
    // 期待: 現状維持
    excellent: { salesChange: -0.02, acosChange: 0.05 },
    good: { salesChange: -0.05, acosChange: 0.10 },
    acceptable: { salesChange: -0.10, acosChange: 0.15 },
  },
  MILD_DOWN: {
    // 期待: ACOS改善
    excellent: { acosChange: -0.10 },
    good: { acosChange: -0.05 },
    acceptable: { acosChange: 0.05 },
  },
  STRONG_DOWN: {
    // 期待: ACOS大幅改善、損失削減
    excellent: { acosChange: -0.15 },
    good: { acosChange: -0.05 },
    acceptable: { acosChange: 0.05 },
  },
  STOP: {
    // 期待: 損失停止
    excellent: { acosChange: -0.20 },
    good: { acosChange: -0.10 },
    acceptable: { acosChange: 0 },
  },
} as const;

/**
 * 成功レベル別のスコア
 */
export const SUCCESS_LEVEL_SCORES = {
  EXCELLENT: 1.0,
  GOOD: 0.7,
  ACCEPTABLE: 0.4,
  POOR: 0.0,
} as const;

// =============================================================================
// BigQuery テーブル設定
// =============================================================================

/**
 * BigQueryテーブルID
 */
export const ADAPTIVE_BIGQUERY_TABLES = {
  /** フィードバックテーブル */
  FEEDBACK: "escore_feedback",
  /** 重み履歴テーブル */
  WEIGHT_HISTORY: "escore_weight_history",
  /** 最適化ログテーブル */
  OPTIMIZATION_LOG: "escore_optimization_log",
} as const;

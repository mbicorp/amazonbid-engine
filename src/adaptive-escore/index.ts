/**
 * 自適応型Eスコア最適化システム
 *
 * 過去の結果に基づいてEスコアの重みを自動最適化するシステム
 *
 * 主要機能:
 * - Eスコア計算（成果・効率・ポテンシャルの重み付け）
 * - フィードバックループによる重み自動最適化
 * - 異常検知とロールバック機能
 * - モード別・ブランドタイプ別・季節別の重み管理
 */

// 型定義
export * from "./types";

// 設定
export {
  DEFAULT_WEIGHTS,
  DEFAULT_BRAND_WEIGHTS,
  DEFAULT_SEASON_WEIGHTS,
  DEFAULT_ADAPTIVE_CONFIG,
  createInitialLearnedWeights,
  createInitialAdaptiveConfig,
  ACTION_SUCCESS_CRITERIA,
  SUCCESS_LEVEL_SCORES,
  ADAPTIVE_BIGQUERY_TABLES,
} from "./config";

// Eスコア計算
export {
  calculatePerformanceScore,
  calculateEfficiencyScore,
  calculatePotentialScore,
  calculateEScore,
  calculateFullEScore,
  selectAdaptiveWeights,
  determineRank,
  getCurrentSeason,
} from "./escore-calculator";
export type { KeywordMetricsForEScore } from "./escore-calculator";

// 成功評価
export {
  evaluateSuccess,
  evaluateFeedbackRecord,
  calculateSuccessRate,
  calculateSuccessRateByAction,
  calculateSuccessRateByRank,
  calculatePredictionAccuracy,
  calculateMetricsChange,
} from "./success-evaluator";

// 重み最適化
export {
  normalizeWeights,
  clipWeights,
  limitDelta,
  optimizeWeightsGradientDescent,
  optimizeWeightsMultiIteration,
  updateLearnedWeights,
  analyzeWeightChange,
} from "./weight-optimizer";

// 安全機構
export {
  detectSuccessRateDrop,
  detectAcosDegradation,
  detectAnomalies,
  createWeightHistory,
  rollbackWeights,
  resetToDefaultWeights,
  applySafetyChecks,
  validateWeights,
  performHealthCheck,
} from "./safety-manager";
export type { AnomalyDetectionResult, SafeOptimizationResult, HealthCheckResult } from "./safety-manager";

// BigQueryアダプター
export {
  insertFeedbackRecord,
  insertFeedbackRecords,
  getUnevaluatedFeedbackRecords,
  getFeedbackRecordsForLearning,
  updateFeedbackRecordEvaluation,
  saveWeightHistory,
  getLatestWeightHistory,
  markWeightHistoryAsRolledBack,
  saveOptimizationLog,
  getSuccessStatsByMode,
  getSuccessStatsByAction,
} from "./bigquery-adapter";

// 最適化ランナー
export {
  AdaptiveEScoreOptimizer,
  getOptimizer,
  resetOptimizer,
  runScheduledOptimization,
  generateOptimizationReport,
} from "./optimization-runner";

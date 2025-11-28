/**
 * Dayparting (時間帯別入札最適化) モジュール
 *
 * 時間帯別のパフォーマンス分析に基づき、
 * 統計的に有意な時間帯にのみ入札乗数を適用する機能を提供
 */

// 型定義
export {
  // 基本型
  HourOfDay,
  DayOfWeek,
  DaypartingMode,
  VALID_DAYPARTING_MODES,
  isValidDaypartingMode,
  ConfidenceLevel,
  VALID_CONFIDENCE_LEVELS,
  HourClassification,
  VALID_HOUR_CLASSIFICATIONS,
  // メトリクス
  HourlyPerformanceMetrics,
  HourlyAnalysisResult,
  HourlyBidMultiplier,
  // 設定
  DaypartingConfig,
  DEFAULT_DAYPARTING_CONFIG,
  // フィードバック
  DaypartingFeedbackRecord,
  DaypartingDailySummary,
  // 安全機構
  SafetyCheckResult,
  RollbackInfo,
  // BigQueryレコード
  HourlyMetricsRecord,
  DaypartingMultiplierRecord,
  DaypartingConfigRecord,
  DaypartingFeedbackRecordBQ,
  DaypartingRollbackRecord,
  // エラーコード
  DaypartingErrorCode,
  DaypartingErrorCodeType,
  // 定数
  DAYPARTING_CONSTANTS,
} from "./types";

// 設定
export {
  GLOBAL_DAYPARTING_DEFAULTS,
  CONFIDENCE_SAMPLE_THRESHOLDS,
  CONFIDENCE_MULTIPLIER_FACTORS,
  CLASSIFICATION_BASE_MULTIPLIERS,
  CLASSIFICATION_THRESHOLDS,
  SIGNIFICANCE_P_VALUES,
  TYPICAL_EC_HOUR_PATTERNS,
  TYPICAL_DAY_OF_WEEK_FACTORS,
  DAYPARTING_BIGQUERY_TABLES,
  DAYPARTING_ENV_KEYS,
  loadDaypartingConfigFromEnv,
  createDaypartingConfig,
  validateDaypartingConfig,
  determineConfidenceLevel,
  determineClassification,
} from "./config";

// メトリクス収集
export {
  BigQueryConfig,
  CollectMetricsOptions,
  CollectMetricsResult,
  collectHourlyMetrics,
  getHourlyMetricsForCampaign,
  calculateOverallAverages,
  aggregateMetricsByHour,
  aggregateMetricsByHourAndDay,
  saveHourlyMetrics,
  getHourAndDayOfWeek,
  getCurrentHourAndDayJST,
  formatHour,
  formatDayOfWeek,
  formatDayOfWeekEn,
} from "./hourly-metrics-collector";

// 統計分析
export {
  normalCdf,
  tCdf,
  standardError,
  oneSampleTTest,
  calculateMeanAndStd,
  analyzeHourlyPerformance,
  analyzeHourlyPerformanceByDay,
  calculateRecommendedMultiplier,
  filterSignificantHours,
  generateAnalysisSummary,
  logAnalysisResults,
} from "./hourly-analyzer";

// 乗数計算
export {
  MultiplierCalculationOptions,
  MultiplierCalculationResult,
  calculateMultipliers,
  getMultiplierForCurrentTime,
  applyMultiplierToBid,
  calculateMultiplierDiff,
  generateDefaultMultipliers,
  generateMultiplierId,
  mergeMultipliers,
  deactivateMultipliers,
  logMultiplierCalculation,
} from "./multiplier-calculator";

// 安全機構
export {
  SafetyCheckConfig,
  DEFAULT_SAFETY_CHECK_CONFIG,
  AnomalyDetectionResult,
  DaypartingHealthCheckResult,
  performSafetyCheck,
  performBatchSafetyCheck,
  detectLossExceeded,
  detectPerformanceDrop,
  detectConsecutiveBadDays,
  detectAnomalies,
  createRollbackInfo,
  executeRollback,
  restoreFromRollback,
  applyGradualChange,
  applyGradualChanges,
  performHealthCheck,
  logSafetyCheckResult,
  logRollback,
} from "./safety-manager";

// フィードバック評価
export {
  CreateFeedbackOptions,
  EvaluateFeedbackOptions,
  SuccessCriteria,
  DEFAULT_SUCCESS_CRITERIA,
  createFeedbackRecord,
  createFeedbackFromMultiplier,
  evaluateFeedback,
  calculateHourlySuccessRates,
  calculateMultiplierRangeSuccessRates,
  createDailySummary,
  calculateDailySummaryEffect,
  logFeedbackEvaluation,
  logDailySummary,
} from "./feedback-evaluator";

// BigQueryアダプター
export {
  configToRecord,
  recordToConfig,
  multiplierToRecord,
  recordToMultiplier,
  feedbackToRecord,
  recordToFeedback,
  saveConfig,
  fetchConfig,
  fetchEnabledConfigs,
  saveMultipliers,
  fetchActiveMultipliers,
  deactivateMultipliers as deactivateMultipliersInBQ,
  saveFeedback,
  updateFeedbackEvaluation,
  fetchUnevaluatedFeedback,
  fetchRecentFeedback,
  saveRollback,
  fetchLatestRollback,
  createDaypartingTables,
} from "./bigquery-adapter";

// メインエンジン
export {
  DaypartingEngineConfig,
  AnalysisRunResult,
  ApplyMultiplierResult,
  BatchRunResult,
  DaypartingEngine,
  getDaypartingEngine,
  resetDaypartingEngine,
} from "./dayparting-engine";

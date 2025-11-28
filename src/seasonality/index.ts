/**
 * 季節性予測による先行入札調整モジュール
 *
 * Jungle Scoutの検索ボリューム履歴データを活用し、
 * 季節的なピークを予測してピーク到来前に入札を調整する機能
 *
 * 使用例:
 * ```typescript
 * import {
 *   runSeasonalityUpdateJob,
 *   applySeasonalityAdjustment,
 *   createSeasonalityUpdateHandler,
 *   SeasonalityConfig,
 *   DEFAULT_SEASONALITY_CONFIG,
 * } from "./seasonality";
 *
 * // バッチジョブとして実行
 * const result = await runSeasonalityUpdateJob({
 *   projectId: "my-project",
 *   dataset: "amazon_bid_engine",
 * });
 *
 * // 入札調整を適用
 * const adjustment = await applySeasonalityAdjustment({
 *   keyword: "ダイエット サプリ",
 *   originalBid: 100,
 *   maxBid: 150,
 * });
 *
 * // Express ルートとして使用
 * router.post("/cron/seasonality-update", createSeasonalityUpdateHandler());
 * ```
 */

// =============================================================================
// Types
// =============================================================================
export {
  // Core Types
  SeasonalityMode,
  SeasonalityDataSource,
  PeakInfo,
  MonthlyVolumeStats,
  SeasonalityPrediction,
  SeasonalityAdjustment,
  CategoryHint,

  // Config Types
  SeasonalityConfig,
  DEFAULT_SEASONALITY_CONFIG,

  // BigQuery Row Types
  SeasonalityPredictionRow,

  // Job Types
  SeasonalityJobResult,
  SeasonalityJobStats,
  RunSeasonalityJobOptions,
  ActiveAdjustmentsFilter,
} from "./types";

// =============================================================================
// Config
// =============================================================================
export {
  // Category Hints
  SUPPLEMENT_CATEGORY_HINTS,

  // Category Detection
  detectCategoryFromKeyword,
  getCategoryHint,
  getCategoryHintForKeyword,

  // Config Utilities
  createSeasonalityConfigFromEnv,
  mergeSeasonalityConfig,
  validateSeasonalityConfig,
} from "./config";

// =============================================================================
// Peak Detection
// =============================================================================
export {
  // Monthly Stats
  calculateMonthlyStats,
  calculateBaseline,

  // Peak Detection
  detectPeaksFromStats,
  generatePeaksFromCategoryHint,
  mergePeaks,

  // Pre-peak Period
  calculateDaysUntilNextPeak,
  isInPrePeakPeriod,
  calculateBidMultiplier,
  generateAdjustmentReason,
} from "./peak-detector";

// =============================================================================
// Predictor
// =============================================================================
export {
  // Main Prediction
  predictSeasonality,
  predictSeasonalityBatch,

  // Validation
  isPredictionValid,
  isPredictionConfident,
  shouldAdjustBid,

  // Debug
  formatPredictionForDebug,
} from "./predictor";

// =============================================================================
// Repository
// =============================================================================
export {
  SeasonalityRepository,
  getSeasonalityRepository,
  resetSeasonalityRepository,
} from "./repository";

// =============================================================================
// Job
// =============================================================================
export {
  runSeasonalityUpdateJob,
  updateSingleKeywordPrediction,
} from "./job";

// =============================================================================
// HTTP Handlers
// =============================================================================
export {
  createSeasonalityUpdateHandler,
  createSeasonalityQueryHandler,
  createActiveAdjustmentsHandler,
  createAdjustmentStatsHandler,
} from "./httpHandler";

// =============================================================================
// Integration (bidEngine用)
// =============================================================================
export {
  // Types
  BidAdjustmentContext,

  // Main Functions
  applySeasonalityAdjustment,
  applySeasonalityAdjustmentBatch,
  logSeasonalityAdjustment,

  // Helpers
  getCurrentSeasonalityConfig,
  isSeasonalityEnabled,
  getSeasonalityMode,
} from "./integration";

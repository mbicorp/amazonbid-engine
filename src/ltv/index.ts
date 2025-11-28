/**
 * LTV（顧客生涯価値）モジュール
 *
 * 収益モデル（LTV/単発購入）に基づいたACOSターゲット計算機能を提供
 */

// 型定義
export {
  RevenueModel,
  LtvMode,
  LifecycleState,
  BusinessMode,
  BrandType,
  ExperimentGroup,
  ProductConfig,
  ProductLtvMetricsRow,
  LtvModeThresholds,
  DEFAULT_LTV_MODE_THRESHOLDS,
  ACOS_CONSTANTS,
  BaseLtvAcosDetails,
  FinalTargetAcosDetails,
} from "./types";

// LTV計算ロジック
export {
  determineLtvMode,
  calculateDaysSinceLaunch,
  computeBaseLtvTargetAcos,
  computeFinalTargetAcos,
  getTargetAcos,
  getTargetAcosWithDetails,
} from "./ltv-calculator";

// ProductConfig組み立て
export {
  parseRevenueModel,
  parseLifecycleState,
  buildProductConfig,
  fetchProductConfig,
  fetchProductConfigs,
  fetchProductConfigByAsin,
} from "./product-config-builder";

// =============================================================================
// 実測LTV（measuredLtv）
// =============================================================================

// 型定義
export {
  RepeatMetrics1y,
  ProfitMetrics1y,
  MeasuredLtvInput,
  LtvSource,
  VALID_LTV_SOURCES,
  isValidLtvSource,
  MeasuredLtvResult,
  MeasuredLtvConfig,
  DEFAULT_MEASURED_LTV_CONFIG,
  ResolveLtvInput,
  ResolvedLtvResult,
} from "./measuredLtv";

// 計算関数
export {
  calculateDaysActive,
  getLtvSafetyFactorMeasured,
  canUseMeasuredLtv,
  computeMeasuredLtv,
  resolveLtvForProduct,
  calculateCumulativeLossLimitFromResolvedLtv,
} from "./measuredLtv";

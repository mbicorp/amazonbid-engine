/**
 * TACOSモジュール
 *
 * TACOS（Total Advertising Cost of Sales）の最適化と健全性評価機能を提供
 */

// 型定義
export {
  DailyTacosMetrics,
  TacosOptimizationConfig,
  DEFAULT_TACOS_OPTIMIZATION_CONFIG,
  TacosOptimizationResult,
  TacosHealthContext,
  TacosHealthResult,
  DEFAULT_LOW_MARGIN,
  StrongUpMultiplierConfig,
  DEFAULT_STRONG_UP_MULTIPLIER_CONFIG,
  StrongUpMultiplierResult,
  ProductTacosConfig,
  PRODUCT_TACOS_CONFIG_DEFAULTS,
  DEFAULT_PRODUCT_TACOS_CONFIG,
  TacosHealthEvaluationInput,
  TacosHealthEvaluationResult,
  // 新規追加: TACOS zone と STRONG_UP gate
  TacosZone,
  TacosZoneContext,
  TacosZoneResult,
  StrongUpGateInput,
  StrongUpGateResult,
  TacosMaxForControlInput,
  TacosMaxForControlResult,
} from "./tacosHealth";

// 計算関数
export {
  estimateOptimalTacos,
  computeTacosHealthScore,
  computeStrongUpMultiplierFromTacosHealth,
  computeStrongUpMultiplierWithDetails,
  calculateTacos90d,
  getProductTacosConfigForProfile,
  evaluateTacosHealth,
  // 新規追加: TACOS zone と STRONG_UP gate
  determineTacosZone,
  applyStrongUpGate,
  calculateTacosMaxForControl,
} from "./tacosHealth";

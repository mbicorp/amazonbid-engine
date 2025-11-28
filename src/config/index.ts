/**
 * 設定レイヤー - エントリーポイント
 *
 * ProductConfig の型定義、バリデーション、リポジトリを一元管理
 */

// 型定義
export {
  // ライフサイクル
  LifecycleState,
  VALID_LIFECYCLE_STATES,
  isValidLifecycleState,

  // 収益モデル
  RevenueModel,
  VALID_REVENUE_MODELS,
  isValidRevenueModel,

  // LTVモード
  LtvMode,
  VALID_LTV_MODES,
  isValidLtvMode,

  // ビジネスモード
  BusinessMode,
  VALID_BUSINESS_MODES,
  isValidBusinessMode,

  // ブランドタイプ
  BrandType,
  VALID_BRAND_TYPES,
  isValidBrandType,

  // 実験グループ
  ExperimentGroup,
  VALID_EXPERIMENT_GROUPS,
  isValidExperimentGroup,

  // リスクレベル
  RiskLevel,
  VALID_RISK_LEVELS,
  isValidRiskLevel,

  // ビッグセール戦略
  BigSaleStrategy,
  VALID_BIG_SALE_STRATEGIES,
  isValidBigSaleStrategy,
  DEFAULT_BIG_SALE_STRATEGY,

  // ProductConfig本体
  ProductConfig,
  PRODUCT_CONFIG_DEFAULTS,
  PRODUCT_CONFIG_BOUNDS,
} from "./productConfigTypes";

// バリデーター
export {
  ValidationSeverity,
  ValidationIssue,
  ValidationResult,
  BulkValidationResult,
  validateProductConfig,
  validateAllProductConfigs,
  formatValidationResult,
  formatBulkValidationResult,
} from "./productConfigValidator";

// リポジトリ
export {
  ProductConfigRepositoryOptions,
  ProductConfigRepository,
  createProductConfigRepository,
  getDefaultProductConfigRepository,
  resetDefaultProductConfigRepository,
} from "./productConfigRepository";

// 旧ローダー（互換性維持）
export {
  ProductConfigLoaderOptions,
  loadAllProductConfigs,
  loadProductConfigByAsin,
  loadProductConfigsByAsins,
  getActiveAsins,
} from "./productConfigLoader";

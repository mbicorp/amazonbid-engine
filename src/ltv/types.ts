/**
 * LTV（顧客生涯価値）関連 - 型定義
 *
 * 商品の収益モデル（LTVベース/単発購入）に基づいてACOSターゲットを計算するための型定義
 *
 * 注意: 基本型（ProductConfig, LifecycleState等）は src/config/productConfigTypes.ts から
 * 再エクスポートしています。新規コードはそちらを直接参照することを推奨します。
 */

// =============================================================================
// 基本型のインポートと再エクスポート（互換性維持）
// =============================================================================

// ProductConfig と関連型は config/productConfigTypes.ts からインポート
import type {
  ProductConfig as _ProductConfig,
  LifecycleState as _LifecycleState,
  RevenueModel as _RevenueModel,
  LtvMode as _LtvMode,
  BusinessMode as _BusinessMode,
  BrandType as _BrandType,
  ExperimentGroup as _ExperimentGroup,
  RiskLevel as _RiskLevel,
} from "../config/productConfigTypes";

// 型を再エクスポート
export type ProductConfig = _ProductConfig;
export type LifecycleState = _LifecycleState;
export type RevenueModel = _RevenueModel;
export type LtvMode = _LtvMode;
export type BusinessMode = _BusinessMode;
export type BrandType = _BrandType;
export type ExperimentGroup = _ExperimentGroup;
export type RiskLevel = _RiskLevel;

// 定数と関数を再エクスポート
export {
  VALID_LIFECYCLE_STATES,
  VALID_REVENUE_MODELS,
  VALID_LTV_MODES,
  VALID_BUSINESS_MODES,
  VALID_BRAND_TYPES,
  VALID_EXPERIMENT_GROUPS,
  VALID_RISK_LEVELS,
  PRODUCT_CONFIG_DEFAULTS,
  isValidLifecycleState,
  isValidRevenueModel,
  isValidLtvMode,
  isValidBusinessMode,
  isValidBrandType,
  isValidExperimentGroup,
  isValidRiskLevel,
} from "../config/productConfigTypes";

// =============================================================================
// 商品LTVメトリクス
// =============================================================================

/**
 * BigQueryのproduct_ltv_metricsテーブルに対応
 */
export interface ProductLtvMetricsRow {
  asin: string;
  product_id: string;
  margin_rate: number;
  expected_repeat_orders_assumed: number;
  expected_repeat_orders_measured_180d: number | null;
  safety_factor_assumed: number;
  safety_factor_measured: number;
  launch_date: Date | null;
  new_customers_total: number;
  last_ltv_updated_at: Date | null;
  revenue_model: string | null;  // "LTV" | "SINGLE_PURCHASE" | null
}

// =============================================================================
// LTVモード判定の閾値
// =============================================================================

/**
 * LTVモード判定の閾値設定
 */
export interface LtvModeThresholds {
  // EARLY_ESTIMATEに移行するための最小経過日数
  EARLY_ESTIMATE_DAYS_MIN: number;
  // MEASUREDに移行するための最小経過日数
  MEASURED_DAYS_MIN: number;
  // EARLY_ESTIMATEに移行するための最小新規顧客数
  EARLY_ESTIMATE_NEW_CUSTOMERS_MIN: number;
  // MEASUREDに移行するための最小新規顧客数
  MEASURED_NEW_CUSTOMERS_MIN: number;
}

/**
 * デフォルトのLTVモード判定閾値
 */
export const DEFAULT_LTV_MODE_THRESHOLDS: LtvModeThresholds = {
  EARLY_ESTIMATE_DAYS_MIN: 60,
  MEASURED_DAYS_MIN: 120,
  EARLY_ESTIMATE_NEW_CUSTOMERS_MIN: 50,
  MEASURED_NEW_CUSTOMERS_MIN: 200,
};

// =============================================================================
// ACOS計算の定数
// =============================================================================

/**
 * ACOS計算の定数
 */
export const ACOS_CONSTANTS = {
  // 単発購入商品の安全係数
  SINGLE_PURCHASE_SAFETY_FACTOR: 0.8,

  // ライフサイクルステージ別ACOS上限
  LAUNCH_HARD_TARGET_ACOS_CAP: 0.60,
  LAUNCH_SOFT_TARGET_ACOS_CAP: 0.50,
  GROW_TARGET_ACOS_CAP: 0.45,
  HARVEST_TARGET_ACOS_CAP: 0.35,

  // ACOS計算結果の最小/最大値
  MIN_ACOS: 0,
  MAX_ACOS: 0.9,

  // HARVESTモードの粗利率係数
  HARVEST_MARGIN_MULTIPLIER: 0.8,

  // ステージ別のLTV ACOS係数
  LAUNCH_SOFT_LTV_MULTIPLIER: 0.9,
  GROW_LTV_MULTIPLIER: 0.8,
};

// =============================================================================
// ACOS計算結果
// =============================================================================

/**
 * baseLtvAcos計算の詳細
 */
export interface BaseLtvAcosDetails {
  revenueModel: RevenueModel;
  ltvMode: LtvMode | null;
  marginRate: number;
  expectedRepeatOrders: number | null;
  safetyFactor: number;
  calculatedAcos: number;
  clipped: boolean;
}

/**
 * finalTargetAcos計算の詳細
 */
export interface FinalTargetAcosDetails {
  baseLtvAcos: number;
  lifecycleState: string;
  multiplier: number;
  cap: number;
  finalAcos: number;
}

// =============================================================================
// ガードレール設定
// =============================================================================

/**
 * ライフサイクル別ガードレール設定
 *
 * 各ライフサイクルステートに対して入札の上下限と変動比率を設定
 */
export interface GuardrailsPerLifecycle {
  /** 最低入札額（円） */
  min_bid: number;
  /** 最高入札額（円） */
  max_bid: number;
  /** 最大上昇比率（例: 1.2 = +20%まで） */
  max_up_ratio: number;
  /** 最大下降比率（例: 0.7 = -30%まで） */
  max_down_ratio: number;
  /** 自動計算されたmin/maxを使用するか */
  use_auto_min_max: boolean;
}

/**
 * ガードレール設定全体
 */
export interface GuardrailsConfig {
  perLifecycle: Record<LifecycleState, GuardrailsPerLifecycle>;
}

/**
 * デフォルトのライフサイクル別ガードレール設定
 */
export const DEFAULT_GUARDRAILS_PER_LIFECYCLE: Record<LifecycleState, GuardrailsPerLifecycle> = {
  LAUNCH_HARD: {
    min_bid: 10,
    max_bid: 500,
    max_up_ratio: 1.3,
    max_down_ratio: 0.6,
    use_auto_min_max: false,
  },
  LAUNCH_SOFT: {
    min_bid: 10,
    max_bid: 400,
    max_up_ratio: 1.25,
    max_down_ratio: 0.65,
    use_auto_min_max: false,
  },
  GROW: {
    min_bid: 10,
    max_bid: 300,
    max_up_ratio: 1.2,
    max_down_ratio: 0.7,
    use_auto_min_max: false,
  },
  HARVEST: {
    min_bid: 10,
    max_bid: 200,
    max_up_ratio: 1.15,
    max_down_ratio: 0.75,
    use_auto_min_max: false,
  },
};

// =============================================================================
// 自動ガードレール設定
// =============================================================================

/**
 * 自動ガードレール計算の設定
 */
export interface AutoGuardrailsConfig {
  /** 最小クリック数の閾値（これ未満のバケットは除外） */
  min_clicks_threshold: number;
  /** ACOS条件の許容マージン（target_acos × margin_acos 以下を有望と判定） */
  margin_acos: number;
  /** CVR条件の最小比率（baseline_cvr × min_cvr_ratio 以上を有望と判定） */
  min_cvr_ratio: number;
  /** ベースラインCVR（履歴がない場合のフォールバック） */
  baseline_cvr_estimate: number;
  /** min_bid計算時のベータ係数（ライフサイクル別） */
  min_beta: Record<LifecycleState, number>;
  /** max_bid計算時のアルファ係数（ライフサイクル別） */
  max_alpha: Record<LifecycleState, number>;
  /** フォールバック時のmin_bid（円） */
  fallback_min_bid: number;
  /** フォールバック時のmax_bid（円） */
  fallback_max_bid: number;
}

/**
 * デフォルトの自動ガードレール設定
 */
export const DEFAULT_AUTO_GUARDRAILS_CONFIG: AutoGuardrailsConfig = {
  min_clicks_threshold: 80,
  margin_acos: 1.2,
  min_cvr_ratio: 0.5,
  baseline_cvr_estimate: 0.03,
  min_beta: {
    LAUNCH_HARD: 0.7,
    LAUNCH_SOFT: 0.75,
    GROW: 0.8,
    HARVEST: 0.85,
  },
  max_alpha: {
    LAUNCH_HARD: 1.5,
    LAUNCH_SOFT: 1.4,
    GROW: 1.3,
    HARVEST: 1.2,
  },
  fallback_min_bid: 10,
  fallback_max_bid: 200,
};

// =============================================================================
// 自動ガードレールテーブル行
// =============================================================================

/**
 * BigQueryのproduct_guardrails_autoテーブルの行
 */
export interface ProductGuardrailsAutoRow {
  asin: string;
  lifecycle_state: LifecycleState;
  min_bid_auto: number;
  max_bid_auto: number;
  data_source: "HISTORICAL" | "THEORETICAL" | "FALLBACK";
  clicks_used: number;
  updated_at: Date;
}

/**
 * 入札バケットデータ（search_term_bid_buckets_30dビューの行）
 */
export interface BidBucketRow {
  asin: string;
  lifecycle_state: LifecycleState;
  bid_bucket: string;
  bid_bucket_lower: number;
  bid_bucket_upper: number;
  impressions_30d: number;
  clicks_30d: number;
  cost_30d: number;
  conversions_30d: number;
  revenue_30d: number;
  avg_bid_30d: number;
  cpc_30d: number | null;
  cvr_30d: number | null;
  acos_30d: number | null;
  record_count: number;
}

/**
 * 自動ガードレール計算結果
 */
export interface AutoGuardrailsResult {
  asin: string;
  lifecycle_state: LifecycleState;
  min_bid_auto: number;
  max_bid_auto: number;
  data_source: "HISTORICAL" | "THEORETICAL" | "FALLBACK";
  clicks_used: number;
}

// =============================================================================
// ガードレールモード
// =============================================================================

/**
 * ガードレール適用モード
 *
 * - OFF: ガードレール計算を行わない（トラブルシュート用）
 * - SHADOW: 計算するがログのみ、実際の入札値には適用しない（デフォルト）
 * - ENFORCE: 計算結果を実際の入札値に適用する
 */
export type GuardrailsMode = "OFF" | "SHADOW" | "ENFORCE";

/**
 * 有効なガードレールモードの一覧
 */
export const VALID_GUARDRAILS_MODES: readonly GuardrailsMode[] = [
  "OFF",
  "SHADOW",
  "ENFORCE",
] as const;

/**
 * ガードレールモードのバリデーション
 */
export function isValidGuardrailsMode(value: string): value is GuardrailsMode {
  return VALID_GUARDRAILS_MODES.includes(value as GuardrailsMode);
}

/**
 * デフォルトのガードレールモード
 * 安全のため SHADOW をデフォルトとし、本番挙動を変えない
 */
export const DEFAULT_GUARDRAILS_MODE: GuardrailsMode = "SHADOW";

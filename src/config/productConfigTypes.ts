/**
 * ProductConfig 型定義 - Single Source of Truth
 *
 * 商品設定の正式なスキーマを定義
 * すべての商品設定関連の型はここから参照する
 */

// =============================================================================
// ライフサイクル
// =============================================================================

/**
 * ライフサイクルステート
 *
 * - LAUNCH_HARD: 新発売ハード投資期（ACOS緩和最大）
 * - LAUNCH_SOFT: 新発売ソフト投資期（ACOS緩和中）
 * - GROW: 成長期（標準ACOS）
 * - HARVEST: 回収期（ACOS厳格）
 */
export type LifecycleState = "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST";

/**
 * 有効なライフサイクルステート一覧
 */
export const VALID_LIFECYCLE_STATES: readonly LifecycleState[] = [
  "LAUNCH_HARD",
  "LAUNCH_SOFT",
  "GROW",
  "HARVEST",
] as const;

/**
 * 値がLifecycleStateかどうかを判定
 */
export function isValidLifecycleState(value: unknown): value is LifecycleState {
  return (
    typeof value === "string" &&
    VALID_LIFECYCLE_STATES.includes(value as LifecycleState)
  );
}

// =============================================================================
// 収益モデル
// =============================================================================

/**
 * 収益モデルタイプ
 *
 * - LTV: サプリなどリピート前提でLTVを見る商品
 * - SINGLE_PURCHASE: シューズなど単発購入前提の商品
 */
export type RevenueModel = "LTV" | "SINGLE_PURCHASE";

/**
 * 有効な収益モデル一覧
 */
export const VALID_REVENUE_MODELS: readonly RevenueModel[] = [
  "LTV",
  "SINGLE_PURCHASE",
] as const;

/**
 * 値がRevenueModelかどうかを判定
 */
export function isValidRevenueModel(value: unknown): value is RevenueModel {
  return (
    typeof value === "string" &&
    VALID_REVENUE_MODELS.includes(value as RevenueModel)
  );
}

// =============================================================================
// LTVモード
// =============================================================================

/**
 * LTVモード
 *
 * - ASSUMED: 仮定値ベース（データ不足期間）
 * - EARLY_ESTIMATE: 早期推計（一定のデータ収集後）
 * - MEASURED: 実測値ベース（十分なデータ収集後）
 */
export type LtvMode = "ASSUMED" | "EARLY_ESTIMATE" | "MEASURED";

/**
 * 有効なLTVモード一覧
 */
export const VALID_LTV_MODES: readonly LtvMode[] = [
  "ASSUMED",
  "EARLY_ESTIMATE",
  "MEASURED",
] as const;

/**
 * 値がLtvModeかどうかを判定
 */
export function isValidLtvMode(value: unknown): value is LtvMode {
  return (
    typeof value === "string" && VALID_LTV_MODES.includes(value as LtvMode)
  );
}

// =============================================================================
// ビジネスモード
// =============================================================================

/**
 * ビジネスモード
 *
 * - PROFIT: 利益優先
 * - SHARE: シェア優先
 */
export type BusinessMode = "PROFIT" | "SHARE";

/**
 * 有効なビジネスモード一覧
 */
export const VALID_BUSINESS_MODES: readonly BusinessMode[] = [
  "PROFIT",
  "SHARE",
] as const;

/**
 * 値がBusinessModeかどうかを判定
 */
export function isValidBusinessMode(value: unknown): value is BusinessMode {
  return (
    typeof value === "string" &&
    VALID_BUSINESS_MODES.includes(value as BusinessMode)
  );
}

// =============================================================================
// ブランドタイプ
// =============================================================================

/**
 * ブランドタイプ
 *
 * - BRAND: 自社ブランド
 * - GENERIC: 汎用キーワード
 * - CONQUEST: 競合ブランド攻略
 */
export type BrandType = "BRAND" | "GENERIC" | "CONQUEST";

/**
 * 有効なブランドタイプ一覧
 */
export const VALID_BRAND_TYPES: readonly BrandType[] = [
  "BRAND",
  "GENERIC",
  "CONQUEST",
] as const;

/**
 * 値がBrandTypeかどうかを判定
 */
export function isValidBrandType(value: unknown): value is BrandType {
  return (
    typeof value === "string" && VALID_BRAND_TYPES.includes(value as BrandType)
  );
}

// =============================================================================
// 実験グループ
// =============================================================================

/**
 * 実験グループ
 */
export type ExperimentGroup = "CONTROL" | "VARIANT_A" | "VARIANT_B";

/**
 * 有効な実験グループ一覧
 */
export const VALID_EXPERIMENT_GROUPS: readonly ExperimentGroup[] = [
  "CONTROL",
  "VARIANT_A",
  "VARIANT_B",
] as const;

/**
 * 値がExperimentGroupかどうかを判定
 */
export function isValidExperimentGroup(
  value: unknown
): value is ExperimentGroup {
  return (
    typeof value === "string" &&
    VALID_EXPERIMENT_GROUPS.includes(value as ExperimentGroup)
  );
}

// =============================================================================
// リスクレベル
// =============================================================================

/**
 * リスクレベル
 *
 * - AGGRESSIVE: 積極的（高リスク・高リターン）
 * - BALANCED: バランス型
 * - CONSERVATIVE: 保守的（低リスク・低リターン）
 */
export type RiskLevel = "AGGRESSIVE" | "BALANCED" | "CONSERVATIVE";

/**
 * 有効なリスクレベル一覧
 */
export const VALID_RISK_LEVELS: readonly RiskLevel[] = [
  "AGGRESSIVE",
  "BALANCED",
  "CONSERVATIVE",
] as const;

/**
 * 値がRiskLevelかどうかを判定
 */
export function isValidRiskLevel(value: unknown): value is RiskLevel {
  return (
    typeof value === "string" && VALID_RISK_LEVELS.includes(value as RiskLevel)
  );
}

// =============================================================================
// 在庫ガードモード
// =============================================================================

/**
 * 在庫ガードモード
 *
 * - OFF: 在庫連動ロジックを無視（実験用）
 * - NORMAL: 通常のガード設定
 * - STRICT: より保守的なガード設定
 */
export type InventoryGuardMode = "OFF" | "NORMAL" | "STRICT";

/**
 * 有効な在庫ガードモード一覧
 */
export const VALID_INVENTORY_GUARD_MODES: readonly InventoryGuardMode[] = [
  "OFF",
  "NORMAL",
  "STRICT",
] as const;

/**
 * 値がInventoryGuardModeかどうかを判定
 */
export function isValidInventoryGuardMode(
  value: unknown
): value is InventoryGuardMode {
  return (
    typeof value === "string" &&
    VALID_INVENTORY_GUARD_MODES.includes(value as InventoryGuardMode)
  );
}

// =============================================================================
// 在庫ゼロ時ポリシー
// =============================================================================

/**
 * 在庫ゼロ時の入札ポリシー
 *
 * - SET_ZERO: 入札をゼロに設定
 * - SKIP_RECOMMENDATION: 推奨レコードを生成しない
 */
export type OutOfStockBidPolicy = "SET_ZERO" | "SKIP_RECOMMENDATION";

/**
 * 有効な在庫ゼロ時ポリシー一覧
 */
export const VALID_OUT_OF_STOCK_POLICIES: readonly OutOfStockBidPolicy[] = [
  "SET_ZERO",
  "SKIP_RECOMMENDATION",
] as const;

/**
 * 値がOutOfStockBidPolicyかどうかを判定
 */
export function isValidOutOfStockBidPolicy(
  value: unknown
): value is OutOfStockBidPolicy {
  return (
    typeof value === "string" &&
    VALID_OUT_OF_STOCK_POLICIES.includes(value as OutOfStockBidPolicy)
  );
}

// =============================================================================
// ビッグセール戦略
// =============================================================================

/**
 * ビッグセール戦略
 *
 * SKUごとに「ビッグセール時にどこまで攻めるか」を制御するフラグ
 *
 * - NONE: ビッグセールでも通常日と同じスタンス。S_MODEの攻めロジックを適用しない
 * - LIGHT: ビッグセールの影響を少しは利用するが、フルスロットルでは走らない
 *          S_MODEの攻め係数を半分程度にスケール
 * - AGGRESSIVE: 本気でビッグセールに乗りに行く。S_MODEのフルパワーを活用
 */
export type BigSaleStrategy = "NONE" | "LIGHT" | "AGGRESSIVE";

/**
 * 有効なビッグセール戦略一覧
 */
export const VALID_BIG_SALE_STRATEGIES: readonly BigSaleStrategy[] = [
  "NONE",
  "LIGHT",
  "AGGRESSIVE",
] as const;

/**
 * 値がBigSaleStrategyかどうかを判定
 */
export function isValidBigSaleStrategy(value: unknown): value is BigSaleStrategy {
  return (
    typeof value === "string" &&
    VALID_BIG_SALE_STRATEGIES.includes(value as BigSaleStrategy)
  );
}

/**
 * デフォルトのビッグセール戦略
 * 保守的に NONE をデフォルトとする
 */
export const DEFAULT_BIG_SALE_STRATEGY: BigSaleStrategy = "NONE";

// =============================================================================
// ProductConfig 本体
// =============================================================================

/**
 * 商品設定（ProductConfig）
 *
 * BigQueryのproduct_configテーブルから読み込んだデータと計算結果を保持
 * これが商品設定の唯一の正（Single Source of Truth）
 */
export interface ProductConfig {
  // ----- 識別子 -----
  /**
   * Amazon Ads プロファイルID
   *
   * 注意: BigQueryのproduct_configテーブルには含まれていないため、
   * ローダー経由で取得した場合はundefinedになります。
   * 実行コンテキストから設定されます。
   */
  profileId?: string;

  /** ASIN（Amazon標準識別番号） */
  asin: string;

  /** 内部商品ID（オプション） */
  productId?: string;

  /** SKU（オプション） */
  sku?: string;

  // ----- 有効フラグ -----
  /** 入札エンジンの対象にするか */
  isActive: boolean;

  // ----- 収益モデル -----
  /** 収益モデル */
  revenueModel: RevenueModel;

  // ----- ライフサイクル -----
  /** ライフサイクルステート */
  lifecycleState: LifecycleState;

  /** 推奨ライフサイクルステート（サジェスト用） */
  lifecycleSuggestedState?: LifecycleState | null;

  /** 最後のライフサイクルサジェスト理由 */
  lastLifecycleSuggestedReason?: string | null;

  // ----- ビジネスモード -----
  /** ビジネスモード */
  businessMode: BusinessMode;

  // ----- カテゴリ・ブランド -----
  /** カテゴリ */
  category?: string;

  /** ブランドタイプ */
  brandType: BrandType;

  // ----- 実験グループ -----
  /** 実験グループ */
  experimentGroup: ExperimentGroup;

  // ----- リスクレベル -----
  /** リスクレベル（オプション、デフォルト: BALANCED） */
  riskLevel?: RiskLevel;

  // ----- LTV関連 -----
  /** LTVモード */
  ltvMode: LtvMode;

  /**
   * 粗利率（0-1）
   * @deprecated marginRateNormal と marginRateBlended を使用してください。
   * 互換性維持のため残していますが、新規コードでは使用しないでください。
   */
  marginRate: number;

  /**
   * 平常時粗利率（0-1）
   *
   * クーポンや小さな値引きは含めてよいが、
   * 特選タイムセールなどの大規模値引きは含めない。
   * 「普段の売り方でどれくらい粗利が取れるか」を表す。
   *
   * LTV計算とtargetTacosStageの算出にはこの値を使用する。
   */
  marginRateNormal?: number;

  /**
   * セール込み実績粗利率（0-1）
   *
   * 最近1年間などの実績データから逆算された粗利率。
   * セール、クーポン、ポイント、キャンペーンなどを全て含めた「現実の粗利率」。
   *
   * 実績の赤字判定やモニタリングにはこの値を使用する。
   */
  marginRateBlended?: number;

  /** 想定リピート回数（仮定値） */
  expectedRepeatOrdersAssumed: number;

  /** 想定リピート回数（実測値、180日） */
  expectedRepeatOrdersMeasured: number | null;

  /** 安全係数（仮定値） */
  safetyFactorAssumed: number;

  /** 安全係数（実測値） */
  safetyFactorMeasured: number;

  // ----- ACOS関連 -----
  /** 計算済みターゲットACOS（LTVベース） */
  targetAcos?: number;

  /** 最大入札倍率（オプション） */
  maxBidMultiplier?: number;

  /** 最小入札倍率（オプション） */
  minBidMultiplier?: number;

  // ----- 日付情報 -----
  /** 発売日 */
  launchDate: Date | null;

  /** 発売日からの経過日数 */
  daysSinceLaunch: number | null;

  /** 累計新規顧客数 */
  newCustomersTotal: number;

  // ----- AUTO→EXACT関連 -----
  /** AUTO→EXACT昇格を有効にするか（デフォルト: true） */
  autoExactEnabled?: boolean;

  /** ポートフォリオベースラインCVR（同一ブランド/商品グループの中央値） */
  portfolioBaselineCvr?: number;

  // ----- 在庫ガード関連 -----
  /**
   * 在庫ガードモード
   *
   * - OFF: 在庫連動ロジックを無視（実験用）
   * - NORMAL: 通常のガード設定（デフォルト）
   * - STRICT: より保守的なガード設定
   */
  inventoryGuardMode?: InventoryGuardMode;

  /**
   * 「攻め」モード禁止閾値（在庫日数）
   *
   * この日数を下回ったら、ライフサイクルに関わらず入札上昇を強く抑制
   * デフォルト: 10日
   */
  minDaysOfInventoryForGrowth?: number;

  /**
   * 「通常」モード抑制閾値（在庫日数）
   *
   * この日数を下回ったら、入札上昇を抑制
   * デフォルト: 20日
   */
  minDaysOfInventoryForNormal?: number;

  /**
   * 在庫ゼロ時の入札ポリシー
   *
   * - SET_ZERO: 入札をゼロに設定（デフォルト）
   * - SKIP_RECOMMENDATION: 推奨レコードを生成しない
   */
  outOfStockBidPolicy?: OutOfStockBidPolicy;

  // ----- 新商品判定関連 -----
  /**
   * 新商品フラグ
   *
   * 以下のいずれかを満たす場合にtrueとなる:
   * - daysSinceFirstImpression < 30
   * - 直近30日クリック数 < 100
   * - 直近30日注文数 < 20
   */
  isNewProduct?: boolean;

  /**
   * 最初のインプレッションからの経過日数
   */
  daysSinceFirstImpression?: number;

  /**
   * 直近30日クリック数（NEW_PRODUCT判定用）
   */
  clicks30d?: number;

  /**
   * 直近30日注文数（NEW_PRODUCT判定用）
   */
  orders30d?: number;

  // ----- 価格・LTV関連 -----
  /**
   * 商品単価（円）
   * LTV期待粗利の計算に使用
   */
  price?: number;

  /**
   * 商品プロファイルタイプ
   * 自動割り当て or 手動設定
   */
  productProfileType?: ProductProfileType;

  /**
   * LTV期待粗利（円）
   * = price × marginRateNormal × (1 + expectedRepeatOrdersAssumed)
   * 計算済みの値をキャッシュ
   */
  expectedLtvGrossProfit?: number;

  /**
   * 商品別累積赤字上限（円）
   * = expectedLtvGrossProfit × lossBudgetMultiple
   * NEW_PRODUCT期間中はlossBudgetMultipleInitialを使用
   */
  productCumulativeLossLimit?: number;

  /**
   * 現在の累積赤字（円）
   * 月次で更新される
   */
  cumulativeLoss?: number;

  /**
   * 連続赤字月数
   */
  consecutiveLossMonths?: number;

  // ----- ビッグセール戦略 -----
  /**
   * ビッグセール戦略
   *
   * SKUごとに「ビッグセール時にどこまで攻めるか」を制御
   *
   * - NONE: 通常日と同じスタンス（S_MODEの攻めロジックを適用しない）
   * - LIGHT: 控えめに参加（S_MODEの攻め係数を半分程度にスケール）
   * - AGGRESSIVE: 本気で参加（S_MODEのフルパワーを活用）
   *
   * デフォルト: NONE（保守的）
   */
  bigSaleStrategy?: BigSaleStrategy;

  // ----- メタ情報 -----
  /** メモ・備考 */
  notes?: string;
}

// =============================================================================
// 商品プロファイル（テンプレート）
// =============================================================================

/**
 * 商品プロファイルタイプ
 *
 * - DEFAULT: 標準設定
 * - SUPPLEMENT_HIGH_LTV: サプリメント高LTVプロファイル（カカオPS系）
 * - SUPPLEMENT_STANDARD: 標準サプリメント
 * - SINGLE_PURCHASE: 単発購入商品
 */
export type ProductProfileType =
  | "DEFAULT"
  | "SUPPLEMENT_HIGH_LTV"
  | "SUPPLEMENT_STANDARD"
  | "SINGLE_PURCHASE";

/**
 * 有効な商品プロファイルタイプ一覧
 */
export const VALID_PRODUCT_PROFILE_TYPES: readonly ProductProfileType[] = [
  "DEFAULT",
  "SUPPLEMENT_HIGH_LTV",
  "SUPPLEMENT_STANDARD",
  "SINGLE_PURCHASE",
] as const;

/**
 * 値がProductProfileTypeかどうかを判定
 */
export function isValidProductProfileType(
  value: unknown
): value is ProductProfileType {
  return (
    typeof value === "string" &&
    VALID_PRODUCT_PROFILE_TYPES.includes(value as ProductProfileType)
  );
}

/**
 * ステージ別TACOS設定
 */
export interface StageTacosConfig {
  /** 最小TACOS */
  minTacos: number;
  /** 最大TACOS */
  maxTacos: number;
}

/**
 * 商品プロファイル設定
 */
export interface ProductProfile {
  /** プロファイルタイプ */
  type: ProductProfileType;
  /** 説明 */
  description: string;
  /** 平常時粗利率のデフォルト値 */
  marginRateNormalDefault: number;
  /** 想定リピート回数 */
  expectedRepeatOrdersAssumed: number;
  /** LTV安全係数 */
  ltvSafetyFactor: number;
  /**
   * 初期赤字許容倍率（NEW_PRODUCT期間）
   * productCumulativeLossLimit = expectedLtvGrossProfit × lossBudgetMultipleInitial
   */
  lossBudgetMultipleInitial: number;
  /**
   * 成熟期赤字許容倍率（昇格後）
   * productCumulativeLossLimit = expectedLtvGrossProfit × lossBudgetMultipleMature
   */
  lossBudgetMultipleMature: number;
  /**
   * NEW_PRODUCT期間中の事前期待リピート回数
   * 実測データがない段階で使用する保守的な値
   */
  expectedRepeatOrdersPrior: number;
  /**
   * NEW_PRODUCT期間中のLTV安全係数
   * 実測データがない段階で使用する保守的な値
   */
  ltvSafetyFactorPrior: number;
  /**
   * ライフサイクルステート別の連続赤字許容月数
   */
  maxConsecutiveLossMonths: {
    LAUNCH_HARD: number;
    LAUNCH_SOFT: number;
    GROW: number;
    HARVEST: number;
  };
  /** ステージ別TACOS設定 */
  tacosConfig: {
    LAUNCH_HARD: StageTacosConfig;
    LAUNCH_SOFT: StageTacosConfig;
    GROW: StageTacosConfig;
    HARVEST: StageTacosConfig;
  };
}

/**
 * カカオPS系サプリ向け「高粗利・高LTVプロファイル」
 *
 * 特徴:
 * - 高粗利率（約55%）
 * - 高リピート率（想定1.7回）
 * - LTV考慮で攻めの広告運用が可能
 * - 初期赤字許容倍率: 0.6（LTV期待粗利の60%まで累積赤字OK）
 * - 成熟期赤字許容倍率: 0.4
 */
export const SUPPLEMENT_HIGH_LTV_PROFILE: ProductProfile = {
  type: "SUPPLEMENT_HIGH_LTV",
  description: "カカオPS系サプリ向け高粗利・高LTVプロファイル",
  marginRateNormalDefault: 0.55,
  expectedRepeatOrdersAssumed: 1.7,
  ltvSafetyFactor: 0.7,
  lossBudgetMultipleInitial: 0.6,
  lossBudgetMultipleMature: 0.4,
  expectedRepeatOrdersPrior: 1.3,
  ltvSafetyFactorPrior: 0.5,
  maxConsecutiveLossMonths: {
    LAUNCH_HARD: 6,
    LAUNCH_SOFT: 4,
    GROW: 3,
    HARVEST: 1,
  },
  tacosConfig: {
    LAUNCH_HARD: { minTacos: 0.25, maxTacos: 0.40 },
    LAUNCH_SOFT: { minTacos: 0.22, maxTacos: 0.38 },
    GROW: { minTacos: 0.20, maxTacos: 0.35 },
    HARVEST: { minTacos: 0.10, maxTacos: 0.20 },
  },
};

/**
 * 標準サプリメントプロファイル
 *
 * 特徴:
 * - 中程度粗利率（約40%）
 * - 標準リピート率（想定1.3回）
 * - 初期赤字許容倍率: 0.4
 * - 成熟期赤字許容倍率: 0.25
 */
export const SUPPLEMENT_STANDARD_PROFILE: ProductProfile = {
  type: "SUPPLEMENT_STANDARD",
  description: "標準サプリメント（ワンショット寄り）",
  marginRateNormalDefault: 0.40,
  expectedRepeatOrdersAssumed: 1.3,
  ltvSafetyFactor: 0.7,
  lossBudgetMultipleInitial: 0.4,
  lossBudgetMultipleMature: 0.25,
  expectedRepeatOrdersPrior: 1.1,
  ltvSafetyFactorPrior: 0.5,
  maxConsecutiveLossMonths: {
    LAUNCH_HARD: 4,
    LAUNCH_SOFT: 3,
    GROW: 2,
    HARVEST: 1,
  },
  tacosConfig: {
    LAUNCH_HARD: { minTacos: 0.25, maxTacos: 0.55 },
    LAUNCH_SOFT: { minTacos: 0.20, maxTacos: 0.45 },
    GROW: { minTacos: 0.15, maxTacos: 0.35 },
    HARVEST: { minTacos: 0.10, maxTacos: 0.25 },
  },
};

/**
 * 単発購入商品プロファイル
 *
 * 特徴:
 * - 標準粗利率（約30%）
 * - リピートなし（1.0回）
 * - 初期赤字許容倍率: 0.2（控えめ）
 * - 成熟期赤字許容倍率: 0.1
 */
export const SINGLE_PURCHASE_PROFILE: ProductProfile = {
  type: "SINGLE_PURCHASE",
  description: "単発購入商品（シューズ等）",
  marginRateNormalDefault: 0.30,
  expectedRepeatOrdersAssumed: 1.0,
  ltvSafetyFactor: 0.8,
  lossBudgetMultipleInitial: 0.2,
  lossBudgetMultipleMature: 0.1,
  expectedRepeatOrdersPrior: 1.0,
  ltvSafetyFactorPrior: 0.7,
  maxConsecutiveLossMonths: {
    LAUNCH_HARD: 3,
    LAUNCH_SOFT: 2,
    GROW: 1,
    HARVEST: 0,
  },
  tacosConfig: {
    LAUNCH_HARD: { minTacos: 0.20, maxTacos: 0.40 },
    LAUNCH_SOFT: { minTacos: 0.15, maxTacos: 0.35 },
    GROW: { minTacos: 0.12, maxTacos: 0.25 },
    HARVEST: { minTacos: 0.08, maxTacos: 0.18 },
  },
};

/**
 * デフォルトプロファイル
 *
 * 特徴:
 * - 保守的な標準設定
 * - 初期赤字許容倍率: 0.3
 * - 成熟期赤字許容倍率: 0.2
 */
export const DEFAULT_PROFILE: ProductProfile = {
  type: "DEFAULT",
  description: "標準設定",
  marginRateNormalDefault: 0.30,
  expectedRepeatOrdersAssumed: 1.0,
  ltvSafetyFactor: 0.7,
  lossBudgetMultipleInitial: 0.3,
  lossBudgetMultipleMature: 0.2,
  expectedRepeatOrdersPrior: 1.0,
  ltvSafetyFactorPrior: 0.5,
  maxConsecutiveLossMonths: {
    LAUNCH_HARD: 4,
    LAUNCH_SOFT: 3,
    GROW: 2,
    HARVEST: 1,
  },
  tacosConfig: {
    LAUNCH_HARD: { minTacos: 0.25, maxTacos: 0.55 },
    LAUNCH_SOFT: { minTacos: 0.20, maxTacos: 0.45 },
    GROW: { minTacos: 0.15, maxTacos: 0.35 },
    HARVEST: { minTacos: 0.10, maxTacos: 0.25 },
  },
};

/**
 * プロファイルマップ
 */
export const PRODUCT_PROFILES: Record<ProductProfileType, ProductProfile> = {
  DEFAULT: DEFAULT_PROFILE,
  SUPPLEMENT_HIGH_LTV: SUPPLEMENT_HIGH_LTV_PROFILE,
  SUPPLEMENT_STANDARD: SUPPLEMENT_STANDARD_PROFILE,
  SINGLE_PURCHASE: SINGLE_PURCHASE_PROFILE,
};

/**
 * プロファイルを取得
 */
export function getProductProfile(type: ProductProfileType): ProductProfile {
  return PRODUCT_PROFILES[type] ?? DEFAULT_PROFILE;
}

// =============================================================================
// デフォルト値
// =============================================================================

/**
 * ProductConfig のデフォルト値
 */
export const PRODUCT_CONFIG_DEFAULTS = {
  isActive: true,
  revenueModel: "LTV" as RevenueModel,
  lifecycleState: "GROW" as LifecycleState,
  businessMode: "PROFIT" as BusinessMode,
  brandType: "GENERIC" as BrandType,
  experimentGroup: "CONTROL" as ExperimentGroup,
  riskLevel: "BALANCED" as RiskLevel,
  ltvMode: "ASSUMED" as LtvMode,
  /** @deprecated marginRateNormal を使用してください */
  marginRate: 0.3,
  marginRateNormal: 0.3,
  marginRateBlended: 0.3,
  expectedRepeatOrdersAssumed: 1.0,
  safetyFactorAssumed: 0.7,
  safetyFactorMeasured: 0.85,
  newCustomersTotal: 0,
  autoExactEnabled: true,
  maxBidMultiplier: 3.0,
  minBidMultiplier: 0.5,
  // 在庫ガード関連
  inventoryGuardMode: "NORMAL" as InventoryGuardMode,
  minDaysOfInventoryForGrowth: 10,
  minDaysOfInventoryForNormal: 20,
  outOfStockBidPolicy: "SET_ZERO" as OutOfStockBidPolicy,
  // 新商品関連
  isNewProduct: false,
  // ビッグセール戦略
  bigSaleStrategy: "NONE" as BigSaleStrategy,
} as const;

// =============================================================================
// バリデーション境界値
// =============================================================================

/**
 * バリデーション用の境界値定数
 */
export const PRODUCT_CONFIG_BOUNDS = {
  // targetAcos: 0超過、1未満（100%以上は異常）
  targetAcos: {
    min: 0,
    max: 1,
    warningMax: 0.8, // 80%以上は警告
  },
  // marginRate: 0以上、1以下
  marginRate: {
    min: 0,
    max: 1,
    warningMin: 0.05, // 5%未満は警告
  },
  // expectedRepeatOrdersAssumed: 1以上
  expectedRepeatOrdersAssumed: {
    min: 1,
    max: 100,
    warningMax: 20, // 20回以上は警告
  },
  // safetyFactor: 0より大きく1以下
  safetyFactor: {
    min: 0,
    max: 1,
    warningMin: 0.5,
    warningMax: 0.95,
  },
  // maxBidMultiplier: 1以上、10以下
  maxBidMultiplier: {
    min: 1,
    max: 10,
    warningMax: 5,
  },
  // minBidMultiplier: 0より大きく、1以下
  minBidMultiplier: {
    min: 0,
    max: 1,
    warningMin: 0.3,
  },
  // newCustomersTotal: 0以上
  newCustomersTotal: {
    min: 0,
  },
  // daysSinceLaunch: 0以上
  daysSinceLaunch: {
    min: 0,
    max: 365 * 10, // 10年
  },
  // minDaysOfInventoryForGrowth: 1以上365以下
  minDaysOfInventoryForGrowth: {
    min: 1,
    max: 365,
    warningMin: 3, // 3日未満は警告
    warningMax: 60, // 60日超は警告
  },
  // minDaysOfInventoryForNormal: 1以上365以下
  minDaysOfInventoryForNormal: {
    min: 1,
    max: 365,
    warningMin: 5, // 5日未満は警告
    warningMax: 90, // 90日超は警告
  },
} as const;

// =============================================================================
// 新商品（NEW_PRODUCT）判定
// =============================================================================

/**
 * NEW_PRODUCT判定の閾値
 */
export const NEW_PRODUCT_THRESHOLDS = {
  /** 最初のインプレッションからの最小経過日数 */
  MIN_DAYS_SINCE_FIRST_IMPRESSION: 30,
  /** 直近30日の最小クリック数 */
  MIN_CLICKS_30D: 100,
  /** 直近30日の最小注文数 */
  MIN_ORDERS_30D: 20,
} as const;

/**
 * NEW_PRODUCT期間中の入札変更制限
 */
export const NEW_PRODUCT_BID_CONSTRAINTS = {
  /** 入札変更幅の上限（通常の±30%に対し、±15%に制限） */
  MAX_BID_CHANGE_RATE: 0.15,
  /** productBidMultiplierの最小値 */
  MIN_PRODUCT_BID_MULTIPLIER: 0.9,
  /** productBidMultiplierの最大値 */
  MAX_PRODUCT_BID_MULTIPLIER: 1.1,
  /** デフォルトのLTV安全係数（保守的） */
  DEFAULT_LTV_SAFETY_FACTOR: 0.5,
} as const;

/**
 * 新商品かどうかを判定
 *
 * 以下のいずれかを満たす場合にNEW_PRODUCTとみなす:
 * - daysSinceFirstImpression < 30
 * - 直近30日クリック数 < 100
 * - 直近30日注文数 < 20
 */
export function isNewProduct(
  daysSinceFirstImpression: number | undefined | null,
  clicks30d: number | undefined | null,
  orders30d: number | undefined | null
): boolean {
  // いずれかがundefined/nullの場合、データ不足なのでNEW_PRODUCTとみなす
  if (
    daysSinceFirstImpression === undefined ||
    daysSinceFirstImpression === null ||
    clicks30d === undefined ||
    clicks30d === null ||
    orders30d === undefined ||
    orders30d === null
  ) {
    return true;
  }

  // いずれかの閾値を下回ればNEW_PRODUCT
  return (
    daysSinceFirstImpression < NEW_PRODUCT_THRESHOLDS.MIN_DAYS_SINCE_FIRST_IMPRESSION ||
    clicks30d < NEW_PRODUCT_THRESHOLDS.MIN_CLICKS_30D ||
    orders30d < NEW_PRODUCT_THRESHOLDS.MIN_ORDERS_30D
  );
}

/**
 * 新商品から通常商品への昇格条件を満たすかどうかを判定
 *
 * 以下の条件をすべて満たした場合に昇格:
 * - daysSinceFirstImpression >= 30
 * - 直近30日クリック数 >= 100
 * - 直近30日注文数 >= 20
 */
export function canPromoteFromNewProduct(
  daysSinceFirstImpression: number | undefined | null,
  clicks30d: number | undefined | null,
  orders30d: number | undefined | null
): boolean {
  // いずれかがundefined/nullの場合は昇格不可
  if (
    daysSinceFirstImpression === undefined ||
    daysSinceFirstImpression === null ||
    clicks30d === undefined ||
    clicks30d === null ||
    orders30d === undefined ||
    orders30d === null
  ) {
    return false;
  }

  // すべての閾値を満たせば昇格可能
  return (
    daysSinceFirstImpression >= NEW_PRODUCT_THRESHOLDS.MIN_DAYS_SINCE_FIRST_IMPRESSION &&
    clicks30d >= NEW_PRODUCT_THRESHOLDS.MIN_CLICKS_30D &&
    orders30d >= NEW_PRODUCT_THRESHOLDS.MIN_ORDERS_30D
  );
}

/**
 * marginRateNormalを取得するヘルパー関数
 *
 * 優先順位:
 * 1. marginRateNormalが設定されていればそれを使用
 * 2. marginRateNormalが未設定でmarginRateがあればmarginRateを使用
 * 3. どちらもなければデフォルト値
 */
export function getMarginRateNormal(config: ProductConfig): number {
  if (config.marginRateNormal !== undefined) {
    return config.marginRateNormal;
  }
  if (config.marginRate !== undefined) {
    return config.marginRate;
  }
  return PRODUCT_CONFIG_DEFAULTS.marginRateNormal;
}

/**
 * marginRateBlendedを取得するヘルパー関数
 *
 * 優先順位:
 * 1. marginRateBlendedが設定されていればそれを使用
 * 2. marginRateBlendedが未設定でmarginRateNormalがあればそれを使用
 * 3. marginRateを使用
 * 4. どちらもなければデフォルト値
 */
export function getMarginRateBlended(config: ProductConfig): number {
  if (config.marginRateBlended !== undefined) {
    return config.marginRateBlended;
  }
  if (config.marginRateNormal !== undefined) {
    return config.marginRateNormal;
  }
  if (config.marginRate !== undefined) {
    return config.marginRate;
  }
  return PRODUCT_CONFIG_DEFAULTS.marginRateBlended;
}

// =============================================================================
// 昇格時パラメータ再推計
// =============================================================================

/**
 * 昇格時の再推計に必要な直近90日の実績データ
 */
export interface PromotionPerformanceData {
  /** ASIN */
  asin: string;
  /** 直近90日の総売上（広告経由+オーガニック） */
  totalSales90d: number;
  /** 直近90日の広告売上 */
  adSales90d: number;
  /** 直近90日の広告費 */
  adSpend90d: number;
  /** 直近90日のクリック数 */
  clicks90d: number;
  /** 直近90日の注文数 */
  orders90d: number;
  /** 直近90日のインプレッション数 */
  impressions90d: number;
  /** 直近90日の新規顧客数 */
  newCustomers90d: number;
  /** 直近90日のリピート注文数 */
  repeatOrders90d: number;
  /** 直近90日のリピート売上 */
  repeatSales90d: number;
  /** 直近90日のオーガニック売上 */
  organicSales90d: number;
  /** 直近90日の平均注文単価 */
  avgOrderValue90d: number;
}

/**
 * 再推計結果
 */
export interface ParameterReestimationResult {
  /** ASIN */
  asin: string;
  /** 推計されたリピート回数 */
  expectedRepeatOrdersEstimated: number;
  /** 推計されたLTV安全係数 */
  ltvSafetyFactorEstimated: number;
  /** 推計されたCVR */
  cvrEstimated: number;
  /** 推計されたCTR */
  ctrEstimated: number;
  /** 推計されたACOS（直近90日実績） */
  acosActual90d: number;
  /** 推計されたTACOS（直近90日実績） */
  tacosActual90d: number;
  /** 推計根拠 */
  estimationBasis: "EARLY_ESTIMATE" | "MEASURED";
  /** 信頼度（0-1、データ量に基づく） */
  confidence: number;
  /** 推計日時 */
  estimatedAt: Date;
  /** 推計に使用したデータ期間（日数） */
  dataPeriodDays: number;
}

/**
 * 昇格処理結果
 */
export interface PromotionResult {
  /** ASIN */
  asin: string;
  /** 昇格前のステータス */
  previousStatus: "NEW_PRODUCT";
  /** 昇格後のステータス */
  newStatus: "NORMAL";
  /** 再推計結果 */
  reestimation: ParameterReestimationResult;
  /** 更新されたProductConfigの差分 */
  configUpdates: Partial<ProductConfig>;
  /** 昇格日時 */
  promotedAt: Date;
}

/**
 * 再推計のデフォルト設定
 */
export const REESTIMATION_DEFAULTS = {
  /** 再推計に必要な最小データ期間（日） */
  MIN_DATA_PERIOD_DAYS: 30,
  /** 推奨データ期間（日） */
  RECOMMENDED_DATA_PERIOD_DAYS: 90,
  /** 高信頼度の閾値 */
  HIGH_CONFIDENCE_THRESHOLD: 0.8,
  /** 中信頼度の閾値 */
  MEDIUM_CONFIDENCE_THRESHOLD: 0.5,
  /** EARLY_ESTIMATEからMEASUREDへの移行に必要な最小リピート注文数 */
  MIN_REPEAT_ORDERS_FOR_MEASURED: 50,
  /** リピート率計算時の最小新規顧客数 */
  MIN_NEW_CUSTOMERS_FOR_REPEAT_RATE: 30,
  /** 安全係数の最小値 */
  MIN_SAFETY_FACTOR: 0.5,
  /** 安全係数の最大値 */
  MAX_SAFETY_FACTOR: 0.9,
  /** リピート回数の最小値 */
  MIN_REPEAT_ORDERS: 1.0,
  /** リピート回数の最大値（異常値検出用） */
  MAX_REPEAT_ORDERS: 10.0,
} as const;

/**
 * 直近90日の実績データからパラメータを再推計する
 *
 * @param performanceData - 直近90日の実績データ
 * @param currentConfig - 現在のProductConfig
 * @returns 再推計結果
 */
export function reestimateParameters(
  performanceData: PromotionPerformanceData,
  currentConfig: ProductConfig
): ParameterReestimationResult {
  const {
    asin,
    clicks90d,
    orders90d,
    impressions90d,
    newCustomers90d,
    repeatOrders90d,
    adSpend90d,
    adSales90d,
    totalSales90d,
  } = performanceData;

  // CVR推計: 注文数 / クリック数
  const cvrEstimated = clicks90d > 0 ? orders90d / clicks90d : 0;

  // CTR推計: クリック数 / インプレッション数
  const ctrEstimated = impressions90d > 0 ? clicks90d / impressions90d : 0;

  // ACOS推計: 広告費 / 広告売上
  const acosActual90d = adSales90d > 0 ? adSpend90d / adSales90d : 0;

  // TACOS推計: 広告費 / 総売上
  const tacosActual90d = totalSales90d > 0 ? adSpend90d / totalSales90d : 0;

  // リピート回数推計
  let expectedRepeatOrdersEstimated: number;
  let estimationBasis: "EARLY_ESTIMATE" | "MEASURED";

  if (
    newCustomers90d >= REESTIMATION_DEFAULTS.MIN_NEW_CUSTOMERS_FOR_REPEAT_RATE &&
    repeatOrders90d >= REESTIMATION_DEFAULTS.MIN_REPEAT_ORDERS_FOR_MEASURED
  ) {
    // 十分なデータがある場合: 実測ベース
    // リピート回数 = 1 + (リピート注文数 / 新規顧客数)
    const repeatRate = repeatOrders90d / newCustomers90d;
    expectedRepeatOrdersEstimated = Math.min(
      Math.max(1 + repeatRate, REESTIMATION_DEFAULTS.MIN_REPEAT_ORDERS),
      REESTIMATION_DEFAULTS.MAX_REPEAT_ORDERS
    );
    estimationBasis = "MEASURED";
  } else if (newCustomers90d >= 10 && repeatOrders90d > 0) {
    // 限定的なデータ: 早期推計
    const repeatRate = repeatOrders90d / newCustomers90d;
    expectedRepeatOrdersEstimated = Math.min(
      Math.max(1 + repeatRate * 0.8, REESTIMATION_DEFAULTS.MIN_REPEAT_ORDERS), // 保守的に20%割引
      REESTIMATION_DEFAULTS.MAX_REPEAT_ORDERS
    );
    estimationBasis = "EARLY_ESTIMATE";
  } else {
    // データ不足: カテゴリ標準値を維持
    expectedRepeatOrdersEstimated =
      currentConfig.expectedRepeatOrdersAssumed ??
      PRODUCT_CONFIG_DEFAULTS.expectedRepeatOrdersAssumed;
    estimationBasis = "EARLY_ESTIMATE";
  }

  // LTV安全係数推計
  // データ量と実績の安定性に基づいて安全係数を調整
  let ltvSafetyFactorEstimated: number;

  if (estimationBasis === "MEASURED") {
    // 十分なデータがある場合: 高めの安全係数
    ltvSafetyFactorEstimated = 0.8;
  } else if (newCustomers90d >= 20) {
    // ある程度のデータがある場合: 中程度の安全係数
    ltvSafetyFactorEstimated = 0.7;
  } else {
    // データ不足: 保守的な安全係数
    ltvSafetyFactorEstimated = 0.6;
  }

  // 信頼度計算
  // クリック数、注文数、新規顧客数に基づく
  const clicksConfidence = Math.min(clicks90d / 500, 1); // 500クリックで満点
  const ordersConfidence = Math.min(orders90d / 100, 1); // 100注文で満点
  const customersConfidence = Math.min(newCustomers90d / 50, 1); // 50新規顧客で満点
  const confidence = (clicksConfidence + ordersConfidence + customersConfidence) / 3;

  return {
    asin,
    expectedRepeatOrdersEstimated,
    ltvSafetyFactorEstimated,
    cvrEstimated,
    ctrEstimated,
    acosActual90d,
    tacosActual90d,
    estimationBasis,
    confidence,
    estimatedAt: new Date(),
    dataPeriodDays: REESTIMATION_DEFAULTS.RECOMMENDED_DATA_PERIOD_DAYS,
  };
}

/**
 * 昇格処理を実行し、パラメータを再推計して更新内容を返す
 *
 * @param performanceData - 直近90日の実績データ
 * @param currentConfig - 現在のProductConfig
 * @returns 昇格処理結果（昇格条件を満たさない場合はnull）
 */
export function executePromotion(
  performanceData: PromotionPerformanceData,
  currentConfig: ProductConfig
): PromotionResult | null {
  // 昇格条件チェック
  const canPromote = canPromoteFromNewProduct(
    currentConfig.daysSinceFirstImpression,
    currentConfig.clicks30d,
    currentConfig.orders30d
  );

  if (!canPromote) {
    return null;
  }

  // パラメータ再推計
  const reestimation = reestimateParameters(performanceData, currentConfig);

  // 更新するConfigの差分を作成
  const configUpdates: Partial<ProductConfig> = {
    isNewProduct: false,
    ltvMode: reestimation.estimationBasis,
  };

  // 信頼度が高い場合のみ推計値で更新
  if (reestimation.confidence >= REESTIMATION_DEFAULTS.MEDIUM_CONFIDENCE_THRESHOLD) {
    configUpdates.expectedRepeatOrdersAssumed = reestimation.expectedRepeatOrdersEstimated;
    configUpdates.safetyFactorAssumed = reestimation.ltvSafetyFactorEstimated;
  }

  // MEASUREDの場合は実測値も設定
  if (reestimation.estimationBasis === "MEASURED") {
    configUpdates.expectedRepeatOrdersMeasured = reestimation.expectedRepeatOrdersEstimated;
    configUpdates.safetyFactorMeasured = reestimation.ltvSafetyFactorEstimated;
  }

  return {
    asin: performanceData.asin,
    previousStatus: "NEW_PRODUCT",
    newStatus: "NORMAL",
    reestimation,
    configUpdates,
    promotedAt: new Date(),
  };
}

// =============================================================================
// LTV期待粗利と累積赤字上限の計算
// =============================================================================

/**
 * グローバルリスク設定
 */
export interface GlobalRiskConfig {
  /**
   * グローバル累積赤字予算率
   * 全商品のexpectedLtvGrossProfit合計に対する許容赤字割合
   */
  globalLossBudgetRate: number;
  /**
   * グローバル累積赤字上限（円）
   * = 全商品のexpectedLtvGrossProfit合計 × globalLossBudgetRate
   */
  globalCumulativeLossLimit?: number;
  /**
   * 現在のグローバル累積赤字（円）
   */
  globalCumulativeLoss?: number;
  /**
   * 理論最大TACOSのグローバル上限
   * theoreticalMaxTacosCapped = min(theoreticalMaxTacos, tmaxCapGlobal)
   * デフォルト: 0.7 (70%)
   */
  tmaxCapGlobal: number;
}

/**
 * グローバルリスク設定のデフォルト値
 */
export const GLOBAL_RISK_CONFIG_DEFAULTS: GlobalRiskConfig = {
  globalLossBudgetRate: 0.15, // 全商品LTV期待粗利の15%まで
  tmaxCapGlobal: 0.7, // 理論最大TACOSの上限は70%
};

/**
 * LTV期待粗利を計算
 *
 * expectedLtvGrossProfit = price × marginRateNormal × (1 + expectedRepeatOrdersAssumed)
 *
 * @param price - 商品単価（円）
 * @param marginRateNormal - 平常時粗利率（0-1）
 * @param expectedRepeatOrders - 想定リピート回数
 * @returns LTV期待粗利（円）
 */
export function calculateExpectedLtvGrossProfit(
  price: number,
  marginRateNormal: number,
  expectedRepeatOrders: number
): number {
  if (price <= 0 || marginRateNormal <= 0 || expectedRepeatOrders < 1) {
    return 0;
  }
  return price * marginRateNormal * (1 + expectedRepeatOrders);
}

/**
 * ProductConfigからLTV期待粗利を計算
 *
 * @param config - ProductConfig
 * @param profile - 商品プロファイル（オプション）
 * @returns LTV期待粗利（円）
 */
export function calculateExpectedLtvGrossProfitFromConfig(
  config: ProductConfig,
  profile?: ProductProfile
): number {
  const price = config.price ?? 0;
  const marginRateNormal = getMarginRateNormal(config);

  // リピート回数の決定
  // NEW_PRODUCT期間中はprofileのprior値を使用
  let expectedRepeatOrders: number;
  if (config.isNewProduct && profile) {
    expectedRepeatOrders = profile.expectedRepeatOrdersPrior;
  } else {
    expectedRepeatOrders = config.expectedRepeatOrdersAssumed ??
      profile?.expectedRepeatOrdersAssumed ??
      PRODUCT_CONFIG_DEFAULTS.expectedRepeatOrdersAssumed;
  }

  return calculateExpectedLtvGrossProfit(price, marginRateNormal, expectedRepeatOrders);
}

/**
 * 商品別累積赤字上限を計算
 *
 * productCumulativeLossLimit = expectedLtvGrossProfit × lossBudgetMultiple
 *
 * @param expectedLtvGrossProfit - LTV期待粗利（円）
 * @param lossBudgetMultiple - 赤字許容倍率
 * @returns 累積赤字上限（円）
 */
export function calculateProductCumulativeLossLimit(
  expectedLtvGrossProfit: number,
  lossBudgetMultiple: number
): number {
  if (expectedLtvGrossProfit <= 0 || lossBudgetMultiple <= 0) {
    return 0;
  }
  return expectedLtvGrossProfit * lossBudgetMultiple;
}

/**
 * ProductConfigから商品別累積赤字上限を計算
 *
 * @param config - ProductConfig
 * @param profile - 商品プロファイル
 * @returns 累積赤字上限（円）
 */
export function calculateProductCumulativeLossLimitFromConfig(
  config: ProductConfig,
  profile: ProductProfile
): number {
  const expectedLtvGrossProfit = calculateExpectedLtvGrossProfitFromConfig(config, profile);

  // NEW_PRODUCT期間中はInitial、昇格後はMatureを使用
  const lossBudgetMultiple = config.isNewProduct
    ? profile.lossBudgetMultipleInitial
    : profile.lossBudgetMultipleMature;

  return calculateProductCumulativeLossLimit(expectedLtvGrossProfit, lossBudgetMultiple);
}

/**
 * グローバル累積赤字上限を計算
 *
 * @param totalExpectedLtvGrossProfit - 全商品のLTV期待粗利合計（円）
 * @param globalLossBudgetRate - グローバル赤字予算率（0-1）
 * @returns グローバル累積赤字上限（円）
 */
export function calculateGlobalCumulativeLossLimit(
  totalExpectedLtvGrossProfit: number,
  globalLossBudgetRate: number
): number {
  if (totalExpectedLtvGrossProfit <= 0 || globalLossBudgetRate <= 0) {
    return 0;
  }
  return totalExpectedLtvGrossProfit * globalLossBudgetRate;
}

/**
 * 累積赤字が上限を超えているかどうかを判定
 *
 * @param cumulativeLoss - 現在の累積赤字（円）
 * @param lossLimit - 累積赤字上限（円）
 * @returns 上限を超えている場合はtrue
 */
export function isOverCumulativeLossLimit(
  cumulativeLoss: number,
  lossLimit: number
): boolean {
  return cumulativeLoss > lossLimit;
}

/**
 * 連続赤字月数が許容上限を超えているかどうかを判定
 *
 * @param consecutiveLossMonths - 現在の連続赤字月数
 * @param maxConsecutiveLossMonths - 許容連続赤字月数
 * @returns 上限を超えている場合はtrue
 */
export function isOverConsecutiveLossMonthsLimit(
  consecutiveLossMonths: number,
  maxConsecutiveLossMonths: number
): boolean {
  return consecutiveLossMonths > maxConsecutiveLossMonths;
}

/**
 * ライフサイクルステートに応じた連続赤字許容月数を取得
 *
 * @param profile - 商品プロファイル
 * @param lifecycleState - ライフサイクルステート
 * @returns 連続赤字許容月数
 */
export function getMaxConsecutiveLossMonths(
  profile: ProductProfile,
  lifecycleState: LifecycleState
): number {
  return profile.maxConsecutiveLossMonths[lifecycleState];
}

/**
 * リスク判定結果
 */
export interface RiskAssessment {
  /** 累積赤字が上限を超えているか */
  isOverCumulativeLoss: boolean;
  /** 連続赤字月数が上限を超えているか */
  isOverConsecutiveLossMonths: boolean;
  /** いずれかのリスク条件に該当するか */
  isAtRisk: boolean;
  /** 累積赤字の上限に対する割合（0-1+） */
  cumulativeLossRatio: number;
  /** 連続赤字月数の上限に対する割合（0-1+） */
  consecutiveLossMonthsRatio: number;
  /** リスクレベル */
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/**
 * 商品のリスクを評価
 *
 * @param config - ProductConfig
 * @param profile - 商品プロファイル
 * @returns リスク評価結果
 */
export function assessProductRisk(
  config: ProductConfig,
  profile: ProductProfile
): RiskAssessment {
  const cumulativeLoss = config.cumulativeLoss ?? 0;
  const consecutiveLossMonths = config.consecutiveLossMonths ?? 0;
  const lossLimit = calculateProductCumulativeLossLimitFromConfig(config, profile);
  const maxLossMonths = getMaxConsecutiveLossMonths(profile, config.lifecycleState);

  const isOverCumulativeLoss = isOverCumulativeLossLimit(cumulativeLoss, lossLimit);
  const isOverConsecutiveLossMonthsFlag = isOverConsecutiveLossMonthsLimit(
    consecutiveLossMonths,
    maxLossMonths
  );

  const cumulativeLossRatio = lossLimit > 0 ? cumulativeLoss / lossLimit : 0;
  const consecutiveLossMonthsRatio = maxLossMonths > 0
    ? consecutiveLossMonths / maxLossMonths
    : 0;

  // リスクレベル判定
  let riskLevel: RiskAssessment["riskLevel"];
  if (isOverCumulativeLoss || isOverConsecutiveLossMonthsFlag) {
    riskLevel = "CRITICAL";
  } else if (cumulativeLossRatio >= 0.8 || consecutiveLossMonthsRatio >= 0.8) {
    riskLevel = "HIGH";
  } else if (cumulativeLossRatio >= 0.5 || consecutiveLossMonthsRatio >= 0.5) {
    riskLevel = "MEDIUM";
  } else {
    riskLevel = "LOW";
  }

  return {
    isOverCumulativeLoss,
    isOverConsecutiveLossMonths: isOverConsecutiveLossMonthsFlag,
    isAtRisk: isOverCumulativeLoss || isOverConsecutiveLossMonthsFlag,
    cumulativeLossRatio,
    consecutiveLossMonthsRatio,
    riskLevel,
  };
}

// =============================================================================
// 激戦度判定と自動プロファイル割り当て
// =============================================================================

/**
 * Jungle Scout等から取得する競合データ
 */
export interface CompetitionData {
  /** ASIN */
  asin: string;
  /** キーワードまたはカテゴリ */
  keywordOrCategory: string;
  /**
   * 強い競合数（月売上100万円以上かつ評価4.0以上）
   */
  strongCompetitorCount: number;
  /**
   * 中央CPC対価格比
   * medianCpcToPriceRatio = カテゴリ中央CPC / 自社商品価格
   * 高いほど激戦
   */
  medianCpcToPriceRatio: number;
  /**
   * 大手ブランドシェア
   * 上位10商品中の大手ブランド売上シェア（0-1）
   */
  bigBrandShare: number;
  /**
   * カテゴリの中央CPC（円）
   */
  medianCpc?: number;
  /**
   * 平均商品価格（円）
   */
  avgProductPrice?: number;
  /**
   * 取得日時
   */
  fetchedAt?: Date;
}

/**
 * 激戦度判定の閾値設定
 */
export const COMPETITION_THRESHOLDS = {
  /** 激戦カテゴリの強い競合数閾値 */
  HIGH_COMPETITION_STRONG_COMPETITOR_COUNT: 15,
  /** 激戦カテゴリの中央CPC対価格比閾値 */
  HIGH_COMPETITION_CPC_PRICE_RATIO: 0.05,
  /** 激戦カテゴリの大手ブランドシェア閾値 */
  HIGH_COMPETITION_BIG_BRAND_SHARE: 0.5,
  /** 低LTVサプリに該当する激戦度スコア閾値 */
  LOW_LTV_SUPPLEMENT_SCORE_THRESHOLD: 2,
} as const;

/**
 * 激戦度スコア（0-3）
 * - 0: 低激戦度
 * - 1: 中程度
 * - 2: 高激戦度
 * - 3: 超激戦度
 */
export type CompetitionIntensityScore = 0 | 1 | 2 | 3;

/**
 * 激戦度を計算
 *
 * 以下の3条件をスコア化:
 * 1. strongCompetitorCount >= 15
 * 2. medianCpcToPriceRatio >= 0.05
 * 3. bigBrandShare >= 0.5
 *
 * @param data - 競合データ
 * @returns 激戦度スコア（0-3）
 */
export function calculateCompetitionIntensity(
  data: CompetitionData
): CompetitionIntensityScore {
  let score = 0;

  if (data.strongCompetitorCount >= COMPETITION_THRESHOLDS.HIGH_COMPETITION_STRONG_COMPETITOR_COUNT) {
    score++;
  }
  if (data.medianCpcToPriceRatio >= COMPETITION_THRESHOLDS.HIGH_COMPETITION_CPC_PRICE_RATIO) {
    score++;
  }
  if (data.bigBrandShare >= COMPETITION_THRESHOLDS.HIGH_COMPETITION_BIG_BRAND_SHARE) {
    score++;
  }

  return score as CompetitionIntensityScore;
}

/**
 * 激戦度スコアに基づいてプロファイルを自動割り当て
 *
 * - スコア0-1: SUPPLEMENT_HIGH_LTV（高リピート期待可能）
 * - スコア2: SUPPLEMENT_STANDARD（標準）
 * - スコア3: LOW_LTV_SUPPLEMENT（激戦・保守的）
 *
 * @param intensityScore - 激戦度スコア
 * @param revenueModel - 収益モデル
 * @returns 推奨プロファイルタイプ
 */
export function getRecommendedProfileByCompetition(
  intensityScore: CompetitionIntensityScore,
  revenueModel: RevenueModel
): ProductProfileType {
  // SINGLE_PURCHASEの場合は常にSINGLE_PURCHASE
  if (revenueModel === "SINGLE_PURCHASE") {
    return "SINGLE_PURCHASE";
  }

  // LTVモデルの場合、激戦度に応じて判定
  switch (intensityScore) {
    case 0:
    case 1:
      return "SUPPLEMENT_HIGH_LTV";
    case 2:
      return "SUPPLEMENT_STANDARD";
    case 3:
      // 超激戦度の場合は低LTVサプリとして扱う
      // 注意: 現状SINGLE_PURCHASEで代用（将来LOW_LTV_SUPPLEMENT追加予定）
      return "SUPPLEMENT_STANDARD";
    default:
      return "DEFAULT";
  }
}

/**
 * プロファイル自動割り当て結果
 */
export interface ProfileAssignmentResult {
  /** 割り当てられたプロファイルタイプ */
  profileType: ProductProfileType;
  /** 激戦度スコア */
  competitionIntensityScore: CompetitionIntensityScore;
  /** 自動割り当てか手動割り当てか */
  assignmentMethod: "AUTO" | "MANUAL";
  /** 割り当て理由 */
  reason: string;
  /** 割り当て日時 */
  assignedAt: Date;
}

/**
 * 競合データに基づいてプロファイルを自動割り当て
 *
 * @param config - 現在のProductConfig
 * @param competitionData - 競合データ
 * @returns プロファイル割り当て結果
 */
export function assignProfileByCompetition(
  config: ProductConfig,
  competitionData: CompetitionData
): ProfileAssignmentResult {
  const intensityScore = calculateCompetitionIntensity(competitionData);
  const recommendedProfile = getRecommendedProfileByCompetition(
    intensityScore,
    config.revenueModel
  );

  let reason: string;
  switch (intensityScore) {
    case 0:
      reason = "低激戦度: 高LTVプロファイル推奨";
      break;
    case 1:
      reason = "中程度激戦度: 高LTVプロファイル推奨（リピート期待可能）";
      break;
    case 2:
      reason = `高激戦度: 標準プロファイル推奨（強い競合${competitionData.strongCompetitorCount}社、CPC比${(competitionData.medianCpcToPriceRatio * 100).toFixed(1)}%）`;
      break;
    case 3:
      reason = `超激戦度: 保守的プロファイル推奨（大手シェア${(competitionData.bigBrandShare * 100).toFixed(0)}%）`;
      break;
    default:
      reason = "デフォルトプロファイル適用";
  }

  return {
    profileType: recommendedProfile,
    competitionIntensityScore: intensityScore,
    assignmentMethod: "AUTO",
    reason,
    assignedAt: new Date(),
  };
}

// =============================================================================
// 成長判定条件（isGrowingCandidate）
// =============================================================================

/**
 * 成長判定に必要なパフォーマンスデータ
 */
export interface GrowthAssessmentData {
  /** ASIN */
  asin: string;
  /** オーガニック売上の前月比成長率（例: 0.15 = +15%） */
  organicGrowthRate: number;
  /** オーガニック売上の前年同月比成長率（例: 0.30 = +30%） */
  organicGrowthRateYoY?: number;
  /** 自社商品の評価（1-5） */
  productRating: number;
  /** 競合商品の評価中央値（1-5） */
  competitorMedianRating: number;
  /** 自社商品のレビュー数 */
  reviewCount: number;
  /** 競合商品のレビュー数中央値 */
  competitorMedianReviewCount?: number;
  /** 広告売上に対するオーガニック売上の比率 */
  organicToAdSalesRatio: number;
  /** 広告依存度（広告売上 / 総売上） */
  adDependencyRatio: number;
  /** 直近30日のBSR（ベストセラーランキング）トレンド方向（-1: 悪化, 0: 横ばい, 1: 改善） */
  bsrTrend?: -1 | 0 | 1;
  /** BSRランキング（カテゴリ内） */
  bsrRank?: number;
}

/**
 * 成長判定の閾値設定
 */
export const GROWTH_THRESHOLDS = {
  /** オーガニック成長が「成長中」とみなす最小成長率 */
  MIN_ORGANIC_GROWTH_RATE: 0.05, // +5%
  /** オーガニック成長が「急成長中」とみなす成長率 */
  HIGH_ORGANIC_GROWTH_RATE: 0.20, // +20%
  /** 評価が「健全」とみなす最小評価 */
  MIN_HEALTHY_RATING: 3.8,
  /** 競合に対する評価差の閾値（自社評価 - 競合評価） */
  MIN_RATING_ADVANTAGE: -0.3, // 競合より0.3以内の差はOK
  /** 広告からオーガニックへの転換が良好とみなす比率 */
  MIN_ORGANIC_TO_AD_RATIO: 0.8, // オーガニック売上 >= 広告売上の80%
  /** 広告依存度が高すぎるとみなす閾値 */
  MAX_AD_DEPENDENCY_RATIO: 0.7, // 70%以上は広告依存しすぎ
  /** 最小レビュー数（信頼性判定用） */
  MIN_REVIEW_COUNT: 10,
} as const;

/**
 * 成長条件の個別判定結果
 */
export interface GrowthConditions {
  /** オーガニック成長中か */
  conditionOrganicGrowing: boolean;
  /** 評価が健全か（自社評価が一定以上 AND 競合と遜色ない） */
  conditionRatingHealthy: boolean;
  /** 広告からオーガニックへの転換が良好か */
  conditionAdsToOrganic: boolean;
  /** 各条件の詳細スコア */
  details: {
    organicGrowthRate: number;
    ratingDifference: number;
    organicToAdRatio: number;
    adDependency: number;
  };
}

/**
 * 成長候補判定結果
 */
export interface GrowthCandidateResult {
  /** 成長候補か */
  isGrowingCandidate: boolean;
  /** 成長条件の判定結果 */
  conditions: GrowthConditions;
  /** 成長スコア（0-100） */
  growthScore: number;
  /** 推奨ライフサイクルステート */
  recommendedLifecycleState: LifecycleState;
  /** 判定理由 */
  reasons: string[];
  /** 判定日時 */
  assessedAt: Date;
}

/**
 * オーガニック成長条件を評価
 *
 * @param data - 成長評価データ
 * @returns オーガニック成長中かどうか
 */
export function evaluateOrganicGrowthCondition(
  data: GrowthAssessmentData
): boolean {
  return data.organicGrowthRate >= GROWTH_THRESHOLDS.MIN_ORGANIC_GROWTH_RATE;
}

/**
 * 評価健全性条件を評価
 *
 * 条件:
 * - 自社評価 >= MIN_HEALTHY_RATING (3.8)
 * - (自社評価 - 競合中央評価) >= MIN_RATING_ADVANTAGE (-0.3)
 *
 * @param data - 成長評価データ
 * @returns 評価が健全かどうか
 */
export function evaluateRatingHealthCondition(
  data: GrowthAssessmentData
): boolean {
  const ratingDifference = data.productRating - data.competitorMedianRating;
  return (
    data.productRating >= GROWTH_THRESHOLDS.MIN_HEALTHY_RATING &&
    ratingDifference >= GROWTH_THRESHOLDS.MIN_RATING_ADVANTAGE
  );
}

/**
 * 広告→オーガニック転換条件を評価
 *
 * 条件:
 * - オーガニック/広告売上比率 >= MIN_ORGANIC_TO_AD_RATIO (0.8)
 * - 広告依存度 <= MAX_AD_DEPENDENCY_RATIO (0.7)
 *
 * @param data - 成長評価データ
 * @returns 転換が良好かどうか
 */
export function evaluateAdsToOrganicCondition(
  data: GrowthAssessmentData
): boolean {
  return (
    data.organicToAdSalesRatio >= GROWTH_THRESHOLDS.MIN_ORGANIC_TO_AD_RATIO &&
    data.adDependencyRatio <= GROWTH_THRESHOLDS.MAX_AD_DEPENDENCY_RATIO
  );
}

/**
 * 成長スコアを計算（0-100）
 *
 * @param conditions - 成長条件
 * @param data - 成長評価データ
 * @returns 成長スコア
 */
export function calculateGrowthScore(
  conditions: GrowthConditions,
  data: GrowthAssessmentData
): number {
  let score = 0;

  // オーガニック成長（最大40点）
  if (conditions.conditionOrganicGrowing) {
    const growthBonus = Math.min(data.organicGrowthRate / GROWTH_THRESHOLDS.HIGH_ORGANIC_GROWTH_RATE, 1);
    score += 20 + growthBonus * 20;
  }

  // 評価健全性（最大30点）
  if (conditions.conditionRatingHealthy) {
    const ratingBonus = Math.min(
      (data.productRating - GROWTH_THRESHOLDS.MIN_HEALTHY_RATING) / 0.5,
      1
    );
    score += 20 + ratingBonus * 10;
  }

  // 広告→オーガニック転換（最大30点）
  if (conditions.conditionAdsToOrganic) {
    const conversionBonus = Math.min(
      (data.organicToAdSalesRatio - GROWTH_THRESHOLDS.MIN_ORGANIC_TO_AD_RATIO) / 0.5,
      1
    );
    score += 20 + conversionBonus * 10;
  }

  // BSRトレンドボーナス（最大10点）
  if (data.bsrTrend === 1) {
    score += 10;
  } else if (data.bsrTrend === 0) {
    score += 5;
  }

  return Math.min(Math.round(score), 100);
}

/**
 * 成長スコアに基づいて推奨ライフサイクルステートを決定
 *
 * @param growthScore - 成長スコア（0-100）
 * @param currentState - 現在のライフサイクルステート
 * @returns 推奨ライフサイクルステート
 */
export function getRecommendedLifecycleByGrowth(
  growthScore: number,
  currentState: LifecycleState
): LifecycleState {
  if (growthScore >= 80) {
    // 高成長: LAUNCH_HARD or LAUNCH_SOFTを維持/推奨
    if (currentState === "HARVEST") return "GROW";
    return currentState === "LAUNCH_HARD" ? "LAUNCH_HARD" : "LAUNCH_SOFT";
  } else if (growthScore >= 60) {
    // 中成長: GROWを推奨
    return "GROW";
  } else if (growthScore >= 40) {
    // 低成長: 現状維持 or HARVEST移行検討
    return currentState === "HARVEST" ? "HARVEST" : "GROW";
  } else {
    // 成長停滞: HARVEST推奨
    return "HARVEST";
  }
}

/**
 * 成長候補かどうかを総合判定
 *
 * isGrowingCandidate = conditionOrganicGrowing AND conditionRatingHealthy AND conditionAdsToOrganic
 *
 * @param data - 成長評価データ
 * @param currentLifecycleState - 現在のライフサイクルステート
 * @returns 成長候補判定結果
 */
export function assessGrowthCandidate(
  data: GrowthAssessmentData,
  currentLifecycleState: LifecycleState
): GrowthCandidateResult {
  const conditionOrganicGrowing = evaluateOrganicGrowthCondition(data);
  const conditionRatingHealthy = evaluateRatingHealthCondition(data);
  const conditionAdsToOrganic = evaluateAdsToOrganicCondition(data);

  const conditions: GrowthConditions = {
    conditionOrganicGrowing,
    conditionRatingHealthy,
    conditionAdsToOrganic,
    details: {
      organicGrowthRate: data.organicGrowthRate,
      ratingDifference: data.productRating - data.competitorMedianRating,
      organicToAdRatio: data.organicToAdSalesRatio,
      adDependency: data.adDependencyRatio,
    },
  };

  const isGrowingCandidate =
    conditionOrganicGrowing && conditionRatingHealthy && conditionAdsToOrganic;

  const growthScore = calculateGrowthScore(conditions, data);
  const recommendedLifecycleState = getRecommendedLifecycleByGrowth(
    growthScore,
    currentLifecycleState
  );

  // 判定理由を生成
  const reasons: string[] = [];
  if (conditionOrganicGrowing) {
    reasons.push(`オーガニック成長中 (+${(data.organicGrowthRate * 100).toFixed(1)}%)`);
  } else {
    reasons.push(`オーガニック成長停滞 (${(data.organicGrowthRate * 100).toFixed(1)}%)`);
  }

  if (conditionRatingHealthy) {
    reasons.push(`評価健全 (${data.productRating.toFixed(1)} vs 競合${data.competitorMedianRating.toFixed(1)})`);
  } else {
    const ratingDiff = data.productRating - data.competitorMedianRating;
    if (data.productRating < GROWTH_THRESHOLDS.MIN_HEALTHY_RATING) {
      reasons.push(`評価低迷 (${data.productRating.toFixed(1)})`);
    } else {
      reasons.push(`競合評価に劣後 (差: ${ratingDiff.toFixed(1)})`);
    }
  }

  if (conditionAdsToOrganic) {
    reasons.push(`オーガニック転換良好 (比率${(data.organicToAdSalesRatio * 100).toFixed(0)}%)`);
  } else {
    if (data.adDependencyRatio > GROWTH_THRESHOLDS.MAX_AD_DEPENDENCY_RATIO) {
      reasons.push(`広告依存度高 (${(data.adDependencyRatio * 100).toFixed(0)}%)`);
    } else {
      reasons.push(`オーガニック転換不足 (比率${(data.organicToAdSalesRatio * 100).toFixed(0)}%)`);
    }
  }

  return {
    isGrowingCandidate,
    conditions,
    growthScore,
    recommendedLifecycleState,
    reasons,
    assessedAt: new Date(),
  };
}

// =============================================================================
// 理論最大TACOS（theoreticalMaxTacos）計算
// =============================================================================

/**
 * 理論最大TACOS計算に必要なパラメータ
 */
export interface TheoreticalMaxTacosParams {
  /** 平常時粗利率（0-1） */
  marginRateNormal: number;
  /** 想定リピート回数（1以上） */
  expectedRepeatOrders: number;
  /** LTV安全係数（0-1） */
  ltvSafetyFactor: number;
  /** 商品価格（円）- maxAdSpendPerUser計算時に使用 */
  price?: number;
}

/**
 * 理論最大TACOS計算結果
 */
export interface TheoreticalMaxTacosResult {
  /**
   * 顧客一人当たり最大広告費（円）
   * maxAdSpendPerUser = expectedLtvGrossProfit × ltvSafetyFactor
   */
  maxAdSpendPerUser: number;
  /**
   * 理論最大TACOS（キャップなし）
   * theoreticalMaxTacos = marginRateNormal × (1 + expectedRepeatOrders) × ltvSafetyFactor
   */
  theoreticalMaxTacos: number;
  /**
   * 理論最大TACOS（キャップあり）
   * theoreticalMaxTacosCapped = min(theoreticalMaxTacos, tmaxCapGlobal)
   */
  theoreticalMaxTacosCapped: number;
  /**
   * キャップが適用されたかどうか
   */
  isCapped: boolean;
}

/**
 * 顧客一人当たり最大広告費を計算
 *
 * maxAdSpendPerUser = expectedLtvGrossProfit × ltvSafetyFactor
 *                   = price × marginRateNormal × (1 + expectedRepeatOrders) × ltvSafetyFactor
 *
 * @param price - 商品価格（円）
 * @param marginRateNormal - 平常時粗利率（0-1）
 * @param expectedRepeatOrders - 想定リピート回数（1以上）
 * @param ltvSafetyFactor - LTV安全係数（0-1）
 * @returns 顧客一人当たり最大広告費（円）
 */
export function calculateMaxAdSpendPerUser(
  price: number,
  marginRateNormal: number,
  expectedRepeatOrders: number,
  ltvSafetyFactor: number
): number {
  if (price <= 0 || marginRateNormal <= 0 || expectedRepeatOrders < 1 || ltvSafetyFactor <= 0) {
    return 0;
  }
  const expectedLtvGrossProfit = price * marginRateNormal * (1 + expectedRepeatOrders);
  return expectedLtvGrossProfit * ltvSafetyFactor;
}

/**
 * 理論最大TACOSを計算
 *
 * theoreticalMaxTacos = marginRateNormal × (1 + expectedRepeatOrders) × ltvSafetyFactor
 *
 * 注意: この値は「広告費/売上」の上限を意味する
 * 例: marginRate=0.55, repeat=1.7, safety=0.7 → 0.55 × 2.7 × 0.7 = 1.0395
 *     → 売上の100%超を広告に投じてもLTV的にはペイする計算
 *
 * @param marginRateNormal - 平常時粗利率（0-1）
 * @param expectedRepeatOrders - 想定リピート回数（1以上）
 * @param ltvSafetyFactor - LTV安全係数（0-1）
 * @returns 理論最大TACOS（0以上の値）
 */
export function calculateTheoreticalMaxTacos(
  marginRateNormal: number,
  expectedRepeatOrders: number,
  ltvSafetyFactor: number
): number {
  if (marginRateNormal <= 0 || expectedRepeatOrders < 1 || ltvSafetyFactor <= 0) {
    return 0;
  }
  return marginRateNormal * (1 + expectedRepeatOrders) * ltvSafetyFactor;
}

/**
 * 理論最大TACOSを計算（キャップあり）
 *
 * theoreticalMaxTacosCapped = min(theoreticalMaxTacos, tmaxCapGlobal)
 *
 * @param marginRateNormal - 平常時粗利率（0-1）
 * @param expectedRepeatOrders - 想定リピート回数（1以上）
 * @param ltvSafetyFactor - LTV安全係数（0-1）
 * @param tmaxCapGlobal - グローバルキャップ（デフォルト: 0.7）
 * @returns キャップ適用後の理論最大TACOS
 */
export function calculateTheoreticalMaxTacosCapped(
  marginRateNormal: number,
  expectedRepeatOrders: number,
  ltvSafetyFactor: number,
  tmaxCapGlobal: number = GLOBAL_RISK_CONFIG_DEFAULTS.tmaxCapGlobal
): number {
  const uncapped = calculateTheoreticalMaxTacos(
    marginRateNormal,
    expectedRepeatOrders,
    ltvSafetyFactor
  );
  return Math.min(uncapped, tmaxCapGlobal);
}

/**
 * ProductConfigから理論最大TACOSの完全な計算結果を取得
 *
 * @param config - ProductConfig
 * @param profile - 商品プロファイル（オプション）
 * @param globalConfig - グローバルリスク設定（オプション）
 * @returns 理論最大TACOS計算結果
 */
export function calculateTheoreticalMaxTacosFromConfig(
  config: ProductConfig,
  profile?: ProductProfile,
  globalConfig: GlobalRiskConfig = GLOBAL_RISK_CONFIG_DEFAULTS
): TheoreticalMaxTacosResult {
  const marginRateNormal = getMarginRateNormal(config);
  const price = config.price ?? 0;

  // リピート回数の決定（NEW_PRODUCT期間中はprofileのprior値を使用）
  let expectedRepeatOrders: number;
  if (config.isNewProduct && profile) {
    expectedRepeatOrders = profile.expectedRepeatOrdersPrior;
  } else {
    expectedRepeatOrders = config.expectedRepeatOrdersAssumed ??
      profile?.expectedRepeatOrdersAssumed ??
      PRODUCT_CONFIG_DEFAULTS.expectedRepeatOrdersAssumed;
  }

  // LTV安全係数の決定（NEW_PRODUCT期間中はprofileのprior値を使用）
  let ltvSafetyFactor: number;
  if (config.isNewProduct && profile) {
    ltvSafetyFactor = profile.ltvSafetyFactorPrior;
  } else {
    ltvSafetyFactor = config.safetyFactorAssumed ??
      profile?.ltvSafetyFactor ??
      PRODUCT_CONFIG_DEFAULTS.safetyFactorAssumed;
  }

  const maxAdSpendPerUser = calculateMaxAdSpendPerUser(
    price,
    marginRateNormal,
    expectedRepeatOrders,
    ltvSafetyFactor
  );

  const theoreticalMaxTacos = calculateTheoreticalMaxTacos(
    marginRateNormal,
    expectedRepeatOrders,
    ltvSafetyFactor
  );

  const theoreticalMaxTacosCapped = Math.min(
    theoreticalMaxTacos,
    globalConfig.tmaxCapGlobal
  );

  return {
    maxAdSpendPerUser,
    theoreticalMaxTacos,
    theoreticalMaxTacosCapped,
    isCapped: theoreticalMaxTacos > globalConfig.tmaxCapGlobal,
  };
}

// =============================================================================
// TACOSターゲットレンジとゾーン定義
// =============================================================================

/**
 * TACOSゾーン
 *
 * - GREEN: currentTacos ≤ tacosTargetMid（健全）
 * - ORANGE: tacosTargetMid < currentTacos ≤ tacosMax（注意）
 * - RED: currentTacos > tacosMax（危険）
 */
export type TacosZone = "GREEN" | "ORANGE" | "RED";

/**
 * ステージ別TACOS制御パラメータ
 *
 * tacosTargetMidを決定するためのmidFactorと、
 * targetAcos調整のためのtacosAcuityを含む
 */
export interface StageTacosControlParams {
  /**
   * tacosTargetMidを決定するための係数
   * tacosTargetMid = tacosMax × midFactor
   * 例: 0.75 → tacosMaxの75%がtacosTargetMid
   */
  midFactor: number;
  /**
   * TACOS乖離に対するtargetAcosの感度
   * 高いほどTACOS乖離に敏感に反応
   * 例: 1.0 → 10%のTACOS乖離で10%のtargetAcos調整
   */
  tacosAcuity: number;
  /**
   * REDゾーン時のペナルティ係数
   * targetAcos = min(targetAcos, tacosMax × tacosPenaltyFactorRed)
   */
  tacosPenaltyFactorRed: number;
  /**
   * ステージ別ACOS下限
   */
  stageAcosMin: number;
  /**
   * ステージ別ACOS上限
   */
  stageAcosMax: number;
}

/**
 * プロファイル別・ステージ別のTACOS制御パラメータデフォルト値
 */
export const TACOS_CONTROL_PARAMS_DEFAULTS: Record<
  ProductProfileType,
  Record<LifecycleState, StageTacosControlParams>
> = {
  SUPPLEMENT_HIGH_LTV: {
    LAUNCH_HARD: {
      midFactor: 0.70, // 積極的に攻める
      tacosAcuity: 0.8, // 感度やや低め（許容範囲広い）
      tacosPenaltyFactorRed: 0.9,
      stageAcosMin: 0.15,
      stageAcosMax: 0.80,
    },
    LAUNCH_SOFT: {
      midFactor: 0.72,
      tacosAcuity: 0.9,
      tacosPenaltyFactorRed: 0.85,
      stageAcosMin: 0.12,
      stageAcosMax: 0.70,
    },
    GROW: {
      midFactor: 0.75,
      tacosAcuity: 1.0,
      tacosPenaltyFactorRed: 0.8,
      stageAcosMin: 0.10,
      stageAcosMax: 0.60,
    },
    HARVEST: {
      midFactor: 0.80, // 保守的
      tacosAcuity: 1.2, // 感度高め（厳格に管理）
      tacosPenaltyFactorRed: 0.7,
      stageAcosMin: 0.05,
      stageAcosMax: 0.40,
    },
  },
  SUPPLEMENT_STANDARD: {
    LAUNCH_HARD: {
      midFactor: 0.68,
      tacosAcuity: 0.9,
      tacosPenaltyFactorRed: 0.85,
      stageAcosMin: 0.15,
      stageAcosMax: 0.70,
    },
    LAUNCH_SOFT: {
      midFactor: 0.70,
      tacosAcuity: 1.0,
      tacosPenaltyFactorRed: 0.8,
      stageAcosMin: 0.12,
      stageAcosMax: 0.60,
    },
    GROW: {
      midFactor: 0.72,
      tacosAcuity: 1.1,
      tacosPenaltyFactorRed: 0.75,
      stageAcosMin: 0.10,
      stageAcosMax: 0.50,
    },
    HARVEST: {
      midFactor: 0.78,
      tacosAcuity: 1.3,
      tacosPenaltyFactorRed: 0.7,
      stageAcosMin: 0.05,
      stageAcosMax: 0.35,
    },
  },
  SINGLE_PURCHASE: {
    LAUNCH_HARD: {
      midFactor: 0.65,
      tacosAcuity: 1.0,
      tacosPenaltyFactorRed: 0.8,
      stageAcosMin: 0.10,
      stageAcosMax: 0.50,
    },
    LAUNCH_SOFT: {
      midFactor: 0.68,
      tacosAcuity: 1.1,
      tacosPenaltyFactorRed: 0.75,
      stageAcosMin: 0.08,
      stageAcosMax: 0.45,
    },
    GROW: {
      midFactor: 0.70,
      tacosAcuity: 1.2,
      tacosPenaltyFactorRed: 0.7,
      stageAcosMin: 0.06,
      stageAcosMax: 0.35,
    },
    HARVEST: {
      midFactor: 0.75,
      tacosAcuity: 1.4,
      tacosPenaltyFactorRed: 0.65,
      stageAcosMin: 0.04,
      stageAcosMax: 0.25,
    },
  },
  DEFAULT: {
    LAUNCH_HARD: {
      midFactor: 0.68,
      tacosAcuity: 0.9,
      tacosPenaltyFactorRed: 0.85,
      stageAcosMin: 0.12,
      stageAcosMax: 0.65,
    },
    LAUNCH_SOFT: {
      midFactor: 0.70,
      tacosAcuity: 1.0,
      tacosPenaltyFactorRed: 0.8,
      stageAcosMin: 0.10,
      stageAcosMax: 0.55,
    },
    GROW: {
      midFactor: 0.72,
      tacosAcuity: 1.1,
      tacosPenaltyFactorRed: 0.75,
      stageAcosMin: 0.08,
      stageAcosMax: 0.45,
    },
    HARVEST: {
      midFactor: 0.78,
      tacosAcuity: 1.3,
      tacosPenaltyFactorRed: 0.7,
      stageAcosMin: 0.05,
      stageAcosMax: 0.30,
    },
  },
};

/**
 * TACOS制御コンテキスト
 *
 * ライフサイクル判定やtargetAcos調整に渡すための構造化データ
 */
export interface TacosControlContext {
  /**
   * 理論最大TACOS（キャップ後）= tacosMax
   */
  tacosMax: number;
  /**
   * TACOSターゲット中央値
   * tacosTargetMid = tacosMax × midFactor
   */
  tacosTargetMid: number;
  /**
   * 現在のTACOS（直近30日実績）
   */
  currentTacos: number;
  /**
   * 現在のTACOSゾーン
   */
  tacosZone: TacosZone;
  /**
   * TACOS乖離率
   * tacosDelta = (tacosTargetMid - currentTacos) / max(tacosTargetMid, epsilon)
   * 正の値: 余裕あり、負の値: 超過
   */
  tacosDelta: number;
  /**
   * 使用されたステージ別制御パラメータ
   */
  controlParams: StageTacosControlParams;
  /**
   * 成長候補フラグ（ライフサイクル判定用）
   */
  isGrowingCandidate?: boolean;
  /**
   * ORANGEゾーン継続月数
   */
  orangeZoneMonths?: number;
  /**
   * REDゾーン継続月数
   */
  redZoneMonths?: number;
}

/**
 * ステージ別TACOS制御パラメータを取得
 *
 * @param profileType - 商品プロファイルタイプ
 * @param lifecycleState - ライフサイクルステート
 * @returns TACOS制御パラメータ
 */
export function getStageTacosControlParams(
  profileType: ProductProfileType,
  lifecycleState: LifecycleState
): StageTacosControlParams {
  return (
    TACOS_CONTROL_PARAMS_DEFAULTS[profileType]?.[lifecycleState] ??
    TACOS_CONTROL_PARAMS_DEFAULTS.DEFAULT[lifecycleState]
  );
}

/**
 * TACOSゾーンを判定
 *
 * @param currentTacos - 現在のTACOS
 * @param tacosTargetMid - TACOSターゲット中央値
 * @param tacosMax - TACOS最大値（理論最大TACOSキャップ後）
 * @returns TACOSゾーン
 */
export function determineTacosZone(
  currentTacos: number,
  tacosTargetMid: number,
  tacosMax: number
): TacosZone {
  if (currentTacos <= tacosTargetMid) {
    return "GREEN";
  } else if (currentTacos <= tacosMax) {
    return "ORANGE";
  } else {
    return "RED";
  }
}

/**
 * TACOS乖離率を計算
 *
 * tacosDelta = (tacosTargetMid - currentTacos) / max(tacosTargetMid, epsilon)
 *
 * @param currentTacos - 現在のTACOS
 * @param tacosTargetMid - TACOSターゲット中央値
 * @param epsilon - ゼロ除算防止用の最小値（デフォルト: 0.01）
 * @returns TACOS乖離率（正=余裕あり、負=超過）
 */
export function calculateTacosDelta(
  currentTacos: number,
  tacosTargetMid: number,
  epsilon: number = 0.01
): number {
  const denominator = Math.max(tacosTargetMid, epsilon);
  return (tacosTargetMid - currentTacos) / denominator;
}

/**
 * TACOS制御コンテキストを構築
 *
 * @param config - ProductConfig
 * @param profile - 商品プロファイル
 * @param currentTacos - 現在のTACOS（直近30日実績）
 * @param globalConfig - グローバルリスク設定（オプション）
 * @param isGrowingCandidate - 成長候補フラグ（オプション）
 * @returns TACOS制御コンテキスト
 */
export function buildTacosControlContext(
  config: ProductConfig,
  profile: ProductProfile,
  currentTacos: number,
  globalConfig: GlobalRiskConfig = GLOBAL_RISK_CONFIG_DEFAULTS,
  isGrowingCandidate?: boolean
): TacosControlContext {
  // 理論最大TACOSを計算
  const theoreticalResult = calculateTheoreticalMaxTacosFromConfig(
    config,
    profile,
    globalConfig
  );
  const tacosMax = theoreticalResult.theoreticalMaxTacosCapped;

  // ステージ別制御パラメータを取得
  const profileType = config.productProfileType ?? profile.type;
  const controlParams = getStageTacosControlParams(profileType, config.lifecycleState);

  // tacosTargetMidを計算
  const tacosTargetMid = tacosMax * controlParams.midFactor;

  // ゾーン判定
  const tacosZone = determineTacosZone(currentTacos, tacosTargetMid, tacosMax);

  // 乖離率計算
  const tacosDelta = calculateTacosDelta(currentTacos, tacosTargetMid);

  return {
    tacosMax,
    tacosTargetMid,
    currentTacos,
    tacosZone,
    tacosDelta,
    controlParams,
    isGrowingCandidate,
  };
}

// =============================================================================
// TACOS乖離によるtargetAcos調整
// =============================================================================

/**
 * targetAcos調整結果
 */
export interface TargetAcosAdjustmentResult {
  /**
   * ベースLTV ACOS（調整前）
   */
  baseLtvAcos: number;
  /**
   * 調整後の生のtargetAcos（クランプ前）
   */
  rawTargetAcos: number;
  /**
   * 最終targetAcos（クランプ後）
   */
  targetAcos: number;
  /**
   * REDゾーンペナルティが適用されたか
   */
  redPenaltyApplied: boolean;
  /**
   * 適用されたTACOS乖離率
   */
  appliedTacosDelta: number;
  /**
   * 調整に使用されたtacosAcuity
   */
  appliedTacosAcuity: number;
  /**
   * 調整係数（1 + tacosAcuity × tacosDelta）
   */
  adjustmentFactor: number;
  /**
   * 使用されたTACOSゾーン
   */
  tacosZone: TacosZone;
}

/**
 * 数値をクランプする
 *
 * @param value - 入力値
 * @param min - 最小値
 * @param max - 最大値
 * @returns クランプ後の値
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * TACOS乖離に基づいてtargetAcosを調整
 *
 * 計算式:
 * - rawTargetAcos = baseLtvAcos × (1 + tacosAcuity × tacosDelta)
 * - targetAcos = clamp(rawTargetAcos, stageAcosMin, stageAcosMax)
 * - REDゾーン時: targetAcos = min(targetAcos, tacosMax × tacosPenaltyFactorRed)
 *
 * @param baseLtvAcos - ベースLTV ACOS（LTV計算から導出されたACOS）
 * @param tacosContext - TACOS制御コンテキスト
 * @returns targetAcos調整結果
 */
export function adjustTargetAcosByTacos(
  baseLtvAcos: number,
  tacosContext: TacosControlContext
): TargetAcosAdjustmentResult {
  const { tacosDelta, tacosZone, tacosMax, controlParams } = tacosContext;
  const { tacosAcuity, stageAcosMin, stageAcosMax, tacosPenaltyFactorRed } = controlParams;

  // 調整係数を計算
  const adjustmentFactor = 1 + tacosAcuity * tacosDelta;

  // 生のtargetAcosを計算
  const rawTargetAcos = baseLtvAcos * adjustmentFactor;

  // ステージ別のmin/maxでクランプ
  let targetAcos = clamp(rawTargetAcos, stageAcosMin, stageAcosMax);

  // REDゾーンペナルティの適用
  let redPenaltyApplied = false;
  if (tacosZone === "RED") {
    const penaltyLimit = tacosMax * tacosPenaltyFactorRed;
    if (targetAcos > penaltyLimit) {
      targetAcos = penaltyLimit;
      redPenaltyApplied = true;
    }
  }

  return {
    baseLtvAcos,
    rawTargetAcos,
    targetAcos,
    redPenaltyApplied,
    appliedTacosDelta: tacosDelta,
    appliedTacosAcuity: tacosAcuity,
    adjustmentFactor,
    tacosZone,
  };
}

/**
 * ProductConfigとTacosContextからtargetAcosを計算
 *
 * この関数は以下のステップを実行:
 * 1. LTVベースのbaseLtvAcosを計算
 * 2. TACOS乖離に基づいてtargetAcosを調整
 * 3. REDゾーンペナルティを適用
 *
 * @param config - ProductConfig
 * @param profile - 商品プロファイル
 * @param tacosContext - TACOS制御コンテキスト
 * @returns targetAcos調整結果
 */
export function calculateTargetAcosWithTacosAdjustment(
  config: ProductConfig,
  profile: ProductProfile,
  tacosContext: TacosControlContext
): TargetAcosAdjustmentResult {
  // baseLtvAcosの計算
  // baseLtvAcos = marginRateNormal × (1 + expectedRepeatOrders) × ltvSafetyFactor
  // これは理論最大TACOSと同じ計算式
  const marginRateNormal = getMarginRateNormal(config);

  let expectedRepeatOrders: number;
  if (config.isNewProduct) {
    expectedRepeatOrders = profile.expectedRepeatOrdersPrior;
  } else {
    expectedRepeatOrders = config.expectedRepeatOrdersAssumed ??
      profile.expectedRepeatOrdersAssumed;
  }

  let ltvSafetyFactor: number;
  if (config.isNewProduct) {
    ltvSafetyFactor = profile.ltvSafetyFactorPrior;
  } else {
    ltvSafetyFactor = config.safetyFactorAssumed ?? profile.ltvSafetyFactor;
  }

  const baseLtvAcos = marginRateNormal * (1 + expectedRepeatOrders) * ltvSafetyFactor;

  // TACOS乖離に基づいて調整
  return adjustTargetAcosByTacos(baseLtvAcos, tacosContext);
}

// =============================================================================
// ライフサイクルとの連動ポイント
// =============================================================================

/**
 * ライフサイクル別TACOSゾーン許容設定
 */
export interface LifecycleTacosZoneTolerance {
  /** ORANGEゾーンを許容するか */
  tolerateOrange: boolean;
  /** REDゾーンを許容するか */
  tolerateRed: boolean;
  /** ORANGEゾーンでREDに移行するまでの許容月数 */
  orangeToleranceMonths: number;
  /** REDゾーン許容月数（isGrowingCandidate=trueの場合のみ有効） */
  redToleranceMonthsForGrowth: number;
}

/**
 * ライフサイクル別のTACOSゾーン許容設定
 */
export const LIFECYCLE_TACOS_ZONE_TOLERANCE: Record<
  LifecycleState,
  LifecycleTacosZoneTolerance
> = {
  LAUNCH_HARD: {
    tolerateOrange: true,
    tolerateRed: true, // isGrowingCandidate=trueの場合のみ
    orangeToleranceMonths: 3,
    redToleranceMonthsForGrowth: 2,
  },
  LAUNCH_SOFT: {
    tolerateOrange: true,
    tolerateRed: false,
    orangeToleranceMonths: 2,
    redToleranceMonthsForGrowth: 1,
  },
  GROW: {
    tolerateOrange: true, // 一時的には許容
    tolerateRed: false,
    orangeToleranceMonths: 1,
    redToleranceMonthsForGrowth: 0,
  },
  HARVEST: {
    tolerateOrange: false, // ORANGEも許容しない
    tolerateRed: false,
    orangeToleranceMonths: 0,
    redToleranceMonthsForGrowth: 0,
  },
};

/**
 * TACOSベースのライフサイクル判定結果
 */
export interface TacosLifecycleJudgment {
  /** 現在のライフサイクルステート */
  currentState: LifecycleState;
  /** 推奨されるライフサイクルステート */
  recommendedState: LifecycleState;
  /** ライフサイクル変更が推奨されるか */
  stateChangeRecommended: boolean;
  /** 入札削減が推奨されるか */
  bidReductionRecommended: boolean;
  /** 入札停止が推奨されるか */
  bidStopRecommended: boolean;
  /** targetAcos引き締めが推奨されるか */
  targetAcosTighteningRecommended: boolean;
  /** 判定理由 */
  reasons: string[];
  /** 警告メッセージ */
  warnings: string[];
}

/**
 * TACOSゾーンに基づいてライフサイクル判定を行う
 *
 * @param tacosContext - TACOS制御コンテキスト
 * @param currentState - 現在のライフサイクルステート
 * @returns ライフサイクル判定結果
 */
export function judgeTacosBasedLifecycle(
  tacosContext: TacosControlContext,
  currentState: LifecycleState
): TacosLifecycleJudgment {
  const {
    tacosZone,
    isGrowingCandidate = false,
    orangeZoneMonths = 0,
    redZoneMonths = 0,
  } = tacosContext;

  const tolerance = LIFECYCLE_TACOS_ZONE_TOLERANCE[currentState];
  const reasons: string[] = [];
  const warnings: string[] = [];
  let recommendedState = currentState;
  let stateChangeRecommended = false;
  let bidReductionRecommended = false;
  let bidStopRecommended = false;
  let targetAcosTighteningRecommended = false;

  // ===== LAUNCH_HARD の判定 =====
  if (currentState === "LAUNCH_HARD") {
    if (tacosZone === "GREEN") {
      reasons.push("GREENゾーン: 健全な状態、LAUNCH_HARD継続");
    } else if (tacosZone === "ORANGE") {
      if (orangeZoneMonths <= tolerance.orangeToleranceMonths) {
        reasons.push(`ORANGEゾーン: ${orangeZoneMonths}ヶ月目、許容範囲内（${tolerance.orangeToleranceMonths}ヶ月まで）`);
      } else {
        targetAcosTighteningRecommended = true;
        warnings.push(`ORANGEゾーン継続${orangeZoneMonths}ヶ月: targetAcos引き締め推奨`);
        recommendedState = "LAUNCH_SOFT";
        stateChangeRecommended = true;
      }
    } else if (tacosZone === "RED") {
      if (isGrowingCandidate && redZoneMonths <= tolerance.redToleranceMonthsForGrowth) {
        warnings.push(`REDゾーン: ${redZoneMonths}ヶ月目、成長候補のため許容（${tolerance.redToleranceMonthsForGrowth}ヶ月まで）`);
        targetAcosTighteningRecommended = true;
      } else {
        warnings.push("REDゾーン: 即座にtargetAcos引き締め、LAUNCH_SOFT移行推奨");
        recommendedState = "LAUNCH_SOFT";
        stateChangeRecommended = true;
        targetAcosTighteningRecommended = true;
      }
    }
  }

  // ===== LAUNCH_SOFT の判定 =====
  else if (currentState === "LAUNCH_SOFT") {
    if (tacosZone === "GREEN") {
      reasons.push("GREENゾーン: 健全な状態、LAUNCH_SOFT継続");
    } else if (tacosZone === "ORANGE") {
      if (orangeZoneMonths <= tolerance.orangeToleranceMonths) {
        warnings.push(`ORANGEゾーン: ${orangeZoneMonths}ヶ月目、許容範囲内（${tolerance.orangeToleranceMonths}ヶ月まで）`);
      } else {
        targetAcosTighteningRecommended = true;
        warnings.push(`ORANGEゾーン継続${orangeZoneMonths}ヶ月: targetAcos引き締め、GROW移行推奨`);
        recommendedState = "GROW";
        stateChangeRecommended = true;
      }
    } else if (tacosZone === "RED") {
      warnings.push("REDゾーン: 即座にtargetAcos引き締め、GROW移行推奨");
      recommendedState = "GROW";
      stateChangeRecommended = true;
      targetAcosTighteningRecommended = true;
      bidReductionRecommended = true;
    }
  }

  // ===== GROW の判定 =====
  else if (currentState === "GROW") {
    if (tacosZone === "GREEN") {
      reasons.push("GREENゾーン: 健全な状態、GROW継続");
    } else if (tacosZone === "ORANGE") {
      if (orangeZoneMonths <= tolerance.orangeToleranceMonths) {
        warnings.push(`ORANGEゾーン: ${orangeZoneMonths}ヶ月目、一時的に許容（${tolerance.orangeToleranceMonths}ヶ月まで）`);
        targetAcosTighteningRecommended = true;
      } else {
        warnings.push(`ORANGEゾーン継続${orangeZoneMonths}ヶ月: targetAcos引き締め、入札削減推奨`);
        targetAcosTighteningRecommended = true;
        bidReductionRecommended = true;
      }
    } else if (tacosZone === "RED") {
      warnings.push("REDゾーン: targetAcos引き締め、入札削減、HARVEST移行検討");
      recommendedState = "HARVEST";
      stateChangeRecommended = true;
      targetAcosTighteningRecommended = true;
      bidReductionRecommended = true;
    }
  }

  // ===== HARVEST の判定 =====
  else if (currentState === "HARVEST") {
    if (tacosZone === "GREEN") {
      reasons.push("GREENゾーン: 健全な状態、HARVEST継続");
    } else if (tacosZone === "ORANGE") {
      warnings.push("ORANGEゾーン: HARVESTでは許容しない、入札削減推奨");
      bidReductionRecommended = true;
      targetAcosTighteningRecommended = true;
    } else if (tacosZone === "RED") {
      warnings.push("REDゾーン: 入札停止フラグ推奨");
      bidStopRecommended = true;
      bidReductionRecommended = true;
      targetAcosTighteningRecommended = true;
    }
  }

  return {
    currentState,
    recommendedState,
    stateChangeRecommended,
    bidReductionRecommended,
    bidStopRecommended,
    targetAcosTighteningRecommended,
    reasons,
    warnings,
  };
}

/**
 * 入札制御アクション
 */
export interface BidControlAction {
  /** 入札乗数の調整率（1.0 = 変更なし、< 1.0 = 削減） */
  bidMultiplierAdjustment: number;
  /** 入札停止フラグ */
  stopBidding: boolean;
  /** targetAcosの一時的な調整率（< 1.0 = 引き締め） */
  targetAcosAdjustment: number;
  /** 理由 */
  reason: string;
}

/**
 * ライフサイクル判定結果に基づいて入札制御アクションを決定
 *
 * @param judgment - ライフサイクル判定結果
 * @param tacosContext - TACOS制御コンテキスト
 * @returns 入札制御アクション
 */
export function determineBidControlAction(
  judgment: TacosLifecycleJudgment,
  tacosContext: TacosControlContext
): BidControlAction {
  let bidMultiplierAdjustment = 1.0;
  let targetAcosAdjustment = 1.0;
  let stopBidding = false;
  const reasons: string[] = [];

  // 入札停止の判定
  if (judgment.bidStopRecommended) {
    stopBidding = true;
    bidMultiplierAdjustment = 0;
    reasons.push("入札停止推奨");
  }
  // 入札削減の判定
  else if (judgment.bidReductionRecommended) {
    // ORANGEゾーンでは10%削減、REDゾーンでは20%削減
    if (tacosContext.tacosZone === "RED") {
      bidMultiplierAdjustment = 0.8;
      reasons.push("REDゾーン: 入札20%削減");
    } else if (tacosContext.tacosZone === "ORANGE") {
      bidMultiplierAdjustment = 0.9;
      reasons.push("ORANGEゾーン: 入札10%削減");
    }
  }

  // targetAcos引き締めの判定
  if (judgment.targetAcosTighteningRecommended && !stopBidding) {
    // TacosDeltaが負（超過）の場合、その程度に応じて引き締め
    const delta = tacosContext.tacosDelta;
    if (delta < 0) {
      // 超過率に応じて5-20%引き締め
      const tighteningRate = Math.min(Math.abs(delta) * 0.5, 0.2);
      targetAcosAdjustment = 1 - tighteningRate;
      reasons.push(`targetAcos ${(tighteningRate * 100).toFixed(0)}%引き締め`);
    }
  }

  return {
    bidMultiplierAdjustment,
    stopBidding,
    targetAcosAdjustment,
    reason: reasons.join("; ") || "調整なし",
  };
}

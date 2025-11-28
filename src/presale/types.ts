/**
 * プレセール診断 - 型定義
 *
 * Amazon広告の「先行セール（プレセール）」期間を診断し、
 * 「売れるプレセール」と「買い控えプレセール」を数値で判定する機能。
 *
 * プレセールのタイプに応じて、防御ロジック（DOWN/STOP/NEG）と
 * 攻めロジック（UP/STRONG_UP）の挙動を切り替える。
 */

// =============================================================================
// セールフェーズ（SalePhase）
// =============================================================================

/**
 * セールフェーズ
 *
 * - NORMAL: 通常日（セール期間外）
 * - PRE_SALE: プレセール期間（セール3-7日前程度）
 * - MAIN_SALE: 本番セール期間
 * - COOL_DOWN: クールダウン期間（セール直後）
 */
export type SalePhase = "NORMAL" | "PRE_SALE" | "MAIN_SALE" | "COOL_DOWN";

/**
 * 有効なSalePhaseの配列（バリデーション用）
 */
export const VALID_SALE_PHASES: readonly SalePhase[] = [
  "NORMAL",
  "PRE_SALE",
  "MAIN_SALE",
  "COOL_DOWN",
] as const;

/**
 * SalePhaseのバリデーション
 */
export function isValidSalePhase(value: unknown): value is SalePhase {
  return (
    typeof value === "string" && VALID_SALE_PHASES.includes(value as SalePhase)
  );
}

// =============================================================================
// プレセールタイプ（PresaleType）
// =============================================================================

/**
 * プレセールタイプ
 *
 * - NONE: セール期間外（診断対象外）
 * - BUYING: 売れるプレセール（CVR維持、ACOSも悪化していない）
 * - HOLD_BACK: 買い控えプレセール（CVR悪化、ACOS悪化）
 * - MIXED: グレーゾーン（判定が難しい、またはデータ不足）
 */
export type PresaleType = "NONE" | "BUYING" | "HOLD_BACK" | "MIXED";

/**
 * 有効なPresaleTypeの配列（バリデーション用）
 */
export const VALID_PRESALE_TYPES: readonly PresaleType[] = [
  "NONE",
  "BUYING",
  "HOLD_BACK",
  "MIXED",
] as const;

/**
 * PresaleTypeのバリデーション
 */
export function isValidPresaleType(value: unknown): value is PresaleType {
  return (
    typeof value === "string" && VALID_PRESALE_TYPES.includes(value as PresaleType)
  );
}

// =============================================================================
// 期間メトリクス
// =============================================================================

/**
 * 期間別パフォーマンスメトリクス
 *
 * baseline（通常日）とpresale（プレセール期間）の両方で使用
 */
export interface PresalePeriodMetrics {
  /** クリック数 */
  clicks: number;
  /** コスト（広告費） */
  cost: number;
  /** コンバージョン数 */
  conversions: number;
  /** 売上（オプション） */
  revenue?: number;
}

/**
 * プレセール診断の入力データ
 */
export interface PresaleDiagnosisInput {
  /** 通常日の集計（baselineDays分） */
  baseline: PresalePeriodMetrics;
  /** プレセール期間の集計（presaleWindowDays分） */
  presale: PresalePeriodMetrics;
}

// =============================================================================
// プレセール診断結果
// =============================================================================

/**
 * プレセール診断結果
 */
export interface PresaleDiagnosis {
  /** 診断されたプレセールタイプ */
  type: PresaleType;

  /** 通常日のCVR（クリックが0の場合はnull） */
  baselineCvr: number | null;

  /** プレセール期間のCVR（クリックが0の場合はnull） */
  presaleCvr: number | null;

  /** 通常日のACOS（売上が0の場合はnull） */
  baselineAcos: number | null;

  /** プレセール期間のACOS（売上が0の場合はnull） */
  presaleAcos: number | null;

  /**
   * CVR比率（presaleCvr / baselineCvr）
   *
   * - > 1.0: プレセールでCVRが向上
   * - < 1.0: プレセールでCVRが悪化
   * - null: 計算不可（データ不足）
   */
  cvrRatio: number | null;

  /**
   * ACOS比率（presaleAcos / baselineAcos）
   *
   * - > 1.0: プレセールでACOSが悪化（コスト効率低下）
   * - < 1.0: プレセールでACOSが改善（コスト効率向上）
   * - null: 計算不可（データ不足）
   */
  acosRatio: number | null;

  /** 診断理由の説明 */
  reason: string;
}

// =============================================================================
// セールコンテキスト設定
// =============================================================================

/**
 * セールコンテキスト設定
 *
 * セールフェーズの判定や診断に使用するパラメータ
 */
export interface SaleContextConfig {
  /** 現在のセールフェーズ */
  salePhase: SalePhase;

  /** 基準となる通常日期間の長さ（日数） */
  baselineDays: number;

  /** プレセールとみなす日数 */
  presaleWindowDays: number;

  /** 診断に必要な最小クリック数（baseline） */
  baselineMinClicks: number;

  /** 診断に必要な最小クリック数（presale） */
  presaleMinClicks: number;
}

/**
 * デフォルトのセールコンテキスト設定
 */
export const DEFAULT_SALE_CONTEXT_CONFIG: SaleContextConfig = {
  salePhase: "NORMAL",
  baselineDays: 30,
  presaleWindowDays: 5,
  baselineMinClicks: 20,
  presaleMinClicks: 10,
};

// =============================================================================
// プレセール診断閾値設定
// =============================================================================

/**
 * プレセール診断の閾値設定
 */
export interface PresaleThresholdConfig {
  /**
   * 売れるプレセール判定: 最小CVR比率
   * CVR比率がこの値以上なら「売れるプレセール」候補
   * 例: 0.9 = プレセールでCVRが通常日の90%以上を維持
   */
  minCvrRatioForBuying: number;

  /**
   * 売れるプレセール判定: 最大ACOS比率
   * ACOS比率がこの値以下なら「売れるプレセール」候補
   * 例: 1.2 = プレセールでACOSが通常日の120%以下
   */
  maxAcosRatioForBuying: number;

  /**
   * 買い控えプレセール判定: 最大CVR比率
   * CVR比率がこの値以下なら「買い控えプレセール」候補
   * 例: 0.6 = プレセールでCVRが通常日の60%以下に低下
   */
  maxCvrRatioForHoldBack: number;

  /**
   * 買い控えプレセール判定: 最小ACOS比率
   * ACOS比率がこの値以上なら「買い控えプレセール」候補
   * 例: 1.3 = プレセールでACOSが通常日の130%以上に悪化
   */
  minAcosRatioForHoldBack: number;
}

/**
 * デフォルトのプレセール診断閾値
 */
export const DEFAULT_PRESALE_THRESHOLD_CONFIG: PresaleThresholdConfig = {
  minCvrRatioForBuying: 0.9,
  maxAcosRatioForBuying: 1.2,
  maxCvrRatioForHoldBack: 0.6,
  minAcosRatioForHoldBack: 1.3,
};

// =============================================================================
// プレセール対応ポリシー
// =============================================================================

/**
 * プレセールタイプ別の入札ポリシー
 */
export interface PresaleBidPolicy {
  /**
   * STOP/NEGを許可するか
   * falseの場合、プレセール期間中は新規STOP/NEGを発動しない
   */
  allowStopNeg: boolean;

  /**
   * STRONG_DOWNを許可するか
   * falseの場合、STRONG_DOWNはMILD_DOWNに緩和される
   */
  allowStrongDown: boolean;

  /**
   * DOWNを許可するか
   * falseの場合、ダウン系アクションは全てKEEPに変換される
   */
  allowDown: boolean;

  /**
   * DOWN時の最大変動幅（%）
   * 通常は-15%まで、HOLD_BACK時は-5〜-10%に制限
   */
  maxDownPercent: number;

  /**
   * STRONG_UPを許可するか
   */
  allowStrongUp: boolean;

  /**
   * UP時の最大変動幅の倍率
   * 例: 1.3 = 現在の入札額の130%まで
   */
  maxUpMultiplier: number;

  /**
   * baselineデータを判断の主軸とするか
   * trueの場合、presaleデータは補助情報として扱う
   */
  useBaselineAsPrimary: boolean;
}

/**
 * プレセールタイプ別のデフォルトポリシー
 */
export const DEFAULT_PRESALE_POLICIES: Record<PresaleType, PresaleBidPolicy> = {
  // NONEはプレセール期間外なので、通常の判定ロジックを適用
  NONE: {
    allowStopNeg: true,
    allowStrongDown: true,
    allowDown: true,
    maxDownPercent: 15,
    allowStrongUp: true,
    maxUpMultiplier: 1.3,
    useBaselineAsPrimary: false,
  },

  // BUYINGは売れるプレセール - ほぼ通常時と同様だが、攻めは少し控えめに
  BUYING: {
    allowStopNeg: true,
    allowStrongDown: true,
    allowDown: true,
    maxDownPercent: 15,
    allowStrongUp: true,
    maxUpMultiplier: 1.25, // MAIN_SALEに余地を残す
    useBaselineAsPrimary: false,
  },

  // HOLD_BACKは買い控えプレセール - 防御を大幅に抑制
  HOLD_BACK: {
    allowStopNeg: false,        // STOP/NEG禁止
    allowStrongDown: false,     // STRONG_DOWN禁止
    allowDown: true,            // DOWNは条件付きで許可
    maxDownPercent: 7,          // DOWN幅を制限（-7%まで）
    allowStrongUp: false,       // STRONG_UP禁止
    maxUpMultiplier: 1.1,       // UPも控えめに
    useBaselineAsPrimary: true, // baselineデータを主軸に
  },

  // MIXEDはグレーゾーン - 中間的な設定
  MIXED: {
    allowStopNeg: false,        // STOP/NEG禁止
    allowStrongDown: false,     // STRONG_DOWN禁止
    allowDown: true,            // DOWNは許可
    maxDownPercent: 10,         // DOWN幅をやや制限
    allowStrongUp: false,       // STRONG_UP禁止
    maxUpMultiplier: 1.15,      // UPはやや控えめに
    useBaselineAsPrimary: true, // baselineデータを主軸に
  },
};

// =============================================================================
// ユーティリティ型
// =============================================================================

/**
 * プレセール診断コンテキスト
 *
 * compute_bid_recommendations内で参照される、
 * プレセール診断の結果とポリシーをまとめたコンテキスト
 */
export interface PresaleContext {
  /** セールフェーズ */
  salePhase: SalePhase;

  /** プレセール診断結果 */
  diagnosis: PresaleDiagnosis;

  /** 適用するポリシー */
  policy: PresaleBidPolicy;
}

/**
 * プレセール診断のスキップ理由
 */
export type PresaleDiagnosisSkipReason =
  | "NOT_PRESALE_PHASE"         // PRE_SALEフェーズではない
  | "BASELINE_CLICKS_INSUFFICIENT"  // baselineのクリック不足
  | "PRESALE_CLICKS_INSUFFICIENT"   // presaleのクリック不足
  | "BASELINE_CVR_ZERO"         // baselineのCVRがゼロ
  | "PRESALE_CVR_ZERO"          // presaleのCVRがゼロ
  | "DATA_UNAVAILABLE";         // データが利用不可

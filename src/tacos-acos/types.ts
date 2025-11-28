/**
 * TACOS-ACOS統合モジュール - 型定義
 *
 * T_opt と T_stage を用いたTACOSモデルをLTVモデルと統合し、
 * 理論最大CPCガードとセール専用expectedCvrロジックを提供する。
 */

import { LifecycleState } from "../config/productConfigTypes";

// =============================================================================
// SalePhase 定義
// =============================================================================

/**
 * セールフェーズ
 *
 * - NORMAL: 通常日
 * - PRE_SALE: セール準備期間（セール前2-3日）
 * - MAIN_SALE: セール本番中
 * - COOL_DOWN: セール終了後のクールダウン期間
 */
export type SalePhase = "NORMAL" | "PRE_SALE" | "MAIN_SALE" | "COOL_DOWN";

/**
 * 有効なSalePhaseの配列
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
// ターゲットACOS計算コンテキスト
// =============================================================================

/**
 * ターゲットACOS計算に必要なコンテキスト情報
 */
export interface TargetAcosContext {
  // ----- ASIN レベルのパラメータ -----
  /** ポテンシャル粗利率 g = marginPotential_product */
  marginPotential: number;

  /** 利益最大化TACOS T_opt */
  tOpt: number;

  /** ローンチ期TACOS目標 T_launch */
  tLaunch: number;

  /** グロー期TACOS目標 T_grow */
  tGrow: number;

  /** ハーベスト期TACOS目標 T_harvest */
  tHarvest: number;

  /** 現在のライフサイクルステージ */
  lifecycleStage: LifecycleState;

  /** 現在のセールフェーズ */
  salePhase: SalePhase;

  // ----- 集計指標 -----
  /** 直近30日の全売上額（円） */
  salesTotal30d: number;

  /** 直近30日の広告経由売上額（円） */
  adSales30d: number;

  // ----- LTV関連 -----
  /** LTVモデルから計算されたベースターゲットACOS */
  baseLtvAcos: number;

  /** LTV観点でのACOS上限（設定がなければ null） */
  ltvHardCap: number | null;
}

// =============================================================================
// ターゲットACOS計算設定
// =============================================================================

/**
 * ターゲットACOS計算の設定
 */
export interface TargetAcosConfig {
  // ----- セール時TACOS乗数 -----
  /**
   * MAIN_SALE時のTACOS乗数
   * T_stage_smode = stageTacos × sModeTacosMultiplier
   */
  sModeTacosMultiplier: number;

  // ----- 広告売上シェア設定 -----
  /** salesTotal が小さい場合に使用するデフォルト広告売上シェア */
  adSalesShareDefault: number;

  /** 広告売上シェアの最小値 */
  adSalesShareMin: number;

  /** 広告売上シェア計算で salesTotal が有効とみなす最小額（円） */
  salesTotalMinThreshold: number;

  // ----- LTVステージ別係数 -----
  /** LAUNCH期のLTV ACOS乗数 */
  ltvLaunchFactor: number;

  /** GROW期のLTV ACOS乗数 */
  ltvGrowFactor: number;

  /** HARVEST期のLTV ACOS乗数 */
  ltvHarvestFactor: number;

  // ----- グローバルACOS制限 -----
  /** グローバルACOS下限 */
  globalAcosMin: number;

  /** グローバルACOS上限 */
  globalAcosMax: number;
}

/**
 * デフォルトのターゲットACOS計算設定
 */
export const DEFAULT_TARGET_ACOS_CONFIG: TargetAcosConfig = {
  sModeTacosMultiplier: 1.3,
  adSalesShareDefault: 0.3,
  adSalesShareMin: 0.1,
  salesTotalMinThreshold: 100000, // 10万円
  ltvLaunchFactor: 1.1,
  ltvGrowFactor: 1.0,
  ltvHarvestFactor: 0.9,
  globalAcosMin: 0.05,
  globalAcosMax: 0.80,
};

// =============================================================================
// ターゲットACOS計算結果
// =============================================================================

/**
 * ターゲットACOS計算結果
 */
export interface TargetAcosResult {
  /** 最終ターゲットACOS */
  finalTargetAcos: number;

  /** TACOSモデルから算出されたACOS */
  targetAcosFromTacos: number;

  /** LTVモデルから算出されたACOS */
  targetAcosFromLtv: number;

  /** 計算に使用したT_stage */
  tStageUsed: number;

  /** 計算に使用した広告売上シェア */
  adSalesShareUsed: number;

  /** TACOSモデルが採用されたか（false = LTVモデル採用） */
  tacosModelSelected: boolean;

  /** 計算詳細 */
  breakdown: TargetAcosBreakdown;
}

/**
 * ターゲットACOS計算の内訳詳細
 */
export interface TargetAcosBreakdown {
  /** ライフサイクルに対応する基本TACOS（T_launch/T_grow/T_harvest） */
  stageTacos: number;

  /** セールモード適用後のTACOS */
  tStageSmode: number;

  /** 最終的に使用されたT_stage */
  tStageUsedFinal: number;

  /** 生の広告売上シェア（計算前） */
  rawAdSalesShare: number;

  /** 適用された広告売上シェア */
  effectiveAdSalesShare: number;

  /** LTV調整前のACOS */
  baseLtvAcosInput: number;

  /** ステージ係数適用後のLTV ACOS */
  adjustedLtvAcos: number;

  /** ltvHardCap 適用後のLTV ACOS */
  cappedLtvAcos: number;

  /** グローバル制限適用前のACOS */
  preClipAcos: number;

  /** クリップが適用されたか */
  wasClipped: boolean;
}

// =============================================================================
// 理論最大CPC設定
// =============================================================================

/**
 * 理論最大CPC計算の設定
 */
export interface TheoreticalMaxCpcConfig {
  /** CPC安全係数（理論値に対するマージン） */
  cpcSafetyFactor: number;

  /** セール時CPC上昇上限（通常時理論CPCに対する倍率） */
  cpcUpliftCap: number;
}

/**
 * デフォルトの理論最大CPC設定
 */
export const DEFAULT_THEORETICAL_MAX_CPC_CONFIG: TheoreticalMaxCpcConfig = {
  cpcSafetyFactor: 1.15,
  cpcUpliftCap: 2.0,
};

// =============================================================================
// 理論最大CPC計算結果
// =============================================================================

/**
 * 理論最大CPC計算の入力
 */
export interface TheoreticalMaxCpcInput {
  /** 商品価格（円） */
  price: number;

  /** 通常時のT_stage */
  tStageNormal: number;

  /** 通常時の期待CVR */
  expectedCvrNormal: number;

  /** 現在のセールフェーズ */
  salePhase: SalePhase;

  /** セールモード適用後のT_stage（MAIN_SALE時） */
  tStageSmode?: number;

  /** セール時の期待CVR（MAIN_SALE時） */
  expectedCvrSale?: number;
}

/**
 * 理論最大CPC計算結果
 */
export interface TheoreticalMaxCpcResult {
  /** 現在フェーズでの理論最大CPC */
  theoreticalMaxCpc: number;

  /** 通常時の理論最大CPC */
  theoreticalMaxCpcNormal: number;

  /** 上限クリップが適用されたか */
  wasUpliftCapped: boolean;

  /** 計算詳細 */
  breakdown: TheoreticalMaxCpcBreakdown;
}

/**
 * 理論最大CPC計算の内訳
 */
export interface TheoreticalMaxCpcBreakdown {
  /** 計算に使用した価格 */
  price: number;

  /** 計算に使用したT_stage */
  tStageUsed: number;

  /** 計算に使用した期待CVR */
  expectedCvrUsed: number;

  /** 安全係数適用前のCPC */
  maxCpcHard: number;

  /** 安全係数適用後のCPC */
  maxCpcWithSafety: number;

  /** セール上限適用前のCPC（セール時のみ） */
  preCappedCpc: number | null;
}

// =============================================================================
// セール用期待CVR設定
// =============================================================================

/**
 * 時間帯別アップリフトの区間定義
 */
export interface UpliftScheduleBand {
  /** 開始時間（セール開始からの経過時間、時間単位） */
  startHour: number;

  /** 終了時間（セール開始からの経過時間、時間単位） */
  endHour: number;

  /** この区間でのアップリフト倍率 */
  uplift: number;
}

/**
 * セール用期待CVR計算の設定
 */
export interface SaleExpectedCvrConfig {
  /** 時間帯別アップリフトスケジュール */
  upliftSchedule: UpliftScheduleBand[];

  /** 最大アップリフト（事前期待・最終結果の両方に適用） */
  maxUplift: number;

  /** セール中実績CVRの信頼度計算に使用する基本クリック数 */
  baseClicksSale: number;

  /** w_liveの最小値（セール特有の挙動を考慮した下限） */
  wMinSale: number;

  /** セール全体の継続時間（時間単位、終了前判定に使用） */
  saleDurationHours: number;
}

/**
 * デフォルトのセール用期待CVR設定
 *
 * Amazonビッグセールの典型的なパターン：
 * - 開始直後（0-2時間）: CVR 1.8倍
 * - 序盤（2-12時間）: CVR 1.3倍
 * - 中盤（12時間〜終了5時間前）: CVR 1.1倍
 * - 終了間際（終了前5時間）: CVR 1.7倍
 */
export const DEFAULT_SALE_EXPECTED_CVR_CONFIG: SaleExpectedCvrConfig = {
  upliftSchedule: [
    { startHour: 0, endHour: 2, uplift: 1.8 },
    { startHour: 2, endHour: 12, uplift: 1.3 },
    { startHour: 12, endHour: 43, uplift: 1.1 }, // 終了5時間前（48-5=43）まで
    { startHour: 43, endHour: 48, uplift: 1.7 }, // 終了前5時間
  ],
  maxUplift: 2.5,
  baseClicksSale: 50,
  wMinSale: 0.3,
  saleDurationHours: 48,
};

// =============================================================================
// セール用期待CVR計算入力・結果
// =============================================================================

/**
 * セール用期待CVR計算の入力
 */
export interface SaleExpectedCvrInput {
  /** 通常時の期待CVR */
  expectedCvrNormal: number;

  /** セール開始からの経過時間（時間単位） */
  hoursSinceMainSaleStart: number;

  /** セール中の実績クリック数 */
  clicksSale: number;

  /** セール中の実績CVR（観測値） */
  cvrObservedSale: number;
}

/**
 * セール用期待CVR計算結果
 */
export interface SaleExpectedCvrResult {
  /** 最終的なセール用期待CVR */
  expectedCvrSale: number;

  /** 計算詳細 */
  breakdown: SaleExpectedCvrBreakdown;
}

/**
 * セール用期待CVR計算の内訳
 */
export interface SaleExpectedCvrBreakdown {
  /** 通常時期待CVR */
  expectedCvrNormal: number;

  /** 時間帯別アップリフト値 */
  upliftScheduleValue: number;

  /** 事前期待CVR（クリップ前） */
  expectedCvrSalePriorRaw: number;

  /** 事前期待CVR（maxUplift適用後） */
  expectedCvrSalePrior: number;

  /** 生のw_live値 */
  wLiveRaw: number;

  /** クリップ後のw_live値 */
  wLiveClipped: number;

  /** 最終的に使用されたw_live値 */
  wLiveFinal: number;

  /** ブレンド後のCVR（クリップ前） */
  blendedCvrRaw: number;

  /** 最大アップリフト制限が適用されたか */
  wasMaxUpliftApplied: boolean;
}

// =============================================================================
// 入札ガード適用結果
// =============================================================================

/**
 * 理論最大CPCによる入札ガード適用結果
 */
export interface CpcGuardResult {
  /** ガード適用後の入札額 */
  cappedBid: number;

  /** 元の推奨入札額 */
  originalBid: number;

  /** ガードが適用されたか */
  wasCapped: boolean;

  /** 使用した理論最大CPC */
  theoreticalMaxCpc: number;

  /** クリップ理由（適用された場合） */
  capReason: string | null;
}

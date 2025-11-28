/**
 * TACOS-ACOS統合モジュール
 *
 * T_opt と T_stage を用いたTACOSモデルをLTVモデルと統合し、
 * 理論最大CPCガードとセール専用expectedCvrロジックを提供する。
 *
 * 主な機能:
 * 1. ターゲットACOS計算（TACOSモデル × LTVモデル統合）
 * 2. 理論最大CPCガード
 * 3. セール用期待CVR計算
 */

// =============================================================================
// 型定義
// =============================================================================

export {
  // SalePhase
  SalePhase,
  VALID_SALE_PHASES,
  isValidSalePhase,

  // ターゲットACOS
  TargetAcosContext,
  TargetAcosConfig,
  DEFAULT_TARGET_ACOS_CONFIG,
  TargetAcosResult,
  TargetAcosBreakdown,

  // 理論最大CPC
  TheoreticalMaxCpcConfig,
  DEFAULT_THEORETICAL_MAX_CPC_CONFIG,
  TheoreticalMaxCpcInput,
  TheoreticalMaxCpcResult,
  TheoreticalMaxCpcBreakdown,
  CpcGuardResult,

  // セール用期待CVR
  UpliftScheduleBand,
  SaleExpectedCvrConfig,
  DEFAULT_SALE_EXPECTED_CVR_CONFIG,
  SaleExpectedCvrInput,
  SaleExpectedCvrResult,
  SaleExpectedCvrBreakdown,
} from "./types";

// =============================================================================
// ターゲットACOS計算
// =============================================================================

export {
  // T_stage決定
  getStageTacos,
  computeTStageWithSalePhase,

  // 広告売上シェア計算
  computeAdSalesShare,
  convertTacosToAcos,

  // LTV ACOS調整
  getLtvStageFactor,
  computeTargetAcosFromLtv,

  // 統合ターゲットACOS計算
  computeIntegratedTargetAcos,

  // ユーティリティ
  buildTStageParams,
  computeTargetAcosSimple,
} from "./target-acos-calculator";

// =============================================================================
// 理論最大CPC
// =============================================================================

export {
  // CPC計算
  computeMaxCpcHard,
  computeTheoreticalMaxCpc,

  // ガード適用
  applyCpcGuard,
  applyTheoreticalMaxCpcGuard,

  // ユーティリティ
  computeBreakEvenCpc,
  computeCpcUtilization,
  computeCpcHeadroom,
  computeTheoreticalMaxCpcSimple,
  isBidWithinTheoreticalLimit,
} from "./theoretical-max-cpc";

// =============================================================================
// セール用期待CVR
// =============================================================================

export {
  // アップリフト計算
  getUpliftScheduleValue,
  getUpliftScheduleValueInterpolated,

  // w_live計算
  computeWLive,

  // セール用期待CVR計算
  computeExpectedCvrSale,
  getExpectedCvrForPhase,

  // ユーティリティ
  validateUpliftSchedule,
  isNearSaleEnd,
  generateDynamicUpliftSchedule,
} from "./sale-expected-cvr";

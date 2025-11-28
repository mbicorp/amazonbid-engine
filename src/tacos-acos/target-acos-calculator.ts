/**
 * ターゲットACOS計算モジュール
 *
 * T_opt と T_stage を用いたTACOSモデルをLTVモデルと統合し、
 * 最終的なターゲットACOSを計算する。
 *
 * 計算ロジック:
 * 1. ライフサイクルに応じたT_stageを決定（T_launch/T_grow/T_harvest）
 * 2. MAIN_SALE時はセール用TACOSを適用（T_stage × sModeTacosMultiplier）
 * 3. 広告売上シェアを計算し、TACOSからACOSに変換
 * 4. LTVモデルからのACOSと比較し、厳しい方を採用
 * 5. グローバル制限を適用
 */

import { LifecycleState } from "../config/productConfigTypes";
import {
  SalePhase,
  TargetAcosContext,
  TargetAcosConfig,
  TargetAcosResult,
  TargetAcosBreakdown,
  DEFAULT_TARGET_ACOS_CONFIG,
} from "./types";

// =============================================================================
// T_stage決定
// =============================================================================

/**
 * ライフサイクルステージに応じたTACOS目標値を取得
 *
 * @param lifecycleStage - 現在のライフサイクルステージ
 * @param tLaunch - ローンチ期TACOS
 * @param tGrow - グロー期TACOS
 * @param tHarvest - ハーベスト期TACOS
 * @returns ステージに対応するTACOS目標値
 */
export function getStageTacos(
  lifecycleStage: LifecycleState,
  tLaunch: number,
  tGrow: number,
  tHarvest: number
): number {
  switch (lifecycleStage) {
    case "LAUNCH_HARD":
    case "LAUNCH_SOFT":
      return tLaunch;
    case "GROW":
      return tGrow;
    case "HARVEST":
      return tHarvest;
    default:
      return tGrow;
  }
}

/**
 * セールフェーズを考慮した最終T_stageを計算
 *
 * @param stageTacos - ライフサイクルに対応する基本TACOS
 * @param salePhase - 現在のセールフェーズ
 * @param config - 設定
 * @returns セールフェーズ考慮後のT_stage
 */
export function computeTStageWithSalePhase(
  stageTacos: number,
  salePhase: SalePhase,
  config: TargetAcosConfig
): { tStageUsed: number; tStageSmode: number } {
  // MAIN_SALEの場合はセール用TACOSを計算
  const tStageSmode = stageTacos * config.sModeTacosMultiplier;

  // 使用するT_stageを決定
  const tStageUsed = salePhase === "MAIN_SALE" ? tStageSmode : stageTacos;

  return { tStageUsed, tStageSmode };
}

// =============================================================================
// 広告売上シェア計算
// =============================================================================

/**
 * 広告売上シェアを計算
 *
 * @param salesTotal30d - 直近30日の全売上
 * @param adSales30d - 直近30日の広告経由売上
 * @param config - 設定
 * @returns 広告売上シェア（0〜1）
 */
export function computeAdSalesShare(
  salesTotal30d: number,
  adSales30d: number,
  config: TargetAcosConfig
): { rawShare: number; effectiveShare: number } {
  // salesTotalが閾値未満の場合はデフォルト値を使用
  if (salesTotal30d < config.salesTotalMinThreshold) {
    return {
      rawShare: 0,
      effectiveShare: config.adSalesShareDefault,
    };
  }

  // 生のシェアを計算
  const rawShare = adSales30d / salesTotal30d;

  // 最小値と比較して有効なシェアを決定
  const effectiveShare = Math.max(rawShare, config.adSalesShareMin);

  return { rawShare, effectiveShare };
}

/**
 * TACOSからACOSへ変換
 *
 * targetAcosFromTacos = T_stage / adSalesShare
 *
 * @param tStage - TACOS目標値
 * @param adSalesShare - 広告売上シェア
 * @returns ACOS目標値
 */
export function convertTacosToAcos(tStage: number, adSalesShare: number): number {
  if (adSalesShare <= 0) {
    return 0;
  }
  return tStage / adSalesShare;
}

// =============================================================================
// LTV ACOS調整
// =============================================================================

/**
 * ライフサイクルに応じたLTV ACOS係数を取得
 */
export function getLtvStageFactor(
  lifecycleStage: LifecycleState,
  config: TargetAcosConfig
): number {
  switch (lifecycleStage) {
    case "LAUNCH_HARD":
    case "LAUNCH_SOFT":
      return config.ltvLaunchFactor;
    case "GROW":
      return config.ltvGrowFactor;
    case "HARVEST":
      return config.ltvHarvestFactor;
    default:
      return config.ltvGrowFactor;
  }
}

/**
 * LTVモデルからのターゲットACOSを計算
 *
 * @param baseLtvAcos - ベースLTV ACOS
 * @param lifecycleStage - ライフサイクルステージ
 * @param ltvHardCap - LTV観点でのACOS上限（なければnull）
 * @param config - 設定
 * @returns 調整後のLTV ACOS
 */
export function computeTargetAcosFromLtv(
  baseLtvAcos: number,
  lifecycleStage: LifecycleState,
  ltvHardCap: number | null,
  config: TargetAcosConfig
): { adjustedLtvAcos: number; cappedLtvAcos: number } {
  // ステージ別係数を適用
  const stageFactor = getLtvStageFactor(lifecycleStage, config);
  const adjustedLtvAcos = baseLtvAcos * stageFactor;

  // ltvHardCapが設定されている場合は上限を適用
  const cappedLtvAcos =
    ltvHardCap !== null
      ? Math.min(adjustedLtvAcos, ltvHardCap)
      : adjustedLtvAcos;

  return { adjustedLtvAcos, cappedLtvAcos };
}

// =============================================================================
// 統合ターゲットACOS計算
// =============================================================================

/**
 * 最終ターゲットACOSを計算
 *
 * TACOSモデルとLTVモデルの両方からACOSを計算し、
 * より厳しい（低い）方を採用する。
 *
 * @param context - ターゲットACOS計算コンテキスト
 * @param config - 設定（オプション）
 * @returns ターゲットACOS計算結果
 */
export function computeIntegratedTargetAcos(
  context: TargetAcosContext,
  config: TargetAcosConfig = DEFAULT_TARGET_ACOS_CONFIG
): TargetAcosResult {
  // 1. ライフサイクルに応じたT_stageを決定
  const stageTacos = getStageTacos(
    context.lifecycleStage,
    context.tLaunch,
    context.tGrow,
    context.tHarvest
  );

  // 2. セールフェーズを考慮したT_stageを計算
  const { tStageUsed, tStageSmode } = computeTStageWithSalePhase(
    stageTacos,
    context.salePhase,
    config
  );

  // 3. 広告売上シェアを計算
  const { rawShare, effectiveShare } = computeAdSalesShare(
    context.salesTotal30d,
    context.adSales30d,
    config
  );

  // 4. TACOSからACOSに変換
  const targetAcosFromTacos = convertTacosToAcos(tStageUsed, effectiveShare);

  // 5. LTVモデルからのACOSを計算
  const { adjustedLtvAcos, cappedLtvAcos } = computeTargetAcosFromLtv(
    context.baseLtvAcos,
    context.lifecycleStage,
    context.ltvHardCap,
    config
  );

  // 6. より厳しい方を採用
  const preClipAcos = Math.min(targetAcosFromTacos, cappedLtvAcos);
  const tacosModelSelected = targetAcosFromTacos <= cappedLtvAcos;

  // 7. グローバル制限を適用
  let finalTargetAcos = preClipAcos;
  let wasClipped = false;

  if (finalTargetAcos < config.globalAcosMin) {
    finalTargetAcos = config.globalAcosMin;
    wasClipped = true;
  } else if (finalTargetAcos > config.globalAcosMax) {
    finalTargetAcos = config.globalAcosMax;
    wasClipped = true;
  }

  // 結果を構築
  const breakdown: TargetAcosBreakdown = {
    stageTacos,
    tStageSmode,
    tStageUsedFinal: tStageUsed,
    rawAdSalesShare: rawShare,
    effectiveAdSalesShare: effectiveShare,
    baseLtvAcosInput: context.baseLtvAcos,
    adjustedLtvAcos,
    cappedLtvAcos,
    preClipAcos,
    wasClipped,
  };

  return {
    finalTargetAcos,
    targetAcosFromTacos,
    targetAcosFromLtv: cappedLtvAcos,
    tStageUsed,
    adSalesShareUsed: effectiveShare,
    tacosModelSelected,
    breakdown,
  };
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * T_opt推計結果からT_stageパラメータを構築
 *
 * この関数は optimalTacos.ts の calculateLifecycleTacosTargets と連携する
 */
export function buildTStageParams(
  tOpt: number,
  marginPotential: number,
  alphaLaunch: number = 0.30,
  alphaHarvest: number = 0.25
): { tLaunch: number; tGrow: number; tHarvest: number } {
  // T_launch = min(g, T_opt × (1 + α_L))
  const tLaunch = Math.min(marginPotential, tOpt * (1 + alphaLaunch));

  // T_grow = T_opt
  const tGrow = tOpt;

  // T_harvest = max(0, T_opt × (1 - α_H))
  const tHarvest = Math.max(0, tOpt * (1 - alphaHarvest));

  return { tLaunch, tGrow, tHarvest };
}

/**
 * 簡易版: 基本パラメータからターゲットACOSを計算
 *
 * ターゲットACOS計算に必要な最小限のパラメータから結果を取得
 */
export function computeTargetAcosSimple(
  tOpt: number,
  marginPotential: number,
  lifecycleStage: LifecycleState,
  salePhase: SalePhase,
  salesTotal30d: number,
  adSales30d: number,
  baseLtvAcos: number,
  config: TargetAcosConfig = DEFAULT_TARGET_ACOS_CONFIG
): number {
  // T_stageパラメータを構築
  const { tLaunch, tGrow, tHarvest } = buildTStageParams(tOpt, marginPotential);

  // コンテキストを構築
  const context: TargetAcosContext = {
    marginPotential,
    tOpt,
    tLaunch,
    tGrow,
    tHarvest,
    lifecycleStage,
    salePhase,
    salesTotal30d,
    adSales30d,
    baseLtvAcos,
    ltvHardCap: null,
  };

  // 計算を実行
  const result = computeIntegratedTargetAcos(context, config);
  return result.finalTargetAcos;
}

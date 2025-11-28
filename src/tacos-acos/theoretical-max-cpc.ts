/**
 * 理論最大CPC計算モジュール
 *
 * g, T_stage, expectedCvr から理論的に許容できる最大CPCを計算し、
 * 入札ガードレールとして使用する。
 *
 * 計算式:
 * theoreticalMaxCpc = price × T_stage × expectedCvr × cpcSafetyFactor
 *
 * セール時の上限:
 * theoreticalMaxCpc_current <= theoreticalMaxCpc_normal × cpcUpliftCap
 */

import {
  SalePhase,
  TheoreticalMaxCpcConfig,
  TheoreticalMaxCpcInput,
  TheoreticalMaxCpcResult,
  TheoreticalMaxCpcBreakdown,
  CpcGuardResult,
  DEFAULT_THEORETICAL_MAX_CPC_CONFIG,
} from "./types";

// =============================================================================
// 理論最大CPC計算
// =============================================================================

/**
 * 理論最大CPCを計算（単一フェーズ）
 *
 * maxCpcHard = price × T_stage × expectedCvr
 * theoreticalMaxCpc = maxCpcHard × cpcSafetyFactor
 *
 * @param price - 商品価格（円）
 * @param tStage - TACOS目標値
 * @param expectedCvr - 期待CVR
 * @param cpcSafetyFactor - CPC安全係数
 * @returns 理論最大CPC（円）
 */
export function computeMaxCpcHard(
  price: number,
  tStage: number,
  expectedCvr: number,
  cpcSafetyFactor: number
): { maxCpcHard: number; maxCpcWithSafety: number } {
  // 基本の理論最大CPC
  const maxCpcHard = price * tStage * expectedCvr;

  // 安全係数を適用
  const maxCpcWithSafety = maxCpcHard * cpcSafetyFactor;

  return { maxCpcHard, maxCpcWithSafety };
}

/**
 * 理論最大CPCを計算
 *
 * 通常時とセール時の両方の理論最大CPCを計算し、
 * セール時はuplift上限を適用する。
 *
 * @param input - 計算入力
 * @param config - 設定
 * @returns 理論最大CPC計算結果
 */
export function computeTheoreticalMaxCpc(
  input: TheoreticalMaxCpcInput,
  config: TheoreticalMaxCpcConfig = DEFAULT_THEORETICAL_MAX_CPC_CONFIG
): TheoreticalMaxCpcResult {
  const {
    price,
    tStageNormal,
    expectedCvrNormal,
    salePhase,
    tStageSmode,
    expectedCvrSale,
  } = input;

  // 1. 通常時の理論最大CPCを計算
  const normalResult = computeMaxCpcHard(
    price,
    tStageNormal,
    expectedCvrNormal,
    config.cpcSafetyFactor
  );

  const theoreticalMaxCpcNormal = normalResult.maxCpcWithSafety;

  // 2. MAIN_SALE以外は通常時の値を使用
  if (salePhase !== "MAIN_SALE") {
    const breakdown: TheoreticalMaxCpcBreakdown = {
      price,
      tStageUsed: tStageNormal,
      expectedCvrUsed: expectedCvrNormal,
      maxCpcHard: normalResult.maxCpcHard,
      maxCpcWithSafety: normalResult.maxCpcWithSafety,
      preCappedCpc: null,
    };

    return {
      theoreticalMaxCpc: theoreticalMaxCpcNormal,
      theoreticalMaxCpcNormal,
      wasUpliftCapped: false,
      breakdown,
    };
  }

  // 3. MAIN_SALE時の理論最大CPCを計算
  const effectiveTStage = tStageSmode ?? tStageNormal;
  const effectiveExpectedCvr = expectedCvrSale ?? expectedCvrNormal;

  const saleResult = computeMaxCpcHard(
    price,
    effectiveTStage,
    effectiveExpectedCvr,
    config.cpcSafetyFactor
  );

  // 4. セール時のuplift上限を適用
  const upliftCap = theoreticalMaxCpcNormal * config.cpcUpliftCap;
  const preCappedCpc = saleResult.maxCpcWithSafety;

  const wasUpliftCapped = preCappedCpc > upliftCap;
  const theoreticalMaxCpc = wasUpliftCapped ? upliftCap : preCappedCpc;

  const breakdown: TheoreticalMaxCpcBreakdown = {
    price,
    tStageUsed: effectiveTStage,
    expectedCvrUsed: effectiveExpectedCvr,
    maxCpcHard: saleResult.maxCpcHard,
    maxCpcWithSafety: saleResult.maxCpcWithSafety,
    preCappedCpc,
  };

  return {
    theoreticalMaxCpc,
    theoreticalMaxCpcNormal,
    wasUpliftCapped,
    breakdown,
  };
}

// =============================================================================
// 入札ガード適用
// =============================================================================

/**
 * 理論最大CPCによる入札ガードを適用
 *
 * 推奨入札額が理論最大CPCを超えている場合、理論最大CPCでクリップする。
 *
 * @param recommendedBid - 推奨入札額（円）
 * @param theoreticalMaxCpc - 理論最大CPC（円）
 * @returns ガード適用結果
 */
export function applyCpcGuard(
  recommendedBid: number,
  theoreticalMaxCpc: number
): CpcGuardResult {
  const wasCapped = recommendedBid > theoreticalMaxCpc;
  const cappedBid = wasCapped ? theoreticalMaxCpc : recommendedBid;

  return {
    cappedBid: Math.round(cappedBid),
    originalBid: recommendedBid,
    wasCapped,
    theoreticalMaxCpc,
    capReason: wasCapped ? `理論最大CPC(${Math.round(theoreticalMaxCpc)}円)を超過` : null,
  };
}

/**
 * 入札計算パイプラインに理論最大CPCガードを統合
 *
 * @param recommendedBidRaw - 倍率計算などで算出された推奨入札額
 * @param input - 理論最大CPC計算入力
 * @param config - 設定
 * @returns ガード適用後の入札額と詳細
 */
export function applyTheoreticalMaxCpcGuard(
  recommendedBidRaw: number,
  input: TheoreticalMaxCpcInput,
  config: TheoreticalMaxCpcConfig = DEFAULT_THEORETICAL_MAX_CPC_CONFIG
): {
  finalBid: number;
  cpcResult: TheoreticalMaxCpcResult;
  guardResult: CpcGuardResult;
} {
  // 理論最大CPCを計算
  const cpcResult = computeTheoreticalMaxCpc(input, config);

  // ガードを適用
  const guardResult = applyCpcGuard(recommendedBidRaw, cpcResult.theoreticalMaxCpc);

  return {
    finalBid: guardResult.cappedBid,
    cpcResult,
    guardResult,
  };
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * 損益分岐CPC（Break-even CPC）を計算
 *
 * break-even CPC = price × marginPotential × expectedCvr
 *
 * これより高いCPCでは理論的に赤字になる。
 *
 * @param price - 商品価格
 * @param marginPotential - ポテンシャル粗利率
 * @param expectedCvr - 期待CVR
 * @returns 損益分岐CPC
 */
export function computeBreakEvenCpc(
  price: number,
  marginPotential: number,
  expectedCvr: number
): number {
  return price * marginPotential * expectedCvr;
}

/**
 * 現在の入札額が理論最大CPCに対してどの程度かを計算
 *
 * @param currentBid - 現在の入札額
 * @param theoreticalMaxCpc - 理論最大CPC
 * @returns 使用率（0〜1+、1超過は超過状態）
 */
export function computeCpcUtilization(
  currentBid: number,
  theoreticalMaxCpc: number
): number {
  if (theoreticalMaxCpc <= 0) {
    return currentBid > 0 ? Infinity : 0;
  }
  return currentBid / theoreticalMaxCpc;
}

/**
 * 理論最大CPCに対する余裕度を計算
 *
 * @param currentBid - 現在の入札額
 * @param theoreticalMaxCpc - 理論最大CPC
 * @returns 余裕度（円）、負の値は超過
 */
export function computeCpcHeadroom(
  currentBid: number,
  theoreticalMaxCpc: number
): number {
  return theoreticalMaxCpc - currentBid;
}

/**
 * 理論最大CPC計算に必要な最小限の情報から結果を取得
 *
 * @param price - 商品価格
 * @param tStage - TACOS目標値
 * @param expectedCvr - 期待CVR
 * @param config - 設定
 * @returns 理論最大CPC
 */
export function computeTheoreticalMaxCpcSimple(
  price: number,
  tStage: number,
  expectedCvr: number,
  config: TheoreticalMaxCpcConfig = DEFAULT_THEORETICAL_MAX_CPC_CONFIG
): number {
  const { maxCpcWithSafety } = computeMaxCpcHard(
    price,
    tStage,
    expectedCvr,
    config.cpcSafetyFactor
  );
  return maxCpcWithSafety;
}

/**
 * 入札額が理論的に許容範囲内かを判定
 *
 * @param bid - 入札額
 * @param price - 商品価格
 * @param tStage - TACOS目標値
 * @param expectedCvr - 期待CVR
 * @param config - 設定
 * @returns 許容範囲内かどうか
 */
export function isBidWithinTheoreticalLimit(
  bid: number,
  price: number,
  tStage: number,
  expectedCvr: number,
  config: TheoreticalMaxCpcConfig = DEFAULT_THEORETICAL_MAX_CPC_CONFIG
): boolean {
  const theoreticalMaxCpc = computeTheoreticalMaxCpcSimple(
    price,
    tStage,
    expectedCvr,
    config
  );
  return bid <= theoreticalMaxCpc;
}

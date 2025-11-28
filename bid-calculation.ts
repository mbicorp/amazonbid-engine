/**
 * Amazon広告自動入札提案エンジン - 入札額計算ロジック
 */

import {
  KeywordMetrics,
  GlobalConfig,
  ActionType,
} from "./types";

/**
 * 最終変化率を計算（7係数）
 *
 * 注: risk_coeffはstats_coeffに統合されたため削除
 */
export function calculateFinalChangeRate(
  baseChangeRate: number,
  coefficients: {
    phase_coeff: number;
    cvr_coeff: number;
    rank_gap_coeff: number;
    competitor_coeff: number;
    brand_coeff: number;
    stats_coeff: number;
    tos_coeff: number;
  }
): number {
  const {
    phase_coeff,
    cvr_coeff,
    rank_gap_coeff,
    competitor_coeff,
    brand_coeff,
    stats_coeff,
    tos_coeff,
  } = coefficients;

  // 全係数を乗算
  let finalChangeRate =
    baseChangeRate *
    phase_coeff *
    cvr_coeff *
    rank_gap_coeff *
    competitor_coeff *
    brand_coeff *
    stats_coeff *
    tos_coeff;

  return finalChangeRate;
}

/**
 * 変化率の上限を適用
 */
export function applyChangeRateLimit(
  changeRate: number,
  config: GlobalConfig,
  isTOSEligible200: boolean
): { clipped_rate: number; clipped: boolean; clip_reason: string | null } {
  let maxChangeRate: number;
  let clipReason: string | null = null;
  let clipped = false;

  if (config.mode === "NORMAL") {
    maxChangeRate = config.max_change_rate_normal;
  } else {
    // S_MODE
    if (isTOSEligible200) {
      maxChangeRate = config.max_change_rate_smode_tos; // 2.0
    } else {
      maxChangeRate = config.max_change_rate_smode_default; // 1.5
    }
  }

  let clippedRate = changeRate;

  // 上限チェック
  if (changeRate > maxChangeRate) {
    clippedRate = maxChangeRate;
    clipped = true;
    clipReason = `変化率が上限${(maxChangeRate * 100).toFixed(0)}%を超えたためクリップ`;
  }

  // 下限チェック（-100%以下にはしない）
  if (clippedRate < -1.0) {
    clippedRate = -1.0;
    clipped = true;
    clipReason = "変化率が-100%を下回ったためクリップ";
  }

  return { clipped_rate: clippedRate, clipped, clip_reason: clipReason };
}

/**
 * 新しい入札額を計算
 */
export function calculateNewBid(
  currentBid: number,
  changeRate: number,
  action: ActionType
): number {
  if (action === "STOP") {
    return 0;
  }

  if (action === "KEEP") {
    return currentBid;
  }

  const newBid = currentBid * (1 + changeRate);
  return Math.max(0, newBid);
}

/**
 * CPC上限を計算
 *
 * 注意: 競合CPCやベースラインCPCが異常に低い場合でも、
 * 最低限の入札余地を確保するため、絶対的な下限フロアを設ける
 */
export function calculateCPCLimit(
  currentBid: number,
  competitorCPC: number,
  baselineCPC: number
): number {
  // 最低限の入札上限フロア（競合データが不完全な場合の保護）
  const MIN_CPC_LIMIT_FLOOR = 50;

  const limit1 = currentBid * 3.0;
  const limit2 = competitorCPC * 1.15;
  const limit3 = baselineCPC * 2.5;

  // 各limitの最小値を取るが、絶対的な下限フロアを保証
  const calculatedLimit = Math.min(limit1, limit2, limit3);

  // 競合CPCやbaselineCPCが0や異常に低い場合でも、最低限のフロアを確保
  return Math.max(calculatedLimit, MIN_CPC_LIMIT_FLOOR);
}

/**
 * 新しい入札額に上限を適用
 */
export function applyBidLimit(
  newBid: number,
  metrics: KeywordMetrics,
  previousClipReason: string | null
): { final_bid: number; clipped: boolean; clip_reason: string | null } {
  const cpcLimit = calculateCPCLimit(
    metrics.current_bid,
    metrics.competitor_cpc_current,
    metrics.baseline_cpc
  );

  if (newBid > cpcLimit) {
    return {
      final_bid: cpcLimit,
      clipped: true,
      clip_reason:
        previousClipReason ||
        `CPC上限${cpcLimit.toFixed(0)}円を超えたためクリップ`,
    };
  }

  // 最低入札額（例: 10円）
  const minBid = 10;
  if (newBid < minBid && newBid > 0) {
    return {
      final_bid: minBid,
      clipped: true,
      clip_reason:
        previousClipReason || `最低入札額${minBid}円未満のためクリップ`,
    };
  }

  return {
    final_bid: newBid,
    clipped: false,
    clip_reason: previousClipReason,
  };
}

/**
 * 完全な入札額計算フロー（7係数）
 */
export function computeBidAmount(
  metrics: KeywordMetrics,
  config: GlobalConfig,
  baseChangeRate: number,
  coefficients: {
    phase_coeff: number;
    cvr_coeff: number;
    rank_gap_coeff: number;
    competitor_coeff: number;
    brand_coeff: number;
    stats_coeff: number;
    tos_coeff: number;
  },
  action: ActionType,
  isTOSEligible200: boolean
): {
  change_rate: number;
  new_bid: number;
  clipped: boolean;
  clip_reason: string | null;
} {
  // 1. 最終変化率を計算
  const finalChangeRate = calculateFinalChangeRate(baseChangeRate, coefficients);

  // 2. 変化率の上限を適用
  const { clipped_rate, clipped, clip_reason } = applyChangeRateLimit(
    finalChangeRate,
    config,
    isTOSEligible200
  );

  // 3. 新しい入札額を計算
  const newBidBeforeLimit = calculateNewBid(
    metrics.current_bid,
    clipped_rate,
    action
  );

  // 4. CPC上限を適用
  const { final_bid, clipped: finalClipped, clip_reason: finalClipReason } =
    applyBidLimit(newBidBeforeLimit, metrics, clip_reason);

  return {
    change_rate: clipped_rate,
    new_bid: Math.round(final_bid),
    clipped: clipped || finalClipped,
    clip_reason: finalClipReason,
  };
}

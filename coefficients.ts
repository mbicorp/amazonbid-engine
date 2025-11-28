/**
 * Amazon広告自動入札提案エンジン - 係数計算ロジック
 */

import {
  PhaseType,
  BrandType,
  KeywordMetrics,
  GlobalConfig,
  ActionType,
} from "./types";

/**
 * フェーズ係数を計算
 */
export function calculatePhaseCoeff(
  phaseType: PhaseType,
  mode: "NORMAL" | "S_MODE"
): number {
  if (mode === "NORMAL") {
    return 1.0;
  }

  // S_MODE の場合
  const phaseCoeffMap: Record<PhaseType, number> = {
    NORMAL: 1.0,
    S_PRE1: 1.2,
    S_PRE2: 1.5,
    S_FREEZE: 0.0, // フリーズ期間は変更なし
    S_NORMAL: 1.3,
    S_FINAL: 1.8,
    S_REVERT: 0.8,
  };

  return phaseCoeffMap[phaseType];
}

/**
 * CVR係数を計算
 */
export function calculateCVRCoeff(
  cvr_recent: number,
  cvr_baseline: number,
  mode: "NORMAL" | "S_MODE",
  action: ActionType
): number {
  if (cvr_baseline === 0) return 1.0;

  const cvrBoost = (cvr_recent - cvr_baseline) / cvr_baseline;

  if (mode === "NORMAL") {
    // NORMAL モードはマイルド
    if (cvrBoost > 0.3) return 1.15;
    if (cvrBoost > 0.1) return 1.08;
    if (cvrBoost < -0.3) return 0.85;
    if (cvrBoost < -0.1) return 0.92;
    return 1.0;
  }

  // S_MODE の場合、より積極的に
  if (action === "STRONG_UP" || action === "MILD_UP") {
    if (cvrBoost > 0.4) return 1.5;
    if (cvrBoost > 0.2) return 1.3;
    if (cvrBoost > 0.1) return 1.15;
  }

  if (action === "STRONG_DOWN" || action === "MILD_DOWN") {
    if (cvrBoost < -0.4) return 0.7;
    if (cvrBoost < -0.2) return 0.85;
  }

  return 1.0;
}

/**
 * ランクギャップ係数を計算
 */
export function calculateRankGapCoeff(
  rank_current: number | null,
  rank_target: number | null,
  action: ActionType
): number {
  if (rank_current === null || rank_target === null) {
    return 1.0;
  }

  const rankGap = rank_current - rank_target;

  // 目標より下にいる場合（rankが大きい = 順位が低い）
  if (rankGap > 0 && (action === "STRONG_UP" || action === "MILD_UP")) {
    if (rankGap >= 5) return 1.3;
    if (rankGap >= 3) return 1.2;
    if (rankGap >= 1) return 1.1;
  }

  // 目標より上にいる場合
  if (rankGap < 0 && (action === "STRONG_DOWN" || action === "MILD_DOWN")) {
    if (rankGap <= -3) return 1.15;
    if (rankGap <= -1) return 1.08;
  }

  return 1.0;
}

/**
 * 競合係数を計算
 */
export function calculateCompetitorCoeff(
  competitor_cpc_current: number,
  competitor_cpc_baseline: number,
  comp_strength: number,
  action: ActionType
): number {
  const compCPCRatio =
    competitor_cpc_baseline > 0
      ? competitor_cpc_current / competitor_cpc_baseline
      : 1.0;

  // 競合が入札を上げている場合
  if (
    compCPCRatio >= 1.2 &&
    comp_strength > 0.6 &&
    (action === "STRONG_UP" || action === "MILD_UP")
  ) {
    return 1.25;
  }

  if (
    compCPCRatio > 1.1 &&
    comp_strength > 0.5 &&
    (action === "STRONG_UP" || action === "MILD_UP")
  ) {
    return 1.15;
  }

  // 競合が入札を下げている場合
  if (
    compCPCRatio < 0.9 &&
    (action === "STRONG_DOWN" || action === "MILD_DOWN")
  ) {
    return 1.1;
  }

  return 1.0;
}

/**
 * ブランド係数を計算
 */
export function calculateBrandCoeff(
  brandType: BrandType,
  action: ActionType
): number {
  if (brandType === "BRAND") {
    // 自社ブランドは積極的に
    if (action === "STRONG_UP" || action === "MILD_UP") {
      return 1.2;
    }
    // 下げる場合は慎重に
    if (action === "STRONG_DOWN" || action === "MILD_DOWN") {
      return 0.8;
    }
  }

  if (brandType === "CONQUEST") {
    // 競合ブランドは慎重に
    if (action === "STRONG_UP") {
      return 0.9;
    }
  }

  return 1.0;
}

/**
 * データ信頼性係数を計算
 *
 * 注: 旧risk_coeffとstats_coeffを統合。
 * どちらも「データ量が少ない＝信頼性が低い」という同じ概念を表していたため、
 * clicks_3hベースの判定に一本化。
 */
export function calculateStatsCoeff(
  clicks_3h: number,
  config: GlobalConfig,
  action: ActionType
): number {
  // データが少なすぎる場合は変更を大幅に抑制
  if (clicks_3h < config.min_clicks_for_decision) {
    return 0.5;
  }

  // データがまあまあの場合
  if (clicks_3h < config.min_clicks_for_confident) {
    if (action === "STRONG_UP" || action === "STRONG_DOWN") {
      return 0.7; // 大きな変更は特に抑制
    }
    return 0.85;
  }

  // データが十分な場合は促進
  if (clicks_3h >= config.min_clicks_for_tos) {
    return 1.1;
  }

  return 1.0;
}

/**
 * TOS係数を計算
 */
export function calculateTOSCoeff(
  metrics: KeywordMetrics,
  config: GlobalConfig,
  isTOSTargeted: boolean,
  action: ActionType
): number {
  if (!isTOSTargeted) {
    return 1.0;
  }

  if (config.mode !== "S_MODE") {
    return 1.0;
  }

  // TOS攻め対象の場合、上げを大幅に促進
  if (action === "STRONG_UP" || action === "MILD_UP") {
    const tosValue = metrics.tos_ctr_mult * metrics.tos_cvr_mult;
    if (tosValue > 2.0) return 1.8;
    if (tosValue > 1.5) return 1.5;
    if (tosValue > 1.2) return 1.3;
    return 1.2;
  }

  return 1.0;
}

/**
 * 全係数を計算して返す（7係数）
 *
 * 注: risk_coeffはstats_coeffに統合されたため削除
 */
export function calculateAllCoefficients(
  metrics: KeywordMetrics,
  config: GlobalConfig,
  action: ActionType,
  isTOSTargeted: boolean
): {
  phase_coeff: number;
  cvr_coeff: number;
  rank_gap_coeff: number;
  competitor_coeff: number;
  brand_coeff: number;
  stats_coeff: number;
  tos_coeff: number;
} {
  return {
    phase_coeff: calculatePhaseCoeff(metrics.phase_type, config.mode),
    cvr_coeff: calculateCVRCoeff(
      metrics.cvr_recent,
      metrics.cvr_baseline,
      config.mode,
      action
    ),
    rank_gap_coeff: calculateRankGapCoeff(
      metrics.rank_current,
      metrics.rank_target,
      action
    ),
    competitor_coeff: calculateCompetitorCoeff(
      metrics.competitor_cpc_current,
      metrics.competitor_cpc_baseline,
      metrics.comp_strength,
      action
    ),
    brand_coeff: calculateBrandCoeff(metrics.brand_type, action),
    stats_coeff: calculateStatsCoeff(metrics.clicks_3h, config, action),
    tos_coeff: calculateTOSCoeff(metrics, config, isTOSTargeted, action),
  };
}

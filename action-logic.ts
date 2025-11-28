/**
 * Amazon広告自動入札提案エンジン - アクション決定ロジック
 */

import {
  ActionType,
  ScoreRank,
  BrandType,
  KeywordMetrics,
  GlobalConfig,
} from "./types";

/**
 * ScoreRankとActionTypeから基本変化率を取得
 */
export function getBaseChangeRate(
  scoreRank: ScoreRank,
  action: ActionType
): number {
  const baseChangeRateMap: Record<ScoreRank, Record<ActionType, number>> = {
    S: {
      STRONG_UP: 0.50,
      MILD_UP: 0.30,
      KEEP: 0.0,
      MILD_DOWN: -0.20,
      STRONG_DOWN: -0.40,
      STOP: -1.0,
    },
    A: {
      STRONG_UP: 0.40,
      MILD_UP: 0.25,
      KEEP: 0.0,
      MILD_DOWN: -0.25,
      STRONG_DOWN: -0.50,
      STOP: -1.0,
    },
    B: {
      STRONG_UP: 0.30,
      MILD_UP: 0.15,
      KEEP: 0.0,
      MILD_DOWN: -0.30,
      STRONG_DOWN: -0.60,
      STOP: -1.0,
    },
    C: {
      STRONG_UP: 0.20,
      MILD_UP: 0.10,
      KEEP: 0.0,
      MILD_DOWN: -0.35,
      STRONG_DOWN: -0.70,
      STOP: -1.0,
    },
  };

  return baseChangeRateMap[scoreRank][action];
}

/**
 * CVRブースト値を計算
 */
export function calculateCVRBoost(
  cvr_recent: number,
  cvr_baseline: number
): number {
  if (cvr_baseline === 0) return 0;
  return (cvr_recent - cvr_baseline) / cvr_baseline;
}

/**
 * ACOS差分を計算
 */
export function calculateACOSDiff(
  acos_actual: number,
  acos_target: number
): number {
  return acos_actual - acos_target;
}

/**
 * メトリクスに基づいてアクションを決定
 */
export function determineAction(
  metrics: KeywordMetrics,
  config: GlobalConfig
): ActionType {
  const cvrBoost = calculateCVRBoost(metrics.cvr_recent, metrics.cvr_baseline);
  const acosDiff = calculateACOSDiff(metrics.acos_actual, metrics.acos_target);
  const { clicks_3h, score_rank, risk_penalty, comp_strength } = metrics;

  // データ不足の場合はKEEP
  if (clicks_3h < config.min_clicks_for_decision) {
    return "KEEP";
  }

  // ACOS Hard Stop: ACOS が target の 3倍以上
  if (
    metrics.acos_target > 0 &&
    metrics.acos_actual >= metrics.acos_target * config.acos_hard_stop_multiplier
  ) {
    return "STOP";
  }

  // ACOS Soft Down: ACOS が target の 1.5倍以上
  if (
    metrics.acos_target > 0 &&
    metrics.acos_actual >= metrics.acos_target * config.acos_soft_down_multiplier
  ) {
    return "STRONG_DOWN";
  }

  // CVRが大幅に向上している場合
  if (cvrBoost > 0.3 && acosDiff <= 0) {
    if (score_rank === "S" || score_rank === "A") {
      return "STRONG_UP";
    }
    return "MILD_UP";
  }

  // CVRが向上している場合
  if (cvrBoost > 0.1 && acosDiff <= metrics.acos_target * 0.2) {
    return "MILD_UP";
  }

  // ACOSが良好でリスクが低い場合
  if (acosDiff < -metrics.acos_target * 0.2 && risk_penalty < 0.3) {
    if (score_rank === "S") {
      return "STRONG_UP";
    }
    return "MILD_UP";
  }

  // CVRが大幅に低下している場合（STRONG_DOWNを先に評価）
  // 注意: より厳しい条件を先に評価しないと、MILD_DOWNに吸収されてしまう
  if (cvrBoost < -0.4 && acosDiff > metrics.acos_target * 0.5) {
    return "STRONG_DOWN";
  }

  // CVRが低下している場合
  if (cvrBoost < -0.2 || acosDiff > metrics.acos_target * 0.3) {
    return "MILD_DOWN";
  }

  // 競合が強い場合の調整
  if (comp_strength > 0.7 && clicks_3h < config.min_clicks_for_confident) {
    if (acosDiff <= 0) {
      return "MILD_UP";
    }
    return "MILD_DOWN";
  }

  // デフォルトはKEEP
  return "KEEP";
}

/**
 * Brand Ownの場合、StrongDownとStopをMildDownに変換
 */
export function adjustActionForBrandOwn(
  action: ActionType,
  brandType: BrandType
): ActionType {
  if (brandType === "BRAND") {
    if (action === "STRONG_DOWN" || action === "STOP") {
      return "MILD_DOWN";
    }
  }
  return action;
}

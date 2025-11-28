/**
 * Amazon広告自動入札提案エンジン - TOS判定ロジック
 */

import { KeywordMetrics, GlobalConfig } from "./types";

/**
 * TOS攻め対象かどうかを判定
 */
export function isTOSTargeted(
  metrics: KeywordMetrics,
  config: GlobalConfig
): boolean {
  // S_MODEでない場合は対象外
  if (config.mode !== "S_MODE") {
    return false;
  }

  // 十分なデータがない場合は対象外
  if (metrics.clicks_3h < config.min_clicks_for_tos) {
    return false;
  }

  // PriorityScoreが高いこと（上位20%）
  if (metrics.priority_score < 0.8) {
    return false;
  }

  // TOSValue（tos_ctr_mult × tos_cvr_mult）が1.5以上
  const tosValue = metrics.tos_ctr_mult * metrics.tos_cvr_mult;
  if (tosValue < 1.5) {
    return false;
  }

  // TOS Gap CPCが正（TOSに入る余地がある）
  if (metrics.tos_gap_cpc <= 0) {
    return false;
  }

  // リスクペナルティが低いこと
  if (metrics.risk_penalty > 0.4) {
    return false;
  }

  return true;
}

/**
 * TOS 200%上限許可対象かどうかを判定
 */
export function isTOSEligible200(
  metrics: KeywordMetrics,
  config: GlobalConfig
): boolean {
  if (!isTOSTargeted(metrics, config)) {
    return false;
  }

  // より厳しい条件
  // PriorityScoreが上位10%
  if (metrics.priority_score < 0.9) {
    return false;
  }

  // TOSValueが2.0以上
  const tosValue = metrics.tos_ctr_mult * metrics.tos_cvr_mult;
  if (tosValue < 2.0) {
    return false;
  }

  // ScoreRankがSまたはA
  if (metrics.score_rank !== "S" && metrics.score_rank !== "A") {
    return false;
  }

  // 十分な予算残高がある
  const budgetNeeded = metrics.expected_clicks_3h * metrics.current_bid * 2.0;
  if (metrics.campaign_budget_remaining < budgetNeeded) {
    return false;
  }

  return true;
}

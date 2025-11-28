/**
 * Amazon広告自動入札提案エンジン - 型定義
 */

export type PhaseType =
  | "NORMAL"
  | "S_PRE1"
  | "S_PRE2"
  | "S_FREEZE"
  | "S_NORMAL"
  | "S_FINAL"
  | "S_REVERT";

export type BrandType = "BRAND" | "CONQUEST" | "GENERIC";

export type ScoreRank = "S" | "A" | "B" | "C";

export type ActionType =
  | "STRONG_UP"
  | "MILD_UP"
  | "KEEP"
  | "MILD_DOWN"
  | "STRONG_DOWN"
  | "STOP";

export interface KeywordMetrics {
  keyword_id: string;
  campaign_id: string;
  ad_group_id: string;

  phase_type: PhaseType;
  brand_type: BrandType;
  score_rank: ScoreRank;

  current_bid: number;
  baseline_cpc: number;

  acos_target: number;
  acos_actual: number;

  cvr_recent: number;
  cvr_baseline: number;
  ctr_recent: number;
  ctr_baseline: number;

  clicks_1h: number;
  clicks_3h: number;
  impressions_1h: number;
  impressions_3h: number;

  rank_current: number | null;
  rank_target: number | null;

  competitor_cpc_current: number;
  competitor_cpc_baseline: number;
  comp_strength: number;

  risk_penalty: number;

  priority_score: number;
  tos_ctr_mult: number;
  tos_cvr_mult: number;
  tos_gap_cpc: number;

  campaign_budget_remaining: number;
  expected_clicks_3h: number;

  time_in_phase_minutes: number;
}

export interface GlobalConfig {
  mode: "NORMAL" | "S_MODE";
  manual_mode: boolean;

  max_change_rate_normal: number;
  max_change_rate_smode_default: number;
  max_change_rate_smode_tos: number;

  min_clicks_for_decision: number;
  min_clicks_for_confident: number;
  min_clicks_for_tos: number;

  acos_hard_stop_multiplier: number;
  acos_soft_down_multiplier: number;

  currency: "JPY";
}

export interface KeywordRecommendation {
  keyword_id: string;
  campaign_id: string;
  ad_group_id: string;

  action: ActionType;
  change_rate: number;
  new_bid: number;
  clipped: boolean;
  clip_reason: string | null;

  tos_targeted: boolean;
  tos_eligible_200: boolean;

  debug_coefficients?: {
    base_change_rate: number;
    phase_coeff: number;
    cvr_coeff: number;
    rank_gap_coeff: number;
    competitor_coeff: number;
    brand_coeff: number;
    stats_coeff: number;
    tos_coeff: number;
  };

  reason_facts: string;
  reason_logic: string;
  reason_impact: string;
}

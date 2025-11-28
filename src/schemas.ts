/**
 * Amazon広告自動入札提案エンジン - バリデーションスキーマ
 */

import { z } from "zod";

// =============================================================================
// 基本型のスキーマ
// =============================================================================

export const PhaseTypeSchema = z.enum([
  "NORMAL",
  "S_PRE1",
  "S_PRE2",
  "S_FREEZE",
  "S_NORMAL",
  "S_FINAL",
  "S_REVERT",
]);

export const BrandTypeSchema = z.enum(["BRAND", "CONQUEST", "GENERIC"]);

export const ScoreRankSchema = z.enum(["S", "A", "B", "C"]);

export const ActionTypeSchema = z.enum([
  "STRONG_UP",
  "MILD_UP",
  "KEEP",
  "MILD_DOWN",
  "STRONG_DOWN",
  "STOP",
]);

export const ExecutionModeSchema = z.enum(["NORMAL", "S_MODE"]);

// =============================================================================
// KeywordMetrics スキーマ
// =============================================================================

export const KeywordMetricsSchema = z.object({
  keyword_id: z.string().min(1, "keyword_id is required"),
  campaign_id: z.string().min(1, "campaign_id is required"),
  ad_group_id: z.string().min(1, "ad_group_id is required"),

  phase_type: PhaseTypeSchema,
  brand_type: BrandTypeSchema,
  score_rank: ScoreRankSchema,

  current_bid: z.number().min(0, "current_bid must be non-negative"),
  baseline_cpc: z.number().min(0, "baseline_cpc must be non-negative"),

  acos_target: z.number().min(0).max(10, "acos_target must be between 0 and 10"),
  acos_actual: z.number().min(0).max(100, "acos_actual must be between 0 and 100"),

  cvr_recent: z.number().min(0).max(1, "cvr_recent must be between 0 and 1"),
  cvr_baseline: z.number().min(0).max(1, "cvr_baseline must be between 0 and 1"),
  ctr_recent: z.number().min(0).max(1, "ctr_recent must be between 0 and 1"),
  ctr_baseline: z.number().min(0).max(1, "ctr_baseline must be between 0 and 1"),

  clicks_1h: z.number().int().min(0, "clicks_1h must be a non-negative integer"),
  clicks_3h: z.number().int().min(0, "clicks_3h must be a non-negative integer"),
  impressions_1h: z.number().int().min(0, "impressions_1h must be a non-negative integer"),
  impressions_3h: z.number().int().min(0, "impressions_3h must be a non-negative integer"),

  rank_current: z.number().int().min(1).nullable(),
  rank_target: z.number().int().min(1).nullable(),

  competitor_cpc_current: z.number().min(0),
  competitor_cpc_baseline: z.number().min(0),
  comp_strength: z.number().min(0).max(1, "comp_strength must be between 0 and 1"),

  risk_penalty: z.number().min(0).max(1, "risk_penalty must be between 0 and 1"),

  priority_score: z.number().min(0).max(1, "priority_score must be between 0 and 1"),
  tos_ctr_mult: z.number().min(0),
  tos_cvr_mult: z.number().min(0),
  tos_gap_cpc: z.number(),

  campaign_budget_remaining: z.number().min(0),
  expected_clicks_3h: z.number().min(0),

  time_in_phase_minutes: z.number().int().min(0),
});

// =============================================================================
// GlobalConfig スキーマ
// =============================================================================

export const GlobalConfigSchema = z.object({
  mode: ExecutionModeSchema,
  manual_mode: z.boolean(),

  max_change_rate_normal: z.number().min(0).max(10),
  max_change_rate_smode_default: z.number().min(0).max(10),
  max_change_rate_smode_tos: z.number().min(0).max(10),

  min_clicks_for_decision: z.number().int().min(0),
  min_clicks_for_confident: z.number().int().min(0),
  min_clicks_for_tos: z.number().int().min(0),

  acos_hard_stop_multiplier: z.number().min(1),
  acos_soft_down_multiplier: z.number().min(1),

  currency: z.literal("JPY"),
});

// =============================================================================
// APIリクエストスキーマ
// =============================================================================

export const RecommendRequestSchema = z.object({
  keywords: z.array(KeywordMetricsSchema).min(1, "At least one keyword is required"),
  config: GlobalConfigSchema,
});

export const CronRunRequestSchema = z.object({
  mode: ExecutionModeSchema.optional().default("NORMAL"),
});

// =============================================================================
// 型エクスポート（zodから推論）
// =============================================================================

export type PhaseType = z.infer<typeof PhaseTypeSchema>;
export type BrandType = z.infer<typeof BrandTypeSchema>;
export type ScoreRank = z.infer<typeof ScoreRankSchema>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
export type KeywordMetrics = z.infer<typeof KeywordMetricsSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type RecommendRequest = z.infer<typeof RecommendRequestSchema>;
export type CronRunRequest = z.infer<typeof CronRunRequestSchema>;

// =============================================================================
// バリデーション結果型
// =============================================================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

// =============================================================================
// バリデーションヘルパー関数
// =============================================================================

/**
 * KeywordMetrics配列をバリデーション
 */
export function validateKeywordMetrics(
  data: unknown
): ValidationResult<KeywordMetrics[]> {
  const result = z.array(KeywordMetricsSchema).safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(
    (err) => `${err.path.join(".")}: ${err.message}`
  );
  return { success: false, errors };
}

/**
 * GlobalConfigをバリデーション
 */
export function validateGlobalConfig(
  data: unknown
): ValidationResult<GlobalConfig> {
  const result = GlobalConfigSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(
    (err) => `${err.path.join(".")}: ${err.message}`
  );
  return { success: false, errors };
}

/**
 * Recommendリクエストをバリデーション
 */
export function validateRecommendRequest(
  data: unknown
): ValidationResult<RecommendRequest> {
  const result = RecommendRequestSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(
    (err) => `${err.path.join(".")}: ${err.message}`
  );
  return { success: false, errors };
}

/**
 * CronRunリクエストをバリデーション
 */
export function validateCronRunRequest(
  data: unknown
): ValidationResult<CronRunRequest> {
  const result = CronRunRequestSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors.map(
    (err) => `${err.path.join(".")}: ${err.message}`
  );
  return { success: false, errors };
}

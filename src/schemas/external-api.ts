/**
 * 外部API応答のZodスキーマ定義
 *
 * Amazon Ads API, BigQueryの応答を型安全に検証する
 */

import { z } from "zod";

// =============================================================================
// Amazon Ads API スキーマ
// =============================================================================

/**
 * Amazon Ads キーワードレポート行
 */
export const AmazonKeywordReportSchema = z.object({
  keywordId: z.union([z.string(), z.number()]).transform(String),
  campaignId: z.union([z.string(), z.number()]).transform(String),
  adGroupId: z.union([z.string(), z.number()]).transform(String),
  keywordText: z.string(),
  matchType: z.enum(["BROAD", "PHRASE", "EXACT"]),
  state: z.enum(["ENABLED", "PAUSED", "ARCHIVED"]).optional(),
  bid: z.number().nonnegative().optional(),
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  cost: z.number().nonnegative().default(0),
  attributedConversions14d: z.number().nonnegative().default(0),
  attributedSales14d: z.number().nonnegative().default(0),
});

export type AmazonKeywordReport = z.infer<typeof AmazonKeywordReportSchema>;

/**
 * Amazon Ads 検索語句レポート行
 */
export const AmazonSearchTermReportSchema = z.object({
  searchTerm: z.string(),
  keywordId: z.union([z.string(), z.number()]).transform(String).optional(),
  campaignId: z.union([z.string(), z.number()]).transform(String),
  adGroupId: z.union([z.string(), z.number()]).transform(String),
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  cost: z.number().nonnegative().default(0),
  attributedConversions14d: z.number().nonnegative().default(0),
  attributedSales14d: z.number().nonnegative().default(0),
});

export type AmazonSearchTermReport = z.infer<typeof AmazonSearchTermReportSchema>;

/**
 * Amazon Ads キーワード作成結果
 */
export const AmazonKeywordCreationResultSchema = z.object({
  keywordId: z.union([z.string(), z.number()]).transform(String),
  code: z.string().optional(),
  description: z.string().optional(),
});

export type AmazonKeywordCreationResult = z.infer<typeof AmazonKeywordCreationResultSchema>;

/**
 * Amazon Ads ネガティブキーワード作成結果
 */
export const AmazonNegativeKeywordCreationResultSchema = z.object({
  keywordId: z.union([z.string(), z.number()]).transform(String),
  code: z.string().optional(),
  description: z.string().optional(),
});

export type AmazonNegativeKeywordCreationResult = z.infer<typeof AmazonNegativeKeywordCreationResultSchema>;

/**
 * Amazon Ads バッチ操作エラー
 */
export const AmazonBatchErrorSchema = z.object({
  index: z.number(),
  code: z.string(),
  details: z.string().optional(),
});

export type AmazonBatchError = z.infer<typeof AmazonBatchErrorSchema>;

/**
 * Amazon Ads トークン応答
 */
export const AmazonTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});

export type AmazonTokenResponse = z.infer<typeof AmazonTokenResponseSchema>;

// =============================================================================
// BigQuery 応答スキーマ
// =============================================================================

/**
 * BigQuery キーワードメトリクス行
 */
export const BigQueryKeywordMetricsSchema = z.object({
  keyword_id: z.string(),
  campaign_id: z.string(),
  ad_group_id: z.string(),
  keyword_text: z.string().optional(),
  match_type: z.string().optional(),
  current_bid: z.number().nonnegative().optional(),
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  cost: z.number().nonnegative().default(0),
  conversions: z.number().nonnegative().default(0),
  sales: z.number().nonnegative().default(0),
  cvr: z.number().nonnegative().optional(),
  acos: z.number().nonnegative().optional(),
  cpc: z.number().nonnegative().optional(),
});

export type BigQueryKeywordMetrics = z.infer<typeof BigQueryKeywordMetricsSchema>;

/**
 * BigQuery ネガティブキーワード候補行
 */
export const BigQueryNegativeSuggestionSchema = z.object({
  suggestion_id: z.string(),
  execution_id: z.string(),
  asin: z.string(),
  query: z.string(),
  match_type: z.enum(["AUTO", "PHRASE", "EXACT"]),
  campaign_id: z.string().nullable().optional(),
  ad_group_id: z.string().nullable().optional(),
  role: z.enum(["GENERIC", "BRAND_OWN", "BRAND_CONQUEST", "OTHER"]),
  clicks_30d: z.number().nonnegative().default(0),
  conversions_30d: z.number().nonnegative().default(0),
  cost_30d: z.number().nonnegative().default(0),
  cvr_30d: z.number().nonnegative().nullable().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "APPLIED"]),
  is_applied: z.boolean().default(false),
  reason_codes: z.array(z.string()).default([]),
});

export type BigQueryNegativeSuggestion = z.infer<typeof BigQueryNegativeSuggestionSchema>;

/**
 * BigQuery AUTO→EXACT昇格候補行
 */
export const BigQueryAutoExactSuggestionSchema = z.object({
  suggestion_id: z.string(),
  execution_id: z.string(),
  profile_id: z.string().nullable().optional(),
  asin: z.string(),
  search_term: z.string(),
  campaign_id_auto: z.string(),
  ad_group_id_auto: z.string(),
  campaign_id_manual_target: z.string().nullable().optional(),
  ad_group_id_manual_target: z.string().nullable().optional(),
  cvr: z.number().nonnegative().default(0),
  acos: z.number().nonnegative().default(0),
  target_acos: z.number().nonnegative().default(0.2),
  score: z.number().default(0),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "APPLIED"]),
  is_applied: z.boolean().default(false),
  recommended_bid: z.number().nonnegative().nullable().optional(),
});

export type BigQueryAutoExactSuggestion = z.infer<typeof BigQueryAutoExactSuggestionSchema>;

/**
 * BigQuery 実行ログ行
 */
export const BigQueryExecutionLogSchema = z.object({
  execution_id: z.string(),
  execution_mode: z.enum(["SHADOW", "APPLY"]),
  status: z.enum(["RUNNING", "SUCCESS", "FAILED", "PARTIAL"]),
  started_at: z.union([z.string(), z.date()]).transform((v) => new Date(v)),
  completed_at: z.union([z.string(), z.date()]).transform((v) => new Date(v)).nullable().optional(),
  total_keywords: z.number().nonnegative().default(0),
  processed_keywords: z.number().nonnegative().default(0),
  recommended_changes: z.number().nonnegative().default(0),
  error_message: z.string().nullable().optional(),
});

export type BigQueryExecutionLog = z.infer<typeof BigQueryExecutionLogSchema>;

// =============================================================================
// 派生値検証ユーティリティ
// =============================================================================

/**
 * CVRの妥当性を検証（0〜100%）
 */
export function validateCvr(cvr: number, fieldName: string = "cvr"): void {
  if (cvr < 0 || cvr > 1) {
    throw new Error(`${fieldName} must be between 0 and 1 (got ${cvr})`);
  }
}

/**
 * ACOSの妥当性を検証（0〜無限大、ただし1000%超は警告）
 */
export function validateAcos(acos: number, fieldName: string = "acos"): void {
  if (acos < 0) {
    throw new Error(`${fieldName} must be non-negative (got ${acos})`);
  }
  if (acos > 10) {
    // 1000%超は異常値の可能性
    console.warn(`Warning: ${fieldName} is unusually high (${acos * 100}%)`);
  }
}

/**
 * 入札額の妥当性を検証（Amazon Adsの制限: 2〜100000円）
 */
export function validateBid(bid: number, fieldName: string = "bid"): void {
  if (bid < 2 || bid > 100000) {
    throw new Error(`${fieldName} must be between 2 and 100000 (got ${bid})`);
  }
}

/**
 * スコアの妥当性を検証（0〜100）
 */
export function validateScore(score: number, fieldName: string = "score"): void {
  if (score < 0 || score > 100) {
    throw new Error(`${fieldName} must be between 0 and 100 (got ${score})`);
  }
}

// =============================================================================
// 配列検証ヘルパー
// =============================================================================

/**
 * 配列を安全にパース
 */
export function safeParseArray<T>(
  schema: z.ZodSchema<T>,
  data: unknown[],
  options?: { skipInvalid?: boolean }
): { valid: T[]; invalid: { index: number; error: z.ZodError }[] } {
  const valid: T[] = [];
  const invalid: { index: number; error: z.ZodError }[] = [];

  for (let i = 0; i < data.length; i++) {
    const result = schema.safeParse(data[i]);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ index: i, error: result.error });
      if (!options?.skipInvalid) {
        break; // デフォルトでは最初のエラーで停止
      }
    }
  }

  return { valid, invalid };
}

/**
 * 必須フィールドが揃っているか確認
 */
export function hasRequiredFields(
  obj: Record<string, unknown>,
  fields: string[]
): boolean {
  return fields.every((field) => obj[field] !== undefined && obj[field] !== null);
}

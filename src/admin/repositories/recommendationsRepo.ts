/**
 * recommendations リポジトリ
 *
 * AdminJS用の入札提案ログ閲覧（読み取り専用）
 */

import { executeQuery, getFullTableName } from "../../bigquery/client";
import { logger } from "../../logger";

// =============================================================================
// 型定義
// =============================================================================

export interface Recommendation {
  id: string;
  execution_id: string;
  profile_id: string;
  campaign_id: string;
  ad_group_id: string;
  keyword_id: string;
  keyword_text: string | null;
  match_type: string | null;
  asin: string | null;
  lifecycle_state: string | null;
  target_acos: number | null;
  current_bid: number;
  recommended_bid: number;
  bid_change: number;
  bid_change_ratio: number;
  reason_codes: string | null;
  impressions: number | null;
  clicks: number | null;
  orders: number | null;
  sales: number | null;
  cost: number | null;
  cvr: number | null;
  acos: number | null;
  created_at: string;
}

export interface RecommendationFilter {
  execution_id?: string;
  profile_id?: string;
  asin?: string;
  keyword_text?: string;
  lifecycle_state?: string;
}

// =============================================================================
// リポジトリ関数
// =============================================================================

/**
 * recommendations 一覧を取得
 */
export async function listRecommendations(
  limit: number = 50,
  offset: number = 0,
  filters?: RecommendationFilter
): Promise<{ records: Recommendation[]; total: number }> {
  const tableName = getFullTableName("bid_recommendations");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };

  if (filters?.execution_id) {
    conditions.push("execution_id = @execution_id");
    params.execution_id = filters.execution_id;
  }
  if (filters?.profile_id) {
    conditions.push("profile_id = @profile_id");
    params.profile_id = filters.profile_id;
  }
  if (filters?.asin) {
    conditions.push("asin LIKE @asin");
    params.asin = `%${filters.asin}%`;
  }
  if (filters?.keyword_text) {
    conditions.push("keyword_text LIKE @keyword_text");
    params.keyword_text = `%${filters.keyword_text}%`;
  }
  if (filters?.lifecycle_state) {
    conditions.push("lifecycle_state = @lifecycle_state");
    params.lifecycle_state = filters.lifecycle_state;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // 総件数を取得
  const countQuery = `
    SELECT COUNT(*) as total
    FROM \`${tableName}\`
    ${whereClause}
  `;
  const countResult = await executeQuery<{ total: number }>(countQuery, params);
  const total = countResult[0]?.total || 0;

  // データを取得（必要なカラムのみ）
  const dataQuery = `
    SELECT
      CONCAT(execution_id, '_', keyword_id) as id,
      execution_id,
      profile_id,
      campaign_id,
      ad_group_id,
      keyword_id,
      keyword_text,
      match_type,
      asin,
      lifecycle_state,
      target_acos,
      current_bid,
      recommended_bid,
      bid_change,
      bid_change_ratio,
      reason_codes,
      impressions,
      clicks,
      orders,
      sales,
      cost,
      cvr,
      acos,
      CAST(created_at AS STRING) as created_at
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT @limit
    OFFSET @offset
  `;

  const records = await executeQuery<Recommendation>(dataQuery, params);

  logger.debug("listRecommendations", { limit, offset, filters, total, count: records.length });

  return { records, total };
}

/**
 * IDで recommendation を取得
 */
export async function getRecommendation(id: string): Promise<Recommendation | null> {
  // IDは execution_id_keyword_id 形式
  const parts = id.split("_");
  if (parts.length < 2) {
    return null;
  }

  const executionId = parts[0];
  const keywordId = parts.slice(1).join("_");

  const tableName = getFullTableName("bid_recommendations");

  const query = `
    SELECT
      CONCAT(execution_id, '_', keyword_id) as id,
      execution_id,
      profile_id,
      campaign_id,
      ad_group_id,
      keyword_id,
      keyword_text,
      match_type,
      asin,
      lifecycle_state,
      target_acos,
      current_bid,
      recommended_bid,
      bid_change,
      bid_change_ratio,
      reason_codes,
      impressions,
      clicks,
      orders,
      sales,
      cost,
      cvr,
      acos,
      CAST(created_at AS STRING) as created_at
    FROM \`${tableName}\`
    WHERE execution_id = @execution_id AND keyword_id = @keyword_id
    LIMIT 1
  `;

  const records = await executeQuery<Recommendation>(query, {
    execution_id: executionId,
    keyword_id: keywordId,
  });

  return records[0] || null;
}

/**
 * recommendations の総件数を取得
 */
export async function countRecommendations(filters?: RecommendationFilter): Promise<number> {
  const tableName = getFullTableName("bid_recommendations");

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.execution_id) {
    conditions.push("execution_id = @execution_id");
    params.execution_id = filters.execution_id;
  }
  if (filters?.profile_id) {
    conditions.push("profile_id = @profile_id");
    params.profile_id = filters.profile_id;
  }
  if (filters?.asin) {
    conditions.push("asin LIKE @asin");
    params.asin = `%${filters.asin}%`;
  }
  if (filters?.keyword_text) {
    conditions.push("keyword_text LIKE @keyword_text");
    params.keyword_text = `%${filters.keyword_text}%`;
  }
  if (filters?.lifecycle_state) {
    conditions.push("lifecycle_state = @lifecycle_state");
    params.lifecycle_state = filters.lifecycle_state;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT COUNT(*) as total
    FROM \`${tableName}\`
    ${whereClause}
  `;

  const result = await executeQuery<{ total: number }>(query, params);
  return result[0]?.total || 0;
}

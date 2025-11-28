/**
 * negative_candidates_shadow リポジトリ
 *
 * AdminJS用のネガティブ候補閲覧（読み取り専用）
 * analytics_views データセットからの参照
 */

import { executeQuery, getFullTableName } from "../../bigquery/client";
import { logger } from "../../logger";

// =============================================================================
// 型定義
// =============================================================================

export interface NegativeCandidate {
  id: string;
  execution_id: string;
  profile_id: string;
  campaign_id: string;
  ad_group_id: string;
  keyword_id: string;
  keyword_text: string | null;
  match_type: string | null;
  asin: string | null;
  reason_code: string | null;
  score: number | null;
  clicks_7d: number | null;
  orders_7d: number | null;
  acos_7d: number | null;
  cost_7d: number | null;
  status: string | null;
  created_at: string;
}

export interface NegativeCandidateFilter {
  execution_id?: string;
  profile_id?: string;
  asin?: string;
  keyword_text?: string;
  status?: string;
  reason_code?: string;
}

// =============================================================================
// リポジトリ関数
// =============================================================================

/**
 * negative_candidates_shadow 一覧を取得
 */
export async function listNegativeCandidates(
  limit: number = 50,
  offset: number = 0,
  filters?: NegativeCandidateFilter
): Promise<{ records: NegativeCandidate[]; total: number }> {
  // analytics_views データセットを使用
  const tableName = getFullTableName("negative_candidates_shadow", "analytics_views");

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
  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.reason_code) {
    conditions.push("reason_code = @reason_code");
    params.reason_code = filters.reason_code;
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

  // データを取得
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
      reason_code,
      score,
      clicks_7d,
      orders_7d,
      acos_7d,
      cost_7d,
      status,
      CAST(created_at AS STRING) as created_at
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT @limit
    OFFSET @offset
  `;

  const records = await executeQuery<NegativeCandidate>(dataQuery, params);

  logger.debug("listNegativeCandidates", { limit, offset, filters, total, count: records.length });

  return { records, total };
}

/**
 * IDで negative_candidate を取得
 */
export async function getNegativeCandidate(id: string): Promise<NegativeCandidate | null> {
  // IDは execution_id_keyword_id 形式
  const parts = id.split("_");
  if (parts.length < 2) {
    return null;
  }

  const executionId = parts[0];
  const keywordId = parts.slice(1).join("_");

  const tableName = getFullTableName("negative_candidates_shadow", "analytics_views");

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
      reason_code,
      score,
      clicks_7d,
      orders_7d,
      acos_7d,
      cost_7d,
      status,
      CAST(created_at AS STRING) as created_at
    FROM \`${tableName}\`
    WHERE execution_id = @execution_id AND keyword_id = @keyword_id
    LIMIT 1
  `;

  const records = await executeQuery<NegativeCandidate>(query, {
    execution_id: executionId,
    keyword_id: keywordId,
  });

  return records[0] || null;
}

/**
 * negative_candidates_shadow の総件数を取得
 */
export async function countNegativeCandidates(filters?: NegativeCandidateFilter): Promise<number> {
  const tableName = getFullTableName("negative_candidates_shadow", "analytics_views");

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
  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.reason_code) {
    conditions.push("reason_code = @reason_code");
    params.reason_code = filters.reason_code;
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

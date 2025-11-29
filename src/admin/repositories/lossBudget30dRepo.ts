/**
 * loss_budget_30d リポジトリ
 *
 * AdminJS用の30日間予算・損失モニタ閲覧（読み取り専用）
 */

import { executeQuery, getFullTableName } from "../../bigquery/client";
import { logger } from "../../logger";

// =============================================================================
// 型定義
// =============================================================================

export interface LossBudget30d {
  asin: string;
  period_start: string;
  period_end: string;
  lifecycle_stage: string | null;
  sales_30d: number | null;
  ad_cost_30d: number | null;
  net_profit_real_30d: number | null;
  net_profit_target_30d: number | null;
  loss_gap_30d: number | null;
  loss_budget_allowed_30d: number | null;
  loss_budget_consumption_30d: number | null;
  investment_state: string | null;
  tacos_30d: number | null;
  acos_30d: number | null;
  calculated_at: string;
}

export interface LossBudget30dFilter {
  asin?: string;
  lifecycle_stage?: string;
  investment_state?: string;
}

// =============================================================================
// リポジトリ関数
// =============================================================================

/**
 * loss_budget_30d 一覧を取得
 */
export async function listLossBudget30d(
  limit: number = 50,
  offset: number = 0,
  filters?: LossBudget30dFilter
): Promise<{ records: LossBudget30d[]; total: number }> {
  const tableName = getFullTableName("loss_budget_30d");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };

  if (filters?.asin) {
    conditions.push("asin LIKE @asin");
    params.asin = `%${filters.asin}%`;
  }
  if (filters?.lifecycle_stage) {
    conditions.push("lifecycle_stage = @lifecycle_stage");
    params.lifecycle_stage = filters.lifecycle_stage;
  }
  if (filters?.investment_state) {
    conditions.push("investment_state = @investment_state");
    params.investment_state = filters.investment_state;
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
      asin,
      CAST(period_start AS STRING) as period_start,
      CAST(period_end AS STRING) as period_end,
      lifecycle_stage,
      sales_30d,
      ad_cost_30d,
      net_profit_real_30d,
      net_profit_target_30d,
      loss_gap_30d,
      loss_budget_allowed_30d,
      loss_budget_consumption_30d,
      investment_state,
      tacos_30d,
      acos_30d,
      CAST(calculated_at AS STRING) as calculated_at
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY calculated_at DESC
    LIMIT @limit
    OFFSET @offset
  `;

  const records = await executeQuery<LossBudget30d>(dataQuery, params);

  logger.debug("listLossBudget30d", { limit, offset, filters, total, count: records.length });

  return { records, total };
}

/**
 * ASINで loss_budget_30d を取得
 */
export async function getLossBudget30d(asin: string): Promise<LossBudget30d | null> {
  const tableName = getFullTableName("loss_budget_30d");

  const query = `
    SELECT
      asin,
      CAST(period_start AS STRING) as period_start,
      CAST(period_end AS STRING) as period_end,
      lifecycle_stage,
      sales_30d,
      ad_cost_30d,
      net_profit_real_30d,
      net_profit_target_30d,
      loss_gap_30d,
      loss_budget_allowed_30d,
      loss_budget_consumption_30d,
      investment_state,
      tacos_30d,
      acos_30d,
      CAST(calculated_at AS STRING) as calculated_at
    FROM \`${tableName}\`
    WHERE asin = @asin
    ORDER BY calculated_at DESC
    LIMIT 1
  `;

  const records = await executeQuery<LossBudget30d>(query, { asin });

  return records[0] || null;
}

/**
 * loss_budget_30d の総件数を取得
 */
export async function countLossBudget30d(filters?: LossBudget30dFilter): Promise<number> {
  const tableName = getFullTableName("loss_budget_30d");

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.asin) {
    conditions.push("asin LIKE @asin");
    params.asin = `%${filters.asin}%`;
  }
  if (filters?.lifecycle_stage) {
    conditions.push("lifecycle_stage = @lifecycle_stage");
    params.lifecycle_stage = filters.lifecycle_stage;
  }
  if (filters?.investment_state) {
    conditions.push("investment_state = @investment_state");
    params.investment_state = filters.investment_state;
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

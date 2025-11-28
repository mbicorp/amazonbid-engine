/**
 * loss_budget_7d リポジトリ
 *
 * AdminJS用の予算・損失モニタ閲覧（読み取り専用）
 */

import { executeQuery, getFullTableName } from "../../bigquery/client";
import { logger } from "../../logger";

// =============================================================================
// 型定義
// =============================================================================

export interface LossBudget7d {
  asin: string;
  profile_id: string;
  loss_budget: number | null;
  loss_so_far: number | null;
  ratio_stage: number | null;
  investment_state: string | null;
  rolling_loss_7d: number | null;
  rolling_budget_7d: number | null;
  rolling_ratio: number | null;
  calculated_at: string;
}

export interface LossBudgetFilter {
  asin?: string;
  profile_id?: string;
  investment_state?: string;
}

// =============================================================================
// リポジトリ関数
// =============================================================================

/**
 * loss_budget_7d 一覧を取得
 */
export async function listLossBudget(
  limit: number = 50,
  offset: number = 0,
  filters?: LossBudgetFilter
): Promise<{ records: LossBudget7d[]; total: number }> {
  const tableName = getFullTableName("loss_budget_7d");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };

  if (filters?.asin) {
    conditions.push("asin LIKE @asin");
    params.asin = `%${filters.asin}%`;
  }
  if (filters?.profile_id) {
    conditions.push("profile_id = @profile_id");
    params.profile_id = filters.profile_id;
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
      profile_id,
      loss_budget,
      loss_so_far,
      ratio_stage,
      investment_state,
      rolling_loss_7d,
      rolling_budget_7d,
      rolling_ratio,
      CAST(calculated_at AS STRING) as calculated_at
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY calculated_at DESC
    LIMIT @limit
    OFFSET @offset
  `;

  const records = await executeQuery<LossBudget7d>(dataQuery, params);

  logger.debug("listLossBudget", { limit, offset, filters, total, count: records.length });

  return { records, total };
}

/**
 * ASINで loss_budget_7d を取得
 */
export async function getLossBudget(asin: string): Promise<LossBudget7d | null> {
  const tableName = getFullTableName("loss_budget_7d");

  const query = `
    SELECT
      asin,
      profile_id,
      loss_budget,
      loss_so_far,
      ratio_stage,
      investment_state,
      rolling_loss_7d,
      rolling_budget_7d,
      rolling_ratio,
      CAST(calculated_at AS STRING) as calculated_at
    FROM \`${tableName}\`
    WHERE asin = @asin
    ORDER BY calculated_at DESC
    LIMIT 1
  `;

  const records = await executeQuery<LossBudget7d>(query, { asin });

  return records[0] || null;
}

/**
 * loss_budget_7d の総件数を取得
 */
export async function countLossBudget(filters?: LossBudgetFilter): Promise<number> {
  const tableName = getFullTableName("loss_budget_7d");

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.asin) {
    conditions.push("asin LIKE @asin");
    params.asin = `%${filters.asin}%`;
  }
  if (filters?.profile_id) {
    conditions.push("profile_id = @profile_id");
    params.profile_id = filters.profile_id;
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

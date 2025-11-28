/**
 * executions リポジトリ
 *
 * AdminJS用の実行ログ閲覧（読み取り専用）
 */

import { executeQuery, getFullTableName } from "../../bigquery/client";
import { logger } from "../../logger";

// =============================================================================
// 型定義
// =============================================================================

export interface Execution {
  execution_id: string;
  profile_id: string;
  mode: string;
  execution_type: string;
  trigger_type: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  total_keywords: number;
  reco_count: number;
  action_strong_up: number;
  action_up: number;
  action_down: number;
  action_stop: number;
  action_keep: number;
  status: string;
  error_message: string | null;
  note: string | null;
}

export interface ExecutionFilter {
  execution_id?: string;
  profile_id?: string;
  mode?: string;
  status?: string;
  execution_type?: string;
}

// =============================================================================
// リポジトリ関数
// =============================================================================

/**
 * executions 一覧を取得
 */
export async function listExecutions(
  limit: number = 50,
  offset: number = 0,
  filters?: ExecutionFilter
): Promise<{ records: Execution[]; total: number }> {
  const tableName = getFullTableName("executions");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };

  if (filters?.execution_id) {
    conditions.push("execution_id LIKE @execution_id");
    params.execution_id = `%${filters.execution_id}%`;
  }
  if (filters?.profile_id) {
    conditions.push("profile_id = @profile_id");
    params.profile_id = filters.profile_id;
  }
  if (filters?.mode) {
    conditions.push("mode = @mode");
    params.mode = filters.mode;
  }
  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.execution_type) {
    conditions.push("execution_type = @execution_type");
    params.execution_type = filters.execution_type;
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
      execution_id,
      profile_id,
      mode,
      execution_type,
      trigger_type,
      CAST(started_at AS STRING) as started_at,
      CAST(ended_at AS STRING) as ended_at,
      duration_ms,
      total_keywords,
      reco_count,
      action_strong_up,
      action_up,
      action_down,
      action_stop,
      action_keep,
      status,
      error_message,
      note
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY started_at DESC
    LIMIT @limit
    OFFSET @offset
  `;

  const records = await executeQuery<Execution>(dataQuery, params);

  logger.debug("listExecutions", { limit, offset, filters, total, count: records.length });

  return { records, total };
}

/**
 * 実行IDで execution を取得
 */
export async function getExecution(executionId: string): Promise<Execution | null> {
  const tableName = getFullTableName("executions");

  const query = `
    SELECT
      execution_id,
      profile_id,
      mode,
      execution_type,
      trigger_type,
      CAST(started_at AS STRING) as started_at,
      CAST(ended_at AS STRING) as ended_at,
      duration_ms,
      total_keywords,
      reco_count,
      action_strong_up,
      action_up,
      action_down,
      action_stop,
      action_keep,
      status,
      error_message,
      note
    FROM \`${tableName}\`
    WHERE execution_id = @execution_id
    LIMIT 1
  `;

  const records = await executeQuery<Execution>(query, { execution_id: executionId });

  return records[0] || null;
}

/**
 * executions の総件数を取得
 */
export async function countExecutions(filters?: ExecutionFilter): Promise<number> {
  const tableName = getFullTableName("executions");

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.execution_id) {
    conditions.push("execution_id LIKE @execution_id");
    params.execution_id = `%${filters.execution_id}%`;
  }
  if (filters?.profile_id) {
    conditions.push("profile_id = @profile_id");
    params.profile_id = filters.profile_id;
  }
  if (filters?.mode) {
    conditions.push("mode = @mode");
    params.mode = filters.mode;
  }
  if (filters?.status) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters?.execution_type) {
    conditions.push("execution_type = @execution_type");
    params.execution_type = filters.execution_type;
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

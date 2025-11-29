/**
 * SHADOW評価リポジトリ
 *
 * shadow_eval_keyword_7d ビューからデータを取得し、
 * SHADOWモードの入札提案と実績の乖離を分析するためのリポジトリ
 */

import { executeQuery, getFullTableName } from "../../bigquery/client";
import { logger } from "../../logger";

// =============================================================================
// 型定義
// =============================================================================

/**
 * SHADOW評価行
 */
export interface ShadowEvalRow {
  execution_id: string;
  mode: string;
  asin: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  keyword_id: string | null;
  keyword_text: string;
  match_type: string | null;
  bid_recommended: number;
  bid_actual: number;
  bid_gap: number;
  bid_gap_rate: number | null;
  clicks: number;
  orders: number;
  sales: number;
  cost: number;
  acos: number | null;
  tacos: number | null;
  net_profit: number;
  direction: string;
  lifecycle_stage: string | null;
  was_good_decision: boolean | null;
  reason_code: string | null;
  target_acos: number | null;
  recommended_at: string;
}

/**
 * SHADOW評価リストのパラメータ
 */
export interface ShadowEvalListParams {
  /** 表示件数（デフォルト: 50） */
  limit?: number;
  /** 実行ID（任意） */
  executionId?: string;
  /** ライフサイクルステージ（任意） */
  lifecycleStage?: string;
  /** 提案が外れたケースのみ（任意） */
  onlyBad?: boolean;
  /** 推奨方向でフィルタ（UP/DOWN/KEEP） */
  direction?: string;
}

// =============================================================================
// リポジトリ関数
// =============================================================================

/**
 * SHADOW評価データの一覧を取得
 */
export async function listShadowEval(
  params: ShadowEvalListParams = {}
): Promise<ShadowEvalRow[]> {
  const { limit = 50, executionId, lifecycleStage, onlyBad, direction } = params;
  const tableName = getFullTableName("shadow_eval_keyword_7d");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const queryParams: Record<string, unknown> = { limit };

  if (executionId) {
    conditions.push("execution_id = @executionId");
    queryParams.executionId = executionId;
  }

  if (lifecycleStage) {
    conditions.push("lifecycle_stage = @lifecycleStage");
    queryParams.lifecycleStage = lifecycleStage;
  }

  if (onlyBad) {
    conditions.push("was_good_decision = FALSE");
  }

  if (direction) {
    conditions.push("direction = @direction");
    queryParams.direction = direction;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT
      execution_id,
      mode,
      asin,
      campaign_id,
      ad_group_id,
      keyword_id,
      keyword_text,
      match_type,
      bid_recommended,
      bid_actual,
      bid_gap,
      bid_gap_rate,
      clicks,
      orders,
      sales,
      cost,
      acos,
      tacos,
      net_profit,
      direction,
      lifecycle_stage,
      was_good_decision,
      reason_code,
      target_acos,
      CAST(recommended_at AS STRING) AS recommended_at
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY recommended_at DESC
    LIMIT @limit
  `;

  try {
    const rows = await executeQuery<ShadowEvalRow>(query, queryParams);
    logger.debug("listShadowEval", { params, count: rows.length });
    return rows;
  } catch (error) {
    logger.error("Failed to list shadow eval", {
      error: error instanceof Error ? error.message : String(error),
      params,
    });
    throw error;
  }
}

/**
 * SHADOW評価データの件数を取得
 */
export async function countShadowEval(
  params: ShadowEvalListParams = {}
): Promise<number> {
  const { executionId, lifecycleStage, onlyBad, direction } = params;
  const tableName = getFullTableName("shadow_eval_keyword_7d");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const queryParams: Record<string, unknown> = {};

  if (executionId) {
    conditions.push("execution_id = @executionId");
    queryParams.executionId = executionId;
  }

  if (lifecycleStage) {
    conditions.push("lifecycle_stage = @lifecycleStage");
    queryParams.lifecycleStage = lifecycleStage;
  }

  if (onlyBad) {
    conditions.push("was_good_decision = FALSE");
  }

  if (direction) {
    conditions.push("direction = @direction");
    queryParams.direction = direction;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT COUNT(*) AS total
    FROM \`${tableName}\`
    ${whereClause}
  `;

  try {
    const result = await executeQuery<{ total: number }>(query, queryParams);
    const total = result[0]?.total || 0;
    logger.debug("countShadowEval", { params, total });
    return total;
  } catch (error) {
    logger.error("Failed to count shadow eval", {
      error: error instanceof Error ? error.message : String(error),
      params,
    });
    throw error;
  }
}

/**
 * SHADOW評価の方向別精度サマリーを取得
 */
export async function getShadowEvalAccuracySummary(): Promise<
  Array<{
    direction: string;
    good_count: number;
    total: number;
    accuracy: number | null;
  }>
> {
  const tableName = getFullTableName("shadow_eval_keyword_7d");

  const query = `
    SELECT
      direction,
      COUNTIF(was_good_decision) AS good_count,
      COUNT(*) AS total,
      SAFE_DIVIDE(COUNTIF(was_good_decision), COUNT(*)) AS accuracy
    FROM \`${tableName}\`
    WHERE was_good_decision IS NOT NULL
    GROUP BY direction
    ORDER BY direction
  `;

  try {
    const result = await executeQuery<{
      direction: string;
      good_count: number;
      total: number;
      accuracy: number | null;
    }>(query, {});
    logger.debug("getShadowEvalAccuracySummary", { result });
    return result;
  } catch (error) {
    logger.error("Failed to get shadow eval accuracy summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

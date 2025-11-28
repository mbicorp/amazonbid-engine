/**
 * product_config リポジトリ
 *
 * AdminJS用のproduct_configテーブル操作
 * 編集可能カラム: lifecycle_stage, target_tacos, max_bid, profile_type
 */

import { executeQuery, executeDml, getFullTableName } from "../../bigquery/client";
import { logger } from "../../logger";

// =============================================================================
// 型定義
// =============================================================================

export interface ProductConfig {
  asin: string;
  is_active: boolean;
  revenue_model: string;
  lifecycle_state: string;
  margin_rate: number | null;
  expected_repeat_orders_assumed: number | null;
  launch_date: string | null;
  target_tacos: number | null;
  max_bid: number | null;
  profile_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductConfigFilter {
  asin?: string;
  is_active?: boolean;
  lifecycle_state?: string;
  profile_type?: string;
}

export interface ProductConfigUpdate {
  lifecycle_state?: string;
  target_tacos?: number;
  max_bid?: number;
  profile_type?: string;
}

// =============================================================================
// バリデーション
// =============================================================================

const VALID_LIFECYCLE_STATES = ["LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"];
const VALID_PROFILE_TYPES = ["STANDARD", "AGGRESSIVE", "CONSERVATIVE", "CUSTOM"];

export function validateProductConfigUpdate(update: ProductConfigUpdate): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (update.lifecycle_state !== undefined) {
    if (!VALID_LIFECYCLE_STATES.includes(update.lifecycle_state)) {
      errors.push(`lifecycle_state must be one of: ${VALID_LIFECYCLE_STATES.join(", ")}`);
    }
  }

  if (update.target_tacos !== undefined) {
    if (typeof update.target_tacos !== "number" || update.target_tacos < 0 || update.target_tacos > 1) {
      errors.push("target_tacos must be a number between 0 and 1");
    }
  }

  if (update.max_bid !== undefined) {
    if (typeof update.max_bid !== "number" || update.max_bid < 0 || update.max_bid > 5) {
      errors.push("max_bid must be a number between 0 and 5");
    }
  }

  if (update.profile_type !== undefined) {
    if (!VALID_PROFILE_TYPES.includes(update.profile_type)) {
      errors.push(`profile_type must be one of: ${VALID_PROFILE_TYPES.join(", ")}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// リポジトリ関数
// =============================================================================

/**
 * product_config 一覧を取得
 */
export async function listProductConfig(
  limit: number = 50,
  offset: number = 0,
  filters?: ProductConfigFilter
): Promise<{ records: ProductConfig[]; total: number }> {
  const tableName = getFullTableName("product_config");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };

  if (filters?.asin) {
    conditions.push("asin LIKE @asin");
    params.asin = `%${filters.asin}%`;
  }
  if (filters?.is_active !== undefined) {
    conditions.push("is_active = @is_active");
    params.is_active = filters.is_active;
  }
  if (filters?.lifecycle_state) {
    conditions.push("lifecycle_state = @lifecycle_state");
    params.lifecycle_state = filters.lifecycle_state;
  }
  if (filters?.profile_type) {
    conditions.push("profile_type = @profile_type");
    params.profile_type = filters.profile_type;
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
      is_active,
      revenue_model,
      lifecycle_state,
      margin_rate,
      expected_repeat_orders_assumed,
      CAST(launch_date AS STRING) as launch_date,
      target_tacos,
      max_bid,
      profile_type,
      CAST(created_at AS STRING) as created_at,
      CAST(updated_at AS STRING) as updated_at
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT @limit
    OFFSET @offset
  `;

  const records = await executeQuery<ProductConfig>(dataQuery, params);

  logger.debug("listProductConfig", { limit, offset, filters, total, count: records.length });

  return { records, total };
}

/**
 * ASIN で product_config を取得
 */
export async function getProductConfigByAsin(asin: string): Promise<ProductConfig | null> {
  const tableName = getFullTableName("product_config");

  const query = `
    SELECT
      asin,
      is_active,
      revenue_model,
      lifecycle_state,
      margin_rate,
      expected_repeat_orders_assumed,
      CAST(launch_date AS STRING) as launch_date,
      target_tacos,
      max_bid,
      profile_type,
      CAST(created_at AS STRING) as created_at,
      CAST(updated_at AS STRING) as updated_at
    FROM \`${tableName}\`
    WHERE asin = @asin
    LIMIT 1
  `;

  const records = await executeQuery<ProductConfig>(query, { asin });

  return records[0] || null;
}

/**
 * product_config を更新（編集可能カラムのみ）
 */
export async function updateProductConfig(
  asin: string,
  update: ProductConfigUpdate
): Promise<{ success: boolean; affectedRows: number; error?: string }> {
  // バリデーション
  const validation = validateProductConfigUpdate(update);
  if (!validation.valid) {
    return { success: false, affectedRows: 0, error: validation.errors.join("; ") };
  }

  const tableName = getFullTableName("product_config");

  // 更新するカラムを構築（編集可能カラムのみ）
  const setClauses: string[] = [];
  const params: Record<string, unknown> = { asin };

  if (update.lifecycle_state !== undefined) {
    setClauses.push("lifecycle_state = @lifecycle_state");
    params.lifecycle_state = update.lifecycle_state;
  }
  if (update.target_tacos !== undefined) {
    setClauses.push("target_tacos = @target_tacos");
    params.target_tacos = update.target_tacos;
  }
  if (update.max_bid !== undefined) {
    setClauses.push("max_bid = @max_bid");
    params.max_bid = update.max_bid;
  }
  if (update.profile_type !== undefined) {
    setClauses.push("profile_type = @profile_type");
    params.profile_type = update.profile_type;
  }

  if (setClauses.length === 0) {
    return { success: false, affectedRows: 0, error: "No valid fields to update" };
  }

  // updated_at を更新
  setClauses.push("updated_at = CURRENT_DATETIME()");

  const query = `
    UPDATE \`${tableName}\`
    SET ${setClauses.join(", ")}
    WHERE asin = @asin
  `;

  try {
    const affectedRows = await executeDml(query, params);

    logger.info("updateProductConfig", { asin, update, affectedRows });

    return { success: true, affectedRows };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("updateProductConfig failed", { asin, update, error: errorMessage });
    return { success: false, affectedRows: 0, error: errorMessage };
  }
}

/**
 * product_config の総件数を取得
 */
export async function countProductConfig(filters?: ProductConfigFilter): Promise<number> {
  const tableName = getFullTableName("product_config");

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.asin) {
    conditions.push("asin LIKE @asin");
    params.asin = `%${filters.asin}%`;
  }
  if (filters?.is_active !== undefined) {
    conditions.push("is_active = @is_active");
    params.is_active = filters.is_active;
  }
  if (filters?.lifecycle_state) {
    conditions.push("lifecycle_state = @lifecycle_state");
    params.lifecycle_state = filters.lifecycle_state;
  }
  if (filters?.profile_type) {
    conditions.push("profile_type = @profile_type");
    params.profile_type = filters.profile_type;
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

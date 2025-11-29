/**
 * SHADOW日次サマリーリポジトリ
 *
 * daily_shadow_summary ビューからデータを取得し、
 * SHADOWモードの入札提案の日次精度を分析するためのリポジトリ
 */

import { executeQuery, getFullTableName } from "./client";
import { logger } from "../logger";

// =============================================================================
// 型定義
// =============================================================================

/**
 * SHADOW日次サマリー
 */
export interface DailyShadowSummary {
  /** 日付（YYYY-MM-DD形式） */
  date: string;
  /** 当該日のSHADOWモード実行回数 */
  shadowExecutions: number;
  /** 評価対象となった提案件数 */
  totalRecommendations: number;
  /** was_good_decision = FALSE の件数 */
  badRecommendations: number;
  /** 外れ率（0〜1） */
  badRate: number;
}

/**
 * SHADOW日次サマリー取得パラメータ
 */
export interface DailyShadowSummaryListParams {
  /** 取得日数（デフォルト: 30） */
  limit?: number;
}

// =============================================================================
// リポジトリ関数
// =============================================================================

/**
 * SHADOW日次サマリーの一覧を取得
 *
 * @param params 取得パラメータ
 * @returns 日次サマリーの配列（新しい日付順）
 */
export async function listDailyShadowSummary(
  params: DailyShadowSummaryListParams = {}
): Promise<DailyShadowSummary[]> {
  const { limit = 30 } = params;
  const tableName = getFullTableName("daily_shadow_summary");

  const query = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', date) AS date,
      shadow_executions AS shadowExecutions,
      total_recommendations AS totalRecommendations,
      bad_recommendations AS badRecommendations,
      COALESCE(bad_rate, 0) AS badRate
    FROM \`${tableName}\`
    ORDER BY date DESC
    LIMIT @limit
  `;

  try {
    const rows = await executeQuery<DailyShadowSummary>(query, { limit });
    logger.debug("listDailyShadowSummary", { params, count: rows.length });
    return rows;
  } catch (error) {
    logger.error("Failed to list daily shadow summary", {
      error: error instanceof Error ? error.message : String(error),
      params,
    });
    throw error;
  }
}

/**
 * 最新のSHADOW日次サマリーを取得
 *
 * @returns 最新1日分のサマリー、またはデータがない場合は null
 */
export async function getLatestDailyShadowSummary(): Promise<DailyShadowSummary | null> {
  const tableName = getFullTableName("daily_shadow_summary");

  const query = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', date) AS date,
      shadow_executions AS shadowExecutions,
      total_recommendations AS totalRecommendations,
      bad_recommendations AS badRecommendations,
      COALESCE(bad_rate, 0) AS badRate
    FROM \`${tableName}\`
    ORDER BY date DESC
    LIMIT 1
  `;

  try {
    const rows = await executeQuery<DailyShadowSummary>(query, {});
    const result = rows.length > 0 ? rows[0] : null;
    logger.debug("getLatestDailyShadowSummary", { result });
    return result;
  } catch (error) {
    logger.error("Failed to get latest daily shadow summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 期間内のSHADOW精度統計を取得
 *
 * @param days 集計対象日数（デフォルト: 7）
 * @returns 平均外れ率と合計件数
 */
export async function getDailyShadowSummaryStats(
  days: number = 7
): Promise<{
  avgBadRate: number;
  totalRecommendations: number;
  totalBadRecommendations: number;
}> {
  const tableName = getFullTableName("daily_shadow_summary");

  const query = `
    SELECT
      COALESCE(AVG(bad_rate), 0) AS avgBadRate,
      COALESCE(SUM(total_recommendations), 0) AS totalRecommendations,
      COALESCE(SUM(bad_recommendations), 0) AS totalBadRecommendations
    FROM \`${tableName}\`
    WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
  `;

  try {
    const rows = await executeQuery<{
      avgBadRate: number;
      totalRecommendations: number;
      totalBadRecommendations: number;
    }>(query, { days });

    const result = rows[0] || {
      avgBadRate: 0,
      totalRecommendations: 0,
      totalBadRecommendations: 0,
    };

    logger.debug("getDailyShadowSummaryStats", { days, result });
    return result;
  } catch (error) {
    logger.error("Failed to get daily shadow summary stats", {
      error: error instanceof Error ? error.message : String(error),
      days,
    });
    throw error;
  }
}

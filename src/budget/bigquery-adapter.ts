/**
 * Budget BigQuery Adapter
 *
 * BigQuery との連携を行うアダプター
 * - campaign_budget_metrics ビューからのデータ取得
 * - budget_recommendations テーブルへの結果保存
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  BudgetMetrics,
  BudgetRecommendation,
  CampaignBudgetMetricsRow,
  BudgetRecommendationRow,
} from "./types";

// =============================================================================
// BigQuery クライアント
// =============================================================================

/**
 * BigQuery アダプターのオプション
 */
export interface BudgetBigQueryAdapterOptions {
  projectId: string;
  dataset: string;
}

/**
 * BudgetBigQueryAdapter クラス
 */
export class BudgetBigQueryAdapter {
  private bigquery: BigQuery;
  private projectId: string;
  private dataset: string;

  constructor(options: BudgetBigQueryAdapterOptions) {
    this.bigquery = new BigQuery({ projectId: options.projectId });
    this.projectId = options.projectId;
    this.dataset = options.dataset;
  }

  // ===========================================================================
  // データ取得
  // ===========================================================================

  /**
   * キャンペーンごとの予算メトリクスを取得
   *
   * @param campaignIds - 対象キャンペーンID（省略時は全キャンペーン）
   * @returns BudgetMetrics の配列
   */
  async loadBudgetMetrics(campaignIds?: string[]): Promise<BudgetMetrics[]> {
    let query = `
      SELECT
        campaign_id,
        campaign_name,
        daily_budget,
        today_spend,
        budget_usage_percent,
        lost_impression_share_budget,
        spend_7d,
        sales_7d,
        orders_7d,
        acos_7d,
        cvr_7d,
        spend_30d,
        sales_30d,
        orders_30d,
        acos_30d,
        cvr_30d,
        target_acos,
        low_usage_days
      FROM \`${this.projectId}.${this.dataset}.campaign_budget_metrics\`
    `;

    const params: Record<string, unknown> = {};

    if (campaignIds && campaignIds.length > 0) {
      query += " WHERE campaign_id IN UNNEST(@campaignIds)";
      params.campaignIds = campaignIds;
    }

    query += " ORDER BY campaign_id";

    try {
      const [rows] = await this.bigquery.query({
        query,
        params,
        location: "asia-northeast1",
      });

      logger.info("Loaded budget metrics from BigQuery", {
        count: rows.length,
        campaignIds: campaignIds?.length ?? "all",
      });

      return rows.map((row: CampaignBudgetMetricsRow) =>
        this.mapRowToMetrics(row)
      );
    } catch (error) {
      logger.error("Failed to load budget metrics", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * BigQuery 行を BudgetMetrics に変換
   */
  private mapRowToMetrics(row: CampaignBudgetMetricsRow): BudgetMetrics {
    return {
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      dailyBudget: row.daily_budget,
      todaySpend: row.today_spend,
      budgetUsagePercent: row.budget_usage_percent,
      lostImpressionShareBudget: row.lost_impression_share_budget,
      spend7d: row.spend_7d,
      sales7d: row.sales_7d,
      orders7d: row.orders_7d,
      acos7d: row.acos_7d,
      cvr7d: row.cvr_7d,
      spend30d: row.spend_30d,
      sales30d: row.sales_30d,
      orders30d: row.orders_30d,
      acos30d: row.acos_30d,
      cvr30d: row.cvr_30d,
      targetAcos: row.target_acos,
      lowUsageDays: row.low_usage_days,
    };
  }

  // ===========================================================================
  // データ保存
  // ===========================================================================

  /**
   * 推奨結果を budget_recommendations テーブルに保存
   *
   * @param executionId - 実行ID
   * @param recommendations - 推奨結果の配列
   * @param isApplied - 適用されたかどうか（APPLY モードの場合 true）
   */
  async saveRecommendations(
    executionId: string,
    recommendations: BudgetRecommendation[],
    isApplied: boolean = false
  ): Promise<void> {
    if (recommendations.length === 0) {
      logger.debug("No budget recommendations to save");
      return;
    }

    const rows: BudgetRecommendationRow[] = recommendations.map((rec) =>
      this.mapRecommendationToRow(executionId, rec, isApplied)
    );

    try {
      await this.bigquery
        .dataset(this.dataset)
        .table("budget_recommendations")
        .insert(rows);

      logger.info("Saved budget recommendations to BigQuery", {
        executionId,
        count: rows.length,
        isApplied,
      });
    } catch (error) {
      logger.error("Failed to save budget recommendations", {
        executionId,
        count: rows.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * BudgetRecommendation を BigQuery 行に変換
   */
  private mapRecommendationToRow(
    executionId: string,
    rec: BudgetRecommendation,
    isApplied: boolean
  ): BudgetRecommendationRow {
    return {
      execution_id: executionId,
      campaign_id: rec.campaignId,
      campaign_name: rec.campaignName,
      action: rec.action,
      old_budget: rec.oldBudget,
      new_budget: rec.newBudget,
      budget_change: rec.budgetChange,
      budget_change_percent: rec.budgetChangePercent,
      reason_code: rec.reasonCode,
      reason_detail: rec.reasonDetail,
      budget_usage_percent: rec.budgetUsagePercent,
      lost_impression_share_budget: rec.lostImpressionShareBudget,
      current_acos_7d: rec.currentAcos7d,
      current_acos_30d: rec.currentAcos30d,
      target_acos: rec.targetAcos,
      acos_gap_ratio: rec.acosGapRatio,
      was_guard_clamped: rec.wasGuardClamped,
      guard_clamp_reason: rec.guardClampReason,
      max_budget_cap: rec.maxBudgetCap,
      is_applied: isApplied,
      applied_at: isApplied ? new Date().toISOString() : null,
      apply_error: null,
      recommended_at: rec.recommendedAt.toISOString(),
    };
  }

  /**
   * 適用エラーを更新
   *
   * @param executionId - 実行ID
   * @param campaignId - キャンペーンID
   * @param errorMessage - エラーメッセージ
   */
  async updateApplyError(
    executionId: string,
    campaignId: string,
    errorMessage: string
  ): Promise<void> {
    const query = `
      UPDATE \`${this.projectId}.${this.dataset}.budget_recommendations\`
      SET
        apply_error = @errorMessage,
        is_applied = FALSE
      WHERE
        execution_id = @executionId
        AND campaign_id = @campaignId
    `;

    try {
      await this.bigquery.query({
        query,
        params: {
          executionId,
          campaignId,
          errorMessage,
        },
        location: "asia-northeast1",
      });

      logger.debug("Updated apply error for budget recommendation", {
        executionId,
        campaignId,
      });
    } catch (error) {
      logger.error("Failed to update apply error", {
        executionId,
        campaignId,
        error: error instanceof Error ? error.message : String(error),
      });
      // エラー更新の失敗は致命的ではないので throw しない
    }
  }
}

// =============================================================================
// ファクトリ関数
// =============================================================================

/**
 * BudgetBigQueryAdapter を作成
 */
export function createBudgetBigQueryAdapter(
  options: BudgetBigQueryAdapterOptions
): BudgetBigQueryAdapter {
  return new BudgetBigQueryAdapter(options);
}

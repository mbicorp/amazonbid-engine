/**
 * Placement BigQuery Adapter
 *
 * BigQuery との連携を行うアダプター
 * - campaign_placement_metrics_30d ビューからのデータ取得
 * - placement_recommendations テーブルへの結果保存
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  PlacementMetrics,
  PlacementRecommendation,
  PlacementType,
  CampaignPlacementMetricsRow,
  PlacementRecommendationRow,
  PLACEMENT_TYPE_MAP,
} from "./types";

// =============================================================================
// BigQuery クライアント
// =============================================================================

/**
 * BigQuery アダプターのオプション
 */
export interface PlacementBigQueryAdapterOptions {
  projectId: string;
  dataset: string;
}

/**
 * PlacementBigQueryAdapter クラス
 */
export class PlacementBigQueryAdapter {
  private bigquery: BigQuery;
  private projectId: string;
  private dataset: string;

  constructor(options: PlacementBigQueryAdapterOptions) {
    this.bigquery = new BigQuery({ projectId: options.projectId });
    this.projectId = options.projectId;
    this.dataset = options.dataset;
  }

  // ===========================================================================
  // データ取得
  // ===========================================================================

  /**
   * キャンペーン×掲載位置のメトリクスを取得
   *
   * @param campaignIds - 対象キャンペーンID（省略時は全キャンペーン）
   * @returns PlacementMetrics の配列
   */
  async loadPlacementMetrics(
    campaignIds?: string[]
  ): Promise<PlacementMetrics[]> {
    let query = `
      SELECT
        campaign_id,
        campaign_name,
        placement,
        current_bid_modifier,
        top_of_search_impression_share,
        impressions,
        clicks,
        spend,
        orders,
        sales,
        cvr,
        acos,
        ctr,
        cpc,
        target_acos,
        daily_budget,
        today_spend
      FROM \`${this.projectId}.${this.dataset}.campaign_placement_metrics_30d\`
    `;

    const params: Record<string, unknown> = {};

    if (campaignIds && campaignIds.length > 0) {
      query += " WHERE campaign_id IN UNNEST(@campaignIds)";
      params.campaignIds = campaignIds;
    }

    query += " ORDER BY campaign_id, placement";

    try {
      const [rows] = await this.bigquery.query({
        query,
        params,
        location: "asia-northeast1",
      });

      logger.info("Loaded placement metrics from BigQuery", {
        count: rows.length,
        campaignIds: campaignIds?.length ?? "all",
      });

      return rows.map((row: CampaignPlacementMetricsRow) =>
        this.mapRowToMetrics(row)
      );
    } catch (error) {
      logger.error("Failed to load placement metrics", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * BigQuery 行を PlacementMetrics に変換
   */
  private mapRowToMetrics(row: CampaignPlacementMetricsRow): PlacementMetrics {
    // placement 文字列を PlacementType に変換
    const placementType = PLACEMENT_TYPE_MAP[row.placement] ?? "REST_OF_SEARCH";

    return {
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      placement: placementType as PlacementType,
      currentBidModifier: row.current_bid_modifier,
      topOfSearchImpressionShare: row.top_of_search_impression_share,
      impressions30d: row.impressions,
      clicks30d: row.clicks,
      spend30d: row.spend,
      orders30d: row.orders,
      sales30d: row.sales,
      cvr30d: row.cvr,
      acos30d: row.acos,
      ctr30d: row.ctr,
      cpc30d: row.cpc,
      targetAcos: row.target_acos,
      dailyBudget: row.daily_budget,
      todaySpend: row.today_spend,
    };
  }

  // ===========================================================================
  // データ保存
  // ===========================================================================

  /**
   * 推奨結果を placement_recommendations テーブルに保存
   *
   * @param executionId - 実行ID
   * @param recommendations - 推奨結果の配列
   * @param isApplied - 適用されたかどうか（APPLY モードの場合 true）
   */
  async saveRecommendations(
    executionId: string,
    recommendations: PlacementRecommendation[],
    isApplied: boolean = false
  ): Promise<void> {
    if (recommendations.length === 0) {
      logger.debug("No recommendations to save");
      return;
    }

    const rows: PlacementRecommendationRow[] = recommendations.map((rec) =>
      this.mapRecommendationToRow(executionId, rec, isApplied)
    );

    try {
      await this.bigquery
        .dataset(this.dataset)
        .table("placement_recommendations")
        .insert(rows);

      logger.info("Saved placement recommendations to BigQuery", {
        executionId,
        count: rows.length,
        isApplied,
      });
    } catch (error) {
      logger.error("Failed to save placement recommendations", {
        executionId,
        count: rows.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * PlacementRecommendation を BigQuery 行に変換
   */
  private mapRecommendationToRow(
    executionId: string,
    rec: PlacementRecommendation,
    isApplied: boolean
  ): PlacementRecommendationRow {
    return {
      execution_id: executionId,
      campaign_id: rec.campaignId,
      campaign_name: rec.campaignName,
      placement: rec.placement,
      action: rec.action,
      old_modifier: rec.oldModifier,
      new_modifier: rec.newModifier,
      modifier_change: rec.modifierChange,
      reason_code: rec.reasonCode,
      reason_detail: rec.reasonDetail,
      impression_share: rec.impressionShare,
      current_acos: rec.currentAcos,
      target_acos: rec.targetAcos,
      acos_gap_ratio: rec.acosGapRatio,
      clicks_30d: rec.clicks30d,
      is_opportunity_jump: rec.isOpportunityJump,
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
   * @param placement - 掲載位置
   * @param errorMessage - エラーメッセージ
   */
  async updateApplyError(
    executionId: string,
    campaignId: string,
    placement: string,
    errorMessage: string
  ): Promise<void> {
    const query = `
      UPDATE \`${this.projectId}.${this.dataset}.placement_recommendations\`
      SET
        apply_error = @errorMessage,
        is_applied = FALSE
      WHERE
        execution_id = @executionId
        AND campaign_id = @campaignId
        AND placement = @placement
    `;

    try {
      await this.bigquery.query({
        query,
        params: {
          executionId,
          campaignId,
          placement,
          errorMessage,
        },
        location: "asia-northeast1",
      });

      logger.debug("Updated apply error for placement recommendation", {
        executionId,
        campaignId,
        placement,
      });
    } catch (error) {
      logger.error("Failed to update apply error", {
        executionId,
        campaignId,
        placement,
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
 * PlacementBigQueryAdapter を作成
 */
export function createPlacementBigQueryAdapter(
  options: PlacementBigQueryAdapterOptions
): PlacementBigQueryAdapter {
  return new PlacementBigQueryAdapter(options);
}

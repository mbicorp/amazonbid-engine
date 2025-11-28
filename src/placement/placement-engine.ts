/**
 * Placement Engine - 掲載位置最適化エンジン
 *
 * キャンペーンの掲載位置（Top of Search 等）の入札調整比率を自動最適化
 * BID_ENGINE_EXECUTION_MODE 環境変数（SHADOW/APPLY）に従う
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import { getExecutionMode, isShadowMode } from "../logging";
import {
  PlacementMetrics,
  PlacementRecommendation,
  PlacementEngineResult,
  PlacementOptimizerConfig,
  DEFAULT_PLACEMENT_OPTIMIZER_CONFIG,
} from "./types";
import {
  computePlacementRecommendations,
  countPlacementActions,
  countOpportunityJumps,
} from "./placement-calculator";
import {
  PlacementBigQueryAdapter,
  createPlacementBigQueryAdapter,
} from "./bigquery-adapter";

// =============================================================================
// 型定義
// =============================================================================

/**
 * PlacementEngine の設定
 */
export interface PlacementEngineConfig {
  /** GCP プロジェクト ID */
  projectId: string;

  /** BigQuery データセット名 */
  dataset: string;

  /** 対象キャンペーン ID（省略時は全キャンペーン） */
  targetCampaignIds?: string[];

  /** 最適化設定（省略時はデフォルト） */
  optimizerConfig?: PlacementOptimizerConfig;

  /** トリガー元（ログ用） */
  triggerSource?: "CRON" | "MANUAL" | "API";

  /** ドライラン（テーブル保存しない） */
  dryRun?: boolean;
}

// =============================================================================
// メインエンジン
// =============================================================================

/**
 * 掲載位置最適化エンジンを実行
 *
 * 1. BigQuery から campaign_placement_metrics_30d を取得
 * 2. 各掲載位置について推奨を計算
 * 3. SHADOW モードでは推奨をログに記録のみ
 * 4. APPLY モードでは Amazon Ads API を呼び出して適用（将来実装）
 * 5. 結果を placement_recommendations テーブルに保存
 *
 * @param config - エンジン設定
 * @returns 実行結果
 */
export async function runPlacementEngine(
  config: PlacementEngineConfig
): Promise<PlacementEngineResult> {
  const executionId = uuidv4();
  const startedAt = new Date();
  const mode = getExecutionMode();
  const optimizerConfig = config.optimizerConfig ?? DEFAULT_PLACEMENT_OPTIMIZER_CONFIG;

  logger.info("Starting placement optimization engine", {
    executionId,
    mode,
    projectId: config.projectId,
    dataset: config.dataset,
    targetCampaigns: config.targetCampaignIds?.length ?? "all",
    triggerSource: config.triggerSource ?? "MANUAL",
    dryRun: config.dryRun ?? false,
  });

  // BigQuery アダプターを作成
  const bqAdapter = createPlacementBigQueryAdapter({
    projectId: config.projectId,
    dataset: config.dataset,
  });

  try {
    // ========================================
    // Step 1: メトリクスを取得
    // ========================================
    const metrics = await bqAdapter.loadPlacementMetrics(config.targetCampaignIds);

    if (metrics.length === 0) {
      logger.warn("No placement metrics found", {
        executionId,
        targetCampaigns: config.targetCampaignIds ?? "all",
      });

      const finishedAt = new Date();
      return {
        success: true,
        executionId,
        mode,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        totalCampaigns: 0,
        totalPlacements: 0,
        recommendationsCount: 0,
        actionCounts: { BOOST: 0, TEST_BOOST: 0, DECREASE: 0, NO_ACTION: 0 },
        opportunityJumpCount: 0,
        recommendations: [],
      };
    }

    // ユニークなキャンペーン数をカウント
    const uniqueCampaigns = new Set(metrics.map((m) => m.campaignId)).size;

    logger.info("Loaded placement metrics", {
      executionId,
      totalPlacements: metrics.length,
      uniqueCampaigns,
    });

    // ========================================
    // Step 2: 推奨を計算
    // ========================================
    const recommendations = computePlacementRecommendations(metrics, optimizerConfig);

    // アクション別件数を集計
    const actionCounts = countPlacementActions(recommendations);
    const opportunityJumpCount = countOpportunityJumps(recommendations);

    // 変更があるもののみフィルタ（NO_ACTION 以外）
    const activeRecommendations = recommendations.filter(
      (rec) => rec.action !== "NO_ACTION"
    );

    logger.info("Computed placement recommendations", {
      executionId,
      totalRecommendations: recommendations.length,
      activeRecommendations: activeRecommendations.length,
      actionCounts,
      opportunityJumpCount,
    });

    // ========================================
    // Step 3: 推奨を適用（APPLY モードの場合）
    // ========================================
    let appliedCount = 0;
    const isApply = mode === "APPLY";

    if (isApply && activeRecommendations.length > 0) {
      // TODO: Amazon Ads API を呼び出して実際に適用
      // 現時点では未実装のため、ログのみ
      logger.info("APPLY mode: Would apply placement bid modifiers", {
        executionId,
        count: activeRecommendations.length,
        note: "Amazon Ads API integration not yet implemented",
      });

      // 将来的にはここで各推奨を適用し、エラーがあれば bqAdapter.updateApplyError を呼ぶ
      appliedCount = 0; // 実装後は実際の適用数
    } else if (isShadowMode()) {
      logger.info("SHADOW mode: Skipping actual bid modifier changes", {
        executionId,
        activeRecommendations: activeRecommendations.length,
      });
    }

    // ========================================
    // Step 4: 結果を BigQuery に保存
    // ========================================
    if (!config.dryRun) {
      try {
        await bqAdapter.saveRecommendations(
          executionId,
          recommendations,
          isApply && appliedCount > 0
        );
      } catch (saveError) {
        logger.error("Failed to save recommendations to BigQuery", {
          executionId,
          error: saveError instanceof Error ? saveError.message : String(saveError),
        });
        // 保存失敗は致命的ではないので続行
      }
    } else {
      logger.info("Dry run: Skipping BigQuery save", {
        executionId,
        recommendationsCount: recommendations.length,
      });
    }

    // ========================================
    // Step 5: 結果を返す
    // ========================================
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    const result: PlacementEngineResult = {
      success: true,
      executionId,
      mode,
      startedAt,
      finishedAt,
      durationMs,
      totalCampaigns: uniqueCampaigns,
      totalPlacements: metrics.length,
      recommendationsCount: recommendations.length,
      actionCounts,
      opportunityJumpCount,
      recommendations,
    };

    logger.info("Placement optimization engine completed", {
      executionId,
      mode,
      durationMs,
      totalCampaigns: uniqueCampaigns,
      totalPlacements: metrics.length,
      activeRecommendations: activeRecommendations.length,
      opportunityJumpCount,
    });

    return result;

  } catch (error) {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Placement optimization engine failed", {
      executionId,
      mode,
      durationMs,
      error: errorMessage,
    });

    return {
      success: false,
      executionId,
      mode,
      startedAt,
      finishedAt,
      durationMs,
      totalCampaigns: 0,
      totalPlacements: 0,
      recommendationsCount: 0,
      actionCounts: { BOOST: 0, TEST_BOOST: 0, DECREASE: 0, NO_ACTION: 0 },
      opportunityJumpCount: 0,
      recommendations: [],
      errorMessage,
    };
  }
}

// =============================================================================
// ユーティリティ
// =============================================================================

/**
 * 実行モード情報をログ出力
 */
export function logPlacementExecutionModeOnStartup(): void {
  const mode = getExecutionMode();

  if (mode === "SHADOW") {
    logger.info("Placement engine starting in SHADOW mode", {
      mode,
      description: "Recommendations will be calculated and logged but NOT applied to Amazon Ads",
    });
  } else {
    logger.info("Placement engine starting in APPLY mode", {
      mode,
      description: "Recommendations WILL be applied to Amazon Ads API",
      warning: "This will modify actual bid modifiers",
    });
  }
}

/**
 * ライフサイクル管理 API ルート
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import {
  fetchLifecycleKeywordMetrics,
  generateBidRecommendations,
  getInvestModeProductsSummary,
  DEFAULT_LIFECYCLE_GLOBAL_CONFIG,
} from "../lifecycle/bid-integration";
import { runLifecycleUpdate, manualLifecycleChange } from "../jobs/lifecycle";
import { runAllAggregationJobs } from "../jobs/aggregation";
import { LifecycleStage } from "../lifecycle/types";
import { fetchProductConfigs } from "../ltv/product-config-builder";
import {
  applySuggestionToProducts,
  saveSuggestionsToDatabase,
} from "../lifecycle/suggestionApplicator";
import { SlackNotifier } from "../lib/slackNotifier";

const router = Router();

// =============================================================================
// 設定
// =============================================================================

function getConfig() {
  return {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || "",
    dataset: process.env.BIGQUERY_DATASET || "amazon_bid_engine",
  };
}

// =============================================================================
// エンドポイント
// =============================================================================

/**
 * GET /lifecycle/products
 * 投資モード商品のサマリーを取得
 */
router.get("/products", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    logger.info("Fetching invest mode products summary");

    const summary = await getInvestModeProductsSummary(config);

    res.json({
      success: true,
      data: {
        products: summary,
        total_products: summary.length,
        invest_mode_products: summary.filter((p) => p.invest_mode_enabled).length,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch products summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /lifecycle/keywords/:productId
 * 商品のキーワードメトリクスと入札推奨を取得
 */
router.get("/keywords/:productId", async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const { productId } = req.params;

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    logger.info("Fetching keyword metrics", { productId });

    const metrics = await fetchLifecycleKeywordMetrics(config, [productId]);
    const recommendations = generateBidRecommendations(
      metrics,
      DEFAULT_LIFECYCLE_GLOBAL_CONFIG
    );

    res.json({
      success: true,
      data: {
        product_id: productId,
        keyword_count: metrics.length,
        metrics,
        recommendations,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch keyword metrics", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /lifecycle/update
 * ライフサイクル状態更新ジョブを実行
 */
router.post("/update", async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const dryRun = req.body.dryRun === true;

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    logger.info("Starting lifecycle update job", { dryRun });

    const result = await runLifecycleUpdate({
      ...config,
      dryRun,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Lifecycle update job failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /lifecycle/products/:productId/stage
 * 商品のライフサイクルステージを手動変更
 */
router.post("/products/:productId/stage", async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const { productId } = req.params;
    const { stage, reason } = req.body;
    const dryRun = req.body.dryRun === true;

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    // ステージのバリデーション
    const validStages: LifecycleStage[] = [
      "LAUNCH_HARD",
      "LAUNCH_SOFT",
      "GROW",
      "HARVEST",
    ];

    if (!validStages.includes(stage)) {
      return res.status(400).json({
        error: `Invalid stage. Must be one of: ${validStages.join(", ")}`,
      });
    }

    if (!reason) {
      return res.status(400).json({
        error: "Reason is required for manual stage change",
      });
    }

    logger.info("Manual lifecycle stage change requested", {
      productId,
      stage,
      reason,
      dryRun,
    });

    await manualLifecycleChange(
      { ...config, dryRun },
      productId,
      stage,
      reason
    );

    res.json({
      success: true,
      data: {
        product_id: productId,
        new_stage: stage,
        reason,
        dry_run: dryRun,
      },
    });
  } catch (error) {
    logger.error("Manual stage change failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /lifecycle/aggregation
 * 集計ジョブを実行
 */
router.post("/aggregation", async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const dryRun = req.body.dryRun === true;
    const {
      skipKeywordMetrics,
      skipSeoKeywordSelection,
      skipSeoScoreCalculation,
      skipMonthlyProfitValidation,
    } = req.body;

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    logger.info("Starting aggregation jobs", { dryRun });

    const result = await runAllAggregationJobs({
      ...config,
      dryRun,
      skipKeywordMetrics,
      skipSeoKeywordSelection,
      skipSeoScoreCalculation,
      skipMonthlyProfitValidation,
    });

    res.json({
      success: result.success,
      data: result,
    });
  } catch (error) {
    logger.error("Aggregation jobs failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /lifecycle/config
 * 現在のライフサイクル設定を取得
 */
router.get("/config", (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      lifecycle_global_config: DEFAULT_LIFECYCLE_GLOBAL_CONFIG,
    },
  });
});

/**
 * POST /lifecycle/suggestions
 * ライフサイクルサジェストを計算してSlackに通知
 */
router.post("/suggestions", async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const {
      productIds,
      isBeforeBigSale = false,
      dryRun = false,
      notifySlack = true,
    } = req.body;

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    logger.info("Starting lifecycle suggestions job", {
      productIdCount: productIds?.length ?? "all",
      isBeforeBigSale,
      dryRun,
      notifySlack,
    });

    // 1. ProductConfigを取得
    const productConfigs = await fetchProductConfigs(config, productIds);
    const products = Array.from(productConfigs.values());

    if (products.length === 0) {
      return res.json({
        success: true,
        data: {
          message: "No products found",
          suggestions: [],
        },
      });
    }

    // 2. サジェストを計算して反映
    const suggestedProducts = await applySuggestionToProducts(
      config,
      products,
      { isBeforeBigSale }
    );

    // 3. 現在のステートと推奨ステートが異なる商品を抽出
    const changedProducts = suggestedProducts.filter(
      (p) =>
        p.lifecycleSuggestedState != null &&
        p.lifecycleSuggestedState !== p.lifecycleState
    );

    // 4. DBに保存（dryRunでない場合）
    if (!dryRun && changedProducts.length > 0) {
      try {
        await saveSuggestionsToDatabase(config, changedProducts);
      } catch (saveError) {
        logger.warn("Failed to save suggestions to database", {
          error: saveError instanceof Error ? saveError.message : String(saveError),
        });
      }
    }

    // 5. Slack通知（notifySlackがtrueの場合）
    if (notifySlack && changedProducts.length > 0) {
      try {
        const slackNotifier = new SlackNotifier();

        for (const product of changedProducts) {
          const message = formatSuggestionSlackMessage(product);
          await slackNotifier.send(
            message,
            product.lifecycleSuggestedState === "HARVEST" ? "warn" : "info"
          );
        }

        // サマリー通知
        const summaryMessage = formatSuggestionSummaryMessage(
          suggestedProducts.length,
          changedProducts
        );
        await slackNotifier.send(summaryMessage, "info");
      } catch (slackError) {
        logger.warn("Failed to send Slack notification", {
          error: slackError instanceof Error ? slackError.message : String(slackError),
        });
      }
    }

    res.json({
      success: true,
      data: {
        total_products: suggestedProducts.length,
        changed_products: changedProducts.length,
        dry_run: dryRun,
        suggestions: changedProducts.map((p) => ({
          asin: p.asin,
          product_id: p.productId,
          current_state: p.lifecycleState,
          suggested_state: p.lifecycleSuggestedState,
          reason: p.lastLifecycleSuggestedReason,
        })),
      },
    });
  } catch (error) {
    logger.error("Lifecycle suggestions job failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * Slack通知用メッセージをフォーマット
 */
function formatSuggestionSlackMessage(product: {
  asin: string;
  lifecycleState: string;
  lifecycleSuggestedState?: string | null;
  lastLifecycleSuggestedReason?: string | null;
}): string {
  const stateLabel: Record<string, string> = {
    LAUNCH_HARD: "投資強化",
    LAUNCH_SOFT: "投資継続",
    GROW: "成長バランス",
    HARVEST: "利益回収",
  };

  const currentLabel = stateLabel[product.lifecycleState] ?? product.lifecycleState;
  const suggestedLabel = product.lifecycleSuggestedState
    ? stateLabel[product.lifecycleSuggestedState] ?? product.lifecycleSuggestedState
    : "不明";

  return [
    `*ライフサイクルサジェスト*`,
    `商品: ${product.asin}`,
    `現在: ${currentLabel} → 推奨: ${suggestedLabel}`,
    `理由: ${product.lastLifecycleSuggestedReason ?? "理由なし"}`,
  ].join("\n");
}

/**
 * サマリー通知メッセージをフォーマット
 */
function formatSuggestionSummaryMessage(
  totalCount: number,
  changedProducts: Array<{
    lifecycleSuggestedState?: string | null;
  }>
): string {
  const harvestCount = changedProducts.filter(
    (p) => p.lifecycleSuggestedState === "HARVEST"
  ).length;
  const launchHardCount = changedProducts.filter(
    (p) => p.lifecycleSuggestedState === "LAUNCH_HARD"
  ).length;
  const growCount = changedProducts.filter(
    (p) => p.lifecycleSuggestedState === "GROW"
  ).length;
  const launchSoftCount = changedProducts.filter(
    (p) => p.lifecycleSuggestedState === "LAUNCH_SOFT"
  ).length;

  return [
    `*ライフサイクルサジェスト完了*`,
    `対象商品: ${totalCount}件`,
    `変更推奨: ${changedProducts.length}件`,
    `  - HARVEST推奨: ${harvestCount}件`,
    `  - LAUNCH_HARD推奨: ${launchHardCount}件`,
    `  - GROW推奨: ${growCount}件`,
    `  - LAUNCH_SOFT推奨: ${launchSoftCount}件`,
  ].join("\n");
}

export default router;

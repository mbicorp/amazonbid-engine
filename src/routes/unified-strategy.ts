/**
 * 統合戦略エンドポイント
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { JungleScoutMarketplace, getLatestStrategyAnalysis } from "../jungle-scout";
import {
  ProductProfitability,
  calculateUnifiedStrategiesForAsin,
  generateUnifiedStrategySummary,
  saveProductProfitability,
  getLatestProductProfitability,
  saveUnifiedStrategies,
  getLatestUnifiedStrategies,
  saveStrategySummary as saveUnifiedSummary,
  getLatestStrategySummary as getUnifiedSummary,
  getActionSummaryByAsin,
} from "../unified-strategy";

const router = Router();

// 商品収益性データを登録/更新
router.post("/product", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const productData = req.body as Partial<ProductProfitability>;

  if (!productData.asin || !productData.marketplace) {
    return res.status(400).json({
      success: false,
      error: "asin and marketplace are required",
    });
  }

  logger.info("Saving product profitability", {
    traceId,
    asin: productData.asin,
    marketplace: productData.marketplace,
  });

  try {
    // 必須フィールドのデフォルト値を設定
    const fullProductData: ProductProfitability = {
      asin: productData.asin,
      marketplace: productData.marketplace,
      total_sales_30d: productData.total_sales_30d || 0,
      total_sales_previous_30d: productData.total_sales_previous_30d || 0,
      ad_sales_30d: productData.ad_sales_30d || 0,
      organic_sales_30d: productData.organic_sales_30d || 0,
      profit_margin: productData.profit_margin || 0.3, // デフォルト30%
      unit_profit: productData.unit_profit || 0,
      ad_spend_30d: productData.ad_spend_30d || 0,
      total_ad_cost: productData.total_ad_cost || 0,
      ad_dependency_ratio:
        productData.ad_dependency_ratio ||
        (productData.total_sales_30d && productData.ad_sales_30d
          ? productData.ad_sales_30d / productData.total_sales_30d
          : 0.5),
      sales_growth_rate:
        productData.sales_growth_rate ||
        (productData.total_sales_30d && productData.total_sales_previous_30d
          ? (productData.total_sales_30d - productData.total_sales_previous_30d) /
            productData.total_sales_previous_30d
          : 0),
      total_roas:
        productData.total_roas ||
        (productData.ad_spend_30d && productData.total_sales_30d
          ? productData.total_sales_30d / productData.ad_spend_30d
          : 0),
      ad_roas:
        productData.ad_roas ||
        (productData.ad_spend_30d && productData.ad_sales_30d
          ? productData.ad_sales_30d / productData.ad_spend_30d
          : 0),
      profit_after_ad:
        productData.profit_after_ad ||
        (productData.total_sales_30d && productData.profit_margin && productData.ad_spend_30d
          ? productData.total_sales_30d * productData.profit_margin - productData.ad_spend_30d
          : 0),
      updated_at: new Date(),
    };

    await saveProductProfitability([fullProductData]);

    return res.json({
      success: true,
      message: "Product profitability saved",
      data: fullProductData,
    });
  } catch (error) {
    logger.error("Failed to save product profitability", {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "save-product-failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// 統合戦略計算実行
router.post("/calculate", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin, marketplace = "jp" } = req.body;

  if (!asin) {
    return res.status(400).json({
      success: false,
      error: "asin is required",
    });
  }

  logger.info("Calculating unified strategy", { traceId, asin, marketplace });

  try {
    const mp = marketplace as JungleScoutMarketplace;

    // 商品収益性データを取得
    let product = await getLatestProductProfitability(mp, asin);

    if (!product) {
      // 商品データがない場合はデフォルト値で作成
      product = {
        asin,
        marketplace: mp,
        total_sales_30d: 100000, // デフォルト10万円
        total_sales_previous_30d: 90000,
        ad_sales_30d: 50000,
        organic_sales_30d: 50000,
        profit_margin: 0.3,
        unit_profit: 500,
        ad_spend_30d: 15000,
        total_ad_cost: 15000,
        ad_dependency_ratio: 0.5,
        sales_growth_rate: 0.11,
        total_roas: 6.67,
        ad_roas: 3.33,
        profit_after_ad: 15000,
        updated_at: new Date(),
      };
      logger.warn("Using default product profitability", { asin });
    }

    // Jungle Scoutのキーワード戦略分析を取得
    const keywordAnalyses = await getLatestStrategyAnalysis(mp, asin);

    if (keywordAnalyses.length === 0) {
      return res.status(404).json({
        success: false,
        error: "no-keyword-analysis",
        message: "No keyword analysis found. Run /jungle-scout/analyze first.",
      });
    }

    // 広告メトリクスマップを作成（実際はAmazon Ads APIから取得）
    // ここではJungle Scoutデータから推定
    const adMetricsMap = new Map<
      string,
      {
        keyword_id: string;
        campaign_id: string;
        ad_group_id: string;
        current_bid: number;
        current_acos: number;
        current_cvr: number;
        current_ctr: number;
        clicks_30d: number;
        impressions_30d: number;
      }
    >();

    // 統合戦略を計算
    const strategies = calculateUnifiedStrategiesForAsin(
      product,
      keywordAnalyses,
      adMetricsMap
    );

    // BigQueryに保存
    await saveUnifiedStrategies(strategies);

    // サマリーを生成・保存
    const summary = generateUnifiedStrategySummary(product, strategies);
    await saveUnifiedSummary(summary);

    logger.info("Unified strategy calculation completed", {
      traceId,
      asin,
      keywordCount: strategies.length,
    });

    return res.json({
      success: true,
      asin,
      marketplace: mp,
      product: {
        strategy: strategies[0]?.product_strategy,
        lifecycle: strategies[0]?.product_lifecycle,
        profitMargin: product.profit_margin,
        adDependencyRatio: product.ad_dependency_ratio,
      },
      summary: {
        totalKeywords: summary.total_keywords,
        keywordsByStrategy: summary.keywords_by_strategy,
        actionsBreakdown: summary.actions_breakdown,
        budgetAllocation: summary.recommended_budget_allocation,
        expectedImpact: summary.expected_impact,
      },
      topStrategies: strategies.slice(0, 20).map((s) => ({
        keyword: s.keyword,
        keywordStrategy: s.keyword_strategy,
        action: s.final_action,
        acosTarget: s.dynamic_acos_target,
        bidAdjustment: s.bid_adjustment_rate,
        recommendedBid: s.recommended_bid,
        priorityScore: s.priority_score,
        reason: s.strategy_reason,
      })),
    });
  } catch (error) {
    logger.error("Unified strategy calculation failed", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "unified-calculation-failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// 統合戦略結果取得
router.get("/strategy/:asin", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin } = req.params;
  const marketplace = (req.query.marketplace as string) || "jp";
  const action = req.query.action as string | undefined;
  const limit = parseInt(req.query.limit as string) || 100;

  try {
    const strategies = await getLatestUnifiedStrategies(marketplace, asin, limit);

    // アクションでフィルタリング
    const filteredStrategies = action
      ? strategies.filter((s) => s.final_action === action)
      : strategies;

    return res.json({
      success: true,
      asin,
      marketplace,
      count: filteredStrategies.length,
      strategies: filteredStrategies.map((s) => ({
        keyword: s.keyword,
        keywordId: s.keyword_id,
        campaignId: s.campaign_id,
        productStrategy: s.product_strategy,
        productLifecycle: s.product_lifecycle,
        keywordStrategy: s.keyword_strategy,
        organicRank: s.organic_rank,
        sponsoredRank: s.sponsored_rank,
        shareOfVoice: s.share_of_voice,
        searchVolume: s.search_volume,
        currentAcos: s.current_acos,
        currentBid: s.current_bid,
        finalAction: s.final_action,
        dynamicAcosTarget: s.dynamic_acos_target,
        recommendedBid: s.recommended_bid,
        bidAdjustmentRate: s.bid_adjustment_rate,
        priorityScore: s.priority_score,
        confidenceScore: s.confidence_score,
        reason: s.strategy_reason,
        constraints: s.constraints_applied,
      })),
    });
  } catch (error) {
    logger.error("Failed to get unified strategies", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "get-unified-strategy-failed",
    });
  }
});

// 統合戦略サマリー取得
router.get("/summary/:asin", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin } = req.params;
  const marketplace = (req.query.marketplace as string) || "jp";

  try {
    const [summary, actionSummary, product] = await Promise.all([
      getUnifiedSummary(marketplace, asin),
      getActionSummaryByAsin(marketplace, asin),
      getLatestProductProfitability(marketplace, asin),
    ]);

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: "no-summary-found",
        message: "No strategy summary found. Run /unified/calculate first.",
      });
    }

    return res.json({
      success: true,
      asin,
      marketplace,
      product: product
        ? {
            totalSales30d: product.total_sales_30d,
            adSales30d: product.ad_sales_30d,
            organicSales30d: product.organic_sales_30d,
            profitMargin: product.profit_margin,
            adDependencyRatio: product.ad_dependency_ratio,
            salesGrowthRate: product.sales_growth_rate,
            totalRoas: product.total_roas,
            adRoas: product.ad_roas,
          }
        : null,
      summary: {
        productStrategy: summary.product_strategy,
        productLifecycle: summary.product_lifecycle,
        totalKeywords: summary.total_keywords,
        keywordsByStrategy: summary.keywords_by_strategy,
        totalSearchVolume: summary.total_search_volume,
        avgShareOfVoice: summary.avg_share_of_voice,
        actionsBreakdown: summary.actions_breakdown,
        budgetAllocation: summary.recommended_budget_allocation,
        expectedImpact: summary.expected_impact,
        analyzedAt: summary.analyzed_at,
      },
      actionSummary,
    });
  } catch (error) {
    logger.error("Failed to get unified summary", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "get-unified-summary-failed",
    });
  }
});

export default router;

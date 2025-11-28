/**
 * Jungle Scout エンドポイント
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import {
  getJungleScoutClient,
  JungleScoutMarketplace,
  saveKeywordIntelligence,
  getLatestKeywordIntelligence,
  saveShareOfVoice,
  getLatestShareOfVoice,
  getAsinKeywordSummary,
  saveStrategyAnalysis,
  getLatestStrategyAnalysis,
  getStrategySummary,
  getTrendingKeywords,
  analyzeKeywordsStrategy,
  generateStrategySummary,
} from "../jungle-scout";

const router = Router();

// Jungle Scout データ同期（ASIN指定）
router.post("/sync", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin, marketplace = "jp" } = req.body;

  if (!asin) {
    return res.status(400).json({
      success: false,
      error: "asin is required",
    });
  }

  logger.info("Starting Jungle Scout sync", { traceId, asin, marketplace });

  try {
    const client = getJungleScoutClient();
    const mp = marketplace as JungleScoutMarketplace;

    // Keywords by ASINを取得
    const keywords = await client.getAllKeywordsByAsin(asin, mp, 5);

    // KeywordIntelligenceに変換
    const intelligenceData = keywords.map((kw) =>
      client.convertToKeywordIntelligence(kw, asin, mp)
    );

    // BigQueryに保存
    await saveKeywordIntelligence(intelligenceData);

    // 上位キーワードのShare of Voiceを取得（API負荷を考慮して上位20件）
    const topKeywords = keywords
      .slice(0, 20)
      .map((kw) => kw.attributes.name);

    const sovDataList: any[] = [];
    for (const keyword of topKeywords) {
      try {
        const sovResponse = await client.getShareOfVoice({
          keyword,
          marketplace: mp,
        });
        const asinSov = client.extractAsinShareOfVoice(
          sovResponse,
          asin,
          mp
        );
        if (asinSov) {
          sovDataList.push(asinSov);
        }
      } catch (sovError) {
        logger.warn("Failed to fetch SOV for keyword", {
          keyword,
          error: sovError instanceof Error ? sovError.message : String(sovError),
        });
      }
    }

    // BigQueryに保存
    if (sovDataList.length > 0) {
      await saveShareOfVoice(sovDataList);
    }

    logger.info("Jungle Scout sync completed", {
      traceId,
      asin,
      keywordCount: intelligenceData.length,
      sovCount: sovDataList.length,
    });

    return res.json({
      success: true,
      asin,
      marketplace: mp,
      keywordsSynced: intelligenceData.length,
      sovSynced: sovDataList.length,
    });
  } catch (error) {
    logger.error("Jungle Scout sync failed", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "jungle-scout-sync-failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// キーワード戦略分析実行
router.post("/analyze", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin, marketplace = "jp" } = req.body;

  if (!asin) {
    return res.status(400).json({
      success: false,
      error: "asin is required",
    });
  }

  logger.info("Starting keyword strategy analysis", { traceId, asin, marketplace });

  try {
    const mp = marketplace as JungleScoutMarketplace;

    // 最新のSOVデータを取得
    const sovList = await getLatestShareOfVoice(mp, asin);

    if (sovList.length === 0) {
      return res.status(404).json({
        success: false,
        error: "no-sov-data",
        message: "No Share of Voice data found. Run /jungle-scout/sync first.",
      });
    }

    // キーワードインテリジェンスを取得
    const intelligenceList = await getLatestKeywordIntelligence(mp, asin);
    const intelligenceMap = new Map(
      intelligenceList.map((ki) => [ki.keyword, ki])
    );

    // 戦略分析を実行
    const analyses = analyzeKeywordsStrategy(sovList, intelligenceMap);

    // BigQueryに保存
    await saveStrategyAnalysis(analyses);

    // サマリーを生成
    const summary = generateStrategySummary(analyses);

    logger.info("Keyword strategy analysis completed", {
      traceId,
      asin,
      analyzedCount: analyses.length,
    });

    return res.json({
      success: true,
      asin,
      marketplace: mp,
      analyzedKeywords: analyses.length,
      summary: {
        strategyBreakdown: summary.strategyBreakdown,
        totalSearchVolume: summary.totalSearchVolume,
        avgOverallSov: summary.avgOverallSov,
        topInvestKeywords: summary.topInvestKeywords.map((k) => ({
          keyword: k.keyword,
          potentialScore: k.potential_score,
          searchVolume: k.search_volume,
          reason: k.strategy_reason,
        })),
        topHarvestKeywords: summary.topHarvestKeywords.map((k) => ({
          keyword: k.keyword,
          currentSov: k.current_sov,
          searchVolume: k.search_volume,
        })),
      },
    });
  } catch (error) {
    logger.error("Keyword strategy analysis failed", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "strategy-analysis-failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ASIN別キーワード情報取得
router.get("/keywords/:asin", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin } = req.params;
  const marketplace = (req.query.marketplace as string) || "jp";
  const limit = parseInt(req.query.limit as string) || 100;

  try {
    const keywords = await getLatestKeywordIntelligence(
      marketplace as JungleScoutMarketplace,
      asin,
      limit
    );

    return res.json({
      success: true,
      asin,
      marketplace,
      count: keywords.length,
      keywords: keywords.map((kw) => ({
        keyword: kw.keyword,
        searchVolumeExact: kw.monthly_search_volume_exact,
        searchVolumeBroad: kw.monthly_search_volume_broad,
        ppcBidExact: kw.ppc_bid_exact,
        ppcBidBroad: kw.ppc_bid_broad,
        easeOfRanking: kw.ease_of_ranking_score,
        trendingDirection: kw.trending_direction,
        trendingPercentage: kw.trending_percentage,
        category: kw.dominant_category,
      })),
    });
  } catch (error) {
    logger.error("Failed to get keywords", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "get-keywords-failed",
    });
  }
});

// ASIN別Share of Voice取得
router.get("/sov/:asin", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin } = req.params;
  const marketplace = (req.query.marketplace as string) || "jp";

  try {
    const [sovList, summary] = await Promise.all([
      getLatestShareOfVoice(marketplace as JungleScoutMarketplace, asin),
      getAsinKeywordSummary(marketplace as JungleScoutMarketplace, asin),
    ]);

    return res.json({
      success: true,
      asin,
      marketplace,
      summary,
      sovCount: sovList.length,
      shareOfVoice: sovList.map((sov) => ({
        keyword: sov.keyword,
        searchVolume: sov.search_volume,
        organicRank: sov.organic_rank,
        sponsoredRank: sov.sponsored_rank,
        combinedRank: sov.combined_rank,
        organicSov: sov.organic_sov,
        sponsoredSov: sov.sponsored_sov,
        combinedSov: sov.combined_sov,
        isAmazonChoice: sov.is_amazon_choice,
        isBestSeller: sov.is_best_seller,
      })),
    });
  } catch (error) {
    logger.error("Failed to get SOV", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "get-sov-failed",
    });
  }
});

// ASIN別戦略分析結果取得
router.get("/strategy/:asin", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin } = req.params;
  const marketplace = (req.query.marketplace as string) || "jp";
  const strategy = req.query.strategy as string | undefined;

  try {
    const [analyses, summary] = await Promise.all([
      getLatestStrategyAnalysis(
        marketplace as JungleScoutMarketplace,
        asin,
        strategy
      ),
      getStrategySummary(marketplace as JungleScoutMarketplace, asin),
    ]);

    return res.json({
      success: true,
      asin,
      marketplace,
      strategySummary: summary,
      analysisCount: analyses.length,
      analyses: analyses.map((a) => ({
        keyword: a.keyword,
        strategy: a.recommended_strategy,
        reason: a.strategy_reason,
        organicRank: a.current_organic_rank,
        sponsoredRank: a.current_sponsored_rank,
        currentSov: a.current_sov,
        searchVolume: a.search_volume,
        bidAdjustment: a.recommended_bid_adjustment,
        acosTarget: a.recommended_acos_target,
        potentialScore: a.potential_score,
        competitionLevel: a.competition_level,
      })),
    });
  } catch (error) {
    logger.error("Failed to get strategy", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "get-strategy-failed",
    });
  }
});

// トレンドキーワード取得
router.get("/trending", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const marketplace = (req.query.marketplace as string) || "jp";
  const asin = req.query.asin as string | undefined;
  const minTrending = parseInt(req.query.minTrending as string) || 10;
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const trendingKeywords = await getTrendingKeywords(
      marketplace as JungleScoutMarketplace,
      asin,
      minTrending,
      limit
    );

    return res.json({
      success: true,
      marketplace,
      asin: asin || null,
      count: trendingKeywords.length,
      keywords: trendingKeywords.map((kw) => ({
        keyword: kw.keyword,
        searchVolume: kw.monthly_search_volume_exact,
        trendingPercentage: kw.trending_percentage,
        ppcBid: kw.ppc_bid_exact,
        easeOfRanking: kw.ease_of_ranking_score,
      })),
    });
  } catch (error) {
    logger.error("Failed to get trending keywords", {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "get-trending-failed",
    });
  }
});

export default router;

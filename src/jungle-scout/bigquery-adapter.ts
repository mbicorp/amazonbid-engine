/**
 * Jungle Scout データ用 BigQuery アダプター
 *
 * Jungle Scoutから取得したデータをBigQueryに保存・取得する
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  JungleScoutMarketplace,
  KeywordIntelligence,
  AsinShareOfVoice,
  KeywordVolumeHistory,
  KeywordStrategyAnalysis,
} from "./types";

// =============================================================================
// 設定
// =============================================================================

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || "rpptool";
const DATASET_ID = process.env.BIGQUERY_DATASET_ID || "amazon_bid_engine";

const TABLES = {
  KEYWORD_INTELLIGENCE: "keyword_intelligence",
  SHARE_OF_VOICE: "asin_share_of_voice",
  VOLUME_HISTORY: "keyword_volume_history",
  STRATEGY_ANALYSIS: "keyword_strategy_analysis",
};

// BigQueryクライアント
let bigqueryClient: BigQuery | null = null;

function getBigQueryClient(): BigQuery {
  if (!bigqueryClient) {
    bigqueryClient = new BigQuery({
      projectId: PROJECT_ID,
    });
  }
  return bigqueryClient;
}

// =============================================================================
// キーワードインテリジェンス
// =============================================================================

/**
 * キーワードインテリジェンスをBigQueryに保存
 */
export async function saveKeywordIntelligence(
  data: KeywordIntelligence[]
): Promise<void> {
  if (data.length === 0) {
    logger.debug("No keyword intelligence data to save");
    return;
  }

  const client = getBigQueryClient();
  const table = client.dataset(DATASET_ID).table(TABLES.KEYWORD_INTELLIGENCE);

  const rows = data.map((item) => ({
    keyword: item.keyword,
    marketplace: item.marketplace,
    asin: item.asin || null,
    monthly_search_volume_exact: item.monthly_search_volume_exact,
    monthly_search_volume_broad: item.monthly_search_volume_broad,
    ppc_bid_broad: item.ppc_bid_broad,
    ppc_bid_exact: item.ppc_bid_exact,
    sp_brand_ad_bid: item.sp_brand_ad_bid,
    ease_of_ranking_score: item.ease_of_ranking_score,
    relevancy_score: item.relevancy_score,
    organic_product_count: item.organic_product_count,
    sponsored_product_count: item.sponsored_product_count,
    trending_direction: item.trending_direction,
    trending_percentage: item.trending_percentage,
    dominant_category: item.dominant_category || null,
    fetched_at: item.fetched_at.toISOString(),
    updated_at: item.updated_at,
  }));

  try {
    await table.insert(rows);
    logger.info("Keyword intelligence saved to BigQuery", {
      count: rows.length,
    });
  } catch (error) {
    logger.error("Failed to save keyword intelligence", {
      error: error instanceof Error ? error.message : String(error),
      count: rows.length,
    });
    throw error;
  }
}

/**
 * 最新のキーワードインテリジェンスを取得
 */
export async function getLatestKeywordIntelligence(
  marketplace: JungleScoutMarketplace,
  asin?: string,
  limit: number = 1000
): Promise<KeywordIntelligence[]> {
  const client = getBigQueryClient();

  let query = `
    SELECT *
    FROM \`${PROJECT_ID}.${DATASET_ID}.v_latest_keyword_intelligence\`
    WHERE marketplace = @marketplace
  `;

  const params: Record<string, string | number> = { marketplace };

  if (asin) {
    query += ` AND asin = @asin`;
    params.asin = asin;
  }

  query += ` ORDER BY monthly_search_volume_exact DESC LIMIT @limit`;
  params.limit = limit;

  const [rows] = await client.query({
    query,
    params,
  });

  return rows.map((row: any) => ({
    keyword: row.keyword,
    marketplace: row.marketplace,
    asin: row.asin,
    monthly_search_volume_exact: row.monthly_search_volume_exact,
    monthly_search_volume_broad: row.monthly_search_volume_broad,
    ppc_bid_broad: row.ppc_bid_broad,
    ppc_bid_exact: row.ppc_bid_exact,
    sp_brand_ad_bid: row.sp_brand_ad_bid,
    ease_of_ranking_score: row.ease_of_ranking_score,
    relevancy_score: row.relevancy_score,
    organic_product_count: row.organic_product_count,
    sponsored_product_count: row.sponsored_product_count,
    trending_direction: row.trending_direction,
    trending_percentage: row.trending_percentage,
    dominant_category: row.dominant_category,
    fetched_at: new Date(row.fetched_at.value),
    updated_at: row.updated_at,
  }));
}

// =============================================================================
// Share of Voice
// =============================================================================

/**
 * Share of VoiceデータをBigQueryに保存
 */
export async function saveShareOfVoice(data: AsinShareOfVoice[]): Promise<void> {
  if (data.length === 0) {
    logger.debug("No share of voice data to save");
    return;
  }

  const client = getBigQueryClient();
  const table = client.dataset(DATASET_ID).table(TABLES.SHARE_OF_VOICE);

  const rows = data.map((item) => ({
    keyword: item.keyword,
    marketplace: item.marketplace,
    asin: item.asin,
    search_volume: item.search_volume,
    organic_rank: item.organic_rank,
    sponsored_rank: item.sponsored_rank,
    combined_rank: item.combined_rank,
    organic_sov: item.organic_sov,
    sponsored_sov: item.sponsored_sov,
    combined_sov: item.combined_sov,
    is_amazon_choice: item.is_amazon_choice,
    is_best_seller: item.is_best_seller,
    fetched_at: item.fetched_at.toISOString(),
  }));

  try {
    await table.insert(rows);
    logger.info("Share of Voice saved to BigQuery", { count: rows.length });
  } catch (error) {
    logger.error("Failed to save Share of Voice", {
      error: error instanceof Error ? error.message : String(error),
      count: rows.length,
    });
    throw error;
  }
}

/**
 * 最新のShare of Voiceを取得
 */
export async function getLatestShareOfVoice(
  marketplace: JungleScoutMarketplace,
  asin: string,
  limit: number = 500
): Promise<AsinShareOfVoice[]> {
  const client = getBigQueryClient();

  const query = `
    SELECT *
    FROM \`${PROJECT_ID}.${DATASET_ID}.v_latest_share_of_voice\`
    WHERE marketplace = @marketplace
      AND asin = @asin
    ORDER BY search_volume DESC
    LIMIT @limit
  `;

  const [rows] = await client.query({
    query,
    params: { marketplace, asin, limit },
  });

  return rows.map((row: any) => ({
    keyword: row.keyword,
    marketplace: row.marketplace,
    asin: row.asin,
    search_volume: row.search_volume,
    organic_rank: row.organic_rank,
    sponsored_rank: row.sponsored_rank,
    combined_rank: row.combined_rank,
    organic_sov: row.organic_sov,
    sponsored_sov: row.sponsored_sov,
    combined_sov: row.combined_sov,
    is_amazon_choice: row.is_amazon_choice,
    is_best_seller: row.is_best_seller,
    fetched_at: new Date(row.fetched_at.value),
  }));
}

/**
 * ASIN別サマリーを取得
 */
export async function getAsinKeywordSummary(
  marketplace: JungleScoutMarketplace,
  asin: string
): Promise<{
  totalKeywords: number;
  totalSearchVolume: number;
  avgCombinedSov: number;
  avgOrganicSov: number;
  avgSponsoredSov: number;
  top10OrganicKeywords: number;
  amazonChoiceCount: number;
  bestSellerCount: number;
} | null> {
  const client = getBigQueryClient();

  const query = `
    SELECT *
    FROM \`${PROJECT_ID}.${DATASET_ID}.v_asin_keyword_summary\`
    WHERE marketplace = @marketplace
      AND asin = @asin
  `;

  const [rows] = await client.query({
    query,
    params: { marketplace, asin },
  });

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    totalKeywords: row.total_keywords,
    totalSearchVolume: row.total_search_volume,
    avgCombinedSov: row.avg_combined_sov,
    avgOrganicSov: row.avg_organic_sov,
    avgSponsoredSov: row.avg_sponsored_sov,
    top10OrganicKeywords: row.top10_organic_keywords,
    amazonChoiceCount: row.amazon_choice_count,
    bestSellerCount: row.best_seller_count,
  };
}

// =============================================================================
// キーワードボリューム履歴
// =============================================================================

/**
 * キーワードボリューム履歴をBigQueryに保存
 */
export async function saveVolumeHistory(
  data: KeywordVolumeHistory[]
): Promise<void> {
  if (data.length === 0) {
    logger.debug("No volume history data to save");
    return;
  }

  const client = getBigQueryClient();
  const table = client.dataset(DATASET_ID).table(TABLES.VOLUME_HISTORY);

  const rows = data.map((item) => ({
    keyword: item.keyword,
    marketplace: item.marketplace,
    date: item.date,
    search_volume_exact: item.search_volume_exact,
    search_volume_broad: item.search_volume_broad,
    fetched_at: item.fetched_at.toISOString(),
  }));

  try {
    await table.insert(rows);
    logger.info("Volume history saved to BigQuery", { count: rows.length });
  } catch (error) {
    logger.error("Failed to save volume history", {
      error: error instanceof Error ? error.message : String(error),
      count: rows.length,
    });
    throw error;
  }
}

/**
 * キーワードのボリューム履歴を取得
 */
export async function getVolumeHistory(
  keyword: string,
  marketplace: JungleScoutMarketplace,
  days: number = 90
): Promise<KeywordVolumeHistory[]> {
  const client = getBigQueryClient();

  const query = `
    SELECT DISTINCT
      keyword,
      marketplace,
      date,
      search_volume_exact,
      search_volume_broad,
      fetched_at
    FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLES.VOLUME_HISTORY}\`
    WHERE keyword = @keyword
      AND marketplace = @marketplace
      AND fetched_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    ORDER BY date DESC
  `;

  const [rows] = await client.query({
    query,
    params: { keyword, marketplace, days },
  });

  return rows.map((row: any) => ({
    keyword: row.keyword,
    marketplace: row.marketplace,
    date: row.date,
    search_volume_exact: row.search_volume_exact,
    search_volume_broad: row.search_volume_broad,
    fetched_at: new Date(row.fetched_at.value),
  }));
}

// =============================================================================
// 戦略分析
// =============================================================================

/**
 * 戦略分析結果をBigQueryに保存
 */
export async function saveStrategyAnalysis(
  data: KeywordStrategyAnalysis[]
): Promise<void> {
  if (data.length === 0) {
    logger.debug("No strategy analysis data to save");
    return;
  }

  const client = getBigQueryClient();
  const table = client.dataset(DATASET_ID).table(TABLES.STRATEGY_ANALYSIS);

  const rows = data.map((item) => ({
    keyword: item.keyword,
    asin: item.asin,
    marketplace: item.marketplace,
    current_organic_rank: item.current_organic_rank,
    current_sponsored_rank: item.current_sponsored_rank,
    current_sov: item.current_sov,
    search_volume: item.search_volume,
    recommended_strategy: item.recommended_strategy,
    strategy_reason: item.strategy_reason,
    recommended_bid_adjustment: item.recommended_bid_adjustment,
    recommended_acos_target: item.recommended_acos_target,
    potential_score: item.potential_score,
    competition_level: item.competition_level,
    analyzed_at: item.analyzed_at.toISOString(),
  }));

  try {
    await table.insert(rows);
    logger.info("Strategy analysis saved to BigQuery", { count: rows.length });
  } catch (error) {
    logger.error("Failed to save strategy analysis", {
      error: error instanceof Error ? error.message : String(error),
      count: rows.length,
    });
    throw error;
  }
}

/**
 * 最新の戦略分析結果を取得
 */
export async function getLatestStrategyAnalysis(
  marketplace: JungleScoutMarketplace,
  asin: string,
  strategy?: string
): Promise<KeywordStrategyAnalysis[]> {
  const client = getBigQueryClient();

  let query = `
    SELECT *
    FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLES.STRATEGY_ANALYSIS}\`
    WHERE marketplace = @marketplace
      AND asin = @asin
      AND analyzed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  `;

  const params: Record<string, string> = { marketplace, asin };

  if (strategy) {
    query += ` AND recommended_strategy = @strategy`;
    params.strategy = strategy;
  }

  query += ` ORDER BY search_volume DESC`;

  const [rows] = await client.query({
    query,
    params,
  });

  return rows.map((row: any) => ({
    keyword: row.keyword,
    asin: row.asin,
    marketplace: row.marketplace,
    current_organic_rank: row.current_organic_rank,
    current_sponsored_rank: row.current_sponsored_rank,
    current_sov: row.current_sov,
    search_volume: row.search_volume,
    recommended_strategy: row.recommended_strategy,
    strategy_reason: row.strategy_reason,
    recommended_bid_adjustment: row.recommended_bid_adjustment,
    recommended_acos_target: row.recommended_acos_target,
    potential_score: row.potential_score,
    competition_level: row.competition_level,
    analyzed_at: new Date(row.analyzed_at.value),
  }));
}

/**
 * 戦略サマリーを取得
 */
export async function getStrategySummary(
  marketplace: JungleScoutMarketplace,
  asin: string
): Promise<
  Array<{
    strategy: string;
    keywordCount: number;
    totalSearchVolume: number;
    avgCurrentSov: number;
    avgPotentialScore: number;
    avgBidAdjustment: number;
  }>
> {
  const client = getBigQueryClient();

  const query = `
    SELECT
      recommended_strategy as strategy,
      keyword_count,
      total_search_volume,
      avg_current_sov,
      avg_potential_score,
      avg_bid_adjustment
    FROM \`${PROJECT_ID}.${DATASET_ID}.v_strategy_summary\`
    WHERE marketplace = @marketplace
      AND asin = @asin
    ORDER BY keyword_count DESC
  `;

  const [rows] = await client.query({
    query,
    params: { marketplace, asin },
  });

  return rows.map((row: any) => ({
    strategy: row.strategy,
    keywordCount: row.keyword_count,
    totalSearchVolume: row.total_search_volume,
    avgCurrentSov: row.avg_current_sov,
    avgPotentialScore: row.avg_potential_score,
    avgBidAdjustment: row.avg_bid_adjustment,
  }));
}

// =============================================================================
// トレンドキーワード
// =============================================================================

/**
 * トレンド上昇中のキーワードを取得
 */
export async function getTrendingKeywords(
  marketplace: JungleScoutMarketplace,
  asin?: string,
  minTrendingPercentage: number = 10,
  limit: number = 100
): Promise<KeywordIntelligence[]> {
  const client = getBigQueryClient();

  let query = `
    SELECT *
    FROM \`${PROJECT_ID}.${DATASET_ID}.v_trending_keywords\`
    WHERE marketplace = @marketplace
      AND trending_percentage >= @minTrendingPercentage
  `;

  const params: Record<string, string | number> = {
    marketplace,
    minTrendingPercentage,
  };

  if (asin) {
    query += ` AND asin = @asin`;
    params.asin = asin;
  }

  query += ` ORDER BY trending_percentage DESC LIMIT @limit`;
  params.limit = limit;

  const [rows] = await client.query({
    query,
    params,
  });

  return rows.map((row: any) => ({
    keyword: row.keyword,
    marketplace: row.marketplace,
    asin: row.asin,
    monthly_search_volume_exact: row.monthly_search_volume_exact,
    monthly_search_volume_broad: 0,
    ppc_bid_broad: 0,
    ppc_bid_exact: row.ppc_bid_exact,
    sp_brand_ad_bid: 0,
    ease_of_ranking_score: row.ease_of_ranking_score,
    relevancy_score: 0,
    organic_product_count: 0,
    sponsored_product_count: 0,
    trending_direction: row.trending_direction,
    trending_percentage: row.trending_percentage,
    dominant_category: "",
    fetched_at: new Date(row.fetched_at.value),
    updated_at: "",
  }));
}

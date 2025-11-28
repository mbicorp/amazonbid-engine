/**
 * 統合入札戦略エンジン - BigQueryアダプター
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  ProductProfitability,
  UnifiedBidStrategy,
  UnifiedStrategySummary,
} from "./types";
import { UNIFIED_BIGQUERY_TABLES } from "./config";

// =============================================================================
// 設定
// =============================================================================

const PROJECT_ID = process.env.BIGQUERY_PROJECT_ID || "rpptool";
const DATASET_ID = process.env.BIGQUERY_DATASET_ID || "amazon_bid_engine";

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
// 商品収益性データ
// =============================================================================

/**
 * 商品収益性データを保存
 */
export async function saveProductProfitability(
  data: ProductProfitability[]
): Promise<void> {
  if (data.length === 0) return;

  const client = getBigQueryClient();
  const table = client
    .dataset(DATASET_ID)
    .table(UNIFIED_BIGQUERY_TABLES.PRODUCT_PROFITABILITY);

  const rows = data.map((item) => ({
    asin: item.asin,
    marketplace: item.marketplace,
    total_sales_30d: item.total_sales_30d,
    total_sales_previous_30d: item.total_sales_previous_30d,
    ad_sales_30d: item.ad_sales_30d,
    organic_sales_30d: item.organic_sales_30d,
    profit_margin: item.profit_margin,
    unit_profit: item.unit_profit,
    ad_spend_30d: item.ad_spend_30d,
    total_ad_cost: item.total_ad_cost,
    ad_dependency_ratio: item.ad_dependency_ratio,
    sales_growth_rate: item.sales_growth_rate,
    total_roas: item.total_roas,
    ad_roas: item.ad_roas,
    profit_after_ad: item.profit_after_ad,
    updated_at: item.updated_at.toISOString(),
  }));

  try {
    await table.insert(rows);
    logger.info("Product profitability saved", { count: rows.length });
  } catch (error) {
    logger.error("Failed to save product profitability", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 最新の商品収益性データを取得
 */
export async function getLatestProductProfitability(
  marketplace: string,
  asin: string
): Promise<ProductProfitability | null> {
  const client = getBigQueryClient();

  const query = `
    SELECT *
    FROM \`${PROJECT_ID}.${DATASET_ID}.${UNIFIED_BIGQUERY_TABLES.PRODUCT_PROFITABILITY}\`
    WHERE marketplace = @marketplace
      AND asin = @asin
    ORDER BY updated_at DESC
    LIMIT 1
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
    asin: row.asin,
    marketplace: row.marketplace,
    total_sales_30d: row.total_sales_30d,
    total_sales_previous_30d: row.total_sales_previous_30d,
    ad_sales_30d: row.ad_sales_30d,
    organic_sales_30d: row.organic_sales_30d,
    profit_margin: row.profit_margin,
    unit_profit: row.unit_profit,
    ad_spend_30d: row.ad_spend_30d,
    total_ad_cost: row.total_ad_cost,
    ad_dependency_ratio: row.ad_dependency_ratio,
    sales_growth_rate: row.sales_growth_rate,
    total_roas: row.total_roas,
    ad_roas: row.ad_roas,
    profit_after_ad: row.profit_after_ad,
    updated_at: new Date(row.updated_at.value),
  };
}

// =============================================================================
// 統合戦略データ
// =============================================================================

/**
 * 統合戦略を保存
 */
export async function saveUnifiedStrategies(
  data: UnifiedBidStrategy[]
): Promise<void> {
  if (data.length === 0) return;

  const client = getBigQueryClient();
  const table = client
    .dataset(DATASET_ID)
    .table(UNIFIED_BIGQUERY_TABLES.UNIFIED_STRATEGY);

  const rows = data.map((item) => ({
    asin: item.asin,
    keyword: item.keyword,
    keyword_id: item.keyword_id,
    campaign_id: item.campaign_id,
    ad_group_id: item.ad_group_id,
    marketplace: item.marketplace,

    product_strategy: item.product_strategy,
    product_lifecycle: item.product_lifecycle,
    product_profit_margin: item.product_profit_margin,

    keyword_strategy: item.keyword_strategy,
    organic_rank: item.organic_rank,
    sponsored_rank: item.sponsored_rank,
    share_of_voice: item.share_of_voice,
    search_volume: item.search_volume,
    keyword_potential_score: item.keyword_potential_score,

    current_acos: item.current_acos,
    current_cvr: item.current_cvr,
    current_ctr: item.current_ctr,
    current_bid: item.current_bid,
    clicks_30d: item.clicks_30d,
    impressions_30d: item.impressions_30d,

    final_action: item.final_action,
    dynamic_acos_target: item.dynamic_acos_target,
    recommended_bid: item.recommended_bid,
    bid_adjustment_rate: item.bid_adjustment_rate,

    strategy_reason: item.strategy_reason,
    constraints_applied: JSON.stringify(item.constraints_applied),

    priority_score: item.priority_score,
    confidence_score: item.confidence_score,

    analyzed_at: item.analyzed_at.toISOString(),
  }));

  try {
    await table.insert(rows);
    logger.info("Unified strategies saved", { count: rows.length });
  } catch (error) {
    logger.error("Failed to save unified strategies", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 最新の統合戦略を取得
 */
export async function getLatestUnifiedStrategies(
  marketplace: string,
  asin: string,
  limit: number = 500
): Promise<UnifiedBidStrategy[]> {
  const client = getBigQueryClient();

  const query = `
    WITH latest AS (
      SELECT
        keyword,
        MAX(analyzed_at) as max_analyzed_at
      FROM \`${PROJECT_ID}.${DATASET_ID}.${UNIFIED_BIGQUERY_TABLES.UNIFIED_STRATEGY}\`
      WHERE marketplace = @marketplace
        AND asin = @asin
      GROUP BY keyword
    )
    SELECT s.*
    FROM \`${PROJECT_ID}.${DATASET_ID}.${UNIFIED_BIGQUERY_TABLES.UNIFIED_STRATEGY}\` s
    INNER JOIN latest l
      ON s.keyword = l.keyword AND s.analyzed_at = l.max_analyzed_at
    WHERE s.marketplace = @marketplace
      AND s.asin = @asin
    ORDER BY s.priority_score DESC
    LIMIT @limit
  `;

  const [rows] = await client.query({
    query,
    params: { marketplace, asin, limit },
  });

  return rows.map((row: any) => ({
    asin: row.asin,
    keyword: row.keyword,
    keyword_id: row.keyword_id,
    campaign_id: row.campaign_id,
    ad_group_id: row.ad_group_id,
    marketplace: row.marketplace,

    product_strategy: row.product_strategy,
    product_lifecycle: row.product_lifecycle,
    product_profit_margin: row.product_profit_margin,

    keyword_strategy: row.keyword_strategy,
    organic_rank: row.organic_rank,
    sponsored_rank: row.sponsored_rank,
    share_of_voice: row.share_of_voice,
    search_volume: row.search_volume,
    keyword_potential_score: row.keyword_potential_score,

    current_acos: row.current_acos,
    current_cvr: row.current_cvr,
    current_ctr: row.current_ctr,
    current_bid: row.current_bid,
    clicks_30d: row.clicks_30d,
    impressions_30d: row.impressions_30d,

    final_action: row.final_action,
    dynamic_acos_target: row.dynamic_acos_target,
    recommended_bid: row.recommended_bid,
    bid_adjustment_rate: row.bid_adjustment_rate,

    strategy_reason: row.strategy_reason,
    constraints_applied: JSON.parse(row.constraints_applied || "[]"),

    priority_score: row.priority_score,
    confidence_score: row.confidence_score,

    analyzed_at: new Date(row.analyzed_at.value),
  }));
}

/**
 * アクション別統合戦略を取得
 */
export async function getUnifiedStrategiesByAction(
  marketplace: string,
  asin: string,
  action: string
): Promise<UnifiedBidStrategy[]> {
  const client = getBigQueryClient();

  const query = `
    SELECT *
    FROM \`${PROJECT_ID}.${DATASET_ID}.${UNIFIED_BIGQUERY_TABLES.UNIFIED_STRATEGY}\`
    WHERE marketplace = @marketplace
      AND asin = @asin
      AND final_action = @action
      AND analyzed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
    ORDER BY priority_score DESC
  `;

  const [rows] = await client.query({
    query,
    params: { marketplace, asin, action },
  });

  return rows.map((row: any) => ({
    asin: row.asin,
    keyword: row.keyword,
    keyword_id: row.keyword_id,
    campaign_id: row.campaign_id,
    ad_group_id: row.ad_group_id,
    marketplace: row.marketplace,

    product_strategy: row.product_strategy,
    product_lifecycle: row.product_lifecycle,
    product_profit_margin: row.product_profit_margin,

    keyword_strategy: row.keyword_strategy,
    organic_rank: row.organic_rank,
    sponsored_rank: row.sponsored_rank,
    share_of_voice: row.share_of_voice,
    search_volume: row.search_volume,
    keyword_potential_score: row.keyword_potential_score,

    current_acos: row.current_acos,
    current_cvr: row.current_cvr,
    current_ctr: row.current_ctr,
    current_bid: row.current_bid,
    clicks_30d: row.clicks_30d,
    impressions_30d: row.impressions_30d,

    final_action: row.final_action,
    dynamic_acos_target: row.dynamic_acos_target,
    recommended_bid: row.recommended_bid,
    bid_adjustment_rate: row.bid_adjustment_rate,

    strategy_reason: row.strategy_reason,
    constraints_applied: JSON.parse(row.constraints_applied || "[]"),

    priority_score: row.priority_score,
    confidence_score: row.confidence_score,

    analyzed_at: new Date(row.analyzed_at.value),
  }));
}

// =============================================================================
// サマリーデータ
// =============================================================================

/**
 * 戦略サマリーを保存
 */
export async function saveStrategySummary(
  data: UnifiedStrategySummary
): Promise<void> {
  const client = getBigQueryClient();
  const table = client
    .dataset(DATASET_ID)
    .table(UNIFIED_BIGQUERY_TABLES.STRATEGY_SUMMARY);

  const row = {
    asin: data.asin,
    marketplace: data.marketplace,
    product_strategy: data.product_strategy,
    product_lifecycle: data.product_lifecycle,
    total_sales_30d: data.total_sales_30d,
    profit_margin: data.profit_margin,
    ad_dependency_ratio: data.ad_dependency_ratio,
    total_keywords: data.total_keywords,
    keywords_by_strategy: JSON.stringify(data.keywords_by_strategy),
    total_search_volume: data.total_search_volume,
    avg_share_of_voice: data.avg_share_of_voice,
    actions_breakdown: JSON.stringify(data.actions_breakdown),
    recommended_budget_allocation: JSON.stringify(
      data.recommended_budget_allocation
    ),
    expected_impact: JSON.stringify(data.expected_impact),
    analyzed_at: data.analyzed_at.toISOString(),
  };

  try {
    await table.insert([row]);
    logger.info("Strategy summary saved", { asin: data.asin });
  } catch (error) {
    logger.error("Failed to save strategy summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 最新のサマリーを取得
 */
export async function getLatestStrategySummary(
  marketplace: string,
  asin: string
): Promise<UnifiedStrategySummary | null> {
  const client = getBigQueryClient();

  const query = `
    SELECT *
    FROM \`${PROJECT_ID}.${DATASET_ID}.${UNIFIED_BIGQUERY_TABLES.STRATEGY_SUMMARY}\`
    WHERE marketplace = @marketplace
      AND asin = @asin
    ORDER BY analyzed_at DESC
    LIMIT 1
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
    asin: row.asin,
    marketplace: row.marketplace,
    product_strategy: row.product_strategy,
    product_lifecycle: row.product_lifecycle,
    total_sales_30d: row.total_sales_30d,
    profit_margin: row.profit_margin,
    ad_dependency_ratio: row.ad_dependency_ratio,
    total_keywords: row.total_keywords,
    keywords_by_strategy: JSON.parse(row.keywords_by_strategy),
    total_search_volume: row.total_search_volume,
    avg_share_of_voice: row.avg_share_of_voice,
    actions_breakdown: JSON.parse(row.actions_breakdown),
    recommended_budget_allocation: JSON.parse(
      row.recommended_budget_allocation
    ),
    expected_impact: JSON.parse(row.expected_impact),
    analyzed_at: new Date(row.analyzed_at.value),
  };
}

// =============================================================================
// 集計クエリ
// =============================================================================

/**
 * ASIN別アクション集計を取得
 */
export async function getActionSummaryByAsin(
  marketplace: string,
  asin: string
): Promise<{
  action: string;
  count: number;
  avgBidAdjustment: number;
  totalSearchVolume: number;
}[]> {
  const client = getBigQueryClient();

  const query = `
    SELECT
      final_action as action,
      COUNT(*) as count,
      AVG(bid_adjustment_rate) as avg_bid_adjustment,
      SUM(search_volume) as total_search_volume
    FROM \`${PROJECT_ID}.${DATASET_ID}.${UNIFIED_BIGQUERY_TABLES.UNIFIED_STRATEGY}\`
    WHERE marketplace = @marketplace
      AND asin = @asin
      AND analyzed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
    GROUP BY final_action
    ORDER BY count DESC
  `;

  const [rows] = await client.query({
    query,
    params: { marketplace, asin },
  });

  return rows.map((row: any) => ({
    action: row.action,
    count: row.count,
    avgBidAdjustment: row.avg_bid_adjustment,
    totalSearchVolume: row.total_search_volume,
  }));
}

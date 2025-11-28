/**
 * キーワードメトリクス集計ジョブ
 *
 * 過去60日間のキーワードパフォーマンスデータを集計し、
 * 正規化スコアを計算してkeyword_metrics_60dテーブルに保存
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../../logger";

interface AggregationConfig {
  projectId: string;
  dataset: string;
  dryRun?: boolean;
}

/**
 * キーワードメトリクス集計クエリを生成
 */
function generateAggregationQuery(config: AggregationConfig): string {
  const { projectId, dataset } = config;

  return `
-- キーワードメトリクス60日集計
-- 過去60日のキーワード別パフォーマンスを集計し、正規化スコアを計算

DECLARE target_date DATE DEFAULT CURRENT_DATE();
DECLARE period_start DATE DEFAULT DATE_SUB(target_date, INTERVAL 60 DAY);

-- 既存データを削除（当日分）
DELETE FROM \`${projectId}.${dataset}.keyword_metrics_60d\`
WHERE period_end = target_date;

-- 新規データを挿入
INSERT INTO \`${projectId}.${dataset}.keyword_metrics_60d\`
(
  product_id,
  keyword,
  period_start,
  period_end,
  impressions_60d,
  clicks_60d,
  orders_60d,
  ad_sales_60d,
  ad_spend_60d,
  ctr_60d,
  cvr_60d,
  acos_60d,
  gross_profit_60d,
  net_profit_60d,
  search_volume,
  js_relevancy,
  volume_score,
  traffic_score,
  ctr_score,
  cvr_score,
  profit_score,
  semantic_relevance_score,
  text_match_score,
  category,
  word_count,
  performance_core_score,
  performance_support_score,
  performance_longtail_score,
  has_sufficient_data
)
WITH
-- 基本集計
base_metrics AS (
  SELECT
    product_id,
    keyword,
    period_start AS period_start_val,
    target_date AS period_end_val,
    SUM(impressions) AS impressions_60d,
    SUM(clicks) AS clicks_60d,
    SUM(orders) AS orders_60d,
    SUM(ad_sales_jpy) AS ad_sales_60d,
    SUM(ad_spend_jpy) AS ad_spend_60d
  FROM \`${projectId}.${dataset}.keyword_stats_daily\`
  WHERE report_date BETWEEN period_start AND target_date
  GROUP BY product_id, keyword
),

-- Jungle Scoutデータを結合
with_js AS (
  SELECT
    m.*,
    js.search_volume,
    js.relevancy_score AS js_relevancy
  FROM base_metrics m
  LEFT JOIN (
    SELECT
      asin AS product_id,
      keyword,
      monthly_search_volume AS search_volume,
      relevancy_score
    FROM \`${projectId}.${dataset}.jungle_scout_keywords\`
    WHERE fetch_date = (
      SELECT MAX(fetch_date) FROM \`${projectId}.${dataset}.jungle_scout_keywords\`
    )
  ) js ON m.product_id = js.product_id AND m.keyword = js.keyword
),

-- 計算指標を追加
with_calculated AS (
  SELECT
    *,
    SAFE_DIVIDE(clicks_60d, impressions_60d) AS ctr_60d,
    SAFE_DIVIDE(orders_60d, clicks_60d) AS cvr_60d,
    SAFE_DIVIDE(ad_spend_60d, ad_sales_60d) AS acos_60d,
    -- 粗利計算（商品戦略から利益率を取得）
    ad_sales_60d * COALESCE(ps.profit_margin, 0.3) AS gross_profit_60d,
    ad_sales_60d * COALESCE(ps.profit_margin, 0.3) - ad_spend_60d AS net_profit_60d,
    ps.brand_keywords,
    ps.product_core_terms
  FROM with_js w
  LEFT JOIN (
    SELECT product_id, profit_margin, brand_keywords, product_core_terms
    FROM \`${projectId}.${dataset}.product_strategy\`
  ) ps ON w.product_id = ps.product_id
),

-- キーワードカテゴリ分類
with_category AS (
  SELECT
    *,
    -- ワード数
    ARRAY_LENGTH(SPLIT(keyword, ' ')) AS word_count,
    -- カテゴリ判定
    CASE
      WHEN EXISTS(
        SELECT 1 FROM UNNEST(brand_keywords) bk
        WHERE LOWER(keyword) LIKE CONCAT('%', LOWER(bk), '%')
      ) THEN 'brand'
      WHEN EXISTS(
        SELECT 1 FROM UNNEST(product_core_terms) ct
        WHERE LOWER(keyword) LIKE CONCAT('%', LOWER(ct), '%')
      ) AND ARRAY_LENGTH(SPLIT(keyword, ' ')) <= 3 THEN 'core'
      WHEN EXISTS(
        SELECT 1 FROM UNNEST(product_core_terms) ct
        WHERE LOWER(keyword) LIKE CONCAT('%', LOWER(ct), '%')
      ) THEN 'support'
      WHEN ARRAY_LENGTH(SPLIT(keyword, ' ')) >= 4 THEN 'longtail_experiment'
      ELSE 'other'
    END AS category
  FROM with_calculated
),

-- 正規化のための統計量を計算
stats AS (
  SELECT
    MAX(search_volume) AS max_search_volume,
    MAX(impressions_60d) AS max_impressions,
    MAX(ctr_60d) AS max_ctr,
    MAX(cvr_60d) AS max_cvr,
    MAX(net_profit_60d) AS max_net_profit,
    MIN(net_profit_60d) AS min_net_profit,
    MAX(js_relevancy) AS max_relevancy
  FROM with_category
),

-- 正規化スコアを計算
with_scores AS (
  SELECT
    c.*,
    -- volume_score: 検索ボリュームの対数正規化
    CASE
      WHEN c.search_volume IS NULL OR c.search_volume = 0 THEN 0
      ELSE SAFE_DIVIDE(LN(c.search_volume + 1), LN(s.max_search_volume + 1))
    END AS volume_score,
    -- traffic_score: インプレッションの対数正規化
    CASE
      WHEN c.impressions_60d = 0 THEN 0
      ELSE SAFE_DIVIDE(LN(c.impressions_60d + 1), LN(s.max_impressions + 1))
    END AS traffic_score,
    -- ctr_score: CTRの正規化
    SAFE_DIVIDE(c.ctr_60d, s.max_ctr) AS ctr_score,
    -- cvr_score: CVRの正規化
    SAFE_DIVIDE(c.cvr_60d, s.max_cvr) AS cvr_score,
    -- profit_score: 利益の正規化（-1〜1）
    CASE
      WHEN s.max_net_profit = s.min_net_profit THEN 0
      ELSE SAFE_DIVIDE(
        c.net_profit_60d - s.min_net_profit,
        s.max_net_profit - s.min_net_profit
      ) * 2 - 1
    END AS profit_score,
    -- semantic_relevance_score: Jungle Scout関連性スコア
    SAFE_DIVIDE(c.js_relevancy, s.max_relevancy) AS semantic_relevance_score,
    -- text_match_score: 商品コア用語との一致度（簡易実装）
    CASE
      WHEN c.category IN ('brand', 'core') THEN 1.0
      WHEN c.category = 'support' THEN 0.7
      ELSE 0.3
    END AS text_match_score,
    -- データ十分性判定
    c.impressions_60d >= 100 AS has_sufficient_data
  FROM with_category c
  CROSS JOIN stats s
)

-- 最終出力
SELECT
  product_id,
  keyword,
  period_start_val AS period_start,
  period_end_val AS period_end,
  impressions_60d,
  clicks_60d,
  orders_60d,
  ad_sales_60d,
  ad_spend_60d,
  ctr_60d,
  cvr_60d,
  acos_60d,
  gross_profit_60d,
  net_profit_60d,
  search_volume,
  js_relevancy,
  volume_score,
  traffic_score,
  ctr_score,
  cvr_score,
  profit_score,
  semantic_relevance_score,
  text_match_score,
  category,
  word_count,
  -- パフォーマンススコア計算
  -- core用: volume重視
  0.4 * COALESCE(volume_score, 0) +
  0.3 * COALESCE(traffic_score, 0) +
  0.2 * COALESCE(cvr_score, 0) +
  0.1 * COALESCE(profit_score, 0) AS performance_core_score,
  -- support用: traffic重視
  0.3 * COALESCE(volume_score, 0) +
  0.35 * COALESCE(traffic_score, 0) +
  0.2 * COALESCE(cvr_score, 0) +
  0.15 * COALESCE(profit_score, 0) AS performance_support_score,
  -- longtail用: CVR重視
  0.1 * COALESCE(volume_score, 0) +
  0.2 * COALESCE(traffic_score, 0) +
  0.4 * COALESCE(cvr_score, 0) +
  0.3 * COALESCE(profit_score, 0) AS performance_longtail_score,
  has_sufficient_data
FROM with_scores;
`;
}

/**
 * キーワードメトリクス集計を実行
 */
export async function runKeywordMetricsAggregation(
  config: AggregationConfig
): Promise<{ processedCount: number }> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  logger.info("Starting keyword metrics aggregation", {
    projectId: config.projectId,
    dataset: config.dataset,
    dryRun: config.dryRun,
  });

  const query = generateAggregationQuery(config);

  if (config.dryRun) {
    logger.info("[DRY RUN] Would execute aggregation query", {
      queryPreview: query.substring(0, 500) + "...",
    });
    return { processedCount: 0 };
  }

  try {
    const [job] = await bigquery.createQueryJob({
      query,
      location: "asia-northeast1",
    });

    logger.info("Aggregation job created", { jobId: job.id });

    const [results] = await job.getQueryResults();

    // 集計結果の件数を取得
    const countQuery = `
      SELECT COUNT(*) as count
      FROM \`${config.projectId}.${config.dataset}.keyword_metrics_60d\`
      WHERE period_end = CURRENT_DATE()
    `;
    const [countResults] = await bigquery.query(countQuery);
    const processedCount = countResults[0]?.count || 0;

    logger.info("Keyword metrics aggregation completed", {
      processedCount,
    });

    return { processedCount };
  } catch (error) {
    logger.error("Keyword metrics aggregation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

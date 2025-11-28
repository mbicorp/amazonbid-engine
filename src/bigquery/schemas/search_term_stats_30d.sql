-- =============================================================================
-- 検索クエリ統計ビュー（30日）
-- ネガティブキーワード候補検出用の検索クエリパフォーマンス集計
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.search_term_stats_30d` AS
WITH
-- 過去30日の検索クエリデータを集計
search_term_aggregated AS (
  SELECT
    asin,
    query,
    match_type,
    SUM(impressions) AS impressions_30d,
    SUM(clicks) AS clicks_30d,
    SUM(cost) AS cost_30d,
    SUM(conversions) AS conversions_30d,
    SUM(revenue) AS revenue_30d
  FROM `${PROJECT_ID}.${DATASET}.search_term_report`
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY asin, query, match_type
),

-- product_strategyからproduct_core_termsを取得してintent_cluster_idを付与
product_terms AS (
  SELECT
    product_id AS asin,
    core_term
  FROM `${PROJECT_ID}.${DATASET}.product_strategy_current`,
  UNNEST(product_core_terms) AS core_term
)

SELECT
  sta.asin,
  sta.query,
  sta.match_type,

  -- intent_cluster_id: クエリに含まれるproduct_core_termをクラスタIDとして使用
  -- 複数マッチする場合は最初のものを使用
  (
    SELECT MIN(pt.core_term)
    FROM product_terms pt
    WHERE pt.asin = sta.asin
      AND LOWER(sta.query) LIKE CONCAT('%', LOWER(pt.core_term), '%')
  ) AS intent_cluster_id,

  -- 基本指標
  sta.impressions_30d,
  sta.clicks_30d,
  sta.cost_30d,
  sta.conversions_30d,
  sta.revenue_30d,

  -- 計算指標
  SAFE_DIVIDE(sta.cost_30d, sta.clicks_30d) AS cpc_30d,
  SAFE_DIVIDE(sta.conversions_30d, sta.clicks_30d) AS cvr_30d,
  SAFE_DIVIDE(sta.cost_30d, sta.revenue_30d) AS acos_30d

FROM search_term_aggregated sta;

-- =============================================================================
-- コメント
-- =============================================================================
-- このビューは search_term_report テーブルから過去30日の検索クエリデータを集計し、
-- product_strategy の product_core_terms を使用して intent_cluster_id を付与します。
--
-- intent_cluster_id は、検索クエリに含まれるコアターム（商品の主要キーワード）を
-- 使用して、同じ検索意図を持つクエリをグループ化するために使用されます。
--
-- 使用例:
-- SELECT * FROM `${PROJECT_ID}.${DATASET}.search_term_stats_30d`
-- WHERE asin = 'B0XXXXXXXXX' AND conversions_30d = 0 AND clicks_30d >= 20;

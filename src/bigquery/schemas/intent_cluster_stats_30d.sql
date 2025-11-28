-- =============================================================================
-- 検索意図クラスタ統計ビュー（30日）
-- intent_cluster_id 単位で集計した検索クエリパフォーマンス
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.intent_cluster_stats_30d` AS
SELECT
  asin,
  intent_cluster_id,

  -- クラスタ単位の集計指標
  SUM(impressions_30d) AS cluster_impressions_30d,
  SUM(clicks_30d) AS cluster_clicks_30d,
  SUM(cost_30d) AS cluster_cost_30d,
  SUM(conversions_30d) AS cluster_conversions_30d,
  SUM(revenue_30d) AS cluster_revenue_30d,

  -- クラスタ単位の計算指標
  SAFE_DIVIDE(SUM(cost_30d), SUM(clicks_30d)) AS cluster_cpc_30d,
  SAFE_DIVIDE(SUM(conversions_30d), SUM(clicks_30d)) AS cluster_cvr_30d,
  SAFE_DIVIDE(SUM(cost_30d), SUM(revenue_30d)) AS cluster_acos_30d,

  -- クラスタ内のクエリ数
  COUNT(DISTINCT query) AS queries_in_cluster

FROM `${PROJECT_ID}.${DATASET}.search_term_stats_30d`
WHERE intent_cluster_id IS NOT NULL
GROUP BY asin, intent_cluster_id;

-- =============================================================================
-- コメント
-- =============================================================================
-- このビューは search_term_stats_30d を intent_cluster_id 単位で集計し、
-- 同じ検索意図を持つクエリグループのパフォーマンスを把握するために使用します。
--
-- ネガティブキーワード候補検出では、クラスタ全体でコンバージョンがゼロの場合、
-- そのクラスタに属するすべてのクエリをネガティブ候補として検討します。
--
-- 使用例:
-- SELECT * FROM `${PROJECT_ID}.${DATASET}.intent_cluster_stats_30d`
-- WHERE asin = 'B0XXXXXXXXX'
--   AND cluster_conversions_30d = 0
--   AND cluster_clicks_30d >= 50;

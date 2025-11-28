-- =============================================================================
-- v_execution_asin_summary
--
-- execution_id と asin ごとの集計サマリービュー
-- BigQueryに手動でデプロイして使用
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.amazon_bid_engine.v_execution_asin_summary` AS
SELECT
  -- 実行情報
  e.execution_id,
  e.profile_id,
  e.execution_type,
  e.mode,
  e.started_at,
  e.status AS execution_status,

  -- ASIN情報
  br.asin,

  -- キーワード統計
  COUNT(DISTINCT br.keyword_id) AS total_keywords,

  -- アクション別集計（bid_changeから推定）
  COUNTIF(br.bid_change > 0) AS action_up_count,
  COUNTIF(br.bid_change < 0) AS action_down_count,
  COUNTIF(br.bid_change = 0) AS action_keep_count,

  -- 入札変更統計
  AVG(br.bid_change_ratio) AS avg_bid_change_ratio,
  MAX(br.bid_change_ratio) AS max_bid_change_ratio,
  MIN(br.bid_change_ratio) AS min_bid_change_ratio,
  SUM(br.bid_change) AS total_bid_change,

  -- パフォーマンス集計
  SUM(br.impressions) AS total_impressions,
  SUM(br.clicks) AS total_clicks,
  SUM(br.orders) AS total_orders,
  SUM(br.sales) AS total_sales,
  SUM(br.cost) AS total_cost,

  -- ACOS計算（cost/sales）
  SAFE_DIVIDE(SUM(br.cost), SUM(br.sales)) AS calculated_acos,

  -- CVR計算（orders/clicks）
  SAFE_DIVIDE(SUM(br.orders), SUM(br.clicks)) AS calculated_cvr,

  -- AUTO→EXACT昇格候補数
  -- auto_exact_promotion_suggestionsテーブルとの結合で取得
  COALESCE(aeps.auto_exact_candidates, 0) AS auto_exact_candidates

FROM
  `${PROJECT_ID}.amazon_bid_engine.executions` e
INNER JOIN
  `${PROJECT_ID}.amazon_bid_engine.bid_recommendations` br
  ON e.execution_id = br.execution_id
LEFT JOIN (
  -- AUTO→EXACT昇格候補をASIN単位で集計
  SELECT
    execution_id,
    asin,
    COUNT(*) AS auto_exact_candidates
  FROM
    `${PROJECT_ID}.amazon_bid_engine.auto_exact_promotion_suggestions`
  GROUP BY
    execution_id, asin
) aeps
  ON br.execution_id = aeps.execution_id
  AND br.asin = aeps.asin

WHERE
  br.asin IS NOT NULL

GROUP BY
  e.execution_id,
  e.profile_id,
  e.execution_type,
  e.mode,
  e.started_at,
  e.status,
  br.asin,
  aeps.auto_exact_candidates

ORDER BY
  e.started_at DESC,
  total_keywords DESC;


-- =============================================================================
-- 使用例
-- =============================================================================
--
-- 1. 特定の実行のASINサマリーを取得:
--    SELECT * FROM `project.amazon_bid_engine.v_execution_asin_summary`
--    WHERE execution_id = 'xxx-yyy-zzz'
--    ORDER BY total_keywords DESC;
--
-- 2. 最新実行のASINサマリーを取得:
--    SELECT * FROM `project.amazon_bid_engine.v_execution_asin_summary`
--    WHERE started_at = (
--      SELECT MAX(started_at) FROM `project.amazon_bid_engine.executions`
--    );
--
-- 3. AUTO→EXACT候補があるASINのみ取得:
--    SELECT * FROM `project.amazon_bid_engine.v_execution_asin_summary`
--    WHERE auto_exact_candidates > 0
--    ORDER BY auto_exact_candidates DESC;
-- =============================================================================

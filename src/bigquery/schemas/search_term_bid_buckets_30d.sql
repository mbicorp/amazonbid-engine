-- =============================================================================
-- 入札バケット別検索クエリ統計ビュー（30日）
-- 自動ガードレール計算用の入札レンジ別パフォーマンス集計
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.search_term_bid_buckets_30d` AS
WITH
-- 過去30日の検索クエリデータを集計（入札レンジ付き）
search_term_with_bid_bucket AS (
  SELECT
    krl.asin,
    krl.lifecycle_state,
    -- 入札バケット（20円刻み: 0-20, 20-40, 40-60, ...）
    CAST(FLOOR(krl.old_bid / 20) * 20 AS INT64) AS bid_bucket_lower,
    CAST(FLOOR(krl.old_bid / 20) * 20 + 20 AS INT64) AS bid_bucket_upper,
    krl.impressions_7d,
    krl.clicks_7d,
    krl.spend_7d,
    krl.conversions_7d,
    krl.sales_7d,
    krl.old_bid
  FROM `${PROJECT_ID}.${DATASET}.keyword_recommendations_log` krl
  WHERE DATE(krl.recommended_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND krl.old_bid > 0
    AND krl.asin IS NOT NULL
),

-- lifecycle_state の最頻値を取得（ASINごと）
lifecycle_mode AS (
  SELECT
    asin,
    lifecycle_state,
    COUNT(*) AS cnt
  FROM search_term_with_bid_bucket
  WHERE lifecycle_state IS NOT NULL
  GROUP BY asin, lifecycle_state
  QUALIFY ROW_NUMBER() OVER (PARTITION BY asin ORDER BY cnt DESC) = 1
)

SELECT
  st.asin,
  COALESCE(st.lifecycle_state, lm.lifecycle_state) AS lifecycle_state,

  -- 入札バケット（表示用文字列）
  CONCAT(CAST(st.bid_bucket_lower AS STRING), '-', CAST(st.bid_bucket_upper AS STRING)) AS bid_bucket,
  st.bid_bucket_lower,
  st.bid_bucket_upper,

  -- 集計指標
  SUM(st.impressions_7d) AS impressions_30d,
  SUM(st.clicks_7d) AS clicks_30d,
  SUM(st.spend_7d) AS cost_30d,
  SUM(st.conversions_7d) AS conversions_30d,
  SUM(st.sales_7d) AS revenue_30d,

  -- 平均入札額
  AVG(st.old_bid) AS avg_bid_30d,

  -- 計算指標
  SAFE_DIVIDE(SUM(st.spend_7d), SUM(st.clicks_7d)) AS cpc_30d,
  SAFE_DIVIDE(SUM(st.conversions_7d), SUM(st.clicks_7d)) AS cvr_30d,
  SAFE_DIVIDE(SUM(st.spend_7d), SUM(st.sales_7d)) AS acos_30d,

  -- レコード数（データ量の参考）
  COUNT(*) AS record_count

FROM search_term_with_bid_bucket st
LEFT JOIN lifecycle_mode lm ON st.asin = lm.asin
GROUP BY
  st.asin,
  COALESCE(st.lifecycle_state, lm.lifecycle_state),
  st.bid_bucket_lower,
  st.bid_bucket_upper;

-- =============================================================================
-- コメント
-- =============================================================================
-- このビューは keyword_recommendations_log から過去30日のデータを集計し、
-- 入札レンジ（バケット）ごとのパフォーマンスを提供します。
--
-- bid_bucket は 20円刻みで分類されます:
-- - 0-20: 0円以上20円未満
-- - 20-40: 20円以上40円未満
-- - 40-60: 40円以上60円未満
-- - ...
--
-- 自動ガードレール計算（recomputeGuardrailsForAllProducts）で使用され、
-- 各ASINのlifecycle_state別に有望な入札レンジを特定するために使用されます。
--
-- 使用例:
-- SELECT * FROM `${PROJECT_ID}.${DATASET}.search_term_bid_buckets_30d`
-- WHERE asin = 'B0XXXXXXXXX'
--   AND clicks_30d >= 80
--   AND acos_30d <= 0.30
-- ORDER BY avg_bid_30d;

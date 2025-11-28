-- =============================================================================
-- キーワードメトリクス 7日集計ビュー（直近3日除外版を含む）
--
-- アトリビューション遅延対策のため、以下の指標を提供:
-- - 7d系: 直近7日間のフル集計（アップ判定用）
-- - 7d_excl_recent系: 直近3日を除いた7日間（ダウン判定用）
-- - last3d系: 直近3日間のみ（安全弁判定用）
-- - 30d系: 直近30日間（長期トレンド確認用）
-- =============================================================================

-- 緩衝期間: 直近からこの日数を除外してダウン判定する
-- アトリビューション遅延は通常2-3日のため、3日に設定
DECLARE safe_window_days_for_down INT64 DEFAULT 3;

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.keyword_metrics_7d` AS
WITH
  -- 期間定義
  date_ranges AS (
    SELECT
      CURRENT_DATE() AS today,
      DATE_SUB(CURRENT_DATE(), INTERVAL 6 DAY) AS start_7d,  -- 7日前から今日まで
      DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY) AS end_7d_excl_recent,  -- 直近3日を除く（3日前まで）
      DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY) AS start_30d  -- 30日前から今日まで
  ),

  -- 7日フル集計（アップ判定用）
  metrics_7d AS (
    SELECT
      ksd.product_id AS asin,
      ksd.keyword,
      ksd.match_type,
      ksd.campaign_id,
      ksd.ad_group_id,
      SUM(ksd.impressions) AS impressions_7d,
      SUM(ksd.clicks) AS clicks_7d,
      SUM(ksd.orders) AS orders_7d,
      SUM(ksd.ad_sales_jpy) AS sales_7d,
      SUM(ksd.ad_spend_jpy) AS cost_7d
    FROM `${PROJECT_ID}.${DATASET}.keyword_stats_daily` ksd
    CROSS JOIN date_ranges dr
    WHERE ksd.date BETWEEN dr.start_7d AND dr.today
    GROUP BY ksd.product_id, ksd.keyword, ksd.match_type, ksd.campaign_id, ksd.ad_group_id
  ),

  -- 直近3日を除いた7日分集計（ダウン判定用）
  -- つまり、7日前から3日前までの4日分
  metrics_7d_excl_recent AS (
    SELECT
      ksd.product_id AS asin,
      ksd.keyword,
      ksd.match_type,
      ksd.campaign_id,
      ksd.ad_group_id,
      SUM(ksd.impressions) AS impressions_7d_excl_recent,
      SUM(ksd.clicks) AS clicks_7d_excl_recent,
      SUM(ksd.orders) AS orders_7d_excl_recent,
      SUM(ksd.ad_sales_jpy) AS sales_7d_excl_recent,
      SUM(ksd.ad_spend_jpy) AS cost_7d_excl_recent
    FROM `${PROJECT_ID}.${DATASET}.keyword_stats_daily` ksd
    CROSS JOIN date_ranges dr
    WHERE ksd.date BETWEEN dr.start_7d AND dr.end_7d_excl_recent
    GROUP BY ksd.product_id, ksd.keyword, ksd.match_type, ksd.campaign_id, ksd.ad_group_id
  ),

  -- 直近3日のみ集計（安全弁判定用）
  metrics_last3d AS (
    SELECT
      ksd.product_id AS asin,
      ksd.keyword,
      ksd.match_type,
      ksd.campaign_id,
      ksd.ad_group_id,
      SUM(ksd.impressions) AS impressions_last3d,
      SUM(ksd.clicks) AS clicks_last3d,
      SUM(ksd.orders) AS orders_last3d,
      SUM(ksd.ad_sales_jpy) AS sales_last3d,
      SUM(ksd.ad_spend_jpy) AS cost_last3d
    FROM `${PROJECT_ID}.${DATASET}.keyword_stats_daily` ksd
    CROSS JOIN date_ranges dr
    WHERE ksd.date > dr.end_7d_excl_recent AND ksd.date <= dr.today
    GROUP BY ksd.product_id, ksd.keyword, ksd.match_type, ksd.campaign_id, ksd.ad_group_id
  ),

  -- 30日集計（長期トレンド確認用）
  metrics_30d AS (
    SELECT
      ksd.product_id AS asin,
      ksd.keyword,
      ksd.match_type,
      ksd.campaign_id,
      ksd.ad_group_id,
      SUM(ksd.impressions) AS impressions_30d,
      SUM(ksd.clicks) AS clicks_30d,
      SUM(ksd.orders) AS orders_30d,
      SUM(ksd.ad_sales_jpy) AS sales_30d,
      SUM(ksd.ad_spend_jpy) AS cost_30d
    FROM `${PROJECT_ID}.${DATASET}.keyword_stats_daily` ksd
    CROSS JOIN date_ranges dr
    WHERE ksd.date BETWEEN dr.start_30d AND dr.today
    GROUP BY ksd.product_id, ksd.keyword, ksd.match_type, ksd.campaign_id, ksd.ad_group_id
  ),

  -- 最新の入札額を取得
  latest_bids AS (
    SELECT
      ksd.product_id AS asin,
      ksd.keyword,
      ksd.match_type,
      ksd.campaign_id,
      ksd.ad_group_id,
      -- 最新の日付のCPCから現在の入札額を推定（実際はAmazon Ads APIから取得）
      SAFE_DIVIDE(SUM(ksd.ad_spend_jpy), SUM(ksd.clicks)) AS estimated_cpc
    FROM `${PROJECT_ID}.${DATASET}.keyword_stats_daily` ksd
    WHERE ksd.date = (SELECT MAX(date) FROM `${PROJECT_ID}.${DATASET}.keyword_stats_daily`)
    GROUP BY ksd.product_id, ksd.keyword, ksd.match_type, ksd.campaign_id, ksd.ad_group_id
  )

SELECT
  -- 識別子
  m7.asin,
  m7.keyword AS keyword_text,
  m7.match_type,
  m7.campaign_id,
  m7.ad_group_id,

  -- 現在入札額（推定）
  COALESCE(lb.estimated_cpc, 100) AS current_bid,

  -- ========================================
  -- 7日フル集計（アップ判定用）
  -- ========================================
  COALESCE(m7.impressions_7d, 0) AS impressions_7d,
  COALESCE(m7.clicks_7d, 0) AS clicks_7d,
  COALESCE(m7.orders_7d, 0) AS orders_7d,
  COALESCE(m7.sales_7d, 0) AS sales_7d,
  COALESCE(m7.cost_7d, 0) AS cost_7d,
  -- 計算指標
  SAFE_DIVIDE(m7.clicks_7d, m7.impressions_7d) AS ctr_7d,
  SAFE_DIVIDE(m7.orders_7d, m7.clicks_7d) AS cvr_7d,
  SAFE_DIVIDE(m7.cost_7d, m7.sales_7d) AS acos_7d,

  -- ========================================
  -- 直近3日除外集計（ダウン判定用）
  -- アトリビューション遅延対策
  -- ========================================
  COALESCE(m7excl.impressions_7d_excl_recent, 0) AS impressions_7d_excl_recent,
  COALESCE(m7excl.clicks_7d_excl_recent, 0) AS clicks_7d_excl_recent,
  COALESCE(m7excl.orders_7d_excl_recent, 0) AS orders_7d_excl_recent,
  COALESCE(m7excl.sales_7d_excl_recent, 0) AS sales_7d_excl_recent,
  COALESCE(m7excl.cost_7d_excl_recent, 0) AS cost_7d_excl_recent,
  -- 計算指標
  SAFE_DIVIDE(m7excl.clicks_7d_excl_recent, m7excl.impressions_7d_excl_recent) AS ctr_7d_excl_recent,
  SAFE_DIVIDE(m7excl.orders_7d_excl_recent, m7excl.clicks_7d_excl_recent) AS cvr_7d_excl_recent,
  SAFE_DIVIDE(m7excl.cost_7d_excl_recent, m7excl.sales_7d_excl_recent) AS acos_7d_excl_recent,

  -- ========================================
  -- 直近3日のみ（安全弁判定用）
  -- 直近が好調ならダウン幅を抑える
  -- ========================================
  COALESCE(m3.impressions_last3d, 0) AS impressions_last3d,
  COALESCE(m3.clicks_last3d, 0) AS clicks_last3d,
  COALESCE(m3.orders_last3d, 0) AS orders_last3d,
  COALESCE(m3.sales_last3d, 0) AS sales_last3d,
  COALESCE(m3.cost_last3d, 0) AS cost_last3d,
  -- 計算指標
  SAFE_DIVIDE(m3.clicks_last3d, m3.impressions_last3d) AS ctr_last3d,
  SAFE_DIVIDE(m3.orders_last3d, m3.clicks_last3d) AS cvr_last3d,
  SAFE_DIVIDE(m3.cost_last3d, m3.sales_last3d) AS acos_last3d,

  -- ========================================
  -- 30日集計（長期トレンド確認用）
  -- ========================================
  COALESCE(m30.impressions_30d, 0) AS impressions_30d,
  COALESCE(m30.clicks_30d, 0) AS clicks_30d,
  COALESCE(m30.orders_30d, 0) AS orders_30d,
  COALESCE(m30.sales_30d, 0) AS sales_30d,
  COALESCE(m30.cost_30d, 0) AS cost_30d,
  -- 計算指標
  SAFE_DIVIDE(m30.clicks_30d, m30.impressions_30d) AS ctr_30d,
  SAFE_DIVIDE(m30.orders_30d, m30.clicks_30d) AS cvr_30d,
  SAFE_DIVIDE(m30.cost_30d, m30.sales_30d) AS acos_30d,

  -- メタ情報
  CURRENT_TIMESTAMP() AS calculated_at

FROM metrics_7d m7
LEFT JOIN metrics_7d_excl_recent m7excl
  ON m7.asin = m7excl.asin
  AND m7.keyword = m7excl.keyword
  AND m7.match_type = m7excl.match_type
  AND m7.campaign_id = m7excl.campaign_id
  AND m7.ad_group_id = m7excl.ad_group_id
LEFT JOIN metrics_last3d m3
  ON m7.asin = m3.asin
  AND m7.keyword = m3.keyword
  AND m7.match_type = m3.match_type
  AND m7.campaign_id = m3.campaign_id
  AND m7.ad_group_id = m3.ad_group_id
LEFT JOIN metrics_30d m30
  ON m7.asin = m30.asin
  AND m7.keyword = m30.keyword
  AND m7.match_type = m30.match_type
  AND m7.campaign_id = m30.campaign_id
  AND m7.ad_group_id = m30.ad_group_id
LEFT JOIN latest_bids lb
  ON m7.asin = lb.asin
  AND m7.keyword = lb.keyword
  AND m7.match_type = lb.match_type
  AND m7.campaign_id = lb.campaign_id
  AND m7.ad_group_id = lb.ad_group_id;

-- コメント: このビューの使い方
-- ================================================================================
--
-- 【アップ判定】（従来通り7日フルを使用）
--   clicks_7d, orders_7d, acos_7d などを使用
--
-- 【ダウン判定】（直近3日を除外 + 30日も参照）
--   1. clicks_7d_excl_recent >= 閾値
--   2. orders_7d_excl_recent == 0 または acos_7d_excl_recent > target * 1.2
--   3. orders_30d が非常に少ない or acos_30d > target * 1.05
--   これらすべてを満たす場合のみ強いダウンを許可
--
-- 【直近3日の安全弁】
--   orders_last3d >= 1 かつ cvr_last3d > cvr_7d_excl_recent * 1.2 の場合、
--   直近は好調なのでダウン幅を抑える（-30% → -15% など）
--
-- ================================================================================

-- campaign_placement_metrics_30d ビュー
-- キャンペーン×掲載位置ごとのパフォーマンスメトリクス（過去30日）
--
-- Placement（掲載位置）最適化エンジンの入力データ
-- Top of Search Impression Share を含む

CREATE OR REPLACE VIEW `{project_id}.{dataset}.campaign_placement_metrics_30d` AS

WITH
-- 掲載位置別パフォーマンス（過去30日）
placement_performance AS (
  SELECT
    sp.campaign_id,
    sp.placement,
    SUM(sp.impressions) AS impressions,
    SUM(sp.clicks) AS clicks,
    SUM(sp.cost) AS spend,
    SUM(sp.attributed_conversions_14d) AS orders,
    SUM(sp.attributed_sales_14d) AS sales
  FROM `{project_id}.{dataset}.sp_placement_report` sp
  WHERE sp.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY sp.campaign_id, sp.placement
),

-- キャンペーン情報（現在の設定値）
campaign_info AS (
  SELECT
    c.campaign_id,
    c.campaign_name,
    c.daily_budget,
    c.state AS campaign_state,
    -- 掲載位置別の入札調整比率
    -- Amazon Ads API の bidding.adjustments から取得
    COALESCE(
      (SELECT ba.percentage
       FROM UNNEST(c.bidding_adjustments) ba
       WHERE ba.predicate = 'placementTop'),
      0
    ) AS top_of_search_modifier,
    COALESCE(
      (SELECT ba.percentage
       FROM UNNEST(c.bidding_adjustments) ba
       WHERE ba.predicate = 'placementProductPage'),
      0
    ) AS product_page_modifier
  FROM `{project_id}.{dataset}.sp_campaigns` c
  WHERE c.state = 'ENABLED'
),

-- キャンペーンレポートからインプレッションシェアを取得
campaign_report AS (
  SELECT
    cr.campaign_id,
    -- Top of Search インプレッションシェア（最新の値を使用）
    AVG(cr.top_of_search_impression_share) AS top_of_search_impression_share
  FROM `{project_id}.{dataset}.sp_campaign_report` cr
  WHERE cr.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  GROUP BY cr.campaign_id
),

-- 本日の消化予算
today_spend AS (
  SELECT
    sp.campaign_id,
    SUM(sp.cost) AS today_spend
  FROM `{project_id}.{dataset}.sp_placement_report` sp
  WHERE sp.date = CURRENT_DATE()
  GROUP BY sp.campaign_id
),

-- 商品設定から目標ACOSを取得（キャンペーンに紐づくASINの平均）
campaign_target_acos AS (
  SELECT
    ag.campaign_id,
    AVG(pc.target_acos) AS target_acos
  FROM `{project_id}.{dataset}.sp_ad_groups` ag
  INNER JOIN `{project_id}.{dataset}.sp_product_ads` pa
    ON ag.ad_group_id = pa.ad_group_id
  INNER JOIN `{project_id}.{dataset}.product_config` pc
    ON pa.asin = pc.asin
  WHERE pc.is_active = TRUE
    AND pc.target_acos IS NOT NULL
  GROUP BY ag.campaign_id
)

-- メイン結果
SELECT
  ci.campaign_id,
  ci.campaign_name,
  pp.placement,

  -- 現在の入札調整比率（掲載位置別）
  CASE pp.placement
    WHEN 'Top of Search (first page)' THEN ci.top_of_search_modifier
    WHEN 'Product pages' THEN ci.product_page_modifier
    ELSE 0
  END AS current_bid_modifier,

  -- インプレッションシェア（Top of Search のみ）
  CASE pp.placement
    WHEN 'Top of Search (first page)' THEN cr.top_of_search_impression_share
    ELSE NULL
  END AS top_of_search_impression_share,

  -- パフォーマンス指標
  pp.impressions,
  pp.clicks,
  pp.spend,
  pp.orders,
  pp.sales,

  -- 計算指標
  SAFE_DIVIDE(pp.orders, pp.clicks) AS cvr,
  SAFE_DIVIDE(pp.spend, pp.sales) AS acos,
  SAFE_DIVIDE(pp.clicks, pp.impressions) AS ctr,
  SAFE_DIVIDE(pp.spend, pp.clicks) AS cpc,

  -- 目標値
  COALESCE(cta.target_acos, 0.25) AS target_acos,

  -- 予算情報
  ci.daily_budget,
  ts.today_spend

FROM placement_performance pp
INNER JOIN campaign_info ci
  ON pp.campaign_id = ci.campaign_id
LEFT JOIN campaign_report cr
  ON pp.campaign_id = cr.campaign_id
LEFT JOIN today_spend ts
  ON pp.campaign_id = ts.campaign_id
LEFT JOIN campaign_target_acos cta
  ON pp.campaign_id = cta.campaign_id

WHERE pp.impressions > 0

ORDER BY ci.campaign_id, pp.placement;

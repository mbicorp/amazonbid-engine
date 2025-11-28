-- =============================================================================
-- 月次利益ビュー（商品別）
-- 日次売上・広告データを月次集計し、利益とTACOSを計算
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.monthly_profit_by_product` AS
WITH monthly_sales AS (
  SELECT
    product_id,
    FORMAT_DATE('%Y-%m', date) AS year_month,
    SUM(revenue_jpy) AS revenue_total_jpy,
    SUM(COALESCE(cogs_jpy, 0)) AS cogs_total_jpy,
    SUM(COALESCE(gross_profit_jpy, revenue_jpy * 0.4)) AS gross_profit_total_jpy,  -- 粗利率40%をデフォルト
    SUM(units_sold) AS units_sold_total
  FROM `${PROJECT_ID}.${DATASET}.daily_sales_by_product`
  GROUP BY product_id, FORMAT_DATE('%Y-%m', date)
),
monthly_ads AS (
  SELECT
    product_id,
    FORMAT_DATE('%Y-%m', date) AS year_month,
    SUM(ad_spend_jpy) AS ad_spend_total_jpy,
    SUM(ad_sales_jpy) AS ad_sales_total_jpy,
    SUM(ad_impressions) AS ad_impressions_total,
    SUM(ad_clicks) AS ad_clicks_total,
    SUM(ad_orders) AS ad_orders_total
  FROM `${PROJECT_ID}.${DATASET}.daily_ads_by_product`
  GROUP BY product_id, FORMAT_DATE('%Y-%m', date)
),
-- 投資開始日を取得
invest_start AS (
  SELECT
    product_id,
    invest_start_date
  FROM `${PROJECT_ID}.${DATASET}.product_strategy_current`
),
-- 累積利益計算用
cumulative_profit AS (
  SELECT
    s.product_id,
    s.year_month,
    COALESCE(s.gross_profit_total_jpy, 0) - COALESCE(a.ad_spend_total_jpy, 0) AS net_profit_monthly,
    i.invest_start_date,
    PARSE_DATE('%Y-%m', s.year_month) AS month_date
  FROM monthly_sales s
  LEFT JOIN monthly_ads a ON s.product_id = a.product_id AND s.year_month = a.year_month
  LEFT JOIN invest_start i ON s.product_id = i.product_id
)
SELECT
  s.product_id,
  s.year_month,

  -- 売上指標
  COALESCE(s.revenue_total_jpy, 0) AS revenue_total_jpy,
  COALESCE(s.cogs_total_jpy, 0) AS cogs_total_jpy,
  COALESCE(s.gross_profit_total_jpy, 0) AS gross_profit_before_ads_jpy,
  COALESCE(s.units_sold_total, 0) AS units_sold_total,

  -- 広告指標
  COALESCE(a.ad_spend_total_jpy, 0) AS ad_spend_total_jpy,
  COALESCE(a.ad_sales_total_jpy, 0) AS ad_sales_total_jpy,
  COALESCE(a.ad_impressions_total, 0) AS ad_impressions_total,
  COALESCE(a.ad_clicks_total, 0) AS ad_clicks_total,
  COALESCE(a.ad_orders_total, 0) AS ad_orders_total,

  -- TACOS（総売上に対する広告費率）
  CASE
    WHEN COALESCE(s.revenue_total_jpy, 0) > 0
    THEN COALESCE(a.ad_spend_total_jpy, 0) / s.revenue_total_jpy
    ELSE NULL
  END AS tacos_monthly,

  -- ACOS（広告売上に対する広告費率）
  CASE
    WHEN COALESCE(a.ad_sales_total_jpy, 0) > 0
    THEN a.ad_spend_total_jpy / a.ad_sales_total_jpy
    ELSE NULL
  END AS acos_monthly,

  -- 広告ROAS
  CASE
    WHEN COALESCE(a.ad_spend_total_jpy, 0) > 0
    THEN a.ad_sales_total_jpy / a.ad_spend_total_jpy
    ELSE NULL
  END AS roas_monthly,

  -- 月次純利益（広告費控除後）
  COALESCE(s.gross_profit_total_jpy, 0) - COALESCE(a.ad_spend_total_jpy, 0) AS net_profit_monthly,

  -- 累積純利益（投資開始以降）
  (
    SELECT SUM(cp2.net_profit_monthly)
    FROM cumulative_profit cp2
    WHERE cp2.product_id = s.product_id
      AND cp2.invest_start_date IS NOT NULL
      AND cp2.month_date >= DATE_TRUNC(cp2.invest_start_date, MONTH)
      AND cp2.month_date <= PARSE_DATE('%Y-%m', s.year_month)
  ) AS net_profit_cumulative,

  -- 投資開始からの経過月数
  DATE_DIFF(
    PARSE_DATE('%Y-%m', s.year_month),
    DATE_TRUNC(i.invest_start_date, MONTH),
    MONTH
  ) + 1 AS months_since_launch

FROM monthly_sales s
LEFT JOIN monthly_ads a ON s.product_id = a.product_id AND s.year_month = a.year_month
LEFT JOIN invest_start i ON s.product_id = i.product_id;

-- マテリアライズドビュー（パフォーマンス最適化用・オプション）
-- CREATE MATERIALIZED VIEW `${PROJECT_ID}.${DATASET}.monthly_profit_by_product_mv`
-- OPTIONS(enable_refresh = true, refresh_interval_minutes = 60)
-- AS SELECT * FROM `${PROJECT_ID}.${DATASET}.monthly_profit_by_product`;

-- campaign_budget_metrics ビュー
-- キャンペーンごとの予算関連メトリクス
--
-- Budget（日予算）最適化エンジンの入力データ
-- Lost Impression Share (Budget) を含む

CREATE OR REPLACE VIEW `{project_id}.{dataset}.campaign_budget_metrics` AS

WITH
-- 当日の消化額
today_spend AS (
  SELECT
    cr.campaign_id,
    SUM(cr.cost) AS today_spend
  FROM `{project_id}.{dataset}.sp_campaign_report` cr
  WHERE cr.date = CURRENT_DATE()
  GROUP BY cr.campaign_id
),

-- 過去7日のパフォーマンス
performance_7d AS (
  SELECT
    cr.campaign_id,
    SUM(cr.cost) AS spend_7d,
    SUM(cr.attributed_sales_14d) AS sales_7d,
    SUM(cr.attributed_conversions_14d) AS orders_7d,
    SUM(cr.clicks) AS clicks_7d
  FROM `{project_id}.{dataset}.sp_campaign_report` cr
  WHERE cr.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  GROUP BY cr.campaign_id
),

-- 過去30日のパフォーマンス
performance_30d AS (
  SELECT
    cr.campaign_id,
    SUM(cr.cost) AS spend_30d,
    SUM(cr.attributed_sales_14d) AS sales_30d,
    SUM(cr.attributed_conversions_14d) AS orders_30d,
    SUM(cr.clicks) AS clicks_30d
  FROM `{project_id}.{dataset}.sp_campaign_report` cr
  WHERE cr.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  GROUP BY cr.campaign_id
),

-- キャンペーン情報（現在の設定値）
campaign_info AS (
  SELECT
    c.campaign_id,
    c.campaign_name,
    c.daily_budget,
    c.state AS campaign_state
  FROM `{project_id}.{dataset}.sp_campaigns` c
  WHERE c.state = 'ENABLED'
),

-- キャンペーンレポートから Lost IS Budget を取得（最新7日の平均）
lost_is_budget AS (
  SELECT
    cr.campaign_id,
    AVG(cr.lost_impression_share_budget) AS lost_impression_share_budget
  FROM `{project_id}.{dataset}.sp_campaign_report` cr
  WHERE cr.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
    AND cr.lost_impression_share_budget IS NOT NULL
  GROUP BY cr.campaign_id
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
),

-- 低予算消化率の連続日数を計算
-- 過去30日間で budget_usage < 50% が何日連続しているか
daily_usage AS (
  SELECT
    cr.campaign_id,
    cr.date,
    cr.cost,
    c.daily_budget,
    SAFE_DIVIDE(cr.cost, c.daily_budget) * 100 AS usage_percent
  FROM `{project_id}.{dataset}.sp_campaign_report` cr
  INNER JOIN `{project_id}.{dataset}.sp_campaigns` c
    ON cr.campaign_id = c.campaign_id
  WHERE cr.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND c.daily_budget > 0
),

low_usage_streak AS (
  SELECT
    campaign_id,
    -- 直近から遡って50%未満が続いた日数をカウント
    COUNTIF(usage_percent < 50) AS low_usage_total_days,
    -- 連続日数は複雑なので、簡易的に直近7日間の低消化日数で代用
    (
      SELECT COUNT(*)
      FROM daily_usage du2
      WHERE du2.campaign_id = daily_usage.campaign_id
        AND du2.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
        AND du2.usage_percent < 50
    ) AS low_usage_days_7d
  FROM daily_usage
  GROUP BY campaign_id
)

-- メイン結果
SELECT
  ci.campaign_id,
  ci.campaign_name,

  -- 予算情報
  ci.daily_budget,
  COALESCE(ts.today_spend, 0) AS today_spend,
  SAFE_DIVIDE(COALESCE(ts.today_spend, 0), ci.daily_budget) * 100 AS budget_usage_percent,

  -- Lost Impression Share Budget（重要）
  lib.lost_impression_share_budget,

  -- 7日パフォーマンス
  COALESCE(p7.spend_7d, 0) AS spend_7d,
  COALESCE(p7.sales_7d, 0) AS sales_7d,
  COALESCE(p7.orders_7d, 0) AS orders_7d,
  SAFE_DIVIDE(p7.spend_7d, p7.sales_7d) AS acos_7d,
  SAFE_DIVIDE(p7.orders_7d, p7.clicks_7d) AS cvr_7d,

  -- 30日パフォーマンス
  COALESCE(p30.spend_30d, 0) AS spend_30d,
  COALESCE(p30.sales_30d, 0) AS sales_30d,
  COALESCE(p30.orders_30d, 0) AS orders_30d,
  SAFE_DIVIDE(p30.spend_30d, p30.sales_30d) AS acos_30d,
  SAFE_DIVIDE(p30.orders_30d, p30.clicks_30d) AS cvr_30d,

  -- 目標ACOS
  COALESCE(cta.target_acos, 0.25) AS target_acos,

  -- 低消化継続日数（直近7日間で50%未満だった日数）
  COALESCE(lus.low_usage_days_7d, 0) AS low_usage_days

FROM campaign_info ci
LEFT JOIN today_spend ts
  ON ci.campaign_id = ts.campaign_id
LEFT JOIN performance_7d p7
  ON ci.campaign_id = p7.campaign_id
LEFT JOIN performance_30d p30
  ON ci.campaign_id = p30.campaign_id
LEFT JOIN lost_is_budget lib
  ON ci.campaign_id = lib.campaign_id
LEFT JOIN campaign_target_acos cta
  ON ci.campaign_id = cta.campaign_id
LEFT JOIN low_usage_streak lus
  ON ci.campaign_id = lus.campaign_id

WHERE ci.daily_budget > 0

ORDER BY ci.campaign_id;

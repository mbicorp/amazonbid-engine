-- =============================================================================
-- ASIN ローンチ投資サマリービュー
--
-- ローンチ期間全体（LAUNCH_HARD/LAUNCH_SOFT に滞在している期間）を対象に、
-- LaunchInvest_total_design と LaunchInvest_usage_ratio を計算する。
--
-- 主な指標:
--   - adCost_opt_launch: T_opt運用だった場合の広告費
--   - extraAdCost_launch_real: 実際の追加広告投資額
--   - LaunchInvest_total_design: 設計上のローンチ追加投資枠
--   - LaunchInvest_usage_ratio: ローンチ追加投資枠の使用率
--
-- 依存テーブル:
--   - daily_sales_by_product: 日次売上データ
--   - daily_ads_by_product: 日次広告費データ
--   - product_config: 商品設定（launch_date, lifecycleStage等）
--   - product_ltv_metrics: LTVメトリクス
--   - lifecycle_history: ライフサイクル履歴（オプション）
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.asin_launch_invest_summary` AS

WITH
-- ライフサイクル履歴がある場合はそれを使用、なければproduct_configから推定
launch_periods AS (
  SELECT
    pc.asin,
    -- ローンチ開始日: launch_dateまたは最初の売上日
    COALESCE(
      pc.launch_date,
      (SELECT MIN(date) FROM `${PROJECT_ID}.${DATASET}.daily_sales_by_product` WHERE product_id = pc.asin)
    ) AS launch_start_date,
    -- ローンチ終了日: 現在もLAUNCH中ならNULL、それ以外はライフサイクル変更日
    -- TODO: lifecycle_historyテーブルができたらそこから取得
    CASE
      WHEN pc.lifecycle_stage IN ('LAUNCH_HARD', 'LAUNCH_SOFT') THEN CURRENT_DATE()
      ELSE COALESCE(pc.lifecycle_changed_at, CURRENT_DATE())
    END AS launch_end_date,
    pc.lifecycle_stage AS current_lifecycle_stage
  FROM `${PROJECT_ID}.${DATASET}.product_config` pc
  WHERE pc.is_enabled = TRUE
    -- LAUNCHを経験したASINのみ（現在LAUNCHまたは過去にLAUNCHだった）
    AND (
      pc.lifecycle_stage IN ('LAUNCH_HARD', 'LAUNCH_SOFT')
      OR pc.launch_date IS NOT NULL
    )
),

-- 商品パラメータ
product_params AS (
  SELECT
    pc.asin,
    COALESCE(pc.margin_potential, ltv.margin_rate, 0.4) AS g,
    COALESCE(pc.t_opt, ltv.margin_rate * 0.3, 0.12) AS t_opt,
    -- T_launch: ローンチ期のターゲットTACOS（通常はT_optより高い）
    COALESCE(pc.t_launch, pc.t_opt * 1.5, 0.18) AS t_launch
  FROM `${PROJECT_ID}.${DATASET}.product_config` pc
  LEFT JOIN `${PROJECT_ID}.${DATASET}.product_ltv_metrics` ltv
    ON pc.asin = ltv.asin
),

-- ローンチ期間中の売上集計
launch_sales AS (
  SELECT
    lp.asin,
    SUM(ds.revenue_jpy) AS sales_launch
  FROM launch_periods lp
  INNER JOIN `${PROJECT_ID}.${DATASET}.daily_sales_by_product` ds
    ON lp.asin = ds.product_id
    AND ds.date >= lp.launch_start_date
    AND ds.date <= lp.launch_end_date
  GROUP BY lp.asin
),

-- ローンチ期間中の広告費集計
launch_ads AS (
  SELECT
    lp.asin,
    SUM(da.cost_jpy) AS ad_cost_launch,
    SUM(da.impressions) AS impressions_launch,
    SUM(da.clicks) AS clicks_launch,
    SUM(da.orders) AS orders_launch,
    SUM(da.revenue_jpy) AS ad_revenue_launch
  FROM launch_periods lp
  INNER JOIN `${PROJECT_ID}.${DATASET}.daily_ads_by_product` da
    ON lp.asin = da.product_id
    AND da.date >= lp.launch_start_date
    AND da.date <= lp.launch_end_date
  GROUP BY lp.asin
),

-- ローンチ日数計算
launch_duration AS (
  SELECT
    asin,
    launch_start_date,
    launch_end_date,
    current_lifecycle_stage,
    DATE_DIFF(launch_end_date, launch_start_date, DAY) + 1 AS days_in_launch
  FROM launch_periods
)

SELECT
  lp.asin,
  ld.launch_start_date,
  ld.launch_end_date,
  ld.current_lifecycle_stage,
  ld.days_in_launch,

  -- 商品パラメータ
  pp.g,
  pp.t_opt,
  pp.t_launch,

  -- 売上・広告費
  COALESCE(ls.sales_launch, 0) AS sales_launch,
  COALESCE(la.ad_cost_launch, 0) AS ad_cost_launch,
  COALESCE(la.impressions_launch, 0) AS impressions_launch,
  COALESCE(la.clicks_launch, 0) AS clicks_launch,
  COALESCE(la.orders_launch, 0) AS orders_launch,

  -- T_opt運用だった場合の広告費: adCost_opt_launch = sales_launch × T_opt
  COALESCE(ls.sales_launch, 0) * pp.t_opt AS ad_cost_opt_launch,

  -- 実際の追加広告投資額: extraAdCost_launch_real = GREATEST(adCost_launch - adCost_opt_launch, 0)
  GREATEST(
    COALESCE(la.ad_cost_launch, 0) - (COALESCE(ls.sales_launch, 0) * pp.t_opt),
    0
  ) AS extra_ad_cost_launch_real,

  -- 設計上のローンチ追加投資枠: LaunchInvest_total_design = sales_launch × (T_launch - T_opt)
  COALESCE(ls.sales_launch, 0) * (pp.t_launch - pp.t_opt) AS launch_invest_total_design,

  -- ローンチ追加投資枠の使用率: LaunchInvest_usage_ratio
  CASE
    WHEN COALESCE(ls.sales_launch, 0) * (pp.t_launch - pp.t_opt) <= 0 THEN 0
    ELSE GREATEST(
      COALESCE(la.ad_cost_launch, 0) - (COALESCE(ls.sales_launch, 0) * pp.t_opt),
      0
    ) / (COALESCE(ls.sales_launch, 0) * (pp.t_launch - pp.t_opt))
  END AS launch_invest_usage_ratio,

  -- TACOS（ローンチ期間）
  CASE
    WHEN COALESCE(ls.sales_launch, 0) > 0
    THEN COALESCE(la.ad_cost_launch, 0) / ls.sales_launch
    ELSE NULL
  END AS tacos_launch,

  -- ローンチ期間の実績ネット利益
  (COALESCE(ls.sales_launch, 0) * pp.g - COALESCE(la.ad_cost_launch, 0)) AS net_profit_launch,

  -- ローンチ期間のターゲットネット利益
  (COALESCE(ls.sales_launch, 0) * (pp.g - pp.t_opt)) AS net_profit_target_launch,

  -- ローンチ期間の利益ギャップ
  GREATEST(
    (COALESCE(ls.sales_launch, 0) * (pp.g - pp.t_opt)) -
    (COALESCE(ls.sales_launch, 0) * pp.g - COALESCE(la.ad_cost_launch, 0)),
    0
  ) AS loss_gap_launch,

  -- ローンチ期間のlossBudget（LAUNCH_HARD想定: 2.5倍）
  GREATEST(
    COALESCE(ls.sales_launch, 0) * (pp.g - pp.t_opt) * 2.5,
    COALESCE(ls.sales_launch, 0) * 0.01,
    1
  ) AS loss_budget_allowed_launch,

  -- ローンチ期間の許容損失消費率
  CASE
    WHEN GREATEST(
      COALESCE(ls.sales_launch, 0) * (pp.g - pp.t_opt) * 2.5,
      COALESCE(ls.sales_launch, 0) * 0.01,
      1
    ) <= 0 THEN 0
    ELSE GREATEST(
      (COALESCE(ls.sales_launch, 0) * (pp.g - pp.t_opt)) -
      (COALESCE(ls.sales_launch, 0) * pp.g - COALESCE(la.ad_cost_launch, 0)),
      0
    ) / GREATEST(
      COALESCE(ls.sales_launch, 0) * (pp.g - pp.t_opt) * 2.5,
      COALESCE(ls.sales_launch, 0) * 0.01,
      1
    )
  END AS loss_budget_consumption_launch,

  CURRENT_TIMESTAMP() AS calculated_at

FROM launch_periods lp
INNER JOIN launch_duration ld ON lp.asin = ld.asin
INNER JOIN product_params pp ON lp.asin = pp.asin
LEFT JOIN launch_sales ls ON lp.asin = ls.asin
LEFT JOIN launch_ads la ON lp.asin = la.asin
;

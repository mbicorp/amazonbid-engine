-- =============================================================================
-- ASIN 30日ローリング集計サマリービュー
--
-- ASINごとに直近30日間の売上・広告費・利益指標を集計し、
-- lossBudgetConsumption_w（許容損失消費率）を計算する。
--
-- 依存テーブル:
--   - daily_sales_by_product: 日次売上データ
--   - daily_ads_by_product: 日次広告費データ
--   - product_config: 商品設定（lifecycleStage, marginPotential等）
--   - product_ltv_metrics: LTVメトリクス（T_opt計算用）
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.asin_rolling_30d_summary` AS

WITH date_range AS (
  SELECT
    DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) AS period_start,
    DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) AS period_end
),

-- 日次売上集計
sales_30d AS (
  SELECT
    ds.product_id AS asin,
    SUM(ds.revenue_jpy) AS sales_w,
    SUM(ds.gross_profit_jpy) AS gross_profit_w
  FROM `${PROJECT_ID}.${DATASET}.daily_sales_by_product` ds
  CROSS JOIN date_range dr
  WHERE ds.date BETWEEN dr.period_start AND dr.period_end
  GROUP BY ds.product_id
),

-- 日次広告費集計
ads_30d AS (
  SELECT
    da.product_id AS asin,
    SUM(da.cost_jpy) AS ad_cost_w,
    SUM(da.impressions) AS impressions_w,
    SUM(da.clicks) AS clicks_w,
    SUM(da.orders) AS orders_w,
    SUM(da.revenue_jpy) AS ad_revenue_w
  FROM `${PROJECT_ID}.${DATASET}.daily_ads_by_product` da
  CROSS JOIN date_range dr
  WHERE da.date BETWEEN dr.period_start AND dr.period_end
  GROUP BY da.product_id
),

-- 商品設定とLTVメトリクスを結合
product_params AS (
  SELECT
    pc.asin,
    pc.lifecycle_stage,
    COALESCE(pc.margin_potential, ltv.margin_rate, 0.4) AS g,  -- marginPotential
    -- T_optの簡易計算: g × 0.3（実際にはより複雑な計算が必要）
    -- 本番ではltv_calculatorからの値を使用
    COALESCE(pc.t_opt, ltv.margin_rate * 0.3, 0.12) AS t_opt,
    -- lossBudgetMultiple: ライフサイクル別の倍率
    CASE pc.lifecycle_stage
      WHEN 'LAUNCH_HARD' THEN 2.5
      WHEN 'LAUNCH_SOFT' THEN 2.0
      WHEN 'GROW' THEN 1.5
      WHEN 'HARVEST' THEN 0.8
      ELSE 1.5
    END AS loss_budget_multiple_stage
  FROM `${PROJECT_ID}.${DATASET}.product_config` pc
  LEFT JOIN `${PROJECT_ID}.${DATASET}.product_ltv_metrics` ltv
    ON pc.asin = ltv.asin
  WHERE pc.is_enabled = TRUE
),

-- メイン集計
main_summary AS (
  SELECT
    pp.asin,
    dr.period_start,
    dr.period_end,
    pp.lifecycle_stage AS lifecycle_stage_w,
    pp.g,
    pp.t_opt,
    pp.loss_budget_multiple_stage,

    -- 売上・広告費
    COALESCE(s.sales_w, 0) AS sales_w,
    COALESCE(a.ad_cost_w, 0) AS ad_cost_w,
    COALESCE(a.impressions_w, 0) AS impressions_w,
    COALESCE(a.clicks_w, 0) AS clicks_w,
    COALESCE(a.orders_w, 0) AS orders_w,

    -- ターゲットネットマージン: n_mid = g - T_opt
    (pp.g - pp.t_opt) AS target_net_margin_mid,

    -- 実績ネット利益: netProfit_real_w = sales_w × g - adCost_w
    (COALESCE(s.sales_w, 0) * pp.g - COALESCE(a.ad_cost_w, 0)) AS net_profit_real_w,

    -- 理論ターゲット利益: netProfit_target_w = sales_w × (g - T_opt)
    (COALESCE(s.sales_w, 0) * (pp.g - pp.t_opt)) AS net_profit_target_w

  FROM product_params pp
  CROSS JOIN date_range dr
  LEFT JOIN sales_30d s ON pp.asin = s.asin
  LEFT JOIN ads_30d a ON pp.asin = a.asin
)

SELECT
  ms.asin,
  ms.period_start,
  ms.period_end,
  ms.lifecycle_stage_w,
  ms.g,
  ms.t_opt,
  ms.loss_budget_multiple_stage,
  ms.sales_w,
  ms.ad_cost_w,
  ms.impressions_w,
  ms.clicks_w,
  ms.orders_w,
  ms.target_net_margin_mid,
  ms.net_profit_real_w,
  ms.net_profit_target_w,

  -- 利益ギャップ: lossGap_w = GREATEST(target - real, 0)
  GREATEST(ms.net_profit_target_w - ms.net_profit_real_w, 0) AS loss_gap_w,

  -- 許容損失額: lossBudgetAllowed_w = netProfit_target_w × lossBudgetMultiple_stage
  -- 最小値として売上の1%または1円を設定
  GREATEST(
    ms.net_profit_target_w * ms.loss_budget_multiple_stage,
    ms.sales_w * 0.01,
    1
  ) AS loss_budget_allowed_w,

  -- 許容損失消費率: lossBudgetConsumption_w = lossGap_w / lossBudgetAllowed_w
  CASE
    WHEN GREATEST(
      ms.net_profit_target_w * ms.loss_budget_multiple_stage,
      ms.sales_w * 0.01,
      1
    ) <= 0 THEN 0
    ELSE GREATEST(ms.net_profit_target_w - ms.net_profit_real_w, 0) /
      GREATEST(
        ms.net_profit_target_w * ms.loss_budget_multiple_stage,
        ms.sales_w * 0.01,
        1
      )
  END AS loss_budget_consumption_w,

  -- TACOS計算: adCost_w / sales_w
  CASE
    WHEN ms.sales_w > 0 THEN ms.ad_cost_w / ms.sales_w
    ELSE NULL
  END AS tacos_w,

  -- ACOS計算（広告起因売上ベース）
  CASE
    WHEN COALESCE((SELECT ad_revenue_w FROM ads_30d WHERE asin = ms.asin), 0) > 0
    THEN ms.ad_cost_w / (SELECT ad_revenue_w FROM ads_30d WHERE asin = ms.asin)
    ELSE NULL
  END AS acos_w,

  CURRENT_TIMESTAMP() AS calculated_at

FROM main_summary ms
;

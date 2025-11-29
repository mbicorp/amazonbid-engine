-- =============================================================================
-- loss_budget_30d ビュー
--
-- 30日間ローリングウィンドウでの予算・損失モニタリングビュー
-- asin_rolling_30d_summary をベースに、AdminJS での表示用に
-- 標準化されたカラム名でデータを提供する。
--
-- 依存ビュー:
--   - asin_rolling_30d_summary: 30日ローリング集計
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.loss_budget_30d` AS

SELECT
  asin,
  period_start,
  period_end,
  lifecycle_stage_w AS lifecycle_stage,

  -- 売上・広告費
  ROUND(sales_w, 0) AS sales_30d,
  ROUND(ad_cost_w, 0) AS ad_cost_30d,

  -- 利益指標
  ROUND(net_profit_real_w, 0) AS net_profit_real_30d,
  ROUND(net_profit_target_w, 0) AS net_profit_target_30d,
  ROUND(loss_gap_w, 0) AS loss_gap_30d,

  -- 許容損失と消費率
  ROUND(loss_budget_allowed_w, 0) AS loss_budget_allowed_30d,
  ROUND(loss_budget_consumption_w, 4) AS loss_budget_consumption_30d,

  -- 投資状態（4段階評価）
  CASE
    WHEN loss_budget_consumption_w >= 1.0 THEN 'BREACH'   -- 100%以上: 超過
    WHEN loss_budget_consumption_w >= 0.8 THEN 'LIMIT'   -- 80-100%: 上限接近
    WHEN loss_budget_consumption_w >= 0.5 THEN 'WATCH'   -- 50-80%: 注意
    ELSE 'SAFE'                                          -- 50%未満: 安全
  END AS investment_state,

  -- TACOS/ACOS
  ROUND(tacos_w, 4) AS tacos_30d,
  ROUND(acos_w, 4) AS acos_30d,

  -- メタデータ
  calculated_at

FROM `${PROJECT_ID}.${DATASET}.asin_rolling_30d_summary`
;

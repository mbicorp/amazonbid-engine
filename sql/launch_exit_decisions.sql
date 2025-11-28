-- =============================================================================
-- launch_exit_decisions テーブル
--
-- LAUNCH終了判定とライフサイクル遷移提案のログテーブル
-- SHADOWモード専用（現時点）
--
-- 用途:
-- - LAUNCH_HARD / LAUNCH_SOFT の ASIN について、通常終了/緊急終了の判定結果を保存
-- - SEOコアキーワードの完了率、日数/データ条件、lossBudget情報を記録
-- - 将来的な分析やダッシュボード表示に使用
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.launch_exit_decisions` (
  -- 実行情報
  runtime_date DATE NOT NULL,
  execution_id STRING NOT NULL,
  mode STRING NOT NULL,                            -- "SHADOW" 固定（現時点）

  -- ASIN情報
  asin STRING NOT NULL,
  current_lifecycle_stage STRING NOT NULL,         -- LAUNCH_HARD / LAUNCH_SOFT
  suggested_lifecycle_stage STRING,                -- GROW など（提案が無い場合は NULL）

  -- 終了判定結果
  should_exit_launch BOOL NOT NULL,                -- LAUNCH終了判定
  is_emergency_exit BOOL,                          -- 緊急終了かどうか
  reason_codes ARRAY<STRING>,                      -- 終了理由コード配列
  reason_message STRING,                           -- 終了理由の詳細メッセージ

  -- SEO進捗情報
  seo_completion_ratio FLOAT64,                    -- (achieved + gaveUp) / totalCoreKeywords
  seo_success_ratio FLOAT64,                       -- achieved / totalCoreKeywords
  total_core_keywords INT64,                       -- コアSEOキーワード総数
  achieved_count INT64,                            -- ACHIEVED数
  gave_up_count INT64,                             -- GAVE_UP数
  active_count INT64,                              -- ACTIVE数

  -- 時間/データ条件
  days_since_launch INT64,                         -- ローンチ開始からの日数
  asin_clicks_total INT64,                         -- ASIN累計クリック
  asin_orders_total INT64,                         -- ASIN累計注文
  avg_daily_sales_30d FLOAT64,                     -- 直近30日の平均日販数

  -- lossBudget情報
  loss_budget_ratio FLOAT64,                       -- profitGap / lossBudgetStage
  loss_investment_state STRING,                    -- SAFE / WATCH / LIMIT / BREACH

  -- スケーリング情報
  volume_scale FLOAT64,                            -- ASIN固有のvolumeScale

  -- 使用した閾値（デバッグ・監査用）
  threshold_min_completion_ratio FLOAT64,          -- SEO完了率の下限閾値
  threshold_min_launch_days INT64,                 -- 最低継続日数
  threshold_min_clicks INT64,                      -- クリック閾値（スケーリング済み）
  threshold_min_orders INT64,                      -- 注文閾値（スケーリング済み）
  threshold_emergency_loss_ratio FLOAT64,          -- 緊急終了とみなすlossBudget比率

  -- メタ情報
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY runtime_date
CLUSTER BY asin, current_lifecycle_stage;


-- =============================================================================
-- 使用例
-- =============================================================================
--
-- 1. 特定日の全LAUNCH終了判定を取得:
--    SELECT * FROM `project.dataset.launch_exit_decisions`
--    WHERE runtime_date = '2025-01-15'
--    ORDER BY asin;
--
-- 2. 緊急終了したASINを取得:
--    SELECT * FROM `project.dataset.launch_exit_decisions`
--    WHERE is_emergency_exit = TRUE
--    ORDER BY created_at DESC;
--
-- 3. 通常終了を推奨されたASINを取得:
--    SELECT * FROM `project.dataset.launch_exit_decisions`
--    WHERE should_exit_launch = TRUE AND is_emergency_exit = FALSE
--    ORDER BY created_at DESC;
--
-- 4. SEO完了率が高いがまだLAUNCH継続のASINを確認:
--    SELECT * FROM `project.dataset.launch_exit_decisions`
--    WHERE should_exit_launch = FALSE
--      AND seo_completion_ratio >= 0.6
--    ORDER BY seo_completion_ratio DESC;
--
-- 5. execution_idごとのサマリー:
--    SELECT
--      execution_id,
--      COUNT(*) AS total_asins,
--      COUNTIF(should_exit_launch) AS exit_suggested_count,
--      COUNTIF(is_emergency_exit) AS emergency_count,
--      AVG(seo_completion_ratio) AS avg_completion_ratio
--    FROM `project.dataset.launch_exit_decisions`
--    GROUP BY execution_id
--    ORDER BY execution_id DESC;
-- =============================================================================

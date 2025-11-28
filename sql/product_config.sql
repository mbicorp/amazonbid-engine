-- =============================================================================
-- product_config テーブル作成DDL
--
-- 商品（ASIN）ごとの設定を管理するテーブル
-- Retool UIから編集可能
--
-- 実行方法:
--   BigQuery Console → SQL ワークスペース でこのクエリを実行
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.product_config` (
  asin STRING NOT NULL,
  is_active BOOL NOT NULL,
  revenue_model STRING NOT NULL,
  lifecycle_state STRING NOT NULL,
  margin_rate FLOAT64,
  expected_repeat_orders_assumed FLOAT64,
  launch_date DATE,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);


-- =============================================================================
-- ダミーデータ挿入
-- テーブル作成後に実行してください
-- =============================================================================

INSERT INTO `rpptool.amazon_bid_engine.product_config`
  (asin, is_active, revenue_model, lifecycle_state, margin_rate, expected_repeat_orders_assumed, launch_date, created_at, updated_at)
VALUES
  ('B00EXAMPLE1', true, 'LTV', 'LAUNCH_HARD', 0.35, 2.5, DATE '2025-11-01', CURRENT_DATETIME(), CURRENT_DATETIME()),
  ('B00EXAMPLE2', true, 'LTV', 'GROW', 0.40, 1.8, DATE '2025-09-15', CURRENT_DATETIME(), CURRENT_DATETIME()),
  ('B00EXAMPLE3', true, 'SINGLE', 'HARVEST', 0.30, 1.0, DATE '2025-06-01', CURRENT_DATETIME(), CURRENT_DATETIME()),
  ('B00EXAMPLE4', false, 'LTV', 'GROW', 0.25, 1.5, DATE '2025-08-20', CURRENT_DATETIME(), CURRENT_DATETIME()),
  ('B00EXAMPLE5', true, 'LTV', 'LAUNCH_SOFT', 0.38, 2.0, DATE '2025-10-10', CURRENT_DATETIME(), CURRENT_DATETIME());


-- =============================================================================
-- 確認クエリ
-- =============================================================================

-- SELECT * FROM `rpptool.amazon_bid_engine.product_config`;

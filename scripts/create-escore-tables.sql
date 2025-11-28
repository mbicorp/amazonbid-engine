-- =============================================================================
-- 自適応型Eスコア最適化システム - BigQueryテーブル作成スクリプト
-- =============================================================================

-- プロジェクトとデータセットを設定
-- 実行前に以下を適切な値に置き換えてください
-- PROJECT_ID: rpptool
-- DATASET_ID: amazon_bid_engine

-- =============================================================================
-- フィードバックテーブル
-- 推奨結果と評価結果を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.escore_feedback` (
  -- 識別子
  feedback_id STRING NOT NULL,
  execution_id STRING NOT NULL,
  keyword_id STRING NOT NULL,
  campaign_id STRING NOT NULL,
  ad_group_id STRING NOT NULL,

  -- タイムスタンプ
  recommendation_timestamp TIMESTAMP NOT NULL,
  evaluation_timestamp TIMESTAMP,

  -- コンテキスト
  mode STRING NOT NULL,         -- NORMAL | S_MODE
  brand_type STRING NOT NULL,   -- BRAND_OWN | BRAND_CONQUEST | GENERIC
  season STRING NOT NULL,       -- Q1 | Q2 | Q3 | Q4

  -- Eスコア情報
  e_score FLOAT64 NOT NULL,
  predicted_rank STRING NOT NULL,  -- S | A | B | C | D
  performance_score FLOAT64 NOT NULL,
  efficiency_score FLOAT64 NOT NULL,
  potential_score FLOAT64 NOT NULL,

  -- 使用した重み
  weight_performance FLOAT64 NOT NULL,
  weight_efficiency FLOAT64 NOT NULL,
  weight_potential FLOAT64 NOT NULL,

  -- アクション情報
  action_taken STRING NOT NULL,  -- STRONG_UP | MILD_UP | KEEP | MILD_DOWN | STRONG_DOWN | STOP
  change_rate FLOAT64 NOT NULL,

  -- 実行前メトリクス
  cvr_before FLOAT64 NOT NULL,
  ctr_before FLOAT64 NOT NULL,
  acos_before FLOAT64 NOT NULL,
  sales_before FLOAT64 NOT NULL,
  clicks_before FLOAT64 NOT NULL,
  bid_before FLOAT64 NOT NULL,

  -- 実行後メトリクス（3時間後に評価）
  cvr_after FLOAT64,
  ctr_after FLOAT64,
  acos_after FLOAT64,
  sales_after FLOAT64,
  clicks_after FLOAT64,
  bid_after FLOAT64,

  -- 評価結果
  success_level STRING,    -- EXCELLENT | GOOD | ACCEPTABLE | POOR
  success_score FLOAT64,   -- 0.0 ~ 1.0

  -- 評価済みフラグ
  evaluated BOOL NOT NULL DEFAULT FALSE
)
PARTITION BY DATE(recommendation_timestamp)
CLUSTER BY mode, brand_type, action_taken
OPTIONS(
  description = '自適応Eスコア最適化のフィードバックデータ',
  labels = [('system', 'adaptive_escore')]
);

-- =============================================================================
-- 重み履歴テーブル
-- 重み変更の履歴を保存（ロールバック用）
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.escore_weight_history` (
  -- 識別子
  history_id STRING NOT NULL,

  -- 対象
  target_type STRING NOT NULL,   -- mode | brand_type | season
  target_value STRING NOT NULL,  -- NORMAL, S_MODE, BRAND_OWN, etc.

  -- 重み
  weight_performance FLOAT64 NOT NULL,
  weight_efficiency FLOAT64 NOT NULL,
  weight_potential FLOAT64 NOT NULL,

  -- メタ情報
  accuracy FLOAT64 NOT NULL,
  data_count INT64 NOT NULL,
  saved_at TIMESTAMP NOT NULL,
  rolled_back BOOL NOT NULL DEFAULT FALSE
)
PARTITION BY DATE(saved_at)
CLUSTER BY target_type, target_value
OPTIONS(
  description = '自適応Eスコアの重み変更履歴',
  labels = [('system', 'adaptive_escore')]
);

-- =============================================================================
-- 最適化ログテーブル
-- 最適化実行の記録
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.escore_optimization_log` (
  -- 識別子
  log_id STRING NOT NULL,

  -- 対象
  target_type STRING NOT NULL,
  target_value STRING NOT NULL,

  -- 最適化前の重み
  previous_weight_performance FLOAT64 NOT NULL,
  previous_weight_efficiency FLOAT64 NOT NULL,
  previous_weight_potential FLOAT64 NOT NULL,

  -- 最適化後の重み
  new_weight_performance FLOAT64 NOT NULL,
  new_weight_efficiency FLOAT64 NOT NULL,
  new_weight_potential FLOAT64 NOT NULL,

  -- 変化量
  delta_performance FLOAT64 NOT NULL,
  delta_efficiency FLOAT64 NOT NULL,
  delta_potential FLOAT64 NOT NULL,

  -- 統計情報
  data_count INT64 NOT NULL,
  previous_accuracy FLOAT64 NOT NULL,
  estimated_accuracy FLOAT64 NOT NULL,

  -- 結果
  anomaly_detected BOOL NOT NULL,
  rolled_back BOOL NOT NULL,

  -- タイムスタンプ
  optimized_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(optimized_at)
CLUSTER BY target_type, target_value
OPTIONS(
  description = '自適応Eスコアの最適化実行ログ',
  labels = [('system', 'adaptive_escore')]
);

-- =============================================================================
-- インデックス用のビュー（分析用）
-- =============================================================================

-- 最新の重み設定を取得するビュー
CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_current_weights` AS
SELECT
  h.target_type,
  h.target_value,
  h.weight_performance,
  h.weight_efficiency,
  h.weight_potential,
  h.accuracy,
  h.data_count,
  h.saved_at
FROM `rpptool.amazon_bid_engine.escore_weight_history` h
INNER JOIN (
  SELECT
    target_type,
    target_value,
    MAX(saved_at) as max_saved_at
  FROM `rpptool.amazon_bid_engine.escore_weight_history`
  WHERE rolled_back = FALSE
  GROUP BY target_type, target_value
) latest
ON h.target_type = latest.target_type
  AND h.target_value = latest.target_value
  AND h.saved_at = latest.max_saved_at
WHERE h.rolled_back = FALSE;

-- アクション別成功率サマリービュー
CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_success_by_action` AS
SELECT
  action_taken,
  mode,
  COUNT(*) as total_count,
  COUNTIF(success_level = 'EXCELLENT') as excellent_count,
  COUNTIF(success_level = 'GOOD') as good_count,
  COUNTIF(success_level = 'ACCEPTABLE') as acceptable_count,
  COUNTIF(success_level = 'POOR') as poor_count,
  AVG(success_score) as avg_success_score,
  AVG(e_score) as avg_e_score
FROM `rpptool.amazon_bid_engine.escore_feedback`
WHERE evaluated = TRUE
  AND recommendation_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY action_taken, mode
ORDER BY mode, action_taken;

-- ランク別精度サマリービュー
CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_accuracy_by_rank` AS
SELECT
  predicted_rank,
  mode,
  COUNT(*) as total_count,
  AVG(success_score) as avg_success_score,
  AVG(e_score) as avg_e_score,
  -- Eスコアと成功スコアの相関（簡易版）
  CORR(e_score / 100, success_score) as correlation
FROM `rpptool.amazon_bid_engine.escore_feedback`
WHERE evaluated = TRUE
  AND recommendation_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY predicted_rank, mode
ORDER BY mode, predicted_rank;

-- 最適化履歴サマリービュー
CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_optimization_summary` AS
SELECT
  target_type,
  target_value,
  COUNT(*) as total_optimizations,
  COUNTIF(rolled_back) as rollback_count,
  COUNTIF(anomaly_detected) as anomaly_count,
  AVG(estimated_accuracy - previous_accuracy) as avg_accuracy_improvement,
  MAX(estimated_accuracy) as best_accuracy,
  SUM(data_count) as total_data_processed,
  MAX(optimized_at) as last_optimized_at
FROM `rpptool.amazon_bid_engine.escore_optimization_log`
WHERE optimized_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY target_type, target_value
ORDER BY target_type, target_value;

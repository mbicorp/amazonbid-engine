-- Migration: keyword_recommendations_log テーブルにガードレールカラムを追加
-- 実行日: 2025-01-XX
--
-- 現在のフェーズでは guarded_new_bid は記録のみで、API送信には raw_new_bid (= new_bid) を使用
-- これにより、ガードレールを有効化した際の影響をシミュレーションできる

ALTER TABLE `{project_id}.{dataset}.keyword_recommendations_log`
ADD COLUMN IF NOT EXISTS raw_new_bid FLOAT64
OPTIONS(description = '入札ロジックが計算した生の推奨値（API送信用 = new_bid と同値）');

ALTER TABLE `{project_id}.{dataset}.keyword_recommendations_log`
ADD COLUMN IF NOT EXISTS guarded_new_bid FLOAT64
OPTIONS(description = 'ガードレール適用後の値（ログ用）');

ALTER TABLE `{project_id}.{dataset}.keyword_recommendations_log`
ADD COLUMN IF NOT EXISTS was_guard_clamped BOOL
OPTIONS(description = 'ガードでクリップされたかどうか');

ALTER TABLE `{project_id}.{dataset}.keyword_recommendations_log`
ADD COLUMN IF NOT EXISTS guard_clamp_reason STRING
OPTIONS(description = 'クランプ理由');

ALTER TABLE `{project_id}.{dataset}.keyword_recommendations_log`
ADD COLUMN IF NOT EXISTS guardrails_min_bid FLOAT64
OPTIONS(description = 'ガードレールの min_bid');

ALTER TABLE `{project_id}.{dataset}.keyword_recommendations_log`
ADD COLUMN IF NOT EXISTS guardrails_max_bid FLOAT64
OPTIONS(description = 'ガードレールの max_bid');

ALTER TABLE `{project_id}.{dataset}.keyword_recommendations_log`
ADD COLUMN IF NOT EXISTS guardrails_auto_data_source STRING
OPTIONS(description = 'データソース（HISTORICAL/THEORETICAL/FALLBACK）');

-- 分析用ビュー: ガードレール適用シミュレーション
CREATE OR REPLACE VIEW `{project_id}.{dataset}.guardrail_simulation_summary` AS
SELECT
  DATE(recommended_at) as date,
  lifecycle_state,
  COUNT(*) as total_recommendations,
  COUNTIF(was_guard_clamped) as clamped_count,
  COUNTIF(NOT was_guard_clamped OR was_guard_clamped IS NULL) as not_clamped_count,
  ROUND(SAFE_DIVIDE(COUNTIF(was_guard_clamped), COUNT(*)) * 100, 2) as clamped_percent,
  -- クランプの影響額
  SUM(CASE WHEN was_guard_clamped THEN ABS(raw_new_bid - guarded_new_bid) ELSE 0 END) as total_clamp_diff,
  AVG(CASE WHEN was_guard_clamped THEN ABS(raw_new_bid - guarded_new_bid) END) as avg_clamp_diff,
  -- データソース別件数
  COUNTIF(guardrails_auto_data_source = 'HISTORICAL') as historical_count,
  COUNTIF(guardrails_auto_data_source = 'THEORETICAL') as theoretical_count,
  COUNTIF(guardrails_auto_data_source = 'FALLBACK') as fallback_count
FROM `{project_id}.{dataset}.keyword_recommendations_log`
WHERE raw_new_bid IS NOT NULL
GROUP BY DATE(recommended_at), lifecycle_state
ORDER BY date DESC, lifecycle_state;

-- 分析用ビュー: ガードレールクランプ詳細
CREATE OR REPLACE VIEW `{project_id}.{dataset}.guardrail_clamp_details` AS
SELECT
  DATE(recommended_at) as date,
  asin,
  keyword_text,
  lifecycle_state,
  old_bid,
  raw_new_bid,
  guarded_new_bid,
  (raw_new_bid - guarded_new_bid) as clamp_diff,
  guard_clamp_reason,
  guardrails_min_bid,
  guardrails_max_bid,
  guardrails_auto_data_source
FROM `{project_id}.{dataset}.keyword_recommendations_log`
WHERE was_guard_clamped = TRUE
ORDER BY recommended_at DESC;

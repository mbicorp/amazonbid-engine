-- execution_health_summary ビュー
-- 実行単位の監視指標を計算し、異常フラグを立てる
--
-- keyword_recommendations_log から集計して、各実行の「健康状態」を評価
-- is_anomaly_basic で基本的な異常検知フラグを提供

-- =============================================================================
-- 実行健康サマリー VIEW
-- =============================================================================

CREATE OR REPLACE VIEW `{project_id}.{dataset}.execution_health_summary` AS
WITH execution_stats AS (
  SELECT
    execution_id,
    MIN(recommended_at) AS execution_time,

    -- 実行モード（最頻値を取得）
    APPROX_TOP_COUNT(guardrails_mode, 1)[SAFE_OFFSET(0)].value AS guardrails_mode,

    -- 基本カウント
    COUNT(*) AS total_keywords,
    COUNTIF(bid_change != 0) AS total_recommendations,
    COUNTIF(is_applied = TRUE) AS total_applied,
    COUNTIF(apply_error IS NOT NULL) AS total_apply_failed,

    -- 変更方向カウント
    COUNTIF(bid_change_percent > 50) AS strong_up_count,
    COUNTIF(bid_change_percent < -30) AS strong_down_count,
    COUNTIF(bid_change > 0) AS up_count,
    COUNTIF(bid_change < 0) AS down_count,
    COUNTIF(bid_change = 0) AS keep_count,

    -- ガードレール関連
    COUNTIF(was_guard_clamped = TRUE) AS guardrails_clipped_count,

    -- 入札変更統計
    AVG(CASE WHEN old_bid > 0 THEN new_bid / old_bid ELSE NULL END) AS avg_bid_change_ratio,
    MAX(CASE WHEN old_bid > 0 THEN new_bid / old_bid ELSE NULL END) AS max_bid_change_ratio,
    MIN(CASE WHEN old_bid > 0 THEN new_bid / old_bid ELSE NULL END) AS min_bid_change_ratio

  FROM `{project_id}.{dataset}.keyword_recommendations_log`
  WHERE recommended_at >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 30 DAY)
  GROUP BY execution_id
),

execution_with_info AS (
  SELECT
    es.*,
    e.mode,
    e.status,
    e.started_at,
    e.finished_at,
    DATETIME_DIFF(e.finished_at, e.started_at, SECOND) AS execution_duration_sec
  FROM execution_stats es
  LEFT JOIN `{project_id}.{dataset}.executions` e
    ON es.execution_id = e.execution_id
)

SELECT
  execution_id,
  execution_time,
  mode,
  guardrails_mode,
  status,
  started_at,
  finished_at,
  execution_duration_sec,

  -- 基本カウント
  total_keywords,
  total_recommendations,
  total_applied,
  total_apply_failed,
  strong_up_count,
  strong_down_count,
  up_count,
  down_count,
  keep_count,
  guardrails_clipped_count,

  -- 比率指標
  SAFE_DIVIDE(up_count, total_keywords) AS up_ratio,
  SAFE_DIVIDE(down_count, total_keywords) AS down_ratio,
  SAFE_DIVIDE(guardrails_clipped_count, total_keywords) AS guardrails_clipped_ratio,
  SAFE_DIVIDE(total_apply_failed, total_applied) AS apply_failed_ratio,

  -- 入札変更統計
  COALESCE(avg_bid_change_ratio, 1.0) AS avg_bid_change_ratio,
  COALESCE(max_bid_change_ratio, 1.0) AS max_bid_change_ratio,
  COALESCE(min_bid_change_ratio, 1.0) AS min_bid_change_ratio,

  -- 異常フラグ（いずれかの閾値を超えた場合に true）
  -- デフォルト閾値:
  --   down_ratio > 0.5
  --   up_ratio > 0.5
  --   guardrails_clipped_ratio > 0.3
  --   apply_failed_ratio > 0.2 OR total_apply_failed > 10
  --   max_bid_change_ratio > 3.0
  CASE
    WHEN SAFE_DIVIDE(down_count, total_keywords) > 0.5 THEN TRUE
    WHEN SAFE_DIVIDE(up_count, total_keywords) > 0.5 THEN TRUE
    WHEN SAFE_DIVIDE(guardrails_clipped_count, total_keywords) > 0.3 THEN TRUE
    WHEN SAFE_DIVIDE(total_apply_failed, total_applied) > 0.2 THEN TRUE
    WHEN total_apply_failed > 10 THEN TRUE
    WHEN COALESCE(max_bid_change_ratio, 1.0) > 3.0 THEN TRUE
    ELSE FALSE
  END AS is_anomaly_basic,

  -- 異常理由（デバッグ用）
  ARRAY_CONCAT(
    IF(SAFE_DIVIDE(down_count, total_keywords) > 0.5, ['DOWN_RATIO_HIGH'], []),
    IF(SAFE_DIVIDE(up_count, total_keywords) > 0.5, ['UP_RATIO_HIGH'], []),
    IF(SAFE_DIVIDE(guardrails_clipped_count, total_keywords) > 0.3, ['GUARDRAILS_CLIPPED_HIGH'], []),
    IF(SAFE_DIVIDE(total_apply_failed, total_applied) > 0.2, ['APPLY_FAILED_RATIO_HIGH'], []),
    IF(total_apply_failed > 10, ['APPLY_FAILED_COUNT_HIGH'], []),
    IF(COALESCE(max_bid_change_ratio, 1.0) > 3.0, ['BID_CHANGE_RATIO_HIGH'], [])
  ) AS anomaly_reasons

FROM execution_with_info
ORDER BY execution_time DESC;


-- =============================================================================
-- 直近 N 回の実行サマリー VIEW（ダッシュボード用）
-- =============================================================================

CREATE OR REPLACE VIEW `{project_id}.{dataset}.execution_health_recent` AS
SELECT *
FROM `{project_id}.{dataset}.execution_health_summary`
ORDER BY execution_time DESC
LIMIT 100;


-- =============================================================================
-- 異常実行のみ抽出 VIEW
-- =============================================================================

CREATE OR REPLACE VIEW `{project_id}.{dataset}.execution_health_anomalies` AS
SELECT *
FROM `{project_id}.{dataset}.execution_health_summary`
WHERE is_anomaly_basic = TRUE
ORDER BY execution_time DESC;


-- =============================================================================
-- 日別サマリー VIEW
-- =============================================================================

CREATE OR REPLACE VIEW `{project_id}.{dataset}.execution_health_daily_summary` AS
SELECT
  DATE(execution_time) AS date,
  COUNT(*) AS total_executions,
  COUNTIF(is_anomaly_basic = TRUE) AS anomaly_executions,
  SAFE_DIVIDE(COUNTIF(is_anomaly_basic = TRUE), COUNT(*)) AS anomaly_rate,
  AVG(total_keywords) AS avg_keywords,
  AVG(total_recommendations) AS avg_recommendations,
  AVG(total_applied) AS avg_applied,
  AVG(up_ratio) AS avg_up_ratio,
  AVG(down_ratio) AS avg_down_ratio,
  AVG(guardrails_clipped_ratio) AS avg_guardrails_clipped_ratio,
  AVG(avg_bid_change_ratio) AS avg_bid_change_ratio,
  MAX(max_bid_change_ratio) AS max_bid_change_ratio_of_day
FROM `{project_id}.{dataset}.execution_health_summary`
WHERE execution_time >= DATETIME_SUB(CURRENT_DATETIME(), INTERVAL 30 DAY)
GROUP BY DATE(execution_time)
ORDER BY date DESC;

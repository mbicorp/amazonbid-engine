-- budget_recommendations テーブル
-- 日予算最適化の推奨ログ
--
-- 各キャンペーンの日予算変更推奨と実際の適用結果を記録
-- Lost IS Budget と ACOS を考慮した判断ロジックの結果を保存

CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.budget_recommendations` (
  -- 実行リンク
  execution_id STRING NOT NULL,           -- 実行ID（UUID）

  -- 対象識別子
  campaign_id STRING NOT NULL,            -- キャンペーンID
  campaign_name STRING NOT NULL,          -- キャンペーン名

  -- アクション
  action STRING NOT NULL,                 -- アクションタイプ
    -- "BOOST": 予算を引き上げる（高パフォーマンス＆予算逼迫）
    -- "KEEP": 現状維持
    -- "CURB": 予算を削減する（低パフォーマンス＆余剰予算）

  -- 予算額
  old_budget INT64 NOT NULL,              -- 変更前の日予算（円）
  new_budget INT64 NOT NULL,              -- 推奨日予算（円）
  budget_change INT64,                    -- 変更幅（円）
  budget_change_percent FLOAT64,          -- 変更率（%）

  -- 判定理由
  reason_code STRING NOT NULL,            -- 変更理由コード
    -- "HIGH_PERFORMANCE_LOST_IS": 高パフォーマンス＆Lost IS Budget が高い
    -- "HIGH_PERFORMANCE_HIGH_USAGE": 高パフォーマンス＆予算消化率が高い
    -- "MODERATE_PERFORMANCE": 目標付近のACOS、現状維持
    -- "BUDGET_AVAILABLE": 予算に余裕がある、現状維持
    -- "LOW_PERFORMANCE_SURPLUS": 低パフォーマンス＆余剰予算、削減推奨
    -- "MAX_BUDGET_REACHED": 最大予算上限に到達
    -- "MIN_BUDGET_REACHED": 最小予算下限に到達
    -- "INSUFFICIENT_DATA": データ不足で判断不可
  reason_detail STRING,                   -- 変更理由の詳細説明

  -- コンテキスト情報（判断根拠）
  budget_usage_percent FLOAT64,           -- 予算消化率（%）
  lost_impression_share_budget FLOAT64,   -- 予算不足によるIS損失（%）
  current_acos_7d FLOAT64,                -- 現在のACOS（7日）
  current_acos_30d FLOAT64,               -- 現在のACOS（30日）
  target_acos FLOAT64 NOT NULL,           -- 目標ACOS
  acos_gap_ratio FLOAT64,                 -- ACOSギャップ比率（current_acos / target_acos）

  -- ガードレール情報
  was_guard_clamped BOOL NOT NULL DEFAULT FALSE, -- ガードレールによりクリップされたか
  guard_clamp_reason STRING,              -- クランプ理由（MAX_BUDGET / MIN_BUDGET）
  max_budget_cap INT64,                   -- 適用された最大予算上限（円）

  -- 適用状態
  is_applied BOOL NOT NULL DEFAULT FALSE, -- 実際に適用されたか（SHADOWでは常にFALSE）
  applied_at DATETIME,                    -- 適用時刻（適用された場合）
  apply_error STRING,                     -- 適用エラー（エラー発生時）

  -- メタ情報
  recommended_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  -- 主キー（複合）
  PRIMARY KEY (execution_id, campaign_id) NOT ENFORCED
)
PARTITION BY DATE(recommended_at)
CLUSTER BY execution_id, campaign_id, action
OPTIONS (
  description = '日予算最適化推奨ログ - Lost IS Budget と ACOS を考慮した判断結果',
  partition_expiration_days = 365
);

-- =============================================================================
-- 分析用ビュー
-- =============================================================================

-- 日別推奨サマリー
CREATE OR REPLACE VIEW `{project_id}.{dataset}.budget_recommendations_daily_summary` AS
SELECT
  DATE(recommended_at) as date,
  COUNT(*) as total_recommendations,
  COUNTIF(action = 'BOOST') as boost_count,
  COUNTIF(action = 'CURB') as curb_count,
  COUNTIF(action = 'KEEP') as keep_count,
  COUNTIF(is_applied) as applied_count,
  SUM(CASE WHEN action = 'BOOST' THEN budget_change ELSE 0 END) as total_budget_increase,
  SUM(CASE WHEN action = 'CURB' THEN ABS(budget_change) ELSE 0 END) as total_budget_decrease,
  AVG(CASE WHEN action = 'BOOST' THEN budget_change_percent END) as avg_boost_percent,
  AVG(CASE WHEN action = 'CURB' THEN budget_change_percent END) as avg_curb_percent,
  reason_code,
  COUNT(*) as reason_count
FROM `{project_id}.{dataset}.budget_recommendations`
GROUP BY DATE(recommended_at), reason_code
ORDER BY date DESC, reason_count DESC;

-- キャンペーン別推奨履歴
CREATE OR REPLACE VIEW `{project_id}.{dataset}.budget_recommendations_by_campaign` AS
SELECT
  campaign_id,
  campaign_name,
  DATE(recommended_at) as date,
  COUNT(*) as total_recommendations,
  COUNTIF(action = 'BOOST') as boost_count,
  COUNTIF(action = 'CURB') as curb_count,
  SUM(budget_change) as net_budget_change,
  AVG(budget_usage_percent) as avg_budget_usage_percent,
  AVG(lost_impression_share_budget) as avg_lost_is_budget,
  AVG(current_acos_7d) as avg_acos_7d,
  AVG(target_acos) as avg_target_acos
FROM `{project_id}.{dataset}.budget_recommendations`
GROUP BY campaign_id, campaign_name, DATE(recommended_at)
ORDER BY date DESC, campaign_id;

-- 予算増額効果追跡ビュー
-- BOOST後のパフォーマンス変化を追跡するためのビュー
CREATE OR REPLACE VIEW `{project_id}.{dataset}.budget_boost_tracking` AS
SELECT
  br.campaign_id,
  br.campaign_name,
  br.recommended_at,
  br.old_budget,
  br.new_budget,
  br.budget_change_percent,
  br.lost_impression_share_budget as lost_is_at_recommendation,
  br.current_acos_7d as acos_at_recommendation,
  br.target_acos,
  br.reason_code,
  br.execution_id
FROM `{project_id}.{dataset}.budget_recommendations` br
WHERE br.action = 'BOOST'
  AND br.is_applied = TRUE
ORDER BY br.recommended_at DESC;

-- 予算最適化の機会損失推定
-- Lost IS Budget から推定される機会損失額を計算
CREATE OR REPLACE VIEW `{project_id}.{dataset}.budget_opportunity_loss_estimate` AS
SELECT
  br.campaign_id,
  br.campaign_name,
  DATE(br.recommended_at) as date,
  br.old_budget,
  br.lost_impression_share_budget,
  br.current_acos_7d,
  br.target_acos,
  -- 機会損失推定額 = 現在の予算 × Lost IS % × (1 - ACOS)
  -- これは Lost IS 分の売上がACOSを考慮した利益になる仮定
  CASE
    WHEN br.lost_impression_share_budget IS NOT NULL
      AND br.lost_impression_share_budget > 0
      AND br.current_acos_7d IS NOT NULL
      AND br.current_acos_7d < 1
    THEN br.old_budget * (br.lost_impression_share_budget / 100) * (1 - br.current_acos_7d)
    ELSE 0
  END as estimated_daily_opportunity_loss
FROM `{project_id}.{dataset}.budget_recommendations` br
WHERE br.action = 'BOOST'
  OR (br.action = 'KEEP' AND br.lost_impression_share_budget > 10)
ORDER BY date DESC, estimated_daily_opportunity_loss DESC;

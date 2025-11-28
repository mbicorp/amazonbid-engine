-- placement_recommendations テーブル
-- 掲載位置最適化の推奨ログ
--
-- 各キャンペーン×掲載位置の入札調整比率変更推奨と実際の適用結果を記録
-- インプレッションシェア考慮型の判断ロジックの結果を保存

CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.placement_recommendations` (
  -- 実行リンク
  execution_id STRING NOT NULL,           -- 実行ID（UUID）

  -- 対象識別子
  campaign_id STRING NOT NULL,            -- キャンペーンID
  campaign_name STRING NOT NULL,          -- キャンペーン名
  placement STRING NOT NULL,              -- 掲載位置タイプ
    -- "TOP_OF_SEARCH": 検索結果ページの最上部（1ページ目）
    -- "PRODUCT_PAGES": 商品詳細ページ
    -- "REST_OF_SEARCH": 検索結果ページのその他

  -- アクション
  action STRING NOT NULL,                 -- アクションタイプ
    -- "BOOST": 入札調整比率を上げる（勝ちパターン）
    -- "TEST_BOOST": テスト的に大きく上げる（オポチュニティ・ジャンプ）
    -- "DECREASE": 入札調整比率を下げる（撤退判断）
    -- "NO_ACTION": 変更なし

  -- 入札調整比率
  old_modifier INT64 NOT NULL,            -- 変更前の入札調整比率（0-900%）
  new_modifier INT64 NOT NULL,            -- 推奨入札調整比率（0-900%）
  modifier_change INT64,                  -- 変更幅（new_modifier - old_modifier）

  -- 判定理由
  reason_code STRING NOT NULL,            -- 変更理由コード
    -- "STRONG_PERFORMANCE": ACOSが目標を達成、BOOSTする
    -- "OPPORTUNITY_JUMP": ISが低くACOSが悪い、テスト的にBOOSTする
    -- "TRUE_WEAKNESS": ISが高くACOSが悪い、撤退
    -- "MODERATE_PERFORMANCE": ACOSが目標付近、現状維持
    -- "INSUFFICIENT_DATA": データ不足で判断不可
    -- "BUDGET_LIMITED": 予算制限のためテストブースト不可
    -- "MAX_MODIFIER_REACHED": 最大調整比率に到達
  reason_detail STRING,                   -- 変更理由の詳細説明

  -- コンテキスト情報（判断根拠）
  impression_share FLOAT64,               -- インプレッションシェア（%）
  current_acos FLOAT64,                   -- 現在のACOS
  target_acos FLOAT64 NOT NULL,           -- 目標ACOS
  acos_gap_ratio FLOAT64,                 -- ACOSギャップ比率（current_acos / target_acos）
  clicks_30d INT64,                       -- 過去30日のクリック数（データ有意性判定用）

  -- オポチュニティ・ジャンプ情報
  is_opportunity_jump BOOL NOT NULL DEFAULT FALSE,
    -- true: ISが低いためテスト的に強く入札して真のTOSパフォーマンスを確認

  -- 適用状態
  is_applied BOOL NOT NULL DEFAULT FALSE, -- 実際に適用されたか（SHADOWでは常にFALSE）
  applied_at DATETIME,                    -- 適用時刻（適用された場合）
  apply_error STRING,                     -- 適用エラー（エラー発生時）

  -- メタ情報
  recommended_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  -- 主キー（複合）
  PRIMARY KEY (execution_id, campaign_id, placement) NOT ENFORCED
)
PARTITION BY DATE(recommended_at)
CLUSTER BY execution_id, campaign_id, action
OPTIONS (
  description = '掲載位置最適化推奨ログ - インプレッションシェア考慮型の判断結果',
  partition_expiration_days = 365
);

-- =============================================================================
-- 分析用ビュー
-- =============================================================================

-- 日別推奨サマリー
CREATE OR REPLACE VIEW `{project_id}.{dataset}.placement_recommendations_daily_summary` AS
SELECT
  DATE(recommended_at) as date,
  COUNT(*) as total_recommendations,
  COUNTIF(action = 'BOOST') as boost_count,
  COUNTIF(action = 'TEST_BOOST') as test_boost_count,
  COUNTIF(action = 'DECREASE') as decrease_count,
  COUNTIF(action = 'NO_ACTION') as no_action_count,
  COUNTIF(is_opportunity_jump) as opportunity_jump_count,
  COUNTIF(is_applied) as applied_count,
  AVG(ABS(modifier_change)) as avg_modifier_change,
  reason_code,
  COUNT(*) as reason_count
FROM `{project_id}.{dataset}.placement_recommendations`
GROUP BY DATE(recommended_at), reason_code
ORDER BY date DESC, reason_count DESC;

-- キャンペーン別推奨履歴
CREATE OR REPLACE VIEW `{project_id}.{dataset}.placement_recommendations_by_campaign` AS
SELECT
  campaign_id,
  campaign_name,
  placement,
  DATE(recommended_at) as date,
  COUNT(*) as total_recommendations,
  COUNTIF(action IN ('BOOST', 'TEST_BOOST')) as boost_count,
  COUNTIF(action = 'DECREASE') as decrease_count,
  COUNTIF(is_opportunity_jump) as opportunity_jump_count,
  AVG(impression_share) as avg_impression_share,
  AVG(current_acos) as avg_acos,
  AVG(target_acos) as avg_target_acos
FROM `{project_id}.{dataset}.placement_recommendations`
GROUP BY campaign_id, campaign_name, placement, DATE(recommended_at)
ORDER BY date DESC, campaign_id, placement;

-- オポチュニティ・ジャンプ追跡ビュー
-- テストブースト後のパフォーマンス変化を追跡するためのビュー
CREATE OR REPLACE VIEW `{project_id}.{dataset}.placement_opportunity_jump_tracking` AS
SELECT
  pr.campaign_id,
  pr.campaign_name,
  pr.placement,
  pr.recommended_at,
  pr.old_modifier,
  pr.new_modifier,
  pr.impression_share as is_at_recommendation,
  pr.current_acos as acos_at_recommendation,
  pr.target_acos,
  -- 1週間後の状態（ジョイン用、実際の実装では別テーブルから取得）
  pr.execution_id
FROM `{project_id}.{dataset}.placement_recommendations` pr
WHERE pr.is_opportunity_jump = TRUE
  AND pr.is_applied = TRUE
ORDER BY pr.recommended_at DESC;

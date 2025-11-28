-- =============================================================================
-- 自動ガードレールテーブル
-- 履歴データベースで自動計算された min_bid / max_bid を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.product_guardrails_auto` (
  -- 複合主キー
  asin STRING NOT NULL,                    -- Amazon標準識別番号
  lifecycle_state STRING NOT NULL,         -- ライフサイクル状態
    -- "LAUNCH_HARD": 投資強化
    -- "LAUNCH_SOFT": 投資継続
    -- "GROW": 成長バランス
    -- "HARVEST": 利益回収

  -- 自動計算されたガードレール
  min_bid_auto NUMERIC NOT NULL,           -- 自動計算された最低入札額（円）
  max_bid_auto NUMERIC NOT NULL,           -- 自動計算された最高入札額（円）

  -- データソース
  data_source STRING NOT NULL,             -- 計算に使用したデータソース
    -- "HISTORICAL": 履歴データから計算（有望バケットあり）
    -- "THEORETICAL": 理論値フォールバック（cpc_break_even から計算）
    -- "FALLBACK": 固定フォールバック（データ不足）

  -- 計算に使用した統計情報
  clicks_used INT64 NOT NULL DEFAULT 0,    -- 計算に使用した合計クリック数

  -- メタ情報
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),

  -- 主キー
  PRIMARY KEY (asin, lifecycle_state) NOT ENFORCED
)
CLUSTER BY asin, lifecycle_state, data_source
OPTIONS (
  description = '自動ガードレール: 履歴データから計算された入札上下限'
);

-- =============================================================================
-- サマリービュー: ASIN別ガードレール概要
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.product_guardrails_auto_summary` AS
SELECT
  asin,
  COUNT(*) AS lifecycle_count,
  ARRAY_AGG(STRUCT(
    lifecycle_state,
    min_bid_auto,
    max_bid_auto,
    data_source,
    clicks_used
  ) ORDER BY lifecycle_state) AS guardrails_by_lifecycle,
  MAX(updated_at) AS last_updated_at
FROM `${PROJECT_ID}.${DATASET}.product_guardrails_auto`
GROUP BY asin;

-- =============================================================================
-- データソース別統計ビュー
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.product_guardrails_auto_stats` AS
SELECT
  data_source,
  lifecycle_state,
  COUNT(DISTINCT asin) AS asin_count,
  AVG(min_bid_auto) AS avg_min_bid,
  AVG(max_bid_auto) AS avg_max_bid,
  SUM(clicks_used) AS total_clicks_used
FROM `${PROJECT_ID}.${DATASET}.product_guardrails_auto`
GROUP BY data_source, lifecycle_state
ORDER BY data_source, lifecycle_state;

-- =============================================================================
-- コメント
-- =============================================================================
-- このテーブルは recomputeGuardrailsForAllProducts 関数によって生成される
-- 自動計算された入札ガードレールを保存します。
--
-- data_source の意味:
-- - "HISTORICAL": search_term_bid_buckets_30d から十分なクリック数の
--   有望バケット（ACOS・CVR条件を満たす）が見つかり、そこから計算
-- - "THEORETICAL": 有望バケットが見つからないが、cpc_break_even（損益分岐CPC）
--   を計算できたため、理論値から min/max を算出
-- - "FALLBACK": データ不足のため、固定のフォールバック値を使用
--
-- 使用例:
-- SELECT * FROM `${PROJECT_ID}.${DATASET}.product_guardrails_auto`
-- WHERE asin = 'B0XXXXXXXXX';
--
-- use_auto_min_max が有効な場合、compute_bid_recommendations は
-- このテーブルから min_bid / max_bid を取得して使用します。

-- =============================================================================
-- 統合入札戦略エンジン - BigQueryテーブル作成スクリプト
-- =============================================================================

-- プロジェクトとデータセットを設定
-- PROJECT_ID: rpptool
-- DATASET_ID: amazon_bid_engine

-- =============================================================================
-- 商品収益性テーブル
-- SP-API / 設定値から取得した商品の収益性データ
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.product_profitability` (
  -- 識別子
  asin STRING NOT NULL,
  marketplace STRING NOT NULL,

  -- 売上データ
  total_sales_30d FLOAT64 NOT NULL,            -- 過去30日の総売上
  total_sales_previous_30d FLOAT64 NOT NULL,   -- 前30日の総売上
  ad_sales_30d FLOAT64 NOT NULL,               -- 広告経由売上
  organic_sales_30d FLOAT64 NOT NULL,          -- オーガニック売上（推定）

  -- 利益率
  profit_margin FLOAT64 NOT NULL,              -- 商品利益率
  unit_profit FLOAT64 NOT NULL,                -- 1個あたり利益

  -- コスト
  ad_spend_30d FLOAT64 NOT NULL,               -- 広告費
  total_ad_cost FLOAT64 NOT NULL,              -- 総広告コスト

  -- 計算値
  ad_dependency_ratio FLOAT64 NOT NULL,        -- 広告依存度
  sales_growth_rate FLOAT64 NOT NULL,          -- 売上成長率
  total_roas FLOAT64 NOT NULL,                 -- 総ROAS
  ad_roas FLOAT64 NOT NULL,                    -- 広告ROAS
  profit_after_ad FLOAT64 NOT NULL,            -- 広告費控除後利益

  -- メタ情報
  updated_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(updated_at)
CLUSTER BY marketplace, asin
OPTIONS(
  description = '商品収益性データ（SP-API/設定値から取得）',
  labels = [('system', 'unified_strategy')]
);

-- =============================================================================
-- 統合入札戦略テーブル
-- 商品×キーワードごとの統合戦略判定結果
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.unified_bid_strategy` (
  -- 識別子
  asin STRING NOT NULL,
  keyword STRING NOT NULL,
  keyword_id STRING NOT NULL,
  campaign_id STRING NOT NULL,
  ad_group_id STRING NOT NULL,
  marketplace STRING NOT NULL,

  -- 商品コンテキスト
  product_strategy STRING NOT NULL,            -- aggressive_growth | balanced_growth | profit_maximize | maintenance | harvest
  product_lifecycle STRING NOT NULL,           -- launch | growth | mature | decline
  product_profit_margin FLOAT64 NOT NULL,

  -- キーワードコンテキスト（Jungle Scout由来）
  keyword_strategy STRING NOT NULL,            -- invest | defend | harvest | optimize | reduce
  organic_rank INT64,
  sponsored_rank INT64,
  share_of_voice FLOAT64 NOT NULL,
  search_volume INT64 NOT NULL,
  keyword_potential_score FLOAT64 NOT NULL,

  -- 広告パフォーマンス
  current_acos FLOAT64 NOT NULL,
  current_cvr FLOAT64 NOT NULL,
  current_ctr FLOAT64 NOT NULL,
  current_bid FLOAT64 NOT NULL,
  clicks_30d INT64 NOT NULL,
  impressions_30d INT64 NOT NULL,

  -- 統合判定結果
  final_action STRING NOT NULL,                -- STRONG_UP | MILD_UP | KEEP | MILD_DOWN | STRONG_DOWN | STOP
  dynamic_acos_target FLOAT64 NOT NULL,
  recommended_bid FLOAT64 NOT NULL,
  bid_adjustment_rate FLOAT64 NOT NULL,

  -- 判定理由
  strategy_reason STRING NOT NULL,
  constraints_applied STRING,                  -- JSON配列

  -- スコア
  priority_score FLOAT64 NOT NULL,
  confidence_score FLOAT64 NOT NULL,

  -- メタ情報
  analyzed_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(analyzed_at)
CLUSTER BY marketplace, asin, final_action
OPTIONS(
  description = '統合入札戦略（商品×キーワード）',
  labels = [('system', 'unified_strategy')]
);

-- =============================================================================
-- 戦略サマリーテーブル
-- ASIN単位の戦略サマリー
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.unified_strategy_summary` (
  -- 識別子
  asin STRING NOT NULL,
  marketplace STRING NOT NULL,

  -- 商品情報
  product_strategy STRING NOT NULL,
  product_lifecycle STRING NOT NULL,
  total_sales_30d FLOAT64 NOT NULL,
  profit_margin FLOAT64 NOT NULL,
  ad_dependency_ratio FLOAT64 NOT NULL,

  -- キーワード統計
  total_keywords INT64 NOT NULL,
  keywords_by_strategy STRING NOT NULL,        -- JSON
  total_search_volume INT64 NOT NULL,
  avg_share_of_voice FLOAT64 NOT NULL,

  -- アクション統計
  actions_breakdown STRING NOT NULL,           -- JSON

  -- 予算配分推奨
  recommended_budget_allocation STRING NOT NULL, -- JSON

  -- 期待効果
  expected_impact STRING NOT NULL,             -- JSON

  -- メタ情報
  analyzed_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(analyzed_at)
CLUSTER BY marketplace, asin
OPTIONS(
  description = 'ASIN別統合戦略サマリー',
  labels = [('system', 'unified_strategy')]
);

-- =============================================================================
-- ビュー: 最新の商品収益性
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_latest_product_profitability` AS
SELECT p.*
FROM `rpptool.amazon_bid_engine.product_profitability` p
INNER JOIN (
  SELECT
    asin,
    marketplace,
    MAX(updated_at) as max_updated_at
  FROM `rpptool.amazon_bid_engine.product_profitability`
  GROUP BY asin, marketplace
) latest
ON p.asin = latest.asin
  AND p.marketplace = latest.marketplace
  AND p.updated_at = latest.max_updated_at;

-- =============================================================================
-- ビュー: 最新の統合戦略
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_latest_unified_strategy` AS
SELECT s.*
FROM `rpptool.amazon_bid_engine.unified_bid_strategy` s
INNER JOIN (
  SELECT
    asin,
    keyword,
    marketplace,
    MAX(analyzed_at) as max_analyzed_at
  FROM `rpptool.amazon_bid_engine.unified_bid_strategy`
  GROUP BY asin, keyword, marketplace
) latest
ON s.asin = latest.asin
  AND s.keyword = latest.keyword
  AND s.marketplace = latest.marketplace
  AND s.analyzed_at = latest.max_analyzed_at;

-- =============================================================================
-- ビュー: アクション別サマリー
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_unified_action_summary` AS
SELECT
  marketplace,
  asin,
  final_action,
  COUNT(*) as keyword_count,
  AVG(bid_adjustment_rate) as avg_bid_adjustment,
  SUM(search_volume) as total_search_volume,
  AVG(share_of_voice) as avg_sov,
  AVG(priority_score) as avg_priority
FROM `rpptool.amazon_bid_engine.v_latest_unified_strategy`
GROUP BY marketplace, asin, final_action
ORDER BY marketplace, asin, keyword_count DESC;

-- =============================================================================
-- ビュー: 商品戦略×キーワード戦略マトリックス
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_strategy_matrix_distribution` AS
SELECT
  marketplace,
  asin,
  product_strategy,
  keyword_strategy,
  COUNT(*) as count,
  AVG(dynamic_acos_target) as avg_acos_target,
  AVG(bid_adjustment_rate) as avg_bid_adjustment,
  SUM(search_volume) as total_search_volume
FROM `rpptool.amazon_bid_engine.v_latest_unified_strategy`
GROUP BY marketplace, asin, product_strategy, keyword_strategy
ORDER BY marketplace, asin, count DESC;

-- =============================================================================
-- ビュー: 投資優先キーワード
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_invest_priority_keywords` AS
SELECT *
FROM `rpptool.amazon_bid_engine.v_latest_unified_strategy`
WHERE final_action IN ('STRONG_UP', 'MILD_UP')
ORDER BY priority_score DESC;

-- =============================================================================
-- ビュー: 削減対象キーワード
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_reduce_target_keywords` AS
SELECT *
FROM `rpptool.amazon_bid_engine.v_latest_unified_strategy`
WHERE final_action IN ('STRONG_DOWN', 'STOP')
ORDER BY priority_score ASC;

-- =============================================================================
-- Jungle Scout データ保存用 BigQueryテーブル作成スクリプト
-- =============================================================================

-- プロジェクトとデータセットを設定
-- PROJECT_ID: rpptool
-- DATASET_ID: amazon_bid_engine

-- =============================================================================
-- キーワードインテリジェンステーブル
-- ASINに関連するキーワード情報を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.keyword_intelligence` (
  -- 識別子
  keyword STRING NOT NULL,
  marketplace STRING NOT NULL,
  asin STRING,

  -- 検索ボリューム
  monthly_search_volume_exact INT64 NOT NULL,
  monthly_search_volume_broad INT64 NOT NULL,

  -- PPC入札関連
  ppc_bid_broad FLOAT64 NOT NULL,
  ppc_bid_exact FLOAT64 NOT NULL,
  sp_brand_ad_bid FLOAT64 NOT NULL,

  -- ランキング・競合指標
  ease_of_ranking_score FLOAT64 NOT NULL,
  relevancy_score FLOAT64 NOT NULL,
  organic_product_count INT64 NOT NULL,
  sponsored_product_count INT64 NOT NULL,

  -- トレンド情報
  trending_direction STRING NOT NULL,  -- up | down | flat
  trending_percentage FLOAT64 NOT NULL,

  -- カテゴリ
  dominant_category STRING,

  -- メタ情報
  fetched_at TIMESTAMP NOT NULL,
  updated_at STRING NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY marketplace, asin, keyword
OPTIONS(
  description = 'Jungle Scout キーワードインテリジェンスデータ',
  labels = [('source', 'jungle_scout')]
);

-- =============================================================================
-- Share of Voiceテーブル
-- 自社ASINのキーワード別シェア情報を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.asin_share_of_voice` (
  -- 識別子
  keyword STRING NOT NULL,
  marketplace STRING NOT NULL,
  asin STRING NOT NULL,

  -- 検索ボリューム
  search_volume INT64 NOT NULL,

  -- ランキング
  organic_rank INT64,          -- NULLの場合はランク外
  sponsored_rank INT64,        -- NULLの場合は広告なし
  combined_rank INT64 NOT NULL,

  -- Share of Voice（%）
  organic_sov FLOAT64 NOT NULL,
  sponsored_sov FLOAT64 NOT NULL,
  combined_sov FLOAT64 NOT NULL,

  -- ステータス
  is_amazon_choice BOOL NOT NULL DEFAULT FALSE,
  is_best_seller BOOL NOT NULL DEFAULT FALSE,

  -- メタ情報
  fetched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY marketplace, asin, keyword
OPTIONS(
  description = 'ASIN別Share of Voiceデータ',
  labels = [('source', 'jungle_scout')]
);

-- =============================================================================
-- キーワード検索ボリューム履歴テーブル
-- 検索ボリュームの時系列データを保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.keyword_volume_history` (
  -- 識別子
  keyword STRING NOT NULL,
  marketplace STRING NOT NULL,
  date STRING NOT NULL,  -- YYYY-MM-DD

  -- 検索ボリューム
  search_volume_exact INT64 NOT NULL,
  search_volume_broad INT64 NOT NULL,

  -- メタ情報
  fetched_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(fetched_at)
CLUSTER BY marketplace, keyword
OPTIONS(
  description = 'キーワード検索ボリューム履歴',
  labels = [('source', 'jungle_scout')]
);

-- =============================================================================
-- キーワード戦略分析テーブル
-- 計算された戦略推奨を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `rpptool.amazon_bid_engine.keyword_strategy_analysis` (
  -- 識別子
  keyword STRING NOT NULL,
  asin STRING NOT NULL,
  marketplace STRING NOT NULL,

  -- 現在の状態
  current_organic_rank INT64,
  current_sponsored_rank INT64,
  current_sov FLOAT64 NOT NULL,
  search_volume INT64 NOT NULL,

  -- 推奨戦略
  recommended_strategy STRING NOT NULL,  -- harvest | invest | defend | optimize | reduce
  strategy_reason STRING NOT NULL,

  -- 推奨入札調整
  recommended_bid_adjustment FLOAT64 NOT NULL,  -- -1.0 ~ +1.0
  recommended_acos_target FLOAT64 NOT NULL,

  -- ポテンシャル評価
  potential_score FLOAT64 NOT NULL,      -- 0-100
  competition_level STRING NOT NULL,     -- low | medium | high

  -- メタ情報
  analyzed_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(analyzed_at)
CLUSTER BY marketplace, asin, recommended_strategy
OPTIONS(
  description = 'キーワード戦略分析結果',
  labels = [('source', 'jungle_scout'), ('type', 'analysis')]
);

-- =============================================================================
-- ビュー：最新のキーワードインテリジェンス
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_latest_keyword_intelligence` AS
SELECT
  ki.*
FROM `rpptool.amazon_bid_engine.keyword_intelligence` ki
INNER JOIN (
  SELECT
    keyword,
    marketplace,
    asin,
    MAX(fetched_at) as max_fetched_at
  FROM `rpptool.amazon_bid_engine.keyword_intelligence`
  GROUP BY keyword, marketplace, asin
) latest
ON ki.keyword = latest.keyword
  AND ki.marketplace = latest.marketplace
  AND COALESCE(ki.asin, '') = COALESCE(latest.asin, '')
  AND ki.fetched_at = latest.max_fetched_at;

-- =============================================================================
-- ビュー：最新のShare of Voice
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_latest_share_of_voice` AS
SELECT
  sov.*
FROM `rpptool.amazon_bid_engine.asin_share_of_voice` sov
INNER JOIN (
  SELECT
    keyword,
    marketplace,
    asin,
    MAX(fetched_at) as max_fetched_at
  FROM `rpptool.amazon_bid_engine.asin_share_of_voice`
  GROUP BY keyword, marketplace, asin
) latest
ON sov.keyword = latest.keyword
  AND sov.marketplace = latest.marketplace
  AND sov.asin = latest.asin
  AND sov.fetched_at = latest.max_fetched_at;

-- =============================================================================
-- ビュー：ASIN別キーワードパフォーマンスサマリー
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_asin_keyword_summary` AS
SELECT
  sov.asin,
  sov.marketplace,
  COUNT(DISTINCT sov.keyword) as total_keywords,
  SUM(sov.search_volume) as total_search_volume,
  AVG(sov.combined_sov) as avg_combined_sov,
  AVG(sov.organic_sov) as avg_organic_sov,
  AVG(sov.sponsored_sov) as avg_sponsored_sov,
  COUNTIF(sov.organic_rank IS NOT NULL AND sov.organic_rank <= 10) as top10_organic_keywords,
  COUNTIF(sov.is_amazon_choice) as amazon_choice_count,
  COUNTIF(sov.is_best_seller) as best_seller_count
FROM `rpptool.amazon_bid_engine.v_latest_share_of_voice` sov
GROUP BY sov.asin, sov.marketplace;

-- =============================================================================
-- ビュー：戦略別キーワード集計
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_strategy_summary` AS
SELECT
  marketplace,
  asin,
  recommended_strategy,
  COUNT(*) as keyword_count,
  SUM(search_volume) as total_search_volume,
  AVG(current_sov) as avg_current_sov,
  AVG(potential_score) as avg_potential_score,
  AVG(recommended_bid_adjustment) as avg_bid_adjustment
FROM `rpptool.amazon_bid_engine.keyword_strategy_analysis`
WHERE analyzed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY marketplace, asin, recommended_strategy
ORDER BY marketplace, asin, keyword_count DESC;

-- =============================================================================
-- ビュー：トレンドキーワード（上昇中）
-- =============================================================================

CREATE OR REPLACE VIEW `rpptool.amazon_bid_engine.v_trending_keywords` AS
SELECT
  keyword,
  marketplace,
  asin,
  monthly_search_volume_exact,
  trending_direction,
  trending_percentage,
  ppc_bid_exact,
  ease_of_ranking_score,
  fetched_at
FROM `rpptool.amazon_bid_engine.v_latest_keyword_intelligence`
WHERE trending_direction = 'up'
  AND trending_percentage > 10
ORDER BY trending_percentage DESC;

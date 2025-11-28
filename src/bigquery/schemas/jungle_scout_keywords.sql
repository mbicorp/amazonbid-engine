-- =============================================================================
-- Jungle Scout キーワードテーブル
-- Jungle Scout APIから取得したキーワード市場データ
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.jungle_scout_keywords` (
  -- キー
  product_id STRING NOT NULL,  -- ASIN
  keyword STRING NOT NULL,

  -- 検索ボリューム
  search_volume INT64,  -- 月間検索ボリューム
  search_volume_trend STRING,  -- UP, DOWN, FLAT

  -- 競合指標
  organic_product_count INT64,  -- オーガニック商品数
  sponsored_product_count INT64,  -- スポンサー商品数

  -- 入札推奨
  ppc_bid_broad FLOAT64,
  ppc_bid_exact FLOAT64,
  sp_brand_ad_bid FLOAT64,

  -- ランキングスコア
  ease_of_ranking_score FLOAT64,  -- ランキング獲得容易度 (0-100)
  relevancy_score FLOAT64,  -- 関連性スコア (0-100)

  -- カテゴリ
  dominant_category STRING,

  -- Jungle Scout固有の関連度
  js_relevancy FLOAT64,  -- 0.0-1.0

  -- ランキング情報
  organic_rank INT64,  -- 自然検索順位
  sponsored_rank INT64,  -- スポンサー順位

  -- Share of Voice
  organic_sov FLOAT64,  -- オーガニックシェア
  sponsored_sov FLOAT64,  -- スポンサーシェア
  combined_sov FLOAT64,  -- 合計シェア

  -- 取得日時
  fetched_at TIMESTAMP NOT NULL,

  -- メタ情報
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(fetched_at)
CLUSTER BY product_id, keyword
OPTIONS(
  description = 'Jungle Scout キーワードテーブル: 市場データと競合分析'
);

-- 最新データのみを取得するビュー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.jungle_scout_keywords_latest` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.jungle_scout_keywords`
WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY product_id, keyword ORDER BY fetched_at DESC) = 1;

-- =============================================================================
-- SEOスコアテーブル（商品×月次）
-- 主要キーワードの順位からSEOスコアを計算
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.seo_score_by_product` (
  -- キー
  product_id STRING NOT NULL,
  year_month STRING NOT NULL,  -- YYYY-MM形式

  -- SEOスコア
  seo_score FLOAT64 NOT NULL,  -- 0-100のスコア

  -- トレンド
  seo_score_trend STRING,  -- UP, FLAT, DOWN（過去3ヶ月の傾き）
  seo_score_prev_month FLOAT64,  -- 前月スコア
  seo_score_change FLOAT64,  -- 前月からの変化

  -- スコア詳細
  brand_score FLOAT64,  -- ブランドキーワードの平均スコア
  core_score FLOAT64,  -- コアキーワードの平均スコア
  support_score FLOAT64,  -- サポートキーワードの平均スコア
  longtail_score FLOAT64,  -- ロングテールキーワードの平均スコア

  -- 主要キーワード数
  brand_keyword_count INT64,
  core_keyword_count INT64,
  support_keyword_count INT64,
  longtail_keyword_count INT64,
  total_keyword_count INT64,

  -- 順位サマリー
  avg_organic_rank FLOAT64,
  best_organic_rank INT64,
  worst_organic_rank INT64,
  keywords_in_top10 INT64,
  keywords_in_top20 INT64,

  -- キーワード詳細（配列）
  keyword_scores ARRAY<STRUCT<
    keyword STRING,
    role STRING,
    organic_rank INT64,
    rank_score FLOAT64,
    weighted_score FLOAT64
  >>,

  -- SEOレベル判定
  seo_level STRING,  -- HIGH (70+), MID (40-69), LOW (<40)

  -- メタ情報
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY PARSE_DATE('%Y-%m', year_month)
CLUSTER BY product_id
OPTIONS(
  description = 'SEOスコア: 商品×月次のSEO順位スコアとトレンド'
);

-- 最新月のSEOスコアを取得するビュー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.seo_score_latest` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.seo_score_by_product`
WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY year_month DESC) = 1;

-- SEOレベル判定用ビュー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.seo_level_by_product` AS
SELECT
  product_id,
  year_month,
  seo_score,
  seo_score_trend,
  CASE
    WHEN seo_score >= 70 THEN 'HIGH'
    WHEN seo_score >= 40 THEN 'MID'
    ELSE 'LOW'
  END AS seo_level
FROM `${PROJECT_ID}.${DATASET}.seo_score_by_product`
WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY year_month DESC) = 1;

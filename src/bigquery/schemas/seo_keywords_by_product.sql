-- =============================================================================
-- SEOキーワードセットテーブル
-- 商品ごとの主要キーワードセットを管理
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.seo_keywords_by_product` (
  -- キー
  product_id STRING NOT NULL,
  keyword STRING NOT NULL,

  -- 役割分類
  role STRING NOT NULL,  -- brand, core, support, longtail_experiment

  -- 選定フラグ
  selected_flag BOOL DEFAULT FALSE,  -- 現在の主要監視セットに含まれるか

  -- 選定理由
  selection_reason STRING,

  -- スコア情報（選定時点）
  volume_score FLOAT64,
  traffic_score FLOAT64,
  performance_score FLOAT64,  -- 役割に応じたスコア

  -- 順位情報
  organic_rank INT64,
  sponsored_rank INT64,

  -- 検索ボリューム
  search_volume INT64,

  -- 選定日
  selected_at TIMESTAMP,
  deselected_at TIMESTAMP,

  -- メタ情報
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(updated_at)
CLUSTER BY product_id, role, selected_flag
OPTIONS(
  description = 'SEOキーワードセット: 商品ごとの主要監視キーワード'
);

-- 現在の主要キーワードセットを取得するビュー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.seo_keywords_selected` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.seo_keywords_by_product`
WHERE selected_flag = TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY product_id, keyword ORDER BY updated_at DESC) = 1;

-- 商品ごとの主要キーワード構成サマリー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.seo_keywords_summary` AS
SELECT
  product_id,
  COUNTIF(role = 'brand' AND selected_flag) AS brand_count,
  COUNTIF(role = 'core' AND selected_flag) AS core_count,
  COUNTIF(role = 'support' AND selected_flag) AS support_count,
  COUNTIF(role = 'longtail_experiment' AND selected_flag) AS longtail_count,
  COUNTIF(selected_flag) AS total_selected,
  ARRAY_AGG(
    STRUCT(keyword, role, search_volume, organic_rank)
    ORDER BY
      CASE role WHEN 'brand' THEN 1 WHEN 'core' THEN 2 WHEN 'support' THEN 3 ELSE 4 END,
      search_volume DESC
  ) AS keywords_detail
FROM `${PROJECT_ID}.${DATASET}.seo_keywords_by_product`
WHERE selected_flag = TRUE
GROUP BY product_id;

-- =============================================================================
-- 日次キーワード実績テーブル
-- Amazon Ads APIから取得したキーワード別の日次パフォーマンスデータ
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.keyword_stats_daily` (
  -- キー
  date DATE NOT NULL,
  product_id STRING NOT NULL,  -- ASIN
  keyword STRING NOT NULL,
  match_type STRING NOT NULL,  -- EXACT, PHRASE, BROAD

  -- キャンペーン情報
  campaign_id STRING,
  ad_group_id STRING,

  -- パフォーマンス指標
  impressions INT64 NOT NULL DEFAULT 0,
  clicks INT64 NOT NULL DEFAULT 0,
  orders INT64 NOT NULL DEFAULT 0,
  ad_sales_jpy FLOAT64 NOT NULL DEFAULT 0,
  ad_spend_jpy FLOAT64 NOT NULL DEFAULT 0,

  -- 計算指標
  ctr FLOAT64,  -- clicks / impressions
  cvr FLOAT64,  -- orders / clicks
  acos FLOAT64,  -- ad_spend / ad_sales
  cpc FLOAT64,  -- ad_spend / clicks

  -- ランキング情報（取得可能な場合）
  avg_organic_rank FLOAT64,
  avg_sponsored_rank FLOAT64,

  -- メタ情報
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY date
CLUSTER BY product_id, keyword
OPTIONS(
  description = '日次キーワード実績テーブル: キーワード別の日次広告パフォーマンス'
);

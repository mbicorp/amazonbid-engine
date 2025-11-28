-- =============================================================================
-- 日次広告実績テーブル（商品別）
-- Amazon Ads APIから取得した日次広告データを格納
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.daily_ads_by_product` (
  -- キー
  date DATE NOT NULL,
  product_id STRING NOT NULL,  -- ASIN

  -- 広告費用
  ad_spend_jpy FLOAT64 NOT NULL,  -- 広告費（円）

  -- 広告パフォーマンス
  ad_sales_jpy FLOAT64 NOT NULL,  -- 広告経由売上
  ad_impressions INT64,  -- インプレッション数
  ad_clicks INT64,  -- クリック数
  ad_orders INT64,  -- 広告経由注文数

  -- 計算指標
  acos FLOAT64,  -- ACOS = ad_spend / ad_sales
  roas FLOAT64,  -- ROAS = ad_sales / ad_spend
  ctr FLOAT64,  -- CTR = clicks / impressions
  cvr FLOAT64,  -- CVR = orders / clicks
  cpc FLOAT64,  -- CPC = ad_spend / clicks

  -- キャンペーン内訳（オプション）
  sp_spend_jpy FLOAT64,  -- Sponsored Products広告費
  sb_spend_jpy FLOAT64,  -- Sponsored Brands広告費
  sd_spend_jpy FLOAT64,  -- Sponsored Display広告費

  -- データソース
  data_source STRING DEFAULT 'amazon_ads_api',

  -- メタ情報
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY date
CLUSTER BY product_id
OPTIONS(
  description = '日次広告実績テーブル: 商品別の日次広告パフォーマンスデータ'
);

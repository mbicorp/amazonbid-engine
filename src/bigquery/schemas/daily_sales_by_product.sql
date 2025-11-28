-- =============================================================================
-- 日次売上テーブル（商品別）
-- SP-API等から取得した日次売上データを格納
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.daily_sales_by_product` (
  -- キー
  date DATE NOT NULL,
  product_id STRING NOT NULL,  -- ASIN

  -- 売上データ
  revenue_jpy FLOAT64 NOT NULL,  -- 総売上（円）
  units_sold INT64,  -- 販売数量

  -- コストデータ
  cogs_jpy FLOAT64,  -- 売上原価（Cost of Goods Sold）
  fba_fees_jpy FLOAT64,  -- FBA手数料
  referral_fees_jpy FLOAT64,  -- 紹介手数料
  other_fees_jpy FLOAT64,  -- その他手数料

  -- 計算値
  gross_profit_jpy FLOAT64,  -- 粗利益 = revenue - cogs - fees

  -- データソース
  data_source STRING DEFAULT 'sp_api',  -- sp_api, manual, estimated

  -- メタ情報
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY date
CLUSTER BY product_id
OPTIONS(
  description = '日次売上テーブル: 商品別の日次売上とコストデータ'
);

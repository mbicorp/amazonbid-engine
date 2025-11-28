-- =============================================================================
-- 集計済キーワードメトリクス（60日）
-- キーワードの性能評価用集計テーブル
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.keyword_metrics_60d` (
  -- キー
  product_id STRING NOT NULL,
  keyword STRING NOT NULL,

  -- 期間
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- 基本指標（60日累計）
  impressions_60d INT64 NOT NULL DEFAULT 0,
  clicks_60d INT64 NOT NULL DEFAULT 0,
  orders_60d INT64 NOT NULL DEFAULT 0,
  ad_sales_60d FLOAT64 NOT NULL DEFAULT 0,
  ad_spend_60d FLOAT64 NOT NULL DEFAULT 0,

  -- 計算指標
  ctr_60d FLOAT64,  -- clicks / impressions
  cvr_60d FLOAT64,  -- orders / clicks
  acos_60d FLOAT64,  -- ad_spend / ad_sales

  -- 利益計算（profit_marginを適用）
  gross_profit_60d FLOAT64,  -- ad_sales * profit_margin
  net_profit_60d FLOAT64,  -- gross_profit - ad_spend

  -- Jungle Scoutデータ
  search_volume INT64,
  js_relevancy FLOAT64,

  -- 正規化スコア（0-1）
  volume_score FLOAT64,  -- search_volumeの対数正規化
  traffic_score FLOAT64,  -- impressionsの対数正規化
  ctr_score FLOAT64,  -- ctrの正規化（データ十分な場合のみ）
  cvr_score FLOAT64,  -- cvrの正規化（データ十分な場合のみ）
  profit_score FLOAT64,  -- net_profitの正規化（-10000〜+10000 → 0-1）
  semantic_relevance_score FLOAT64,  -- js_relevancy + volume + text_match

  -- text_match_score計算用
  text_match_score FLOAT64,  -- product_core_termsとの一致率

  -- キーワードカテゴリ
  category STRING,  -- brand, core, support, longtail_experiment, other
  word_count INT64,  -- キーワードの単語数

  -- 性能スコア（カテゴリ別に計算方法が異なる）
  performance_core_score FLOAT64,
  performance_support_score FLOAT64,
  performance_longtail_score FLOAT64,

  -- データ十分性フラグ
  has_sufficient_data BOOL,  -- impressions >= 100 AND clicks >= 20

  -- メタ情報
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY period_end
CLUSTER BY product_id, category
OPTIONS(
  description = '集計済キーワードメトリクス: 60日間のパフォーマンスと正規化スコア'
);

-- 最新データのみを取得するビュー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.keyword_metrics_60d_latest` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.keyword_metrics_60d`
WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY product_id, keyword ORDER BY period_end DESC) = 1;

-- =============================================================================
-- 商品戦略テーブル
-- ASIN単位でライフサイクルステージと投資設定を管理
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.product_strategy` (
  -- プライマリキー
  product_id STRING NOT NULL,  -- ASIN

  -- ライフサイクル管理
  lifecycle_stage STRING NOT NULL,  -- LAUNCH_HARD, LAUNCH_SOFT, GROW, HARVEST
  strategy_pattern STRING NOT NULL,  -- launch_hard, launch_soft, grow, harvest

  -- TACOS設定
  sustainable_tacos FLOAT64 NOT NULL,  -- 長期的に許容するTACOS (例: 0.20)
  invest_tacos_cap FLOAT64,  -- 投資フェーズで許容する最大TACOS (例: 0.60)

  -- 投資上限
  invest_max_loss_per_month_jpy INT64,  -- 月次許容赤字上限 (例: 500000)
  invest_max_months_base INT64,  -- 初期の投資期間上限
  invest_max_months_dynamic INT64,  -- 実際に許容している投資期間上限（自動延長）

  -- 投資開始日
  invest_start_date DATE,

  -- 商品情報
  profit_margin FLOAT64 NOT NULL,  -- 粗利率 (例: 0.40)
  unit_price_jpy FLOAT64,  -- 平均販売単価

  -- 再投資設定
  reinvest_allowed BOOL DEFAULT FALSE,  -- GROWからLAUNCH_SOFTへの戻り許可

  -- 商品グループ（将来の拡張用）
  product_group_id STRING,

  -- レビュー情報（セーフティ判定用）
  review_rating FLOAT64,
  review_count INT64,

  -- ブランドキーワード（SEOカテゴリ分類用）
  brand_keywords ARRAY<STRING>,

  -- 主要商品用語（セマンティック関連度計算用）
  product_core_terms ARRAY<STRING>,

  -- メタ情報
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(updated_at)
CLUSTER BY product_id, lifecycle_stage
OPTIONS(
  description = '商品戦略テーブル: ASIN単位のライフサイクルと投資設定を管理'
);

-- インデックス用のビュー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.product_strategy_current` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.product_strategy`
WHERE TRUE
QUALIFY ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY updated_at DESC) = 1;

-- product_config テーブル
-- 商品設定の唯一の正（Single Source of Truth）
-- 人間が編集し、入札エンジンが参照する

CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.product_config` (
  -- 識別子
  asin STRING NOT NULL,                    -- Amazon標準識別番号（主キー）
  product_id STRING,                       -- 内部商品ID（任意）
  sku STRING,                              -- SKU（任意）

  -- 有効フラグ
  is_active BOOL NOT NULL DEFAULT TRUE,    -- 入札エンジンの対象にするか

  -- 収益モデル
  revenue_model STRING NOT NULL DEFAULT 'LTV',
    -- "LTV": リピート購入前提
    -- "SINGLE_PURCHASE": 単発購入前提

  -- ライフサイクル
  lifecycle_state STRING NOT NULL DEFAULT 'GROW',
    -- "LAUNCH_HARD": 投資強化
    -- "LAUNCH_SOFT": 投資継続
    -- "GROW": 成長バランス
    -- "HARVEST": 利益回収

  -- ビジネスモード
  business_mode STRING NOT NULL DEFAULT 'PROFIT',
    -- "PROFIT": 利益優先
    -- "SHARE": シェア優先

  -- カテゴリ・ブランド
  category STRING,                         -- 商品カテゴリ（例: "SUPPLEMENT", "SHOES"）
  brand_type STRING NOT NULL DEFAULT 'GENERIC',
    -- "BRAND": 自社ブランド
    -- "GENERIC": 一般キーワード
    -- "CONQUEST": 競合ブランド攻略

  -- 実験グループ（ABテスト用）
  experiment_group STRING NOT NULL DEFAULT 'CONTROL',
    -- "CONTROL": コントロール群
    -- "VARIANT_A": バリアントA
    -- "VARIANT_B": バリアントB

  -- LTV関連パラメータ
  margin_rate FLOAT64,                     -- 粗利率（例: 0.40 = 40%）
  expected_repeat_orders_assumed FLOAT64 DEFAULT 1.0,
    -- 仮定の期待リピート回数
  expected_repeat_orders_measured_180d FLOAT64,
    -- 180日間の実測リピート回数
  safety_factor_assumed FLOAT64 DEFAULT 0.7,
    -- 仮定期間の安全係数
  safety_factor_measured FLOAT64 DEFAULT 0.85,
    -- 実測期間の安全係数
  launch_date DATE,                        -- 商品発売日
  new_customers_total INT64 DEFAULT 0,     -- 累計新規顧客数

  -- メタ情報
  created_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  -- 主キー
  PRIMARY KEY (asin) NOT ENFORCED
)
CLUSTER BY is_active, lifecycle_state, revenue_model
OPTIONS (
  description = '商品設定マスタ - 入札エンジンの唯一の設定ソース'
);

-- 更新トリガー用のプロシージャ（手動実行用）
-- BigQueryにはトリガーがないため、更新時に手動でupdated_atを更新する
-- MERGE文やUPDATE文で updated_at = CURRENT_DATETIME() を含めること

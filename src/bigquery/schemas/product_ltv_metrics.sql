-- product_ltv_metrics テーブル
-- 商品別のLTV（顧客生涯価値）関連メトリクスを格納
-- 収益モデル（LTV/単発購入）に基づくACOSターゲット計算に使用

CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.product_ltv_metrics` (
  -- 識別子
  asin STRING NOT NULL,                    -- Amazon標準識別番号
  product_id STRING NOT NULL,              -- 内部商品ID

  -- 粗利率
  margin_rate FLOAT64 NOT NULL,            -- 粗利率（例: 0.40 = 40%）

  -- 期待リピート回数
  expected_repeat_orders_assumed FLOAT64 NOT NULL DEFAULT 1.0,
    -- 仮定の期待リピート回数（LTV商品のデフォルト想定値、単発商品は1.0）
  expected_repeat_orders_measured_180d FLOAT64,
    -- 180日間の実測リピート回数（十分なデータがある場合のみ）

  -- 安全係数
  safety_factor_assumed FLOAT64 NOT NULL DEFAULT 0.7,
    -- 仮定期間の安全係数（リスク考慮）
  safety_factor_measured FLOAT64 NOT NULL DEFAULT 0.85,
    -- 実測期間の安全係数（実績ベースなのでやや高め）

  -- 日付情報
  launch_date DATE,                        -- 商品発売日
  new_customers_total INT64 NOT NULL DEFAULT 0,
    -- 累計新規顧客数（LTVモード判定に使用）

  -- 収益モデル
  revenue_model STRING,                    -- "LTV" または "SINGLE_PURCHASE"
    -- NULL の場合はデフォルトで "LTV" として扱う

  -- メタ情報
  last_ltv_updated_at DATETIME,            -- LTVデータ最終更新日時
  created_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  -- 主キー
  PRIMARY KEY (product_id) NOT ENFORCED
)
OPTIONS (
  description = '商品別LTVメトリクス - 収益モデルに基づくACOSターゲット計算用'
);

-- インデックス用のクラスタリング
-- ALTER TABLE `{project_id}.{dataset}.product_ltv_metrics`
-- CLUSTER BY revenue_model, launch_date;

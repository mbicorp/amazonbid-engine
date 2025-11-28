-- product_seo_rank_history テーブル
-- 商品別のSEO検索順位履歴を格納
-- ライフサイクルサジェスト機能で使用

CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.product_seo_rank_history` (
  -- 識別子
  asin STRING NOT NULL,                    -- Amazon標準識別番号

  -- 日付
  date DATE NOT NULL,                      -- 順位計測日

  -- キーワード情報
  keyword_type STRING NOT NULL,            -- "MAIN", "BRAND", "GENERIC"
  category STRING,                         -- 商品カテゴリ（例: "shoes", "supplement"）
  search_keyword STRING NOT NULL,          -- 順位を追っているキーワード

  -- 順位情報
  organic_rank INT64,                      -- オーガニック検索順位（1以上、50以上は圏外扱い可能）

  -- メタ情報
  created_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  -- 複合主キー（ASIN + 日付 + キーワードタイプ）
  PRIMARY KEY (asin, date, keyword_type) NOT ENFORCED
)
PARTITION BY date
CLUSTER BY asin, keyword_type
OPTIONS (
  description = '商品別SEO検索順位履歴 - ライフサイクルサジェスト機能用'
);

-- インデックス用のビュー（直近の順位を取得しやすくする）
-- CREATE OR REPLACE VIEW `{project_id}.{dataset}.product_seo_rank_latest` AS
-- SELECT
--   asin,
--   keyword_type,
--   category,
--   search_keyword,
--   organic_rank,
--   date,
--   created_at
-- FROM (
--   SELECT
--     *,
--     ROW_NUMBER() OVER (PARTITION BY asin, keyword_type ORDER BY date DESC) as rn
--   FROM `{project_id}.{dataset}.product_seo_rank_history`
-- )
-- WHERE rn = 1;

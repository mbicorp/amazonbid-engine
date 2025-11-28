-- =============================================================================
-- keyword_core_candidate_metrics テーブル
-- =============================================================================
-- CORE_SEOキーワード候補のメトリクスとスコアを格納するテーブル
--
-- 用途:
-- - Brand Analytics、Jungle Scout、検索語レポートから取得したデータを統合
-- - computeCoreSeoScore によるスコア計算結果を格納
-- - 上位10語をCORE_SEO候補として提示する際のデータソース
--
-- 更新タイミング:
-- - 日次バッチで更新（検索語レポート反映後）
-- - Brand Analytics更新時（週次）
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.keyword_core_candidate_metrics` (
  -- 識別情報
  profile_id STRING NOT NULL,
  asin STRING NOT NULL,
  keyword STRING NOT NULL,
  match_type STRING NOT NULL,
  marketplace STRING NOT NULL,

  -- 検索ボリューム（Brand Analytics / Jungle Scout由来）
  search_volume_month INT64,
  search_volume_rank INT64,  -- カテゴリ内での検索ボリュームランク

  -- 関連度スコア（0〜1）
  rel_text FLOAT64,   -- 商品テキストとの意味的関連度
  rel_brand FLOAT64,  -- ブランド指名性（0, 0.5, 1）

  -- コンバージョン情報
  conv_share FLOAT64,  -- その検索語での自社コンバージョンシェア（0〜1）

  -- 競合情報
  cpc_percentile FLOAT64,      -- 推奨CPCのカテゴリ内パーセンタイル（0〜1）
  sponsored_slots_norm FLOAT64, -- スポンサー枠の多さ（0〜1正規化）

  -- ブランド成熟度
  brand_search_volume INT64,  -- ブランド名を含む全検索語の月間ボリューム合計

  -- 計算済み正規化値
  vol_norm FLOAT64,   -- 検索ボリューム正規化値（対数スケール、0〜1）
  conv_norm FLOAT64,  -- コンバージョンシェア正規化値（0〜1）
  comp_score FLOAT64, -- 競合度スコア（0〜1）

  -- 最終スコア
  score_core FLOAT64,  -- CORE_SEOスコア（computeCoreSeoScoreの出力）

  -- スコア内訳（デバッグ/分析用）
  score_part_volume FLOAT64,      -- 検索ボリューム寄与
  score_part_text FLOAT64,        -- テキスト関連度寄与
  score_part_brand FLOAT64,       -- ブランド指名性寄与
  score_part_conv FLOAT64,        -- コンバージョンシェア寄与
  score_part_competition FLOAT64, -- 競合度ペナルティ（負値）

  -- CORE_SEO候補としてのステータス
  is_core_candidate BOOL DEFAULT FALSE,  -- スコア/関連度の閾値を満たすか
  core_rank INT64,  -- ASIN内でのCORE候補ランク（1〜10程度）

  -- メタ情報
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
);

-- =============================================================================
-- インデックス（パーティションキー）
-- =============================================================================
-- Note: BigQueryではパーティションとクラスタリングで最適化

-- プライマリキー相当のユニーク制約（BigQueryでは NOT ENFORCED）
-- ALTER TABLE `${PROJECT_ID}.${DATASET}.keyword_core_candidate_metrics`
-- ADD PRIMARY KEY (profile_id, asin, keyword, match_type, marketplace) NOT ENFORCED;

-- =============================================================================
-- コメント
-- =============================================================================
-- このテーブルは以下の2つの関数と連携:
--
-- 1. computeCoreSeoScore (src/metrics/coreSeoScoring.ts)
--    - TypeScript側でスコアを計算
--    - score_core と各 score_part_* を算出
--
-- 2. rankCoreSeoKeywords (src/metrics/coreSeoScoring.ts)
--    - ASIN単位で上位N件のCORE候補を抽出
--    - core_rank を設定
--
-- 将来的には、BigQuery側でもスコア計算を行うビューを追加予定:
-- - v_keyword_core_score: リアルタイムスコア計算ビュー
-- - バッチジョブとの整合性を保ちつつ、即時計算も可能に

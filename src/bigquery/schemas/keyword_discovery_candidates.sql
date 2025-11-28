-- =============================================================================
-- キーワード発見候補テーブル
-- 検索語レポートおよびJungle Scout APIから発見された新規キーワード候補を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.keyword_discovery_candidates` (
  -- 識別情報
  id STRING NOT NULL,                           -- UUID
  asin STRING NOT NULL,                         -- ASIN
  query STRING NOT NULL,                        -- 検索クエリ（キーワード）
  normalized_query STRING NOT NULL,             -- 正規化されたクエリ（比較用）

  -- 推奨情報
  suggested_match_type STRING NOT NULL,         -- 推奨マッチタイプ（EXACT, PHRASE, BROAD）
  source STRING NOT NULL,                       -- データソース（SEARCH_TERM, JUNGLE_SCOUT, BOTH）
  score FLOAT64 NOT NULL,                       -- 総合スコア（0-100）

  -- 検索語由来の指標（7日間）
  impressions_7d INT64,                         -- 表示回数
  clicks_7d INT64,                              -- クリック数
  orders_7d INT64,                              -- 注文数
  sales_7d FLOAT64,                             -- 売上
  cost_7d FLOAT64,                              -- 広告費
  acos_7d FLOAT64,                              -- ACOS
  cvr_7d FLOAT64,                               -- CVR
  cpc_7d FLOAT64,                               -- CPC

  -- Jungle Scout由来の指標
  js_search_volume_exact INT64,                 -- 月間検索ボリューム（EXACT）
  js_search_volume_broad INT64,                 -- 月間検索ボリューム（BROAD）
  js_competition_score FLOAT64,                 -- 競合スコア（0-100）
  js_ease_of_ranking_score FLOAT64,             -- ランキング難易度（0-100）
  js_relevancy_score FLOAT64,                   -- 関連度スコア（0-100）
  js_suggested_bid_low FLOAT64,                 -- 推奨入札額（下限）
  js_suggested_bid_high FLOAT64,                -- 推奨入札額（上限）
  js_trending_direction STRING,                 -- トレンド方向（up, down, flat）
  js_trending_percentage FLOAT64,               -- トレンド変化率（%）
  js_fetched_at TIMESTAMP,                      -- Jungle Scoutデータ取得日時

  -- スコア内訳
  score_search_term FLOAT64 NOT NULL,           -- 検索語由来スコア（0-100）
  score_jungle_scout FLOAT64 NOT NULL,          -- Jungle Scout由来スコア（0-100）
  weight_search_term FLOAT64 NOT NULL,          -- 検索語スコアの重み
  weight_jungle_scout FLOAT64 NOT NULL,         -- Jungle Scoutスコアの重み

  -- ステータス
  state STRING NOT NULL,                        -- PENDING_REVIEW, APPROVED, REJECTED, APPLIED

  -- メタ情報
  profile_id STRING,                            -- プロファイルID
  campaign_id STRING,                           -- 発見元キャンペーンID
  ad_group_id STRING,                           -- 発見元広告グループID
  discovered_at TIMESTAMP NOT NULL,             -- 発見日時
  updated_at TIMESTAMP NOT NULL,                -- 最終更新日時

  -- 承認フロー情報
  approved_at TIMESTAMP,                        -- 承認日時
  approved_by STRING,                           -- 承認者
  rejected_at TIMESTAMP,                        -- 却下日時
  rejected_by STRING,                           -- 却下者
  rejection_reason STRING,                      -- 却下理由
  applied_at TIMESTAMP                          -- 適用日時
)
PARTITION BY DATE(discovered_at)
CLUSTER BY asin, state, source
OPTIONS (
  description = 'キーワード発見候補テーブル - 検索語レポートおよびJungle Scout APIから発見された新規キーワード候補',
  labels = [("module", "keyword_discovery"), ("phase", "one")]
);

-- =============================================================================
-- インデックス用ビュー: レビュー待ち候補（スコア降順）
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.v_keyword_discovery_pending_review` AS
SELECT
  id,
  asin,
  query,
  suggested_match_type,
  source,
  score,
  impressions_7d,
  clicks_7d,
  orders_7d,
  acos_7d,
  cvr_7d,
  js_search_volume_exact,
  js_competition_score,
  discovered_at
FROM `${PROJECT_ID}.${DATASET}.keyword_discovery_candidates`
WHERE state = 'PENDING_REVIEW'
ORDER BY score DESC;

-- =============================================================================
-- コメント
-- =============================================================================
-- このテーブルは、キーワード自動発見機能で発見された候補を保存します。
--
-- 状態管理:
-- - PENDING_REVIEW: 初期状態。人間がレビューするまでこの状態。
-- - APPROVED: 承認済み。将来のAPPLYフェーズで自動登録される対象。
-- - REJECTED: 却下。このキーワードは今後も候補として表示しない。
-- - APPLIED: キャンペーンに適用済み。
--
-- データソース:
-- - SEARCH_TERM: Amazon検索語レポートから発見
-- - JUNGLE_SCOUT: Jungle Scout APIから発見（フェーズ二で本番利用）
-- - BOTH: 両方のソースで発見
--
-- 使用例:
-- -- レビュー待ち候補を上位から取得
-- SELECT * FROM `${PROJECT_ID}.${DATASET}.v_keyword_discovery_pending_review`
-- WHERE asin = 'B0XXXXXXXXX'
-- LIMIT 100;
--
-- -- 特定のASINの承認済み候補を取得
-- SELECT * FROM `${PROJECT_ID}.${DATASET}.keyword_discovery_candidates`
-- WHERE asin = 'B0XXXXXXXXX' AND state = 'APPROVED';

-- =============================================================================
-- ネガティブキーワード候補テーブル
-- SHADOW モードで生成されたネガティブキーワード候補を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.negative_keyword_suggestions` (
  -- プライマリキー
  suggestion_id STRING NOT NULL,  -- UUID

  -- 実行情報
  execution_id STRING NOT NULL,   -- 実行IDとの紐付け
  execution_mode STRING NOT NULL, -- "SHADOW" or "APPLY"

  -- 対象識別子
  profile_id STRING,              -- Amazon Ads プロファイルID
  campaign_id STRING,             -- キャンペーンID（適用時に必要）
  ad_group_id STRING,             -- 広告グループID（適用時に必要）
  asin STRING NOT NULL,
  query STRING NOT NULL,
  match_type STRING NOT NULL,     -- "AUTO", "PHRASE", "EXACT"
  intent_cluster_id STRING,       -- クラスタID（NULL許容）

  -- キーワードの役割
  role STRING NOT NULL,           -- "GENERIC", "BRAND_OWN", "BRAND_CONQUEST", "OTHER"

  -- 30日パフォーマンス指標
  clicks_30d INT64 NOT NULL,
  conversions_30d INT64 NOT NULL,
  cost_30d NUMERIC NOT NULL,
  cpc_30d NUMERIC,
  cvr_30d NUMERIC,
  acos_30d NUMERIC,

  -- クラスタ単位の指標（オプション）
  cluster_clicks_30d INT64,
  cluster_conversions_30d INT64,
  cluster_cost_30d NUMERIC,
  cluster_cvr_30d NUMERIC,

  -- ベースライン情報
  baseline_asin_cvr_30d NUMERIC NOT NULL,  -- ASIN全体のベースラインCVR

  -- 統計的判定情報
  required_clicks INT64 NOT NULL,          -- ルールオブスリーによる必要クリック数
  min_clicks_by_role INT64 NOT NULL,       -- role別の最小クリック数閾値

  -- 理由コード（複数可）
  reason_codes ARRAY<STRING> NOT NULL,     -- ["NG_NO_CONVERSION", "NG_WASTED_SPEND", etc.]
  reason_detail STRING,                    -- 詳細説明

  -- 適用状態
  is_applied BOOL NOT NULL DEFAULT FALSE,  -- ネガティブ登録されたか
  applied_at TIMESTAMP,                    -- 適用日時
  apply_error STRING,                      -- 適用時エラー

  -- ライフサイクル情報（判定時点）
  lifecycle_state STRING,                  -- "LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"

  -- 承認フロー情報
  status STRING NOT NULL DEFAULT 'PENDING',  -- "PENDING", "APPROVED", "REJECTED", "APPLIED"
  approved_at TIMESTAMP,                      -- 承認日時
  approved_by STRING,                         -- 承認者
  rejected_at TIMESTAMP,                      -- 却下日時
  rejected_by STRING,                         -- 却下者
  rejection_reason STRING,                    -- 却下理由

  -- メタ情報
  suggested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(suggested_at)
CLUSTER BY asin, role, is_applied
OPTIONS(
  description = 'ネガティブキーワード候補: SHADOWモードで検出されたネガティブ候補を保存'
);

-- =============================================================================
-- インデックス用ビュー
-- =============================================================================

-- 未適用の候補のみを取得するビュー（PENDING ステータス）
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.negative_keyword_suggestions_pending` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.negative_keyword_suggestions`
WHERE status = 'PENDING'
  AND suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY);

-- 承認済みの候補を取得するビュー（APPROVED ステータス、未適用）
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.negative_keyword_suggestions_approved` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.negative_keyword_suggestions`
WHERE status = 'APPROVED'
  AND is_applied = FALSE
  AND suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY);

-- ASIN別の候補サマリービュー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.negative_keyword_suggestions_summary` AS
SELECT
  asin,
  COUNT(*) AS total_candidates,
  SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
  SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved_count,
  SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count,
  SUM(CASE WHEN status = 'APPLIED' OR is_applied THEN 1 ELSE 0 END) AS applied_count,
  SUM(cost_30d) AS total_wasted_cost_30d,
  ARRAY_AGG(DISTINCT role) AS roles,
  MAX(suggested_at) AS last_suggested_at
FROM `${PROJECT_ID}.${DATASET}.negative_keyword_suggestions`
WHERE suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY asin;

-- =============================================================================
-- コメント
-- =============================================================================
-- このテーブルは computeNegativeKeywordCandidates 関数によって生成された
-- ネガティブキーワード候補を保存します。
--
-- reason_codes の値:
-- - "NG_NO_CONVERSION": CVR=0 かつクリック数がしきい値超え
-- - "NG_WASTED_SPEND": CPCが全体より高く、コストがかさみ過ぎ
-- - "NG_CLUSTER_NO_CONVERSION": クラスタ単位でCVR=0
-- - "NG_INTENT_MISMATCH": 検索意図が商品と不一致
--
-- 現時点ではSHADOWモード専用で、自動でのネガティブ登録は行いません。

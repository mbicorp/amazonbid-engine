-- =============================================================================
-- AUTO→EXACT 昇格候補テーブル
-- SHADOW モードで生成された AUTO→EXACT キーワード昇格候補を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions` (
  -- プライマリキー
  suggestion_id STRING NOT NULL,  -- UUID

  -- 実行情報
  execution_id STRING NOT NULL,   -- 実行IDとの紐付け
  mode STRING NOT NULL,           -- "SHADOW" 固定（将来 "APPLY" 対応予定）

  -- プロファイル・対象識別子
  profile_id STRING NOT NULL,     -- Amazon Ads プロファイルID
  asin STRING NOT NULL,
  search_term STRING NOT NULL,    -- 昇格対象の検索語
  match_type STRING NOT NULL,     -- "EXACT" 固定

  -- AUTO キャンペーン情報（元のキャンペーン）
  campaign_id_auto STRING NOT NULL,
  ad_group_id_auto STRING NOT NULL,

  -- ターゲット MANUAL キャンペーン情報（昇格先）
  campaign_id_manual_target STRING,   -- NULL の場合は割り当て未定
  ad_group_id_manual_target STRING,

  -- クラスタ情報
  intent_cluster_id STRING,           -- 検索意図クラスタID
  intent_cluster_label STRING,        -- 検索意図クラスタラベル

  -- ルックバック期間
  lookback_days INT64 NOT NULL,       -- 通常 30

  -- 検索語パフォーマンス指標（30日）
  clicks INT64 NOT NULL,
  impressions INT64 NOT NULL,
  orders INT64 NOT NULL,
  sales NUMERIC NOT NULL,
  cost NUMERIC NOT NULL,
  cvr NUMERIC NOT NULL,               -- コンバージョン率
  acos NUMERIC NOT NULL,              -- 広告費売上比率

  -- クラスタパフォーマンス
  cluster_clicks INT64,
  cluster_cvr NUMERIC,

  -- 基準値
  asin_baseline_cvr NUMERIC NOT NULL,         -- ASIN単位のベースラインCVR
  portfolio_baseline_cvr NUMERIC NOT NULL,    -- ポートフォリオベースラインCVR
  effective_baseline_cvr NUMERIC NOT NULL,    -- 有効ベースラインCVR（max(asin, portfolio)）
  target_acos NUMERIC NOT NULL,               -- 目標ACOS

  -- 判定情報
  score NUMERIC NOT NULL,             -- 昇格優先度スコア（cvr / (acos / target_acos)）
  reason_codes ARRAY<STRING> NOT NULL,  -- ["HIGH_CVR", "LOW_ACOS", "CLUSTER_PERFORMER", etc.]
  reason_detail STRING,               -- 詳細説明

  -- ライフサイクル情報（判定時点）
  lifecycle_state STRING NOT NULL,    -- "LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"

  -- 承認フロー情報
  status STRING NOT NULL DEFAULT 'PENDING',  -- "PENDING", "APPROVED", "REJECTED", "APPLIED"
  approved_at TIMESTAMP,              -- 承認日時
  approved_by STRING,                 -- 承認者
  rejected_at TIMESTAMP,              -- 却下日時
  rejected_by STRING,                 -- 却下者
  rejection_reason STRING,            -- 却下理由

  -- 適用状態
  is_applied BOOL NOT NULL DEFAULT FALSE,  -- Amazon Ads に適用されたか
  applied_at TIMESTAMP,               -- 適用日時
  apply_error STRING,                 -- 適用時エラー

  -- メタ情報
  suggested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(suggested_at)
CLUSTER BY asin, lifecycle_state, status
OPTIONS(
  description = 'AUTO→EXACT昇格候補: SHADOWモードで検出されたEXACTキーワード昇格候補を保存'
);

-- =============================================================================
-- インデックス用ビュー
-- =============================================================================

-- 未処理の候補のみを取得するビュー（PENDING ステータス）
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions_pending` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions`
WHERE status = 'PENDING'
  AND suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
ORDER BY score DESC;

-- 承認済みの候補を取得するビュー（APPROVED ステータス、未適用）
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions_approved` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions`
WHERE status = 'APPROVED'
  AND is_applied = FALSE
  AND suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
ORDER BY score DESC;

-- ASIN別の候補サマリービュー
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions_summary` AS
SELECT
  asin,
  lifecycle_state,
  COUNT(*) AS total_candidates,
  SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
  SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved_count,
  SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count,
  SUM(CASE WHEN status = 'APPLIED' OR is_applied THEN 1 ELSE 0 END) AS applied_count,
  AVG(cvr) AS avg_cvr,
  AVG(acos) AS avg_acos,
  AVG(score) AS avg_score,
  SUM(orders) AS total_orders,
  SUM(sales) AS total_sales,
  MAX(suggested_at) AS last_suggested_at
FROM `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions`
WHERE suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY asin, lifecycle_state;

-- トップスコア候補を取得するビュー（上位100件）
CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions_top` AS
SELECT *
FROM `${PROJECT_ID}.${DATASET}.auto_exact_promotion_suggestions`
WHERE status = 'PENDING'
  AND suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
ORDER BY score DESC
LIMIT 100;

-- =============================================================================
-- コメント
-- =============================================================================
-- このテーブルは computeAutoExactPromotionCandidates 関数によって生成された
-- AUTO→EXACT キーワード昇格候補を保存します。
--
-- reason_codes の値:
-- - "HIGH_CVR": CVR が基準を大きく上回る
-- - "LOW_ACOS": ACOS が目標を大きく下回る
-- - "HIGH_VOLUME": クリック数・注文数が十分
-- - "CLUSTER_PERFORMER": クラスタ内で特に優秀
-- - "LIFECYCLE_BOOST": ライフサイクル緩和による昇格
--
-- 昇格優先度スコア計算:
-- score = cvr / (acos / target_acos)
-- CVR が高く、ACOS が低いほど高スコア
--
-- 現時点ではSHADOWモード専用で、Amazon Ads API への自動登録は行いません。
-- 将来 APPLY モードを追加し、APPROVED 状態の候補を自動適用予定。

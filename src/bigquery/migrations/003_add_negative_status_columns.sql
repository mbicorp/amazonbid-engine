-- Migration: negative_keyword_suggestions テーブルにステータス・承認フロー用カラムを追加
-- 実行日: 2025-01-XX
--
-- このマイグレーションにより、ネガティブキーワード候補の承認フロー管理が可能になります。
-- ステータス: PENDING → APPROVED/REJECTED → APPLIED
--
-- 既存のレコードは全て status = 'PENDING' に設定されます。

-- ステータスカラムの追加
ALTER TABLE `{project_id}.{dataset}.negative_keyword_suggestions`
ADD COLUMN IF NOT EXISTS status STRING DEFAULT 'PENDING'
OPTIONS(description = 'ステータス: PENDING（未処理）, APPROVED（承認済）, REJECTED（却下）, APPLIED（適用済）');

-- 承認情報カラムの追加
ALTER TABLE `{project_id}.{dataset}.negative_keyword_suggestions`
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP
OPTIONS(description = '承認日時');

ALTER TABLE `{project_id}.{dataset}.negative_keyword_suggestions`
ADD COLUMN IF NOT EXISTS approved_by STRING
OPTIONS(description = '承認者');

-- 却下情報カラムの追加
ALTER TABLE `{project_id}.{dataset}.negative_keyword_suggestions`
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP
OPTIONS(description = '却下日時');

ALTER TABLE `{project_id}.{dataset}.negative_keyword_suggestions`
ADD COLUMN IF NOT EXISTS rejected_by STRING
OPTIONS(description = '却下者');

ALTER TABLE `{project_id}.{dataset}.negative_keyword_suggestions`
ADD COLUMN IF NOT EXISTS rejection_reason STRING
OPTIONS(description = '却下理由');

-- 既存レコードのステータスを設定
-- is_applied = TRUE のレコードは APPLIED、それ以外は PENDING
UPDATE `{project_id}.{dataset}.negative_keyword_suggestions`
SET status = CASE
  WHEN is_applied = TRUE THEN 'APPLIED'
  ELSE 'PENDING'
END
WHERE status IS NULL;

-- 承認済み候補ビューの作成
CREATE OR REPLACE VIEW `{project_id}.{dataset}.negative_keyword_suggestions_approved` AS
SELECT *
FROM `{project_id}.{dataset}.negative_keyword_suggestions`
WHERE status = 'APPROVED'
  AND is_applied = FALSE
  AND suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY);

-- pending ビューの更新（status ベースに変更）
CREATE OR REPLACE VIEW `{project_id}.{dataset}.negative_keyword_suggestions_pending` AS
SELECT *
FROM `{project_id}.{dataset}.negative_keyword_suggestions`
WHERE status = 'PENDING'
  AND suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY);

-- サマリービューの更新（ステータス別集計を追加）
CREATE OR REPLACE VIEW `{project_id}.{dataset}.negative_keyword_suggestions_summary` AS
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
FROM `{project_id}.{dataset}.negative_keyword_suggestions`
WHERE suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY asin;

-- 承認フロー監査用ビュー
CREATE OR REPLACE VIEW `{project_id}.{dataset}.negative_keyword_approval_audit` AS
SELECT
  suggestion_id,
  asin,
  query,
  role,
  status,
  cost_30d,
  reason_codes,
  suggested_at,
  approved_at,
  approved_by,
  rejected_at,
  rejected_by,
  rejection_reason,
  applied_at,
  TIMESTAMP_DIFF(
    COALESCE(approved_at, rejected_at),
    suggested_at,
    HOUR
  ) AS hours_to_decision
FROM `{project_id}.{dataset}.negative_keyword_suggestions`
WHERE status IN ('APPROVED', 'REJECTED', 'APPLIED')
ORDER BY COALESCE(approved_at, rejected_at) DESC;

-- =============================================================================
-- 季節性予測テーブル
-- Jungle Scout検索ボリューム履歴とカテゴリヒントに基づく季節性予測を保存
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.seasonality_predictions` (
  -- 識別情報
  keyword STRING NOT NULL,                        -- 検索キーワード
  asin STRING,                                    -- ASIN（オプション）

  -- ピーク情報（JSON配列）
  -- 例: [{"month": 1, "confidence": 0.85}, {"month": 5, "confidence": 0.75}]
  predicted_peaks STRING NOT NULL,                -- JSON: Array<{month, confidence, fromCategoryHint, volumeMultiplier}>

  -- 現在の調整状態
  current_multiplier FLOAT64 NOT NULL,            -- 現在の入札倍率（1.0 = 調整なし）
  is_pre_peak_period BOOL NOT NULL,               -- Pre-peak期間中か
  days_until_peak INT64,                          -- 次のピークまでの日数（nullの場合はピークなし）

  -- データソース情報
  category_hint STRING,                           -- 使用されたカテゴリヒント（diet, immune等）
  data_source STRING NOT NULL,                    -- JS_ONLY, CATEGORY_HINT, COMBINED
  confidence_score FLOAT64 NOT NULL,              -- 総合信頼度スコア（0-1）

  -- 月別統計データ（JSON配列）
  -- 例: [{"month": 1, "avgVolume": 10000, "stdDev": 2000, "sampleCount": 2}]
  monthly_stats STRING,                           -- JSON: Array<MonthlyVolumeStats>
  baseline_volume FLOAT64,                        -- ベースライン検索ボリューム

  -- 調整理由
  adjustment_reason STRING NOT NULL,              -- 人間が読める調整理由

  -- メタ情報
  generated_at TIMESTAMP NOT NULL,                -- 予測生成日時
  expires_at TIMESTAMP NOT NULL,                  -- 予測有効期限
  last_updated TIMESTAMP NOT NULL                 -- 最終更新日時
)
PARTITION BY DATE(generated_at)
CLUSTER BY keyword, asin, data_source
OPTIONS (
  description = '季節性予測テーブル - キーワードの季節的なピークと入札調整情報',
  labels = [("module", "seasonality"), ("phase", "one")]
);

-- =============================================================================
-- インデックス用ビュー: アクティブな調整（Pre-peak期間中のキーワード）
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.v_seasonality_active_adjustments` AS
SELECT
  keyword,
  asin,
  current_multiplier,
  days_until_peak,
  confidence_score,
  category_hint,
  data_source,
  adjustment_reason,
  generated_at,
  expires_at
FROM `${PROJECT_ID}.${DATASET}.seasonality_predictions`
WHERE
  is_pre_peak_period = TRUE
  AND current_multiplier > 1.0
  AND expires_at > CURRENT_TIMESTAMP()
ORDER BY current_multiplier DESC;

-- =============================================================================
-- インデックス用ビュー: 信頼度の高い予測
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.v_seasonality_high_confidence` AS
SELECT
  keyword,
  asin,
  predicted_peaks,
  current_multiplier,
  is_pre_peak_period,
  days_until_peak,
  confidence_score,
  data_source,
  adjustment_reason,
  generated_at
FROM `${PROJECT_ID}.${DATASET}.seasonality_predictions`
WHERE
  confidence_score >= 0.6
  AND expires_at > CURRENT_TIMESTAMP()
ORDER BY confidence_score DESC;

-- =============================================================================
-- インデックス用ビュー: 期限切れ予測（クリーンアップ用）
-- =============================================================================

CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.v_seasonality_expired` AS
SELECT
  keyword,
  asin,
  generated_at,
  expires_at
FROM `${PROJECT_ID}.${DATASET}.seasonality_predictions`
WHERE expires_at <= CURRENT_TIMESTAMP();

-- =============================================================================
-- 季節性調整ログテーブル
-- 実際に適用された（またはSHADOWモードでログされた）調整を記録
-- =============================================================================

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.seasonality_adjustment_log` (
  -- 識別情報
  log_id STRING NOT NULL,                         -- UUID
  keyword STRING NOT NULL,                        -- キーワード
  asin STRING,                                    -- ASIN

  -- 調整情報
  mode STRING NOT NULL,                           -- SHADOW / APPLY
  original_bid FLOAT64 NOT NULL,                  -- 元の推奨入札額
  adjusted_bid FLOAT64 NOT NULL,                  -- 調整後の入札額
  multiplier FLOAT64 NOT NULL,                    -- 適用された倍率
  applied BOOL NOT NULL,                          -- 実際に適用されたか

  -- キャップ情報
  capped_by_max_bid BOOL NOT NULL,                -- maxBidで制限されたか
  capped_by_ltv BOOL NOT NULL,                    -- LTVで制限されたか
  capped_by_inventory BOOL NOT NULL,              -- 在庫で制限されたか

  -- 予測情報
  days_until_peak INT64,                          -- ピークまでの日数
  confidence_score FLOAT64,                       -- 予測の信頼度
  data_source STRING,                             -- データソース

  -- 理由
  reason STRING NOT NULL,                         -- 調整理由

  -- メタ情報
  created_at TIMESTAMP NOT NULL                   -- ログ作成日時
)
PARTITION BY DATE(created_at)
CLUSTER BY keyword, mode, applied
OPTIONS (
  description = '季節性調整ログ - 入札調整の履歴を記録',
  labels = [("module", "seasonality"), ("phase", "one")]
);

-- =============================================================================
-- コメント
-- =============================================================================
-- このテーブル群は、季節性予測による先行入札調整機能で使用されます。
--
-- seasonality_predictions:
--   - キーワードごとの季節性予測を保存
--   - ピーク月、信頼度、現在の調整倍率などを記録
--   - 定期的に更新され、有効期限を持つ
--
-- seasonality_adjustment_log:
--   - 実際の入札調整（またはSHADOWモードでの計算結果）を記録
--   - 分析と監査のために使用
--
-- データソース:
--   - JS_ONLY: Jungle Scoutの履歴データのみ
--   - CATEGORY_HINT: カテゴリヒントのみ（JSデータ不足時）
--   - COMBINED: 両方のソースを統合
--
-- 使用例:
-- -- アクティブな調整を確認
-- SELECT * FROM `${PROJECT_ID}.${DATASET}.v_seasonality_active_adjustments`
-- WHERE asin = 'B0XXXXXXXXX';
--
-- -- 調整ログを分析（SHADOW vs APPLY）
-- SELECT
--   mode,
--   COUNT(*) as count,
--   AVG(multiplier) as avg_multiplier,
--   AVG(adjusted_bid - original_bid) as avg_bid_increase
-- FROM `${PROJECT_ID}.${DATASET}.seasonality_adjustment_log`
-- WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
-- GROUP BY mode;

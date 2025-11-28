-- keyword_recommendations_log テーブル
-- キーワードごとの入札推奨ログ（詳細レベル）
-- 各キーワードの入札変更推奨と実際の適用結果を記録

CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.keyword_recommendations_log` (
  -- 実行リンク
  execution_id STRING NOT NULL,           -- executions.execution_idへの参照

  -- 対象識別子
  asin STRING NOT NULL,                   -- Amazon標準識別番号
  keyword_id STRING,                      -- Amazon Ads キーワードID
  keyword_text STRING NOT NULL,           -- キーワード文字列
  match_type STRING,                      -- マッチタイプ（EXACT, PHRASE, BROAD）
  campaign_id STRING,                     -- キャンペーンID
  ad_group_id STRING,                     -- 広告グループID

  -- 入札額
  old_bid FLOAT64 NOT NULL,               -- 変更前入札額
  new_bid FLOAT64 NOT NULL,               -- 推奨入札額
  bid_change FLOAT64,                     -- 変更幅（new_bid - old_bid）
  bid_change_percent FLOAT64,             -- 変更率（(new_bid - old_bid) / old_bid * 100）

  -- ACOS関連
  target_acos FLOAT64,                    -- 目標ACOS
  current_acos FLOAT64,                   -- 現在のACOS
  acos_gap FLOAT64,                       -- ACOSギャップ（current - target）

  -- 判定理由
  reason_code STRING NOT NULL,            -- 変更理由コード
    -- "ACOS_HIGH": ACOSが目標より高い
    -- "ACOS_LOW": ACOSが目標より低い（機会損失）
    -- "NO_CONVERSION": コンバージョンなし
    -- "LOW_IMPRESSIONS": インプレッション不足
    -- "ORGANIC_STRONG": オーガニック順位強い
    -- "ORGANIC_WEAK": オーガニック順位弱い
    -- "LIFECYCLE_LAUNCH": ローンチ期投資
    -- "LIFECYCLE_HARVEST": 収穫期抑制
    -- "NO_CHANGE": 変更不要
    -- "BUDGET_CAP": 予算上限
    -- "MIN_BID": 最低入札額制限
    -- "MAX_BID": 最高入札額制限
  reason_detail STRING,                   -- 変更理由の詳細説明

  -- コンテキスト情報
  lifecycle_state STRING,                 -- ライフサイクル状態
  revenue_model STRING,                   -- 収益モデル（LTV/SINGLE_PURCHASE）
  ltv_mode STRING,                        -- LTVモード（ASSUMED/MEASURED/MATURE）
  business_mode STRING,                   -- ビジネスモード（PROFIT/SHARE）
  brand_type STRING,                      -- ブランドタイプ
  experiment_group STRING,                -- 実験グループ

  -- SEO情報
  seo_rank_current INT64,                 -- 現在のオーガニック順位
  seo_rank_trend FLOAT64,                 -- 順位トレンド
  seo_rank_zone STRING,                   -- 順位ゾーン

  -- パフォーマンスメトリクス
  impressions_7d INT64,                   -- 過去7日のインプレッション
  clicks_7d INT64,                        -- 過去7日のクリック
  conversions_7d INT64,                   -- 過去7日のコンバージョン
  spend_7d FLOAT64,                       -- 過去7日の広告費
  sales_7d FLOAT64,                       -- 過去7日の売上
  ctr_7d FLOAT64,                         -- CTR
  cvr_7d FLOAT64,                         -- CVR

  -- ガードレール情報（ログ用）
  -- guardrails_mode によって動作が変わる:
  -- - OFF: ガードレール計算をスキップ
  -- - SHADOW: 計算するがログのみ（new_bid = raw_new_bid）
  -- - ENFORCE: 計算結果を実際に適用（new_bid = guarded_new_bid）
  raw_new_bid FLOAT64,                    -- 入札ロジックが計算した生の推奨値（ガードレール適用前）
  guarded_new_bid FLOAT64,                -- ガードレール適用後の値
  was_guard_clamped BOOL,                 -- ガードでクリップされたかどうか
  guard_clamp_reason STRING,              -- クランプ理由
  guardrails_min_bid FLOAT64,             -- ガードレールの min_bid
  guardrails_max_bid FLOAT64,             -- ガードレールの max_bid
  guardrails_auto_data_source STRING,     -- データソース（HISTORICAL/THEORETICAL/FALLBACK）
  guardrails_mode STRING,                 -- ガードレールモード（OFF/SHADOW/ENFORCE）
  guardrails_applied BOOL,                -- ガードレールが実際に new_bid に適用されたか（ENFORCE かつ was_guard_clamped）

  -- 在庫ガード情報（ログ用）
  days_of_inventory FLOAT64,              -- 在庫日数
  inventory_risk_status STRING,           -- 在庫リスクステータス（OUT_OF_STOCK/LOW_STOCK/NORMAL/UNKNOWN）
  inventory_guard_applied BOOL,           -- 在庫ガードが適用されたかどうか
  inventory_guard_type STRING,            -- 在庫ガードの種類（HARD_KILL/SOFT_THROTTLE/NONE）
  inventory_guard_reason STRING,          -- 在庫ガード適用理由

  -- 適用状態
  is_applied BOOL NOT NULL DEFAULT FALSE, -- 実際に適用されたか（SHADOWでは常にFALSE）
  applied_at DATETIME,                    -- 適用時刻（適用された場合）
  apply_error STRING,                     -- 適用エラー（エラー発生時）

  -- APPLY フィルタリング情報
  is_apply_candidate BOOL,                -- APPLY候補かどうか（allowlistに含まれ、変更幅がしきい値以上）
  apply_skip_reason STRING,               -- APPLYスキップ理由
    -- "SHADOW_MODE": SHADOWモードのためスキップ
    -- "NOT_IN_ALLOWLIST": キャンペーンがallowlistに含まれていない
    -- "APPLY_LIMIT_REACHED": max_apply_changes_per_run の上限に達した
    -- "NO_SIGNIFICANT_CHANGE": 変更幅が閾値未満
    -- "API_ERROR": API呼び出しエラー

  -- メタ情報
  recommended_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  -- 主キー（複合）
  PRIMARY KEY (execution_id, asin, keyword_text) NOT ENFORCED
)
PARTITION BY DATE(recommended_at)
CLUSTER BY execution_id, asin, reason_code
OPTIONS (
  description = 'キーワード入札推奨ログ - 詳細レベルの推奨記録',
  partition_expiration_days = 365
);

-- 分析用ビュー: 日別推奨サマリー
CREATE OR REPLACE VIEW `{project_id}.{dataset}.keyword_recommendations_daily_summary` AS
SELECT
  DATE(recommended_at) as date,
  COUNT(*) as total_recommendations,
  COUNTIF(is_applied) as applied_count,
  COUNTIF(NOT is_applied) as not_applied_count,
  COUNTIF(bid_change > 0) as bid_increase_count,
  COUNTIF(bid_change < 0) as bid_decrease_count,
  COUNTIF(bid_change = 0) as bid_unchanged_count,
  AVG(ABS(bid_change_percent)) as avg_bid_change_percent,
  reason_code,
  COUNT(*) as reason_count
FROM `{project_id}.{dataset}.keyword_recommendations_log`
GROUP BY DATE(recommended_at), reason_code
ORDER BY date DESC, reason_count DESC;

-- 分析用ビュー: 商品別推奨サマリー
CREATE OR REPLACE VIEW `{project_id}.{dataset}.keyword_recommendations_by_product` AS
SELECT
  asin,
  DATE(recommended_at) as date,
  COUNT(*) as total_recommendations,
  COUNTIF(is_applied) as applied_count,
  SUM(CASE WHEN bid_change > 0 THEN bid_change ELSE 0 END) as total_bid_increase,
  SUM(CASE WHEN bid_change < 0 THEN ABS(bid_change) ELSE 0 END) as total_bid_decrease,
  AVG(target_acos) as avg_target_acos,
  AVG(current_acos) as avg_current_acos
FROM `{project_id}.{dataset}.keyword_recommendations_log`
GROUP BY asin, DATE(recommended_at)
ORDER BY date DESC, total_recommendations DESC;

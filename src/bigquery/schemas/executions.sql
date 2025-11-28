-- executions テーブル
-- 入札エンジン実行ログ（ジョブレベル）
-- 各実行のメタデータと統計を記録

CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.executions` (
  -- 実行識別子
  execution_id STRING NOT NULL,           -- UUID形式の実行ID

  -- 実行時刻
  started_at DATETIME NOT NULL,           -- 実行開始時刻
  finished_at DATETIME,                   -- 実行終了時刻（実行中はNULL）

  -- 実行モード
  mode STRING NOT NULL,                   -- "APPLY" または "SHADOW"

  -- 実行ステータス
  status STRING NOT NULL DEFAULT 'RUNNING',
    -- "RUNNING": 実行中
    -- "SUCCESS": 正常終了
    -- "ERROR": エラー終了
    -- "PARTIAL_ERROR": 一部エラー

  -- 処理対象統計
  total_products_count INT64 DEFAULT 0,   -- 対象商品数
  total_keywords_count INT64 DEFAULT 0,   -- 対象キーワード数

  -- 処理結果統計
  recommendations_count INT64 DEFAULT 0,  -- 推奨変更件数
  applied_count INT64 DEFAULT 0,          -- 実際に適用した件数（SHADOWでは0）
  skipped_count INT64 DEFAULT 0,          -- スキップした件数
  error_count INT64 DEFAULT 0,            -- エラー件数

  -- 変更サマリー
  bid_increases_count INT64 DEFAULT 0,    -- 入札額上昇件数
  bid_decreases_count INT64 DEFAULT 0,    -- 入札額下降件数
  bid_unchanged_count INT64 DEFAULT 0,    -- 入札額変更なし件数

  -- エラー情報
  error_message STRING,                   -- エラーメッセージ（エラー時のみ）
  error_stack STRING,                     -- エラースタック（エラー時のみ）

  -- 実行環境
  trigger_source STRING,                  -- トリガー元（"SCHEDULER", "MANUAL", "API"）
  triggered_by STRING,                    -- トリガー者（ユーザーIDや"system"）
  environment STRING,                     -- 環境（"production", "staging", "development"）

  -- メタ情報
  created_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  -- 主キー
  PRIMARY KEY (execution_id) NOT ENFORCED
)
PARTITION BY DATE(started_at)
CLUSTER BY status, mode
OPTIONS (
  description = '入札エンジン実行ログ - ジョブレベルの実行記録',
  partition_expiration_days = 365
);

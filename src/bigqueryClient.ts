/**
 * Amazon広告自動入札提案エンジン - BigQueryクライアント
 */

import { BigQuery } from "@google-cloud/bigquery";
import { BIGQUERY } from "./constants";
import { logger } from "./logger";

// BigQueryクライアントの初期化
const bigquery = new BigQuery({
  projectId: process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID,
});

// =============================================================================
// 型定義
// =============================================================================

export type ExecutionMode = "NORMAL" | "S_MODE";
export type ExecutionStatus = "SUCCESS" | "ERROR";

/**
 * executions テーブルの行
 *
 * BigQuery DDL（参考）:
 * ```sql
 * CREATE TABLE IF NOT EXISTS `{project}.amazon_bid_engine.executions` (
 *   id STRING NOT NULL,
 *   profile_id STRING NOT NULL,
 *   mode STRING NOT NULL,
 *   execution_type STRING NOT NULL,
 *   status STRING NOT NULL,
 *   started_at TIMESTAMP NOT NULL,
 *   finished_at TIMESTAMP NOT NULL,
 *   duration_ms INT64 NOT NULL,
 *   total_keywords INT64,
 *   reco_count INT64,
 *   action_strong_up INT64,
 *   action_up INT64,
 *   action_down INT64,
 *   action_stop INT64,
 *   action_keep INT64,
 *   note STRING,
 *   config_snapshot STRING
 * )
 * PARTITION BY DATE(started_at)
 * CLUSTER BY profile_id, execution_type;
 * ```
 */
export interface ExecutionRecord {
  /** 実行ID（execution_id と同義） */
  execution_id: string;
  /** プロファイルID */
  profile_id: string;
  /** 実行モード: NORMAL または S_MODE */
  mode: ExecutionMode;
  /** 実行種別: run-bid-normal, run-bid-smode, run-auto-exact-shadow など */
  execution_type: string;
  /** 旧trigger_type互換（deprecated、execution_typeを使用） */
  trigger_type: string;
  started_at: Date;
  ended_at: Date;
  duration_ms: number;
  total_keywords: number;
  reco_count: number;
  action_strong_up: number;
  action_up: number;
  action_down: number;
  action_stop: number;
  action_keep: number;
  status: ExecutionStatus;
  error_message: string | null;
  /** 任意メモやエラー概要 */
  note?: string | null;
  config_snapshot: string;
}

export interface RecommendationRecord {
  execution_id: string;
  mode: ExecutionMode;
  keyword_id: string | null;
  campaign_id: string | null;
  ad_group_id: string | null;
  action: string | null;
  old_bid: number | null;
  new_bid: number | null;
  change_rate: number | null;
  clipped: boolean | null;
  clip_reason: string | null;
  priority_score: number | null;
  rank_current: number | null;
  rank_target: number | null;
  cvr_recent: number | null;
  cvr_baseline: number | null;
  ctr_recent: number | null;
  ctr_baseline: number | null;
  acos_actual: number | null;
  acos_target: number | null;
  tos_targeted: boolean | null;
  tos_eligible_200: boolean | null;
  base_change_rate: number | null;
  phase_coeff: number | null;
  cvr_coeff: number | null;
  rank_gap_coeff: number | null;
  competitor_coeff: number | null;
  brand_coeff: number | null;
  stats_coeff: number | null;
  tos_coeff: number | null;
  reason_facts: string | null;
  reason_logic: string | null;
  reason_impact: string | null;
  created_at: Date;
}

/**
 * bid_recommendations テーブルの行
 *
 * BigQuery DDL（参考）:
 * ```sql
 * CREATE TABLE IF NOT EXISTS `{project}.amazon_bid_engine.bid_recommendations` (
 *   execution_id STRING NOT NULL,
 *   profile_id STRING NOT NULL,
 *   campaign_id STRING NOT NULL,
 *   ad_group_id STRING NOT NULL,
 *   keyword_id STRING NOT NULL,
 *   keyword_text STRING,
 *   match_type STRING,
 *   asin STRING,
 *   lifecycle_state STRING,
 *   target_acos NUMERIC,
 *   current_bid NUMERIC NOT NULL,
 *   recommended_bid NUMERIC NOT NULL,
 *   bid_change NUMERIC NOT NULL,
 *   bid_change_ratio NUMERIC NOT NULL,
 *   reason_codes STRING,
 *   impressions INT64,
 *   clicks INT64,
 *   orders INT64,
 *   sales NUMERIC,
 *   cost NUMERIC,
 *   cvr NUMERIC,
 *   acos NUMERIC,
 *   created_at TIMESTAMP NOT NULL
 * )
 * PARTITION BY DATE(created_at)
 * CLUSTER BY profile_id, asin;
 * ```
 */
export interface BidRecommendationRow {
  /** 実行ID（executions.id とひも付け） */
  execution_id: string;
  /** プロファイルID */
  profile_id: string;
  /** キャンペーンID */
  campaign_id: string;
  /** 広告グループID */
  ad_group_id: string;
  /** キーワードID */
  keyword_id: string;
  /** キーワードテキスト */
  keyword_text: string | null;
  /** マッチタイプ */
  match_type: string | null;
  /** ASIN */
  asin: string | null;
  /** ライフサイクル状態 */
  lifecycle_state: string | null;
  /** ターゲットACOS */
  target_acos: number | null;
  /** 現在の入札額 */
  current_bid: number;
  /** 推奨入札額 */
  recommended_bid: number;
  /** 入札変化額（recommended - current） */
  bid_change: number;
  /** 入札変化率（recommended / current） */
  bid_change_ratio: number;
  /** 理由コード（カンマ区切りまたはJSON文字列） */
  reason_codes: string | null;
  /** インプレッション数 */
  impressions: number | null;
  /** クリック数 */
  clicks: number | null;
  /** 注文数 */
  orders: number | null;
  /** 売上 */
  sales: number | null;
  /** 広告費 */
  cost: number | null;
  /** CVR */
  cvr: number | null;
  /** ACOS */
  acos: number | null;
  /** 作成日時 */
  created_at: Date;
}

// =============================================================================
// リトライロジック
// =============================================================================

/**
 * リトライ可能なエラーかどうかを判定
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // 一時的なエラーパターン
    const retryablePatterns = [
      "rate limit",
      "quota exceeded",
      "timeout",
      "connection reset",
      "econnreset",
      "etimedout",
      "socket hang up",
      "temporarily unavailable",
      "503",
      "429",
      "internal error",
    ];
    return retryablePatterns.some((pattern) => message.includes(pattern));
  }
  return false;
}

/**
 * 指数バックオフで遅延を計算
 */
function calculateBackoffDelay(attempt: number): number {
  const delay = Math.min(
    BIGQUERY.INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt),
    BIGQUERY.MAX_RETRY_DELAY_MS
  );
  // ジッターを追加（0-25%のランダム遅延）
  const jitter = delay * 0.25 * Math.random();
  return delay + jitter;
}

/**
 * 遅延を実行
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * リトライロジック付きで関数を実行
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < BIGQUERY.MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryableError(error) || attempt === BIGQUERY.MAX_RETRY_ATTEMPTS - 1) {
        logger.error(`${operationName} failed after ${attempt + 1} attempts`, {
          error: lastError.message,
          attempt: attempt + 1,
        });
        throw lastError;
      }

      const delay = calculateBackoffDelay(attempt);
      logger.warn(`${operationName} failed, retrying...`, {
        error: lastError.message,
        attempt: attempt + 1,
        retryDelayMs: delay,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

// =============================================================================
// データベース操作
// =============================================================================

/**
 * テーブルに行を挿入
 */
async function insertRows(tableId: string, rows: unknown[]): Promise<void> {
  if (!rows.length) return;

  const datasetId = process.env.BIGQUERY_DATASET_ID || BIGQUERY.DATASET_ID;
  const table = bigquery.dataset(datasetId).table(tableId);

  await withRetry(async () => {
    const [response] = await table.insert(rows, {
      skipInvalidRows: false,
      ignoreUnknownValues: false,
    });

    // insertメソッドはエラー時に例外をスローするため、
    // 正常終了時はresponseの検証は不要
    logger.debug(`Inserted ${rows.length} rows into ${tableId}`, {
      tableId,
      rowCount: rows.length,
    });

    return response;
  }, `BigQuery insert to ${tableId}`);
}

/**
 * 実行レコードを挿入
 */
export async function insertExecution(record: ExecutionRecord): Promise<void> {
  logger.info("Inserting execution record", {
    executionId: record.execution_id,
    mode: record.mode,
    status: record.status,
  });

  await insertRows(BIGQUERY.EXECUTIONS_TABLE_ID, [record]);

  logger.info("Execution record inserted successfully", {
    executionId: record.execution_id,
  });
}

/**
 * 推奨レコードを挿入
 */
export async function insertRecommendations(
  records: RecommendationRecord[]
): Promise<void> {
  if (!records.length) {
    logger.debug("No recommendations to insert");
    return;
  }

  logger.info("Inserting recommendation records", {
    recordCount: records.length,
    executionId: records[0]?.execution_id,
  });

  // 大量のレコードは分割して挿入（BigQueryの制限対策）
  const BATCH_SIZE = 500;
  const batches: RecommendationRecord[][] = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    batches.push(records.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    logger.debug(`Inserting batch ${i + 1}/${batches.length}`, {
      batchSize: batch.length,
    });
    await insertRows(BIGQUERY.RECOMMENDATIONS_TABLE_ID, batch);
  }

  logger.info("Recommendation records inserted successfully", {
    recordCount: records.length,
    batchCount: batches.length,
  });
}

/**
 * 入札推奨レコードを挿入（新形式）
 */
export async function insertBidRecommendations(
  records: BidRecommendationRow[]
): Promise<void> {
  if (!records.length) {
    logger.debug("No bid recommendations to insert");
    return;
  }

  logger.info("Inserting bid recommendation records", {
    recordCount: records.length,
    executionId: records[0]?.execution_id,
    profileId: records[0]?.profile_id,
  });

  // 大量のレコードは分割して挿入（BigQueryの制限対策）
  const BATCH_SIZE = 500;
  const batches: BidRecommendationRow[][] = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    batches.push(records.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    logger.debug(`Inserting bid recommendation batch ${i + 1}/${batches.length}`, {
      batchSize: batch.length,
    });
    await insertRows(BIGQUERY.BID_RECOMMENDATIONS_TABLE_ID, batch);
  }

  logger.info("Bid recommendation records inserted successfully", {
    recordCount: records.length,
    batchCount: batches.length,
  });
}

/**
 * 実行履歴を取得
 */
export async function getRecentExecutions(
  limit: number = 10
): Promise<ExecutionRecord[]> {
  const datasetId = process.env.BIGQUERY_DATASET_ID || BIGQUERY.DATASET_ID;
  const projectId = process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID;
  const query = `
    SELECT *
    FROM \`${projectId}.${datasetId}.${BIGQUERY.EXECUTIONS_TABLE_ID}\`
    ORDER BY started_at DESC
    LIMIT @limit
  `;

  return withRetry(async () => {
    const [rows] = await bigquery.query({
      query,
      params: { limit },
    });
    return rows as ExecutionRecord[];
  }, "BigQuery getRecentExecutions");
}

/**
 * 特定の実行IDに紐づく推奨を取得
 */
export async function getRecommendationsByExecutionId(
  executionId: string
): Promise<RecommendationRecord[]> {
  const datasetId = process.env.BIGQUERY_DATASET_ID || BIGQUERY.DATASET_ID;
  const projectId = process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID;
  const query = `
    SELECT *
    FROM \`${projectId}.${datasetId}.${BIGQUERY.RECOMMENDATIONS_TABLE_ID}\`
    WHERE execution_id = @executionId
    ORDER BY created_at
  `;

  return withRetry(async () => {
    const [rows] = await bigquery.query({
      query,
      params: { executionId },
    });
    return rows as RecommendationRecord[];
  }, "BigQuery getRecommendationsByExecutionId");
}

/**
 * BigQuery接続をテスト
 */
export async function testConnection(): Promise<boolean> {
  try {
    const datasetId = process.env.BIGQUERY_DATASET_ID || BIGQUERY.DATASET_ID;
    const [datasets] = await bigquery.getDatasets();
    const datasetExists = datasets.some((ds) => ds.id === datasetId);

    if (!datasetExists) {
      logger.warn("Dataset not found", { datasetId });
      return false;
    }

    logger.info("BigQuery connection test successful", { datasetId });
    return true;
  } catch (error) {
    logger.error("BigQuery connection test failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

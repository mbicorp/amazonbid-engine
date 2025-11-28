/**
 * BigQuery クライアント（Admin用）
 *
 * ADC（Application Default Credentials）認証で動作する。
 * Cloud Run 上ではサービスアカウントの認証情報を自動取得。
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";

// シングルトンインスタンス
let bigqueryInstance: BigQuery | null = null;

/**
 * BigQuery クライアントを取得
 *
 * ADC認証を使用し、プロジェクトIDは環境変数または自動取得で対応。
 */
export function getBigQueryClient(): BigQuery {
  if (!bigqueryInstance) {
    const projectId = process.env.GCP_PROJECT_ID || process.env.BIGQUERY_PROJECT_ID;

    bigqueryInstance = new BigQuery({
      projectId,
      // ADC認証を使用（Cloud Run上では自動的にサービスアカウントを使用）
    });

    logger.debug("BigQuery client initialized for Admin", { projectId });
  }

  return bigqueryInstance;
}

/**
 * データセットIDを取得
 */
export function getDatasetId(): string {
  return process.env.BQ_DATASET || process.env.BIGQUERY_DATASET_ID || "amazon_bid_engine";
}

/**
 * プロジェクトIDを取得
 */
export function getProjectId(): string {
  return process.env.GCP_PROJECT_ID || process.env.BIGQUERY_PROJECT_ID || "rpptool";
}

/**
 * 完全修飾テーブル名を生成
 */
export function getFullTableName(tableName: string, dataset?: string): string {
  const projectId = getProjectId();
  const datasetId = dataset || getDatasetId();
  return `${projectId}.${datasetId}.${tableName}`;
}

/**
 * クエリを実行して結果を取得
 */
export async function executeQuery<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
  const client = getBigQueryClient();

  try {
    const [rows] = await client.query({
      query,
      params,
    });
    return rows as T[];
  } catch (error) {
    logger.error("BigQuery query failed", {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 200),
    });
    throw error;
  }
}

/**
 * DMLクエリを実行（INSERT/UPDATE/DELETE）
 */
export async function executeDml(query: string, params?: Record<string, unknown>): Promise<number> {
  const client = getBigQueryClient();

  try {
    const [job] = await client.createQueryJob({
      query,
      params,
    });

    const [result] = await job.getQueryResults();

    // DMLの場合、影響を受けた行数を返す
    const metadata = await job.getMetadata();
    const numDmlAffectedRows = metadata[0]?.statistics?.query?.numDmlAffectedRows;

    logger.debug("BigQuery DML executed", {
      affectedRows: numDmlAffectedRows,
    });

    return parseInt(numDmlAffectedRows || "0", 10);
  } catch (error) {
    logger.error("BigQuery DML failed", {
      error: error instanceof Error ? error.message : String(error),
      query: query.substring(0, 200),
    });
    throw error;
  }
}

/**
 * BigQuery用 AdminJS Database アダプタ
 *
 * AdminJS の BaseDatabase を継承し、BigQuery をデータベースとして扱えるようにする。
 * 実際のデータ操作は BigQueryResource 側で行うため、このクラスは薄い実装。
 */

import { BaseDatabase } from "adminjs";

export interface BigQueryDatabaseOptions {
  projectId?: string;
  datasetId?: string;
}

/**
 * BigQuery Database Adapter for AdminJS
 */
export class BigQueryDatabase extends BaseDatabase {
  private projectId: string;
  private datasetId: string;

  constructor(options: BigQueryDatabaseOptions = {}) {
    super(options);
    this.projectId = options.projectId || process.env.GCP_PROJECT_ID || process.env.BIGQUERY_PROJECT_ID || "rpptool";
    this.datasetId = options.datasetId || process.env.BQ_DATASET || process.env.BIGQUERY_DATASET_ID || "amazon_bid_engine";
  }

  /**
   * このアダプタが対象のデータベースをサポートするかどうかを判定
   */
  static isAdapterFor(database: unknown): boolean {
    // BigQueryDatabase インスタンスまたは BigQueryDatabaseOptions 型のオブジェクトを受け入れる
    if (database instanceof BigQueryDatabase) {
      return true;
    }
    if (database && typeof database === "object" && "_isBigQueryDatabase" in database) {
      return true;
    }
    return false;
  }

  /**
   * データベース名（識別子）を返す
   */
  databaseName(): string {
    return `${this.projectId}.${this.datasetId}`;
  }

  /**
   * リソース一覧を返す（BigQueryResource で個別に登録するため空配列）
   */
  resources(): never[] {
    return [];
  }
}

/**
 * BigQueryDatabase であることを示すマーカー付きオブジェクト生成ヘルパー
 */
export function createBigQueryDatabaseMarker(options: BigQueryDatabaseOptions = {}): BigQueryDatabaseOptions & { _isBigQueryDatabase: true } {
  return {
    ...options,
    _isBigQueryDatabase: true,
  };
}

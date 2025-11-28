/**
 * 季節性予測 BigQuery リポジトリ
 *
 * seasonality_predictions テーブルの読み書きを担当
 */

import { BigQuery } from "@google-cloud/bigquery";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import { BIGQUERY } from "../constants";
import {
  SeasonalityPrediction,
  SeasonalityPredictionRow,
  SeasonalityAdjustment,
  ActiveAdjustmentsFilter,
  PeakInfo,
  MonthlyVolumeStats,
  SeasonalityDataSource,
} from "./types";

// =============================================================================
// テーブル名定数
// =============================================================================

const TABLES = {
  SEASONALITY_PREDICTIONS: "seasonality_predictions",
  SEASONALITY_ADJUSTMENT_LOG: "seasonality_adjustment_log",
  KEYWORD_METRICS: "keyword_metrics_60d",
} as const;

// =============================================================================
// BigQuery クライアント
// =============================================================================

let bigqueryClient: BigQuery | null = null;

function getBigQueryClient(projectId?: string): BigQuery {
  if (!bigqueryClient) {
    bigqueryClient = new BigQuery({
      projectId: projectId ?? BIGQUERY.PROJECT_ID,
    });
  }
  return bigqueryClient;
}

// =============================================================================
// 変換ユーティリティ
// =============================================================================

/**
 * SeasonalityPrediction を BigQuery 行に変換
 */
function predictionToRow(prediction: SeasonalityPrediction): SeasonalityPredictionRow {
  return {
    keyword: prediction.keyword,
    asin: prediction.asin ?? null,
    predicted_peaks: JSON.stringify(
      prediction.predictedPeaks.map((p) => ({
        month: p.month,
        confidence: p.confidence,
        fromCategoryHint: p.fromCategoryHint,
        volumeMultiplier: p.volumeMultiplier,
      }))
    ),
    current_multiplier: prediction.currentMultiplier,
    is_pre_peak_period: prediction.isPrePeakPeriod,
    days_until_peak: prediction.daysUntilNextPeak,
    category_hint: prediction.categoryHint ?? null,
    data_source: prediction.dataSource,
    confidence_score: prediction.confidenceScore,
    monthly_stats: JSON.stringify(prediction.monthlyStats),
    baseline_volume: prediction.baselineVolume,
    adjustment_reason: prediction.adjustmentReason,
    generated_at: prediction.generatedAt,
    expires_at: prediction.expiresAt,
    last_updated: new Date(),
  };
}

/**
 * BigQuery 行を SeasonalityPrediction に変換
 */
function rowToPrediction(row: Record<string, unknown>): SeasonalityPrediction {
  const now = new Date();
  const currentYear = now.getFullYear();

  // predicted_peaks のパース
  let predictedPeaks: PeakInfo[] = [];
  try {
    const peaksJson = row.predicted_peaks ? JSON.parse(String(row.predicted_peaks)) : [];
    predictedPeaks = peaksJson.map((p: Record<string, unknown>) => {
      const month = Number(p.month);
      const predictedPeakDate = new Date(currentYear, month - 1, 15);
      if (predictedPeakDate < now) {
        predictedPeakDate.setFullYear(currentYear + 1);
      }
      return {
        month,
        confidence: Number(p.confidence ?? 0),
        predictedPeakDate,
        fromCategoryHint: Boolean(p.fromCategoryHint),
        volumeMultiplier: Number(p.volumeMultiplier ?? 1.0),
      };
    });
  } catch {
    // パース失敗時は空配列
  }

  // monthly_stats のパース
  let monthlyStats: MonthlyVolumeStats[] = [];
  try {
    monthlyStats = row.monthly_stats ? JSON.parse(String(row.monthly_stats)) : [];
  } catch {
    // パース失敗時は空配列
  }

  return {
    keyword: String(row.keyword ?? ""),
    asin: row.asin ? String(row.asin) : undefined,
    predictedPeaks,
    daysUntilNextPeak: row.days_until_peak != null ? Number(row.days_until_peak) : null,
    isPrePeakPeriod: Boolean(row.is_pre_peak_period),
    currentMultiplier: Number(row.current_multiplier ?? 1.0),
    adjustmentReason: String(row.adjustment_reason ?? ""),
    dataSource: String(row.data_source ?? "CATEGORY_HINT") as SeasonalityDataSource,
    categoryHint: row.category_hint ? String(row.category_hint) : undefined,
    confidenceScore: Number(row.confidence_score ?? 0),
    monthlyStats,
    baselineVolume: Number(row.baseline_volume ?? 0),
    generatedAt: row.generated_at ? new Date(String(row.generated_at)) : new Date(),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : new Date(),
  };
}

// =============================================================================
// リポジトリクラス
// =============================================================================

export class SeasonalityRepository {
  private projectId: string;
  private dataset: string;

  constructor(projectId?: string, dataset?: string) {
    this.projectId = projectId ?? BIGQUERY.PROJECT_ID;
    this.dataset = dataset ?? BIGQUERY.DATASET_ID;
  }

  // ===========================================================================
  // UPSERT: 予測の追加・更新
  // ===========================================================================

  /**
   * 季節性予測を upsert（同一 keyword で更新）
   */
  async upsertPredictions(predictions: SeasonalityPrediction[]): Promise<void> {
    if (predictions.length === 0) {
      logger.info("No seasonality predictions to upsert");
      return;
    }

    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.SEASONALITY_PREDICTIONS}`;

    const rows = predictions.map(predictionToRow);

    // バッチ処理
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      try {
        // まず既存レコードを削除（keyword で一致するもの）
        const keywords = batch.map((row) => `'${row.keyword.replace(/'/g, "\\'")}'`);
        const deleteQuery = `
          DELETE FROM \`${tableId}\`
          WHERE keyword IN (${keywords.join(", ")})
        `;

        await bq.query({
          query: deleteQuery,
          location: "asia-northeast1",
        });

        // 新しいレコードを挿入
        const table = bq.dataset(this.dataset).table(TABLES.SEASONALITY_PREDICTIONS);
        await table.insert(batch);

        logger.debug("Upserted seasonality predictions batch", {
          batchStart: i,
          batchSize: batch.length,
        });
      } catch (error) {
        logger.error("Failed to upsert seasonality predictions batch", {
          batchStart: i,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    logger.info("Upserted all seasonality predictions", {
      count: rows.length,
    });
  }

  // ===========================================================================
  // READ: 予測の取得
  // ===========================================================================

  /**
   * キーワードの予測を取得
   */
  async getPrediction(keyword: string): Promise<SeasonalityPrediction | null> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.SEASONALITY_PREDICTIONS}`;

    const query = `
      SELECT *
      FROM \`${tableId}\`
      WHERE keyword = @keyword
        AND expires_at > CURRENT_TIMESTAMP()
      ORDER BY generated_at DESC
      LIMIT 1
    `;

    try {
      const [rows] = await bq.query({
        query,
        params: { keyword },
        location: "asia-northeast1",
      });

      if (rows.length === 0) {
        return null;
      }

      return rowToPrediction(rows[0] as Record<string, unknown>);
    } catch (error) {
      logger.error("Failed to get seasonality prediction", {
        keyword,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 複数キーワードの予測を一括取得
   */
  async getPredictions(keywords: string[]): Promise<Map<string, SeasonalityPrediction>> {
    if (keywords.length === 0) {
      return new Map();
    }

    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.SEASONALITY_PREDICTIONS}`;

    const keywordList = keywords.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");

    const query = `
      SELECT *
      FROM \`${tableId}\`
      WHERE keyword IN (${keywordList})
        AND expires_at > CURRENT_TIMESTAMP()
      QUALIFY ROW_NUMBER() OVER (PARTITION BY keyword ORDER BY generated_at DESC) = 1
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      const result = new Map<string, SeasonalityPrediction>();
      for (const row of rows) {
        const prediction = rowToPrediction(row as Record<string, unknown>);
        result.set(prediction.keyword, prediction);
      }

      return result;
    } catch (error) {
      logger.error("Failed to get seasonality predictions", {
        keywordCount: keywords.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  /**
   * アクティブな調整（Pre-peak期間中）の一覧を取得
   */
  async getActiveAdjustments(
    filters: ActiveAdjustmentsFilter = {}
  ): Promise<SeasonalityPrediction[]> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.SEASONALITY_PREDICTIONS}`;

    const conditions: string[] = [
      "is_pre_peak_period = TRUE",
      "current_multiplier > 1.0",
      "expires_at > CURRENT_TIMESTAMP()",
    ];

    if (filters.asin) {
      conditions.push(`asin = '${filters.asin}'`);
    }
    if (filters.minMultiplier) {
      conditions.push(`current_multiplier >= ${filters.minMultiplier}`);
    }

    const whereClause = conditions.join(" AND ");
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const query = `
      SELECT *
      FROM \`${tableId}\`
      WHERE ${whereClause}
      ORDER BY current_multiplier DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      return rows.map((row: Record<string, unknown>) => rowToPrediction(row));
    } catch (error) {
      logger.error("Failed to get active adjustments", {
        filters,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 期限切れの予測を取得（クリーンアップ用）
   */
  async getExpiredPredictions(limit: number = 1000): Promise<string[]> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.SEASONALITY_PREDICTIONS}`;

    const query = `
      SELECT keyword
      FROM \`${tableId}\`
      WHERE expires_at <= CURRENT_TIMESTAMP()
      LIMIT ${limit}
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      return rows.map((row: Record<string, unknown>) => String(row.keyword ?? ""));
    } catch (error) {
      logger.error("Failed to get expired predictions", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // ===========================================================================
  // DELETE: 予測の削除
  // ===========================================================================

  /**
   * 期限切れの予測を削除
   */
  async deleteExpiredPredictions(): Promise<number> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.SEASONALITY_PREDICTIONS}`;

    const query = `
      DELETE FROM \`${tableId}\`
      WHERE expires_at <= CURRENT_TIMESTAMP()
    `;

    try {
      const [job] = await bq.createQueryJob({
        query,
        location: "asia-northeast1",
      });

      await job.getQueryResults();
      const metadata = job.metadata as {
        statistics?: { query?: { numDmlAffectedRows?: string } };
      };
      const deletedCount = Number(metadata?.statistics?.query?.numDmlAffectedRows ?? 0);

      logger.info("Deleted expired seasonality predictions", {
        count: deletedCount,
      });

      return deletedCount;
    } catch (error) {
      logger.error("Failed to delete expired predictions", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  // ===========================================================================
  // 調整ログ
  // ===========================================================================

  /**
   * 調整ログを記録
   */
  async logAdjustment(
    keyword: string,
    adjustment: SeasonalityAdjustment,
    asin?: string
  ): Promise<void> {
    const bq = getBigQueryClient(this.projectId);
    const table = bq.dataset(this.dataset).table(TABLES.SEASONALITY_ADJUSTMENT_LOG);

    const row = {
      log_id: uuidv4(),
      keyword,
      asin: asin ?? null,
      mode: adjustment.mode,
      original_bid: adjustment.originalBid,
      adjusted_bid: adjustment.adjustedBid,
      multiplier: adjustment.multiplier,
      applied: adjustment.applied,
      capped_by_max_bid: adjustment.cappedByMaxBid,
      capped_by_ltv: adjustment.cappedByLtv,
      capped_by_inventory: adjustment.cappedByInventory,
      days_until_peak: adjustment.prediction?.daysUntilNextPeak ?? null,
      confidence_score: adjustment.prediction?.confidenceScore ?? null,
      data_source: adjustment.prediction?.dataSource ?? null,
      reason: adjustment.reason,
      created_at: new Date(),
    };

    try {
      await table.insert([row]);

      logger.debug("Logged seasonality adjustment", {
        keyword,
        mode: adjustment.mode,
        multiplier: adjustment.multiplier,
        applied: adjustment.applied,
      });
    } catch (error) {
      // ログの失敗は致命的ではないのでエラーログのみ
      logger.error("Failed to log seasonality adjustment", {
        keyword,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 調整ログの統計を取得
   */
  async getAdjustmentStats(
    daysBack: number = 7
  ): Promise<{
    shadow: { count: number; avgMultiplier: number };
    apply: { count: number; avgMultiplier: number; avgBidIncrease: number };
  }> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.SEASONALITY_ADJUSTMENT_LOG}`;

    const query = `
      SELECT
        mode,
        COUNT(*) as count,
        AVG(multiplier) as avg_multiplier,
        AVG(adjusted_bid - original_bid) as avg_bid_increase
      FROM \`${tableId}\`
      WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${daysBack} DAY)
      GROUP BY mode
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      const result = {
        shadow: { count: 0, avgMultiplier: 1.0 },
        apply: { count: 0, avgMultiplier: 1.0, avgBidIncrease: 0 },
      };

      for (const row of rows) {
        const mode = String(row.mode ?? "").toLowerCase();
        if (mode === "shadow") {
          result.shadow.count = Number(row.count ?? 0);
          result.shadow.avgMultiplier = Number(row.avg_multiplier ?? 1.0);
        } else if (mode === "apply") {
          result.apply.count = Number(row.count ?? 0);
          result.apply.avgMultiplier = Number(row.avg_multiplier ?? 1.0);
          result.apply.avgBidIncrease = Number(row.avg_bid_increase ?? 0);
        }
      }

      return result;
    } catch (error) {
      logger.error("Failed to get adjustment stats", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        shadow: { count: 0, avgMultiplier: 1.0 },
        apply: { count: 0, avgMultiplier: 1.0, avgBidIncrease: 0 },
      };
    }
  }

  // ===========================================================================
  // データ取得: アクティブキーワード
  // ===========================================================================

  /**
   * アクティブなキーワード一覧を取得（予測更新対象）
   */
  async fetchActiveKeywords(limit?: number): Promise<string[]> {
    const bq = getBigQueryClient(this.projectId);

    const limitClause = limit ? `LIMIT ${limit}` : "";

    const query = `
      SELECT DISTINCT keyword
      FROM \`${this.projectId}.${this.dataset}.${TABLES.KEYWORD_METRICS}\`
      WHERE impressions > 0
      ${limitClause}
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      logger.debug("Fetched active keywords", {
        count: rows.length,
      });

      return rows.map((row: Record<string, unknown>) => String(row.keyword ?? ""));
    } catch (error) {
      logger.error("Failed to fetch active keywords", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * キーワードに関連するASINを取得
   */
  async fetchKeywordAsins(keywords: string[]): Promise<Map<string, string[]>> {
    if (keywords.length === 0) {
      return new Map();
    }

    const bq = getBigQueryClient(this.projectId);
    const keywordList = keywords.map((k) => `'${k.replace(/'/g, "\\'")}'`).join(", ");

    const query = `
      SELECT DISTINCT keyword, asin
      FROM \`${this.projectId}.${this.dataset}.${TABLES.KEYWORD_METRICS}\`
      WHERE keyword IN (${keywordList})
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      const result = new Map<string, string[]>();
      for (const row of rows) {
        const keyword = String(row.keyword ?? "");
        const asin = String(row.asin ?? "");
        if (!result.has(keyword)) {
          result.set(keyword, []);
        }
        result.get(keyword)!.push(asin);
      }

      return result;
    } catch (error) {
      logger.error("Failed to fetch keyword ASINs", {
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }
}

// =============================================================================
// シングルトンインスタンス
// =============================================================================

let repositoryInstance: SeasonalityRepository | null = null;

/**
 * リポジトリインスタンスを取得
 */
export function getSeasonalityRepository(
  projectId?: string,
  dataset?: string
): SeasonalityRepository {
  if (!repositoryInstance || projectId || dataset) {
    repositoryInstance = new SeasonalityRepository(projectId, dataset);
  }
  return repositoryInstance;
}

/**
 * リポジトリインスタンスをリセット（テスト用）
 */
export function resetSeasonalityRepository(): void {
  repositoryInstance = null;
}

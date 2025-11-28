/**
 * 季節性予測機能 - バッチジョブ
 *
 * 定期的に実行されるジョブ：
 * - アクティブなキーワードの季節性予測を更新
 * - Jungle Scoutからの履歴データ取得
 * - 期限切れ予測のクリーンアップ
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import {
  SeasonalityPrediction,
  SeasonalityConfig,
  SeasonalityJobResult,
  SeasonalityJobStats,
  RunSeasonalityJobOptions,
  DEFAULT_SEASONALITY_CONFIG,
} from "./types";
import {
  createSeasonalityConfigFromEnv,
  mergeSeasonalityConfig,
} from "./config";
import { predictSeasonality } from "./predictor";
import { getSeasonalityRepository, SeasonalityRepository } from "./repository";
import { getJungleScoutClient, JungleScoutClient } from "../jungle-scout/client";
import { HistoricalSearchVolumeData } from "../jungle-scout/types";

// =============================================================================
// ジョブ実行
// =============================================================================

/**
 * 季節性予測更新ジョブを実行
 */
export async function runSeasonalityUpdateJob(
  options: RunSeasonalityJobOptions
): Promise<SeasonalityJobResult> {
  const executionId = uuidv4();
  const startTime = Date.now();

  logger.info("Starting seasonality update job", {
    executionId,
    projectId: options.projectId,
    dataset: options.dataset,
    keywordLimit: options.keywordLimit,
    forceRefresh: options.forceRefresh,
  });

  // 設定を構築
  const baseConfig = createSeasonalityConfigFromEnv();
  const config = options.configOverride
    ? mergeSeasonalityConfig(baseConfig, options.configOverride)
    : baseConfig;

  // 統計初期化
  const stats: SeasonalityJobStats = {
    totalKeywordsProcessed: 0,
    jsDataFetched: 0,
    jsDataFailed: 0,
    categoryHintOnly: 0,
    predictionsGenerated: 0,
    prePeakKeywords: 0,
    lowConfidenceSkipped: 0,
  };

  try {
    // リポジトリとクライアントを取得
    const repository = getSeasonalityRepository(options.projectId, options.dataset);
    const jsClient = getJungleScoutClient();

    // アクティブなキーワードを取得
    const keywords = await repository.fetchActiveKeywords(options.keywordLimit);
    stats.totalKeywordsProcessed = keywords.length;

    if (keywords.length === 0) {
      logger.info("No active keywords found", { executionId });
      return {
        executionId,
        success: true,
        stats,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // 既存の予測を取得（有効期限チェック用）
    const existingPredictions = options.forceRefresh
      ? new Map<string, SeasonalityPrediction>()
      : await repository.getPredictions(keywords);

    // 更新が必要なキーワードをフィルタ
    const keywordsToUpdate = keywords.filter((keyword) => {
      const existing = existingPredictions.get(keyword);
      return !existing || new Date() >= existing.expiresAt;
    });

    logger.info("Keywords to update", {
      executionId,
      total: keywords.length,
      needsUpdate: keywordsToUpdate.length,
      cached: keywords.length - keywordsToUpdate.length,
    });

    // 予測を生成
    const predictions = await generatePredictions(
      keywordsToUpdate,
      jsClient,
      config,
      stats
    );

    // BigQueryに保存
    if (predictions.length > 0) {
      await repository.upsertPredictions(predictions);
      stats.predictionsGenerated = predictions.length;

      // Pre-peak期間のキーワードをカウント
      stats.prePeakKeywords = predictions.filter((p) => p.isPrePeakPeriod).length;
    }

    // 期限切れ予測をクリーンアップ
    const deletedCount = await repository.deleteExpiredPredictions();
    logger.info("Cleaned up expired predictions", {
      executionId,
      deletedCount,
    });

    const processingTimeMs = Date.now() - startTime;

    logger.info("Seasonality update job completed", {
      executionId,
      processingTimeMs,
      stats,
    });

    return {
      executionId,
      success: true,
      stats,
      processingTimeMs,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Seasonality update job failed", {
      executionId,
      processingTimeMs,
      error: errorMessage,
      stats,
    });

    return {
      executionId,
      success: false,
      stats,
      errorMessage,
      processingTimeMs,
    };
  }
}

// =============================================================================
// 予測生成
// =============================================================================

/**
 * キーワードリストの予測を生成
 */
async function generatePredictions(
  keywords: string[],
  jsClient: JungleScoutClient,
  config: SeasonalityConfig,
  stats: SeasonalityJobStats
): Promise<SeasonalityPrediction[]> {
  const predictions: SeasonalityPrediction[] = [];
  const BATCH_SIZE = 10; // Jungle Scout API のレート制限を考慮

  for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
    const batch = keywords.slice(i, i + BATCH_SIZE);

    // バッチ内のキーワードを並列処理
    const batchResults = await Promise.allSettled(
      batch.map(async (keyword) => {
        // Jungle Scoutから履歴データを取得
        let jsData: HistoricalSearchVolumeData | null = null;

        try {
          jsData = await jsClient.getHistoricalSearchVolume({
            keyword,
            marketplace: "jp",
          });
          stats.jsDataFetched++;
        } catch (error) {
          // Jungle Scoutのエラーは致命的ではない（カテゴリヒントで補完）
          stats.jsDataFailed++;
          logger.debug("Failed to fetch JS historical data", {
            keyword,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // 予測を生成
        const prediction = predictSeasonality(keyword, jsData, config);

        // データソースの統計
        if (prediction.dataSource === "CATEGORY_HINT") {
          stats.categoryHintOnly++;
        }

        // 信頼度が低い場合はスキップ（ただしログは残す）
        if (prediction.confidenceScore < config.confidenceThreshold) {
          stats.lowConfidenceSkipped++;
          logger.debug("Skipping low confidence prediction", {
            keyword,
            confidenceScore: prediction.confidenceScore,
            threshold: config.confidenceThreshold,
          });
          // スキップしても予測は返す（履歴として保存）
        }

        return prediction;
      })
    );

    // 成功した予測を収集
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        predictions.push(result.value);
      }
    }

    // レート制限を考慮して少し待機
    if (i + BATCH_SIZE < keywords.length) {
      await sleep(1000);
    }
  }

  return predictions;
}

// =============================================================================
// ユーティリティ
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// 単一キーワードの予測更新
// =============================================================================

/**
 * 単一キーワードの予測を更新（API呼び出し用）
 */
export async function updateSingleKeywordPrediction(
  keyword: string,
  projectId: string,
  dataset: string,
  forceRefresh: boolean = false
): Promise<SeasonalityPrediction | null> {
  const config = createSeasonalityConfigFromEnv();
  const repository = getSeasonalityRepository(projectId, dataset);
  const jsClient = getJungleScoutClient();

  // 既存の予測をチェック
  if (!forceRefresh) {
    const existing = await repository.getPrediction(keyword);
    if (existing && new Date() < existing.expiresAt) {
      return existing;
    }
  }

  // Jungle Scoutから履歴データを取得
  let jsData: HistoricalSearchVolumeData | null = null;
  try {
    jsData = await jsClient.getHistoricalSearchVolume({
      keyword,
      marketplace: "jp",
    });
  } catch (error) {
    logger.debug("Failed to fetch JS historical data for single keyword", {
      keyword,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 予測を生成
  const prediction = predictSeasonality(keyword, jsData, config);

  // BigQueryに保存
  await repository.upsertPredictions([prediction]);

  return prediction;
}

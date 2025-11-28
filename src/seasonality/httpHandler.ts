/**
 * 季節性予測機能 - HTTP ハンドラー
 *
 * Express ルートハンドラーを提供：
 * - POST /cron/seasonality-update: 予測更新ジョブ
 * - GET /seasonality/:keyword: 個別キーワードの予測取得
 * - GET /seasonality/active-adjustments: アクティブな調整一覧
 */

import { Request, Response, RequestHandler } from "express";
import { logger } from "../logger";
import { BIGQUERY } from "../constants";
import { RunSeasonalityJobOptions, ActiveAdjustmentsFilter } from "./types";
import { runSeasonalityUpdateJob, updateSingleKeywordPrediction } from "./job";
import { getSeasonalityRepository } from "./repository";
import { formatPredictionForDebug } from "./predictor";

// =============================================================================
// Cron ジョブハンドラー
// =============================================================================

/**
 * 季節性予測更新 Cron ハンドラーを作成
 */
export function createSeasonalityUpdateHandler(): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    logger.info("Received seasonality update request", {
      method: req.method,
      path: req.path,
      query: req.query,
    });

    try {
      // オプションを構築
      const options: RunSeasonalityJobOptions = {
        projectId: (req.query.projectId as string) ?? BIGQUERY.PROJECT_ID,
        dataset: (req.query.dataset as string) ?? BIGQUERY.DATASET_ID,
        keywordLimit: req.query.limit
          ? parseInt(req.query.limit as string, 10)
          : undefined,
        forceRefresh: req.query.forceRefresh === "true",
      };

      // ジョブを実行
      const result = await runSeasonalityUpdateJob(options);

      const responseTime = Date.now() - startTime;

      if (result.success) {
        res.status(200).json({
          success: true,
          executionId: result.executionId,
          stats: result.stats,
          processingTimeMs: result.processingTimeMs,
          responseTimeMs: responseTime,
        });
      } else {
        res.status(500).json({
          success: false,
          executionId: result.executionId,
          error: result.errorMessage,
          stats: result.stats,
          processingTimeMs: result.processingTimeMs,
          responseTimeMs: responseTime,
        });
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error("Seasonality update handler error", {
        error: errorMessage,
        responseTimeMs: responseTime,
      });

      res.status(500).json({
        success: false,
        error: errorMessage,
        responseTimeMs: responseTime,
      });
    }
  };
}

// =============================================================================
// 個別キーワード取得ハンドラー
// =============================================================================

/**
 * 個別キーワードの季節性予測取得ハンドラーを作成
 */
export function createSeasonalityQueryHandler(): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const { keyword } = req.params;

    if (!keyword) {
      res.status(400).json({
        success: false,
        error: "Missing required parameter: keyword",
      });
      return;
    }

    try {
      const projectId = (req.query.projectId as string) ?? BIGQUERY.PROJECT_ID;
      const dataset = (req.query.dataset as string) ?? BIGQUERY.DATASET_ID;
      const forceRefresh = req.query.forceRefresh === "true";
      const debug = req.query.debug === "true";

      // 予測を取得（必要に応じて更新）
      const prediction = await updateSingleKeywordPrediction(
        decodeURIComponent(keyword),
        projectId,
        dataset,
        forceRefresh
      );

      if (!prediction) {
        res.status(404).json({
          success: false,
          error: "Could not generate prediction for keyword",
          keyword,
        });
        return;
      }

      // デバッグモードの場合は詳細情報を追加
      const response: Record<string, unknown> = {
        success: true,
        prediction: {
          keyword: prediction.keyword,
          asin: prediction.asin,
          predictedPeaks: prediction.predictedPeaks.map((p) => ({
            month: p.month,
            confidence: p.confidence,
            fromCategoryHint: p.fromCategoryHint,
          })),
          daysUntilNextPeak: prediction.daysUntilNextPeak,
          isPrePeakPeriod: prediction.isPrePeakPeriod,
          currentMultiplier: prediction.currentMultiplier,
          adjustmentReason: prediction.adjustmentReason,
          dataSource: prediction.dataSource,
          categoryHint: prediction.categoryHint,
          confidenceScore: prediction.confidenceScore,
          generatedAt: prediction.generatedAt,
          expiresAt: prediction.expiresAt,
        },
      };

      if (debug) {
        response.debug = formatPredictionForDebug(prediction);
        response.rawPrediction = prediction;
      }

      res.status(200).json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error("Seasonality query handler error", {
        keyword,
        error: errorMessage,
      });

      res.status(500).json({
        success: false,
        error: errorMessage,
        keyword,
      });
    }
  };
}

// =============================================================================
// アクティブ調整一覧ハンドラー
// =============================================================================

/**
 * アクティブな調整一覧取得ハンドラーを作成
 */
export function createActiveAdjustmentsHandler(): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = (req.query.projectId as string) ?? BIGQUERY.PROJECT_ID;
      const dataset = (req.query.dataset as string) ?? BIGQUERY.DATASET_ID;

      const filters: ActiveAdjustmentsFilter = {
        asin: req.query.asin as string | undefined,
        minMultiplier: req.query.minMultiplier
          ? parseFloat(req.query.minMultiplier as string)
          : undefined,
        limit: req.query.limit
          ? parseInt(req.query.limit as string, 10)
          : 100,
        offset: req.query.offset
          ? parseInt(req.query.offset as string, 10)
          : 0,
      };

      const repository = getSeasonalityRepository(projectId, dataset);
      const predictions = await repository.getActiveAdjustments(filters);

      res.status(200).json({
        success: true,
        count: predictions.length,
        filters,
        adjustments: predictions.map((p) => ({
          keyword: p.keyword,
          asin: p.asin,
          currentMultiplier: p.currentMultiplier,
          daysUntilNextPeak: p.daysUntilNextPeak,
          adjustmentReason: p.adjustmentReason,
          confidenceScore: p.confidenceScore,
          dataSource: p.dataSource,
          categoryHint: p.categoryHint,
          expiresAt: p.expiresAt,
        })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error("Active adjustments handler error", {
        error: errorMessage,
      });

      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  };
}

// =============================================================================
// 調整統計ハンドラー
// =============================================================================

/**
 * 調整ログ統計取得ハンドラーを作成
 */
export function createAdjustmentStatsHandler(): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = (req.query.projectId as string) ?? BIGQUERY.PROJECT_ID;
      const dataset = (req.query.dataset as string) ?? BIGQUERY.DATASET_ID;
      const daysBack = req.query.daysBack
        ? parseInt(req.query.daysBack as string, 10)
        : 7;

      const repository = getSeasonalityRepository(projectId, dataset);
      const stats = await repository.getAdjustmentStats(daysBack);

      res.status(200).json({
        success: true,
        daysBack,
        stats,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error("Adjustment stats handler error", {
        error: errorMessage,
      });

      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  };
}

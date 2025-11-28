/**
 * Eスコア最適化エンドポイント
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import {
  runScheduledOptimization,
  getOptimizer,
  generateOptimizationReport,
  getSuccessStatsByMode,
  getSuccessStatsByAction,
} from "../adaptive-escore";

const router = Router();

// Eスコア重み最適化実行
router.post("/optimize", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;

  logger.info("Starting E-score optimization", { traceId });

  try {
    const result = await runScheduledOptimization();

    logger.info("E-score optimization completed", {
      traceId,
      success: result.success,
      totalOptimizations: result.stats.totalOptimizations,
    });

    return res.json({
      success: result.success,
      message: result.message,
      stats: result.stats,
    });
  } catch (error) {
    logger.error("E-score optimization failed", {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "escore-optimization-failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Eスコア統計情報取得
router.get("/stats", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const days = parseInt(req.query.days as string) || 7;

  try {
    const [modeStats, actionStats] = await Promise.all([
      getSuccessStatsByMode(days),
      getSuccessStatsByAction(days),
    ]);

    const optimizer = getOptimizer();
    const config = optimizer.getConfig();
    const optimizerStats = optimizer.getStats();

    return res.json({
      success: true,
      period: `${days} days`,
      modeStats,
      actionStats,
      currentWeights: {
        NORMAL: config.byMode.NORMAL.weights,
        S_MODE: config.byMode.S_MODE.weights,
      },
      optimizerStats,
    });
  } catch (error) {
    logger.error("Failed to get E-score stats", {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "escore-stats-failed",
    });
  }
});

// Eスコアシステムヘルスチェック
router.get("/health", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const mode = (req.query.mode as string) === "S_MODE" ? "S_MODE" : "NORMAL";

  try {
    const optimizer = getOptimizer();
    const healthCheck = await optimizer.performHealthCheck(mode);

    return res.status(healthCheck.healthy ? 200 : 503).json({
      success: true,
      mode,
      healthy: healthCheck.healthy,
      currentAccuracy: healthCheck.currentAccuracy,
      accuracyTrend: healthCheck.accuracyTrend,
      hoursSinceLastRollback: healthCheck.hoursSinceLastRollback,
      warnings: healthCheck.warnings,
    });
  } catch (error) {
    logger.error("Failed to get E-score health", {
      traceId,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "escore-health-failed",
    });
  }
});

// Eスコアレポート取得
router.get("/report", (req: Request, res: Response) => {
  try {
    const optimizer = getOptimizer();
    const report = generateOptimizationReport(optimizer);

    res.set("Content-Type", "text/plain; charset=utf-8");
    return res.send(report);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "escore-report-failed",
    });
  }
});

export default router;

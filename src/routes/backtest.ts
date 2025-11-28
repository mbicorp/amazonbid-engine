/**
 * バックテスト API ルート
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import { runBacktest, runWeeklyBacktest } from "../backtest/backtest-engine";
import {
  fetchBacktestExecutions,
  fetchBacktestExecution,
  fetchBacktestDailyDetails,
  createBacktestTables,
} from "../backtest/bigquery-adapter";
import {
  sendBacktestNotification,
  generateConsoleReport,
  exportToJson,
  exportTimeSeriesDataToCsv,
} from "../backtest/report-generator";
import { BacktestConfig } from "../backtest/types";
import { ValidationError } from "../errors";

const router = Router();

// =============================================================================
// 設定
// =============================================================================

function getConfig() {
  return {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || "",
    dataset: process.env.BIGQUERY_DATASET || "amazon_bid_engine",
  };
}

// =============================================================================
// エンドポイント
// =============================================================================

/**
 * POST /backtest/run
 * バックテストを実行
 */
router.post("/run", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        success: false,
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const {
      startDate,
      endDate,
      targetAsins,
      targetCampaignIds,
      granularity = "DAILY",
      saveResults = true,
      notifySlack = true,
      profitMargin = 0.30,
    } = req.body;

    // 入力バリデーション
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "startDate and endDate are required",
      });
    }

    const backtestConfig: BacktestConfig = {
      startDate,
      endDate,
      targetAsins,
      targetCampaignIds,
      granularity,
    };

    logger.info("Starting backtest via API", { backtestConfig });

    const result = await runBacktest({
      config: backtestConfig,
      saveResults,
      profitMargin,
    });

    // Slack通知
    if (notifySlack) {
      await sendBacktestNotification(result);
    }

    // コンソールレポートをログ出力
    logger.info("Backtest completed", {
      executionId: result.executionId,
      actualAcos: (result.actual.acos * 100).toFixed(1) + "%",
      simulatedAcos: (result.simulated.acos * 100).toFixed(1) + "%",
      accuracyRate: (result.accuracy.accuracyRate * 100).toFixed(1) + "%",
    });

    res.json({
      success: true,
      data: {
        executionId: result.executionId,
        period: result.period,
        actual: result.actual,
        simulated: result.simulated,
        improvement: result.improvement,
        accuracy: {
          totalDecisions: result.accuracy.totalDecisions,
          correctDecisions: result.accuracy.correctDecisions,
          accuracyRate: result.accuracy.accuracyRate,
        },
        meta: result.meta,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        details: error.errors,
      });
    }

    logger.error("Backtest failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /backtest/executions
 * 過去のバックテスト実行一覧を取得
 */
router.get("/executions", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        success: false,
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const limit = parseInt(req.query.limit as string) || 20;

    logger.info("Fetching backtest executions", { limit });

    const executions = await fetchBacktestExecutions(config, limit);

    res.json({
      success: true,
      data: {
        executions,
        total: executions.length,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch backtest executions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /backtest/executions/:executionId
 * バックテスト詳細結果を取得
 */
router.get("/executions/:executionId", async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const { executionId } = req.params;

    if (!config.projectId) {
      return res.status(500).json({
        success: false,
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    logger.info("Fetching backtest execution details", { executionId });

    const [execution, dailyDetails] = await Promise.all([
      fetchBacktestExecution(config, executionId),
      fetchBacktestDailyDetails(config, executionId),
    ]);

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: "Backtest execution not found",
      });
    }

    res.json({
      success: true,
      data: {
        execution,
        dailyDetails,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch backtest execution", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /backtest/executions/:executionId/export
 * バックテスト結果をエクスポート
 */
router.get("/executions/:executionId/export", async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const { executionId } = req.params;
    const format = (req.query.format as string) || "json";

    if (!config.projectId) {
      return res.status(500).json({
        success: false,
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    logger.info("Exporting backtest result", { executionId, format });

    const [execution, dailyDetails] = await Promise.all([
      fetchBacktestExecution(config, executionId),
      fetchBacktestDailyDetails(config, executionId),
    ]);

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: "Backtest execution not found",
      });
    }

    // 結果を再構築（時系列データを含む）
    const result = {
      ...execution,
      timeSeries: dailyDetails,
    };

    if (format === "csv") {
      const csv = exportTimeSeriesDataToCsv(result as any);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=backtest_${executionId}.csv`
      );
      return res.send(csv);
    }

    // デフォルトはJSON
    const json = exportToJson(result as any);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=backtest_${executionId}.json`
    );
    return res.send(json);
  } catch (error) {
    logger.error("Failed to export backtest result", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /backtest/setup
 * バックテスト用テーブルを作成
 */
router.post("/setup", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        success: false,
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    logger.info("Creating backtest tables");

    await createBacktestTables(config);

    res.json({
      success: true,
      message: "Backtest tables created successfully",
    });
  } catch (error) {
    logger.error("Failed to create backtest tables", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /cron/run-weekly-backtest
 * 週次定期実行用（過去7日間のバックテスト）
 */
router.post("/weekly", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        success: false,
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const notifySlack = req.body.notifySlack !== false;

    logger.info("Starting weekly backtest");

    const result = await runWeeklyBacktest();

    // Slack通知
    if (notifySlack) {
      await sendBacktestNotification(result);
    }

    // コンソールレポート
    const consoleReport = generateConsoleReport(result);
    logger.info("Weekly backtest completed\n" + consoleReport);

    res.json({
      success: true,
      data: {
        executionId: result.executionId,
        period: result.period,
        actual: result.actual,
        simulated: result.simulated,
        improvement: result.improvement,
        accuracy: {
          totalDecisions: result.accuracy.totalDecisions,
          correctDecisions: result.accuracy.correctDecisions,
          accuracyRate: result.accuracy.accuracyRate,
        },
      },
    });
  } catch (error) {
    logger.error("Weekly backtest failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;

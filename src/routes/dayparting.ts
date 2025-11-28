/**
 * Dayparting (時間帯別入札最適化) APIルート
 */

import { Router, Request, Response, NextFunction } from "express";
import { logger } from "../logger";
import { loadEnvConfig } from "../config";
import {
  DaypartingConfig,
  DaypartingMode,
  isValidDaypartingMode,
  HourOfDay,
  getDaypartingEngine,
  DaypartingEngine,
  createDaypartingTables,
  fetchActiveMultipliers,
  fetchRecentFeedback,
  getCurrentHourAndDayJST,
  DAYPARTING_CONSTANTS,
  BigQueryConfig,
} from "../dayparting";

const router = Router();

// =============================================================================
// ヘルパー関数
// =============================================================================

function getBigQueryConfig(): BigQueryConfig {
  const envConfig = loadEnvConfig();
  return {
    projectId: envConfig.bigqueryProjectId,
    dataset: envConfig.bigqueryDatasetId,
  };
}

function getEngine(): DaypartingEngine {
  const config = getBigQueryConfig();
  return getDaypartingEngine({
    projectId: config.projectId,
    dataset: config.dataset,
  });
}

// =============================================================================
// 設定エンドポイント
// =============================================================================

/**
 * POST /dayparting/configs
 * 設定を作成または更新
 */
router.post("/configs", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId, adGroupId, ...overrides } = req.body;

    if (!asin || !campaignId) {
      return res.status(400).json({
        error: "asin and campaignId are required",
      });
    }

    // モードのバリデーション
    if (overrides.mode && !isValidDaypartingMode(overrides.mode)) {
      return res.status(400).json({
        error: `Invalid mode: ${overrides.mode}. Must be one of: OFF, SHADOW, APPLY`,
      });
    }

    const engine = getEngine();
    const config = await engine.createOrUpdateConfig(
      asin,
      campaignId,
      adGroupId ?? null,
      overrides
    );

    res.status(201).json({
      message: "Config created/updated successfully",
      config,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /dayparting/configs/:asin/:campaignId
 * 設定を取得
 */
router.get("/configs/:asin/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const adGroupId = req.query.adGroupId as string | undefined;

    const engine = getEngine();
    const config = await engine.getConfig(asin, campaignId, adGroupId ?? null);

    if (!config) {
      return res.status(404).json({
        error: "Config not found",
      });
    }

    res.json({ config });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /dayparting/configs
 * 有効な設定を全て取得
 */
router.get("/configs", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const engine = getEngine();
    const configs = await engine.getEnabledConfigs();

    res.json({
      count: configs.length,
      configs,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /dayparting/configs/:asin/:campaignId/enable
 * 設定を有効化
 */
router.patch("/configs/:asin/:campaignId/enable", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const adGroupId = req.query.adGroupId as string | undefined;

    const engine = getEngine();
    const config = await engine.createOrUpdateConfig(
      asin,
      campaignId,
      adGroupId ?? null,
      { enabled: true }
    );

    res.json({
      message: "Config enabled",
      config,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /dayparting/configs/:asin/:campaignId/disable
 * 設定を無効化
 */
router.patch("/configs/:asin/:campaignId/disable", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const adGroupId = req.query.adGroupId as string | undefined;

    const engine = getEngine();
    const config = await engine.createOrUpdateConfig(
      asin,
      campaignId,
      adGroupId ?? null,
      { enabled: false }
    );

    res.json({
      message: "Config disabled",
      config,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /dayparting/configs/:asin/:campaignId/mode
 * モードを変更
 */
router.patch("/configs/:asin/:campaignId/mode", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const { mode } = req.body;
    const adGroupId = req.query.adGroupId as string | undefined;

    if (!mode || !isValidDaypartingMode(mode)) {
      return res.status(400).json({
        error: `Invalid mode: ${mode}. Must be one of: OFF, SHADOW, APPLY`,
      });
    }

    const engine = getEngine();
    const config = await engine.createOrUpdateConfig(
      asin,
      campaignId,
      adGroupId ?? null,
      { mode }
    );

    res.json({
      message: `Mode changed to ${mode}`,
      config,
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// 分析エンドポイント
// =============================================================================

/**
 * POST /dayparting/analysis/:asin/:campaignId
 * 単一キャンペーンの分析を実行
 */
router.post("/analysis/:asin/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const adGroupId = req.query.adGroupId as string | undefined;

    const engine = getEngine();
    const result = await engine.runAnalysis(asin, campaignId, adGroupId ?? null);

    if (result.status === "ERROR") {
      return res.status(500).json({
        error: result.error,
        result,
      });
    }

    res.json({ result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /dayparting/analysis/batch
 * バッチ分析を実行
 */
router.post("/analysis/batch", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const engine = getEngine();
    const result = await engine.runBatchAnalysis();

    res.json({ result });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// 乗数エンドポイント
// =============================================================================

/**
 * GET /dayparting/multipliers/:asin/:campaignId
 * アクティブな乗数を取得
 */
router.get("/multipliers/:asin/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const bqConfig = getBigQueryConfig();

    const multipliers = await fetchActiveMultipliers(bqConfig, asin, campaignId);

    res.json({
      count: multipliers.length,
      multipliers,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /dayparting/multipliers/:asin/:campaignId/current
 * 現在時刻の乗数を取得
 */
router.get("/multipliers/:asin/:campaignId/current", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;

    const engine = getEngine();
    const multiplier = await engine.getCurrentMultiplier(asin, campaignId);
    const { hour, dayOfWeek } = getCurrentHourAndDayJST();

    res.json({
      hour,
      dayOfWeek,
      multiplier: multiplier ?? {
        multiplier: DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER,
        message: "No multiplier found for current hour",
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /dayparting/multipliers/:asin/:campaignId/apply
 * 入札額に乗数を適用
 */
router.post("/multipliers/:asin/:campaignId/apply", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const { baseBid } = req.body;

    if (typeof baseBid !== "number" || baseBid <= 0) {
      return res.status(400).json({
        error: "baseBid must be a positive number",
      });
    }

    const engine = getEngine();
    const result = await engine.applyMultiplier(asin, campaignId, baseBid);

    res.json({ result });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// フィードバックエンドポイント
// =============================================================================

/**
 * GET /dayparting/feedback/:asin/:campaignId
 * 直近のフィードバックを取得
 */
router.get("/feedback/:asin/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const days = parseInt(req.query.days as string, 10) || 7;
    const bqConfig = getBigQueryConfig();

    const feedback = await fetchRecentFeedback(bqConfig, asin, campaignId, days);

    res.json({
      count: feedback.length,
      feedback,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /dayparting/feedback/evaluate
 * 未評価のフィードバックを評価
 */
router.post("/feedback/evaluate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const engine = getEngine();
    const evaluatedCount = await engine.evaluateUnevaluatedFeedback();

    res.json({
      message: "Feedback evaluation completed",
      evaluatedCount,
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// ロールバックエンドポイント
// =============================================================================

/**
 * POST /dayparting/rollback/:asin/:campaignId
 * ロールバックを実行
 */
router.post("/rollback/:asin/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        error: "reason is required",
      });
    }

    const engine = getEngine();
    await engine.performRollback(asin, campaignId, reason);

    res.json({
      message: "Rollback completed",
      asin,
      campaignId,
      reason,
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// ヘルスチェックエンドポイント
// =============================================================================

/**
 * GET /dayparting/health/:asin/:campaignId
 * ヘルスチェックを実行
 */
router.get("/health/:asin/:campaignId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { asin, campaignId } = req.params;

    const engine = getEngine();
    const health = await engine.runHealthCheck(asin, campaignId);

    res.json({ health });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// 管理エンドポイント
// =============================================================================

/**
 * POST /dayparting/tables/create
 * テーブルを作成
 */
router.post("/tables/create", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bqConfig = getBigQueryConfig();
    await createDaypartingTables(bqConfig);

    res.json({
      message: "Dayparting tables created successfully",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /dayparting/status
 * システムステータスを取得
 */
router.get("/status", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const engine = getEngine();
    const configs = await engine.getEnabledConfigs();
    const { hour, dayOfWeek } = getCurrentHourAndDayJST();

    res.json({
      status: "OK",
      currentHour: hour,
      currentDayOfWeek: dayOfWeek,
      enabledConfigCount: configs.length,
      constants: {
        defaultMultiplier: DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER,
        hoursPerDay: DAYPARTING_CONSTANTS.HOURS_PER_DAY,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;

/**
 * A/Bテスト APIルート
 *
 * テストの作成、管理、評価結果の取得
 */

import { Router, Request, Response } from "express";
import { loadEnvConfig } from "../config";
import { logger } from "../logger";
import {
  // 型
  ABTestConfig,
  ABTestStatus,
  // テスト管理
  createTestConfig,
  CreateTestOptions,
  UpdateTestOptions,
  getABTestManager,
  isTestInValidPeriod,
  getRemainingDays,
  getElapsedDays,
  // 評価
  evaluateABTest,
  toNotificationData,
  formatSlackMessage,
  // BigQuery
  BigQueryConfig,
  createABTestTables,
  saveTest,
  updateTest as updateTestInBQ,
  fetchTest,
  fetchTests,
  fetchRunningTests,
  saveAssignments,
  fetchAssignments,
  saveDailyMetrics,
  fetchDailyMetrics,
  fetchMetricsAggregate,
  saveEvaluation,
  fetchEvaluations,
  fetchLatestEvaluation,
} from "../ab-test";

const router = Router();

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * BigQuery設定を取得
 */
function getBigQueryConfig(): BigQueryConfig {
  const envConfig = loadEnvConfig();
  return {
    projectId: envConfig.bigqueryProjectId,
    dataset: envConfig.bigqueryDatasetId,
  };
}

/**
 * エラーレスポンスを返す
 */
function errorResponse(
  res: Response,
  status: number,
  error: string,
  message: string,
  details?: unknown
): Response {
  return res.status(status).json({
    success: false,
    error,
    message,
    details,
  });
}

// =============================================================================
// テスト管理エンドポイント
// =============================================================================

/**
 * POST /ab-test/tests
 * 新しいA/Bテストを作成
 */
router.post("/tests", async (req: Request, res: Response) => {
  try {
    const options: CreateTestOptions = req.body;

    // 日付をパース
    if (typeof options.startDate === "string") {
      options.startDate = new Date(options.startDate);
    }
    if (typeof options.endDate === "string") {
      options.endDate = new Date(options.endDate);
    }

    // テスト設定を作成
    const config = createTestConfig(options);

    // BigQueryに保存
    const bqConfig = getBigQueryConfig();
    await saveTest(bqConfig, config);

    // マネージャーに登録
    const manager = getABTestManager();
    manager.registerTest(config);

    logger.info("A/Bテストを作成しました", {
      testId: config.testId,
      name: config.name,
    });

    res.status(201).json({
      success: true,
      data: config,
    });
  } catch (error) {
    logger.error("A/Bテスト作成エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      400,
      "CREATE_TEST_ERROR",
      error instanceof Error ? error.message : "テスト作成に失敗しました"
    );
  }
});

/**
 * GET /ab-test/tests
 * テスト一覧を取得
 */
router.get("/tests", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as ABTestStatus | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

    const bqConfig = getBigQueryConfig();
    const tests = await fetchTests(bqConfig, { status, limit });

    res.status(200).json({
      success: true,
      data: tests,
      total: tests.length,
    });
  } catch (error) {
    logger.error("A/Bテスト一覧取得エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "FETCH_TESTS_ERROR",
      "テスト一覧の取得に失敗しました"
    );
  }
});

/**
 * GET /ab-test/tests/running
 * 実行中のテスト一覧を取得
 */
router.get("/tests/running", async (req: Request, res: Response) => {
  try {
    const bqConfig = getBigQueryConfig();
    const tests = await fetchRunningTests(bqConfig);

    res.status(200).json({
      success: true,
      data: tests,
      total: tests.length,
    });
  } catch (error) {
    logger.error("実行中テスト取得エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "FETCH_RUNNING_TESTS_ERROR",
      "実行中テストの取得に失敗しました"
    );
  }
});

/**
 * GET /ab-test/tests/:testId
 * 特定のテストを取得
 */
router.get("/tests/:testId", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();
    const test = await fetchTest(bqConfig, testId);

    if (!test) {
      return errorResponse(
        res,
        404,
        "TEST_NOT_FOUND",
        `テストが見つかりません: ${testId}`
      );
    }

    // 追加情報を計算
    const isInPeriod = isTestInValidPeriod(test);
    const remainingDays = getRemainingDays(test);
    const elapsedDays = getElapsedDays(test);

    res.status(200).json({
      success: true,
      data: {
        ...test,
        isInPeriod,
        remainingDays,
        elapsedDays,
      },
    });
  } catch (error) {
    logger.error("A/Bテスト取得エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "FETCH_TEST_ERROR",
      "テストの取得に失敗しました"
    );
  }
});

/**
 * PATCH /ab-test/tests/:testId
 * テストを更新
 */
router.patch("/tests/:testId", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;
    const updates: UpdateTestOptions = req.body;

    // 日付をパース
    if (typeof updates.endDate === "string") {
      updates.endDate = new Date(updates.endDate);
    }

    const bqConfig = getBigQueryConfig();

    // 既存テストを取得
    const existing = await fetchTest(bqConfig, testId);
    if (!existing) {
      return errorResponse(
        res,
        404,
        "TEST_NOT_FOUND",
        `テストが見つかりません: ${testId}`
      );
    }

    // マネージャーで更新
    const manager = getABTestManager();
    manager.registerTest(existing); // 念のため登録
    const updated = manager.updateTest(testId, updates);

    // BigQueryを更新
    await updateTestInBQ(bqConfig, updated);

    logger.info("A/Bテストを更新しました", {
      testId,
      updates: Object.keys(updates),
    });

    res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error("A/Bテスト更新エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      400,
      "UPDATE_TEST_ERROR",
      error instanceof Error ? error.message : "テスト更新に失敗しました"
    );
  }
});

/**
 * POST /ab-test/tests/:testId/start
 * テストを開始
 */
router.post("/tests/:testId/start", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();

    // 既存テストを取得
    const existing = await fetchTest(bqConfig, testId);
    if (!existing) {
      return errorResponse(
        res,
        404,
        "TEST_NOT_FOUND",
        `テストが見つかりません: ${testId}`
      );
    }

    // マネージャーで状態変更
    const manager = getABTestManager();
    manager.registerTest(existing);
    const updated = manager.changeStatus(testId, "start");

    // BigQueryを更新
    await updateTestInBQ(bqConfig, updated);

    logger.info("A/Bテストを開始しました", { testId });

    res.status(200).json({
      success: true,
      data: updated,
      message: "テストを開始しました",
    });
  } catch (error) {
    logger.error("A/Bテスト開始エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      400,
      "START_TEST_ERROR",
      error instanceof Error ? error.message : "テスト開始に失敗しました"
    );
  }
});

/**
 * POST /ab-test/tests/:testId/pause
 * テストを一時停止
 */
router.post("/tests/:testId/pause", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();

    const existing = await fetchTest(bqConfig, testId);
    if (!existing) {
      return errorResponse(
        res,
        404,
        "TEST_NOT_FOUND",
        `テストが見つかりません: ${testId}`
      );
    }

    const manager = getABTestManager();
    manager.registerTest(existing);
    const updated = manager.changeStatus(testId, "pause");

    await updateTestInBQ(bqConfig, updated);

    logger.info("A/Bテストを一時停止しました", { testId });

    res.status(200).json({
      success: true,
      data: updated,
      message: "テストを一時停止しました",
    });
  } catch (error) {
    logger.error("A/Bテスト一時停止エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      400,
      "PAUSE_TEST_ERROR",
      error instanceof Error ? error.message : "テスト一時停止に失敗しました"
    );
  }
});

/**
 * POST /ab-test/tests/:testId/complete
 * テストを完了
 */
router.post("/tests/:testId/complete", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();

    const existing = await fetchTest(bqConfig, testId);
    if (!existing) {
      return errorResponse(
        res,
        404,
        "TEST_NOT_FOUND",
        `テストが見つかりません: ${testId}`
      );
    }

    const manager = getABTestManager();
    manager.registerTest(existing);
    const updated = manager.changeStatus(testId, "complete");

    await updateTestInBQ(bqConfig, updated);

    logger.info("A/Bテストを完了しました", { testId });

    res.status(200).json({
      success: true,
      data: updated,
      message: "テストを完了しました",
    });
  } catch (error) {
    logger.error("A/Bテスト完了エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      400,
      "COMPLETE_TEST_ERROR",
      error instanceof Error ? error.message : "テスト完了に失敗しました"
    );
  }
});

/**
 * POST /ab-test/tests/:testId/cancel
 * テストをキャンセル
 */
router.post("/tests/:testId/cancel", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();

    const existing = await fetchTest(bqConfig, testId);
    if (!existing) {
      return errorResponse(
        res,
        404,
        "TEST_NOT_FOUND",
        `テストが見つかりません: ${testId}`
      );
    }

    const manager = getABTestManager();
    manager.registerTest(existing);
    const updated = manager.changeStatus(testId, "cancel");

    await updateTestInBQ(bqConfig, updated);

    logger.info("A/Bテストをキャンセルしました", { testId });

    res.status(200).json({
      success: true,
      data: updated,
      message: "テストをキャンセルしました",
    });
  } catch (error) {
    logger.error("A/Bテストキャンセルエラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      400,
      "CANCEL_TEST_ERROR",
      error instanceof Error ? error.message : "テストキャンセルに失敗しました"
    );
  }
});

// =============================================================================
// 割り当てエンドポイント
// =============================================================================

/**
 * GET /ab-test/tests/:testId/assignments
 * テストの割り当て一覧を取得
 */
router.get("/tests/:testId/assignments", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();
    const assignments = await fetchAssignments(bqConfig, testId);

    // グループ別に集計
    const controlCount = assignments.filter((a) => a.group === "CONTROL").length;
    const testCount = assignments.filter((a) => a.group === "TEST").length;

    res.status(200).json({
      success: true,
      data: assignments,
      total: assignments.length,
      summary: {
        controlCount,
        testCount,
        controlRatio: assignments.length > 0 ? controlCount / assignments.length : 0,
        testRatio: assignments.length > 0 ? testCount / assignments.length : 0,
      },
    });
  } catch (error) {
    logger.error("割り当て取得エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "FETCH_ASSIGNMENTS_ERROR",
      "割り当ての取得に失敗しました"
    );
  }
});

// =============================================================================
// メトリクスエンドポイント
// =============================================================================

/**
 * GET /ab-test/tests/:testId/metrics
 * テストの日次メトリクスを取得
 */
router.get("/tests/:testId/metrics", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : undefined;
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : undefined;

    const bqConfig = getBigQueryConfig();
    const metrics = await fetchDailyMetrics(bqConfig, testId, startDate, endDate);

    res.status(200).json({
      success: true,
      data: metrics,
      total: metrics.length,
    });
  } catch (error) {
    logger.error("メトリクス取得エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "FETCH_METRICS_ERROR",
      "メトリクスの取得に失敗しました"
    );
  }
});

/**
 * GET /ab-test/tests/:testId/metrics/aggregate
 * テストの集計メトリクスを取得
 */
router.get("/tests/:testId/metrics/aggregate", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : undefined;
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : undefined;

    const bqConfig = getBigQueryConfig();

    // 両グループの集計を取得
    const [controlMetrics, testMetrics] = await Promise.all([
      fetchMetricsAggregate(bqConfig, testId, "CONTROL", startDate, endDate),
      fetchMetricsAggregate(bqConfig, testId, "TEST", startDate, endDate),
    ]);

    res.status(200).json({
      success: true,
      data: {
        control: controlMetrics,
        test: testMetrics,
      },
    });
  } catch (error) {
    logger.error("集計メトリクス取得エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "FETCH_AGGREGATE_METRICS_ERROR",
      "集計メトリクスの取得に失敗しました"
    );
  }
});

// =============================================================================
// 評価エンドポイント
// =============================================================================

/**
 * POST /ab-test/tests/:testId/evaluate
 * テストを評価
 */
router.post("/tests/:testId/evaluate", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();

    // テスト設定を取得
    const testConfig = await fetchTest(bqConfig, testId);
    if (!testConfig) {
      return errorResponse(
        res,
        404,
        "TEST_NOT_FOUND",
        `テストが見つかりません: ${testId}`
      );
    }

    // メトリクス集計を取得
    const [controlMetrics, testMetrics] = await Promise.all([
      fetchMetricsAggregate(bqConfig, testId, "CONTROL"),
      fetchMetricsAggregate(bqConfig, testId, "TEST"),
    ]);

    if (!controlMetrics || !testMetrics) {
      return errorResponse(
        res,
        400,
        "INSUFFICIENT_DATA",
        "評価に必要なデータが不足しています"
      );
    }

    // 日次データを取得（標準偏差計算用）
    const dailyMetrics = await fetchDailyMetrics(bqConfig, testId);
    const controlDaily = dailyMetrics.filter((m) => m.group === "CONTROL");
    const testDaily = dailyMetrics.filter((m) => m.group === "TEST");

    const controlDailyData = {
      acos: controlDaily.map((m) => m.acos ?? 0),
      roas: controlDaily.map((m) => m.roas ?? 0),
      cvr: controlDaily.map((m) => m.cvr ?? 0),
      sales: controlDaily.map((m) => m.sales),
    };

    const testDailyData = {
      acos: testDaily.map((m) => m.acos ?? 0),
      roas: testDaily.map((m) => m.roas ?? 0),
      cvr: testDaily.map((m) => m.cvr ?? 0),
      sales: testDaily.map((m) => m.sales),
    };

    // 評価を実行
    const evaluation = evaluateABTest(
      testConfig,
      controlMetrics,
      testMetrics,
      controlDailyData,
      testDailyData
    );

    // 評価結果を保存
    await saveEvaluation(bqConfig, evaluation);

    logger.info("A/Bテストを評価しました", {
      testId,
      winner: evaluation.overallWinner,
      hasAdequateSampleSize: evaluation.hasAdequateSampleSize,
    });

    res.status(200).json({
      success: true,
      data: evaluation,
    });
  } catch (error) {
    logger.error("A/Bテスト評価エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "EVALUATE_TEST_ERROR",
      "テスト評価に失敗しました"
    );
  }
});

/**
 * GET /ab-test/tests/:testId/evaluations
 * テストの評価結果一覧を取得
 */
router.get("/tests/:testId/evaluations", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();
    const evaluations = await fetchEvaluations(bqConfig, testId);

    res.status(200).json({
      success: true,
      data: evaluations,
      total: evaluations.length,
    });
  } catch (error) {
    logger.error("評価結果取得エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "FETCH_EVALUATIONS_ERROR",
      "評価結果の取得に失敗しました"
    );
  }
});

/**
 * GET /ab-test/tests/:testId/evaluations/latest
 * 最新の評価結果を取得
 */
router.get("/tests/:testId/evaluations/latest", async (req: Request, res: Response) => {
  try {
    const { testId } = req.params;

    const bqConfig = getBigQueryConfig();
    const evaluation = await fetchLatestEvaluation(bqConfig, testId);

    if (!evaluation) {
      return errorResponse(
        res,
        404,
        "EVALUATION_NOT_FOUND",
        "評価結果が見つかりません"
      );
    }

    // 通知用データも生成
    const testConfig = await fetchTest(bqConfig, testId);
    const notificationData = testConfig
      ? toNotificationData(testConfig, evaluation)
      : null;

    res.status(200).json({
      success: true,
      data: evaluation,
      notification: notificationData,
    });
  } catch (error) {
    logger.error("最新評価結果取得エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "FETCH_LATEST_EVALUATION_ERROR",
      "最新評価結果の取得に失敗しました"
    );
  }
});

// =============================================================================
// セットアップエンドポイント
// =============================================================================

/**
 * POST /ab-test/setup
 * A/Bテスト用テーブルを作成
 */
router.post("/setup", async (req: Request, res: Response) => {
  try {
    const bqConfig = getBigQueryConfig();
    await createABTestTables(bqConfig);

    logger.info("A/Bテストテーブルを作成しました");

    res.status(200).json({
      success: true,
      message: "A/Bテストテーブルを作成しました",
    });
  } catch (error) {
    logger.error("テーブル作成エラー", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      res,
      500,
      "SETUP_ERROR",
      "テーブル作成に失敗しました"
    );
  }
});

export default router;

/**
 * Amazon広告自動入札提案エンジン - APIサーバー
 *
 * エントリポイント: startServer() を呼び出してHTTPサーバーを起動
 */

// dotenv を最初に読み込んで .env ファイルから環境変数を設定
import "dotenv/config";

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { compute_bid_recommendations } from "../index";
import { KeywordMetrics, GlobalConfig } from "../types";
import { testConnection } from "./bigqueryClient";
import { validateEnvConfig, loadEnvConfig } from "./config";
import { validateRecommendRequest } from "./schemas";
import { apiKeyAuth, internalAuth } from "./middleware/auth";
import { logger } from "./logger";
import { SERVER } from "./constants";
import {
  healthRoutes,
  seoInvestmentRoutes,
  cronRoutes,
  escoreRoutes,
  jungleScoutRoutes,
  unifiedStrategyRoutes,
  lifecycleRoutes,
  negativeSuggestionsRoutes,
  autoExactSuggestionsRoutes,
  debugRoutes,
  executionsRoutes,
  backtestRoutes,
  abTestRoutes,
} from "./routes";
import { configureNotifications } from "./utils/notification";
import { registerAdmin } from "./admin/admin";

// =============================================================================
// サーバー起動関数
// =============================================================================

/**
 * HTTPサーバーを起動する
 *
 * この関数は以下を行う:
 * 1. Express app の作成と設定
 * 2. ミドルウェアの登録
 * 3. APIルートの登録
 * 4. AdminJS管理画面の登録
 * 5. app.listen()でHTTPサーバーを起動
 *
 * @returns Promise<void> - サーバー起動完了後にresolve（プロセスは終了しない）
 */
async function startServer(): Promise<void> {
  // 環境変数の検証
  const envValidation = validateEnvConfig();
  if (!envValidation.valid) {
    logger.error("Environment validation failed", { errors: envValidation.errors });
    // 開発環境では警告のみ、本番では起動を停止
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Environment validation failed: ${envValidation.errors.join(", ")}`);
    }
  }

  const app = express();
  const PORT = process.env.PORT || SERVER.DEFAULT_PORT;

  // 設定を読み込み（環境変数が不足している場合はundefinedになる可能性あり）
  let envConfig: ReturnType<typeof loadEnvConfig> | null = null;
  try {
    envConfig = loadEnvConfig();
  } catch {
    logger.warn("Failed to load env config, some features may be disabled");
  }

  // ===========================================================================
  // 通知システム設定
  // ===========================================================================

  configureNotifications({
    enabled: !!process.env.SLACK_WEBHOOK_URL,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || null,
    channel: process.env.SLACK_CHANNEL || "#amazon-ads-alerts",
  });

  // ===========================================================================
  // CORS設定
  // ===========================================================================

  // Retool Cloud および許可されたオリジンからのリクエストを受け入れる
  const allowedOrigins: (string | RegExp)[] = [
    // Retool Cloud
    /^https:\/\/.*\.retool\.com$/,
    /^https:\/\/.*\.tryretool\.com$/,
    // ローカル開発
    "http://localhost:3000",
    "http://localhost:8080",
  ];

  // 環境変数で追加オリジンを設定可能
  if (process.env.CORS_ALLOWED_ORIGINS) {
    const additionalOrigins = process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) =>
      o.trim()
    );
    allowedOrigins.push(...additionalOrigins);
  }

  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      // オリジンがない場合（サーバー間通信など）は許可
      if (!origin) {
        return callback(null, true);
      }

      // 許可リストをチェック
      const isAllowed = allowedOrigins.some((allowed) => {
        if (typeof allowed === "string") {
          return origin === allowed;
        }
        if (allowed instanceof RegExp) {
          return allowed.test(origin);
        }
        return false;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        logger.warn("CORS request blocked", { origin });
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Request-ID",
      "X-Trace-ID",
    ],
    exposedHeaders: ["X-Request-ID", "X-Trace-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
    maxAge: 86400, // プリフライトリクエストを24時間キャッシュ
  };

  app.use(cors(corsOptions));

  // ===========================================================================
  // ミドルウェア
  // ===========================================================================

  // JSONリクエストボディのパース
  app.use(express.json({ limit: "10mb" }));

  // リクエストログ
  app.use(logger.requestLogger());

  // レート制限（API全体）
  // AdminJS 管理画面（/admin-panel）は除外
  const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分間
    max: 100, // 100リクエスト/分
    message: {
      success: false,
      error: "rate-limit-exceeded",
      message: "Too many requests, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/admin-panel"),
  });

  // 書き込み系API用の厳しいレート制限
  const writeLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1分間
    max: 30, // 30リクエスト/分
    message: {
      success: false,
      error: "rate-limit-exceeded",
      message: "Too many write requests, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // レート制限を適用
  app.use(generalLimiter);

  // エラーハンドリング
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled error", {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });
    res.status(500).json({
      error: "Internal Server Error",
      message: process.env.NODE_ENV === "production" ? "An error occurred" : err.message,
    });
  });

  // ===========================================================================
  // 公開エンドポイント
  // ===========================================================================

  // ヘルスチェックエンドポイント
  app.get("/health", async (req: Request, res: Response) => {
    const bigqueryHealthy = await testConnection();

    res.status(bigqueryHealthy ? 200 : 503).json({
      status: bigqueryHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      service: "amazon-bid-engine",
      checks: {
        bigquery: bigqueryHealthy ? "ok" : "failed",
      },
    });
  });

  // ルートエンドポイント
  app.get("/", (req: Request, res: Response) => {
    res.status(200).json({
      service: "Amazon広告自動入札提案エンジン API",
      version: "1.0.0",
      endpoints: {
        health: "GET /health",
        recommend: "POST /recommend",
        admin_panel: "GET /admin-panel (AdminJS管理画面)",
        cron: {
          run: "POST /cron/run",
          run_normal: "POST /cron/run-normal",
          run_smode: "POST /cron/run-smode",
          recompute_guardrails: "POST /cron/recompute-guardrails",
          run_auto_exact_promotion:
            "POST /cron/run-auto-exact-promotion (SHADOW mode only)",
          run_auto_exact_shadow:
            "POST /cron/run-auto-exact-shadow (BigQuery保存付き、環境変数AUTO_EXACT_SHADOW_PROFILE_IDで対象指定)",
        },
        escore: {
          optimize: "POST /escore/optimize",
          stats: "GET /escore/stats",
          health: "GET /escore/health",
          report: "GET /escore/report",
        },
        jungle_scout: {
          sync: "POST /jungle-scout/sync",
          analyze: "POST /jungle-scout/analyze",
          keywords: "GET /jungle-scout/keywords/:asin",
          sov: "GET /jungle-scout/sov/:asin",
          strategy: "GET /jungle-scout/strategy/:asin",
          trending: "GET /jungle-scout/trending",
        },
        unified: {
          calculate: "POST /unified/calculate",
          product: "POST /unified/product",
          strategy: "GET /unified/strategy/:asin",
          summary: "GET /unified/summary/:asin",
        },
        seo_investment: {
          evaluate: "POST /seo-investment/evaluate",
          start: "POST /seo-investment/start",
          update: "POST /seo-investment/update",
          status: "GET /seo-investment/status/:asin",
          summary: "GET /seo-investment/summary/:asin",
          acos_limit: "GET /seo-investment/acos-limit",
          investment_limit: "GET /seo-investment/investment-limit",
          stop: "DELETE /seo-investment/stop",
        },
        lifecycle: {
          products: "GET /lifecycle/products",
          keywords: "GET /lifecycle/keywords/:productId",
          update: "POST /lifecycle/update",
          stage: "POST /lifecycle/products/:productId/stage",
          aggregation: "POST /lifecycle/aggregation",
          config: "GET /lifecycle/config",
        },
        admin_api: {
          negative_suggestions: {
            list: "GET /admin/negative-suggestions",
            summary: "GET /admin/negative-suggestions/summary",
            detail: "GET /admin/negative-suggestions/:suggestionId",
            approve: "POST /admin/negative-suggestions/approve",
            reject: "POST /admin/negative-suggestions/reject",
            apply_queued: "POST /admin/negative-suggestions/apply-queued (placeholder)",
          },
          executions: {
            list: "GET /admin/executions",
            asin_summary: "GET /admin/executions/:executionId/asin-summary",
            keyword_details: "GET /admin/executions/:executionId/keyword-details",
          },
        },
        debug: {
          run_auto_exact_shadow:
            "GET /debug/run-auto-exact-shadow?profileId=xxx&asin=yyy",
        },
        backtest: {
          run: "POST /backtest/run",
          executions: "GET /backtest/executions",
          execution_detail: "GET /backtest/executions/:executionId",
          export: "GET /backtest/executions/:executionId/export",
          setup: "POST /backtest/setup",
          weekly: "POST /backtest/weekly",
        },
        ab_test: {
          tests: "GET /ab-test/tests",
          tests_running: "GET /ab-test/tests/running",
          test_detail: "GET /ab-test/tests/:testId",
          create_test: "POST /ab-test/tests",
          update_test: "PATCH /ab-test/tests/:testId",
          start_test: "POST /ab-test/tests/:testId/start",
          pause_test: "POST /ab-test/tests/:testId/pause",
          complete_test: "POST /ab-test/tests/:testId/complete",
          cancel_test: "POST /ab-test/tests/:testId/cancel",
          assignments: "GET /ab-test/tests/:testId/assignments",
          metrics: "GET /ab-test/tests/:testId/metrics",
          metrics_aggregate: "GET /ab-test/tests/:testId/metrics/aggregate",
          evaluate: "POST /ab-test/tests/:testId/evaluate",
          evaluations: "GET /ab-test/tests/:testId/evaluations",
          evaluations_latest: "GET /ab-test/tests/:testId/evaluations/latest",
          setup: "POST /ab-test/setup",
        },
      },
    });
  });

  // ===========================================================================
  // 認証付きエンドポイント
  // ===========================================================================

  // 入札推奨エンドポイント（API Key認証）
  app.post(
    "/recommend",
    apiKeyAuth(envConfig?.apiKey),
    (req: Request, res: Response) => {
      const traceId = (req as any).traceId;

      // バリデーション
      const validation = validateRecommendRequest(req.body);
      if (!validation.success) {
        logger.warn("Invalid recommend request", {
          traceId,
          errors: validation.errors,
        });
        return res.status(400).json({
          error: "Invalid request",
          message: "Request validation failed",
          details: validation.errors,
        });
      }

      const { keywords, config } = validation.data!;

      try {
        // 入札推奨を計算
        const recommendations = compute_bid_recommendations(
          keywords as KeywordMetrics[],
          config as GlobalConfig
        );

        logger.info("Recommendations computed", {
          traceId,
          keywordCount: keywords.length,
          recommendationCount: recommendations.length,
        });

        // 結果を返す
        res.status(200).json({
          success: true,
          total: recommendations.length,
          recommendations,
        });
      } catch (error) {
        logger.error("Error processing recommendation", {
          traceId,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // ===========================================================================
  // ルーターの登録
  // ===========================================================================

  // 内部認証ミドルウェア
  const internalAuthMiddleware = internalAuth(
    envConfig?.apiKey,
    envConfig?.googleCloudProjectId,
    envConfig?.enableOidcAuth || false
  );

  // API Key認証ミドルウェア
  const apiKeyAuthMiddleware = apiKeyAuth(envConfig?.apiKey);

  // Cronエンドポイント（内部認証）
  app.use("/cron", internalAuthMiddleware, cronRoutes);

  // Eスコアエンドポイント（最適化は内部認証、参照はAPI Key認証）
  app.post("/escore/optimize", internalAuthMiddleware);
  app.use("/escore", apiKeyAuthMiddleware, escoreRoutes);

  // Jungle Scoutエンドポイント（同期・分析は内部認証、参照はAPI Key認証）
  app.post("/jungle-scout/sync", internalAuthMiddleware);
  app.post("/jungle-scout/analyze", internalAuthMiddleware);
  app.use("/jungle-scout", apiKeyAuthMiddleware, jungleScoutRoutes);

  // 統合戦略エンドポイント（計算・登録は内部認証、参照はAPI Key認証）
  app.post("/unified/product", internalAuthMiddleware);
  app.post("/unified/calculate", internalAuthMiddleware);
  app.use("/unified", apiKeyAuthMiddleware, unifiedStrategyRoutes);

  // SEO投資ルートを登録（認証付き + 書き込み用レート制限）
  app.use(
    "/seo-investment",
    internalAuthMiddleware,
    writeLimiter,
    seoInvestmentRoutes
  );

  // ライフサイクル管理エンドポイント（更新は内部認証、参照はAPI Key認証）
  app.post("/lifecycle/update", internalAuthMiddleware);
  app.post("/lifecycle/aggregation", internalAuthMiddleware);
  app.post("/lifecycle/products/:productId/stage", internalAuthMiddleware);
  app.use("/lifecycle", apiKeyAuthMiddleware, lifecycleRoutes);

  // ネガティブキーワード候補管理エンドポイント（API Key認証 + 書き込み用レート制限）
  app.use(
    "/admin/negative-suggestions",
    apiKeyAuthMiddleware,
    writeLimiter,
    negativeSuggestionsRoutes
  );

  // AUTO→EXACT昇格候補管理エンドポイント（API Key認証 + 書き込み用レート制限）
  app.use(
    "/admin/auto-exact-suggestions",
    apiKeyAuthMiddleware,
    writeLimiter,
    autoExactSuggestionsRoutes
  );

  // 実行履歴ダッシュボードエンドポイント（API Key認証）
  app.use("/admin/executions", apiKeyAuthMiddleware, executionsRoutes);

  // ヘルスチェック（認証なし）
  app.use("/", healthRoutes);

  // デバッグエンドポイント（API Key認証）
  // 本番では適切なアクセス制御が必要
  app.use("/debug", apiKeyAuthMiddleware, debugRoutes);

  // バックテストエンドポイント（実行は内部認証、参照はAPI Key認証）
  app.post("/backtest/run", internalAuthMiddleware);
  app.post("/backtest/setup", internalAuthMiddleware);
  app.post("/backtest/weekly", internalAuthMiddleware);
  app.use("/backtest", apiKeyAuthMiddleware, backtestRoutes);

  // A/Bテストエンドポイント（テスト作成・操作は内部認証、参照はAPI Key認証）
  app.post("/ab-test/tests", internalAuthMiddleware);
  app.post("/ab-test/tests/:testId/start", internalAuthMiddleware);
  app.post("/ab-test/tests/:testId/pause", internalAuthMiddleware);
  app.post("/ab-test/tests/:testId/complete", internalAuthMiddleware);
  app.post("/ab-test/tests/:testId/cancel", internalAuthMiddleware);
  app.post("/ab-test/tests/:testId/evaluate", internalAuthMiddleware);
  app.post("/ab-test/setup", internalAuthMiddleware);
  app.use("/ab-test", apiKeyAuthMiddleware, abTestRoutes);

  // ===========================================================================
  // AdminJS 管理画面
  // ===========================================================================

  // 管理画面を登録（環境変数が設定されている場合のみ）
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    try {
      registerAdmin(app);
    } catch (error) {
      logger.error("Failed to register AdminJS admin panel", {
        error: error instanceof Error ? error.message : String(error),
      });
      // AdminJS の登録失敗はサーバー起動を妨げない（他のAPIは動作可能）
    }
  } else {
    logger.warn("AdminJS admin panel disabled: ADMIN_EMAIL and ADMIN_PASSWORD not set");
  }

  // ===========================================================================
  // HTTPサーバー起動
  // ===========================================================================

  return new Promise<void>((resolve) => {
    app.listen(PORT, () => {
      logger.info("Server started", {
        service: "amazon-bid-engine",
        version: "1.0.0",
        port: PORT,
        environment: process.env.NODE_ENV || "development",
        authEnabled: !!envConfig?.apiKey || envConfig?.enableOidcAuth,
        rateLimitEnabled: true,
        notificationsEnabled: !!process.env.SLACK_WEBHOOK_URL,
        adminEnabled: !!(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD),
      });
      // resolve() を呼ぶが、app.listen() がソケットを保持し続けるためプロセスは終了しない
      resolve();
    });
  });
}

// =============================================================================
// エントリポイント
// =============================================================================

// サーバー起動を実行
startServer().catch((error) => {
  logger.error("Failed to start server", {
    service: "amazon-bid-engine",
    environment: process.env.NODE_ENV || "development",
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

// Express app のエクスポートはテスト用途のみ
// 注意: このモジュールをimportすると startServer() が実行される
export { startServer };

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
import { renderExecutionsView } from "./ui/executionsView";
import { renderRecommendationsView } from "./ui/recommendationsView";
import { renderMonitoringView } from "./ui/monitoringView";
import { renderShadowEvalView } from "./ui/shadowEvalView";
import { renderOpsPlaybookView } from "./ui/opsPlaybookView";
import { renderDailyShadowSummaryView } from "./ui/dailyShadowSummaryView";
import { fetchTopSummary } from "./ui/topSummary";

// package.json からバージョン情報を取得
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require("../../package.json") as { version: string };

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

  // ルートエンドポイント - HTMLトップページ（管理用インデックス）
  app.get("/", async (req: Request, res: Response) => {
    const version = packageJson.version;
    const environment = process.env.NODE_ENV || "development";

    // 要対応タスク数を取得（エラー時は0件として扱う）
    let topSummary = { strongPendingCount: 0, breachCount: 0 };
    try {
      topSummary = await fetchTopSummary();
    } catch (error) {
      logger.warn("Failed to fetch top summary", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // バッジHTML生成関数
    const buildBadge = (count: number, type: "warning" | "danger" | "info"): string => {
      if (count === 0) return "";
      return `<span class="top-card-badge top-card-badge-${type}">${count}</span>`;
    };

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Amazon自動入札エンジン 管理ページ</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans CJK JP", sans-serif;
      background: linear-gradient(135deg, #0f172a, #1d3557);
      color: #f9fafb;
      min-height: 100vh;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 24px 16px 40px;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
    }
    .subtitle {
      margin-bottom: 24px;
      opacity: 0.85;
    }
    .meta {
      margin-bottom: 24px;
      font-size: 14px;
      opacity: 0.9;
    }
    .meta span {
      display: inline-block;
      margin-right: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .card {
      background: rgba(15, 23, 42, 0.9);
      border-radius: 12px;
      padding: 16px 18px;
      text-decoration: none;
      color: inherit;
      box-shadow: 0 10px 20px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(148, 163, 184, 0.3);
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 28px rgba(0, 0, 0, 0.5);
      border-color: #38bdf8;
    }
    .card-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
    }
    .card-desc {
      font-size: 13px;
      opacity: 0.9;
    }
    .top-card-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 600;
      color: white;
      margin-left: 8px;
    }
    .top-card-badge-warning {
      background: #dd6b20;
    }
    .top-card-badge-danger {
      background: #e53e3e;
    }
    .top-card-badge-info {
      background: #3182ce;
    }
    footer {
      margin-top: 32px;
      font-size: 12px;
      opacity: 0.75;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Amazon自動入札エンジン 管理ページ</h1>
    <p class="subtitle">入札ロジックの実行状況を確認し、管理ツールにアクセスするためのトップページです。</p>

    <div class="meta">
      <span>バージョン: v${version}</span>
      <span>環境: ${environment}</span>
    </div>

    <div class="grid">
      <a href="/ui/ops-playbook" class="card">
        <div class="card-title">オペフロー</div>
        <div class="card-desc">日次オペレーションの手順とチェックリスト。まずはここから確認を始めてください。</div>
      </a>

      <a href="/ui/recommendations?strongOnly=1&pendingOnly=1" class="card">
        <div class="card-title">推奨入札ビュー${buildBadge(topSummary.strongPendingCount, "warning")}</div>
        <div class="card-desc">推奨入札結果を一覧で確認するための画面です。強い変更かつ未適用の件数をバッジ表示。</div>
      </a>

      <a href="/admin-panel/resources/loss_budget_7d" class="card">
        <div class="card-title">予算・損失モニタ${buildBadge(topSummary.breachCount, "danger")}</div>
        <div class="card-desc">ASIN別の予算消化状況と損失を確認。BREACH状態のASIN件数をバッジ表示。</div>
      </a>

      <a href="/ui/executions" class="card">
        <div class="card-title">実行履歴ビュー</div>
        <div class="card-desc">バッチ実行状況や成否、処理件数などを一覧で確認します。</div>
      </a>

      <a href="/ui/monitoring" class="card">
        <div class="card-title">監視ビュー</div>
        <div class="card-desc">入札エンジン実行ごとの健康状態と異常検出状況を一覧する監視用ビューです。</div>
      </a>

      <a href="/ui/shadow-eval" class="card">
        <div class="card-title">SHADOW評価</div>
        <div class="card-desc">SHADOWモードの入札提案が事後的に正しかったか評価します。</div>
      </a>

      <a href="/ui/daily-shadow-summary" class="card">
        <div class="card-title">SHADOW日次サマリー</div>
        <div class="card-desc">SHADOWモードの提案の当たり外れを日次単位で集計し、AI分析用テキストも生成します。</div>
      </a>

      <a href="/admin-panel" class="card">
        <div class="card-title">管理画面 AdminJS</div>
        <div class="card-desc">広告アカウントや設定値をブラウザ上から管理するための画面です。</div>
      </a>

      <a href="/health" class="card">
        <div class="card-title">ヘルスチェック</div>
        <div class="card-desc">Cloud Runやスケジューラからの死活監視に使うエンドポイントです。</div>
      </a>
    </div>

    <footer>
      Amazon広告自動入札エンジン 管理UI
    </footer>
  </div>
</body>
</html>`;
    res.status(200).type("html").send(html);
  });

  // 実行履歴ビュー（UIエンドポイント、認証なし）
  app.get("/ui/executions", renderExecutionsView);

  // 推奨入札ビュー（UIエンドポイント、認証なし）
  app.get("/ui/recommendations", renderRecommendationsView);

  // 監視ビュー（UIエンドポイント、認証なし）
  app.get("/ui/monitoring", renderMonitoringView);

  // SHADOW評価ビュー（UIエンドポイント、認証なし）
  app.get("/ui/shadow-eval", renderShadowEvalView);

  // オペフローページ（UIエンドポイント、認証なし）
  app.get("/ui/ops-playbook", renderOpsPlaybookView);

  // SHADOW日次サマリービュー（UIエンドポイント、認証なし）
  app.get("/ui/daily-shadow-summary", renderDailyShadowSummaryView);

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

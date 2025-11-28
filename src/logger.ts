/**
 * Amazon広告自動入札提案エンジン - 構造化ログ
 */

/**
 * ログレベル
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * ログエントリの構造
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  traceId?: string;
  spanId?: string;
  service: string;
  version: string;
  environment: string;
  [key: string]: unknown;
}

/**
 * ログコンテキスト（リクエストごとの情報）
 */
interface LogContext {
  traceId?: string;
  spanId?: string;
  userId?: string;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * 構造化ロガークラス
 */
class StructuredLogger {
  private service: string;
  private version: string;
  private environment: string;
  private minLevel: LogLevel;
  private context: LogContext;

  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor() {
    this.service = "amazon-bid-engine";
    this.version = process.env.npm_package_version || "1.0.0";
    this.environment = process.env.NODE_ENV || "development";
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
    this.context = {};
  }

  /**
   * ログコンテキストを設定
   */
  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * ログコンテキストをクリア
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * トレースIDを生成
   */
  generateTraceId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * ログエントリを構築
   */
  private buildLogEntry(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
      version: this.version,
      environment: this.environment,
      ...this.context,
      ...data,
    };

    // Cloud Loggingの重大度フィールドを追加
    (entry as Record<string, unknown>).severity = level.toUpperCase();

    return entry;
  }

  /**
   * ログを出力
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (this.levelPriority[level] < this.levelPriority[this.minLevel]) {
      return;
    }

    const entry = this.buildLogEntry(level, message, data);
    const output = JSON.stringify(entry);

    switch (level) {
      case "error":
        console.error(output);
        break;
      case "warn":
        console.warn(output);
        break;
      case "debug":
        console.debug(output);
        break;
      default:
        console.log(output);
    }
  }

  /**
   * デバッグログ
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  /**
   * 情報ログ
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  /**
   * 警告ログ
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  /**
   * エラーログ
   */
  error(message: string, data?: Record<string, unknown>): void {
    // エラーオブジェクトを文字列化
    if (data?.error instanceof Error) {
      data = {
        ...data,
        error: {
          name: data.error.name,
          message: data.error.message,
          stack: data.error.stack,
        },
      };
    }
    this.log("error", message, data);
  }

  /**
   * 子ロガーを作成（追加のコンテキストを持つ）
   */
  child(additionalContext: LogContext): StructuredLogger {
    const childLogger = new StructuredLogger();
    childLogger.context = { ...this.context, ...additionalContext };
    return childLogger;
  }

  /**
   * リクエストログ用のミドルウェア
   */
  requestLogger() {
    return (req: any, res: any, next: any): void => {
      const traceId = this.generateTraceId();
      const startTime = Date.now();

      // Cloud Traceヘッダーがあれば使用
      const cloudTraceHeader = req.headers["x-cloud-trace-context"];
      const finalTraceId = cloudTraceHeader
        ? cloudTraceHeader.split("/")[0]
        : traceId;

      // リクエストにトレースIDを付与
      req.traceId = finalTraceId;

      // リクエスト開始ログ
      this.info("Request started", {
        traceId: finalTraceId,
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      // レスポンス完了時のログ
      res.on("finish", () => {
        const duration = Date.now() - startTime;
        this.info("Request completed", {
          traceId: finalTraceId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: duration,
        });
      });

      next();
    };
  }
}

// シングルトンインスタンス
export const logger = new StructuredLogger();

// 便利な関数をエクスポート
export function createChildLogger(context: LogContext): StructuredLogger {
  return logger.child(context);
}

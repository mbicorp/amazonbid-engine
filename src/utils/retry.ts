/**
 * リトライ・サーキットブレーカーユーティリティ
 *
 * 外部API（Amazon Ads, BigQuery, Jungle Scout）への呼び出しを
 * 安全にリトライし、障害時にサーキットブレーカーで保護する
 */

import { logger } from "../logger";
import {
  AppError,
  CircuitOpenError,
  isRetryableError,
  getRetryDelayMs,
} from "../errors";

// =============================================================================
// 設定
// =============================================================================

export interface RetryConfig {
  maxRetries: number; // 最大リトライ回数
  baseDelayMs: number; // 基本待機時間（ミリ秒）
  maxDelayMs: number; // 最大待機時間（ミリ秒）
  backoffMultiplier: number; // 指数バックオフ乗数
  retryableErrors?: string[]; // リトライ対象のエラーコード
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // オープンになる失敗回数
  resetTimeoutMs: number; // ハーフオープンまでの時間
  halfOpenRequests: number; // ハーフオープン時の試行回数
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "429", // Too Many Requests
    "500", // Internal Server Error
    "502", // Bad Gateway
    "503", // Service Unavailable
    "504", // Gateway Timeout
  ],
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 1分
  halfOpenRequests: 3,
};

// =============================================================================
// サーキットブレーカー
// =============================================================================

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  halfOpenAttempts: number;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

function getCircuitBreaker(name: string): CircuitBreakerState {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, {
      state: "CLOSED",
      failures: 0,
      successes: 0,
      lastFailureTime: null,
      halfOpenAttempts: 0,
    });
  }
  return circuitBreakers.get(name)!;
}

function shouldAllowRequest(
  name: string,
  config: CircuitBreakerConfig
): { allowed: boolean; state: CircuitState } {
  const breaker = getCircuitBreaker(name);
  const now = Date.now();

  switch (breaker.state) {
    case "CLOSED":
      return { allowed: true, state: "CLOSED" };

    case "OPEN":
      // タイムアウト経過後、ハーフオープンに移行
      if (
        breaker.lastFailureTime &&
        now - breaker.lastFailureTime >= config.resetTimeoutMs
      ) {
        breaker.state = "HALF_OPEN";
        breaker.halfOpenAttempts = 0;
        logger.info("Circuit breaker transitioning to HALF_OPEN", { name });
        return { allowed: true, state: "HALF_OPEN" };
      }
      return { allowed: false, state: "OPEN" };

    case "HALF_OPEN":
      // ハーフオープン時は限定的にリクエストを許可
      if (breaker.halfOpenAttempts < config.halfOpenRequests) {
        breaker.halfOpenAttempts++;
        return { allowed: true, state: "HALF_OPEN" };
      }
      return { allowed: false, state: "HALF_OPEN" };

    default:
      return { allowed: true, state: "CLOSED" };
  }
}

function recordSuccess(name: string, config: CircuitBreakerConfig): void {
  const breaker = getCircuitBreaker(name);

  if (breaker.state === "HALF_OPEN") {
    breaker.successes++;
    // ハーフオープン時に一定数成功したらクローズに戻す
    if (breaker.successes >= config.halfOpenRequests) {
      breaker.state = "CLOSED";
      breaker.failures = 0;
      breaker.successes = 0;
      breaker.halfOpenAttempts = 0;
      logger.info("Circuit breaker CLOSED (recovered)", { name });
    }
  } else if (breaker.state === "CLOSED") {
    // 成功したら失敗カウントをリセット
    breaker.failures = 0;
  }
}

function recordFailure(name: string, config: CircuitBreakerConfig): void {
  const breaker = getCircuitBreaker(name);
  breaker.failures++;
  breaker.lastFailureTime = Date.now();

  if (breaker.state === "HALF_OPEN") {
    // ハーフオープン中の失敗は即座にオープンに戻す
    breaker.state = "OPEN";
    breaker.successes = 0;
    logger.warn("Circuit breaker OPEN (half-open failure)", { name });
  } else if (
    breaker.state === "CLOSED" &&
    breaker.failures >= config.failureThreshold
  ) {
    breaker.state = "OPEN";
    logger.warn("Circuit breaker OPEN", {
      name,
      failures: breaker.failures,
      threshold: config.failureThreshold,
    });
  }
}

// =============================================================================
// リトライ関数
// =============================================================================

/**
 * 指数バックオフでリトライを実行
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    name: string;
    retryConfig?: Partial<RetryConfig>;
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  }
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options.retryConfig };
  const cbConfig = {
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    ...options.circuitBreakerConfig,
  };

  // サーキットブレーカーチェック
  const { allowed, state } = shouldAllowRequest(options.name, cbConfig);
  if (!allowed) {
    throw new CircuitOpenError(options.name, cbConfig.resetTimeoutMs);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const result = await fn();
      recordSuccess(options.name, cbConfig);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorCode = (error as any).code || (error as any).status || "";

      // AppErrorの場合はretryableプロパティを優先
      const canRetry = error instanceof AppError
        ? error.retryable
        : isRetryableError(error) ||
          retryConfig.retryableErrors?.some(
            (code) =>
              errorCode.toString().includes(code) ||
              lastError!.message.includes(code)
          );

      if (!canRetry || attempt >= retryConfig.maxRetries) {
        recordFailure(options.name, cbConfig);
        logger.error("Request failed (no more retries)", {
          name: options.name,
          attempt,
          error: lastError.message,
          code: errorCode,
          retryable: canRetry,
        });
        throw lastError;
      }

      // AppErrorのretryAfterMsがあればそれを使用、なければ指数バックオフ
      const delay = error instanceof AppError && error.retryAfterMs
        ? error.retryAfterMs
        : Math.min(
            retryConfig.baseDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt),
            retryConfig.maxDelayMs
          );

      // ジッターを追加（0-20%のランダム）
      const jitter = delay * Math.random() * 0.2;
      const waitTime = Math.round(delay + jitter);

      logger.warn("Retrying request", {
        name: options.name,
        attempt: attempt + 1,
        maxRetries: retryConfig.maxRetries,
        waitMs: waitTime,
        error: lastError.message,
        errorCode: error instanceof AppError ? error.code : errorCode,
      });

      await sleep(waitTime);
    }
  }

  // ここには到達しないはずだが、念のため
  throw lastError || new Error("Unknown error in retry");
}

/**
 * タイムアウト付きで関数を実行
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  name: string
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        const error = new Error(`Timeout after ${timeoutMs}ms: ${name}`);
        (error as any).code = "ETIMEDOUT";
        reject(error);
      }, timeoutMs);
    }),
  ]);
}

/**
 * リトライとタイムアウトを組み合わせた実行
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  options: {
    name: string;
    timeoutMs?: number;
    retryConfig?: Partial<RetryConfig>;
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  }
): Promise<T> {
  const timeoutMs = options.timeoutMs || 30000; // デフォルト30秒

  return withRetry(
    () => withTimeout(fn, timeoutMs, options.name),
    options
  );
}

// =============================================================================
// サーキットブレーカー状態取得
// =============================================================================

export function getCircuitBreakerStatus(name: string): {
  state: CircuitState;
  failures: number;
  lastFailureTime: number | null;
} {
  const breaker = getCircuitBreaker(name);
  return {
    state: breaker.state,
    failures: breaker.failures,
    lastFailureTime: breaker.lastFailureTime,
  };
}

export function getAllCircuitBreakerStatuses(): Map<
  string,
  { state: CircuitState; failures: number }
> {
  const statuses = new Map<string, { state: CircuitState; failures: number }>();
  circuitBreakers.forEach((breaker, name) => {
    statuses.set(name, {
      state: breaker.state,
      failures: breaker.failures,
    });
  });
  return statuses;
}

export function resetCircuitBreaker(name: string): void {
  const breaker = getCircuitBreaker(name);
  breaker.state = "CLOSED";
  breaker.failures = 0;
  breaker.successes = 0;
  breaker.lastFailureTime = null;
  breaker.halfOpenAttempts = 0;
  logger.info("Circuit breaker manually reset", { name });
}

// =============================================================================
// ヘルパー
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * カスタムエラークラスと統一レスポンス形式
 *
 * エラーハンドリングを統一し、適切なリトライ戦略を可能にする
 */

// =============================================================================
// エラーコード定義
// =============================================================================

export const ErrorCode = {
  // 認証・認可エラー (4xx)
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_API_KEY: "INVALID_API_KEY",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",

  // バリデーションエラー (400)
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",

  // リソースエラー (404)
  NOT_FOUND: "NOT_FOUND",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",

  // レート制限 (429)
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  THROTTLED: "THROTTLED",

  // 外部サービスエラー (5xx)
  AMAZON_ADS_API_ERROR: "AMAZON_ADS_API_ERROR",
  BIGQUERY_ERROR: "BIGQUERY_ERROR",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",

  // サーバーエラー (500)
  INTERNAL_ERROR: "INTERNAL_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",

  // サーキットブレーカー
  CIRCUIT_OPEN: "CIRCUIT_OPEN",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// =============================================================================
// 基底エラークラス
// =============================================================================

export interface AppErrorOptions {
  code: ErrorCodeType;
  message: string;
  statusCode?: number;
  details?: Record<string, unknown>;
  cause?: Error;
  retryable?: boolean;
  retryAfterMs?: number;
}

/**
 * アプリケーション基底エラークラス
 */
export class AppError extends Error {
  public readonly code: ErrorCodeType;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly timestamp: string;
  public readonly originalCause?: Error;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.timestamp = new Date().toISOString();
    this.originalCause = options.cause;

    // スタックトレースを保持
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * JSON形式でエラー情報を取得
   */
  toJSON(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      timestamp: this.timestamp,
    };
  }
}

// =============================================================================
// 認証エラー
// =============================================================================

/**
 * 認証エラー（401）
 * リトライしても無駄なエラー
 */
export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication failed", details?: Record<string, unknown>) {
    super({
      code: ErrorCode.UNAUTHORIZED,
      message,
      statusCode: 401,
      details,
      retryable: false,
    });
    this.name = "AuthenticationError";
  }
}

/**
 * 認可エラー（403）
 */
export class AuthorizationError extends AppError {
  constructor(message: string = "Access denied", details?: Record<string, unknown>) {
    super({
      code: ErrorCode.FORBIDDEN,
      message,
      statusCode: 403,
      details,
      retryable: false,
    });
    this.name = "AuthorizationError";
  }
}

// =============================================================================
// バリデーションエラー
// =============================================================================

export interface ValidationErrorDetail {
  field: string;
  message: string;
  received?: unknown;
}

/**
 * バリデーションエラー（400）
 */
export class ValidationError extends AppError {
  public readonly errors: ValidationErrorDetail[];

  constructor(errors: ValidationErrorDetail[], message: string = "Validation failed") {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      message,
      statusCode: 400,
      details: { errors },
      retryable: false,
    });
    this.name = "ValidationError";
    this.errors = errors;
  }

  static fromZodError(zodError: { issues: Array<{ path: (string | number)[]; message: string }> }): ValidationError {
    const errors: ValidationErrorDetail[] = zodError.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    return new ValidationError(errors);
  }
}

// =============================================================================
// リソースエラー
// =============================================================================

/**
 * リソース未検出エラー（404）
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super({
      code: ErrorCode.NOT_FOUND,
      message,
      statusCode: 404,
      details: { resource, identifier },
      retryable: false,
    });
    this.name = "NotFoundError";
  }
}

// =============================================================================
// レート制限エラー
// =============================================================================

/**
 * レート制限エラー（429）
 * 指定時間後にリトライすべき
 */
export class RateLimitError extends AppError {
  constructor(retryAfterMs: number = 60000, message: string = "Rate limit exceeded") {
    super({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message,
      statusCode: 429,
      retryable: true,
      retryAfterMs,
    });
    this.name = "RateLimitError";
  }
}

// =============================================================================
// 外部サービスエラー
// =============================================================================

/**
 * Amazon Ads APIエラー
 */
export class AmazonAdsApiError extends AppError {
  public readonly amazonErrorCode?: string;
  public readonly amazonRequestId?: string;

  constructor(options: {
    message: string;
    statusCode: number;
    amazonErrorCode?: string;
    amazonRequestId?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    cause?: Error;
  }) {
    super({
      code: ErrorCode.AMAZON_ADS_API_ERROR,
      message: options.message,
      statusCode: options.statusCode,
      details: {
        amazonErrorCode: options.amazonErrorCode,
        amazonRequestId: options.amazonRequestId,
      },
      retryable: options.retryable ?? false,
      retryAfterMs: options.retryAfterMs,
      cause: options.cause,
    });
    this.name = "AmazonAdsApiError";
    this.amazonErrorCode = options.amazonErrorCode;
    this.amazonRequestId = options.amazonRequestId;
  }

  /**
   * HTTPステータスコードからエラーを生成
   */
  static fromHttpStatus(
    status: number,
    responseBody: string,
    requestId?: string
  ): AmazonAdsApiError {
    switch (status) {
      case 401:
        return new AmazonAdsApiError({
          message: "Amazon Ads API authentication failed",
          statusCode: 401,
          amazonRequestId: requestId,
          retryable: false,
        });
      case 403:
        return new AmazonAdsApiError({
          message: "Amazon Ads API access forbidden",
          statusCode: 403,
          amazonRequestId: requestId,
          retryable: false,
        });
      case 429:
        return new AmazonAdsApiError({
          message: "Amazon Ads API rate limit exceeded",
          statusCode: 429,
          amazonRequestId: requestId,
          retryable: true,
          retryAfterMs: 60000, // 1分後にリトライ
        });
      case 500:
      case 502:
      case 503:
      case 504:
        return new AmazonAdsApiError({
          message: `Amazon Ads API server error: ${status}`,
          statusCode: status,
          amazonRequestId: requestId,
          retryable: true,
          retryAfterMs: 5000, // 5秒後にリトライ
        });
      default:
        return new AmazonAdsApiError({
          message: `Amazon Ads API error: ${responseBody}`,
          statusCode: status,
          amazonRequestId: requestId,
          retryable: false,
        });
    }
  }
}

/**
 * BigQueryエラー
 */
export class BigQueryError extends AppError {
  constructor(
    message: string,
    options?: {
      cause?: Error;
      retryable?: boolean;
      retryAfterMs?: number;
    }
  ) {
    super({
      code: ErrorCode.BIGQUERY_ERROR,
      message,
      statusCode: 500,
      retryable: options?.retryable ?? false,
      retryAfterMs: options?.retryAfterMs,
      cause: options?.cause,
    });
    this.name = "BigQueryError";
  }

  /**
   * BigQueryエラーメッセージからリトライ可能か判定
   */
  static isRetryableMessage(message: string): boolean {
    const retryablePatterns = [
      /rate limit/i,
      /quota exceeded/i,
      /temporarily unavailable/i,
      /service unavailable/i,
      /internal error/i,
      /backendError/i,
      /rateLimitExceeded/i,
    ];
    return retryablePatterns.some((pattern) => pattern.test(message));
  }

  static fromError(error: Error): BigQueryError {
    const retryable = BigQueryError.isRetryableMessage(error.message);
    return new BigQueryError(error.message, {
      cause: error,
      retryable,
      retryAfterMs: retryable ? 5000 : undefined,
    });
  }
}

// =============================================================================
// サーキットブレーカーエラー
// =============================================================================

/**
 * サーキットオープンエラー
 * サーキットブレーカーが開いている状態
 */
export class CircuitOpenError extends AppError {
  public readonly serviceName: string;
  public readonly openedAt: Date;

  constructor(serviceName: string, retryAfterMs: number = 30000) {
    super({
      code: ErrorCode.CIRCUIT_OPEN,
      message: `Circuit breaker is open for ${serviceName}`,
      statusCode: 503,
      details: { serviceName },
      retryable: true,
      retryAfterMs,
    });
    this.name = "CircuitOpenError";
    this.serviceName = serviceName;
    this.openedAt = new Date();
  }
}

// =============================================================================
// 設定エラー
// =============================================================================

/**
 * 設定エラー
 */
export class ConfigurationError extends AppError {
  constructor(message: string, missingConfig?: string[]) {
    super({
      code: ErrorCode.CONFIGURATION_ERROR,
      message,
      statusCode: 500,
      details: missingConfig ? { missingConfig } : undefined,
      retryable: false,
    });
    this.name = "ConfigurationError";
  }
}

// =============================================================================
// 統一レスポンス形式
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  statusCode: number;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    retryAfterMs?: number;
  };
  meta?: {
    requestId?: string;
    timestamp: string;
    pagination?: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };
}

/**
 * 統一レスポンスビルダー
 */
export class ApiResponseBuilder {
  /**
   * 成功レスポンスを生成
   */
  static success<T>(
    data: T,
    options?: {
      statusCode?: number;
      requestId?: string;
      pagination?: {
        total: number;
        limit: number;
        offset: number;
      };
    }
  ): ApiResponse<T> {
    const pagination = options?.pagination
      ? {
          ...options.pagination,
          hasMore: options.pagination.offset + options.pagination.limit < options.pagination.total,
        }
      : undefined;

    return {
      success: true,
      statusCode: options?.statusCode ?? 200,
      data,
      meta: {
        requestId: options?.requestId,
        timestamp: new Date().toISOString(),
        pagination,
      },
    };
  }

  /**
   * エラーレスポンスを生成
   */
  static error(error: AppError | Error, requestId?: string): ApiResponse<never> {
    if (error instanceof AppError) {
      return {
        success: false,
        statusCode: error.statusCode,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          retryable: error.retryable,
          retryAfterMs: error.retryAfterMs,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // 一般的なErrorの場合
    return {
      success: false,
      statusCode: 500,
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: error.message || "An unexpected error occurred",
        retryable: false,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * バリデーションエラーレスポンスを生成
   */
  static validationError(
    errors: ValidationErrorDetail[],
    requestId?: string
  ): ApiResponse<never> {
    return {
      success: false,
      statusCode: 400,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: "Validation failed",
        details: { errors },
        retryable: false,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 認証エラーレスポンスを生成
   */
  static unauthorized(message: string = "Unauthorized", requestId?: string): ApiResponse<never> {
    return {
      success: false,
      statusCode: 401,
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message,
        retryable: false,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Not Foundレスポンスを生成
   */
  static notFound(resource: string, identifier?: string, requestId?: string): ApiResponse<never> {
    return {
      success: false,
      statusCode: 404,
      error: {
        code: ErrorCode.NOT_FOUND,
        message: identifier ? `${resource} not found: ${identifier}` : `${resource} not found`,
        details: { resource, identifier },
        retryable: false,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// =============================================================================
// エラーハンドリングユーティリティ
// =============================================================================

/**
 * エラーがリトライ可能か判定
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.retryable;
  }
  if (error instanceof Error) {
    // 一般的なリトライ可能パターン
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("network") ||
      message.includes("temporarily unavailable")
    );
  }
  return false;
}

/**
 * リトライ待機時間を取得（ミリ秒）
 */
export function getRetryDelayMs(error: unknown, attempt: number): number {
  if (error instanceof AppError && error.retryAfterMs) {
    return error.retryAfterMs;
  }
  // 指数バックオフ: 1秒, 2秒, 4秒, 8秒... (最大30秒)
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

/**
 * エラーをAppErrorに変換
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError({
      code: ErrorCode.INTERNAL_ERROR,
      message: error.message,
      cause: error,
      retryable: isRetryableError(error),
    });
  }
  return new AppError({
    code: ErrorCode.INTERNAL_ERROR,
    message: String(error),
    retryable: false,
  });
}

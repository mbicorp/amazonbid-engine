/**
 * Amazon広告自動入札提案エンジン - 認証ミドルウェア
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

/**
 * 認証エラーレスポンス
 */
interface AuthErrorResponse {
  error: string;
  message: string;
}

/**
 * API Key認証ミドルウェア
 * ヘッダー: X-API-Key または Authorization: Bearer <api_key>
 */
export function apiKeyAuth(apiKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiKey) {
      // API Keyが設定されていない場合は認証をスキップ
      logger.warn("API Key authentication is disabled (API_KEY not set)");
      next();
      return;
    }

    const providedKey =
      req.headers["x-api-key"] ||
      extractBearerToken(req.headers.authorization);

    if (!providedKey) {
      const response: AuthErrorResponse = {
        error: "Unauthorized",
        message: "API key is required. Provide via X-API-Key header or Authorization: Bearer <key>",
      };
      res.status(401).json(response);
      return;
    }

    if (providedKey !== apiKey) {
      logger.warn("Invalid API key attempt", {
        ip: req.ip,
        path: req.path,
      });
      const response: AuthErrorResponse = {
        error: "Unauthorized",
        message: "Invalid API key",
      };
      res.status(401).json(response);
      return;
    }

    next();
  };
}

/**
 * Cloud Scheduler用OIDC認証ミドルウェア
 * Google Cloud Schedulerからのリクエストを検証
 */
export function cloudSchedulerAuth(
  projectId: string | undefined,
  enabled: boolean
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!enabled) {
      // OIDC認証が無効の場合はスキップ
      next();
      return;
    }

    if (!projectId) {
      logger.error("OIDC auth is enabled but GOOGLE_CLOUD_PROJECT_ID is not set");
      const response: AuthErrorResponse = {
        error: "Internal Server Error",
        message: "Server configuration error",
      };
      res.status(500).json(response);
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const response: AuthErrorResponse = {
        error: "Unauthorized",
        message: "Authorization header with Bearer token is required",
      };
      res.status(401).json(response);
      return;
    }

    const token = authHeader.substring(7);

    try {
      const isValid = await verifyGoogleOIDCToken(token, projectId);
      if (!isValid) {
        const response: AuthErrorResponse = {
          error: "Unauthorized",
          message: "Invalid or expired token",
        };
        res.status(401).json(response);
        return;
      }

      next();
    } catch (error) {
      logger.error("OIDC token verification failed", { error });
      const response: AuthErrorResponse = {
        error: "Unauthorized",
        message: "Token verification failed",
      };
      res.status(401).json(response);
      return;
    }
  };
}

/**
 * Google OIDC トークンを検証
 * Cloud Schedulerが発行したトークンを検証する
 */
async function verifyGoogleOIDCToken(
  token: string,
  expectedProjectId: string
): Promise<boolean> {
  try {
    // Google のトークン情報エンドポイントでトークンを検証
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    );

    if (!response.ok) {
      logger.warn("Google token info request failed", {
        status: response.status,
      });
      return false;
    }

    const tokenInfo = await response.json() as {
      aud?: string;
      iss?: string;
      exp?: string;
      email?: string;
    };

    // 発行者の検証
    if (
      tokenInfo.iss !== "https://accounts.google.com" &&
      tokenInfo.iss !== "accounts.google.com"
    ) {
      logger.warn("Invalid token issuer", { iss: tokenInfo.iss });
      return false;
    }

    // 有効期限の検証
    const exp = parseInt(tokenInfo.exp || "0", 10);
    if (exp * 1000 < Date.now()) {
      logger.warn("Token has expired", { exp });
      return false;
    }

    // サービスアカウントの検証（Cloud Schedulerのサービスアカウント）
    // 形式: <project-number>-compute@developer.gserviceaccount.com
    // または: <service-account-name>@<project-id>.iam.gserviceaccount.com
    if (tokenInfo.email) {
      const isValidServiceAccount =
        tokenInfo.email.includes(expectedProjectId) ||
        tokenInfo.email.endsWith(".gserviceaccount.com");

      if (!isValidServiceAccount) {
        logger.warn("Invalid service account", { email: tokenInfo.email });
        return false;
      }
    }

    return true;
  } catch (error) {
    logger.error("Error verifying OIDC token", { error });
    return false;
  }
}

/**
 * Authorization ヘッダーからBearerトークンを抽出
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * 内部エンドポイント用の複合認証ミドルウェア
 * API Key または OIDC のいずれかで認証
 */
export function internalAuth(
  apiKey: string | undefined,
  projectId: string | undefined,
  oidcEnabled: boolean
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    // API Keyが提供されている場合はAPI Key認証を試行
    const providedApiKey =
      req.headers["x-api-key"] ||
      extractBearerToken(req.headers.authorization);

    if (providedApiKey && apiKey && providedApiKey === apiKey) {
      next();
      return;
    }

    // OIDC認証が有効な場合はOIDC認証を試行
    if (oidcEnabled && projectId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        try {
          const isValid = await verifyGoogleOIDCToken(token, projectId);
          if (isValid) {
            next();
            return;
          }
        } catch {
          // OIDC認証失敗、続行して最終的にエラーを返す
        }
      }
    }

    // どちらの認証も失敗
    const response: AuthErrorResponse = {
      error: "Unauthorized",
      message: "Valid API key or OIDC token is required",
    };
    res.status(401).json(response);
  };
}

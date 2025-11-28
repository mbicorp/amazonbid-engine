/**
 * シャドーモード
 *
 * 環境変数によって実行モードを制御する機能
 * SHADOWモードでは推奨を計算・記録するが、APIは呼び出さない
 */

import { logger } from "../logger";
import { ExecutionMode } from "./types";

// =============================================================================
// 環境変数
// =============================================================================

/**
 * 実行モードを決定する環境変数名
 */
const EXECUTION_MODE_ENV_VAR = "BID_ENGINE_EXECUTION_MODE";

/**
 * デフォルトの実行モード（安全のためSHADOW）
 */
const DEFAULT_EXECUTION_MODE: ExecutionMode = "SHADOW";

// =============================================================================
// 実行モード判定
// =============================================================================

/**
 * 現在の実行モードを取得
 *
 * 環境変数 BID_ENGINE_EXECUTION_MODE の値に基づいて判定
 * - "APPLY": 実際にAmazon Ads APIを呼び出して入札を適用
 * - "SHADOW" (デフォルト): 推奨は計算・記録するが、APIは呼び出さない
 *
 * @returns 現在の実行モード
 */
export function getExecutionMode(): ExecutionMode {
  const envValue = process.env[EXECUTION_MODE_ENV_VAR];

  if (!envValue) {
    logger.debug("Execution mode not set, using default", {
      default: DEFAULT_EXECUTION_MODE,
    });
    return DEFAULT_EXECUTION_MODE;
  }

  const normalizedValue = envValue.toUpperCase().trim();

  if (normalizedValue === "APPLY") {
    return "APPLY";
  }

  if (normalizedValue === "SHADOW") {
    return "SHADOW";
  }

  // 不明な値の場合は安全のためSHADOWにフォールバック
  logger.warn("Unknown execution mode, falling back to SHADOW", {
    envValue,
    envVar: EXECUTION_MODE_ENV_VAR,
  });
  return "SHADOW";
}

/**
 * シャドーモードかどうかを判定
 *
 * @returns シャドーモードならtrue
 */
export function isShadowMode(): boolean {
  return getExecutionMode() === "SHADOW";
}

/**
 * 適用モードかどうかを判定
 *
 * @returns 適用モードならtrue
 */
export function isApplyMode(): boolean {
  return getExecutionMode() === "APPLY";
}

// =============================================================================
// モード別実行ヘルパー
// =============================================================================

/**
 * モードに応じてAPIを呼び出すかスキップするラッパー
 *
 * @param applyFn - APPLYモード時に実行する関数
 * @param shadowFn - SHADOWモード時に実行する関数（オプション）
 * @returns 実行結果
 */
export async function executeWithMode<T>(
  applyFn: () => Promise<T>,
  shadowFn?: () => Promise<T>
): Promise<{ result: T | null; wasApplied: boolean }> {
  const mode = getExecutionMode();

  if (mode === "APPLY") {
    const result = await applyFn();
    return { result, wasApplied: true };
  }

  // SHADOWモード
  if (shadowFn) {
    const result = await shadowFn();
    return { result, wasApplied: false };
  }

  return { result: null, wasApplied: false };
}

/**
 * 入札適用をモードに応じて実行
 *
 * @param applyBidFn - 入札を適用する関数
 * @param keywordInfo - ログ用のキーワード情報
 * @returns 適用されたかどうか
 */
export async function applyBidWithMode(
  applyBidFn: () => Promise<void>,
  keywordInfo: {
    keywordId?: string;
    keywordText: string;
    oldBid: number;
    newBid: number;
  }
): Promise<{ wasApplied: boolean; error?: Error }> {
  const mode = getExecutionMode();

  if (mode === "SHADOW") {
    logger.debug("Shadow mode: skipping bid apply", {
      ...keywordInfo,
      mode,
    });
    return { wasApplied: false };
  }

  // APPLYモード
  try {
    await applyBidFn();
    logger.debug("Bid applied successfully", {
      ...keywordInfo,
      mode,
    });
    return { wasApplied: true };
  } catch (error) {
    logger.error("Failed to apply bid", {
      ...keywordInfo,
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      wasApplied: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

// =============================================================================
// モード情報ロギング
// =============================================================================

/**
 * 起動時に実行モードをログ出力
 *
 * エンジン起動時に呼び出すことを推奨
 */
export function logExecutionModeOnStartup(): void {
  const mode = getExecutionMode();

  if (mode === "SHADOW") {
    logger.info("Bid engine starting in SHADOW mode", {
      mode,
      description: "Recommendations will be calculated and logged but NOT applied to Amazon Ads",
      envVar: EXECUTION_MODE_ENV_VAR,
      tip: `Set ${EXECUTION_MODE_ENV_VAR}=APPLY to enable actual bid changes`,
    });
  } else {
    logger.info("Bid engine starting in APPLY mode", {
      mode,
      description: "Recommendations WILL be applied to Amazon Ads API",
      warning: "This will modify actual bid amounts",
    });
  }
}

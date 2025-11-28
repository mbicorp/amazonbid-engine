/**
 * 監視・アラート - 設定ローダー
 *
 * 環境変数からアラート設定を読み込む
 */

import {
  AlertConfig,
  AlertThresholds,
  DEFAULT_ALERT_CONFIG,
  DEFAULT_ALERT_THRESHOLDS,
} from "./types";

// =============================================================================
// 環境変数名
// =============================================================================

/**
 * 環境変数名の定義
 */
export const ALERT_ENV_VARS = {
  /** アラート機能の有効/無効 */
  ENABLED: "ALERT_ENABLED",

  /** 正常時もサマリーを送信するか */
  SEND_SUMMARY_ON_SUCCESS: "ALERT_SEND_SUMMARY_ON_SUCCESS",

  /** アラート送信先チャンネル */
  ALERT_CHANNEL: "ALERT_SLACK_CHANNEL",

  // ----- 閾値 -----
  /** DOWN比率の上限 */
  MAX_DOWN_RATIO: "ALERT_MAX_DOWN_RATIO",

  /** UP比率の上限 */
  MAX_UP_RATIO: "ALERT_MAX_UP_RATIO",

  /** ガードレールクリップ比率の上限 */
  MAX_GUARDRAILS_CLIPPED_RATIO: "ALERT_MAX_GUARDRAILS_CLIPPED_RATIO",

  /** 適用失敗比率の上限 */
  MAX_APPLY_FAILED_RATIO: "ALERT_MAX_APPLY_FAILED_RATIO",

  /** 適用失敗件数の絶対上限 */
  MAX_APPLY_FAILED_COUNT: "ALERT_MAX_APPLY_FAILED_COUNT",

  /** 最大入札変更率の上限（倍率） */
  MAX_BID_CHANGE_RATIO: "ALERT_MAX_BID_CHANGE_RATIO",

  /** 強いUP判定の閾値（%） */
  STRONG_UP_THRESHOLD_PERCENT: "ALERT_STRONG_UP_THRESHOLD_PERCENT",

  /** 強いDOWN判定の閾値（%） */
  STRONG_DOWN_THRESHOLD_PERCENT: "ALERT_STRONG_DOWN_THRESHOLD_PERCENT",
} as const;

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 環境変数からブール値を取得
 */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return value.toLowerCase() === "true" || value === "1";
}

/**
 * 環境変数から数値を取得
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = parseFloat(value);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

/**
 * 環境変数から文字列を取得
 */
function getEnvString(key: string): string | undefined {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

// =============================================================================
// 設定ローダー
// =============================================================================

/**
 * 環境変数からアラート閾値を読み込む
 */
export function loadAlertThresholds(): AlertThresholds {
  return {
    maxDownRatio: getEnvNumber(
      ALERT_ENV_VARS.MAX_DOWN_RATIO,
      DEFAULT_ALERT_THRESHOLDS.maxDownRatio
    ),
    maxUpRatio: getEnvNumber(
      ALERT_ENV_VARS.MAX_UP_RATIO,
      DEFAULT_ALERT_THRESHOLDS.maxUpRatio
    ),
    maxGuardrailsClippedRatio: getEnvNumber(
      ALERT_ENV_VARS.MAX_GUARDRAILS_CLIPPED_RATIO,
      DEFAULT_ALERT_THRESHOLDS.maxGuardrailsClippedRatio
    ),
    maxApplyFailedRatio: getEnvNumber(
      ALERT_ENV_VARS.MAX_APPLY_FAILED_RATIO,
      DEFAULT_ALERT_THRESHOLDS.maxApplyFailedRatio
    ),
    maxApplyFailedCount: getEnvNumber(
      ALERT_ENV_VARS.MAX_APPLY_FAILED_COUNT,
      DEFAULT_ALERT_THRESHOLDS.maxApplyFailedCount
    ),
    maxBidChangeRatio: getEnvNumber(
      ALERT_ENV_VARS.MAX_BID_CHANGE_RATIO,
      DEFAULT_ALERT_THRESHOLDS.maxBidChangeRatio
    ),
    strongUpThresholdPercent: getEnvNumber(
      ALERT_ENV_VARS.STRONG_UP_THRESHOLD_PERCENT,
      DEFAULT_ALERT_THRESHOLDS.strongUpThresholdPercent
    ),
    strongDownThresholdPercent: getEnvNumber(
      ALERT_ENV_VARS.STRONG_DOWN_THRESHOLD_PERCENT,
      DEFAULT_ALERT_THRESHOLDS.strongDownThresholdPercent
    ),
  };
}

/**
 * 環境変数からアラート設定を読み込む
 */
export function loadAlertConfig(): AlertConfig {
  return {
    enabled: getEnvBoolean(ALERT_ENV_VARS.ENABLED, DEFAULT_ALERT_CONFIG.enabled),
    thresholds: loadAlertThresholds(),
    sendSummaryOnSuccess: getEnvBoolean(
      ALERT_ENV_VARS.SEND_SUMMARY_ON_SUCCESS,
      DEFAULT_ALERT_CONFIG.sendSummaryOnSuccess
    ),
    alertChannel: getEnvString(ALERT_ENV_VARS.ALERT_CHANNEL),
  };
}

/**
 * 現在のアラート設定を取得（シングルトン的に使用）
 */
let cachedConfig: AlertConfig | null = null;

export function getAlertConfig(): AlertConfig {
  if (!cachedConfig) {
    cachedConfig = loadAlertConfig();
  }
  return cachedConfig;
}

/**
 * キャッシュをクリア（テスト用）
 */
export function clearAlertConfigCache(): void {
  cachedConfig = null;
}

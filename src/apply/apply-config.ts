/**
 * APPLY モード設定ローダー
 *
 * 環境変数からAPPLY安全制限設定を読み込む
 */

import { logger } from "../logger";
import {
  ApplySafetyConfig,
  DEFAULT_APPLY_SAFETY_CONFIG,
} from "./types";

// =============================================================================
// 環境変数名
// =============================================================================

/**
 * 1回のジョブ実行で実際にAPIへ送ってよいbid更新件数の上限
 */
const MAX_APPLY_CHANGES_PER_RUN_ENV = "MAX_APPLY_CHANGES_PER_RUN";

/**
 * APPLYを許可するcampaignIdのリスト（カンマ区切り）
 */
const APPLY_CAMPAIGN_ALLOWLIST_ENV = "APPLY_CAMPAIGN_ALLOWLIST";

/**
 * APPLYに必要な最小変更幅（円）
 */
const MIN_APPLY_CHANGE_AMOUNT_ENV = "MIN_APPLY_CHANGE_AMOUNT";

/**
 * APPLYに必要な最小変更率（比率、例: 0.01 = 1%）
 */
const MIN_APPLY_CHANGE_RATIO_ENV = "MIN_APPLY_CHANGE_RATIO";

// =============================================================================
// 設定ローダー
// =============================================================================

/**
 * 環境変数からAPPLY安全制限設定を読み込む
 *
 * 環境変数:
 * - MAX_APPLY_CHANGES_PER_RUN: 1回のジョブで送ってよい件数（デフォルト: 100）
 * - APPLY_CAMPAIGN_ALLOWLIST: 許可キャンペーンIDリスト（カンマ区切り、デフォルト: 空）
 * - MIN_APPLY_CHANGE_AMOUNT: 最小変更幅（円）（デフォルト: 1）
 * - MIN_APPLY_CHANGE_RATIO: 最小変更率（デフォルト: 0.01 = 1%）
 *
 * @returns ApplySafetyConfig
 */
export function loadApplySafetyConfig(): ApplySafetyConfig {
  const config: ApplySafetyConfig = { ...DEFAULT_APPLY_SAFETY_CONFIG };

  // MAX_APPLY_CHANGES_PER_RUN
  const maxApplyChangesEnv = process.env[MAX_APPLY_CHANGES_PER_RUN_ENV];
  if (maxApplyChangesEnv) {
    const parsed = parseInt(maxApplyChangesEnv, 10);
    if (!isNaN(parsed) && parsed > 0) {
      config.maxApplyChangesPerRun = parsed;
    } else {
      logger.warn(`Invalid ${MAX_APPLY_CHANGES_PER_RUN_ENV}, using default`, {
        envValue: maxApplyChangesEnv,
        default: DEFAULT_APPLY_SAFETY_CONFIG.maxApplyChangesPerRun,
      });
    }
  }

  // APPLY_CAMPAIGN_ALLOWLIST
  const allowlistEnv = process.env[APPLY_CAMPAIGN_ALLOWLIST_ENV];
  if (allowlistEnv) {
    // カンマ区切りでパース、空白をトリム、空文字を除外
    const parsed = allowlistEnv
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    config.applyCampaignAllowlist = parsed;
  }

  // MIN_APPLY_CHANGE_AMOUNT
  const minAmountEnv = process.env[MIN_APPLY_CHANGE_AMOUNT_ENV];
  if (minAmountEnv) {
    const parsed = parseFloat(minAmountEnv);
    if (!isNaN(parsed) && parsed >= 0) {
      config.minApplyChangeAmount = parsed;
    } else {
      logger.warn(`Invalid ${MIN_APPLY_CHANGE_AMOUNT_ENV}, using default`, {
        envValue: minAmountEnv,
        default: DEFAULT_APPLY_SAFETY_CONFIG.minApplyChangeAmount,
      });
    }
  }

  // MIN_APPLY_CHANGE_RATIO
  const minRatioEnv = process.env[MIN_APPLY_CHANGE_RATIO_ENV];
  if (minRatioEnv) {
    const parsed = parseFloat(minRatioEnv);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      config.minApplyChangeRatio = parsed;
    } else {
      logger.warn(`Invalid ${MIN_APPLY_CHANGE_RATIO_ENV}, using default`, {
        envValue: minRatioEnv,
        default: DEFAULT_APPLY_SAFETY_CONFIG.minApplyChangeRatio,
      });
    }
  }

  return config;
}

/**
 * APPLY設定を起動時にログ出力
 */
export function logApplySafetyConfigOnStartup(config: ApplySafetyConfig): void {
  logger.info("APPLY safety config loaded", {
    maxApplyChangesPerRun: config.maxApplyChangesPerRun,
    applyCampaignAllowlistCount: config.applyCampaignAllowlist.length,
    applyCampaignAllowlist:
      config.applyCampaignAllowlist.length > 0
        ? config.applyCampaignAllowlist.slice(0, 5).join(", ") +
          (config.applyCampaignAllowlist.length > 5 ? "..." : "")
        : "(empty - all campaigns will be SHADOW)",
    minApplyChangeAmount: config.minApplyChangeAmount,
    minApplyChangeRatio: config.minApplyChangeRatio,
  });

  // allowlist が空の場合は警告
  if (config.applyCampaignAllowlist.length === 0) {
    logger.warn(
      "APPLY_CAMPAIGN_ALLOWLIST is empty - all campaigns will be treated as SHADOW even in APPLY mode",
      {
        tip: `Set ${APPLY_CAMPAIGN_ALLOWLIST_ENV}=campaign_id_1,campaign_id_2 to enable APPLY for specific campaigns`,
      }
    );
  }
}

/**
 * 環境変数テンプレートを出力（デバッグ用）
 */
export function printApplyConfigTemplate(): void {
  console.log(`
# APPLY モード安全制限設定

# 1回のジョブ実行で実際にAPIへ送ってよいbid更新件数の上限
# デフォルト: 100
MAX_APPLY_CHANGES_PER_RUN=100

# APPLYを許可するcampaignIdのリスト（カンマ区切り）
# 空の場合は全キャンペーンがSHADOW扱い
# 例: APPLY_CAMPAIGN_ALLOWLIST=12345678901234,98765432109876
APPLY_CAMPAIGN_ALLOWLIST=

# APPLYに必要な最小変更幅（円）
# デフォルト: 1
MIN_APPLY_CHANGE_AMOUNT=1

# APPLYに必要な最小変更率（比率）
# 例: 0.01 = 1%未満の変更はスキップ
# デフォルト: 0.01
MIN_APPLY_CHANGE_RATIO=0.01
  `);
}

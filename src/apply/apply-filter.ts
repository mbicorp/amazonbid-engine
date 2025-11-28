/**
 * APPLY フィルター
 *
 * Bid推奨値をAmazon Ads APIに適用する前のフィルタリングロジック
 * 安全設計に基づいて、どの推奨を実際にAPIに送るかを判定
 */

import { logger } from "../logger";
import {
  ApplySafetyConfig,
  ApplyCandidateResult,
  ApplySkipReason,
  DEFAULT_APPLY_SAFETY_CONFIG,
} from "./types";

// =============================================================================
// APPLY 候補判定
// =============================================================================

/**
 * 単一の推奨がAPPLY候補かどうかを判定
 *
 * 以下の条件をすべて満たす場合にAPPLY候補となる:
 * 1. キャンペーンが allowlist に含まれている（allowlistが空の場合は全て対象外）
 * 2. 変更幅が minApplyChangeAmount 以上
 * 3. 変更率が minApplyChangeRatio 以上
 *
 * @param campaignId - キャンペーンID
 * @param oldBid - 変更前の入札額
 * @param newBid - 推奨入札額
 * @param config - APPLY安全制限設定
 * @returns APPLY候補判定結果（isCandidate と skipReason）
 */
export function checkApplyCandidate(
  campaignId: string,
  oldBid: number,
  newBid: number,
  config: ApplySafetyConfig = DEFAULT_APPLY_SAFETY_CONFIG
): { isCandidate: boolean; skipReason?: ApplySkipReason } {
  // 1. allowlist チェック
  // allowlist が空の場合は「全キャンペーン SHADOW 扱い」（明示的に入れたものだけ APPLY）
  if (config.applyCampaignAllowlist.length === 0) {
    return {
      isCandidate: false,
      skipReason: "NOT_IN_ALLOWLIST",
    };
  }

  if (!config.applyCampaignAllowlist.includes(campaignId)) {
    return {
      isCandidate: false,
      skipReason: "NOT_IN_ALLOWLIST",
    };
  }

  // 2. 変更幅チェック
  const changeAmount = Math.abs(newBid - oldBid);
  if (changeAmount < config.minApplyChangeAmount) {
    return {
      isCandidate: false,
      skipReason: "NO_SIGNIFICANT_CHANGE",
    };
  }

  // 3. 変更率チェック
  if (oldBid > 0) {
    const changeRatio = Math.abs((newBid - oldBid) / oldBid);
    if (changeRatio < config.minApplyChangeRatio) {
      return {
        isCandidate: false,
        skipReason: "NO_SIGNIFICANT_CHANGE",
      };
    }
  }

  return { isCandidate: true };
}

// =============================================================================
// バッチフィルタリング
// =============================================================================

/**
 * フィルタリング対象の推奨アイテム
 */
export interface ApplyFilterItem {
  /** 一意識別子（keywordIdなど） */
  id: string;
  /** キャンペーンID */
  campaignId: string;
  /** 変更前の入札額 */
  oldBid: number;
  /** 推奨入札額 */
  newBid: number;
}

/**
 * フィルタリング結果
 */
export interface ApplyFilterResult<T extends ApplyFilterItem> {
  /** APPLY対象（max_apply_changes_per_run内） */
  toApply: T[];
  /** APPLY対象外（全スキップ分） */
  skipped: Array<T & { skipReason: ApplySkipReason }>;
}

/**
 * 推奨リストをフィルタリングしてAPPLY対象を決定
 *
 * 処理フロー:
 * 1. 各推奨について checkApplyCandidate でAPPLY候補かを判定
 * 2. APPLY候補を max_apply_changes_per_run までに制限
 * 3. 制限を超えた分は APPLY_LIMIT_REACHED でスキップ
 *
 * @param items - フィルタリング対象の推奨リスト
 * @param config - APPLY安全制限設定
 * @returns フィルタリング結果（toApply と skipped）
 */
export function filterApplyCandidates<T extends ApplyFilterItem>(
  items: T[],
  config: ApplySafetyConfig = DEFAULT_APPLY_SAFETY_CONFIG
): ApplyFilterResult<T> {
  const toApply: T[] = [];
  const skipped: Array<T & { skipReason: ApplySkipReason }> = [];

  let appliedCount = 0;

  for (const item of items) {
    // 1. APPLY候補判定
    const { isCandidate, skipReason } = checkApplyCandidate(
      item.campaignId,
      item.oldBid,
      item.newBid,
      config
    );

    if (!isCandidate) {
      skipped.push({ ...item, skipReason: skipReason! });
      continue;
    }

    // 2. max_apply_changes_per_run チェック
    if (appliedCount >= config.maxApplyChangesPerRun) {
      skipped.push({ ...item, skipReason: "APPLY_LIMIT_REACHED" });
      continue;
    }

    // 3. APPLY対象に追加
    toApply.push(item);
    appliedCount++;
  }

  logger.debug("Apply filter completed", {
    totalItems: items.length,
    toApplyCount: toApply.length,
    skippedCount: skipped.length,
    maxApplyChangesPerRun: config.maxApplyChangesPerRun,
  });

  return { toApply, skipped };
}

// =============================================================================
// ユーティリティ
// =============================================================================

/**
 * キャンペーンがallowlistに含まれているかチェック
 */
export function isCampaignInAllowlist(
  campaignId: string,
  allowlist: string[]
): boolean {
  // allowlist が空の場合は全て対象外
  if (allowlist.length === 0) {
    return false;
  }
  return allowlist.includes(campaignId);
}

/**
 * 変更が有意かどうかをチェック
 */
export function isSignificantChange(
  oldBid: number,
  newBid: number,
  minChangeAmount: number,
  minChangeRatio: number
): boolean {
  const changeAmount = Math.abs(newBid - oldBid);
  if (changeAmount < minChangeAmount) {
    return false;
  }

  if (oldBid > 0) {
    const changeRatio = Math.abs((newBid - oldBid) / oldBid);
    if (changeRatio < minChangeRatio) {
      return false;
    }
  }

  return true;
}

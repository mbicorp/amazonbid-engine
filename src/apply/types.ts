/**
 * APPLY モード安全設計 - 型定義
 *
 * Bid推奨値をAmazon Ads APIに適用する際の安全制御に関する型定義
 */

// =============================================================================
// APPLY スキップ理由
// =============================================================================

/**
 * APPLY をスキップした理由
 */
export type ApplySkipReason =
  | "SHADOW_MODE"                // SHADOWモードのためスキップ
  | "NOT_IN_ALLOWLIST"           // キャンペーンがallowlistに含まれていない
  | "APPLY_LIMIT_REACHED"        // max_apply_changes_per_run の上限に達した
  | "NO_SIGNIFICANT_CHANGE"      // 変更幅が閾値未満
  | "API_ERROR";                 // API呼び出しエラー

/**
 * 有効な ApplySkipReason の一覧
 */
export const VALID_APPLY_SKIP_REASONS: readonly ApplySkipReason[] = [
  "SHADOW_MODE",
  "NOT_IN_ALLOWLIST",
  "APPLY_LIMIT_REACHED",
  "NO_SIGNIFICANT_CHANGE",
  "API_ERROR",
] as const;

// =============================================================================
// APPLY 設定
// =============================================================================

/**
 * APPLY モードの安全制限設定
 */
export interface ApplySafetyConfig {
  /**
   * 1回のジョブ実行で実際にAPIへ送ってよいbid更新件数の上限
   *
   * この上限を超える分は「計算はするが、APIには送らない」
   * 環境変数: MAX_APPLY_CHANGES_PER_RUN
   * デフォルト: 100件
   */
  maxApplyChangesPerRun: number;

  /**
   * APPLYを許可するcampaignIdのリスト
   *
   * 空の場合は「全キャンペーンSHADOW扱い」（明示的にallowlistに入れたキャンペーンだけAPPLY）
   * 環境変数: APPLY_CAMPAIGN_ALLOWLIST (カンマ区切り)
   * デフォルト: 空配列
   */
  applyCampaignAllowlist: string[];

  /**
   * APPLYに必要な最小変更幅（円）
   *
   * 変更幅がこの値未満の場合はスキップ
   * 環境変数: MIN_APPLY_CHANGE_AMOUNT
   * デフォルト: 1円
   */
  minApplyChangeAmount: number;

  /**
   * APPLYに必要な最小変更率（比率）
   *
   * 変更率がこの値未満の場合はスキップ
   * 例: 0.01 = 1%未満の変更はスキップ
   * 環境変数: MIN_APPLY_CHANGE_RATIO
   * デフォルト: 0.01 (1%)
   */
  minApplyChangeRatio: number;
}

/**
 * デフォルトのAPPLY安全制限設定
 */
export const DEFAULT_APPLY_SAFETY_CONFIG: ApplySafetyConfig = {
  maxApplyChangesPerRun: 100,
  applyCampaignAllowlist: [],
  minApplyChangeAmount: 1,
  minApplyChangeRatio: 0.01,
};

// =============================================================================
// APPLY 候補判定結果
// =============================================================================

/**
 * APPLY候補判定結果
 */
export interface ApplyCandidateResult {
  /**
   * APPLY候補かどうか
   *
   * true: allowlist に含まれており、変更幅がしきい値以上
   * false: 上記条件を満たさない
   */
  isCandidate: boolean;

  /**
   * 実際にAPIに適用されたかどうか
   *
   * APPLYモードで、かつisCandidate=trueで、
   * かつ max_apply_changes_per_run の上限内で、
   * かつAPI呼び出しが成功した場合のみ true
   */
  isApplied: boolean;

  /**
   * スキップ理由（スキップされた場合のみ）
   */
  skipReason?: ApplySkipReason;

  /**
   * APIエラーメッセージ（エラー発生時のみ）
   */
  apiError?: string;
}

// =============================================================================
// APPLY 実行統計
// =============================================================================

/**
 * APPLY 実行統計
 */
export interface ApplyExecutionStats {
  /**
   * 全推奨件数
   */
  totalRecommendations: number;

  /**
   * APPLY候補件数（allowlistに含まれ、変更幅がしきい値以上）
   */
  totalApplyCandidates: number;

  /**
   * 実際にAPIに送った件数
   */
  totalApplied: number;

  /**
   * API呼び出し失敗件数
   */
  totalApplyFailed: number;

  /**
   * スキップ理由別件数
   */
  skipReasonCounts: Record<ApplySkipReason, number>;
}

/**
 * 空の APPLY 実行統計を作成
 */
export function createEmptyApplyExecutionStats(): ApplyExecutionStats {
  return {
    totalRecommendations: 0,
    totalApplyCandidates: 0,
    totalApplied: 0,
    totalApplyFailed: 0,
    skipReasonCounts: {
      SHADOW_MODE: 0,
      NOT_IN_ALLOWLIST: 0,
      APPLY_LIMIT_REACHED: 0,
      NO_SIGNIFICANT_CHANGE: 0,
      API_ERROR: 0,
    },
  };
}

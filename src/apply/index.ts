/**
 * APPLY モード安全設計モジュール
 *
 * Bid推奨値をAmazon Ads APIに適用する際の安全制御
 *
 * 主要エクスポート:
 * - loadApplySafetyConfig: 環境変数から設定を読み込む
 * - filterApplyCandidates: 推奨リストをフィルタリング
 * - checkApplyCandidate: 単一推奨のAPPLY候補判定
 */

// =============================================================================
// 型定義
// =============================================================================

export {
  // スキップ理由
  ApplySkipReason,
  VALID_APPLY_SKIP_REASONS,
  // 設定
  ApplySafetyConfig,
  DEFAULT_APPLY_SAFETY_CONFIG,
  // 候補判定結果
  ApplyCandidateResult,
  // 実行統計
  ApplyExecutionStats,
  createEmptyApplyExecutionStats,
} from "./types";

// =============================================================================
// 設定ローダー
// =============================================================================

export {
  loadApplySafetyConfig,
  logApplySafetyConfigOnStartup,
  printApplyConfigTemplate,
} from "./apply-config";

// =============================================================================
// フィルターロジック
// =============================================================================

export {
  // メインフィルター
  checkApplyCandidate,
  filterApplyCandidates,
  // 型
  ApplyFilterItem,
  ApplyFilterResult,
  // ユーティリティ
  isCampaignInAllowlist,
  isSignificantChange,
} from "./apply-filter";

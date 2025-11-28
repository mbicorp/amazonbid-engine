/**
 * Budget（日予算）最適化モジュール
 *
 * 「予算によるインプレッションシェア損失（Lost IS Budget）」と「ACOSの健全性」に基づいて
 * キャンペーンの日予算を動的に最適化
 *
 * コアコンセプト:
 * 「予算が足りない（Usageが高い または Lost ISがある）」かつ「利益が出ている（ACOSが低い）」
 * 場合のみ、予算を引き上げる。無駄遣いしているキャンペーンの予算は増やさない。
 *
 * 主要エクスポート:
 * - runBudgetEngine: メインエンジン実行関数
 * - computeBudgetRecommendation: 純粋関数（単一推奨計算）
 * - BudgetBigQueryAdapter: BigQuery 連携アダプター
 */

// =============================================================================
// 型定義
// =============================================================================

export {
  // アクション
  BudgetAction,
  VALID_BUDGET_ACTIONS,
  isValidBudgetAction,
  // 理由コード
  BudgetReasonCode,
  VALID_BUDGET_REASON_CODES,
  // メトリクス
  BudgetMetrics,
  // 推奨
  BudgetRecommendation,
  // 設定
  BudgetOptimizerConfig,
  DEFAULT_BUDGET_OPTIMIZER_CONFIG,
  // 実行結果
  BudgetEngineResult,
  // BigQuery 行型
  CampaignBudgetMetricsRow,
  BudgetRecommendationRow,
} from "./types";

// =============================================================================
// 計算ロジック（純粋関数）
// =============================================================================

export {
  // メイン計算関数
  computeBudgetRecommendation,
  computeBudgetRecommendations,
  // 統計ヘルパー
  countBudgetActions,
  calculateTotalBudgetChange,
} from "./budget-calculator";

// =============================================================================
// BigQuery アダプター
// =============================================================================

export {
  BudgetBigQueryAdapter,
  BudgetBigQueryAdapterOptions,
  createBudgetBigQueryAdapter,
} from "./bigquery-adapter";

// =============================================================================
// エンジン
// =============================================================================

export {
  // エンジン実行
  runBudgetEngine,
  BudgetEngineConfig,
  // ユーティリティ
  logBudgetExecutionModeOnStartup,
  logBudgetOptimizerConfigOnStartup,
} from "./budget-engine";

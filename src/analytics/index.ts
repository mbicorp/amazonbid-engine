/**
 * 分析モジュール
 *
 * ASIN別のTACOS最適化、利益分析、投資健全性評価などの分析機能を提供
 */

// T_opt推定（利益最大化TACOS）
export {
  // 型定義
  DailyTacosData,
  OptimalTacosConfig,
  LifecycleTacosConfig,
  OptimalTacosResult,
  LifecycleTacosTargets,
  LaunchInvestmentMetrics,
  AsinTacosOptimization,
  // デフォルト設定
  DEFAULT_OPTIMAL_TACOS_CONFIG,
  DEFAULT_LIFECYCLE_TACOS_CONFIG,
  // 主要関数
  estimateTopt,
  calculateLifecycleTacosTargets,
  calculateLaunchInvestment,
  optimizeAsinTacos,
  // ユーティリティ関数
  getTacosTargetForStage,
  calculateNetMargin,
  calculateDailyNetProfit,
  calculatePeriodNetProfit,
} from "./optimalTacos";

// lossBudget評価（ASIN投資健全性）
export {
  // 列挙型
  InvestmentState,
  // 型定義
  AsinPeriodPerformance,
  LifecycleLossBudgetMultiples,
  LossBudgetConfig,
  AsinLossBudgetMetrics,
  AsinLossBudgetMap,
  ActionConstraints,
  // LossBudgetState（簡易3状態）
  LossBudgetState,
  LossBudgetSummary,
  LossBudgetStateConfig,
  // デフォルト設定
  DEFAULT_LOSS_BUDGET_CONFIG,
  DEFAULT_ACTION_CONSTRAINTS,
  DEFAULT_LOSS_BUDGET_STATE_CONFIG,
  // 主要関数
  evaluateAsinLossBudget,
  evaluateAllAsins,
  getActionConstraints,
  // ヘルパー関数
  getLossBudgetMultiple,
  determineInvestmentState,
  // LossBudgetState関連関数
  investmentStateToLossBudgetState,
  resolveLossBudgetState,
  createLossBudgetSummary,
  isLossBudgetCritical,
  isLossBudgetWarningOrCritical,
  // ユーティリティ関数
  isWarningState,
  isCriticalState,
  shouldConsiderLifecycleTransition,
  generateAlertSummary,
} from "./lossBudgetEvaluator";

// lossBudgetリポジトリ（BigQueryデータ取得）
export {
  // 型定義
  LossBudgetRepositoryOptions,
  RollingSummaryRow,
  LaunchInvestSummaryRow,
  AsinLossBudgetData,
  // クラス
  LossBudgetRepository,
  // ファクトリ関数
  createLossBudgetRepository,
  // ユーティリティ関数
  filterByLossBudgetState,
  getCriticalAsins,
  getWarningOrCriticalAsins,
} from "./lossBudgetRepository";

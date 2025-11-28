/**
 * 統合入札戦略エンジン
 *
 * Jungle Scout（市場データ）+ SP-API（商品収益性）+ Amazon Ads（広告パフォーマンス）
 * を統合した入札戦略を提供する
 */

// 型定義
export * from "./types";

// 設定
export {
  DEFAULT_UNIFIED_CONFIG,
  STRATEGY_MATRIX,
  getStrategyMatrixCell,
  determineProductLifecycle,
  recommendProductStrategy,
  UNIFIED_BIGQUERY_TABLES,
} from "./config";

// 戦略計算
export {
  calculateDynamicAcos,
  calculatePriorityScore,
  calculateUnifiedStrategy,
  calculateUnifiedStrategiesForAsin,
  generateUnifiedStrategySummary,
} from "./strategy-calculator";

// BigQueryアダプター
export {
  saveProductProfitability,
  getLatestProductProfitability,
  saveUnifiedStrategies,
  getLatestUnifiedStrategies,
  getUnifiedStrategiesByAction,
  saveStrategySummary,
  getLatestStrategySummary,
  getActionSummaryByAsin,
} from "./bigquery-adapter";

// SEO投資戦略（赤字許容モード）
export {
  DEFAULT_SEO_INVESTMENT_CONFIG,
  evaluateSeoInvestmentOpportunity,
  calculateDynamicInvestmentLimit,
  updateSeoInvestmentState,
  calculateSeoInvestmentAcosLimit,
  generateSeoInvestmentSummary,
} from "./seo-investment";

/**
 * バックテストモジュール
 *
 * 過去データを使って入札エンジンの成果をシミュレーション
 * 「このエンジンを使っていたら、実際と比べてどれだけ成果が改善していたか」を定量的に証明
 */

// 型定義
export {
  BacktestConfig,
  BacktestParameters,
  DEFAULT_BACKTEST_PARAMETERS,
  BacktestResult,
  HistoricalRecommendation,
  HistoricalPerformance,
  SimulatedResult,
  DailyAggregate,
  ActionAccuracy,
  DecisionAccuracy,
  PeriodSummary,
  PerformanceSummary,
  ImprovementSummary,
  BacktestTimeSeriesEntry,
  BacktestExecutionSummary,
  BacktestNotificationData,
  BacktestErrorCode,
  BacktestErrorCodeType,
} from "./types";

// バックテストエンジン
export {
  runBacktest,
  runWeeklyBacktest,
  RunBacktestOptions,
} from "./backtest-engine";

// 計算関数
export {
  simulateKeywordDay,
  evaluateDecisionCorrectness,
  aggregateByDay,
  aggregateByWeek,
  calculateDecisionAccuracy,
  toTimeSeriesEntries,
  calculateImprovement,
  calculateDaysBetween,
  isValidDateRange,
} from "./backtest-calculator";

// BigQueryアダプター
export {
  BACKTEST_TABLES,
  fetchHistoricalRecommendations,
  fetchHistoricalPerformance,
  saveBacktestExecution,
  saveBacktestDailyDetails,
  fetchBacktestExecutions,
  fetchBacktestExecution,
  fetchBacktestDailyDetails,
  createBacktestTables,
} from "./bigquery-adapter";

// レポート生成
export {
  sendBacktestNotification,
  formatBacktestSlackMessage,
  generateConsoleReport,
  exportToJson,
  exportTimeSeriesDataToCsv,
  toNotificationData,
} from "./report-generator";

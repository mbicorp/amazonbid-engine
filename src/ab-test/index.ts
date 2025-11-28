/**
 * A/Bテストモジュール
 *
 * 入札ロジックの変更を安全にテストするための機能を提供
 * グループ割り当て、統計的有意性検定、効果量計算をサポート
 */

// 型定義
export {
  // 基本型
  ABTestStatus,
  AssignmentLevel,
  TestGroup,
  VALID_AB_TEST_STATUSES,
  VALID_ASSIGNMENT_LEVELS,
  VALID_TEST_GROUPS,
  isValidABTestStatus,
  isValidAssignmentLevel,
  isValidTestGroup,
  // オーバーライド設定
  BidEngineOverrides,
  DEFAULT_BID_ENGINE_OVERRIDES,
  // テスト設定
  ABTestConfig,
  ABTestTargetFilters,
  // グループ割り当て
  ABTestAssignment,
  // メトリクス
  ABTestDailyMetrics,
  ABTestMetricsAggregate,
  // 統計評価
  SignificanceLevel,
  TTestResult,
  EffectSizeInterpretation,
  EffectSizeResult,
  MetricEvaluationResult,
  ABTestEvaluationResult,
  // BigQueryレコード
  ABTestRecord,
  ABTestAssignmentRecord,
  ABTestDailyMetricsRecord,
  ABTestEvaluationRecord,
  // エラーコード
  ABTestErrorCode,
  ABTestErrorCodeType,
  // 通知
  ABTestNotificationData,
  // 定数
  AB_TEST_CONSTANTS,
} from "./types";

// グループ割り当て
export {
  murmurhash3_32,
  normalizeHash,
  createAssignmentKey,
  determineGroup,
  assignToGroup,
  assignMultipleToGroups,
  calculateAssignmentStats,
  validateAssignmentDistribution,
  CachedGroupAssigner,
  createAssigner,
} from "./ab-test-assigner";

// テスト管理
export {
  CreateTestOptions,
  UpdateTestOptions,
  validateCreateTestOptions,
  validateOverrides,
  createTestConfig,
  updateTestConfig,
  startTest,
  pauseTest,
  completeTest,
  cancelTest,
  mergeOverrides,
  getOverridesForGroup,
  isEntityTargeted,
  isTestInValidPeriod,
  getRemainingDays,
  getElapsedDays,
  ABTestManager,
  getABTestManager,
  resetABTestManager,
} from "./ab-test-manager";

// 統計評価
export {
  normalCdf,
  tCdf,
  standardError,
  welchTTest,
  calculateCohensD,
  calculateRequiredSampleSize,
  calculatePower,
  evaluateMetric,
  evaluateABTest,
  toNotificationData,
  formatSlackMessage,
} from "./ab-test-evaluator";

// BigQueryアダプター
export {
  BigQueryConfig,
  AB_TEST_TABLES,
  configToRecord,
  recordToConfig,
  assignmentToRecord,
  recordToAssignment,
  metricsToRecord,
  recordToMetrics,
  evaluationToRecord,
  createABTestTables,
  saveTest,
  updateTest,
  fetchTest,
  fetchTests,
  fetchRunningTests,
  saveAssignments,
  fetchAssignments,
  fetchAssignment,
  saveDailyMetrics,
  fetchDailyMetrics,
  fetchMetricsAggregate,
  saveEvaluation,
  fetchEvaluations,
  fetchLatestEvaluation,
} from "./bigquery-adapter";

/**
 * ログ記録モジュール
 *
 * 入札エンジン実行のログを記録する機能を提供
 */

// 型定義
export {
  ExecutionMode,
  ExecutionStatus,
  TriggerSource,
  ExecutionLogEntry,
  KeywordRecommendationLogEntry,
  ReasonCode,
  ApplySkipReason,
} from "./types";

// ExecutionLogger
export {
  ExecutionLogger,
  ExecutionLoggerOptions,
  ExecutionStats,
  createExecutionLogger,
} from "./executionLogger";

// シャドーモード
export {
  getExecutionMode,
  isShadowMode,
  isApplyMode,
  executeWithMode,
  applyBidWithMode,
  logExecutionModeOnStartup,
} from "./shadowMode";

/**
 * 監視・アラート モジュール
 *
 * 実行単位の「健康状態」を評価し、異常時にSlackアラートを送信
 *
 * 主要エクスポート:
 * - evaluateAndNotify: 実行IDから監視指標を取得し、評価・通知を行う（ワンショット関数）
 * - evaluateExecutionHealth: 監視指標を評価して異常を検出
 * - sendAlertNotification: 評価結果に基づいてSlack通知を送信
 * - collectExecutionHealthMetrics: BigQueryから監視指標を収集
 */

// =============================================================================
// 型定義
// =============================================================================

export {
  // 監視指標
  ExecutionHealthMetrics,

  // アラート閾値
  AlertThresholds,
  DEFAULT_ALERT_THRESHOLDS,

  // アラート設定
  AlertConfig,
  DEFAULT_ALERT_CONFIG,

  // アラート結果
  DetectedIssue,
  AlertIssueCode,
  AlertEvaluationResult,
} from "./types";

// =============================================================================
// 設定
// =============================================================================

export {
  ALERT_ENV_VARS,
  loadAlertThresholds,
  loadAlertConfig,
  getAlertConfig,
  clearAlertConfigCache,
} from "./config";

// =============================================================================
// 評価ロジック
// =============================================================================

export {
  evaluateExecutionHealth,
  getIssueCodeLabel,
} from "./alertEvaluator";

// =============================================================================
// メトリクス収集
// =============================================================================

export {
  MetricsCollectorOptions,
  collectExecutionHealthMetrics,
} from "./metricsCollector";

// =============================================================================
// 通知
// =============================================================================

export {
  AlertNotificationResult,
  sendAlertNotification,
  evaluateAndNotify,
} from "./alertNotifier";

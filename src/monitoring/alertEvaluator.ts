/**
 * 監視・アラート - 評価ロジック
 *
 * 実行の監視指標を評価し、異常を検出する
 */

import {
  ExecutionHealthMetrics,
  AlertThresholds,
  AlertEvaluationResult,
  DetectedIssue,
  AlertIssueCode,
} from "./types";
import { getAlertConfig } from "./config";
import { logger } from "../logger";

// =============================================================================
// アラート評価
// =============================================================================

/**
 * 実行の健康状態を評価し、異常を検出する
 *
 * @param metrics - 評価対象の監視指標
 * @param thresholds - アラート閾値（省略時は設定から取得）
 * @returns 評価結果
 */
export function evaluateExecutionHealth(
  metrics: ExecutionHealthMetrics,
  thresholds?: AlertThresholds
): AlertEvaluationResult {
  const config = getAlertConfig();
  const effectiveThresholds = thresholds ?? config.thresholds;
  const issues: DetectedIssue[] = [];

  // 1. DOWN比率のチェック
  if (metrics.downRatio > effectiveThresholds.maxDownRatio) {
    issues.push({
      code: "DOWN_RATIO_HIGH",
      message: `DOWN ratio too high: ${(metrics.downRatio * 100).toFixed(1)}% (threshold: ${(effectiveThresholds.maxDownRatio * 100).toFixed(0)}%)`,
      actualValue: metrics.downRatio,
      threshold: effectiveThresholds.maxDownRatio,
    });
  }

  // 2. UP比率のチェック
  if (metrics.upRatio > effectiveThresholds.maxUpRatio) {
    issues.push({
      code: "UP_RATIO_HIGH",
      message: `UP ratio too high: ${(metrics.upRatio * 100).toFixed(1)}% (threshold: ${(effectiveThresholds.maxUpRatio * 100).toFixed(0)}%)`,
      actualValue: metrics.upRatio,
      threshold: effectiveThresholds.maxUpRatio,
    });
  }

  // 3. ガードレールクリップ比率のチェック
  if (metrics.guardrailsClippedRatio > effectiveThresholds.maxGuardrailsClippedRatio) {
    issues.push({
      code: "GUARDRAILS_CLIPPED_HIGH",
      message: `Guardrails clipped ratio high: ${(metrics.guardrailsClippedRatio * 100).toFixed(1)}% (threshold: ${(effectiveThresholds.maxGuardrailsClippedRatio * 100).toFixed(0)}%)`,
      actualValue: metrics.guardrailsClippedRatio,
      threshold: effectiveThresholds.maxGuardrailsClippedRatio,
    });
  }

  // 4. 適用失敗比率のチェック（適用がある場合のみ）
  if (metrics.totalApplied > 0) {
    if (metrics.applyFailedRatio > effectiveThresholds.maxApplyFailedRatio) {
      issues.push({
        code: "APPLY_FAILED_RATIO_HIGH",
        message: `Apply failed ratio high: ${(metrics.applyFailedRatio * 100).toFixed(1)}% (threshold: ${(effectiveThresholds.maxApplyFailedRatio * 100).toFixed(0)}%)`,
        actualValue: metrics.applyFailedRatio,
        threshold: effectiveThresholds.maxApplyFailedRatio,
      });
    }
  }

  // 5. 適用失敗件数の絶対値チェック
  if (metrics.totalApplyFailed > effectiveThresholds.maxApplyFailedCount) {
    issues.push({
      code: "APPLY_FAILED_COUNT_HIGH",
      message: `Apply failed count high: ${metrics.totalApplyFailed} (threshold: ${effectiveThresholds.maxApplyFailedCount})`,
      actualValue: metrics.totalApplyFailed,
      threshold: effectiveThresholds.maxApplyFailedCount,
    });
  }

  // 6. 最大入札変更率のチェック
  if (metrics.maxBidChangeRatio > effectiveThresholds.maxBidChangeRatio) {
    issues.push({
      code: "BID_CHANGE_RATIO_HIGH",
      message: `Max bid change ratio too high: x${metrics.maxBidChangeRatio.toFixed(2)} (threshold: x${effectiveThresholds.maxBidChangeRatio.toFixed(1)})`,
      actualValue: metrics.maxBidChangeRatio,
      threshold: effectiveThresholds.maxBidChangeRatio,
    });
  }

  const isAnomaly = issues.length > 0;

  if (isAnomaly) {
    logger.warn("Execution health anomaly detected", {
      executionId: metrics.executionId,
      issueCount: issues.length,
      issues: issues.map((i) => i.code),
    });
  } else {
    logger.debug("Execution health evaluation passed", {
      executionId: metrics.executionId,
    });
  }

  return {
    isAnomaly,
    issues,
    metrics,
  };
}

/**
 * 問題コードの日本語ラベルを取得
 */
export function getIssueCodeLabel(code: AlertIssueCode): string {
  const labels: Record<AlertIssueCode, string> = {
    DOWN_RATIO_HIGH: "DOWN比率超過",
    UP_RATIO_HIGH: "UP比率超過",
    GUARDRAILS_CLIPPED_HIGH: "ガードレールクリップ率超過",
    APPLY_FAILED_RATIO_HIGH: "適用失敗率超過",
    APPLY_FAILED_COUNT_HIGH: "適用失敗件数超過",
    BID_CHANGE_RATIO_HIGH: "入札変更率超過",
  };
  return labels[code] ?? code;
}

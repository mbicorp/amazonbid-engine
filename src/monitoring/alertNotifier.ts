/**
 * 監視・アラート - Slack通知
 *
 * 異常検出時にSlackへアラートを送信する
 */

import { slackNotifier } from "../lib/slackNotifier";
import { logger } from "../logger";
import {
  ExecutionHealthMetrics,
  AlertEvaluationResult,
  DetectedIssue,
} from "./types";
import { getAlertConfig } from "./config";

// =============================================================================
// 型定義
// =============================================================================

/**
 * アラート通知結果
 */
export interface AlertNotificationResult {
  /** 送信成功 */
  success: boolean;
  /** 異常が検出されたか */
  wasAnomaly: boolean;
  /** 送信されたメッセージタイプ */
  messageType: "alert" | "summary" | "skipped";
  /** エラーメッセージ */
  error?: string;
}

// =============================================================================
// メッセージ構築
// =============================================================================

/**
 * アラートメッセージを構築
 */
function buildAlertMessage(result: AlertEvaluationResult): string {
  const { metrics, issues } = result;
  const lines: string[] = [];

  // ヘッダー（警告絵文字はslackNotifierが付与するので不要）
  lines.push("*[ALERT] Amazon Bid Engine execution anomaly detected*");
  lines.push("");

  // 基本情報
  lines.push("```");
  lines.push(`実行ID:         ${metrics.executionId}`);
  lines.push(`実行時刻:       ${metrics.executionTime.toISOString().replace("T", " ").substring(0, 19)}`);
  lines.push(`モード:         ${metrics.mode}`);
  lines.push(`ガードレール:   ${metrics.guardrailsMode ?? "N/A"}`);
  lines.push(`キーワード数:   ${metrics.totalKeywords}`);
  lines.push(`推奨件数:       ${metrics.totalRecommendations}`);
  lines.push(`適用件数:       ${metrics.totalApplied}`);
  if (metrics.executionDurationSec !== null) {
    lines.push(`実行時間:       ${metrics.executionDurationSec} 秒`);
  }
  lines.push("```");

  // 検出された問題
  lines.push("");
  lines.push("*:warning: 検出された問題:*");
  for (const issue of issues) {
    lines.push(`• ${issue.message}`);
  }

  // 詳細メトリクス
  lines.push("");
  lines.push("*詳細メトリクス:*");
  lines.push("```");
  lines.push(`UP比率:             ${(metrics.upRatio * 100).toFixed(1)}% (${metrics.upCount}/${metrics.totalKeywords})`);
  lines.push(`DOWN比率:           ${(metrics.downRatio * 100).toFixed(1)}% (${metrics.downCount}/${metrics.totalKeywords})`);
  lines.push(`強いUP:             ${metrics.strongUpCount} 件`);
  lines.push(`強いDOWN:           ${metrics.strongDownCount} 件`);
  lines.push(`ガードレールクリップ: ${(metrics.guardrailsClippedRatio * 100).toFixed(1)}%`);
  lines.push(`平均入札変更率:     x${metrics.avgBidChangeRatio.toFixed(3)}`);
  lines.push(`最大入札変更率:     x${metrics.maxBidChangeRatio.toFixed(3)}`);
  if (metrics.totalApplied > 0) {
    lines.push(`適用失敗:           ${metrics.totalApplyFailed} 件 (${(metrics.applyFailedRatio * 100).toFixed(1)}%)`);
  }
  lines.push("```");

  // ヒント
  lines.push("");
  lines.push("_詳細は BigQuery の `execution_health_summary` VIEW を参照してください_");

  return lines.join("\n");
}

/**
 * 正常時のサマリーメッセージを構築
 */
function buildSummaryMessage(metrics: ExecutionHealthMetrics): string {
  const lines: string[] = [];

  lines.push("*Amazon Bid Engine 実行完了*");
  lines.push("");
  lines.push("```");
  lines.push(`実行ID:         ${metrics.executionId}`);
  lines.push(`モード:         ${metrics.mode}`);
  lines.push(`キーワード数:   ${metrics.totalKeywords}`);
  lines.push(`推奨件数:       ${metrics.totalRecommendations}`);
  lines.push(`適用件数:       ${metrics.totalApplied}`);
  lines.push(`UP:             ${metrics.upCount} (${(metrics.upRatio * 100).toFixed(1)}%)`);
  lines.push(`DOWN:           ${metrics.downCount} (${(metrics.downRatio * 100).toFixed(1)}%)`);
  if (metrics.executionDurationSec !== null) {
    lines.push(`実行時間:       ${metrics.executionDurationSec} 秒`);
  }
  lines.push("```");

  return lines.join("\n");
}

// =============================================================================
// メイン通知関数
// =============================================================================

/**
 * 実行の評価結果に基づいてSlack通知を送信
 *
 * @param result - 評価結果
 * @returns 通知結果
 */
export async function sendAlertNotification(
  result: AlertEvaluationResult
): Promise<AlertNotificationResult> {
  const config = getAlertConfig();

  // アラートが無効の場合
  if (!config.enabled) {
    logger.debug("Alert notification skipped: disabled");
    return {
      success: true,
      wasAnomaly: result.isAnomaly,
      messageType: "skipped",
    };
  }

  // Slackが設定されていない場合
  if (!slackNotifier.isConfigured()) {
    logger.debug("Alert notification skipped: Slack not configured");
    return {
      success: true,
      wasAnomaly: result.isAnomaly,
      messageType: "skipped",
    };
  }

  try {
    if (result.isAnomaly) {
      // 異常検出時: アラートメッセージを送信
      const message = buildAlertMessage(result);
      const success = await slackNotifier.send(
        message,
        "warn",
        config.alertChannel
      );

      if (success) {
        logger.info("Alert notification sent", {
          executionId: result.metrics.executionId,
          issueCount: result.issues.length,
        });
      } else {
        logger.warn("Failed to send alert notification", {
          executionId: result.metrics.executionId,
        });
      }

      return {
        success,
        wasAnomaly: true,
        messageType: "alert",
      };
    } else if (config.sendSummaryOnSuccess) {
      // 正常時: サマリーメッセージを送信
      const message = buildSummaryMessage(result.metrics);
      const success = await slackNotifier.send(
        message,
        "info",
        config.alertChannel
      );

      if (success) {
        logger.debug("Summary notification sent", {
          executionId: result.metrics.executionId,
        });
      }

      return {
        success,
        wasAnomaly: false,
        messageType: "summary",
      };
    } else {
      // 正常時かつサマリー送信無効: スキップ
      logger.debug("Summary notification skipped: sendSummaryOnSuccess=false");
      return {
        success: true,
        wasAnomaly: false,
        messageType: "skipped",
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Alert notification error", {
      executionId: result.metrics.executionId,
      error: errorMessage,
    });

    // エラーでもメイン処理には影響させない
    return {
      success: false,
      wasAnomaly: result.isAnomaly,
      messageType: result.isAnomaly ? "alert" : "summary",
      error: errorMessage,
    };
  }
}

/**
 * 実行IDから監視指標を取得し、評価してSlack通知を送信する
 * （高レベルのワンショット関数）
 *
 * @param executionId - 実行ID
 * @param projectId - BigQueryプロジェクトID
 * @param dataset - BigQueryデータセット
 * @returns 通知結果
 */
export async function evaluateAndNotify(
  executionId: string,
  projectId?: string,
  dataset?: string
): Promise<AlertNotificationResult> {
  // 遅延インポートで循環参照を回避
  const { collectExecutionHealthMetrics } = await import("./metricsCollector");
  const { evaluateExecutionHealth } = await import("./alertEvaluator");

  const metrics = await collectExecutionHealthMetrics(executionId, {
    projectId,
    dataset,
  });

  if (!metrics) {
    logger.warn("Cannot evaluate: metrics not found", { executionId });
    return {
      success: false,
      wasAnomaly: false,
      messageType: "skipped",
      error: "Metrics not found",
    };
  }

  const result = evaluateExecutionHealth(metrics);
  return sendAlertNotification(result);
}

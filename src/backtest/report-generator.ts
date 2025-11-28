/**
 * バックテスト - レポート生成とSlack通知
 */

import { logger } from "../logger";
import { SlackNotifier } from "../lib/slackNotifier";
import {
  BacktestResult,
  BacktestNotificationData,
} from "./types";

// =============================================================================
// Slack通知
// =============================================================================

/**
 * バックテスト完了通知をSlackに送信
 */
export async function sendBacktestNotification(result: BacktestResult): Promise<boolean> {
  const notifier = new SlackNotifier();

  const message = formatBacktestSlackMessage(result);

  try {
    const sent = await notifier.send(message, "info");

    if (sent) {
      logger.info("Backtest notification sent to Slack", {
        executionId: result.executionId,
      });
    }

    return sent;
  } catch (error) {
    logger.error("Failed to send backtest notification", {
      error: error instanceof Error ? error.message : String(error),
      executionId: result.executionId,
    });
    return false;
  }
}

/**
 * Slackメッセージをフォーマット
 */
export function formatBacktestSlackMessage(result: BacktestResult): string {
  const {
    executionId,
    period,
    actual,
    simulated,
    improvement,
    accuracy,
  } = result;

  const formatPercent = (val: number) => (val * 100).toFixed(1) + "%";
  const formatCurrency = (val: number) => "¥" + Math.round(val).toLocaleString();
  const formatDiff = (val: number) => (val >= 0 ? "+" : "") + formatCurrency(val);

  // ACOS改善方向の表示（マイナスが良い方向）
  const acosArrow = improvement.acosDiff >= 0 ? "▼" : "▲";
  const acosDiffDisplay = `${acosArrow}${Math.abs(improvement.acosDiff * 100).toFixed(1)}pt`;

  // 広告費変化の表示
  const spendArrow = improvement.spendDiffPercent < 0 ? "▼" : "▲";
  const spendDiffDisplay = `${spendArrow}${Math.abs(improvement.spendDiffPercent).toFixed(1)}%`;

  const lines = [
    `📊 *バックテスト完了*`,
    ``,
    `*期間:* ${period.start} 〜 ${period.end} (${period.days}日間)`,
    `*実行ID:* \`${executionId.slice(0, 20)}...\``,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `*【実績 vs シミュレーション】*`,
    ``,
    `*広告費:* ${formatCurrency(actual.totalSpend)} → ${formatCurrency(simulated.totalSpend)} (${spendDiffDisplay})`,
    `*ACOS:* ${formatPercent(actual.acos)} → ${formatPercent(simulated.acos)} (${acosDiffDisplay})`,
    `*ROAS:* ${actual.roas.toFixed(2)} → ${simulated.roas.toFixed(2)}`,
    ``,
    `*推定利益改善:* ${formatDiff(improvement.estimatedProfitGain)}`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `*【判断精度】*`,
    ``,
    `*正解率:* ${formatPercent(accuracy.accuracyRate)} (${accuracy.correctDecisions.toLocaleString()}/${accuracy.totalDecisions.toLocaleString()}件)`,
  ];

  // アクション別精度を追加
  const actionLabels: Record<string, string> = {
    STRONG_UP: "強UP",
    MILD_UP: "軽UP",
    KEEP: "維持",
    MILD_DOWN: "軽DOWN",
    STRONG_DOWN: "強DOWN",
    STOP: "停止",
  };

  const actionStats = Object.entries(accuracy.byAction)
    .filter(([, stat]) => stat.total > 0)
    .map(([action, stat]) => `${actionLabels[action]}: ${formatPercent(stat.rate)}`)
    .join(" / ");

  if (actionStats) {
    lines.push(`*アクション別:* ${actionStats}`);
  }

  return lines.join("\n");
}

// =============================================================================
// コンソールレポート
// =============================================================================

/**
 * コンソール用サマリーレポートを生成
 */
export function generateConsoleReport(result: BacktestResult): string {
  const {
    executionId,
    period,
    actual,
    simulated,
    improvement,
    accuracy,
    meta,
  } = result;

  const formatPercent = (val: number) => (val * 100).toFixed(2) + "%";
  const formatCurrency = (val: number) => "¥" + Math.round(val).toLocaleString();

  const lines = [
    "╔════════════════════════════════════════════════════════════════╗",
    "║                    バックテスト結果レポート                      ║",
    "╚════════════════════════════════════════════════════════════════╝",
    "",
    `実行ID: ${executionId}`,
    `期間: ${period.start} 〜 ${period.end} (${period.days}日間)`,
    `処理時間: ${meta.durationMs.toLocaleString()}ms`,
    `処理キーワード数: ${meta.keywordsProcessed.toLocaleString()}`,
    `処理推奨数: ${meta.recommendationsProcessed.toLocaleString()}`,
    "",
    "┌────────────────────────────────────────────────────────────────┐",
    "│ 実績 vs シミュレーション                                        │",
    "├─────────────────┬──────────────────┬──────────────────┬───────┤",
    "│ 指標            │ 実績             │ シミュレーション │ 差分  │",
    "├─────────────────┼──────────────────┼──────────────────┼───────┤",
    `│ 広告費          │ ${formatCurrency(actual.totalSpend).padEnd(16)} │ ${formatCurrency(simulated.totalSpend).padEnd(16)} │ ${formatPercent(improvement.spendDiffPercent / 100).padEnd(5)} │`,
    `│ 広告売上        │ ${formatCurrency(actual.totalSales).padEnd(16)} │ ${formatCurrency(simulated.totalSales).padEnd(16)} │       │`,
    `│ 注文数          │ ${actual.totalOrders.toLocaleString().padEnd(16)} │ ${simulated.totalOrders.toLocaleString().padEnd(16)} │       │`,
    `│ ACOS            │ ${formatPercent(actual.acos).padEnd(16)} │ ${formatPercent(simulated.acos).padEnd(16)} │ ${(improvement.acosDiff * 100).toFixed(1).padEnd(5)}pt │`,
    `│ ROAS            │ ${actual.roas.toFixed(2).padEnd(16)} │ ${simulated.roas.toFixed(2).padEnd(16)} │ ${improvement.roasDiff.toFixed(2).padEnd(5)} │`,
    "└─────────────────┴──────────────────┴──────────────────┴───────┘",
    "",
    `推定利益改善額: ${formatCurrency(improvement.estimatedProfitGain)}`,
    "",
    "┌────────────────────────────────────────────────────────────────┐",
    "│ 判断精度                                                       │",
    "├────────────────────────────────────────────────────────────────┤",
    `│ 総合正解率: ${formatPercent(accuracy.accuracyRate)} (${accuracy.correctDecisions.toLocaleString()}/${accuracy.totalDecisions.toLocaleString()}件)`,
    "│",
  ];

  // アクション別精度
  for (const [action, stat] of Object.entries(accuracy.byAction)) {
    if (stat.total > 0) {
      lines.push(`│ ${action.padEnd(12)}: ${formatPercent(stat.rate).padEnd(8)} (${stat.correct}/${stat.total}件)`);
    }
  }

  lines.push("└────────────────────────────────────────────────────────────────┘");

  return lines.join("\n");
}

// =============================================================================
// JSON/CSVエクスポート
// =============================================================================

/**
 * 結果をJSON形式でエクスポート
 */
export function exportToJson(result: BacktestResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * 時系列データをCSV形式でエクスポート
 */
export function exportTimeSeriesDataToCsv(result: BacktestResult): string {
  const headers = [
    "date",
    "actual_spend",
    "actual_sales",
    "actual_acos",
    "simulated_spend",
    "simulated_sales",
    "simulated_acos",
    "decisions",
    "correct_decisions",
    "accuracy_rate",
  ];

  const rows = result.timeSeries.map((entry) => [
    entry.date,
    entry.actualSpend.toFixed(2),
    entry.actualSales.toFixed(2),
    entry.actualAcos !== null ? (entry.actualAcos * 100).toFixed(2) : "",
    entry.simulatedSpend.toFixed(2),
    entry.simulatedSales.toFixed(2),
    entry.simulatedAcos !== null ? (entry.simulatedAcos * 100).toFixed(2) : "",
    entry.decisions.toString(),
    entry.correctDecisions.toString(),
    entry.decisions > 0
      ? ((entry.correctDecisions / entry.decisions) * 100).toFixed(2)
      : "",
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// =============================================================================
// 通知データ変換
// =============================================================================

/**
 * BacktestResultを通知用データに変換
 */
export function toNotificationData(result: BacktestResult): BacktestNotificationData {
  return {
    executionId: result.executionId,
    period: result.period,
    comparison: {
      actualSpend: result.actual.totalSpend,
      simulatedSpend: result.simulated.totalSpend,
      spendDiffPercent: result.improvement.spendDiffPercent,
      actualAcos: result.actual.acos,
      simulatedAcos: result.simulated.acos,
      acosDiff: result.improvement.acosDiff,
      estimatedProfitGain: result.improvement.estimatedProfitGain,
    },
    accuracy: {
      total: result.accuracy.totalDecisions,
      correct: result.accuracy.correctDecisions,
      rate: result.accuracy.accuracyRate,
    },
  };
}

/**
 * ライフサイクル通知ヘルパー
 * ライフサイクルステージ変更や強制HARVESTアラートを通知
 */

import { slackNotifier, NotificationLevel } from "./slackNotifier";
import { LifecycleStage } from "../lifecycle/types";

/** ステージ変更情報 */
export interface LifecycleChange {
  productId: string;
  productName?: string;
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
  reason: string;
  seoScore?: number;
  monthlyProfit?: number;
}

/** 強制HARVESTアラート情報 */
export interface HarvestAlert {
  productId: string;
  productName?: string;
  trigger: "cumulative_loss" | "consecutive_loss" | "review_collapse";
  details: string;
  cumulativeLoss?: number;
  consecutiveLossMonths?: number;
  reviewScore?: number;
  reviewCount?: number;
}

/** ステージの日本語ラベル */
const STAGE_LABELS: Record<LifecycleStage, string> = {
  LAUNCH_HARD: "立ち上げ（強）",
  LAUNCH_SOFT: "立ち上げ（弱）",
  GROW: "通常運用",
  HARVEST: "回収モード",
};

/**
 * ライフサイクルステージ変更を通知
 */
export async function notifyLifecycleChange(change: LifecycleChange): Promise<boolean> {
  const fromLabel = STAGE_LABELS[change.fromStage];
  const toLabel = STAGE_LABELS[change.toStage];
  const productDisplay = change.productName
    ? `${change.productName} (${change.productId})`
    : change.productId;

  const lines = [
    `*ライフサイクルステージ変更*`,
    `商品: ${productDisplay}`,
    `変更: ${fromLabel} → ${toLabel}`,
    `理由: ${change.reason}`,
  ];

  if (change.seoScore !== undefined) {
    lines.push(`SEOスコア: ${change.seoScore.toFixed(1)}`);
  }

  if (change.monthlyProfit !== undefined) {
    const profitStr = change.monthlyProfit >= 0
      ? `+${change.monthlyProfit.toLocaleString()}円`
      : `${change.monthlyProfit.toLocaleString()}円`;
    lines.push(`月次利益: ${profitStr}`);
  }

  const message = lines.join("\n");

  // ステージによって通知レベルを決定
  let level: NotificationLevel = "info";
  if (change.toStage === "HARVEST") {
    level = "warn";
  } else if (change.toStage === "LAUNCH_HARD") {
    level = "info";
  }

  return slackNotifier.send(message, level);
}

/**
 * 強制HARVESTアラートを通知
 */
export async function notifyForcedHarvest(alert: HarvestAlert): Promise<boolean> {
  const productDisplay = alert.productName
    ? `${alert.productName} (${alert.productId})`
    : alert.productId;

  const triggerLabels: Record<HarvestAlert["trigger"], string> = {
    cumulative_loss: "累積赤字上限超過",
    consecutive_loss: "連続赤字",
    review_collapse: "レビュー崩壊",
  };

  const lines = [
    `*強制HARVEST移行アラート*`,
    `商品: ${productDisplay}`,
    `トリガー: ${triggerLabels[alert.trigger]}`,
    `詳細: ${alert.details}`,
  ];

  if (alert.cumulativeLoss !== undefined) {
    lines.push(`累積赤字: ${Math.abs(alert.cumulativeLoss).toLocaleString()}円`);
  }

  if (alert.consecutiveLossMonths !== undefined) {
    lines.push(`連続赤字月数: ${alert.consecutiveLossMonths}ヶ月`);
  }

  if (alert.reviewScore !== undefined && alert.reviewCount !== undefined) {
    lines.push(`レビュー: ${alert.reviewScore.toFixed(1)} (${alert.reviewCount}件)`);
  }

  const message = lines.join("\n");

  return slackNotifier.send(message, "error");
}

/**
 * 複数のステージ変更をまとめて通知
 */
export async function notifyBulkLifecycleChanges(
  changes: LifecycleChange[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const change of changes) {
    const result = await notifyLifecycleChange(change);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  return { success, failed };
}

/**
 * ライフサイクル更新ジョブのサマリーを通知
 */
export async function notifyLifecycleUpdateSummary(summary: {
  totalProducts: number;
  transitioned: number;
  forcedHarvest: number;
  errors: number;
  dryRun: boolean;
}): Promise<boolean> {
  const dryRunLabel = summary.dryRun ? "[DRY RUN] " : "";

  const lines = [
    `*${dryRunLabel}ライフサイクル更新ジョブ完了*`,
    `処理商品数: ${summary.totalProducts}`,
    `ステージ変更: ${summary.transitioned}件`,
  ];

  if (summary.forcedHarvest > 0) {
    lines.push(`強制HARVEST: ${summary.forcedHarvest}件`);
  }

  if (summary.errors > 0) {
    lines.push(`エラー: ${summary.errors}件`);
  }

  const message = lines.join("\n");

  // エラーがあればwarn、なければinfo
  const level: NotificationLevel = summary.errors > 0 ? "warn" : "info";

  return slackNotifier.send(message, level);
}

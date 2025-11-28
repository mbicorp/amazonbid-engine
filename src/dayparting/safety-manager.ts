/**
 * Dayparting (時間帯別入札最適化) - 安全機構とロールバック
 *
 * 乗数適用前の安全チェック、異常検知、ロールバック機能を提供
 */

import * as crypto from "crypto";
import { logger } from "../logger";
import {
  HourlyBidMultiplier,
  DaypartingConfig,
  DaypartingFeedbackRecord,
  DaypartingDailySummary,
  SafetyCheckResult,
  RollbackInfo,
  DaypartingMode,
  DAYPARTING_CONSTANTS,
} from "./types";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 安全チェック設定
 */
export interface SafetyCheckConfig {
  /** 日次最大損失許容額 */
  maxDailyLoss: number;
  /** パフォーマンス低下閾値 */
  performanceDegradationThreshold: number;
  /** 最大連続悪化日数 */
  maxConsecutiveBadDays: number;
  /** 最小データポイント数（判断に必要） */
  minDataPointsForDecision: number;
}

/**
 * デフォルトの安全チェック設定
 */
export const DEFAULT_SAFETY_CHECK_CONFIG: SafetyCheckConfig = {
  maxDailyLoss: 5000,
  performanceDegradationThreshold: 0.15,
  maxConsecutiveBadDays: 3,
  minDataPointsForDecision: 10,
};

/**
 * 異常検知結果
 */
export interface AnomalyDetectionResult {
  /** 異常が検知されたか */
  isAnomalous: boolean;
  /** 異常の種類 */
  anomalyType: "loss_exceeded" | "performance_drop" | "consecutive_bad_days" | "none";
  /** 詳細メッセージ */
  message: string;
  /** 現在の値 */
  currentValue: number;
  /** 閾値 */
  threshold: number;
  /** ロールバック推奨 */
  shouldRollback: boolean;
}

// =============================================================================
// 安全チェック
// =============================================================================

/**
 * 乗数適用前の安全チェックを実行
 */
export function performSafetyCheck(
  multiplier: HourlyBidMultiplier,
  config: DaypartingConfig,
  recentFeedback: DaypartingFeedbackRecord[],
  dailySummaries: DaypartingDailySummary[],
  safetyConfig: SafetyCheckConfig = DEFAULT_SAFETY_CHECK_CONFIG
): SafetyCheckResult {
  const warnings: string[] = [];
  let blockReason: string | null = null;
  let recommendedAction: "APPLY" | "REDUCE" | "SKIP" | "ROLLBACK" = "APPLY";
  let adjustedMultiplier: number | null = null;

  // 1. 乗数が設定範囲内かチェック
  if (multiplier.multiplier > config.maxMultiplier) {
    warnings.push(`乗数が最大値を超過: ${multiplier.multiplier} > ${config.maxMultiplier}`);
    adjustedMultiplier = config.maxMultiplier;
    recommendedAction = "REDUCE";
  }
  if (multiplier.multiplier < config.minMultiplier) {
    warnings.push(`乗数が最小値を下回る: ${multiplier.multiplier} < ${config.minMultiplier}`);
    adjustedMultiplier = config.minMultiplier;
    recommendedAction = "REDUCE";
  }

  // 2. 日次損失チェック
  const todaySummary = dailySummaries.find((s) => {
    const today = new Date();
    return s.date.toDateString() === today.toDateString();
  });

  if (todaySummary) {
    const currentLoss = todaySummary.actualSpend - todaySummary.actualSales;
    if (currentLoss > safetyConfig.maxDailyLoss) {
      blockReason = `日次損失が許容額を超過: ¥${currentLoss.toLocaleString()} > ¥${safetyConfig.maxDailyLoss.toLocaleString()}`;
      recommendedAction = "SKIP";
    }
  }

  // 3. 直近のパフォーマンス低下チェック
  const recentEvaluatedFeedback = recentFeedback.filter(
    (f) => f.evaluated && f.hour === multiplier.hour
  );

  if (recentEvaluatedFeedback.length >= safetyConfig.minDataPointsForDecision) {
    const successCount = recentEvaluatedFeedback.filter((f) => f.isSuccess).length;
    const successRate = successCount / recentEvaluatedFeedback.length;

    if (successRate < 1 - safetyConfig.performanceDegradationThreshold) {
      warnings.push(`この時間帯の成功率が低下: ${(successRate * 100).toFixed(1)}%`);

      // 乗数を1.0に近づける
      if (multiplier.multiplier > 1.0) {
        adjustedMultiplier = 1.0 + (multiplier.multiplier - 1.0) * 0.5;
        recommendedAction = "REDUCE";
      } else if (multiplier.multiplier < 1.0) {
        adjustedMultiplier = 1.0 - (1.0 - multiplier.multiplier) * 0.5;
        recommendedAction = "REDUCE";
      }
    }
  }

  // 4. 連続悪化日数チェック
  const sortedSummaries = [...dailySummaries].sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  );

  let consecutiveBadDays = 0;
  for (const summary of sortedSummaries.slice(0, 7)) {
    const roi = summary.actualSpend > 0
      ? (summary.actualSales - summary.actualSpend) / summary.actualSpend
      : 0;

    if (roi < -safetyConfig.performanceDegradationThreshold) {
      consecutiveBadDays++;
    } else {
      break;
    }
  }

  if (consecutiveBadDays >= safetyConfig.maxConsecutiveBadDays) {
    blockReason = `${consecutiveBadDays}日連続でパフォーマンスが悪化`;
    recommendedAction = "ROLLBACK";
  }

  // 5. 信頼度が不十分な場合の警告
  if (multiplier.confidence === "INSUFFICIENT") {
    warnings.push("データ不足のため信頼度が不十分");
    if (Math.abs(multiplier.multiplier - 1.0) > 0.1) {
      adjustedMultiplier = DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER;
      recommendedAction = "REDUCE";
    }
  }

  const isSafe = blockReason === null;

  return {
    isSafe,
    warnings,
    blockReason,
    recommendedAction,
    adjustedMultiplier,
  };
}

/**
 * バッチで安全チェックを実行
 */
export function performBatchSafetyCheck(
  multipliers: HourlyBidMultiplier[],
  config: DaypartingConfig,
  recentFeedback: DaypartingFeedbackRecord[],
  dailySummaries: DaypartingDailySummary[],
  safetyConfig: SafetyCheckConfig = DEFAULT_SAFETY_CHECK_CONFIG
): Map<string, SafetyCheckResult> {
  const results = new Map<string, SafetyCheckResult>();

  for (const multiplier of multipliers) {
    const key = `${multiplier.hour}|${multiplier.dayOfWeek ?? "all"}`;
    const result = performSafetyCheck(
      multiplier,
      config,
      recentFeedback,
      dailySummaries,
      safetyConfig
    );
    results.set(key, result);
  }

  return results;
}

// =============================================================================
// 異常検知
// =============================================================================

/**
 * 損失超過を検知
 */
export function detectLossExceeded(
  dailySummaries: DaypartingDailySummary[],
  maxDailyLoss: number
): AnomalyDetectionResult {
  const today = new Date();
  const todaySummary = dailySummaries.find(
    (s) => s.date.toDateString() === today.toDateString()
  );

  if (!todaySummary) {
    return {
      isAnomalous: false,
      anomalyType: "none",
      message: "本日のデータがありません",
      currentValue: 0,
      threshold: maxDailyLoss,
      shouldRollback: false,
    };
  }

  const currentLoss = todaySummary.actualSpend - todaySummary.actualSales;

  if (currentLoss > maxDailyLoss) {
    return {
      isAnomalous: true,
      anomalyType: "loss_exceeded",
      message: `日次損失が許容額を超過: ¥${currentLoss.toLocaleString()} > ¥${maxDailyLoss.toLocaleString()}`,
      currentValue: currentLoss,
      threshold: maxDailyLoss,
      shouldRollback: true,
    };
  }

  return {
    isAnomalous: false,
    anomalyType: "none",
    message: "損失は許容範囲内",
    currentValue: currentLoss,
    threshold: maxDailyLoss,
    shouldRollback: false,
  };
}

/**
 * パフォーマンス低下を検知
 */
export function detectPerformanceDrop(
  feedbackRecords: DaypartingFeedbackRecord[],
  threshold: number
): AnomalyDetectionResult {
  const evaluatedRecords = feedbackRecords.filter((f) => f.evaluated);

  if (evaluatedRecords.length < 10) {
    return {
      isAnomalous: false,
      anomalyType: "none",
      message: "データ不足のため判定不可",
      currentValue: 0,
      threshold,
      shouldRollback: false,
    };
  }

  // CVR変化率を計算
  let totalCvrChange = 0;
  let validCount = 0;

  for (const record of evaluatedRecords) {
    if (record.cvrBefore > 0 && record.cvrAfter !== null) {
      const change = (record.cvrAfter - record.cvrBefore) / record.cvrBefore;
      totalCvrChange += change;
      validCount++;
    }
  }

  if (validCount === 0) {
    return {
      isAnomalous: false,
      anomalyType: "none",
      message: "有効なデータがありません",
      currentValue: 0,
      threshold,
      shouldRollback: false,
    };
  }

  const avgCvrChange = totalCvrChange / validCount;

  if (avgCvrChange < -threshold) {
    return {
      isAnomalous: true,
      anomalyType: "performance_drop",
      message: `平均CVRが${(Math.abs(avgCvrChange) * 100).toFixed(1)}%低下（閾値: ${(threshold * 100).toFixed(1)}%）`,
      currentValue: avgCvrChange,
      threshold: -threshold,
      shouldRollback: true,
    };
  }

  return {
    isAnomalous: false,
    anomalyType: "none",
    message: "パフォーマンスに異常なし",
    currentValue: avgCvrChange,
    threshold: -threshold,
    shouldRollback: false,
  };
}

/**
 * 連続悪化日数を検知
 */
export function detectConsecutiveBadDays(
  dailySummaries: DaypartingDailySummary[],
  maxConsecutiveDays: number,
  degradationThreshold: number
): AnomalyDetectionResult {
  const sortedSummaries = [...dailySummaries].sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  );

  let consecutiveBadDays = 0;

  for (const summary of sortedSummaries) {
    const roi = summary.actualSpend > 0
      ? (summary.actualSales - summary.actualSpend) / summary.actualSpend
      : 0;

    if (roi < -degradationThreshold) {
      consecutiveBadDays++;
    } else {
      break;
    }
  }

  if (consecutiveBadDays >= maxConsecutiveDays) {
    return {
      isAnomalous: true,
      anomalyType: "consecutive_bad_days",
      message: `${consecutiveBadDays}日連続でパフォーマンスが悪化（閾値: ${maxConsecutiveDays}日）`,
      currentValue: consecutiveBadDays,
      threshold: maxConsecutiveDays,
      shouldRollback: true,
    };
  }

  return {
    isAnomalous: false,
    anomalyType: "none",
    message: `連続悪化日数は${consecutiveBadDays}日（閾値: ${maxConsecutiveDays}日）`,
    currentValue: consecutiveBadDays,
    threshold: maxConsecutiveDays,
    shouldRollback: false,
  };
}

/**
 * 総合的な異常検知
 */
export function detectAnomalies(
  feedbackRecords: DaypartingFeedbackRecord[],
  dailySummaries: DaypartingDailySummary[],
  safetyConfig: SafetyCheckConfig = DEFAULT_SAFETY_CHECK_CONFIG
): AnomalyDetectionResult[] {
  const results: AnomalyDetectionResult[] = [];

  results.push(detectLossExceeded(dailySummaries, safetyConfig.maxDailyLoss));
  results.push(detectPerformanceDrop(feedbackRecords, safetyConfig.performanceDegradationThreshold));
  results.push(detectConsecutiveBadDays(
    dailySummaries,
    safetyConfig.maxConsecutiveBadDays,
    safetyConfig.performanceDegradationThreshold
  ));

  return results;
}

// =============================================================================
// ロールバック
// =============================================================================

/**
 * ロールバック情報を作成
 */
export function createRollbackInfo(
  asin: string,
  campaignId: string,
  reason: string,
  previousMultipliers: HourlyBidMultiplier[]
): RollbackInfo {
  return {
    rollbackId: `rollback_${crypto.randomUUID()}`,
    asin,
    campaignId,
    reason,
    previousMultipliers: [...previousMultipliers],
    rolledBackAt: new Date(),
    restoredAt: null,
  };
}

/**
 * ロールバックを実行（乗数を1.0にリセット）
 */
export function executeRollback(
  multipliers: HourlyBidMultiplier[]
): HourlyBidMultiplier[] {
  const now = new Date();

  return multipliers.map((m) => ({
    ...m,
    multiplier: DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER,
    isActive: true,
    updatedAt: now,
  }));
}

/**
 * ロールバックから復元
 */
export function restoreFromRollback(
  rollbackInfo: RollbackInfo
): HourlyBidMultiplier[] {
  const now = new Date();

  return rollbackInfo.previousMultipliers.map((m) => ({
    ...m,
    isActive: true,
    updatedAt: now,
  }));
}

// =============================================================================
// 段階的適用
// =============================================================================

/**
 * 段階的に乗数を適用（急激な変化を防ぐ）
 */
export function applyGradualChange(
  currentMultiplier: number,
  targetMultiplier: number,
  maxChangePerStep: number = 0.05
): number {
  const diff = targetMultiplier - currentMultiplier;
  const clampedDiff = Math.max(-maxChangePerStep, Math.min(maxChangePerStep, diff));
  const newMultiplier = currentMultiplier + clampedDiff;

  return Math.round(newMultiplier * 100) / 100;
}

/**
 * 乗数配列に段階的変化を適用
 */
export function applyGradualChanges(
  currentMultipliers: HourlyBidMultiplier[],
  targetMultipliers: HourlyBidMultiplier[],
  maxChangePerStep: number = 0.05
): HourlyBidMultiplier[] {
  const currentMap = new Map<string, HourlyBidMultiplier>();
  for (const m of currentMultipliers) {
    const key = `${m.hour}|${m.dayOfWeek ?? "all"}`;
    currentMap.set(key, m);
  }

  const now = new Date();

  return targetMultipliers.map((target) => {
    const key = `${target.hour}|${target.dayOfWeek ?? "all"}`;
    const current = currentMap.get(key);

    if (!current) {
      return target;
    }

    const gradualMultiplier = applyGradualChange(
      current.multiplier,
      target.multiplier,
      maxChangePerStep
    );

    return {
      ...target,
      multiplier: gradualMultiplier,
      updatedAt: now,
    };
  });
}

// =============================================================================
// ヘルスチェック
// =============================================================================

/**
 * Daypartingシステムのヘルスチェック結果
 */
export interface DaypartingHealthCheckResult {
  /** 健全かどうか */
  healthy: boolean;
  /** モード */
  mode: DaypartingMode;
  /** アクティブな乗数の数 */
  activeMultiplierCount: number;
  /** 直近の成功率 */
  recentSuccessRate: number | null;
  /** 異常検知結果 */
  anomalies: AnomalyDetectionResult[];
  /** 警告 */
  warnings: string[];
  /** 最後のロールバックからの経過時間（時間） */
  hoursSinceLastRollback: number | null;
}

/**
 * システムのヘルスチェック
 */
export function performHealthCheck(
  config: DaypartingConfig,
  multipliers: HourlyBidMultiplier[],
  feedbackRecords: DaypartingFeedbackRecord[],
  dailySummaries: DaypartingDailySummary[],
  lastRollbackTime: Date | null
): DaypartingHealthCheckResult {
  const warnings: string[] = [];

  // アクティブな乗数をカウント
  const activeMultiplierCount = multipliers.filter((m) => m.isActive).length;

  // 直近の成功率を計算
  const recentFeedback = feedbackRecords.filter((f) => f.evaluated).slice(-50);
  let recentSuccessRate: number | null = null;
  if (recentFeedback.length >= 10) {
    const successCount = recentFeedback.filter((f) => f.isSuccess).length;
    recentSuccessRate = successCount / recentFeedback.length;

    if (recentSuccessRate < 0.5) {
      warnings.push(`成功率が低下しています: ${(recentSuccessRate * 100).toFixed(1)}%`);
    }
  } else {
    warnings.push("フィードバックデータが不足しています");
  }

  // 異常検知
  const anomalies = detectAnomalies(feedbackRecords, dailySummaries);
  for (const anomaly of anomalies) {
    if (anomaly.isAnomalous) {
      warnings.push(anomaly.message);
    }
  }

  // ロールバックからの経過時間
  let hoursSinceLastRollback: number | null = null;
  if (lastRollbackTime) {
    hoursSinceLastRollback = (Date.now() - lastRollbackTime.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastRollback < 24) {
      warnings.push(`24時間以内にロールバックが発生（${hoursSinceLastRollback.toFixed(1)}時間前）`);
    }
  }

  const healthy = warnings.length === 0 && !anomalies.some((a) => a.shouldRollback);

  return {
    healthy,
    mode: config.mode,
    activeMultiplierCount,
    recentSuccessRate,
    anomalies,
    warnings,
    hoursSinceLastRollback,
  };
}

// =============================================================================
// ログ出力
// =============================================================================

/**
 * 安全チェック結果をログ出力
 */
export function logSafetyCheckResult(
  result: SafetyCheckResult,
  asin: string,
  campaignId: string,
  hour: number
): void {
  if (!result.isSafe) {
    logger.warn("Safety check failed", {
      asin,
      campaignId,
      hour,
      blockReason: result.blockReason,
      recommendedAction: result.recommendedAction,
      warnings: result.warnings,
    });
  } else if (result.warnings.length > 0) {
    logger.info("Safety check passed with warnings", {
      asin,
      campaignId,
      hour,
      warnings: result.warnings,
      adjustedMultiplier: result.adjustedMultiplier,
    });
  }
}

/**
 * ロールバックをログ出力
 */
export function logRollback(rollbackInfo: RollbackInfo): void {
  logger.warn("Dayparting rollback executed", {
    rollbackId: rollbackInfo.rollbackId,
    asin: rollbackInfo.asin,
    campaignId: rollbackInfo.campaignId,
    reason: rollbackInfo.reason,
    multiplierCount: rollbackInfo.previousMultipliers.length,
    rolledBackAt: rollbackInfo.rolledBackAt.toISOString(),
  });
}

/**
 * Dayparting (時間帯別入札最適化) - フィードバック評価
 *
 * 乗数適用後のパフォーマンスを評価し、
 * 学習データとして活用するための機能
 */

import * as crypto from "crypto";
import { logger } from "../logger";
import {
  DaypartingFeedbackRecord,
  DaypartingDailySummary,
  HourlyBidMultiplier,
  HourOfDay,
  DayOfWeek,
  DaypartingMode,
} from "./types";

// =============================================================================
// 型定義
// =============================================================================

/**
 * フィードバック作成オプション
 */
export interface CreateFeedbackOptions {
  /** ASIN */
  asin: string;
  /** キャンペーンID */
  campaignId: string;
  /** 広告グループID */
  adGroupId: string | null;
  /** 時間帯 */
  hour: HourOfDay;
  /** 曜日 */
  dayOfWeek: DayOfWeek | null;
  /** 適用された乗数 */
  appliedMultiplier: number;
  /** 適用前のCVR */
  cvrBefore: number;
  /** 適用前のROAS */
  roasBefore: number;
  /** 適用前のクリック数 */
  clicksBefore: number;
  /** 適用前のコンバージョン数 */
  conversionsBefore: number;
}

/**
 * フィードバック評価オプション
 */
export interface EvaluateFeedbackOptions {
  /** 適用後のCVR */
  cvrAfter: number;
  /** 適用後のROAS */
  roasAfter: number;
  /** 適用後のクリック数 */
  clicksAfter: number;
  /** 適用後のコンバージョン数 */
  conversionsAfter: number;
}

/**
 * 成功判定基準
 */
export interface SuccessCriteria {
  /** CVR変化率の閾値（正の値で改善が必要） */
  minCvrChange: number;
  /** ROAS変化率の閾値 */
  minRoasChange: number;
  /** 悪化許容率 */
  maxDegradation: number;
}

/**
 * デフォルトの成功判定基準
 */
export const DEFAULT_SUCCESS_CRITERIA: SuccessCriteria = {
  minCvrChange: -0.05,    // 5%の悪化まで許容
  minRoasChange: -0.05,   // 5%の悪化まで許容
  maxDegradation: 0.15,   // 15%以上の悪化は失敗
};

// =============================================================================
// フィードバック作成
// =============================================================================

/**
 * フィードバックレコードを作成
 */
export function createFeedbackRecord(options: CreateFeedbackOptions): DaypartingFeedbackRecord {
  return {
    feedbackId: `feedback_${crypto.randomUUID()}`,
    asin: options.asin,
    campaignId: options.campaignId,
    adGroupId: options.adGroupId,
    hour: options.hour,
    dayOfWeek: options.dayOfWeek,
    appliedMultiplier: options.appliedMultiplier,
    appliedAt: new Date(),
    evaluatedAt: null,
    cvrBefore: options.cvrBefore,
    roasBefore: options.roasBefore,
    clicksBefore: options.clicksBefore,
    conversionsBefore: options.conversionsBefore,
    cvrAfter: null,
    roasAfter: null,
    clicksAfter: null,
    conversionsAfter: null,
    isSuccess: null,
    successScore: null,
    evaluated: false,
  };
}

/**
 * 乗数適用時にフィードバックレコードを作成
 */
export function createFeedbackFromMultiplier(
  multiplier: HourlyBidMultiplier,
  currentMetrics: {
    cvr: number;
    roas: number;
    clicks: number;
    conversions: number;
  }
): DaypartingFeedbackRecord {
  return createFeedbackRecord({
    asin: multiplier.asin,
    campaignId: multiplier.campaignId,
    adGroupId: multiplier.adGroupId,
    hour: multiplier.hour,
    dayOfWeek: multiplier.dayOfWeek,
    appliedMultiplier: multiplier.multiplier,
    cvrBefore: currentMetrics.cvr,
    roasBefore: currentMetrics.roas,
    clicksBefore: currentMetrics.clicks,
    conversionsBefore: currentMetrics.conversions,
  });
}

// =============================================================================
// フィードバック評価
// =============================================================================

/**
 * フィードバックを評価
 */
export function evaluateFeedback(
  feedback: DaypartingFeedbackRecord,
  afterMetrics: EvaluateFeedbackOptions,
  criteria: SuccessCriteria = DEFAULT_SUCCESS_CRITERIA
): DaypartingFeedbackRecord {
  // 変化率を計算
  const cvrChange = feedback.cvrBefore > 0
    ? (afterMetrics.cvrAfter - feedback.cvrBefore) / feedback.cvrBefore
    : 0;

  const roasChange = feedback.roasBefore > 0
    ? (afterMetrics.roasAfter - feedback.roasBefore) / feedback.roasBefore
    : 0;

  // 成功判定
  const { isSuccess, successScore } = judgeSuccess(
    cvrChange,
    roasChange,
    feedback.appliedMultiplier,
    criteria
  );

  return {
    ...feedback,
    cvrAfter: afterMetrics.cvrAfter,
    roasAfter: afterMetrics.roasAfter,
    clicksAfter: afterMetrics.clicksAfter,
    conversionsAfter: afterMetrics.conversionsAfter,
    isSuccess,
    successScore,
    evaluated: true,
    evaluatedAt: new Date(),
  };
}

/**
 * 成功を判定
 */
function judgeSuccess(
  cvrChange: number,
  roasChange: number,
  appliedMultiplier: number,
  criteria: SuccessCriteria
): { isSuccess: boolean; successScore: number } {
  // 乗数が1.0より大きい場合（ブースト）
  if (appliedMultiplier > 1.0) {
    // ブーストの場合、パフォーマンスが維持または改善されれば成功
    const cvrOk = cvrChange >= criteria.minCvrChange;
    const roasOk = roasChange >= criteria.minRoasChange;
    const notTooWorse = cvrChange >= -criteria.maxDegradation && roasChange >= -criteria.maxDegradation;

    if (cvrOk && roasOk) {
      // 両方OK
      const score = calculateSuccessScore(cvrChange, roasChange, true);
      return { isSuccess: true, successScore: score };
    } else if (notTooWorse) {
      // 悪化しているが許容範囲内
      const score = calculateSuccessScore(cvrChange, roasChange, false);
      return { isSuccess: true, successScore: score };
    } else {
      // 大きく悪化
      return { isSuccess: false, successScore: 0 };
    }
  }

  // 乗数が1.0より小さい場合（抑制）
  if (appliedMultiplier < 1.0) {
    // 抑制の場合、効率が改善されれば成功
    // 悪い時間帯を抑制したので、全体効率が上がるはず
    const roasImproved = roasChange >= 0;
    const notTooWorse = cvrChange >= -criteria.maxDegradation;

    if (roasImproved) {
      const score = calculateSuccessScore(cvrChange, roasChange, true);
      return { isSuccess: true, successScore: score };
    } else if (notTooWorse) {
      const score = calculateSuccessScore(cvrChange, roasChange, false);
      return { isSuccess: true, successScore: score };
    } else {
      return { isSuccess: false, successScore: 0 };
    }
  }

  // 乗数が1.0の場合（変更なし）
  // 現状維持なので、大きな変動がなければ成功
  const stable = Math.abs(cvrChange) < criteria.maxDegradation &&
                 Math.abs(roasChange) < criteria.maxDegradation;

  if (stable) {
    return { isSuccess: true, successScore: 0.5 };
  } else {
    return { isSuccess: false, successScore: 0 };
  }
}

/**
 * 成功スコアを計算 (0-1)
 */
function calculateSuccessScore(
  cvrChange: number,
  roasChange: number,
  isPositive: boolean
): number {
  if (!isPositive) {
    // 許容範囲内だが改善はしていない
    return 0.3;
  }

  // 改善度に応じてスコアを計算
  const cvrScore = Math.min(1, Math.max(0, cvrChange + 0.1) / 0.2);
  const roasScore = Math.min(1, Math.max(0, roasChange + 0.1) / 0.2);

  // 両方の平均
  const score = (cvrScore + roasScore) / 2;

  // 0.3〜1.0の範囲に正規化
  return 0.3 + score * 0.7;
}

// =============================================================================
// 集計・分析
// =============================================================================

/**
 * 時間帯別の成功率を計算
 */
export function calculateHourlySuccessRates(
  feedbackRecords: DaypartingFeedbackRecord[]
): Map<HourOfDay, { successRate: number; count: number; avgScore: number }> {
  const hourlyStats = new Map<HourOfDay, { successes: number; total: number; scoreSum: number }>();

  // 初期化
  for (let h = 0; h < 24; h++) {
    hourlyStats.set(h as HourOfDay, { successes: 0, total: 0, scoreSum: 0 });
  }

  // 集計
  for (const record of feedbackRecords) {
    if (!record.evaluated) continue;

    const stats = hourlyStats.get(record.hour)!;
    stats.total++;
    if (record.isSuccess) {
      stats.successes++;
    }
    stats.scoreSum += record.successScore ?? 0;
  }

  // 結果を生成
  const result = new Map<HourOfDay, { successRate: number; count: number; avgScore: number }>();

  for (const [hour, stats] of hourlyStats) {
    result.set(hour, {
      successRate: stats.total > 0 ? stats.successes / stats.total : 0,
      count: stats.total,
      avgScore: stats.total > 0 ? stats.scoreSum / stats.total : 0,
    });
  }

  return result;
}

/**
 * 乗数範囲別の成功率を計算
 */
export function calculateMultiplierRangeSuccessRates(
  feedbackRecords: DaypartingFeedbackRecord[]
): {
  boost: { successRate: number; count: number; avgScore: number };
  neutral: { successRate: number; count: number; avgScore: number };
  reduce: { successRate: number; count: number; avgScore: number };
} {
  const ranges = {
    boost: { successes: 0, total: 0, scoreSum: 0 },
    neutral: { successes: 0, total: 0, scoreSum: 0 },
    reduce: { successes: 0, total: 0, scoreSum: 0 },
  };

  for (const record of feedbackRecords) {
    if (!record.evaluated) continue;

    let range: "boost" | "neutral" | "reduce";
    if (record.appliedMultiplier > 1.01) {
      range = "boost";
    } else if (record.appliedMultiplier < 0.99) {
      range = "reduce";
    } else {
      range = "neutral";
    }

    ranges[range].total++;
    if (record.isSuccess) {
      ranges[range].successes++;
    }
    ranges[range].scoreSum += record.successScore ?? 0;
  }

  return {
    boost: {
      successRate: ranges.boost.total > 0 ? ranges.boost.successes / ranges.boost.total : 0,
      count: ranges.boost.total,
      avgScore: ranges.boost.total > 0 ? ranges.boost.scoreSum / ranges.boost.total : 0,
    },
    neutral: {
      successRate: ranges.neutral.total > 0 ? ranges.neutral.successes / ranges.neutral.total : 0,
      count: ranges.neutral.total,
      avgScore: ranges.neutral.total > 0 ? ranges.neutral.scoreSum / ranges.neutral.total : 0,
    },
    reduce: {
      successRate: ranges.reduce.total > 0 ? ranges.reduce.successes / ranges.reduce.total : 0,
      count: ranges.reduce.total,
      avgScore: ranges.reduce.total > 0 ? ranges.reduce.scoreSum / ranges.reduce.total : 0,
    },
  };
}

// =============================================================================
// 日次サマリー
// =============================================================================

/**
 * 日次サマリーを作成
 */
export function createDailySummary(
  date: Date,
  asin: string,
  campaignId: string,
  mode: DaypartingMode,
  actualMetrics: {
    impressions: number;
    clicks: number;
    conversions: number;
    sales: number;
    spend: number;
  },
  estimatedWithoutMultiplier?: {
    impressions: number;
    clicks: number;
    conversions: number;
    sales: number;
  }
): DaypartingDailySummary {
  const estimated = estimatedWithoutMultiplier ?? {
    impressions: actualMetrics.impressions,
    clicks: actualMetrics.clicks,
    conversions: actualMetrics.conversions,
    sales: actualMetrics.sales,
  };

  return {
    date,
    asin,
    campaignId,
    estimatedImpressionsWithoutMultiplier: estimated.impressions,
    estimatedClicksWithoutMultiplier: estimated.clicks,
    estimatedConversionsWithoutMultiplier: estimated.conversions,
    estimatedSalesWithoutMultiplier: estimated.sales,
    actualImpressions: actualMetrics.impressions,
    actualClicks: actualMetrics.clicks,
    actualConversions: actualMetrics.conversions,
    actualSales: actualMetrics.sales,
    actualSpend: actualMetrics.spend,
    incrementalImpressions: actualMetrics.impressions - estimated.impressions,
    incrementalClicks: actualMetrics.clicks - estimated.clicks,
    incrementalConversions: actualMetrics.conversions - estimated.conversions,
    incrementalSales: actualMetrics.sales - estimated.sales,
    mode,
  };
}

/**
 * 日次サマリーの効果を計算
 */
export function calculateDailySummaryEffect(
  summary: DaypartingDailySummary
): {
  incrementalRoi: number;
  incrementalRoas: number;
  incrementalCvr: number;
  isPositive: boolean;
} {
  const incrementalSpend = summary.actualSpend * (summary.incrementalSales / summary.actualSales || 0);

  const incrementalRoi = incrementalSpend > 0
    ? (summary.incrementalSales - incrementalSpend) / incrementalSpend
    : 0;

  const incrementalRoas = incrementalSpend > 0
    ? summary.incrementalSales / incrementalSpend
    : 0;

  const incrementalCvr = summary.incrementalClicks > 0
    ? summary.incrementalConversions / summary.incrementalClicks
    : 0;

  return {
    incrementalRoi,
    incrementalRoas,
    incrementalCvr,
    isPositive: summary.incrementalSales > 0 && incrementalRoi > 0,
  };
}

// =============================================================================
// ログ出力
// =============================================================================

/**
 * フィードバック評価結果をログ出力
 */
export function logFeedbackEvaluation(
  feedback: DaypartingFeedbackRecord
): void {
  if (!feedback.evaluated) return;

  const cvrChange = feedback.cvrBefore > 0 && feedback.cvrAfter !== null
    ? ((feedback.cvrAfter - feedback.cvrBefore) / feedback.cvrBefore * 100).toFixed(1)
    : "N/A";

  const roasChange = feedback.roasBefore > 0 && feedback.roasAfter !== null
    ? ((feedback.roasAfter - feedback.roasBefore) / feedback.roasBefore * 100).toFixed(1)
    : "N/A";

  logger.info("Feedback evaluated", {
    feedbackId: feedback.feedbackId,
    asin: feedback.asin,
    hour: feedback.hour,
    appliedMultiplier: feedback.appliedMultiplier,
    cvrChange: `${cvrChange}%`,
    roasChange: `${roasChange}%`,
    isSuccess: feedback.isSuccess,
    successScore: feedback.successScore?.toFixed(2),
  });
}

/**
 * 日次サマリーをログ出力
 */
export function logDailySummary(summary: DaypartingDailySummary): void {
  const effect = calculateDailySummaryEffect(summary);

  logger.info("Daily summary", {
    date: summary.date.toISOString().split("T")[0],
    asin: summary.asin,
    campaignId: summary.campaignId,
    mode: summary.mode,
    actualSales: `¥${summary.actualSales.toLocaleString()}`,
    incrementalSales: `¥${summary.incrementalSales.toLocaleString()}`,
    incrementalRoi: `${(effect.incrementalRoi * 100).toFixed(1)}%`,
    isPositive: effect.isPositive,
  });
}

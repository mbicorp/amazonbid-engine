/**
 * 季節性予測機能 - ピーク検出アルゴリズム
 *
 * Jungle Scoutの検索ボリューム履歴データから季節的なピークを検出
 * 統計的手法（平均、標準偏差）を使用してピーク月を特定
 */

import {
  PeakInfo,
  MonthlyVolumeStats,
  SeasonalityConfig,
  CategoryHint,
} from "./types";
import { SearchVolumeEstimate } from "../jungle-scout/types";

// =============================================================================
// 月別統計の計算
// =============================================================================

/**
 * 検索ボリューム履歴から月別統計を計算
 *
 * @param estimates Jungle Scoutからの履歴データ
 * @returns 月別統計の配列
 */
export function calculateMonthlyStats(
  estimates: SearchVolumeEstimate[]
): MonthlyVolumeStats[] {
  // 月別にデータをグループ化
  const monthlyData: Map<number, number[]> = new Map();

  for (const estimate of estimates) {
    const date = new Date(estimate.date);
    const month = date.getMonth() + 1; // 1-12

    if (!monthlyData.has(month)) {
      monthlyData.set(month, []);
    }

    // exact検索ボリュームを使用（より正確）
    monthlyData.get(month)!.push(estimate.estimated_exact_search_volume);
  }

  // 各月の統計を計算
  const stats: MonthlyVolumeStats[] = [];

  for (let month = 1; month <= 12; month++) {
    const volumes = monthlyData.get(month) || [];

    if (volumes.length === 0) {
      stats.push({
        month,
        avgVolume: 0,
        stdDev: 0,
        sampleCount: 0,
      });
      continue;
    }

    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const variance =
      volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) /
      volumes.length;
    const stdDev = Math.sqrt(variance);

    stats.push({
      month,
      avgVolume,
      stdDev,
      sampleCount: volumes.length,
    });
  }

  return stats;
}

/**
 * ベースライン（全月平均）を計算
 *
 * @param stats 月別統計
 * @returns ベースライン検索ボリューム
 */
export function calculateBaseline(stats: MonthlyVolumeStats[]): number {
  const validStats = stats.filter((s) => s.sampleCount > 0);
  if (validStats.length === 0) {
    return 0;
  }

  const totalVolume = validStats.reduce((sum, s) => sum + s.avgVolume, 0);
  return totalVolume / validStats.length;
}

// =============================================================================
// ピーク検出
// =============================================================================

/**
 * 履歴データからピーク月を検出
 *
 * @param stats 月別統計
 * @param config 設定
 * @returns 検出されたピーク情報の配列
 */
export function detectPeaksFromStats(
  stats: MonthlyVolumeStats[],
  config: SeasonalityConfig
): PeakInfo[] {
  const baseline = calculateBaseline(stats);
  if (baseline === 0) {
    return [];
  }

  // 全体の標準偏差を計算（ピーク判定閾値用）
  const validStats = stats.filter((s) => s.sampleCount >= config.minSampleCount);
  if (validStats.length < 3) {
    // 最低3ヶ月のデータが必要
    return [];
  }

  const allVolumes = validStats.map((s) => s.avgVolume);
  const globalMean = allVolumes.reduce((sum, v) => sum + v, 0) / allVolumes.length;
  const globalVariance =
    allVolumes.reduce((sum, v) => sum + Math.pow(v - globalMean, 2), 0) /
    allVolumes.length;
  const globalStdDev = Math.sqrt(globalVariance);

  // 標準偏差が0（全月同じ値）の場合はピークなし
  if (globalStdDev === 0) {
    return [];
  }

  // ピーク閾値: baseline + (globalStdDev * multiplier)
  const peakThreshold = baseline + globalStdDev * config.peakStdDevMultiplier;

  const peaks: PeakInfo[] = [];
  const currentYear = new Date().getFullYear();

  for (const stat of validStats) {
    if (stat.avgVolume >= peakThreshold) {
      // ピークと判定
      const volumeMultiplier = stat.avgVolume / baseline;

      // 信頼度計算: サンプル数と閾値からの乖離度に基づく
      const excessRatio = (stat.avgVolume - peakThreshold) / globalStdDev;
      const sampleConfidence = Math.min(stat.sampleCount / 3, 1.0); // 3サンプル以上で最大
      const excessConfidence = Math.min(excessRatio / 2, 1.0); // 2σ以上で最大
      const confidence = sampleConfidence * 0.5 + excessConfidence * 0.5;

      // 予測ピーク日（月の15日を仮定）
      const predictedPeakDate = new Date(currentYear, stat.month - 1, 15);

      // 過去の日付の場合は翌年に調整
      const now = new Date();
      if (predictedPeakDate < now) {
        predictedPeakDate.setFullYear(currentYear + 1);
      }

      peaks.push({
        month: stat.month,
        confidence: Math.min(confidence, 1.0),
        predictedPeakDate,
        fromCategoryHint: false,
        volumeMultiplier,
      });
    }
  }

  // 信頼度順にソート
  return peaks.sort((a, b) => b.confidence - a.confidence);
}

// =============================================================================
// カテゴリヒントからのピーク生成
// =============================================================================

/**
 * カテゴリヒントからピーク情報を生成
 *
 * @param categoryHint カテゴリヒント
 * @returns ピーク情報の配列
 */
export function generatePeaksFromCategoryHint(
  categoryHint: CategoryHint
): PeakInfo[] {
  const currentYear = new Date().getFullYear();
  const now = new Date();

  return categoryHint.expectedPeakMonths.map((month) => {
    const predictedPeakDate = new Date(currentYear, month - 1, 15);

    // 過去の日付の場合は翌年に調整
    if (predictedPeakDate < now) {
      predictedPeakDate.setFullYear(currentYear + 1);
    }

    return {
      month,
      confidence: categoryHint.confidence,
      predictedPeakDate,
      fromCategoryHint: true,
      volumeMultiplier: 1.3, // カテゴリヒントの場合はデフォルト値
    };
  });
}

// =============================================================================
// ピークの統合（JSデータ + カテゴリヒント）
// =============================================================================

/**
 * JSデータとカテゴリヒントからのピークを統合
 *
 * @param jsPeaks Jungle Scoutデータから検出されたピーク
 * @param categoryPeaks カテゴリヒントから生成されたピーク
 * @param config 設定
 * @returns 統合されたピーク情報の配列
 */
export function mergePeaks(
  jsPeaks: PeakInfo[],
  categoryPeaks: PeakInfo[],
  config: SeasonalityConfig
): PeakInfo[] {
  const peaksByMonth: Map<number, PeakInfo> = new Map();

  // JSデータからのピークを追加
  for (const peak of jsPeaks) {
    peaksByMonth.set(peak.month, peak);
  }

  // カテゴリヒントからのピークを統合
  for (const catPeak of categoryPeaks) {
    const existingPeak = peaksByMonth.get(catPeak.month);

    if (existingPeak) {
      // 両方のソースで一致 → 信頼度を上げる
      const combinedConfidence = Math.min(
        existingPeak.confidence * config.jsDataWeight +
          catPeak.confidence * (1 - config.jsDataWeight) +
          0.1, // 一致ボーナス
        1.0
      );

      peaksByMonth.set(catPeak.month, {
        ...existingPeak,
        confidence: combinedConfidence,
        fromCategoryHint: false, // 両方のソース
      });
    } else if (config.useCategoryHints) {
      // カテゴリヒントのみの場合、重みを適用
      peaksByMonth.set(catPeak.month, {
        ...catPeak,
        confidence: catPeak.confidence * config.categoryHintOnlyWeight,
      });
    }
  }

  // 信頼度順にソートして返す
  return Array.from(peaksByMonth.values()).sort(
    (a, b) => b.confidence - a.confidence
  );
}

// =============================================================================
// Pre-peak期間の判定
// =============================================================================

/**
 * 指定日から最も近いピークまでの日数を計算
 *
 * @param peaks ピーク情報の配列
 * @param fromDate 起点日（デフォルトは現在）
 * @returns 最も近いピークまでの日数（ピークがない場合はnull）
 */
export function calculateDaysUntilNextPeak(
  peaks: PeakInfo[],
  fromDate: Date = new Date()
): number | null {
  if (peaks.length === 0) {
    return null;
  }

  const fromTime = fromDate.getTime();
  let minDays: number | null = null;

  for (const peak of peaks) {
    const peakTime = peak.predictedPeakDate.getTime();
    const diffMs = peakTime - fromTime;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      if (minDays === null || diffDays < minDays) {
        minDays = diffDays;
      }
    }
  }

  return minDays;
}

/**
 * 現在がPre-peak期間内かどうかを判定
 *
 * @param daysUntilPeak 次のピークまでの日数
 * @param config 設定
 * @returns Pre-peak期間内ならtrue
 */
export function isInPrePeakPeriod(
  daysUntilPeak: number | null,
  config: SeasonalityConfig
): boolean {
  if (daysUntilPeak === null) {
    return false;
  }

  return (
    daysUntilPeak >= config.prePeakDaysMin &&
    daysUntilPeak <= config.prePeakDaysMax
  );
}

// =============================================================================
// 入札倍率の計算
// =============================================================================

/**
 * Pre-peak期間の進行度に基づいて入札倍率を計算
 *
 * Pre-peak期間の開始時は倍率が低く、ピークに近づくにつれて上昇
 *
 * @param daysUntilPeak 次のピークまでの日数
 * @param config 設定
 * @returns 入札倍率（1.0〜maxMultiplier）
 */
export function calculateBidMultiplier(
  daysUntilPeak: number | null,
  config: SeasonalityConfig
): number {
  if (daysUntilPeak === null) {
    return 1.0;
  }

  if (!isInPrePeakPeriod(daysUntilPeak, config)) {
    return 1.0;
  }

  // Pre-peak期間内での進行度（0 = 開始、1 = ピーク直前）
  const periodLength = config.prePeakDaysMax - config.prePeakDaysMin;
  const daysIntoPeriod = config.prePeakDaysMax - daysUntilPeak;
  const progress = Math.max(0, Math.min(daysIntoPeriod / periodLength, 1.0));

  // イージング関数（緩やかに開始、ピーク近くで加速）
  // 二次関数: progress^2 でゆっくり立ち上がり
  const easedProgress = Math.pow(progress, 2);

  // 倍率を計算
  const multiplierRange = config.maxMultiplier - 1.0;
  const multiplier = 1.0 + multiplierRange * easedProgress;

  return Math.min(multiplier, config.maxMultiplier);
}

// =============================================================================
// 調整理由の生成
// =============================================================================

/**
 * 調整理由の説明文を生成
 *
 * @param daysUntilPeak 次のピークまでの日数
 * @param multiplier 適用される倍率
 * @param peaks ピーク情報
 * @param config 設定
 * @returns 理由説明文
 */
export function generateAdjustmentReason(
  daysUntilPeak: number | null,
  multiplier: number,
  peaks: PeakInfo[],
  config: SeasonalityConfig
): string {
  if (daysUntilPeak === null || peaks.length === 0) {
    return "ピークデータなし - 調整なし";
  }

  if (!isInPrePeakPeriod(daysUntilPeak, config)) {
    if (daysUntilPeak < config.prePeakDaysMin) {
      return `ピーク直前期間（${daysUntilPeak}日後）- 調整終了`;
    }
    return `Pre-peak期間外（${daysUntilPeak}日後）- 調整なし`;
  }

  const nextPeak = peaks.find(
    (p) =>
      Math.abs(
        Math.ceil(
          (p.predictedPeakDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        ) - daysUntilPeak!
      ) <= 1
  );

  const peakMonth = nextPeak ? nextPeak.month : "不明";
  const sourceInfo = nextPeak?.fromCategoryHint
    ? "カテゴリヒント"
    : "JSデータ";
  const confidencePercent = nextPeak
    ? Math.round(nextPeak.confidence * 100)
    : 0;

  return `${peakMonth}月ピークの${daysUntilPeak}日前 - ${Math.round((multiplier - 1) * 100)}%増（信頼度${confidencePercent}%、${sourceInfo}）`;
}

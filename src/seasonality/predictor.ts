/**
 * 季節性予測機能 - 予測ロジック
 *
 * Jungle Scoutデータとカテゴリヒントを組み合わせて
 * キーワードの季節性予測を生成
 */

import {
  SeasonalityPrediction,
  SeasonalityConfig,
  SeasonalityDataSource,
  PeakInfo,
  MonthlyVolumeStats,
  DEFAULT_SEASONALITY_CONFIG,
} from "./types";
import {
  HistoricalSearchVolumeData,
  SearchVolumeEstimate,
} from "../jungle-scout/types";
import { getCategoryHintForKeyword } from "./config";
import {
  calculateMonthlyStats,
  calculateBaseline,
  detectPeaksFromStats,
  generatePeaksFromCategoryHint,
  mergePeaks,
  calculateDaysUntilNextPeak,
  isInPrePeakPeriod,
  calculateBidMultiplier,
  generateAdjustmentReason,
} from "./peak-detector";

// =============================================================================
// メイン予測関数
// =============================================================================

/**
 * キーワードの季節性予測を生成
 *
 * @param keyword 対象キーワード
 * @param jsData Jungle Scoutの履歴データ（nullの場合はカテゴリヒントのみ使用）
 * @param config 設定
 * @param asin オプションのASIN
 * @returns 季節性予測
 */
export function predictSeasonality(
  keyword: string,
  jsData: HistoricalSearchVolumeData | null,
  config: SeasonalityConfig = DEFAULT_SEASONALITY_CONFIG,
  asin?: string
): SeasonalityPrediction {
  const now = new Date();

  // カテゴリヒントを取得
  const categoryHint = config.useCategoryHints
    ? getCategoryHintForKeyword(keyword)
    : null;

  // Jungle Scoutデータから統計を計算
  let monthlyStats: MonthlyVolumeStats[] = [];
  let baseline = 0;
  let jsPeaks: PeakInfo[] = [];

  if (jsData && jsData.attributes.estimates.length > 0) {
    monthlyStats = calculateMonthlyStats(jsData.attributes.estimates);
    baseline = calculateBaseline(monthlyStats);
    jsPeaks = detectPeaksFromStats(monthlyStats, config);
  }

  // カテゴリヒントからのピークを生成
  const categoryPeaks = categoryHint
    ? generatePeaksFromCategoryHint(categoryHint)
    : [];

  // データソースを判定
  const dataSource = determineDataSource(jsPeaks, categoryPeaks);

  // ピークを統合
  let predictedPeaks: PeakInfo[];
  let confidenceScore: number;

  if (dataSource === "JS_ONLY") {
    predictedPeaks = jsPeaks;
    confidenceScore = calculateOverallConfidence(jsPeaks);
  } else if (dataSource === "CATEGORY_HINT") {
    predictedPeaks = categoryPeaks.map((p) => ({
      ...p,
      confidence: p.confidence * config.categoryHintOnlyWeight,
    }));
    confidenceScore =
      calculateOverallConfidence(predictedPeaks) * config.categoryHintOnlyWeight;
  } else {
    // COMBINED
    predictedPeaks = mergePeaks(jsPeaks, categoryPeaks, config);
    confidenceScore = calculateOverallConfidence(predictedPeaks);
  }

  // 次のピークまでの日数を計算
  const daysUntilNextPeak = calculateDaysUntilNextPeak(predictedPeaks);

  // Pre-peak期間判定
  const isPrePeakPeriod = isInPrePeakPeriod(daysUntilNextPeak, config);

  // 入札倍率を計算
  let currentMultiplier = 1.0;
  if (isPrePeakPeriod && confidenceScore >= config.confidenceThreshold) {
    currentMultiplier = calculateBidMultiplier(daysUntilNextPeak, config);
  }

  // 調整理由を生成
  const adjustmentReason = generateAdjustmentReason(
    daysUntilNextPeak,
    currentMultiplier,
    predictedPeaks,
    config
  );

  // 有効期限を計算
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + config.predictionValidityDays);

  return {
    keyword,
    asin,
    predictedPeaks,
    daysUntilNextPeak,
    isPrePeakPeriod,
    currentMultiplier,
    adjustmentReason,
    dataSource,
    categoryHint: categoryHint?.category,
    confidenceScore,
    monthlyStats,
    baselineVolume: baseline,
    generatedAt: now,
    expiresAt,
  };
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * データソースを判定
 */
function determineDataSource(
  jsPeaks: PeakInfo[],
  categoryPeaks: PeakInfo[]
): SeasonalityDataSource {
  const hasJsData = jsPeaks.length > 0;
  const hasCategoryHint = categoryPeaks.length > 0;

  if (hasJsData && hasCategoryHint) {
    return "COMBINED";
  } else if (hasJsData) {
    return "JS_ONLY";
  } else if (hasCategoryHint) {
    return "CATEGORY_HINT";
  }

  // どちらもない場合はカテゴリヒントとして扱う（空）
  return "CATEGORY_HINT";
}

/**
 * 全体の信頼度スコアを計算
 */
function calculateOverallConfidence(peaks: PeakInfo[]): number {
  if (peaks.length === 0) {
    return 0;
  }

  // 最も信頼度の高いピークの信頼度を基準に、ピーク数でボーナス
  const maxConfidence = Math.max(...peaks.map((p) => p.confidence));
  const peakCountBonus = Math.min((peaks.length - 1) * 0.05, 0.15); // 複数ピークでボーナス

  return Math.min(maxConfidence + peakCountBonus, 1.0);
}

// =============================================================================
// バッチ予測
// =============================================================================

/**
 * 複数キーワードの季節性予測をバッチ生成
 *
 * @param keywords キーワードとJSデータのペア
 * @param config 設定
 * @returns 予測結果の配列
 */
export function predictSeasonalityBatch(
  keywords: Array<{
    keyword: string;
    jsData: HistoricalSearchVolumeData | null;
    asin?: string;
  }>,
  config: SeasonalityConfig = DEFAULT_SEASONALITY_CONFIG
): SeasonalityPrediction[] {
  return keywords.map(({ keyword, jsData, asin }) =>
    predictSeasonality(keyword, jsData, config, asin)
  );
}

// =============================================================================
// 予測の有効性チェック
// =============================================================================

/**
 * 予測が有効期限内かどうかをチェック
 *
 * @param prediction 予測結果
 * @returns 有効ならtrue
 */
export function isPredictionValid(prediction: SeasonalityPrediction): boolean {
  return new Date() < prediction.expiresAt;
}

/**
 * 予測が信頼度閾値を満たしているかチェック
 *
 * @param prediction 予測結果
 * @param config 設定
 * @returns 閾値を満たしていればtrue
 */
export function isPredictionConfident(
  prediction: SeasonalityPrediction,
  config: SeasonalityConfig = DEFAULT_SEASONALITY_CONFIG
): boolean {
  return prediction.confidenceScore >= config.confidenceThreshold;
}

/**
 * 予測に基づいて調整が必要かどうかをチェック
 *
 * @param prediction 予測結果
 * @param config 設定
 * @returns 調整が必要ならtrue
 */
export function shouldAdjustBid(
  prediction: SeasonalityPrediction,
  config: SeasonalityConfig = DEFAULT_SEASONALITY_CONFIG
): boolean {
  return (
    prediction.isPrePeakPeriod &&
    isPredictionConfident(prediction, config) &&
    prediction.currentMultiplier > 1.0
  );
}

// =============================================================================
// デバッグ用ユーティリティ
// =============================================================================

/**
 * 予測結果を人間が読みやすい形式でフォーマット
 *
 * @param prediction 予測結果
 * @returns フォーマットされた文字列
 */
export function formatPredictionForDebug(
  prediction: SeasonalityPrediction
): string {
  const lines: string[] = [
    `=== Seasonality Prediction: ${prediction.keyword} ===`,
    `ASIN: ${prediction.asin || "N/A"}`,
    `Data Source: ${prediction.dataSource}`,
    `Category Hint: ${prediction.categoryHint || "N/A"}`,
    `Confidence: ${(prediction.confidenceScore * 100).toFixed(1)}%`,
    ``,
    `--- Peaks ---`,
  ];

  if (prediction.predictedPeaks.length === 0) {
    lines.push("No peaks detected");
  } else {
    for (const peak of prediction.predictedPeaks) {
      const source = peak.fromCategoryHint ? "(hint)" : "(JS)";
      lines.push(
        `  Month ${peak.month}: confidence=${(peak.confidence * 100).toFixed(1)}% ${source}`
      );
    }
  }

  lines.push(``);
  lines.push(`--- Current Status ---`);
  lines.push(
    `Days until next peak: ${prediction.daysUntilNextPeak ?? "N/A"}`
  );
  lines.push(`Is Pre-peak period: ${prediction.isPrePeakPeriod}`);
  lines.push(
    `Current multiplier: ${prediction.currentMultiplier.toFixed(3)}`
  );
  lines.push(`Reason: ${prediction.adjustmentReason}`);
  lines.push(``);
  lines.push(`Generated: ${prediction.generatedAt.toISOString()}`);
  lines.push(`Expires: ${prediction.expiresAt.toISOString()}`);

  return lines.join("\n");
}

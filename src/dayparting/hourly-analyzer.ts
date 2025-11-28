/**
 * Dayparting (時間帯別入札最適化) - 統計分析
 *
 * 時間帯別パフォーマンスの統計的有意性を検定し、
 * 信頼性の高い時間帯のみに乗数を適用するための分析機能
 */

import { logger } from "../logger";
import {
  HourlyPerformanceMetrics,
  HourlyAnalysisResult,
  HourOfDay,
  DayOfWeek,
  ConfidenceLevel,
  HourClassification,
  DAYPARTING_CONSTANTS,
} from "./types";
import {
  determineConfidenceLevel,
  determineClassification,
  CONFIDENCE_MULTIPLIER_FACTORS,
  CLASSIFICATION_BASE_MULTIPLIERS,
} from "./config";
import {
  calculateOverallAverages,
  aggregateMetricsByHour,
} from "./hourly-metrics-collector";

// =============================================================================
// 統計関数
// =============================================================================

/**
 * 標準正規分布のCDF (累積分布関数)
 * Abramowitz and Stegun の近似式を使用
 */
export function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * t分布のCDF
 * 自由度dfのt分布の累積分布関数
 */
export function tCdf(t: number, df: number): number {
  // 正規分布への近似（大きな自由度の場合）
  if (df > 100) {
    return normalCdf(t);
  }

  // ベータ関数を用いた計算
  const x = df / (df + t * t);
  const beta = incompleteBeta(x, df / 2, 0.5);

  if (t >= 0) {
    return 1 - 0.5 * beta;
  } else {
    return 0.5 * beta;
  }
}

/**
 * 不完全ベータ関数
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x === 0) return 0;
  if (x === 1) return 1;

  // 連分数展開による近似
  const maxIterations = 200;
  const epsilon = 1e-10;

  const lnBeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  let f = 1;
  let c = 1;
  let d = 0;

  for (let m = 0; m <= maxIterations; m++) {
    const m2 = 2 * m;

    // Even step
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;

    // Odd step
    aa = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    f *= del;

    if (Math.abs(del - 1) < epsilon) break;
  }

  return front * f;
}

/**
 * ログガンマ関数
 */
function logGamma(x: number): number {
  const c = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5
  ];

  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;

  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += c[j] / y;
  }

  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * 標準誤差を計算
 */
export function standardError(std: number, n: number): number {
  if (n <= 1) return Infinity;
  return std / Math.sqrt(n);
}

/**
 * 1標本t検定
 * サンプル平均が母集団平均と有意に異なるかを検定
 */
export function oneSampleTTest(
  sampleMean: number,
  populationMean: number,
  sampleStd: number,
  sampleSize: number
): { tStat: number; pValue: number; degreesOfFreedom: number } {
  if (sampleSize <= 1 || sampleStd === 0) {
    return { tStat: 0, pValue: 1, degreesOfFreedom: 0 };
  }

  const se = standardError(sampleStd, sampleSize);
  const tStat = (sampleMean - populationMean) / se;
  const df = sampleSize - 1;

  // 両側検定のp値
  const pValue = 2 * (1 - tCdf(Math.abs(tStat), df));

  return { tStat, pValue, degreesOfFreedom: df };
}

/**
 * 平均と標準偏差を計算
 */
export function calculateMeanAndStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) {
    return { mean: 0, std: 0 };
  }

  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;

  if (n === 1) {
    return { mean, std: 0 };
  }

  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
  const std = Math.sqrt(variance);

  return { mean, std };
}

// =============================================================================
// 時間帯分析
// =============================================================================

/**
 * 時間帯別の分析を実行
 */
export function analyzeHourlyPerformance(
  metrics: HourlyPerformanceMetrics[],
  significanceLevel: number = 0.05
): HourlyAnalysisResult[] {
  const results: HourlyAnalysisResult[] = [];

  // 全体平均を計算
  const overall = calculateOverallAverages(metrics);

  // 時間帯別に集約
  const hourlyAggregates = aggregateMetricsByHour(metrics);

  // 時間帯別にCVR/ROASのサンプルを収集
  const hourlyCvrSamples = new Map<HourOfDay, number[]>();
  const hourlyRoasSamples = new Map<HourOfDay, number[]>();

  for (let h = 0; h < 24; h++) {
    hourlyCvrSamples.set(h as HourOfDay, []);
    hourlyRoasSamples.set(h as HourOfDay, []);
  }

  // 各メトリクスをサンプルとして収集
  for (const metric of metrics) {
    if (metric.cvr !== null && metric.clicks >= DAYPARTING_CONSTANTS.MIN_DATA_POINTS) {
      hourlyCvrSamples.get(metric.hour)!.push(metric.cvr);
    }
    if (metric.roas !== null && metric.spend > 0) {
      hourlyRoasSamples.get(metric.hour)!.push(metric.roas);
    }
  }

  // 各時間帯を分析
  for (let h = 0; h < 24; h++) {
    const hour = h as HourOfDay;
    const agg = hourlyAggregates.get(hour)!;
    const cvrSamples = hourlyCvrSamples.get(hour)!;
    const roasSamples = hourlyRoasSamples.get(hour)!;

    // CVRの統計
    const cvrStats = calculateMeanAndStd(cvrSamples);
    const cvrTest = oneSampleTTest(cvrStats.mean, overall.meanCvr, cvrStats.std, cvrSamples.length);

    // ROASの統計
    const roasStats = calculateMeanAndStd(roasSamples);
    const roasTest = oneSampleTTest(roasStats.mean, overall.meanRoas, roasStats.std, roasSamples.length);

    // 相対パフォーマンス
    const relativeCvrPerformance = overall.meanCvr > 0 ? cvrStats.mean / overall.meanCvr : 1;
    const relativeRoasPerformance = overall.meanRoas > 0 ? roasStats.mean / overall.meanRoas : 1;

    // 信頼度判定（CVRとROASの両方を考慮）
    const minSampleSize = Math.min(cvrSamples.length, roasSamples.length);
    const maxPValue = Math.max(cvrTest.pValue, roasTest.pValue);
    const confidence = determineConfidenceLevel(minSampleSize, maxPValue);

    // 分類判定（CVRとROASの平均を使用）
    const avgRelativePerformance = (relativeCvrPerformance + relativeRoasPerformance) / 2;
    const classification = determineClassification(avgRelativePerformance);

    // 推奨乗数の計算
    const recommendedMultiplier = calculateRecommendedMultiplier(
      avgRelativePerformance,
      confidence,
      classification
    );

    results.push({
      hour,
      dayOfWeek: null, // 全曜日平均
      meanCvr: cvrStats.mean,
      stdCvr: cvrStats.std,
      meanRoas: roasStats.mean,
      stdRoas: roasStats.std,
      sampleSize: minSampleSize,
      overallMeanCvr: overall.meanCvr,
      overallMeanRoas: overall.meanRoas,
      relativeCvrPerformance,
      relativeRoasPerformance,
      tStatCvr: cvrTest.tStat,
      pValueCvr: cvrTest.pValue,
      tStatRoas: roasTest.tStat,
      pValueRoas: roasTest.pValue,
      confidence,
      classification,
      recommendedMultiplier,
    });
  }

  return results;
}

/**
 * 時間帯×曜日別の分析を実行
 */
export function analyzeHourlyPerformanceByDay(
  metrics: HourlyPerformanceMetrics[],
  significanceLevel: number = 0.05
): HourlyAnalysisResult[] {
  const results: HourlyAnalysisResult[] = [];

  // 全体平均を計算
  const overall = calculateOverallAverages(metrics);

  // 時間帯×曜日別にサンプルを収集
  const samples = new Map<string, { cvr: number[]; roas: number[] }>();

  for (const metric of metrics) {
    const key = `${metric.hour}|${metric.dayOfWeek}`;
    if (!samples.has(key)) {
      samples.set(key, { cvr: [], roas: [] });
    }
    const s = samples.get(key)!;
    if (metric.cvr !== null && metric.clicks >= DAYPARTING_CONSTANTS.MIN_DATA_POINTS) {
      s.cvr.push(metric.cvr);
    }
    if (metric.roas !== null && metric.spend > 0) {
      s.roas.push(metric.roas);
    }
  }

  // 各時間帯×曜日を分析
  for (const [key, s] of samples) {
    const [hourStr, dayStr] = key.split("|");
    const hour = parseInt(hourStr, 10) as HourOfDay;
    const dayOfWeek = parseInt(dayStr, 10) as DayOfWeek;

    // CVRの統計
    const cvrStats = calculateMeanAndStd(s.cvr);
    const cvrTest = oneSampleTTest(cvrStats.mean, overall.meanCvr, cvrStats.std, s.cvr.length);

    // ROASの統計
    const roasStats = calculateMeanAndStd(s.roas);
    const roasTest = oneSampleTTest(roasStats.mean, overall.meanRoas, roasStats.std, s.roas.length);

    // 相対パフォーマンス
    const relativeCvrPerformance = overall.meanCvr > 0 ? cvrStats.mean / overall.meanCvr : 1;
    const relativeRoasPerformance = overall.meanRoas > 0 ? roasStats.mean / overall.meanRoas : 1;

    // 信頼度判定
    const minSampleSize = Math.min(s.cvr.length, s.roas.length);
    const maxPValue = Math.max(cvrTest.pValue, roasTest.pValue);
    const confidence = determineConfidenceLevel(minSampleSize, maxPValue);

    // 分類判定
    const avgRelativePerformance = (relativeCvrPerformance + relativeRoasPerformance) / 2;
    const classification = determineClassification(avgRelativePerformance);

    // 推奨乗数の計算
    const recommendedMultiplier = calculateRecommendedMultiplier(
      avgRelativePerformance,
      confidence,
      classification
    );

    results.push({
      hour,
      dayOfWeek,
      meanCvr: cvrStats.mean,
      stdCvr: cvrStats.std,
      meanRoas: roasStats.mean,
      stdRoas: roasStats.std,
      sampleSize: minSampleSize,
      overallMeanCvr: overall.meanCvr,
      overallMeanRoas: overall.meanRoas,
      relativeCvrPerformance,
      relativeRoasPerformance,
      tStatCvr: cvrTest.tStat,
      pValueCvr: cvrTest.pValue,
      tStatRoas: roasTest.tStat,
      pValueRoas: roasTest.pValue,
      confidence,
      classification,
      recommendedMultiplier,
    });
  }

  return results;
}

// =============================================================================
// 乗数計算
// =============================================================================

/**
 * 推奨乗数を計算
 */
export function calculateRecommendedMultiplier(
  relativePerformance: number,
  confidence: ConfidenceLevel,
  classification: HourClassification
): number {
  // 信頼度が不十分な場合は1.0（変更なし）
  if (confidence === "INSUFFICIENT") {
    return DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER;
  }

  // 基本乗数を取得
  const baseMultiplier = CLASSIFICATION_BASE_MULTIPLIERS[classification];

  // 信頼度による調整係数
  const confidenceFactor = CONFIDENCE_MULTIPLIER_FACTORS[confidence];

  // 1.0からの差分に信頼度係数を適用
  const adjustedMultiplier = 1.0 + (baseMultiplier - 1.0) * confidenceFactor;

  // 小数点2桁に丸める
  return Math.round(adjustedMultiplier * 100) / 100;
}

/**
 * 有意な時間帯のみをフィルタリング
 */
export function filterSignificantHours(
  analysisResults: HourlyAnalysisResult[],
  minConfidence: ConfidenceLevel = "LOW"
): HourlyAnalysisResult[] {
  const confidenceOrder: ConfidenceLevel[] = ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"];
  const minIndex = confidenceOrder.indexOf(minConfidence);

  return analysisResults.filter((result) => {
    const resultIndex = confidenceOrder.indexOf(result.confidence);
    return resultIndex <= minIndex;
  });
}

/**
 * 分析結果のサマリーを生成
 */
export function generateAnalysisSummary(
  analysisResults: HourlyAnalysisResult[]
): {
  peakHours: HourOfDay[];
  goodHours: HourOfDay[];
  poorHours: HourOfDay[];
  deadHours: HourOfDay[];
  significantCount: number;
  highConfidenceCount: number;
  avgMultiplier: number;
} {
  const peakHours: HourOfDay[] = [];
  const goodHours: HourOfDay[] = [];
  const poorHours: HourOfDay[] = [];
  const deadHours: HourOfDay[] = [];

  let significantCount = 0;
  let highConfidenceCount = 0;
  let multiplierSum = 0;

  for (const result of analysisResults) {
    if (result.confidence !== "INSUFFICIENT") {
      significantCount++;
      multiplierSum += result.recommendedMultiplier;

      if (result.confidence === "HIGH") {
        highConfidenceCount++;
      }
    }

    switch (result.classification) {
      case "PEAK":
        peakHours.push(result.hour);
        break;
      case "GOOD":
        goodHours.push(result.hour);
        break;
      case "POOR":
        poorHours.push(result.hour);
        break;
      case "DEAD":
        deadHours.push(result.hour);
        break;
    }
  }

  return {
    peakHours: peakHours.sort((a, b) => a - b),
    goodHours: goodHours.sort((a, b) => a - b),
    poorHours: poorHours.sort((a, b) => a - b),
    deadHours: deadHours.sort((a, b) => a - b),
    significantCount,
    highConfidenceCount,
    avgMultiplier: significantCount > 0 ? multiplierSum / significantCount : 1.0,
  };
}

/**
 * 分析結果をログ出力
 */
export function logAnalysisResults(
  analysisResults: HourlyAnalysisResult[],
  asin: string,
  campaignId: string
): void {
  const summary = generateAnalysisSummary(analysisResults);

  logger.info("Hourly analysis completed", {
    asin,
    campaignId,
    totalHours: analysisResults.length,
    significantCount: summary.significantCount,
    highConfidenceCount: summary.highConfidenceCount,
    peakHours: summary.peakHours.join(", "),
    goodHours: summary.goodHours.join(", "),
    poorHours: summary.poorHours.join(", "),
    deadHours: summary.deadHours.join(", "),
    avgMultiplier: summary.avgMultiplier.toFixed(2),
  });
}

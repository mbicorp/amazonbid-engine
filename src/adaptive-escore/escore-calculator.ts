/**
 * 自適応型Eスコア最適化システム - Eスコア計算機
 */

import {
  EScoreWeights,
  EScoreComponents,
  EScoreResult,
  EScoreRank,
  OperationMode,
  BrandCategory,
  Season,
  AdaptiveWeightConfig,
} from "./types";
import { DEFAULT_ADAPTIVE_CONFIG, createInitialAdaptiveConfig } from "./config";

// =============================================================================
// 成分スコア計算
// =============================================================================

/**
 * 成果スコアを計算 (0-100)
 * - 売上、クリック数、インプレッションなどに基づく
 */
export function calculatePerformanceScore(metrics: {
  sales: number;
  clicks: number;
  impressions: number;
  cvr: number;
  // 比較用のベースライン
  salesBaseline?: number;
  clicksBaseline?: number;
}): number {
  let score = 0;

  // 売上スコア (0-40点)
  if (metrics.salesBaseline && metrics.salesBaseline > 0) {
    const salesRatio = metrics.sales / metrics.salesBaseline;
    score += Math.min(40, salesRatio * 20);
  } else if (metrics.sales > 0) {
    // ベースラインがない場合は絶対値で評価
    score += Math.min(40, Math.log10(metrics.sales + 1) * 10);
  }

  // クリック数スコア (0-30点)
  if (metrics.clicksBaseline && metrics.clicksBaseline > 0) {
    const clicksRatio = metrics.clicks / metrics.clicksBaseline;
    score += Math.min(30, clicksRatio * 15);
  } else if (metrics.clicks > 0) {
    score += Math.min(30, Math.log10(metrics.clicks + 1) * 8);
  }

  // CVRスコア (0-30点)
  // CVRが高いほど高スコア（最大5%で満点）
  score += Math.min(30, (metrics.cvr / 0.05) * 30);

  return Math.min(100, Math.max(0, score));
}

/**
 * 効率スコアを計算 (0-100)
 * - ACOS、CPC効率などに基づく
 */
export function calculateEfficiencyScore(metrics: {
  acos: number;
  acosTarget: number;
  cpc: number;
  cpcBaseline?: number;
  ctr: number;
}): number {
  let score = 0;

  // ACOSスコア (0-50点)
  // 目標ACOS以下なら高スコア
  if (metrics.acosTarget > 0) {
    const acosRatio = metrics.acos / metrics.acosTarget;
    if (acosRatio <= 0.5) {
      score += 50; // 目標の半分以下は満点
    } else if (acosRatio <= 1.0) {
      score += 50 - (acosRatio - 0.5) * 60; // 目標以下は30-50点
    } else if (acosRatio <= 1.5) {
      score += 20 - (acosRatio - 1.0) * 30; // 目標の1.5倍以下は5-20点
    } else {
      score += Math.max(0, 5 - (acosRatio - 1.5) * 10); // それ以上は0-5点
    }
  }

  // CPC効率スコア (0-25点)
  if (metrics.cpcBaseline && metrics.cpcBaseline > 0) {
    const cpcRatio = metrics.cpc / metrics.cpcBaseline;
    if (cpcRatio <= 0.8) {
      score += 25; // ベースラインの80%以下は満点
    } else if (cpcRatio <= 1.0) {
      score += 25 - (cpcRatio - 0.8) * 50; // ベースライン以下は15-25点
    } else if (cpcRatio <= 1.2) {
      score += 15 - (cpcRatio - 1.0) * 50; // ベースラインの120%以下は5-15点
    } else {
      score += Math.max(0, 5 - (cpcRatio - 1.2) * 25);
    }
  } else {
    score += 12.5; // ベースラインがなければ中央値
  }

  // CTRスコア (0-25点)
  // CTRが高いほど効率的（最大3%で満点）
  score += Math.min(25, (metrics.ctr / 0.03) * 25);

  return Math.min(100, Math.max(0, score));
}

/**
 * ポテンシャルスコアを計算 (0-100)
 * - 成長余地、競合状況、市場機会などに基づく
 */
export function calculatePotentialScore(metrics: {
  rankCurrent: number | null;
  rankTarget: number | null;
  competitorStrength: number; // 0-1
  riskPenalty: number; // 0-1
  impressionsGrowth?: number; // 前期比
  marketShare?: number; // 0-1
}): number {
  let score = 0;

  // ランクギャップスコア (0-30点)
  // 目標ランクに近いほど高スコア
  if (metrics.rankCurrent !== null && metrics.rankTarget !== null) {
    const gap = metrics.rankCurrent - metrics.rankTarget;
    if (gap <= 0) {
      score += 30; // 目標以上は満点
    } else if (gap <= 2) {
      score += 25;
    } else if (gap <= 5) {
      score += 20;
    } else if (gap <= 10) {
      score += 10;
    } else {
      score += 5;
    }
  } else {
    score += 15; // ランク不明は中央値
  }

  // 競合優位性スコア (0-30点)
  // 競合が弱いほど高スコア
  score += (1 - metrics.competitorStrength) * 30;

  // リスクスコア (0-20点)
  // リスクが低いほど高スコア
  score += (1 - metrics.riskPenalty) * 20;

  // インプレッション成長スコア (0-20点)
  if (metrics.impressionsGrowth !== undefined) {
    if (metrics.impressionsGrowth > 0.2) {
      score += 20; // 20%以上成長は満点
    } else if (metrics.impressionsGrowth > 0) {
      score += metrics.impressionsGrowth * 100; // 成長率に応じたスコア
    } else {
      score += Math.max(0, 10 + metrics.impressionsGrowth * 50); // マイナス成長は減点
    }
  } else {
    score += 10; // 成長率不明は中央値
  }

  return Math.min(100, Math.max(0, score));
}

// =============================================================================
// Eスコア計算
// =============================================================================

/**
 * Eスコアランクを決定
 */
export function determineRank(score: number): EScoreRank {
  const thresholds = DEFAULT_ADAPTIVE_CONFIG.rankThresholds;

  if (score >= thresholds.S) return "S";
  if (score >= thresholds.A) return "A";
  if (score >= thresholds.B) return "B";
  if (score >= thresholds.C) return "C";
  return "D";
}

/**
 * Eスコアを計算
 */
export function calculateEScore(
  components: EScoreComponents,
  weights: EScoreWeights
): EScoreResult {
  // 重み付き合計
  const score =
    components.performanceScore * weights.performance +
    components.efficiencyScore * weights.efficiency +
    components.potentialScore * weights.potential;

  return {
    score: Math.min(100, Math.max(0, score)),
    rank: determineRank(score),
    components,
    weights,
  };
}

// =============================================================================
// 適応型重み選択
// =============================================================================

/**
 * コンテキストに基づいて最適な重みを選択
 */
export function selectAdaptiveWeights(
  config: AdaptiveWeightConfig,
  context: {
    mode: OperationMode;
    brandType?: BrandCategory;
    season?: Season;
  }
): EScoreWeights {
  // 基本はモード別重み
  let baseWeights = config.byMode[context.mode].weights;

  // ブランドタイプで調整（存在する場合）
  if (context.brandType && config.byBrandType[context.brandType]) {
    const brandWeights = config.byBrandType[context.brandType].weights;
    // ブレンド（モード70% + ブランド30%）
    baseWeights = blendWeights(baseWeights, brandWeights, 0.7);
  }

  // 季節で調整（存在する場合）
  if (context.season && config.bySeason[context.season]) {
    const seasonWeights = config.bySeason[context.season].weights;
    // ブレンド（現在90% + 季節10%）
    baseWeights = blendWeights(baseWeights, seasonWeights, 0.9);
  }

  return normalizeWeights(baseWeights);
}

/**
 * 2つの重みをブレンド
 */
function blendWeights(
  weights1: EScoreWeights,
  weights2: EScoreWeights,
  ratio: number // weights1の比率
): EScoreWeights {
  return {
    performance: weights1.performance * ratio + weights2.performance * (1 - ratio),
    efficiency: weights1.efficiency * ratio + weights2.efficiency * (1 - ratio),
    potential: weights1.potential * ratio + weights2.potential * (1 - ratio),
  };
}

/**
 * 重みを正規化
 */
function normalizeWeights(weights: EScoreWeights): EScoreWeights {
  const sum = weights.performance + weights.efficiency + weights.potential;
  if (sum === 0) {
    return { performance: 0.4, efficiency: 0.4, potential: 0.2 };
  }
  return {
    performance: weights.performance / sum,
    efficiency: weights.efficiency / sum,
    potential: weights.potential / sum,
  };
}

// =============================================================================
// 統合Eスコア計算機
// =============================================================================

/**
 * キーワードメトリクスからEスコアを計算
 */
export interface KeywordMetricsForEScore {
  // 成果指標
  sales: number;
  clicks: number;
  impressions: number;
  cvr: number;
  salesBaseline?: number;
  clicksBaseline?: number;

  // 効率指標
  acos: number;
  acosTarget: number;
  cpc: number;
  cpcBaseline?: number;
  ctr: number;

  // ポテンシャル指標
  rankCurrent: number | null;
  rankTarget: number | null;
  competitorStrength: number;
  riskPenalty: number;
  impressionsGrowth?: number;
}

/**
 * キーワードメトリクスから完全なEスコア計算を実行
 */
export function calculateFullEScore(
  metrics: KeywordMetricsForEScore,
  context: {
    mode: OperationMode;
    brandType?: BrandCategory;
    season?: Season;
  },
  adaptiveConfig?: AdaptiveWeightConfig
): EScoreResult {
  // 各成分スコアを計算
  const components: EScoreComponents = {
    performanceScore: calculatePerformanceScore({
      sales: metrics.sales,
      clicks: metrics.clicks,
      impressions: metrics.impressions,
      cvr: metrics.cvr,
      salesBaseline: metrics.salesBaseline,
      clicksBaseline: metrics.clicksBaseline,
    }),
    efficiencyScore: calculateEfficiencyScore({
      acos: metrics.acos,
      acosTarget: metrics.acosTarget,
      cpc: metrics.cpc,
      cpcBaseline: metrics.cpcBaseline,
      ctr: metrics.ctr,
    }),
    potentialScore: calculatePotentialScore({
      rankCurrent: metrics.rankCurrent,
      rankTarget: metrics.rankTarget,
      competitorStrength: metrics.competitorStrength,
      riskPenalty: metrics.riskPenalty,
      impressionsGrowth: metrics.impressionsGrowth,
    }),
  };

  // 重みを選択
  const config = adaptiveConfig || createInitialAdaptiveConfig();
  const weights = selectAdaptiveWeights(config, context);

  // Eスコアを計算
  return calculateEScore(components, weights);
}

// =============================================================================
// 現在の季節を取得
// =============================================================================

/**
 * 現在の季節を取得
 */
export function getCurrentSeason(): Season {
  const month = new Date().getMonth() + 1; // 1-12

  if (month >= 1 && month <= 3) return "Q1";
  if (month >= 4 && month <= 6) return "Q2";
  if (month >= 7 && month <= 9) return "Q3";
  return "Q4";
}

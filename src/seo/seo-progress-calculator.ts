/**
 * SEO進捗スコア計算
 *
 * キーワードクラスタ単位でSEO進捗を評価し、seoProgressScoreを計算する
 */

import {
  SeoProgressMetrics,
  SeoProgressConfig,
  RankTargetConfig,
  DEFAULT_SEO_PROGRESS_CONFIG,
  DEFAULT_RANK_TARGET_CONFIG,
} from "./seo-rank-target.types";

// =============================================================================
// seoProgressScore計算
// =============================================================================

/**
 * 順位コンポーネントスコアを計算
 *
 * rankScoreComponent = (targetRank + rankTolerance - organicRank) / max(targetRank, 1)
 *
 * - targetRank付近でおおよそ1
 * - organicRankがtargetRankより悪いほど小さくなる
 * - organicRankがtargetRankより良い場合は1を超える
 *
 * @param organicRank - オーガニック順位
 * @param targetRank - 目標順位
 * @param rankTolerance - 許容誤差
 * @returns 順位コンポーネントスコア（0〜1.5にクランプ）
 */
export function calculateRankScoreComponent(
  organicRank: number,
  targetRank: number,
  rankTolerance: number
): number {
  const denominator = Math.max(targetRank, 1);
  const numerator = targetRank + rankTolerance - organicRank;
  const rawScore = numerator / denominator;

  // 0〜1.5にクランプ
  return Math.max(0, Math.min(1.5, rawScore));
}

/**
 * SOVコンポーネントスコアを計算
 *
 * sovScoreComponent = sov / max(targetSov, epsilon)
 *
 * @param sov - 現在のShare of Voice（%）
 * @param targetSov - 目標SOV（%）
 * @param epsilon - ゼロ除算防止の最小値（デフォルト: 0.1）
 * @returns SOVコンポーネントスコア（0〜1.5にクランプ）
 */
export function calculateSovScoreComponent(
  sov: number,
  targetSov: number,
  epsilon: number = 0.1
): number {
  const denominator = Math.max(targetSov, epsilon);
  const rawScore = sov / denominator;

  // 0〜1.5にクランプ
  return Math.max(0, Math.min(1.5, rawScore));
}

/**
 * SEO進捗スコアを計算
 *
 * seoProgressScore = wRank * clamp(rankScoreComponent, 0, 1.5)
 *                  + wSov  * clamp(sovScoreComponent, 0, 1.5)
 *
 * @param rankScoreComponent - 順位コンポーネントスコア
 * @param sovScoreComponent - SOVコンポーネントスコア
 * @param rankWeight - 順位の重み（wRank）
 * @param sovWeight - SOVの重み（wSov）
 * @returns SEO進捗スコア
 */
export function calculateSeoProgressScore(
  rankScoreComponent: number,
  sovScoreComponent: number,
  rankWeight: number = 0.6,
  sovWeight: number = 0.4
): number {
  return rankWeight * rankScoreComponent + sovWeight * sovScoreComponent;
}

// =============================================================================
// SeoProgressMetrics生成
// =============================================================================

/**
 * SEO進捗メトリクスの入力データ
 */
export interface SeoProgressInput {
  /** クラスタ識別子 */
  clusterId: string;
  /** 商品識別子（ASIN） */
  productId: string;
  /** 代表キーワードのオーガニック順位（中央値など） */
  organicRank: number;
  /** Share of Voice（%） */
  sov: number;
}

/**
 * SEO進捗メトリクスを計算
 *
 * @param input - 入力データ
 * @param rankTargetConfig - 目標順位設定
 * @param progressConfig - 進捗計算設定
 * @returns SEO進捗メトリクス
 */
export function computeSeoProgressMetrics(
  input: SeoProgressInput,
  rankTargetConfig: RankTargetConfig = DEFAULT_RANK_TARGET_CONFIG,
  progressConfig: SeoProgressConfig = DEFAULT_SEO_PROGRESS_CONFIG
): SeoProgressMetrics {
  const { clusterId, productId, organicRank, sov } = input;
  const { targetRank, rankTolerance } = rankTargetConfig;
  const { targetSov, rankWeight, sovWeight } = progressConfig;

  // 各コンポーネントスコアを計算
  const rankScoreComponent = calculateRankScoreComponent(
    organicRank,
    targetRank,
    rankTolerance
  );

  const sovScoreComponent = calculateSovScoreComponent(sov, targetSov);

  // SEO進捗スコアを計算
  const seoProgressScore = calculateSeoProgressScore(
    rankScoreComponent,
    sovScoreComponent,
    rankWeight,
    sovWeight
  );

  return {
    clusterId,
    productId,
    organicRank,
    sov,
    targetRank,
    rankTolerance,
    seoProgressScore,
    rankScoreComponent,
    sovScoreComponent,
    calculatedAt: new Date(),
  };
}

// =============================================================================
// SEO進捗レベル判定
// =============================================================================

/**
 * SEO進捗レベル
 */
export type SeoProgressLevel = "LOW" | "ON_TARGET" | "HIGH";

/**
 * SEO進捗スコアからレベルを判定
 *
 * @param seoProgressScore - SEO進捗スコア
 * @param config - 進捗計算設定
 * @returns SEO進捗レベル
 */
export function determineSeoProgressLevel(
  seoProgressScore: number,
  config: SeoProgressConfig = DEFAULT_SEO_PROGRESS_CONFIG
): SeoProgressLevel {
  if (seoProgressScore < config.seoProgressLowThreshold) {
    return "LOW";
  } else if (seoProgressScore >= config.seoProgressHighThreshold) {
    return "HIGH";
  } else {
    return "ON_TARGET";
  }
}

/**
 * SEO進捗レベルの日本語説明を取得
 *
 * @param level - SEO進捗レベル
 * @returns 日本語説明
 */
export function getSeoProgressLevelDescription(level: SeoProgressLevel): string {
  switch (level) {
    case "LOW":
      return "まだ目標から遠い";
    case "ON_TARGET":
      return "目標レベルに近い";
    case "HIGH":
      return "目標以上に取れている";
  }
}

// =============================================================================
// バルク計算
// =============================================================================

/**
 * 複数クラスタのSEO進捗メトリクスをバルク計算
 *
 * @param inputs - 入力データ配列
 * @param rankTargetConfigs - クラスタID→RankTargetConfigのマップ
 * @param progressConfig - 進捗計算設定
 * @returns クラスタID→SeoProgressMetricsのマップ
 */
export function computeBulkSeoProgressMetrics(
  inputs: SeoProgressInput[],
  rankTargetConfigs: Map<string, RankTargetConfig>,
  progressConfig: SeoProgressConfig = DEFAULT_SEO_PROGRESS_CONFIG
): Map<string, SeoProgressMetrics> {
  const results = new Map<string, SeoProgressMetrics>();

  for (const input of inputs) {
    const rankTargetConfig =
      rankTargetConfigs.get(input.clusterId) ?? DEFAULT_RANK_TARGET_CONFIG;

    const metrics = computeSeoProgressMetrics(
      input,
      rankTargetConfig,
      progressConfig
    );

    results.set(input.clusterId, metrics);
  }

  return results;
}

// =============================================================================
// ユーティリティ
// =============================================================================

/**
 * オーガニック順位の配列から中央値を計算
 *
 * @param ranks - オーガニック順位の配列
 * @returns 中央値
 */
export function calculateMedianRank(ranks: number[]): number {
  if (ranks.length === 0) {
    return Infinity; // データなしは最悪の順位として扱う
  }

  const sorted = [...ranks].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    return sorted[mid];
  }
}

/**
 * SOV（Share of Voice）の配列から平均値を計算
 *
 * @param sovs - SOV値の配列（%）
 * @returns 平均値
 */
export function calculateAverageSov(sovs: number[]): number {
  if (sovs.length === 0) {
    return 0;
  }

  const sum = sovs.reduce((acc, sov) => acc + sov, 0);
  return sum / sovs.length;
}

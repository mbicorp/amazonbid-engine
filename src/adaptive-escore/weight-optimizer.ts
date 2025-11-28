/**
 * 自適応型Eスコア最適化システム - 重み最適化エンジン
 */

import {
  EScoreWeights,
  FeedbackRecord,
  WeightConstraints,
  OptimizationResult,
  LearnedWeights,
} from "./types";
import { DEFAULT_ADAPTIVE_CONFIG } from "./config";
import { logger } from "../logger";

// =============================================================================
// 重みの正規化・検証
// =============================================================================

/**
 * 重みを正規化（合計が1になるように）
 */
export function normalizeWeights(weights: EScoreWeights): EScoreWeights {
  const sum = weights.performance + weights.efficiency + weights.potential;

  if (sum === 0) {
    // フォールバック
    return { performance: 0.4, efficiency: 0.4, potential: 0.2 };
  }

  return {
    performance: weights.performance / sum,
    efficiency: weights.efficiency / sum,
    potential: weights.potential / sum,
  };
}

/**
 * 重みを制約範囲内にクリップ
 */
export function clipWeights(
  weights: EScoreWeights,
  constraints: WeightConstraints
): EScoreWeights {
  const clipped = {
    performance: Math.max(
      constraints.bounds.performance.min,
      Math.min(constraints.bounds.performance.max, weights.performance)
    ),
    efficiency: Math.max(
      constraints.bounds.efficiency.min,
      Math.min(constraints.bounds.efficiency.max, weights.efficiency)
    ),
    potential: Math.max(
      constraints.bounds.potential.min,
      Math.min(constraints.bounds.potential.max, weights.potential)
    ),
  };

  // クリップ後も正規化
  return normalizeWeights(clipped);
}

/**
 * 変動幅を制限
 */
export function limitDelta(
  currentWeights: EScoreWeights,
  newWeights: EScoreWeights,
  maxDelta: number
): EScoreWeights {
  const limited = {
    performance: currentWeights.performance + Math.max(
      -maxDelta,
      Math.min(maxDelta, newWeights.performance - currentWeights.performance)
    ),
    efficiency: currentWeights.efficiency + Math.max(
      -maxDelta,
      Math.min(maxDelta, newWeights.efficiency - currentWeights.efficiency)
    ),
    potential: currentWeights.potential + Math.max(
      -maxDelta,
      Math.min(maxDelta, newWeights.potential - currentWeights.potential)
    ),
  };

  return normalizeWeights(limited);
}

// =============================================================================
// 勾配計算
// =============================================================================

/**
 * 各重みの勾配を計算
 */
function calculateGradients(
  feedbackRecords: FeedbackRecord[]
): EScoreWeights {
  const gradients = {
    performance: 0,
    efficiency: 0,
    potential: 0,
  };

  for (const record of feedbackRecords) {
    if (!record.evaluated || record.success_score === null) continue;

    // 期待した成功度（Eスコアベース）と実際の成功度の差
    const expectedSuccess = record.e_score / 100;
    const actualSuccess = record.success_score;
    const error = expectedSuccess - actualSuccess;

    // 各成分の正規化スコア（0-1）
    const perfNorm = record.performance_score / 100;
    const effNorm = record.efficiency_score / 100;
    const potNorm = record.potential_score / 100;

    // 勾配 = 誤差 × 成分スコア
    // 誤差が正（過大評価）なら、その成分の寄与を減らす方向
    // 誤差が負（過小評価）なら、その成分の寄与を増やす方向
    gradients.performance += error * perfNorm;
    gradients.efficiency += error * effNorm;
    gradients.potential += error * potNorm;
  }

  // 平均化
  const n = feedbackRecords.filter((r) => r.evaluated).length;
  if (n > 0) {
    gradients.performance /= n;
    gradients.efficiency /= n;
    gradients.potential /= n;
  }

  return gradients;
}

// =============================================================================
// メイン最適化関数
// =============================================================================

/**
 * 勾配降下法で重みを最適化
 */
export function optimizeWeightsGradientDescent(
  feedbackRecords: FeedbackRecord[],
  currentWeights: EScoreWeights,
  learningRate: number = DEFAULT_ADAPTIVE_CONFIG.learningRate,
  constraints: WeightConstraints = DEFAULT_ADAPTIVE_CONFIG.constraints
): OptimizationResult {
  const evaluatedRecords = feedbackRecords.filter(
    (r) => r.evaluated && r.success_score !== null
  );

  if (evaluatedRecords.length < DEFAULT_ADAPTIVE_CONFIG.minDataForLearning) {
    logger.warn("Insufficient data for weight optimization", {
      required: DEFAULT_ADAPTIVE_CONFIG.minDataForLearning,
      actual: evaluatedRecords.length,
    });

    // データ不足の場合は現在の重みをそのまま返す
    return {
      previousWeights: { ...currentWeights },
      newWeights: { ...currentWeights },
      delta: { performance: 0, efficiency: 0, potential: 0 },
      dataCount: evaluatedRecords.length,
      previousAccuracy: calculateCurrentAccuracy(evaluatedRecords, currentWeights),
      estimatedAccuracy: calculateCurrentAccuracy(evaluatedRecords, currentWeights),
      optimizedAt: new Date(),
    };
  }

  // 勾配を計算
  const gradients = calculateGradients(evaluatedRecords);

  // 重みを更新（勾配の逆方向に移動）
  const rawNewWeights = {
    performance: currentWeights.performance - learningRate * gradients.performance,
    efficiency: currentWeights.efficiency - learningRate * gradients.efficiency,
    potential: currentWeights.potential - learningRate * gradients.potential,
  };

  // 変動幅を制限
  const limitedWeights = limitDelta(
    currentWeights,
    rawNewWeights,
    constraints.maxDeltaPerUpdate
  );

  // 制約範囲内にクリップ
  const newWeights = clipWeights(limitedWeights, constraints);

  // 精度を計算
  const previousAccuracy = calculateCurrentAccuracy(evaluatedRecords, currentWeights);
  const estimatedAccuracy = calculateCurrentAccuracy(evaluatedRecords, newWeights);

  const result: OptimizationResult = {
    previousWeights: { ...currentWeights },
    newWeights,
    delta: {
      performance: newWeights.performance - currentWeights.performance,
      efficiency: newWeights.efficiency - currentWeights.efficiency,
      potential: newWeights.potential - currentWeights.potential,
    },
    dataCount: evaluatedRecords.length,
    previousAccuracy,
    estimatedAccuracy,
    optimizedAt: new Date(),
  };

  logger.info("Weight optimization completed", {
    dataCount: result.dataCount,
    previousAccuracy: (result.previousAccuracy * 100).toFixed(2) + "%",
    estimatedAccuracy: (result.estimatedAccuracy * 100).toFixed(2) + "%",
    delta: {
      performance: (result.delta.performance * 100).toFixed(2) + "%",
      efficiency: (result.delta.efficiency * 100).toFixed(2) + "%",
      potential: (result.delta.potential * 100).toFixed(2) + "%",
    },
  });

  return result;
}

/**
 * 現在の重みでの精度を計算
 */
function calculateCurrentAccuracy(
  records: FeedbackRecord[],
  weights: EScoreWeights
): number {
  if (records.length === 0) return 0;

  let totalError = 0;

  for (const record of records) {
    if (record.success_score === null) continue;

    // 与えられた重みでEスコアを再計算
    const recalculatedScore =
      record.performance_score * weights.performance +
      record.efficiency_score * weights.efficiency +
      record.potential_score * weights.potential;

    // 正規化して比較
    const normalizedScore = recalculatedScore / 100;
    const error = Math.abs(normalizedScore - record.success_score);
    totalError += error;
  }

  const avgError = totalError / records.length;
  return Math.max(0, 1 - avgError);
}

// =============================================================================
// LearnedWeightsの更新
// =============================================================================

/**
 * LearnedWeightsを更新
 */
export function updateLearnedWeights(
  current: LearnedWeights,
  optimizationResult: OptimizationResult
): LearnedWeights {
  return {
    weights: { ...optimizationResult.newWeights },
    initialWeights: { ...current.initialWeights },
    dataCount: current.dataCount + optimizationResult.dataCount,
    lastUpdated: optimizationResult.optimizedAt,
    accuracy: optimizationResult.estimatedAccuracy,
    version: current.version + 1,
  };
}

// =============================================================================
// バッチ最適化
// =============================================================================

/**
 * 複数イテレーションで最適化（より安定した収束のため）
 */
export function optimizeWeightsMultiIteration(
  feedbackRecords: FeedbackRecord[],
  currentWeights: EScoreWeights,
  iterations: number = 5,
  learningRate: number = DEFAULT_ADAPTIVE_CONFIG.learningRate,
  constraints: WeightConstraints = DEFAULT_ADAPTIVE_CONFIG.constraints
): OptimizationResult {
  let weights = { ...currentWeights };
  let lastResult: OptimizationResult | null = null;

  for (let i = 0; i < iterations; i++) {
    // 学習率を徐々に下げる（学習率減衰）
    const decayedLearningRate = learningRate * Math.pow(0.9, i);

    lastResult = optimizeWeightsGradientDescent(
      feedbackRecords,
      weights,
      decayedLearningRate,
      constraints
    );

    weights = lastResult.newWeights;

    logger.debug(`Optimization iteration ${i + 1}/${iterations}`, {
      accuracy: (lastResult.estimatedAccuracy * 100).toFixed(2) + "%",
    });
  }

  if (!lastResult) {
    return {
      previousWeights: currentWeights,
      newWeights: currentWeights,
      delta: { performance: 0, efficiency: 0, potential: 0 },
      dataCount: 0,
      previousAccuracy: 0,
      estimatedAccuracy: 0,
      optimizedAt: new Date(),
    };
  }

  // 最終的な差分を計算
  return {
    ...lastResult,
    previousWeights: currentWeights,
    delta: {
      performance: lastResult.newWeights.performance - currentWeights.performance,
      efficiency: lastResult.newWeights.efficiency - currentWeights.efficiency,
      potential: lastResult.newWeights.potential - currentWeights.potential,
    },
  };
}

// =============================================================================
// 重み分析
// =============================================================================

/**
 * 重みの変化を分析してレポート
 */
export function analyzeWeightChange(
  initial: EScoreWeights,
  current: EScoreWeights
): {
  performanceChange: number;
  efficiencyChange: number;
  potentialChange: number;
  dominantFactor: "performance" | "efficiency" | "potential";
  summary: string;
} {
  const performanceChange = current.performance - initial.performance;
  const efficiencyChange = current.efficiency - initial.efficiency;
  const potentialChange = current.potential - initial.potential;

  // 最も重要視されている要素
  let dominantFactor: "performance" | "efficiency" | "potential" = "performance";
  if (current.efficiency > current.performance && current.efficiency > current.potential) {
    dominantFactor = "efficiency";
  } else if (current.potential > current.performance && current.potential > current.efficiency) {
    dominantFactor = "potential";
  }

  // サマリー生成
  const changes: string[] = [];
  if (Math.abs(performanceChange) > 0.02) {
    changes.push(`成果重視${performanceChange > 0 ? "増" : "減"}(${(performanceChange * 100).toFixed(1)}%)`);
  }
  if (Math.abs(efficiencyChange) > 0.02) {
    changes.push(`効率重視${efficiencyChange > 0 ? "増" : "減"}(${(efficiencyChange * 100).toFixed(1)}%)`);
  }
  if (Math.abs(potentialChange) > 0.02) {
    changes.push(`ポテンシャル重視${potentialChange > 0 ? "増" : "減"}(${(potentialChange * 100).toFixed(1)}%)`);
  }

  const summary = changes.length > 0
    ? changes.join("、")
    : "重みに大きな変化なし";

  return {
    performanceChange,
    efficiencyChange,
    potentialChange,
    dominantFactor,
    summary,
  };
}

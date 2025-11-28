/**
 * 自適応型Eスコア最適化システム - 安全機構とロールバック
 */

import {
  EScoreWeights,
  FeedbackRecord,
  WeightHistory,
  RollbackThresholds,
  LearnedWeights,
  OptimizationResult,
} from "./types";
import { DEFAULT_ADAPTIVE_CONFIG, DEFAULT_WEIGHTS } from "./config";
import { logger } from "../logger";
import { v4 as uuidv4 } from "uuid";

// =============================================================================
// 異常検知
// =============================================================================

/**
 * 異常検知の結果
 */
export interface AnomalyDetectionResult {
  /** 異常検知されたか */
  isAnomalous: boolean;
  /** 異常の種類 */
  anomalyType: "success_rate_drop" | "acos_degradation" | "none";
  /** 詳細メッセージ */
  message: string;
  /** 現在の値 */
  currentValue: number;
  /** 閾値 */
  threshold: number;
  /** ロールバック推奨 */
  shouldRollback: boolean;
}

/**
 * 成功率の低下を検知
 */
export function detectSuccessRateDrop(
  previousAccuracy: number,
  currentAccuracy: number,
  threshold: number = DEFAULT_ADAPTIVE_CONFIG.rollbackThresholds.successRateDrop
): AnomalyDetectionResult {
  const drop = previousAccuracy - currentAccuracy;

  if (drop >= threshold) {
    return {
      isAnomalous: true,
      anomalyType: "success_rate_drop",
      message: `成功率が${(drop * 100).toFixed(1)}%低下しました（閾値: ${(threshold * 100).toFixed(1)}%）`,
      currentValue: drop,
      threshold,
      shouldRollback: true,
    };
  }

  return {
    isAnomalous: false,
    anomalyType: "none",
    message: "成功率に異常なし",
    currentValue: drop,
    threshold,
    shouldRollback: false,
  };
}

/**
 * ACOS悪化を検知
 */
export function detectAcosDegradation(
  feedbackRecords: FeedbackRecord[],
  threshold: number = DEFAULT_ADAPTIVE_CONFIG.rollbackThresholds.acosDegradation
): AnomalyDetectionResult {
  const evaluatedRecords = feedbackRecords.filter(
    (r) => r.evaluated && r.acos_before > 0 && r.acos_after !== null && r.acos_after > 0
  );

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

  // 平均ACOS変化率を計算
  let totalAcosChange = 0;
  for (const record of evaluatedRecords) {
    const acosChange = ((record.acos_after || 0) - record.acos_before) / record.acos_before;
    totalAcosChange += acosChange;
  }
  const avgAcosChange = totalAcosChange / evaluatedRecords.length;

  if (avgAcosChange >= threshold) {
    return {
      isAnomalous: true,
      anomalyType: "acos_degradation",
      message: `平均ACOSが${(avgAcosChange * 100).toFixed(1)}%悪化しました（閾値: ${(threshold * 100).toFixed(1)}%）`,
      currentValue: avgAcosChange,
      threshold,
      shouldRollback: true,
    };
  }

  return {
    isAnomalous: false,
    anomalyType: "none",
    message: "ACOSに異常なし",
    currentValue: avgAcosChange,
    threshold,
    shouldRollback: false,
  };
}

/**
 * 総合的な異常検知
 */
export function detectAnomalies(
  previousAccuracy: number,
  currentAccuracy: number,
  feedbackRecords: FeedbackRecord[],
  thresholds: RollbackThresholds = DEFAULT_ADAPTIVE_CONFIG.rollbackThresholds
): AnomalyDetectionResult[] {
  const results: AnomalyDetectionResult[] = [];

  // 成功率低下チェック
  results.push(detectSuccessRateDrop(previousAccuracy, currentAccuracy, thresholds.successRateDrop));

  // ACOS悪化チェック
  results.push(detectAcosDegradation(feedbackRecords, thresholds.acosDegradation));

  return results;
}

// =============================================================================
// ロールバック管理
// =============================================================================

/**
 * 重み履歴を作成
 */
export function createWeightHistory(
  targetType: "mode" | "brand_type" | "season",
  targetValue: string,
  weights: EScoreWeights,
  accuracy: number,
  dataCount: number
): WeightHistory {
  return {
    history_id: uuidv4(),
    target_type: targetType,
    target_value: targetValue,
    weights: { ...weights },
    accuracy,
    data_count: dataCount,
    saved_at: new Date(),
    rolled_back: false,
  };
}

/**
 * ロールバックを実行
 */
export function rollbackWeights(
  currentLearnedWeights: LearnedWeights,
  history: WeightHistory
): LearnedWeights {
  logger.warn("Rolling back weights", {
    targetType: history.target_type,
    targetValue: history.target_value,
    fromWeights: currentLearnedWeights.weights,
    toWeights: history.weights,
  });

  return {
    ...currentLearnedWeights,
    weights: { ...history.weights },
    lastUpdated: new Date(),
    accuracy: history.accuracy,
    // バージョンは増やす（ロールバックも変更の一種）
    version: currentLearnedWeights.version + 1,
  };
}

/**
 * デフォルト重みにリセット
 */
export function resetToDefaultWeights(
  mode: "NORMAL" | "S_MODE"
): EScoreWeights {
  logger.warn("Resetting to default weights", { mode });
  return { ...DEFAULT_WEIGHTS[mode] };
}

// =============================================================================
// 安全な最適化
// =============================================================================

/**
 * 安全チェック付きの最適化結果
 */
export interface SafeOptimizationResult {
  /** 最適化結果 */
  result: OptimizationResult;
  /** 異常検知結果 */
  anomalies: AnomalyDetectionResult[];
  /** ロールバックが必要か */
  needsRollback: boolean;
  /** 適用される重み（ロールバック時は以前の重み） */
  finalWeights: EScoreWeights;
  /** 警告メッセージ */
  warnings: string[];
}

/**
 * 最適化結果に安全チェックを適用
 */
export function applySafetyChecks(
  optimizationResult: OptimizationResult,
  feedbackRecords: FeedbackRecord[],
  previousHistory: WeightHistory | null,
  thresholds: RollbackThresholds = DEFAULT_ADAPTIVE_CONFIG.rollbackThresholds
): SafeOptimizationResult {
  const warnings: string[] = [];

  // 異常検知
  const anomalies = detectAnomalies(
    optimizationResult.previousAccuracy,
    optimizationResult.estimatedAccuracy,
    feedbackRecords,
    thresholds
  );

  // ロールバックが必要かチェック
  const needsRollback = anomalies.some((a) => a.shouldRollback);

  let finalWeights: EScoreWeights;

  if (needsRollback) {
    if (previousHistory) {
      // 履歴があればそこに戻す
      finalWeights = previousHistory.weights;
      warnings.push(`異常を検知したため、${previousHistory.saved_at.toISOString()}時点の重みにロールバックします`);
    } else {
      // 履歴がなければ初期重みに戻す
      finalWeights = optimizationResult.previousWeights;
      warnings.push("異常を検知したため、最適化前の重みを維持します");
    }

    // 異常の詳細をログ
    for (const anomaly of anomalies) {
      if (anomaly.isAnomalous) {
        logger.error("Anomaly detected during optimization", {
          type: anomaly.anomalyType,
          message: anomaly.message,
          currentValue: anomaly.currentValue,
          threshold: anomaly.threshold,
        });
        warnings.push(anomaly.message);
      }
    }
  } else {
    // 正常なら新しい重みを適用
    finalWeights = optimizationResult.newWeights;
  }

  return {
    result: optimizationResult,
    anomalies,
    needsRollback,
    finalWeights,
    warnings,
  };
}

// =============================================================================
// 重みの検証
// =============================================================================

/**
 * 重みが有効かどうかを検証
 */
export function validateWeights(weights: EScoreWeights): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 各重みが0以上1以下
  if (weights.performance < 0 || weights.performance > 1) {
    errors.push(`performance重みが範囲外: ${weights.performance}`);
  }
  if (weights.efficiency < 0 || weights.efficiency > 1) {
    errors.push(`efficiency重みが範囲外: ${weights.efficiency}`);
  }
  if (weights.potential < 0 || weights.potential > 1) {
    errors.push(`potential重みが範囲外: ${weights.potential}`);
  }

  // 合計がほぼ1（浮動小数点誤差を許容）
  const sum = weights.performance + weights.efficiency + weights.potential;
  if (Math.abs(sum - 1) > 0.001) {
    errors.push(`重みの合計が1ではありません: ${sum}`);
  }

  // 制約範囲内か
  const constraints = DEFAULT_ADAPTIVE_CONFIG.constraints;
  if (weights.performance < constraints.bounds.performance.min ||
      weights.performance > constraints.bounds.performance.max) {
    errors.push(`performance重みが制約範囲外: ${weights.performance}`);
  }
  if (weights.efficiency < constraints.bounds.efficiency.min ||
      weights.efficiency > constraints.bounds.efficiency.max) {
    errors.push(`efficiency重みが制約範囲外: ${weights.efficiency}`);
  }
  if (weights.potential < constraints.bounds.potential.min ||
      weights.potential > constraints.bounds.potential.max) {
    errors.push(`potential重みが制約範囲外: ${weights.potential}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// =============================================================================
// 監視メトリクス
// =============================================================================

/**
 * 監視用のヘルスチェック結果
 */
export interface HealthCheckResult {
  /** 健全かどうか */
  healthy: boolean;
  /** 現在の精度 */
  currentAccuracy: number;
  /** 過去24時間の精度推移 */
  accuracyTrend: "improving" | "stable" | "declining";
  /** 最後のロールバックからの時間（時間） */
  hoursSinceLastRollback: number | null;
  /** 警告 */
  warnings: string[];
}

/**
 * システムのヘルスチェック
 */
export function performHealthCheck(
  learnedWeights: LearnedWeights,
  recentFeedback: FeedbackRecord[],
  lastRollbackTime: Date | null
): HealthCheckResult {
  const warnings: string[] = [];

  // 精度チェック
  const currentAccuracy = learnedWeights.accuracy;
  if (currentAccuracy < 0.5) {
    warnings.push(`精度が低下しています: ${(currentAccuracy * 100).toFixed(1)}%`);
  }

  // データ量チェック
  if (learnedWeights.dataCount < 100) {
    warnings.push(`学習データが不足しています: ${learnedWeights.dataCount}件`);
  }

  // 精度推移を計算（簡易版）
  let accuracyTrend: "improving" | "stable" | "declining" = "stable";
  const evaluatedRecent = recentFeedback.filter((r) => r.evaluated && r.success_score !== null);
  if (evaluatedRecent.length >= 20) {
    const firstHalf = evaluatedRecent.slice(0, Math.floor(evaluatedRecent.length / 2));
    const secondHalf = evaluatedRecent.slice(Math.floor(evaluatedRecent.length / 2));

    const firstHalfAvg = firstHalf.reduce((s, r) => s + (r.success_score || 0), 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((s, r) => s + (r.success_score || 0), 0) / secondHalf.length;

    if (secondHalfAvg - firstHalfAvg > 0.05) {
      accuracyTrend = "improving";
    } else if (firstHalfAvg - secondHalfAvg > 0.05) {
      accuracyTrend = "declining";
      warnings.push("精度が低下傾向にあります");
    }
  }

  // ロールバックからの時間
  let hoursSinceLastRollback: number | null = null;
  if (lastRollbackTime) {
    hoursSinceLastRollback = (Date.now() - lastRollbackTime.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastRollback < 24) {
      warnings.push(`24時間以内にロールバックが発生しています（${hoursSinceLastRollback.toFixed(1)}時間前）`);
    }
  }

  return {
    healthy: warnings.length === 0,
    currentAccuracy,
    accuracyTrend,
    hoursSinceLastRollback,
    warnings,
  };
}

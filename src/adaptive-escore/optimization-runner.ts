/**
 * 自適応型Eスコア最適化システム - 最適化実行ランナー
 */

import {
  OperationMode,
  BrandCategory,
  Season,
  FeedbackRecord,
  AdaptiveWeightConfig,
  LearnedWeights,
  WeightHistory,
  OptimizationStats,
} from "./types";
import {
  DEFAULT_ADAPTIVE_CONFIG,
  createInitialAdaptiveConfig,
  createInitialLearnedWeights,
  DEFAULT_WEIGHTS,
  DEFAULT_BRAND_WEIGHTS,
  DEFAULT_SEASON_WEIGHTS,
} from "./config";
import {
  optimizeWeightsMultiIteration,
  updateLearnedWeights,
  analyzeWeightChange,
} from "./weight-optimizer";
import {
  applySafetyChecks,
  createWeightHistory,
  performHealthCheck,
  SafeOptimizationResult,
} from "./safety-manager";
import {
  getFeedbackRecordsForLearning,
  saveWeightHistory,
  saveOptimizationLog,
  getLatestWeightHistory,
  markWeightHistoryAsRolledBack,
} from "./bigquery-adapter";
import { logger } from "../logger";

// =============================================================================
// 最適化ランナークラス
// =============================================================================

export class AdaptiveEScoreOptimizer {
  private config: AdaptiveWeightConfig;
  private stats: OptimizationStats;
  private lastRollbackTime: Date | null = null;

  constructor(initialConfig?: AdaptiveWeightConfig) {
    this.config = initialConfig || createInitialAdaptiveConfig();
    this.stats = {
      totalOptimizations: 0,
      successfulOptimizations: 0,
      rollbackCount: 0,
      avgAccuracyImprovement: 0,
      bestAccuracy: 0,
      totalDataProcessed: 0,
    };
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): AdaptiveWeightConfig {
    return this.config;
  }

  /**
   * 統計情報を取得
   */
  getStats(): OptimizationStats {
    return this.stats;
  }

  /**
   * モード別の重みを最適化
   */
  async optimizeForMode(mode: OperationMode): Promise<SafeOptimizationResult> {
    logger.info(`Starting weight optimization for mode: ${mode}`);

    // 学習データを取得
    const feedbackRecords = await getFeedbackRecordsForLearning(
      mode,
      DEFAULT_ADAPTIVE_CONFIG.learningWindowDays
    );

    logger.info(`Fetched ${feedbackRecords.length} feedback records for ${mode}`);

    // 現在の重みを取得
    const currentLearnedWeights = this.config.byMode[mode];

    // 最適化を実行
    const optimizationResult = optimizeWeightsMultiIteration(
      feedbackRecords,
      currentLearnedWeights.weights,
      5, // iterations
      DEFAULT_ADAPTIVE_CONFIG.learningRate,
      DEFAULT_ADAPTIVE_CONFIG.constraints
    );

    // 以前の履歴を取得
    const previousHistory = await getLatestWeightHistory("mode", mode);

    // 安全チェックを適用
    const safeResult = applySafetyChecks(
      optimizationResult,
      feedbackRecords,
      previousHistory,
      DEFAULT_ADAPTIVE_CONFIG.rollbackThresholds
    );

    // 結果を適用
    if (!safeResult.needsRollback) {
      // 新しい重みを保存
      const newHistory = createWeightHistory(
        "mode",
        mode,
        optimizationResult.previousWeights,
        optimizationResult.previousAccuracy,
        currentLearnedWeights.dataCount
      );
      await saveWeightHistory(newHistory);

      // 設定を更新
      this.config.byMode[mode] = updateLearnedWeights(
        currentLearnedWeights,
        optimizationResult
      );

      this.stats.successfulOptimizations++;

      // 精度改善を記録
      const improvement = optimizationResult.estimatedAccuracy - optimizationResult.previousAccuracy;
      this.stats.avgAccuracyImprovement =
        (this.stats.avgAccuracyImprovement * (this.stats.successfulOptimizations - 1) + improvement) /
        this.stats.successfulOptimizations;

      if (optimizationResult.estimatedAccuracy > this.stats.bestAccuracy) {
        this.stats.bestAccuracy = optimizationResult.estimatedAccuracy;
      }
    } else {
      // ロールバック
      this.stats.rollbackCount++;
      this.lastRollbackTime = new Date();

      if (previousHistory) {
        await markWeightHistoryAsRolledBack(previousHistory.history_id);
      }
    }

    // 統計を更新
    this.stats.totalOptimizations++;
    this.stats.totalDataProcessed += optimizationResult.dataCount;

    // 最適化ログを保存
    await saveOptimizationLog(
      "mode",
      mode,
      optimizationResult,
      safeResult.anomalies.some((a) => a.isAnomalous),
      safeResult.needsRollback
    );

    // 分析結果をログ
    const analysis = analyzeWeightChange(
      currentLearnedWeights.initialWeights,
      safeResult.finalWeights
    );
    logger.info(`Weight optimization completed for ${mode}`, {
      needsRollback: safeResult.needsRollback,
      summary: analysis.summary,
      dominantFactor: analysis.dominantFactor,
    });

    return safeResult;
  }

  /**
   * ブランドタイプ別の重みを最適化
   */
  async optimizeForBrandType(brandType: BrandCategory): Promise<SafeOptimizationResult> {
    logger.info(`Starting weight optimization for brand type: ${brandType}`);

    // ブランドタイプ別のデータを取得（両モード合わせて）
    const normalRecords = await getFeedbackRecordsForLearning(
      "NORMAL",
      DEFAULT_ADAPTIVE_CONFIG.learningWindowDays
    );
    const smodeRecords = await getFeedbackRecordsForLearning(
      "S_MODE",
      DEFAULT_ADAPTIVE_CONFIG.learningWindowDays
    );

    // ブランドタイプでフィルタリング
    const feedbackRecords = [...normalRecords, ...smodeRecords].filter(
      (r) => r.brand_type === brandType
    );

    logger.info(`Fetched ${feedbackRecords.length} feedback records for ${brandType}`);

    const currentLearnedWeights = this.config.byBrandType[brandType];

    const optimizationResult = optimizeWeightsMultiIteration(
      feedbackRecords,
      currentLearnedWeights.weights,
      5,
      DEFAULT_ADAPTIVE_CONFIG.learningRate,
      DEFAULT_ADAPTIVE_CONFIG.constraints
    );

    const previousHistory = await getLatestWeightHistory("brand_type", brandType);

    const safeResult = applySafetyChecks(
      optimizationResult,
      feedbackRecords,
      previousHistory,
      DEFAULT_ADAPTIVE_CONFIG.rollbackThresholds
    );

    if (!safeResult.needsRollback) {
      const newHistory = createWeightHistory(
        "brand_type",
        brandType,
        optimizationResult.previousWeights,
        optimizationResult.previousAccuracy,
        currentLearnedWeights.dataCount
      );
      await saveWeightHistory(newHistory);

      this.config.byBrandType[brandType] = updateLearnedWeights(
        currentLearnedWeights,
        optimizationResult
      );
    }

    await saveOptimizationLog(
      "brand_type",
      brandType,
      optimizationResult,
      safeResult.anomalies.some((a) => a.isAnomalous),
      safeResult.needsRollback
    );

    return safeResult;
  }

  /**
   * 全ての最適化を実行
   */
  async runFullOptimization(): Promise<{
    modeResults: Record<OperationMode, SafeOptimizationResult>;
    brandResults: Record<BrandCategory, SafeOptimizationResult>;
    overallSuccess: boolean;
  }> {
    logger.info("Starting full weight optimization");

    const modeResults: Record<OperationMode, SafeOptimizationResult> = {} as any;
    const brandResults: Record<BrandCategory, SafeOptimizationResult> = {} as any;

    // モード別最適化
    for (const mode of ["NORMAL", "S_MODE"] as OperationMode[]) {
      try {
        modeResults[mode] = await this.optimizeForMode(mode);
      } catch (error) {
        logger.error(`Failed to optimize for mode: ${mode}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        // フォールバック結果を作成
        modeResults[mode] = this.createFailedResult(mode);
      }
    }

    // ブランドタイプ別最適化
    for (const brandType of ["BRAND", "CONQUEST", "GENERIC"] as BrandCategory[]) {
      try {
        brandResults[brandType] = await this.optimizeForBrandType(brandType);
      } catch (error) {
        logger.error(`Failed to optimize for brand type: ${brandType}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        brandResults[brandType] = this.createFailedResult(brandType);
      }
    }

    const overallSuccess =
      Object.values(modeResults).every((r) => !r.needsRollback) &&
      Object.values(brandResults).every((r) => !r.needsRollback);

    logger.info("Full weight optimization completed", {
      overallSuccess,
      modeRollbacks: Object.values(modeResults).filter((r) => r.needsRollback).length,
      brandRollbacks: Object.values(brandResults).filter((r) => r.needsRollback).length,
    });

    return { modeResults, brandResults, overallSuccess };
  }

  /**
   * ヘルスチェックを実行
   */
  async performHealthCheck(mode: OperationMode): Promise<ReturnType<typeof performHealthCheck>> {
    const feedbackRecords = await getFeedbackRecordsForLearning(mode, 1); // 過去1日
    const learnedWeights = this.config.byMode[mode];

    return performHealthCheck(learnedWeights, feedbackRecords, this.lastRollbackTime);
  }

  /**
   * 設定をリセット
   */
  resetToDefaults(): void {
    logger.warn("Resetting adaptive E-score config to defaults");
    this.config = createInitialAdaptiveConfig();
  }

  /**
   * 失敗時のダミー結果を作成
   */
  private createFailedResult(target: string): SafeOptimizationResult {
    const now = new Date();
    const defaultWeights = DEFAULT_WEIGHTS.NORMAL;

    return {
      result: {
        previousWeights: defaultWeights,
        newWeights: defaultWeights,
        delta: { performance: 0, efficiency: 0, potential: 0 },
        dataCount: 0,
        previousAccuracy: 0,
        estimatedAccuracy: 0,
        optimizedAt: now,
      },
      anomalies: [],
      needsRollback: true,
      finalWeights: defaultWeights,
      warnings: [`Optimization failed for ${target}`],
    };
  }
}

// =============================================================================
// シングルトンインスタンス
// =============================================================================

let optimizerInstance: AdaptiveEScoreOptimizer | null = null;

/**
 * オプティマイザーのシングルトンインスタンスを取得
 */
export function getOptimizer(): AdaptiveEScoreOptimizer {
  if (!optimizerInstance) {
    optimizerInstance = new AdaptiveEScoreOptimizer();
  }
  return optimizerInstance;
}

/**
 * オプティマイザーをリセット（テスト用）
 */
export function resetOptimizer(): void {
  optimizerInstance = null;
}

// =============================================================================
// スケジュール実行用関数
// =============================================================================

/**
 * 定期実行用の最適化関数
 * Cloud Schedulerなどから呼び出される
 */
export async function runScheduledOptimization(): Promise<{
  success: boolean;
  message: string;
  stats: OptimizationStats;
}> {
  const optimizer = getOptimizer();

  try {
    const results = await optimizer.runFullOptimization();

    return {
      success: results.overallSuccess,
      message: results.overallSuccess
        ? "All optimizations completed successfully"
        : "Some optimizations required rollback",
      stats: optimizer.getStats(),
    };
  } catch (error) {
    logger.error("Scheduled optimization failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      stats: optimizer.getStats(),
    };
  }
}

// =============================================================================
// レポート生成
// =============================================================================

/**
 * 最適化レポートを生成
 */
export function generateOptimizationReport(optimizer: AdaptiveEScoreOptimizer): string {
  const config = optimizer.getConfig();
  const stats = optimizer.getStats();

  const lines: string[] = [
    "========================================",
    "  自適応Eスコア 最適化レポート",
    "========================================",
    "",
    "【統計情報】",
    `  総最適化回数: ${stats.totalOptimizations}`,
    `  成功回数: ${stats.successfulOptimizations}`,
    `  ロールバック回数: ${stats.rollbackCount}`,
    `  平均精度改善: ${(stats.avgAccuracyImprovement * 100).toFixed(2)}%`,
    `  最高精度: ${(stats.bestAccuracy * 100).toFixed(2)}%`,
    `  処理データ数: ${stats.totalDataProcessed}`,
    "",
    "【モード別重み】",
  ];

  for (const mode of ["NORMAL", "S_MODE"] as OperationMode[]) {
    const lw = config.byMode[mode];
    lines.push(`  ${mode}:`);
    lines.push(`    成果: ${(lw.weights.performance * 100).toFixed(1)}%`);
    lines.push(`    効率: ${(lw.weights.efficiency * 100).toFixed(1)}%`);
    lines.push(`    ポテンシャル: ${(lw.weights.potential * 100).toFixed(1)}%`);
    lines.push(`    精度: ${(lw.accuracy * 100).toFixed(1)}%`);
    lines.push(`    データ数: ${lw.dataCount}`);
    lines.push(`    バージョン: ${lw.version}`);
  }

  lines.push("");
  lines.push("【ブランドタイプ別重み】");

  for (const brandType of ["BRAND", "CONQUEST", "GENERIC"] as BrandCategory[]) {
    const lw = config.byBrandType[brandType];
    lines.push(`  ${brandType}:`);
    lines.push(`    成果: ${(lw.weights.performance * 100).toFixed(1)}%`);
    lines.push(`    効率: ${(lw.weights.efficiency * 100).toFixed(1)}%`);
    lines.push(`    ポテンシャル: ${(lw.weights.potential * 100).toFixed(1)}%`);
  }

  lines.push("");
  lines.push("========================================");

  return lines.join("\n");
}

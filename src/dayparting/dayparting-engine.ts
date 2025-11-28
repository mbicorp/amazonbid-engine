/**
 * Dayparting (時間帯別入札最適化) - メインエンジン
 *
 * 時間帯別の入札乗数を計算・適用するメインエンジン
 */

import { logger } from "../logger";
import {
  DaypartingConfig,
  HourlyBidMultiplier,
  DaypartingFeedbackRecord,
  DaypartingDailySummary,
  HourlyAnalysisResult,
  HourOfDay,
  DayOfWeek,
  DaypartingMode,
  DAYPARTING_CONSTANTS,
} from "./types";
import { createDaypartingConfig, validateDaypartingConfig } from "./config";
import {
  collectHourlyMetrics,
  getHourlyMetricsForCampaign,
  getCurrentHourAndDayJST,
  BigQueryConfig,
} from "./hourly-metrics-collector";
import {
  analyzeHourlyPerformance,
  generateAnalysisSummary,
  logAnalysisResults,
} from "./hourly-analyzer";
import {
  calculateMultipliers,
  getMultiplierForCurrentTime,
  applyMultiplierToBid,
  generateDefaultMultipliers,
  mergeMultipliers,
  deactivateMultipliers as deactivateMultipliersInMemory,
  logMultiplierCalculation,
} from "./multiplier-calculator";
import {
  performSafetyCheck,
  performBatchSafetyCheck,
  performHealthCheck,
  createRollbackInfo,
  executeRollback,
  applyGradualChanges,
  DEFAULT_SAFETY_CHECK_CONFIG,
  logRollback,
} from "./safety-manager";
import {
  createFeedbackFromMultiplier,
  evaluateFeedback,
  calculateHourlySuccessRates,
  logFeedbackEvaluation,
} from "./feedback-evaluator";
import {
  saveConfig,
  fetchConfig,
  fetchEnabledConfigs,
  saveMultipliers,
  fetchActiveMultipliers,
  deactivateMultipliers as deactivateMultipliersInBQ,
  saveFeedback,
  updateFeedbackEvaluation,
  fetchUnevaluatedFeedback,
  fetchRecentFeedback,
  saveRollback,
  fetchLatestRollback,
} from "./bigquery-adapter";

// =============================================================================
// 型定義
// =============================================================================

/**
 * エンジン設定
 */
export interface DaypartingEngineConfig {
  projectId: string;
  dataset: string;
}

/**
 * 分析実行結果
 */
export interface AnalysisRunResult {
  asin: string;
  campaignId: string;
  status: "SUCCESS" | "SKIPPED" | "ERROR";
  analysisResults?: HourlyAnalysisResult[];
  multipliers?: HourlyBidMultiplier[];
  error?: string;
  summary?: {
    peakHours: HourOfDay[];
    goodHours: HourOfDay[];
    poorHours: HourOfDay[];
    significantCount: number;
  };
}

/**
 * 乗数適用結果
 */
export interface ApplyMultiplierResult {
  asin: string;
  campaignId: string;
  hour: HourOfDay;
  dayOfWeek: DayOfWeek;
  originalBid: number;
  adjustedBid: number;
  multiplier: number;
  applied: boolean;
  mode: DaypartingMode;
  reason?: string;
}

/**
 * バッチ実行結果
 */
export interface BatchRunResult {
  executionId: string;
  startTime: Date;
  endTime: Date;
  totalConfigs: number;
  successCount: number;
  skippedCount: number;
  errorCount: number;
  results: AnalysisRunResult[];
}

// =============================================================================
// メインエンジン
// =============================================================================

/**
 * DaypartingEngineクラス
 */
export class DaypartingEngine {
  private config: DaypartingEngineConfig;
  private bqConfig: BigQueryConfig;

  constructor(config: DaypartingEngineConfig) {
    this.config = config;
    this.bqConfig = {
      projectId: config.projectId,
      dataset: config.dataset,
    };
  }

  // ===========================================================================
  // 設定管理
  // ===========================================================================

  /**
   * 設定を作成または更新
   */
  async createOrUpdateConfig(
    asin: string,
    campaignId: string,
    adGroupId: string | null = null,
    overrides: Partial<DaypartingConfig> = {}
  ): Promise<DaypartingConfig> {
    const config = createDaypartingConfig(asin, campaignId, adGroupId, overrides);

    const validation = validateDaypartingConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
    }

    await saveConfig(this.bqConfig, config);

    logger.info("Created/updated dayparting config", {
      asin,
      campaignId,
      mode: config.mode,
      enabled: config.enabled,
    });

    return config;
  }

  /**
   * 設定を取得
   */
  async getConfig(
    asin: string,
    campaignId: string,
    adGroupId: string | null = null
  ): Promise<DaypartingConfig | null> {
    return fetchConfig(this.bqConfig, asin, campaignId, adGroupId);
  }

  /**
   * 有効な設定を全て取得
   */
  async getEnabledConfigs(): Promise<DaypartingConfig[]> {
    return fetchEnabledConfigs(this.bqConfig);
  }

  // ===========================================================================
  // 分析・乗数計算
  // ===========================================================================

  /**
   * 単一キャンペーンの分析を実行
   */
  async runAnalysis(
    asin: string,
    campaignId: string,
    adGroupId: string | null = null
  ): Promise<AnalysisRunResult> {
    try {
      // 設定を取得
      const config = await this.getConfig(asin, campaignId, adGroupId);
      if (!config) {
        return {
          asin,
          campaignId,
          status: "SKIPPED",
          error: "Config not found",
        };
      }

      if (!config.enabled) {
        return {
          asin,
          campaignId,
          status: "SKIPPED",
          error: "Dayparting is disabled",
        };
      }

      // メトリクスを収集
      const metrics = await getHourlyMetricsForCampaign(
        this.bqConfig,
        asin,
        campaignId,
        config.analysisWindowDays
      );

      if (metrics.length === 0) {
        return {
          asin,
          campaignId,
          status: "SKIPPED",
          error: "No metrics available",
        };
      }

      // 分析を実行
      const analysisResults = analyzeHourlyPerformance(metrics, config.significanceLevel);

      // 乗数を計算
      const { multipliers, stats } = calculateMultipliers(analysisResults, config);

      // 直近のフィードバックを取得
      const recentFeedback = await fetchRecentFeedback(this.bqConfig, asin, campaignId, 7);

      // 安全チェック
      const safetyResults = performBatchSafetyCheck(
        multipliers,
        config,
        recentFeedback,
        [], // dailySummaries - 必要に応じて取得
        DEFAULT_SAFETY_CHECK_CONFIG
      );

      // 既存の乗数を無効化
      await deactivateMultipliersInBQ(this.bqConfig, asin, campaignId);

      // 新しい乗数を保存
      await saveMultipliers(this.bqConfig, multipliers);

      // ログ出力
      logAnalysisResults(analysisResults, asin, campaignId);
      logMultiplierCalculation({ multipliers, stats }, asin, campaignId);

      const summary = generateAnalysisSummary(analysisResults);

      return {
        asin,
        campaignId,
        status: "SUCCESS",
        analysisResults,
        multipliers,
        summary: {
          peakHours: summary.peakHours,
          goodHours: summary.goodHours,
          poorHours: summary.poorHours,
          significantCount: summary.significantCount,
        },
      };
    } catch (error) {
      logger.error("Analysis failed", {
        asin,
        campaignId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        asin,
        campaignId,
        status: "ERROR",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 全有効キャンペーンの分析をバッチ実行
   */
  async runBatchAnalysis(): Promise<BatchRunResult> {
    const executionId = `daypart_batch_${Date.now()}`;
    const startTime = new Date();

    logger.info("Starting batch analysis", { executionId });

    const configs = await this.getEnabledConfigs();
    const results: AnalysisRunResult[] = [];
    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const config of configs) {
      const result = await this.runAnalysis(
        config.asin,
        config.campaignId,
        config.adGroupId
      );

      results.push(result);

      switch (result.status) {
        case "SUCCESS":
          successCount++;
          break;
        case "SKIPPED":
          skippedCount++;
          break;
        case "ERROR":
          errorCount++;
          break;
      }
    }

    const endTime = new Date();

    logger.info("Batch analysis completed", {
      executionId,
      totalConfigs: configs.length,
      successCount,
      skippedCount,
      errorCount,
      durationMs: endTime.getTime() - startTime.getTime(),
    });

    return {
      executionId,
      startTime,
      endTime,
      totalConfigs: configs.length,
      successCount,
      skippedCount,
      errorCount,
      results,
    };
  }

  // ===========================================================================
  // 乗数適用
  // ===========================================================================

  /**
   * 現在時刻の乗数を取得
   */
  async getCurrentMultiplier(
    asin: string,
    campaignId: string
  ): Promise<HourlyBidMultiplier | null> {
    const multipliers = await fetchActiveMultipliers(this.bqConfig, asin, campaignId);
    const { hour, dayOfWeek } = getCurrentHourAndDayJST();

    return getMultiplierForCurrentTime(multipliers, hour, dayOfWeek);
  }

  /**
   * 入札額に乗数を適用
   */
  async applyMultiplier(
    asin: string,
    campaignId: string,
    baseBid: number
  ): Promise<ApplyMultiplierResult> {
    const { hour, dayOfWeek } = getCurrentHourAndDayJST();

    // 設定を取得
    const config = await this.getConfig(asin, campaignId);
    if (!config || !config.enabled) {
      return {
        asin,
        campaignId,
        hour,
        dayOfWeek,
        originalBid: baseBid,
        adjustedBid: baseBid,
        multiplier: DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER,
        applied: false,
        mode: config?.mode ?? "OFF",
        reason: config ? "Dayparting disabled" : "Config not found",
      };
    }

    // 乗数を取得
    const multiplier = await this.getCurrentMultiplier(asin, campaignId);
    if (!multiplier) {
      return {
        asin,
        campaignId,
        hour,
        dayOfWeek,
        originalBid: baseBid,
        adjustedBid: baseBid,
        multiplier: DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER,
        applied: false,
        mode: config.mode,
        reason: "No multiplier found for current hour",
      };
    }

    // 入札額を計算
    const adjustedBid = applyMultiplierToBid(baseBid, multiplier.multiplier);

    // モードに応じて適用
    const shouldApply = config.mode === "APPLY";

    // フィードバックを記録
    if (shouldApply || config.mode === "SHADOW") {
      const feedback = createFeedbackFromMultiplier(multiplier, {
        cvr: 0, // 実際の値は後で更新
        roas: 0,
        clicks: 0,
        conversions: 0,
      });
      await saveFeedback(this.bqConfig, feedback);
    }

    return {
      asin,
      campaignId,
      hour,
      dayOfWeek,
      originalBid: baseBid,
      adjustedBid: shouldApply ? adjustedBid : baseBid,
      multiplier: multiplier.multiplier,
      applied: shouldApply,
      mode: config.mode,
    };
  }

  // ===========================================================================
  // フィードバック評価
  // ===========================================================================

  /**
   * 未評価のフィードバックを評価
   */
  async evaluateUnevaluatedFeedback(): Promise<number> {
    const unevaluated = await fetchUnevaluatedFeedback(this.bqConfig, 3);

    let evaluatedCount = 0;

    for (const feedback of unevaluated) {
      try {
        // 3時間後のメトリクスを取得
        // 実際の実装ではBigQueryから適切なデータを取得
        const afterMetrics = {
          cvrAfter: 0, // 実際の値
          roasAfter: 0,
          clicksAfter: 0,
          conversionsAfter: 0,
        };

        const evaluated = evaluateFeedback(feedback, afterMetrics);

        await updateFeedbackEvaluation(this.bqConfig, feedback.feedbackId, {
          cvrAfter: evaluated.cvrAfter!,
          roasAfter: evaluated.roasAfter!,
          clicksAfter: evaluated.clicksAfter!,
          conversionsAfter: evaluated.conversionsAfter!,
          isSuccess: evaluated.isSuccess!,
          successScore: evaluated.successScore!,
        });

        logFeedbackEvaluation(evaluated);
        evaluatedCount++;
      } catch (error) {
        logger.error("Failed to evaluate feedback", {
          feedbackId: feedback.feedbackId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Feedback evaluation completed", {
      total: unevaluated.length,
      evaluated: evaluatedCount,
    });

    return evaluatedCount;
  }

  // ===========================================================================
  // ロールバック
  // ===========================================================================

  /**
   * ロールバックを実行
   */
  async performRollback(
    asin: string,
    campaignId: string,
    reason: string
  ): Promise<void> {
    // 現在の乗数を取得
    const currentMultipliers = await fetchActiveMultipliers(this.bqConfig, asin, campaignId);

    // ロールバック情報を作成
    const rollbackInfo = createRollbackInfo(asin, campaignId, reason, currentMultipliers);

    // ロールバックを実行
    const rolledBackMultipliers = executeRollback(currentMultipliers);

    // 現在の乗数を無効化
    await deactivateMultipliersInBQ(this.bqConfig, asin, campaignId);

    // リセットされた乗数を保存
    await saveMultipliers(this.bqConfig, rolledBackMultipliers);

    // ロールバック情報を保存
    await saveRollback(this.bqConfig, rollbackInfo);

    logRollback(rollbackInfo);
  }

  // ===========================================================================
  // ヘルスチェック
  // ===========================================================================

  /**
   * ヘルスチェックを実行
   */
  async runHealthCheck(
    asin: string,
    campaignId: string
  ): Promise<ReturnType<typeof performHealthCheck>> {
    const config = await this.getConfig(asin, campaignId);
    if (!config) {
      throw new Error("Config not found");
    }

    const multipliers = await fetchActiveMultipliers(this.bqConfig, asin, campaignId);
    const feedback = await fetchRecentFeedback(this.bqConfig, asin, campaignId, 7);
    const lastRollback = await fetchLatestRollback(this.bqConfig, asin, campaignId);

    return performHealthCheck(
      config,
      multipliers,
      feedback,
      [], // dailySummaries
      lastRollback?.rolledBackAt ?? null
    );
  }
}

// =============================================================================
// シングルトン
// =============================================================================

let engineInstance: DaypartingEngine | null = null;

/**
 * Daypartingエンジンのシングルトンを取得
 */
export function getDaypartingEngine(config?: DaypartingEngineConfig): DaypartingEngine {
  if (!engineInstance && !config) {
    throw new Error("DaypartingEngine must be initialized with config first");
  }

  if (config) {
    engineInstance = new DaypartingEngine(config);
  }

  return engineInstance!;
}

/**
 * Daypartingエンジンをリセット（テスト用）
 */
export function resetDaypartingEngine(): void {
  engineInstance = null;
}

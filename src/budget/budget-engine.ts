/**
 * Budget Engine - 日予算最適化エンジン
 *
 * キャンペーンの日予算を「予算によるインプレッションシェア損失」と「ACOSの健全性」に基づいて自動最適化
 * BID_ENGINE_EXECUTION_MODE 環境変数（SHADOW/APPLY）に従う
 *
 * コアコンセプト:
 * 「予算が足りない（Usageが高い または Lost ISがある）」かつ「利益が出ている（ACOSが低い）」
 * 場合のみ、予算を引き上げる。無駄遣いしているキャンペーンの予算は増やさない。
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import { getExecutionMode, isShadowMode } from "../logging";
import {
  BudgetMetrics,
  BudgetRecommendation,
  BudgetEngineResult,
  BudgetOptimizerConfig,
  DEFAULT_BUDGET_OPTIMIZER_CONFIG,
} from "./types";
import {
  computeBudgetRecommendations,
  countBudgetActions,
  calculateTotalBudgetChange,
} from "./budget-calculator";
import {
  BudgetBigQueryAdapter,
  createBudgetBigQueryAdapter,
} from "./bigquery-adapter";

// =============================================================================
// 型定義
// =============================================================================

/**
 * BudgetEngine の設定
 */
export interface BudgetEngineConfig {
  /** GCP プロジェクト ID */
  projectId: string;

  /** BigQuery データセット名 */
  dataset: string;

  /** 対象キャンペーン ID（省略時は全キャンペーン） */
  targetCampaignIds?: string[];

  /** 最適化設定（省略時はデフォルト） */
  optimizerConfig?: BudgetOptimizerConfig;

  /** トリガー元（ログ用） */
  triggerSource?: "CRON" | "MANUAL" | "API";

  /** ドライラン（テーブル保存しない） */
  dryRun?: boolean;
}

// =============================================================================
// メインエンジン
// =============================================================================

/**
 * 日予算最適化エンジンを実行
 *
 * 1. BigQuery から campaign_budget_metrics を取得
 * 2. 各キャンペーンについて予算推奨を計算
 * 3. SHADOW モードでは推奨をログに記録のみ
 * 4. APPLY モードでは Amazon Ads API を呼び出して適用（将来実装）
 * 5. 結果を budget_recommendations テーブルに保存
 *
 * @param config - エンジン設定
 * @returns 実行結果
 */
export async function runBudgetEngine(
  config: BudgetEngineConfig
): Promise<BudgetEngineResult> {
  const executionId = uuidv4();
  const startedAt = new Date();
  const mode = getExecutionMode();
  const optimizerConfig = config.optimizerConfig ?? DEFAULT_BUDGET_OPTIMIZER_CONFIG;

  logger.info("Starting budget optimization engine", {
    executionId,
    mode,
    projectId: config.projectId,
    dataset: config.dataset,
    targetCampaigns: config.targetCampaignIds?.length ?? "all",
    triggerSource: config.triggerSource ?? "MANUAL",
    dryRun: config.dryRun ?? false,
  });

  // BigQuery アダプターを作成
  const bqAdapter = createBudgetBigQueryAdapter({
    projectId: config.projectId,
    dataset: config.dataset,
  });

  try {
    // ========================================
    // Step 1: メトリクスを取得
    // ========================================
    const metrics = await bqAdapter.loadBudgetMetrics(config.targetCampaignIds);

    if (metrics.length === 0) {
      logger.warn("No budget metrics found", {
        executionId,
        targetCampaigns: config.targetCampaignIds ?? "all",
      });

      const finishedAt = new Date();
      return {
        success: true,
        executionId,
        mode,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        totalCampaigns: 0,
        recommendationsCount: 0,
        actionCounts: { BOOST: 0, KEEP: 0, CURB: 0 },
        recommendations: [],
      };
    }

    logger.info("Loaded budget metrics", {
      executionId,
      totalCampaigns: metrics.length,
    });

    // ========================================
    // Step 2: 推奨を計算
    // ========================================
    const recommendations = computeBudgetRecommendations(metrics, optimizerConfig);

    // アクション別件数を集計
    const actionCounts = countBudgetActions(recommendations);
    const budgetChanges = calculateTotalBudgetChange(recommendations);

    // 変更があるもののみフィルタ（KEEP 以外）
    const activeRecommendations = recommendations.filter(
      (rec) => rec.action !== "KEEP"
    );

    logger.info("Computed budget recommendations", {
      executionId,
      totalRecommendations: recommendations.length,
      activeRecommendations: activeRecommendations.length,
      actionCounts,
      totalBudgetIncrease: budgetChanges.totalIncrease,
      totalBudgetDecrease: budgetChanges.totalDecrease,
      netBudgetChange: budgetChanges.netChange,
    });

    // ========================================
    // Step 3: 推奨を適用（APPLY モードの場合）
    // ========================================
    let appliedCount = 0;
    const isApply = mode === "APPLY";

    if (isApply && activeRecommendations.length > 0) {
      // TODO: Amazon Ads API を呼び出して実際に適用
      // 現時点では未実装のため、ログのみ
      logger.info("APPLY mode: Would apply daily budget changes", {
        executionId,
        count: activeRecommendations.length,
        boostCount: actionCounts.BOOST,
        curbCount: actionCounts.CURB,
        totalBudgetIncrease: budgetChanges.totalIncrease,
        totalBudgetDecrease: budgetChanges.totalDecrease,
        note: "Amazon Ads API integration not yet implemented",
      });

      // 将来的にはここで各推奨を適用し、エラーがあれば bqAdapter.updateApplyError を呼ぶ
      appliedCount = 0; // 実装後は実際の適用数
    } else if (isShadowMode()) {
      logger.info("SHADOW mode: Skipping actual budget changes", {
        executionId,
        activeRecommendations: activeRecommendations.length,
        boostCount: actionCounts.BOOST,
        curbCount: actionCounts.CURB,
      });
    }

    // ========================================
    // Step 4: 結果を BigQuery に保存
    // ========================================
    if (!config.dryRun) {
      try {
        await bqAdapter.saveRecommendations(
          executionId,
          recommendations,
          isApply && appliedCount > 0
        );
      } catch (saveError) {
        logger.error("Failed to save budget recommendations to BigQuery", {
          executionId,
          error: saveError instanceof Error ? saveError.message : String(saveError),
        });
        // 保存失敗は致命的ではないので続行
      }
    } else {
      logger.info("Dry run: Skipping BigQuery save", {
        executionId,
        recommendationsCount: recommendations.length,
      });
    }

    // ========================================
    // Step 5: 結果を返す
    // ========================================
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    const result: BudgetEngineResult = {
      success: true,
      executionId,
      mode,
      startedAt,
      finishedAt,
      durationMs,
      totalCampaigns: metrics.length,
      recommendationsCount: recommendations.length,
      actionCounts,
      recommendations,
    };

    logger.info("Budget optimization engine completed", {
      executionId,
      mode,
      durationMs,
      totalCampaigns: metrics.length,
      activeRecommendations: activeRecommendations.length,
      boostCount: actionCounts.BOOST,
      curbCount: actionCounts.CURB,
      netBudgetChange: budgetChanges.netChange,
    });

    return result;

  } catch (error) {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Budget optimization engine failed", {
      executionId,
      mode,
      durationMs,
      error: errorMessage,
    });

    return {
      success: false,
      executionId,
      mode,
      startedAt,
      finishedAt,
      durationMs,
      totalCampaigns: 0,
      recommendationsCount: 0,
      actionCounts: { BOOST: 0, KEEP: 0, CURB: 0 },
      recommendations: [],
      errorMessage,
    };
  }
}

// =============================================================================
// ユーティリティ
// =============================================================================

/**
 * 実行モード情報をログ出力
 */
export function logBudgetExecutionModeOnStartup(): void {
  const mode = getExecutionMode();

  if (mode === "SHADOW") {
    logger.info("Budget engine starting in SHADOW mode", {
      mode,
      description: "Recommendations will be calculated and logged but NOT applied to Amazon Ads",
    });
  } else {
    logger.info("Budget engine starting in APPLY mode", {
      mode,
      description: "Recommendations WILL be applied to Amazon Ads API",
      warning: "This will modify actual daily budgets",
    });
  }
}

/**
 * 設定情報をログ出力
 */
export function logBudgetOptimizerConfigOnStartup(
  config: BudgetOptimizerConfig = DEFAULT_BUDGET_OPTIMIZER_CONFIG
): void {
  logger.info("Budget optimizer configuration", {
    // 増額判定
    boostUsageThreshold: `${config.boostUsageThreshold}%`,
    boostLostIsThreshold: `${config.boostLostIsThreshold}%`,
    boostAcosRatio: `${(config.boostAcosRatio * 100).toFixed(0)}% of target`,
    boostPercent: `+${config.boostPercent}%`,

    // 減額判定
    curbUsageThreshold: `<${config.curbUsageThreshold}%`,
    curbLowUsageDays: `${config.curbLowUsageDays} days`,
    curbAcosRatio: `${(config.curbAcosRatio * 100).toFixed(0)}% of target`,
    curbPercent: `-${config.curbPercent}%`,

    // ガードレール
    globalMaxBudgetCap: `¥${config.globalMaxBudgetCap.toLocaleString()}`,
    maxBudgetMultiplier: `${config.maxBudgetMultiplier}x`,
    minBudget: `¥${config.minBudget.toLocaleString()}`,

    // データ有意性
    minOrdersForDecision: config.minOrdersForDecision,
  });
}

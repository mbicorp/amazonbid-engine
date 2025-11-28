/**
 * LAUNCH終了判定のBigQueryログ出力
 *
 * SHADOWモードでlaunch_exit_decisionsテーブルにLAUNCH終了判定結果を記録する。
 * このモジュールは、lifecycleSuggestionから呼び出される。
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import { ExecutionMode } from "../logging/types";
import {
  EvaluateLaunchExitForAsinResult,
  AsinSeoLaunchProgress,
  LaunchExitThresholdsComputed,
  LaunchExitDecision,
} from "./seo-launch-evaluator";
import { LifecycleTransitionDecision } from "./transition-logic";

// =============================================================================
// 型定義
// =============================================================================

/**
 * launch_exit_decisionsテーブルの行
 */
export interface LaunchExitDecisionRow {
  runtime_date: string;
  execution_id: string;
  mode: string;
  asin: string;
  current_lifecycle_stage: string;
  suggested_lifecycle_stage: string | null;
  should_exit_launch: boolean;
  is_emergency_exit: boolean | null;
  reason_codes: string[];
  reason_message: string | null;
  seo_completion_ratio: number | null;
  seo_success_ratio: number | null;
  total_core_keywords: number | null;
  achieved_count: number | null;
  gave_up_count: number | null;
  active_count: number | null;
  days_since_launch: number | null;
  asin_clicks_total: number | null;
  asin_orders_total: number | null;
  avg_daily_sales_30d: number | null;
  loss_budget_ratio: number | null;
  loss_investment_state: string | null;
  volume_scale: number | null;
  threshold_min_completion_ratio: number | null;
  threshold_min_launch_days: number | null;
  threshold_min_clicks: number | null;
  threshold_min_orders: number | null;
  threshold_emergency_loss_ratio: number | null;
  created_at: string;
}

/**
 * ログ出力に必要な入力情報
 */
export interface LaunchExitDecisionLogInput {
  /** 実行ID */
  executionId: string;
  /** 実行モード */
  mode: ExecutionMode;
  /** ASIN */
  asin: string;
  /** 現在のライフサイクルステージ */
  currentLifecycleStage: string;
  /** LAUNCH終了評価結果 */
  launchExitEvaluation: EvaluateLaunchExitForAsinResult;
  /** ライフサイクル遷移判定結果（遷移がない場合はnull） */
  transitionDecision: LifecycleTransitionDecision | null;
  /** ローンチ開始からの日数 */
  daysSinceLaunch: number;
  /** ASIN累計クリック */
  asinClicksTotal: number;
  /** ASIN累計注文 */
  asinOrdersTotal: number;
  /** 直近30日の平均日販数 */
  avgDailySales30d: number;
}

/**
 * LaunchExitDecisionLoggerの設定
 */
export interface LaunchExitDecisionLoggerOptions {
  projectId: string;
  dataset: string;
}

// =============================================================================
// LaunchExitDecisionLogger クラス
// =============================================================================

/**
 * LAUNCH終了判定をBigQueryに記録するクラス
 */
export class LaunchExitDecisionLogger {
  private bigquery: BigQuery;
  private options: LaunchExitDecisionLoggerOptions;
  private buffer: LaunchExitDecisionRow[];
  private readonly BUFFER_SIZE = 100;
  private readonly TABLE_NAME = "launch_exit_decisions";

  constructor(options: LaunchExitDecisionLoggerOptions) {
    this.bigquery = new BigQuery({ projectId: options.projectId });
    this.options = options;
    this.buffer = [];
  }

  /**
   * LAUNCH終了判定をログに追加（バッファリング）
   *
   * @param input - ログ出力に必要な入力情報
   */
  async log(input: LaunchExitDecisionLogInput): Promise<void> {
    // SHADOWモードの場合のみログを記録
    if (input.mode !== "SHADOW") {
      logger.debug("Skipping launch exit decision log (not SHADOW mode)", {
        asin: input.asin,
        mode: input.mode,
      });
      return;
    }

    const row = this.buildRow(input);
    this.buffer.push(row);

    // バッファがいっぱいになったらフラッシュ
    if (this.buffer.length >= this.BUFFER_SIZE) {
      await this.flush();
    }
  }

  /**
   * 複数のLAUNCH終了判定を一括でログに追加
   *
   * @param inputs - ログ出力に必要な入力情報の配列
   */
  async logBulk(inputs: LaunchExitDecisionLogInput[]): Promise<void> {
    for (const input of inputs) {
      await this.log(input);
    }
  }

  /**
   * バッファをフラッシュしてBigQueryに書き込む
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const rows = [...this.buffer];
    this.buffer = [];

    try {
      await this.bigquery
        .dataset(this.options.dataset)
        .table(this.TABLE_NAME)
        .insert(rows);

      logger.debug("Flushed launch exit decision logs", {
        count: rows.length,
      });
    } catch (error) {
      logger.error("Failed to flush launch exit decision logs", {
        count: rows.length,
        error: error instanceof Error ? error.message : String(error),
      });
      // ログ失敗は実行を止めない
    }
  }

  /**
   * 入力情報からBigQuery行を構築
   */
  private buildRow(input: LaunchExitDecisionLogInput): LaunchExitDecisionRow {
    const { launchExitEvaluation, transitionDecision } = input;
    const { decision, thresholds, progress } = launchExitEvaluation;

    const now = new Date();
    const runtimeDate = now.toISOString().split("T")[0];

    return {
      runtime_date: runtimeDate,
      execution_id: input.executionId,
      mode: input.mode,
      asin: input.asin,
      current_lifecycle_stage: input.currentLifecycleStage,
      suggested_lifecycle_stage: transitionDecision?.to ?? null,
      should_exit_launch: decision.shouldExitLaunch,
      is_emergency_exit: decision.isEmergencyExit,
      reason_codes: decision.reasonCodes,
      reason_message: decision.reasonMessage,
      seo_completion_ratio: progress.completionRatio,
      seo_success_ratio: progress.successRatio,
      total_core_keywords: progress.totalCoreKeywords,
      achieved_count: progress.achievedCount,
      gave_up_count: progress.gaveUpCount,
      active_count: progress.activeCount,
      days_since_launch: input.daysSinceLaunch,
      asin_clicks_total: input.asinClicksTotal,
      asin_orders_total: input.asinOrdersTotal,
      avg_daily_sales_30d: input.avgDailySales30d,
      loss_budget_ratio: decision.lossBudgetMetrics?.ratioStage ?? null,
      loss_investment_state: decision.lossBudgetMetrics?.investmentState ?? null,
      volume_scale: decision.volumeScale ?? null,
      threshold_min_completion_ratio: thresholds.minCoreCompletionRatio,
      threshold_min_launch_days: thresholds.minLaunchDays,
      threshold_min_clicks: thresholds.minAsinClicksTotal,
      threshold_min_orders: thresholds.minAsinOrdersTotal,
      threshold_emergency_loss_ratio: thresholds.emergencyLossRatioThreshold,
      created_at: now.toISOString(),
    };
  }
}

// =============================================================================
// ファクトリ関数
// =============================================================================

/**
 * LaunchExitDecisionLoggerを作成
 */
export function createLaunchExitDecisionLogger(
  options: LaunchExitDecisionLoggerOptions
): LaunchExitDecisionLogger {
  return new LaunchExitDecisionLogger(options);
}

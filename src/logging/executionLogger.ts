/**
 * ExecutionLogger
 *
 * 入札エンジン実行のログを記録するクラス
 * BigQueryのexecutionsテーブルとkeyword_recommendations_logテーブルに書き込む
 */

import { BigQuery } from "@google-cloud/bigquery";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import {
  ExecutionMode,
  ExecutionStatus,
  TriggerSource,
  ExecutionLogEntry,
  KeywordRecommendationLogEntry,
  ExecutionRow,
  KeywordRecommendationRow,
} from "./types";

// =============================================================================
// 型定義
// =============================================================================

/**
 * ExecutionLogger設定
 */
export interface ExecutionLoggerOptions {
  projectId: string;
  dataset: string;
  mode: ExecutionMode;
  triggerSource: TriggerSource;
  triggeredBy?: string;
}

/**
 * 実行統計
 */
export interface ExecutionStats {
  totalProductsCount: number;
  totalKeywordsCount: number;
  recommendationsCount: number;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  bidIncreasesCount: number;
  bidDecreasesCount: number;
  bidUnchangedCount: number;
}

// =============================================================================
// ExecutionLogger クラス
// =============================================================================

/**
 * 実行ログを管理するクラス
 */
export class ExecutionLogger {
  private bigquery: BigQuery;
  private options: ExecutionLoggerOptions;
  private executionId: string;
  private startedAt: Date;
  private stats: ExecutionStats;
  private recommendationBuffer: KeywordRecommendationLogEntry[];
  private readonly BUFFER_SIZE = 100;

  constructor(options: ExecutionLoggerOptions) {
    this.bigquery = new BigQuery({ projectId: options.projectId });
    this.options = options;
    this.executionId = uuidv4();
    this.startedAt = new Date();
    this.stats = {
      totalProductsCount: 0,
      totalKeywordsCount: 0,
      recommendationsCount: 0,
      appliedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      bidIncreasesCount: 0,
      bidDecreasesCount: 0,
      bidUnchangedCount: 0,
    };
    this.recommendationBuffer = [];
  }

  /**
   * 実行IDを取得
   */
  getExecutionId(): string {
    return this.executionId;
  }

  /**
   * 実行モードを取得
   */
  getMode(): ExecutionMode {
    return this.options.mode;
  }

  /**
   * 実行開始を記録
   */
  async start(): Promise<void> {
    const row: ExecutionRow = {
      execution_id: this.executionId,
      started_at: this.startedAt.toISOString(),
      finished_at: null,
      mode: this.options.mode,
      status: "RUNNING",
      total_products_count: 0,
      total_keywords_count: 0,
      recommendations_count: 0,
      applied_count: 0,
      skipped_count: 0,
      error_count: 0,
      bid_increases_count: 0,
      bid_decreases_count: 0,
      bid_unchanged_count: 0,
      error_message: null,
      error_stack: null,
      trigger_source: this.options.triggerSource,
      triggered_by: this.options.triggeredBy ?? "system",
      environment: process.env.NODE_ENV ?? "development",
      created_at: new Date().toISOString(),
    };

    try {
      await this.bigquery
        .dataset(this.options.dataset)
        .table("executions")
        .insert([row]);

      logger.info("Execution started", {
        executionId: this.executionId,
        mode: this.options.mode,
        triggerSource: this.options.triggerSource,
      });
    } catch (error) {
      logger.error("Failed to log execution start", {
        executionId: this.executionId,
        error: error instanceof Error ? error.message : String(error),
      });
      // ログ失敗は実行を止めない
    }
  }

  /**
   * 統計を更新
   */
  updateStats(partial: Partial<ExecutionStats>): void {
    this.stats = { ...this.stats, ...partial };
  }

  /**
   * 統計を加算
   */
  incrementStats(key: keyof ExecutionStats, amount: number = 1): void {
    this.stats[key] += amount;
  }

  /**
   * キーワード推奨を記録（バッファリング）
   */
  async logRecommendation(entry: Omit<KeywordRecommendationLogEntry, "executionId" | "recommendedAt">): Promise<void> {
    const fullEntry: KeywordRecommendationLogEntry = {
      ...entry,
      executionId: this.executionId,
      recommendedAt: new Date(),
    };

    this.recommendationBuffer.push(fullEntry);

    // 統計を更新
    this.stats.recommendationsCount++;
    if (entry.bidChange > 0) {
      this.stats.bidIncreasesCount++;
    } else if (entry.bidChange < 0) {
      this.stats.bidDecreasesCount++;
    } else {
      this.stats.bidUnchangedCount++;
    }

    if (entry.isApplied) {
      this.stats.appliedCount++;
    }

    // バッファがいっぱいになったらフラッシュ
    if (this.recommendationBuffer.length >= this.BUFFER_SIZE) {
      await this.flushRecommendations();
    }
  }

  /**
   * 推奨バッファをフラッシュ
   */
  async flushRecommendations(): Promise<void> {
    if (this.recommendationBuffer.length === 0) {
      return;
    }

    const rows: KeywordRecommendationRow[] = this.recommendationBuffer.map((entry) => ({
      execution_id: entry.executionId,
      asin: entry.asin,
      keyword_id: entry.keywordId ?? null,
      keyword_text: entry.keywordText,
      match_type: entry.matchType ?? null,
      campaign_id: entry.campaignId ?? null,
      ad_group_id: entry.adGroupId ?? null,
      old_bid: entry.oldBid,
      new_bid: entry.newBid,
      bid_change: entry.bidChange,
      bid_change_percent: entry.bidChangePercent,
      target_acos: entry.targetAcos ?? null,
      current_acos: entry.currentAcos ?? null,
      acos_gap: entry.acosGap ?? null,
      reason_code: entry.reasonCode,
      reason_detail: entry.reasonDetail ?? null,
      lifecycle_state: entry.lifecycleState ?? null,
      revenue_model: entry.revenueModel ?? null,
      ltv_mode: entry.ltvMode ?? null,
      business_mode: entry.businessMode ?? null,
      brand_type: entry.brandType ?? null,
      experiment_group: entry.experimentGroup ?? null,
      seo_rank_current: entry.seoRankCurrent ?? null,
      seo_rank_trend: entry.seoRankTrend ?? null,
      seo_rank_zone: entry.seoRankZone ?? null,
      impressions_7d: entry.impressions7d ?? null,
      clicks_7d: entry.clicks7d ?? null,
      conversions_7d: entry.conversions7d ?? null,
      spend_7d: entry.spend7d ?? null,
      sales_7d: entry.sales7d ?? null,
      ctr_7d: entry.ctr7d ?? null,
      cvr_7d: entry.cvr7d ?? null,
      // ガードレール情報（ログ用）
      raw_new_bid: entry.rawNewBid ?? null,
      guarded_new_bid: entry.guardedNewBid ?? null,
      was_guard_clamped: entry.wasGuardClamped ?? null,
      guard_clamp_reason: entry.guardClampReason ?? null,
      guardrails_min_bid: entry.guardrailsMinBid ?? null,
      guardrails_max_bid: entry.guardrailsMaxBid ?? null,
      guardrails_auto_data_source: entry.guardrailsAutoDataSource ?? null,
      guardrails_mode: entry.guardrailsMode ?? null,
      guardrails_applied: entry.guardrailsApplied ?? null,
      // 在庫ガード情報（ログ用）
      days_of_inventory: entry.daysOfInventory ?? null,
      inventory_risk_status: entry.inventoryRiskStatus ?? null,
      inventory_guard_applied: entry.inventoryGuardApplied ?? null,
      inventory_guard_type: entry.inventoryGuardType ?? null,
      inventory_guard_reason: entry.inventoryGuardReason ?? null,
      // 適用状態
      is_applied: entry.isApplied,
      applied_at: entry.appliedAt?.toISOString() ?? null,
      apply_error: entry.applyError ?? null,
      // APPLY フィルタリング情報
      is_apply_candidate: entry.isApplyCandidate ?? null,
      apply_skip_reason: entry.applySkipReason ?? null,
      recommended_at: entry.recommendedAt.toISOString(),
    }));

    try {
      await this.bigquery
        .dataset(this.options.dataset)
        .table("keyword_recommendations_log")
        .insert(rows);

      logger.debug("Flushed recommendation logs", {
        executionId: this.executionId,
        count: rows.length,
      });
    } catch (error) {
      logger.error("Failed to flush recommendation logs", {
        executionId: this.executionId,
        count: rows.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // バッファをクリア
    this.recommendationBuffer = [];
  }

  /**
   * 実行完了を記録（成功）
   */
  async finish(): Promise<void> {
    await this.completeExecution("SUCCESS");
  }

  /**
   * 実行完了を記録（エラー）
   */
  async finishWithError(error: Error): Promise<void> {
    await this.completeExecution("ERROR", error);
  }

  /**
   * 実行完了を記録（部分エラー）
   */
  async finishWithPartialError(error?: Error): Promise<void> {
    await this.completeExecution("PARTIAL_ERROR", error);
  }

  /**
   * 実行完了の共通処理
   */
  private async completeExecution(status: ExecutionStatus, error?: Error): Promise<void> {
    // 残りの推奨をフラッシュ
    await this.flushRecommendations();

    const finishedAt = new Date();

    // MERGE文でステータスを更新
    const query = `
      UPDATE \`${this.options.projectId}.${this.options.dataset}.executions\`
      SET
        finished_at = @finishedAt,
        status = @status,
        total_products_count = @totalProductsCount,
        total_keywords_count = @totalKeywordsCount,
        recommendations_count = @recommendationsCount,
        applied_count = @appliedCount,
        skipped_count = @skippedCount,
        error_count = @errorCount,
        bid_increases_count = @bidIncreasesCount,
        bid_decreases_count = @bidDecreasesCount,
        bid_unchanged_count = @bidUnchangedCount,
        error_message = @errorMessage,
        error_stack = @errorStack
      WHERE execution_id = @executionId
    `;

    try {
      await this.bigquery.query({
        query,
        params: {
          executionId: this.executionId,
          finishedAt: finishedAt.toISOString(),
          status,
          totalProductsCount: this.stats.totalProductsCount,
          totalKeywordsCount: this.stats.totalKeywordsCount,
          recommendationsCount: this.stats.recommendationsCount,
          appliedCount: this.stats.appliedCount,
          skippedCount: this.stats.skippedCount,
          errorCount: this.stats.errorCount,
          bidIncreasesCount: this.stats.bidIncreasesCount,
          bidDecreasesCount: this.stats.bidDecreasesCount,
          bidUnchangedCount: this.stats.bidUnchangedCount,
          errorMessage: error?.message ?? null,
          errorStack: error?.stack ?? null,
        },
        location: "asia-northeast1",
      });

      const durationMs = finishedAt.getTime() - this.startedAt.getTime();

      logger.info("Execution completed", {
        executionId: this.executionId,
        mode: this.options.mode,
        status,
        durationMs,
        stats: this.stats,
      });
    } catch (err) {
      logger.error("Failed to log execution completion", {
        executionId: this.executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 現在の統計を取得
   */
  getStats(): ExecutionStats {
    return { ...this.stats };
  }
}

// =============================================================================
// ファクトリ関数
// =============================================================================

/**
 * ExecutionLoggerを作成
 */
export function createExecutionLogger(options: ExecutionLoggerOptions): ExecutionLogger {
  return new ExecutionLogger(options);
}

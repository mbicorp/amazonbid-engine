/**
 * 監視・アラート - メトリクス収集
 *
 * BigQuery から実行の監視指標を取得する
 */

import { BigQuery } from "@google-cloud/bigquery";
import { ExecutionHealthMetrics, DEFAULT_ALERT_THRESHOLDS } from "./types";
import { logger } from "../logger";

// =============================================================================
// 型定義
// =============================================================================

/**
 * メトリクス収集オプション
 */
export interface MetricsCollectorOptions {
  /** BigQuery プロジェクトID */
  projectId?: string;
  /** BigQuery データセット */
  dataset?: string;
  /** 強いUP判定の閾値（%） */
  strongUpThresholdPercent?: number;
  /** 強いDOWN判定の閾値（%） */
  strongDownThresholdPercent?: number;
}

// =============================================================================
// メトリクス収集
// =============================================================================

/**
 * 実行IDに対応する監視指標を収集する
 *
 * @param executionId - 実行ID
 * @param options - オプション
 * @returns 監視指標（実行が見つからない場合は null）
 */
export async function collectExecutionHealthMetrics(
  executionId: string,
  options: MetricsCollectorOptions = {}
): Promise<ExecutionHealthMetrics | null> {
  const projectId = options.projectId ?? process.env.GCP_PROJECT_ID ?? "";
  const dataset = options.dataset ?? process.env.BQ_DATASET ?? "amazon_bid_engine";
  const strongUpThreshold = options.strongUpThresholdPercent ?? DEFAULT_ALERT_THRESHOLDS.strongUpThresholdPercent;
  const strongDownThreshold = options.strongDownThresholdPercent ?? DEFAULT_ALERT_THRESHOLDS.strongDownThresholdPercent;

  if (!projectId) {
    logger.warn("metricsCollector: GCP_PROJECT_ID not set");
    return null;
  }

  const bigquery = new BigQuery({ projectId });

  const query = `
    WITH recommendation_stats AS (
      SELECT
        execution_id,
        MIN(recommended_at) AS execution_time,

        -- ガードレールモード（最頻値）
        APPROX_TOP_COUNT(guardrails_mode, 1)[SAFE_OFFSET(0)].value AS guardrails_mode,

        -- 基本カウント
        COUNT(*) AS total_keywords,
        COUNTIF(bid_change != 0) AS total_recommendations,
        COUNTIF(is_applied = TRUE) AS total_applied,
        COUNTIF(apply_error IS NOT NULL) AS total_apply_failed,

        -- 変更方向カウント
        COUNTIF(bid_change_percent > @strongUpThreshold) AS strong_up_count,
        COUNTIF(bid_change_percent < @strongDownThreshold) AS strong_down_count,
        COUNTIF(bid_change > 0) AS up_count,
        COUNTIF(bid_change < 0) AS down_count,
        COUNTIF(bid_change = 0) AS keep_count,

        -- ガードレール関連
        COUNTIF(was_guard_clamped = TRUE) AS guardrails_clipped_count,

        -- 入札変更統計
        AVG(CASE WHEN old_bid > 0 THEN new_bid / old_bid ELSE NULL END) AS avg_bid_change_ratio,
        MAX(CASE WHEN old_bid > 0 THEN new_bid / old_bid ELSE NULL END) AS max_bid_change_ratio,
        MIN(CASE WHEN old_bid > 0 THEN new_bid / old_bid ELSE NULL END) AS min_bid_change_ratio

      FROM \`${projectId}.${dataset}.keyword_recommendations_log\`
      WHERE execution_id = @executionId
      GROUP BY execution_id
    )

    SELECT
      rs.*,
      e.mode,
      e.started_at,
      e.finished_at,
      DATETIME_DIFF(e.finished_at, e.started_at, SECOND) AS execution_duration_sec
    FROM recommendation_stats rs
    LEFT JOIN \`${projectId}.${dataset}.executions\` e
      ON rs.execution_id = e.execution_id
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: {
        executionId,
        strongUpThreshold,
        strongDownThreshold,
      },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      logger.warn("No recommendation data found for execution", { executionId });
      return null;
    }

    const row = rows[0];

    const totalKeywords = Number(row.total_keywords) || 0;
    const totalApplied = Number(row.total_applied) || 0;
    const upCount = Number(row.up_count) || 0;
    const downCount = Number(row.down_count) || 0;
    const guardrailsClippedCount = Number(row.guardrails_clipped_count) || 0;
    const totalApplyFailed = Number(row.total_apply_failed) || 0;

    const metrics: ExecutionHealthMetrics = {
      executionId: row.execution_id,
      executionTime: row.execution_time ? new Date(row.execution_time.value ?? row.execution_time) : new Date(),
      mode: row.mode ?? "UNKNOWN",
      guardrailsMode: row.guardrails_mode ?? null,

      totalKeywords,
      totalRecommendations: Number(row.total_recommendations) || 0,
      totalApplied,
      totalApplyFailed,

      strongUpCount: Number(row.strong_up_count) || 0,
      strongDownCount: Number(row.strong_down_count) || 0,
      upCount,
      downCount,
      keepCount: Number(row.keep_count) || 0,

      upRatio: totalKeywords > 0 ? upCount / totalKeywords : 0,
      downRatio: totalKeywords > 0 ? downCount / totalKeywords : 0,
      guardrailsClippedRatio: totalKeywords > 0 ? guardrailsClippedCount / totalKeywords : 0,
      applyFailedRatio: totalApplied > 0 ? totalApplyFailed / totalApplied : 0,

      avgBidChangeRatio: Number(row.avg_bid_change_ratio) || 1.0,
      maxBidChangeRatio: Number(row.max_bid_change_ratio) || 1.0,
      minBidChangeRatio: Number(row.min_bid_change_ratio) || 1.0,

      executionDurationSec: row.execution_duration_sec != null ? Number(row.execution_duration_sec) : null,
    };

    logger.debug("Collected execution health metrics", {
      executionId,
      totalKeywords: metrics.totalKeywords,
      upRatio: metrics.upRatio.toFixed(3),
      downRatio: metrics.downRatio.toFixed(3),
    });

    return metrics;
  } catch (error) {
    logger.error("Failed to collect execution health metrics", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

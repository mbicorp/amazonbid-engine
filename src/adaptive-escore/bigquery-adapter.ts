/**
 * 自適応型Eスコア最適化システム - BigQueryアダプター
 */

import { BigQuery } from "@google-cloud/bigquery";
import {
  FeedbackRecord,
  WeightHistory,
  EScoreWeights,
  OperationMode,
  BrandCategory,
  Season,
  OptimizationResult,
} from "./types";
import { ADAPTIVE_BIGQUERY_TABLES } from "./config";
import { BIGQUERY } from "../constants";
import { logger } from "../logger";

// BigQueryクライアントの初期化
const bigquery = new BigQuery({
  projectId: process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID,
});

const datasetId = process.env.BIGQUERY_DATASET_ID || BIGQUERY.DATASET_ID;
const projectId = process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID;

// =============================================================================
// フィードバックレコード操作
// =============================================================================

/**
 * フィードバックレコードを挿入
 */
export async function insertFeedbackRecord(record: FeedbackRecord): Promise<void> {
  const table = bigquery.dataset(datasetId).table(ADAPTIVE_BIGQUERY_TABLES.FEEDBACK);

  try {
    await table.insert([{
      feedback_id: record.feedback_id,
      execution_id: record.execution_id,
      keyword_id: record.keyword_id,
      campaign_id: record.campaign_id,
      ad_group_id: record.ad_group_id,
      recommendation_timestamp: record.recommendation_timestamp.toISOString(),
      evaluation_timestamp: record.evaluation_timestamp?.toISOString() || null,
      mode: record.mode,
      brand_type: record.brand_type,
      season: record.season,
      e_score: record.e_score,
      predicted_rank: record.predicted_rank,
      performance_score: record.performance_score,
      efficiency_score: record.efficiency_score,
      potential_score: record.potential_score,
      weight_performance: record.weight_performance,
      weight_efficiency: record.weight_efficiency,
      weight_potential: record.weight_potential,
      action_taken: record.action_taken,
      change_rate: record.change_rate,
      cvr_before: record.cvr_before,
      ctr_before: record.ctr_before,
      acos_before: record.acos_before,
      sales_before: record.sales_before,
      clicks_before: record.clicks_before,
      bid_before: record.bid_before,
      cvr_after: record.cvr_after,
      ctr_after: record.ctr_after,
      acos_after: record.acos_after,
      sales_after: record.sales_after,
      clicks_after: record.clicks_after,
      bid_after: record.bid_after,
      success_level: record.success_level,
      success_score: record.success_score,
      evaluated: record.evaluated,
    }]);

    logger.debug("Inserted feedback record", { feedbackId: record.feedback_id });
  } catch (error) {
    logger.error("Failed to insert feedback record", {
      error: error instanceof Error ? error.message : String(error),
      feedbackId: record.feedback_id,
    });
    throw error;
  }
}

/**
 * フィードバックレコードを一括挿入
 */
export async function insertFeedbackRecords(records: FeedbackRecord[]): Promise<void> {
  if (records.length === 0) return;

  const table = bigquery.dataset(datasetId).table(ADAPTIVE_BIGQUERY_TABLES.FEEDBACK);
  const BATCH_SIZE = 500;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map((record) => ({
      feedback_id: record.feedback_id,
      execution_id: record.execution_id,
      keyword_id: record.keyword_id,
      campaign_id: record.campaign_id,
      ad_group_id: record.ad_group_id,
      recommendation_timestamp: record.recommendation_timestamp.toISOString(),
      evaluation_timestamp: record.evaluation_timestamp?.toISOString() || null,
      mode: record.mode,
      brand_type: record.brand_type,
      season: record.season,
      e_score: record.e_score,
      predicted_rank: record.predicted_rank,
      performance_score: record.performance_score,
      efficiency_score: record.efficiency_score,
      potential_score: record.potential_score,
      weight_performance: record.weight_performance,
      weight_efficiency: record.weight_efficiency,
      weight_potential: record.weight_potential,
      action_taken: record.action_taken,
      change_rate: record.change_rate,
      cvr_before: record.cvr_before,
      ctr_before: record.ctr_before,
      acos_before: record.acos_before,
      sales_before: record.sales_before,
      clicks_before: record.clicks_before,
      bid_before: record.bid_before,
      cvr_after: record.cvr_after,
      ctr_after: record.ctr_after,
      acos_after: record.acos_after,
      sales_after: record.sales_after,
      clicks_after: record.clicks_after,
      bid_after: record.bid_after,
      success_level: record.success_level,
      success_score: record.success_score,
      evaluated: record.evaluated,
    }));

    try {
      await table.insert(batch);
      logger.debug(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}`, { count: batch.length });
    } catch (error) {
      logger.error("Failed to insert feedback batch", {
        error: error instanceof Error ? error.message : String(error),
        batchIndex: Math.floor(i / BATCH_SIZE),
      });
      throw error;
    }
  }

  logger.info("Inserted feedback records", { count: records.length });
}

/**
 * 未評価のフィードバックレコードを取得
 */
export async function getUnevaluatedFeedbackRecords(
  olderThanHours: number = 3
): Promise<FeedbackRecord[]> {
  const query = `
    SELECT *
    FROM \`${projectId}.${datasetId}.${ADAPTIVE_BIGQUERY_TABLES.FEEDBACK}\`
    WHERE evaluated = false
      AND recommendation_timestamp < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
    ORDER BY recommendation_timestamp ASC
    LIMIT 1000
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { hours: olderThanHours },
    });

    return rows.map(mapRowToFeedbackRecord);
  } catch (error) {
    logger.error("Failed to get unevaluated feedback records", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 学習用のフィードバックレコードを取得
 */
export async function getFeedbackRecordsForLearning(
  mode: OperationMode,
  days: number = 7
): Promise<FeedbackRecord[]> {
  const query = `
    SELECT *
    FROM \`${projectId}.${datasetId}.${ADAPTIVE_BIGQUERY_TABLES.FEEDBACK}\`
    WHERE evaluated = true
      AND mode = @mode
      AND recommendation_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    ORDER BY recommendation_timestamp DESC
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { mode, days },
    });

    return rows.map(mapRowToFeedbackRecord);
  } catch (error) {
    logger.error("Failed to get feedback records for learning", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * フィードバックレコードを更新（評価結果）
 */
export async function updateFeedbackRecordEvaluation(
  feedbackId: string,
  evaluation: {
    cvr_after: number;
    ctr_after: number;
    acos_after: number;
    sales_after: number;
    clicks_after: number;
    bid_after: number;
    success_level: string;
    success_score: number;
  }
): Promise<void> {
  const query = `
    UPDATE \`${projectId}.${datasetId}.${ADAPTIVE_BIGQUERY_TABLES.FEEDBACK}\`
    SET
      cvr_after = @cvr_after,
      ctr_after = @ctr_after,
      acos_after = @acos_after,
      sales_after = @sales_after,
      clicks_after = @clicks_after,
      bid_after = @bid_after,
      success_level = @success_level,
      success_score = @success_score,
      evaluated = true,
      evaluation_timestamp = CURRENT_TIMESTAMP()
    WHERE feedback_id = @feedback_id
  `;

  try {
    await bigquery.query({
      query,
      params: {
        feedback_id: feedbackId,
        ...evaluation,
      },
    });

    logger.debug("Updated feedback record evaluation", { feedbackId });
  } catch (error) {
    logger.error("Failed to update feedback record evaluation", {
      error: error instanceof Error ? error.message : String(error),
      feedbackId,
    });
    throw error;
  }
}

// =============================================================================
// 重み履歴操作
// =============================================================================

/**
 * 重み履歴を保存
 */
export async function saveWeightHistory(history: WeightHistory): Promise<void> {
  const table = bigquery.dataset(datasetId).table(ADAPTIVE_BIGQUERY_TABLES.WEIGHT_HISTORY);

  try {
    await table.insert([{
      history_id: history.history_id,
      target_type: history.target_type,
      target_value: history.target_value,
      weight_performance: history.weights.performance,
      weight_efficiency: history.weights.efficiency,
      weight_potential: history.weights.potential,
      accuracy: history.accuracy,
      data_count: history.data_count,
      saved_at: history.saved_at.toISOString(),
      rolled_back: history.rolled_back,
    }]);

    logger.debug("Saved weight history", { historyId: history.history_id });
  } catch (error) {
    logger.error("Failed to save weight history", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 最新の重み履歴を取得
 */
export async function getLatestWeightHistory(
  targetType: "mode" | "brand_type" | "season",
  targetValue: string
): Promise<WeightHistory | null> {
  const query = `
    SELECT *
    FROM \`${projectId}.${datasetId}.${ADAPTIVE_BIGQUERY_TABLES.WEIGHT_HISTORY}\`
    WHERE target_type = @target_type
      AND target_value = @target_value
      AND rolled_back = false
    ORDER BY saved_at DESC
    LIMIT 1
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { target_type: targetType, target_value: targetValue },
    });

    if (rows.length === 0) return null;

    return mapRowToWeightHistory(rows[0]);
  } catch (error) {
    logger.error("Failed to get latest weight history", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 重み履歴をロールバック済みとしてマーク
 */
export async function markWeightHistoryAsRolledBack(historyId: string): Promise<void> {
  const query = `
    UPDATE \`${projectId}.${datasetId}.${ADAPTIVE_BIGQUERY_TABLES.WEIGHT_HISTORY}\`
    SET rolled_back = true
    WHERE history_id = @history_id
  `;

  try {
    await bigquery.query({
      query,
      params: { history_id: historyId },
    });

    logger.debug("Marked weight history as rolled back", { historyId });
  } catch (error) {
    logger.error("Failed to mark weight history as rolled back", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// 最適化ログ
// =============================================================================

/**
 * 最適化ログを保存
 */
export async function saveOptimizationLog(
  targetType: "mode" | "brand_type" | "season",
  targetValue: string,
  result: OptimizationResult,
  anomalyDetected: boolean,
  rolledBack: boolean
): Promise<void> {
  const table = bigquery.dataset(datasetId).table(ADAPTIVE_BIGQUERY_TABLES.OPTIMIZATION_LOG);

  try {
    await table.insert([{
      log_id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      target_type: targetType,
      target_value: targetValue,
      previous_weight_performance: result.previousWeights.performance,
      previous_weight_efficiency: result.previousWeights.efficiency,
      previous_weight_potential: result.previousWeights.potential,
      new_weight_performance: result.newWeights.performance,
      new_weight_efficiency: result.newWeights.efficiency,
      new_weight_potential: result.newWeights.potential,
      delta_performance: result.delta.performance,
      delta_efficiency: result.delta.efficiency,
      delta_potential: result.delta.potential,
      data_count: result.dataCount,
      previous_accuracy: result.previousAccuracy,
      estimated_accuracy: result.estimatedAccuracy,
      anomaly_detected: anomalyDetected,
      rolled_back: rolledBack,
      optimized_at: result.optimizedAt.toISOString(),
    }]);

    logger.debug("Saved optimization log", { targetType, targetValue });
  } catch (error) {
    logger.error("Failed to save optimization log", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// 統計クエリ
// =============================================================================

/**
 * モード別の成功率統計を取得
 */
export async function getSuccessStatsByMode(days: number = 7): Promise<{
  mode: OperationMode;
  count: number;
  avgSuccessScore: number;
  avgEScore: number;
}[]> {
  const query = `
    SELECT
      mode,
      COUNT(*) as count,
      AVG(success_score) as avg_success_score,
      AVG(e_score) as avg_e_score
    FROM \`${projectId}.${datasetId}.${ADAPTIVE_BIGQUERY_TABLES.FEEDBACK}\`
    WHERE evaluated = true
      AND recommendation_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    GROUP BY mode
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { days },
    });

    return rows.map((row: any) => ({
      mode: row.mode as OperationMode,
      count: row.count,
      avgSuccessScore: row.avg_success_score,
      avgEScore: row.avg_e_score,
    }));
  } catch (error) {
    logger.error("Failed to get success stats by mode", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * アクション別の成功率統計を取得
 */
export async function getSuccessStatsByAction(days: number = 7): Promise<{
  action: string;
  count: number;
  avgSuccessScore: number;
}[]> {
  const query = `
    SELECT
      action_taken as action,
      COUNT(*) as count,
      AVG(success_score) as avg_success_score
    FROM \`${projectId}.${datasetId}.${ADAPTIVE_BIGQUERY_TABLES.FEEDBACK}\`
    WHERE evaluated = true
      AND recommendation_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    GROUP BY action_taken
    ORDER BY count DESC
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { days },
    });

    return rows.map((row: any) => ({
      action: row.action,
      count: row.count,
      avgSuccessScore: row.avg_success_score,
    }));
  } catch (error) {
    logger.error("Failed to get success stats by action", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// ヘルパー関数
// =============================================================================

function mapRowToFeedbackRecord(row: any): FeedbackRecord {
  return {
    feedback_id: row.feedback_id,
    execution_id: row.execution_id,
    keyword_id: row.keyword_id,
    campaign_id: row.campaign_id,
    ad_group_id: row.ad_group_id,
    recommendation_timestamp: new Date(row.recommendation_timestamp.value || row.recommendation_timestamp),
    evaluation_timestamp: row.evaluation_timestamp
      ? new Date(row.evaluation_timestamp.value || row.evaluation_timestamp)
      : new Date(),
    mode: row.mode as OperationMode,
    brand_type: row.brand_type as BrandCategory,
    season: row.season as Season,
    e_score: row.e_score,
    predicted_rank: row.predicted_rank,
    performance_score: row.performance_score,
    efficiency_score: row.efficiency_score,
    potential_score: row.potential_score,
    weight_performance: row.weight_performance,
    weight_efficiency: row.weight_efficiency,
    weight_potential: row.weight_potential,
    action_taken: row.action_taken,
    change_rate: row.change_rate,
    cvr_before: row.cvr_before,
    ctr_before: row.ctr_before,
    acos_before: row.acos_before,
    sales_before: row.sales_before,
    clicks_before: row.clicks_before,
    bid_before: row.bid_before,
    cvr_after: row.cvr_after,
    ctr_after: row.ctr_after,
    acos_after: row.acos_after,
    sales_after: row.sales_after,
    clicks_after: row.clicks_after,
    bid_after: row.bid_after,
    success_level: row.success_level,
    success_score: row.success_score,
    evaluated: row.evaluated,
  };
}

function mapRowToWeightHistory(row: any): WeightHistory {
  return {
    history_id: row.history_id,
    target_type: row.target_type,
    target_value: row.target_value,
    weights: {
      performance: row.weight_performance,
      efficiency: row.weight_efficiency,
      potential: row.weight_potential,
    },
    accuracy: row.accuracy,
    data_count: row.data_count,
    saved_at: new Date(row.saved_at.value || row.saved_at),
    rolled_back: row.rolled_back,
  };
}

/**
 * Dayparting (時間帯別入札最適化) - BigQueryアダプター
 *
 * BigQueryへのデータ保存・取得機能を提供
 */

import { BigQuery } from "@google-cloud/bigquery";
import * as crypto from "crypto";
import { logger } from "../logger";
import {
  DaypartingConfig,
  HourlyBidMultiplier,
  DaypartingFeedbackRecord,
  DaypartingDailySummary,
  RollbackInfo,
  HourOfDay,
  DayOfWeek,
  ConfidenceLevel,
  HourClassification,
  DaypartingMode,
  DaypartingConfigRecord,
  DaypartingMultiplierRecord,
  DaypartingFeedbackRecordBQ,
  DaypartingRollbackRecord,
} from "./types";
import { DAYPARTING_BIGQUERY_TABLES } from "./config";

// =============================================================================
// 型定義
// =============================================================================

/**
 * BigQuery設定
 */
export interface BigQueryConfig {
  projectId: string;
  dataset: string;
}

// =============================================================================
// データ変換
// =============================================================================

/**
 * ConfigをBigQueryレコードに変換
 */
export function configToRecord(config: DaypartingConfig): DaypartingConfigRecord {
  return {
    config_id: `config_${crypto.randomUUID()}`,
    asin: config.asin,
    campaign_id: config.campaignId,
    ad_group_id: config.adGroupId,
    mode: config.mode,
    enabled: config.enabled,
    max_multiplier: config.maxMultiplier,
    min_multiplier: config.minMultiplier,
    significance_level: config.significanceLevel,
    min_sample_size: config.minSampleSize,
    analysis_window_days: config.analysisWindowDays,
    max_daily_loss: config.maxDailyLoss,
    rollback_threshold: config.rollbackThreshold,
    created_at: config.createdAt.toISOString(),
    updated_at: config.updatedAt.toISOString(),
  };
}

/**
 * BigQueryレコードをConfigに変換
 */
export function recordToConfig(record: DaypartingConfigRecord): DaypartingConfig {
  return {
    asin: record.asin,
    campaignId: record.campaign_id,
    adGroupId: record.ad_group_id,
    mode: record.mode as DaypartingMode,
    enabled: record.enabled,
    maxMultiplier: record.max_multiplier,
    minMultiplier: record.min_multiplier,
    significanceLevel: record.significance_level,
    minSampleSize: record.min_sample_size,
    analysisWindowDays: record.analysis_window_days,
    maxDailyLoss: record.max_daily_loss,
    rollbackThreshold: record.rollback_threshold,
    createdAt: new Date(record.created_at),
    updatedAt: new Date(record.updated_at),
  };
}

/**
 * MultiplierをBigQueryレコードに変換
 */
export function multiplierToRecord(multiplier: HourlyBidMultiplier): DaypartingMultiplierRecord {
  return {
    multiplier_id: `mult_${crypto.randomUUID()}`,
    asin: multiplier.asin,
    campaign_id: multiplier.campaignId,
    ad_group_id: multiplier.adGroupId,
    hour: multiplier.hour,
    day_of_week: multiplier.dayOfWeek,
    multiplier: multiplier.multiplier,
    confidence: multiplier.confidence,
    classification: multiplier.classification,
    effective_from: multiplier.effectiveFrom.toISOString(),
    effective_to: multiplier.effectiveTo?.toISOString() ?? null,
    is_active: multiplier.isActive,
    created_at: multiplier.createdAt.toISOString(),
    updated_at: multiplier.updatedAt.toISOString(),
  };
}

/**
 * BigQueryレコードをMultiplierに変換
 */
export function recordToMultiplier(record: DaypartingMultiplierRecord): HourlyBidMultiplier {
  return {
    asin: record.asin,
    campaignId: record.campaign_id,
    adGroupId: record.ad_group_id,
    hour: record.hour as HourOfDay,
    dayOfWeek: record.day_of_week as DayOfWeek | null,
    multiplier: record.multiplier,
    confidence: record.confidence as ConfidenceLevel,
    classification: record.classification as HourClassification,
    effectiveFrom: new Date(record.effective_from),
    effectiveTo: record.effective_to ? new Date(record.effective_to) : null,
    isActive: record.is_active,
    createdAt: new Date(record.created_at),
    updatedAt: new Date(record.updated_at),
  };
}

/**
 * FeedbackをBigQueryレコードに変換
 */
export function feedbackToRecord(feedback: DaypartingFeedbackRecord): DaypartingFeedbackRecordBQ {
  return {
    feedback_id: feedback.feedbackId,
    asin: feedback.asin,
    campaign_id: feedback.campaignId,
    ad_group_id: feedback.adGroupId,
    hour: feedback.hour,
    day_of_week: feedback.dayOfWeek,
    applied_multiplier: feedback.appliedMultiplier,
    applied_at: feedback.appliedAt.toISOString(),
    evaluated_at: feedback.evaluatedAt?.toISOString() ?? null,
    cvr_before: feedback.cvrBefore,
    roas_before: feedback.roasBefore,
    clicks_before: feedback.clicksBefore,
    conversions_before: feedback.conversionsBefore,
    cvr_after: feedback.cvrAfter,
    roas_after: feedback.roasAfter,
    clicks_after: feedback.clicksAfter,
    conversions_after: feedback.conversionsAfter,
    is_success: feedback.isSuccess,
    success_score: feedback.successScore,
    evaluated: feedback.evaluated,
  };
}

/**
 * BigQueryレコードをFeedbackに変換
 */
export function recordToFeedback(record: DaypartingFeedbackRecordBQ): DaypartingFeedbackRecord {
  return {
    feedbackId: record.feedback_id,
    asin: record.asin,
    campaignId: record.campaign_id,
    adGroupId: record.ad_group_id,
    hour: record.hour as HourOfDay,
    dayOfWeek: record.day_of_week as DayOfWeek | null,
    appliedMultiplier: record.applied_multiplier,
    appliedAt: new Date(record.applied_at),
    evaluatedAt: record.evaluated_at ? new Date(record.evaluated_at) : null,
    cvrBefore: record.cvr_before,
    roasBefore: record.roas_before,
    clicksBefore: record.clicks_before,
    conversionsBefore: record.conversions_before,
    cvrAfter: record.cvr_after,
    roasAfter: record.roas_after,
    clicksAfter: record.clicks_after,
    conversionsAfter: record.conversions_after,
    isSuccess: record.is_success,
    successScore: record.success_score,
    evaluated: record.evaluated,
  };
}

// =============================================================================
// 設定の保存・取得
// =============================================================================

/**
 * 設定を保存
 */
export async function saveConfig(
  bqConfig: BigQueryConfig,
  config: DaypartingConfig
): Promise<void> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });
  const record = configToRecord(config);

  const query = `
    MERGE \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.CONFIGS}\` AS target
    USING (SELECT @asin AS asin, @campaign_id AS campaign_id, @ad_group_id AS ad_group_id) AS source
    ON target.asin = source.asin
       AND target.campaign_id = source.campaign_id
       AND IFNULL(target.ad_group_id, '') = IFNULL(source.ad_group_id, '')
    WHEN MATCHED THEN
      UPDATE SET
        mode = @mode,
        enabled = @enabled,
        max_multiplier = @max_multiplier,
        min_multiplier = @min_multiplier,
        significance_level = @significance_level,
        min_sample_size = @min_sample_size,
        analysis_window_days = @analysis_window_days,
        max_daily_loss = @max_daily_loss,
        rollback_threshold = @rollback_threshold,
        updated_at = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN
      INSERT (config_id, asin, campaign_id, ad_group_id, mode, enabled,
              max_multiplier, min_multiplier, significance_level, min_sample_size,
              analysis_window_days, max_daily_loss, rollback_threshold, created_at, updated_at)
      VALUES (@config_id, @asin, @campaign_id, @ad_group_id, @mode, @enabled,
              @max_multiplier, @min_multiplier, @significance_level, @min_sample_size,
              @analysis_window_days, @max_daily_loss, @rollback_threshold, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
  `;

  try {
    await bigquery.query({
      query,
      params: {
        config_id: record.config_id,
        asin: record.asin,
        campaign_id: record.campaign_id,
        ad_group_id: record.ad_group_id ?? "",
        mode: record.mode,
        enabled: record.enabled,
        max_multiplier: record.max_multiplier,
        min_multiplier: record.min_multiplier,
        significance_level: record.significance_level,
        min_sample_size: record.min_sample_size,
        analysis_window_days: record.analysis_window_days,
        max_daily_loss: record.max_daily_loss,
        rollback_threshold: record.rollback_threshold,
      },
      location: "asia-northeast1",
    });

    logger.info("Saved dayparting config", {
      asin: config.asin,
      campaignId: config.campaignId,
    });
  } catch (error) {
    logger.error("Failed to save dayparting config", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 設定を取得
 */
export async function fetchConfig(
  bqConfig: BigQueryConfig,
  asin: string,
  campaignId: string,
  adGroupId: string | null = null
): Promise<DaypartingConfig | null> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const query = `
    SELECT *
    FROM \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.CONFIGS}\`
    WHERE asin = @asin
      AND campaign_id = @campaign_id
      AND IFNULL(ad_group_id, '') = @ad_group_id
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: {
        asin,
        campaign_id: campaignId,
        ad_group_id: adGroupId ?? "",
      },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      return null;
    }

    return recordToConfig(rows[0] as DaypartingConfigRecord);
  } catch (error) {
    logger.error("Failed to fetch dayparting config", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 有効な設定を全て取得
 */
export async function fetchEnabledConfigs(
  bqConfig: BigQueryConfig
): Promise<DaypartingConfig[]> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const query = `
    SELECT *
    FROM \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.CONFIGS}\`
    WHERE enabled = TRUE
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      location: "asia-northeast1",
    });

    return rows.map((row) => recordToConfig(row as DaypartingConfigRecord));
  } catch (error) {
    logger.error("Failed to fetch enabled configs", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// 乗数の保存・取得
// =============================================================================

/**
 * 乗数を保存
 */
export async function saveMultipliers(
  bqConfig: BigQueryConfig,
  multipliers: HourlyBidMultiplier[]
): Promise<void> {
  if (multipliers.length === 0) return;

  const bigquery = new BigQuery({ projectId: bqConfig.projectId });
  const records = multipliers.map(multiplierToRecord);

  try {
    await bigquery
      .dataset(bqConfig.dataset)
      .table(DAYPARTING_BIGQUERY_TABLES.MULTIPLIERS)
      .insert(records);

    logger.info("Saved dayparting multipliers", {
      count: records.length,
    });
  } catch (error) {
    logger.error("Failed to save multipliers", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * アクティブな乗数を取得
 */
export async function fetchActiveMultipliers(
  bqConfig: BigQueryConfig,
  asin: string,
  campaignId: string
): Promise<HourlyBidMultiplier[]> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const query = `
    SELECT *
    FROM \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.MULTIPLIERS}\`
    WHERE asin = @asin
      AND campaign_id = @campaign_id
      AND is_active = TRUE
    ORDER BY hour, day_of_week
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asin, campaign_id: campaignId },
      location: "asia-northeast1",
    });

    return rows.map((row) => recordToMultiplier(row as DaypartingMultiplierRecord));
  } catch (error) {
    logger.error("Failed to fetch active multipliers", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 乗数を無効化
 */
export async function deactivateMultipliers(
  bqConfig: BigQueryConfig,
  asin: string,
  campaignId: string
): Promise<void> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const query = `
    UPDATE \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.MULTIPLIERS}\`
    SET is_active = FALSE, effective_to = CURRENT_TIMESTAMP(), updated_at = CURRENT_TIMESTAMP()
    WHERE asin = @asin
      AND campaign_id = @campaign_id
      AND is_active = TRUE
  `;

  try {
    await bigquery.query({
      query,
      params: { asin, campaign_id: campaignId },
      location: "asia-northeast1",
    });

    logger.info("Deactivated multipliers", { asin, campaignId });
  } catch (error) {
    logger.error("Failed to deactivate multipliers", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// フィードバックの保存・取得
// =============================================================================

/**
 * フィードバックを保存
 */
export async function saveFeedback(
  bqConfig: BigQueryConfig,
  feedback: DaypartingFeedbackRecord
): Promise<void> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });
  const record = feedbackToRecord(feedback);

  try {
    await bigquery
      .dataset(bqConfig.dataset)
      .table(DAYPARTING_BIGQUERY_TABLES.FEEDBACK)
      .insert([record]);

    logger.info("Saved dayparting feedback", {
      feedbackId: feedback.feedbackId,
    });
  } catch (error) {
    logger.error("Failed to save feedback", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * フィードバックを更新（評価結果）
 */
export async function updateFeedbackEvaluation(
  bqConfig: BigQueryConfig,
  feedbackId: string,
  evaluation: {
    cvrAfter: number;
    roasAfter: number;
    clicksAfter: number;
    conversionsAfter: number;
    isSuccess: boolean;
    successScore: number;
  }
): Promise<void> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const query = `
    UPDATE \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.FEEDBACK}\`
    SET
      cvr_after = @cvr_after,
      roas_after = @roas_after,
      clicks_after = @clicks_after,
      conversions_after = @conversions_after,
      is_success = @is_success,
      success_score = @success_score,
      evaluated = TRUE,
      evaluated_at = CURRENT_TIMESTAMP()
    WHERE feedback_id = @feedback_id
  `;

  try {
    await bigquery.query({
      query,
      params: {
        feedback_id: feedbackId,
        cvr_after: evaluation.cvrAfter,
        roas_after: evaluation.roasAfter,
        clicks_after: evaluation.clicksAfter,
        conversions_after: evaluation.conversionsAfter,
        is_success: evaluation.isSuccess,
        success_score: evaluation.successScore,
      },
      location: "asia-northeast1",
    });

    logger.info("Updated feedback evaluation", { feedbackId });
  } catch (error) {
    logger.error("Failed to update feedback evaluation", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 未評価のフィードバックを取得
 */
export async function fetchUnevaluatedFeedback(
  bqConfig: BigQueryConfig,
  minAgeHours: number = 3
): Promise<DaypartingFeedbackRecord[]> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const query = `
    SELECT *
    FROM \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.FEEDBACK}\`
    WHERE evaluated = FALSE
      AND applied_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @min_age_hours HOUR)
    ORDER BY applied_at
    LIMIT 1000
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { min_age_hours: minAgeHours },
      location: "asia-northeast1",
    });

    return rows.map((row) => recordToFeedback(row as DaypartingFeedbackRecordBQ));
  } catch (error) {
    logger.error("Failed to fetch unevaluated feedback", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 直近のフィードバックを取得
 */
export async function fetchRecentFeedback(
  bqConfig: BigQueryConfig,
  asin: string,
  campaignId: string,
  days: number = 7
): Promise<DaypartingFeedbackRecord[]> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const query = `
    SELECT *
    FROM \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.FEEDBACK}\`
    WHERE asin = @asin
      AND campaign_id = @campaign_id
      AND applied_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    ORDER BY applied_at DESC
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asin, campaign_id: campaignId, days },
      location: "asia-northeast1",
    });

    return rows.map((row) => recordToFeedback(row as DaypartingFeedbackRecordBQ));
  } catch (error) {
    logger.error("Failed to fetch recent feedback", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// ロールバックの保存・取得
// =============================================================================

/**
 * ロールバック情報を保存
 */
export async function saveRollback(
  bqConfig: BigQueryConfig,
  rollbackInfo: RollbackInfo
): Promise<void> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const record: DaypartingRollbackRecord = {
    rollback_id: rollbackInfo.rollbackId,
    asin: rollbackInfo.asin,
    campaign_id: rollbackInfo.campaignId,
    reason: rollbackInfo.reason,
    previous_multipliers_json: JSON.stringify(rollbackInfo.previousMultipliers),
    rolled_back_at: rollbackInfo.rolledBackAt.toISOString(),
    restored_at: rollbackInfo.restoredAt?.toISOString() ?? null,
  };

  try {
    await bigquery
      .dataset(bqConfig.dataset)
      .table(DAYPARTING_BIGQUERY_TABLES.ROLLBACKS)
      .insert([record]);

    logger.info("Saved rollback info", {
      rollbackId: rollbackInfo.rollbackId,
    });
  } catch (error) {
    logger.error("Failed to save rollback info", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 最新のロールバックを取得
 */
export async function fetchLatestRollback(
  bqConfig: BigQueryConfig,
  asin: string,
  campaignId: string
): Promise<RollbackInfo | null> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const query = `
    SELECT *
    FROM \`${bqConfig.projectId}.${bqConfig.dataset}.${DAYPARTING_BIGQUERY_TABLES.ROLLBACKS}\`
    WHERE asin = @asin AND campaign_id = @campaign_id
    ORDER BY rolled_back_at DESC
    LIMIT 1
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asin, campaign_id: campaignId },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      return null;
    }

    const record = rows[0] as DaypartingRollbackRecord;
    return {
      rollbackId: record.rollback_id,
      asin: record.asin,
      campaignId: record.campaign_id,
      reason: record.reason,
      previousMultipliers: JSON.parse(record.previous_multipliers_json),
      rolledBackAt: new Date(record.rolled_back_at),
      restoredAt: record.restored_at ? new Date(record.restored_at) : null,
    };
  } catch (error) {
    logger.error("Failed to fetch latest rollback", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// テーブル作成
// =============================================================================

/**
 * Daypartingテーブルを作成
 */
export async function createDaypartingTables(bqConfig: BigQueryConfig): Promise<void> {
  const bigquery = new BigQuery({ projectId: bqConfig.projectId });

  const tables = [
    {
      name: DAYPARTING_BIGQUERY_TABLES.CONFIGS,
      schema: `
        config_id STRING NOT NULL,
        asin STRING NOT NULL,
        campaign_id STRING NOT NULL,
        ad_group_id STRING,
        mode STRING NOT NULL,
        enabled BOOL NOT NULL,
        max_multiplier FLOAT64 NOT NULL,
        min_multiplier FLOAT64 NOT NULL,
        significance_level FLOAT64 NOT NULL,
        min_sample_size INT64 NOT NULL,
        analysis_window_days INT64 NOT NULL,
        max_daily_loss FLOAT64 NOT NULL,
        rollback_threshold FLOAT64 NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      `,
    },
    {
      name: DAYPARTING_BIGQUERY_TABLES.MULTIPLIERS,
      schema: `
        multiplier_id STRING NOT NULL,
        asin STRING NOT NULL,
        campaign_id STRING NOT NULL,
        ad_group_id STRING,
        hour INT64 NOT NULL,
        day_of_week INT64,
        multiplier FLOAT64 NOT NULL,
        confidence STRING NOT NULL,
        classification STRING NOT NULL,
        effective_from TIMESTAMP NOT NULL,
        effective_to TIMESTAMP,
        is_active BOOL NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      `,
    },
    {
      name: DAYPARTING_BIGQUERY_TABLES.FEEDBACK,
      schema: `
        feedback_id STRING NOT NULL,
        asin STRING NOT NULL,
        campaign_id STRING NOT NULL,
        ad_group_id STRING,
        hour INT64 NOT NULL,
        day_of_week INT64,
        applied_multiplier FLOAT64 NOT NULL,
        applied_at TIMESTAMP NOT NULL,
        evaluated_at TIMESTAMP,
        cvr_before FLOAT64 NOT NULL,
        roas_before FLOAT64 NOT NULL,
        clicks_before INT64 NOT NULL,
        conversions_before INT64 NOT NULL,
        cvr_after FLOAT64,
        roas_after FLOAT64,
        clicks_after INT64,
        conversions_after INT64,
        is_success BOOL,
        success_score FLOAT64,
        evaluated BOOL NOT NULL
      `,
    },
    {
      name: DAYPARTING_BIGQUERY_TABLES.ROLLBACKS,
      schema: `
        rollback_id STRING NOT NULL,
        asin STRING NOT NULL,
        campaign_id STRING NOT NULL,
        reason STRING NOT NULL,
        previous_multipliers_json STRING NOT NULL,
        rolled_back_at TIMESTAMP NOT NULL,
        restored_at TIMESTAMP
      `,
    },
    {
      name: DAYPARTING_BIGQUERY_TABLES.HOURLY_METRICS,
      schema: `
        asin STRING NOT NULL,
        campaign_id STRING NOT NULL,
        ad_group_id STRING NOT NULL,
        hour INT64 NOT NULL,
        day_of_week INT64 NOT NULL,
        impressions INT64 NOT NULL,
        clicks INT64 NOT NULL,
        conversions INT64 NOT NULL,
        spend FLOAT64 NOT NULL,
        sales FLOAT64 NOT NULL,
        ctr FLOAT64,
        cvr FLOAT64,
        acos FLOAT64,
        roas FLOAT64,
        cpc FLOAT64,
        data_points INT64 NOT NULL,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        recorded_at TIMESTAMP NOT NULL
      `,
    },
  ];

  for (const table of tables) {
    const query = `
      CREATE TABLE IF NOT EXISTS \`${bqConfig.projectId}.${bqConfig.dataset}.${table.name}\` (
        ${table.schema}
      )
    `;

    try {
      await bigquery.query({ query, location: "asia-northeast1" });
      logger.info(`Created table ${table.name}`);
    } catch (error) {
      logger.error(`Failed to create table ${table.name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

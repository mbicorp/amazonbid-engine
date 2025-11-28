/**
 * バックテスト - BigQueryアダプター
 *
 * 過去の入札推奨ログと実績データを取得・保存
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import { BIGQUERY } from "../constants";
import {
  BacktestConfig,
  BacktestResult,
  HistoricalRecommendation,
  HistoricalPerformance,
  BacktestExecutionSummary,
  BacktestTimeSeriesEntry,
} from "./types";
import { ReasonCode } from "../logging";

/**
 * BigQuery接続設定
 */
interface BigQueryConfig {
  projectId: string;
  dataset: string;
}

// =============================================================================
// 設定
// =============================================================================

const projectId = process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID;
const datasetId = process.env.BIGQUERY_DATASET_ID || BIGQUERY.DATASET_ID;

const bigquery = new BigQuery({ projectId });

/**
 * バックテスト用テーブル名
 */
export const BACKTEST_TABLES = {
  EXECUTIONS: "backtest_executions",
  DAILY_DETAILS: "backtest_daily_details",
} as const;

// =============================================================================
// 過去データ取得
// =============================================================================

/**
 * 過去の入札推奨ログを取得
 */
export async function fetchHistoricalRecommendations(
  config: BacktestConfig
): Promise<HistoricalRecommendation[]> {
  let whereClause = `
    DATE(executed_at) >= @startDate
    AND DATE(executed_at) <= @endDate
  `;

  const params: Record<string, unknown> = {
    startDate: config.startDate,
    endDate: config.endDate,
  };

  if (config.targetAsins && config.targetAsins.length > 0) {
    whereClause += " AND asin IN UNNEST(@targetAsins)";
    params.targetAsins = config.targetAsins;
  }

  if (config.targetCampaignIds && config.targetCampaignIds.length > 0) {
    whereClause += " AND campaign_id IN UNNEST(@campaignIds)";
    params.campaignIds = config.targetCampaignIds;
  }

  const query = `
    SELECT
      GENERATE_UUID() AS recommendation_id,
      execution_id,
      DATE(executed_at) AS date,
      asin,
      keyword_id,
      keyword_text,
      match_type,
      campaign_id,
      ad_group_id,
      old_bid,
      new_bid,
      bid_change,
      bid_change_percent,
      target_acos,
      current_acos,
      reason_code,
      reason_detail,
      is_applied,
      COALESCE(new_bid, old_bid) AS actual_bid
    FROM \`${projectId}.${datasetId}.keyword_recommendations_log\`
    WHERE ${whereClause}
    ORDER BY executed_at ASC
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params,
      location: "asia-northeast1",
    });

    logger.debug("Fetched historical recommendations", {
      count: rows.length,
      startDate: config.startDate,
      endDate: config.endDate,
    });

    return rows.map((row: Record<string, unknown>) => ({
      recommendationId: row.recommendation_id as string,
      executionId: row.execution_id as string,
      date: row.date as string,
      asin: row.asin as string,
      keywordId: row.keyword_id as string,
      keywordText: row.keyword_text as string,
      matchType: row.match_type as string,
      campaignId: row.campaign_id as string,
      adGroupId: row.ad_group_id as string,
      oldBid: Number(row.old_bid) || 0,
      newBid: Number(row.new_bid) || 0,
      bidChange: Number(row.bid_change) || 0,
      bidChangePercent: Number(row.bid_change_percent) || 0,
      targetAcos: Number(row.target_acos) || 0,
      currentAcos: row.current_acos !== null ? Number(row.current_acos) : null,
      reasonCode: ((row.reason_code as string) || "NO_CHANGE") as ReasonCode,
      reasonDetail: (row.reason_detail as string) || "",
      isApplied: Boolean(row.is_applied),
      actualBid: Number(row.actual_bid) || 0,
    }));
  } catch (error) {
    logger.error("Failed to fetch historical recommendations", {
      error: error instanceof Error ? error.message : String(error),
      config,
    });
    throw error;
  }
}

/**
 * 過去の実績データを取得
 */
export async function fetchHistoricalPerformance(
  config: BacktestConfig
): Promise<HistoricalPerformance[]> {
  let whereClause = `
    date >= @startDate
    AND date <= @endDate
  `;

  const params: Record<string, unknown> = {
    startDate: config.startDate,
    endDate: config.endDate,
  };

  if (config.targetAsins && config.targetAsins.length > 0) {
    whereClause += " AND asin IN UNNEST(@targetAsins)";
    params.targetAsins = config.targetAsins;
  }

  if (config.targetCampaignIds && config.targetCampaignIds.length > 0) {
    whereClause += " AND campaign_id IN UNNEST(@campaignIds)";
    params.campaignIds = config.targetCampaignIds;
  }

  // keyword_daily_performance テーブルから取得
  // 存在しない場合は sp_keyword_report_daily から取得
  const query = `
    SELECT
      date,
      asin,
      keyword_id,
      campaign_id,
      impressions,
      clicks,
      orders AS conversions,
      cost AS spend,
      sales,
      SAFE_DIVIDE(clicks, impressions) AS ctr,
      SAFE_DIVIDE(orders, clicks) AS cvr,
      SAFE_DIVIDE(cost, clicks) AS cpc,
      SAFE_DIVIDE(cost, sales) AS acos,
      COALESCE(bid, 0) AS avg_bid,
      NULL AS avg_rank
    FROM \`${projectId}.${datasetId}.sp_keyword_report_daily\`
    WHERE ${whereClause}
    ORDER BY date ASC, keyword_id ASC
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params,
      location: "asia-northeast1",
    });

    logger.debug("Fetched historical performance", {
      count: rows.length,
      startDate: config.startDate,
      endDate: config.endDate,
    });

    return rows.map((row: Record<string, unknown>) => ({
      date: row.date as string,
      asin: row.asin as string,
      keywordId: row.keyword_id as string,
      campaignId: row.campaign_id as string,
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      conversions: Number(row.conversions) || 0,
      spend: Number(row.spend) || 0,
      sales: Number(row.sales) || 0,
      ctr: row.ctr !== null ? Number(row.ctr) : null,
      cvr: row.cvr !== null ? Number(row.cvr) : null,
      cpc: row.cpc !== null ? Number(row.cpc) : null,
      acos: row.acos !== null ? Number(row.acos) : null,
      avgBid: Number(row.avg_bid) || 0,
      avgRank: row.avg_rank !== null ? Number(row.avg_rank) : null,
    }));
  } catch (error) {
    logger.error("Failed to fetch historical performance", {
      error: error instanceof Error ? error.message : String(error),
      config,
    });
    throw error;
  }
}

// =============================================================================
// バックテスト結果保存
// =============================================================================

/**
 * バックテスト実行結果を保存
 */
export async function saveBacktestExecution(result: BacktestResult): Promise<void> {
  const table = bigquery.dataset(datasetId).table(BACKTEST_TABLES.EXECUTIONS);

  const row = {
    execution_id: result.executionId,
    config: JSON.stringify(result.config),
    period_start: result.period.start,
    period_end: result.period.end,
    period_days: result.period.days,

    // 実績値
    actual_spend: result.actual.totalSpend,
    actual_sales: result.actual.totalSales,
    actual_orders: result.actual.totalOrders,
    actual_acos: result.actual.acos,
    actual_roas: result.actual.roas,

    // シミュレーション値
    simulated_spend: result.simulated.totalSpend,
    simulated_sales: result.simulated.totalSales,
    simulated_orders: result.simulated.totalOrders,
    simulated_acos: result.simulated.acos,
    simulated_roas: result.simulated.roas,

    // 改善率
    spend_diff_percent: result.improvement.spendDiffPercent,
    acos_diff: result.improvement.acosDiff,
    estimated_profit_gain: result.improvement.estimatedProfitGain,

    // 精度
    total_decisions: result.accuracy.totalDecisions,
    correct_decisions: result.accuracy.correctDecisions,
    accuracy_rate: result.accuracy.accuracyRate,

    // メタデータ
    started_at: result.meta.startedAt,
    completed_at: result.meta.completedAt,
    duration_ms: result.meta.durationMs,
    keywords_processed: result.meta.keywordsProcessed,
    recommendations_processed: result.meta.recommendationsProcessed,

    created_at: new Date().toISOString(),
  };

  try {
    await table.insert([row]);
    logger.info("Saved backtest execution", { executionId: result.executionId });
  } catch (error) {
    logger.error("Failed to save backtest execution", {
      error: error instanceof Error ? error.message : String(error),
      executionId: result.executionId,
    });
    throw error;
  }
}

/**
 * バックテスト日別詳細を保存
 */
export async function saveBacktestDailyDetails(
  executionId: string,
  timeSeries: BacktestTimeSeriesEntry[]
): Promise<void> {
  if (timeSeries.length === 0) return;

  const table = bigquery.dataset(datasetId).table(BACKTEST_TABLES.DAILY_DETAILS);

  const rows = timeSeries.map((entry) => ({
    execution_id: executionId,
    date: entry.date,
    actual_spend: entry.actualSpend,
    actual_sales: entry.actualSales,
    actual_acos: entry.actualAcos,
    simulated_spend: entry.simulatedSpend,
    simulated_sales: entry.simulatedSales,
    simulated_acos: entry.simulatedAcos,
    decisions_count: entry.decisions,
    correct_decisions: entry.correctDecisions,
    created_at: new Date().toISOString(),
  }));

  const BATCH_SIZE = 500;

  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await table.insert(batch);
    }

    logger.debug("Saved backtest daily details", {
      executionId,
      count: rows.length,
    });
  } catch (error) {
    logger.error("Failed to save backtest daily details", {
      error: error instanceof Error ? error.message : String(error),
      executionId,
    });
    throw error;
  }
}

// =============================================================================
// バックテスト結果取得
// =============================================================================

/**
 * バックテスト実行一覧を取得
 */
export async function fetchBacktestExecutions(
  config: BigQueryConfig,
  limit: number = 20,
  offset: number = 0
): Promise<BacktestExecutionSummary[]> {
  const bq = new BigQuery({ projectId: config.projectId });
  const query = `
    SELECT
      execution_id,
      period_start AS start_date,
      period_end AS end_date,
      JSON_EXTRACT_SCALAR(config, '$.targetAsins') AS target_asins_json,
      actual_acos,
      simulated_acos,
      acos_diff,
      estimated_profit_gain,
      accuracy_rate,
      created_at
    FROM \`${config.projectId}.${config.dataset}.${BACKTEST_TABLES.EXECUTIONS}\`
    ORDER BY created_at DESC
    LIMIT @limit
    OFFSET @offset
  `;

  try {
    const [rows] = await bq.query({
      query,
      params: { limit, offset },
      location: "asia-northeast1",
    });

    return rows.map((row: Record<string, unknown>) => {
      const targetAsinsJson = row.target_asins_json as string | null;
      let asinCount = 0;
      if (targetAsinsJson) {
        try {
          const asins = JSON.parse(targetAsinsJson);
          asinCount = Array.isArray(asins) ? asins.length : 0;
        } catch {
          asinCount = 0;
        }
      }

      return {
        executionId: row.execution_id as string,
        startDate: row.start_date as string,
        endDate: row.end_date as string,
        asinCount,
        actualAcos: Number(row.actual_acos) || 0,
        simulatedAcos: Number(row.simulated_acos) || 0,
        acosDiff: Number(row.acos_diff) || 0,
        estimatedProfitGain: Number(row.estimated_profit_gain) || 0,
        accuracyRate: Number(row.accuracy_rate) || 0,
        createdAt: row.created_at as string,
      };
    });
  } catch (error) {
    logger.error("Failed to fetch backtest executions", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * バックテスト実行詳細を取得
 */
export async function fetchBacktestExecution(
  config: BigQueryConfig,
  executionId: string
): Promise<BacktestResult | null> {
  const bq = new BigQuery({ projectId: config.projectId });
  const executionQuery = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${BACKTEST_TABLES.EXECUTIONS}\`
    WHERE execution_id = @executionId
  `;

  const detailsQuery = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${BACKTEST_TABLES.DAILY_DETAILS}\`
    WHERE execution_id = @executionId
    ORDER BY date ASC
  `;

  try {
    const [[executionRows], [detailRows]] = await Promise.all([
      bq.query({
        query: executionQuery,
        params: { executionId },
        location: "asia-northeast1",
      }),
      bq.query({
        query: detailsQuery,
        params: { executionId },
        location: "asia-northeast1",
      }),
    ]);

    if (executionRows.length === 0) {
      return null;
    }

    const row = executionRows[0] as Record<string, unknown>;
    const config = JSON.parse(row.config as string) as BacktestConfig;

    const timeSeries: BacktestTimeSeriesEntry[] = detailRows.map(
      (d: Record<string, unknown>) => ({
        date: d.date as string,
        actualSpend: Number(d.actual_spend) || 0,
        actualSales: Number(d.actual_sales) || 0,
        actualAcos: d.actual_acos !== null ? Number(d.actual_acos) : null,
        simulatedSpend: Number(d.simulated_spend) || 0,
        simulatedSales: Number(d.simulated_sales) || 0,
        simulatedAcos: d.simulated_acos !== null ? Number(d.simulated_acos) : null,
        decisions: Number(d.decisions_count) || 0,
        correctDecisions: Number(d.correct_decisions) || 0,
      })
    );

    return {
      executionId: row.execution_id as string,
      config,
      period: {
        start: row.period_start as string,
        end: row.period_end as string,
        days: Number(row.period_days) || 0,
      },
      actual: {
        totalSpend: Number(row.actual_spend) || 0,
        totalSales: Number(row.actual_sales) || 0,
        totalOrders: Number(row.actual_orders) || 0,
        acos: Number(row.actual_acos) || 0,
        roas: Number(row.actual_roas) || 0,
      },
      simulated: {
        totalSpend: Number(row.simulated_spend) || 0,
        totalSales: Number(row.simulated_sales) || 0,
        totalOrders: Number(row.simulated_orders) || 0,
        acos: Number(row.simulated_acos) || 0,
        roas: Number(row.simulated_roas) || 0,
      },
      improvement: {
        spendDiff: Number(row.simulated_spend) - Number(row.actual_spend),
        spendDiffPercent: Number(row.spend_diff_percent) || 0,
        acosDiff: Number(row.acos_diff) || 0,
        roasDiff: Number(row.simulated_roas) - Number(row.actual_roas),
        estimatedProfitGain: Number(row.estimated_profit_gain) || 0,
      },
      accuracy: {
        totalDecisions: Number(row.total_decisions) || 0,
        correctDecisions: Number(row.correct_decisions) || 0,
        accuracyRate: Number(row.accuracy_rate) || 0,
        byAction: {
          STRONG_UP: { total: 0, correct: 0, rate: 0 },
          MILD_UP: { total: 0, correct: 0, rate: 0 },
          KEEP: { total: 0, correct: 0, rate: 0 },
          MILD_DOWN: { total: 0, correct: 0, rate: 0 },
          STRONG_DOWN: { total: 0, correct: 0, rate: 0 },
          STOP: { total: 0, correct: 0, rate: 0 },
        },
      },
      timeSeries,
      meta: {
        startedAt: row.started_at as string,
        completedAt: row.completed_at as string,
        durationMs: Number(row.duration_ms) || 0,
        keywordsProcessed: Number(row.keywords_processed) || 0,
        recommendationsProcessed: Number(row.recommendations_processed) || 0,
      },
    };
  } catch (error) {
    logger.error("Failed to fetch backtest execution", {
      error: error instanceof Error ? error.message : String(error),
      executionId,
    });
    throw error;
  }
}

/**
 * バックテスト日別詳細を取得
 */
export async function fetchBacktestDailyDetails(
  config: BigQueryConfig,
  executionId: string
): Promise<BacktestTimeSeriesEntry[]> {
  const bq = new BigQuery({ projectId: config.projectId });
  const query = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${BACKTEST_TABLES.DAILY_DETAILS}\`
    WHERE execution_id = @executionId
    ORDER BY date ASC
  `;

  try {
    const [rows] = await bq.query({
      query,
      params: { executionId },
      location: "asia-northeast1",
    });

    return rows.map((d: Record<string, unknown>) => ({
      date: d.date as string,
      actualSpend: Number(d.actual_spend) || 0,
      actualSales: Number(d.actual_sales) || 0,
      actualAcos: d.actual_acos !== null ? Number(d.actual_acos) : null,
      simulatedSpend: Number(d.simulated_spend) || 0,
      simulatedSales: Number(d.simulated_sales) || 0,
      simulatedAcos: d.simulated_acos !== null ? Number(d.simulated_acos) : null,
      decisions: Number(d.decisions_count) || 0,
      correctDecisions: Number(d.correct_decisions) || 0,
    }));
  } catch (error) {
    logger.error("Failed to fetch backtest daily details", {
      error: error instanceof Error ? error.message : String(error),
      executionId,
    });
    throw error;
  }
}

// =============================================================================
// テーブル作成（初期化用）
// =============================================================================

/**
 * バックテストテーブルを作成
 */
export async function createBacktestTables(config: BigQueryConfig): Promise<void> {
  const bq = new BigQuery({ projectId: config.projectId });
  const executionsSchema = `
    CREATE TABLE IF NOT EXISTS \`${config.projectId}.${config.dataset}.${BACKTEST_TABLES.EXECUTIONS}\` (
      execution_id STRING NOT NULL,
      config JSON NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      period_days INT64 NOT NULL,

      -- 実績値
      actual_spend NUMERIC NOT NULL,
      actual_sales NUMERIC NOT NULL,
      actual_orders INT64 NOT NULL,
      actual_acos NUMERIC NOT NULL,
      actual_roas NUMERIC NOT NULL,

      -- シミュレーション値
      simulated_spend NUMERIC NOT NULL,
      simulated_sales NUMERIC NOT NULL,
      simulated_orders INT64 NOT NULL,
      simulated_acos NUMERIC NOT NULL,
      simulated_roas NUMERIC NOT NULL,

      -- 改善率
      spend_diff_percent NUMERIC NOT NULL,
      acos_diff NUMERIC NOT NULL,
      estimated_profit_gain NUMERIC NOT NULL,

      -- 精度
      total_decisions INT64 NOT NULL,
      correct_decisions INT64 NOT NULL,
      accuracy_rate NUMERIC NOT NULL,

      -- メタデータ
      started_at TIMESTAMP NOT NULL,
      completed_at TIMESTAMP NOT NULL,
      duration_ms INT64 NOT NULL,
      keywords_processed INT64 NOT NULL,
      recommendations_processed INT64 NOT NULL,

      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    PARTITION BY DATE(created_at)
  `;

  const dailyDetailsSchema = `
    CREATE TABLE IF NOT EXISTS \`${config.projectId}.${config.dataset}.${BACKTEST_TABLES.DAILY_DETAILS}\` (
      execution_id STRING NOT NULL,
      date DATE NOT NULL,

      actual_spend NUMERIC,
      actual_sales NUMERIC,
      actual_acos NUMERIC,
      simulated_spend NUMERIC,
      simulated_sales NUMERIC,
      simulated_acos NUMERIC,

      decisions_count INT64,
      correct_decisions INT64,

      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
    )
    PARTITION BY date
  `;

  try {
    await bq.query({ query: executionsSchema, location: "asia-northeast1" });
    await bq.query({ query: dailyDetailsSchema, location: "asia-northeast1" });
    logger.info("Backtest tables created successfully");
  } catch (error) {
    logger.error("Failed to create backtest tables", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

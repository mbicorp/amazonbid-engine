/**
 * Dayparting (時間帯別入札最適化) - 時間帯別メトリクス収集
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  HourlyPerformanceMetrics,
  HourOfDay,
  DayOfWeek,
  HourlyMetricsRecord,
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

/**
 * メトリクス収集オプション
 */
export interface CollectMetricsOptions {
  /** 対象ASIN (省略時は全ASIN) */
  asins?: string[];
  /** 対象キャンペーンID (省略時は全キャンペーン) */
  campaignIds?: string[];
  /** 分析対象期間（日数） */
  windowDays?: number;
  /** 終了日 (省略時は今日) */
  endDate?: Date;
}

/**
 * メトリクス収集結果
 */
export interface CollectMetricsResult {
  /** 収集したメトリクス数 */
  count: number;
  /** ASIN別のメトリクス */
  byAsin: Map<string, HourlyPerformanceMetrics[]>;
  /** キャンペーン別のメトリクス */
  byCampaign: Map<string, HourlyPerformanceMetrics[]>;
  /** 時間帯別の集約メトリクス */
  byHour: Map<HourOfDay, HourlyPerformanceMetrics[]>;
  /** 収集日時 */
  collectedAt: Date;
}

// =============================================================================
// メトリクス収集
// =============================================================================

/**
 * BigQueryから時間帯別メトリクスを収集
 */
export async function collectHourlyMetrics(
  config: BigQueryConfig,
  options: CollectMetricsOptions = {}
): Promise<CollectMetricsResult> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const windowDays = options.windowDays ?? 14;
  const endDate = options.endDate ?? new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - windowDays);

  // WHERE句を構築
  const whereConditions: string[] = [
    "report_date >= @startDate",
    "report_date <= @endDate",
  ];

  if (options.asins && options.asins.length > 0) {
    whereConditions.push("asin IN UNNEST(@asins)");
  }

  if (options.campaignIds && options.campaignIds.length > 0) {
    whereConditions.push("campaign_id IN UNNEST(@campaignIds)");
  }

  const whereClause = whereConditions.join(" AND ");

  // 時間帯別メトリクス集計クエリ
  // search_term_report_hourly ビューから集計
  const query = `
    WITH hourly_raw AS (
      SELECT
        asin,
        campaign_id,
        ad_group_id,
        EXTRACT(HOUR FROM report_timestamp) AS hour,
        EXTRACT(DAYOFWEEK FROM report_timestamp) - 1 AS day_of_week,
        impressions,
        clicks,
        conversions,
        cost AS spend,
        sales
      FROM \`${config.projectId}.${config.dataset}.search_term_report_hourly\`
      WHERE ${whereClause}
    ),
    aggregated AS (
      SELECT
        asin,
        campaign_id,
        ad_group_id,
        hour,
        day_of_week,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(conversions) AS conversions,
        SUM(spend) AS spend,
        SUM(sales) AS sales,
        COUNT(*) AS data_points
      FROM hourly_raw
      GROUP BY asin, campaign_id, ad_group_id, hour, day_of_week
    )
    SELECT
      asin,
      campaign_id,
      ad_group_id,
      hour,
      day_of_week,
      impressions,
      clicks,
      conversions,
      spend,
      sales,
      SAFE_DIVIDE(clicks, impressions) AS ctr,
      SAFE_DIVIDE(conversions, clicks) AS cvr,
      SAFE_DIVIDE(spend, sales) AS acos,
      SAFE_DIVIDE(sales, spend) AS roas,
      SAFE_DIVIDE(spend, clicks) AS cpc,
      data_points
    FROM aggregated
    ORDER BY asin, campaign_id, hour, day_of_week
  `;

  const params: Record<string, unknown> = {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };

  if (options.asins && options.asins.length > 0) {
    params.asins = options.asins;
  }

  if (options.campaignIds && options.campaignIds.length > 0) {
    params.campaignIds = options.campaignIds;
  }

  try {
    const [rows] = await bigquery.query({
      query,
      params,
      location: "asia-northeast1",
    });

    const metrics: HourlyPerformanceMetrics[] = [];
    const byAsin = new Map<string, HourlyPerformanceMetrics[]>();
    const byCampaign = new Map<string, HourlyPerformanceMetrics[]>();
    const byHour = new Map<HourOfDay, HourlyPerformanceMetrics[]>();

    for (const row of rows) {
      const metric: HourlyPerformanceMetrics = {
        asin: row.asin,
        campaignId: row.campaign_id,
        adGroupId: row.ad_group_id,
        hour: row.hour as HourOfDay,
        dayOfWeek: row.day_of_week as DayOfWeek,
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions: Number(row.conversions ?? 0),
        spend: Number(row.spend ?? 0),
        sales: Number(row.sales ?? 0),
        ctr: row.ctr !== null ? Number(row.ctr) : null,
        cvr: row.cvr !== null ? Number(row.cvr) : null,
        acos: row.acos !== null ? Number(row.acos) : null,
        roas: row.roas !== null ? Number(row.roas) : null,
        cpc: row.cpc !== null ? Number(row.cpc) : null,
        dataPoints: Number(row.data_points ?? 0),
        periodStart: startDate,
        periodEnd: endDate,
      };

      metrics.push(metric);

      // ASIN別に集約
      if (!byAsin.has(metric.asin)) {
        byAsin.set(metric.asin, []);
      }
      byAsin.get(metric.asin)!.push(metric);

      // キャンペーン別に集約
      if (!byCampaign.has(metric.campaignId)) {
        byCampaign.set(metric.campaignId, []);
      }
      byCampaign.get(metric.campaignId)!.push(metric);

      // 時間帯別に集約
      if (!byHour.has(metric.hour)) {
        byHour.set(metric.hour, []);
      }
      byHour.get(metric.hour)!.push(metric);
    }

    logger.info("Collected hourly metrics", {
      count: metrics.length,
      asinCount: byAsin.size,
      campaignCount: byCampaign.size,
      windowDays,
    });

    return {
      count: metrics.length,
      byAsin,
      byCampaign,
      byHour,
      collectedAt: new Date(),
    };
  } catch (error) {
    logger.error("Failed to collect hourly metrics", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 単一ASIN・キャンペーンの時間帯別メトリクスを取得
 */
export async function getHourlyMetricsForCampaign(
  config: BigQueryConfig,
  asin: string,
  campaignId: string,
  windowDays: number = 14
): Promise<HourlyPerformanceMetrics[]> {
  const result = await collectHourlyMetrics(config, {
    asins: [asin],
    campaignIds: [campaignId],
    windowDays,
  });

  return result.byAsin.get(asin) ?? [];
}

// =============================================================================
// 全体平均の計算
// =============================================================================

/**
 * 全体平均メトリクスを計算
 */
export function calculateOverallAverages(
  metrics: HourlyPerformanceMetrics[]
): {
  meanCvr: number;
  meanRoas: number;
  meanCtr: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  totalSpend: number;
  totalSales: number;
} {
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalConversions = 0;
  let totalSpend = 0;
  let totalSales = 0;

  for (const metric of metrics) {
    totalImpressions += metric.impressions;
    totalClicks += metric.clicks;
    totalConversions += metric.conversions;
    totalSpend += metric.spend;
    totalSales += metric.sales;
  }

  return {
    meanCvr: totalClicks > 0 ? totalConversions / totalClicks : 0,
    meanRoas: totalSpend > 0 ? totalSales / totalSpend : 0,
    meanCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    totalImpressions,
    totalClicks,
    totalConversions,
    totalSpend,
    totalSales,
  };
}

/**
 * 時間帯別の集約メトリクスを計算
 */
export function aggregateMetricsByHour(
  metrics: HourlyPerformanceMetrics[]
): Map<HourOfDay, {
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  sales: number;
  cvr: number;
  roas: number;
  ctr: number;
  dataPoints: number;
}> {
  const hourlyAggregates = new Map<HourOfDay, {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    dataPoints: number;
  }>();

  // 初期化
  for (let h = 0; h < 24; h++) {
    hourlyAggregates.set(h as HourOfDay, {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spend: 0,
      sales: 0,
      dataPoints: 0,
    });
  }

  // 集計
  for (const metric of metrics) {
    const agg = hourlyAggregates.get(metric.hour)!;
    agg.impressions += metric.impressions;
    agg.clicks += metric.clicks;
    agg.conversions += metric.conversions;
    agg.spend += metric.spend;
    agg.sales += metric.sales;
    agg.dataPoints += metric.dataPoints;
  }

  // 計算済み指標を追加
  const result = new Map<HourOfDay, {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    cvr: number;
    roas: number;
    ctr: number;
    dataPoints: number;
  }>();

  for (const [hour, agg] of hourlyAggregates) {
    result.set(hour, {
      ...agg,
      cvr: agg.clicks > 0 ? agg.conversions / agg.clicks : 0,
      roas: agg.spend > 0 ? agg.sales / agg.spend : 0,
      ctr: agg.impressions > 0 ? agg.clicks / agg.impressions : 0,
    });
  }

  return result;
}

/**
 * 時間帯×曜日別の集約メトリクスを計算
 */
export function aggregateMetricsByHourAndDay(
  metrics: HourlyPerformanceMetrics[]
): Map<string, {
  hour: HourOfDay;
  dayOfWeek: DayOfWeek;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  sales: number;
  cvr: number;
  roas: number;
  ctr: number;
  dataPoints: number;
}> {
  const aggregates = new Map<string, {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    dataPoints: number;
  }>();

  // 集計
  for (const metric of metrics) {
    const key = `${metric.hour}|${metric.dayOfWeek}`;
    if (!aggregates.has(key)) {
      aggregates.set(key, {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        spend: 0,
        sales: 0,
        dataPoints: 0,
      });
    }
    const agg = aggregates.get(key)!;
    agg.impressions += metric.impressions;
    agg.clicks += metric.clicks;
    agg.conversions += metric.conversions;
    agg.spend += metric.spend;
    agg.sales += metric.sales;
    agg.dataPoints += metric.dataPoints;
  }

  // 計算済み指標を追加
  const result = new Map<string, {
    hour: HourOfDay;
    dayOfWeek: DayOfWeek;
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    cvr: number;
    roas: number;
    ctr: number;
    dataPoints: number;
  }>();

  for (const [key, agg] of aggregates) {
    const [hourStr, dayStr] = key.split("|");
    result.set(key, {
      hour: parseInt(hourStr, 10) as HourOfDay,
      dayOfWeek: parseInt(dayStr, 10) as DayOfWeek,
      ...agg,
      cvr: agg.clicks > 0 ? agg.conversions / agg.clicks : 0,
      roas: agg.spend > 0 ? agg.sales / agg.spend : 0,
      ctr: agg.impressions > 0 ? agg.clicks / agg.impressions : 0,
    });
  }

  return result;
}

// =============================================================================
// メトリクス保存
// =============================================================================

/**
 * 収集したメトリクスをBigQueryに保存
 */
export async function saveHourlyMetrics(
  config: BigQueryConfig,
  metrics: HourlyPerformanceMetrics[]
): Promise<void> {
  if (metrics.length === 0) {
    logger.info("No metrics to save");
    return;
  }

  const bigquery = new BigQuery({ projectId: config.projectId });
  const tableRef = `${config.projectId}.${config.dataset}.${DAYPARTING_BIGQUERY_TABLES.HOURLY_METRICS}`;

  const rows: HourlyMetricsRecord[] = metrics.map((m) => ({
    asin: m.asin,
    campaign_id: m.campaignId,
    ad_group_id: m.adGroupId,
    hour: m.hour,
    day_of_week: m.dayOfWeek,
    impressions: m.impressions,
    clicks: m.clicks,
    conversions: m.conversions,
    spend: m.spend,
    sales: m.sales,
    ctr: m.ctr,
    cvr: m.cvr,
    acos: m.acos,
    roas: m.roas,
    cpc: m.cpc,
    data_points: m.dataPoints,
    period_start: m.periodStart.toISOString(),
    period_end: m.periodEnd.toISOString(),
    recorded_at: new Date().toISOString(),
  }));

  try {
    await bigquery
      .dataset(config.dataset)
      .table(DAYPARTING_BIGQUERY_TABLES.HOURLY_METRICS)
      .insert(rows);

    logger.info("Saved hourly metrics to BigQuery", {
      count: rows.length,
      table: tableRef,
    });
  } catch (error) {
    logger.error("Failed to save hourly metrics", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// ユーティリティ
// =============================================================================

/**
 * 指定日時の時間帯と曜日を取得
 */
export function getHourAndDayOfWeek(date: Date): {
  hour: HourOfDay;
  dayOfWeek: DayOfWeek;
} {
  return {
    hour: date.getHours() as HourOfDay,
    dayOfWeek: date.getDay() as DayOfWeek,
  };
}

/**
 * 現在の時間帯と曜日を取得（日本時間）
 */
export function getCurrentHourAndDayJST(): {
  hour: HourOfDay;
  dayOfWeek: DayOfWeek;
} {
  // 日本時間に変換
  const now = new Date();
  const jstOffset = 9 * 60; // UTC+9
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const jstDate = new Date(utcMs + (jstOffset * 60 * 1000));

  return {
    hour: jstDate.getHours() as HourOfDay,
    dayOfWeek: jstDate.getDay() as DayOfWeek,
  };
}

/**
 * 時間帯を人間が読みやすい形式に変換
 */
export function formatHour(hour: HourOfDay): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

/**
 * 曜日を人間が読みやすい形式に変換（日本語）
 */
export function formatDayOfWeek(dayOfWeek: DayOfWeek): string {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return days[dayOfWeek];
}

/**
 * 曜日を人間が読みやすい形式に変換（英語）
 */
export function formatDayOfWeekEn(dayOfWeek: DayOfWeek): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[dayOfWeek];
}

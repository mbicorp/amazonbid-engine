/**
 * SEOメトリクス取得ヘルパー
 *
 * BigQueryからSEO順位履歴を取得し、トレンドを計算する
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  SeoMetrics,
  SeoQueryConfig,
  RankStatus,
  RankZone,
  SEO_TREND_LOOKBACK_DAYS,
  RANK_ZONE_THRESHOLDS,
  RANK_TREND_THRESHOLDS,
} from "./types";

// =============================================================================
// 順位ステータス・ゾーン判定
// =============================================================================

/**
 * 順位トレンドからステータスを判定
 *
 * @param rankTrend - 順位変化（prevRank - currentRank、上昇ならプラス）
 * @returns RankStatus
 */
export function determineRankStatus(rankTrend: number | null): RankStatus {
  if (rankTrend === null) {
    return "UNKNOWN";
  }

  if (rankTrend >= RANK_TREND_THRESHOLDS.UP_MIN) {
    return "UP";
  }

  if (rankTrend <= RANK_TREND_THRESHOLDS.DOWN_MAX) {
    return "DOWN";
  }

  return "FLAT";
}

/**
 * 現在順位からゾーンを判定
 *
 * @param currentRank - 現在の順位
 * @returns RankZone
 */
export function determineRankZone(currentRank: number | null): RankZone {
  if (currentRank === null) {
    return "UNKNOWN";
  }

  if (currentRank <= RANK_ZONE_THRESHOLDS.TOP_ZONE_MAX) {
    return "TOP_ZONE";
  }

  if (currentRank <= RANK_ZONE_THRESHOLDS.MID_ZONE_MAX) {
    return "MID_ZONE";
  }

  return "OUT_OF_RANGE";
}

// =============================================================================
// SEOメトリクス計算
// =============================================================================

/**
 * 現在順位と過去順位からSeoMetricsを計算
 *
 * @param asin - ASIN
 * @param currentRank - 現在の順位
 * @param prevRank - 過去の順位
 * @returns SeoMetrics
 */
export function calculateSeoMetrics(
  asin: string,
  currentRank: number | null,
  prevRank: number | null
): SeoMetrics {
  // トレンド計算
  let rankTrend: number | null = null;
  if (prevRank !== null && currentRank !== null) {
    // prevRank - currentRank: 順位が上がった（数値が減った）ならプラス
    rankTrend = prevRank - currentRank;
  }

  const rankStatus = determineRankStatus(rankTrend);
  const rankZone = determineRankZone(currentRank);

  return {
    asin,
    currentRank,
    prevRank,
    rankTrend,
    rankStatus,
    rankZone,
  };
}

// =============================================================================
// BigQueryからデータ取得
// =============================================================================

/**
 * 指定日付に最も近い順位レコードを取得
 *
 * @param bigquery - BigQueryクライアント
 * @param config - BigQuery接続設定
 * @param asin - ASIN
 * @param targetDate - 対象日付
 * @param keywordType - キーワードタイプ（デフォルト: MAIN）
 * @returns 順位またはnull
 */
async function fetchRankNearDate(
  bigquery: BigQuery,
  config: SeoQueryConfig,
  asin: string,
  targetDate: Date,
  keywordType: string = "MAIN"
): Promise<number | null> {
  // 対象日付の前後3日以内で最も近いレコードを取得
  const query = `
    SELECT organic_rank
    FROM \`${config.projectId}.${config.dataset}.product_seo_rank_history\`
    WHERE asin = @asin
      AND keyword_type = @keywordType
      AND date BETWEEN DATE_SUB(@targetDate, INTERVAL 3 DAY) AND DATE_ADD(@targetDate, INTERVAL 3 DAY)
    ORDER BY ABS(DATE_DIFF(date, @targetDate, DAY)) ASC
    LIMIT 1
  `;

  const targetDateStr = targetDate.toISOString().split("T")[0];

  try {
    const [rows] = await bigquery.query({
      query,
      params: {
        asin,
        keywordType,
        targetDate: targetDateStr,
      },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      return null;
    }

    return rows[0].organic_rank ?? null;
  } catch (error) {
    logger.warn("Failed to fetch rank near date", {
      asin,
      targetDate: targetDateStr,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * ASINのSEOメトリクスを取得
 *
 * @param config - BigQuery接続設定
 * @param asin - ASIN
 * @param today - 基準日（デフォルト: 今日）
 * @param lookbackDays - ルックバック日数（デフォルト: 7日）
 * @returns SeoMetrics
 */
export async function getSeoMetricsForAsin(
  config: SeoQueryConfig,
  asin: string,
  today: Date = new Date(),
  lookbackDays: number = SEO_TREND_LOOKBACK_DAYS
): Promise<SeoMetrics> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  // 過去の日付を計算
  const prevDate = new Date(today);
  prevDate.setDate(prevDate.getDate() - lookbackDays);

  // 現在順位と過去順位を並行取得
  const [currentRank, prevRank] = await Promise.all([
    fetchRankNearDate(bigquery, config, asin, today),
    fetchRankNearDate(bigquery, config, asin, prevDate),
  ]);

  const metrics = calculateSeoMetrics(asin, currentRank, prevRank);

  logger.debug("SEO metrics calculated", {
    asin,
    currentRank,
    prevRank,
    rankTrend: metrics.rankTrend,
    rankStatus: metrics.rankStatus,
    rankZone: metrics.rankZone,
  });

  return metrics;
}

/**
 * 複数ASINのSEOメトリクスをバルク取得
 *
 * @param config - BigQuery接続設定
 * @param asins - ASINリスト
 * @param today - 基準日（デフォルト: 今日）
 * @param lookbackDays - ルックバック日数（デフォルト: 7日）
 * @returns ASINをキーとするSeoMetricsのMap
 */
export async function getSeoMetricsForAsins(
  config: SeoQueryConfig,
  asins: string[],
  today: Date = new Date(),
  lookbackDays: number = SEO_TREND_LOOKBACK_DAYS
): Promise<Map<string, SeoMetrics>> {
  if (asins.length === 0) {
    return new Map();
  }

  const bigquery = new BigQuery({ projectId: config.projectId });

  const prevDate = new Date(today);
  prevDate.setDate(prevDate.getDate() - lookbackDays);

  const todayStr = today.toISOString().split("T")[0];
  const prevDateStr = prevDate.toISOString().split("T")[0];

  // 一括クエリで取得
  const query = `
    WITH current_ranks AS (
      SELECT
        asin,
        organic_rank,
        ROW_NUMBER() OVER (PARTITION BY asin ORDER BY ABS(DATE_DIFF(date, @today, DAY)) ASC) as rn
      FROM \`${config.projectId}.${config.dataset}.product_seo_rank_history\`
      WHERE asin IN UNNEST(@asins)
        AND keyword_type = 'MAIN'
        AND date BETWEEN DATE_SUB(@today, INTERVAL 3 DAY) AND DATE_ADD(@today, INTERVAL 3 DAY)
    ),
    prev_ranks AS (
      SELECT
        asin,
        organic_rank,
        ROW_NUMBER() OVER (PARTITION BY asin ORDER BY ABS(DATE_DIFF(date, @prevDate, DAY)) ASC) as rn
      FROM \`${config.projectId}.${config.dataset}.product_seo_rank_history\`
      WHERE asin IN UNNEST(@asins)
        AND keyword_type = 'MAIN'
        AND date BETWEEN DATE_SUB(@prevDate, INTERVAL 3 DAY) AND DATE_ADD(@prevDate, INTERVAL 3 DAY)
    )
    SELECT
      a.asin,
      c.organic_rank as current_rank,
      p.organic_rank as prev_rank
    FROM UNNEST(@asins) as a
    LEFT JOIN current_ranks c ON a = c.asin AND c.rn = 1
    LEFT JOIN prev_ranks p ON a = p.asin AND p.rn = 1
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: {
        asins,
        today: todayStr,
        prevDate: prevDateStr,
      },
      location: "asia-northeast1",
    });

    const metricsMap = new Map<string, SeoMetrics>();

    for (const row of rows) {
      const metrics = calculateSeoMetrics(
        row.asin,
        row.current_rank ?? null,
        row.prev_rank ?? null
      );
      metricsMap.set(row.asin, metrics);
    }

    logger.info("Bulk SEO metrics fetched", {
      requestedCount: asins.length,
      fetchedCount: metricsMap.size,
    });

    return metricsMap;
  } catch (error) {
    logger.error("Failed to fetch bulk SEO metrics", {
      asinCount: asins.length,
      error: error instanceof Error ? error.message : String(error),
    });

    // エラー時は空のメトリクスを返す
    const metricsMap = new Map<string, SeoMetrics>();
    for (const asin of asins) {
      metricsMap.set(asin, calculateSeoMetrics(asin, null, null));
    }
    return metricsMap;
  }
}

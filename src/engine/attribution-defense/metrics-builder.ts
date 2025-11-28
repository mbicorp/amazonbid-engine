/**
 * アトリビューション防御ロジック - メトリクス構築
 *
 * 日次パフォーマンスデータからAttributionAwareMetricsを構築する。
 * stable期間（アトリビューション遅延が発生していない期間）と
 * recent期間（直近の遅延が発生しうる期間）を分離して集計。
 */

import {
  AttributionAwareMetrics,
  PeriodMetrics,
  DailyPerformanceData,
  MetricsBuildConfig,
  DEFAULT_METRICS_BUILD_CONFIG,
} from "./types";

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 日付文字列をDateオブジェクトに変換
 */
function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}

/**
 * 2つの日付の差分（日数）を計算
 */
function daysDiff(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(date1.getTime() - date2.getTime()) / oneDay);
}

/**
 * 空のPeriodMetricsを生成
 */
function createEmptyPeriodMetrics(): PeriodMetrics {
  return {
    impressions: 0,
    clicks: 0,
    conversions: 0,
    cost: 0,
    sales: 0,
    ctr: null,
    cvr: null,
    acos: null,
    cpc: null,
  };
}

/**
 * 集計結果からPeriodMetricsを計算
 */
function calculatePeriodMetrics(
  impressions: number,
  clicks: number,
  conversions: number,
  cost: number,
  sales: number
): PeriodMetrics {
  return {
    impressions,
    clicks,
    conversions,
    cost,
    sales,
    ctr: impressions > 0 ? clicks / impressions : null,
    cvr: clicks > 0 ? conversions / clicks : null,
    acos: sales > 0 ? cost / sales : null,
    cpc: clicks > 0 ? cost / clicks : null,
  };
}

/**
 * 2つのPeriodMetricsを合算
 */
function mergePeriodMetrics(a: PeriodMetrics, b: PeriodMetrics): PeriodMetrics {
  const impressions = a.impressions + b.impressions;
  const clicks = a.clicks + b.clicks;
  const conversions = a.conversions + b.conversions;
  const cost = a.cost + b.cost;
  const sales = a.sales + b.sales;

  return calculatePeriodMetrics(impressions, clicks, conversions, cost, sales);
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * 日次データからAttributionAwareMetricsを構築
 *
 * @param asin - ASIN
 * @param entityId - キーワードID または クラスターID
 * @param entityType - エンティティタイプ
 * @param dailyData - 日次パフォーマンスデータ（日付降順でソートされていること）
 * @param targetCpa - 目標CPA
 * @param referenceDate - 基準日（デフォルトは今日）
 * @param config - 構築設定
 * @returns AttributionAwareMetrics
 *
 * @example
 * ```typescript
 * const metrics = buildAttributionAwareMetrics(
 *   "B00EXAMPLE",
 *   "keyword_123",
 *   "KEYWORD",
 *   dailyData,
 *   2000, // targetCPA = ¥2,000
 *   new Date("2024-01-15")
 * );
 *
 * // metrics.stable: 2024-01-01 〜 2024-01-11 のデータ（直近3日除外）
 * // metrics.recent: 2024-01-12 〜 2024-01-14 のデータ（直近3日）
 * // metrics.total: 2024-01-01 〜 2024-01-14 のデータ（全期間）
 * ```
 */
export function buildAttributionAwareMetrics(
  asin: string,
  entityId: string,
  entityType: "KEYWORD" | "SEARCH_TERM_CLUSTER",
  dailyData: DailyPerformanceData[],
  targetCpa: number,
  referenceDate: Date = new Date(),
  config: MetricsBuildConfig = DEFAULT_METRICS_BUILD_CONFIG
): AttributionAwareMetrics {
  const { recentDays, totalDays } = config;

  // stable期間の日数 = total期間 - recent期間
  const stableDays = totalDays - recentDays;

  // 基準日をリセット（時刻部分を除去）
  const refDate = new Date(referenceDate);
  refDate.setHours(0, 0, 0, 0);

  // recent期間の境界日（基準日からrecentDays日前）
  const recentBoundary = new Date(refDate);
  recentBoundary.setDate(refDate.getDate() - recentDays);

  // total期間の境界日（基準日からtotalDays日前）
  const totalBoundary = new Date(refDate);
  totalBoundary.setDate(refDate.getDate() - totalDays);

  // 各期間の集計用変数
  let stableImpressions = 0;
  let stableClicks = 0;
  let stableConversions = 0;
  let stableCost = 0;
  let stableSales = 0;

  let recentImpressions = 0;
  let recentClicks = 0;
  let recentConversions = 0;
  let recentCost = 0;
  let recentSales = 0;

  // 日次データを走査して期間別に集計
  for (const daily of dailyData) {
    const date = parseDate(daily.date);
    date.setHours(0, 0, 0, 0);

    // total期間外のデータはスキップ
    if (date < totalBoundary || date >= refDate) {
      continue;
    }

    if (date >= recentBoundary) {
      // recent期間（直近recentDays日）
      recentImpressions += daily.impressions;
      recentClicks += daily.clicks;
      recentConversions += daily.conversions;
      recentCost += daily.cost;
      recentSales += daily.sales;
    } else {
      // stable期間（recentDays日より前）
      stableImpressions += daily.impressions;
      stableClicks += daily.clicks;
      stableConversions += daily.conversions;
      stableCost += daily.cost;
      stableSales += daily.sales;
    }
  }

  // 各期間のメトリクスを計算
  const stable = calculatePeriodMetrics(
    stableImpressions,
    stableClicks,
    stableConversions,
    stableCost,
    stableSales
  );

  const recent = calculatePeriodMetrics(
    recentImpressions,
    recentClicks,
    recentConversions,
    recentCost,
    recentSales
  );

  // total = stable + recent
  const total = mergePeriodMetrics(stable, recent);

  return {
    asin,
    entityId,
    entityType,
    stable,
    recent,
    total,
    stableDays,
    recentDays,
    targetCpa,
  };
}

/**
 * KeywordMetricsからAttributionAwareMetricsを構築
 *
 * 既存のKeywordMetrics（7d/7dExclRecent/last3d/30d）から
 * AttributionAwareMetricsに変換する。
 *
 * マッピング:
 * - stable: 7dExclRecent の値を使用
 * - recent: last3d の値を使用
 * - total: 7d の値を使用（または stable + recent）
 *
 * @param asin - ASIN
 * @param keywordId - キーワードID
 * @param metrics7dExclRecent - 7日間（直近3日除外）のメトリクス
 * @param metricsLast3d - 直近3日のメトリクス
 * @param metrics7d - 7日間（フル）のメトリクス
 * @param targetCpa - 目標CPA
 */
export function buildFromKeywordMetrics(
  asin: string,
  keywordId: string,
  metrics7dExclRecent: {
    impressions: number;
    clicks: number;
    conversions: number;
    cost: number;
    sales: number;
  },
  metricsLast3d: {
    impressions: number;
    clicks: number;
    conversions: number;
    cost: number;
    sales: number;
  },
  metrics7d: {
    impressions: number;
    clicks: number;
    conversions: number;
    cost: number;
    sales: number;
  },
  targetCpa: number
): AttributionAwareMetrics {
  const stable = calculatePeriodMetrics(
    metrics7dExclRecent.impressions,
    metrics7dExclRecent.clicks,
    metrics7dExclRecent.conversions,
    metrics7dExclRecent.cost,
    metrics7dExclRecent.sales
  );

  const recent = calculatePeriodMetrics(
    metricsLast3d.impressions,
    metricsLast3d.clicks,
    metricsLast3d.conversions,
    metricsLast3d.cost,
    metricsLast3d.sales
  );

  const total = calculatePeriodMetrics(
    metrics7d.impressions,
    metrics7d.clicks,
    metrics7d.conversions,
    metrics7d.cost,
    metrics7d.sales
  );

  return {
    asin,
    entityId: keywordId,
    entityType: "KEYWORD",
    stable,
    recent,
    total,
    stableDays: 4, // 7 - 3 = 4日
    recentDays: 3,
    targetCpa,
  };
}

/**
 * 検索語クラスター統計からAttributionAwareMetricsを構築
 *
 * QueryClusterMetricsからAttributionAwareMetricsに変換する。
 * クラスターレベルでは日次データがない場合が多いため、
 * 集計済みの期間データを直接使用する。
 *
 * @param asin - ASIN
 * @param clusterId - クラスターID
 * @param stableMetrics - stable期間の集計済みメトリクス
 * @param recentMetrics - recent期間の集計済みメトリクス（オプション）
 * @param targetCpa - 目標CPA
 * @param stableDays - stable期間の日数
 * @param recentDays - recent期間の日数
 */
export function buildFromClusterMetrics(
  asin: string,
  clusterId: string,
  stableMetrics: {
    impressions: number;
    clicks: number;
    conversions: number;
    cost: number;
    sales: number;
  },
  recentMetrics: {
    impressions: number;
    clicks: number;
    conversions: number;
    cost: number;
    sales: number;
  } | null,
  targetCpa: number,
  stableDays: number = 27,
  recentDays: number = 3
): AttributionAwareMetrics {
  const stable = calculatePeriodMetrics(
    stableMetrics.impressions,
    stableMetrics.clicks,
    stableMetrics.conversions,
    stableMetrics.cost,
    stableMetrics.sales
  );

  const recent = recentMetrics
    ? calculatePeriodMetrics(
        recentMetrics.impressions,
        recentMetrics.clicks,
        recentMetrics.conversions,
        recentMetrics.cost,
        recentMetrics.sales
      )
    : createEmptyPeriodMetrics();

  const total = mergePeriodMetrics(stable, recent);

  return {
    asin,
    entityId: clusterId,
    entityType: "SEARCH_TERM_CLUSTER",
    stable,
    recent,
    total,
    stableDays,
    recentDays,
    targetCpa,
  };
}

// =============================================================================
// エクスポート
// =============================================================================

export {
  createEmptyPeriodMetrics,
  calculatePeriodMetrics,
  mergePeriodMetrics,
};

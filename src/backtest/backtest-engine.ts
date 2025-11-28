/**
 * バックテストエンジン本体
 *
 * 過去データを使って入札エンジンの成果をシミュレーション
 * 「このエンジンを使っていたら、実際と比べてどれだけ成果が改善していたか」を定量的に証明
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import {
  BacktestConfig,
  BacktestParameters,
  DEFAULT_BACKTEST_PARAMETERS,
  BacktestResult,
  HistoricalRecommendation,
  HistoricalPerformance,
  SimulatedResult,
  PerformanceSummary,
} from "./types";
import {
  fetchHistoricalRecommendations,
  fetchHistoricalPerformance,
  saveBacktestExecution,
  saveBacktestDailyDetails,
} from "./bigquery-adapter";
import {
  simulateKeywordDay,
  aggregateByDay,
  aggregateByWeek,
  calculateDecisionAccuracy,
  toTimeSeriesEntries,
  calculateImprovement,
  calculateDaysBetween,
  isValidDateRange,
} from "./backtest-calculator";
import { ValidationError } from "../errors";

// =============================================================================
// バックテスト実行
// =============================================================================

/**
 * バックテスト実行オプション
 */
export interface RunBacktestOptions {
  /** バックテスト設定 */
  config: BacktestConfig;
  /** シミュレーションパラメータ（省略時はデフォルト） */
  params?: BacktestParameters;
  /** 結果をBigQueryに保存するか */
  saveResults?: boolean;
  /** 利益率（改善額計算用） */
  profitMargin?: number;
}

/**
 * バックテストを実行
 */
export async function runBacktest(options: RunBacktestOptions): Promise<BacktestResult> {
  const {
    config,
    params = DEFAULT_BACKTEST_PARAMETERS,
    saveResults = true,
    profitMargin = 0.30,
  } = options;

  const executionId = `backtest_${uuidv4()}`;
  const startedAt = new Date().toISOString();

  logger.info("Starting backtest", {
    executionId,
    config,
    params,
  });

  // 入力検証
  validateBacktestConfig(config);

  try {
    // 1. 過去データを取得
    logger.info("Fetching historical data...");
    const [recommendations, performance] = await Promise.all([
      fetchHistoricalRecommendations(config),
      fetchHistoricalPerformance(config),
    ]);

    if (recommendations.length === 0) {
      throw new ValidationError(
        [{ field: "period", message: "指定期間に推奨ログがありません" }],
        "バックテストデータが不足しています"
      );
    }

    logger.info("Historical data fetched", {
      recommendations: recommendations.length,
      performance: performance.length,
    });

    // 2. 推奨と実績をマッチング
    const matchedData = matchRecommendationsWithPerformance(recommendations, performance);

    logger.info("Data matched", {
      matchedCount: matchedData.length,
    });

    // 3. シミュレーション実行
    logger.info("Running simulation...");
    const simulatedResults = matchedData.map(({ recommendation, perf }) =>
      simulateKeywordDay(recommendation, perf, params)
    );

    // 4. 集計
    const dailyAggregates = aggregateByDay(simulatedResults);
    const timeSeries = config.granularity === "WEEKLY"
      ? toTimeSeriesEntries(aggregateByWeek(dailyAggregates))
      : toTimeSeriesEntries(dailyAggregates);

    // 5. 全体集計
    const actual = calculateTotalPerformance(simulatedResults.map((r) => r.actual));
    const simulated = calculateTotalPerformance(simulatedResults.map((r) => r.simulated));
    const improvement = calculateImprovement(
      {
        spend: actual.totalSpend,
        sales: actual.totalSales,
        acos: actual.acos,
        roas: actual.roas,
      },
      {
        spend: simulated.totalSpend,
        sales: simulated.totalSales,
        acos: simulated.acos,
        roas: simulated.roas,
      },
      profitMargin
    );

    // 6. 判定精度を計算
    const accuracy = calculateDecisionAccuracy(simulatedResults);

    // 7. 結果を生成
    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

    const result: BacktestResult = {
      executionId,
      config,
      period: {
        start: config.startDate,
        end: config.endDate,
        days: calculateDaysBetween(config.startDate, config.endDate),
      },
      actual,
      simulated,
      improvement,
      accuracy,
      timeSeries,
      meta: {
        startedAt,
        completedAt,
        durationMs,
        keywordsProcessed: new Set(simulatedResults.map((r) => r.keywordId)).size,
        recommendationsProcessed: simulatedResults.length,
      },
    };

    logger.info("Backtest completed", {
      executionId,
      durationMs,
      actualAcos: (actual.acos * 100).toFixed(1) + "%",
      simulatedAcos: (simulated.acos * 100).toFixed(1) + "%",
      acosDiff: (improvement.acosDiff * 100).toFixed(1) + "pt",
      accuracyRate: (accuracy.accuracyRate * 100).toFixed(1) + "%",
      estimatedProfitGain: improvement.estimatedProfitGain.toLocaleString() + "円",
    });

    // 8. 結果を保存
    if (saveResults) {
      await saveBacktestExecution(result);
      await saveBacktestDailyDetails(executionId, timeSeries);
    }

    return result;
  } catch (error) {
    logger.error("Backtest failed", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * バックテスト設定を検証
 */
function validateBacktestConfig(config: BacktestConfig): void {
  const errors: { field: string; message: string }[] = [];

  if (!config.startDate) {
    errors.push({ field: "startDate", message: "開始日は必須です" });
  }

  if (!config.endDate) {
    errors.push({ field: "endDate", message: "終了日は必須です" });
  }

  if (config.startDate && config.endDate && !isValidDateRange(config.startDate, config.endDate)) {
    errors.push({
      field: "period",
      message: "期間が無効です（開始日 <= 終了日、最大365日）",
    });
  }

  if (!["DAILY", "WEEKLY"].includes(config.granularity)) {
    errors.push({ field: "granularity", message: "集計粒度は DAILY または WEEKLY です" });
  }

  if (errors.length > 0) {
    throw new ValidationError(errors, "バックテスト設定が無効です");
  }
}

/**
 * 推奨ログと実績データをマッチング
 */
function matchRecommendationsWithPerformance(
  recommendations: HistoricalRecommendation[],
  performance: HistoricalPerformance[]
): Array<{ recommendation: HistoricalRecommendation; perf: HistoricalPerformance }> {
  // 実績データをキーワードID×日付でインデックス化
  const perfIndex = new Map<string, HistoricalPerformance>();
  for (const perf of performance) {
    const key = `${perf.keywordId}|${perf.date}`;
    perfIndex.set(key, perf);
  }

  const matched: Array<{ recommendation: HistoricalRecommendation; perf: HistoricalPerformance }> = [];

  for (const rec of recommendations) {
    const key = `${rec.keywordId}|${rec.date}`;
    const perf = perfIndex.get(key);

    if (perf) {
      matched.push({ recommendation: rec, perf });
    }
  }

  return matched;
}

/**
 * 合計パフォーマンスを計算
 */
function calculateTotalPerformance(
  data: Array<{
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    acos: number | null;
  }>
): PerformanceSummary {
  const totalSpend = data.reduce((sum, d) => sum + d.spend, 0);
  const totalSales = data.reduce((sum, d) => sum + d.sales, 0);
  const totalOrders = data.reduce((sum, d) => sum + d.conversions, 0);

  return {
    totalSpend,
    totalSales,
    totalOrders,
    acos: totalSales > 0 ? totalSpend / totalSales : 0,
    roas: totalSpend > 0 ? totalSales / totalSpend : 0,
  };
}

// =============================================================================
// 週次バックテスト（定期実行用）
// =============================================================================

/**
 * 週次バックテストを実行（過去7日間）
 */
export async function runWeeklyBacktest(): Promise<BacktestResult> {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 1); // 昨日まで

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 6); // 7日前

  const config: BacktestConfig = {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
    granularity: "DAILY",
  };

  logger.info("Running weekly backtest", { config });

  return runBacktest({
    config,
    saveResults: true,
  });
}

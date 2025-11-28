/**
 * バックテスト - シミュレーション計算（純粋関数）
 *
 * 過去データを使って「推奨入札額を適用していた場合」の想定結果を計算
 *
 * シミュレーション計算の考え方:
 *
 * 入札を上げた場合 → インプレッション増加を期待
 *   impressions_sim = impressions_actual * (1 + bid_change_ratio * elasticity)
 *   elasticity = 0.5（入札10%増でインプレッション5%増と仮定）
 *
 * クリック数・売上の推定:
 *   clicks_sim = impressions_sim * ctr_actual
 *   orders_sim = clicks_sim * cvr_actual
 *   sales_sim = orders_sim * aov_actual
 *   cost_sim = clicks_sim * cpc_simulated
 */

import {
  BacktestParameters,
  DEFAULT_BACKTEST_PARAMETERS,
  HistoricalRecommendation,
  HistoricalPerformance,
  SimulatedResult,
  DailyAggregate,
  ActionAccuracy,
  DecisionAccuracy,
  BacktestTimeSeriesEntry,
} from "./types";

// =============================================================================
// シミュレーション計算
// =============================================================================

/**
 * 単一キーワード×日のシミュレーション結果を計算
 */
export function simulateKeywordDay(
  recommendation: HistoricalRecommendation,
  performance: HistoricalPerformance,
  params: BacktestParameters = DEFAULT_BACKTEST_PARAMETERS
): SimulatedResult {
  const { bidElasticity, cpcChangeRatio, assumeConstantCvr } = params;

  // 実際の入札額と推奨入札額の差分
  const actualBid = performance.avgBid > 0 ? performance.avgBid : recommendation.actualBid;
  const recommendedBid = recommendation.newBid;
  const bidChangeRate = actualBid > 0 ? (recommendedBid - actualBid) / actualBid : 0;

  // 実績値
  const actual = {
    impressions: performance.impressions,
    clicks: performance.clicks,
    conversions: performance.conversions,
    spend: performance.spend,
    sales: performance.sales,
    acos: performance.acos,
  };

  // シミュレーション値の計算
  // 1. インプレッションの変化（入札弾力性を適用）
  const impressionsMultiplier = 1 + bidChangeRate * bidElasticity;
  const simulatedImpressions = Math.round(actual.impressions * impressionsMultiplier);

  // 2. CTRは一定と仮定（実績CTRを使用）
  const ctr = actual.clicks > 0 && actual.impressions > 0
    ? actual.clicks / actual.impressions
    : 0.01; // デフォルトCTR 1%
  const simulatedClicks = Math.round(simulatedImpressions * ctr);

  // 3. CVRの計算
  let cvr: number;
  if (assumeConstantCvr) {
    // CVRは一定と仮定
    cvr = actual.clicks > 0 && actual.conversions > 0
      ? actual.conversions / actual.clicks
      : 0.02; // デフォルトCVR 2%
  } else {
    // 順位変動に応じてCVRも変化（将来拡張用）
    cvr = actual.clicks > 0 && actual.conversions > 0
      ? actual.conversions / actual.clicks
      : 0.02;
  }
  const simulatedConversions = Math.round(simulatedClicks * cvr);

  // 4. CPCの変化（入札額増加に伴いCPCも若干上昇）
  const actualCpc = actual.clicks > 0 ? actual.spend / actual.clicks : recommendedBid * 0.7;
  const cpcMultiplier = 1 + bidChangeRate * cpcChangeRatio;
  const simulatedCpc = actualCpc * cpcMultiplier;

  // 5. 広告費の計算
  const simulatedSpend = simulatedClicks * simulatedCpc;

  // 6. AOV（平均注文単価）は一定と仮定
  const aov = actual.conversions > 0 ? actual.sales / actual.conversions : 5000; // デフォルト5000円
  const simulatedSales = simulatedConversions * aov;

  // 7. ACOSの計算
  const simulatedAcos = simulatedSales > 0 ? simulatedSpend / simulatedSales : null;

  // 判定精度の評価
  const decision = evaluateDecisionCorrectness(
    recommendation,
    actual,
    {
      impressions: simulatedImpressions,
      clicks: simulatedClicks,
      conversions: simulatedConversions,
      spend: simulatedSpend,
      sales: simulatedSales,
      acos: simulatedAcos,
    }
  );

  return {
    date: performance.date,
    asin: performance.asin,
    keywordId: performance.keywordId,
    campaignId: performance.campaignId,
    actualBid,
    recommendedBid,
    bidChangeRate,
    actual,
    simulated: {
      impressions: simulatedImpressions,
      clicks: simulatedClicks,
      conversions: simulatedConversions,
      spend: simulatedSpend,
      sales: simulatedSales,
      acos: simulatedAcos,
    },
    decision,
  };
}

/**
 * 判定の正確性を評価
 *
 * 判定が「正しい」とみなす条件:
 * - UP判定: シミュレーションで売上増加またはACOS改善
 * - DOWN判定: シミュレーションでACOS改善（コスト削減）
 * - KEEP判定: 大きな変化なし
 */
export function evaluateDecisionCorrectness(
  recommendation: HistoricalRecommendation,
  actual: {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    acos: number | null;
  },
  simulated: {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    acos: number | null;
  }
): {
  action: string;
  wasCorrect: boolean;
  correctnessReason: string;
} {
  const action = getActionFromBidChange(recommendation.bidChangePercent);

  // 改善率の計算
  const salesImprovement = actual.sales > 0
    ? (simulated.sales - actual.sales) / actual.sales
    : 0;
  const spendChange = actual.spend > 0
    ? (simulated.spend - actual.spend) / actual.spend
    : 0;
  const acosImprovement = actual.acos && simulated.acos
    ? actual.acos - simulated.acos
    : 0;

  let wasCorrect = false;
  let correctnessReason = "";

  switch (action) {
    case "STRONG_UP":
    case "MILD_UP":
      // UP判定が正しい条件:
      // - 売上が5%以上増加、または
      // - ACOS改善（1ポイント以上）
      if (salesImprovement >= 0.05) {
        wasCorrect = true;
        correctnessReason = `売上${(salesImprovement * 100).toFixed(1)}%増加`;
      } else if (acosImprovement >= 0.01) {
        wasCorrect = true;
        correctnessReason = `ACOS${(acosImprovement * 100).toFixed(1)}pt改善`;
      } else {
        correctnessReason = `売上・ACOS改善なし（売上${(salesImprovement * 100).toFixed(1)}%）`;
      }
      break;

    case "MILD_DOWN":
    case "STRONG_DOWN":
    case "STOP":
      // DOWN判定が正しい条件:
      // - コスト削減（5%以上）
      // - 売上減少が10%以内
      if (spendChange <= -0.05 && salesImprovement >= -0.10) {
        wasCorrect = true;
        correctnessReason = `コスト${(-spendChange * 100).toFixed(1)}%削減、売上影響${(salesImprovement * 100).toFixed(1)}%`;
      } else if (acosImprovement >= 0.02) {
        wasCorrect = true;
        correctnessReason = `ACOS${(acosImprovement * 100).toFixed(1)}pt改善`;
      } else {
        correctnessReason = `コスト削減効果不十分（${(spendChange * 100).toFixed(1)}%）`;
      }
      break;

    case "KEEP":
    default:
      // KEEP判定が正しい条件:
      // - 大きな変化なし（売上変動10%以内）
      if (Math.abs(salesImprovement) <= 0.10 && Math.abs(spendChange) <= 0.10) {
        wasCorrect = true;
        correctnessReason = "安定維持";
      } else {
        correctnessReason = `変動あり（売上${(salesImprovement * 100).toFixed(1)}%）`;
      }
      break;
  }

  return {
    action,
    wasCorrect,
    correctnessReason,
  };
}

/**
 * 入札変更率からアクションを判定
 */
export function getActionFromBidChange(bidChangePercent: number): string {
  if (bidChangePercent >= 25) return "STRONG_UP";
  if (bidChangePercent >= 10) return "MILD_UP";
  if (bidChangePercent <= -60) return "STOP";
  if (bidChangePercent <= -25) return "STRONG_DOWN";
  if (bidChangePercent <= -10) return "MILD_DOWN";
  return "KEEP";
}

// =============================================================================
// 集計計算
// =============================================================================

/**
 * 日別に集計
 */
export function aggregateByDay(results: SimulatedResult[]): DailyAggregate[] {
  const byDate = new Map<string, SimulatedResult[]>();

  for (const result of results) {
    const existing = byDate.get(result.date) || [];
    existing.push(result);
    byDate.set(result.date, existing);
  }

  const aggregates: DailyAggregate[] = [];

  for (const [date, dayResults] of byDate) {
    const actualSpend = sum(dayResults, (r) => r.actual.spend);
    const actualSales = sum(dayResults, (r) => r.actual.sales);
    const actualConversions = sum(dayResults, (r) => r.actual.conversions);

    const simulatedSpend = sum(dayResults, (r) => r.simulated.spend);
    const simulatedSales = sum(dayResults, (r) => r.simulated.sales);
    const simulatedConversions = sum(dayResults, (r) => r.simulated.conversions);

    const correctDecisions = dayResults.filter((r) => r.decision.wasCorrect).length;

    aggregates.push({
      date,
      actual: {
        spend: actualSpend,
        sales: actualSales,
        conversions: actualConversions,
        acos: actualSales > 0 ? actualSpend / actualSales : null,
        roas: actualSpend > 0 ? actualSales / actualSpend : null,
      },
      simulated: {
        spend: simulatedSpend,
        sales: simulatedSales,
        conversions: simulatedConversions,
        acos: simulatedSales > 0 ? simulatedSpend / simulatedSales : null,
        roas: simulatedSpend > 0 ? simulatedSales / simulatedSpend : null,
      },
      decisionsCount: dayResults.length,
      correctDecisions,
    });
  }

  // 日付順にソート
  return aggregates.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 週別に集計
 */
export function aggregateByWeek(dailyAggregates: DailyAggregate[]): DailyAggregate[] {
  const byWeek = new Map<string, DailyAggregate[]>();

  for (const day of dailyAggregates) {
    const weekStart = getWeekStart(day.date);
    const existing = byWeek.get(weekStart) || [];
    existing.push(day);
    byWeek.set(weekStart, existing);
  }

  const weeklyAggregates: DailyAggregate[] = [];

  for (const [weekStart, weekDays] of byWeek) {
    const actualSpend = sum(weekDays, (d) => d.actual.spend);
    const actualSales = sum(weekDays, (d) => d.actual.sales);
    const actualConversions = sum(weekDays, (d) => d.actual.conversions);

    const simulatedSpend = sum(weekDays, (d) => d.simulated.spend);
    const simulatedSales = sum(weekDays, (d) => d.simulated.sales);
    const simulatedConversions = sum(weekDays, (d) => d.simulated.conversions);

    const decisionsCount = sum(weekDays, (d) => d.decisionsCount);
    const correctDecisions = sum(weekDays, (d) => d.correctDecisions);

    weeklyAggregates.push({
      date: weekStart,
      actual: {
        spend: actualSpend,
        sales: actualSales,
        conversions: actualConversions,
        acos: actualSales > 0 ? actualSpend / actualSales : null,
        roas: actualSpend > 0 ? actualSales / actualSpend : null,
      },
      simulated: {
        spend: simulatedSpend,
        sales: simulatedSales,
        conversions: simulatedConversions,
        acos: simulatedSales > 0 ? simulatedSpend / simulatedSales : null,
        roas: simulatedSpend > 0 ? simulatedSales / simulatedSpend : null,
      },
      decisionsCount,
      correctDecisions,
    });
  }

  return weeklyAggregates.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 判定精度を集計
 */
export function calculateDecisionAccuracy(results: SimulatedResult[]): DecisionAccuracy {
  const byAction: Record<string, { total: number; correct: number }> = {
    STRONG_UP: { total: 0, correct: 0 },
    MILD_UP: { total: 0, correct: 0 },
    KEEP: { total: 0, correct: 0 },
    MILD_DOWN: { total: 0, correct: 0 },
    STRONG_DOWN: { total: 0, correct: 0 },
    STOP: { total: 0, correct: 0 },
  };

  for (const result of results) {
    const action = result.decision.action;
    if (byAction[action]) {
      byAction[action].total++;
      if (result.decision.wasCorrect) {
        byAction[action].correct++;
      }
    }
  }

  const totalDecisions = results.length;
  const correctDecisions = results.filter((r) => r.decision.wasCorrect).length;

  const toActionAccuracy = (data: { total: number; correct: number }): ActionAccuracy => ({
    total: data.total,
    correct: data.correct,
    rate: data.total > 0 ? data.correct / data.total : 0,
  });

  return {
    totalDecisions,
    correctDecisions,
    accuracyRate: totalDecisions > 0 ? correctDecisions / totalDecisions : 0,
    byAction: {
      STRONG_UP: toActionAccuracy(byAction.STRONG_UP),
      MILD_UP: toActionAccuracy(byAction.MILD_UP),
      KEEP: toActionAccuracy(byAction.KEEP),
      MILD_DOWN: toActionAccuracy(byAction.MILD_DOWN),
      STRONG_DOWN: toActionAccuracy(byAction.STRONG_DOWN),
      STOP: toActionAccuracy(byAction.STOP),
    },
  };
}

/**
 * 日別集計を時系列エントリに変換
 */
export function toTimeSeriesEntries(dailyAggregates: DailyAggregate[]): BacktestTimeSeriesEntry[] {
  return dailyAggregates.map((day) => ({
    date: day.date,
    actualSpend: day.actual.spend,
    actualSales: day.actual.sales,
    actualAcos: day.actual.acos,
    simulatedSpend: day.simulated.spend,
    simulatedSales: day.simulated.sales,
    simulatedAcos: day.simulated.acos,
    decisions: day.decisionsCount,
    correctDecisions: day.correctDecisions,
  }));
}

/**
 * 改善率を計算
 */
export function calculateImprovement(
  actual: { spend: number; sales: number; acos: number | null; roas: number | null },
  simulated: { spend: number; sales: number; acos: number | null; roas: number | null },
  profitMargin: number = 0.30
): {
  spendDiff: number;
  spendDiffPercent: number;
  acosDiff: number;
  roasDiff: number;
  estimatedProfitGain: number;
} {
  const spendDiff = simulated.spend - actual.spend;
  const spendDiffPercent = actual.spend > 0
    ? (spendDiff / actual.spend) * 100
    : 0;

  const acosDiff = (actual.acos ?? 0) - (simulated.acos ?? 0);
  const roasDiff = (simulated.roas ?? 0) - (actual.roas ?? 0);

  // 推定利益改善額
  // = 広告費削減額 + (売上増加 × 利益率)
  const salesDiff = simulated.sales - actual.sales;
  const estimatedProfitGain = -spendDiff + salesDiff * profitMargin;

  return {
    spendDiff,
    spendDiffPercent,
    acosDiff,
    roasDiff,
    estimatedProfitGain,
  };
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 配列の合計を計算
 */
function sum<T>(arr: T[], fn: (item: T) => number): number {
  return arr.reduce((acc, item) => acc + fn(item), 0);
}

/**
 * 週の開始日（月曜日）を取得
 */
function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // 月曜日を週の開始に
  const weekStart = new Date(date.setDate(diff));
  return weekStart.toISOString().split("T")[0];
}

/**
 * 期間の日数を計算
 */
export function calculateDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * 日付が有効な範囲内か確認
 */
export function isValidDateRange(startDate: string, endDate: string): boolean {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return false;
  }

  if (start > end) {
    return false;
  }

  // 最大365日まで
  const days = calculateDaysBetween(startDate, endDate);
  if (days > 365) {
    return false;
  }

  return true;
}

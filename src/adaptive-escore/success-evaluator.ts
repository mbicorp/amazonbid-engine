/**
 * 自適応型Eスコア最適化システム - 成功/失敗評価ロジック
 */

import {
  ActionType,
  SuccessLevel,
  MetricsSnapshot,
  FeedbackRecord,
} from "./types";
import { ACTION_SUCCESS_CRITERIA, SUCCESS_LEVEL_SCORES } from "./config";

// =============================================================================
// メトリクス変化率の計算
// =============================================================================

/**
 * 変化率を計算（ゼロ除算対策）
 */
function calculateChangeRate(before: number, after: number): number {
  if (before === 0) {
    return after > 0 ? 1 : 0;
  }
  return (after - before) / before;
}

/**
 * 実行前後のメトリクス変化を計算
 */
export function calculateMetricsChange(
  before: MetricsSnapshot,
  after: MetricsSnapshot
): {
  cvrChange: number;
  ctrChange: number;
  acosChange: number;
  salesChange: number;
  clicksChange: number;
} {
  return {
    cvrChange: calculateChangeRate(before.cvr, after.cvr),
    ctrChange: calculateChangeRate(before.ctr, after.ctr),
    acosChange: calculateChangeRate(before.acos, after.acos),
    salesChange: calculateChangeRate(before.sales, after.sales),
    clicksChange: calculateChangeRate(before.clicks, after.clicks),
  };
}

// =============================================================================
// アクション別成功判定
// =============================================================================

/**
 * STRONG_UPアクションの成功判定
 */
function evaluateStrongUp(
  salesChange: number,
  cvrChange: number,
  acosChange: number
): SuccessLevel {
  const criteria = ACTION_SUCCESS_CRITERIA.STRONG_UP;

  // EXCELLENT: 売上15%以上増加、CVR低下5%未満
  if (salesChange >= criteria.excellent.salesChange && cvrChange >= criteria.excellent.cvrChange) {
    return "EXCELLENT";
  }

  // GOOD: 売上5%以上増加、CVR低下10%未満
  if (salesChange >= criteria.good.salesChange && cvrChange >= criteria.good.cvrChange) {
    return "GOOD";
  }

  // ACCEPTABLE: 売上増加（微小でも）、ACOS20%以内の悪化
  if (salesChange >= criteria.acceptable.salesChange && acosChange <= criteria.acceptable.acosChange) {
    return "ACCEPTABLE";
  }

  return "POOR";
}

/**
 * MILD_UPアクションの成功判定
 */
function evaluateMildUp(
  salesChange: number,
  acosChange: number
): SuccessLevel {
  const criteria = ACTION_SUCCESS_CRITERIA.MILD_UP;

  if (salesChange >= criteria.excellent.salesChange && acosChange <= criteria.excellent.acosChange) {
    return "EXCELLENT";
  }

  if (salesChange >= criteria.good.salesChange && acosChange <= criteria.good.acosChange) {
    return "GOOD";
  }

  if (salesChange >= criteria.acceptable.salesChange && acosChange <= criteria.acceptable.acosChange) {
    return "ACCEPTABLE";
  }

  return "POOR";
}

/**
 * KEEPアクションの成功判定
 */
function evaluateKeep(
  salesChange: number,
  acosChange: number
): SuccessLevel {
  const criteria = ACTION_SUCCESS_CRITERIA.KEEP;

  // 安定維持が成功
  if (salesChange >= criteria.excellent.salesChange && acosChange <= criteria.excellent.acosChange) {
    return "EXCELLENT";
  }

  if (salesChange >= criteria.good.salesChange && acosChange <= criteria.good.acosChange) {
    return "GOOD";
  }

  if (salesChange >= criteria.acceptable.salesChange && acosChange <= criteria.acceptable.acosChange) {
    return "ACCEPTABLE";
  }

  return "POOR";
}

/**
 * MILD_DOWNアクションの成功判定
 */
function evaluateMildDown(acosChange: number): SuccessLevel {
  const criteria = ACTION_SUCCESS_CRITERIA.MILD_DOWN;

  // ACOS改善が成功
  if (acosChange <= criteria.excellent.acosChange) {
    return "EXCELLENT";
  }

  if (acosChange <= criteria.good.acosChange) {
    return "GOOD";
  }

  if (acosChange <= criteria.acceptable.acosChange) {
    return "ACCEPTABLE";
  }

  return "POOR";
}

/**
 * STRONG_DOWNアクションの成功判定
 */
function evaluateStrongDown(acosChange: number): SuccessLevel {
  const criteria = ACTION_SUCCESS_CRITERIA.STRONG_DOWN;

  if (acosChange <= criteria.excellent.acosChange) {
    return "EXCELLENT";
  }

  if (acosChange <= criteria.good.acosChange) {
    return "GOOD";
  }

  if (acosChange <= criteria.acceptable.acosChange) {
    return "ACCEPTABLE";
  }

  return "POOR";
}

/**
 * STOPアクションの成功判定
 */
function evaluateStop(acosChange: number): SuccessLevel {
  const criteria = ACTION_SUCCESS_CRITERIA.STOP;

  // 損失が止まれば成功
  if (acosChange <= criteria.excellent.acosChange) {
    return "EXCELLENT";
  }

  if (acosChange <= criteria.good.acosChange) {
    return "GOOD";
  }

  if (acosChange <= criteria.acceptable.acosChange) {
    return "ACCEPTABLE";
  }

  return "POOR";
}

// =============================================================================
// メイン評価関数
// =============================================================================

/**
 * アクションの成功度を評価
 */
export function evaluateSuccess(
  before: MetricsSnapshot,
  after: MetricsSnapshot,
  action: ActionType
): { level: SuccessLevel; score: number } {
  const changes = calculateMetricsChange(before, after);

  let level: SuccessLevel;

  switch (action) {
    case "STRONG_UP":
      level = evaluateStrongUp(changes.salesChange, changes.cvrChange, changes.acosChange);
      break;

    case "MILD_UP":
      level = evaluateMildUp(changes.salesChange, changes.acosChange);
      break;

    case "KEEP":
      level = evaluateKeep(changes.salesChange, changes.acosChange);
      break;

    case "MILD_DOWN":
      level = evaluateMildDown(changes.acosChange);
      break;

    case "STRONG_DOWN":
      level = evaluateStrongDown(changes.acosChange);
      break;

    case "STOP":
      level = evaluateStop(changes.acosChange);
      break;

    default:
      level = "ACCEPTABLE";
  }

  return {
    level,
    score: SUCCESS_LEVEL_SCORES[level],
  };
}

/**
 * フィードバックレコードを評価して更新
 */
export function evaluateFeedbackRecord(
  record: FeedbackRecord,
  afterMetrics: MetricsSnapshot
): FeedbackRecord {
  const beforeMetrics: MetricsSnapshot = {
    cvr: record.cvr_before,
    ctr: record.ctr_before,
    acos: record.acos_before,
    sales: record.sales_before,
    clicks: record.clicks_before,
    impressions: 0, // 使用しない
    rank: null,
    bid: record.bid_before,
  };

  const evaluation = evaluateSuccess(beforeMetrics, afterMetrics, record.action_taken);

  return {
    ...record,
    cvr_after: afterMetrics.cvr,
    ctr_after: afterMetrics.ctr,
    acos_after: afterMetrics.acos,
    sales_after: afterMetrics.sales,
    clicks_after: afterMetrics.clicks,
    bid_after: afterMetrics.bid,
    success_level: evaluation.level,
    success_score: evaluation.score,
    evaluated: true,
    evaluation_timestamp: new Date(),
  };
}

// =============================================================================
// 統計計算
// =============================================================================

/**
 * フィードバックレコード群から成功率を計算
 */
export function calculateSuccessRate(records: FeedbackRecord[]): number {
  const evaluatedRecords = records.filter((r) => r.evaluated && r.success_score !== null);

  if (evaluatedRecords.length === 0) {
    return 0;
  }

  const totalScore = evaluatedRecords.reduce((sum, r) => sum + (r.success_score || 0), 0);
  return totalScore / evaluatedRecords.length;
}

/**
 * アクション別の成功率を計算
 */
export function calculateSuccessRateByAction(
  records: FeedbackRecord[]
): Record<ActionType, { rate: number; count: number }> {
  const result: Record<ActionType, { rate: number; count: number }> = {
    STRONG_UP: { rate: 0, count: 0 },
    MILD_UP: { rate: 0, count: 0 },
    KEEP: { rate: 0, count: 0 },
    MILD_DOWN: { rate: 0, count: 0 },
    STRONG_DOWN: { rate: 0, count: 0 },
    STOP: { rate: 0, count: 0 },
  };

  for (const record of records) {
    if (!record.evaluated || record.success_score === null) continue;

    const action = record.action_taken;
    result[action].count++;
    result[action].rate += record.success_score;
  }

  // 平均化
  for (const action of Object.keys(result) as ActionType[]) {
    if (result[action].count > 0) {
      result[action].rate /= result[action].count;
    }
  }

  return result;
}

/**
 * Eスコアランク別の成功率を計算
 */
export function calculateSuccessRateByRank(
  records: FeedbackRecord[]
): Record<string, { rate: number; count: number }> {
  const result: Record<string, { rate: number; count: number }> = {
    S: { rate: 0, count: 0 },
    A: { rate: 0, count: 0 },
    B: { rate: 0, count: 0 },
    C: { rate: 0, count: 0 },
    D: { rate: 0, count: 0 },
  };

  for (const record of records) {
    if (!record.evaluated || record.success_score === null) continue;

    const rank = record.predicted_rank;
    result[rank].count++;
    result[rank].rate += record.success_score;
  }

  // 平均化
  for (const rank of Object.keys(result)) {
    if (result[rank].count > 0) {
      result[rank].rate /= result[rank].count;
    }
  }

  return result;
}

/**
 * 予測精度を計算（Eスコアと実際の成功度の相関）
 */
export function calculatePredictionAccuracy(records: FeedbackRecord[]): number {
  const evaluatedRecords = records.filter((r) => r.evaluated && r.success_score !== null);

  if (evaluatedRecords.length < 10) {
    return 0; // データ不足
  }

  // Eスコア（0-100）を0-1に正規化して、成功スコアとの差の絶対値を計算
  let totalError = 0;

  for (const record of evaluatedRecords) {
    const normalizedEScore = record.e_score / 100;
    const error = Math.abs(normalizedEScore - (record.success_score || 0));
    totalError += error;
  }

  // 平均誤差を1から引いて精度とする
  const avgError = totalError / evaluatedRecords.length;
  return Math.max(0, 1 - avgError);
}

/**
 * Budget（日予算）最適化 - 計算ロジック
 *
 * 純粋関数として実装。外部依存なし、テスト容易。
 *
 * コアコンセプト:
 * 「予算が足りない（Usageが高い または Lost ISがある）」かつ「利益が出ている（ACOSが低い）」
 * 場合のみ、予算を引き上げる。無駄遣いしているキャンペーンの予算は増やさない。
 */

import {
  BudgetMetrics,
  BudgetRecommendation,
  BudgetAction,
  BudgetReasonCode,
  BudgetOptimizerConfig,
  DEFAULT_BUDGET_OPTIMIZER_CONFIG,
} from "./types";

// =============================================================================
// メイン計算関数
// =============================================================================

/**
 * 単一キャンペーンの予算推奨を計算
 *
 * @param metrics キャンペーンの予算メトリクス
 * @param config 最適化設定
 * @returns 予算推奨結果
 */
export function computeBudgetRecommendation(
  metrics: BudgetMetrics,
  config: BudgetOptimizerConfig = DEFAULT_BUDGET_OPTIMIZER_CONFIG
): BudgetRecommendation {
  const now = new Date();

  // 7日ACOSを主に使用（データがなければ30日を使用）
  const currentAcos = metrics.acos7d ?? metrics.acos30d;

  // ACOS ギャップ比率を計算
  const acosGapRatio =
    currentAcos !== null && metrics.targetAcos > 0
      ? currentAcos / metrics.targetAcos
      : null;

  // ベース推奨値（変更なし）
  const baseRecommendation: BudgetRecommendation = {
    campaignId: metrics.campaignId,
    campaignName: metrics.campaignName,
    action: "KEEP",
    oldBudget: metrics.dailyBudget,
    newBudget: metrics.dailyBudget,
    budgetChange: 0,
    budgetChangePercent: 0,
    reasonCode: "BUDGET_AVAILABLE",
    reasonDetail: "",
    budgetUsagePercent: metrics.budgetUsagePercent,
    lostImpressionShareBudget: metrics.lostImpressionShareBudget,
    currentAcos7d: metrics.acos7d,
    currentAcos30d: metrics.acos30d,
    targetAcos: metrics.targetAcos,
    acosGapRatio,
    wasGuardClamped: false,
    guardClampReason: null,
    maxBudgetCap: Math.min(
      config.globalMaxBudgetCap,
      metrics.dailyBudget * config.maxBudgetMultiplier
    ),
    recommendedAt: now,
  };

  // ----- Step 1: データ有意性チェック -----
  if (metrics.orders7d < config.minOrdersForDecision) {
    return {
      ...baseRecommendation,
      reasonCode: "INSUFFICIENT_DATA",
      reasonDetail: `判断に必要なデータが不足しています（7日間注文数: ${metrics.orders7d} < ${config.minOrdersForDecision}）`,
    };
  }

  // ----- Step 2: 増額判定 (BOOST) -----
  const boostResult = checkBoostCondition(metrics, config, acosGapRatio);
  if (boostResult.shouldBoost) {
    const rawNewBudget = metrics.dailyBudget * (1 + config.boostPercent / 100);
    const { clampedBudget, wasGuardClamped, guardClampReason } = applyBudgetGuardrails(
      rawNewBudget,
      metrics.dailyBudget,
      config
    );

    // ガードレールでクリップされて変更がない場合
    if (clampedBudget === metrics.dailyBudget) {
      return {
        ...baseRecommendation,
        action: "KEEP",
        reasonCode: "MAX_BUDGET_REACHED",
        reasonDetail: `最大予算上限（${baseRecommendation.maxBudgetCap}円）に到達しているため増額不可`,
        wasGuardClamped,
        guardClampReason,
      };
    }

    return {
      ...baseRecommendation,
      action: "BOOST",
      newBudget: clampedBudget,
      budgetChange: clampedBudget - metrics.dailyBudget,
      budgetChangePercent: ((clampedBudget - metrics.dailyBudget) / metrics.dailyBudget) * 100,
      reasonCode: boostResult.reasonCode,
      reasonDetail: boostResult.reasonDetail,
      wasGuardClamped,
      guardClampReason,
    };
  }

  // ----- Step 3: 減額判定 (CURB) -----
  const curbResult = checkCurbCondition(metrics, config, acosGapRatio);
  if (curbResult.shouldCurb) {
    const rawNewBudget = metrics.dailyBudget * (1 - config.curbPercent / 100);
    const { clampedBudget, wasGuardClamped, guardClampReason } = applyBudgetGuardrails(
      rawNewBudget,
      metrics.dailyBudget,
      config
    );

    // ガードレールでクリップされて変更がない場合
    if (clampedBudget === metrics.dailyBudget) {
      return {
        ...baseRecommendation,
        action: "KEEP",
        reasonCode: "MIN_BUDGET_REACHED",
        reasonDetail: `最小予算下限（${config.minBudget}円）に到達しているため減額不可`,
        wasGuardClamped,
        guardClampReason,
      };
    }

    return {
      ...baseRecommendation,
      action: "CURB",
      newBudget: clampedBudget,
      budgetChange: clampedBudget - metrics.dailyBudget,
      budgetChangePercent: ((clampedBudget - metrics.dailyBudget) / metrics.dailyBudget) * 100,
      reasonCode: curbResult.reasonCode,
      reasonDetail: curbResult.reasonDetail,
      wasGuardClamped,
      guardClampReason,
    };
  }

  // ----- Step 4: 現状維持 (KEEP) -----
  const keepReason = determineKeepReason(metrics, config, acosGapRatio);
  return {
    ...baseRecommendation,
    reasonCode: keepReason.reasonCode,
    reasonDetail: keepReason.reasonDetail,
  };
}

// =============================================================================
// 判定ヘルパー関数
// =============================================================================

interface BoostCheckResult {
  shouldBoost: boolean;
  reasonCode: BudgetReasonCode;
  reasonDetail: string;
}

/**
 * 増額条件をチェック
 *
 * 増額条件（すべて満たす必要がある）:
 * 1. 予算逼迫: budget_usage_percent > 90% OR lost_impression_share_budget > 10%
 * 2. 高パフォーマンス: current_acos < target_acos * 0.9（目標より10%以上良い）
 */
function checkBoostCondition(
  metrics: BudgetMetrics,
  config: BudgetOptimizerConfig,
  acosGapRatio: number | null
): BoostCheckResult {
  const noBoost: BoostCheckResult = {
    shouldBoost: false,
    reasonCode: "BUDGET_AVAILABLE",
    reasonDetail: "",
  };

  // 条件1: 予算逼迫チェック
  const isUsageHigh = metrics.budgetUsagePercent > config.boostUsageThreshold;
  const isLostIsHigh =
    metrics.lostImpressionShareBudget !== null &&
    metrics.lostImpressionShareBudget > config.boostLostIsThreshold;

  if (!isUsageHigh && !isLostIsHigh) {
    return noBoost;
  }

  // 条件2: 高パフォーマンスチェック
  if (acosGapRatio === null || acosGapRatio >= config.boostAcosRatio) {
    return noBoost;
  }

  // 両条件を満たす場合、理由を決定
  if (isLostIsHigh) {
    return {
      shouldBoost: true,
      reasonCode: "HIGH_PERFORMANCE_LOST_IS",
      reasonDetail:
        `高パフォーマンス（ACOS ${((acosGapRatio) * 100).toFixed(0)}% of target）` +
        `かつ予算不足による機会損失が発生（Lost IS Budget: ${metrics.lostImpressionShareBudget?.toFixed(1)}%）`,
    };
  }

  return {
    shouldBoost: true,
    reasonCode: "HIGH_PERFORMANCE_HIGH_USAGE",
    reasonDetail:
      `高パフォーマンス（ACOS ${((acosGapRatio) * 100).toFixed(0)}% of target）` +
      `かつ予算消化率が高い（${metrics.budgetUsagePercent.toFixed(1)}%）`,
  };
}

interface CurbCheckResult {
  shouldCurb: boolean;
  reasonCode: BudgetReasonCode;
  reasonDetail: string;
}

/**
 * 減額条件をチェック
 *
 * 減額条件（すべて満たす必要がある）:
 * 1. 予算余剰: budget_usage_percent < 50% が継続（low_usage_days >= 7）
 * 2. 低パフォーマンス: current_acos > target_acos * 1.5（目標より50%以上悪い）
 */
function checkCurbCondition(
  metrics: BudgetMetrics,
  config: BudgetOptimizerConfig,
  acosGapRatio: number | null
): CurbCheckResult {
  const noCurb: CurbCheckResult = {
    shouldCurb: false,
    reasonCode: "BUDGET_AVAILABLE",
    reasonDetail: "",
  };

  // 条件1: 予算余剰チェック（低消化が継続）
  if (metrics.lowUsageDays < config.curbLowUsageDays) {
    return noCurb;
  }

  // 条件2: 低パフォーマンスチェック
  if (acosGapRatio === null || acosGapRatio <= config.curbAcosRatio) {
    return noCurb;
  }

  return {
    shouldCurb: true,
    reasonCode: "LOW_PERFORMANCE_SURPLUS",
    reasonDetail:
      `低パフォーマンス（ACOS ${((acosGapRatio) * 100).toFixed(0)}% of target）` +
      `かつ予算余剰が継続（${metrics.lowUsageDays}日間消化率50%未満）。余剰予算を回収推奨。`,
  };
}

interface KeepReasonResult {
  reasonCode: BudgetReasonCode;
  reasonDetail: string;
}

/**
 * 現状維持の理由を決定
 */
function determineKeepReason(
  metrics: BudgetMetrics,
  config: BudgetOptimizerConfig,
  acosGapRatio: number | null
): KeepReasonResult {
  // ACOSが目標付近
  if (acosGapRatio !== null && acosGapRatio >= config.boostAcosRatio && acosGapRatio <= config.curbAcosRatio) {
    return {
      reasonCode: "MODERATE_PERFORMANCE",
      reasonDetail: `ACOSが目標付近（${((acosGapRatio) * 100).toFixed(0)}% of target）のため現状維持`,
    };
  }

  // 予算に余裕がある
  if (metrics.budgetUsagePercent <= config.boostUsageThreshold) {
    return {
      reasonCode: "BUDGET_AVAILABLE",
      reasonDetail: `予算消化率（${metrics.budgetUsagePercent.toFixed(1)}%）に余裕があるため現状維持`,
    };
  }

  // デフォルト
  return {
    reasonCode: "MODERATE_PERFORMANCE",
    reasonDetail: "増額・減額の条件を満たさないため現状維持",
  };
}

// =============================================================================
// ガードレール適用
// =============================================================================

interface GuardrailResult {
  clampedBudget: number;
  wasGuardClamped: boolean;
  guardClampReason: string | null;
}

/**
 * 予算ガードレールを適用
 *
 * - 絶対上限額でクリップ
 * - 現在予算の最大倍率でクリップ
 * - 最小予算でクリップ
 */
function applyBudgetGuardrails(
  rawNewBudget: number,
  currentBudget: number,
  config: BudgetOptimizerConfig
): GuardrailResult {
  let clampedBudget = rawNewBudget;
  let wasGuardClamped = false;
  let guardClampReason: string | null = null;

  // 上限チェック
  const effectiveMaxBudget = Math.min(
    config.globalMaxBudgetCap,
    currentBudget * config.maxBudgetMultiplier
  );

  if (clampedBudget > effectiveMaxBudget) {
    clampedBudget = effectiveMaxBudget;
    wasGuardClamped = true;
    guardClampReason = "MAX_BUDGET";
  }

  // 下限チェック
  if (clampedBudget < config.minBudget) {
    clampedBudget = config.minBudget;
    wasGuardClamped = true;
    guardClampReason = "MIN_BUDGET";
  }

  // 整数に丸める（円単位）
  clampedBudget = Math.round(clampedBudget);

  return {
    clampedBudget,
    wasGuardClamped,
    guardClampReason,
  };
}

// =============================================================================
// バッチ処理
// =============================================================================

/**
 * 複数キャンペーンの予算推奨を一括計算
 */
export function computeBudgetRecommendations(
  metricsArray: BudgetMetrics[],
  config: BudgetOptimizerConfig = DEFAULT_BUDGET_OPTIMIZER_CONFIG
): BudgetRecommendation[] {
  return metricsArray.map((metrics) => computeBudgetRecommendation(metrics, config));
}

// =============================================================================
// 統計ヘルパー
// =============================================================================

/**
 * アクション別の件数をカウント
 */
export function countBudgetActions(
  recommendations: BudgetRecommendation[]
): Record<BudgetAction, number> {
  return {
    BOOST: recommendations.filter((r) => r.action === "BOOST").length,
    KEEP: recommendations.filter((r) => r.action === "KEEP").length,
    CURB: recommendations.filter((r) => r.action === "CURB").length,
  };
}

/**
 * 推奨された予算変更の総額を計算
 */
export function calculateTotalBudgetChange(
  recommendations: BudgetRecommendation[]
): { totalIncrease: number; totalDecrease: number; netChange: number } {
  let totalIncrease = 0;
  let totalDecrease = 0;

  for (const rec of recommendations) {
    if (rec.budgetChange > 0) {
      totalIncrease += rec.budgetChange;
    } else if (rec.budgetChange < 0) {
      totalDecrease += Math.abs(rec.budgetChange);
    }
  }

  return {
    totalIncrease,
    totalDecrease,
    netChange: totalIncrease - totalDecrease,
  };
}

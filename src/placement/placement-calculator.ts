/**
 * Placement Calculator - 掲載位置最適化ロジック（純粋関数）
 *
 * Top of Search Impression Share を考慮した入札調整比率の最適化
 *
 * コアコンセプト:
 * ACOSが悪くても、インプレッションシェア（IS）が低い場合は
 * 「まだ1位を取れていないため真のパフォーマンスが不明」と判断し、
 * 安易に入札を下げない（あるいはテスト的に上げる）
 */

import {
  PlacementMetrics,
  PlacementRecommendation,
  PlacementAction,
  PlacementReasonCode,
  PlacementOptimizerConfig,
  DEFAULT_PLACEMENT_OPTIMIZER_CONFIG,
} from "./types";

// =============================================================================
// メイン計算関数
// =============================================================================

/**
 * 単一の掲載位置に対する推奨を計算
 *
 * アルゴリズム詳細:
 *
 * 1. データ有意性の確認
 *    - クリック数が閾値未満の場合は NO_ACTION
 *
 * 2. Top of Search (TOS) の評価ロジック:
 *
 *    パターンA: 勝ちパターン (Strong Performance)
 *    - 条件: TOS ACOS < Target ACOS * 0.9
 *    - アクション: BOOST (Modifier を +10〜20% 加算)
 *    - 目的: 利益が出ているのでさらに露出を強化する
 *
 *    パターンB: オポチュニティ・ジャンプ (Opportunity Jump)
 *    - 条件:
 *      - TOS ACOS > Target ACOS * 1.0（やや悪い〜悪い）
 *      - かつ、TOS Impression Share < 20%（シェアが極端に低い）
 *    - アクション: TEST_BOOST (Modifier を +30〜50% 一時的に加算)
 *    - 理由: 現在は検索結果の3〜4位に表示されており、パフォーマンスが悪い可能性
 *
 *    パターンC: 撤退判断 (True Weakness)
 *    - 条件:
 *      - TOS ACOS > Target ACOS * 1.2（悪い）
 *      - かつ、TOS Impression Share > 50%（既に十分なシェアがある）
 *    - アクション: DECREASE (Modifier を -10〜30% 減算、または 0% にリセット)
 *    - 理由: 1位に近い位置で表示されているにも関わらず結果が出ていない
 *
 * @param metrics - 掲載位置メトリクス
 * @param config - 最適化設定
 * @returns 推奨結果
 */
export function computePlacementRecommendation(
  metrics: PlacementMetrics,
  config: PlacementOptimizerConfig = DEFAULT_PLACEMENT_OPTIMIZER_CONFIG
): PlacementRecommendation {
  const now = new Date();

  // 基本情報を準備
  const baseRecommendation: Omit<PlacementRecommendation, "action" | "newModifier" | "modifierChange" | "reasonCode" | "reasonDetail" | "isOpportunityJump"> = {
    campaignId: metrics.campaignId,
    campaignName: metrics.campaignName,
    placement: metrics.placement,
    oldModifier: metrics.currentBidModifier,
    impressionShare: metrics.topOfSearchImpressionShare,
    currentAcos: metrics.acos30d,
    targetAcos: metrics.targetAcos,
    acosGapRatio: calculateAcosGapRatio(metrics.acos30d, metrics.targetAcos),
    clicks30d: metrics.clicks30d,
    recommendedAt: now,
  };

  // ========================================
  // Step 1: データ有意性の確認
  // ========================================
  if (metrics.clicks30d < config.minClicksForDecision) {
    return {
      ...baseRecommendation,
      action: "NO_ACTION",
      newModifier: metrics.currentBidModifier,
      modifierChange: 0,
      reasonCode: "INSUFFICIENT_DATA",
      reasonDetail: `クリック数不足 (${metrics.clicks30d} < ${config.minClicksForDecision})`,
      isOpportunityJump: false,
    };
  }

  // ========================================
  // Step 2: ACOS が計算できない場合
  // ========================================
  if (metrics.acos30d === null) {
    return {
      ...baseRecommendation,
      action: "NO_ACTION",
      newModifier: metrics.currentBidModifier,
      modifierChange: 0,
      reasonCode: "INSUFFICIENT_DATA",
      reasonDetail: "売上データなし（ACOS計算不可）",
      isOpportunityJump: false,
    };
  }

  // ========================================
  // Step 3: 最大調整比率に到達済みチェック
  // ========================================
  if (metrics.currentBidModifier >= config.maxModifier) {
    return {
      ...baseRecommendation,
      action: "NO_ACTION",
      newModifier: metrics.currentBidModifier,
      modifierChange: 0,
      reasonCode: "MAX_MODIFIER_REACHED",
      reasonDetail: `最大調整比率 (${config.maxModifier}%) に到達済み`,
      isOpportunityJump: false,
    };
  }

  // ACOS ギャップ比率を計算
  const acosGapRatio = metrics.acos30d / metrics.targetAcos;
  const impressionShare = metrics.topOfSearchImpressionShare;

  // ========================================
  // パターンA: 勝ちパターン (Strong Performance)
  // ========================================
  if (acosGapRatio < config.strongPerformanceThreshold) {
    const { newModifier, modifierChange } = calculateNewModifier(
      metrics.currentBidModifier,
      config.boostIncrement,
      config.minModifier,
      config.maxModifier
    );

    return {
      ...baseRecommendation,
      action: "BOOST",
      newModifier,
      modifierChange,
      reasonCode: "STRONG_PERFORMANCE",
      reasonDetail: buildReasonDetail(
        "勝ちパターン",
        metrics.acos30d,
        metrics.targetAcos,
        acosGapRatio,
        impressionShare
      ),
      isOpportunityJump: false,
    };
  }

  // ========================================
  // パターンB: オポチュニティ・ジャンプ (Opportunity Jump)
  // ========================================
  // 条件: ACOS が目標より悪い かつ IS が低い
  if (
    acosGapRatio >= config.opportunityJumpAcosMin &&
    impressionShare !== null &&
    impressionShare < config.opportunityJumpIsMax
  ) {
    // 予算安全装置チェック
    const hasSufficientBudget = checkBudgetSafety(
      metrics.dailyBudget,
      metrics.todaySpend,
      config.budgetSafetyRatio
    );

    if (!hasSufficientBudget) {
      return {
        ...baseRecommendation,
        action: "NO_ACTION",
        newModifier: metrics.currentBidModifier,
        modifierChange: 0,
        reasonCode: "BUDGET_LIMITED",
        reasonDetail: `オポチュニティ・ジャンプ候補だが予算残存率不足（必要: ${config.budgetSafetyRatio * 100}%）`,
        isOpportunityJump: false,
      };
    }

    const { newModifier, modifierChange } = calculateNewModifier(
      metrics.currentBidModifier,
      config.testBoostIncrement,
      config.minModifier,
      config.maxModifier
    );

    return {
      ...baseRecommendation,
      action: "TEST_BOOST",
      newModifier,
      modifierChange,
      reasonCode: "OPPORTUNITY_JUMP",
      reasonDetail: buildReasonDetail(
        "オポチュニティ・ジャンプ（IS低・真のTOSパフォーマンス未確認）",
        metrics.acos30d,
        metrics.targetAcos,
        acosGapRatio,
        impressionShare
      ),
      isOpportunityJump: true,
    };
  }

  // ========================================
  // パターンC: 撤退判断 (True Weakness)
  // ========================================
  // 条件: ACOS が大幅に悪い かつ IS が高い（既に1位付近）
  if (
    acosGapRatio >= config.trueWeaknessAcosThreshold &&
    impressionShare !== null &&
    impressionShare >= config.trueWeaknessIsMin
  ) {
    const { newModifier, modifierChange } = calculateNewModifier(
      metrics.currentBidModifier,
      -config.decreaseDecrement, // 負の値で減少
      config.minModifier,
      config.maxModifier
    );

    return {
      ...baseRecommendation,
      action: "DECREASE",
      newModifier,
      modifierChange,
      reasonCode: "TRUE_WEAKNESS",
      reasonDetail: buildReasonDetail(
        "撤退判断（IS高・真のTOS適性なし）",
        metrics.acos30d,
        metrics.targetAcos,
        acosGapRatio,
        impressionShare
      ),
      isOpportunityJump: false,
    };
  }

  // ========================================
  // パターンD: 現状維持 (Moderate Performance)
  // ========================================
  // 上記のいずれにも該当しない場合
  return {
    ...baseRecommendation,
    action: "NO_ACTION",
    newModifier: metrics.currentBidModifier,
    modifierChange: 0,
    reasonCode: "MODERATE_PERFORMANCE",
    reasonDetail: buildReasonDetail(
      "現状維持（明確な判断基準に該当せず）",
      metrics.acos30d,
      metrics.targetAcos,
      acosGapRatio,
      impressionShare
    ),
    isOpportunityJump: false,
  };
}

/**
 * 複数の掲載位置に対する推奨を一括計算
 *
 * @param metricsArray - 掲載位置メトリクスの配列
 * @param config - 最適化設定
 * @returns 推奨結果の配列
 */
export function computePlacementRecommendations(
  metricsArray: PlacementMetrics[],
  config: PlacementOptimizerConfig = DEFAULT_PLACEMENT_OPTIMIZER_CONFIG
): PlacementRecommendation[] {
  return metricsArray.map((metrics) =>
    computePlacementRecommendation(metrics, config)
  );
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ACOS ギャップ比率を計算
 *
 * @param currentAcos - 現在の ACOS
 * @param targetAcos - 目標 ACOS
 * @returns ACOS ギャップ比率（currentAcos / targetAcos）
 */
function calculateAcosGapRatio(
  currentAcos: number | null,
  targetAcos: number
): number | null {
  if (currentAcos === null || targetAcos <= 0) {
    return null;
  }
  return currentAcos / targetAcos;
}

/**
 * 新しい調整比率を計算
 *
 * @param currentModifier - 現在の調整比率
 * @param change - 変更幅（正で増加、負で減少）
 * @param minModifier - 最小調整比率
 * @param maxModifier - 最大調整比率
 * @returns 新しい調整比率と変更幅
 */
function calculateNewModifier(
  currentModifier: number,
  change: number,
  minModifier: number,
  maxModifier: number
): { newModifier: number; modifierChange: number } {
  let newModifier = currentModifier + change;

  // ガードレール適用
  if (newModifier > maxModifier) {
    newModifier = maxModifier;
  }
  if (newModifier < minModifier) {
    newModifier = minModifier;
  }

  // 整数に丸める
  newModifier = Math.round(newModifier);

  return {
    newModifier,
    modifierChange: newModifier - currentModifier,
  };
}

/**
 * 予算安全装置チェック
 *
 * @param dailyBudget - 日予算
 * @param todaySpend - 本日の消化済み予算
 * @param requiredRatio - 必要な残存率
 * @returns 十分な予算があるかどうか
 */
function checkBudgetSafety(
  dailyBudget: number | null,
  todaySpend: number | null,
  requiredRatio: number
): boolean {
  // 予算情報がない場合は安全側に倒す（テストブースト可能）
  if (dailyBudget === null || dailyBudget <= 0) {
    return true;
  }

  const spend = todaySpend ?? 0;
  const remainingRatio = (dailyBudget - spend) / dailyBudget;

  return remainingRatio >= requiredRatio;
}

/**
 * 理由詳細を構築
 */
function buildReasonDetail(
  pattern: string,
  currentAcos: number,
  targetAcos: number,
  acosGapRatio: number,
  impressionShare: number | null
): string {
  const acosPercent = (currentAcos * 100).toFixed(1);
  const targetPercent = (targetAcos * 100).toFixed(1);
  const gapPercent = (acosGapRatio * 100).toFixed(0);
  const isPercent = impressionShare !== null
    ? `${impressionShare.toFixed(1)}%`
    : "N/A";

  return `${pattern} | ACOS: ${acosPercent}% (目標: ${targetPercent}%, 比率: ${gapPercent}%) | IS: ${isPercent}`;
}

// =============================================================================
// 統計ヘルパー
// =============================================================================

/**
 * 推奨結果からアクション別件数を集計
 */
export function countPlacementActions(
  recommendations: PlacementRecommendation[]
): {
  BOOST: number;
  TEST_BOOST: number;
  DECREASE: number;
  NO_ACTION: number;
} {
  const counts = {
    BOOST: 0,
    TEST_BOOST: 0,
    DECREASE: 0,
    NO_ACTION: 0,
  };

  for (const rec of recommendations) {
    counts[rec.action]++;
  }

  return counts;
}

/**
 * オポチュニティ・ジャンプの件数を集計
 */
export function countOpportunityJumps(
  recommendations: PlacementRecommendation[]
): number {
  return recommendations.filter((rec) => rec.isOpportunityJump).length;
}

/**
 * ライフサイクル状態遷移ロジック
 *
 * 月次の利益とSEOスコアに基づいて、商品のライフサイクルステージを自動で更新する
 * SEO目標順位の進捗も考慮する
 */

import {
  LifecycleStage,
  SeoLevel,
  SeoScoreTrend,
  ProductStrategy,
  MonthlyProfit,
  SeoScore,
  LifecycleTransitionInput,
  LifecycleTransitionResult,
  LifecycleConfig,
  DEFAULT_LIFECYCLE_CONFIG,
} from "./types";
import { logger } from "../logger";
import {
  SeoProgressMetrics,
  RankAdjustmentSuggestion,
} from "../seo/seo-rank-target.types";

// =============================================================================
// SEOレベル判定
// =============================================================================

/**
 * SEOスコアからSEOレベルを判定
 */
export function getSeoLevel(seoScore: number, config: LifecycleConfig): SeoLevel {
  if (seoScore >= config.transition_thresholds.seo_high_threshold) {
    return "HIGH";
  } else if (seoScore >= config.transition_thresholds.seo_mid_threshold) {
    return "MID";
  }
  return "LOW";
}

// =============================================================================
// グローバルセーフティチェック
// =============================================================================

interface SafetyCheckResult {
  forceHarvest: boolean;
  reason: string | null;
  warnings: string[];
}

/**
 * グローバルセーフティ条件をチェック
 * いずれかを満たした場合、強制的にHARVESTへ移行
 */
export function checkGlobalSafety(
  input: LifecycleTransitionInput,
  prevProfits: MonthlyProfit[],
  config: LifecycleConfig
): SafetyCheckResult {
  const { product, monthlyProfit } = input;
  const warnings: string[] = [];
  let forceHarvest = false;
  let reason: string | null = null;

  // 1. 連続赤字チェック
  const consecutiveLossMonths = countConsecutiveLossMonths(prevProfits, monthlyProfit);
  if (consecutiveLossMonths >= config.safety.consecutive_loss_months) {
    const lossLimit = product.invest_max_loss_per_month_jpy || 0;
    // 許容赤字を超える赤字が連続している場合
    const exceededMonths = prevProfits.filter(p =>
      p.net_profit_monthly < -lossLimit
    ).length;

    if (exceededMonths >= config.safety.consecutive_loss_months) {
      forceHarvest = true;
      reason = `連続${config.safety.consecutive_loss_months}ヶ月以上、許容赤字(${lossLimit}円)を超過`;
    }
  }

  // 2. 累積赤字チェック
  const cumulativeLoss = monthlyProfit.net_profit_cumulative || 0;
  if (cumulativeLoss < -input.globalCumulativeLossLimit) {
    forceHarvest = true;
    reason = `累積赤字が上限(${input.globalCumulativeLossLimit}円)を超過: ${cumulativeLoss}円`;
  }

  // 3. レビュー崩壊チェック
  if (product.review_rating !== null && product.review_count !== null) {
    if (
      product.review_rating < config.safety.min_review_rating &&
      product.review_count >= config.safety.min_review_count
    ) {
      forceHarvest = true;
      reason = `レビュー評価が基準(${config.safety.min_review_rating})未満: ${product.review_rating} (${product.review_count}件)`;
    }
  }

  // 警告を追加
  if (consecutiveLossMonths >= 1) {
    warnings.push(`${consecutiveLossMonths}ヶ月連続で赤字`);
  }
  if (cumulativeLoss < 0) {
    warnings.push(`累積損失: ${cumulativeLoss}円`);
  }

  return { forceHarvest, reason, warnings };
}

/**
 * 連続赤字月数をカウント
 */
function countConsecutiveLossMonths(
  prevProfits: MonthlyProfit[],
  currentProfit: MonthlyProfit
): number {
  let count = 0;

  // 現在月から逆順にチェック
  if (currentProfit.net_profit_monthly < 0) {
    count++;
    // 過去のデータを新しい順にソート
    const sorted = [...prevProfits].sort((a, b) =>
      b.year_month.localeCompare(a.year_month)
    );
    for (const profit of sorted) {
      if (profit.net_profit_monthly < 0) {
        count++;
      } else {
        break;
      }
    }
  }

  return count;
}

// =============================================================================
// 投資期間延長判定
// =============================================================================

interface ExtensionResult {
  extend: boolean;
  newDynamicMonths: number | null;
  reason: string | null;
}

/**
 * 投資期間の自動延長を判定
 */
export function checkInvestmentExtension(
  input: LifecycleTransitionInput,
  seoLevel: SeoLevel,
  config: LifecycleConfig
): ExtensionResult {
  const { product, monthlyProfit, seoScore } = input;

  // LAUNCH_HARD または LAUNCH_SOFT の場合のみ延長可能
  if (
    product.lifecycle_stage !== "LAUNCH_HARD" &&
    product.lifecycle_stage !== "LAUNCH_SOFT"
  ) {
    return { extend: false, newDynamicMonths: null, reason: null };
  }

  const currentDynamic = product.invest_max_months_dynamic || product.invest_max_months_base || 0;

  // 既に上限に達している場合は延長不可
  if (currentDynamic >= config.invest_months.max_dynamic) {
    return { extend: false, newDynamicMonths: null, reason: "既に最大延長期間に達しています" };
  }

  // 延長条件チェック
  const conditions: boolean[] = [];
  const reasons: string[] = [];

  // 条件1: SEOトレンドがUPまたはFLAT
  const trendOk = seoScore.seo_score_trend === "UP" || seoScore.seo_score_trend === "FLAT";
  conditions.push(trendOk);
  if (trendOk) reasons.push("SEOトレンド良好");

  // 条件2: 赤字が許容範囲の70%以内
  const lossLimit = product.invest_max_loss_per_month_jpy || 0;
  const actualLoss = Math.min(0, monthlyProfit.net_profit_monthly);
  const lossOk = actualLoss >= -lossLimit * config.extension.loss_tolerance_ratio;
  conditions.push(lossOk);
  if (lossOk) reasons.push("赤字が許容範囲内");

  // 条件3: TACOSがinvest_tacos_cap以下
  const tacosCap = product.invest_tacos_cap || 0;
  const tacosOk = (monthlyProfit.tacos_monthly || 0) <= tacosCap;
  conditions.push(tacosOk);
  if (tacosOk) reasons.push("TACOSが上限以下");

  // 全条件を満たした場合のみ延長
  if (conditions.every(c => c)) {
    return {
      extend: true,
      newDynamicMonths: currentDynamic + 1,
      reason: reasons.join(", "),
    };
  }

  return { extend: false, newDynamicMonths: null, reason: null };
}

// =============================================================================
// ステージ別遷移判定
// =============================================================================

/**
 * LAUNCH_HARD からの遷移判定
 */
function evaluateLaunchHardTransition(
  input: LifecycleTransitionInput,
  seoLevel: SeoLevel,
  config: LifecycleConfig
): { stage: LifecycleStage; reason: string } {
  const { product, monthlyProfit, seoScore } = input;
  const tacosCap = product.invest_tacos_cap || config.tacos_caps.LAUNCH_HARD;
  const lossLimit = product.invest_max_loss_per_month_jpy || 0;
  const maxMonths = product.invest_max_months_dynamic || product.invest_max_months_base || config.invest_months.LAUNCH_HARD;
  const monthsSinceLaunch = monthlyProfit.months_since_launch || 0;
  const tacos = monthlyProfit.tacos_monthly || 0;
  const trend = seoScore.seo_score_trend;

  // 継続条件チェック
  const withinPeriod = monthsSinceLaunch <= maxMonths;
  const tacosOk = tacos <= tacosCap * config.transition_thresholds.tacos_exceed_multiplier;
  const lossOk = monthlyProfit.net_profit_monthly >= -lossLimit;
  const seoNotHigh = seoLevel === "LOW" || seoLevel === "MID";
  const trendOk = trend === "UP" || trend === "FLAT";

  // 継続条件を全て満たす → LAUNCH_HARD維持
  if (withinPeriod && tacosOk && lossOk && seoNotHigh && trendOk) {
    return { stage: "LAUNCH_HARD", reason: "継続条件を満たす" };
  }

  // GROW直接移行条件
  if (
    monthsSinceLaunch > maxMonths &&
    seoLevel === "HIGH" &&
    tacos <= product.sustainable_tacos * config.transition_thresholds.sustainable_tacos_multiplier &&
    monthlyProfit.net_profit_monthly >= 0
  ) {
    return { stage: "GROW", reason: "投資期間完了・SEO HIGH・黒字化達成" };
  }

  // LAUNCH_SOFT降格条件
  if (
    (seoLevel === "MID" || seoLevel === "HIGH") && (trend === "FLAT" || trend === "DOWN") ||
    tacos > tacosCap * config.transition_thresholds.tacos_exceed_multiplier ||
    monthlyProfit.net_profit_monthly < -lossLimit
  ) {
    return { stage: "LAUNCH_SOFT", reason: "TACOS超過または赤字超過またはSEO改善停滞" };
  }

  // 期間超過時
  if (monthsSinceLaunch > maxMonths) {
    if (seoLevel === "LOW") {
      return { stage: "HARVEST", reason: "投資期間超過・SEOランク未達成" };
    }
    return { stage: "LAUNCH_SOFT", reason: "投資期間超過・継続投資" };
  }

  return { stage: "LAUNCH_HARD", reason: "デフォルト継続" };
}

/**
 * LAUNCH_SOFT からの遷移判定
 */
function evaluateLaunchSoftTransition(
  input: LifecycleTransitionInput,
  seoLevel: SeoLevel,
  config: LifecycleConfig
): { stage: LifecycleStage; reason: string } {
  const { product, monthlyProfit, seoScore } = input;
  const tacosCap = product.invest_tacos_cap || config.tacos_caps.LAUNCH_SOFT;
  const lossLimit = product.invest_max_loss_per_month_jpy || 0;
  const maxMonths = product.invest_max_months_dynamic || product.invest_max_months_base || config.invest_months.LAUNCH_SOFT;
  const monthsSinceLaunch = monthlyProfit.months_since_launch || 0;
  const tacos = monthlyProfit.tacos_monthly || 0;
  const trend = seoScore.seo_score_trend;

  // LAUNCH_HARD再昇格条件
  if (
    seoLevel === "LOW" &&
    (trend === "UP" || trend === "FLAT") &&
    tacos <= tacosCap * config.transition_thresholds.tacos_good_multiplier &&
    monthlyProfit.net_profit_monthly >= -lossLimit * config.transition_thresholds.loss_tolerance_multiplier
  ) {
    return { stage: "LAUNCH_HARD", reason: "SEO LOW維持・TACOS良好・投資余力あり → 再攻め" };
  }

  // GROW移行条件
  if (
    seoLevel === "HIGH" &&
    (trend === "FLAT" || trend === "UP") &&
    tacos >= product.sustainable_tacos &&
    tacos <= tacosCap &&
    monthlyProfit.net_profit_monthly >= 0
  ) {
    return { stage: "GROW", reason: "SEO HIGH達成・黒字化 → 安定運用へ" };
  }

  // HARVEST移行条件
  if (
    monthsSinceLaunch > maxMonths &&
    seoLevel === "LOW" &&
    (monthlyProfit.net_profit_cumulative || 0) < 0
  ) {
    return { stage: "HARVEST", reason: "投資期間超過・SEO未達成・累積赤字 → 撤退" };
  }

  // 継続条件
  const withinPeriod = monthsSinceLaunch <= maxMonths;
  const tacosOk = tacos <= tacosCap * 1.05;
  const lossOk = monthlyProfit.net_profit_monthly >= -lossLimit;
  const trendOk = trend === "UP" || trend === "FLAT";

  if (withinPeriod && tacosOk && lossOk && (seoLevel === "LOW" || seoLevel === "MID") && trendOk) {
    return { stage: "LAUNCH_SOFT", reason: "継続条件を満たす" };
  }

  return { stage: "LAUNCH_SOFT", reason: "デフォルト継続" };
}

/**
 * GROW からの遷移判定
 */
function evaluateGrowTransition(
  input: LifecycleTransitionInput,
  seoLevel: SeoLevel,
  config: LifecycleConfig
): { stage: LifecycleStage; reason: string } {
  const { product, monthlyProfit, seoScore } = input;
  const sustainableTacos = product.sustainable_tacos;
  const tacos = monthlyProfit.tacos_monthly || 0;
  const trend = seoScore.seo_score_trend;

  // HARVEST移行条件
  if (
    seoLevel === "HIGH" &&
    (trend === "FLAT" || trend === "UP") &&
    tacos <= sustainableTacos &&
    monthlyProfit.net_profit_monthly >= 0
  ) {
    return { stage: "HARVEST", reason: "SEO安定・効率良好 → 利益回収へ" };
  }

  // LAUNCH_SOFT再投資条件
  if (
    product.reinvest_allowed &&
    seoLevel === "MID" &&
    trend === "DOWN" &&
    monthlyProfit.net_profit_monthly >= 0
  ) {
    return { stage: "LAUNCH_SOFT", reason: "SEO低下・再投資許可あり → 再投資" };
  }

  // 継続条件
  const seoOk = seoLevel === "MID" || seoLevel === "HIGH";
  const trendOk = trend !== "DOWN";
  const tacosOk = tacos >= sustainableTacos * 0.8 && tacos <= sustainableTacos * 1.2;
  const profitOk = monthlyProfit.net_profit_monthly >= 0;

  if (seoOk && trendOk && tacosOk && profitOk) {
    return { stage: "GROW", reason: "継続条件を満たす" };
  }

  // 悪化時はHARVESTへ
  if (!profitOk || tacos > sustainableTacos * 1.5) {
    return { stage: "HARVEST", reason: "収益悪化 → 利益回収へ" };
  }

  return { stage: "GROW", reason: "デフォルト継続" };
}

/**
 * HARVEST からの遷移判定
 * 基本的には維持。自動での再投資はしない方針。
 */
function evaluateHarvestTransition(
  input: LifecycleTransitionInput,
  seoLevel: SeoLevel,
  _config: LifecycleConfig
): { stage: LifecycleStage; reason: string } {
  const { monthlyProfit } = input;

  // 継続条件
  const profitOk = monthlyProfit.net_profit_monthly >= 0;
  const seoOk = seoLevel === "MID" || seoLevel === "HIGH";

  if (profitOk && seoOk) {
    return { stage: "HARVEST", reason: "利益回収継続" };
  }

  // 赤字化しても基本はHARVEST維持（手動介入が必要）
  return { stage: "HARVEST", reason: "HARVEST維持（要手動確認）" };
}

// =============================================================================
// メイン遷移判定関数
// =============================================================================

/**
 * ライフサイクル遷移を判定
 */
export function evaluateLifecycleTransition(
  input: LifecycleTransitionInput,
  prevProfits: MonthlyProfit[] = [],
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): LifecycleTransitionResult {
  const { product, seoScore } = input;
  const currentStage = product.lifecycle_stage;
  const seoLevel = getSeoLevel(seoScore.seo_score, config);

  logger.info("Evaluating lifecycle transition", {
    product_id: product.product_id,
    current_stage: currentStage,
    seo_score: seoScore.seo_score,
    seo_level: seoLevel,
    seo_trend: seoScore.seo_score_trend,
  });

  // グローバルセーフティチェック
  const safetyResult = checkGlobalSafety(input, prevProfits, config);
  if (safetyResult.forceHarvest) {
    logger.warn("Force HARVEST due to safety violation", {
      product_id: product.product_id,
      reason: safetyResult.reason,
    });
    return {
      product_id: product.product_id,
      current_stage: currentStage,
      recommended_stage: "HARVEST",
      should_transition: currentStage !== "HARVEST",
      transition_reason: safetyResult.reason || "安全条件違反",
      extend_investment: false,
      new_invest_max_months_dynamic: null,
      extension_reason: null,
      warnings: safetyResult.warnings,
      force_harvest: true,
      force_harvest_reason: safetyResult.reason,
    };
  }

  // 投資期間延長チェック
  const extensionResult = checkInvestmentExtension(input, seoLevel, config);

  // ステージ別の遷移判定
  let transition: { stage: LifecycleStage; reason: string };

  switch (currentStage) {
    case "LAUNCH_HARD":
      transition = evaluateLaunchHardTransition(input, seoLevel, config);
      break;
    case "LAUNCH_SOFT":
      transition = evaluateLaunchSoftTransition(input, seoLevel, config);
      break;
    case "GROW":
      transition = evaluateGrowTransition(input, seoLevel, config);
      break;
    case "HARVEST":
      transition = evaluateHarvestTransition(input, seoLevel, config);
      break;
    default:
      transition = { stage: currentStage, reason: "不明なステージ" };
  }

  const shouldTransition = transition.stage !== currentStage;

  logger.info("Lifecycle transition evaluated", {
    product_id: product.product_id,
    current_stage: currentStage,
    recommended_stage: transition.stage,
    should_transition: shouldTransition,
    reason: transition.reason,
    extend_investment: extensionResult.extend,
  });

  return {
    product_id: product.product_id,
    current_stage: currentStage,
    recommended_stage: transition.stage,
    should_transition: shouldTransition,
    transition_reason: transition.reason,
    extend_investment: extensionResult.extend,
    new_invest_max_months_dynamic: extensionResult.newDynamicMonths,
    extension_reason: extensionResult.reason,
    warnings: safetyResult.warnings,
    force_harvest: false,
    force_harvest_reason: null,
  };
}

// =============================================================================
// SEO目標順位進捗を考慮したライフサイクル判定拡張
// =============================================================================

/**
 * SEO目標順位進捗を考慮したライフサイクル遷移入力
 */
export interface LifecycleTransitionInputWithSeoProgress extends LifecycleTransitionInput {
  /** クラスタ単位のSEO進捗メトリクス（オプション） */
  clusterSeoProgressMetrics?: Map<string, SeoProgressMetrics>;
  /** 目標順位ダウン提案（オプション） */
  rankAdjustmentSuggestions?: RankAdjustmentSuggestion[];
}

/**
 * SEO目標順位進捗を考慮したライフサイクル遷移結果
 */
export interface LifecycleTransitionResultWithSeoProgress extends LifecycleTransitionResult {
  /** SEO目標順位に関する追加警告 */
  seoRankWarnings: string[];
  /** targetRank変更を検討すべきかのシグナル */
  shouldConsiderTargetRankChange: boolean;
  /** 関連するRankAdjustmentSuggestion */
  relatedRankSuggestions: RankAdjustmentSuggestion[];
}

/**
 * SEO目標順位進捗からの警告を生成
 *
 * LAUNCH_HARD, LAUNCH_SOFTで以下の状況の場合にシグナルを出す:
 * - seoProgressScoreが低いまま
 * - 累積損失が上限に近づいている
 * - RankAdjustmentSuggestion.UNREALISTIC_FOR_IDEALが発生している
 *
 * @param input - 拡張入力
 * @param currentStage - 現在のライフサイクルステージ
 * @returns 警告とシグナル
 */
export function evaluateSeoRankProgressWarnings(
  input: LifecycleTransitionInputWithSeoProgress,
  currentStage: LifecycleStage
): {
  warnings: string[];
  shouldConsiderTargetRankChange: boolean;
  relatedSuggestions: RankAdjustmentSuggestion[];
} {
  const warnings: string[] = [];
  let shouldConsiderTargetRankChange = false;
  const relatedSuggestions: RankAdjustmentSuggestion[] = [];

  // LAUNCH_HARD, LAUNCH_SOFTの場合のみ詳細評価
  if (currentStage !== "LAUNCH_HARD" && currentStage !== "LAUNCH_SOFT") {
    return { warnings, shouldConsiderTargetRankChange, relatedSuggestions };
  }

  const { clusterSeoProgressMetrics, rankAdjustmentSuggestions, monthlyProfit } = input;

  // RankAdjustmentSuggestionがある場合
  if (rankAdjustmentSuggestions && rankAdjustmentSuggestions.length > 0) {
    const unrealisticSuggestions = rankAdjustmentSuggestions.filter(
      (s) => s.reasonCode === "UNREALISTIC_FOR_IDEAL"
    );

    if (unrealisticSuggestions.length > 0) {
      relatedSuggestions.push(...unrealisticSuggestions);
      shouldConsiderTargetRankChange = true;
      warnings.push(
        `${unrealisticSuggestions.length}件のクラスタで目標順位の見直しが提案されています`
      );
    }
  }

  // クラスタ単位のSEO進捗が全体的に低い場合
  if (clusterSeoProgressMetrics && clusterSeoProgressMetrics.size > 0) {
    const metrics = Array.from(clusterSeoProgressMetrics.values());
    const avgSeoProgressScore =
      metrics.reduce((sum, m) => sum + m.seoProgressScore, 0) / metrics.length;

    if (avgSeoProgressScore < 0.7) {
      warnings.push(
        `全クラスタ平均のSEO進捗スコアが低い（${avgSeoProgressScore.toFixed(2)}）`
      );
    }

    // 進捗スコアが低く、累積赤字も大きい場合
    const cumulativeLoss = monthlyProfit.net_profit_cumulative || 0;
    if (avgSeoProgressScore < 0.7 && cumulativeLoss < 0) {
      shouldConsiderTargetRankChange = true;
      warnings.push(
        `SEO進捗が低調で累積赤字（${cumulativeLoss}円）も発生しています。` +
          `今回のセールサイクルでは1位を狙わず、targetRankを下げることを検討してください`
      );
    }
  }

  return { warnings, shouldConsiderTargetRankChange, relatedSuggestions };
}

/**
 * SEO目標順位進捗を考慮したライフサイクル遷移を判定
 *
 * 既存のevaluateLifecycleTransitionに加えて、SEO進捗の警告を追加
 *
 * @param input - 拡張入力
 * @param prevProfits - 過去の月次利益データ
 * @param config - ライフサイクル設定
 * @returns 拡張結果
 */
export function evaluateLifecycleTransitionWithSeoProgress(
  input: LifecycleTransitionInputWithSeoProgress,
  prevProfits: MonthlyProfit[] = [],
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): LifecycleTransitionResultWithSeoProgress {
  // 基本のライフサイクル遷移判定
  const baseResult = evaluateLifecycleTransition(input, prevProfits, config);

  // SEO目標順位進捗の評価
  const seoRankEvaluation = evaluateSeoRankProgressWarnings(
    input,
    input.product.lifecycle_stage
  );

  // 警告をマージ
  const allWarnings = [
    ...baseResult.warnings,
    ...seoRankEvaluation.warnings,
  ];

  logger.info("Lifecycle transition with SEO progress evaluated", {
    product_id: input.product.product_id,
    current_stage: input.product.lifecycle_stage,
    recommended_stage: baseResult.recommended_stage,
    seo_rank_warnings_count: seoRankEvaluation.warnings.length,
    should_consider_target_rank_change: seoRankEvaluation.shouldConsiderTargetRankChange,
    related_rank_suggestions_count: seoRankEvaluation.relatedSuggestions.length,
  });

  return {
    ...baseResult,
    warnings: allWarnings,
    seoRankWarnings: seoRankEvaluation.warnings,
    shouldConsiderTargetRankChange: seoRankEvaluation.shouldConsiderTargetRankChange,
    relatedRankSuggestions: seoRankEvaluation.relatedSuggestions,
  };
}

// =============================================================================
// SEOローンチ終了判定との統合
// =============================================================================

import {
  LaunchExitDecision,
  LaunchExitReasonCode,
  AsinSeoLaunchProgress,
  decideLaunchExit,
  LaunchExitThresholds,
  DEFAULT_LAUNCH_EXIT_THRESHOLDS,
  isLaunchStage,
} from "./seo-launch-evaluator";
import { AsinLossBudgetMetrics } from "../analytics/lossBudgetEvaluator";

// =============================================================================
// ライフサイクル遷移判定（LAUNCH終了用）
// =============================================================================

/**
 * ライフサイクル遷移判定結果
 *
 * LaunchExitDecisionと現在のライフサイクルステージから、
 * 次のステージを決定するための純粋ロジック層の結果型。
 */
export interface LifecycleTransitionDecision {
  /** ASIN */
  asin: string;
  /** 遷移元のステージ */
  from: LifecycleStage;
  /** 遷移先のステージ */
  to: LifecycleStage;
  /** 緊急終了かどうか（lossBudget超過等） */
  isEmergency: boolean;
  /** 遷移理由コード */
  reasonCodes: LaunchExitReasonCode[];
  /** 遷移理由の詳細メッセージ */
  reasonMessage: string;
}

/**
 * LaunchExitDecisionと現在のライフサイクルステージから、次のステージを決定する
 *
 * この関数は純粋なロジック層として、BigQueryや外部I/Oは行わず、
 * 「ステージ遷移の決定」だけに責務を限定する。
 *
 * @param asin - ASIN
 * @param currentStage - 現在のライフサイクルステージ
 * @param launchExitDecision - LAUNCH終了判定結果（nullの場合は遷移なし）
 * @returns LifecycleTransitionDecision（遷移がない場合はnull）
 */
export function decideNextLifecycleStageForAsin(
  asin: string,
  currentStage: LifecycleStage,
  launchExitDecision: LaunchExitDecision | null
): LifecycleTransitionDecision | null {
  // 1. currentStage が "LAUNCH_HARD" でも "LAUNCH_SOFT" でもない場合
  //    → 常に null を返す（この関数では遷移なし）
  if (!isLaunchStage(currentStage)) {
    return null;
  }

  // 2. launchExitDecision が null、または shouldExitLaunch が false の場合
  //    → null を返す（LAUNCH 継続）
  if (launchExitDecision === null || !launchExitDecision.shouldExitLaunch) {
    return null;
  }

  // 3. shouldExitLaunch が true の場合
  //    → GROW への遷移を返す
  return {
    asin,
    from: currentStage,
    to: launchExitDecision.recommendedNextStage,
    isEmergency: launchExitDecision.isEmergencyExit,
    reasonCodes: launchExitDecision.reasonCodes,
    reasonMessage: launchExitDecision.reasonMessage,
  };
}

/**
 * SEOローンチ終了判定を含むライフサイクル遷移入力
 */
export interface LifecycleTransitionInputWithSeoLaunch extends LifecycleTransitionInput {
  /** ローンチ開始からの日数 */
  daysSinceLaunch: number;
  /** ASIN累計クリック */
  asinClicksTotal: number;
  /** ASIN累計注文 */
  asinOrdersTotal: number;
  /** ASIN SEOローンチ進捗 */
  seoLaunchProgress: AsinSeoLaunchProgress;
  /** lossBudget評価結果（オプション） */
  lossBudgetMetrics?: AsinLossBudgetMetrics;
  /** ローンチ終了判定閾値（オプション） */
  launchExitThresholds?: LaunchExitThresholds;
}

/**
 * SEOローンチ終了判定を含むライフサイクル遷移結果
 */
export interface LifecycleTransitionResultWithSeoLaunch extends LifecycleTransitionResult {
  /** SEOローンチ終了判定 */
  launchExitDecision: LaunchExitDecision | null;
  /** SEOローンチに基づくステージ移行が必要か */
  shouldTransitionBySeoLaunch: boolean;
  /** lossBudgetによる緊急終了か */
  isEmergencyExit: boolean;
}

/**
 * SEOローンチ終了判定を統合したライフサイクル遷移を評価
 *
 * LAUNCH期のASINについて、コアSEOキーワードの進捗とlossBudgetを考慮して
 * GROWへの移行タイミングを判定する。
 *
 * @param input - SEOローンチ情報を含む遷移入力
 * @param prevProfits - 過去の月次利益データ
 * @param config - ライフサイクル設定
 * @returns SEOローンチ終了判定を含む遷移結果
 */
export function evaluateLifecycleTransitionWithSeoLaunch(
  input: LifecycleTransitionInputWithSeoLaunch,
  prevProfits: MonthlyProfit[] = [],
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): LifecycleTransitionResultWithSeoLaunch {
  const { product, daysSinceLaunch, asinClicksTotal, asinOrdersTotal, seoLaunchProgress, lossBudgetMetrics } = input;
  const currentStage = product.lifecycle_stage;

  // 基本のライフサイクル遷移判定
  const baseResult = evaluateLifecycleTransition(input, prevProfits, config);

  // LAUNCH期でない場合はSEOローンチ判定は不要
  if (!isLaunchStage(currentStage)) {
    return {
      ...baseResult,
      launchExitDecision: null,
      shouldTransitionBySeoLaunch: false,
      isEmergencyExit: false,
    };
  }

  // SEOローンチ終了判定
  const thresholds = input.launchExitThresholds ?? DEFAULT_LAUNCH_EXIT_THRESHOLDS;
  const launchExitDecision = decideLaunchExit(
    product.product_id,
    currentStage,
    daysSinceLaunch,
    asinClicksTotal,
    asinOrdersTotal,
    seoLaunchProgress,
    lossBudgetMetrics ?? null,
    thresholds
  );

  // SEOローンチ判定で終了すべき場合
  if (launchExitDecision.shouldExitLaunch) {
    const isEmergency = launchExitDecision.isEmergencyExit;
    const nextStage = launchExitDecision.recommendedNextStage;

    logger.info("SEO launch exit decision triggered", {
      product_id: product.product_id,
      current_stage: currentStage,
      recommended_next_stage: nextStage,
      is_emergency: isEmergency,
      reason_codes: launchExitDecision.reasonCodes,
      completion_ratio: seoLaunchProgress.completionRatio,
    });

    // 基本判定とSEOローンチ判定をマージ
    // SEOローンチ終了がトリガーされた場合、そちらを優先
    const finalRecommendedStage = nextStage;
    const shouldTransition = finalRecommendedStage !== currentStage;

    // 緊急終了の場合は警告を追加
    const allWarnings = [...baseResult.warnings];
    if (isEmergency) {
      allWarnings.push(`[緊急終了] ${launchExitDecision.reasonMessage}`);
    } else {
      allWarnings.push(`[SEOローンチ完了] ${launchExitDecision.reasonMessage}`);
    }

    return {
      ...baseResult,
      recommended_stage: finalRecommendedStage,
      should_transition: shouldTransition,
      transition_reason: launchExitDecision.reasonMessage,
      warnings: allWarnings,
      launchExitDecision,
      shouldTransitionBySeoLaunch: true,
      isEmergencyExit: isEmergency,
    };
  }

  // SEOローンチ継続
  return {
    ...baseResult,
    launchExitDecision,
    shouldTransitionBySeoLaunch: false,
    isEmergencyExit: false,
  };
}

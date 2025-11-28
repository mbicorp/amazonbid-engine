/**
 * ライフサイクル自動サジェストロジック
 *
 * SEO順位トレンド、ACOS、CVR、在庫日数などを使って
 * ライフサイクルステートの推奨値を計算する
 *
 * また、LAUNCH_HARD / LAUNCH_SOFT の ASIN について、
 * SEOローンチ評価（seo-launch-evaluator）と遷移ロジック（transition-logic）を
 * 呼び出し、GROW への移行判定を行う。
 */

import { LifecycleState, ProductConfig } from "../ltv/types";
import { SeoMetrics } from "../seo/types";
import { getTargetAcos } from "../ltv/ltv-calculator";
import { ExecutionMode } from "../logging/types";
import {
  evaluateLaunchExitForAsin,
  EvaluateLaunchExitForAsinParams,
  EvaluateLaunchExitForAsinResult,
  AsinSeoLaunchProgress,
  LaunchExitBaseThresholds,
  DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
  LaunchExitReasonCode,
  isLaunchStage,
} from "./seo-launch-evaluator";
import {
  decideNextLifecycleStageForAsin,
  LifecycleTransitionDecision,
} from "./transition-logic";
import { AsinLossBudgetMetrics } from "../analytics/lossBudgetEvaluator";

// =============================================================================
// 定数
// =============================================================================

/**
 * ライフサイクルサジェスト判定用の定数
 */
export const SUGGESTION_CONSTANTS = {
  // 順位ゾーン閾値
  MID_ZONE_MIN: 8,
  MID_ZONE_MAX: 20,

  // レビュー数閾値
  LOW_REVIEW_THRESHOLD: 20,

  // 在庫日数閾値
  LOW_INVENTORY_DAYS: 10,
  STABLE_INVENTORY_DAYS: 20,

  // ACOS許容範囲（target_acos ±20%）
  ACOS_TOLERANCE_RATIO: 0.2,

  // ACOS悪化閾値（target_acosの1.3倍以上で悪化とみなす）
  ACOS_BAD_MULTIPLIER: 1.3,

  // CVR判定の最低閾値
  MIN_CVR_FOR_LAUNCH: 0.005, // 0.5%以上あれば「そこまで悪くない」
} as const;

// =============================================================================
// 型定義
// =============================================================================

/**
 * ライフサイクルサジェスト計算の入力
 */
export interface LifecycleSuggestionInput {
  product: ProductConfig;
  seo: SeoMetrics;
  acosRecent: number | null;           // 最近のACOS（例: 30日）
  cvrRecent: number | null;            // 最近のCVR
  cvrCategoryAvg: number | null;       // 同カテゴリ平均CVR
  reviewCount: number | null;
  avgRating: number | null;
  daysOfInventory: number | null;      // 在庫日数
  isBeforeBigSale: boolean;            // セール前14日内フラグ
}

/**
 * ライフサイクルサジェスト計算の結果
 */
export interface LifecycleSuggestionResult {
  suggestedState: LifecycleState;
  reason: string;
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ACOSがターゲット許容範囲内かどうか判定
 */
function isAcosWithinTolerance(
  acosRecent: number,
  targetAcos: number
): boolean {
  const tolerance = targetAcos * SUGGESTION_CONSTANTS.ACOS_TOLERANCE_RATIO;
  return (
    acosRecent >= targetAcos - tolerance &&
    acosRecent <= targetAcos + tolerance
  );
}

/**
 * ACOSが大幅に悪化しているか判定
 */
function isAcosBad(acosRecent: number, targetAcos: number): boolean {
  return acosRecent > targetAcos * SUGGESTION_CONSTANTS.ACOS_BAD_MULTIPLIER;
}

// =============================================================================
// HARVEST判定
// =============================================================================

interface HarvestCheckResult {
  isHarvest: boolean;
  reasons: string[];
}

/**
 * HARVEST推奨条件をチェック
 */
function checkHarvestConditions(
  input: LifecycleSuggestionInput,
  targetAcos: number
): HarvestCheckResult {
  const reasons: string[] = [];

  // 1. 在庫が少ない
  if (
    input.daysOfInventory !== null &&
    input.daysOfInventory < SUGGESTION_CONSTANTS.LOW_INVENTORY_DAYS
  ) {
    reasons.push(
      `在庫日数が少ない（${input.daysOfInventory}日）ためHARVEST推奨`
    );
  }

  // 2. ACOSが大幅に悪化
  if (input.acosRecent !== null && isAcosBad(input.acosRecent, targetAcos)) {
    const acosPercent = (input.acosRecent * 100).toFixed(1);
    const targetPercent = (targetAcos * 100).toFixed(1);
    reasons.push(
      `ACOSが${acosPercent}%でtarget_acos(${targetPercent}%)を大きく超過しているためHARVEST推奨`
    );
  }

  // 3. SEO順位が下降トレンド（上位帯から落ちている）
  if (
    input.seo.rankStatus === "DOWN" &&
    (input.seo.rankZone === "TOP_ZONE" || input.seo.rankZone === "MID_ZONE")
  ) {
    reasons.push(
      `SEO順位が下降トレンド（${input.seo.rankZone}）のためHARVEST推奨`
    );
  }

  return {
    isHarvest: reasons.length > 0,
    reasons,
  };
}

// =============================================================================
// LAUNCH_HARD判定
// =============================================================================

interface LaunchHardCheckResult {
  isLaunchHard: boolean;
  reasons: string[];
}

/**
 * LAUNCH_HARD推奨条件をチェック
 */
function checkLaunchHardConditions(
  input: LifecycleSuggestionInput
): LaunchHardCheckResult {
  const reasons: string[] = [];

  // 1. SEO順位が上昇トレンドでMID_ZONEにいる
  if (
    input.seo.rankStatus === "UP" &&
    input.seo.rankZone === "MID_ZONE"
  ) {
    reasons.push(
      `SEO順位が上昇トレンドでMID_ZONE（${input.seo.currentRank}位）にいるためLAUNCH_HARD推奨`
    );
  }

  // 2. 順位は低いがCVRがカテゴリ平均以上
  if (
    input.seo.currentRank !== null &&
    input.seo.currentRank >= 20 &&
    input.cvrRecent !== null &&
    input.cvrCategoryAvg !== null &&
    input.cvrRecent >= input.cvrCategoryAvg
  ) {
    const cvrPercent = (input.cvrRecent * 100).toFixed(2);
    const avgPercent = (input.cvrCategoryAvg * 100).toFixed(2);
    reasons.push(
      `CVR(${cvrPercent}%)がカテゴリ平均(${avgPercent}%)以上かつ順位が低いため攻めどき（LAUNCH_HARD推奨）`
    );
  }

  // 3. セール前
  if (input.isBeforeBigSale) {
    reasons.push(`セール前のためLAUNCH_HARD推奨`);
  }

  // 4. レビュー数が少ないがCVRはそこまで悪くない
  if (
    input.reviewCount !== null &&
    input.reviewCount < SUGGESTION_CONSTANTS.LOW_REVIEW_THRESHOLD &&
    input.cvrRecent !== null &&
    input.cvrRecent >= SUGGESTION_CONSTANTS.MIN_CVR_FOR_LAUNCH
  ) {
    const cvrPercent = (input.cvrRecent * 100).toFixed(2);
    reasons.push(
      `レビュー数が少ない（${input.reviewCount}件）がCVR(${cvrPercent}%)に伸びしろがあるためLAUNCH_HARD推奨`
    );
  }

  return {
    isLaunchHard: reasons.length > 0,
    reasons,
  };
}

// =============================================================================
// GROW判定
// =============================================================================

interface GrowCheckResult {
  isGrow: boolean;
  reasons: string[];
}

/**
 * GROW推奨条件をチェック
 */
function checkGrowConditions(
  input: LifecycleSuggestionInput,
  targetAcos: number
): GrowCheckResult {
  const reasons: string[] = [];

  // 条件を全て満たす必要がある
  const conditions = {
    // SEOが上位帯で安定
    seoStable:
      (input.seo.rankZone === "TOP_ZONE" || input.seo.rankZone === "MID_ZONE") &&
      (input.seo.rankStatus === "FLAT" || input.seo.rankStatus === "UNKNOWN"),

    // 在庫が十分
    inventoryStable:
      input.daysOfInventory === null ||
      input.daysOfInventory >= SUGGESTION_CONSTANTS.STABLE_INVENTORY_DAYS,

    // ACOSが許容範囲内
    acosStable:
      input.acosRecent === null ||
      isAcosWithinTolerance(input.acosRecent, targetAcos),
  };

  if (conditions.seoStable && conditions.inventoryStable && conditions.acosStable) {
    const acosInfo =
      input.acosRecent !== null
        ? `ACOS ${(input.acosRecent * 100).toFixed(1)}%がtarget付近`
        : "ACOS情報なし";
    const seoInfo = `SEO順位が${input.seo.rankZone}で安定`;
    reasons.push(`${seoInfo}、${acosInfo}のためGROW推奨`);
  }

  return {
    isGrow: reasons.length > 0,
    reasons,
  };
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * ライフサイクルサジェストを計算
 *
 * 優先順位:
 * 1. HARVEST（守り）
 * 2. LAUNCH_HARD（攻め）
 * 3. GROW（最適化）
 * 4. LAUNCH_SOFT（デフォルト）
 *
 * @param input - 判定に必要な入力データ
 * @param targetAcos - 目標ACOS（未指定時はProductConfigから計算）
 * @returns サジェスト結果
 */
export function computeLifecycleSuggestion(
  input: LifecycleSuggestionInput,
  targetAcos?: number
): LifecycleSuggestionResult {
  // targetAcosが未指定の場合はProductConfigから計算
  const effectiveTargetAcos = targetAcos ?? getTargetAcos(input.product);

  // 1. HARVEST判定（最優先）
  const harvestResult = checkHarvestConditions(input, effectiveTargetAcos);
  if (harvestResult.isHarvest) {
    return {
      suggestedState: "HARVEST",
      reason: harvestResult.reasons.join("。"),
    };
  }

  // 2. LAUNCH_HARD判定
  const launchHardResult = checkLaunchHardConditions(input);
  if (launchHardResult.isLaunchHard) {
    return {
      suggestedState: "LAUNCH_HARD",
      reason: launchHardResult.reasons.join("。"),
    };
  }

  // 3. GROW判定
  const growResult = checkGrowConditions(input, effectiveTargetAcos);
  if (growResult.isGrow) {
    return {
      suggestedState: "GROW",
      reason: growResult.reasons.join("。"),
    };
  }

  // 4. デフォルト: LAUNCH_SOFT
  return {
    suggestedState: "LAUNCH_SOFT",
    reason: "明確な攻め時でも守り時でもないためLAUNCH_SOFT推奨",
  };
}

// =============================================================================
// バルク処理用
// =============================================================================

/**
 * 複数商品のライフサイクルサジェストを一括計算
 *
 * @param inputs - 判定に必要な入力データの配列
 * @returns ASINをキーとするサジェスト結果のMap
 */
export function computeLifecycleSuggestionsBulk(
  inputs: LifecycleSuggestionInput[]
): Map<string, LifecycleSuggestionResult> {
  const results = new Map<string, LifecycleSuggestionResult>();

  for (const input of inputs) {
    const result = computeLifecycleSuggestion(input);
    results.set(input.product.asin, result);
  }

  return results;
}

// =============================================================================
// LAUNCH終了評価統合（SEOローンチ評価 + 遷移ロジック）
// =============================================================================

/**
 * LAUNCH終了評価を含むライフサイクルサジェスト入力
 */
export interface LifecycleSuggestionWithLaunchExitInput extends LifecycleSuggestionInput {
  /** ローンチ開始からの日数 */
  daysSinceLaunch: number;
  /** ASIN累計クリック */
  asinClicksTotal: number;
  /** ASIN累計注文 */
  asinOrdersTotal: number;
  /** 直近30日の平均日販数 */
  avgDailySales30d: number;
  /** ASIN SEOローンチ進捗 */
  seoLaunchProgress: AsinSeoLaunchProgress;
  /** lossBudget評価結果（オプション） */
  lossBudgetMetrics?: AsinLossBudgetMetrics;
  /** プロファイルレベルのベース閾値（オプション） */
  launchExitBaseThresholds?: LaunchExitBaseThresholds;
}

/**
 * LAUNCH終了評価を含むライフサイクルサジェスト結果
 */
export interface LifecycleSuggestionWithLaunchExitResult extends LifecycleSuggestionResult {
  /** LAUNCH終了評価結果（LAUNCH期の場合のみ） */
  launchExitEvaluation?: EvaluateLaunchExitForAsinResult;
  /** ライフサイクル遷移判定（LAUNCH終了の場合のみ） */
  lifecycleTransitionDecision?: LifecycleTransitionDecision;
  /** LAUNCH終了による遷移が発生したか */
  isLaunchExitTriggered: boolean;
  /** 緊急終了かどうか（lossBudget超過等） */
  isEmergencyExit: boolean;
  /** LAUNCH終了理由コード（存在する場合） */
  launchExitReasonCodes?: LaunchExitReasonCode[];
}

/**
 * LAUNCH終了評価を含むライフサイクルサジェストを計算
 *
 * LAUNCH_HARD / LAUNCH_SOFT の ASIN については:
 * 1. evaluateLaunchExitForAsin でLAUNCH終了判定を実行
 * 2. decideNextLifecycleStageForAsin で遷移先を決定
 * 3. 遷移が発生する場合は suggestedState を更新
 *
 * @param input - LAUNCH終了評価を含む入力データ
 * @param mode - 実行モード（SHADOW / APPLY）
 * @returns LAUNCH終了評価を含むサジェスト結果
 */
export function computeLifecycleSuggestionWithLaunchExit(
  input: LifecycleSuggestionWithLaunchExitInput,
  mode: ExecutionMode = "SHADOW"
): LifecycleSuggestionWithLaunchExitResult {
  // 基本のライフサイクルサジェストを計算
  const baseResult = computeLifecycleSuggestion(input);

  // LAUNCH期でない場合はそのまま返す
  const currentLifecycleState = input.product.lifecycleState;
  if (!isLaunchStage(currentLifecycleState as "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST")) {
    return {
      ...baseResult,
      isLaunchExitTriggered: false,
      isEmergencyExit: false,
    };
  }

  // LAUNCH期の場合、LAUNCH終了評価を実行
  const launchExitParams: EvaluateLaunchExitForAsinParams = {
    asin: input.product.asin,
    lifecycleStage: currentLifecycleState as "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST",
    daysSinceLaunch: input.daysSinceLaunch,
    asinClicksTotal: input.asinClicksTotal,
    asinOrdersTotal: input.asinOrdersTotal,
    avgDailySales30d: input.avgDailySales30d,
    progress: input.seoLaunchProgress,
    lossBudget: input.lossBudgetMetrics ?? null,
    baseThresholds: input.launchExitBaseThresholds ?? DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
  };

  const launchExitEvaluation = evaluateLaunchExitForAsin(launchExitParams);

  // 遷移判定を実行
  const transitionDecision = decideNextLifecycleStageForAsin(
    input.product.asin,
    currentLifecycleState as "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST",
    launchExitEvaluation.decision
  );

  // 遷移が発生する場合
  if (transitionDecision !== null) {
    return {
      suggestedState: transitionDecision.to as LifecycleState,
      reason: transitionDecision.reasonMessage,
      launchExitEvaluation,
      lifecycleTransitionDecision: transitionDecision,
      isLaunchExitTriggered: true,
      isEmergencyExit: transitionDecision.isEmergency,
      launchExitReasonCodes: transitionDecision.reasonCodes,
    };
  }

  // 遷移が発生しない場合、基本のサジェストを返す
  return {
    ...baseResult,
    launchExitEvaluation,
    isLaunchExitTriggered: false,
    isEmergencyExit: false,
  };
}

/**
 * 複数商品のLAUNCH終了評価を含むライフサイクルサジェストを一括計算
 *
 * @param inputs - LAUNCH終了評価を含む入力データの配列
 * @param mode - 実行モード（SHADOW / APPLY）
 * @returns ASINをキーとするサジェスト結果のMap
 */
export function computeLifecycleSuggestionWithLaunchExitBulk(
  inputs: LifecycleSuggestionWithLaunchExitInput[],
  mode: ExecutionMode = "SHADOW"
): Map<string, LifecycleSuggestionWithLaunchExitResult> {
  const results = new Map<string, LifecycleSuggestionWithLaunchExitResult>();

  for (const input of inputs) {
    const result = computeLifecycleSuggestionWithLaunchExit(input, mode);
    results.set(input.product.asin, result);
  }

  return results;
}

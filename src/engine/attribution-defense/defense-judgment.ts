/**
 * アトリビューション防御ロジック - 防御判定
 *
 * stable期間（アトリビューション遅延が発生していない期間）のデータを使用して
 * DOWN/STRONG_DOWN/STOP/NEGの防御判定を行う。
 *
 * 判定ルール:
 * 1. stable期間のクリック数 >= 閾値
 * 2. stable期間のコスト / targetCPA >= 閾値
 * 3. stable期間でCV=0 または ACOS高すぎ
 * 4. ライフサイクルポリシーでブロックされていない
 * 5. 直近期間が好調な場合は緩和
 */

import {
  AttributionAwareMetrics,
  DefenseThresholdConfig,
  DefenseJudgmentResult,
  DefenseReasonCode,
  DefenseActionType,
  SingleDefenseThreshold,
  LifecycleState,
  LifecycleDefensePolicy,
  DEFAULT_DEFENSE_THRESHOLD_CONFIG,
  DEFAULT_LIFECYCLE_DEFENSE_POLICIES,
  StableRatioCheckResult,
  StableRatioThresholds,
  DEFAULT_STABLE_RATIO_THRESHOLDS,
} from "./types";

// =============================================================================
// 定数
// =============================================================================

/**
 * ACOS高すぎ判定の乗数
 * stable期間のACOSがtargetAcos * この値を超えたら高すぎと判定
 */
const ACOS_HIGH_MULTIPLIER_STRONG = 1.5;  // STRONG_DOWN用
const ACOS_HIGH_MULTIPLIER_NORMAL = 1.2;  // DOWN用

/**
 * 直近期間が好調と判定するCVR改善率
 */
const RECENT_GOOD_CVR_RATIO = 1.2;

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ライフサイクル乗数を適用した閾値を計算
 */
function applyLifecycleMultiplier(
  threshold: SingleDefenseThreshold,
  multiplier: number
): SingleDefenseThreshold {
  return {
    minStableClicks: Math.ceil(threshold.minStableClicks * multiplier),
    minStableCostToTargetCpaRatio: threshold.minStableCostToTargetCpaRatio * multiplier,
  };
}

/**
 * 直近期間が好調かどうかを判定
 */
function isRecentPerformanceGood(metrics: AttributionAwareMetrics): boolean {
  // 直近期間にコンバージョンがあれば好調
  if (metrics.recent.conversions >= 1) {
    return true;
  }

  // CVR比較（両方とも有効な値がある場合）
  if (
    metrics.recent.cvr !== null &&
    metrics.stable.cvr !== null &&
    metrics.stable.cvr > 0
  ) {
    if (metrics.recent.cvr >= metrics.stable.cvr * RECENT_GOOD_CVR_RATIO) {
      return true;
    }
  }

  return false;
}

/**
 * stable期間でコンバージョンなし（STOP/NEG候補）かを判定
 */
function isNoConversionInStable(metrics: AttributionAwareMetrics): boolean {
  return metrics.stable.conversions === 0;
}

/**
 * stable期間でACOS高すぎ（STRONG_DOWN候補）かを判定
 */
function isAcosHighInStableStrong(
  metrics: AttributionAwareMetrics,
  targetAcos: number
): boolean {
  if (metrics.stable.acos === null) {
    return false;
  }
  return metrics.stable.acos > targetAcos * ACOS_HIGH_MULTIPLIER_STRONG;
}

/**
 * stable期間でACOS高め（DOWN候補）かを判定
 */
function isAcosHighInStableNormal(
  metrics: AttributionAwareMetrics,
  targetAcos: number
): boolean {
  if (metrics.stable.acos === null) {
    return false;
  }
  return metrics.stable.acos > targetAcos * ACOS_HIGH_MULTIPLIER_NORMAL;
}

// =============================================================================
// メイン判定関数
// =============================================================================

/**
 * 防御判定を実行
 *
 * @param metrics - アトリビューション対応メトリクス
 * @param targetAcos - 目標ACOS
 * @param lifecycleState - ライフサイクルステート
 * @param thresholdConfig - 防御閾値設定（オプション）
 * @param lifecyclePolicies - ライフサイクル別ポリシー（オプション）
 * @returns 防御判定結果
 *
 * @example
 * ```typescript
 * const result = judgeDefense(metrics, 0.15, "STEADY");
 *
 * if (result.shouldDefend) {
 *   console.log(`防御アクション: ${result.recommendedAction}`);
 *   console.log(`理由: ${result.reasonDetail}`);
 * } else {
 *   console.log(`防御見送り: ${result.reasonCode}`);
 * }
 * ```
 */
export function judgeDefense(
  metrics: AttributionAwareMetrics,
  targetAcos: number,
  lifecycleState: LifecycleState,
  thresholdConfig: DefenseThresholdConfig = DEFAULT_DEFENSE_THRESHOLD_CONFIG,
  lifecyclePolicies: Record<LifecycleState, LifecycleDefensePolicy> = DEFAULT_LIFECYCLE_DEFENSE_POLICIES
): DefenseJudgmentResult {
  const policy = lifecyclePolicies[lifecycleState];
  const recentGood = isRecentPerformanceGood(metrics);

  // targetCPAを計算（targetAcosとstable期間のCPCから推定）
  const targetCpa = metrics.targetCpa;

  // stable期間のコスト対CPA比率
  const stableCostToCpaRatio = targetCpa > 0 ? metrics.stable.cost / targetCpa : 0;

  // ==========================================================================
  // STOP/NEG判定
  // ==========================================================================
  if (!policy.blockStopNeg) {
    const stopNegThreshold = applyLifecycleMultiplier(
      thresholdConfig.stopNeg,
      policy.thresholdMultiplier
    );

    const meetsClicksForStopNeg = metrics.stable.clicks >= stopNegThreshold.minStableClicks;
    const meetsCostForStopNeg = stableCostToCpaRatio >= stopNegThreshold.minStableCostToTargetCpaRatio;

    if (isNoConversionInStable(metrics)) {
      // クリック閾値を満たさない
      if (!meetsClicksForStopNeg) {
        return {
          shouldDefend: false,
          recommendedAction: null,
          reasonCode: "DEFENSE_BLOCKED_INSUFFICIENT_CLICKS",
          reasonDetail: `stable期間のクリック数(${metrics.stable.clicks})が閾値(${stopNegThreshold.minStableClicks})未満のためSTOP/NEG判定を見送り`,
          meetsClickThreshold: false,
          meetsCostThreshold: meetsCostForStopNeg,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: recentGood,
          effectiveThreshold: stopNegThreshold,
        };
      }

      // コスト閾値を満たさない
      if (!meetsCostForStopNeg) {
        return {
          shouldDefend: false,
          recommendedAction: null,
          reasonCode: "DEFENSE_BLOCKED_INSUFFICIENT_COST",
          reasonDetail: `stable期間のコスト対CPA比率(${stableCostToCpaRatio.toFixed(2)})が閾値(${stopNegThreshold.minStableCostToTargetCpaRatio})未満のためSTOP/NEG判定を見送り`,
          meetsClickThreshold: true,
          meetsCostThreshold: false,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: recentGood,
          effectiveThreshold: stopNegThreshold,
        };
      }

      // 直近期間が好調な場合は緩和（STOP/NEG → STRONG_DOWN）
      if (recentGood) {
        // STRONG_DOWNもブロックされている場合はDOWNに
        const recommendedAction: DefenseActionType = policy.blockStrongDown ? "DOWN" : "STRONG_DOWN";
        return {
          shouldDefend: !policy.blockDown || !policy.blockStrongDown,
          recommendedAction: policy.blockDown && policy.blockStrongDown ? null : recommendedAction,
          reasonCode: "DEFENSE_BLOCKED_RECENT_GOOD_PERFORMANCE",
          reasonDetail: `stable期間でCV=0だが、直近期間が好調なためSTOP/NEGから${recommendedAction}に緩和`,
          meetsClickThreshold: true,
          meetsCostThreshold: true,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: true,
          effectiveThreshold: stopNegThreshold,
        };
      }

      // STOP/NEG発動
      // キーワードはSTOP、検索語クラスターはNEG
      const action: DefenseActionType = metrics.entityType === "KEYWORD" ? "STOP" : "NEG";
      const reasonCode: DefenseReasonCode = action === "STOP"
        ? "DEFENSE_STOP_NO_CONVERSION"
        : "DEFENSE_NEG_NO_CONVERSION";

      return {
        shouldDefend: true,
        recommendedAction: action,
        reasonCode,
        reasonDetail: `stable期間(${metrics.stableDays}日)でCV=0、クリック=${metrics.stable.clicks}、コスト=¥${metrics.stable.cost.toLocaleString()}`,
        meetsClickThreshold: true,
        meetsCostThreshold: true,
        blockedByLifecyclePolicy: false,
        recentPerformanceGood: false,
        effectiveThreshold: stopNegThreshold,
      };
    }
  } else if (isNoConversionInStable(metrics)) {
    // ライフサイクルポリシーでSTOP/NEGがブロックされている
    return {
      shouldDefend: false,
      recommendedAction: null,
      reasonCode: "DEFENSE_BLOCKED_LIFECYCLE_POLICY",
      reasonDetail: `${lifecycleState}フェーズではSTOP/NEGがブロックされています`,
      meetsClickThreshold: true,
      meetsCostThreshold: true,
      blockedByLifecyclePolicy: true,
      recentPerformanceGood: recentGood,
      effectiveThreshold: applyLifecycleMultiplier(
        thresholdConfig.stopNeg,
        policy.thresholdMultiplier
      ),
    };
  }

  // ==========================================================================
  // STRONG_DOWN判定
  // ==========================================================================
  if (!policy.blockStrongDown) {
    const strongDownThreshold = applyLifecycleMultiplier(
      thresholdConfig.strongDown,
      policy.thresholdMultiplier
    );

    const meetsClicksForStrongDown = metrics.stable.clicks >= strongDownThreshold.minStableClicks;
    const meetsCostForStrongDown = stableCostToCpaRatio >= strongDownThreshold.minStableCostToTargetCpaRatio;

    if (isAcosHighInStableStrong(metrics, targetAcos)) {
      // クリック閾値を満たさない
      if (!meetsClicksForStrongDown) {
        return {
          shouldDefend: false,
          recommendedAction: null,
          reasonCode: "DEFENSE_BLOCKED_INSUFFICIENT_CLICKS",
          reasonDetail: `stable期間のクリック数(${metrics.stable.clicks})が閾値(${strongDownThreshold.minStableClicks})未満のためSTRONG_DOWN判定を見送り`,
          meetsClickThreshold: false,
          meetsCostThreshold: meetsCostForStrongDown,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: recentGood,
          effectiveThreshold: strongDownThreshold,
        };
      }

      // コスト閾値を満たさない
      if (!meetsCostForStrongDown) {
        return {
          shouldDefend: false,
          recommendedAction: null,
          reasonCode: "DEFENSE_BLOCKED_INSUFFICIENT_COST",
          reasonDetail: `stable期間のコスト対CPA比率(${stableCostToCpaRatio.toFixed(2)})が閾値(${strongDownThreshold.minStableCostToTargetCpaRatio})未満のためSTRONG_DOWN判定を見送り`,
          meetsClickThreshold: true,
          meetsCostThreshold: false,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: recentGood,
          effectiveThreshold: strongDownThreshold,
        };
      }

      // 直近期間が好調な場合は緩和（STRONG_DOWN → DOWN）
      if (recentGood) {
        return {
          shouldDefend: !policy.blockDown,
          recommendedAction: policy.blockDown ? null : "DOWN",
          reasonCode: "DEFENSE_BLOCKED_RECENT_GOOD_PERFORMANCE",
          reasonDetail: `stable期間でACOS高すぎだが、直近期間が好調なためSTRONG_DOWNからDOWNに緩和`,
          meetsClickThreshold: true,
          meetsCostThreshold: true,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: true,
          effectiveThreshold: strongDownThreshold,
        };
      }

      // STRONG_DOWN発動
      return {
        shouldDefend: true,
        recommendedAction: "STRONG_DOWN",
        reasonCode: "DEFENSE_STRONG_DOWN_HIGH_ACOS",
        reasonDetail: `stable期間のACOS(${((metrics.stable.acos ?? 0) * 100).toFixed(1)}%)がtargetAcos(${(targetAcos * 100).toFixed(1)}%)の${ACOS_HIGH_MULTIPLIER_STRONG}倍を超過`,
        meetsClickThreshold: true,
        meetsCostThreshold: true,
        blockedByLifecyclePolicy: false,
        recentPerformanceGood: false,
        effectiveThreshold: strongDownThreshold,
      };
    }
  }

  // ==========================================================================
  // DOWN判定
  // ==========================================================================
  if (!policy.blockDown) {
    const downThreshold = applyLifecycleMultiplier(
      thresholdConfig.down,
      policy.thresholdMultiplier
    );

    const meetsClicksForDown = metrics.stable.clicks >= downThreshold.minStableClicks;
    const meetsCostForDown = stableCostToCpaRatio >= downThreshold.minStableCostToTargetCpaRatio;

    if (isAcosHighInStableNormal(metrics, targetAcos)) {
      // クリック閾値を満たさない
      if (!meetsClicksForDown) {
        return {
          shouldDefend: false,
          recommendedAction: null,
          reasonCode: "DEFENSE_BLOCKED_INSUFFICIENT_CLICKS",
          reasonDetail: `stable期間のクリック数(${metrics.stable.clicks})が閾値(${downThreshold.minStableClicks})未満のためDOWN判定を見送り`,
          meetsClickThreshold: false,
          meetsCostThreshold: meetsCostForDown,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: recentGood,
          effectiveThreshold: downThreshold,
        };
      }

      // コスト閾値を満たさない
      if (!meetsCostForDown) {
        return {
          shouldDefend: false,
          recommendedAction: null,
          reasonCode: "DEFENSE_BLOCKED_INSUFFICIENT_COST",
          reasonDetail: `stable期間のコスト対CPA比率(${stableCostToCpaRatio.toFixed(2)})が閾値(${downThreshold.minStableCostToTargetCpaRatio})未満のためDOWN判定を見送り`,
          meetsClickThreshold: true,
          meetsCostThreshold: false,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: recentGood,
          effectiveThreshold: downThreshold,
        };
      }

      // 直近期間が好調な場合は見送り
      if (recentGood) {
        return {
          shouldDefend: false,
          recommendedAction: null,
          reasonCode: "DEFENSE_BLOCKED_RECENT_GOOD_PERFORMANCE",
          reasonDetail: `stable期間でACOS高めだが、直近期間が好調なためDOWN判定を見送り`,
          meetsClickThreshold: true,
          meetsCostThreshold: true,
          blockedByLifecyclePolicy: false,
          recentPerformanceGood: true,
          effectiveThreshold: downThreshold,
        };
      }

      // DOWN発動
      return {
        shouldDefend: true,
        recommendedAction: "DOWN",
        reasonCode: "DEFENSE_DOWN_HIGH_ACOS",
        reasonDetail: `stable期間のACOS(${((metrics.stable.acos ?? 0) * 100).toFixed(1)}%)がtargetAcos(${(targetAcos * 100).toFixed(1)}%)の${ACOS_HIGH_MULTIPLIER_NORMAL}倍を超過`,
        meetsClickThreshold: true,
        meetsCostThreshold: true,
        blockedByLifecyclePolicy: false,
        recentPerformanceGood: false,
        effectiveThreshold: downThreshold,
      };
    }
  }

  // ==========================================================================
  // パフォーマンス良好（防御不要）
  // ==========================================================================
  return {
    shouldDefend: false,
    recommendedAction: null,
    reasonCode: "DEFENSE_NOT_NEEDED_GOOD_PERFORMANCE",
    reasonDetail: `stable期間のパフォーマンスは良好（ACOS=${metrics.stable.acos !== null ? ((metrics.stable.acos * 100).toFixed(1) + "%") : "N/A"}, CV=${metrics.stable.conversions}）`,
    meetsClickThreshold: true,
    meetsCostThreshold: true,
    blockedByLifecyclePolicy: false,
    recentPerformanceGood: recentGood,
    effectiveThreshold: applyLifecycleMultiplier(
      thresholdConfig.down,
      policy.thresholdMultiplier
    ),
  };
}

// =============================================================================
// UP/STRONG_UP用の安定比率チェック
// =============================================================================

/**
 * アップ判定の安定比率チェック
 *
 * stable期間とtotal期間のACOSを比較し、
 * total期間のACOSがstable期間より大幅に悪化している場合は
 * アップを抑制する。
 *
 * これは、直近期間でパフォーマンスが急激に悪化している可能性を
 * 検出するためのチェック。
 *
 * @param metrics - アトリビューション対応メトリクス
 * @param thresholds - 閾値設定（オプション）
 * @returns チェック結果
 */
export function checkStableRatioForUp(
  metrics: AttributionAwareMetrics,
  thresholds: StableRatioThresholds = DEFAULT_STABLE_RATIO_THRESHOLDS
): StableRatioCheckResult {
  const { maxAcosDivergenceRatio, minStableClicks } = thresholds;

  // stable期間のデータが不足している場合はスキップ
  if (metrics.stable.clicks < minStableClicks) {
    return {
      allowUp: true,
      stableAcos: metrics.stable.acos,
      totalAcos: metrics.total.acos,
      acosDivergenceRatio: null,
      reason: `stable期間のクリック数(${metrics.stable.clicks})が閾値(${minStableClicks})未満のためチェックをスキップ`,
    };
  }

  // どちらかのACOSがnullの場合はスキップ
  if (metrics.stable.acos === null || metrics.total.acos === null) {
    return {
      allowUp: true,
      stableAcos: metrics.stable.acos,
      totalAcos: metrics.total.acos,
      acosDivergenceRatio: null,
      reason: "ACOSデータが不足しているためチェックをスキップ",
    };
  }

  // stable期間のACOSが0の場合は比較不可
  if (metrics.stable.acos === 0) {
    return {
      allowUp: true,
      stableAcos: 0,
      totalAcos: metrics.total.acos,
      acosDivergenceRatio: null,
      reason: "stable期間のACOSが0のためチェックをスキップ",
    };
  }

  // 乖離率を計算
  const divergenceRatio = (metrics.total.acos - metrics.stable.acos) / metrics.stable.acos;

  // 乖離率が閾値を超えている場合はアップを抑制
  if (divergenceRatio > maxAcosDivergenceRatio) {
    return {
      allowUp: false,
      stableAcos: metrics.stable.acos,
      totalAcos: metrics.total.acos,
      acosDivergenceRatio: divergenceRatio,
      reason: `total期間のACOS(${(metrics.total.acos * 100).toFixed(1)}%)がstable期間(${(metrics.stable.acos * 100).toFixed(1)}%)より${(divergenceRatio * 100).toFixed(1)}%悪化（閾値: ${(maxAcosDivergenceRatio * 100).toFixed(0)}%）`,
    };
  }

  return {
    allowUp: true,
    stableAcos: metrics.stable.acos,
    totalAcos: metrics.total.acos,
    acosDivergenceRatio: divergenceRatio,
    reason: "ACOS乖離率は許容範囲内",
  };
}

// =============================================================================
// 簡易判定関数
// =============================================================================

/**
 * LAUNCH期の防御ブロック判定
 *
 * LAUNCH_HARD/LAUNCH_SOFTの場合、STOP/NEG/STRONG_DOWNをブロック
 */
export function isDefenseBlockedByLaunchPhase(
  action: DefenseActionType,
  lifecycleState: LifecycleState
): boolean {
  if (lifecycleState !== "LAUNCH_HARD" && lifecycleState !== "LAUNCH_SOFT") {
    return false;
  }

  const policy = DEFAULT_LIFECYCLE_DEFENSE_POLICIES[lifecycleState];

  switch (action) {
    case "STOP":
    case "NEG":
      return policy.blockStopNeg;
    case "STRONG_DOWN":
      return policy.blockStrongDown;
    case "DOWN":
      return policy.blockDown;
    default:
      return false;
  }
}

/**
 * 防御アクションをライフサイクルポリシーに基づいて緩和
 */
export function mitigateDefenseAction(
  action: DefenseActionType,
  lifecycleState: LifecycleState
): DefenseActionType | null {
  const policy = DEFAULT_LIFECYCLE_DEFENSE_POLICIES[lifecycleState];

  if (action === "STOP" || action === "NEG") {
    if (policy.blockStopNeg) {
      if (!policy.blockStrongDown) return "STRONG_DOWN";
      if (!policy.blockDown) return "DOWN";
      return null;
    }
    return action;
  }

  if (action === "STRONG_DOWN") {
    if (policy.blockStrongDown) {
      if (!policy.blockDown) return "DOWN";
      return null;
    }
    return action;
  }

  if (action === "DOWN") {
    if (policy.blockDown) {
      return null;
    }
    return action;
  }

  return action;
}

// =============================================================================
// エクスポート
// =============================================================================

export {
  isRecentPerformanceGood,
  isNoConversionInStable,
  isAcosHighInStableStrong,
  isAcosHighInStableNormal,
  applyLifecycleMultiplier,
  ACOS_HIGH_MULTIPLIER_STRONG,
  ACOS_HIGH_MULTIPLIER_NORMAL,
  RECENT_GOOD_CVR_RATIO,
};

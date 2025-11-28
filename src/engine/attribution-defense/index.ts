/**
 * アトリビューション防御ロジック - モジュールエクスポート
 *
 * Amazon広告のCV計上遅延（2-3日）を考慮した
 * DOWN/STRONG_DOWN/STOP/NEGの防御判定機能を提供。
 */

// 型定義
export {
  // メトリクス関連
  PeriodMetrics,
  AttributionAwareMetrics,
  DailyPerformanceData,
  MetricsBuildConfig,
  DEFAULT_METRICS_BUILD_CONFIG,

  // 防御閾値関連
  DefenseActionType,
  SingleDefenseThreshold,
  DefenseThresholdConfig,
  DEFAULT_DEFENSE_THRESHOLD_CONFIG,

  // ライフサイクル関連
  LifecycleState,
  LifecycleDefensePolicy,
  DEFAULT_LIFECYCLE_DEFENSE_POLICIES,

  // 判定結果関連
  DefenseJudgmentResult,
  DefenseReasonCode,

  // UP/STRONG_UP用
  StableRatioCheckResult,
  StableRatioThresholds,
  DEFAULT_STABLE_RATIO_THRESHOLDS,
} from "./types";

// メトリクス構築
export {
  buildAttributionAwareMetrics,
  buildFromKeywordMetrics,
  buildFromClusterMetrics,
  createEmptyPeriodMetrics,
  calculatePeriodMetrics,
  mergePeriodMetrics,
} from "./metrics-builder";

// 防御判定
export {
  judgeDefense,
  checkStableRatioForUp,
  isDefenseBlockedByLaunchPhase,
  mitigateDefenseAction,

  // ヘルパー関数（テスト用にエクスポート）
  isRecentPerformanceGood,
  isNoConversionInStable,
  isAcosHighInStableStrong,
  isAcosHighInStableNormal,
  applyLifecycleMultiplier,

  // 定数
  ACOS_HIGH_MULTIPLIER_STRONG,
  ACOS_HIGH_MULTIPLIER_NORMAL,
  RECENT_GOOD_CVR_RATIO,
} from "./defense-judgment";

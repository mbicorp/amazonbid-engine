/**
 * 入札エンジンモジュール
 */

export {
  BidEngineConfig,
  KeywordMetrics,
  BidRecommendation,
  BidEngineResult,
  runBidEngine,
  getExecutionMode,
  isShadowMode,
  logExecutionModeOnStartup,
  // 既存のアトリビューション遅延対策関数
  ATTRIBUTION_DELAY_CONFIG,
  isRecentPerformanceGood,
  shouldBeNoConversion,
  shouldBeAcosHigh,
  applyRecentGoodSafetyValve,
} from "./bidEngine";

// アトリビューション防御ロジック（新モジュール）
export * from "./attribution-defense";

// ロール×ライフサイクル別ガードレール
export * from "./roleGuardrails";

/**
 * SEOモジュール
 *
 * SEO順位トレンドを使ったライフサイクルサジェスト機能用
 * および SEO目標順位管理機能
 */

// 型定義（基本）
export {
  SeoMetrics,
  SeoRankHistoryRow,
  SeoQueryConfig,
  RankStatus,
  RankZone,
  KeywordType,
  SEO_TREND_LOOKBACK_DAYS,
  RANK_ZONE_THRESHOLDS,
  RANK_TREND_THRESHOLDS,
} from "./types";

// SEOメトリクス取得
export {
  determineRankStatus,
  determineRankZone,
  calculateSeoMetrics,
  getSeoMetricsForAsin,
  getSeoMetricsForAsins,
} from "./seoMetrics";

// =============================================================================
// SEO目標順位関連（新規）
// =============================================================================

// 型定義（目標順位関連）
export {
  RankTargetConfig,
  DEFAULT_RANK_TARGET_CONFIG,
  SeoProgressMetrics,
  SeoProgressConfig,
  DEFAULT_SEO_PROGRESS_CONFIG,
  RankAdjustmentReasonCode,
  RankAdjustmentSuggestion,
  RankAdjustmentConfig,
  SuggestedRankRule,
  DEFAULT_RANK_ADJUSTMENT_CONFIG,
  KeywordClusterConfig,
  createDefaultKeywordClusterConfig,
  ProductProfileRankTargetDefaults,
  PROFILE_RANK_TARGET_DEFAULTS,
  getDefaultRankTargetConfigForProfile,
  // LTVプロファイル別RankAdjustmentConfig
  ProductLtvProfile,
  VALID_PRODUCT_LTV_PROFILES,
  isValidProductLtvProfile,
  DEFAULT_PRODUCT_LTV_PROFILE,
  RANK_ADJUSTMENT_CONFIG_BY_PROFILE,
  getRankAdjustmentConfigForProfile,
} from "./seo-rank-target.types";

// SEO進捗計算
export {
  calculateRankScoreComponent,
  calculateSovScoreComponent,
  calculateSeoProgressScore,
  SeoProgressInput,
  computeSeoProgressMetrics,
  SeoProgressLevel,
  determineSeoProgressLevel,
  getSeoProgressLevelDescription,
  computeBulkSeoProgressMetrics,
  calculateMedianRank,
  calculateAverageSov,
} from "./seo-progress-calculator";

// 目標順位調整提案
export {
  RankAdjustmentInput,
  checkUnrealisticConditions,
  calculateUnhealthyTacosMonths,
  determineSuggestedTargetRank,
  generateExplanation,
  generateRankAdjustmentSuggestion,
  generateBulkRankAdjustmentSuggestions,
  StableAboveTargetInput,
  generateStableAboveTargetSuggestion,
} from "./rank-adjustment-suggester";

// SEO進捗とTACOS制御の統合
export {
  SeoAdjustedTacosParams,
  adjustTacosParamsBySeoProgress,
  SeoIntegratedTacosContext,
  buildSeoIntegratedTacosContext,
  SeoAdjustedTargetAcosResult,
  calculateFinalTargetAcosWithSeo,
} from "./seo-tacos-integration";

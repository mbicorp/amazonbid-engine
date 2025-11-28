/**
 * AUTO→EXACT 昇格エンジン
 *
 * AUTO キャンペーンから EXACT キーワードへの昇格候補をサジェストする機能
 * SHADOWモード専用で、Amazon Ads API への自動登録は行いません
 */

// 型定義
export * from "./types";

// コアロジック
export {
  getAsinBaselineCvr,
  getPortfolioBaselineCvr,
  getEffectiveBaselineCvr,
  getPromotionConfigForLifecycle,
  isClusterEligible,
  filterEligibleClusters,
  isSearchTermEligible,
  isDuplicateExactKeyword,
  isNegativeKeywordCandidate,
  calculatePromotionScore,
  determineReasonCodes,
  generateReasonDetail,
  findTargetManualCampaign,
  computeAutoExactPromotionCandidates,
} from "./auto-exact-promotion-engine";

// ジョブ
export {
  runAutoExactPromotionJob,
  runAutoExactShadowOnce,
  type RunAutoExactPromotionJobOptions,
  type RunAutoExactPromotionJobResult,
  type RunAutoExactShadowOnceOptions,
  type RunAutoExactShadowOnceResult,
} from "./auto-exact-promotion-job";

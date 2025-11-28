/**
 * ネガティブキーワード候補検出モジュール
 *
 * 統計的に安全な方法でネガティブキーワード候補をサジェストします。
 * SHADOWモード専用で、自動でのネガティブ登録は行いません。
 *
 * v2: 検索意図クラスターベースの判定を追加
 * - ASIN×検索意図クラスター単位でのSTOP/NEG判定
 * - 重要キーワードハイブリッド判定（緩和のみ許可）
 */

// 型定義
export type {
  NegativeKeywordCandidate,
  NegativeSuggestConfig,
  NegativeKeywordCandidatesResult,
  QueryRole,
  NegativeMatchType,
  NegativeReasonCode,
  SearchTermStats30dRow,
  IntentClusterStats30dRow,
  NegativeKeywordSuggestionRow,
} from "./types";

export {
  DEFAULT_NEGATIVE_SUGGEST_CONFIG,
  EXCLUDED_LIFECYCLE_STATES,
  isExcludedLifecycleState,
} from "./types";

// メイン関数
export {
  computeNegativeKeywordCandidates,
  calculateRequiredClicks,
  determineQueryRole,
  getMinClicksByRole,
  determineReasonCodes,
} from "./negative-keyword-calculator";

// =============================================================================
// 検索意図クラスターベース判定（v2）
// =============================================================================

// 型定義
export type {
  QueryIntentTag,
  ClusterJudgmentPhase,
  ClusterPhaseThresholds,
  QueryClusterMetrics,
  ClusterJudgmentResult,
  ClusterJudgmentReasonCode,
  ImportantKeywordConfig,
  ImportantKeywordCheckResult,
  ImportantKeywordReason,
  HybridJudgmentResult,
  SingleKeywordJudgmentResult,
  LongTailThresholds,
  LongTailCheckResult,
  ClusterBasedNegativeConfig,
  QueryNormalizerConfig,
  IntentTagDetectionResult,
  HybridJudgmentSummary,
} from "./query-cluster";

// 定数
export {
  QUERY_INTENT_TAG_LABELS,
  DEFAULT_CLUSTER_PHASE_THRESHOLDS,
  DEFAULT_IMPORTANT_KEYWORD_CONFIG,
  DEFAULT_LONG_TAIL_THRESHOLDS,
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG,
  DEFAULT_NORMALIZER_CONFIG,
} from "./query-cluster";

// 正規化
export {
  normalizeQuery,
  toCanonicalQuery,
} from "./query-cluster";

// 検索意図タグ検出
export {
  detectQueryIntentTag,
  detectQueryIntentTagWithDetails,
  generateQueryClusterId,
  parseQueryClusterId,
  addCustomKeywords,
} from "./query-cluster";

// クラスター判定
export {
  calculateRequiredClicksByRuleOfThree,
  determineClusterPhase,
  checkLongTail,
  judgeCluster,
  aggregateClusterMetrics,
  judgeClustersBatch,
  filterJudgmentResults,
} from "./query-cluster";

// ハイブリッド判定
export {
  calculateSpendRanking,
  checkImportantKeyword,
  judgeSingleKeyword,
  executeHybridJudgment,
  executeHybridJudgmentBatch,
  summarizeHybridJudgmentResults,
} from "./query-cluster";

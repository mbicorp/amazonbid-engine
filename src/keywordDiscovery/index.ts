/**
 * キーワード自動発見・拡張モジュール
 *
 * フェーズ一: Amazon検索語レポートから新しい有望キーワード候補を自動抽出
 * フェーズ二: Jungle Scout API との統合（設計とダミー実装）
 *
 * 使用例:
 * ```typescript
 * import {
 *   runKeywordDiscoveryJob,
 *   createKeywordDiscoveryHandler,
 *   KeywordDiscoveryConfig,
 *   DEFAULT_KEYWORD_DISCOVERY_CONFIG,
 * } from "./keywordDiscovery";
 *
 * // バッチジョブとして実行
 * const result = await runKeywordDiscoveryJob({
 *   projectId: "my-project",
 *   dataset: "amazon_bid_engine",
 *   lookbackDays: 7,
 * });
 *
 * // Express ルートとして使用
 * router.post("/cron/run-keyword-discovery", createKeywordDiscoveryHandler());
 * ```
 */

// =============================================================================
// Types
// =============================================================================
export {
  // Core Types
  DiscoverySource,
  CandidateState,
  SuggestedMatchType,
  JungleScoutMetrics,
  SearchTermMetrics,
  CandidateKeyword,
  ScoreBreakdown,

  // Config Types
  KeywordDiscoveryConfig,
  DEFAULT_KEYWORD_DISCOVERY_CONFIG,

  // BigQuery Row Types
  KeywordDiscoveryCandidateRow,
  SearchTermReportRow,
  ExistingKeyword,
  ProductConfigForDiscovery,

  // Result Types
  KeywordDiscoveryResult,
  KeywordDiscoveryStats,
  CandidateFilterOptions,

  // Utility Functions
  createEmptyJungleScoutMetrics,
} from "./types";

// =============================================================================
// Engine
// =============================================================================
export {
  // Core Functions
  discoverNewKeywordsFromSearchTerms,
  discoverNewKeywordsFromJungleScout,
  mergeAndScoreCandidates,
  runKeywordDiscovery,

  // Utility Functions
  normalizeKeyword,
} from "./engine";

// =============================================================================
// Repository
// =============================================================================
export {
  KeywordDiscoveryRepository,
  getKeywordDiscoveryRepository,
  resetKeywordDiscoveryRepository,
} from "./repository";

// =============================================================================
// HTTP Handler
// =============================================================================
export {
  // Job Function
  runKeywordDiscoveryJob,
  RunKeywordDiscoveryJobOptions,
  RunKeywordDiscoveryJobResult,

  // Express Handler Factory
  createKeywordDiscoveryHandler,
} from "./httpHandler";

// =============================================================================
// Jungle Scout Client
// =============================================================================
export {
  JungleScoutDiscoveryClient,
  JungleScoutDiscoveryConfig,
  JungleScoutKeywordResult,
  createJungleScoutDiscoveryClient,
  extractJungleScoutMetrics,
} from "./jungleScoutClient";

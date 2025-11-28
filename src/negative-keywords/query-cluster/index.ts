/**
 * 検索意図クラスターモジュール
 *
 * ASIN×検索意図クラスター単位でのSTOP/NEG判定を実現
 *
 * 主要機能:
 * - クエリ正規化（canonicalQuery生成）
 * - 検索意図タグ検出（child/adult/concern/info/generic）
 * - クラスターベースSTOP/NEG判定（3フェーズ）
 * - 重要キーワードハイブリッド判定（緩和のみ許可）
 * - ロングテールクラスター処理
 */

// =============================================================================
// 型定義
// =============================================================================

export type {
  // 検索意図タグ
  QueryIntentTag,

  // クラスター判定フェーズ
  ClusterJudgmentPhase,
  ClusterPhaseThresholds,

  // クラスターメトリクス
  QueryClusterMetrics,

  // クラスター判定結果
  ClusterJudgmentResult,
  ClusterJudgmentReasonCode,

  // 重要キーワード
  ImportantKeywordConfig,
  ImportantKeywordCheckResult,
  ImportantKeywordReason,

  // ハイブリッド判定
  HybridJudgmentResult,
  SingleKeywordJudgmentResult,

  // ロングテール
  LongTailThresholds,
  LongTailCheckResult,

  // 設定
  ClusterBasedNegativeConfig,
} from "./types";

export {
  // 定数
  QUERY_INTENT_TAG_LABELS,
  DEFAULT_CLUSTER_PHASE_THRESHOLDS,
  DEFAULT_IMPORTANT_KEYWORD_CONFIG,
  DEFAULT_LONG_TAIL_THRESHOLDS,
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG,
} from "./types";

// =============================================================================
// 正規化
// =============================================================================

export type { QueryNormalizerConfig } from "./normalizer";

export {
  normalizeQuery,
  toCanonicalQuery,
  DEFAULT_NORMALIZER_CONFIG,
} from "./normalizer";

// =============================================================================
// 検索意図タグ検出
// =============================================================================

export type { IntentTagDetectionResult } from "./intent-tagger";

export {
  detectQueryIntentTag,
  detectQueryIntentTagWithDetails,
  generateQueryClusterId,
  parseQueryClusterId,
  addCustomKeywords,
} from "./intent-tagger";

// =============================================================================
// クラスター判定
// =============================================================================

export {
  // ルールオブスリー
  calculateRequiredClicksByRuleOfThree,

  // フェーズ判定
  determineClusterPhase,

  // ロングテール判定
  checkLongTail,

  // クラスター判定
  judgeCluster,

  // メトリクス集約
  aggregateClusterMetrics,

  // バッチ処理
  judgeClustersBatch,
  filterJudgmentResults,
} from "./cluster-judgment";

// =============================================================================
// ハイブリッド判定
// =============================================================================

export type { HybridJudgmentSummary } from "./hybrid-judgment";

export {
  // 重要キーワード
  calculateSpendRanking,
  checkImportantKeyword,

  // 単一キーワード判定
  judgeSingleKeyword,

  // ハイブリッド判定
  executeHybridJudgment,
  executeHybridJudgmentBatch,

  // サマリー
  summarizeHybridJudgmentResults,
} from "./hybrid-judgment";

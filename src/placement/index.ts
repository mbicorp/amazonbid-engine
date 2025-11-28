/**
 * Placement（掲載位置）最適化モジュール
 *
 * Top of Search Impression Share を考慮した掲載位置入札調整比率の自動最適化
 *
 * 主要エクスポート:
 * - runPlacementEngine: メインエンジン実行関数
 * - computePlacementRecommendation: 純粋関数（単一推奨計算）
 * - PlacementBigQueryAdapter: BigQuery 連携アダプター
 */

// =============================================================================
// 型定義
// =============================================================================

export {
  // 掲載位置タイプ
  PlacementType,
  PLACEMENT_TYPE_MAP,
  VALID_PLACEMENT_TYPES,
  isValidPlacementType,
  // メトリクス
  PlacementMetrics,
  // アクション
  PlacementAction,
  VALID_PLACEMENT_ACTIONS,
  isValidPlacementAction,
  // 推奨
  PlacementRecommendation,
  PlacementReasonCode,
  VALID_PLACEMENT_REASON_CODES,
  // 設定
  PlacementOptimizerConfig,
  DEFAULT_PLACEMENT_OPTIMIZER_CONFIG,
  // 実行結果
  PlacementEngineResult,
  // BigQuery 行型
  CampaignPlacementMetricsRow,
  PlacementRecommendationRow,
} from "./types";

// =============================================================================
// 計算ロジック（純粋関数）
// =============================================================================

export {
  // メイン計算関数
  computePlacementRecommendation,
  computePlacementRecommendations,
  // 統計ヘルパー
  countPlacementActions,
  countOpportunityJumps,
} from "./placement-calculator";

// =============================================================================
// BigQuery アダプター
// =============================================================================

export {
  PlacementBigQueryAdapter,
  PlacementBigQueryAdapterOptions,
  createPlacementBigQueryAdapter,
} from "./bigquery-adapter";

// =============================================================================
// エンジン
// =============================================================================

export {
  // エンジン実行
  runPlacementEngine,
  PlacementEngineConfig,
  // ユーティリティ
  logPlacementExecutionModeOnStartup,
} from "./placement-engine";

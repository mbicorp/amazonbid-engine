/**
 * Jungle Scout 統合モジュール
 *
 * Jungle Scout APIを使用したキーワードインテリジェンスと
 * 戦略分析機能を提供する
 */

// 型定義
export * from "./types";

// APIクライアント
export {
  JungleScoutClient,
  JungleScoutConfig,
  JungleScoutApiException,
  createJungleScoutClient,
  getJungleScoutClient,
  resetJungleScoutClient,
} from "./client";

// BigQueryアダプター
export {
  saveKeywordIntelligence,
  getLatestKeywordIntelligence,
  saveShareOfVoice,
  getLatestShareOfVoice,
  getAsinKeywordSummary,
  saveVolumeHistory,
  getVolumeHistory,
  saveStrategyAnalysis,
  getLatestStrategyAnalysis,
  getStrategySummary,
  getTrendingKeywords,
} from "./bigquery-adapter";

// 戦略分析
export {
  analyzeKeywordStrategy,
  analyzeKeywordsStrategy,
  generateStrategySummary,
} from "./strategy-analyzer";

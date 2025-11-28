/**
 * SEOメトリクス関連 - 型定義
 *
 * SEO順位トレンドを使ったライフサイクルサジェスト機能用
 */

// =============================================================================
// 定数
// =============================================================================

/**
 * SEOトレンド計算用のルックバック日数
 */
export const SEO_TREND_LOOKBACK_DAYS = 7;

/**
 * 順位ゾーン判定の閾値
 */
export const RANK_ZONE_THRESHOLDS = {
  TOP_ZONE_MAX: 7,      // 1-7位がTOP_ZONE
  MID_ZONE_MAX: 20,     // 8-20位がMID_ZONE
  OUT_OF_RANGE_MIN: 21, // 21位以降がOUT_OF_RANGE
} as const;

/**
 * トレンド判定の閾値
 */
export const RANK_TREND_THRESHOLDS = {
  UP_MIN: 3,    // +3以上で「上昇」
  DOWN_MAX: -3, // -3以下で「下降」
} as const;

// =============================================================================
// 型定義
// =============================================================================

/**
 * 順位トレンドステータス
 */
export type RankStatus = "UP" | "FLAT" | "DOWN" | "UNKNOWN";

/**
 * 順位ゾーン
 */
export type RankZone = "TOP_ZONE" | "MID_ZONE" | "OUT_OF_RANGE" | "UNKNOWN";

/**
 * キーワードタイプ
 */
export type KeywordType = "MAIN" | "BRAND" | "GENERIC";

/**
 * SEOメトリクス
 */
export interface SeoMetrics {
  asin: string;
  currentRank: number | null;     // 今日または直近の順位
  prevRank: number | null;        // lookbackDays前の順位
  rankTrend: number | null;       // prevRank - currentRank（上昇ならプラス）
  rankStatus: RankStatus;
  rankZone: RankZone;
}

/**
 * BigQueryのproduct_seo_rank_historyテーブルに対応する行
 */
export interface SeoRankHistoryRow {
  asin: string;
  date: Date;
  keyword_type: string;
  category: string | null;
  search_keyword: string;
  organic_rank: number | null;
  created_at: Date;
}

/**
 * BigQuery接続設定
 */
export interface SeoQueryConfig {
  projectId: string;
  dataset: string;
}

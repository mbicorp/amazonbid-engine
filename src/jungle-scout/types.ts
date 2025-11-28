/**
 * Jungle Scout API 型定義
 *
 * Jungle Scout Cobalt APIの型定義
 * https://developer.junglescout.com/
 */

// =============================================================================
// 共通型
// =============================================================================

/**
 * サポートされるマーケットプレイス
 */
export type JungleScoutMarketplace =
  | "us"
  | "uk"
  | "de"
  | "fr"
  | "it"
  | "es"
  | "ca"
  | "mx"
  | "jp"
  | "in"
  | "au";

/**
 * APIレスポンスの基本構造
 */
export interface JungleScoutApiResponse<T> {
  data: T;
  links?: {
    self?: string;
    next?: string;
    prev?: string;
  };
  meta?: {
    total_items?: number;
    page_count?: number;
    current_page?: number;
  };
}

/**
 * エラーレスポンス
 */
export interface JungleScoutApiError {
  errors: Array<{
    status: string;
    code: string;
    title: string;
    detail: string;
  }>;
}

// =============================================================================
// Keywords by ASIN
// =============================================================================

/**
 * Keywords by ASINリクエストパラメータ
 */
export interface KeywordsByAsinRequest {
  asin: string;
  marketplace: JungleScoutMarketplace;
  filter_options?: {
    min_monthly_search_volume_exact?: number;
    max_monthly_search_volume_exact?: number;
    min_monthly_search_volume_broad?: number;
    max_monthly_search_volume_broad?: number;
    min_word_count?: number;
    max_word_count?: number;
    min_organic_product_count?: number;
    max_organic_product_count?: number;
  };
  sort_option?: KeywordSortOption;
  page_size?: number;
  page?: number;
}

export type KeywordSortOption =
  | "monthly_search_volume_exact_desc"
  | "monthly_search_volume_exact_asc"
  | "monthly_search_volume_broad_desc"
  | "monthly_search_volume_broad_asc"
  | "relevancy_score_desc"
  | "relevancy_score_asc";

/**
 * Keywords by ASINレスポンスのキーワードデータ
 */
export interface KeywordByAsinData {
  type: "keywords_by_asin";
  id: string;
  attributes: {
    name: string;
    country: string;
    monthly_search_volume_exact: number;
    monthly_search_volume_broad: number;
    dominant_category: string;
    recommended_promotions: number;
    sp_brand_ad_bid: number;
    ppc_bid_broad: number;
    ppc_bid_exact: number;
    ease_of_ranking_score: number;
    relevancy_score: number;
    organic_product_count: number;
    sponsored_product_count: number;
    trending: TrendingInfo;
    updated_at: string;
  };
}

export interface TrendingInfo {
  direction: "up" | "down" | "flat";
  percentage_change: number;
}

// =============================================================================
// Share of Voice
// =============================================================================

/**
 * Share of Voiceリクエストパラメータ
 */
export interface ShareOfVoiceRequest {
  keyword: string;
  marketplace: JungleScoutMarketplace;
}

/**
 * Share of Voiceレスポンスのデータ
 */
export interface ShareOfVoiceData {
  type: "share_of_voice";
  id: string;
  attributes: {
    keyword: string;
    country: string;
    search_volume: number;
    search_volume_trend: TrendingInfo;
    updated_at: string;
    products: ShareOfVoiceProduct[];
  };
}

export interface ShareOfVoiceProduct {
  asin: string;
  brand: string;
  title: string;
  image_url: string;
  price: number;
  rating: number;
  review_count: number;
  organic_rank: number | null;
  sponsored_rank: number | null;
  combined_rank: number;
  organic_share_of_voice: number;
  sponsored_share_of_voice: number;
  combined_share_of_voice: number;
  is_amazon_choice: boolean;
  is_best_seller: boolean;
  is_sponsored: boolean;
}

// =============================================================================
// Historical Search Volume
// =============================================================================

/**
 * Historical Search Volumeリクエストパラメータ
 */
export interface HistoricalSearchVolumeRequest {
  keyword: string;
  marketplace: JungleScoutMarketplace;
  start_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
}

/**
 * Historical Search Volumeレスポンスのデータ
 */
export interface HistoricalSearchVolumeData {
  type: "historical_search_volume";
  id: string;
  attributes: {
    keyword: string;
    country: string;
    estimates: SearchVolumeEstimate[];
  };
}

export interface SearchVolumeEstimate {
  date: string;
  estimated_exact_search_volume: number;
  estimated_broad_search_volume: number;
}

// =============================================================================
// Keyword by Keyword（キーワード詳細情報）
// =============================================================================

/**
 * Keyword by Keywordリクエストパラメータ
 */
export interface KeywordByKeywordRequest {
  search_terms: string[];
  marketplace: JungleScoutMarketplace;
}

/**
 * Keyword by Keywordレスポンスのデータ
 */
export interface KeywordByKeywordData {
  type: "keyword_by_keyword";
  id: string;
  attributes: {
    name: string;
    country: string;
    monthly_search_volume_exact: number;
    monthly_search_volume_broad: number;
    dominant_category: string;
    recommended_promotions: number;
    sp_brand_ad_bid: number;
    ppc_bid_broad: number;
    ppc_bid_exact: number;
    ease_of_ranking_score: number;
    relevancy_score: number;
    organic_product_count: number;
    sponsored_product_count: number;
    trending: TrendingInfo;
    updated_at: string;
  };
}

// =============================================================================
// 内部使用型（BigQuery保存用）
// =============================================================================

/**
 * キーワードインテリジェンスデータ（統合型）
 */
export interface KeywordIntelligence {
  // 識別子
  keyword: string;
  marketplace: JungleScoutMarketplace;
  asin?: string;

  // 検索ボリューム
  monthly_search_volume_exact: number;
  monthly_search_volume_broad: number;

  // PPC関連
  ppc_bid_broad: number;
  ppc_bid_exact: number;
  sp_brand_ad_bid: number;

  // ランキング・競合
  ease_of_ranking_score: number;
  relevancy_score: number;
  organic_product_count: number;
  sponsored_product_count: number;

  // トレンド
  trending_direction: "up" | "down" | "flat";
  trending_percentage: number;

  // カテゴリ
  dominant_category: string;

  // メタ情報
  fetched_at: Date;
  updated_at: string;
}

/**
 * Share of Voice結果（自社ASIN用）
 */
export interface AsinShareOfVoice {
  keyword: string;
  marketplace: JungleScoutMarketplace;
  asin: string;
  search_volume: number;

  // 自社ランキング
  organic_rank: number | null;
  sponsored_rank: number | null;
  combined_rank: number;

  // Share of Voice
  organic_sov: number;
  sponsored_sov: number;
  combined_sov: number;

  // ステータス
  is_amazon_choice: boolean;
  is_best_seller: boolean;

  // メタ情報
  fetched_at: Date;
}

/**
 * キーワード検索ボリューム履歴
 */
export interface KeywordVolumeHistory {
  keyword: string;
  marketplace: JungleScoutMarketplace;
  date: string;
  search_volume_exact: number;
  search_volume_broad: number;
  fetched_at: Date;
}

// =============================================================================
// ビジネス戦略用の集計型
// =============================================================================

/**
 * キーワード戦略タイプ
 */
export type KeywordStrategy =
  | "harvest" // 高SOV・高ランク → 効率重視
  | "invest" // 低SOV・高ポテンシャル → 成長投資
  | "defend" // 高SOV・競合増加 → 維持戦略
  | "optimize" // 中SOV → ROI最適化
  | "reduce"; // 低ポテンシャル → 削減

/**
 * キーワード戦略分析結果
 */
export interface KeywordStrategyAnalysis {
  keyword: string;
  asin: string;
  marketplace: JungleScoutMarketplace;

  // 現在の状態
  current_organic_rank: number | null;
  current_sponsored_rank: number | null;
  current_sov: number;
  search_volume: number;

  // 推奨戦略
  recommended_strategy: KeywordStrategy;
  strategy_reason: string;

  // 推奨入札
  recommended_bid_adjustment: number; // -1.0 ~ +1.0
  recommended_acos_target: number;

  // ポテンシャル
  potential_score: number; // 0-100
  competition_level: "low" | "medium" | "high";

  // 計算日時
  analyzed_at: Date;
}

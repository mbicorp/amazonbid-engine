/**
 * ライフサイクル管理 - 型定義
 *
 * 商品のライフサイクルステージ、SEOスコア、投資戦略を管理するための型定義
 */

// =============================================================================
// ライフサイクルステージ
// =============================================================================

/**
 * 商品ライフサイクルステージ
 */
export type LifecycleStage =
  | "LAUNCH_HARD"    // 投資強度最大：積極的な赤字投資でSEO獲得
  | "LAUNCH_SOFT"    // やや赤字〜トントン：投資継続
  | "GROW"           // sustainable_tacos周辺でバランス運用
  | "HARVEST";       // 利益回収フェーズ

/**
 * 戦略パターン（lifecycle_stageと対応）
 */
export type StrategyPattern =
  | "launch_hard"
  | "launch_soft"
  | "grow"
  | "harvest";

// =============================================================================
// SEO関連
// =============================================================================

/**
 * SEOレベル
 */
export type SeoLevel = "HIGH" | "MID" | "LOW";

/**
 * SEOスコアトレンド
 */
export type SeoScoreTrend = "UP" | "FLAT" | "DOWN";

/**
 * キーワード役割
 */
export type KeywordRole =
  | "brand"              // ブランドキーワード
  | "core"               // コアジェネリック
  | "support"            // サポートキーワード
  | "longtail_experiment" // ロングテール実験
  | "other";             // その他

// =============================================================================
// 商品戦略
// =============================================================================

/**
 * 商品戦略テーブルの型
 */
export interface ProductStrategy {
  product_id: string;  // ASIN

  // ライフサイクル管理
  lifecycle_stage: LifecycleStage;
  strategy_pattern: StrategyPattern;

  // TACOS設定
  sustainable_tacos: number;  // 長期的に許容するTACOS (例: 0.20)
  invest_tacos_cap: number | null;  // 投資フェーズで許容する最大TACOS (例: 0.60)

  // 投資上限
  invest_max_loss_per_month_jpy: number | null;  // 月次許容赤字上限
  invest_max_months_base: number | null;  // 初期投資期間上限
  invest_max_months_dynamic: number | null;  // 動的投資期間上限（自動延長）

  // 投資開始日
  invest_start_date: Date | null;

  // 商品情報
  profit_margin: number;  // 粗利率
  unit_price_jpy: number | null;  // 平均販売単価

  // 再投資設定
  reinvest_allowed: boolean;

  // 商品グループ
  product_group_id: string | null;

  // レビュー情報
  review_rating: number | null;
  review_count: number | null;

  // キーワード設定
  brand_keywords: string[];
  product_core_terms: string[];

  // メタ情報
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// 月次利益
// =============================================================================

/**
 * 月次利益データ
 */
export interface MonthlyProfit {
  product_id: string;
  year_month: string;  // YYYY-MM

  // 売上指標
  revenue_total_jpy: number;
  cogs_total_jpy: number;
  gross_profit_before_ads_jpy: number;

  // 広告指標
  ad_spend_total_jpy: number;
  ad_sales_total_jpy: number;

  // 計算指標
  tacos_monthly: number | null;
  acos_monthly: number | null;
  roas_monthly: number | null;
  net_profit_monthly: number;
  net_profit_cumulative: number | null;

  // 経過月数
  months_since_launch: number | null;
}

// =============================================================================
// SEOスコア
// =============================================================================

/**
 * SEOスコアデータ
 */
export interface SeoScore {
  product_id: string;
  year_month: string;

  // スコア
  seo_score: number;  // 0-100
  seo_score_trend: SeoScoreTrend;
  seo_score_prev_month: number | null;
  seo_score_change: number | null;

  // 役割別スコア
  brand_score: number | null;
  core_score: number | null;
  support_score: number | null;
  longtail_score: number | null;

  // キーワード数
  brand_keyword_count: number;
  core_keyword_count: number;
  support_keyword_count: number;
  longtail_keyword_count: number;
  total_keyword_count: number;

  // 順位サマリー
  avg_organic_rank: number | null;
  best_organic_rank: number | null;
  worst_organic_rank: number | null;
  keywords_in_top10: number;
  keywords_in_top20: number;

  // SEOレベル
  seo_level: SeoLevel;
}

// =============================================================================
// キーワードメトリクス
// =============================================================================

/**
 * 60日集計キーワードメトリクス
 */
export interface KeywordMetrics60d {
  product_id: string;
  keyword: string;
  period_start: Date;
  period_end: Date;

  // 基本指標
  impressions_60d: number;
  clicks_60d: number;
  orders_60d: number;
  ad_sales_60d: number;
  ad_spend_60d: number;

  // 計算指標
  ctr_60d: number | null;
  cvr_60d: number | null;
  acos_60d: number | null;
  gross_profit_60d: number | null;
  net_profit_60d: number | null;

  // 検索ボリューム
  search_volume: number | null;
  js_relevancy: number | null;

  // 正規化スコア
  volume_score: number | null;
  traffic_score: number | null;
  ctr_score: number | null;
  cvr_score: number | null;
  profit_score: number | null;
  semantic_relevance_score: number | null;
  text_match_score: number | null;

  // カテゴリ
  category: KeywordRole;
  word_count: number;

  // 性能スコア
  performance_core_score: number | null;
  performance_support_score: number | null;
  performance_longtail_score: number | null;

  // データ十分性
  has_sufficient_data: boolean;
}

/**
 * SEOキーワードセット
 */
export interface SeoKeyword {
  product_id: string;
  keyword: string;
  role: KeywordRole;
  selected_flag: boolean;
  selection_reason: string | null;

  // スコア情報
  volume_score: number | null;
  traffic_score: number | null;
  performance_score: number | null;

  // 順位情報
  organic_rank: number | null;
  sponsored_rank: number | null;
  search_volume: number | null;

  // 選定日
  selected_at: Date | null;
  deselected_at: Date | null;
}

// =============================================================================
// ライフサイクル遷移
// =============================================================================

/**
 * ライフサイクル遷移判定の入力データ
 */
export interface LifecycleTransitionInput {
  product: ProductStrategy;
  monthlyProfit: MonthlyProfit;
  seoScore: SeoScore;
  prevMonthlyProfit?: MonthlyProfit;

  // グローバル設定
  globalCumulativeLossLimit: number;  // 累積赤字上限
}

/**
 * ライフサイクル遷移判定結果
 */
export interface LifecycleTransitionResult {
  product_id: string;
  current_stage: LifecycleStage;
  recommended_stage: LifecycleStage;
  should_transition: boolean;
  transition_reason: string;

  // 投資期間延長判定
  extend_investment: boolean;
  new_invest_max_months_dynamic: number | null;
  extension_reason: string | null;

  // 警告・アラート
  warnings: string[];
  force_harvest: boolean;
  force_harvest_reason: string | null;
}

// =============================================================================
// 設定
// =============================================================================

/**
 * ライフサイクル管理の設定
 */
export interface LifecycleConfig {
  // TACOS設定（ライフサイクルステージ別）
  tacos_caps: {
    LAUNCH_HARD: number;  // 例: 0.60
    LAUNCH_SOFT: number;  // 例: 0.40
    GROW: number;         // 例: 0.25
    HARVEST: number;      // 例: 0.15
  };

  // 投資期間設定
  invest_months: {
    LAUNCH_HARD: number;  // 例: 4
    LAUNCH_SOFT: number;  // 例: 6
    max_dynamic: number;  // 例: 12
  };

  // 遷移条件のしきい値
  transition_thresholds: {
    // LAUNCH_HARD → LAUNCH_SOFT
    tacos_exceed_multiplier: number;  // 例: 1.10
    // LAUNCH_SOFT → LAUNCH_HARD
    tacos_good_multiplier: number;    // 例: 0.70
    loss_tolerance_multiplier: number; // 例: 0.50

    // → GROW
    sustainable_tacos_multiplier: number;  // 例: 1.20

    // SEOレベル
    seo_high_threshold: number;   // 例: 70
    seo_mid_threshold: number;    // 例: 40
  };

  // グローバルセーフティ
  safety: {
    consecutive_loss_months: number;      // 例: 2
    global_cumulative_loss_limit: number; // 例: 2000000
    min_review_rating: number;            // 例: 3.0
    min_review_count: number;             // 例: 20
  };

  // 投資延長条件
  extension: {
    loss_tolerance_ratio: number;  // 例: 0.70（許容赤字の70%以内）
  };
}

/**
 * デフォルトのライフサイクル設定
 */
export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  tacos_caps: {
    LAUNCH_HARD: 0.60,
    LAUNCH_SOFT: 0.40,
    GROW: 0.25,
    HARVEST: 0.15,
  },
  invest_months: {
    LAUNCH_HARD: 4,
    LAUNCH_SOFT: 6,
    max_dynamic: 12,
  },
  transition_thresholds: {
    tacos_exceed_multiplier: 1.10,
    tacos_good_multiplier: 0.70,
    loss_tolerance_multiplier: 0.50,
    sustainable_tacos_multiplier: 1.20,
    seo_high_threshold: 70,
    seo_mid_threshold: 40,
  },
  safety: {
    consecutive_loss_months: 2,
    global_cumulative_loss_limit: 2000000,
    min_review_rating: 3.0,
    min_review_count: 20,
  },
  extension: {
    loss_tolerance_ratio: 0.70,
  },
};

/**
 * 統合入札戦略エンジン - 型定義
 *
 * Jungle Scout（市場データ）+ SP-API（商品収益性）+ Amazon Ads（広告パフォーマンス）
 * を統合した入札戦略の型定義
 */

// =============================================================================
// 商品収益性データ（SP-API / 設定値）
// =============================================================================

/**
 * 商品収益性情報
 */
export interface ProductProfitability {
  asin: string;
  marketplace: string;

  // 売上データ
  total_sales_30d: number; // 過去30日の総売上（広告経由+オーガニック）
  total_sales_previous_30d: number; // 前30日の総売上（成長率計算用）
  ad_sales_30d: number; // 広告経由の売上
  organic_sales_30d: number; // オーガニック売上（推定）

  // 利益率
  profit_margin: number; // 商品利益率（0.0-1.0）
  unit_profit: number; // 1個あたりの利益額

  // コスト
  ad_spend_30d: number; // 広告費
  total_ad_cost: number; // 総広告コスト

  // 計算値
  ad_dependency_ratio: number; // 広告依存度（ad_sales / total_sales）
  sales_growth_rate: number; // 売上成長率
  total_roas: number; // 総ROAS（total_sales / ad_spend）
  ad_roas: number; // 広告ROAS（ad_sales / ad_spend）
  profit_after_ad: number; // 広告費控除後利益

  // メタ情報
  updated_at: Date;
}

/**
 * 商品ライフサイクルステージ
 */
export type ProductLifecycle =
  | "launch" // 新商品（発売〜3ヶ月）
  | "growth" // 成長期（売上成長中）
  | "mature" // 成熟期（安定）
  | "decline"; // 衰退期（売上減少）

/**
 * 商品戦略タイプ（商品レベル）
 */
export type ProductStrategy =
  | "aggressive_growth" // 積極成長：シェア拡大優先
  | "balanced_growth" // バランス成長：成長と収益のバランス
  | "profit_maximize" // 利益最大化：効率重視
  | "maintenance" // 維持：現状維持
  | "harvest"; // 収穫：最小投資で利益回収

// =============================================================================
// キーワード戦略（Jungle Scout由来）
// =============================================================================

/**
 * キーワード戦略タイプ（キーワードレベル）
 */
export type KeywordStrategy =
  | "invest" // 投資：SOV拡大
  | "defend" // 防衛：シェア維持
  | "harvest" // 収穫：効率重視
  | "optimize" // 最適化：ROI改善
  | "reduce"; // 削減：予算縮小

// =============================================================================
// 統合戦略
// =============================================================================

/**
 * 統合入札戦略（商品×キーワード）
 */
export interface UnifiedBidStrategy {
  // 識別子
  asin: string;
  keyword: string;
  keyword_id: string;
  campaign_id: string;
  ad_group_id: string;
  marketplace: string;

  // 商品コンテキスト
  product_strategy: ProductStrategy;
  product_lifecycle: ProductLifecycle;
  product_profit_margin: number;

  // キーワードコンテキスト（Jungle Scout）
  keyword_strategy: KeywordStrategy;
  organic_rank: number | null;
  sponsored_rank: number | null;
  share_of_voice: number;
  search_volume: number;
  keyword_potential_score: number;

  // 広告パフォーマンス（Amazon Ads）
  current_acos: number;
  current_cvr: number;
  current_ctr: number;
  current_bid: number;
  clicks_30d: number;
  impressions_30d: number;

  // 統合判定結果
  final_action: BidAction;
  dynamic_acos_target: number;
  recommended_bid: number;
  bid_adjustment_rate: number; // -1.0 ~ +2.0

  // 判定理由
  strategy_reason: string;
  constraints_applied: string[];

  // スコア
  priority_score: number; // 優先度スコア（予算配分用）
  confidence_score: number; // 判定信頼度

  // メタ情報
  analyzed_at: Date;
}

/**
 * 入札アクション
 */
export type BidAction =
  | "STRONG_UP" // 大幅増額（+30%以上）
  | "MILD_UP" // 小幅増額（+10-30%）
  | "KEEP" // 維持
  | "MILD_DOWN" // 小幅減額（-10-30%）
  | "STRONG_DOWN" // 大幅減額（-30%以上）
  | "STOP"; // 停止

// =============================================================================
// 動的ACOSしきい値
// =============================================================================

/**
 * 動的ACOS設定
 */
export interface DynamicAcosConfig {
  // 基準値
  base_acos_target: number;

  // 商品戦略による調整
  product_strategy_multiplier: number;

  // キーワード戦略による調整
  keyword_strategy_multiplier: number;

  // 利益率による上限
  profit_margin_limit: number;

  // 最終ACOS目標
  final_acos_target: number;

  // 許容範囲
  acos_hard_stop: number; // これ以上は絶対NG
  acos_soft_limit: number; // 警告レベル
}

// =============================================================================
// 戦略マトリックス
// =============================================================================

/**
 * 商品×キーワード戦略マトリックスの1セル
 */
export interface StrategyMatrixCell {
  product_strategy: ProductStrategy;
  keyword_strategy: KeywordStrategy;
  recommended_action: BidAction;
  acos_multiplier: number;
  bid_adjustment_range: {
    min: number;
    max: number;
  };
  priority_boost: number;
  description: string;
}

// =============================================================================
// 分析サマリー
// =============================================================================

/**
 * ASIN別統合戦略サマリー
 */
export interface UnifiedStrategySummary {
  asin: string;
  marketplace: string;

  // 商品情報
  product_strategy: ProductStrategy;
  product_lifecycle: ProductLifecycle;
  total_sales_30d: number;
  profit_margin: number;
  ad_dependency_ratio: number;

  // キーワード統計
  total_keywords: number;
  keywords_by_strategy: Record<KeywordStrategy, number>;
  total_search_volume: number;
  avg_share_of_voice: number;

  // 推奨アクション統計
  actions_breakdown: Record<BidAction, number>;

  // 予算配分
  recommended_budget_allocation: {
    invest_keywords: number; // 投資キーワードへの配分率
    defend_keywords: number;
    harvest_keywords: number;
    optimize_keywords: number;
    reduce_keywords: number;
  };

  // 期待効果
  expected_impact: {
    estimated_sales_change: number; // 売上変化予測（%）
    estimated_acos_change: number; // ACOS変化予測
    estimated_sov_change: number; // SOV変化予測
  };

  analyzed_at: Date;
}

// =============================================================================
// SEO投資戦略（赤字許容モード）
// =============================================================================

/**
 * SEO投資設定
 * 新商品やビッグキーワードで自然検索上位を狙うための赤字許容設定
 */
export interface SeoInvestmentConfig {
  enabled: boolean;

  // 赤字許容設定
  allow_loss_ratio: number; // 許容赤字率（例: 0.5 = 利益率の50%まで赤字OK → 利益率30%なら ACOS 45%まで許容）
  max_loss_per_keyword_daily: number; // キーワード別1日あたり最大赤字額（円）
  max_total_loss_daily: number; // ASIN全体の1日あたり最大赤字額（円）

  // 目標設定
  target_organic_rank: number; // 目標自然検索順位（例: 10 = 10位以内）
  target_sponsored_rank: number; // 目標スポンサー順位（例: 3 = 3位以内）

  // 対象条件
  min_search_volume: number; // 対象とする最小検索ボリューム（ビッグKWのみに適用）
  min_profit_margin: number; // 赤字投資を許可する最小利益率（利益率が低いと回収困難）
  max_competition_sov: number; // 1社の占有SOVがこれ以上だと投資見送り

  // 撤退条件（どれか1つでも該当したら撤退）
  exit_conditions: {
    // 時間ベース
    max_investment_days: number; // 最大投資日数（例: 60日）

    // 投資効率ベース（商品規模に連動）
    max_investment_ratio_to_monthly_profit: number; // 月間利益に対する最大投資比率（例: 3.0 = 3ヶ月分の利益まで）
    max_investment_ratio_to_organic_value: number; // 期待オーガニック価値に対する最大投資比率（例: 12.0 = 12ヶ月分まで）

    // 進捗ベース
    min_rank_improvement_per_week: number; // 週あたり最小ランク改善（例: 3 = 3位以上改善なければ要検討）
    stagnant_weeks_limit: number; // ランク停滞週数上限（例: 2週連続で改善なし → 撤退）

    // ROI効率ベース
    min_roi_efficiency: number; // 最小ROI効率（投資1円あたりの順位改善）しきい値以下で撤退警告
    roi_check_after_days: number; // ROI効率チェック開始日（例: 14日目以降）
  };

  // フェーズ別赤字許容率
  phase_loss_ratios: {
    initial: number; // 初期フェーズ（1-2週目）: 最大赤字許容
    acceleration: number; // 加速フェーズ（3-4週目）: 効果確認後の増額
    maintenance: number; // 維持フェーズ（5週目以降）: 順位維持のための投資
    exit: number; // 撤退フェーズ: 赤字縮小
  };
}

/**
 * SEO投資状態追跡
 */
export interface SeoInvestmentState {
  asin: string;
  keyword: string;
  marketplace: string;

  // 投資状態
  phase: "initial" | "acceleration" | "maintenance" | "exit" | "completed" | "abandoned";
  started_at: Date;
  current_day: number;

  // ランク推移
  rank_history: {
    date: Date;
    organic_rank: number | null;
    sponsored_rank: number | null;
  }[];
  initial_organic_rank: number | null;
  current_organic_rank: number | null;
  best_organic_rank: number | null;

  // 投資実績
  total_investment: number; // 総投資額（赤字分）
  total_ad_spend: number; // 総広告費
  total_sales: number; // 総売上
  daily_investments: {
    date: Date;
    ad_spend: number;
    sales: number;
    loss: number;
  }[];

  // 評価
  rank_improvement: number; // ランク改善幅
  weeks_without_improvement: number; // 改善なし週数
  estimated_organic_value: number; // 推定オーガニック価値（投資回収期間計算用）
  roi_projection: number; // 投資回収見込み（月数）
}

/**
 * SEO投資推奨判定結果
 */
export interface SeoInvestmentRecommendation {
  keyword: string;
  search_volume: number;
  current_organic_rank: number | null;
  target_organic_rank: number;

  // 推奨
  should_invest: boolean;
  recommended_phase: "initial" | "acceleration" | "maintenance" | "exit" | "skip";
  recommended_loss_ratio: number; // 推奨赤字許容率

  // 計算値
  estimated_investment_needed: number; // 目標達成に必要な推定投資額
  estimated_payback_months: number; // 投資回収見込み月数
  organic_value_per_month: number; // オーガニック上位による月間価値

  // リスク評価
  risk_level: "low" | "medium" | "high" | "very_high";
  risk_factors: string[];

  // 理由
  recommendation_reason: string;
}

// =============================================================================
// 設定
// =============================================================================

/**
 * 統合戦略エンジン設定
 */
export interface UnifiedStrategyConfig {
  // ACOS基準値
  default_acos_target: number;

  // 利益率ベースのACOS上限計算
  // max_acos = profit_margin * profit_to_acos_ratio
  profit_to_acos_ratio: number;

  // 商品戦略別ACOS乗数
  product_strategy_acos_multipliers: Record<ProductStrategy, number>;

  // キーワード戦略別ACOS乗数
  keyword_strategy_acos_multipliers: Record<KeywordStrategy, number>;

  // 入札調整制限
  max_bid_increase_rate: number;
  max_bid_decrease_rate: number;
  min_bid: number;

  // 信頼度しきい値
  min_clicks_for_decision: number;
  min_clicks_for_confident: number;

  // 優先度計算重み
  priority_weights: {
    search_volume: number;
    potential_score: number;
    profit_contribution: number;
    sov_gap: number;
  };
}

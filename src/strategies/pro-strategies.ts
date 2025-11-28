/**
 * Amazon広告プロ戦略モジュール
 *
 * 以下の8つの戦略を実装:
 * 1. アンカーキーワード戦略 - CVR対カテゴリ平均でスコアリング
 * 2. Revenue-Based Bid - 売上ベースの最適入札額計算
 * 3. ローンチ攻め最適化 - LAUNCH_HARDモード強化
 * 4. 広告SKU選択 - SKU別パフォーマンス追跡
 * 5. 季節性追随 - 需要追随型ロジック
 * 6. Bidding Lifecycle - クリック数ベースの入札ライフサイクル管理
 * 7. キャンペーン保護 - 好調キャンペーン保護フラグ
 * 8. 商品レベル TACOS コントローラ - 商品単位のTACOS制御
 */

// =============================================================================
// 型定義
// =============================================================================

/**
 * アンカーキーワードスコア計算の入力
 */
export interface AnchorKeywordInput {
  keyword_id: string;
  keyword_text: string;
  cvr: number;
  category_avg_cvr: number;
  search_volume: number;
  relevance_score: number; // 0-1, 商品との関連性
}

/**
 * アンカーキーワードスコア計算の結果
 */
export interface AnchorKeywordResult {
  keyword_id: string;
  keyword_text: string;
  anchor_score: number;
  cvr_vs_category: number; // CVR / カテゴリ平均
  is_anchor_candidate: boolean;
  recommendation: string;
}

/**
 * ローンチモード設定
 */
export interface LaunchModeConfig {
  is_launch_mode: boolean;
  launch_date: Date | null;
  days_since_launch: number;
  /** ローンチ期間（日数） */
  launch_period_days: number;
  /** ローンチ中のACOS許容倍率 */
  acos_tolerance_multiplier: number;
  /** 最低インプレッション閾値（3時間） */
  min_impressions_3h: number;
}

/**
 * SKUパフォーマンスデータ
 */
export interface SkuPerformance {
  sku: string;
  asin: string;
  variant_name: string; // 例: "60粒", "ブルー", "Mサイズ"
  ad_ctr: number;
  ad_cvr: number;
  ad_roas: number;
  ad_impressions: number;
  ad_clicks: number;
  ad_orders: number;
  total_sales_rank: number; // 全体売上順位（バリエーション内）
  ad_performance_rank: number; // 広告パフォーマンス順位
}

/**
 * 推奨広告SKU結果
 */
export interface RecommendedAdSku {
  recommended_sku: string;
  reason: string;
  performance_score: number;
  is_different_from_bestseller: boolean;
}

/**
 * 需要追随判定の入力
 */
export interface DemandFollowingInput {
  keyword_id: string;
  current_sessions_7d: number;
  previous_year_sessions_7d: number;
  seasonality_score: number; // 0-1, 季節性の強さ
  is_peak_season: boolean;
}

/**
 * 需要追随判定の結果
 */
export interface DemandFollowingResult {
  demand_phase: "PRE_SEASON" | "DEMAND_RISING" | "PEAK" | "POST_PEAK" | "OFF_SEASON";
  acos_multiplier: number;
  bid_aggression: "CONSERVATIVE" | "NORMAL" | "AGGRESSIVE";
  reason: string;
}

/**
 * キャンペーン保護状態
 */
export interface CampaignProtection {
  campaign_id: string;
  is_protected: boolean;
  protection_reason: string | null;
  health_score: number; // 0-100
  roas_trend: "IMPROVING" | "STABLE" | "DECLINING";
  days_since_last_change: number;
}

/**
 * Revenue-Based Bid計算の入力
 */
export interface RevenueBasedBidInput {
  avg_order_value: number;  // 平均注文単価（円）
  cvr: number;              // コンバージョン率（0-1）
  target_acos: number;      // 目標ACOS（0-1）
  safety_margin?: number;   // 安全マージン（デフォルト0.9 = 10%引き）
}

/**
 * Revenue-Based Bid計算の結果
 */
export interface RevenueBasedBidResult {
  optimal_bid: number;      // 最適入札額（円）
  theoretical_bid: number;  // 理論上の最大入札額（安全マージン前）
  breakdown: {
    avg_order_value: number;
    cvr: number;
    target_acos: number;
    safety_margin: number;
  };
  formula: string;          // 計算式の説明
}

/**
 * Bidding Lifecycleフェーズ
 * Phase1: データ収集期 - クリック数不足、慎重に入札
 * Phase2: 最適化期 - 十分なデータあり、Revenue-Based Bidで最適化
 * Phase3: 成長期 - ACOS良好、積極的にスケール
 */
export type BiddingLifecyclePhase = "PHASE1_DATA_COLLECTION" | "PHASE2_OPTIMIZATION" | "PHASE3_GROWTH";

/**
 * Bidding Lifecycle判定の入力
 */
export interface BiddingLifecycleInput {
  keyword_id: string;
  total_clicks: number;       // 累計クリック数
  current_acos: number;       // 現在のACOS（0-1）
  target_acos: number;        // 目標ACOS（0-1）
  current_bid: number;        // 現在の入札額
  avg_order_value: number;    // 平均注文単価
  cvr: number;                // CVR
}

/**
 * Bidding Lifecycle判定の結果
 */
export interface BiddingLifecycleResult {
  phase: BiddingLifecyclePhase;
  phase_name: string;
  acos_tolerance_multiplier: number;  // ACOS許容倍率
  recommended_bid: number;            // 推奨入札額
  bid_strategy: "INCH_UP" | "REVENUE_BASED" | "AGGRESSIVE";
  reason: string;
  next_phase_threshold: string;       // 次フェーズへの条件
}

/**
 * 商品ライフサイクルステージ
 */
export type ProductLifecycleStage = "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST";

/**
 * TACOS コントローラの入力
 */
export interface TacosControllerInput {
  asin: string;
  // 売上・広告関連（過去30日）
  totalSales30d: number;
  adSales30d: number;
  adSpend30d: number;
  organicSales30d: number;
  organicSalesPrev30d: number;
  // 利益関連（商品マスタから）
  /**
   * @deprecated marginRateNormal を使用してください
   */
  marginRate?: number;                   // 粗利率（0-1）- 互換性維持用
  /**
   * 平常時粗利率（0-1）
   * LTV計算とtargetTacosStageの算出に使用
   */
  marginRateNormal?: number;
  expectedRepeatOrdersAssumed?: number;  // 想定リピート回数（LTV商品用）
  ltvSafetyFactor?: number;              // LTV保守係数（0.6-0.8）
  // ライフサイクル
  lifecycleStage: ProductLifecycleStage;
  mode?: "NORMAL" | "S_MODE";
}

/**
 * TACOS コントローラのゾーン判定
 */
export type TacosZone = "STRONG_SUPPRESSION" | "LIGHT_SUPPRESSION" | "AGGRESSIVE" | "NEUTRAL";

/**
 * TACOS コントローラの結果
 */
export interface TacosControllerResult {
  asin: string;
  // 計算された指標
  tacos30d: number;                      // 現在のTACOS
  organicGrowthRate: number;             // 自然検索成長率
  targetTacosStage: number;              // ステージ別目標TACOS
  ltvMultiplierStage: number;            // LTV倍率
  // 補正結果
  productBidMultiplier: number;          // 商品レベル入札補正係数
  zone: TacosZone;                       // 判定ゾーン
  // 内訳
  breakdown: {
    maxTacosStageRaw: number;            // 理論上のTACOS上限
    tacosDiff: number;                   // TACOS偏差
    tacosDiffRate: number;               // TACOS偏差率
    goodOrganicGrowth: boolean;          // 自然検索成長良好
    badOrganicGrowth: boolean;           // 自然検索成長悪化
  };
  reason: string;
}

/**
 * TACOS コントローラの設定
 */
export interface TacosControllerConfig {
  // 自然検索成長率の閾値
  goodOrganicGrowthThreshold: number;    // デフォルト: 0.10 (10%)
  badOrganicGrowthThreshold: number;     // デフォルト: 0.02 (2%)
  // 補正係数
  k1: number;                            // 抑制係数（デフォルト: 0.5）
  k2: number;                            // 攻め係数（デフォルト: 0.5）
  // 最小売上閾値
  minTotalSales30d: number;              // デフォルト: 10000（1万円）
}

// =============================================================================
// 2. Revenue-Based Bid（売上ベース最適入札額）
// =============================================================================

/**
 * Revenue-Based Bidを計算
 *
 * 理論: 最適入札額 = 平均注文単価 × CVR × 目標ACOS
 *
 * この計算式は「1クリックから得られる期待売上」に基づいています:
 * - CVRが5%、平均単価3000円なら、1クリックの期待売上は150円
 * - 目標ACOSが20%なら、その20%（=30円）まで入札できる
 *
 * 安全マージン（デフォルト10%）を適用して、実際の入札額を算出
 */
export function calculateRevenueBasedBid(
  input: RevenueBasedBidInput
): RevenueBasedBidResult {
  const { avg_order_value, cvr, target_acos, safety_margin = 0.9 } = input;

  // 理論上の最大入札額
  const theoretical_bid = avg_order_value * cvr * target_acos;

  // 安全マージン適用後の最適入札額（円単位で四捨五入）
  const optimal_bid = Math.round(theoretical_bid * safety_margin);

  return {
    optimal_bid,
    theoretical_bid,
    breakdown: {
      avg_order_value,
      cvr,
      target_acos,
      safety_margin,
    },
    formula: `${avg_order_value}円 × ${(cvr * 100).toFixed(1)}% × ${(target_acos * 100).toFixed(0)}% × ${(safety_margin * 100).toFixed(0)}% = ${optimal_bid}円`,
  };
}

/**
 * シンプルなRevenue-Based Bid計算（数値のみ返す）
 */
export function calculateRevenueBasedBidSimple(
  avgOrderValue: number,
  cvr: number,
  targetAcos: number,
  safetyMargin: number = 0.9
): number {
  const optimalBid = avgOrderValue * cvr * targetAcos * safetyMargin;
  return Math.round(optimalBid);
}

// =============================================================================
// 6. Bidding Lifecycle（入札ライフサイクル管理）
// =============================================================================

/**
 * Bidding Lifecycleのフェーズを判定
 *
 * Phase1: データ収集期（clicks < 100）
 *   - Inch Up Bidding: 低めの入札から10-15%ずつ増加
 *   - ACOS許容: 目標の3倍まで
 *
 * Phase2: 最適化期（clicks >= 100）
 *   - Revenue-Based Bid: データに基づく最適入札
 *   - ACOS許容: 目標の1.5倍まで
 *
 * Phase3: 成長期（ACOS < 目標 × 0.8）
 *   - Aggressive/TOS: 積極的にスケール
 *   - ACOS許容: 目標の1.2倍まで
 */
export function determineBiddingLifecycle(
  input: BiddingLifecycleInput
): BiddingLifecycleResult {
  const {
    total_clicks,
    current_acos,
    target_acos,
    current_bid,
    avg_order_value,
    cvr,
  } = input;

  // Phase3判定: ACOS良好（目標の80%未満）かつ十分なクリック数
  if (total_clicks >= 100 && current_acos < target_acos * 0.8 && current_acos > 0) {
    // Revenue-Based Bidで計算した上限値
    const revenueBased = calculateRevenueBasedBidSimple(avg_order_value, cvr, target_acos);
    // 積極的に+20%上乗せ（ただしRevenue-Basedの1.3倍を上限）
    const aggressive_bid = Math.min(
      Math.round(current_bid * 1.2),
      Math.round(revenueBased * 1.3)
    );

    return {
      phase: "PHASE3_GROWTH",
      phase_name: "成長期",
      acos_tolerance_multiplier: 1.2,
      recommended_bid: aggressive_bid,
      bid_strategy: "AGGRESSIVE",
      reason: `ACOS ${(current_acos * 100).toFixed(1)}%は目標${(target_acos * 100).toFixed(0)}%を大幅に下回っている。スケールアップ推奨`,
      next_phase_threshold: "ACOSが目標を超えたらPhase2に戻る",
    };
  }

  // Phase2判定: 十分なクリック数がある
  if (total_clicks >= 100) {
    const revenueBased = calculateRevenueBasedBidSimple(avg_order_value, cvr, target_acos);

    return {
      phase: "PHASE2_OPTIMIZATION",
      phase_name: "最適化期",
      acos_tolerance_multiplier: 1.5,
      recommended_bid: revenueBased,
      bid_strategy: "REVENUE_BASED",
      reason: `クリック数${total_clicks}で十分なデータあり。Revenue-Based Bid: ${revenueBased}円を推奨`,
      next_phase_threshold: `ACOSが${(target_acos * 0.8 * 100).toFixed(0)}%未満になればPhase3へ`,
    };
  }

  // Phase1: データ収集期（クリック数不足）
  // Inch Up Bidding: 現在の入札額から10-15%増加
  const inch_up_rate = total_clicks < 50 ? 0.15 : 0.10; // 50クリック未満なら15%、以上なら10%
  const inch_up_bid = Math.round(current_bid * (1 + inch_up_rate));

  // ただしRevenue-Basedの上限は超えない
  const revenueBased = calculateRevenueBasedBidSimple(avg_order_value, cvr, target_acos * 3.0); // ACOS3倍許容
  const recommended = Math.min(inch_up_bid, revenueBased);

  return {
    phase: "PHASE1_DATA_COLLECTION",
    phase_name: "データ収集期",
    acos_tolerance_multiplier: 3.0,
    recommended_bid: recommended,
    bid_strategy: "INCH_UP",
    reason: `クリック数${total_clicks}はまだ不足。Inch Up Bidding: ${current_bid}円 → ${recommended}円（+${(inch_up_rate * 100).toFixed(0)}%）`,
    next_phase_threshold: "クリック数が100以上になればPhase2へ",
  };
}

/**
 * Bidding Lifecycle係数を計算（既存の係数システムと統合用）
 *
 * この係数は基本変化率に乗算されます
 */
export function calculateBiddingLifecycleCoeff(
  phase: BiddingLifecyclePhase
): number {
  switch (phase) {
    case "PHASE1_DATA_COLLECTION":
      return 0.8; // データ不足のため控えめに
    case "PHASE2_OPTIMIZATION":
      return 1.0; // 標準
    case "PHASE3_GROWTH":
      return 1.3; // 積極的にスケール
    default:
      return 1.0;
  }
}

// =============================================================================
// 1. アンカーキーワード戦略
// =============================================================================

/**
 * アンカーキーワードスコアを計算
 *
 * アンカーキーワード = 自社商品との関連性が高く、CVRがカテゴリ平均以上のキーワード
 *
 * スコア計算式:
 * anchor_score = (CVR / カテゴリ平均CVR) × 関連性スコア × log(検索ボリューム)
 */
export function calculateAnchorKeywordScore(
  input: AnchorKeywordInput
): AnchorKeywordResult {
  const { keyword_id, keyword_text, cvr, category_avg_cvr, search_volume, relevance_score } = input;

  // CVR対カテゴリ平均の比率
  const cvr_vs_category = category_avg_cvr > 0 ? cvr / category_avg_cvr : 1;

  // 検索ボリュームの対数スケール（1000を基準に正規化）
  const volume_factor = search_volume > 0 ? Math.log10(search_volume) / Math.log10(1000) : 0;

  // アンカースコア計算
  const anchor_score = cvr_vs_category * relevance_score * Math.max(0.5, volume_factor);

  // アンカー候補判定（CVRがカテゴリ平均の1.2倍以上、かつ関連性0.7以上）
  const is_anchor_candidate = cvr_vs_category >= 1.2 && relevance_score >= 0.7;

  // 推奨コメント生成
  let recommendation: string;
  if (is_anchor_candidate && anchor_score >= 1.5) {
    recommendation = "最優先アンカーキーワード: 積極的に入札強化を推奨";
  } else if (is_anchor_candidate) {
    recommendation = "アンカー候補: CVRが高く関連性も高い。入札維持〜強化";
  } else if (cvr_vs_category >= 1.0) {
    recommendation = "標準キーワード: CVRは平均以上。現状維持";
  } else if (cvr_vs_category >= 0.7) {
    recommendation = "要観察: CVRがやや低い。改善の余地あり";
  } else {
    recommendation = "見直し推奨: CVRが低い。入札抑制または除外検討";
  }

  return {
    keyword_id,
    keyword_text,
    anchor_score,
    cvr_vs_category,
    is_anchor_candidate,
    recommendation,
  };
}

/**
 * キーワードリストからアンカーキーワードを抽出
 */
export function identifyAnchorKeywords(
  keywords: AnchorKeywordInput[]
): AnchorKeywordResult[] {
  const results = keywords.map(calculateAnchorKeywordScore);

  // アンカースコア降順でソート
  return results.sort((a, b) => b.anchor_score - a.anchor_score);
}

// =============================================================================
// 3. ローンチ攻め最適化
// =============================================================================

/**
 * ローンチモード設定を計算
 *
 * ローンチ後72時間（3日間）は特に積極的に、
 * その後14日間は通常より緩いACOS許容で運用
 */
export function calculateLaunchModeConfig(
  launch_date: Date | null,
  current_date: Date = new Date()
): LaunchModeConfig {
  if (!launch_date) {
    return {
      is_launch_mode: false,
      launch_date: null,
      days_since_launch: -1,
      launch_period_days: 14,
      acos_tolerance_multiplier: 1.0,
      min_impressions_3h: 0,
    };
  }

  const days_since_launch = Math.floor(
    (current_date.getTime() - launch_date.getTime()) / (1000 * 60 * 60 * 24)
  );

  // ローンチ期間判定（14日以内）
  const is_launch_mode = days_since_launch >= 0 && days_since_launch <= 14;

  let acos_tolerance_multiplier: number;
  let min_impressions_3h: number;

  if (days_since_launch <= 3) {
    // 最初の72時間: 最も積極的
    acos_tolerance_multiplier = 3.0; // ACOS許容を3倍に
    min_impressions_3h = 100; // 3時間で最低100インプレッション
  } else if (days_since_launch <= 7) {
    // 4-7日目: やや積極的
    acos_tolerance_multiplier = 2.0;
    min_impressions_3h = 50;
  } else if (days_since_launch <= 14) {
    // 8-14日目: 緩やかに通常へ移行
    acos_tolerance_multiplier = 1.5;
    min_impressions_3h = 30;
  } else {
    // 15日目以降: 通常運用
    acos_tolerance_multiplier = 1.0;
    min_impressions_3h = 0;
  }

  return {
    is_launch_mode,
    launch_date,
    days_since_launch,
    launch_period_days: 14,
    acos_tolerance_multiplier,
    min_impressions_3h,
  };
}

/**
 * ローンチモード時の入札調整を計算
 *
 * インプレッション不足の場合は入札を引き上げる
 */
export function calculateLaunchBidAdjustment(
  current_impressions_3h: number,
  launch_config: LaunchModeConfig
): { adjustment_rate: number; reason: string } {
  if (!launch_config.is_launch_mode) {
    return { adjustment_rate: 0, reason: "ローンチモードではない" };
  }

  const { min_impressions_3h, days_since_launch } = launch_config;

  if (min_impressions_3h === 0) {
    return { adjustment_rate: 0, reason: "インプレッション閾値なし" };
  }

  const impression_ratio = current_impressions_3h / min_impressions_3h;

  if (impression_ratio >= 1.0) {
    return {
      adjustment_rate: 0,
      reason: `インプレッション目標達成 (${current_impressions_3h}/${min_impressions_3h})`,
    };
  }

  // インプレッション不足の場合、不足分に応じて入札を引き上げ
  // 50%未満なら+30%、50-80%なら+15%、80%以上なら+5%
  let adjustment_rate: number;
  let severity: string;

  if (impression_ratio < 0.5) {
    adjustment_rate = 0.30;
    severity = "深刻な不足";
  } else if (impression_ratio < 0.8) {
    adjustment_rate = 0.15;
    severity = "やや不足";
  } else {
    adjustment_rate = 0.05;
    severity = "軽微な不足";
  }

  return {
    adjustment_rate,
    reason: `ローンチ${days_since_launch}日目: インプレッション${severity} (${current_impressions_3h}/${min_impressions_3h}) → 入札+${(adjustment_rate * 100).toFixed(0)}%`,
  };
}

// =============================================================================
// 4. 広告SKU選択
// =============================================================================

/**
 * SKUパフォーマンススコアを計算
 *
 * 広告パフォーマンス = CTR × CVR × (1 + log(インプレッション数))
 */
export function calculateSkuPerformanceScore(sku: SkuPerformance): number {
  const { ad_ctr, ad_cvr, ad_impressions } = sku;

  // 最低インプレッション数がないとスコア計算不可
  if (ad_impressions < 100) {
    return 0;
  }

  // インプレッション数の対数ボーナス（データ信頼性）
  const impression_factor = 1 + Math.log10(ad_impressions) / 4;

  return ad_ctr * ad_cvr * impression_factor;
}

/**
 * バリエーション内で最適な広告SKUを推奨
 */
export function recommendAdSku(skus: SkuPerformance[]): RecommendedAdSku | null {
  if (skus.length === 0) {
    return null;
  }

  // 全体売上1位のSKU
  const bestseller = skus.reduce((best, current) =>
    current.total_sales_rank < best.total_sales_rank ? current : best
  );

  // 広告パフォーマンススコアを計算
  const skusWithScore = skus.map((sku) => ({
    ...sku,
    performance_score: calculateSkuPerformanceScore(sku),
  }));

  // スコアが0より大きいSKUのみを対象
  const validSkus = skusWithScore.filter((sku) => sku.performance_score > 0);

  if (validSkus.length === 0) {
    // データ不足の場合はベストセラーを推奨
    return {
      recommended_sku: bestseller.sku,
      reason: "広告データ不足のため、売上1位SKUを推奨",
      performance_score: 0,
      is_different_from_bestseller: false,
    };
  }

  // 広告パフォーマンス1位のSKU
  const topPerformer = validSkus.reduce((best, current) =>
    current.performance_score > best.performance_score ? current : best
  );

  const is_different = topPerformer.sku !== bestseller.sku;

  let reason: string;
  if (is_different) {
    reason = `広告パフォーマンス分析: 「${topPerformer.variant_name}」が売上1位「${bestseller.variant_name}」よりCTR/CVRが高い`;
  } else {
    reason = `売上1位「${bestseller.variant_name}」が広告パフォーマンスも最高`;
  }

  return {
    recommended_sku: topPerformer.sku,
    reason,
    performance_score: topPerformer.performance_score,
    is_different_from_bestseller: is_different,
  };
}

// =============================================================================
// 5. 季節性追随
// =============================================================================

/**
 * 需要フェーズを判定
 *
 * 前年同期比でセッション数の増減を見て、需要の立ち上がりを検知
 */
export function determineDemandPhase(input: DemandFollowingInput): DemandFollowingResult {
  const {
    current_sessions_7d,
    previous_year_sessions_7d,
    seasonality_score,
    is_peak_season,
  } = input;

  // 季節性が低い商品（通年型）は常にNORMAL
  if (seasonality_score < 0.3) {
    return {
      demand_phase: "OFF_SEASON",
      acos_multiplier: 1.0,
      bid_aggression: "NORMAL",
      reason: "通年型商品のため季節性ロジックをスキップ",
    };
  }

  // 前年比の計算
  const yoy_ratio = previous_year_sessions_7d > 0
    ? current_sessions_7d / previous_year_sessions_7d
    : 1.0;

  let demand_phase: DemandFollowingResult["demand_phase"];
  let acos_multiplier: number;
  let bid_aggression: DemandFollowingResult["bid_aggression"];
  let reason: string;

  if (is_peak_season && yoy_ratio >= 1.2) {
    // ピーク期間中かつ前年比+20%以上
    demand_phase = "PEAK";
    acos_multiplier = 1.5;
    bid_aggression = "AGGRESSIVE";
    reason = `需要ピーク検知: 前年比+${((yoy_ratio - 1) * 100).toFixed(0)}%`;
  } else if (yoy_ratio >= 1.2) {
    // 需要立ち上がり（前年比+20%以上）
    demand_phase = "DEMAND_RISING";
    acos_multiplier = 1.3;
    bid_aggression = "AGGRESSIVE";
    reason = `需要上昇中: 前年比+${((yoy_ratio - 1) * 100).toFixed(0)}%。攻め時`;
  } else if (yoy_ratio >= 0.9) {
    // 安定期（前年比-10%〜+20%）
    demand_phase = is_peak_season ? "PEAK" : "OFF_SEASON";
    acos_multiplier = 1.0;
    bid_aggression = "NORMAL";
    reason = `需要安定: 前年比${((yoy_ratio - 1) * 100).toFixed(0)}%`;
  } else if (yoy_ratio >= 0.7) {
    // 需要減少（前年比-10%〜-30%）
    demand_phase = "POST_PEAK";
    acos_multiplier = 0.8;
    bid_aggression = "CONSERVATIVE";
    reason = `需要減少中: 前年比${((yoy_ratio - 1) * 100).toFixed(0)}%。守りに転換`;
  } else {
    // オフシーズン（前年比-30%以下）
    demand_phase = "OFF_SEASON";
    acos_multiplier = 0.6;
    bid_aggression = "CONSERVATIVE";
    reason = `オフシーズン: 前年比${((yoy_ratio - 1) * 100).toFixed(0)}%。ACOS厳格管理`;
  }

  return {
    demand_phase,
    acos_multiplier,
    bid_aggression,
    reason,
  };
}

// =============================================================================
// 7. キャンペーン保護
// =============================================================================

/**
 * キャンペーン健全性スコアを計算
 *
 * 健全性 = ROAS安定性 × パフォーマンス継続日数
 */
export interface CampaignHealthInput {
  campaign_id: string;
  roas_last_7d: number;
  roas_last_14d: number;
  roas_last_30d: number;
  days_since_structure_change: number;
  total_spend_30d: number;
  total_sales_30d: number;
}

export function calculateCampaignHealth(input: CampaignHealthInput): CampaignProtection {
  const {
    campaign_id,
    roas_last_7d,
    roas_last_14d,
    roas_last_30d,
    days_since_structure_change,
    total_spend_30d,
  } = input;

  // ROAS トレンド判定
  let roas_trend: CampaignProtection["roas_trend"];
  if (roas_last_7d > roas_last_14d * 1.1) {
    roas_trend = "IMPROVING";
  } else if (roas_last_7d < roas_last_14d * 0.9) {
    roas_trend = "DECLINING";
  } else {
    roas_trend = "STABLE";
  }

  // 健全性スコア計算（0-100）
  let health_score = 50; // 基準点

  // ROASトレンドボーナス
  if (roas_trend === "IMPROVING") health_score += 20;
  if (roas_trend === "STABLE") health_score += 10;
  if (roas_trend === "DECLINING") health_score -= 10;

  // ROAS絶対値ボーナス（3.0以上で優秀）
  if (roas_last_30d >= 4.0) health_score += 20;
  else if (roas_last_30d >= 3.0) health_score += 15;
  else if (roas_last_30d >= 2.0) health_score += 10;
  else if (roas_last_30d < 1.0) health_score -= 20;

  // 構造変更からの日数ボーナス（安定稼働期間）
  if (days_since_structure_change >= 30) health_score += 10;
  else if (days_since_structure_change >= 14) health_score += 5;

  // 支出ボリュームボーナス（データ信頼性）
  if (total_spend_30d >= 100000) health_score += 10; // 10万円以上
  else if (total_spend_30d >= 30000) health_score += 5; // 3万円以上

  // 0-100に正規化
  health_score = Math.max(0, Math.min(100, health_score));

  // 保護判定（健全性70以上かつROAS安定/改善中）
  const is_protected =
    health_score >= 70 && (roas_trend === "STABLE" || roas_trend === "IMPROVING");

  let protection_reason: string | null = null;
  if (is_protected) {
    protection_reason = `健全性スコア${health_score}、ROAS${roas_trend === "IMPROVING" ? "改善中" : "安定"}のため保護対象`;
  }

  return {
    campaign_id,
    is_protected,
    protection_reason,
    health_score,
    roas_trend,
    days_since_last_change: days_since_structure_change,
  };
}

/**
 * 保護対象キャンペーンへの変更を検証
 *
 * 保護対象キャンペーンには構造変更（キーワード追加/削除、ターゲティング変更）を制限
 */
export function validateCampaignChange(
  protection: CampaignProtection,
  change_type: "KEYWORD_ADD" | "KEYWORD_REMOVE" | "BID_CHANGE" | "STRUCTURE_CHANGE"
): { allowed: boolean; warning: string | null } {
  if (!protection.is_protected) {
    return { allowed: true, warning: null };
  }

  // 入札変更は常に許可
  if (change_type === "BID_CHANGE") {
    return { allowed: true, warning: null };
  }

  // キーワード追加は許可（既存に影響しない）
  if (change_type === "KEYWORD_ADD") {
    return {
      allowed: true,
      warning: "保護対象キャンペーンへのキーワード追加。パフォーマンス監視を推奨",
    };
  }

  // キーワード削除・構造変更は警告
  if (change_type === "KEYWORD_REMOVE" || change_type === "STRUCTURE_CHANGE") {
    return {
      allowed: false,
      warning: `保護対象キャンペーン（健全性${protection.health_score}）への${
        change_type === "KEYWORD_REMOVE" ? "キーワード削除" : "構造変更"
      }はパフォーマンス低下リスクがあります。本当に実行しますか？`,
    };
  }

  return { allowed: true, warning: null };
}

// =============================================================================
// エクスポート用のサマリー関数
// =============================================================================

/**
 * 全戦略を統合したキーワード評価
 */
export interface IntegratedKeywordEvaluation {
  keyword_id: string;
  anchor_score: number | null;
  launch_adjustment: number;
  demand_multiplier: number;
  lifecycle_phase: BiddingLifecyclePhase | null;
  lifecycle_coeff: number;
  revenue_based_bid: number | null;
  final_bid_multiplier: number;
  recommendations: string[];
}

export function evaluateKeywordWithStrategies(
  keyword: {
    keyword_id: string;
    cvr: number;
    category_avg_cvr: number;
    search_volume: number;
    relevance_score: number;
    impressions_3h: number;
    sessions_7d: number;
    sessions_7d_last_year: number;
    seasonality_score: number;
    is_peak_season: boolean;
    // Bidding Lifecycle用の追加フィールド（オプション）
    total_clicks?: number;
    current_acos?: number;
    target_acos?: number;
    current_bid?: number;
    avg_order_value?: number;
  },
  launch_config: LaunchModeConfig
): IntegratedKeywordEvaluation {
  const recommendations: string[] = [];
  let final_multiplier = 1.0;

  // 1. アンカーキーワード評価
  const anchorResult = calculateAnchorKeywordScore({
    keyword_id: keyword.keyword_id,
    keyword_text: "",
    cvr: keyword.cvr,
    category_avg_cvr: keyword.category_avg_cvr,
    search_volume: keyword.search_volume,
    relevance_score: keyword.relevance_score,
  });

  if (anchorResult.is_anchor_candidate) {
    final_multiplier *= 1.15; // アンカーキーワードは+15%
    recommendations.push(`アンカーKW: CVRがカテゴリ平均の${anchorResult.cvr_vs_category.toFixed(1)}倍`);
  }

  // 2. Revenue-Based Bid計算（データがある場合）
  let revenue_based_bid: number | null = null;
  if (keyword.avg_order_value && keyword.cvr && keyword.target_acos) {
    const rbResult = calculateRevenueBasedBid({
      avg_order_value: keyword.avg_order_value,
      cvr: keyword.cvr,
      target_acos: keyword.target_acos,
    });
    revenue_based_bid = rbResult.optimal_bid;
    recommendations.push(`Revenue-Based Bid: ${rbResult.formula}`);
  }

  // 3. ローンチ調整
  const launchAdj = calculateLaunchBidAdjustment(keyword.impressions_3h, launch_config);
  if (launchAdj.adjustment_rate > 0) {
    final_multiplier *= 1 + launchAdj.adjustment_rate;
    recommendations.push(launchAdj.reason);
  }

  // 5. 需要追随
  const demandResult = determineDemandPhase({
    keyword_id: keyword.keyword_id,
    current_sessions_7d: keyword.sessions_7d,
    previous_year_sessions_7d: keyword.sessions_7d_last_year,
    seasonality_score: keyword.seasonality_score,
    is_peak_season: keyword.is_peak_season,
  });

  if (demandResult.acos_multiplier !== 1.0) {
    // 需要フェーズに応じて入札調整（ACOS許容と連動）
    const demand_bid_adj = demandResult.bid_aggression === "AGGRESSIVE" ? 1.1 :
                           demandResult.bid_aggression === "CONSERVATIVE" ? 0.9 : 1.0;
    final_multiplier *= demand_bid_adj;
    recommendations.push(demandResult.reason);
  }

  // 6. Bidding Lifecycle評価（データがある場合）
  let lifecycle_phase: BiddingLifecyclePhase | null = null;
  let lifecycle_coeff = 1.0;
  if (
    keyword.total_clicks !== undefined &&
    keyword.current_acos !== undefined &&
    keyword.target_acos !== undefined &&
    keyword.current_bid !== undefined &&
    keyword.avg_order_value !== undefined
  ) {
    const lifecycleResult = determineBiddingLifecycle({
      keyword_id: keyword.keyword_id,
      total_clicks: keyword.total_clicks,
      current_acos: keyword.current_acos,
      target_acos: keyword.target_acos,
      current_bid: keyword.current_bid,
      avg_order_value: keyword.avg_order_value,
      cvr: keyword.cvr,
    });
    lifecycle_phase = lifecycleResult.phase;
    lifecycle_coeff = calculateBiddingLifecycleCoeff(lifecycle_phase);
    final_multiplier *= lifecycle_coeff;
    recommendations.push(`${lifecycleResult.phase_name}: ${lifecycleResult.reason}`);
  }

  return {
    keyword_id: keyword.keyword_id,
    anchor_score: anchorResult.anchor_score,
    launch_adjustment: launchAdj.adjustment_rate,
    demand_multiplier: demandResult.acos_multiplier,
    lifecycle_phase,
    lifecycle_coeff,
    revenue_based_bid,
    final_bid_multiplier: final_multiplier,
    recommendations,
  };
}

// =============================================================================
// 8. 商品レベル TACOS コントローラ
// =============================================================================

/**
 * ステージ別の係数定義
 */
const STAGE_COEFFICIENTS: Record<ProductLifecycleStage, number> = {
  LAUNCH_HARD: 1.0,
  LAUNCH_SOFT: 0.8,
  GROW: 0.5,
  HARVEST: 0.2,
};

/**
 * ステージ別の目標利益率
 */
const TARGET_PROFIT_RATE: Record<ProductLifecycleStage, number> = {
  LAUNCH_HARD: 0.00,
  LAUNCH_SOFT: 0.05,
  GROW: 0.10,
  HARVEST: 0.15,
};

/**
 * ステージ別のTACOS安全レンジ
 */
const TACOS_SAFE_RANGE: Record<ProductLifecycleStage, { min: number; max: number }> = {
  LAUNCH_HARD: { min: 0.25, max: 0.55 },
  LAUNCH_SOFT: { min: 0.20, max: 0.45 },
  GROW: { min: 0.15, max: 0.35 },
  HARVEST: { min: 0.10, max: 0.25 },
};

/**
 * デフォルト設定
 */
const DEFAULT_TACOS_CONFIG: TacosControllerConfig = {
  goodOrganicGrowthThreshold: 0.10,  // 10%
  badOrganicGrowthThreshold: 0.02,   // 2%
  k1: 0.5,
  k2: 0.5,
  minTotalSales30d: 10000,           // 1万円
};

/**
 * 値をmin-max範囲にクランプする
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * LTV倍率（ltvMultiplierStage）を計算
 *
 * ltvMultiplierStage = 1 + expectedRepeatOrdersAssumed × stageCoefficient × ltvSafetyFactor
 */
export function calculateLtvMultiplierStage(
  expectedRepeatOrdersAssumed: number | undefined,
  ltvSafetyFactor: number | undefined,
  lifecycleStage: ProductLifecycleStage
): number {
  // LTV設定がない場合は1.0
  if (expectedRepeatOrdersAssumed === undefined || ltvSafetyFactor === undefined) {
    return 1.0;
  }

  const stageCoefficient = STAGE_COEFFICIENTS[lifecycleStage];
  return 1 + expectedRepeatOrdersAssumed * stageCoefficient * ltvSafetyFactor;
}

/**
 * ステージ別ターゲットTACOSを計算
 *
 * maxTacosStageRaw = marginRate × ltvMultiplierStage − targetProfitRateStage
 * targetTacosStage = clamp(maxTacosStageRaw, minTacosStage, maxTacosStage)
 */
export function calculateTargetTacosStage(
  marginRate: number,
  ltvMultiplierStage: number,
  lifecycleStage: ProductLifecycleStage
): { targetTacosStage: number; maxTacosStageRaw: number } {
  const targetProfitRate = TARGET_PROFIT_RATE[lifecycleStage];
  const safeRange = TACOS_SAFE_RANGE[lifecycleStage];

  // 理論上のTACOS上限値
  const maxTacosStageRaw = marginRate * ltvMultiplierStage - targetProfitRate;

  // 安全レンジにクランプ
  const targetTacosStage = clamp(maxTacosStageRaw, safeRange.min, safeRange.max);

  return { targetTacosStage, maxTacosStageRaw };
}

/**
 * 商品レベル補正係数（productBidMultiplier）を計算
 *
 * 仕様書セクション18.4に基づく実装:
 * - (a) 強い抑制ゾーン: TACOS > 120%目標 かつ badOrganicGrowth → 0.6-0.8
 * - (b) 軽い抑制ゾーン: TACOS > 105%目標 → 1 - k1 × tacosDiffRate (下限0.8)
 * - (c) 攻めゾーン: TACOS < 80%目標 かつ goodOrganicGrowth → 1 + k2 × |tacosDiffRate| (上限1.3)
 * - (d) ニュートラルゾーン: それ以外 → 1.0
 */
export function calculateProductBidMultiplier(
  input: TacosControllerInput,
  config: Partial<TacosControllerConfig> = {}
): TacosControllerResult {
  const cfg = { ...DEFAULT_TACOS_CONFIG, ...config };
  const {
    asin,
    totalSales30d,
    adSpend30d,
    organicSales30d,
    organicSalesPrev30d,
    marginRate,
    marginRateNormal,
    expectedRepeatOrdersAssumed,
    ltvSafetyFactor,
    lifecycleStage,
  } = input;

  // LTV/TACOS計算では marginRateNormal を優先使用
  // 互換性のため marginRateNormal がなければ marginRate を使用
  const effectiveMarginRate = marginRateNormal ?? marginRate ?? 0.3;

  // データ欠損チェック
  if (totalSales30d < cfg.minTotalSales30d) {
    return {
      asin,
      tacos30d: 0,
      organicGrowthRate: 0,
      targetTacosStage: 0,
      ltvMultiplierStage: 1.0,
      productBidMultiplier: 1.0,
      zone: "NEUTRAL",
      breakdown: {
        maxTacosStageRaw: 0,
        tacosDiff: 0,
        tacosDiffRate: 0,
        goodOrganicGrowth: false,
        badOrganicGrowth: false,
      },
      reason: `データ不足: 売上${totalSales30d}円 < 閾値${cfg.minTotalSales30d}円のためTACOSコントローラ無効`,
    };
  }

  // TACOS計算
  const tacos30d = totalSales30d > 0 ? adSpend30d / totalSales30d : 0;

  // 自然検索成長率計算
  const epsilon = 1; // 0割り防止
  const organicGrowthRate = organicSalesPrev30d > epsilon
    ? (organicSales30d - organicSalesPrev30d) / organicSalesPrev30d
    : 0;

  // LTV倍率計算
  const ltvMultiplierStage = calculateLtvMultiplierStage(
    expectedRepeatOrdersAssumed,
    ltvSafetyFactor,
    lifecycleStage
  );

  // ターゲットTACOS計算（marginRateNormalを使用）
  const { targetTacosStage, maxTacosStageRaw } = calculateTargetTacosStage(
    effectiveMarginRate,
    ltvMultiplierStage,
    lifecycleStage
  );

  // TACOS偏差計算
  const tacosDiff = tacos30d - targetTacosStage;
  const tacosDiffRate = targetTacosStage > 0 ? tacosDiff / targetTacosStage : 0;

  // 自然検索成長の評価
  const goodOrganicGrowth = organicGrowthRate >= cfg.goodOrganicGrowthThreshold;
  const badOrganicGrowth = organicGrowthRate <= cfg.badOrganicGrowthThreshold;

  // ゾーン判定とproductBidMultiplier計算
  let productBidMultiplier: number;
  let zone: TacosZone;
  let reason: string;

  // (a) 強い抑制ゾーン
  if (tacos30d > targetTacosStage * 1.2 && badOrganicGrowth) {
    productBidMultiplier = 0.7; // 初期値0.7（0.6-0.8の中間）
    zone = "STRONG_SUPPRESSION";
    reason = `強い抑制ゾーン: TACOS ${(tacos30d * 100).toFixed(1)}%が目標${(targetTacosStage * 100).toFixed(1)}%の120%超、かつ自然検索成長${(organicGrowthRate * 100).toFixed(1)}%（不調）`;
  }
  // (b) 軽い抑制ゾーン
  else if (tacos30d > targetTacosStage * 1.05) {
    // productBidMultiplier = 1 - k1 × tacosDiffRate（下限0.8）
    const rawMultiplier = 1 - cfg.k1 * tacosDiffRate;
    productBidMultiplier = Math.max(0.8, rawMultiplier);
    zone = "LIGHT_SUPPRESSION";
    reason = `軽い抑制ゾーン: TACOS ${(tacos30d * 100).toFixed(1)}%が目標${(targetTacosStage * 100).toFixed(1)}%の105%超 → 係数${productBidMultiplier.toFixed(2)}`;
  }
  // (c) 攻めゾーン
  else if (tacos30d < targetTacosStage * 0.8 && goodOrganicGrowth) {
    // productBidMultiplier = 1 + k2 × abs(tacosDiffRate)（上限1.3）
    const rawMultiplier = 1 + cfg.k2 * Math.abs(tacosDiffRate);
    productBidMultiplier = Math.min(1.3, rawMultiplier);
    zone = "AGGRESSIVE";
    reason = `攻めゾーン: TACOS ${(tacos30d * 100).toFixed(1)}%が目標${(targetTacosStage * 100).toFixed(1)}%の80%未満、かつ自然検索成長${(organicGrowthRate * 100).toFixed(1)}%（好調）→ 係数${productBidMultiplier.toFixed(2)}`;
  }
  // (d) ニュートラルゾーン
  else {
    productBidMultiplier = 1.0;
    zone = "NEUTRAL";
    reason = `ニュートラルゾーン: TACOS ${(tacos30d * 100).toFixed(1)}%は目標${(targetTacosStage * 100).toFixed(1)}%付近`;
  }

  return {
    asin,
    tacos30d,
    organicGrowthRate,
    targetTacosStage,
    ltvMultiplierStage,
    productBidMultiplier,
    zone,
    breakdown: {
      maxTacosStageRaw,
      tacosDiff,
      tacosDiffRate,
      goodOrganicGrowth,
      badOrganicGrowth,
    },
    reason,
  };
}

/**
 * シンプルなproductBidMultiplier計算（数値のみ返す）
 */
export function calculateProductBidMultiplierSimple(
  input: TacosControllerInput,
  config: Partial<TacosControllerConfig> = {}
): number {
  return calculateProductBidMultiplier(input, config).productBidMultiplier;
}

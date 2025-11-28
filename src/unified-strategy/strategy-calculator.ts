/**
 * 統合入札戦略エンジン - 戦略計算ロジック
 *
 * 商品収益性 × キーワード戦略 × 広告パフォーマンス を統合して
 * 最終的な入札アクションと動的ACOS目標を決定する
 */

import { logger } from "../logger";
import {
  ProductProfitability,
  ProductStrategy,
  ProductLifecycle,
  KeywordStrategy,
  UnifiedBidStrategy,
  BidAction,
  DynamicAcosConfig,
  UnifiedStrategySummary,
} from "./types";
import {
  DEFAULT_UNIFIED_CONFIG,
  getStrategyMatrixCell,
  determineProductLifecycle,
  recommendProductStrategy,
} from "./config";
import { KeywordStrategyAnalysis, AsinShareOfVoice } from "../jungle-scout/types";

// =============================================================================
// 動的ACOS計算
// =============================================================================

/**
 * 動的ACOS目標を計算
 */
export function calculateDynamicAcos(
  profitMargin: number,
  productStrategy: ProductStrategy,
  keywordStrategy: KeywordStrategy,
  config = DEFAULT_UNIFIED_CONFIG
): DynamicAcosConfig {
  // 利益率ベースのACOS上限
  const profitBasedLimit = profitMargin * config.profit_to_acos_ratio;

  // 基準ACOS
  const baseAcos = config.default_acos_target;

  // 商品戦略乗数
  const productMultiplier =
    config.product_strategy_acos_multipliers[productStrategy];

  // キーワード戦略乗数
  const keywordMultiplier =
    config.keyword_strategy_acos_multipliers[keywordStrategy];

  // 最終ACOS目標（利益率上限を超えない）
  const calculatedAcos = baseAcos * productMultiplier * keywordMultiplier;
  const finalAcosTarget = Math.min(calculatedAcos, profitBasedLimit);

  // ハードストップ（利益率の100%）
  const hardStop = profitMargin;

  // ソフトリミット（目標の1.5倍）
  const softLimit = finalAcosTarget * 1.5;

  return {
    base_acos_target: baseAcos,
    product_strategy_multiplier: productMultiplier,
    keyword_strategy_multiplier: keywordMultiplier,
    profit_margin_limit: profitBasedLimit,
    final_acos_target: finalAcosTarget,
    acos_hard_stop: hardStop,
    acos_soft_limit: Math.min(softLimit, hardStop),
  };
}

// =============================================================================
// 入札アクション決定
// =============================================================================

/**
 * 入札調整率を計算
 */
function calculateBidAdjustment(
  matrixCell: ReturnType<typeof getStrategyMatrixCell>,
  currentAcos: number,
  targetAcos: number,
  hardStopAcos: number,
  clicks: number,
  config = DEFAULT_UNIFIED_CONFIG
): { rate: number; action: BidAction; constraints: string[] } {
  const constraints: string[] = [];
  let rate = 0;

  // マトリックスの推奨レンジを取得
  const { min, max } = matrixCell.bid_adjustment_range;
  const baseAction = matrixCell.recommended_action;

  // ACOSベースの調整
  if (currentAcos > hardStopAcos) {
    // ハードストップ超え → 強制減額
    rate = -0.5;
    constraints.push(`ACOS ${(currentAcos * 100).toFixed(1)}% がハードストップ ${(hardStopAcos * 100).toFixed(1)}% を超過`);
    return { rate, action: "STRONG_DOWN", constraints };
  }

  if (currentAcos > targetAcos * 1.5) {
    // 目標の1.5倍超え → 減額方向に調整
    rate = Math.max(min, -0.2);
    constraints.push(`ACOS ${(currentAcos * 100).toFixed(1)}% が目標 ${(targetAcos * 100).toFixed(1)}% を大幅超過`);
  } else if (currentAcos > targetAcos) {
    // 目標超え → やや減額方向
    rate = Math.max(min, (max + min) / 2 - 0.1);
    constraints.push(`ACOS ${(currentAcos * 100).toFixed(1)}% が目標をやや超過`);
  } else if (currentAcos < targetAcos * 0.5) {
    // 目標の半分以下 → 増額余地あり
    rate = Math.min(max, (max + min) / 2 + 0.15);
    constraints.push(`ACOS ${(currentAcos * 100).toFixed(1)}% が目標より大幅に低い、増額余地あり`);
  } else {
    // 目標範囲内 → マトリックス推奨の中央値
    rate = (max + min) / 2;
  }

  // クリック数による信頼度調整
  if (clicks < config.min_clicks_for_decision) {
    rate = rate * 0.5; // データ不足時は控えめ
    constraints.push(`クリック数 ${clicks} がしきい値 ${config.min_clicks_for_decision} 未満、調整控えめ`);
  } else if (clicks < config.min_clicks_for_confident) {
    rate = rate * 0.75;
    constraints.push(`クリック数 ${clicks} が信頼しきい値 ${config.min_clicks_for_confident} 未満`);
  }

  // レート制限
  rate = Math.max(config.max_bid_decrease_rate, Math.min(config.max_bid_increase_rate, rate));

  // アクション決定
  let action: BidAction;
  if (rate > 0.3) {
    action = "STRONG_UP";
  } else if (rate > 0.1) {
    action = "MILD_UP";
  } else if (rate > -0.1) {
    action = "KEEP";
  } else if (rate > -0.3) {
    action = "MILD_DOWN";
  } else if (rate > -0.7) {
    action = "STRONG_DOWN";
  } else {
    action = "STOP";
  }

  return { rate, action, constraints };
}

// =============================================================================
// 優先度スコア計算
// =============================================================================

/**
 * キーワードの優先度スコアを計算（予算配分用）
 */
export function calculatePriorityScore(
  searchVolume: number,
  potentialScore: number,
  profitContribution: number, // 推定利益貢献度
  sovGap: number, // 目標SOVとの差
  matrixPriorityBoost: number,
  config = DEFAULT_UNIFIED_CONFIG
): number {
  const weights = config.priority_weights;

  // 検索ボリュームスコア（0-100に正規化）
  const volumeScore = Math.min(100, (searchVolume / 10000) * 100);

  // SOVギャップスコア（正の場合は成長機会）
  const sovScore = Math.max(0, Math.min(100, sovGap * 5));

  // 重み付け合計
  const baseScore =
    volumeScore * weights.search_volume +
    potentialScore * weights.potential_score +
    profitContribution * weights.profit_contribution +
    sovScore * weights.sov_gap;

  // マトリックスブーストを適用
  return baseScore * matrixPriorityBoost;
}

// =============================================================================
// メインAPI: 統合戦略計算
// =============================================================================

/**
 * 単一キーワードの統合戦略を計算
 */
export function calculateUnifiedStrategy(
  // 商品情報
  product: ProductProfitability,
  productStrategy: ProductStrategy,
  productLifecycle: ProductLifecycle,
  // キーワード戦略（Jungle Scout由来）
  keywordAnalysis: KeywordStrategyAnalysis,
  // 広告パフォーマンス
  adMetrics: {
    keyword_id: string;
    campaign_id: string;
    ad_group_id: string;
    current_bid: number;
    current_acos: number;
    current_cvr: number;
    current_ctr: number;
    clicks_30d: number;
    impressions_30d: number;
  },
  config = DEFAULT_UNIFIED_CONFIG
): UnifiedBidStrategy {
  const keywordStrategy = keywordAnalysis.recommended_strategy as KeywordStrategy;

  // 戦略マトリックスから推奨を取得
  const matrixCell = getStrategyMatrixCell(productStrategy, keywordStrategy);

  // 動的ACOS目標を計算
  const acosConfig = calculateDynamicAcos(
    product.profit_margin,
    productStrategy,
    keywordStrategy,
    config
  );

  // 入札調整を計算
  const { rate, action, constraints } = calculateBidAdjustment(
    matrixCell,
    adMetrics.current_acos,
    acosConfig.final_acos_target,
    acosConfig.acos_hard_stop,
    adMetrics.clicks_30d,
    config
  );

  // 推奨入札額を計算
  let recommendedBid = adMetrics.current_bid * (1 + rate);
  recommendedBid = Math.max(config.min_bid, recommendedBid);

  // 優先度スコアを計算
  const profitContribution =
    (keywordAnalysis.search_volume / 10000) *
    product.profit_margin *
    (adMetrics.current_cvr || 0.01) *
    100;

  const targetSov = keywordStrategy === "invest" ? 20 : keywordStrategy === "defend" ? keywordAnalysis.current_sov : 10;
  const sovGap = targetSov - keywordAnalysis.current_sov;

  const priorityScore = calculatePriorityScore(
    keywordAnalysis.search_volume,
    keywordAnalysis.potential_score,
    profitContribution,
    sovGap,
    matrixCell.priority_boost,
    config
  );

  // 信頼度スコア
  const confidenceScore =
    adMetrics.clicks_30d >= config.min_clicks_for_confident
      ? 1.0
      : adMetrics.clicks_30d >= config.min_clicks_for_decision
        ? 0.7
        : 0.4;

  // 戦略理由を構築
  const strategyReason = `${matrixCell.description}。` +
    `商品戦略=${productStrategy}(${productLifecycle})、` +
    `KW戦略=${keywordStrategy}、` +
    `ACOS目標=${(acosConfig.final_acos_target * 100).toFixed(1)}%`;

  return {
    asin: product.asin,
    keyword: keywordAnalysis.keyword,
    keyword_id: adMetrics.keyword_id,
    campaign_id: adMetrics.campaign_id,
    ad_group_id: adMetrics.ad_group_id,
    marketplace: keywordAnalysis.marketplace,

    product_strategy: productStrategy,
    product_lifecycle: productLifecycle,
    product_profit_margin: product.profit_margin,

    keyword_strategy: keywordStrategy,
    organic_rank: keywordAnalysis.current_organic_rank,
    sponsored_rank: keywordAnalysis.current_sponsored_rank,
    share_of_voice: keywordAnalysis.current_sov,
    search_volume: keywordAnalysis.search_volume,
    keyword_potential_score: keywordAnalysis.potential_score,

    current_acos: adMetrics.current_acos,
    current_cvr: adMetrics.current_cvr,
    current_ctr: adMetrics.current_ctr,
    current_bid: adMetrics.current_bid,
    clicks_30d: adMetrics.clicks_30d,
    impressions_30d: adMetrics.impressions_30d,

    final_action: action,
    dynamic_acos_target: acosConfig.final_acos_target,
    recommended_bid: recommendedBid,
    bid_adjustment_rate: rate,

    strategy_reason: strategyReason,
    constraints_applied: constraints,

    priority_score: priorityScore,
    confidence_score: confidenceScore,

    analyzed_at: new Date(),
  };
}

/**
 * ASIN全体の統合戦略を計算
 */
export function calculateUnifiedStrategiesForAsin(
  product: ProductProfitability,
  keywordAnalyses: KeywordStrategyAnalysis[],
  adMetricsMap: Map<
    string,
    {
      keyword_id: string;
      campaign_id: string;
      ad_group_id: string;
      current_bid: number;
      current_acos: number;
      current_cvr: number;
      current_ctr: number;
      clicks_30d: number;
      impressions_30d: number;
    }
  >,
  config = DEFAULT_UNIFIED_CONFIG
): UnifiedBidStrategy[] {
  // 商品ライフサイクルを判定
  const lifecycle = determineProductLifecycle(
    product.sales_growth_rate,
    product.total_sales_30d
  );

  // 商品戦略を推奨
  const productStrategy = recommendProductStrategy(
    lifecycle,
    product.profit_margin,
    product.ad_dependency_ratio,
    product.total_roas
  );

  logger.info("Calculating unified strategies for ASIN", {
    asin: product.asin,
    lifecycle,
    productStrategy,
    keywordCount: keywordAnalyses.length,
  });

  const strategies: UnifiedBidStrategy[] = [];

  for (const kwAnalysis of keywordAnalyses) {
    const adMetrics = adMetricsMap.get(kwAnalysis.keyword);

    if (!adMetrics) {
      // 広告データがない場合はデフォルト値で計算
      const defaultAdMetrics = {
        keyword_id: `kw_${kwAnalysis.keyword.replace(/\s+/g, "_")}`,
        campaign_id: "unknown",
        ad_group_id: "unknown",
        current_bid: 50, // デフォルト50円
        current_acos: 0,
        current_cvr: 0,
        current_ctr: 0,
        clicks_30d: 0,
        impressions_30d: 0,
      };

      strategies.push(
        calculateUnifiedStrategy(
          product,
          productStrategy,
          lifecycle,
          kwAnalysis,
          defaultAdMetrics,
          config
        )
      );
    } else {
      strategies.push(
        calculateUnifiedStrategy(
          product,
          productStrategy,
          lifecycle,
          kwAnalysis,
          adMetrics,
          config
        )
      );
    }
  }

  // 優先度でソート
  strategies.sort((a, b) => b.priority_score - a.priority_score);

  return strategies;
}

// =============================================================================
// サマリー生成
// =============================================================================

/**
 * 統合戦略サマリーを生成
 */
export function generateUnifiedStrategySummary(
  product: ProductProfitability,
  strategies: UnifiedBidStrategy[]
): UnifiedStrategySummary {
  if (strategies.length === 0) {
    throw new Error("No strategies to summarize");
  }

  const firstStrategy = strategies[0];

  // キーワード戦略別集計
  const keywordsByStrategy: Record<KeywordStrategy, number> = {
    invest: 0,
    defend: 0,
    harvest: 0,
    optimize: 0,
    reduce: 0,
  };

  // アクション別集計
  const actionsBreakdown: Record<BidAction, number> = {
    STRONG_UP: 0,
    MILD_UP: 0,
    KEEP: 0,
    MILD_DOWN: 0,
    STRONG_DOWN: 0,
    STOP: 0,
  };

  let totalSearchVolume = 0;
  let totalSov = 0;

  for (const s of strategies) {
    keywordsByStrategy[s.keyword_strategy]++;
    actionsBreakdown[s.final_action]++;
    totalSearchVolume += s.search_volume;
    totalSov += s.share_of_voice;
  }

  const avgSov = totalSov / strategies.length;

  // 予算配分推奨
  const totalKeywords = strategies.length;
  const budgetAllocation = {
    invest_keywords: keywordsByStrategy.invest / totalKeywords,
    defend_keywords: keywordsByStrategy.defend / totalKeywords,
    harvest_keywords: keywordsByStrategy.harvest / totalKeywords,
    optimize_keywords: keywordsByStrategy.optimize / totalKeywords,
    reduce_keywords: keywordsByStrategy.reduce / totalKeywords,
  };

  // 期待効果（簡易推定）
  const investRatio = keywordsByStrategy.invest / totalKeywords;
  const reduceRatio = keywordsByStrategy.reduce / totalKeywords;

  const expectedImpact = {
    estimated_sales_change: (investRatio * 0.2 - reduceRatio * 0.1) * 100, // 投資で+20%、削減で-10%
    estimated_acos_change: investRatio * 0.05 - reduceRatio * 0.03, // 投資でACOS+5%、削減で-3%
    estimated_sov_change: investRatio * 5 - reduceRatio * 2, // 投資でSOV+5%、削減で-2%
  };

  return {
    asin: product.asin,
    marketplace: firstStrategy.marketplace,
    product_strategy: firstStrategy.product_strategy,
    product_lifecycle: firstStrategy.product_lifecycle,
    total_sales_30d: product.total_sales_30d,
    profit_margin: product.profit_margin,
    ad_dependency_ratio: product.ad_dependency_ratio,
    total_keywords: totalKeywords,
    keywords_by_strategy: keywordsByStrategy,
    total_search_volume: totalSearchVolume,
    avg_share_of_voice: avgSov,
    actions_breakdown: actionsBreakdown,
    recommended_budget_allocation: budgetAllocation,
    expected_impact: expectedImpact,
    analyzed_at: new Date(),
  };
}

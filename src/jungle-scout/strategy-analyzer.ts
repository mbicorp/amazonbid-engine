/**
 * キーワード戦略分析ロジック
 *
 * Jungle ScoutのSOVデータとキーワードインテリジェンスを基に
 * 各キーワードの推奨戦略を決定する
 */

import { logger } from "../logger";
import {
  JungleScoutMarketplace,
  AsinShareOfVoice,
  KeywordIntelligence,
  KeywordStrategy,
  KeywordStrategyAnalysis,
} from "./types";

// =============================================================================
// 戦略決定ロジック
// =============================================================================

/**
 * 戦略決定のしきい値
 */
const STRATEGY_THRESHOLDS = {
  // SOVしきい値
  HIGH_SOV: 15, // 15%以上 = 高シェア
  MEDIUM_SOV: 5, // 5%以上 = 中シェア
  LOW_SOV: 1, // 1%未満 = 低シェア

  // ランクしきい値
  TOP_ORGANIC_RANK: 10,
  TOP_SPONSORED_RANK: 5,

  // ポテンシャルスコアしきい値
  HIGH_POTENTIAL: 70,
  MEDIUM_POTENTIAL: 40,

  // 競合レベルしきい値
  HIGH_COMPETITION_PRODUCTS: 100,
  MEDIUM_COMPETITION_PRODUCTS: 50,

  // 検索ボリュームしきい値
  HIGH_VOLUME: 10000,
  MEDIUM_VOLUME: 1000,

  // トレンドしきい値
  STRONG_UPTREND: 20, // 20%以上の上昇
  MODERATE_UPTREND: 5,
  STRONG_DOWNTREND: -20,

  // ACOS目標
  HARVEST_ACOS_TARGET: 0.15, // 15%
  INVEST_ACOS_TARGET: 0.35, // 35%
  DEFEND_ACOS_TARGET: 0.25, // 25%
  OPTIMIZE_ACOS_TARGET: 0.20, // 20%
  REDUCE_ACOS_TARGET: 0.10, // 10%
};

/**
 * 競合レベルを判定
 */
function determineCompetitionLevel(
  organicProductCount: number,
  sponsoredProductCount: number
): "low" | "medium" | "high" {
  const totalProducts = organicProductCount + sponsoredProductCount;

  if (totalProducts >= STRATEGY_THRESHOLDS.HIGH_COMPETITION_PRODUCTS) {
    return "high";
  }
  if (totalProducts >= STRATEGY_THRESHOLDS.MEDIUM_COMPETITION_PRODUCTS) {
    return "medium";
  }
  return "low";
}

/**
 * ポテンシャルスコアを計算（0-100）
 */
function calculatePotentialScore(
  searchVolume: number,
  easeOfRankingScore: number,
  trendingPercentage: number,
  competitionLevel: "low" | "medium" | "high",
  currentSov: number
): number {
  // 検索ボリュームスコア（0-30）
  let volumeScore = 0;
  if (searchVolume >= STRATEGY_THRESHOLDS.HIGH_VOLUME) {
    volumeScore = 30;
  } else if (searchVolume >= STRATEGY_THRESHOLDS.MEDIUM_VOLUME) {
    volumeScore = 20;
  } else {
    volumeScore = Math.min(10, (searchVolume / STRATEGY_THRESHOLDS.MEDIUM_VOLUME) * 10);
  }

  // ランキング難易度スコア（0-25）- ease_of_ranking_scoreが高いほど良い
  const easeScore = Math.min(25, easeOfRankingScore * 25);

  // トレンドスコア（0-20）
  let trendScore = 10; // ベース
  if (trendingPercentage >= STRATEGY_THRESHOLDS.STRONG_UPTREND) {
    trendScore = 20;
  } else if (trendingPercentage >= STRATEGY_THRESHOLDS.MODERATE_UPTREND) {
    trendScore = 15;
  } else if (trendingPercentage <= STRATEGY_THRESHOLDS.STRONG_DOWNTREND) {
    trendScore = 0;
  }

  // 競合スコア（0-15）- 競合が少ないほど良い
  const competitionScore =
    competitionLevel === "low" ? 15 : competitionLevel === "medium" ? 10 : 5;

  // 成長余地スコア（0-10）- 現在のSOVが低いほど成長余地がある
  const growthRoomScore = Math.max(0, 10 - currentSov / 2);

  return Math.min(
    100,
    volumeScore + easeScore + trendScore + competitionScore + growthRoomScore
  );
}

/**
 * 入札調整率を計算（-1.0 ~ +1.0）
 */
function calculateBidAdjustment(
  strategy: KeywordStrategy,
  potentialScore: number,
  currentSov: number,
  organicRank: number | null
): number {
  switch (strategy) {
    case "harvest":
      // 高SOV・高ランク → 効率重視で入札を維持または微減
      return organicRank && organicRank <= 3 ? -0.1 : 0;

    case "invest":
      // 低SOV・高ポテンシャル → 積極投資
      const investMultiplier = potentialScore / 100;
      return 0.3 + investMultiplier * 0.4; // 0.3 ~ 0.7

    case "defend":
      // 高SOV・競合増加 → 維持のため適度に入札
      return 0.1 + (100 - currentSov) / 500; // 0.1 ~ 0.3

    case "optimize":
      // 中SOV → 効率を見ながら調整
      return potentialScore > 60 ? 0.15 : potentialScore > 40 ? 0 : -0.1;

    case "reduce":
      // 低ポテンシャル → 大幅削減
      return -0.3 - (100 - potentialScore) / 200; // -0.3 ~ -0.8
  }
}

/**
 * 戦略を決定
 */
function determineStrategy(
  sov: AsinShareOfVoice,
  intelligence: KeywordIntelligence | null,
  competitionLevel: "low" | "medium" | "high",
  potentialScore: number
): { strategy: KeywordStrategy; reason: string } {
  const { organic_rank, combined_sov } = sov;

  // ケース1: 高SOV（15%以上）
  if (combined_sov >= STRATEGY_THRESHOLDS.HIGH_SOV) {
    // 競合が増加中なら防衛
    if (
      intelligence?.trending_direction === "up" &&
      intelligence.sponsored_product_count > 20
    ) {
      return {
        strategy: "defend",
        reason: `高シェア(${combined_sov.toFixed(1)}%)だが競合広告増加中のため防衛戦略`,
      };
    }
    // そうでなければ収穫
    return {
      strategy: "harvest",
      reason: `高シェア(${combined_sov.toFixed(1)}%)・オーガニックランク${organic_rank || "圏外"}のため効率重視`,
    };
  }

  // ケース2: 中SOV（5-15%）
  if (combined_sov >= STRATEGY_THRESHOLDS.MEDIUM_SOV) {
    // ポテンシャルが高ければ投資
    if (potentialScore >= STRATEGY_THRESHOLDS.HIGH_POTENTIAL) {
      return {
        strategy: "invest",
        reason: `中シェア(${combined_sov.toFixed(1)}%)・高ポテンシャル(${potentialScore.toFixed(0)})のため成長投資`,
      };
    }
    // そうでなければ最適化
    return {
      strategy: "optimize",
      reason: `中シェア(${combined_sov.toFixed(1)}%)のためROI最適化`,
    };
  }

  // ケース3: 低SOV（5%未満）
  // ポテンシャルが高ければ投資
  if (potentialScore >= STRATEGY_THRESHOLDS.HIGH_POTENTIAL) {
    return {
      strategy: "invest",
      reason: `低シェア(${combined_sov.toFixed(1)}%)だが高ポテンシャル(${potentialScore.toFixed(0)})のため積極投資`,
    };
  }

  // 中程度のポテンシャルなら最適化
  if (potentialScore >= STRATEGY_THRESHOLDS.MEDIUM_POTENTIAL) {
    return {
      strategy: "optimize",
      reason: `低シェア(${combined_sov.toFixed(1)}%)・中ポテンシャル(${potentialScore.toFixed(0)})のため慎重最適化`,
    };
  }

  // 低ポテンシャルなら削減
  return {
    strategy: "reduce",
    reason: `低シェア(${combined_sov.toFixed(1)}%)・低ポテンシャル(${potentialScore.toFixed(0)})のため予算削減`,
  };
}

/**
 * ACOS目標を取得
 */
function getAcosTarget(strategy: KeywordStrategy): number {
  switch (strategy) {
    case "harvest":
      return STRATEGY_THRESHOLDS.HARVEST_ACOS_TARGET;
    case "invest":
      return STRATEGY_THRESHOLDS.INVEST_ACOS_TARGET;
    case "defend":
      return STRATEGY_THRESHOLDS.DEFEND_ACOS_TARGET;
    case "optimize":
      return STRATEGY_THRESHOLDS.OPTIMIZE_ACOS_TARGET;
    case "reduce":
      return STRATEGY_THRESHOLDS.REDUCE_ACOS_TARGET;
  }
}

// =============================================================================
// メインAPI
// =============================================================================

/**
 * 単一キーワードの戦略を分析
 */
export function analyzeKeywordStrategy(
  sov: AsinShareOfVoice,
  intelligence: KeywordIntelligence | null
): KeywordStrategyAnalysis {
  // 競合レベルを判定
  const competitionLevel = intelligence
    ? determineCompetitionLevel(
        intelligence.organic_product_count,
        intelligence.sponsored_product_count
      )
    : "medium";

  // ポテンシャルスコアを計算
  const potentialScore = intelligence
    ? calculatePotentialScore(
        sov.search_volume,
        intelligence.ease_of_ranking_score,
        intelligence.trending_percentage,
        competitionLevel,
        sov.combined_sov
      )
    : 50; // デフォルト中間値

  // 戦略を決定
  const { strategy, reason } = determineStrategy(
    sov,
    intelligence,
    competitionLevel,
    potentialScore
  );

  // 入札調整率を計算
  const bidAdjustment = calculateBidAdjustment(
    strategy,
    potentialScore,
    sov.combined_sov,
    sov.organic_rank
  );

  // ACOS目標を取得
  const acosTarget = getAcosTarget(strategy);

  return {
    keyword: sov.keyword,
    asin: sov.asin,
    marketplace: sov.marketplace,
    current_organic_rank: sov.organic_rank,
    current_sponsored_rank: sov.sponsored_rank,
    current_sov: sov.combined_sov,
    search_volume: sov.search_volume,
    recommended_strategy: strategy,
    strategy_reason: reason,
    recommended_bid_adjustment: bidAdjustment,
    recommended_acos_target: acosTarget,
    potential_score: potentialScore,
    competition_level: competitionLevel,
    analyzed_at: new Date(),
  };
}

/**
 * 複数キーワードの戦略を一括分析
 */
export function analyzeKeywordsStrategy(
  sovList: AsinShareOfVoice[],
  intelligenceMap: Map<string, KeywordIntelligence>
): KeywordStrategyAnalysis[] {
  logger.info("Analyzing keyword strategies", { count: sovList.length });

  const results: KeywordStrategyAnalysis[] = [];

  for (const sov of sovList) {
    const intelligence = intelligenceMap.get(sov.keyword) || null;
    const analysis = analyzeKeywordStrategy(sov, intelligence);
    results.push(analysis);
  }

  // 戦略別の集計をログ
  const strategyCounts = results.reduce(
    (acc, r) => {
      acc[r.recommended_strategy] = (acc[r.recommended_strategy] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  logger.info("Strategy analysis completed", {
    total: results.length,
    breakdown: strategyCounts,
  });

  return results;
}

/**
 * 戦略サマリーを生成
 */
export function generateStrategySummary(
  analyses: KeywordStrategyAnalysis[]
): {
  strategyBreakdown: Record<
    KeywordStrategy,
    {
      count: number;
      totalVolume: number;
      avgSov: number;
      avgPotential: number;
      avgBidAdjustment: number;
    }
  >;
  topInvestKeywords: KeywordStrategyAnalysis[];
  topHarvestKeywords: KeywordStrategyAnalysis[];
  reduceKeywords: KeywordStrategyAnalysis[];
  totalSearchVolume: number;
  avgOverallSov: number;
} {
  const strategies: KeywordStrategy[] = [
    "harvest",
    "invest",
    "defend",
    "optimize",
    "reduce",
  ];

  const strategyBreakdown = {} as Record<
    KeywordStrategy,
    {
      count: number;
      totalVolume: number;
      avgSov: number;
      avgPotential: number;
      avgBidAdjustment: number;
    }
  >;

  for (const strategy of strategies) {
    const items = analyses.filter((a) => a.recommended_strategy === strategy);
    strategyBreakdown[strategy] = {
      count: items.length,
      totalVolume: items.reduce((sum, i) => sum + i.search_volume, 0),
      avgSov:
        items.length > 0
          ? items.reduce((sum, i) => sum + i.current_sov, 0) / items.length
          : 0,
      avgPotential:
        items.length > 0
          ? items.reduce((sum, i) => sum + i.potential_score, 0) / items.length
          : 0,
      avgBidAdjustment:
        items.length > 0
          ? items.reduce((sum, i) => sum + i.recommended_bid_adjustment, 0) /
            items.length
          : 0,
    };
  }

  // 投資対象トップキーワード
  const topInvestKeywords = analyses
    .filter((a) => a.recommended_strategy === "invest")
    .sort((a, b) => b.potential_score - a.potential_score)
    .slice(0, 10);

  // 収穫対象トップキーワード
  const topHarvestKeywords = analyses
    .filter((a) => a.recommended_strategy === "harvest")
    .sort((a, b) => b.search_volume - a.search_volume)
    .slice(0, 10);

  // 削減対象キーワード
  const reduceKeywords = analyses
    .filter((a) => a.recommended_strategy === "reduce")
    .sort((a, b) => a.potential_score - b.potential_score);

  return {
    strategyBreakdown,
    topInvestKeywords,
    topHarvestKeywords,
    reduceKeywords,
    totalSearchVolume: analyses.reduce((sum, a) => sum + a.search_volume, 0),
    avgOverallSov:
      analyses.length > 0
        ? analyses.reduce((sum, a) => sum + a.current_sov, 0) / analyses.length
        : 0,
  };
}

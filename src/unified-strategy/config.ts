/**
 * 統合入札戦略エンジン - 設定
 */

import {
  UnifiedStrategyConfig,
  ProductStrategy,
  KeywordStrategy,
  BidAction,
  StrategyMatrixCell,
} from "./types";

// =============================================================================
// デフォルト設定
// =============================================================================

export const DEFAULT_UNIFIED_CONFIG: UnifiedStrategyConfig = {
  // ACOS基準値（20%）
  default_acos_target: 0.20,

  // 利益率→ACOS上限変換率
  // 例: 利益率40% × 0.8 = ACOS上限32%
  profit_to_acos_ratio: 0.8,

  // 商品戦略別ACOS乗数
  product_strategy_acos_multipliers: {
    aggressive_growth: 1.75, // 積極成長: ACOS 35%まで許容
    balanced_growth: 1.25, // バランス: ACOS 25%まで
    profit_maximize: 0.75, // 利益重視: ACOS 15%まで
    maintenance: 1.0, // 維持: 基準通り
    harvest: 0.5, // 収穫: ACOS 10%まで
  },

  // キーワード戦略別ACOS乗数
  keyword_strategy_acos_multipliers: {
    invest: 1.5, // 投資: 50%増し
    defend: 1.25, // 防衛: 25%増し
    harvest: 0.75, // 収穫: 25%減
    optimize: 1.0, // 最適化: 基準通り
    reduce: 0.5, // 削減: 50%減
  },

  // 入札調整制限
  max_bid_increase_rate: 1.5, // 最大+150%
  max_bid_decrease_rate: -0.8, // 最大-80%
  min_bid: 2, // 最低入札額（円）

  // 信頼度しきい値
  min_clicks_for_decision: 10,
  min_clicks_for_confident: 30,

  // 優先度計算重み
  priority_weights: {
    search_volume: 0.3,
    potential_score: 0.25,
    profit_contribution: 0.25,
    sov_gap: 0.2,
  },
};

// =============================================================================
// 戦略マトリックス
// 商品戦略 × キーワード戦略 → 推奨アクション
// =============================================================================

export const STRATEGY_MATRIX: StrategyMatrixCell[] = [
  // ===== aggressive_growth（積極成長）=====
  {
    product_strategy: "aggressive_growth",
    keyword_strategy: "invest",
    recommended_action: "STRONG_UP",
    acos_multiplier: 2.0,
    bid_adjustment_range: { min: 0.3, max: 1.0 },
    priority_boost: 1.5,
    description: "積極成長×投資: 最優先で入札強化、ACOS緩和",
  },
  {
    product_strategy: "aggressive_growth",
    keyword_strategy: "defend",
    recommended_action: "MILD_UP",
    acos_multiplier: 1.5,
    bid_adjustment_range: { min: 0.1, max: 0.4 },
    priority_boost: 1.3,
    description: "積極成長×防衛: シェア維持のため入札強化",
  },
  {
    product_strategy: "aggressive_growth",
    keyword_strategy: "harvest",
    recommended_action: "KEEP",
    acos_multiplier: 1.2,
    bid_adjustment_range: { min: -0.1, max: 0.1 },
    priority_boost: 1.0,
    description: "積極成長×収穫: 効率キーワードは現状維持",
  },
  {
    product_strategy: "aggressive_growth",
    keyword_strategy: "optimize",
    recommended_action: "MILD_UP",
    acos_multiplier: 1.3,
    bid_adjustment_range: { min: 0.05, max: 0.25 },
    priority_boost: 1.1,
    description: "積極成長×最適化: やや強化して成長促進",
  },
  {
    product_strategy: "aggressive_growth",
    keyword_strategy: "reduce",
    recommended_action: "KEEP",
    acos_multiplier: 1.0,
    bid_adjustment_range: { min: -0.2, max: 0 },
    priority_boost: 0.8,
    description: "積極成長×削減: 成長優先のため維持",
  },

  // ===== balanced_growth（バランス成長）=====
  {
    product_strategy: "balanced_growth",
    keyword_strategy: "invest",
    recommended_action: "MILD_UP",
    acos_multiplier: 1.5,
    bid_adjustment_range: { min: 0.15, max: 0.5 },
    priority_boost: 1.3,
    description: "バランス×投資: 収益性を見つつ投資",
  },
  {
    product_strategy: "balanced_growth",
    keyword_strategy: "defend",
    recommended_action: "MILD_UP",
    acos_multiplier: 1.25,
    bid_adjustment_range: { min: 0.05, max: 0.25 },
    priority_boost: 1.2,
    description: "バランス×防衛: シェア維持重視",
  },
  {
    product_strategy: "balanced_growth",
    keyword_strategy: "harvest",
    recommended_action: "KEEP",
    acos_multiplier: 0.9,
    bid_adjustment_range: { min: -0.1, max: 0.05 },
    priority_boost: 1.0,
    description: "バランス×収穫: 効率維持",
  },
  {
    product_strategy: "balanced_growth",
    keyword_strategy: "optimize",
    recommended_action: "KEEP",
    acos_multiplier: 1.0,
    bid_adjustment_range: { min: -0.1, max: 0.15 },
    priority_boost: 1.0,
    description: "バランス×最適化: ROI改善に注力",
  },
  {
    product_strategy: "balanced_growth",
    keyword_strategy: "reduce",
    recommended_action: "MILD_DOWN",
    acos_multiplier: 0.7,
    bid_adjustment_range: { min: -0.3, max: -0.1 },
    priority_boost: 0.7,
    description: "バランス×削減: 非効率は縮小",
  },

  // ===== profit_maximize（利益最大化）=====
  {
    product_strategy: "profit_maximize",
    keyword_strategy: "invest",
    recommended_action: "KEEP",
    acos_multiplier: 1.0,
    bid_adjustment_range: { min: 0, max: 0.2 },
    priority_boost: 1.0,
    description: "利益重視×投資: 慎重に投資",
  },
  {
    product_strategy: "profit_maximize",
    keyword_strategy: "defend",
    recommended_action: "KEEP",
    acos_multiplier: 0.9,
    bid_adjustment_range: { min: -0.1, max: 0.1 },
    priority_boost: 0.9,
    description: "利益重視×防衛: 効率的に維持",
  },
  {
    product_strategy: "profit_maximize",
    keyword_strategy: "harvest",
    recommended_action: "MILD_DOWN",
    acos_multiplier: 0.7,
    bid_adjustment_range: { min: -0.2, max: 0 },
    priority_boost: 1.1,
    description: "利益重視×収穫: 効率最大化",
  },
  {
    product_strategy: "profit_maximize",
    keyword_strategy: "optimize",
    recommended_action: "MILD_DOWN",
    acos_multiplier: 0.8,
    bid_adjustment_range: { min: -0.15, max: 0.05 },
    priority_boost: 1.0,
    description: "利益重視×最適化: 効率改善優先",
  },
  {
    product_strategy: "profit_maximize",
    keyword_strategy: "reduce",
    recommended_action: "STRONG_DOWN",
    acos_multiplier: 0.5,
    bid_adjustment_range: { min: -0.5, max: -0.2 },
    priority_boost: 0.5,
    description: "利益重視×削減: 大幅縮小",
  },

  // ===== maintenance（維持）=====
  {
    product_strategy: "maintenance",
    keyword_strategy: "invest",
    recommended_action: "KEEP",
    acos_multiplier: 1.1,
    bid_adjustment_range: { min: 0, max: 0.15 },
    priority_boost: 0.9,
    description: "維持×投資: 控えめに投資",
  },
  {
    product_strategy: "maintenance",
    keyword_strategy: "defend",
    recommended_action: "KEEP",
    acos_multiplier: 1.0,
    bid_adjustment_range: { min: -0.05, max: 0.1 },
    priority_boost: 1.0,
    description: "維持×防衛: 現状維持",
  },
  {
    product_strategy: "maintenance",
    keyword_strategy: "harvest",
    recommended_action: "KEEP",
    acos_multiplier: 0.85,
    bid_adjustment_range: { min: -0.1, max: 0 },
    priority_boost: 1.0,
    description: "維持×収穫: 効率維持",
  },
  {
    product_strategy: "maintenance",
    keyword_strategy: "optimize",
    recommended_action: "KEEP",
    acos_multiplier: 0.9,
    bid_adjustment_range: { min: -0.1, max: 0.05 },
    priority_boost: 0.9,
    description: "維持×最適化: 微調整",
  },
  {
    product_strategy: "maintenance",
    keyword_strategy: "reduce",
    recommended_action: "MILD_DOWN",
    acos_multiplier: 0.6,
    bid_adjustment_range: { min: -0.3, max: -0.1 },
    priority_boost: 0.6,
    description: "維持×削減: 縮小",
  },

  // ===== harvest（収穫）=====
  {
    product_strategy: "harvest",
    keyword_strategy: "invest",
    recommended_action: "MILD_DOWN",
    acos_multiplier: 0.7,
    bid_adjustment_range: { min: -0.2, max: 0 },
    priority_boost: 0.6,
    description: "収穫×投資: 投資控え、効率重視",
  },
  {
    product_strategy: "harvest",
    keyword_strategy: "defend",
    recommended_action: "MILD_DOWN",
    acos_multiplier: 0.6,
    bid_adjustment_range: { min: -0.25, max: -0.05 },
    priority_boost: 0.7,
    description: "収穫×防衛: 最小限の防衛",
  },
  {
    product_strategy: "harvest",
    keyword_strategy: "harvest",
    recommended_action: "STRONG_DOWN",
    acos_multiplier: 0.5,
    bid_adjustment_range: { min: -0.4, max: -0.15 },
    priority_boost: 1.0,
    description: "収穫×収穫: 最大効率で回収",
  },
  {
    product_strategy: "harvest",
    keyword_strategy: "optimize",
    recommended_action: "MILD_DOWN",
    acos_multiplier: 0.55,
    bid_adjustment_range: { min: -0.3, max: -0.1 },
    priority_boost: 0.8,
    description: "収穫×最適化: 効率改善",
  },
  {
    product_strategy: "harvest",
    keyword_strategy: "reduce",
    recommended_action: "STOP",
    acos_multiplier: 0.3,
    bid_adjustment_range: { min: -0.8, max: -0.5 },
    priority_boost: 0.3,
    description: "収穫×削減: 停止検討",
  },
];

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 戦略マトリックスからセルを取得
 */
export function getStrategyMatrixCell(
  productStrategy: ProductStrategy,
  keywordStrategy: KeywordStrategy
): StrategyMatrixCell {
  const cell = STRATEGY_MATRIX.find(
    (c) =>
      c.product_strategy === productStrategy &&
      c.keyword_strategy === keywordStrategy
  );

  if (!cell) {
    // デフォルト（維持×最適化）
    return {
      product_strategy: productStrategy,
      keyword_strategy: keywordStrategy,
      recommended_action: "KEEP",
      acos_multiplier: 1.0,
      bid_adjustment_range: { min: -0.1, max: 0.1 },
      priority_boost: 1.0,
      description: "デフォルト: 現状維持",
    };
  }

  return cell;
}

/**
 * 商品ライフサイクルを判定
 */
export function determineProductLifecycle(
  salesGrowthRate: number,
  totalSales30d: number,
  daysSinceLaunch?: number
): "launch" | "growth" | "mature" | "decline" {
  // 新商品判定（90日以内）
  if (daysSinceLaunch !== undefined && daysSinceLaunch < 90) {
    return "launch";
  }

  // 成長率ベースの判定
  if (salesGrowthRate > 0.15) {
    return "growth";
  }
  if (salesGrowthRate < -0.15) {
    return "decline";
  }
  return "mature";
}

/**
 * 商品戦略を推奨
 */
export function recommendProductStrategy(
  lifecycle: "launch" | "growth" | "mature" | "decline",
  profitMargin: number,
  adDependencyRatio: number,
  totalRoas: number
): ProductStrategy {
  // 新商品: 積極成長
  if (lifecycle === "launch") {
    return "aggressive_growth";
  }

  // 成長期
  if (lifecycle === "growth") {
    if (profitMargin > 0.3 && totalRoas > 3) {
      return "aggressive_growth";
    }
    return "balanced_growth";
  }

  // 衰退期
  if (lifecycle === "decline") {
    if (totalRoas < 2) {
      return "harvest";
    }
    return "maintenance";
  }

  // 成熟期
  if (profitMargin > 0.4 && adDependencyRatio < 0.3) {
    return "profit_maximize";
  }
  if (totalRoas > 4) {
    return "balanced_growth";
  }
  if (totalRoas < 2) {
    return "harvest";
  }
  return "maintenance";
}

// =============================================================================
// BigQueryテーブル設定
// =============================================================================

export const UNIFIED_BIGQUERY_TABLES = {
  PRODUCT_PROFITABILITY: "product_profitability",
  UNIFIED_STRATEGY: "unified_bid_strategy",
  STRATEGY_SUMMARY: "unified_strategy_summary",
};

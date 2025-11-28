/**
 * SEO投資戦略のテスト
 */

import {
  DEFAULT_SEO_INVESTMENT_CONFIG,
  evaluateSeoInvestmentOpportunity,
  calculateDynamicInvestmentLimit,
  calculateSeoInvestmentAcosLimit,
  updateSeoInvestmentState,
} from "../src/unified-strategy/seo-investment";
import {
  SeoInvestmentState,
  SeoInvestmentConfig,
  ProductProfitability,
} from "../src/unified-strategy/types";
import { KeywordStrategyAnalysis } from "../src/jungle-scout/types";

describe("seo-investment", () => {
  const defaultConfig: SeoInvestmentConfig = {
    ...DEFAULT_SEO_INVESTMENT_CONFIG,
    enabled: true,
  };

  const createMockProduct = (overrides: Partial<ProductProfitability> = {}): ProductProfitability => ({
    asin: "B001234567",
    marketplace: "jp",
    total_sales_30d: 100000,
    total_sales_previous_30d: 90000,
    ad_sales_30d: 50000,
    organic_sales_30d: 50000,
    profit_margin: 0.3,
    unit_profit: 500,
    ad_spend_30d: 15000,
    total_ad_cost: 15000,
    ad_dependency_ratio: 0.5,
    sales_growth_rate: 0.11,
    total_roas: 6.67,
    ad_roas: 3.33,
    profit_after_ad: 15000,
    updated_at: new Date(),
    ...overrides,
  });

  const createMockKeywordAnalysis = (overrides: Partial<KeywordStrategyAnalysis> = {}): KeywordStrategyAnalysis => ({
    asin: "B001234567",
    keyword: "test keyword",
    marketplace: "jp",
    search_volume: 10000,
    current_organic_rank: 50,
    current_sponsored_rank: 10,
    current_sov: 0.05,
    competition_level: "medium" as const,
    recommended_strategy: "invest" as const,
    recommended_bid_adjustment: 0.2,
    recommended_acos_target: 0.25,
    potential_score: 80,
    strategy_reason: "高ポテンシャルキーワード",
    analyzed_at: new Date(),
    ...overrides,
  });

  const createMockState = (overrides: Partial<SeoInvestmentState> = {}): SeoInvestmentState => ({
    asin: "B001234567",
    keyword: "test keyword",
    marketplace: "jp",
    phase: "initial",
    started_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7日前
    current_day: 7,
    rank_history: [],
    initial_organic_rank: 50,
    current_organic_rank: 40,
    best_organic_rank: 35,
    total_investment: 10000,
    total_ad_spend: 50000,
    total_sales: 40000,
    daily_investments: [],
    rank_improvement: 10,
    weeks_without_improvement: 0,
    estimated_organic_value: 100000, // 月間10万円の価値
    roi_projection: 6, // 6ヶ月で回収
    ...overrides,
  });

  describe("evaluateSeoInvestmentOpportunity", () => {
    it("should evaluate investment opportunity for high search volume keywords", () => {
      const product = createMockProduct();
      const keywordAnalysis = createMockKeywordAnalysis({
        keyword: "ビッグキーワード",
        search_volume: 50000,
        current_organic_rank: 50, // 圏内だが改善の余地あり
      });

      const result = evaluateSeoInvestmentOpportunity(
        product,
        keywordAnalysis,
        0.2, // competitorMaxSov
        defaultConfig
      );

      // 投資判定が行われ、結果が返されること
      expect(result.risk_level).toBeDefined();
      expect(result.recommendation_reason).toBeDefined();
      expect(typeof result.should_invest).toBe("boolean");
      expect(result.estimated_investment_needed).toBeGreaterThanOrEqual(0);
    });

    it("should skip investment for low search volume keywords", () => {
      const product = createMockProduct();
      const keywordAnalysis = createMockKeywordAnalysis({
        keyword: "ニッチキーワード",
        search_volume: 100, // 最小検索ボリューム未満
        current_organic_rank: 100,
      });

      const result = evaluateSeoInvestmentOpportunity(
        product,
        keywordAnalysis,
        0.2,
        { ...defaultConfig, min_search_volume: 500 }
      );

      expect(result.should_invest).toBe(false);
      expect(result.recommended_phase).toBe("skip");
    });

    it("should skip investment for keywords already ranking well", () => {
      const product = createMockProduct();
      const keywordAnalysis = createMockKeywordAnalysis({
        keyword: "既に良好なキーワード",
        search_volume: 10000,
        current_organic_rank: 5, // 既に上位
      });

      const result = evaluateSeoInvestmentOpportunity(
        product,
        keywordAnalysis,
        0.2,
        { ...defaultConfig, target_organic_rank: 10 }
      );

      expect(result.should_invest).toBe(false);
    });

    it("should skip investment for low profit margin products", () => {
      const product = createMockProduct({ profit_margin: 0.05 }); // 5%の利益率
      const keywordAnalysis = createMockKeywordAnalysis({
        keyword: "低利益率商品",
        search_volume: 10000,
        current_organic_rank: 100,
      });

      const result = evaluateSeoInvestmentOpportunity(
        product,
        keywordAnalysis,
        0.2,
        { ...defaultConfig, min_profit_margin: 0.15 }
      );

      expect(result.should_invest).toBe(false);
    });

    it("should identify high risk when competitor SOV is high", () => {
      const product = createMockProduct();
      const keywordAnalysis = createMockKeywordAnalysis({
        search_volume: 10000,
        current_organic_rank: 50, // 圏内だが改善の余地あり（80位だとvery_highになる）
      });

      const result = evaluateSeoInvestmentOpportunity(
        product,
        keywordAnalysis,
        0.5, // 50% SOV - 高競合
        { ...defaultConfig, max_competition_sov: 0.4 }
      );

      // 高競合でリスクを評価（競合SOVが高いのでhighかvery_high）
      expect(["high", "very_high"]).toContain(result.risk_level);
      expect(result.risk_factors.length).toBeGreaterThan(0);
    });
  });

  describe("calculateDynamicInvestmentLimit", () => {
    it("should calculate investment limit based on monthly profit", () => {
      const limit = calculateDynamicInvestmentLimit(
        50000, // monthlyProfit: 月間利益5万円
        30000, // estimatedOrganicValue: 月間オーガニック価値3万円
        defaultConfig
      );

      expect(limit.profitBasedLimit).toBeGreaterThan(0);
      expect(limit.organicValueBasedLimit).toBeGreaterThan(0);
      expect(limit.effectiveLimit).toBeGreaterThan(0);
      expect(limit.explanation).toBeDefined();
    });

    it("should use the smaller of profit-based and organic-value-based limits", () => {
      // 月間利益が大きく、オーガニック価値が小さい場合
      const limit = calculateDynamicInvestmentLimit(
        100000, // 月間利益10万円
        10000, // オーガニック価値1万円
        defaultConfig
      );

      // effectiveLimitは両方の上限の小さい方
      expect(limit.effectiveLimit).toBeLessThanOrEqual(limit.profitBasedLimit);
      expect(limit.effectiveLimit).toBeLessThanOrEqual(limit.organicValueBasedLimit);
    });
  });

  describe("calculateSeoInvestmentAcosLimit", () => {
    it("should return higher ACOS limit for initial phase", () => {
      const initialLimit = calculateSeoInvestmentAcosLimit(0.3, "initial", defaultConfig);
      const maintenanceLimit = calculateSeoInvestmentAcosLimit(0.3, "maintenance", defaultConfig);

      // 初期フェーズは維持フェーズより高いACOSを許容
      expect(initialLimit).toBeGreaterThan(maintenanceLimit);
    });

    it("should return lower ACOS limit for maintenance phase", () => {
      const accelerationLimit = calculateSeoInvestmentAcosLimit(0.3, "acceleration", defaultConfig);
      const maintenanceLimit = calculateSeoInvestmentAcosLimit(0.3, "maintenance", defaultConfig);

      // 維持フェーズは加速フェーズより低いACOS
      expect(maintenanceLimit).toBeLessThan(accelerationLimit);
    });

    it("should return minimal ACOS limit for exit phase", () => {
      const exitLimit = calculateSeoInvestmentAcosLimit(0.3, "exit", defaultConfig);
      const profitMargin = 0.3;

      // 撤退フェーズでは大幅な赤字は許可しない
      // exitの赤字許容率は0.1なので、ACOS上限は profitMargin + profitMargin * 0.1 = 0.33
      expect(exitLimit).toBeLessThan(profitMargin * 1.5);
    });
  });

  describe("updateSeoInvestmentState", () => {
    it("should track rank history", () => {
      const state = createMockState({
        rank_history: [],
      });

      const result = updateSeoInvestmentState(
        state,
        35, // currentOrganicRank
        5000, // todayAdSpend
        4000, // todaySales
        30000, // monthlyProfit
        20000, // estimatedOrganicValue
        defaultConfig
      );

      expect(result.updatedState.rank_history.length).toBeGreaterThan(0);
      expect(result.updatedState.rank_history[result.updatedState.rank_history.length - 1].organic_rank).toBe(35);
    });

    it("should update investment totals", () => {
      const state = createMockState({
        total_ad_spend: 50000,
        total_sales: 40000,
        total_investment: 10000,
      });

      const result = updateSeoInvestmentState(
        state,
        40, // currentOrganicRank
        5000, // todayAdSpend
        3000, // todaySales (赤字)
        30000,
        20000,
        defaultConfig
      );

      expect(result.updatedState.total_ad_spend).toBe(55000);
      expect(result.updatedState.total_sales).toBe(43000);
    });

    it("should update best rank when improved", () => {
      const state = createMockState({
        best_organic_rank: 40,
        current_organic_rank: 40,
      });

      const result = updateSeoInvestmentState(
        state,
        30, // 改善
        5000,
        4000,
        30000,
        20000,
        defaultConfig
      );

      expect(result.updatedState.best_organic_rank).toBe(30);
      expect(result.updatedState.current_organic_rank).toBe(30);
    });

    it("should increment current_day", () => {
      const state = createMockState({
        current_day: 10,
      });

      const result = updateSeoInvestmentState(
        state,
        40,
        5000,
        4000,
        30000,
        20000,
        defaultConfig
      );

      expect(result.updatedState.current_day).toBe(11);
    });

    it("should mark as abandoned when max days exceeded", () => {
      const state = createMockState({
        phase: "acceleration",
        current_day: defaultConfig.exit_conditions.max_investment_days + 1,
      });

      const result = updateSeoInvestmentState(
        state,
        40,
        5000,
        4000,
        30000,
        20000,
        defaultConfig
      );

      expect(result.action).toBe("abandon");
      expect(result.updatedState.phase).toBe("abandoned");
    });
  });
});

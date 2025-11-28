/**
 * キーワード自動発見エンジンのテスト
 */

// uuid モジュールをモック
jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-12345678"),
}));

import {
  normalizeKeyword,
  discoverNewKeywordsFromSearchTerms,
  mergeAndScoreCandidates,
} from "../src/keywordDiscovery/engine";
import {
  CandidateKeyword,
  KeywordDiscoveryConfig,
  DEFAULT_KEYWORD_DISCOVERY_CONFIG,
  SearchTermReportRow,
  ExistingKeyword,
  ProductConfigForDiscovery,
  createEmptyJungleScoutMetrics,
} from "../src/keywordDiscovery/types";

describe("keyword-discovery", () => {
  // テスト用のデフォルト設定
  const defaultConfig: KeywordDiscoveryConfig = {
    ...DEFAULT_KEYWORD_DISCOVERY_CONFIG,
  };

  // テスト用の検索語レポート行を作成
  const createSearchTermRow = (
    overrides: Partial<SearchTermReportRow> = {}
  ): SearchTermReportRow => ({
    profile_id: "profile-001",
    asin: "B001234567",
    campaign_id: "campaign-001",
    ad_group_id: "adgroup-001",
    query: "test keyword",
    match_type: "AUTO",
    impressions: 500,
    clicks: 10,
    orders: 2,
    sales: 5000,
    cost: 1000,
    acos: 0.2,
    cvr: 0.2,
    ...overrides,
  });

  // テスト用の既存キーワードを作成
  const createExistingKeyword = (
    overrides: Partial<ExistingKeyword> = {}
  ): ExistingKeyword => ({
    asin: "B001234567",
    keyword: "existing keyword",
    normalizedKeyword: "existing keyword",
    matchType: "EXACT",
    ...overrides,
  });

  // テスト用の商品設定を作成
  const createProductConfig = (
    asin: string,
    overrides: Partial<ProductConfigForDiscovery> = {}
  ): ProductConfigForDiscovery => ({
    asin,
    profileId: "profile-001",
    targetAcos: 0.3,
    lifecycleState: "NORMAL",
    categoryBaselineCvr: 0.02,
    ...overrides,
  });

  describe("normalizeKeyword", () => {
    it("should convert to lowercase", () => {
      expect(normalizeKeyword("Test KEYWORD")).toBe("test keyword");
    });

    it("should trim whitespace", () => {
      expect(normalizeKeyword("  test keyword  ")).toBe("test keyword");
    });

    it("should collapse multiple spaces", () => {
      expect(normalizeKeyword("test   keyword")).toBe("test keyword");
    });

    it("should convert full-width characters to half-width", () => {
      // 全角英数字
      expect(normalizeKeyword("ＡＢＣＤ１２３４")).toBe("abcd1234");
    });

    it("should convert full-width space to half-width", () => {
      expect(normalizeKeyword("test　keyword")).toBe("test keyword");
    });

    it("should handle mixed input", () => {
      expect(normalizeKeyword("  ＴＥＳＴ　keyword  ")).toBe("test keyword");
    });

    it("should handle empty string", () => {
      expect(normalizeKeyword("")).toBe("");
    });

    it("should handle single character", () => {
      expect(normalizeKeyword("A")).toBe("a");
    });
  });

  describe("discoverNewKeywordsFromSearchTerms", () => {
    it("should discover candidates from valid search terms", () => {
      const searchTerms = [
        createSearchTermRow({
          query: "promising keyword",
          impressions: 500,
          clicks: 10,
          orders: 2,
          sales: 5000,
          cost: 1000,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates, stats } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0].query).toBe("promising keyword");
      expect(candidates[0].normalizedQuery).toBe("promising keyword");
      expect(candidates[0].source).toBe("SEARCH_TERM");
      expect(candidates[0].state).toBe("PENDING_REVIEW");
      expect(candidates[0].score).toBeGreaterThan(0);
      expect(stats.searchTermCandidates).toBe(1);
    });

    it("should exclude existing keywords", () => {
      const searchTerms = [
        createSearchTermRow({
          query: "existing keyword",
        }),
      ];
      const existingKeywords = [
        createExistingKeyword({
          asin: "B001234567",
          normalizedKeyword: "existing keyword",
        }),
      ];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates, stats } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(0);
      expect(stats.duplicatesExcluded).toBe(1);
    });

    it("should exclude search terms below impression threshold", () => {
      const searchTerms = [
        createSearchTermRow({
          impressions: 30, // Below excludeBelowImpressions (50)
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates, stats } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(0);
      expect(stats.belowThresholdExcluded).toBe(1);
    });

    it("should exclude search terms with zero clicks when configured", () => {
      const searchTerms = [
        createSearchTermRow({
          impressions: 500,
          clicks: 0,
          orders: 0,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates, stats } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        { ...defaultConfig, excludeZeroClicks: true }
      );

      expect(candidates.length).toBe(0);
      expect(stats.belowThresholdExcluded).toBe(1);
    });

    it("should exclude search terms with clicks below minimum", () => {
      const searchTerms = [
        createSearchTermRow({
          impressions: 500,
          clicks: 2, // Below minClicks7d (3)
          orders: 1,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates, stats } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(0);
      expect(stats.belowThresholdExcluded).toBeGreaterThan(0);
    });

    it("should exclude search terms with high clicks but zero orders", () => {
      const searchTerms = [
        createSearchTermRow({
          impressions: 500,
          clicks: 25, // High clicks
          orders: 0,  // Zero orders
          sales: 0,
          cost: 500,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates, stats } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(0);
      expect(stats.belowThresholdExcluded).toBe(1);
    });

    it("should calculate correct match type for high-order keywords", () => {
      const searchTerms = [
        createSearchTermRow({
          query: "high order keyword",
          impressions: 1000,
          clicks: 50,
          orders: 5, // >= 3 should suggest EXACT
          sales: 10000,
          cost: 2000,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0].suggestedMatchType).toBe("EXACT");
    });

    it("should calculate correct match type for short keywords", () => {
      const searchTerms = [
        createSearchTermRow({
          query: "short", // 1 word should suggest EXACT
          impressions: 500,
          clicks: 10,
          orders: 2,
          sales: 5000,
          cost: 1000,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0].suggestedMatchType).toBe("EXACT");
    });

    it("should calculate correct match type for long-tail keywords", () => {
      const searchTerms = [
        createSearchTermRow({
          query: "this is a long tail keyword phrase", // > 2 words, low orders
          impressions: 500,
          clicks: 10,
          orders: 1, // < 3, should suggest PHRASE
          sales: 2500,
          cost: 500,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(1);
      expect(candidates[0].suggestedMatchType).toBe("PHRASE");
    });

    it("should process multiple ASINs", () => {
      const searchTerms = [
        createSearchTermRow({
          asin: "B001234567",
          query: "keyword for asin 1",
          impressions: 500,
          clicks: 10,
          orders: 2,
        }),
        createSearchTermRow({
          asin: "B009876543",
          query: "keyword for asin 2",
          impressions: 500,
          clicks: 10,
          orders: 2,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));
      productConfigs.set("B009876543", createProductConfig("B009876543"));

      const { candidates, stats } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(2);
      expect(stats.totalAsinsProcessed).toBe(2);
    });

    it("should use default target_acos for search terms without product config", () => {
      const searchTerms = [
        createSearchTermRow({
          asin: "B999999999", // No config for this ASIN
          query: "orphan keyword",
          impressions: 500,
          clicks: 10,
          orders: 2,
        }),
      ];
      const existingKeywords: ExistingKeyword[] = [];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      // No config for B999999999 - will use defaults (targetAcos=0.3, categoryBaselineCvr=0.02)

      const { candidates } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      // Should still process with default target_acos
      expect(candidates.length).toBe(1);
      expect(candidates[0].asin).toBe("B999999999");
    });

    it("should track statistics correctly", () => {
      const searchTerms = [
        createSearchTermRow({ query: "valid 1", impressions: 500, clicks: 10, orders: 2 }),
        createSearchTermRow({ query: "valid 2", impressions: 500, clicks: 10, orders: 2 }),
        createSearchTermRow({ query: "low impressions", impressions: 30, clicks: 1, orders: 0 }),
        createSearchTermRow({ query: "existing keyword", impressions: 500, clicks: 10, orders: 2 }),
      ];
      const existingKeywords = [
        createExistingKeyword({ normalizedKeyword: "existing keyword" }),
      ];
      const productConfigs = new Map<string, ProductConfigForDiscovery>();
      productConfigs.set("B001234567", createProductConfig("B001234567"));

      const { candidates, stats } = discoverNewKeywordsFromSearchTerms(
        searchTerms,
        existingKeywords,
        productConfigs,
        defaultConfig
      );

      expect(candidates.length).toBe(2);
      expect(stats.totalSearchTermsProcessed).toBe(4);
      expect(stats.duplicatesExcluded).toBe(1);
      expect(stats.belowThresholdExcluded).toBe(1);
      expect(stats.searchTermCandidates).toBe(2);
    });
  });

  describe("mergeAndScoreCandidates", () => {
    // テスト用の候補を作成
    const createCandidate = (
      overrides: Partial<CandidateKeyword> = {}
    ): CandidateKeyword => ({
      id: "candidate-001",
      asin: "B001234567",
      query: "test keyword",
      normalizedQuery: "test keyword",
      suggestedMatchType: "EXACT",
      source: "SEARCH_TERM",
      searchTermMetrics: {
        impressions7d: 500,
        clicks7d: 10,
        orders7d: 2,
        sales7d: 5000,
        cost7d: 1000,
        acos7d: 0.2,
        cvr7d: 0.2,
        cpc7d: 100,
      },
      jungleScoutMetrics: null,
      score: 50,
      scoreBreakdown: {
        searchTermScore: 50,
        jungleScoutScore: 0,
        weights: { searchTerm: 1, jungleScout: 0 },
      },
      state: "PENDING_REVIEW",
      discoveredAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    it("should merge search term candidates only", () => {
      const searchTermCandidates = [
        createCandidate({ id: "st-1", normalizedQuery: "keyword one", score: 60 }),
        createCandidate({ id: "st-2", normalizedQuery: "keyword two", score: 40 }),
      ];
      const jungleScoutCandidates: CandidateKeyword[] = [];

      const merged = mergeAndScoreCandidates(
        searchTermCandidates,
        jungleScoutCandidates,
        defaultConfig
      );

      expect(merged.length).toBe(2);
      expect(merged[0].source).toBe("SEARCH_TERM");
      expect(merged[1].source).toBe("SEARCH_TERM");
    });

    it("should sort by score descending", () => {
      const searchTermCandidates = [
        createCandidate({ id: "st-1", normalizedQuery: "low score", score: 30 }),
        createCandidate({ id: "st-2", normalizedQuery: "high score", score: 80 }),
        createCandidate({ id: "st-3", normalizedQuery: "mid score", score: 50 }),
      ];
      const jungleScoutCandidates: CandidateKeyword[] = [];

      const merged = mergeAndScoreCandidates(
        searchTermCandidates,
        jungleScoutCandidates,
        defaultConfig
      );

      expect(merged.length).toBe(3);
      expect(merged[0].score).toBe(80);
      expect(merged[1].score).toBe(50);
      expect(merged[2].score).toBe(30);
    });

    it("should merge overlapping candidates with BOTH source", () => {
      const searchTermCandidates = [
        createCandidate({
          id: "st-1",
          normalizedQuery: "shared keyword",
          source: "SEARCH_TERM",
          score: 50,
          scoreBreakdown: {
            searchTermScore: 50,
            jungleScoutScore: 0,
            weights: { searchTerm: 1, jungleScout: 0 },
          },
        }),
      ];
      const jungleScoutCandidates = [
        createCandidate({
          id: "js-1",
          normalizedQuery: "shared keyword",
          source: "JUNGLE_SCOUT",
          searchTermMetrics: null,
          jungleScoutMetrics: {
            searchVolumeExact: 5000,
            searchVolumeBroad: 10000,
            competitionScore: 30,
            easeOfRankingScore: 50,
            relevancyScore: 80,
            suggestedBidLow: 50,
            suggestedBidHigh: 150,
            trendingDirection: "up",
            trendingPercentage: 15,
            fetchedAt: new Date(),
          },
          score: 60,
          scoreBreakdown: {
            searchTermScore: 0,
            jungleScoutScore: 60,
            weights: { searchTerm: 0, jungleScout: 1 },
          },
        }),
      ];

      const merged = mergeAndScoreCandidates(
        searchTermCandidates,
        jungleScoutCandidates,
        defaultConfig
      );

      expect(merged.length).toBe(1);
      expect(merged[0].source).toBe("BOTH");
      expect(merged[0].searchTermMetrics).not.toBeNull();
      expect(merged[0].jungleScoutMetrics).not.toBeNull();
    });

    it("should add non-overlapping Jungle Scout candidates", () => {
      const searchTermCandidates = [
        createCandidate({ id: "st-1", normalizedQuery: "keyword one", score: 50 }),
      ];
      const jungleScoutCandidates = [
        createCandidate({
          id: "js-1",
          normalizedQuery: "keyword two",
          source: "JUNGLE_SCOUT",
          score: 40,
        }),
      ];

      const merged = mergeAndScoreCandidates(
        searchTermCandidates,
        jungleScoutCandidates,
        defaultConfig
      );

      expect(merged.length).toBe(2);
      const sources = merged.map((c) => c.source);
      expect(sources).toContain("SEARCH_TERM");
      expect(sources).toContain("JUNGLE_SCOUT");
    });

    it("should handle empty inputs", () => {
      const merged = mergeAndScoreCandidates([], [], defaultConfig);
      expect(merged.length).toBe(0);
    });

    it("should handle only Jungle Scout candidates", () => {
      const searchTermCandidates: CandidateKeyword[] = [];
      const jungleScoutCandidates = [
        createCandidate({
          id: "js-1",
          normalizedQuery: "js only",
          source: "JUNGLE_SCOUT",
          score: 50,
        }),
      ];

      const merged = mergeAndScoreCandidates(
        searchTermCandidates,
        jungleScoutCandidates,
        defaultConfig
      );

      expect(merged.length).toBe(1);
      expect(merged[0].source).toBe("JUNGLE_SCOUT");
    });

    it("should deduplicate by asin and normalizedQuery", () => {
      const searchTermCandidates = [
        createCandidate({
          id: "st-1",
          asin: "B001234567",
          normalizedQuery: "duplicate keyword",
          score: 50,
        }),
        createCandidate({
          id: "st-2",
          asin: "B009876543", // Different ASIN
          normalizedQuery: "duplicate keyword", // Same keyword
          score: 60,
        }),
      ];
      const jungleScoutCandidates: CandidateKeyword[] = [];

      const merged = mergeAndScoreCandidates(
        searchTermCandidates,
        jungleScoutCandidates,
        defaultConfig
      );

      // Should keep both because different ASINs
      expect(merged.length).toBe(2);
    });

    it("should preserve searchTermMetrics when merging", () => {
      const searchTermMetrics = {
        impressions7d: 1000,
        clicks7d: 20,
        orders7d: 5,
        sales7d: 10000,
        cost7d: 2000,
        acos7d: 0.2,
        cvr7d: 0.25,
        cpc7d: 100,
      };

      const searchTermCandidates = [
        createCandidate({
          id: "st-1",
          normalizedQuery: "shared keyword",
          searchTermMetrics,
          score: 70,
        }),
      ];
      const jungleScoutCandidates = [
        createCandidate({
          id: "js-1",
          normalizedQuery: "shared keyword",
          source: "JUNGLE_SCOUT",
          searchTermMetrics: null,
          score: 30,
        }),
      ];

      const merged = mergeAndScoreCandidates(
        searchTermCandidates,
        jungleScoutCandidates,
        defaultConfig
      );

      expect(merged.length).toBe(1);
      expect(merged[0].source).toBe("BOTH");
      expect(merged[0].searchTermMetrics).toEqual(searchTermMetrics);
    });
  });
});

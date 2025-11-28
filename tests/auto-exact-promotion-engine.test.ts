/**
 * AUTO→EXACT 昇格エンジンのテスト
 */

import {
  getAsinBaselineCvr,
  getPortfolioBaselineCvr,
  getEffectiveBaselineCvr,
  getPromotionConfigForLifecycle,
  isClusterEligible,
  filterEligibleClusters,
  isSearchTermEligible,
  isDuplicateExactKeyword,
  isNegativeKeywordCandidate,
  calculatePromotionScore,
  determineReasonCodes,
  generateReasonDetail,
  findTargetManualCampaign,
  computeAutoExactPromotionCandidates,
} from "../src/auto-exact/auto-exact-promotion-engine";
import {
  PromotionConfig,
  SearchTermStats30dRow,
  IntentClusterStats30dRow,
  AsinBaselineStats30dRow,
  ProductConfigForPromotion,
  ExistingExactKeywordRow,
  TargetManualCampaignRow,
  LifecycleState,
  DEFAULT_PROMOTION_CONFIG,
  LIFECYCLE_PROMOTION_CONFIGS,
} from "../src/auto-exact/types";

describe("auto-exact-promotion-engine", () => {
  // =============================================================================
  // テスト用ヘルパー関数
  // =============================================================================

  const createSearchTerm = (
    overrides: Partial<SearchTermStats30dRow> = {}
  ): SearchTermStats30dRow => ({
    profile_id: "profile001",
    campaign_id: "camp001",
    ad_group_id: "ag001",
    asin: "B001234567",
    search_term: "test keyword",
    match_type: "AUTO",
    intent_cluster_id: "cluster001",
    intent_cluster_label: "test cluster",
    impressions: 1000,
    clicks: 50,
    cost: 5000,
    sales: 20000,
    orders: 5,
    cvr: 0.1, // 10%
    acos: 0.25, // 25%
    ...overrides,
  });

  const createCluster = (
    overrides: Partial<IntentClusterStats30dRow> = {}
  ): IntentClusterStats30dRow => ({
    profile_id: "profile001",
    asin: "B001234567",
    intent_cluster_id: "cluster001",
    intent_cluster_label: "test cluster",
    impressions: 5000,
    clicks: 100,
    cost: 10000,
    sales: 50000,
    orders: 10,
    cvr: 0.1, // 10%
    acos: 0.2, // 20%
    ...overrides,
  });

  const createBaseline = (
    overrides: Partial<AsinBaselineStats30dRow> = {}
  ): AsinBaselineStats30dRow => ({
    profile_id: "profile001",
    asin: "B001234567",
    impressions: 10000,
    clicks: 500,
    orders: 50,
    sales: 100000,
    cvr: 0.1, // 10%
    acos: 0.2, // 20%
    ...overrides,
  });

  const createProductConfig = (
    overrides: Partial<ProductConfigForPromotion> = {}
  ): ProductConfigForPromotion => ({
    asin: "B001234567",
    profileId: "profile001",
    lifecycleState: "GROW",
    targetAcos: 0.2, // 20%
    ...overrides,
  });

  const createExistingKeyword = (
    overrides: Partial<ExistingExactKeywordRow> = {}
  ): ExistingExactKeywordRow => ({
    profile_id: "profile001",
    campaign_id: "manual_camp001",
    ad_group_id: "manual_ag001",
    asin: "B001234567",
    keyword_text: "existing keyword",
    ...overrides,
  });

  const createTargetCampaign = (
    overrides: Partial<TargetManualCampaignRow> = {}
  ): TargetManualCampaignRow => ({
    profile_id: "profile001",
    campaign_id: "manual_camp001",
    ad_group_id: "manual_ag001",
    asin: "B001234567",
    campaign_name: "Manual Campaign",
    ad_group_name: "Manual Ad Group",
    ...overrides,
  });

  // =============================================================================
  // ベースラインCVR計算
  // =============================================================================

  describe("getAsinBaselineCvr", () => {
    it("should return baseline CVR when ASIN exists", () => {
      const baselines = [createBaseline({ cvr: 0.08 })];
      expect(getAsinBaselineCvr("B001234567", baselines)).toBe(0.08);
    });

    it("should return 0 when ASIN does not exist", () => {
      const baselines = [createBaseline({ asin: "B999999999" })];
      expect(getAsinBaselineCvr("B001234567", baselines)).toBe(0);
    });

    it("should return 0 when baselines array is empty", () => {
      expect(getAsinBaselineCvr("B001234567", [])).toBe(0);
    });
  });

  describe("getPortfolioBaselineCvr", () => {
    it("should return portfolioBaselineCvr when set", () => {
      const config = createProductConfig({ portfolioBaselineCvr: 0.12 });
      expect(getPortfolioBaselineCvr(config)).toBe(0.12);
    });

    it("should return 0 when portfolioBaselineCvr is not set", () => {
      const config = createProductConfig();
      expect(getPortfolioBaselineCvr(config)).toBe(0);
    });
  });

  describe("getEffectiveBaselineCvr", () => {
    it("should return max of asin and portfolio baseline CVR", () => {
      expect(getEffectiveBaselineCvr(0.08, 0.1)).toBe(0.1);
      expect(getEffectiveBaselineCvr(0.12, 0.1)).toBe(0.12);
      expect(getEffectiveBaselineCvr(0.1, 0.1)).toBe(0.1);
    });
  });

  // =============================================================================
  // ライフサイクル設定
  // =============================================================================

  describe("getPromotionConfigForLifecycle", () => {
    it("should return LAUNCH_HARD config for LAUNCH_HARD state", () => {
      const config = getPromotionConfigForLifecycle("LAUNCH_HARD");
      expect(config.clusterMinClicks).toBe(40);
      expect(config.keywordMinClicks).toBe(8);
    });

    it("should return LAUNCH_SOFT config for LAUNCH_SOFT state", () => {
      const config = getPromotionConfigForLifecycle("LAUNCH_SOFT");
      expect(config.clusterMinClicks).toBe(45);
      expect(config.keywordMinClicks).toBe(9);
    });

    it("should return GROW config for GROW state", () => {
      const config = getPromotionConfigForLifecycle("GROW");
      expect(config.clusterMinClicks).toBe(50);
      expect(config.keywordMinClicks).toBe(10);
    });

    it("should return HARVEST config for HARVEST state", () => {
      const config = getPromotionConfigForLifecycle("HARVEST");
      expect(config.clusterMinClicks).toBe(60);
      expect(config.keywordMinClicks).toBe(15);
    });

    it("should return default config for null/undefined state", () => {
      expect(getPromotionConfigForLifecycle(null)).toEqual(DEFAULT_PROMOTION_CONFIG);
      expect(getPromotionConfigForLifecycle(undefined)).toEqual(DEFAULT_PROMOTION_CONFIG);
    });
  });

  // =============================================================================
  // クラスタフィルタ
  // =============================================================================

  describe("isClusterEligible", () => {
    const config = DEFAULT_PROMOTION_CONFIG;
    const effectiveBaselineCvr = 0.05;
    const targetAcos = 0.2;

    it("should pass cluster with good metrics", () => {
      const cluster = createCluster({
        clicks: 100,
        orders: 5,
        cvr: 0.06, // above baseline * ratio (0.05)
        acos: 0.2, // at target * ratio (0.26)
      });
      expect(isClusterEligible(cluster, effectiveBaselineCvr, targetAcos, config)).toBe(true);
    });

    it("should reject cluster with insufficient clicks", () => {
      const cluster = createCluster({
        clicks: 30, // below 50
        orders: 5,
        cvr: 0.1,
        acos: 0.15,
      });
      expect(isClusterEligible(cluster, effectiveBaselineCvr, targetAcos, config)).toBe(false);
    });

    it("should reject cluster with insufficient orders", () => {
      const cluster = createCluster({
        clicks: 100,
        orders: 2, // below 3
        cvr: 0.1,
        acos: 0.15,
      });
      expect(isClusterEligible(cluster, effectiveBaselineCvr, targetAcos, config)).toBe(false);
    });

    it("should reject cluster with low CVR", () => {
      const cluster = createCluster({
        clicks: 100,
        orders: 5,
        cvr: 0.03, // below threshold (0.05)
        acos: 0.15,
      });
      expect(isClusterEligible(cluster, effectiveBaselineCvr, targetAcos, config)).toBe(false);
    });

    it("should reject cluster with high ACOS", () => {
      const cluster = createCluster({
        clicks: 100,
        orders: 5,
        cvr: 0.1,
        acos: 0.35, // above threshold (0.26)
      });
      expect(isClusterEligible(cluster, effectiveBaselineCvr, targetAcos, config)).toBe(false);
    });
  });

  describe("filterEligibleClusters", () => {
    const config = DEFAULT_PROMOTION_CONFIG;
    const effectiveBaselineCvr = 0.05;
    const targetAcos = 0.2;

    it("should filter clusters by ASIN and eligibility", () => {
      const clusters = [
        createCluster({
          asin: "B001234567",
          intent_cluster_id: "c1",
          clicks: 100,
          orders: 5,
          cvr: 0.1,
          acos: 0.15,
        }),
        createCluster({
          asin: "B001234567",
          intent_cluster_id: "c2",
          clicks: 30, // insufficient
          orders: 5,
          cvr: 0.1,
          acos: 0.15,
        }),
        createCluster({
          asin: "B999999999", // different ASIN
          intent_cluster_id: "c3",
          clicks: 100,
          orders: 5,
          cvr: 0.1,
          acos: 0.15,
        }),
      ];

      const result = filterEligibleClusters(
        clusters,
        "B001234567",
        effectiveBaselineCvr,
        targetAcos,
        config
      );

      expect(result.length).toBe(1);
      expect(result[0].intent_cluster_id).toBe("c1");
    });
  });

  // =============================================================================
  // 検索語フィルタ
  // =============================================================================

  describe("isSearchTermEligible", () => {
    const config = DEFAULT_PROMOTION_CONFIG;
    const effectiveBaselineCvr = 0.05;
    const targetAcos = 0.2;
    const clusterCvr = 0.08;

    it("should pass search term with good metrics", () => {
      const term = createSearchTerm({
        clicks: 20,
        orders: 3,
        cvr: 0.1, // above threshold
        acos: 0.2, // at target * ratio
      });
      expect(
        isSearchTermEligible(term, clusterCvr, effectiveBaselineCvr, targetAcos, config)
      ).toBe(true);
    });

    it("should reject search term with insufficient clicks", () => {
      const term = createSearchTerm({
        clicks: 5, // below 10
        orders: 3,
        cvr: 0.1,
        acos: 0.15,
      });
      expect(
        isSearchTermEligible(term, clusterCvr, effectiveBaselineCvr, targetAcos, config)
      ).toBe(false);
    });

    it("should reject search term with insufficient orders", () => {
      const term = createSearchTerm({
        clicks: 20,
        orders: 1, // below 2
        cvr: 0.1,
        acos: 0.15,
      });
      expect(
        isSearchTermEligible(term, clusterCvr, effectiveBaselineCvr, targetAcos, config)
      ).toBe(false);
    });

    it("should reject search term with low CVR", () => {
      const term = createSearchTerm({
        clicks: 20,
        orders: 3,
        cvr: 0.05, // below threshold (0.088)
        acos: 0.15,
      });
      expect(
        isSearchTermEligible(term, clusterCvr, effectiveBaselineCvr, targetAcos, config)
      ).toBe(false);
    });

    it("should reject search term with high ACOS", () => {
      const term = createSearchTerm({
        clicks: 20,
        orders: 3,
        cvr: 0.1,
        acos: 0.3, // above threshold (0.24)
      });
      expect(
        isSearchTermEligible(term, clusterCvr, effectiveBaselineCvr, targetAcos, config)
      ).toBe(false);
    });
  });

  // =============================================================================
  // 重複・除外チェック
  // =============================================================================

  describe("isDuplicateExactKeyword", () => {
    it("should detect duplicate keyword (case insensitive)", () => {
      const existingKeywords = [
        createExistingKeyword({ keyword_text: "Test Keyword", profile_id: "profile001" }),
      ];
      expect(isDuplicateExactKeyword("test keyword", "profile001", existingKeywords)).toBe(true);
      expect(isDuplicateExactKeyword("TEST KEYWORD", "profile001", existingKeywords)).toBe(true);
    });

    it("should not detect duplicate for different profile", () => {
      const existingKeywords = [
        createExistingKeyword({ keyword_text: "test keyword", profile_id: "profile002" }),
      ];
      expect(isDuplicateExactKeyword("test keyword", "profile001", existingKeywords)).toBe(false);
    });

    it("should not detect duplicate for different keyword", () => {
      const existingKeywords = [
        createExistingKeyword({ keyword_text: "other keyword", profile_id: "profile001" }),
      ];
      expect(isDuplicateExactKeyword("test keyword", "profile001", existingKeywords)).toBe(false);
    });
  });

  describe("isNegativeKeywordCandidate", () => {
    it("should detect negative keyword candidate", () => {
      const negativeQueries = new Set(["B001234567:test keyword"]);
      expect(isNegativeKeywordCandidate("test keyword", "B001234567", negativeQueries)).toBe(true);
    });

    it("should not detect for different ASIN", () => {
      const negativeQueries = new Set(["B999999999:test keyword"]);
      expect(isNegativeKeywordCandidate("test keyword", "B001234567", negativeQueries)).toBe(false);
    });

    it("should not detect for different keyword", () => {
      const negativeQueries = new Set(["B001234567:other keyword"]);
      expect(isNegativeKeywordCandidate("test keyword", "B001234567", negativeQueries)).toBe(false);
    });
  });

  // =============================================================================
  // スコア計算
  // =============================================================================

  describe("calculatePromotionScore", () => {
    it("should calculate score correctly", () => {
      // score = cvr / (acos / target_acos) = 0.1 / (0.2 / 0.2) = 0.1
      expect(calculatePromotionScore(0.1, 0.2, 0.2)).toBeCloseTo(0.1);
    });

    it("should give higher score for lower ACOS", () => {
      // score = cvr / (acos / target_acos) = 0.1 / (0.1 / 0.2) = 0.2
      expect(calculatePromotionScore(0.1, 0.1, 0.2)).toBeCloseTo(0.2);
    });

    it("should give higher score for higher CVR", () => {
      // score = cvr / (acos / target_acos) = 0.2 / (0.2 / 0.2) = 0.2
      expect(calculatePromotionScore(0.2, 0.2, 0.2)).toBeCloseTo(0.2);
    });

    it("should return high score when ACOS is 0", () => {
      // When acos <= 0, returns cvr * 100
      expect(calculatePromotionScore(0.1, 0, 0.2)).toBe(10);
    });
  });

  // =============================================================================
  // 理由コード
  // =============================================================================

  describe("determineReasonCodes", () => {
    const config = DEFAULT_PROMOTION_CONFIG;

    it("should include HIGH_CVR when CVR is significantly above baseline", () => {
      const reasons = determineReasonCodes(
        0.12, // 20% above baseline
        0.15,
        0.1, // baseline
        0.2,
        null,
        "GROW",
        config
      );
      expect(reasons).toContain("HIGH_CVR");
    });

    it("should include LOW_ACOS when ACOS is significantly below target", () => {
      const reasons = determineReasonCodes(
        0.1,
        0.15, // 25% below target
        0.1,
        0.2, // target
        null,
        "GROW",
        config
      );
      expect(reasons).toContain("LOW_ACOS");
    });

    it("should include CLUSTER_PERFORMER when CVR beats cluster by 10%+", () => {
      // CLUSTER_PERFORMER: CVR が clusterCvr * 1.1 以上
      const reasons = determineReasonCodes(
        0.12, // 20% above cluster (0.1 * 1.1 = 0.11, so 0.12 passes)
        0.22, // above 0.2 * 0.8 = 0.16, so no LOW_ACOS
        0.05,
        0.2,
        0.1, // cluster CVR
        "GROW",
        config
      );
      expect(reasons).toContain("CLUSTER_PERFORMER");
    });

    it("should include LIFECYCLE_BOOST for LAUNCH_HARD state", () => {
      const reasons = determineReasonCodes(
        0.1,
        0.2,
        0.1,
        0.2,
        null,
        "LAUNCH_HARD",
        config
      );
      expect(reasons).toContain("LIFECYCLE_BOOST");
    });

    it("should include LIFECYCLE_BOOST for LAUNCH_SOFT state", () => {
      const reasons = determineReasonCodes(
        0.1,
        0.2,
        0.1,
        0.2,
        null,
        "LAUNCH_SOFT",
        config
      );
      expect(reasons).toContain("LIFECYCLE_BOOST");
    });

    it("should default to HIGH_VOLUME when no other reasons apply", () => {
      const reasons = determineReasonCodes(
        0.1,
        0.2,
        0.1,
        0.2,
        null,
        "GROW",
        config
      );
      expect(reasons).toContain("HIGH_VOLUME");
    });
  });

  // =============================================================================
  // ターゲットキャンペーン検索
  // =============================================================================

  describe("findTargetManualCampaign", () => {
    it("should find matching campaign", () => {
      const campaigns = [
        createTargetCampaign({ asin: "B001234567", profile_id: "profile001" }),
      ];
      const result = findTargetManualCampaign("B001234567", "profile001", campaigns);
      expect(result).not.toBeNull();
      expect(result?.campaign_id).toBe("manual_camp001");
    });

    it("should return null for non-matching ASIN", () => {
      const campaigns = [
        createTargetCampaign({ asin: "B999999999", profile_id: "profile001" }),
      ];
      const result = findTargetManualCampaign("B001234567", "profile001", campaigns);
      expect(result).toBeNull();
    });

    it("should return null for non-matching profile", () => {
      const campaigns = [
        createTargetCampaign({ asin: "B001234567", profile_id: "profile002" }),
      ];
      const result = findTargetManualCampaign("B001234567", "profile001", campaigns);
      expect(result).toBeNull();
    });
  });

  // =============================================================================
  // メイン関数: computeAutoExactPromotionCandidates
  // =============================================================================

  describe("computeAutoExactPromotionCandidates", () => {
    it("should produce candidates for eligible search terms", () => {
      const searchTerms = [
        createSearchTerm({
          search_term: "good keyword",
          clicks: 20,
          orders: 3,
          cvr: 0.15,
          acos: 0.15,
        }),
      ];
      const clusters = [
        createCluster({
          clicks: 100,
          orders: 5,
          cvr: 0.1,
          acos: 0.18,
        }),
      ];
      const baselines = [createBaseline({ cvr: 0.08 })];
      const productConfigs = [createProductConfig({ targetAcos: 0.2 })];
      const targetCampaigns = [createTargetCampaign()];
      const existingKeywords: ExistingExactKeywordRow[] = [];
      const negativeQueries = new Set<string>();

      const result = computeAutoExactPromotionCandidates(
        searchTerms,
        clusters,
        baselines,
        productConfigs,
        targetCampaigns,
        existingKeywords,
        negativeQueries,
        "profile001",
        "SHADOW"
      );

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].searchTerm).toBe("good keyword");
      expect(result.stats.searchTermsPassedFilter).toBe(1);
    });

    it("should exclude search terms with low clicks", () => {
      const searchTerms = [
        createSearchTerm({
          search_term: "low click keyword",
          clicks: 5, // below threshold
          orders: 3,
          cvr: 0.15,
          acos: 0.15,
        }),
      ];
      const clusters = [
        createCluster({
          clicks: 100,
          orders: 5,
          cvr: 0.1,
          acos: 0.18,
        }),
      ];
      const baselines = [createBaseline({ cvr: 0.08 })];
      const productConfigs = [createProductConfig({ targetAcos: 0.2 })];

      const result = computeAutoExactPromotionCandidates(
        searchTerms,
        clusters,
        baselines,
        productConfigs,
        [],
        [],
        new Set(),
        "profile001",
        "SHADOW"
      );

      expect(result.candidates.length).toBe(0);
    });

    it("should exclude search terms with high ACOS", () => {
      const searchTerms = [
        createSearchTerm({
          search_term: "high acos keyword",
          clicks: 20,
          orders: 3,
          cvr: 0.15,
          acos: 0.35, // above threshold
        }),
      ];
      const clusters = [
        createCluster({
          clicks: 100,
          orders: 5,
          cvr: 0.1,
          acos: 0.18,
        }),
      ];
      const baselines = [createBaseline({ cvr: 0.08 })];
      const productConfigs = [createProductConfig({ targetAcos: 0.2 })];

      const result = computeAutoExactPromotionCandidates(
        searchTerms,
        clusters,
        baselines,
        productConfigs,
        [],
        [],
        new Set(),
        "profile001",
        "SHADOW"
      );

      expect(result.candidates.length).toBe(0);
    });

    it("should exclude duplicate keywords", () => {
      const searchTerms = [
        createSearchTerm({
          search_term: "existing keyword",
          clicks: 20,
          orders: 3,
          cvr: 0.15,
          acos: 0.15,
        }),
      ];
      const clusters = [
        createCluster({
          clicks: 100,
          orders: 5,
          cvr: 0.1,
          acos: 0.18,
        }),
      ];
      const baselines = [createBaseline({ cvr: 0.08 })];
      const productConfigs = [createProductConfig({ targetAcos: 0.2 })];
      const existingKeywords = [
        createExistingKeyword({
          keyword_text: "existing keyword",
          profile_id: "profile001",
        }),
      ];

      const result = computeAutoExactPromotionCandidates(
        searchTerms,
        clusters,
        baselines,
        productConfigs,
        [],
        existingKeywords,
        new Set(),
        "profile001",
        "SHADOW"
      );

      expect(result.candidates.length).toBe(0);
      expect(result.stats.duplicatesExcluded).toBe(1);
    });

    it("should exclude negative keyword candidates", () => {
      const searchTerms = [
        createSearchTerm({
          search_term: "negative candidate",
          clicks: 20,
          orders: 3,
          cvr: 0.15,
          acos: 0.15,
        }),
      ];
      const clusters = [
        createCluster({
          clicks: 100,
          orders: 5,
          cvr: 0.1,
          acos: 0.18,
        }),
      ];
      const baselines = [createBaseline({ cvr: 0.08 })];
      const productConfigs = [createProductConfig({ targetAcos: 0.2 })];
      const negativeQueries = new Set(["B001234567:negative candidate"]);

      const result = computeAutoExactPromotionCandidates(
        searchTerms,
        clusters,
        baselines,
        productConfigs,
        [],
        [],
        negativeQueries,
        "profile001",
        "SHADOW"
      );

      expect(result.candidates.length).toBe(0);
      expect(result.stats.negativesExcluded).toBe(1);
    });

    it("should sort candidates by score descending", () => {
      const searchTerms = [
        createSearchTerm({
          search_term: "low score keyword",
          intent_cluster_id: "cluster001",
          clicks: 20,
          orders: 2,
          cvr: 0.1,
          acos: 0.2,
        }),
        createSearchTerm({
          search_term: "high score keyword",
          intent_cluster_id: "cluster001",
          clicks: 30,
          orders: 5,
          cvr: 0.15,
          acos: 0.1, // better ACOS = higher score
        }),
      ];
      const clusters = [
        createCluster({
          intent_cluster_id: "cluster001",
          clicks: 100,
          orders: 5,
          cvr: 0.08,
          acos: 0.18,
        }),
      ];
      const baselines = [createBaseline({ cvr: 0.08 })];
      const productConfigs = [createProductConfig({ targetAcos: 0.2 })];

      const result = computeAutoExactPromotionCandidates(
        searchTerms,
        clusters,
        baselines,
        productConfigs,
        [],
        [],
        new Set(),
        "profile001",
        "SHADOW"
      );

      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0].searchTerm).toBe("high score keyword");
      expect(result.candidates[1].searchTerm).toBe("low score keyword");
    });

    it("should use lifecycle-specific config for LAUNCH_HARD", () => {
      const searchTerms = [
        createSearchTerm({
          search_term: "launch keyword",
          clicks: 9, // would fail GROW (10), but pass LAUNCH_HARD (8)
          orders: 2,
          cvr: 0.1,
          acos: 0.15,
        }),
      ];
      const clusters = [
        createCluster({
          clicks: 45, // would fail GROW (50), but pass LAUNCH_HARD (40)
          orders: 3,
          cvr: 0.08,
          acos: 0.25, // LAUNCH_HARD has higher ACOS tolerance
        }),
      ];
      const baselines = [createBaseline({ cvr: 0.08 })];
      const productConfigs = [
        createProductConfig({
          targetAcos: 0.2,
          lifecycleState: "LAUNCH_HARD",
        }),
      ];

      const result = computeAutoExactPromotionCandidates(
        searchTerms,
        clusters,
        baselines,
        productConfigs,
        [],
        [],
        new Set(),
        "profile001",
        "SHADOW"
      );

      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].lifecycleState).toBe("LAUNCH_HARD");
    });

    it("should correctly populate stats", () => {
      const searchTerms = [
        createSearchTerm({
          search_term: "good keyword",
          intent_cluster_id: "cluster001",
          clicks: 20,
          orders: 3,
          cvr: 0.15,
          acos: 0.15,
        }),
        createSearchTerm({
          search_term: "low click keyword",
          intent_cluster_id: "cluster001",
          clicks: 5,
          orders: 2,
          cvr: 0.15,
          acos: 0.15,
        }),
      ];
      const clusters = [
        createCluster({
          intent_cluster_id: "cluster001",
          clicks: 100,
          orders: 5,
          cvr: 0.1,
          acos: 0.18,
        }),
        createCluster({
          intent_cluster_id: "cluster002",
          clicks: 30, // won't pass filter
          orders: 5,
          cvr: 0.1,
          acos: 0.18,
        }),
      ];
      const baselines = [createBaseline({ cvr: 0.08 })];
      const productConfigs = [createProductConfig({ targetAcos: 0.2 })];

      const result = computeAutoExactPromotionCandidates(
        searchTerms,
        clusters,
        baselines,
        productConfigs,
        [],
        [],
        new Set(),
        "profile001",
        "SHADOW"
      );

      expect(result.stats.totalAsinsProcessed).toBe(1);
      expect(result.stats.totalClustersProcessed).toBe(2);
      expect(result.stats.clustersPassedFilter).toBe(1);
      expect(result.stats.totalSearchTermsProcessed).toBe(2);
      expect(result.stats.searchTermsPassedFilter).toBe(1);
    });
  });
});

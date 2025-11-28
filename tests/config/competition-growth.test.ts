/**
 * 激戦度判定・プロファイル自動割り当て・成長判定のテスト
 */
import {
  calculateCompetitionIntensity,
  getRecommendedProfileByCompetition,
  assignProfileByCompetition,
  evaluateOrganicGrowthCondition,
  evaluateRatingHealthCondition,
  evaluateAdsToOrganicCondition,
  calculateGrowthScore,
  getRecommendedLifecycleByGrowth,
  assessGrowthCandidate,
  CompetitionData,
  GrowthAssessmentData,
  ProductConfig,
  COMPETITION_THRESHOLDS,
  GROWTH_THRESHOLDS,
} from "../../src/config/productConfigTypes";

describe("激戦度計算（calculateCompetitionIntensity）", () => {
  it("すべての条件を満たさない場合はスコア0", () => {
    const data: CompetitionData = {
      asin: "B001234567",
      keywordOrCategory: "サプリメント",
      strongCompetitorCount: 10, // < 15
      medianCpcToPriceRatio: 0.03, // < 0.05
      bigBrandShare: 0.3, // < 0.5
    };
    expect(calculateCompetitionIntensity(data)).toBe(0);
  });

  it("1つの条件を満たす場合はスコア1", () => {
    const data: CompetitionData = {
      asin: "B001234567",
      keywordOrCategory: "サプリメント",
      strongCompetitorCount: 20, // >= 15
      medianCpcToPriceRatio: 0.03, // < 0.05
      bigBrandShare: 0.3, // < 0.5
    };
    expect(calculateCompetitionIntensity(data)).toBe(1);
  });

  it("2つの条件を満たす場合はスコア2", () => {
    const data: CompetitionData = {
      asin: "B001234567",
      keywordOrCategory: "サプリメント",
      strongCompetitorCount: 20, // >= 15
      medianCpcToPriceRatio: 0.06, // >= 0.05
      bigBrandShare: 0.3, // < 0.5
    };
    expect(calculateCompetitionIntensity(data)).toBe(2);
  });

  it("すべての条件を満たす場合はスコア3", () => {
    const data: CompetitionData = {
      asin: "B001234567",
      keywordOrCategory: "サプリメント",
      strongCompetitorCount: 20, // >= 15
      medianCpcToPriceRatio: 0.06, // >= 0.05
      bigBrandShare: 0.6, // >= 0.5
    };
    expect(calculateCompetitionIntensity(data)).toBe(3);
  });

  it("閾値の境界値テスト", () => {
    // ちょうど閾値の場合
    const data: CompetitionData = {
      asin: "B001234567",
      keywordOrCategory: "サプリメント",
      strongCompetitorCount: 15, // = 15
      medianCpcToPriceRatio: 0.05, // = 0.05
      bigBrandShare: 0.5, // = 0.5
    };
    expect(calculateCompetitionIntensity(data)).toBe(3);
  });
});

describe("激戦度に基づくプロファイル推奨（getRecommendedProfileByCompetition）", () => {
  it("スコア0-1でLTVモデルの場合はSUPPLEMENT_HIGH_LTV", () => {
    expect(getRecommendedProfileByCompetition(0, "LTV")).toBe("SUPPLEMENT_HIGH_LTV");
    expect(getRecommendedProfileByCompetition(1, "LTV")).toBe("SUPPLEMENT_HIGH_LTV");
  });

  it("スコア2でLTVモデルの場合はSUPPLEMENT_STANDARD", () => {
    expect(getRecommendedProfileByCompetition(2, "LTV")).toBe("SUPPLEMENT_STANDARD");
  });

  it("スコア3でLTVモデルの場合はSUPPLEMENT_STANDARD", () => {
    expect(getRecommendedProfileByCompetition(3, "LTV")).toBe("SUPPLEMENT_STANDARD");
  });

  it("SINGLE_PURCHASEモデルの場合は常にSINGLE_PURCHASE", () => {
    expect(getRecommendedProfileByCompetition(0, "SINGLE_PURCHASE")).toBe("SINGLE_PURCHASE");
    expect(getRecommendedProfileByCompetition(3, "SINGLE_PURCHASE")).toBe("SINGLE_PURCHASE");
  });
});

describe("プロファイル自動割り当て（assignProfileByCompetition）", () => {
  const baseConfig: ProductConfig = {
    asin: "B001234567",
    isActive: true,
    revenueModel: "LTV",
    lifecycleState: "GROW",
    businessMode: "PROFIT",
    brandType: "GENERIC",
    experimentGroup: "CONTROL",
    ltvMode: "ASSUMED",
    marginRate: 0.3,
    expectedRepeatOrdersAssumed: 1.5,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: 60,
    newCustomersTotal: 100,
  };

  it("低激戦度の場合は高LTVプロファイルを推奨", () => {
    const competitionData: CompetitionData = {
      asin: "B001234567",
      keywordOrCategory: "サプリメント",
      strongCompetitorCount: 5,
      medianCpcToPriceRatio: 0.02,
      bigBrandShare: 0.2,
    };

    const result = assignProfileByCompetition(baseConfig, competitionData);
    expect(result.profileType).toBe("SUPPLEMENT_HIGH_LTV");
    expect(result.competitionIntensityScore).toBe(0);
    expect(result.assignmentMethod).toBe("AUTO");
    expect(result.reason).toContain("低激戦度");
  });

  it("高激戦度の場合は標準プロファイルを推奨", () => {
    const competitionData: CompetitionData = {
      asin: "B001234567",
      keywordOrCategory: "サプリメント",
      strongCompetitorCount: 20,
      medianCpcToPriceRatio: 0.06,
      bigBrandShare: 0.3,
    };

    const result = assignProfileByCompetition(baseConfig, competitionData);
    expect(result.profileType).toBe("SUPPLEMENT_STANDARD");
    expect(result.competitionIntensityScore).toBe(2);
    expect(result.reason).toContain("高激戦度");
  });
});

describe("オーガニック成長条件（evaluateOrganicGrowthCondition）", () => {
  const baseData: GrowthAssessmentData = {
    asin: "B001234567",
    organicGrowthRate: 0,
    productRating: 4.5,
    competitorMedianRating: 4.2,
    reviewCount: 100,
    organicToAdSalesRatio: 1.0,
    adDependencyRatio: 0.3,
  };

  it("成長率5%以上でtrue", () => {
    expect(evaluateOrganicGrowthCondition({ ...baseData, organicGrowthRate: 0.05 })).toBe(true);
    expect(evaluateOrganicGrowthCondition({ ...baseData, organicGrowthRate: 0.10 })).toBe(true);
  });

  it("成長率5%未満でfalse", () => {
    expect(evaluateOrganicGrowthCondition({ ...baseData, organicGrowthRate: 0.04 })).toBe(false);
    expect(evaluateOrganicGrowthCondition({ ...baseData, organicGrowthRate: 0 })).toBe(false);
  });
});

describe("評価健全性条件（evaluateRatingHealthCondition）", () => {
  const baseData: GrowthAssessmentData = {
    asin: "B001234567",
    organicGrowthRate: 0.10,
    productRating: 4.0,
    competitorMedianRating: 4.0,
    reviewCount: 100,
    organicToAdSalesRatio: 1.0,
    adDependencyRatio: 0.3,
  };

  it("評価3.8以上かつ競合差-0.3以上でtrue", () => {
    expect(evaluateRatingHealthCondition({ ...baseData, productRating: 4.0, competitorMedianRating: 4.2 })).toBe(true);
    expect(evaluateRatingHealthCondition({ ...baseData, productRating: 4.5, competitorMedianRating: 4.0 })).toBe(true);
  });

  it("評価3.8未満でfalse", () => {
    expect(evaluateRatingHealthCondition({ ...baseData, productRating: 3.7, competitorMedianRating: 3.5 })).toBe(false);
  });

  it("競合評価との差が-0.3より大きい場合はfalse", () => {
    expect(evaluateRatingHealthCondition({ ...baseData, productRating: 4.0, competitorMedianRating: 4.5 })).toBe(false);
  });
});

describe("広告→オーガニック転換条件（evaluateAdsToOrganicCondition）", () => {
  const baseData: GrowthAssessmentData = {
    asin: "B001234567",
    organicGrowthRate: 0.10,
    productRating: 4.5,
    competitorMedianRating: 4.2,
    reviewCount: 100,
    organicToAdSalesRatio: 0.8,
    adDependencyRatio: 0.7,
  };

  it("オーガニック比率80%以上かつ広告依存度70%以下でtrue", () => {
    expect(evaluateAdsToOrganicCondition({ ...baseData, organicToAdSalesRatio: 0.8, adDependencyRatio: 0.7 })).toBe(true);
    expect(evaluateAdsToOrganicCondition({ ...baseData, organicToAdSalesRatio: 1.2, adDependencyRatio: 0.4 })).toBe(true);
  });

  it("オーガニック比率80%未満でfalse", () => {
    expect(evaluateAdsToOrganicCondition({ ...baseData, organicToAdSalesRatio: 0.7, adDependencyRatio: 0.5 })).toBe(false);
  });

  it("広告依存度70%超でfalse", () => {
    expect(evaluateAdsToOrganicCondition({ ...baseData, organicToAdSalesRatio: 1.0, adDependencyRatio: 0.8 })).toBe(false);
  });
});

describe("成長スコア計算（calculateGrowthScore）", () => {
  it("すべての条件を満たす場合は高スコア", () => {
    const conditions = {
      conditionOrganicGrowing: true,
      conditionRatingHealthy: true,
      conditionAdsToOrganic: true,
      details: {
        organicGrowthRate: 0.20,
        ratingDifference: 0.5,
        organicToAdRatio: 1.3,
        adDependency: 0.3,
      },
    };
    const data: GrowthAssessmentData = {
      asin: "B001234567",
      organicGrowthRate: 0.20,
      productRating: 4.5,
      competitorMedianRating: 4.0,
      reviewCount: 100,
      organicToAdSalesRatio: 1.3,
      adDependencyRatio: 0.3,
      bsrTrend: 1,
    };
    const score = calculateGrowthScore(conditions, data);
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it("条件を満たさない場合は低スコア", () => {
    const conditions = {
      conditionOrganicGrowing: false,
      conditionRatingHealthy: false,
      conditionAdsToOrganic: false,
      details: {
        organicGrowthRate: 0.02,
        ratingDifference: -0.5,
        organicToAdRatio: 0.5,
        adDependency: 0.8,
      },
    };
    const data: GrowthAssessmentData = {
      asin: "B001234567",
      organicGrowthRate: 0.02,
      productRating: 3.5,
      competitorMedianRating: 4.0,
      reviewCount: 100,
      organicToAdSalesRatio: 0.5,
      adDependencyRatio: 0.8,
    };
    const score = calculateGrowthScore(conditions, data);
    expect(score).toBeLessThan(20);
  });
});

describe("ライフサイクル推奨（getRecommendedLifecycleByGrowth）", () => {
  it("高スコア（80以上）の場合は攻めのステート", () => {
    expect(getRecommendedLifecycleByGrowth(85, "GROW")).toBe("LAUNCH_SOFT");
    expect(getRecommendedLifecycleByGrowth(85, "LAUNCH_HARD")).toBe("LAUNCH_HARD");
  });

  it("中スコア（60-79）の場合はGROW", () => {
    expect(getRecommendedLifecycleByGrowth(65, "HARVEST")).toBe("GROW");
  });

  it("低スコア（40-59）の場合は現状維持", () => {
    expect(getRecommendedLifecycleByGrowth(45, "GROW")).toBe("GROW");
    expect(getRecommendedLifecycleByGrowth(45, "HARVEST")).toBe("HARVEST");
  });

  it("成長停滞（40未満）の場合はHARVEST", () => {
    expect(getRecommendedLifecycleByGrowth(30, "GROW")).toBe("HARVEST");
  });
});

describe("成長候補総合判定（assessGrowthCandidate）", () => {
  it("すべての条件を満たす場合は成長候補", () => {
    const data: GrowthAssessmentData = {
      asin: "B001234567",
      organicGrowthRate: 0.15,
      productRating: 4.5,
      competitorMedianRating: 4.0,
      reviewCount: 200,
      organicToAdSalesRatio: 1.2,
      adDependencyRatio: 0.4,
      bsrTrend: 1,
    };

    const result = assessGrowthCandidate(data, "GROW");
    expect(result.isGrowingCandidate).toBe(true);
    expect(result.conditions.conditionOrganicGrowing).toBe(true);
    expect(result.conditions.conditionRatingHealthy).toBe(true);
    expect(result.conditions.conditionAdsToOrganic).toBe(true);
    expect(result.growthScore).toBeGreaterThanOrEqual(60);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("一部の条件を満たさない場合は成長候補ではない", () => {
    const data: GrowthAssessmentData = {
      asin: "B001234567",
      organicGrowthRate: 0.02, // 成長条件を満たさない
      productRating: 4.5,
      competitorMedianRating: 4.0,
      reviewCount: 200,
      organicToAdSalesRatio: 1.2,
      adDependencyRatio: 0.4,
    };

    const result = assessGrowthCandidate(data, "GROW");
    expect(result.isGrowingCandidate).toBe(false);
    expect(result.conditions.conditionOrganicGrowing).toBe(false);
    expect(result.reasons).toContain("オーガニック成長停滞 (2.0%)");
  });

  it("評価が低い場合は成長候補ではない", () => {
    const data: GrowthAssessmentData = {
      asin: "B001234567",
      organicGrowthRate: 0.15,
      productRating: 3.5, // 評価条件を満たさない
      competitorMedianRating: 4.0,
      reviewCount: 200,
      organicToAdSalesRatio: 1.2,
      adDependencyRatio: 0.4,
    };

    const result = assessGrowthCandidate(data, "GROW");
    expect(result.isGrowingCandidate).toBe(false);
    expect(result.conditions.conditionRatingHealthy).toBe(false);
  });

  it("広告依存度が高い場合は成長候補ではない", () => {
    const data: GrowthAssessmentData = {
      asin: "B001234567",
      organicGrowthRate: 0.15,
      productRating: 4.5,
      competitorMedianRating: 4.0,
      reviewCount: 200,
      organicToAdSalesRatio: 0.6, // オーガニック比率が低い
      adDependencyRatio: 0.75, // 広告依存度が高い
    };

    const result = assessGrowthCandidate(data, "GROW");
    expect(result.isGrowingCandidate).toBe(false);
    expect(result.conditions.conditionAdsToOrganic).toBe(false);
  });
});

describe("閾値定数の確認", () => {
  it("COMPETITION_THRESHOLDSの値", () => {
    expect(COMPETITION_THRESHOLDS.HIGH_COMPETITION_STRONG_COMPETITOR_COUNT).toBe(15);
    expect(COMPETITION_THRESHOLDS.HIGH_COMPETITION_CPC_PRICE_RATIO).toBe(0.05);
    expect(COMPETITION_THRESHOLDS.HIGH_COMPETITION_BIG_BRAND_SHARE).toBe(0.5);
  });

  it("GROWTH_THRESHOLDSの値", () => {
    expect(GROWTH_THRESHOLDS.MIN_ORGANIC_GROWTH_RATE).toBe(0.05);
    expect(GROWTH_THRESHOLDS.HIGH_ORGANIC_GROWTH_RATE).toBe(0.20);
    expect(GROWTH_THRESHOLDS.MIN_HEALTHY_RATING).toBe(3.8);
    expect(GROWTH_THRESHOLDS.MIN_RATING_ADVANTAGE).toBe(-0.3);
    expect(GROWTH_THRESHOLDS.MIN_ORGANIC_TO_AD_RATIO).toBe(0.8);
    expect(GROWTH_THRESHOLDS.MAX_AD_DEPENDENCY_RATIO).toBe(0.7);
  });
});

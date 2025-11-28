/**
 * 昇格処理・パラメータ再推計のテスト
 */
import {
  isNewProduct,
  canPromoteFromNewProduct,
  reestimateParameters,
  executePromotion,
  PromotionPerformanceData,
  ProductConfig,
  PRODUCT_CONFIG_DEFAULTS,
  NEW_PRODUCT_THRESHOLDS,
  REESTIMATION_DEFAULTS,
} from "../../src/config/productConfigTypes";

describe("新商品判定（isNewProduct）", () => {
  it("すべての条件を満たす場合はNEW_PRODUCT", () => {
    expect(isNewProduct(10, 50, 10)).toBe(true);
  });

  it("daysSinceFirstImpressionのみ閾値未満でNEW_PRODUCT", () => {
    expect(isNewProduct(20, 200, 50)).toBe(true);
  });

  it("clicks30dのみ閾値未満でNEW_PRODUCT", () => {
    expect(isNewProduct(60, 50, 50)).toBe(true);
  });

  it("orders30dのみ閾値未満でNEW_PRODUCT", () => {
    expect(isNewProduct(60, 200, 10)).toBe(true);
  });

  it("すべての条件を満たさない場合はNEW_PRODUCTではない", () => {
    expect(isNewProduct(60, 200, 50)).toBe(false);
  });

  it("undefined/nullの場合はデータ不足としてNEW_PRODUCT", () => {
    expect(isNewProduct(undefined, 200, 50)).toBe(true);
    expect(isNewProduct(60, null, 50)).toBe(true);
    expect(isNewProduct(60, 200, undefined)).toBe(true);
  });
});

describe("昇格条件判定（canPromoteFromNewProduct）", () => {
  it("すべての条件を満たす場合は昇格可能", () => {
    expect(canPromoteFromNewProduct(30, 100, 20)).toBe(true);
    expect(canPromoteFromNewProduct(60, 200, 50)).toBe(true);
  });

  it("いずれかの条件を満たさない場合は昇格不可", () => {
    expect(canPromoteFromNewProduct(29, 100, 20)).toBe(false);
    expect(canPromoteFromNewProduct(30, 99, 20)).toBe(false);
    expect(canPromoteFromNewProduct(30, 100, 19)).toBe(false);
  });

  it("undefined/nullの場合は昇格不可", () => {
    expect(canPromoteFromNewProduct(undefined, 100, 20)).toBe(false);
    expect(canPromoteFromNewProduct(30, null, 20)).toBe(false);
    expect(canPromoteFromNewProduct(30, 100, undefined)).toBe(false);
  });
});

describe("パラメータ再推計（reestimateParameters）", () => {
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

  it("十分なデータがある場合はMEASUREDとして推計", () => {
    const performanceData: PromotionPerformanceData = {
      asin: "B001234567",
      totalSales90d: 500000,
      adSales90d: 300000,
      adSpend90d: 60000,
      clicks90d: 5000,
      orders90d: 250,
      impressions90d: 100000,
      newCustomers90d: 50,
      repeatOrders90d: 60,
      repeatSales90d: 120000,
      organicSales90d: 200000,
      avgOrderValue90d: 2000,
    };

    const result = reestimateParameters(performanceData, baseConfig);

    expect(result.asin).toBe("B001234567");
    expect(result.estimationBasis).toBe("MEASURED");
    // リピート回数 = 1 + (60 / 50) = 2.2
    expect(result.expectedRepeatOrdersEstimated).toBeCloseTo(2.2, 1);
    // 十分なデータ → 安全係数0.8
    expect(result.ltvSafetyFactorEstimated).toBe(0.8);
    // CVR = 250 / 5000 = 0.05
    expect(result.cvrEstimated).toBeCloseTo(0.05, 3);
    // CTR = 5000 / 100000 = 0.05
    expect(result.ctrEstimated).toBeCloseTo(0.05, 3);
    // ACOS = 60000 / 300000 = 0.2
    expect(result.acosActual90d).toBeCloseTo(0.2, 2);
    // TACOS = 60000 / 500000 = 0.12
    expect(result.tacosActual90d).toBeCloseTo(0.12, 2);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("限定的なデータの場合はEARLY_ESTIMATEとして推計", () => {
    const performanceData: PromotionPerformanceData = {
      asin: "B001234567",
      totalSales90d: 100000,
      adSales90d: 60000,
      adSpend90d: 15000,
      clicks90d: 800,
      orders90d: 40,
      impressions90d: 20000,
      newCustomers90d: 25,
      repeatOrders90d: 10,
      repeatSales90d: 20000,
      organicSales90d: 40000,
      avgOrderValue90d: 2500,
    };

    const result = reestimateParameters(performanceData, baseConfig);

    expect(result.estimationBasis).toBe("EARLY_ESTIMATE");
    // リピート率 = 10 / 25 = 0.4, 保守的に20%引き → 0.32
    // リピート回数 = 1 + 0.32 = 1.32
    expect(result.expectedRepeatOrdersEstimated).toBeCloseTo(1.32, 1);
    // 中程度のデータ → 安全係数0.7
    expect(result.ltvSafetyFactorEstimated).toBe(0.7);
  });

  it("データ不足の場合はカテゴリ標準値を維持", () => {
    const performanceData: PromotionPerformanceData = {
      asin: "B001234567",
      totalSales90d: 20000,
      adSales90d: 15000,
      adSpend90d: 5000,
      clicks90d: 100,
      orders90d: 5,
      impressions90d: 3000,
      newCustomers90d: 5,
      repeatOrders90d: 0,
      repeatSales90d: 0,
      organicSales90d: 5000,
      avgOrderValue90d: 4000,
    };

    const result = reestimateParameters(performanceData, baseConfig);

    expect(result.estimationBasis).toBe("EARLY_ESTIMATE");
    // データ不足なのでカテゴリ標準値を維持
    expect(result.expectedRepeatOrdersEstimated).toBe(baseConfig.expectedRepeatOrdersAssumed);
    // データ不足 → 保守的な安全係数0.6
    expect(result.ltvSafetyFactorEstimated).toBe(0.6);
    expect(result.confidence).toBeLessThan(0.3);
  });

  it("異常に高いリピート回数はクランプされる", () => {
    const performanceData: PromotionPerformanceData = {
      asin: "B001234567",
      totalSales90d: 1000000,
      adSales90d: 500000,
      adSpend90d: 100000,
      clicks90d: 10000,
      orders90d: 500,
      impressions90d: 200000,
      newCustomers90d: 30,
      repeatOrders90d: 500, // 異常に高いリピート
      repeatSales90d: 500000,
      organicSales90d: 500000,
      avgOrderValue90d: 2000,
    };

    const result = reestimateParameters(performanceData, baseConfig);

    // 上限10.0でクランプ
    expect(result.expectedRepeatOrdersEstimated).toBe(REESTIMATION_DEFAULTS.MAX_REPEAT_ORDERS);
  });
});

describe("昇格処理（executePromotion）", () => {
  const promotableConfig: ProductConfig = {
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
    isNewProduct: true,
    daysSinceFirstImpression: 45, // 昇格条件を満たす
    clicks30d: 150,
    orders30d: 30,
  };

  const performanceData: PromotionPerformanceData = {
    asin: "B001234567",
    totalSales90d: 500000,
    adSales90d: 300000,
    adSpend90d: 60000,
    clicks90d: 5000,
    orders90d: 250,
    impressions90d: 100000,
    newCustomers90d: 50,
    repeatOrders90d: 60,
    repeatSales90d: 120000,
    organicSales90d: 200000,
    avgOrderValue90d: 2000,
  };

  it("昇格条件を満たす場合はPromotionResultを返す", () => {
    const result = executePromotion(performanceData, promotableConfig);

    expect(result).not.toBeNull();
    expect(result!.asin).toBe("B001234567");
    expect(result!.previousStatus).toBe("NEW_PRODUCT");
    expect(result!.newStatus).toBe("NORMAL");
    expect(result!.configUpdates.isNewProduct).toBe(false);
    expect(result!.configUpdates.ltvMode).toBe("MEASURED");
    expect(result!.reestimation.expectedRepeatOrdersEstimated).toBeCloseTo(2.2, 1);
  });

  it("昇格条件を満たさない場合はnullを返す", () => {
    const nonPromotableConfig: ProductConfig = {
      ...promotableConfig,
      daysSinceFirstImpression: 20, // 昇格条件を満たさない
      clicks30d: 50,
      orders30d: 10,
    };

    const result = executePromotion(performanceData, nonPromotableConfig);

    expect(result).toBeNull();
  });

  it("MEASUREDの場合は実測値も設定される", () => {
    const result = executePromotion(performanceData, promotableConfig);

    expect(result!.reestimation.estimationBasis).toBe("MEASURED");
    expect(result!.configUpdates.expectedRepeatOrdersMeasured).toBeDefined();
    expect(result!.configUpdates.safetyFactorMeasured).toBeDefined();
  });

  it("信頼度が低い場合は推計値で更新しない", () => {
    const lowDataPerformance: PromotionPerformanceData = {
      ...performanceData,
      clicks90d: 50,
      orders90d: 3,
      newCustomers90d: 2,
      repeatOrders90d: 0,
    };

    const result = executePromotion(lowDataPerformance, promotableConfig);

    expect(result).not.toBeNull();
    expect(result!.reestimation.confidence).toBeLessThan(
      REESTIMATION_DEFAULTS.MEDIUM_CONFIDENCE_THRESHOLD
    );
    // 信頼度が低いので推計値での更新はない
    expect(result!.configUpdates.expectedRepeatOrdersAssumed).toBeUndefined();
    expect(result!.configUpdates.safetyFactorAssumed).toBeUndefined();
  });
});

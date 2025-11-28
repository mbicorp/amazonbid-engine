/**
 * LTV期待粗利・累積赤字上限計算のテスト
 */
import {
  calculateExpectedLtvGrossProfit,
  calculateExpectedLtvGrossProfitFromConfig,
  calculateProductCumulativeLossLimit,
  calculateProductCumulativeLossLimitFromConfig,
  calculateGlobalCumulativeLossLimit,
  isOverCumulativeLossLimit,
  isOverConsecutiveLossMonthsLimit,
  getMaxConsecutiveLossMonths,
  assessProductRisk,
  ProductConfig,
  ProductProfile,
  SUPPLEMENT_HIGH_LTV_PROFILE,
  SUPPLEMENT_STANDARD_PROFILE,
  SINGLE_PURCHASE_PROFILE,
  DEFAULT_PROFILE,
  GLOBAL_RISK_CONFIG_DEFAULTS,
} from "../../src/config/productConfigTypes";

describe("LTV期待粗利計算（calculateExpectedLtvGrossProfit）", () => {
  it("正常なパラメータでLTV期待粗利を計算", () => {
    // price=5000円, marginRate=0.55, repeatOrders=1.7
    // LTV期待粗利 = 5000 × 0.55 × (1 + 1.7) = 5000 × 0.55 × 2.7 = 7425
    const result = calculateExpectedLtvGrossProfit(5000, 0.55, 1.7);
    expect(result).toBeCloseTo(7425, 0);
  });

  it("リピート回数1.0（リピートなし）の場合", () => {
    // price=3000円, marginRate=0.30, repeatOrders=1.0
    // LTV期待粗利 = 3000 × 0.30 × (1 + 1.0) = 3000 × 0.30 × 2.0 = 1800
    const result = calculateExpectedLtvGrossProfit(3000, 0.30, 1.0);
    expect(result).toBeCloseTo(1800, 0);
  });

  it("価格が0以下の場合は0を返す", () => {
    expect(calculateExpectedLtvGrossProfit(0, 0.55, 1.7)).toBe(0);
    expect(calculateExpectedLtvGrossProfit(-100, 0.55, 1.7)).toBe(0);
  });

  it("粗利率が0以下の場合は0を返す", () => {
    expect(calculateExpectedLtvGrossProfit(5000, 0, 1.7)).toBe(0);
    expect(calculateExpectedLtvGrossProfit(5000, -0.1, 1.7)).toBe(0);
  });

  it("リピート回数が1未満の場合は0を返す", () => {
    expect(calculateExpectedLtvGrossProfit(5000, 0.55, 0.5)).toBe(0);
  });
});

describe("ProductConfigからのLTV期待粗利計算", () => {
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
    marginRateNormal: 0.55,
    expectedRepeatOrdersAssumed: 1.7,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: 60,
    newCustomersTotal: 100,
    price: 5000,
  };

  it("通常商品の場合はexpectedRepeatOrdersAssumedを使用", () => {
    const result = calculateExpectedLtvGrossProfitFromConfig(
      { ...baseConfig, isNewProduct: false },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    // 5000 × 0.55 × (1 + 1.7) = 7425
    expect(result).toBeCloseTo(7425, 0);
  });

  it("NEW_PRODUCT期間中はprofileのprior値を使用", () => {
    const result = calculateExpectedLtvGrossProfitFromConfig(
      { ...baseConfig, isNewProduct: true },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    // SUPPLEMENT_HIGH_LTV_PROFILE.expectedRepeatOrdersPrior = 1.3
    // 5000 × 0.55 × (1 + 1.3) = 5000 × 0.55 × 2.3 = 6325
    expect(result).toBeCloseTo(6325, 0);
  });

  it("priceが未設定の場合は0を返す", () => {
    const result = calculateExpectedLtvGrossProfitFromConfig(
      { ...baseConfig, price: undefined },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    expect(result).toBe(0);
  });
});

describe("商品別累積赤字上限計算", () => {
  it("正常なパラメータで累積赤字上限を計算", () => {
    // expectedLtvGrossProfit=7425, lossBudgetMultiple=0.6
    // 累積赤字上限 = 7425 × 0.6 = 4455
    const result = calculateProductCumulativeLossLimit(7425, 0.6);
    expect(result).toBeCloseTo(4455, 0);
  });

  it("LTV期待粗利が0以下の場合は0を返す", () => {
    expect(calculateProductCumulativeLossLimit(0, 0.6)).toBe(0);
    expect(calculateProductCumulativeLossLimit(-100, 0.6)).toBe(0);
  });

  it("赤字許容倍率が0以下の場合は0を返す", () => {
    expect(calculateProductCumulativeLossLimit(7425, 0)).toBe(0);
    expect(calculateProductCumulativeLossLimit(7425, -0.1)).toBe(0);
  });
});

describe("ProductConfigからの累積赤字上限計算", () => {
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
    marginRateNormal: 0.55,
    expectedRepeatOrdersAssumed: 1.7,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: 60,
    newCustomersTotal: 100,
    price: 5000,
  };

  it("NEW_PRODUCT期間中はlossBudgetMultipleInitialを使用", () => {
    const result = calculateProductCumulativeLossLimitFromConfig(
      { ...baseConfig, isNewProduct: true },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    // LTV期待粗利 = 5000 × 0.55 × (1 + 1.3) = 6325
    // 累積赤字上限 = 6325 × 0.6 = 3795
    expect(result).toBeCloseTo(3795, 0);
  });

  it("昇格後はlossBudgetMultipleMatureを使用", () => {
    const result = calculateProductCumulativeLossLimitFromConfig(
      { ...baseConfig, isNewProduct: false },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    // LTV期待粗利 = 5000 × 0.55 × (1 + 1.7) = 7425
    // 累積赤字上限 = 7425 × 0.4 = 2970
    expect(result).toBeCloseTo(2970, 0);
  });
});

describe("グローバル累積赤字上限計算", () => {
  it("正常なパラメータでグローバル上限を計算", () => {
    // 全商品LTV期待粗利合計 = 1000000, globalLossBudgetRate = 0.15
    // グローバル上限 = 1000000 × 0.15 = 150000
    const result = calculateGlobalCumulativeLossLimit(1000000, 0.15);
    expect(result).toBe(150000);
  });

  it("デフォルトのglobalLossBudgetRateは0.15", () => {
    expect(GLOBAL_RISK_CONFIG_DEFAULTS.globalLossBudgetRate).toBe(0.15);
  });
});

describe("累積赤字上限判定", () => {
  it("累積赤字が上限以下の場合はfalse", () => {
    expect(isOverCumulativeLossLimit(4000, 5000)).toBe(false);
    expect(isOverCumulativeLossLimit(5000, 5000)).toBe(false);
  });

  it("累積赤字が上限を超える場合はtrue", () => {
    expect(isOverCumulativeLossLimit(5001, 5000)).toBe(true);
  });
});

describe("連続赤字月数上限判定", () => {
  it("連続赤字月数が上限以下の場合はfalse", () => {
    expect(isOverConsecutiveLossMonthsLimit(2, 3)).toBe(false);
    expect(isOverConsecutiveLossMonthsLimit(3, 3)).toBe(false);
  });

  it("連続赤字月数が上限を超える場合はtrue", () => {
    expect(isOverConsecutiveLossMonthsLimit(4, 3)).toBe(true);
  });
});

describe("ライフサイクル別連続赤字許容月数取得", () => {
  it("SUPPLEMENT_HIGH_LTV_PROFILEの各ライフサイクルの許容月数", () => {
    expect(getMaxConsecutiveLossMonths(SUPPLEMENT_HIGH_LTV_PROFILE, "LAUNCH_HARD")).toBe(6);
    expect(getMaxConsecutiveLossMonths(SUPPLEMENT_HIGH_LTV_PROFILE, "LAUNCH_SOFT")).toBe(4);
    expect(getMaxConsecutiveLossMonths(SUPPLEMENT_HIGH_LTV_PROFILE, "GROW")).toBe(3);
    expect(getMaxConsecutiveLossMonths(SUPPLEMENT_HIGH_LTV_PROFILE, "HARVEST")).toBe(1);
  });

  it("SINGLE_PURCHASE_PROFILEのHARVESTは0", () => {
    expect(getMaxConsecutiveLossMonths(SINGLE_PURCHASE_PROFILE, "HARVEST")).toBe(0);
  });
});

describe("リスク評価（assessProductRisk）", () => {
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
    marginRateNormal: 0.55,
    expectedRepeatOrdersAssumed: 1.7,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: 60,
    newCustomersTotal: 100,
    price: 5000,
    isNewProduct: false,
    cumulativeLoss: 0,
    consecutiveLossMonths: 0,
  };

  it("リスクなしの場合はLOW", () => {
    const result = assessProductRisk(baseConfig, SUPPLEMENT_HIGH_LTV_PROFILE);
    expect(result.riskLevel).toBe("LOW");
    expect(result.isAtRisk).toBe(false);
  });

  it("累積赤字比率50%以上でMEDIUM", () => {
    // 累積赤字上限 = 7425 × 0.4 = 2970
    // 50%は約1485
    const result = assessProductRisk(
      { ...baseConfig, cumulativeLoss: 1500 },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    expect(result.riskLevel).toBe("MEDIUM");
  });

  it("累積赤字比率80%以上でHIGH", () => {
    // 80%は約2376
    const result = assessProductRisk(
      { ...baseConfig, cumulativeLoss: 2400 },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    expect(result.riskLevel).toBe("HIGH");
  });

  it("累積赤字上限超過でCRITICAL", () => {
    const result = assessProductRisk(
      { ...baseConfig, cumulativeLoss: 3000 },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.isOverCumulativeLoss).toBe(true);
    expect(result.isAtRisk).toBe(true);
  });

  it("連続赤字月数上限超過でCRITICAL", () => {
    // GROW期間のSUPPLEMENT_HIGH_LTVは3ヶ月まで許容
    const result = assessProductRisk(
      { ...baseConfig, consecutiveLossMonths: 4 },
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    expect(result.riskLevel).toBe("CRITICAL");
    expect(result.isOverConsecutiveLossMonths).toBe(true);
    expect(result.isAtRisk).toBe(true);
  });
});

describe("各プロファイルの設定値確認", () => {
  it("SUPPLEMENT_HIGH_LTV_PROFILEの設定", () => {
    expect(SUPPLEMENT_HIGH_LTV_PROFILE.lossBudgetMultipleInitial).toBe(0.6);
    expect(SUPPLEMENT_HIGH_LTV_PROFILE.lossBudgetMultipleMature).toBe(0.4);
    expect(SUPPLEMENT_HIGH_LTV_PROFILE.expectedRepeatOrdersPrior).toBe(1.3);
    expect(SUPPLEMENT_HIGH_LTV_PROFILE.ltvSafetyFactorPrior).toBe(0.5);
  });

  it("SUPPLEMENT_STANDARD_PROFILEの設定", () => {
    expect(SUPPLEMENT_STANDARD_PROFILE.lossBudgetMultipleInitial).toBe(0.4);
    expect(SUPPLEMENT_STANDARD_PROFILE.lossBudgetMultipleMature).toBe(0.25);
    expect(SUPPLEMENT_STANDARD_PROFILE.expectedRepeatOrdersPrior).toBe(1.1);
  });

  it("SINGLE_PURCHASE_PROFILEの設定", () => {
    expect(SINGLE_PURCHASE_PROFILE.lossBudgetMultipleInitial).toBe(0.2);
    expect(SINGLE_PURCHASE_PROFILE.lossBudgetMultipleMature).toBe(0.1);
    expect(SINGLE_PURCHASE_PROFILE.expectedRepeatOrdersPrior).toBe(1.0);
  });

  it("DEFAULT_PROFILEの設定", () => {
    expect(DEFAULT_PROFILE.lossBudgetMultipleInitial).toBe(0.3);
    expect(DEFAULT_PROFILE.lossBudgetMultipleMature).toBe(0.2);
  });
});

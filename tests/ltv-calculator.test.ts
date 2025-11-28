/**
 * LTV（顧客生涯価値）ベースのACOS計算ロジックのテスト
 *
 * 収益モデル（LTV/単発購入）とライフサイクルステージに基づいて
 * 動的なACOSターゲットが正しく計算されることを検証
 */

import {
  determineLtvMode,
  calculateDaysSinceLaunch,
  computeBaseLtvTargetAcos,
  computeFinalTargetAcos,
  getTargetAcos,
  getTargetAcosWithDetails,
} from "../src/ltv/ltv-calculator";
import {
  ProductConfig,
  LtvMode,
  RevenueModel,
  DEFAULT_LTV_MODE_THRESHOLDS,
  ACOS_CONSTANTS,
} from "../src/ltv/types";

// =============================================================================
// テストヘルパー
// =============================================================================

/**
 * テスト用のProductConfigを作成
 */
function createProductConfig(
  overrides: Partial<ProductConfig> = {}
): ProductConfig {
  return {
    productId: "prod-001",
    asin: "B0XXXXXXXX",
    isActive: true,
    revenueModel: "LTV",
    ltvMode: "ASSUMED",
    marginRate: 0.4,
    expectedRepeatOrdersAssumed: 2.0,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: null,
    newCustomersTotal: 0,
    lifecycleState: "GROW",
    businessMode: "PROFIT",
    brandType: "GENERIC",
    experimentGroup: "CONTROL",
    ...overrides,
  };
}

// =============================================================================
// determineLtvMode テスト
// =============================================================================

describe("determineLtvMode", () => {
  describe("経過日数がnullの場合", () => {
    it("ASSUMEDを返す", () => {
      const result = determineLtvMode(null, 1000);
      expect(result).toBe("ASSUMED");
    });
  });

  describe("ASSUMED判定", () => {
    it("経過日数が足りない場合はASSUMED", () => {
      const result = determineLtvMode(30, 100);
      expect(result).toBe("ASSUMED");
    });

    it("新規顧客数が足りない場合はASSUMED", () => {
      const result = determineLtvMode(100, 30);
      expect(result).toBe("ASSUMED");
    });
  });

  describe("EARLY_ESTIMATE判定", () => {
    it("60日以上かつ50人以上でEARLY_ESTIMATE", () => {
      const result = determineLtvMode(60, 50);
      expect(result).toBe("EARLY_ESTIMATE");
    });

    it("90日で100人でもEARLY_ESTIMATE（MEASURED閾値未満）", () => {
      const result = determineLtvMode(90, 100);
      expect(result).toBe("EARLY_ESTIMATE");
    });
  });

  describe("MEASURED判定", () => {
    it("120日以上かつ200人以上でMEASURED", () => {
      const result = determineLtvMode(120, 200);
      expect(result).toBe("MEASURED");
    });

    it("180日で500人でもMEASURED", () => {
      const result = determineLtvMode(180, 500);
      expect(result).toBe("MEASURED");
    });
  });

  describe("カスタム閾値", () => {
    it("カスタム閾値でMEASURED判定", () => {
      const customThresholds = {
        EARLY_ESTIMATE_DAYS_MIN: 30,
        MEASURED_DAYS_MIN: 60,
        EARLY_ESTIMATE_NEW_CUSTOMERS_MIN: 20,
        MEASURED_NEW_CUSTOMERS_MIN: 100,
      };
      const result = determineLtvMode(60, 100, customThresholds);
      expect(result).toBe("MEASURED");
    });
  });
});

// =============================================================================
// calculateDaysSinceLaunch テスト
// =============================================================================

describe("calculateDaysSinceLaunch", () => {
  it("launchDateがnullならnullを返す", () => {
    const result = calculateDaysSinceLaunch(null);
    expect(result).toBeNull();
  });

  it("経過日数を正しく計算", () => {
    const launchDate = new Date("2024-01-01");
    const referenceDate = new Date("2024-01-11");
    const result = calculateDaysSinceLaunch(launchDate, referenceDate);
    expect(result).toBe(10);
  });

  it("同日なら0を返す", () => {
    const launchDate = new Date("2024-01-01");
    const referenceDate = new Date("2024-01-01");
    const result = calculateDaysSinceLaunch(launchDate, referenceDate);
    expect(result).toBe(0);
  });

  it("未来の日付でも0以上を返す", () => {
    const launchDate = new Date("2024-01-15");
    const referenceDate = new Date("2024-01-01");
    const result = calculateDaysSinceLaunch(launchDate, referenceDate);
    expect(result).toBe(0); // Math.max(0, negative) = 0
  });
});

// =============================================================================
// computeBaseLtvTargetAcos テスト
// =============================================================================

describe("computeBaseLtvTargetAcos", () => {
  describe("SINGLE_PURCHASE商品", () => {
    it("marginRate × SINGLE_PURCHASE_SAFETY_FACTOR で計算される", () => {
      const config = createProductConfig({
        revenueModel: "SINGLE_PURCHASE",
        marginRate: 0.4, // 40%
        expectedRepeatOrdersAssumed: 3.0, // これは無視される
      });

      const result = computeBaseLtvTargetAcos(config);

      // 0.4 × 0.8 = 0.32
      expect(result.acos).toBeCloseTo(0.32, 6);
      expect(result.details.revenueModel).toBe("SINGLE_PURCHASE");
      expect(result.details.ltvMode).toBeNull();
      expect(result.details.expectedRepeatOrders).toBe(1);
      expect(result.details.safetyFactor).toBe(
        ACOS_CONSTANTS.SINGLE_PURCHASE_SAFETY_FACTOR
      );
    });

    it("expectedRepeatOrdersMeasuredがあっても無視される", () => {
      const config = createProductConfig({
        revenueModel: "SINGLE_PURCHASE",
        marginRate: 0.5,
        ltvMode: "MEASURED",
        expectedRepeatOrdersMeasured: 4.0, // これは無視される
      });

      const result = computeBaseLtvTargetAcos(config);

      // 0.5 × 0.8 = 0.4
      expect(result.acos).toBe(0.4);
      expect(result.details.expectedRepeatOrders).toBe(1);
    });
  });

  describe("LTV商品 - ASSUMEDモード", () => {
    it("仮定値で計算される", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.0,
        safetyFactorAssumed: 0.7,
      });

      const result = computeBaseLtvTargetAcos(config);

      // 0.4 × 2.0 × 0.7 = 0.56
      expect(result.acos).toBeCloseTo(0.56, 6);
      expect(result.details.ltvMode).toBe("ASSUMED");
      expect(result.details.expectedRepeatOrders).toBe(2.0);
      expect(result.details.safetyFactor).toBe(0.7);
    });
  });

  describe("LTV商品 - EARLY_ESTIMATEモード", () => {
    it("仮定値で計算される（MEASUREDと同じ扱い）", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "EARLY_ESTIMATE",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.5,
        safetyFactorAssumed: 0.7,
      });

      const result = computeBaseLtvTargetAcos(config);

      // 0.4 × 2.5 × 0.7 = 0.7
      expect(result.acos).toBe(0.7);
      expect(result.details.ltvMode).toBe("EARLY_ESTIMATE");
    });
  });

  describe("LTV商品 - MEASUREDモード", () => {
    it("実測値で計算される", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "MEASURED",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.0, // これは無視
        expectedRepeatOrdersMeasured: 3.0, // これを使用
        safetyFactorAssumed: 0.7, // これは無視
        safetyFactorMeasured: 0.85, // これを使用
      });

      const result = computeBaseLtvTargetAcos(config);

      // 0.4 × 3.0 × 0.85 = 1.02 → clipped to 0.9
      expect(result.acos).toBe(0.9);
      expect(result.details.ltvMode).toBe("MEASURED");
      expect(result.details.expectedRepeatOrders).toBe(3.0);
      expect(result.details.safetyFactor).toBe(0.85);
      expect(result.details.clipped).toBe(true);
      expect(result.details.calculatedAcos).toBeCloseTo(1.02, 2);
    });

    it("expectedRepeatOrdersMeasuredがnullならASSUMED値を使う", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "MEASURED",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.0,
        expectedRepeatOrdersMeasured: null, // nullなので仮定値を使用
        safetyFactorAssumed: 0.7,
      });

      const result = computeBaseLtvTargetAcos(config);

      // 0.4 × 2.0 × 0.7 = 0.56
      expect(result.acos).toBeCloseTo(0.56, 6);
    });
  });

  describe("ACOSのクリッピング", () => {
    it("上限0.9でクリップされる", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.8,
        expectedRepeatOrdersAssumed: 3.0,
        safetyFactorAssumed: 0.7,
      });

      const result = computeBaseLtvTargetAcos(config);

      // 0.8 × 3.0 × 0.7 = 1.68 → clipped to 0.9
      expect(result.acos).toBe(0.9);
      expect(result.details.clipped).toBe(true);
    });

    it("下限0でクリップされる（理論上）", () => {
      const config = createProductConfig({
        revenueModel: "SINGLE_PURCHASE",
        marginRate: 0,
      });

      const result = computeBaseLtvTargetAcos(config);

      expect(result.acos).toBe(0);
    });
  });
});

// =============================================================================
// computeFinalTargetAcos テスト
// =============================================================================

describe("computeFinalTargetAcos", () => {
  describe("LAUNCH_HARDステージ", () => {
    it("baseLtvAcosがそのまま使用される（上限0.60）", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.0,
        safetyFactorAssumed: 0.7,
        lifecycleState: "LAUNCH_HARD",
      });

      const result = computeFinalTargetAcos(config);

      // baseLtvAcos = 0.4 × 2.0 × 0.7 = 0.56
      // LAUNCH_HARD: min(0.56, 0.60) = 0.56
      expect(result.acos).toBeCloseTo(0.56, 6);
      expect(result.details.multiplier).toBe(1.0);
      expect(result.details.cap).toBe(0.60);
    });

    it("上限0.60でキャップされる", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.5,
        expectedRepeatOrdersAssumed: 2.5,
        safetyFactorAssumed: 0.7,
        lifecycleState: "LAUNCH_HARD",
      });

      const result = computeFinalTargetAcos(config);

      // baseLtvAcos = 0.5 × 2.5 × 0.7 = 0.875
      // LAUNCH_HARD: min(0.875, 0.60) = 0.60
      expect(result.acos).toBe(0.60);
    });
  });

  describe("LAUNCH_SOFTステージ", () => {
    it("baseLtvAcos × 0.9で計算される（上限0.50）", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.0,
        safetyFactorAssumed: 0.7,
        lifecycleState: "LAUNCH_SOFT",
      });

      const result = computeFinalTargetAcos(config);

      // baseLtvAcos = 0.4 × 2.0 × 0.7 = 0.56
      // LAUNCH_SOFT: min(0.56 × 0.9, 0.50) = min(0.504, 0.50) = 0.50
      expect(result.acos).toBe(0.50);
      expect(result.details.multiplier).toBe(0.9);
      expect(result.details.cap).toBe(0.50);
    });
  });

  describe("GROWステージ", () => {
    it("baseLtvAcos × 0.8で計算される（上限0.45）", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.0,
        safetyFactorAssumed: 0.7,
        lifecycleState: "GROW",
      });

      const result = computeFinalTargetAcos(config);

      // baseLtvAcos = 0.4 × 2.0 × 0.7 = 0.56
      // GROW: min(0.56 × 0.8, 0.45) = min(0.448, 0.45) = 0.448
      expect(result.acos).toBeCloseTo(0.448, 3);
      expect(result.details.multiplier).toBe(0.8);
      expect(result.details.cap).toBe(0.45);
    });
  });

  describe("HARVESTステージ", () => {
    it("marginRate × 0.8で計算される（上限0.35）", () => {
      const config = createProductConfig({
        revenueModel: "LTV",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 3.0, // これは無視される
        lifecycleState: "HARVEST",
      });

      const result = computeFinalTargetAcos(config);

      // HARVEST: marginRate × 0.8 = 0.4 × 0.8 = 0.32
      // min(0.32, 0.35) = 0.32
      expect(result.acos).toBeCloseTo(0.32, 6);
      expect(result.details.multiplier).toBe(0.8);
      expect(result.details.cap).toBe(0.35);
    });

    it("上限0.35でキャップされる", () => {
      const config = createProductConfig({
        marginRate: 0.5,
        lifecycleState: "HARVEST",
      });

      const result = computeFinalTargetAcos(config);

      // HARVEST: marginRate × 0.8 = 0.5 × 0.8 = 0.40
      // min(0.40, 0.35) = 0.35
      expect(result.acos).toBe(0.35);
    });
  });
});

// =============================================================================
// LTV商品 vs SINGLE_PURCHASE商品の比較テスト
// =============================================================================

describe("LTV商品 vs SINGLE_PURCHASE商品の比較", () => {
  const baseConfig = {
    marginRate: 0.4,
    expectedRepeatOrdersAssumed: 2.5,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
  };

  describe("LAUNCH_HARDステージ", () => {
    it("LTV商品はSINGLE_PURCHASE商品より高いACOSになる", () => {
      const ltvConfig = createProductConfig({
        ...baseConfig,
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        lifecycleState: "LAUNCH_HARD",
      });

      const singleConfig = createProductConfig({
        ...baseConfig,
        revenueModel: "SINGLE_PURCHASE",
        lifecycleState: "LAUNCH_HARD",
      });

      const ltvResult = computeFinalTargetAcos(ltvConfig);
      const singleResult = computeFinalTargetAcos(singleConfig);

      // LTV: min(0.4 × 2.5 × 0.7, 0.60) = min(0.7, 0.60) = 0.60
      // SINGLE: min(0.4 × 0.8, 0.60) = min(0.32, 0.60) = 0.32
      expect(ltvResult.acos).toBe(0.60);
      expect(singleResult.acos).toBeCloseTo(0.32, 6);
      expect(ltvResult.acos).toBeGreaterThan(singleResult.acos);
    });
  });

  describe("GROWステージ", () => {
    it("LTV商品はSINGLE_PURCHASE商品より高いACOSになる", () => {
      const ltvConfig = createProductConfig({
        ...baseConfig,
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        lifecycleState: "GROW",
      });

      const singleConfig = createProductConfig({
        ...baseConfig,
        revenueModel: "SINGLE_PURCHASE",
        lifecycleState: "GROW",
      });

      const ltvResult = computeFinalTargetAcos(ltvConfig);
      const singleResult = computeFinalTargetAcos(singleConfig);

      // LTV: min((0.4 × 2.5 × 0.7) × 0.8, 0.45) = min(0.56, 0.45) = 0.45
      // SINGLE: min((0.4 × 0.8) × 0.8, 0.45) = min(0.256, 0.45) = 0.256
      expect(ltvResult.acos).toBe(0.45);
      expect(singleResult.acos).toBeCloseTo(0.256, 3);
      expect(ltvResult.acos).toBeGreaterThan(singleResult.acos);
    });
  });

  describe("ライフサイクルステージによるACOS差", () => {
    it("LTV商品: LAUNCH_HARDとGROWで明らかに違う値になる", () => {
      const launchConfig = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.0,
        safetyFactorAssumed: 0.7,
        lifecycleState: "LAUNCH_HARD",
      });

      const growConfig = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.4,
        expectedRepeatOrdersAssumed: 2.0,
        safetyFactorAssumed: 0.7,
        lifecycleState: "GROW",
      });

      const launchResult = computeFinalTargetAcos(launchConfig);
      const growResult = computeFinalTargetAcos(growConfig);

      // LAUNCH_HARD: 0.56
      // GROW: 0.448
      expect(launchResult.acos).toBeCloseTo(0.56, 6);
      expect(growResult.acos).toBeCloseTo(0.448, 3);
      expect(launchResult.acos).toBeGreaterThan(growResult.acos);
    });
  });
});

// =============================================================================
// 便利関数テスト
// =============================================================================

describe("getTargetAcos", () => {
  it("最終ACOSを直接取得できる", () => {
    const config = createProductConfig({
      revenueModel: "LTV",
      ltvMode: "ASSUMED",
      marginRate: 0.4,
      expectedRepeatOrdersAssumed: 2.0,
      safetyFactorAssumed: 0.7,
      lifecycleState: "GROW",
    });

    const result = getTargetAcos(config);

    expect(result).toBeCloseTo(0.448, 3);
  });
});

describe("getTargetAcosWithDetails", () => {
  it("すべての詳細情報を取得できる", () => {
    const config = createProductConfig({
      revenueModel: "LTV",
      ltvMode: "ASSUMED",
      marginRate: 0.4,
      expectedRepeatOrdersAssumed: 2.0,
      safetyFactorAssumed: 0.7,
      lifecycleState: "GROW",
    });

    const result = getTargetAcosWithDetails(config);

    expect(result.targetAcos).toBeCloseTo(0.448, 3);
    expect(result.baseLtvAcosDetails.revenueModel).toBe("LTV");
    expect(result.baseLtvAcosDetails.ltvMode).toBe("ASSUMED");
    expect(result.baseLtvAcosDetails.calculatedAcos).toBeCloseTo(0.56, 6);
    expect(result.finalAcosDetails.lifecycleState).toBe("GROW");
    expect(result.finalAcosDetails.multiplier).toBe(0.8);
  });
});

// =============================================================================
// ユーザー要件検証テスト
// =============================================================================

describe("ユーザー要件検証", () => {
  describe("サプリ商品（LTV）のテスト", () => {
    it("expectedRepeatOrdersAssumed > 1のとき、LAUNCH_HARDとGROWで明らかに違うACOS", () => {
      const supplementConfigLaunch = createProductConfig({
        productId: "supplement-001",
        asin: "B0SUPPLEMENT",
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate: 0.45,
        expectedRepeatOrdersAssumed: 2.8, // > 1
        safetyFactorAssumed: 0.7,
        lifecycleState: "LAUNCH_HARD",
      });

      const supplementConfigGrow = createProductConfig({
        ...supplementConfigLaunch,
        lifecycleState: "GROW",
      });

      const launchAcos = getTargetAcos(supplementConfigLaunch);
      const growAcos = getTargetAcos(supplementConfigGrow);

      // LAUNCH_HARD: min(0.45 × 2.8 × 0.7, 0.60) = min(0.882, 0.60) = 0.60
      // GROW: min((0.45 × 2.8 × 0.7) × 0.8, 0.45) = min(0.7056, 0.45) = 0.45
      expect(launchAcos).toBe(0.60);
      expect(growAcos).toBe(0.45);
      expect(launchAcos - growAcos).toBeGreaterThanOrEqual(0.1); // 明らかに違う値
    });
  });

  describe("シューズ商品（SINGLE_PURCHASE）のテスト", () => {
    it("expectedRepeatOrdersに関係なく、単発商品として妥当な値になる", () => {
      const shoesConfig1 = createProductConfig({
        productId: "shoes-001",
        asin: "B0SHOES",
        revenueModel: "SINGLE_PURCHASE",
        marginRate: 0.35,
        expectedRepeatOrdersAssumed: 1.0,
        lifecycleState: "GROW",
      });

      const shoesConfig2 = createProductConfig({
        ...shoesConfig1,
        expectedRepeatOrdersAssumed: 5.0, // 高い値を設定しても
        expectedRepeatOrdersMeasured: 8.0, // これも無視される
      });

      const acos1 = getTargetAcos(shoesConfig1);
      const acos2 = getTargetAcos(shoesConfig2);

      // どちらも同じ計算結果になる
      // SINGLE_PURCHASE: min((0.35 × 0.8) × 0.8, 0.45) = min(0.224, 0.45) = 0.224
      expect(acos1).toBeCloseTo(0.224, 3);
      expect(acos2).toBeCloseTo(0.224, 3);
      expect(acos1).toBe(acos2);
    });

    it("サプリ商品より明らかに低いACOSになる", () => {
      // 同じmarginRateで比較
      const marginRate = 0.4;

      const supplementConfig = createProductConfig({
        revenueModel: "LTV",
        ltvMode: "ASSUMED",
        marginRate,
        expectedRepeatOrdersAssumed: 2.5,
        safetyFactorAssumed: 0.7,
        lifecycleState: "GROW",
      });

      const shoesConfig = createProductConfig({
        revenueModel: "SINGLE_PURCHASE",
        marginRate,
        lifecycleState: "GROW",
      });

      const supplementAcos = getTargetAcos(supplementConfig);
      const shoesAcos = getTargetAcos(shoesConfig);

      // サプリ: min((0.4 × 2.5 × 0.7) × 0.8, 0.45) = min(0.56, 0.45) = 0.45
      // シューズ: min((0.4 × 0.8) × 0.8, 0.45) = min(0.256, 0.45) = 0.256
      expect(supplementAcos).toBe(0.45);
      expect(shoesAcos).toBeCloseTo(0.256, 3);
      expect(supplementAcos).toBeGreaterThan(shoesAcos);
      expect(supplementAcos - shoesAcos).toBeGreaterThan(0.1); // 明らかに違う
    });
  });
});

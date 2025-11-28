/**
 * 実測LTV（measuredLtv）テスト
 */

import {
  RepeatMetrics1y,
  ProfitMetrics1y,
  MeasuredLtvInput,
  MeasuredLtvConfig,
  DEFAULT_MEASURED_LTV_CONFIG,
  calculateDaysActive,
  getLtvSafetyFactorMeasured,
  canUseMeasuredLtv,
  computeMeasuredLtv,
  resolveLtvForProduct,
  calculateCumulativeLossLimitFromResolvedLtv,
  ResolveLtvInput,
  isValidLtvSource,
  VALID_LTV_SOURCES,
} from "../../src/ltv/measuredLtv";

describe("実測LTV（measuredLtv）", () => {
  // テスト用のヘルパー関数
  const createRepeatMetrics = (
    uniqueCustomers: number,
    totalOrders: number
  ): RepeatMetrics1y => ({
    asin: "B00TEST123",
    uniqueCustomers1y: uniqueCustomers,
    totalOrders1y: totalOrders,
    periodStart: new Date("2024-01-01"),
    periodEnd: new Date("2024-12-31"),
  });

  const createProfitMetrics = (
    totalGrossProfit: number,
    totalOrders: number
  ): ProfitMetrics1y => ({
    asin: "B00TEST123",
    totalGrossProfit1y: totalGrossProfit,
    totalOrders1y: totalOrders,
    avgSellingPrice1y: 3000,
    avgMarginRate1y: 0.4,
  });

  const createMeasuredLtvInput = (
    uniqueCustomers: number,
    totalOrders: number,
    totalGrossProfit: number,
    daysAgo: number = 200
  ): MeasuredLtvInput => {
    const launchDate = new Date();
    launchDate.setDate(launchDate.getDate() - daysAgo);
    return {
      asin: "B00TEST123",
      repeatMetrics: createRepeatMetrics(uniqueCustomers, totalOrders),
      profitMetrics: createProfitMetrics(totalGrossProfit, totalOrders),
      launchDate,
      productLtvProfile: "SUPPLEMENT_NORMAL",
    };
  };

  describe("isValidLtvSource", () => {
    it("有効なLtvSourceを判定できる", () => {
      expect(isValidLtvSource("PRIOR")).toBe(true);
      expect(isValidLtvSource("MEASURED")).toBe(true);
    });

    it("無効な値を判定できる", () => {
      expect(isValidLtvSource("INVALID")).toBe(false);
      expect(isValidLtvSource("")).toBe(false);
      expect(isValidLtvSource(null)).toBe(false);
      expect(isValidLtvSource(undefined)).toBe(false);
      expect(isValidLtvSource(123)).toBe(false);
    });

    it("VALID_LTV_SOURCESが正しい", () => {
      expect(VALID_LTV_SOURCES).toEqual(["PRIOR", "MEASURED"]);
    });
  });

  describe("calculateDaysActive", () => {
    it("正しく日数を計算する", () => {
      const launchDate = new Date();
      launchDate.setDate(launchDate.getDate() - 100);
      const result = calculateDaysActive(launchDate);
      expect(result).toBe(100);
    });

    it("将来の日付の場合は0を返す", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const result = calculateDaysActive(futureDate);
      expect(result).toBe(0);
    });

    it("基準日を指定できる", () => {
      const launchDate = new Date("2024-01-01");
      const referenceDate = new Date("2024-04-10");
      const result = calculateDaysActive(launchDate, referenceDate);
      expect(result).toBe(100);
    });
  });

  describe("getLtvSafetyFactorMeasured", () => {
    it("プロファイル別に正しい安全係数を返す", () => {
      expect(getLtvSafetyFactorMeasured("SUPPLEMENT_HIGH_LTV")).toBe(0.80);
      expect(getLtvSafetyFactorMeasured("SUPPLEMENT_NORMAL")).toBe(0.75);
      expect(getLtvSafetyFactorMeasured("LOW_LTV_SUPPLEMENT")).toBe(0.70);
    });

    it("カスタム設定を使用できる", () => {
      const customConfig: MeasuredLtvConfig = {
        ...DEFAULT_MEASURED_LTV_CONFIG,
        ltvSafetyFactorMeasuredByProfile: {
          SUPPLEMENT_HIGH_LTV: 0.90,
          SUPPLEMENT_NORMAL: 0.85,
          LOW_LTV_SUPPLEMENT: 0.80,
        },
      };
      expect(getLtvSafetyFactorMeasured("SUPPLEMENT_NORMAL", customConfig)).toBe(0.85);
    });
  });

  describe("canUseMeasuredLtv", () => {
    it("条件を満たす場合はtrueを返す", () => {
      expect(canUseMeasuredLtv(300, 180)).toBe(true);
      expect(canUseMeasuredLtv(500, 365)).toBe(true);
    });

    it("顧客数が足りない場合はfalseを返す", () => {
      expect(canUseMeasuredLtv(299, 180)).toBe(false);
      expect(canUseMeasuredLtv(100, 365)).toBe(false);
    });

    it("日数が足りない場合はfalseを返す", () => {
      expect(canUseMeasuredLtv(300, 179)).toBe(false);
      expect(canUseMeasuredLtv(500, 90)).toBe(false);
    });

    it("両方足りない場合はfalseを返す", () => {
      expect(canUseMeasuredLtv(100, 90)).toBe(false);
    });

    it("カスタム設定を使用できる", () => {
      const customConfig: MeasuredLtvConfig = {
        ...DEFAULT_MEASURED_LTV_CONFIG,
        minCustomersForMeasured: 100,
        minDaysActiveForMeasured: 90,
      };
      expect(canUseMeasuredLtv(100, 90, customConfig)).toBe(true);
      expect(canUseMeasuredLtv(99, 90, customConfig)).toBe(false);
    });
  });

  describe("computeMeasuredLtv", () => {
    describe("条件を満たす場合", () => {
      it("正しく実測LTVを計算する", () => {
        // 顧客400人、注文600回、粗利60万円
        // extraOrdersPerCustomer = (600 - 400) / 400 = 0.5
        // totalOrdersPerCustomer = 1 + 0.5 = 1.5
        // avgGrossProfitPerOrder = 600000 / 600 = 1000円
        // measuredLtvGross = 1000 × 1.5 = 1500円
        // ltvEffectiveGross = 1500 × 0.75 = 1125円
        const input = createMeasuredLtvInput(400, 600, 600000, 200);
        const result = computeMeasuredLtv(input);

        expect(result.ltvSource).toBe("MEASURED");
        expect(result.avgGrossProfitPerOrder1y).toBe(1000);
        expect(result.extraOrdersPerCustomer1y).toBe(0.5);
        expect(result.totalOrdersPerCustomer1y).toBe(1.5);
        expect(result.measuredLtvGross).toBe(1500);
        expect(result.ltvSafetyFactorMeasured).toBe(0.75);
        expect(result.ltvEffectiveGross).toBe(1125);
        expect(result.customersUsed).toBe(400);
        expect(result.daysActive).toBeGreaterThanOrEqual(199);
      });

      it("リピートなし（顧客数=注文数）の場合も正しく計算する", () => {
        // 顧客300人、注文300回
        // extraOrdersPerCustomer = 0
        // totalOrdersPerCustomer = 1
        const input = createMeasuredLtvInput(300, 300, 300000, 200);
        const result = computeMeasuredLtv(input);

        expect(result.ltvSource).toBe("MEASURED");
        expect(result.extraOrdersPerCustomer1y).toBe(0);
        expect(result.totalOrdersPerCustomer1y).toBe(1);
        expect(result.measuredLtvGross).toBe(1000); // 300000 / 300
      });

      it("高リピート率の場合も正しく計算する", () => {
        // 顧客300人、注文900回（3倍）
        // extraOrdersPerCustomer = (900 - 300) / 300 = 2
        // totalOrdersPerCustomer = 1 + 2 = 3
        const input = createMeasuredLtvInput(300, 900, 900000, 200);
        const result = computeMeasuredLtv(input);

        expect(result.ltvSource).toBe("MEASURED");
        expect(result.extraOrdersPerCustomer1y).toBe(2);
        expect(result.totalOrdersPerCustomer1y).toBe(3);
        expect(result.measuredLtvGross).toBe(3000); // 1000 × 3
      });
    });

    describe("条件を満たさない場合", () => {
      it("顧客数不足の場合はPRIORを返す", () => {
        const input = createMeasuredLtvInput(200, 400, 400000, 200);
        const result = computeMeasuredLtv(input);

        expect(result.ltvSource).toBe("PRIOR");
        expect(result.calculationNote).toContain("実測LTV条件未達");
        expect(result.calculationNote).toContain("顧客数=200");
      });

      it("日数不足の場合はPRIORを返す", () => {
        const input = createMeasuredLtvInput(400, 600, 600000, 100);
        const result = computeMeasuredLtv(input);

        expect(result.ltvSource).toBe("PRIOR");
        expect(result.calculationNote).toContain("実測LTV条件未達");
        expect(result.calculationNote).toContain("日数=");
      });
    });

    describe("エッジケース", () => {
      it("顧客数0の場合はPRIORを返す", () => {
        const input = createMeasuredLtvInput(0, 0, 0, 200);
        const result = computeMeasuredLtv(input);

        expect(result.ltvSource).toBe("PRIOR");
        expect(result.measuredLtvGross).toBe(0);
        expect(result.calculationNote).toContain("データ不足");
      });

      it("注文数が顧客数より少ない異常データの場合は0にクリップ", () => {
        // 通常ありえない：顧客400人なのに注文200回
        // extraOrders = (200 - 400) / 400 = -0.5 → 0にクリップ
        const input = createMeasuredLtvInput(400, 200, 200000, 200);
        const result = computeMeasuredLtv(input);

        expect(result.extraOrdersPerCustomer1y).toBe(0);
        expect(result.totalOrdersPerCustomer1y).toBe(1);
      });

      it("プロファイル別に安全係数が変わる", () => {
        const baseInput = createMeasuredLtvInput(400, 600, 600000, 200);

        const highLtvInput = { ...baseInput, productLtvProfile: "SUPPLEMENT_HIGH_LTV" as const };
        const lowLtvInput = { ...baseInput, productLtvProfile: "LOW_LTV_SUPPLEMENT" as const };

        const highResult = computeMeasuredLtv(highLtvInput);
        const lowResult = computeMeasuredLtv(lowLtvInput);

        expect(highResult.ltvSafetyFactorMeasured).toBe(0.80);
        expect(lowResult.ltvSafetyFactorMeasured).toBe(0.70);

        // measuredLtvGrossは同じ
        expect(highResult.measuredLtvGross).toBe(1500);
        expect(lowResult.measuredLtvGross).toBe(1500);

        // ltvEffectiveGrossは異なる
        expect(highResult.ltvEffectiveGross).toBe(1500 * 0.80);
        expect(lowResult.ltvEffectiveGross).toBe(1500 * 0.70);
      });
    });
  });

  describe("resolveLtvForProduct", () => {
    describe("新商品の場合", () => {
      it("事前LTV（PRIOR）を使用する", () => {
        const input: ResolveLtvInput = {
          asin: "B00NEW123",
          isNewProduct: true,
          priorLtvGross: 5000,
          priorSafetyFactor: 0.8,
        };
        const result = resolveLtvForProduct(input);

        expect(result.ltvSource).toBe("PRIOR");
        expect(result.ltvEffectiveGross).toBe(4000); // 5000 × 0.8
        expect(result.measuredLtvGross).toBeNull();
        expect(result.details.resolutionReason).toContain("新商品");
      });
    });

    describe("既存商品で実測LTVデータがない場合", () => {
      it("事前LTV（PRIOR）を使用する", () => {
        const input: ResolveLtvInput = {
          asin: "B00EXIST123",
          isNewProduct: false,
          priorLtvGross: 5000,
          priorSafetyFactor: 0.8,
        };
        const result = resolveLtvForProduct(input);

        expect(result.ltvSource).toBe("PRIOR");
        expect(result.ltvEffectiveGross).toBe(4000);
        expect(result.details.resolutionReason).toContain("実測LTVデータがない");
      });
    });

    describe("既存商品で実測LTV条件を満たす場合", () => {
      it("実測LTV（MEASURED）を使用する", () => {
        const measuredInput = createMeasuredLtvInput(400, 600, 600000, 200);
        const input: ResolveLtvInput = {
          asin: "B00EXIST123",
          isNewProduct: false,
          priorLtvGross: 5000,
          priorSafetyFactor: 0.8,
          measuredLtvInput: measuredInput,
          productLtvProfile: "SUPPLEMENT_NORMAL",
        };
        const result = resolveLtvForProduct(input);

        expect(result.ltvSource).toBe("MEASURED");
        expect(result.ltvEffectiveGross).toBe(1125); // 1500 × 0.75
        expect(result.measuredLtvGross).toBe(1500);
        expect(result.safetyFactorUsed).toBe(0.75);
        expect(result.details.measuredLtvResult).toBeDefined();
      });
    });

    describe("既存商品で実測LTV条件を満たさない場合", () => {
      it("事前LTV（PRIOR）を使用する", () => {
        const measuredInput = createMeasuredLtvInput(100, 200, 200000, 200); // 顧客数不足
        const input: ResolveLtvInput = {
          asin: "B00EXIST123",
          isNewProduct: false,
          priorLtvGross: 5000,
          priorSafetyFactor: 0.8,
          measuredLtvInput: measuredInput,
        };
        const result = resolveLtvForProduct(input);

        expect(result.ltvSource).toBe("PRIOR");
        expect(result.ltvEffectiveGross).toBe(4000);
        expect(result.measuredLtvGross).not.toBeNull(); // 計算はする
        expect(result.details.resolutionReason).toContain("実測LTV条件未達");
      });
    });
  });

  describe("calculateCumulativeLossLimitFromResolvedLtv", () => {
    it("正しく累積損失上限を計算する", () => {
      const measuredInput = createMeasuredLtvInput(400, 600, 600000, 200);
      const resolvedLtv = resolveLtvForProduct({
        asin: "B00TEST123",
        isNewProduct: false,
        priorLtvGross: 5000,
        priorSafetyFactor: 0.8,
        measuredLtvInput: measuredInput,
      });

      // ltvEffectiveGross = 1125円
      // lossBudgetMultiple = 2.0
      // 累積損失上限 = 1125 × 2.0 = 2250円
      const limit = calculateCumulativeLossLimitFromResolvedLtv(resolvedLtv, 2.0);
      expect(limit).toBe(2250);
    });

    it("事前LTVの場合も正しく計算する", () => {
      const resolvedLtv = resolveLtvForProduct({
        asin: "B00NEW123",
        isNewProduct: true,
        priorLtvGross: 5000,
        priorSafetyFactor: 0.8,
      });

      // ltvEffectiveGross = 4000円
      // lossBudgetMultiple = 1.5
      // 累積損失上限 = 4000 × 1.5 = 6000円
      const limit = calculateCumulativeLossLimitFromResolvedLtv(resolvedLtv, 1.5);
      expect(limit).toBe(6000);
    });

    it("LTV0の場合は0を返す", () => {
      const resolvedLtv = resolveLtvForProduct({
        asin: "B00TEST123",
        isNewProduct: true,
        priorLtvGross: 0,
        priorSafetyFactor: 0.8,
      });

      const limit = calculateCumulativeLossLimitFromResolvedLtv(resolvedLtv, 2.0);
      expect(limit).toBe(0);
    });

    it("倍率0の場合は0を返す", () => {
      const resolvedLtv = resolveLtvForProduct({
        asin: "B00TEST123",
        isNewProduct: true,
        priorLtvGross: 5000,
        priorSafetyFactor: 0.8,
      });

      const limit = calculateCumulativeLossLimitFromResolvedLtv(resolvedLtv, 0);
      expect(limit).toBe(0);
    });
  });

  describe("DEFAULT_MEASURED_LTV_CONFIG", () => {
    it("適切なデフォルト値が設定されている", () => {
      expect(DEFAULT_MEASURED_LTV_CONFIG.minCustomersForMeasured).toBe(300);
      expect(DEFAULT_MEASURED_LTV_CONFIG.minDaysActiveForMeasured).toBe(180);
      expect(DEFAULT_MEASURED_LTV_CONFIG.ltvSafetyFactorMeasuredByProfile).toEqual({
        SUPPLEMENT_HIGH_LTV: 0.80,
        SUPPLEMENT_NORMAL: 0.75,
        LOW_LTV_SUPPLEMENT: 0.70,
      });
    });
  });
});

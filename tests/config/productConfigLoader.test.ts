/**
 * ProductConfigLoaderのテスト
 */

// BigQueryのモック
const mockQuery = jest.fn();
jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: jest.fn().mockImplementation(() => ({
    query: mockQuery,
  })),
}));

import {
  loadAllProductConfigs,
  loadProductConfigByAsin,
  loadProductConfigsByAsins,
  getActiveAsins,
} from "../../src/config/productConfigLoader";

// =============================================================================
// テストデータ
// =============================================================================

const createMockProductRow = (overrides: Record<string, unknown> = {}) => ({
  asin: "B0TEST1234",
  product_id: "PROD001",
  sku: "SKU001",
  is_active: true,
  revenue_model: "LTV",
  lifecycle_state: "GROW",
  business_mode: "PROFIT",
  category: "SUPPLEMENT",
  brand_type: "GENERIC",
  experiment_group: "CONTROL",
  margin_rate: 0.4,
  expected_repeat_orders_assumed: 2.0,
  expected_repeat_orders_measured_180d: 1.8,
  safety_factor_assumed: 0.7,
  safety_factor_measured: 0.85,
  launch_date: new Date("2024-01-15"),
  new_customers_total: 500,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

// =============================================================================
// loadAllProductConfigs テスト
// =============================================================================

describe("loadAllProductConfigs", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const options = {
    projectId: "test-project",
    dataset: "test_dataset",
  };

  it("アクティブな商品設定をロードできる", async () => {
    mockQuery.mockResolvedValueOnce([
      [
        createMockProductRow({ asin: "B0TEST0001" }),
        createMockProductRow({ asin: "B0TEST0002" }),
      ],
    ]);

    const result = await loadAllProductConfigs(options);

    expect(result.size).toBe(2);
    expect(result.has("B0TEST0001")).toBe(true);
    expect(result.has("B0TEST0002")).toBe(true);
  });

  it("空の場合は空のMapを返す", async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const result = await loadAllProductConfigs(options);

    expect(result.size).toBe(0);
  });

  it("ProductConfigが正しく組み立てられる", async () => {
    mockQuery.mockResolvedValueOnce([
      [createMockProductRow()],
    ]);

    const result = await loadAllProductConfigs(options);
    const config = result.get("B0TEST1234");

    expect(config).toBeDefined();
    expect(config!.asin).toBe("B0TEST1234");
    expect(config!.productId).toBe("PROD001");
    expect(config!.sku).toBe("SKU001");
    expect(config!.isActive).toBe(true);
    expect(config!.revenueModel).toBe("LTV");
    expect(config!.lifecycleState).toBe("GROW");
    expect(config!.businessMode).toBe("PROFIT");
    expect(config!.category).toBe("SUPPLEMENT");
    expect(config!.brandType).toBe("GENERIC");
    expect(config!.experimentGroup).toBe("CONTROL");
    expect(config!.marginRate).toBe(0.4);
    expect(config!.expectedRepeatOrdersAssumed).toBe(2.0);
    expect(config!.expectedRepeatOrdersMeasured).toBe(1.8);
    expect(config!.safetyFactorAssumed).toBe(0.7);
    expect(config!.safetyFactorMeasured).toBe(0.85);
    expect(config!.newCustomersTotal).toBe(500);
  });

  it("非アクティブ商品も含める場合", async () => {
    mockQuery.mockResolvedValueOnce([
      [
        createMockProductRow({ asin: "B0ACTIVE01", is_active: true }),
        createMockProductRow({ asin: "B0INACTIVE", is_active: false }),
      ],
    ]);

    const result = await loadAllProductConfigs(options, true);

    expect(result.size).toBe(2);
  });
});

// =============================================================================
// パース関数テスト（buildProductConfigFromRow経由）
// =============================================================================

describe("パース関数", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const options = {
    projectId: "test-project",
    dataset: "test_dataset",
  };

  describe("parseRevenueModel", () => {
    it("SINGLE_PURCHASEをパースできる", async () => {
      mockQuery.mockResolvedValueOnce([
        [createMockProductRow({ revenue_model: "SINGLE_PURCHASE" })],
      ]);

      const result = await loadAllProductConfigs(options);
      const config = result.get("B0TEST1234");

      expect(config!.revenueModel).toBe("SINGLE_PURCHASE");
    });

    it("不明な値はLTVにフォールバック", async () => {
      mockQuery.mockResolvedValueOnce([
        [createMockProductRow({ revenue_model: "UNKNOWN" })],
      ]);

      const result = await loadAllProductConfigs(options);
      const config = result.get("B0TEST1234");

      expect(config!.revenueModel).toBe("LTV");
    });
  });

  describe("parseLifecycleState", () => {
    it("各ライフサイクルステートをパースできる", async () => {
      const states = ["LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"];

      for (const state of states) {
        mockQuery.mockResolvedValueOnce([
          [createMockProductRow({ lifecycle_state: state })],
        ]);

        const result = await loadAllProductConfigs(options);
        const config = result.get("B0TEST1234");

        expect(config!.lifecycleState).toBe(state);
      }
    });

    it("不明な値はGROWにフォールバック", async () => {
      mockQuery.mockResolvedValueOnce([
        [createMockProductRow({ lifecycle_state: "UNKNOWN" })],
      ]);

      const result = await loadAllProductConfigs(options);
      const config = result.get("B0TEST1234");

      expect(config!.lifecycleState).toBe("GROW");
    });
  });

  describe("parseBusinessMode", () => {
    it("SHAREをパースできる", async () => {
      mockQuery.mockResolvedValueOnce([
        [createMockProductRow({ business_mode: "SHARE" })],
      ]);

      const result = await loadAllProductConfigs(options);
      const config = result.get("B0TEST1234");

      expect(config!.businessMode).toBe("SHARE");
    });

    it("不明な値はPROFITにフォールバック", async () => {
      mockQuery.mockResolvedValueOnce([
        [createMockProductRow({ business_mode: "UNKNOWN" })],
      ]);

      const result = await loadAllProductConfigs(options);
      const config = result.get("B0TEST1234");

      expect(config!.businessMode).toBe("PROFIT");
    });
  });

  describe("parseBrandType", () => {
    it("各ブランドタイプをパースできる", async () => {
      const types = ["BRAND", "GENERIC", "CONQUEST"];

      for (const type of types) {
        mockQuery.mockResolvedValueOnce([
          [createMockProductRow({ brand_type: type })],
        ]);

        const result = await loadAllProductConfigs(options);
        const config = result.get("B0TEST1234");

        expect(config!.brandType).toBe(type);
      }
    });

    it("不明な値はGENERICにフォールバック", async () => {
      mockQuery.mockResolvedValueOnce([
        [createMockProductRow({ brand_type: "UNKNOWN" })],
      ]);

      const result = await loadAllProductConfigs(options);
      const config = result.get("B0TEST1234");

      expect(config!.brandType).toBe("GENERIC");
    });
  });

  describe("parseExperimentGroup", () => {
    it("各実験グループをパースできる", async () => {
      const groups = ["CONTROL", "VARIANT_A", "VARIANT_B"];

      for (const group of groups) {
        mockQuery.mockResolvedValueOnce([
          [createMockProductRow({ experiment_group: group })],
        ]);

        const result = await loadAllProductConfigs(options);
        const config = result.get("B0TEST1234");

        expect(config!.experimentGroup).toBe(group);
      }
    });

    it("不明な値はCONTROLにフォールバック", async () => {
      mockQuery.mockResolvedValueOnce([
        [createMockProductRow({ experiment_group: "UNKNOWN" })],
      ]);

      const result = await loadAllProductConfigs(options);
      const config = result.get("B0TEST1234");

      expect(config!.experimentGroup).toBe("CONTROL");
    });
  });
});

// =============================================================================
// loadProductConfigByAsin テスト
// =============================================================================

describe("loadProductConfigByAsin", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const options = {
    projectId: "test-project",
    dataset: "test_dataset",
  };

  it("存在するASINの商品設定を取得できる", async () => {
    mockQuery.mockResolvedValueOnce([
      [createMockProductRow({ asin: "B0SPECIFIC" })],
    ]);

    const result = await loadProductConfigByAsin(options, "B0SPECIFIC");

    expect(result).not.toBeNull();
    expect(result!.asin).toBe("B0SPECIFIC");
  });

  it("存在しないASINの場合はnullを返す", async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const result = await loadProductConfigByAsin(options, "B0NOTEXIST");

    expect(result).toBeNull();
  });
});

// =============================================================================
// loadProductConfigsByAsins テスト
// =============================================================================

describe("loadProductConfigsByAsins", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const options = {
    projectId: "test-project",
    dataset: "test_dataset",
  };

  it("複数のASINの商品設定を取得できる", async () => {
    mockQuery.mockResolvedValueOnce([
      [
        createMockProductRow({ asin: "B0TEST0001" }),
        createMockProductRow({ asin: "B0TEST0002" }),
      ],
    ]);

    const result = await loadProductConfigsByAsins(
      options,
      ["B0TEST0001", "B0TEST0002", "B0NOTEXIST"]
    );

    expect(result.size).toBe(2);
    expect(result.has("B0TEST0001")).toBe(true);
    expect(result.has("B0TEST0002")).toBe(true);
    expect(result.has("B0NOTEXIST")).toBe(false);
  });

  it("空のASINリストの場合は空のMapを返す", async () => {
    const result = await loadProductConfigsByAsins(options, []);

    expect(result.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// =============================================================================
// getActiveAsins テスト
// =============================================================================

describe("getActiveAsins", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const options = {
    projectId: "test-project",
    dataset: "test_dataset",
  };

  it("アクティブなASINリストを取得できる", async () => {
    mockQuery.mockResolvedValueOnce([
      [
        { asin: "B0ACTIVE01" },
        { asin: "B0ACTIVE02" },
        { asin: "B0ACTIVE03" },
      ],
    ]);

    const result = await getActiveAsins(options);

    expect(result).toEqual(["B0ACTIVE01", "B0ACTIVE02", "B0ACTIVE03"]);
  });

  it("アクティブな商品がない場合は空配列を返す", async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const result = await getActiveAsins(options);

    expect(result).toEqual([]);
  });
});

// =============================================================================
// デフォルト値テスト
// =============================================================================

describe("デフォルト値", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const options = {
    projectId: "test-project",
    dataset: "test_dataset",
  };

  it("null値に対してデフォルト値が設定される", async () => {
    mockQuery.mockResolvedValueOnce([
      [
        {
          asin: "B0NULLTEST",
          product_id: null,
          sku: null,
          is_active: true,
          revenue_model: null,
          lifecycle_state: null,
          business_mode: null,
          category: null,
          brand_type: null,
          experiment_group: null,
          margin_rate: null,
          expected_repeat_orders_assumed: null,
          expected_repeat_orders_measured_180d: null,
          safety_factor_assumed: null,
          safety_factor_measured: null,
          launch_date: null,
          new_customers_total: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    ]);

    const result = await loadAllProductConfigs(options);
    const config = result.get("B0NULLTEST");

    expect(config).toBeDefined();
    expect(config!.productId).toBe("B0NULLTEST"); // ASINがフォールバック
    expect(config!.sku).toBeUndefined();
    expect(config!.revenueModel).toBe("LTV");
    expect(config!.lifecycleState).toBe("GROW");
    expect(config!.businessMode).toBe("PROFIT");
    expect(config!.brandType).toBe("GENERIC");
    expect(config!.experimentGroup).toBe("CONTROL");
    expect(config!.marginRate).toBe(0.3);
    expect(config!.expectedRepeatOrdersAssumed).toBe(1.0);
    expect(config!.expectedRepeatOrdersMeasured).toBeNull();
    expect(config!.safetyFactorAssumed).toBe(0.7);
    expect(config!.safetyFactorMeasured).toBe(0.85);
    expect(config!.launchDate).toBeNull();
    expect(config!.newCustomersTotal).toBe(0);
  });
});

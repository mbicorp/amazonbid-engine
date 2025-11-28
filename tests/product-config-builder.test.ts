/**
 * ProductConfig組み立て処理のテスト
 */

import {
  parseRevenueModel,
  parseLifecycleState,
  buildProductConfig,
} from "../src/ltv/product-config-builder";

// =============================================================================
// parseRevenueModel テスト
// =============================================================================

describe("parseRevenueModel", () => {
  it("SINGLE_PURCHASEを正しくパース", () => {
    expect(parseRevenueModel("SINGLE_PURCHASE")).toBe("SINGLE_PURCHASE");
  });

  it("LTVを正しくパース", () => {
    expect(parseRevenueModel("LTV")).toBe("LTV");
  });

  it("nullはLTVにフォールバック", () => {
    expect(parseRevenueModel(null)).toBe("LTV");
  });

  it("undefinedはLTVにフォールバック", () => {
    expect(parseRevenueModel(undefined)).toBe("LTV");
  });

  it("空文字はLTVにフォールバック", () => {
    expect(parseRevenueModel("")).toBe("LTV");
  });

  it("不明な値はLTVにフォールバック", () => {
    expect(parseRevenueModel("UNKNOWN")).toBe("LTV");
    expect(parseRevenueModel("single_purchase")).toBe("LTV"); // 小文字は不一致
  });
});

// =============================================================================
// parseLifecycleState テスト
// =============================================================================

describe("parseLifecycleState", () => {
  it("LAUNCH_HARDを正しくパース", () => {
    expect(parseLifecycleState("LAUNCH_HARD")).toBe("LAUNCH_HARD");
  });

  it("LAUNCH_SOFTを正しくパース", () => {
    expect(parseLifecycleState("LAUNCH_SOFT")).toBe("LAUNCH_SOFT");
  });

  it("GROWを正しくパース", () => {
    expect(parseLifecycleState("GROW")).toBe("GROW");
  });

  it("HARVESTを正しくパース", () => {
    expect(parseLifecycleState("HARVEST")).toBe("HARVEST");
  });

  it("nullはGROWにフォールバック", () => {
    expect(parseLifecycleState(null)).toBe("GROW");
  });

  it("undefinedはGROWにフォールバック", () => {
    expect(parseLifecycleState(undefined)).toBe("GROW");
  });

  it("不明な値はGROWにフォールバック", () => {
    expect(parseLifecycleState("UNKNOWN")).toBe("GROW");
    expect(parseLifecycleState("launch_hard")).toBe("GROW"); // 小文字は不一致
  });
});

// =============================================================================
// buildProductConfig テスト
// =============================================================================

describe("buildProductConfig", () => {
  const createRow = (overrides: Record<string, unknown> = {}) => ({
    asin: "B0XXXXXXXX",
    product_id: "prod-001",
    margin_rate: 0.4,
    expected_repeat_orders_assumed: 2.0,
    expected_repeat_orders_measured_180d: null,
    safety_factor_assumed: 0.7,
    safety_factor_measured: 0.85,
    launch_date: null,
    new_customers_total: 100,
    revenue_model: "LTV",
    last_ltv_updated_at: null,
    lifecycle_stage: "GROW",
    ...overrides,
  });

  it("基本的なLTV商品を正しく組み立て", () => {
    const row = createRow();
    const result = buildProductConfig(row);

    expect(result.productId).toBe("prod-001");
    expect(result.asin).toBe("B0XXXXXXXX");
    expect(result.revenueModel).toBe("LTV");
    expect(result.ltvMode).toBe("ASSUMED"); // launch_dateがnullなので
    expect(result.marginRate).toBe(0.4);
    expect(result.expectedRepeatOrdersAssumed).toBe(2.0);
    expect(result.expectedRepeatOrdersMeasured).toBeNull();
    expect(result.safetyFactorAssumed).toBe(0.7);
    expect(result.safetyFactorMeasured).toBe(0.85);
    expect(result.lifecycleState).toBe("GROW");
  });

  it("SINGLE_PURCHASE商品を正しく組み立て", () => {
    const row = createRow({
      revenue_model: "SINGLE_PURCHASE",
    });
    const result = buildProductConfig(row);

    expect(result.revenueModel).toBe("SINGLE_PURCHASE");
    // SINGLE_PURCHASEでもltvModeは計算される（ログ用）
    expect(result.ltvMode).toBeDefined();
  });

  it("launch_dateがある場合、daysSinceLaunchを計算", () => {
    const referenceDate = new Date("2024-06-01");
    const row = createRow({
      launch_date: new Date("2024-01-01"),
      new_customers_total: 300,
    });
    const result = buildProductConfig(row, referenceDate);

    // 152日経過、300人の新規顧客 → MEASURED
    expect(result.daysSinceLaunch).toBe(152);
    expect(result.ltvMode).toBe("MEASURED");
  });

  it("EARLY_ESTIMATE条件を満たす場合", () => {
    const referenceDate = new Date("2024-03-15");
    const row = createRow({
      launch_date: new Date("2024-01-01"),
      new_customers_total: 80,
    });
    const result = buildProductConfig(row, referenceDate);

    // 74日経過、80人の新規顧客 → EARLY_ESTIMATE
    expect(result.daysSinceLaunch).toBe(74);
    expect(result.ltvMode).toBe("EARLY_ESTIMATE");
  });

  it("expectedRepeatOrdersMeasured_180dがある場合", () => {
    const row = createRow({
      expected_repeat_orders_measured_180d: 3.5,
    });
    const result = buildProductConfig(row);

    expect(result.expectedRepeatOrdersMeasured).toBe(3.5);
  });

  it("lifecycle_stageがnullの場合、GROWにフォールバック", () => {
    const row = createRow({
      lifecycle_stage: null,
    });
    const result = buildProductConfig(row);

    expect(result.lifecycleState).toBe("GROW");
  });

  it("revenue_modelがnullの場合、LTVにフォールバック", () => {
    const row = createRow({
      revenue_model: null,
    });
    const result = buildProductConfig(row);

    expect(result.revenueModel).toBe("LTV");
  });
});

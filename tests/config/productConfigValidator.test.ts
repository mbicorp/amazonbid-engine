/**
 * ProductConfig バリデーターのテスト
 */

import {
  validateProductConfig,
  validateAllProductConfigs,
  formatValidationResult,
  formatBulkValidationResult,
} from "../../src/config/productConfigValidator";
import { ProductConfig, PRODUCT_CONFIG_DEFAULTS } from "../../src/config/productConfigTypes";

describe("productConfigValidator", () => {
  // ==========================================================================
  // テスト用のヘルパー
  // ==========================================================================

  /**
   * 正常なProductConfigを生成
   */
  function createValidConfig(overrides: Partial<ProductConfig> = {}): ProductConfig {
    return {
      // profileId はオプション（BigQueryから読み込む場合はundefined）
      asin: "B0XXXXXXXXX",
      productId: "product-001",
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
      launchDate: new Date("2024-01-01"),
      daysSinceLaunch: 100,
      newCustomersTotal: 50,
      ...overrides,
    };
  }

  // ==========================================================================
  // 正常ケース
  // ==========================================================================

  describe("正常ケース", () => {
    it("有効な設定でバリデーションが通る", () => {
      const config = createValidConfig();
      const result = validateProductConfig(config);

      expect(result.ok).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("全てのライフサイクルステートが有効", () => {
      const states = ["LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"] as const;

      for (const state of states) {
        const config = createValidConfig({ lifecycleState: state });
        const result = validateProductConfig(config);
        expect(result.ok).toBe(true);
      }
    });

    it("オプションフィールドが未設定でも有効", () => {
      const config = createValidConfig({
        sku: undefined,
        category: undefined,
        riskLevel: undefined,
        maxBidMultiplier: undefined,
        minBidMultiplier: undefined,
        targetAcos: undefined,
      });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(true);
    });
  });

  // ==========================================================================
  // エラーケース
  // ==========================================================================

  describe("エラーケース", () => {
    it("profileIdが空文字列の場合はエラー", () => {
      const config = createValidConfig({ profileId: "" });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "profileId",
          severity: "error",
        })
      );
    });

    it("profileIdがundefinedの場合は許可（オプショナル）", () => {
      const config = createValidConfig({ profileId: undefined });
      const result = validateProductConfig(config);

      // profileIdがundefinedでもエラーにならない
      const profileIdIssue = result.issues.find((i) => i.field === "profileId");
      expect(profileIdIssue).toBeUndefined();
    });

    it("asinが空の場合はエラー", () => {
      const config = createValidConfig({ asin: "" });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "asin",
          severity: "error",
        })
      );
    });

    it("無効なlifecycleStateはエラー", () => {
      const config = createValidConfig({ lifecycleState: "INVALID" as any });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "lifecycleState",
          severity: "error",
        })
      );
    });

    it("targetAcosが1以上はエラー", () => {
      const config = createValidConfig({ targetAcos: 1.5 });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "targetAcos",
          severity: "error",
        })
      );
    });

    it("targetAcosが0以下はエラー", () => {
      const config = createValidConfig({ targetAcos: 0 });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "targetAcos",
          severity: "error",
        })
      );
    });

    it("marginRateが範囲外はエラー", () => {
      const config = createValidConfig({ marginRate: 1.5 });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "marginRate",
          severity: "error",
        })
      );
    });

    it("expectedRepeatOrdersAssumedが1未満はエラー", () => {
      const config = createValidConfig({ expectedRepeatOrdersAssumed: 0.5 });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "expectedRepeatOrdersAssumed",
          severity: "error",
        })
      );
    });

    it("safetyFactorAssumedが範囲外はエラー", () => {
      const config = createValidConfig({ safetyFactorAssumed: 0 });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "safetyFactorAssumed",
          severity: "error",
        })
      );
    });

    it("maxBidMultiplierがminBidMultiplierより小さいはエラー", () => {
      const config = createValidConfig({
        maxBidMultiplier: 1.0,
        minBidMultiplier: 1.5,
      });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "maxBidMultiplier",
          severity: "error",
        })
      );
    });
  });

  // ==========================================================================
  // 警告ケース
  // ==========================================================================

  describe("警告ケース", () => {
    it("targetAcosが80%超は警告（エラーではない）", () => {
      const config = createValidConfig({ targetAcos: 0.85 });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(true);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "targetAcos",
          severity: "warning",
        })
      );
    });

    it("marginRateが5%未満は警告", () => {
      const config = createValidConfig({ marginRate: 0.03 });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(true);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "marginRate",
          severity: "warning",
        })
      );
    });

    it("maxBidMultiplierが5超は警告", () => {
      const config = createValidConfig({ maxBidMultiplier: 7 });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(true);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "maxBidMultiplier",
          severity: "warning",
        })
      );
    });

    it("HARVESTでAGGRESSIVEリスクレベルは警告", () => {
      const config = createValidConfig({
        lifecycleState: "HARVEST",
        riskLevel: "AGGRESSIVE",
      });
      const result = validateProductConfig(config);

      expect(result.ok).toBe(true);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          field: "riskLevel",
          severity: "warning",
        })
      );
    });
  });

  // ==========================================================================
  // 一括バリデーション
  // ==========================================================================

  describe("validateAllProductConfigs", () => {
    it("全ての設定が有効な場合", () => {
      const configs = [
        createValidConfig({ asin: "B0000000001" }),
        createValidConfig({ asin: "B0000000002" }),
        createValidConfig({ asin: "B0000000003" }),
      ];

      const result = validateAllProductConfigs(configs);

      expect(result.hasError).toBe(false);
      expect(result.hasWarning).toBe(false);
      expect(result.totalIssueCount).toBe(0);
    });

    it("一部にエラーがある場合", () => {
      const configs = [
        createValidConfig({ asin: "B0000000001" }),
        createValidConfig({ asin: "" }), // エラー（asinが空）
        createValidConfig({ asin: "B0000000003" }),
      ];

      const result = validateAllProductConfigs(configs);

      expect(result.hasError).toBe(true);
      expect(result.errorCount).toBeGreaterThan(0);
    });

    it("警告のみの場合", () => {
      const configs = [
        createValidConfig({ asin: "B0000000001", targetAcos: 0.85 }), // 警告
        createValidConfig({ asin: "B0000000002" }),
      ];

      const result = validateAllProductConfigs(configs);

      expect(result.hasError).toBe(false);
      expect(result.hasWarning).toBe(true);
      expect(result.warningCount).toBeGreaterThan(0);
    });

    it("issuesByAsinにASINごとの問題が記録される", () => {
      const configs = [
        createValidConfig({ asin: "B0000000001", marginRate: -0.1 }), // エラー（marginRateが負）
        createValidConfig({ asin: "B0000000002" }),
      ];

      const result = validateAllProductConfigs(configs);

      expect(result.issuesByAsin["B0000000001"]).toBeDefined();
      expect(result.issuesByAsin["B0000000002"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // フォーマッター
  // ==========================================================================

  describe("formatValidationResult", () => {
    it("問題がない場合は成功メッセージ", () => {
      const config = createValidConfig();
      const result = validateProductConfig(config);
      const formatted = formatValidationResult(result);

      expect(formatted).toContain("passed");
    });

    it("エラーがある場合は[ERROR]が含まれる", () => {
      const config = createValidConfig({ asin: "" });
      const result = validateProductConfig(config);
      const formatted = formatValidationResult(result);

      expect(formatted).toContain("[ERROR]");
    });

    it("警告がある場合は[WARNING]が含まれる", () => {
      const config = createValidConfig({ targetAcos: 0.85 });
      const result = validateProductConfig(config);
      const formatted = formatValidationResult(result);

      expect(formatted).toContain("[WARNING]");
    });
  });

  describe("formatBulkValidationResult", () => {
    it("全て有効な場合は成功メッセージ", () => {
      const configs = [createValidConfig()];
      const result = validateAllProductConfigs(configs);
      const formatted = formatBulkValidationResult(result);

      expect(formatted).toContain("passed");
    });

    it("エラーがある場合はASINが含まれる", () => {
      const configs = [createValidConfig({ asin: "B0TESTBAD01", profileId: "" })];
      const result = validateAllProductConfigs(configs);
      const formatted = formatBulkValidationResult(result);

      expect(formatted).toContain("B0TESTBAD01");
    });
  });
});

/**
 * 在庫ガードロジックのテスト
 *
 * テストシナリオ:
 * 1. 在庫ゼロ → ハードキルで入札ゼロ（SET_ZERO）またはスキップ（SKIP_RECOMMENDATION）
 * 2. 在庫薄（LOW_STOCK） → ソフトスロットルでアップ抑制
 * 3. 在庫十分（NORMAL） → ガードなし
 */

import {
  AsinInventorySnapshot,
  InventoryRiskStatus,
  INVENTORY_GUARD_DEFAULTS,
} from "../src/inventory/types";
import {
  calculateInventoryRiskStatus,
} from "../src/inventory/inventoryRepository";
import {
  applyHardKill,
  calculateSoftThrottleParams,
  applyInventoryGuard,
  extractInventoryGuardConfig,
  InventoryGuardConfig,
  DEFAULT_INVENTORY_GUARD_CONFIG,
} from "../src/inventory/inventoryGuard";

describe("Inventory Guard", () => {
  // ==========================================================================
  // calculateInventoryRiskStatus
  // ==========================================================================
  describe("calculateInventoryRiskStatus", () => {
    const minDaysForGrowth = 10;
    const minDaysForNormal = 20;

    it("在庫ゼロ（daysOfInventory = 0）はOUT_OF_STOCK", () => {
      const status = calculateInventoryRiskStatus(0, minDaysForGrowth, minDaysForNormal);
      expect(status).toBe("OUT_OF_STOCK");
    });

    it("在庫null はUNKNOWN", () => {
      const status = calculateInventoryRiskStatus(null, minDaysForGrowth, minDaysForNormal);
      expect(status).toBe("UNKNOWN");
    });

    it("在庫 5日（< minDaysForGrowth）はLOW_STOCK_STRICT", () => {
      const status = calculateInventoryRiskStatus(5, minDaysForGrowth, minDaysForNormal);
      expect(status).toBe("LOW_STOCK_STRICT");
    });

    it("在庫 15日（>= minDaysForGrowth, < minDaysForNormal）はLOW_STOCK", () => {
      const status = calculateInventoryRiskStatus(15, minDaysForGrowth, minDaysForNormal);
      expect(status).toBe("LOW_STOCK");
    });

    it("在庫 30日（>= minDaysForNormal）はNORMAL", () => {
      const status = calculateInventoryRiskStatus(30, minDaysForGrowth, minDaysForNormal);
      expect(status).toBe("NORMAL");
    });

    it("境界値: 10日（= minDaysForGrowth）はLOW_STOCK", () => {
      const status = calculateInventoryRiskStatus(10, minDaysForGrowth, minDaysForNormal);
      expect(status).toBe("LOW_STOCK");
    });

    it("境界値: 20日（= minDaysForNormal）はNORMAL", () => {
      const status = calculateInventoryRiskStatus(20, minDaysForGrowth, minDaysForNormal);
      expect(status).toBe("NORMAL");
    });
  });

  // ==========================================================================
  // applyHardKill
  // ==========================================================================
  describe("applyHardKill", () => {
    const baseConfig: InventoryGuardConfig = {
      ...DEFAULT_INVENTORY_GUARD_CONFIG,
      inventoryGuardMode: "NORMAL",
      outOfStockBidPolicy: "SET_ZERO",
    };

    it("在庫ゼロ + SET_ZEROポリシー → 入札ゼロ", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 0,
        status: "OUT_OF_STOCK",
      };

      const result = applyHardKill(inventory, 100, baseConfig);

      expect(result.wasApplied).toBe(true);
      expect(result.adjustedBid).toBe(0);
      expect(result.guardType).toBe("HARD_KILL");
      expect(result.shouldSkipRecommendation).toBe(false);
      expect(result.reason).toContain("在庫ゼロ");
    });

    it("在庫ゼロ + SKIP_RECOMMENDATIONポリシー → スキップフラグtrue", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 0,
        status: "OUT_OF_STOCK",
      };

      const config: InventoryGuardConfig = {
        ...baseConfig,
        outOfStockBidPolicy: "SKIP_RECOMMENDATION",
      };

      const result = applyHardKill(inventory, 100, config);

      expect(result.wasApplied).toBe(true);
      expect(result.adjustedBid).toBe(0);
      expect(result.guardType).toBe("HARD_KILL");
      expect(result.shouldSkipRecommendation).toBe(true);
    });

    it("在庫あり → ハードキル不適用", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 15,
        status: "LOW_STOCK",
      };

      const result = applyHardKill(inventory, 100, baseConfig);

      expect(result.wasApplied).toBe(false);
      expect(result.adjustedBid).toBe(100);
      expect(result.guardType).toBe("NONE");
    });

    it("inventoryGuardMode = OFF → ハードキル不適用", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 0,
        status: "OUT_OF_STOCK",
      };

      const config: InventoryGuardConfig = {
        ...baseConfig,
        inventoryGuardMode: "OFF",
      };

      const result = applyHardKill(inventory, 100, config);

      expect(result.wasApplied).toBe(false);
      expect(result.adjustedBid).toBe(100);
      expect(result.reason).toBeNull(); // OFFモードではreasonはnull
    });

    it("inventory = null → ハードキル不適用（UNKNOWN扱い）", () => {
      const result = applyHardKill(null, 100, baseConfig);

      expect(result.wasApplied).toBe(false);
      expect(result.adjustedBid).toBe(100);
      expect(result.inventoryStatus).toBe("UNKNOWN");
    });
  });

  // ==========================================================================
  // calculateSoftThrottleParams
  // ==========================================================================
  describe("calculateSoftThrottleParams", () => {
    const baseConfig: InventoryGuardConfig = {
      ...DEFAULT_INVENTORY_GUARD_CONFIG,
      inventoryGuardMode: "NORMAL",
    };

    it("LOW_STOCK → max_up_ratio を抑制（1.15）", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 15,
        status: "LOW_STOCK",
      };

      const result = calculateSoftThrottleParams(
        inventory,
        baseConfig,
        1.5, // originalMaxUpRatio
        0.3  // originalTargetAcos
      );

      expect(result.wasAdjusted).toBe(true);
      expect(result.adjustedMaxUpRatio).toBe(INVENTORY_GUARD_DEFAULTS.LOW_STOCK_MAX_UP_RATIO);
      expect(result.adjustedTargetAcos).toBe(0.3); // targetAcosは変更なし
    });

    it("LOW_STOCK_STRICT → max_up_ratio を強く抑制（1.05）+ targetAcos を10%下げ", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 5,
        status: "LOW_STOCK_STRICT",
      };

      const result = calculateSoftThrottleParams(
        inventory,
        baseConfig,
        1.5, // originalMaxUpRatio
        0.3  // originalTargetAcos
      );

      expect(result.wasAdjusted).toBe(true);
      expect(result.adjustedMaxUpRatio).toBe(INVENTORY_GUARD_DEFAULTS.LOW_STOCK_STRICT_MAX_UP_RATIO);
      expect(result.adjustedTargetAcos).toBeCloseTo(0.3 * 0.9, 4); // 10%下げ
    });

    it("NORMAL → ソフトスロットル不適用", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 30,
        status: "NORMAL",
      };

      const result = calculateSoftThrottleParams(
        inventory,
        baseConfig,
        1.5,
        0.3
      );

      expect(result.wasAdjusted).toBe(false);
      expect(result.adjustedMaxUpRatio).toBe(1.5);
      expect(result.adjustedTargetAcos).toBe(0.3);
    });

    it("inventoryGuardMode = OFF → ソフトスロットル不適用", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 5,
        status: "LOW_STOCK_STRICT",
      };

      const config: InventoryGuardConfig = {
        ...baseConfig,
        inventoryGuardMode: "OFF",
      };

      const result = calculateSoftThrottleParams(
        inventory,
        config,
        1.5,
        0.3
      );

      expect(result.wasAdjusted).toBe(false);
      expect(result.adjustedMaxUpRatio).toBe(1.5);
      expect(result.adjustedTargetAcos).toBe(0.3);
    });

    it("inventoryGuardMode = STRICT → LOW_STOCK_STRICTでより厳しいACOS調整", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 5,
        status: "LOW_STOCK_STRICT",
      };

      const config: InventoryGuardConfig = {
        ...baseConfig,
        inventoryGuardMode: "STRICT",
      };

      const result = calculateSoftThrottleParams(
        inventory,
        config,
        1.5,
        0.3
      );

      expect(result.wasAdjusted).toBe(true);
      // STRICTモードではLOW_STOCK_STRICTでtargetAcosがさらに厳しくなる（0.9 * 0.9 = 0.81倍）
      expect(result.adjustedMaxUpRatio).toBe(INVENTORY_GUARD_DEFAULTS.LOW_STOCK_STRICT_MAX_UP_RATIO);
      expect(result.adjustedTargetAcos).toBeCloseTo(0.3 * 0.9 * 0.9, 4);
    });
  });

  // ==========================================================================
  // applyInventoryGuard (統合)
  // ==========================================================================
  describe("applyInventoryGuard", () => {
    const baseConfig: InventoryGuardConfig = {
      ...DEFAULT_INVENTORY_GUARD_CONFIG,
      inventoryGuardMode: "NORMAL",
      outOfStockBidPolicy: "SET_ZERO",
    };

    it("シナリオ1: 在庫ゼロ → ハードキルで入札ゼロ", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 0,
        status: "OUT_OF_STOCK",
      };

      const result = applyInventoryGuard(
        inventory,
        120, // recommendedBid（+20%アップ）
        100, // currentBid
        baseConfig,
        1.5, // originalMaxUpRatio
        0.3  // originalTargetAcos
      );

      expect(result.wasApplied).toBe(true);
      expect(result.guardType).toBe("HARD_KILL");
      expect(result.adjustedBid).toBe(0);
      expect(result.inventoryStatus).toBe("OUT_OF_STOCK");
    });

    it("シナリオ2: 在庫薄（LOW_STOCK）→ ソフトスロットルでアップ抑制", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 15,
        status: "LOW_STOCK",
      };

      const result = applyInventoryGuard(
        inventory,
        150, // recommendedBid（+50%アップ）
        100, // currentBid
        baseConfig,
        1.5, // originalMaxUpRatio
        0.3  // originalTargetAcos
      );

      expect(result.wasApplied).toBe(true);
      expect(result.guardType).toBe("SOFT_THROTTLE");
      // max_up_ratio = 1.15 なので、最大でも 100 * 1.15 = 115
      expect(result.adjustedBid).toBeCloseTo(115, 0);
      expect(result.adjustedMaxUpRatio).toBe(1.15);
    });

    it("シナリオ2b: 在庫薄（LOW_STOCK_STRICT）→ より強いソフトスロットル", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 5,
        status: "LOW_STOCK_STRICT",
      };

      const result = applyInventoryGuard(
        inventory,
        150, // recommendedBid（+50%アップ）
        100, // currentBid
        baseConfig,
        1.5, // originalMaxUpRatio
        0.3  // originalTargetAcos
      );

      expect(result.wasApplied).toBe(true);
      expect(result.guardType).toBe("SOFT_THROTTLE");
      // max_up_ratio = 1.05 なので、最大でも 100 * 1.05 = 105
      expect(result.adjustedBid).toBe(105);
      expect(result.adjustedMaxUpRatio).toBe(1.05);
      // targetAcosも10%下げ
      expect(result.adjustedTargetAcos).toBeCloseTo(0.27, 4);
    });

    it("シナリオ3: 在庫十分（NORMAL）→ ガードなし", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 30,
        status: "NORMAL",
      };

      const result = applyInventoryGuard(
        inventory,
        150, // recommendedBid（+50%アップ）
        100, // currentBid
        baseConfig,
        1.5, // originalMaxUpRatio
        0.3  // originalTargetAcos
      );

      expect(result.wasApplied).toBe(false);
      expect(result.guardType).toBe("NONE");
      expect(result.adjustedBid).toBe(150); // そのまま
      // NORMALではソフトスロットルが適用されないため、adjustedMaxUpRatio/adjustedTargetAcosはnull
      expect(result.adjustedMaxUpRatio).toBeNull();
      expect(result.adjustedTargetAcos).toBeNull();
    });

    it("入札ダウン時はソフトスロットル不適用（上昇抑制のみ）", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 15,
        status: "LOW_STOCK",
      };

      const result = applyInventoryGuard(
        inventory,
        80, // recommendedBid（-20%ダウン）
        100, // currentBid
        baseConfig,
        1.5,
        0.3
      );

      // ダウン方向なのでソフトスロットルは適用されない
      expect(result.adjustedBid).toBe(80);
    });

    it("元々の上昇幅がmax_up_ratio以下の場合はクリップされない", () => {
      const inventory: AsinInventorySnapshot = {
        profileId: "test-profile",
        asin: "TEST-ASIN",
        daysOfInventory: 15,
        status: "LOW_STOCK",
      };

      const result = applyInventoryGuard(
        inventory,
        110, // recommendedBid（+10%アップ、1.15以下）
        100, // currentBid
        baseConfig,
        1.5,
        0.3
      );

      // 110は 100 * 1.15 = 115 以下なのでクリップされない
      expect(result.adjustedBid).toBe(110);
      // 実際に入札額が変更されなかったので wasApplied = false, guardType = "NONE"
      expect(result.wasApplied).toBe(false);
      expect(result.guardType).toBe("NONE");
    });
  });

  // ==========================================================================
  // extractInventoryGuardConfig
  // ==========================================================================
  describe("extractInventoryGuardConfig", () => {
    it("デフォルト値が正しく適用される", () => {
      const productConfig = {
        asin: "TEST-ASIN",
        // 在庫関連フィールドは未設定
      };

      const config = extractInventoryGuardConfig(productConfig as any);

      expect(config.inventoryGuardMode).toBe("NORMAL");
      expect(config.minDaysOfInventoryForGrowth).toBe(10);
      expect(config.minDaysOfInventoryForNormal).toBe(20);
      expect(config.outOfStockBidPolicy).toBe("SET_ZERO");
    });

    it("ProductConfigの値が正しく抽出される", () => {
      const productConfig = {
        asin: "TEST-ASIN",
        inventoryGuardMode: "STRICT" as const,
        minDaysOfInventoryForGrowth: 15,
        minDaysOfInventoryForNormal: 30,
        outOfStockBidPolicy: "SKIP_RECOMMENDATION" as const,
      };

      const config = extractInventoryGuardConfig(productConfig as any);

      expect(config.inventoryGuardMode).toBe("STRICT");
      expect(config.minDaysOfInventoryForGrowth).toBe(15);
      expect(config.minDaysOfInventoryForNormal).toBe(30);
      expect(config.outOfStockBidPolicy).toBe("SKIP_RECOMMENDATION");
    });

    it("inventoryGuardMode = OFF の場合もそのまま抽出", () => {
      const productConfig = {
        asin: "TEST-ASIN",
        inventoryGuardMode: "OFF" as const,
      };

      const config = extractInventoryGuardConfig(productConfig as any);

      expect(config.inventoryGuardMode).toBe("OFF");
    });
  });
});

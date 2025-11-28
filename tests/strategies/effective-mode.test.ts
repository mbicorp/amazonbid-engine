/**
 * effectiveMode決定ロジック テスト
 */

import {
  determineEffectiveMode,
  EffectiveModeInput,
  DEFAULT_S_MODE_SCALE_CONFIG,
  scaleSmodeParameter,
  scaleBidUpMultiplier,
  scaleBidDownMultiplier,
  scaleAcosMultiplier,
  calculateEffectiveEventBidParams,
  getBigSaleStrategy,
  isValidOperationMode,
} from "../../src/strategies/effective-mode";
import { isValidBigSaleStrategy, DEFAULT_BIG_SALE_STRATEGY } from "../../src/config/productConfigTypes";

describe("effectiveMode決定ロジック", () => {
  describe("isValidOperationMode", () => {
    it("有効なOperationModeを判定できる", () => {
      expect(isValidOperationMode("NORMAL")).toBe(true);
      expect(isValidOperationMode("S_MODE")).toBe(true);
    });

    it("無効な値を判定できる", () => {
      expect(isValidOperationMode("INVALID")).toBe(false);
      expect(isValidOperationMode("")).toBe(false);
      expect(isValidOperationMode(null)).toBe(false);
    });
  });

  describe("isValidBigSaleStrategy", () => {
    it("有効なBigSaleStrategyを判定できる", () => {
      expect(isValidBigSaleStrategy("NONE")).toBe(true);
      expect(isValidBigSaleStrategy("LIGHT")).toBe(true);
      expect(isValidBigSaleStrategy("AGGRESSIVE")).toBe(true);
    });

    it("無効な値を判定できる", () => {
      expect(isValidBigSaleStrategy("INVALID")).toBe(false);
      expect(isValidBigSaleStrategy("")).toBe(false);
    });
  });

  describe("getBigSaleStrategy", () => {
    it("未定義の場合はデフォルト値を返す", () => {
      expect(getBigSaleStrategy(undefined)).toBe(DEFAULT_BIG_SALE_STRATEGY);
    });

    it("定義済みの場合はそのまま返す", () => {
      expect(getBigSaleStrategy("AGGRESSIVE")).toBe("AGGRESSIVE");
      expect(getBigSaleStrategy("LIGHT")).toBe("LIGHT");
      expect(getBigSaleStrategy("NONE")).toBe("NONE");
    });
  });

  describe("determineEffectiveMode", () => {
    describe("globalMode = NORMAL の場合", () => {
      it("EventMode、bigSaleStrategyに関わらずNORMALを返す", () => {
        const testCases: EffectiveModeInput[] = [
          { globalMode: "NORMAL", eventMode: "NONE", bigSaleStrategy: "AGGRESSIVE" },
          { globalMode: "NORMAL", eventMode: "BIG_SALE_PREP", bigSaleStrategy: "AGGRESSIVE" },
          { globalMode: "NORMAL", eventMode: "BIG_SALE_DAY", bigSaleStrategy: "AGGRESSIVE" },
          { globalMode: "NORMAL", eventMode: "BIG_SALE_DAY", bigSaleStrategy: "LIGHT" },
          { globalMode: "NORMAL", eventMode: "BIG_SALE_DAY", bigSaleStrategy: "NONE" },
        ];

        for (const input of testCases) {
          const result = determineEffectiveMode(input);
          expect(result.effectiveMode).toBe("NORMAL");
          expect(result.sModeScale).toBe(0.0);
        }
      });
    });

    describe("globalMode = S_MODE, eventMode = NONE の場合", () => {
      it("bigSaleStrategyに関わらずNORMALを返す", () => {
        const testCases: EffectiveModeInput[] = [
          { globalMode: "S_MODE", eventMode: "NONE", bigSaleStrategy: "AGGRESSIVE" },
          { globalMode: "S_MODE", eventMode: "NONE", bigSaleStrategy: "LIGHT" },
          { globalMode: "S_MODE", eventMode: "NONE", bigSaleStrategy: "NONE" },
        ];

        for (const input of testCases) {
          const result = determineEffectiveMode(input);
          expect(result.effectiveMode).toBe("NORMAL");
          expect(result.sModeScale).toBe(0.0);
        }
      });
    });

    describe("globalMode = S_MODE, eventMode = BIG_SALE_DAY の場合", () => {
      it("bigSaleStrategy = AGGRESSIVE → S_MODE (フルパワー)", () => {
        const input: EffectiveModeInput = {
          globalMode: "S_MODE",
          eventMode: "BIG_SALE_DAY",
          bigSaleStrategy: "AGGRESSIVE",
        };
        const result = determineEffectiveMode(input);

        expect(result.effectiveMode).toBe("S_MODE");
        expect(result.sModeScale).toBe(1.0);
      });

      it("bigSaleStrategy = LIGHT → S_MODE_LIGHT (スケール0.5)", () => {
        const input: EffectiveModeInput = {
          globalMode: "S_MODE",
          eventMode: "BIG_SALE_DAY",
          bigSaleStrategy: "LIGHT",
        };
        const result = determineEffectiveMode(input);

        expect(result.effectiveMode).toBe("S_MODE_LIGHT");
        expect(result.sModeScale).toBe(0.5);
      });

      it("bigSaleStrategy = NONE → NORMAL (参加しない)", () => {
        const input: EffectiveModeInput = {
          globalMode: "S_MODE",
          eventMode: "BIG_SALE_DAY",
          bigSaleStrategy: "NONE",
        };
        const result = determineEffectiveMode(input);

        expect(result.effectiveMode).toBe("NORMAL");
        expect(result.sModeScale).toBe(0.0);
      });
    });

    describe("globalMode = S_MODE, eventMode = BIG_SALE_PREP の場合", () => {
      it("bigSaleStrategy = AGGRESSIVE → S_MODE_LIGHT (準備期間は控えめ)", () => {
        const input: EffectiveModeInput = {
          globalMode: "S_MODE",
          eventMode: "BIG_SALE_PREP",
          bigSaleStrategy: "AGGRESSIVE",
        };
        const result = determineEffectiveMode(input);

        expect(result.effectiveMode).toBe("S_MODE_LIGHT");
        expect(result.sModeScale).toBe(0.5);
      });

      it("bigSaleStrategy = LIGHT → NORMAL (準備期間は適用しない)", () => {
        const input: EffectiveModeInput = {
          globalMode: "S_MODE",
          eventMode: "BIG_SALE_PREP",
          bigSaleStrategy: "LIGHT",
        };
        const result = determineEffectiveMode(input);

        expect(result.effectiveMode).toBe("NORMAL");
        expect(result.sModeScale).toBe(0.0);
      });

      it("bigSaleStrategy = NONE → NORMAL", () => {
        const input: EffectiveModeInput = {
          globalMode: "S_MODE",
          eventMode: "BIG_SALE_PREP",
          bigSaleStrategy: "NONE",
        };
        const result = determineEffectiveMode(input);

        expect(result.effectiveMode).toBe("NORMAL");
        expect(result.sModeScale).toBe(0.0);
      });
    });
  });

  describe("スケーリング関数", () => {
    describe("scaleSmodeParameter", () => {
      it("sModeScale = 1.0 の場合、baseValueを返す", () => {
        expect(scaleSmodeParameter(1.5, 1.3, 1.0)).toBeCloseTo(1.5);
      });

      it("sModeScale = 0.0 の場合、normalValueを返す", () => {
        expect(scaleSmodeParameter(1.5, 1.3, 0.0)).toBeCloseTo(1.3);
      });

      it("sModeScale = 0.5 の場合、中間値を返す", () => {
        // 1.3 + (1.5 - 1.3) × 0.5 = 1.3 + 0.1 = 1.4
        expect(scaleSmodeParameter(1.5, 1.3, 0.5)).toBeCloseTo(1.4);
      });
    });

    describe("scaleBidUpMultiplier", () => {
      it("正しくスケーリングする", () => {
        // NORMAL=1.3, S_MODE=1.5 の場合
        expect(scaleBidUpMultiplier(1.5, 1.3, 1.0)).toBeCloseTo(1.5);
        expect(scaleBidUpMultiplier(1.5, 1.3, 0.5)).toBeCloseTo(1.4);
        expect(scaleBidUpMultiplier(1.5, 1.3, 0.0)).toBeCloseTo(1.3);
      });
    });

    describe("scaleBidDownMultiplier", () => {
      it("正しくスケーリングする", () => {
        // NORMAL=0.7, S_MODE=0.9 の場合
        expect(scaleBidDownMultiplier(0.9, 0.7, 1.0)).toBeCloseTo(0.9);
        expect(scaleBidDownMultiplier(0.9, 0.7, 0.5)).toBeCloseTo(0.8);
        expect(scaleBidDownMultiplier(0.9, 0.7, 0.0)).toBeCloseTo(0.7);
      });
    });

    describe("scaleAcosMultiplier", () => {
      it("正しくスケーリングする", () => {
        // NORMAL=1.2, S_MODE=1.5 の場合
        expect(scaleAcosMultiplier(1.5, 1.2, 1.0)).toBeCloseTo(1.5);
        expect(scaleAcosMultiplier(1.5, 1.2, 0.5)).toBeCloseTo(1.35);
        expect(scaleAcosMultiplier(1.5, 1.2, 0.0)).toBeCloseTo(1.2);
      });
    });
  });

  describe("calculateEffectiveEventBidParams", () => {
    it("S_MODEフルパワーの場合、S_MODEのポリシーを返す", () => {
      const effectiveModeResult = {
        effectiveMode: "S_MODE" as const,
        reason: "test",
        sModeScale: 1.0,
      };

      const result = calculateEffectiveEventBidParams(
        effectiveModeResult,
        "BIG_SALE_DAY"
      );

      expect(result.maxBidUpMultiplier).toBeCloseTo(1.5);
      expect(result.maxBidDownMultiplier).toBeCloseTo(0.9);
      expect(result.allowStrongDown).toBe(false); // BIG_SALE_DAY + S_MODE では抑制
      expect(result.allowNoConversionDown).toBe(false);
    });

    it("NORMALモードの場合、NORMALのポリシーを返す", () => {
      const effectiveModeResult = {
        effectiveMode: "NORMAL" as const,
        reason: "test",
        sModeScale: 0.0,
      };

      const result = calculateEffectiveEventBidParams(
        effectiveModeResult,
        "BIG_SALE_DAY"
      );

      expect(result.maxBidUpMultiplier).toBeCloseTo(1.3);
      expect(result.maxBidDownMultiplier).toBeCloseTo(0.7);
      expect(result.allowStrongDown).toBe(true); // NORMALでは許可
      expect(result.allowNoConversionDown).toBe(true);
    });

    it("S_MODE_LIGHTの場合、中間のポリシーを返す", () => {
      const effectiveModeResult = {
        effectiveMode: "S_MODE_LIGHT" as const,
        reason: "test",
        sModeScale: 0.5,
      };

      const result = calculateEffectiveEventBidParams(
        effectiveModeResult,
        "BIG_SALE_DAY"
      );

      // 1.3 + (1.5 - 1.3) × 0.5 = 1.4
      expect(result.maxBidUpMultiplier).toBeCloseTo(1.4);
      // 0.7 + (0.9 - 0.7) × 0.5 = 0.8
      expect(result.maxBidDownMultiplier).toBeCloseTo(0.8);
      expect(result.allowStrongDown).toBe(false); // BIG_SALE_DAY + S_MODE_LIGHT では抑制
      expect(result.allowNoConversionDown).toBe(false);
    });

    it("NONEイベント時は強いダウンを許可する", () => {
      const effectiveModeResult = {
        effectiveMode: "NORMAL" as const,
        reason: "test",
        sModeScale: 0.0,
      };

      const result = calculateEffectiveEventBidParams(
        effectiveModeResult,
        "NONE"
      );

      expect(result.allowStrongDown).toBe(true);
      expect(result.allowNoConversionDown).toBe(true);
    });
  });

  describe("DEFAULT_S_MODE_SCALE_CONFIG", () => {
    it("適切なデフォルト値が設定されている", () => {
      expect(DEFAULT_S_MODE_SCALE_CONFIG.aggressive).toBe(1.0);
      expect(DEFAULT_S_MODE_SCALE_CONFIG.light).toBe(0.5);
      expect(DEFAULT_S_MODE_SCALE_CONFIG.none).toBe(0.0);
    });
  });
});

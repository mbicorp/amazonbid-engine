/**
 * プレセール対応攻めロジック統合のテスト
 */

import {
  adjustOffenseAction,
  applyPresaleUpStrategy,
  applyPresaleOffense,
  applyBuyingUpStrategy,
  applyHoldBackUpStrategy,
  applyMixedUpStrategy,
  OffenseAction,
  PresaleContext,
  DEFAULT_PRESALE_POLICIES,
} from "../../src/presale";

describe("プレセール対応攻めロジック", () => {
  // ==========================================================================
  // テスト用ヘルパー
  // ==========================================================================

  const createContext = (
    type: "NONE" | "BUYING" | "HOLD_BACK" | "MIXED",
    overrides?: Partial<PresaleContext>
  ): PresaleContext => ({
    salePhase: type === "NONE" ? "NORMAL" : "PRE_SALE",
    diagnosis: {
      type,
      baselineCvr: 0.1,
      presaleCvr: type === "HOLD_BACK" ? 0.04 : 0.1,
      baselineAcos: 0.1,
      presaleAcos: type === "HOLD_BACK" ? 0.35 : 0.1,
      cvrRatio: type === "HOLD_BACK" ? 0.4 : 1.0,
      acosRatio: type === "HOLD_BACK" ? 3.5 : 1.0,
      reason: "",
    },
    policy: DEFAULT_PRESALE_POLICIES[type],
    ...overrides,
  });

  // ==========================================================================
  // adjustOffenseAction テスト
  // ==========================================================================

  describe("adjustOffenseAction", () => {
    describe("NONEコンテキスト（プレセール期間外）", () => {
      const noneContext = createContext("NONE");

      it("全てのアクションがそのまま通過", () => {
        const result1 = adjustOffenseAction("STRONG_UP", 1.4, noneContext);
        expect(result1.finalAction).toBe("STRONG_UP");
        expect(result1.finalMultiplier).toBe(1.4);
        expect(result1.adjustedByPresale).toBe(false);

        const result2 = adjustOffenseAction("MILD_UP", 1.2, noneContext);
        expect(result2.finalAction).toBe("MILD_UP");
        expect(result2.finalMultiplier).toBe(1.2);
        expect(result2.adjustedByPresale).toBe(false);

        const result3 = adjustOffenseAction("KEEP", 1.0, noneContext);
        expect(result3.finalAction).toBe("KEEP");
        expect(result3.finalMultiplier).toBe(1.0);
        expect(result3.adjustedByPresale).toBe(false);
      });
    });

    describe("BUYINGコンテキスト（売れるプレセール）", () => {
      const buyingContext = createContext("BUYING");

      it("STRONG_UPは許可されるが倍率は制限される", () => {
        // maxUpMultiplier = 1.25 なので 1.4 -> 1.25 に制限
        const result = adjustOffenseAction("STRONG_UP", 1.4, buyingContext);

        expect(result.finalAction).toBe("STRONG_UP");
        expect(result.finalMultiplier).toBe(1.25);
        expect(result.originalMultiplier).toBe(1.4);
        expect(result.adjustedByPresale).toBe(true);
        expect(result.adjustmentReason).toContain("UP倍率を");
      });

      it("STRONG_UPで倍率が制限内ならそのまま", () => {
        const result = adjustOffenseAction("STRONG_UP", 1.2, buyingContext);

        expect(result.finalAction).toBe("STRONG_UP");
        expect(result.finalMultiplier).toBe(1.2);
        expect(result.adjustedByPresale).toBe(false);
      });

      it("MILD_UPもそのまま許可", () => {
        const result = adjustOffenseAction("MILD_UP", 1.1, buyingContext);

        expect(result.finalAction).toBe("MILD_UP");
        expect(result.finalMultiplier).toBe(1.1);
        expect(result.adjustedByPresale).toBe(false);
      });
    });

    describe("HOLD_BACKコンテキスト（買い控えプレセール）", () => {
      const holdBackContext = createContext("HOLD_BACK");

      it("STRONG_UPがMILD_UPに変換され倍率も制限される", () => {
        const result = adjustOffenseAction("STRONG_UP", 1.4, holdBackContext);

        expect(result.finalAction).toBe("MILD_UP");
        expect(result.originalAction).toBe("STRONG_UP");
        expect(result.finalMultiplier).toBe(1.1); // maxUpMultiplier = 1.1
        expect(result.adjustedByPresale).toBe(true);
        expect(result.adjustmentReason).toContain("STRONG_UP禁止");
      });

      it("MILD_UPは許可されるが倍率は制限される", () => {
        const result = adjustOffenseAction("MILD_UP", 1.2, holdBackContext);

        expect(result.finalAction).toBe("MILD_UP");
        expect(result.finalMultiplier).toBe(1.1); // maxUpMultiplier = 1.1
        expect(result.adjustedByPresale).toBe(true);
      });

      it("MILD_UPで倍率が制限内ならそのまま", () => {
        const result = adjustOffenseAction("MILD_UP", 1.05, holdBackContext);

        expect(result.finalAction).toBe("MILD_UP");
        expect(result.finalMultiplier).toBe(1.05);
        expect(result.adjustedByPresale).toBe(false);
      });

      it("KEEPはそのまま", () => {
        const result = adjustOffenseAction("KEEP", 1.0, holdBackContext);

        expect(result.finalAction).toBe("KEEP");
        expect(result.finalMultiplier).toBe(1.0);
        expect(result.adjustedByPresale).toBe(false);
      });
    });

    describe("MIXEDコンテキスト（グレーゾーン）", () => {
      const mixedContext = createContext("MIXED");

      it("STRONG_UPがMILD_UPに変換される", () => {
        const result = adjustOffenseAction("STRONG_UP", 1.3, mixedContext);

        expect(result.finalAction).toBe("MILD_UP");
        expect(result.originalAction).toBe("STRONG_UP");
        expect(result.finalMultiplier).toBe(1.15); // maxUpMultiplier = 1.15
        expect(result.adjustedByPresale).toBe(true);
      });

      it("MILD_UPは許可されるが倍率は制限される", () => {
        const result = adjustOffenseAction("MILD_UP", 1.2, mixedContext);

        expect(result.finalAction).toBe("MILD_UP");
        expect(result.finalMultiplier).toBe(1.15);
        expect(result.adjustedByPresale).toBe(true);
      });
    });
  });

  // ==========================================================================
  // applyPresaleUpStrategy テスト
  // ==========================================================================

  describe("applyPresaleUpStrategy", () => {
    describe("NONEコンテキスト", () => {
      const noneContext = createContext("NONE");

      it("調整なしでそのまま返す", () => {
        const result = applyPresaleUpStrategy(100, 150, noneContext);

        expect(result.adjustedBid).toBe(150);
        expect(result.strategy).toContain("調整なし");
        expect(result.presaleType).toBe("NONE");
      });
    });

    describe("BUYINGコンテキスト", () => {
      const buyingContext = createContext("BUYING");

      it("倍率が制限される", () => {
        // 100 -> 150 = 1.5倍、maxUpMultiplier = 1.25 なので 125 に制限
        const result = applyPresaleUpStrategy(100, 150, buyingContext);

        expect(result.adjustedBid).toBe(125);
        expect(result.strategy).toContain("BUYING");
        expect(result.strategy).toContain("制限");
      });

      it("倍率が制限内ならそのまま", () => {
        const result = applyPresaleUpStrategy(100, 120, buyingContext);

        expect(result.adjustedBid).toBe(120);
        expect(result.strategy).toContain("積極的アップを許可");
      });

      it("目標が現在以下なら調整なし", () => {
        const result = applyPresaleUpStrategy(100, 90, buyingContext);

        expect(result.adjustedBid).toBe(90);
        expect(result.strategy).toContain("調整なし");
      });
    });

    describe("HOLD_BACKコンテキスト", () => {
      const holdBackContext = createContext("HOLD_BACK");

      it("倍率が厳しく制限される", () => {
        // maxUpMultiplier = 1.1 なので 100 -> 110 に制限
        const result = applyPresaleUpStrategy(100, 150, holdBackContext);

        expect(result.adjustedBid).toBeCloseTo(110, 5);
        expect(result.strategy).toContain("HOLD_BACK");
        expect(result.strategy).toContain("控えめ");
      });

      it("倍率が制限内ならそのまま", () => {
        const result = applyPresaleUpStrategy(100, 105, holdBackContext);

        expect(result.adjustedBid).toBe(105);
        expect(result.strategy).toContain("控えめアップ");
      });
    });

    describe("MIXEDコンテキスト", () => {
      const mixedContext = createContext("MIXED");

      it("中間的な制限が適用される", () => {
        // maxUpMultiplier = 1.15 なので 100 -> 115 に制限
        const result = applyPresaleUpStrategy(100, 150, mixedContext);

        expect(result.adjustedBid).toBeCloseTo(115, 5);
        expect(result.strategy).toContain("MIXED");
        expect(result.strategy).toContain("中間的");
      });
    });
  });

  // ==========================================================================
  // 個別のアップ戦略テスト
  // ==========================================================================

  describe("applyBuyingUpStrategy", () => {
    const buyingContext = createContext("BUYING");

    it("目標入札額が制限内なら許可", () => {
      const result = applyBuyingUpStrategy(100, 120, buyingContext);

      expect(result.adjustedBid).toBe(120);
      expect(result.strategy).toContain("積極的アップを許可");
    });

    it("目標入札額が制限超過なら制限", () => {
      const result = applyBuyingUpStrategy(100, 140, buyingContext);

      expect(result.adjustedBid).toBe(125);
      expect(result.strategy).toContain("MAIN_SALEに余地を残す");
    });
  });

  describe("applyHoldBackUpStrategy", () => {
    const holdBackContext = createContext("HOLD_BACK");

    it("控えめな制限が適用される", () => {
      const result = applyHoldBackUpStrategy(100, 130, holdBackContext);

      expect(result.adjustedBid).toBeCloseTo(110, 5);
      expect(result.strategy).toContain("買い控え期間のため控えめ");
    });
  });

  describe("applyMixedUpStrategy", () => {
    const mixedContext = createContext("MIXED");

    it("中間的な制限が適用される", () => {
      const result = applyMixedUpStrategy(100, 130, mixedContext);

      expect(result.adjustedBid).toBeCloseTo(115, 5);
      expect(result.strategy).toContain("グレーゾーンのため中間的制限");
    });
  });

  // ==========================================================================
  // applyPresaleOffense テスト
  // ==========================================================================

  describe("applyPresaleOffense", () => {
    it("adjustOffenseActionと同じ結果を返す", () => {
      const context = createContext("HOLD_BACK");

      const result = applyPresaleOffense("STRONG_UP", 1.4, context);

      expect(result.finalAction).toBe("MILD_UP");
      expect(result.finalMultiplier).toBe(1.1);
      expect(result.adjustedByPresale).toBe(true);
    });
  });
});

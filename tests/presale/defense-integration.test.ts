/**
 * プレセール対応防御ロジック統合のテスト
 */

import {
  adjustDefenseAction,
  applyPresaleDownLimit,
  shouldAllowDownInHoldBack,
  applyPresaleDefense,
  DefenseAction,
  PresaleContext,
  PresaleBidPolicy,
  DEFAULT_PRESALE_POLICIES,
} from "../../src/presale";

describe("プレセール対応防御ロジック", () => {
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
  // adjustDefenseAction テスト
  // ==========================================================================

  describe("adjustDefenseAction", () => {
    describe("NONEコンテキスト（プレセール期間外）", () => {
      const noneContext = createContext("NONE");

      it("全てのアクションがそのまま通過", () => {
        const actions: DefenseAction[] = ["STOP", "NEG", "STRONG_DOWN", "DOWN", "KEEP"];

        for (const action of actions) {
          const result = adjustDefenseAction(action, noneContext);
          expect(result.finalAction).toBe(action);
          expect(result.adjustedByPresale).toBe(false);
        }
      });
    });

    describe("BUYINGコンテキスト（売れるプレセール）", () => {
      const buyingContext = createContext("BUYING");

      it("全てのアクションが許可される", () => {
        const result1 = adjustDefenseAction("STOP", buyingContext);
        expect(result1.finalAction).toBe("STOP");
        expect(result1.adjustedByPresale).toBe(false);

        const result2 = adjustDefenseAction("STRONG_DOWN", buyingContext);
        expect(result2.finalAction).toBe("STRONG_DOWN");
        expect(result2.adjustedByPresale).toBe(false);
      });
    });

    describe("HOLD_BACKコンテキスト（買い控えプレセール）", () => {
      const holdBackContext = createContext("HOLD_BACK");

      it("STOPがKEEPに変換される", () => {
        const result = adjustDefenseAction("STOP", holdBackContext);

        expect(result.finalAction).toBe("KEEP");
        expect(result.originalAction).toBe("STOP");
        expect(result.adjustedByPresale).toBe(true);
        expect(result.adjustmentReason).toContain("STOP/NEGを禁止");
      });

      it("NEGがKEEPに変換される", () => {
        const result = adjustDefenseAction("NEG", holdBackContext);

        expect(result.finalAction).toBe("KEEP");
        expect(result.originalAction).toBe("NEG");
        expect(result.adjustedByPresale).toBe(true);
      });

      it("STRONG_DOWNがDOWNに変換される", () => {
        const result = adjustDefenseAction("STRONG_DOWN", holdBackContext);

        expect(result.finalAction).toBe("DOWN");
        expect(result.originalAction).toBe("STRONG_DOWN");
        expect(result.adjustedByPresale).toBe(true);
        expect(result.adjustmentReason).toContain("STRONG_DOWN禁止");
      });

      it("DOWNはそのまま", () => {
        const result = adjustDefenseAction("DOWN", holdBackContext);

        expect(result.finalAction).toBe("DOWN");
        expect(result.adjustedByPresale).toBe(false);
      });

      it("KEEPはそのまま", () => {
        const result = adjustDefenseAction("KEEP", holdBackContext);

        expect(result.finalAction).toBe("KEEP");
        expect(result.adjustedByPresale).toBe(false);
      });
    });

    describe("MIXEDコンテキスト（グレーゾーン）", () => {
      const mixedContext = createContext("MIXED");

      it("STOPがKEEPに変換される", () => {
        const result = adjustDefenseAction("STOP", mixedContext);

        expect(result.finalAction).toBe("KEEP");
        expect(result.adjustedByPresale).toBe(true);
      });

      it("STRONG_DOWNがDOWNに変換される", () => {
        const result = adjustDefenseAction("STRONG_DOWN", mixedContext);

        expect(result.finalAction).toBe("DOWN");
        expect(result.adjustedByPresale).toBe(true);
      });
    });
  });

  // ==========================================================================
  // applyPresaleDownLimit テスト
  // ==========================================================================

  describe("applyPresaleDownLimit", () => {
    it("NONEコンテキストでは制限なし", () => {
      const context = createContext("NONE");
      // -20%減少を適用
      const result = applyPresaleDownLimit(100, -20, context);

      expect(result.adjustedBid).toBe(80);
      expect(result.wasLimited).toBe(false);
    });

    it("HOLD_BACKコンテキストでDOWN幅が制限される", () => {
      const context = createContext("HOLD_BACK");
      // maxDownPercent = 7% なので、100 * (1 - 0.07) = 93 が最小
      // rawDownPercent = -20 (20%減少) → adjustedDownPercent = -7 (7%減少)
      const result = applyPresaleDownLimit(100, -20, context);

      expect(result.adjustedBid).toBe(93);
      expect(result.wasLimited).toBe(true);
      expect(result.adjustedDownPercent).toBe(-7);
    });

    it("HOLD_BACKでも制限内ならそのまま", () => {
      const context = createContext("HOLD_BACK");
      // -5%減少は-7%の制限内
      const result = applyPresaleDownLimit(100, -5, context);

      expect(result.adjustedBid).toBe(95);
      expect(result.wasLimited).toBe(false);
    });

    it("MIXEDコンテキストでDOWN幅が制限される", () => {
      const context = createContext("MIXED");
      // maxDownPercent = 10% なので、rawDownPercent = -20 → -10 に制限
      const result = applyPresaleDownLimit(100, -20, context);

      expect(result.adjustedBid).toBe(90);
      expect(result.wasLimited).toBe(true);
      expect(result.adjustedDownPercent).toBe(-10);
    });

    it("アップ方向のpercent（正の値）はそのまま", () => {
      const context = createContext("HOLD_BACK");
      // +10%増加 → 110
      const result = applyPresaleDownLimit(100, 10, context);

      expect(result.adjustedBid).toBeCloseTo(110, 5);
      expect(result.wasLimited).toBe(false);
    });
  });

  // ==========================================================================
  // shouldAllowDownInHoldBack テスト
  // ==========================================================================

  describe("shouldAllowDownInHoldBack", () => {
    it("baseline ACOSが悪い場合はDOWNを許可", () => {
      // 5引数は必須：baselineAcos, presaleAcos, targetAcos, baselineCvr, presaleCvr
      const result = shouldAllowDownInHoldBack(
        0.35, // baselineAcos - targetAcos*1.2 = 0.24を超えている
        0.50, // presaleAcos - baselineAcos以上
        0.20, // targetAcos
        0.10, // baselineCvr
        0.05  // presaleCvr
      );

      expect(result.allowDown).toBe(true);
      expect(result.reason).toContain("二重条件クリア");
    });

    it("baseline ACOSが良い場合はDOWNを禁止", () => {
      const result = shouldAllowDownInHoldBack(
        0.10, // baselineAcos - 良い（targetAcos*1.2 = 0.24未満）
        0.50, // presaleAcos - 悪い
        0.20, // targetAcos
        0.10, // baselineCvr
        0.05  // presaleCvr
      );

      expect(result.allowDown).toBe(false);
      expect(result.reason).toContain("未達");
    });

    it("baseline ACOSがnullの場合はDOWN禁止", () => {
      const result = shouldAllowDownInHoldBack(
        null, // baselineAcos
        0.50, // presaleAcos
        0.20, // targetAcos
        0.10, // baselineCvr
        0.05  // presaleCvr
      );

      expect(result.allowDown).toBe(false);
      expect(result.reason).toContain("baselineACOSが不明");
    });

    it("presale ACOSがnullの場合はDOWN禁止", () => {
      const result = shouldAllowDownInHoldBack(
        0.35, // baselineAcos
        null, // presaleAcos
        0.20, // targetAcos
        0.10, // baselineCvr
        0.05  // presaleCvr
      );

      expect(result.allowDown).toBe(false);
      expect(result.reason).toContain("presaleACOSが不明");
    });

    it("CVR条件も考慮（baselineCVRが悪い場合はDOWN許可）", () => {
      // baselineAcosが悪い + baselineCvrがtargetの80%未満
      const result = shouldAllowDownInHoldBack(
        0.35, // baselineAcos - 悪い
        0.40, // presaleAcos - さらに悪い
        0.20, // targetAcos
        0.03, // baselineCvr - targetCvrの80%未満
        0.02, // presaleCvr
        0.05  // targetCvr
      );

      expect(result.allowDown).toBe(true);
      expect(result.reason).toContain("二重条件クリア");
    });

    it("CVR条件も考慮（baselineCVRが良い場合はCVR条件未達）", () => {
      // baselineAcosが悪いがbaselineCvrは良い
      const result = shouldAllowDownInHoldBack(
        0.35, // baselineAcos - 悪い
        0.40, // presaleAcos
        0.20, // targetAcos
        0.10, // baselineCvr - targetCvrの80%以上
        0.02, // presaleCvr
        0.05  // targetCvr
      );

      // ACOSは満たすがCVR条件が満たされない
      expect(result.allowDown).toBe(false);
      expect(result.reason).toContain("CVR条件未達");
    });
  });

  // ==========================================================================
  // applyPresaleDefense テスト
  // ==========================================================================

  describe("applyPresaleDefense", () => {
    it("HOLD_BACKでbaselineも悪い場合はDOWNを許可", () => {
      const context: PresaleContext = {
        salePhase: "PRE_SALE",
        diagnosis: {
          type: "HOLD_BACK",
          baselineCvr: 0.02, // targetCvr(0.05)の80%未満
          presaleCvr: 0.01,
          baselineAcos: 0.35, // targetAcos(0.20)の120%超
          presaleAcos: 0.50,
          cvrRatio: 0.5,
          acosRatio: 1.43,
          reason: "",
        },
        policy: DEFAULT_PRESALE_POLICIES.HOLD_BACK,
      };

      const result = applyPresaleDefense("DOWN", context, 0.20, 0.05);

      expect(result.finalAction).toBe("DOWN");
      expect(result.adjustedByPresale).toBe(false);
    });

    it("HOLD_BACKでbaselineが良い場合はDOWNをKEEPに変換", () => {
      const context: PresaleContext = {
        salePhase: "PRE_SALE",
        diagnosis: {
          type: "HOLD_BACK",
          baselineCvr: 0.10,
          presaleCvr: 0.03,
          baselineAcos: 0.10, // targetAcos(0.20)の120%未満 = 良い
          presaleAcos: 0.50,
          cvrRatio: 0.3,
          acosRatio: 5.0,
          reason: "",
        },
        policy: DEFAULT_PRESALE_POLICIES.HOLD_BACK,
      };

      const result = applyPresaleDefense("DOWN", context, 0.20);

      expect(result.finalAction).toBe("KEEP");
      expect(result.adjustedByPresale).toBe(true);
      expect(result.adjustmentReason).toContain("二重条件未達");
    });

    it("BUYINGコンテキストでは通常通りDOWN許可", () => {
      const context = createContext("BUYING");

      const result = applyPresaleDefense("STRONG_DOWN", context, 0.20);

      expect(result.finalAction).toBe("STRONG_DOWN");
      expect(result.adjustedByPresale).toBe(false);
    });

    it("NONEコンテキストでは全て許可", () => {
      const context = createContext("NONE");

      const result = applyPresaleDefense("STOP", context);

      expect(result.finalAction).toBe("STOP");
      expect(result.adjustedByPresale).toBe(false);
    });
  });
});

/**
 * プレセール診断関数のテスト
 */

import {
  diagnosePresaleType,
  getPresaleBidPolicy,
  createPresaleContext,
  calculateCvr,
  calculateAcos,
  hasMinimumClicks,
  PresaleDiagnosisInput,
  SaleContextConfig,
  PresaleThresholdConfig,
  DEFAULT_SALE_CONTEXT_CONFIG,
  DEFAULT_PRESALE_THRESHOLD_CONFIG,
  DEFAULT_PRESALE_POLICIES,
} from "../../src/presale";

describe("プレセール診断", () => {
  // ==========================================================================
  // ヘルパー関数テスト
  // ==========================================================================

  describe("calculateCvr", () => {
    it("正常なCVR計算", () => {
      expect(calculateCvr(10, 100)).toBe(0.1);
      expect(calculateCvr(5, 50)).toBe(0.1);
      expect(calculateCvr(0, 100)).toBe(0);
    });

    it("クリック0の場合はnullを返す", () => {
      expect(calculateCvr(10, 0)).toBeNull();
    });
  });

  describe("calculateAcos", () => {
    it("正常なACOS計算", () => {
      expect(calculateAcos(100, 1000)).toBe(0.1);
      expect(calculateAcos(500, 1000)).toBe(0.5);
      expect(calculateAcos(0, 1000)).toBe(0);
    });

    it("売上0または未定義の場合はnullを返す", () => {
      expect(calculateAcos(100, 0)).toBeNull();
      expect(calculateAcos(100, undefined)).toBeNull();
    });
  });

  describe("hasMinimumClicks", () => {
    it("最小クリック数の判定", () => {
      expect(hasMinimumClicks(20, 20)).toBe(true);
      expect(hasMinimumClicks(21, 20)).toBe(true);
      expect(hasMinimumClicks(19, 20)).toBe(false);
      expect(hasMinimumClicks(0, 20)).toBe(false);
    });
  });

  // ==========================================================================
  // diagnosePresaleType テスト
  // ==========================================================================

  describe("diagnosePresaleType", () => {
    const presaleConfig: SaleContextConfig = {
      ...DEFAULT_SALE_CONTEXT_CONFIG,
      salePhase: "PRE_SALE",
    };

    describe("NONEの判定（非プレセール期間）", () => {
      it("NORMALフェーズではNONEを返す", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 500, conversions: 5, revenue: 5000 },
        };

        const result = diagnosePresaleType(input, {
          ...presaleConfig,
          salePhase: "NORMAL",
        });

        expect(result.type).toBe("NONE");
        expect(result.reason).toContain("診断対象外");
      });

      it("MAIN_SALEフェーズではNONEを返す", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 500, conversions: 5, revenue: 5000 },
        };

        const result = diagnosePresaleType(input, {
          ...presaleConfig,
          salePhase: "MAIN_SALE",
        });

        expect(result.type).toBe("NONE");
      });
    });

    describe("MIXEDの判定（データ不足）", () => {
      it("baselineのクリック不足でMIXED", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 5, cost: 100, conversions: 1, revenue: 1000 },
          presale: { clicks: 50, cost: 500, conversions: 5, revenue: 5000 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("MIXED");
        expect(result.reason).toContain("baseline");
        expect(result.reason).toContain("クリック");
      });

      it("presaleのクリック不足でMIXED", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 5, cost: 50, conversions: 0, revenue: 500 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("MIXED");
        expect(result.reason).toContain("presale");
        expect(result.reason).toContain("クリック");
      });

      it("baselineCVRが0でMIXED", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 0, revenue: 0 },
          presale: { clicks: 50, cost: 500, conversions: 5, revenue: 5000 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("MIXED");
        expect(result.baselineCvr).toBe(0);
        expect(result.reason).toContain("CVR比率が計算できない");
      });
    });

    describe("BUYINGの判定（売れるプレセール）", () => {
      it("CVR維持 + ACOS良好でBUYING", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 500, conversions: 5, revenue: 5000 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("BUYING");
        expect(result.baselineCvr).toBe(0.1);
        expect(result.presaleCvr).toBe(0.1);
        expect(result.cvrRatio).toBe(1.0);
        expect(result.acosRatio).toBe(1.0);
        expect(result.reason).toContain("売れるプレセール");
      });

      it("CVRが90%以上維持でBUYING", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 500, conversions: 5, revenue: 5556 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("BUYING");
        expect(result.cvrRatio).toBe(1.0);
      });

      it("ACOSが120%以下でBUYING", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 600, conversions: 5, revenue: 5000 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("BUYING");
        expect(result.acosRatio).toBe(1.2);
      });
    });

    describe("HOLD_BACKの判定（買い控えプレセール）", () => {
      it("CVR大幅悪化 + ACOS悪化でHOLD_BACK", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 700, conversions: 2, revenue: 2000 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("HOLD_BACK");
        expect(result.cvrRatio).toBeCloseTo(0.4, 5); // 4%/10% = 0.4
        expect(result.acosRatio).toBeCloseTo(3.5, 5); // (700/2000) / (1000/10000) = 0.35 / 0.1 = 3.5
        expect(result.reason).toContain("買い控えプレセール");
      });

      it("CVRが60%以下でHOLD_BACK候補", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 800, conversions: 3, revenue: 3000 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("HOLD_BACK");
        expect(result.cvrRatio).toBe(0.6);
      });
    });

    describe("MIXEDの判定（グレーゾーン）", () => {
      it("CVRがBUYINGとHOLD_BACKの間でMIXED", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 500, conversions: 4, revenue: 4000 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("MIXED");
        expect(result.cvrRatio).toBeCloseTo(0.8, 5); // 8%/10% = 0.8
        expect(result.reason).toContain("グレーゾーン");
      });

      it("売上データなしでもCVRだけで判定", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10 },
          presale: { clicks: 50, cost: 500, conversions: 5 },
        };

        const result = diagnosePresaleType(input, presaleConfig);

        expect(result.type).toBe("BUYING");
        expect(result.cvrRatio).toBe(1.0);
        expect(result.acosRatio).toBeNull();
      });
    });

    describe("カスタム閾値での診断", () => {
      it("厳しい閾値でBUYINGがMIXEDになる", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 500, conversions: 5, revenue: 5000 },
        };

        const strictThreshold: PresaleThresholdConfig = {
          ...DEFAULT_PRESALE_THRESHOLD_CONFIG,
          minCvrRatioForBuying: 1.1, // CVRが110%以上必要
        };

        const result = diagnosePresaleType(input, presaleConfig, strictThreshold);

        expect(result.type).toBe("MIXED");
      });

      it("緩い閾値でHOLD_BACKがMIXEDになる", () => {
        const input: PresaleDiagnosisInput = {
          baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
          presale: { clicks: 50, cost: 700, conversions: 2, revenue: 2000 },
        };

        const looseThreshold: PresaleThresholdConfig = {
          ...DEFAULT_PRESALE_THRESHOLD_CONFIG,
          maxCvrRatioForHoldBack: 0.3, // CVRが30%以下でないとHOLD_BACKにならない
        };

        const result = diagnosePresaleType(input, presaleConfig, looseThreshold);

        expect(result.type).toBe("MIXED");
      });
    });
  });

  // ==========================================================================
  // getPresaleBidPolicy テスト
  // ==========================================================================

  describe("getPresaleBidPolicy", () => {
    it("NONEタイプのポリシー", () => {
      const policy = getPresaleBidPolicy("NONE");

      expect(policy.allowStopNeg).toBe(true);
      expect(policy.allowStrongDown).toBe(true);
      expect(policy.allowStrongUp).toBe(true);
      expect(policy.maxDownPercent).toBe(15);
      expect(policy.maxUpMultiplier).toBe(1.3);
    });

    it("BUYINGタイプのポリシー", () => {
      const policy = getPresaleBidPolicy("BUYING");

      expect(policy.allowStopNeg).toBe(true);
      expect(policy.allowStrongDown).toBe(true);
      expect(policy.allowStrongUp).toBe(true);
      expect(policy.maxUpMultiplier).toBe(1.25);
    });

    it("HOLD_BACKタイプのポリシー", () => {
      const policy = getPresaleBidPolicy("HOLD_BACK");

      expect(policy.allowStopNeg).toBe(false);
      expect(policy.allowStrongDown).toBe(false);
      expect(policy.allowDown).toBe(true);
      expect(policy.maxDownPercent).toBe(7);
      expect(policy.allowStrongUp).toBe(false);
      expect(policy.maxUpMultiplier).toBe(1.1);
      expect(policy.useBaselineAsPrimary).toBe(true);
    });

    it("MIXEDタイプのポリシー", () => {
      const policy = getPresaleBidPolicy("MIXED");

      expect(policy.allowStopNeg).toBe(false);
      expect(policy.allowStrongDown).toBe(false);
      expect(policy.allowDown).toBe(true);
      expect(policy.maxDownPercent).toBe(10);
      expect(policy.allowStrongUp).toBe(false);
      expect(policy.maxUpMultiplier).toBe(1.15);
      expect(policy.useBaselineAsPrimary).toBe(true);
    });

    it("カスタムポリシーでオーバーライド", () => {
      const customPolicies = {
        HOLD_BACK: { maxDownPercent: 5, maxUpMultiplier: 1.05 },
      };

      const policy = getPresaleBidPolicy("HOLD_BACK", customPolicies);

      expect(policy.maxDownPercent).toBe(5);
      expect(policy.maxUpMultiplier).toBe(1.05);
      expect(policy.allowStopNeg).toBe(false); // 他は維持
    });
  });

  // ==========================================================================
  // createPresaleContext テスト
  // ==========================================================================

  describe("createPresaleContext", () => {
    it("プレセールコンテキストを生成", () => {
      const input: PresaleDiagnosisInput = {
        baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
        presale: { clicks: 50, cost: 500, conversions: 5, revenue: 5000 },
      };

      const config: SaleContextConfig = {
        ...DEFAULT_SALE_CONTEXT_CONFIG,
        salePhase: "PRE_SALE",
      };

      const context = createPresaleContext(input, config);

      expect(context.salePhase).toBe("PRE_SALE");
      expect(context.diagnosis.type).toBe("BUYING");
      expect(context.policy.allowStopNeg).toBe(true);
    });

    it("HOLD_BACKコンテキストを生成", () => {
      const input: PresaleDiagnosisInput = {
        baseline: { clicks: 100, cost: 1000, conversions: 10, revenue: 10000 },
        presale: { clicks: 50, cost: 700, conversions: 2, revenue: 2000 },
      };

      const config: SaleContextConfig = {
        ...DEFAULT_SALE_CONTEXT_CONFIG,
        salePhase: "PRE_SALE",
      };

      const context = createPresaleContext(input, config);

      expect(context.salePhase).toBe("PRE_SALE");
      expect(context.diagnosis.type).toBe("HOLD_BACK");
      expect(context.policy.allowStopNeg).toBe(false);
      expect(context.policy.allowStrongDown).toBe(false);
    });
  });
});

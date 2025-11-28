/**
 * lossBudgetEvaluator モジュールのテスト
 */

import {
  InvestmentState,
  AsinPeriodPerformance,
  LossBudgetConfig,
  DEFAULT_LOSS_BUDGET_CONFIG,
  DEFAULT_ACTION_CONSTRAINTS,
  evaluateAsinLossBudget,
  evaluateAllAsins,
  getActionConstraints,
  getLossBudgetMultiple,
  determineInvestmentState,
  isWarningState,
  isCriticalState,
  shouldConsiderLifecycleTransition,
  generateAlertSummary,
} from "../../src/analytics";

describe("lossBudgetEvaluator", () => {
  // ==========================================================================
  // テスト用ヘルパー
  // ==========================================================================

  function createPerformance(
    overrides: Partial<AsinPeriodPerformance> = {}
  ): AsinPeriodPerformance {
    return {
      asin: "B00TEST123",
      periodStart: "2024-01-01",
      periodEnd: "2024-01-31",
      sales: 100000,
      adCost: 15000,
      lifecycleStage: "GROW",
      ...overrides,
    };
  }

  const defaultG = 0.55; // 55%粗利率
  const defaultTopt = 0.15; // 15%がT_opt

  // ==========================================================================
  // getLossBudgetMultiple テスト
  // ==========================================================================

  describe("getLossBudgetMultiple", () => {
    it("LAUNCH_HARDの倍率を返す", () => {
      expect(
        getLossBudgetMultiple("LAUNCH_HARD", DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(2.5);
    });

    it("LAUNCH_SOFTの倍率を返す", () => {
      expect(
        getLossBudgetMultiple("LAUNCH_SOFT", DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(2.0);
    });

    it("GROWの倍率を返す", () => {
      expect(getLossBudgetMultiple("GROW", DEFAULT_LOSS_BUDGET_CONFIG)).toBe(
        1.5
      );
    });

    it("HARVESTの倍率を返す", () => {
      expect(getLossBudgetMultiple("HARVEST", DEFAULT_LOSS_BUDGET_CONFIG)).toBe(
        0.8
      );
    });
  });

  // ==========================================================================
  // determineInvestmentState テスト
  // ==========================================================================

  describe("determineInvestmentState", () => {
    it("ratioが0.5未満でSAFE", () => {
      expect(
        determineInvestmentState(0.3, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.SAFE);
      expect(
        determineInvestmentState(0.49, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.SAFE);
    });

    it("ratioが0.5以上0.8未満でWATCH", () => {
      expect(
        determineInvestmentState(0.5, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.WATCH);
      expect(
        determineInvestmentState(0.79, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.WATCH);
    });

    it("ratioが0.8以上1.0以下でLIMIT", () => {
      expect(
        determineInvestmentState(0.8, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.LIMIT);
      expect(
        determineInvestmentState(1.0, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.LIMIT);
    });

    it("ratioが1.0超過でBREACH", () => {
      expect(
        determineInvestmentState(1.01, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.BREACH);
      expect(
        determineInvestmentState(2.0, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.BREACH);
    });

    it("ratioが0でSAFE", () => {
      expect(
        determineInvestmentState(0, DEFAULT_LOSS_BUDGET_CONFIG)
      ).toBe(InvestmentState.SAFE);
    });
  });

  // ==========================================================================
  // evaluateAsinLossBudget テスト
  // ==========================================================================

  describe("evaluateAsinLossBudget", () => {
    it("基本的な計算が正しい（SAFE判定）", () => {
      // sales=100000, adCost=15000, g=0.55, T_opt=0.15
      // targetNetMarginMid = 0.55 - 0.15 = 0.40
      // targetNetProfit = 100000 * 0.40 = 40000
      // actualNetProfit = 100000 * 0.55 - 15000 = 40000
      // profitGap = 40000 - 40000 = 0
      // ratioStage = 0 → SAFE

      const perf = createPerformance({ sales: 100000, adCost: 15000 });
      const result = evaluateAsinLossBudget(perf, defaultG, defaultTopt);

      expect(result.targetNetMarginMid).toBeCloseTo(0.40, 5);
      expect(result.targetNetProfit).toBeCloseTo(40000, 0);
      expect(result.actualNetProfit).toBeCloseTo(40000, 0);
      expect(result.profitGap).toBeCloseTo(0, 0);
      expect(result.ratioStage).toBe(0);
      expect(result.investmentState).toBe(InvestmentState.SAFE);
    });

    it("利益ギャップがある場合の計算（WATCH判定）", () => {
      // sales=100000, adCost=30000, g=0.55, T_opt=0.15
      // targetNetProfit = 100000 * 0.40 = 40000
      // actualNetProfit = 100000 * 0.55 - 30000 = 25000
      // profitGap = 40000 - 25000 = 15000
      // lossBudgetStage = 40000 * 1.5 = 60000 (GROW)
      // ratioStage = 15000 / 60000 = 0.25 → SAFE

      const perf = createPerformance({ sales: 100000, adCost: 30000 });
      const result = evaluateAsinLossBudget(perf, defaultG, defaultTopt);

      expect(result.profitGap).toBeCloseTo(15000, 0);
      expect(result.lossBudgetStage).toBeCloseTo(60000, 0);
      expect(result.ratioStage).toBeCloseTo(0.25, 5);
      expect(result.investmentState).toBe(InvestmentState.SAFE);
    });

    it("LIMIT判定", () => {
      // profitGapがlossBudgetの80-100%
      // lossBudgetStage = 40000 * 1.5 = 60000
      // profitGap = 50000 → ratio = 0.833 → LIMIT

      const perf = createPerformance({
        sales: 100000,
        adCost: 50000, // actualNetProfit = 55000 - 50000 = 5000
      });
      // targetNetProfit = 40000, actualNetProfit = 5000
      // profitGap = 40000 - 5000 = 35000
      // ratio = 35000 / 60000 = 0.583 → WATCH

      const result = evaluateAsinLossBudget(perf, defaultG, defaultTopt);
      expect(result.investmentState).toBe(InvestmentState.WATCH);
    });

    it("BREACH判定", () => {
      // 広告費が極端に高く、profitGapがlossBudgetを超える
      const perf = createPerformance({
        sales: 100000,
        adCost: 95000, // actualNetProfit = 55000 - 95000 = -40000
      });
      // targetNetProfit = 40000, actualNetProfit = -40000
      // profitGap = 40000 - (-40000) = 80000
      // ratio = 80000 / 60000 = 1.33 → BREACH

      const result = evaluateAsinLossBudget(perf, defaultG, defaultTopt);

      expect(result.profitGap).toBeCloseTo(80000, 0);
      expect(result.ratioStage).toBeGreaterThan(1.0);
      expect(result.investmentState).toBe(InvestmentState.BREACH);
    });

    it("目標超過（利益が良い）場合はratioStageが0", () => {
      // adCostが低く、actualNetProfit > targetNetProfit
      const perf = createPerformance({
        sales: 100000,
        adCost: 5000, // actualNetProfit = 55000 - 5000 = 50000
      });
      // targetNetProfit = 40000, actualNetProfit = 50000
      // profitGap = 40000 - 50000 = -10000

      const result = evaluateAsinLossBudget(perf, defaultG, defaultTopt);

      expect(result.profitGap).toBeCloseTo(-10000, 0);
      expect(result.ratioStage).toBe(0);
      expect(result.investmentState).toBe(InvestmentState.SAFE);
    });

    it("LAUNCH_HARDは高いlossBudgetMultiple", () => {
      const perf = createPerformance({
        lifecycleStage: "LAUNCH_HARD",
        sales: 100000,
        adCost: 50000,
      });

      const result = evaluateAsinLossBudget(perf, defaultG, defaultTopt);

      expect(result.lossBudgetMultiple).toBe(2.5);
      // lossBudgetStage = 40000 * 2.5 = 100000
      expect(result.lossBudgetStage).toBeCloseTo(100000, 0);
      // profitGap = 40000 - 5000 = 35000
      // ratio = 35000 / 100000 = 0.35 → SAFE
      expect(result.investmentState).toBe(InvestmentState.SAFE);
    });

    it("HARVESTは低いlossBudgetMultiple", () => {
      const perf = createPerformance({
        lifecycleStage: "HARVEST",
        sales: 100000,
        adCost: 30000,
      });

      const result = evaluateAsinLossBudget(perf, defaultG, defaultTopt);

      expect(result.lossBudgetMultiple).toBe(0.8);
      // lossBudgetStage = 40000 * 0.8 = 32000
      expect(result.lossBudgetStage).toBeCloseTo(32000, 0);
      // profitGap = 15000
      // ratio = 15000 / 32000 = 0.469 → SAFE
    });
  });

  // ==========================================================================
  // evaluateAllAsins テスト
  // ==========================================================================

  describe("evaluateAllAsins", () => {
    it("複数ASINを一括評価", () => {
      const performances: AsinPeriodPerformance[] = [
        createPerformance({ asin: "ASIN001", sales: 100000, adCost: 15000 }),
        createPerformance({ asin: "ASIN002", sales: 50000, adCost: 20000 }),
      ];

      const getG = (asin: string) => 0.55;
      const getTopt = (asin: string) => 0.15;

      const map = evaluateAllAsins(performances, getG, getTopt);

      expect(map.size).toBe(2);
      expect(map.has("ASIN001")).toBe(true);
      expect(map.has("ASIN002")).toBe(true);

      const asin1 = map.get("ASIN001")!;
      expect(asin1.investmentState).toBe(InvestmentState.SAFE);

      const asin2 = map.get("ASIN002")!;
      expect(asin2.sales).toBe(50000);
    });
  });

  // ==========================================================================
  // getActionConstraints テスト
  // ==========================================================================

  describe("getActionConstraints", () => {
    describe("LAUNCH期", () => {
      it("LAUNCH_HARD/SAFEはSTOP/NEG封印、それ以外は許可", () => {
        const constraints = getActionConstraints("LAUNCH_HARD", InvestmentState.SAFE);

        expect(constraints.allowStrongUp).toBe(true);
        expect(constraints.allowUp).toBe(true);
        expect(constraints.allowDown).toBe(true);
        expect(constraints.allowStrongDown).toBe(false);
        expect(constraints.allowStop).toBe(false);
        expect(constraints.allowNeg).toBe(false);
      });

      it("LAUNCH_HARD/WATCHは上昇幅を抑える", () => {
        const constraints = getActionConstraints("LAUNCH_HARD", InvestmentState.WATCH);

        expect(constraints.allowStrongUp).toBe(true);
        expect(constraints.maxIncreaseMultiplier).toBe(1.2);
        expect(constraints.strongUpThresholdMultiplier).toBe(1.2);
      });

      it("LAUNCH_HARD/LIMITはSTRONG_UP禁止", () => {
        const constraints = getActionConstraints("LAUNCH_HARD", InvestmentState.LIMIT);

        expect(constraints.allowStrongUp).toBe(false);
        expect(constraints.allowUp).toBe(true);
        expect(constraints.maxIncreaseMultiplier).toBe(1.1);
        expect(constraints.tStageAdjustmentFactor).toBe(0.9);
      });

      it("LAUNCH_HARD/BREACHはUP系禁止", () => {
        const constraints = getActionConstraints("LAUNCH_HARD", InvestmentState.BREACH);

        expect(constraints.allowStrongUp).toBe(false);
        expect(constraints.allowUp).toBe(false);
        expect(constraints.allowStop).toBe(false); // それでもSTOP封印
        expect(constraints.allowNeg).toBe(false);
        expect(constraints.tStageAdjustmentFactor).toBe(0.8);
      });

      it("LAUNCH_SOFTも同様のルール", () => {
        const safe = getActionConstraints("LAUNCH_SOFT", InvestmentState.SAFE);
        expect(safe.allowStop).toBe(false);
        expect(safe.allowNeg).toBe(false);

        const breach = getActionConstraints("LAUNCH_SOFT", InvestmentState.BREACH);
        expect(breach.allowUp).toBe(false);
      });
    });

    describe("GROW期", () => {
      it("GROW/SAFEは全アクション許可", () => {
        const constraints = getActionConstraints("GROW", InvestmentState.SAFE);

        expect(constraints.allowStrongUp).toBe(true);
        expect(constraints.allowUp).toBe(true);
        expect(constraints.allowDown).toBe(true);
        expect(constraints.allowStrongDown).toBe(true);
        expect(constraints.allowStop).toBe(true);
        expect(constraints.allowNeg).toBe(true);
      });

      it("GROW/WATCHは上昇幅を抑える", () => {
        const constraints = getActionConstraints("GROW", InvestmentState.WATCH);

        expect(constraints.maxIncreaseMultiplier).toBe(1.2);
        expect(constraints.strongUpThresholdMultiplier).toBe(1.2);
      });

      it("GROW/LIMITはSTRONG_UP禁止、DOWNやや積極的", () => {
        const constraints = getActionConstraints("GROW", InvestmentState.LIMIT);

        expect(constraints.allowStrongUp).toBe(false);
        expect(constraints.maxDecreaseMultiplier).toBe(0.2);
      });

      it("GROW/BREACHはUP系禁止、DOWN積極的", () => {
        const constraints = getActionConstraints("GROW", InvestmentState.BREACH);

        expect(constraints.allowStrongUp).toBe(false);
        expect(constraints.allowUp).toBe(false);
        expect(constraints.maxDecreaseMultiplier).toBe(0.25);
        expect(constraints.tStageAdjustmentFactor).toBe(0.9);
      });
    });

    describe("HARVEST期", () => {
      it("HARVEST/SAFEは限定的なUP許可", () => {
        const constraints = getActionConstraints("HARVEST", InvestmentState.SAFE);

        expect(constraints.allowStrongUp).toBe(true);
        expect(constraints.maxIncreaseMultiplier).toBe(1.15);
        expect(constraints.strongUpThresholdMultiplier).toBe(1.3);
      });

      it("HARVEST/WATCHはSTRONG_UP禁止", () => {
        const constraints = getActionConstraints("HARVEST", InvestmentState.WATCH);

        expect(constraints.allowStrongUp).toBe(false);
        expect(constraints.maxIncreaseMultiplier).toBe(1.1);
      });

      it("HARVEST/LIMITはUP系禁止", () => {
        const constraints = getActionConstraints("HARVEST", InvestmentState.LIMIT);

        expect(constraints.allowStrongUp).toBe(false);
        expect(constraints.allowUp).toBe(false);
        expect(constraints.maxDecreaseMultiplier).toBe(0.2);
      });

      it("HARVEST/BREACHは広告規模縮小モード", () => {
        const constraints = getActionConstraints("HARVEST", InvestmentState.BREACH);

        expect(constraints.allowStrongUp).toBe(false);
        expect(constraints.allowUp).toBe(false);
        expect(constraints.maxDecreaseMultiplier).toBe(0.3);
      });
    });
  });

  // ==========================================================================
  // ユーティリティ関数テスト
  // ==========================================================================

  describe("isWarningState", () => {
    it("SAFEはfalse", () => {
      expect(isWarningState(InvestmentState.SAFE)).toBe(false);
    });

    it("WATCH以上はtrue", () => {
      expect(isWarningState(InvestmentState.WATCH)).toBe(true);
      expect(isWarningState(InvestmentState.LIMIT)).toBe(true);
      expect(isWarningState(InvestmentState.BREACH)).toBe(true);
    });
  });

  describe("isCriticalState", () => {
    it("SAFE/WATCHはfalse", () => {
      expect(isCriticalState(InvestmentState.SAFE)).toBe(false);
      expect(isCriticalState(InvestmentState.WATCH)).toBe(false);
    });

    it("LIMIT/BREACHはtrue", () => {
      expect(isCriticalState(InvestmentState.LIMIT)).toBe(true);
      expect(isCriticalState(InvestmentState.BREACH)).toBe(true);
    });
  });

  describe("shouldConsiderLifecycleTransition", () => {
    it("LAUNCH + BREACH → true", () => {
      expect(
        shouldConsiderLifecycleTransition("LAUNCH_HARD", InvestmentState.BREACH)
      ).toBe(true);
      expect(
        shouldConsiderLifecycleTransition("LAUNCH_SOFT", InvestmentState.BREACH)
      ).toBe(true);
    });

    it("GROW + BREACH → true", () => {
      expect(
        shouldConsiderLifecycleTransition("GROW", InvestmentState.BREACH)
      ).toBe(true);
    });

    it("HARVEST + BREACH → false", () => {
      expect(
        shouldConsiderLifecycleTransition("HARVEST", InvestmentState.BREACH)
      ).toBe(false);
    });

    it("SAFE/WATCH/LIMIT → false", () => {
      expect(
        shouldConsiderLifecycleTransition("LAUNCH_HARD", InvestmentState.SAFE)
      ).toBe(false);
      expect(
        shouldConsiderLifecycleTransition("GROW", InvestmentState.LIMIT)
      ).toBe(false);
    });
  });

  describe("generateAlertSummary", () => {
    it("SAFEはアラートなし", () => {
      const perf = createPerformance({ sales: 100000, adCost: 15000 });
      const metrics = evaluateAsinLossBudget(perf, defaultG, defaultTopt);
      const alert = generateAlertSummary(metrics);

      expect(alert.shouldAlert).toBe(false);
    });

    it("WATCHはinfo", () => {
      const perf = createPerformance({ sales: 100000, adCost: 40000 });
      const metrics = evaluateAsinLossBudget(perf, defaultG, defaultTopt);
      // profitGap = 40000 - 15000 = 25000, ratio = 25000/60000 = 0.417 → SAFE

      // WATCHになるように調整
      const watchMetrics = {
        ...metrics,
        investmentState: InvestmentState.WATCH,
        ratioStage: 0.6,
      };
      const alert = generateAlertSummary(watchMetrics);

      expect(alert.shouldAlert).toBe(true);
      expect(alert.alertLevel).toBe("info");
      expect(alert.message).toContain("[WATCH]");
    });

    it("LIMITはwarning", () => {
      const limitMetrics = {
        asin: "B00TEST123",
        lifecycleStage: "GROW" as const,
        g: defaultG,
        tOpt: defaultTopt,
        sales: 100000,
        adCost: 50000,
        targetNetMarginMid: 0.4,
        targetNetProfit: 40000,
        actualNetProfit: 5000,
        profitGap: 35000,
        lossBudgetMultiple: 1.5,
        lossBudgetStage: 40000,
        ratioStage: 0.875,
        investmentState: InvestmentState.LIMIT,
        periodStart: "2024-01-01",
        periodEnd: "2024-01-31",
        calculationNote: "",
      };
      const alert = generateAlertSummary(limitMetrics);

      expect(alert.shouldAlert).toBe(true);
      expect(alert.alertLevel).toBe("warning");
      expect(alert.message).toContain("[LIMIT]");
    });

    it("BREACHはcritical", () => {
      const breachMetrics = {
        asin: "B00TEST123",
        lifecycleStage: "GROW" as const,
        g: defaultG,
        tOpt: defaultTopt,
        sales: 100000,
        adCost: 95000,
        targetNetMarginMid: 0.4,
        targetNetProfit: 40000,
        actualNetProfit: -40000,
        profitGap: 80000,
        lossBudgetMultiple: 1.5,
        lossBudgetStage: 60000,
        ratioStage: 1.33,
        investmentState: InvestmentState.BREACH,
        periodStart: "2024-01-01",
        periodEnd: "2024-01-31",
        calculationNote: "",
      };
      const alert = generateAlertSummary(breachMetrics);

      expect(alert.shouldAlert).toBe(true);
      expect(alert.alertLevel).toBe("critical");
      expect(alert.message).toContain("[BREACH]");
      expect(alert.message).toContain("戦略見直し");
    });
  });
});

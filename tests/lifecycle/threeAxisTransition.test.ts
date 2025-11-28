/**
 * 三軸ライフサイクル遷移判定 テスト
 */

import {
  ThreeAxisTransitionInput,
  ThreeAxisTransitionConfig,
  ThreeAxisTransitionResult,
  DEFAULT_THREE_AXIS_TRANSITION_CONFIG,
  evaluateThreeAxisTransition,
  generateThreeAxisAlertSummary,
} from "../../src/lifecycle/seo-launch-evaluator";
import {
  LossBudgetSummary,
  createLossBudgetSummary,
} from "../../src/analytics/lossBudgetEvaluator";

describe("evaluateThreeAxisTransition", () => {
  const createTestInput = (
    overrides: Partial<ThreeAxisTransitionInput> = {}
  ): ThreeAxisTransitionInput => ({
    asin: "TEST_ASIN",
    currentStage: "LAUNCH_HARD",
    seoCompletionRatio: 0.3,
    minDaysSatisfied: false,
    sampleEnough: false,
    lossBudgetSummary: createLossBudgetSummary(
      "TEST_ASIN",
      0.3,
      0.3,
      0.3,
      "2024-01-01",
      "2024-01-30"
    ),
    ...overrides,
  });

  describe("Non-LAUNCH stage handling", () => {
    it("should return CONTINUE_LAUNCH for GROW stage", () => {
      const input = createTestInput({ currentStage: "GROW" });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(false);
      expect(result.nextStage).toBe("GROW");
      expect(result.reasonCode).toBe("CONTINUE_LAUNCH");
    });

    it("should return CONTINUE_LAUNCH for HARVEST stage", () => {
      const input = createTestInput({ currentStage: "HARVEST" });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(false);
      expect(result.nextStage).toBe("HARVEST");
      expect(result.reasonCode).toBe("CONTINUE_LAUNCH");
    });
  });

  describe("Emergency stop (C-axis CRITICAL)", () => {
    it("should trigger emergency stop when lossBudgetConsumptionLaunch exceeds critical threshold", () => {
      const input = createTestInput({
        lossBudgetSummary: createLossBudgetSummary(
          "TEST_ASIN",
          0.3,
          0.95, // >= 0.9 critical threshold
          0.3,
          "2024-01-01",
          "2024-01-30"
        ),
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(true);
      expect(result.nextStage).toBe("GROW");
      expect(result.reasonCode).toBe("LOSS_BUDGET_EMERGENCY");
      expect(result.isEmergencyStop).toBe(true);
      expect(result.axisEvaluation.emergencyStop).toBe(true);
    });

    it("should trigger emergency stop when launchInvestUsageRatio exceeds critical threshold", () => {
      const input = createTestInput({
        lossBudgetSummary: createLossBudgetSummary(
          "TEST_ASIN",
          0.3,
          0.3,
          1.1, // >= 1.0 launchInvest critical threshold
          "2024-01-01",
          "2024-01-30"
        ),
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(true);
      expect(result.nextStage).toBe("GROW");
      expect(result.reasonCode).toBe("LOSS_BUDGET_EMERGENCY");
      expect(result.isEmergencyStop).toBe(true);
    });
  });

  describe("Normal completion (A+B both met)", () => {
    it("should trigger normal completion when SEO and trial conditions are met", () => {
      const input = createTestInput({
        seoCompletionRatio: 0.75, // >= 0.7 threshold
        minDaysSatisfied: true,
        sampleEnough: true,
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(true);
      expect(result.nextStage).toBe("GROW");
      expect(result.reasonCode).toBe("NORMAL_COMPLETION");
      expect(result.isEmergencyStop).toBe(false);
      expect(result.axisEvaluation.seoConditionMet).toBe(true);
      expect(result.axisEvaluation.trialConditionMet).toBe(true);
    });

    it("should not trigger when only SEO condition is met", () => {
      const input = createTestInput({
        seoCompletionRatio: 0.75,
        minDaysSatisfied: false,
        sampleEnough: true,
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(false);
      expect(result.reasonCode).toBe("CONTINUE_LAUNCH");
    });

    it("should not trigger when only trial condition is met", () => {
      const input = createTestInput({
        seoCompletionRatio: 0.5, // < 0.7
        minDaysSatisfied: true,
        sampleEnough: true,
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(false);
      expect(result.reasonCode).toBe("CONTINUE_LAUNCH");
    });
  });

  describe("Early exit (C-axis WARNING + A-axis partial)", () => {
    it("should trigger early exit when WARNING and SEO partially met", () => {
      const input = createTestInput({
        seoCompletionRatio: 0.45, // >= 0.4 warning threshold
        minDaysSatisfied: false,
        sampleEnough: false,
        lossBudgetSummary: createLossBudgetSummary(
          "TEST_ASIN",
          0.6, // >= 0.5 warning threshold
          0.3,
          0.3,
          "2024-01-01",
          "2024-01-30"
        ),
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(true);
      expect(result.nextStage).toBe("GROW");
      expect(result.reasonCode).toBe("LOSS_BUDGET_EARLY_EXIT");
      expect(result.isEmergencyStop).toBe(false);
      expect(result.axisEvaluation.warningZone).toBe(true);
    });

    it("should not trigger early exit when WARNING but SEO not partially met", () => {
      const input = createTestInput({
        seoCompletionRatio: 0.3, // < 0.4 warning threshold
        lossBudgetSummary: createLossBudgetSummary(
          "TEST_ASIN",
          0.6,
          0.3,
          0.3,
          "2024-01-01",
          "2024-01-30"
        ),
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(false);
      expect(result.reasonCode).toBe("CONTINUE_LAUNCH");
    });
  });

  describe("Continue LAUNCH", () => {
    it("should continue when no conditions are met", () => {
      const input = createTestInput({
        seoCompletionRatio: 0.3,
        minDaysSatisfied: false,
        sampleEnough: false,
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(false);
      expect(result.nextStage).toBe("LAUNCH_HARD");
      expect(result.reasonCode).toBe("CONTINUE_LAUNCH");
      expect(result.reasonMessage).toContain("LAUNCH継続");
    });

    it("should include missing conditions in reason message", () => {
      const input = createTestInput({
        seoCompletionRatio: 0.3,
        minDaysSatisfied: false,
        sampleEnough: true,
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.reasonMessage).toContain("SEO完了率");
      expect(result.reasonMessage).toContain("最低日数未達");
    });
  });

  describe("LAUNCH_SOFT stage", () => {
    it("should apply same logic for LAUNCH_SOFT", () => {
      const input = createTestInput({
        currentStage: "LAUNCH_SOFT",
        seoCompletionRatio: 0.75,
        minDaysSatisfied: true,
        sampleEnough: true,
      });
      const result = evaluateThreeAxisTransition(input);

      expect(result.shouldTransition).toBe(true);
      expect(result.nextStage).toBe("GROW");
      expect(result.reasonCode).toBe("NORMAL_COMPLETION");
    });
  });

  describe("Custom config", () => {
    it("should use custom thresholds", () => {
      const customConfig: ThreeAxisTransitionConfig = {
        seoCompletionThreshold: 0.5,
        seoCompletionWarningThreshold: 0.2,
        lossBudgetStateConfig: {
          warningThreshold: 0.3,
          criticalThreshold: 0.6,
          launchInvestWarningThreshold: 0.3,
          launchInvestCriticalThreshold: 0.6,
        },
      };

      const input = createTestInput({
        seoCompletionRatio: 0.55,
        minDaysSatisfied: true,
        sampleEnough: true,
      });
      const result = evaluateThreeAxisTransition(input, customConfig);

      expect(result.shouldTransition).toBe(true);
      expect(result.reasonCode).toBe("NORMAL_COMPLETION");
    });
  });
});

describe("generateThreeAxisAlertSummary", () => {
  it("should return critical alert for emergency stop", () => {
    const result: ThreeAxisTransitionResult = {
      asin: "TEST_ASIN",
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "LOSS_BUDGET_EMERGENCY",
      reasonMessage: "Emergency stop message",
      isEmergencyStop: true,
      axisEvaluation: {
        seoConditionMet: false,
        trialConditionMet: false,
        lossBudgetState: "CRITICAL",
        emergencyStop: true,
        warningZone: false,
      },
    };
    const alert = generateThreeAxisAlertSummary(result);

    expect(alert.shouldAlert).toBe(true);
    expect(alert.alertLevel).toBe("critical");
    expect(alert.message).toContain("緊急終了");
  });

  it("should return warning alert for early exit", () => {
    const result: ThreeAxisTransitionResult = {
      asin: "TEST_ASIN",
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "LOSS_BUDGET_EARLY_EXIT",
      reasonMessage: "Early exit message",
      isEmergencyStop: false,
      axisEvaluation: {
        seoConditionMet: false,
        trialConditionMet: false,
        lossBudgetState: "WARNING",
        emergencyStop: false,
        warningZone: true,
      },
    };
    const alert = generateThreeAxisAlertSummary(result);

    expect(alert.shouldAlert).toBe(true);
    expect(alert.alertLevel).toBe("warning");
    expect(alert.message).toContain("早期終了");
  });

  it("should return info alert for normal completion", () => {
    const result: ThreeAxisTransitionResult = {
      asin: "TEST_ASIN",
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "NORMAL_COMPLETION",
      reasonMessage: "Normal completion message",
      isEmergencyStop: false,
      axisEvaluation: {
        seoConditionMet: true,
        trialConditionMet: true,
        lossBudgetState: "SAFE",
        emergencyStop: false,
        warningZone: false,
      },
    };
    const alert = generateThreeAxisAlertSummary(result);

    expect(alert.shouldAlert).toBe(true);
    expect(alert.alertLevel).toBe("info");
    expect(alert.message).toContain("通常終了");
  });

  it("should return warning alert for continue with warning zone", () => {
    const result: ThreeAxisTransitionResult = {
      asin: "TEST_ASIN",
      shouldTransition: false,
      nextStage: "LAUNCH_HARD",
      reasonCode: "CONTINUE_LAUNCH",
      reasonMessage: "Continue message",
      isEmergencyStop: false,
      axisEvaluation: {
        seoConditionMet: false,
        trialConditionMet: false,
        lossBudgetState: "WARNING",
        emergencyStop: false,
        warningZone: true,
      },
    };
    const alert = generateThreeAxisAlertSummary(result);

    expect(alert.shouldAlert).toBe(true);
    expect(alert.alertLevel).toBe("warning");
    expect(alert.message).toContain("WARNING");
  });

  it("should not alert for normal continue", () => {
    const result: ThreeAxisTransitionResult = {
      asin: "TEST_ASIN",
      shouldTransition: false,
      nextStage: "LAUNCH_HARD",
      reasonCode: "CONTINUE_LAUNCH",
      reasonMessage: "Continue message",
      isEmergencyStop: false,
      axisEvaluation: {
        seoConditionMet: false,
        trialConditionMet: false,
        lossBudgetState: "SAFE",
        emergencyStop: false,
        warningZone: false,
      },
    };
    const alert = generateThreeAxisAlertSummary(result);

    expect(alert.shouldAlert).toBe(false);
  });
});

/**
 * LossBudgetSummary / LossBudgetState テスト
 */

import {
  LossBudgetState,
  LossBudgetSummary,
  LossBudgetStateConfig,
  DEFAULT_LOSS_BUDGET_STATE_CONFIG,
  resolveLossBudgetState,
  createLossBudgetSummary,
  isLossBudgetCritical,
  isLossBudgetWarningOrCritical,
  investmentStateToLossBudgetState,
  InvestmentState,
} from "../../src/analytics/lossBudgetEvaluator";

describe("LossBudgetState", () => {
  describe("resolveLossBudgetState", () => {
    const config = DEFAULT_LOSS_BUDGET_STATE_CONFIG;

    it("should return SAFE when all consumptions are below warning threshold", () => {
      const result = resolveLossBudgetState(0.3, 0.2, 0.4, config);
      expect(result).toBe("SAFE");
    });

    it("should return WARNING when rolling consumption exceeds warning threshold", () => {
      const result = resolveLossBudgetState(0.6, 0.2, 0.3, config);
      expect(result).toBe("WARNING");
    });

    it("should return WARNING when launch consumption exceeds warning threshold", () => {
      const result = resolveLossBudgetState(0.3, 0.7, 0.3, config);
      expect(result).toBe("WARNING");
    });

    it("should return WARNING when launchInvestUsage exceeds launchInvestWarningThreshold", () => {
      const result = resolveLossBudgetState(0.3, 0.3, 0.6, config);
      expect(result).toBe("WARNING");
    });

    it("should return CRITICAL when rolling consumption exceeds critical threshold", () => {
      const result = resolveLossBudgetState(0.95, 0.3, 0.3, config);
      expect(result).toBe("CRITICAL");
    });

    it("should return CRITICAL when launch consumption exceeds critical threshold", () => {
      const result = resolveLossBudgetState(0.3, 0.92, 0.3, config);
      expect(result).toBe("CRITICAL");
    });

    it("should return CRITICAL when launchInvestUsage exceeds launchInvestCriticalThreshold", () => {
      const result = resolveLossBudgetState(0.3, 0.3, 1.1, config);
      expect(result).toBe("CRITICAL");
    });

    it("should handle zero values", () => {
      const result = resolveLossBudgetState(0, 0, 0, config);
      expect(result).toBe("SAFE");
    });

    it("should handle undefined/NaN values by treating them as 0", () => {
      const result = resolveLossBudgetState(NaN, undefined as unknown as number, 0.3, config);
      expect(result).toBe("SAFE");
    });

    it("should use custom config thresholds", () => {
      const customConfig: LossBudgetStateConfig = {
        warningThreshold: 0.3,
        criticalThreshold: 0.6,
        launchInvestWarningThreshold: 0.3,
        launchInvestCriticalThreshold: 0.6,
      };
      const result = resolveLossBudgetState(0.4, 0.2, 0.2, customConfig);
      expect(result).toBe("WARNING");
    });
  });

  describe("createLossBudgetSummary", () => {
    it("should create a valid LossBudgetSummary", () => {
      const summary = createLossBudgetSummary(
        "ASIN123",
        0.3,
        0.2,
        0.4,
        "2024-01-01",
        "2024-01-30"
      );

      expect(summary.asin).toBe("ASIN123");
      expect(summary.lossBudgetConsumptionRolling).toBe(0.3);
      expect(summary.lossBudgetConsumptionLaunch).toBe(0.2);
      expect(summary.launchInvestUsageRatio).toBe(0.4);
      expect(summary.state).toBe("SAFE");
      expect(summary.maxConsumption).toBe(0.4);
      expect(summary.periodStart).toBe("2024-01-01");
      expect(summary.periodEnd).toBe("2024-01-30");
    });

    it("should calculate correct state based on consumptions", () => {
      const warningSummary = createLossBudgetSummary(
        "ASIN456",
        0.6,
        0.2,
        0.3,
        "2024-01-01",
        "2024-01-30"
      );
      expect(warningSummary.state).toBe("WARNING");

      const criticalSummary = createLossBudgetSummary(
        "ASIN789",
        0.95,
        0.2,
        0.3,
        "2024-01-01",
        "2024-01-30"
      );
      expect(criticalSummary.state).toBe("CRITICAL");
    });

    it("should handle zero values", () => {
      const summary = createLossBudgetSummary(
        "ASIN000",
        0,
        0,
        0,
        "2024-01-01",
        "2024-01-30"
      );
      expect(summary.state).toBe("SAFE");
      expect(summary.maxConsumption).toBe(0);
    });
  });

  describe("isLossBudgetCritical", () => {
    it("should return true for CRITICAL state", () => {
      expect(isLossBudgetCritical("CRITICAL")).toBe(true);
    });

    it("should return false for WARNING state", () => {
      expect(isLossBudgetCritical("WARNING")).toBe(false);
    });

    it("should return false for SAFE state", () => {
      expect(isLossBudgetCritical("SAFE")).toBe(false);
    });
  });

  describe("isLossBudgetWarningOrCritical", () => {
    it("should return true for CRITICAL state", () => {
      expect(isLossBudgetWarningOrCritical("CRITICAL")).toBe(true);
    });

    it("should return true for WARNING state", () => {
      expect(isLossBudgetWarningOrCritical("WARNING")).toBe(true);
    });

    it("should return false for SAFE state", () => {
      expect(isLossBudgetWarningOrCritical("SAFE")).toBe(false);
    });
  });

  describe("investmentStateToLossBudgetState", () => {
    it("should convert SAFE to SAFE", () => {
      expect(investmentStateToLossBudgetState(InvestmentState.SAFE)).toBe("SAFE");
    });

    it("should convert WATCH to WARNING", () => {
      expect(investmentStateToLossBudgetState(InvestmentState.WATCH)).toBe("WARNING");
    });

    it("should convert LIMIT to WARNING", () => {
      expect(investmentStateToLossBudgetState(InvestmentState.LIMIT)).toBe("WARNING");
    });

    it("should convert BREACH to CRITICAL", () => {
      expect(investmentStateToLossBudgetState(InvestmentState.BREACH)).toBe("CRITICAL");
    });
  });
});

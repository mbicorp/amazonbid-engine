/**
 * 係数計算ロジックのテスト
 */

import {
  calculatePhaseCoeff,
  calculateCVRCoeff,
  calculateRankGapCoeff,
  calculateCompetitorCoeff,
  calculateBrandCoeff,
  calculateStatsCoeff,
  calculateTOSCoeff,
  calculateAllCoefficients,
} from "../coefficients";
import { KeywordMetrics, GlobalConfig, ActionType } from "../types";

describe("coefficients", () => {
  const defaultConfig: GlobalConfig = {
    mode: "NORMAL",
    manual_mode: false,
    max_change_rate_normal: 0.6,
    max_change_rate_smode_default: 1.5,
    max_change_rate_smode_tos: 2.0,
    min_clicks_for_decision: 5,
    min_clicks_for_confident: 20,
    min_clicks_for_tos: 40,
    acos_hard_stop_multiplier: 3.0,
    acos_soft_down_multiplier: 1.5,
    currency: "JPY",
  };

  const createMetrics = (overrides: Partial<KeywordMetrics> = {}): KeywordMetrics => ({
    keyword_id: "kw001",
    campaign_id: "camp001",
    ad_group_id: "ag001",
    phase_type: "NORMAL",
    brand_type: "GENERIC",
    score_rank: "A",
    current_bid: 150,
    baseline_cpc: 120,
    acos_target: 0.2,
    acos_actual: 0.18,
    cvr_recent: 0.05,
    cvr_baseline: 0.05,
    ctr_recent: 0.02,
    ctr_baseline: 0.02,
    clicks_1h: 10,
    clicks_3h: 30,
    impressions_1h: 500,
    impressions_3h: 1500,
    rank_current: 5,
    rank_target: 3,
    competitor_cpc_current: 160,
    competitor_cpc_baseline: 150,
    comp_strength: 0.5,
    risk_penalty: 0.1,
    priority_score: 0.8,
    tos_ctr_mult: 1.2,
    tos_cvr_mult: 1.3,
    tos_gap_cpc: 20,
    campaign_budget_remaining: 50000,
    expected_clicks_3h: 35,
    time_in_phase_minutes: 120,
    ...overrides,
  });

  describe("calculatePhaseCoeff", () => {
    it("should return 1.0 for NORMAL mode", () => {
      expect(calculatePhaseCoeff("NORMAL", "NORMAL")).toBe(1.0);
      expect(calculatePhaseCoeff("S_PRE1", "NORMAL")).toBe(1.0);
    });

    it("should return phase-specific coefficients for S_MODE", () => {
      expect(calculatePhaseCoeff("NORMAL", "S_MODE")).toBe(1.0);
      expect(calculatePhaseCoeff("S_PRE1", "S_MODE")).toBe(1.2);
      expect(calculatePhaseCoeff("S_PRE2", "S_MODE")).toBe(1.5);
      expect(calculatePhaseCoeff("S_FREEZE", "S_MODE")).toBe(0.0);
      expect(calculatePhaseCoeff("S_NORMAL", "S_MODE")).toBe(1.3);
      expect(calculatePhaseCoeff("S_FINAL", "S_MODE")).toBe(1.8);
      expect(calculatePhaseCoeff("S_REVERT", "S_MODE")).toBe(0.8);
    });
  });

  describe("calculateCVRCoeff", () => {
    it("should return 1.0 when baseline is 0", () => {
      expect(calculateCVRCoeff(0.05, 0, "NORMAL", "STRONG_UP")).toBe(1.0);
    });

    it("should return higher coefficient for significant CVR boost in NORMAL mode", () => {
      // 40% boost
      const coeff = calculateCVRCoeff(0.07, 0.05, "NORMAL", "STRONG_UP");
      expect(coeff).toBe(1.15);
    });

    it("should return lower coefficient for CVR decline in NORMAL mode", () => {
      // -40% decline
      const coeff = calculateCVRCoeff(0.03, 0.05, "NORMAL", "MILD_DOWN");
      expect(coeff).toBe(0.85);
    });

    it("should return more aggressive coefficients for S_MODE", () => {
      // 50% boost in S_MODE
      const coeff = calculateCVRCoeff(0.075, 0.05, "S_MODE", "STRONG_UP");
      expect(coeff).toBe(1.5);
    });
  });

  describe("calculateRankGapCoeff", () => {
    it("should return 1.0 when rank is null", () => {
      expect(calculateRankGapCoeff(null, 3, "STRONG_UP")).toBe(1.0);
      expect(calculateRankGapCoeff(5, null, "STRONG_UP")).toBe(1.0);
    });

    it("should return higher coefficient for large gap with UP action", () => {
      // Current rank 10, target 3 = gap of 7
      expect(calculateRankGapCoeff(10, 3, "STRONG_UP")).toBe(1.3);
    });

    it("should return coefficient for medium gap", () => {
      // Current rank 6, target 3 = gap of 3
      expect(calculateRankGapCoeff(6, 3, "MILD_UP")).toBe(1.2);
    });

    it("should handle negative gap for DOWN actions", () => {
      // Current rank 2, target 5 = gap of -3
      expect(calculateRankGapCoeff(2, 5, "MILD_DOWN")).toBe(1.15);
    });
  });

  describe("calculateCompetitorCoeff", () => {
    it("should return 1.0 when competitor CPC baseline is 0", () => {
      expect(calculateCompetitorCoeff(180, 0, 0.7, "STRONG_UP")).toBe(1.0);
    });

    it("should return higher coefficient when competitor CPC increased significantly", () => {
      // CPC ratio = 180/150 = 1.2, comp_strength = 0.7
      expect(calculateCompetitorCoeff(180, 150, 0.7, "STRONG_UP")).toBe(1.25);
    });

    it("should return coefficient for DOWN actions when competitor CPC decreased", () => {
      // CPC ratio = 130/150 = 0.87
      expect(calculateCompetitorCoeff(130, 150, 0.5, "MILD_DOWN")).toBe(1.1);
    });
  });

  describe("calculateBrandCoeff", () => {
    it("should return 1.0 for GENERIC brand type", () => {
      expect(calculateBrandCoeff("GENERIC", "STRONG_UP")).toBe(1.0);
    });

    it("should return higher coefficient for BRAND with UP action", () => {
      expect(calculateBrandCoeff("BRAND", "STRONG_UP")).toBe(1.2);
    });

    it("should return lower coefficient for BRAND with DOWN action", () => {
      expect(calculateBrandCoeff("BRAND", "MILD_DOWN")).toBe(0.8);
    });

    it("should return 0.9 for CONQUEST with STRONG_UP", () => {
      expect(calculateBrandCoeff("CONQUEST", "STRONG_UP")).toBe(0.9);
    });
  });

  describe("calculateStatsCoeff", () => {
    it("should return 0.5 for insufficient data", () => {
      expect(calculateStatsCoeff(3, defaultConfig, "STRONG_UP")).toBe(0.5);
    });

    it("should return 0.7 for low confidence strong actions", () => {
      expect(calculateStatsCoeff(10, defaultConfig, "STRONG_UP")).toBe(0.7);
    });

    it("should return 0.85 for low confidence mild actions", () => {
      expect(calculateStatsCoeff(10, defaultConfig, "MILD_UP")).toBe(0.85);
    });

    it("should return 1.1 for high confidence", () => {
      expect(calculateStatsCoeff(50, defaultConfig, "MILD_UP")).toBe(1.1);
    });
  });

  describe("calculateTOSCoeff", () => {
    it("should return 1.0 when not TOS targeted", () => {
      const metrics = createMetrics();
      expect(calculateTOSCoeff(metrics, defaultConfig, false, "STRONG_UP")).toBe(1.0);
    });

    it("should return 1.0 for NORMAL mode", () => {
      const metrics = createMetrics({ tos_ctr_mult: 1.8, tos_cvr_mult: 1.5 });
      expect(calculateTOSCoeff(metrics, defaultConfig, true, "STRONG_UP")).toBe(1.0);
    });

    it("should return high coefficient for S_MODE with high TOS value", () => {
      const smodeConfig = { ...defaultConfig, mode: "S_MODE" as const };
      const metrics = createMetrics({ tos_ctr_mult: 1.5, tos_cvr_mult: 1.5 }); // TOS value = 2.25
      expect(calculateTOSCoeff(metrics, smodeConfig, true, "STRONG_UP")).toBe(1.8);
    });
  });

  describe("calculateAllCoefficients", () => {
    it("should return all coefficients", () => {
      const metrics = createMetrics();
      const coefficients = calculateAllCoefficients(metrics, defaultConfig, "MILD_UP", false);

      expect(coefficients).toHaveProperty("phase_coeff");
      expect(coefficients).toHaveProperty("cvr_coeff");
      expect(coefficients).toHaveProperty("rank_gap_coeff");
      expect(coefficients).toHaveProperty("competitor_coeff");
      expect(coefficients).toHaveProperty("brand_coeff");
      expect(coefficients).toHaveProperty("stats_coeff");
      expect(coefficients).toHaveProperty("tos_coeff");
    });

    it("should return numeric values for all coefficients", () => {
      const metrics = createMetrics();
      const coefficients = calculateAllCoefficients(metrics, defaultConfig, "MILD_UP", false);

      Object.values(coefficients).forEach((value) => {
        expect(typeof value).toBe("number");
        expect(isNaN(value)).toBe(false);
      });
    });
  });
});

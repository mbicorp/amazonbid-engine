/**
 * アクション決定ロジックのテスト
 */

import {
  getBaseChangeRate,
  calculateCVRBoost,
  calculateACOSDiff,
  determineAction,
  adjustActionForBrandOwn,
} from "../action-logic";
import { KeywordMetrics, GlobalConfig, ScoreRank, ActionType } from "../types";

describe("action-logic", () => {
  // テスト用のデフォルト設定
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

  // テスト用のデフォルトメトリクス
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

  describe("getBaseChangeRate", () => {
    it("should return correct base change rate for S rank STRONG_UP", () => {
      expect(getBaseChangeRate("S", "STRONG_UP")).toBe(0.5);
    });

    it("should return correct base change rate for A rank MILD_UP", () => {
      expect(getBaseChangeRate("A", "MILD_UP")).toBe(0.25);
    });

    it("should return 0 for KEEP action", () => {
      expect(getBaseChangeRate("S", "KEEP")).toBe(0);
      expect(getBaseChangeRate("A", "KEEP")).toBe(0);
      expect(getBaseChangeRate("B", "KEEP")).toBe(0);
      expect(getBaseChangeRate("C", "KEEP")).toBe(0);
    });

    it("should return -1.0 for STOP action", () => {
      expect(getBaseChangeRate("S", "STOP")).toBe(-1.0);
      expect(getBaseChangeRate("C", "STOP")).toBe(-1.0);
    });

    it("should return higher absolute values for lower ranks on down actions", () => {
      const sRankDown = Math.abs(getBaseChangeRate("S", "STRONG_DOWN"));
      const cRankDown = Math.abs(getBaseChangeRate("C", "STRONG_DOWN"));
      expect(cRankDown).toBeGreaterThan(sRankDown);
    });
  });

  describe("calculateCVRBoost", () => {
    it("should return 0 when baseline is 0", () => {
      expect(calculateCVRBoost(0.05, 0)).toBe(0);
    });

    it("should calculate positive boost correctly", () => {
      // 10% increase: (0.055 - 0.05) / 0.05 = 0.1
      expect(calculateCVRBoost(0.055, 0.05)).toBeCloseTo(0.1);
    });

    it("should calculate negative boost correctly", () => {
      // 20% decrease: (0.04 - 0.05) / 0.05 = -0.2
      expect(calculateCVRBoost(0.04, 0.05)).toBeCloseTo(-0.2);
    });

    it("should return 0 when recent equals baseline", () => {
      expect(calculateCVRBoost(0.05, 0.05)).toBe(0);
    });
  });

  describe("calculateACOSDiff", () => {
    it("should calculate positive diff when actual > target", () => {
      expect(calculateACOSDiff(0.25, 0.2)).toBeCloseTo(0.05);
    });

    it("should calculate negative diff when actual < target", () => {
      expect(calculateACOSDiff(0.15, 0.2)).toBeCloseTo(-0.05);
    });

    it("should return 0 when actual equals target", () => {
      expect(calculateACOSDiff(0.2, 0.2)).toBe(0);
    });
  });

  describe("determineAction", () => {
    it("should return KEEP when clicks are below minimum", () => {
      const metrics = createMetrics({ clicks_3h: 2 });
      expect(determineAction(metrics, defaultConfig)).toBe("KEEP");
    });

    it("should return STOP when ACOS exceeds hard stop threshold", () => {
      // ACOS target = 0.2, multiplier = 3.0, so threshold = 0.6
      const metrics = createMetrics({
        acos_actual: 0.65,
        acos_target: 0.2,
        clicks_3h: 30,
      });
      expect(determineAction(metrics, defaultConfig)).toBe("STOP");
    });

    it("should return STRONG_DOWN when ACOS exceeds soft down threshold", () => {
      // ACOS target = 0.2, multiplier = 1.5, so threshold = 0.3
      const metrics = createMetrics({
        acos_actual: 0.35,
        acos_target: 0.2,
        clicks_3h: 30,
      });
      expect(determineAction(metrics, defaultConfig)).toBe("STRONG_DOWN");
    });

    it("should return STRONG_UP for S rank with significant CVR boost", () => {
      const metrics = createMetrics({
        score_rank: "S",
        cvr_recent: 0.08,
        cvr_baseline: 0.05, // 60% boost
        acos_actual: 0.15,
        acos_target: 0.2, // good ACOS
        clicks_3h: 30,
      });
      expect(determineAction(metrics, defaultConfig)).toBe("STRONG_UP");
    });

    it("should return MILD_UP for good CVR boost", () => {
      const metrics = createMetrics({
        cvr_recent: 0.056,
        cvr_baseline: 0.05, // 12% boost
        acos_actual: 0.2,
        acos_target: 0.2,
        clicks_3h: 30,
      });
      expect(determineAction(metrics, defaultConfig)).toBe("MILD_UP");
    });

    it("should return MILD_DOWN when CVR is declining", () => {
      const metrics = createMetrics({
        cvr_recent: 0.04,
        cvr_baseline: 0.05, // -20% decline
        acos_actual: 0.2,
        acos_target: 0.2,
        clicks_3h: 30,
      });
      expect(determineAction(metrics, defaultConfig)).toBe("MILD_DOWN");
    });
  });

  describe("adjustActionForBrandOwn", () => {
    it("should not modify actions for GENERIC brand type", () => {
      expect(adjustActionForBrandOwn("STRONG_DOWN", "GENERIC")).toBe("STRONG_DOWN");
      expect(adjustActionForBrandOwn("STOP", "GENERIC")).toBe("STOP");
    });

    it("should convert STRONG_DOWN to MILD_DOWN for BRAND", () => {
      expect(adjustActionForBrandOwn("STRONG_DOWN", "BRAND")).toBe("MILD_DOWN");
    });

    it("should convert STOP to MILD_DOWN for BRAND", () => {
      expect(adjustActionForBrandOwn("STOP", "BRAND")).toBe("MILD_DOWN");
    });

    it("should not modify positive actions for BRAND", () => {
      expect(adjustActionForBrandOwn("STRONG_UP", "BRAND")).toBe("STRONG_UP");
      expect(adjustActionForBrandOwn("MILD_UP", "BRAND")).toBe("MILD_UP");
      expect(adjustActionForBrandOwn("KEEP", "BRAND")).toBe("KEEP");
    });
  });
});

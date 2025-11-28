/**
 * compute_bid_recommendations のテスト
 *
 * 入力メトリクスからのアクション決定と入札額変化率の検証
 */

import { compute_bid_recommendations } from "../index";
import { KeywordMetrics, GlobalConfig } from "../types";

describe("compute_bid_recommendations", () => {
  // =============================================================================
  // テスト用ヘルパー関数
  // =============================================================================

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

  // =============================================================================
  // 基本動作テスト
  // =============================================================================

  describe("basic functionality", () => {
    it("should return empty array for empty input", () => {
      const result = compute_bid_recommendations([], defaultConfig);
      expect(result).toEqual([]);
    });

    it("should process multiple keywords", () => {
      const metrics = [
        createMetrics({ keyword_id: "kw001" }),
        createMetrics({ keyword_id: "kw002" }),
        createMetrics({ keyword_id: "kw003" }),
      ];
      const result = compute_bid_recommendations(metrics, defaultConfig);
      expect(result.length).toBe(3);
      expect(result.map((r) => r.keyword_id)).toEqual(["kw001", "kw002", "kw003"]);
    });
  });

  // =============================================================================
  // CVR向上時の入札引き上げテスト
  // =============================================================================

  describe("high CVR with good ACOS should result in bid increase", () => {
    it("should return positive change_rate for high CVR keyword", () => {
      const metrics = createMetrics({
        score_rank: "S",
        cvr_recent: 0.08, // 60% above baseline
        cvr_baseline: 0.05,
        acos_actual: 0.15, // below target (good)
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("STRONG_UP");
      expect(result[0].change_rate).toBeGreaterThan(0);
      expect(result[0].new_bid).toBeGreaterThan(metrics.current_bid);
    });

    it("should return MILD_UP for moderate CVR boost", () => {
      const metrics = createMetrics({
        cvr_recent: 0.056, // 12% boost
        cvr_baseline: 0.05,
        acos_actual: 0.2,
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("MILD_UP");
      expect(result[0].change_rate).toBeGreaterThan(0);
    });

    it("should give higher change_rate for S rank than A rank", () => {
      const sRankMetrics = createMetrics({
        score_rank: "S",
        cvr_recent: 0.08,
        cvr_baseline: 0.05,
        acos_actual: 0.15,
        acos_target: 0.2,
        clicks_3h: 30,
      });
      const aRankMetrics = createMetrics({
        score_rank: "A",
        cvr_recent: 0.08,
        cvr_baseline: 0.05,
        acos_actual: 0.15,
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const sResult = compute_bid_recommendations([sRankMetrics], defaultConfig);
      const aResult = compute_bid_recommendations([aRankMetrics], defaultConfig);

      expect(sResult[0].change_rate).toBeGreaterThan(aResult[0].change_rate);
    });
  });

  // =============================================================================
  // 高ACOS時の入札引き下げテスト
  // =============================================================================

  describe("bad ACOS should result in bid decrease", () => {
    it("should return negative change_rate for high ACOS keyword", () => {
      const metrics = createMetrics({
        acos_actual: 0.35, // 1.75x target
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("STRONG_DOWN");
      expect(result[0].change_rate).toBeLessThan(0);
      expect(result[0].new_bid).toBeLessThan(metrics.current_bid);
    });

    it("should return STOP for very high ACOS", () => {
      const metrics = createMetrics({
        acos_actual: 0.65, // 3.25x target (above hard stop threshold)
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("STOP");
      expect(result[0].change_rate).toBe(-1.0);
      expect(result[0].new_bid).toBe(0);
    });

    it("should return MILD_DOWN for declining CVR", () => {
      const metrics = createMetrics({
        cvr_recent: 0.04, // 20% decline
        cvr_baseline: 0.05,
        acos_actual: 0.2,
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("MILD_DOWN");
      expect(result[0].change_rate).toBeLessThan(0);
    });
  });

  // =============================================================================
  // 統計的信頼性テスト
  // =============================================================================

  describe("statistical confidence", () => {
    it("should return KEEP when clicks are below minimum", () => {
      const metrics = createMetrics({
        clicks_3h: 2, // below min_clicks_for_decision
        cvr_recent: 0.1,
        cvr_baseline: 0.05,
        acos_actual: 0.15,
        acos_target: 0.2,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("KEEP");
      expect(result[0].change_rate).toBe(0);
    });
  });

  // =============================================================================
  // Brand Own 保護テスト
  // =============================================================================

  describe("Brand Own protection", () => {
    it("should convert STRONG_DOWN to MILD_DOWN for BRAND", () => {
      const metrics = createMetrics({
        brand_type: "BRAND",
        acos_actual: 0.35, // would normally trigger STRONG_DOWN
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("MILD_DOWN");
    });

    it("should convert STOP to MILD_DOWN for BRAND", () => {
      const metrics = createMetrics({
        brand_type: "BRAND",
        acos_actual: 0.65, // would normally trigger STOP
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("MILD_DOWN");
    });
  });

  // =============================================================================
  // S_FREEZE フェーズテスト
  // =============================================================================

  describe("S_FREEZE phase", () => {
    it("should force KEEP action in S_FREEZE phase", () => {
      const metrics = createMetrics({
        phase_type: "S_FREEZE",
        cvr_recent: 0.1, // high CVR would normally trigger UP
        cvr_baseline: 0.05,
        acos_actual: 0.15,
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("KEEP");
      expect(result[0].change_rate).toBe(0);
    });
  });

  // =============================================================================
  // S_MODE テスト
  // =============================================================================

  describe("S_MODE", () => {
    const smodeConfig: GlobalConfig = {
      ...defaultConfig,
      mode: "S_MODE",
    };

    it("should apply S_MODE CVR coefficients", () => {
      const normalMetrics = createMetrics({
        phase_type: "S_NORMAL",
        cvr_recent: 0.08,
        cvr_baseline: 0.05,
        acos_actual: 0.15,
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([normalMetrics], smodeConfig);

      // S_MODE should apply higher CVR boost coefficient
      expect(result[0].debug_coefficients?.cvr_coeff).toBeGreaterThan(1);
    });
  });

  // =============================================================================
  // TOS（Top of Search）テスト
  // =============================================================================

  describe("TOS targeting", () => {
    // TOS targeting requires S_MODE
    const smodeConfigForTos: GlobalConfig = {
      ...defaultConfig,
      mode: "S_MODE",
    };

    it("should identify TOS targeted keywords in S_MODE", () => {
      const metrics = createMetrics({
        priority_score: 0.85, // above MIN_PRIORITY_SCORE (0.8)
        risk_penalty: 0.3, // below TOS_MAX (0.4)
        tos_gap_cpc: 25, // positive gap
        tos_ctr_mult: 1.3,
        tos_cvr_mult: 1.2, // tosValue = 1.56 >= 1.5
        clicks_3h: 50, // above min_clicks_for_tos
      });

      const result = compute_bid_recommendations([metrics], smodeConfigForTos);

      expect(result[0].tos_targeted).toBe(true);
    });

    it("should not target TOS in NORMAL mode", () => {
      const metrics = createMetrics({
        priority_score: 0.85,
        risk_penalty: 0.2,
        tos_gap_cpc: 25,
        tos_ctr_mult: 1.3,
        tos_cvr_mult: 1.2,
        clicks_3h: 50,
      });

      // NORMAL mode - TOS never targeted
      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].tos_targeted).toBe(false);
    });

    it("should not target TOS for low priority keywords", () => {
      const metrics = createMetrics({
        priority_score: 0.5, // below threshold
        risk_penalty: 0.2,
        clicks_3h: 50,
      });

      const result = compute_bid_recommendations([metrics], smodeConfigForTos);

      expect(result[0].tos_targeted).toBe(false);
    });
  });

  // =============================================================================
  // クリッピングテスト
  // =============================================================================

  describe("bid clipping", () => {
    it("should clip bid at maximum change rate", () => {
      const metrics = createMetrics({
        score_rank: "S",
        cvr_recent: 0.2, // extreme CVR boost
        cvr_baseline: 0.05,
        acos_actual: 0.1,
        acos_target: 0.2,
        clicks_3h: 100,
        current_bid: 100,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      // In NORMAL mode, max change rate is 0.6 (60%)
      const maxBid = 100 * (1 + defaultConfig.max_change_rate_normal);
      expect(result[0].new_bid).toBeLessThanOrEqual(maxBid);
    });

    it("should not go below minimum bid", () => {
      const metrics = createMetrics({
        acos_actual: 0.5,
        acos_target: 0.2,
        clicks_3h: 30,
        current_bid: 15, // low starting bid
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      // Minimum bid is 10 JPY
      expect(result[0].new_bid).toBeGreaterThanOrEqual(10);
    });
  });

  // =============================================================================
  // 出力フォーマットテスト
  // =============================================================================

  describe("output format", () => {
    it("should include all required fields", () => {
      const metrics = createMetrics();
      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0]).toHaveProperty("keyword_id");
      expect(result[0]).toHaveProperty("campaign_id");
      expect(result[0]).toHaveProperty("ad_group_id");
      expect(result[0]).toHaveProperty("action");
      expect(result[0]).toHaveProperty("change_rate");
      expect(result[0]).toHaveProperty("new_bid");
      expect(result[0]).toHaveProperty("clipped");
      expect(result[0]).toHaveProperty("tos_targeted");
      expect(result[0]).toHaveProperty("reason_facts");
      expect(result[0]).toHaveProperty("reason_logic");
      expect(result[0]).toHaveProperty("reason_impact");
    });

    it("should include debug coefficients", () => {
      const metrics = createMetrics();
      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].debug_coefficients).toBeDefined();
      expect(result[0].debug_coefficients).toHaveProperty("base_change_rate");
      expect(result[0].debug_coefficients).toHaveProperty("phase_coeff");
      expect(result[0].debug_coefficients).toHaveProperty("cvr_coeff");
      expect(result[0].debug_coefficients).toHaveProperty("stats_coeff");
    });
  });

  // =============================================================================
  // エッジケーステスト
  // =============================================================================

  describe("edge cases", () => {
    it("should handle zero CVR baseline", () => {
      const metrics = createMetrics({
        cvr_baseline: 0,
        cvr_recent: 0.05,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result).toHaveLength(1);
      expect(result[0].keyword_id).toBe(metrics.keyword_id);
    });

    it("should handle zero clicks", () => {
      const metrics = createMetrics({
        clicks_3h: 0,
        clicks_1h: 0,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].action).toBe("KEEP");
    });

    it("should handle very high current bid", () => {
      const metrics = createMetrics({
        current_bid: 10000,
        acos_actual: 0.35,
        acos_target: 0.2,
        clicks_3h: 30,
      });

      const result = compute_bid_recommendations([metrics], defaultConfig);

      expect(result[0].new_bid).toBeLessThan(metrics.current_bid);
    });
  });
});

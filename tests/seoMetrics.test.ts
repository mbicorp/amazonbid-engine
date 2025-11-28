/**
 * SEOメトリクス取得ヘルパーのテスト
 */

import {
  determineRankStatus,
  determineRankZone,
  calculateSeoMetrics,
} from "../src/seo/seoMetrics";
import {
  RANK_ZONE_THRESHOLDS,
  RANK_TREND_THRESHOLDS,
} from "../src/seo/types";

// =============================================================================
// determineRankStatus テスト
// =============================================================================

describe("determineRankStatus", () => {
  describe("UNKNOWNの判定", () => {
    it("rankTrendがnullならUNKNOWN", () => {
      expect(determineRankStatus(null)).toBe("UNKNOWN");
    });
  });

  describe("UP判定", () => {
    it("rankTrendが+3以上ならUP", () => {
      expect(determineRankStatus(3)).toBe("UP");
      expect(determineRankStatus(5)).toBe("UP");
      expect(determineRankStatus(10)).toBe("UP");
    });

    it("閾値ちょうどはUP", () => {
      expect(determineRankStatus(RANK_TREND_THRESHOLDS.UP_MIN)).toBe("UP");
    });
  });

  describe("DOWN判定", () => {
    it("rankTrendが-3以下ならDOWN", () => {
      expect(determineRankStatus(-3)).toBe("DOWN");
      expect(determineRankStatus(-5)).toBe("DOWN");
      expect(determineRankStatus(-10)).toBe("DOWN");
    });

    it("閾値ちょうどはDOWN", () => {
      expect(determineRankStatus(RANK_TREND_THRESHOLDS.DOWN_MAX)).toBe("DOWN");
    });
  });

  describe("FLAT判定", () => {
    it("rankTrendが-2〜+2ならFLAT", () => {
      expect(determineRankStatus(0)).toBe("FLAT");
      expect(determineRankStatus(1)).toBe("FLAT");
      expect(determineRankStatus(2)).toBe("FLAT");
      expect(determineRankStatus(-1)).toBe("FLAT");
      expect(determineRankStatus(-2)).toBe("FLAT");
    });
  });
});

// =============================================================================
// determineRankZone テスト
// =============================================================================

describe("determineRankZone", () => {
  describe("UNKNOWNの判定", () => {
    it("currentRankがnullならUNKNOWN", () => {
      expect(determineRankZone(null)).toBe("UNKNOWN");
    });
  });

  describe("TOP_ZONE判定", () => {
    it("1〜7位はTOP_ZONE", () => {
      expect(determineRankZone(1)).toBe("TOP_ZONE");
      expect(determineRankZone(5)).toBe("TOP_ZONE");
      expect(determineRankZone(7)).toBe("TOP_ZONE");
    });

    it("閾値ちょうどはTOP_ZONE", () => {
      expect(determineRankZone(RANK_ZONE_THRESHOLDS.TOP_ZONE_MAX)).toBe("TOP_ZONE");
    });
  });

  describe("MID_ZONE判定", () => {
    it("8〜20位はMID_ZONE", () => {
      expect(determineRankZone(8)).toBe("MID_ZONE");
      expect(determineRankZone(15)).toBe("MID_ZONE");
      expect(determineRankZone(20)).toBe("MID_ZONE");
    });

    it("閾値ちょうどはMID_ZONE", () => {
      expect(determineRankZone(RANK_ZONE_THRESHOLDS.MID_ZONE_MAX)).toBe("MID_ZONE");
    });
  });

  describe("OUT_OF_RANGE判定", () => {
    it("21位以上はOUT_OF_RANGE", () => {
      expect(determineRankZone(21)).toBe("OUT_OF_RANGE");
      expect(determineRankZone(50)).toBe("OUT_OF_RANGE");
      expect(determineRankZone(100)).toBe("OUT_OF_RANGE");
    });
  });
});

// =============================================================================
// calculateSeoMetrics テスト
// =============================================================================

describe("calculateSeoMetrics", () => {
  const asin = "B0TESTXXXX";

  describe("rankTrend計算", () => {
    it("prevRankとcurrentRankがあればトレンドを計算", () => {
      // 20位 → 15位 = +5（上昇）
      const result = calculateSeoMetrics(asin, 15, 20);
      expect(result.rankTrend).toBe(5);
      expect(result.rankStatus).toBe("UP");
    });

    it("順位が下がった場合はマイナスのトレンド", () => {
      // 10位 → 15位 = -5（下降）
      const result = calculateSeoMetrics(asin, 15, 10);
      expect(result.rankTrend).toBe(-5);
      expect(result.rankStatus).toBe("DOWN");
    });

    it("順位が変わらなければ0", () => {
      const result = calculateSeoMetrics(asin, 10, 10);
      expect(result.rankTrend).toBe(0);
      expect(result.rankStatus).toBe("FLAT");
    });
  });

  describe("rankTrendがnullになるケース", () => {
    it("prevRankがnullならrankTrendはnull", () => {
      const result = calculateSeoMetrics(asin, 10, null);
      expect(result.rankTrend).toBeNull();
      expect(result.rankStatus).toBe("UNKNOWN");
    });

    it("currentRankがnullならrankTrendはnull", () => {
      const result = calculateSeoMetrics(asin, null, 10);
      expect(result.rankTrend).toBeNull();
      expect(result.rankStatus).toBe("UNKNOWN");
    });

    it("両方nullならrankTrendはnull", () => {
      const result = calculateSeoMetrics(asin, null, null);
      expect(result.rankTrend).toBeNull();
      expect(result.rankStatus).toBe("UNKNOWN");
    });
  });

  describe("rankZone判定", () => {
    it("currentRankに基づいてrankZoneを判定", () => {
      expect(calculateSeoMetrics(asin, 5, 10).rankZone).toBe("TOP_ZONE");
      expect(calculateSeoMetrics(asin, 15, 20).rankZone).toBe("MID_ZONE");
      expect(calculateSeoMetrics(asin, 30, 35).rankZone).toBe("OUT_OF_RANGE");
    });

    it("currentRankがnullならUNKNOWN", () => {
      expect(calculateSeoMetrics(asin, null, 10).rankZone).toBe("UNKNOWN");
    });
  });

  describe("完全なSeoMetricsオブジェクト", () => {
    it("すべてのフィールドが正しくセットされる", () => {
      const result = calculateSeoMetrics(asin, 12, 18);

      expect(result.asin).toBe(asin);
      expect(result.currentRank).toBe(12);
      expect(result.prevRank).toBe(18);
      expect(result.rankTrend).toBe(6); // 18 - 12 = 6
      expect(result.rankStatus).toBe("UP");
      expect(result.rankZone).toBe("MID_ZONE");
    });
  });
});

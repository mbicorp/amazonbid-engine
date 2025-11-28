/**
 * クラスター判定ロジックテスト
 */

import {
  calculateRequiredClicksByRuleOfThree,
  determineClusterPhase,
  checkLongTail,
  judgeCluster,
  aggregateClusterMetrics,
} from "../../src/negative-keywords/query-cluster/cluster-judgment";
import {
  QueryClusterMetrics,
  DEFAULT_CLUSTER_PHASE_THRESHOLDS,
  DEFAULT_LONG_TAIL_THRESHOLDS,
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG,
} from "../../src/negative-keywords/query-cluster/types";

describe("cluster-judgment", () => {
  describe("calculateRequiredClicksByRuleOfThree", () => {
    it("ベースラインCVR 1%の場合は300クリック必要", () => {
      const required = calculateRequiredClicksByRuleOfThree(0.01, 0.5);
      expect(required).toBe(300);
    });

    it("ベースラインCVR 5%の場合は60クリック必要", () => {
      const required = calculateRequiredClicksByRuleOfThree(0.05, 0.5);
      expect(required).toBe(60);
    });

    it("ベースラインCVR 10%の場合は30クリック必要", () => {
      const required = calculateRequiredClicksByRuleOfThree(0.10, 0.5);
      expect(required).toBe(30);
    });

    it("リスク許容度が高いと必要クリック数が減る", () => {
      const low = calculateRequiredClicksByRuleOfThree(0.05, 0.0);
      const mid = calculateRequiredClicksByRuleOfThree(0.05, 0.5);
      const high = calculateRequiredClicksByRuleOfThree(0.05, 1.0);

      expect(high).toBeLessThan(mid);
      expect(mid).toBeLessThan(low);
    });

    it("最低10クリックは必要", () => {
      const required = calculateRequiredClicksByRuleOfThree(1.0, 1.0);
      expect(required).toBeGreaterThanOrEqual(10);
    });

    it("CVRが0の場合は最小CVRが適用される", () => {
      const required = calculateRequiredClicksByRuleOfThree(0, 0.5, 0.01);
      expect(required).toBe(300);
    });
  });

  describe("determineClusterPhase", () => {
    const thresholds = DEFAULT_CLUSTER_PHASE_THRESHOLDS;

    it("クリック < 20 の場合はLEARNING", () => {
      expect(determineClusterPhase(0, thresholds)).toBe("LEARNING");
      expect(determineClusterPhase(10, thresholds)).toBe("LEARNING");
      expect(determineClusterPhase(19, thresholds)).toBe("LEARNING");
    });

    it("20 <= クリック < 60 の場合はLIMITED_ACTION", () => {
      expect(determineClusterPhase(20, thresholds)).toBe("LIMITED_ACTION");
      expect(determineClusterPhase(40, thresholds)).toBe("LIMITED_ACTION");
      expect(determineClusterPhase(59, thresholds)).toBe("LIMITED_ACTION");
    });

    it("クリック >= 60 の場合はSTOP_CANDIDATE", () => {
      expect(determineClusterPhase(60, thresholds)).toBe("STOP_CANDIDATE");
      expect(determineClusterPhase(100, thresholds)).toBe("STOP_CANDIDATE");
      expect(determineClusterPhase(1000, thresholds)).toBe("STOP_CANDIDATE");
    });
  });

  describe("checkLongTail", () => {
    const thresholds = DEFAULT_LONG_TAIL_THRESHOLDS;

    function createMetrics(impressions: number, clicks: number, conversions: number): QueryClusterMetrics {
      return {
        asin: "TEST_ASIN",
        queryClusterId: "test::generic",
        canonicalQuery: "test",
        queryIntentTag: "generic",
        windowDays: 30,
        impressions,
        clicks,
        cost: clicks * 50,
        conversions,
        revenue: conversions * 2000,
        cpc: clicks > 0 ? 50 : null,
        cvr: clicks > 0 ? conversions / clicks : null,
        acos: conversions > 0 ? (clicks * 50) / (conversions * 2000) : null,
        queriesInCluster: 1,
        queryList: ["test"],
      };
    }

    it("インプレッション < 200 かつ クリック < 5 の場合はロングテール", () => {
      const result = checkLongTail(createMetrics(100, 3, 0), thresholds);
      expect(result.isLongTail).toBe(true);
    });

    it("インプレッション >= 200 の場合はロングテールではない", () => {
      const result = checkLongTail(createMetrics(200, 3, 0), thresholds);
      expect(result.isLongTail).toBe(false);
    });

    it("クリック >= 5 の場合はロングテールではない", () => {
      const result = checkLongTail(createMetrics(100, 5, 0), thresholds);
      expect(result.isLongTail).toBe(false);
    });

    it("ロングテールでコンバージョンなしの場合はレビュー推奨", () => {
      const result = checkLongTail(createMetrics(100, 3, 0), thresholds);
      expect(result.isLongTail).toBe(true);
      expect(result.needsReview).toBe(true);
      expect(result.recommendedAction).toBe("MANUAL_REVIEW");
    });

    it("ロングテールでコンバージョンありの場合は継続", () => {
      const result = checkLongTail(createMetrics(100, 3, 1), thresholds);
      expect(result.isLongTail).toBe(true);
      expect(result.needsReview).toBe(false);
      expect(result.recommendedAction).toBe("CONTINUE");
    });
  });

  describe("judgeCluster", () => {
    function createMetrics(
      clicks: number,
      conversions: number,
      impressions: number = 1000
    ): QueryClusterMetrics {
      return {
        asin: "TEST_ASIN",
        queryClusterId: "test::generic",
        canonicalQuery: "test",
        queryIntentTag: "generic",
        windowDays: 30,
        impressions,
        clicks,
        cost: clicks * 50,
        conversions,
        revenue: conversions * 2000,
        cpc: clicks > 0 ? 50 : null,
        cvr: clicks > 0 ? conversions / clicks : null,
        acos: conversions > 0 ? (clicks * 50) / (conversions * 2000) : null,
        queriesInCluster: 1,
        queryList: ["test"],
      };
    }

    const baselineCvr = 0.05; // 5%

    describe("LEARNINGフェーズ", () => {
      it("クリック < 20 の場合はSTOP候補にならない", () => {
        const result = judgeCluster(createMetrics(15, 0), baselineCvr);
        expect(result.phase).toBe("LEARNING");
        expect(result.isStopCandidate).toBe(false);
        expect(result.isNegativeCandidate).toBe(false);
        expect(result.reasonCode).toBe("CLUSTER_LEARNING");
      });
    });

    describe("LIMITED_ACTIONフェーズ", () => {
      it("20 <= クリック < 60 の場合はSTOP候補にならない", () => {
        const result = judgeCluster(createMetrics(40, 0), baselineCvr);
        expect(result.phase).toBe("LIMITED_ACTION");
        expect(result.isStopCandidate).toBe(false);
        expect(result.isNegativeCandidate).toBe(false);
        expect(result.reasonCode).toBe("CLUSTER_LIMITED_ACTION");
      });
    });

    describe("STOP_CANDIDATEフェーズ", () => {
      it("CVR=0 かつ 必要クリック数を満たす場合はSTOP候補", () => {
        // baselineCvr 5% → 必要クリック数 = 3/0.05 = 60
        const result = judgeCluster(createMetrics(60, 0), baselineCvr);
        expect(result.phase).toBe("STOP_CANDIDATE");
        expect(result.isStopCandidate).toBe(true);
        expect(result.isNegativeCandidate).toBe(true);
        expect(result.reasonCode).toBe("CLUSTER_NO_CONVERSION");
      });

      it("CVR=0 だが必要クリック数に満たない場合はSTOP候補にならない", () => {
        // baselineCvr 1% → 必要クリック数 = 300
        const result = judgeCluster(createMetrics(100, 0), 0.01);
        expect(result.phase).toBe("STOP_CANDIDATE");
        expect(result.isStopCandidate).toBe(false);
        expect(result.meetsClickThreshold).toBe(false);
      });

      it("コンバージョンがある場合はSTOP候補にならない", () => {
        const result = judgeCluster(createMetrics(100, 5), baselineCvr);
        expect(result.phase).toBe("STOP_CANDIDATE");
        expect(result.isStopCandidate).toBe(false);
        expect(result.isNegativeCandidate).toBe(false);
      });

      it("低CVRクラスターはLOW_CVR判定される", () => {
        // コンバージョンはあるがCVRがベースラインの50%未満
        // baselineCvr 5% の 50% = 2.5%
        // CVR = 1/100 = 1% < 2.5%
        const result = judgeCluster(createMetrics(100, 1), baselineCvr);
        expect(result.phase).toBe("STOP_CANDIDATE");
        expect(result.reasonCode).toBe("CLUSTER_LOW_CVR");
        expect(result.isStopCandidate).toBe(false);
      });
    });
  });

  describe("aggregateClusterMetrics", () => {
    it("検索語統計を正しく集約する", () => {
      const stats = [
        { query: "test1", impressions: 100, clicks: 10, cost: 500, conversions: 1, revenue: 2000 },
        { query: "test2", impressions: 200, clicks: 20, cost: 1000, conversions: 2, revenue: 4000 },
      ];

      const result = aggregateClusterMetrics(
        "TEST_ASIN",
        "test::generic",
        "test",
        "generic",
        stats,
        30
      );

      expect(result.asin).toBe("TEST_ASIN");
      expect(result.queryClusterId).toBe("test::generic");
      expect(result.impressions).toBe(300);
      expect(result.clicks).toBe(30);
      expect(result.cost).toBe(1500);
      expect(result.conversions).toBe(3);
      expect(result.revenue).toBe(6000);
      expect(result.cpc).toBe(50); // 1500 / 30
      expect(result.cvr).toBe(0.1); // 3 / 30
      expect(result.acos).toBe(0.25); // 1500 / 6000
      expect(result.queriesInCluster).toBe(2);
      expect(result.queryList).toEqual(["test1", "test2"]);
    });

    it("クリック0の場合はCPC/CVRがnull", () => {
      const stats = [
        { query: "test", impressions: 100, clicks: 0, cost: 0, conversions: 0, revenue: 0 },
      ];

      const result = aggregateClusterMetrics(
        "TEST_ASIN",
        "test::generic",
        "test",
        "generic",
        stats,
        30
      );

      expect(result.cpc).toBeNull();
      expect(result.cvr).toBeNull();
    });

    it("売上0の場合はACOSがnull", () => {
      const stats = [
        { query: "test", impressions: 100, clicks: 10, cost: 500, conversions: 0, revenue: 0 },
      ];

      const result = aggregateClusterMetrics(
        "TEST_ASIN",
        "test::generic",
        "test",
        "generic",
        stats,
        30
      );

      expect(result.acos).toBeNull();
    });
  });
});

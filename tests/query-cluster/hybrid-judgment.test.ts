/**
 * ハイブリッド判定ロジックテスト
 */

import {
  checkImportantKeyword,
  judgeSingleKeyword,
  executeHybridJudgment,
  calculateSpendRanking,
  summarizeHybridJudgmentResults,
} from "../../src/negative-keywords/query-cluster/hybrid-judgment";
import {
  ClusterJudgmentResult,
  ImportantKeywordConfig,
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG,
  DEFAULT_IMPORTANT_KEYWORD_CONFIG,
} from "../../src/negative-keywords/query-cluster/types";

describe("hybrid-judgment", () => {
  describe("calculateSpendRanking", () => {
    it("広告費降順でランク付けする", () => {
      const stats = [
        { query: "a", cost: 1000 },
        { query: "b", cost: 3000 },
        { query: "c", cost: 2000 },
      ];

      const ranking = calculateSpendRanking(stats);

      expect(ranking.get("b")).toBe(1);
      expect(ranking.get("c")).toBe(2);
      expect(ranking.get("a")).toBe(3);
    });
  });

  describe("checkImportantKeyword", () => {
    it("グローバルホワイトリストに含まれる場合は重要キーワード", () => {
      const config: ImportantKeywordConfig = {
        ...DEFAULT_IMPORTANT_KEYWORD_CONFIG,
        globalWhitelist: new Set(["重要キーワード"]),
      };

      const result = checkImportantKeyword("重要キーワード", "ASIN1", config);

      expect(result.isImportant).toBe(true);
      expect(result.reason).toBe("GLOBAL_WHITELIST");
    });

    it("ASIN別ホワイトリストに含まれる場合は重要キーワード", () => {
      const config: ImportantKeywordConfig = {
        ...DEFAULT_IMPORTANT_KEYWORD_CONFIG,
        manualWhitelist: new Map([["ASIN1", new Set(["重要キーワード"])]]),
      };

      const result = checkImportantKeyword("重要キーワード", "ASIN1", config);

      expect(result.isImportant).toBe(true);
      expect(result.reason).toBe("MANUAL_WHITELIST");
    });

    it("別のASINのホワイトリストには反応しない", () => {
      const config: ImportantKeywordConfig = {
        ...DEFAULT_IMPORTANT_KEYWORD_CONFIG,
        manualWhitelist: new Map([["ASIN2", new Set(["重要キーワード"])]]),
      };

      const result = checkImportantKeyword("重要キーワード", "ASIN1", config);

      expect(result.isImportant).toBe(false);
    });

    it("広告費上位N件は自動検出される", () => {
      const config: ImportantKeywordConfig = {
        ...DEFAULT_IMPORTANT_KEYWORD_CONFIG,
        autoDetectEnabled: true,
        autoDetectTopN: 10,
        autoDetectMinSpend: 1000,
      };

      const spendRanking = new Map([
        ["キーワード1", 1],
        ["キーワード2", 2],
        ["キーワード3", 11], // 上位10件外
      ]);

      const result1 = checkImportantKeyword("キーワード1", "ASIN1", config, spendRanking, 5000);
      expect(result1.isImportant).toBe(true);
      expect(result1.reason).toBe("AUTO_TOP_SPEND");
      expect(result1.spendRank).toBe(1);

      const result3 = checkImportantKeyword("キーワード3", "ASIN1", config, spendRanking, 5000);
      expect(result3.isImportant).toBe(false);
    });

    it("最小広告費を満たさない場合は自動検出されない", () => {
      const config: ImportantKeywordConfig = {
        ...DEFAULT_IMPORTANT_KEYWORD_CONFIG,
        autoDetectEnabled: true,
        autoDetectTopN: 10,
        autoDetectMinSpend: 5000,
      };

      const spendRanking = new Map([["キーワード1", 1]]);

      const result = checkImportantKeyword("キーワード1", "ASIN1", config, spendRanking, 1000);
      expect(result.isImportant).toBe(false);
    });
  });

  describe("judgeSingleKeyword", () => {
    const baselineCvr = 0.05;

    it("コンバージョンがある場合はSTOP候補にならない", () => {
      const result = judgeSingleKeyword(
        "test",
        { clicks: 100, conversions: 5, cost: 5000, revenue: 10000 },
        baselineCvr,
        DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
      );

      expect(result.isStopCandidate).toBe(false);
      expect(result.isNegativeCandidate).toBe(false);
      expect(result.reasonCode).toBe("SINGLE_HAS_CONVERSION");
    });

    it("CVR=0で必要クリック数を満たす場合はSTOP候補", () => {
      const result = judgeSingleKeyword(
        "test",
        { clicks: 100, conversions: 0, cost: 5000, revenue: 0 },
        baselineCvr,
        DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
      );

      expect(result.isStopCandidate).toBe(true);
      expect(result.isNegativeCandidate).toBe(true);
      expect(result.reasonCode).toBe("SINGLE_NO_CONVERSION");
    });

    it("クリック不足の場合はSTOP候補にならない", () => {
      const result = judgeSingleKeyword(
        "test",
        { clicks: 10, conversions: 0, cost: 500, revenue: 0 },
        baselineCvr,
        DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
      );

      expect(result.isStopCandidate).toBe(false);
      expect(result.reasonCode).toBe("SINGLE_INSUFFICIENT_CLICKS");
    });
  });

  describe("executeHybridJudgment", () => {
    function createClusterJudgment(
      isStopCandidate: boolean,
      isNegativeCandidate: boolean
    ): ClusterJudgmentResult {
      return {
        asin: "TEST_ASIN",
        queryClusterId: "test::generic",
        phase: "STOP_CANDIDATE",
        isStopCandidate,
        isNegativeCandidate,
        reasonCode: isStopCandidate ? "CLUSTER_NO_CONVERSION" : "CLUSTER_OK",
        reasonDetail: "テスト",
        clusterMetrics: {
          asin: "TEST_ASIN",
          queryClusterId: "test::generic",
          canonicalQuery: "test",
          queryIntentTag: "generic",
          windowDays: 30,
          impressions: 1000,
          clicks: 100,
          cost: 5000,
          conversions: 0,
          revenue: 0,
          cpc: 50,
          cvr: 0,
          acos: null,
          queriesInCluster: 1,
          queryList: ["test"],
        },
        requiredClicksByRuleOfThree: 60,
        meetsClickThreshold: true,
      };
    }

    it("通常キーワードはクラスター判定をそのまま適用", () => {
      const clusterJudgment = createClusterJudgment(true, true);
      const importantCheck = {
        isImportant: false,
        reason: "NOT_IMPORTANT" as const,
      };

      const result = executeHybridJudgment(
        "test",
        "TEST_ASIN",
        clusterJudgment,
        importantCheck
      );

      expect(result.finalIsStopCandidate).toBe(true);
      expect(result.finalIsNegativeCandidate).toBe(true);
      expect(result.overrideApplied).toBe(false);
    });

    it("重要キーワードは緩和オーバーライドを適用できる", () => {
      const clusterJudgment = createClusterJudgment(true, true);
      const importantCheck = {
        isImportant: true,
        reason: "AUTO_TOP_SPEND" as const,
        adSpend: 10000,
        spendRank: 1,
      };

      // 単一キーワードではコンバージョンがあるため緩和
      const singleKeywordStats = {
        clicks: 50,
        conversions: 2,
        cost: 2500,
        revenue: 4000,
      };

      const result = executeHybridJudgment(
        "test",
        "TEST_ASIN",
        clusterJudgment,
        importantCheck,
        singleKeywordStats,
        0.05,
        DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
      );

      expect(result.finalIsStopCandidate).toBe(false);
      expect(result.finalIsNegativeCandidate).toBe(false);
      expect(result.overrideApplied).toBe(true);
      expect(result.overrideDirection).toBe("LOOSENED");
    });

    it("重要キーワードでも厳格化オーバーライドは禁止", () => {
      // クラスター判定: OK（STOP候補ではない）
      const clusterJudgment = createClusterJudgment(false, false);
      const importantCheck = {
        isImportant: true,
        reason: "MANUAL_WHITELIST" as const,
      };

      // 単一キーワードではSTOP候補
      const singleKeywordStats = {
        clicks: 100,
        conversions: 0,
        cost: 5000,
        revenue: 0,
      };

      const result = executeHybridJudgment(
        "test",
        "TEST_ASIN",
        clusterJudgment,
        importantCheck,
        singleKeywordStats,
        0.05,
        DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
      );

      // クラスター判定を維持（厳格化は禁止）
      expect(result.finalIsStopCandidate).toBe(false);
      expect(result.finalIsNegativeCandidate).toBe(false);
      expect(result.overrideApplied).toBe(false);
    });

    it("重要キーワードで判定が同じ場合はオーバーライドなし", () => {
      const clusterJudgment = createClusterJudgment(true, true);
      const importantCheck = {
        isImportant: true,
        reason: "GLOBAL_WHITELIST" as const,
      };

      // 単一キーワードでもSTOP候補
      const singleKeywordStats = {
        clicks: 100,
        conversions: 0,
        cost: 5000,
        revenue: 0,
      };

      const result = executeHybridJudgment(
        "test",
        "TEST_ASIN",
        clusterJudgment,
        importantCheck,
        singleKeywordStats,
        0.05,
        DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
      );

      expect(result.finalIsStopCandidate).toBe(true);
      expect(result.overrideApplied).toBe(false);
    });
  });

  describe("summarizeHybridJudgmentResults", () => {
    it("結果を正しくサマリーする", () => {
      const results = [
        {
          asin: "ASIN1",
          query: "q1",
          queryClusterId: "q1::generic",
          clusterJudgment: { phase: "LEARNING" } as any,
          importantKeywordCheck: { isImportant: true, reason: "AUTO_TOP_SPEND" as const },
          finalIsStopCandidate: false,
          finalIsNegativeCandidate: false,
          overrideApplied: false,
          finalReasonCode: "test",
          finalReasonDetail: "test",
        },
        {
          asin: "ASIN1",
          query: "q2",
          queryClusterId: "q2::generic",
          clusterJudgment: { phase: "STOP_CANDIDATE" } as any,
          importantKeywordCheck: { isImportant: true, reason: "MANUAL_WHITELIST" as const },
          finalIsStopCandidate: true,
          finalIsNegativeCandidate: true,
          overrideApplied: false,
          finalReasonCode: "test",
          finalReasonDetail: "test",
        },
        {
          asin: "ASIN1",
          query: "q3",
          queryClusterId: "q3::generic",
          clusterJudgment: { phase: "STOP_CANDIDATE" } as any,
          importantKeywordCheck: { isImportant: true, reason: "GLOBAL_WHITELIST" as const },
          singleKeywordJudgment: { isStopCandidate: false } as any,
          finalIsStopCandidate: false,
          finalIsNegativeCandidate: false,
          overrideApplied: true,
          overrideDirection: "LOOSENED" as const,
          finalReasonCode: "test",
          finalReasonDetail: "test",
        },
      ];

      const summary = summarizeHybridJudgmentResults(results);

      expect(summary.totalQueries).toBe(3);
      expect(summary.stopCandidates).toBe(1);
      expect(summary.negativeCandidates).toBe(1);
      expect(summary.importantKeywords.total).toBe(3);
      expect(summary.importantKeywords.autoDetected).toBe(1);
      expect(summary.importantKeywords.manualWhitelist).toBe(1);
      expect(summary.importantKeywords.globalWhitelist).toBe(1);
      expect(summary.overrides.total).toBe(1);
      expect(summary.overrides.loosened).toBe(1);
      expect(summary.byClusterPhase.learning).toBe(1);
      expect(summary.byClusterPhase.stopCandidate).toBe(2);
    });
  });
});

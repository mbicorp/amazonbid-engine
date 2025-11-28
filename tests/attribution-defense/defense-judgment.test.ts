/**
 * 防御判定ロジックのテスト
 */

import {
  judgeDefense,
  checkStableRatioForUp,
  isDefenseBlockedByLaunchPhase,
  mitigateDefenseAction,
  AttributionAwareMetrics,
  DEFAULT_DEFENSE_THRESHOLD_CONFIG,
  DEFAULT_LIFECYCLE_DEFENSE_POLICIES,
  LifecycleState,
} from "../../src/engine/attribution-defense";

describe("defense-judgment", () => {
  /**
   * テスト用のAttributionAwareMetricsを生成
   */
  function createMetrics(
    stableClicks: number,
    stableConversions: number,
    stableCost: number,
    stableSales: number,
    recentClicks: number = 0,
    recentConversions: number = 0,
    recentCost: number = 0,
    recentSales: number = 0
  ): AttributionAwareMetrics {
    const stableAcos = stableSales > 0 ? stableCost / stableSales : null;
    const stableCvr = stableClicks > 0 ? stableConversions / stableClicks : null;
    const recentAcos = recentSales > 0 ? recentCost / recentSales : null;
    const recentCvr = recentClicks > 0 ? recentConversions / recentClicks : null;

    const totalClicks = stableClicks + recentClicks;
    const totalConversions = stableConversions + recentConversions;
    const totalCost = stableCost + recentCost;
    const totalSales = stableSales + recentSales;
    const totalAcos = totalSales > 0 ? totalCost / totalSales : null;
    const totalCvr = totalClicks > 0 ? totalConversions / totalClicks : null;

    return {
      asin: "B00EXAMPLE",
      entityId: "keyword_123",
      entityType: "KEYWORD",
      stable: {
        impressions: stableClicks * 20,
        clicks: stableClicks,
        conversions: stableConversions,
        cost: stableCost,
        sales: stableSales,
        ctr: 0.05,
        cvr: stableCvr,
        acos: stableAcos,
        cpc: stableClicks > 0 ? stableCost / stableClicks : null,
      },
      recent: {
        impressions: recentClicks * 20,
        clicks: recentClicks,
        conversions: recentConversions,
        cost: recentCost,
        sales: recentSales,
        ctr: 0.05,
        cvr: recentCvr,
        acos: recentAcos,
        cpc: recentClicks > 0 ? recentCost / recentClicks : null,
      },
      total: {
        impressions: totalClicks * 20,
        clicks: totalClicks,
        conversions: totalConversions,
        cost: totalCost,
        sales: totalSales,
        ctr: 0.05,
        cvr: totalCvr,
        acos: totalAcos,
        cpc: totalClicks > 0 ? totalCost / totalClicks : null,
      },
      stableDays: 27,
      recentDays: 3,
      targetCpa: 2000, // ¥2,000
    };
  }

  describe("judgeDefense - STOP/NEG判定", () => {
    it("stable期間でCV=0かつ閾値を満たす場合はSTOP推奨", () => {
      // stable: 60クリック、CV=0、コスト¥6,000（targetCPA ¥2,000 の3倍）
      const metrics = createMetrics(60, 0, 6000, 0);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(true);
      expect(result.recommendedAction).toBe("STOP");
      expect(result.reasonCode).toBe("DEFENSE_STOP_NO_CONVERSION");
      expect(result.meetsClickThreshold).toBe(true);
      expect(result.meetsCostThreshold).toBe(true);
    });

    it("検索語クラスターの場合はNEG推奨", () => {
      const metrics = createMetrics(60, 0, 6000, 0);
      metrics.entityType = "SEARCH_TERM_CLUSTER";

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(true);
      expect(result.recommendedAction).toBe("NEG");
      expect(result.reasonCode).toBe("DEFENSE_NEG_NO_CONVERSION");
    });

    it("stable期間のクリックが閾値未満の場合はSTOP見送り", () => {
      // stable: 50クリック（閾値60未満）、CV=0
      const metrics = createMetrics(50, 0, 5000, 0);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(false);
      expect(result.reasonCode).toBe("DEFENSE_BLOCKED_INSUFFICIENT_CLICKS");
      expect(result.meetsClickThreshold).toBe(false);
    });

    it("stable期間のコスト対CPA比率が閾値未満の場合はSTOP見送り", () => {
      // stable: 60クリック、CV=0、コスト¥5,000（targetCPA ¥2,000 の2.5倍 < 3倍）
      const metrics = createMetrics(60, 0, 5000, 0);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(false);
      expect(result.reasonCode).toBe("DEFENSE_BLOCKED_INSUFFICIENT_COST");
      expect(result.meetsCostThreshold).toBe(false);
    });

    it("直近期間にCVがある場合はSTOPをSTRONG_DOWNに緩和", () => {
      // stable: CV=0、recent: CV=1
      const metrics = createMetrics(60, 0, 6000, 0, 10, 1, 500, 2000);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(true);
      expect(result.recommendedAction).toBe("STRONG_DOWN");
      expect(result.reasonCode).toBe("DEFENSE_BLOCKED_RECENT_GOOD_PERFORMANCE");
      expect(result.recentPerformanceGood).toBe(true);
    });
  });

  describe("judgeDefense - STRONG_DOWN判定", () => {
    it("stable期間でACOS高すぎの場合はSTRONG_DOWN推奨", () => {
      // stable: ACOS 25%、targetAcos 15%（1.5倍超過）
      // 40クリック、コスト¥4,000（targetCPA ¥2,000 の2倍）
      const metrics = createMetrics(40, 2, 4000, 16000);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(true);
      expect(result.recommendedAction).toBe("STRONG_DOWN");
      expect(result.reasonCode).toBe("DEFENSE_STRONG_DOWN_HIGH_ACOS");
    });

    it("stable期間のクリックが閾値未満の場合はSTRONG_DOWN見送り", () => {
      // stable: 30クリック（閾値40未満）、ACOS高め
      const metrics = createMetrics(30, 1, 3000, 10000);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(false);
      expect(result.reasonCode).toBe("DEFENSE_BLOCKED_INSUFFICIENT_CLICKS");
    });
  });

  describe("judgeDefense - DOWN判定", () => {
    it("stable期間でACOS高めの場合はDOWN推奨", () => {
      // stable: ACOS 20%、targetAcos 15%（1.2倍超過だが1.5倍未満）
      // 20クリック、コスト¥2,000
      const metrics = createMetrics(20, 2, 2000, 10000);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(true);
      expect(result.recommendedAction).toBe("DOWN");
      expect(result.reasonCode).toBe("DEFENSE_DOWN_HIGH_ACOS");
    });
  });

  describe("judgeDefense - ライフサイクルポリシー", () => {
    it("LAUNCH_HARDフェーズではSTOP/NEGがブロックされる", () => {
      const metrics = createMetrics(100, 0, 10000, 0);

      const result = judgeDefense(metrics, 0.15, "LAUNCH_HARD");

      expect(result.shouldDefend).toBe(false);
      expect(result.reasonCode).toBe("DEFENSE_BLOCKED_LIFECYCLE_POLICY");
      expect(result.blockedByLifecyclePolicy).toBe(true);
    });

    it("LAUNCH_SOFTフェーズでもSTOP/NEGがブロックされる", () => {
      const metrics = createMetrics(100, 0, 10000, 0);

      const result = judgeDefense(metrics, 0.15, "LAUNCH_SOFT");

      expect(result.shouldDefend).toBe(false);
      expect(result.blockedByLifecyclePolicy).toBe(true);
    });

    it("LAUNCH_HARDフェーズでは閾値が2倍に厳格化される", () => {
      // 通常なら60クリックでSTOP候補だが、LAUNCH_HARDでは120必要
      // ただしSTOP/NEG自体がブロックされているのでSTRONG_DOWNを見る
      // STRONG_DOWNも40→80クリック必要、さらにブロック
      // DOWNも20→40クリック必要、かつブロック
      const metrics = createMetrics(60, 2, 6000, 20000); // ACOS 30%

      const result = judgeDefense(metrics, 0.15, "LAUNCH_HARD");

      expect(result.shouldDefend).toBe(false);
    });

    it("HARVESTフェーズでは閾値が0.8倍に緩和される", () => {
      // 通常60クリック必要なところが48クリックで足りる
      const metrics = createMetrics(50, 0, 5000, 0);

      const result = judgeDefense(metrics, 0.15, "HARVEST");

      expect(result.shouldDefend).toBe(true);
      expect(result.recommendedAction).toBe("STOP");
    });
  });

  describe("judgeDefense - パフォーマンス良好", () => {
    it("stable期間のパフォーマンスが良好な場合は防御不要", () => {
      // stable: ACOS 10%、targetAcos 15%
      const metrics = createMetrics(50, 5, 2500, 25000);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(false);
      expect(result.reasonCode).toBe("DEFENSE_NOT_NEEDED_GOOD_PERFORMANCE");
    });
  });

  describe("checkStableRatioForUp", () => {
    it("ACOS乖離が許容範囲内ならアップを許可", () => {
      // stable: ACOS 10%, total: ACOS 11% (10%乖離)
      const metrics = createMetrics(20, 2, 2000, 20000, 5, 0, 600, 5000);
      // total ACOS = 2600 / 25000 = 10.4%

      const result = checkStableRatioForUp(metrics);

      expect(result.allowUp).toBe(true);
    });

    it("ACOS乖離が閾値を超える場合はアップを抑制", () => {
      // stable: ACOS 10%, total: ACOS 15% (50%乖離 > 25%閾値)
      const metrics = createMetrics(20, 2, 2000, 20000, 10, 0, 1500, 5000);
      // total ACOS = 3500 / 25000 = 14%

      const result = checkStableRatioForUp(metrics);

      expect(result.allowUp).toBe(false);
      expect(result.acosDivergenceRatio).toBeGreaterThan(0.25);
    });

    it("stable期間のクリックが不足している場合はチェックをスキップ", () => {
      const metrics = createMetrics(10, 1, 1000, 10000);

      const result = checkStableRatioForUp(metrics);

      expect(result.allowUp).toBe(true);
      expect(result.acosDivergenceRatio).toBeNull();
    });
  });

  describe("isDefenseBlockedByLaunchPhase", () => {
    it("LAUNCH_HARDでSTOPはブロックされる", () => {
      expect(isDefenseBlockedByLaunchPhase("STOP", "LAUNCH_HARD")).toBe(true);
    });

    it("LAUNCH_HARDでNEGはブロックされる", () => {
      expect(isDefenseBlockedByLaunchPhase("NEG", "LAUNCH_HARD")).toBe(true);
    });

    it("LAUNCH_SOFTでSTRONG_DOWNはブロックされる", () => {
      expect(isDefenseBlockedByLaunchPhase("STRONG_DOWN", "LAUNCH_SOFT")).toBe(true);
    });

    it("LAUNCH_SOFTでDOWNはブロックされない", () => {
      expect(isDefenseBlockedByLaunchPhase("DOWN", "LAUNCH_SOFT")).toBe(false);
    });

    it("STEADYではどのアクションもブロックされない", () => {
      expect(isDefenseBlockedByLaunchPhase("STOP", "STEADY")).toBe(false);
      expect(isDefenseBlockedByLaunchPhase("NEG", "STEADY")).toBe(false);
      expect(isDefenseBlockedByLaunchPhase("STRONG_DOWN", "STEADY")).toBe(false);
      expect(isDefenseBlockedByLaunchPhase("DOWN", "STEADY")).toBe(false);
    });
  });

  describe("mitigateDefenseAction", () => {
    it("LAUNCH_HARDではSTOPがnullに緩和される", () => {
      expect(mitigateDefenseAction("STOP", "LAUNCH_HARD")).toBeNull();
    });

    it("LAUNCH_SOFTではSTOPがDOWNに緩和される", () => {
      expect(mitigateDefenseAction("STOP", "LAUNCH_SOFT")).toBe("DOWN");
    });

    it("GROWTHではSTOPがそのまま維持される", () => {
      expect(mitigateDefenseAction("STOP", "GROWTH")).toBe("STOP");
    });

    it("STEADYでは全アクションがそのまま維持される", () => {
      expect(mitigateDefenseAction("STOP", "STEADY")).toBe("STOP");
      expect(mitigateDefenseAction("NEG", "STEADY")).toBe("NEG");
      expect(mitigateDefenseAction("STRONG_DOWN", "STEADY")).toBe("STRONG_DOWN");
      expect(mitigateDefenseAction("DOWN", "STEADY")).toBe("DOWN");
    });
  });

  describe("統合テスト", () => {
    it("典型的なCV=0キーワードのSTOP判定フロー", () => {
      // 状況: 30日間で100クリック、CV=0、コスト¥8,000使用
      const metrics = createMetrics(100, 0, 8000, 0);

      // STEADYフェーズでの判定
      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(true);
      expect(result.recommendedAction).toBe("STOP");
      expect(result.meetsClickThreshold).toBe(true);
      expect(result.meetsCostThreshold).toBe(true);
    });

    it("直近好調なキーワードの緩和フロー", () => {
      // 状況: stable期間でCV=0だが、直近3日で1件CV
      const metrics = createMetrics(80, 0, 6000, 0, 10, 1, 500, 2000);

      const result = judgeDefense(metrics, 0.15, "STEADY");

      expect(result.shouldDefend).toBe(true);
      expect(result.recommendedAction).toBe("STRONG_DOWN"); // STOPから緩和
      expect(result.recentPerformanceGood).toBe(true);
    });

    it("新商品ローンチ時の保護フロー", () => {
      // 状況: LAUNCH_HARD期で100クリック、CV=0
      const metrics = createMetrics(100, 0, 8000, 0);

      const result = judgeDefense(metrics, 0.15, "LAUNCH_HARD");

      expect(result.shouldDefend).toBe(false);
      expect(result.blockedByLifecyclePolicy).toBe(true);
    });
  });
});

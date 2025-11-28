/**
 * decideNextLifecycleStageForAsin テスト
 *
 * LaunchExitDecisionと現在のライフサイクルステージから、
 * 次のステージを決定するロジックのテスト
 */

import {
  decideNextLifecycleStageForAsin,
  LifecycleTransitionDecision,
} from "../../src/lifecycle/transition-logic";
import {
  LaunchExitDecision,
  LaunchExitReasonCode,
  AsinSeoLaunchProgress,
} from "../../src/lifecycle/seo-launch-evaluator";

describe("decideNextLifecycleStageForAsin", () => {
  const asin = "B00TEST123";

  // テスト用のSEO進捗情報
  const baseSeoProgress: AsinSeoLaunchProgress = {
    asin,
    totalCoreKeywords: 10,
    achievedCount: 7,
    gaveUpCount: 0,
    activeCount: 3,
    completionRatio: 0.7,
    successRatio: 0.7,
    keywordStatuses: [],
  };

  // 正常終了のLaunchExitDecision
  const normalExitDecision: LaunchExitDecision = {
    asin,
    shouldExitLaunch: true,
    isEmergencyExit: false,
    recommendedNextStage: "GROW",
    reasonCodes: ["CORE_COMPLETION", "DAYS_OR_DATA"] as LaunchExitReasonCode[],
    reasonMessage: "SEO完了率70%達成、試行条件達成 → GROWへ移行推奨",
    seoProgress: baseSeoProgress,
  };

  // 緊急終了のLaunchExitDecision
  const emergencyExitDecision: LaunchExitDecision = {
    asin,
    shouldExitLaunch: true,
    isEmergencyExit: true,
    recommendedNextStage: "GROW",
    reasonCodes: ["LOSS_BUDGET_EMERGENCY"] as LaunchExitReasonCode[],
    reasonMessage: "lossBudget超過による緊急終了 → GROWへ移行推奨",
    seoProgress: { ...baseSeoProgress, completionRatio: 0.3 },
  };

  // 継続のLaunchExitDecision
  const continueDecision: LaunchExitDecision = {
    asin,
    shouldExitLaunch: false,
    isEmergencyExit: false,
    recommendedNextStage: "LAUNCH_HARD",
    reasonCodes: ["NOT_READY"] as LaunchExitReasonCode[],
    reasonMessage: "SEO完了率未達、LAUNCH継続",
    seoProgress: { ...baseSeoProgress, completionRatio: 0.4 },
  };

  describe("LAUNCH期以外のステージでは遷移しない", () => {
    it("GROW ステージでは LaunchExitDecision があっても null を返す", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "GROW",
        normalExitDecision
      );

      expect(result).toBeNull();
    });

    it("HARVEST ステージでは LaunchExitDecision があっても null を返す", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "HARVEST",
        emergencyExitDecision
      );

      expect(result).toBeNull();
    });
  });

  describe("launchExitDecision が null または shouldExitLaunch=false の場合", () => {
    it("launchExitDecision が null の場合は null を返す", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        null
      );

      expect(result).toBeNull();
    });

    it("shouldExitLaunch が false の場合は null を返す", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        continueDecision
      );

      expect(result).toBeNull();
    });
  });

  describe("LAUNCH_HARD からの正常遷移", () => {
    it("shouldExitLaunch=true で GROW への遷移を返す（通常終了）", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        normalExitDecision
      );

      expect(result).not.toBeNull();
      expect(result!.asin).toBe(asin);
      expect(result!.from).toBe("LAUNCH_HARD");
      expect(result!.to).toBe("GROW");
      expect(result!.isEmergency).toBe(false);
      expect(result!.reasonCodes).toContain("CORE_COMPLETION");
      expect(result!.reasonCodes).toContain("DAYS_OR_DATA");
      expect(result!.reasonMessage).toContain("SEO完了率");
    });

    it("shouldExitLaunch=true で GROW への遷移を返す（緊急終了）", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        emergencyExitDecision
      );

      expect(result).not.toBeNull();
      expect(result!.asin).toBe(asin);
      expect(result!.from).toBe("LAUNCH_HARD");
      expect(result!.to).toBe("GROW");
      expect(result!.isEmergency).toBe(true);
      expect(result!.reasonCodes).toContain("LOSS_BUDGET_EMERGENCY");
    });
  });

  describe("LAUNCH_SOFT からの正常遷移", () => {
    it("shouldExitLaunch=true で GROW への遷移を返す（通常終了）", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_SOFT",
        normalExitDecision
      );

      expect(result).not.toBeNull();
      expect(result!.asin).toBe(asin);
      expect(result!.from).toBe("LAUNCH_SOFT");
      expect(result!.to).toBe("GROW");
      expect(result!.isEmergency).toBe(false);
    });

    it("shouldExitLaunch=true で GROW への遷移を返す（緊急終了）", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_SOFT",
        emergencyExitDecision
      );

      expect(result).not.toBeNull();
      expect(result!.asin).toBe(asin);
      expect(result!.from).toBe("LAUNCH_SOFT");
      expect(result!.to).toBe("GROW");
      expect(result!.isEmergency).toBe(true);
    });
  });

  describe("isEmergency / reasonCodes の正しい引き継ぎ", () => {
    it("通常終了では isEmergency=false", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        normalExitDecision
      );

      expect(result!.isEmergency).toBe(false);
    });

    it("緊急終了では isEmergency=true", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        emergencyExitDecision
      );

      expect(result!.isEmergency).toBe(true);
    });

    it("reasonCodes が正しく引き継がれる", () => {
      const multiReasonDecision: LaunchExitDecision = {
        asin,
        shouldExitLaunch: true,
        isEmergencyExit: false,
        recommendedNextStage: "GROW",
        reasonCodes: ["CORE_COMPLETION", "DAYS_OR_DATA", "LOSS_BUDGET_OK"] as LaunchExitReasonCode[],
        reasonMessage: "複数条件達成",
        seoProgress: baseSeoProgress,
      };

      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        multiReasonDecision
      );

      expect(result!.reasonCodes).toEqual(["CORE_COMPLETION", "DAYS_OR_DATA", "LOSS_BUDGET_OK"]);
    });

    it("reasonMessage が正しく引き継がれる", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        normalExitDecision
      );

      expect(result!.reasonMessage).toBe(normalExitDecision.reasonMessage);
    });
  });

  describe("型整合性", () => {
    it("LifecycleTransitionDecision の全フィールドが設定される", () => {
      const result = decideNextLifecycleStageForAsin(
        asin,
        "LAUNCH_HARD",
        normalExitDecision
      );

      // TypeScript のコンパイル時にチェックされるが、ランタイムでも確認
      expect(result).toHaveProperty("asin");
      expect(result).toHaveProperty("from");
      expect(result).toHaveProperty("to");
      expect(result).toHaveProperty("isEmergency");
      expect(result).toHaveProperty("reasonCodes");
      expect(result).toHaveProperty("reasonMessage");
    });
  });
});

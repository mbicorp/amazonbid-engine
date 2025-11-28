/**
 * ロール×ライフサイクル×セールフェーズ別ガードレール テスト
 */

import {
  KeywordRole,
  PresaleType,
  LossBudgetState,
  GuardrailContext,
  RoleLifecycleGuardrails,
  getRoleLifecycleGuardrails,
  computeOverspendRatio,
  isActionAllowed,
  meetsActionThreshold,
  clipDownRatio,
  fallbackAction,
  isValidKeywordRole,
  isValidPresaleType,
  isValidLossBudgetState,
  VALID_KEYWORD_ROLES,
  VALID_PRESALE_TYPES,
  VALID_LOSS_BUDGET_STATES,
  DEFAULT_ROLE_LIFECYCLE_GUARDRAILS,
} from "../../src/engine/roleGuardrails";
import { LifecycleState } from "../../src/config/productConfigTypes";
import { SalePhase } from "../../src/tacos-acos/types";

// =============================================================================
// 型バリデーション テスト
// =============================================================================

describe("型バリデーション", () => {
  describe("isValidKeywordRole", () => {
    test("有効なKeywordRoleはtrueを返す", () => {
      expect(isValidKeywordRole("CORE")).toBe(true);
      expect(isValidKeywordRole("SUPPORT")).toBe(true);
      expect(isValidKeywordRole("EXPERIMENT")).toBe(true);
    });

    test("無効な値はfalseを返す", () => {
      expect(isValidKeywordRole("INVALID")).toBe(false);
      expect(isValidKeywordRole("")).toBe(false);
      expect(isValidKeywordRole(null)).toBe(false);
      expect(isValidKeywordRole(undefined)).toBe(false);
      expect(isValidKeywordRole(123)).toBe(false);
    });
  });

  describe("isValidPresaleType", () => {
    test("有効なPresaleTypeはtrueを返す", () => {
      expect(isValidPresaleType("BUYING")).toBe(true);
      expect(isValidPresaleType("HOLD_BACK")).toBe(true);
      expect(isValidPresaleType("MIXED")).toBe(true);
      expect(isValidPresaleType("NONE")).toBe(true);
    });

    test("無効な値はfalseを返す", () => {
      expect(isValidPresaleType("INVALID")).toBe(false);
    });
  });

  describe("isValidLossBudgetState", () => {
    test("有効なLossBudgetStateはtrueを返す", () => {
      expect(isValidLossBudgetState("SAFE")).toBe(true);
      expect(isValidLossBudgetState("WARNING")).toBe(true);
      expect(isValidLossBudgetState("CRITICAL")).toBe(true);
    });

    test("無効な値はfalseを返す", () => {
      expect(isValidLossBudgetState("INVALID")).toBe(false);
    });
  });
});

// =============================================================================
// CORE ロール テスト
// =============================================================================

describe("CORE ロールのガードレール", () => {
  describe("LAUNCH × CORE", () => {
    const baseContext: GuardrailContext = {
      role: "CORE",
      lifecycleStage: "LAUNCH_HARD",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };

    test("STOP/NEG/STRONG_DOWNは原則禁止", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.allowStop).toBe(false);
      expect(guardrails.allowNegative).toBe(false);
      expect(guardrails.allowStrongDown).toBe(false);
    });

    test("DOWN用クリック数閾値は高め（90クリック）", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.minClicksDown).toBe(90);
    });

    test("overspendThresholdDownは1.3（MED_OVER）", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.overspendThresholdDown).toBe(1.3);
    });

    test("maxDownStepRatioは0.1（1回最大10%）", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.maxDownStepRatio).toBe(0.1);
    });

    test("LAUNCH_SOFTでも同様のガードレール", () => {
      const softContext = { ...baseContext, lifecycleStage: "LAUNCH_SOFT" as LifecycleState };
      const guardrails = getRoleLifecycleGuardrails(softContext);

      expect(guardrails.allowStop).toBe(false);
      expect(guardrails.allowNegative).toBe(false);
      expect(guardrails.allowStrongDown).toBe(false);
    });
  });

  describe("GROW × CORE", () => {
    const baseContext: GuardrailContext = {
      role: "CORE",
      lifecycleStage: "GROW",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };

    test("SAFE状態ではSTOP/NEGは禁止", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.allowStop).toBe(false);
      expect(guardrails.allowNegative).toBe(false);
    });

    test("CRITICAL状態ではSTOP/NEGを例外的に許可", () => {
      const criticalContext = { ...baseContext, lossBudgetState: "CRITICAL" as LossBudgetState };
      const guardrails = getRoleLifecycleGuardrails(criticalContext);

      expect(guardrails.allowStop).toBe(true);
      expect(guardrails.allowNegative).toBe(true);
    });

    test("PRE_SALE×HOLD_BACKではSTRONG_DOWN禁止", () => {
      const presaleContext: GuardrailContext = {
        ...baseContext,
        salePhase: "PRE_SALE",
        presaleType: "HOLD_BACK",
      };
      const guardrails = getRoleLifecycleGuardrails(presaleContext);

      expect(guardrails.allowStrongDown).toBe(false);
    });

    test("通常時はSTRONG_DOWN許可", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.allowStrongDown).toBe(true);
    });

    test("クリック数閾値は標準の2倍", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.minClicksDown).toBe(60);
      expect(guardrails.minClicksStrongDown).toBe(100);
      expect(guardrails.minClicksStop).toBe(160);
    });
  });

  describe("HARVEST × CORE", () => {
    const baseContext: GuardrailContext = {
      role: "CORE",
      lifecycleStage: "HARVEST",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };

    test("SAFE状態ではSTOP禁止だがSTRONG_DOWNは許可", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.allowStop).toBe(false);
      expect(guardrails.allowNegative).toBe(false);
      expect(guardrails.allowStrongDown).toBe(true);
    });

    test("WARNING状態ではSTOP許可", () => {
      const warningContext = { ...baseContext, lossBudgetState: "WARNING" as LossBudgetState };
      const guardrails = getRoleLifecycleGuardrails(warningContext);

      expect(guardrails.allowStop).toBe(true);
    });

    test("CRITICAL状態ではNEGも許可", () => {
      const criticalContext = { ...baseContext, lossBudgetState: "CRITICAL" as LossBudgetState };
      const guardrails = getRoleLifecycleGuardrails(criticalContext);

      expect(guardrails.allowStop).toBe(true);
      expect(guardrails.allowNegative).toBe(true);
    });
  });
});

// =============================================================================
// SUPPORT ロール テスト
// =============================================================================

describe("SUPPORT ロールのガードレール", () => {
  describe("LAUNCH × SUPPORT", () => {
    const baseContext: GuardrailContext = {
      role: "SUPPORT",
      lifecycleStage: "LAUNCH_HARD",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };

    test("SAFE状態ではSTOP禁止、NEGは常に禁止", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.allowStop).toBe(false);
      expect(guardrails.allowNegative).toBe(false);
    });

    test("CRITICAL状態ではSTOP許可", () => {
      const criticalContext = { ...baseContext, lossBudgetState: "CRITICAL" as LossBudgetState };
      const guardrails = getRoleLifecycleGuardrails(criticalContext);

      expect(guardrails.allowStop).toBe(true);
      // CRITICAL補正でNEGも許可
      expect(guardrails.allowNegative).toBe(true);
    });

    test("クリック数閾値は標準の1.5倍", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.minClicksDown).toBe(45);
    });
  });

  describe("GROW × SUPPORT（メイン調整対象）", () => {
    const baseContext: GuardrailContext = {
      role: "SUPPORT",
      lifecycleStage: "GROW",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };

    test("STOPは常に許可", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.allowStop).toBe(true);
    });

    test("SAFE状態ではNEG禁止", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.allowNegative).toBe(false);
    });

    test("WARNING状態ではNEG許可", () => {
      const warningContext = { ...baseContext, lossBudgetState: "WARNING" as LossBudgetState };
      const guardrails = getRoleLifecycleGuardrails(warningContext);

      expect(guardrails.allowNegative).toBe(true);
    });

    test("標準クリック数閾値を使用", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.minClicksDown).toBe(30);
      expect(guardrails.minClicksStrongDown).toBe(50);
      expect(guardrails.minClicksStop).toBe(80);
    });

    test("maxDownStepRatioは0.2（1回最大20%）", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.maxDownStepRatio).toBe(0.2);
    });
  });

  describe("HARVEST × SUPPORT（利益優先）", () => {
    const baseContext: GuardrailContext = {
      role: "SUPPORT",
      lifecycleStage: "HARVEST",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };

    test("STOP/NEG/STRONG_DOWN全て許可", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.allowStop).toBe(true);
      expect(guardrails.allowNegative).toBe(true);
      expect(guardrails.allowStrongDown).toBe(true);
    });

    test("STRONG_DOWN閾値は軽め（SMALL_OVER）", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.overspendThresholdStrongDown).toBe(1.1);
    });

    test("STOP閾値も軽め（MED_OVER）", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.overspendThresholdStop).toBe(1.3);
    });

    test("maxDownStepRatioは0.25（1回最大25%）", () => {
      const guardrails = getRoleLifecycleGuardrails(baseContext);

      expect(guardrails.maxDownStepRatio).toBe(0.25);
    });
  });
});

// =============================================================================
// EXPERIMENT ロール テスト
// =============================================================================

describe("EXPERIMENT ロールのガードレール", () => {
  const lifecycleStages: LifecycleState[] = ["LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"];

  test("全ステージでSTOP/NEG/STRONG_DOWN許可", () => {
    for (const stage of lifecycleStages) {
      const context: GuardrailContext = {
        role: "EXPERIMENT",
        lifecycleStage: stage,
        salePhase: "NORMAL",
        presaleType: "NONE",
        lossBudgetState: "SAFE",
      };
      const guardrails = getRoleLifecycleGuardrails(context);

      expect(guardrails.allowStop).toBe(true);
      expect(guardrails.allowNegative).toBe(true);
      expect(guardrails.allowStrongDown).toBe(true);
    }
  });

  test("クリック数閾値は標準の0.7倍", () => {
    const context: GuardrailContext = {
      role: "EXPERIMENT",
      lifecycleStage: "GROW",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };
    const guardrails = getRoleLifecycleGuardrails(context);

    expect(guardrails.minClicksDown).toBe(21);
    expect(guardrails.minClicksStrongDown).toBe(35);
    expect(guardrails.minClicksStop).toBe(56);
  });

  test("maxDownStepRatioは0.3（1回最大30%）", () => {
    const context: GuardrailContext = {
      role: "EXPERIMENT",
      lifecycleStage: "GROW",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };
    const guardrails = getRoleLifecycleGuardrails(context);

    expect(guardrails.maxDownStepRatio).toBe(0.3);
  });
});

// =============================================================================
// PRE_SALE × HOLD_BACK 補正 テスト
// =============================================================================

describe("PRE_SALE × HOLD_BACK 補正", () => {
  test("SUPPORT: STRONG_DOWNが禁止される", () => {
    const context: GuardrailContext = {
      role: "SUPPORT",
      lifecycleStage: "GROW",
      salePhase: "PRE_SALE",
      presaleType: "HOLD_BACK",
      lossBudgetState: "SAFE",
    };
    const guardrails = getRoleLifecycleGuardrails(context);

    expect(guardrails.allowStrongDown).toBe(false);
  });

  test("EXPERIMENT: STRONG_DOWNが禁止される", () => {
    const context: GuardrailContext = {
      role: "EXPERIMENT",
      lifecycleStage: "GROW",
      salePhase: "PRE_SALE",
      presaleType: "HOLD_BACK",
      lossBudgetState: "SAFE",
    };
    const guardrails = getRoleLifecycleGuardrails(context);

    expect(guardrails.allowStrongDown).toBe(false);
  });

  test("STOP閾値が強化される", () => {
    const normalContext: GuardrailContext = {
      role: "EXPERIMENT",
      lifecycleStage: "GROW",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };
    const presaleContext: GuardrailContext = {
      ...normalContext,
      salePhase: "PRE_SALE",
      presaleType: "HOLD_BACK",
    };

    const normalGuardrails = getRoleLifecycleGuardrails(normalContext);
    const presaleGuardrails = getRoleLifecycleGuardrails(presaleContext);

    expect(presaleGuardrails.minClicksStop).toBeGreaterThanOrEqual(normalGuardrails.minClicksStop);
  });

  test("BUYING/MIXEDでは補正なし", () => {
    const buyingContext: GuardrailContext = {
      role: "SUPPORT",
      lifecycleStage: "GROW",
      salePhase: "PRE_SALE",
      presaleType: "BUYING",
      lossBudgetState: "SAFE",
    };
    const guardrails = getRoleLifecycleGuardrails(buyingContext);

    expect(guardrails.allowStrongDown).toBe(true);
  });
});

// =============================================================================
// lossBudgetState CRITICAL 補正 テスト
// =============================================================================

describe("lossBudgetState CRITICAL 補正", () => {
  test("SUPPORT: STOP/NEGが強制許可", () => {
    const context: GuardrailContext = {
      role: "SUPPORT",
      lifecycleStage: "LAUNCH_HARD",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "CRITICAL",
    };
    const guardrails = getRoleLifecycleGuardrails(context);

    expect(guardrails.allowStop).toBe(true);
    expect(guardrails.allowNegative).toBe(true);
  });

  test("EXPERIMENT: overspendThresholdStopが緩和", () => {
    const safeContext: GuardrailContext = {
      role: "EXPERIMENT",
      lifecycleStage: "GROW",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };
    const criticalContext: GuardrailContext = {
      ...safeContext,
      lossBudgetState: "CRITICAL",
    };

    const safeGuardrails = getRoleLifecycleGuardrails(safeContext);
    const criticalGuardrails = getRoleLifecycleGuardrails(criticalContext);

    expect(criticalGuardrails.overspendThresholdStop).toBeLessThanOrEqual(
      safeGuardrails.overspendThresholdStop
    );
  });
});

// =============================================================================
// ユーティリティ関数 テスト
// =============================================================================

describe("computeOverspendRatio", () => {
  test("正常なoverspendRatioを計算", () => {
    expect(computeOverspendRatio(0.30, 0.25)).toBeCloseTo(1.2);
    expect(computeOverspendRatio(0.50, 0.25)).toBeCloseTo(2.0);
  });

  test("acosがnullの場合は0を返す", () => {
    expect(computeOverspendRatio(null, 0.25)).toBe(0);
  });

  test("targetAcosが0以下の場合は0を返す", () => {
    expect(computeOverspendRatio(0.30, 0)).toBe(0);
    expect(computeOverspendRatio(0.30, -0.1)).toBe(0);
  });
});

describe("isActionAllowed", () => {
  const guardrails: RoleLifecycleGuardrails = {
    ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS,
    allowStop: false,
    allowNegative: false,
    allowStrongDown: true,
  };

  test("DOWNは常にtrue", () => {
    expect(isActionAllowed("DOWN", guardrails)).toBe(true);
  });

  test("STOPの許可/禁止を反映", () => {
    expect(isActionAllowed("STOP", guardrails)).toBe(false);
  });

  test("NEGATIVEの許可/禁止を反映", () => {
    expect(isActionAllowed("NEGATIVE", guardrails)).toBe(false);
  });

  test("STRONG_DOWNの許可/禁止を反映", () => {
    expect(isActionAllowed("STRONG_DOWN", guardrails)).toBe(true);
  });
});

describe("meetsActionThreshold", () => {
  const guardrails: RoleLifecycleGuardrails = {
    ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS,
    minClicksDown: 30,
    minClicksStrongDown: 50,
    minClicksStop: 80,
    overspendThresholdDown: 1.1,
    overspendThresholdStrongDown: 1.3,
    overspendThresholdStop: 1.6,
  };

  test("DOWN閾値を満たすケース", () => {
    expect(meetsActionThreshold("DOWN", 30, 1.1, guardrails)).toBe(true);
    expect(meetsActionThreshold("DOWN", 35, 1.2, guardrails)).toBe(true);
  });

  test("DOWN閾値を満たさないケース（クリック不足）", () => {
    expect(meetsActionThreshold("DOWN", 29, 1.1, guardrails)).toBe(false);
  });

  test("DOWN閾値を満たさないケース（overspend不足）", () => {
    expect(meetsActionThreshold("DOWN", 30, 1.09, guardrails)).toBe(false);
  });

  test("STRONG_DOWN閾値を満たすケース", () => {
    expect(meetsActionThreshold("STRONG_DOWN", 50, 1.3, guardrails)).toBe(true);
  });

  test("STOP閾値を満たすケース", () => {
    expect(meetsActionThreshold("STOP", 80, 1.6, guardrails)).toBe(true);
  });
});

describe("clipDownRatio", () => {
  test("maxDownStepRatio以下の場合はそのまま返す", () => {
    const guardrails = { ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS, maxDownStepRatio: 0.2 };
    expect(clipDownRatio(0.15, guardrails)).toBe(0.15);
  });

  test("maxDownStepRatioを超える場合はクリップ", () => {
    const guardrails = { ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS, maxDownStepRatio: 0.1 };
    expect(clipDownRatio(0.3, guardrails)).toBe(0.1);
  });
});

describe("fallbackAction", () => {
  test("UP系アクションはそのまま返す", () => {
    const guardrails = { ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS, allowStop: false };
    expect(fallbackAction("STRONG_UP", guardrails, "SUPPORT")).toBe("STRONG_UP");
    expect(fallbackAction("MILD_UP", guardrails, "SUPPORT")).toBe("MILD_UP");
    expect(fallbackAction("KEEP", guardrails, "SUPPORT")).toBe("KEEP");
  });

  test("MILD_DOWNはそのまま返す", () => {
    const guardrails = { ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS, allowStop: false };
    expect(fallbackAction("MILD_DOWN", guardrails, "SUPPORT")).toBe("MILD_DOWN");
  });

  test("STOP禁止の場合、COREはKEEPにフォールバック", () => {
    const guardrails = { ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS, allowStop: false };
    expect(fallbackAction("STOP", guardrails, "CORE")).toBe("KEEP");
  });

  test("STOP禁止の場合、SUPPORTはSTRONG_DOWNにフォールバック（許可時）", () => {
    const guardrails = {
      ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS,
      allowStop: false,
      allowStrongDown: true,
    };
    expect(fallbackAction("STOP", guardrails, "SUPPORT")).toBe("STRONG_DOWN");
  });

  test("STOP禁止かつSTRONG_DOWN禁止の場合、SUPPORTはMILD_DOWNにフォールバック", () => {
    const guardrails = {
      ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS,
      allowStop: false,
      allowStrongDown: false,
    };
    expect(fallbackAction("STOP", guardrails, "SUPPORT")).toBe("MILD_DOWN");
  });

  test("STRONG_DOWN禁止の場合、MILD_DOWNにフォールバック", () => {
    const guardrails = { ...DEFAULT_ROLE_LIFECYCLE_GUARDRAILS, allowStrongDown: false };
    expect(fallbackAction("STRONG_DOWN", guardrails, "SUPPORT")).toBe("MILD_DOWN");
  });
});

// =============================================================================
// 統合シナリオ テスト
// =============================================================================

describe("統合シナリオ", () => {
  test("CORE×LAUNCH_HARD×SAFE: 最も保護的なガードレール", () => {
    const context: GuardrailContext = {
      role: "CORE",
      lifecycleStage: "LAUNCH_HARD",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "SAFE",
    };
    const guardrails = getRoleLifecycleGuardrails(context);

    // 保護的な設定
    expect(guardrails.allowStop).toBe(false);
    expect(guardrails.allowNegative).toBe(false);
    expect(guardrails.allowStrongDown).toBe(false);
    expect(guardrails.minClicksDown).toBe(90);
    expect(guardrails.maxDownStepRatio).toBe(0.1);
  });

  test("EXPERIMENT×HARVEST×CRITICAL: 最も攻撃的なガードレール", () => {
    const context: GuardrailContext = {
      role: "EXPERIMENT",
      lifecycleStage: "HARVEST",
      salePhase: "NORMAL",
      presaleType: "NONE",
      lossBudgetState: "CRITICAL",
    };
    const guardrails = getRoleLifecycleGuardrails(context);

    // 攻撃的な設定
    expect(guardrails.allowStop).toBe(true);
    expect(guardrails.allowNegative).toBe(true);
    expect(guardrails.allowStrongDown).toBe(true);
    expect(guardrails.minClicksDown).toBe(21);
    expect(guardrails.maxDownStepRatio).toBe(0.3);
    // CRITICAL補正でoverspendThresholdStopが緩和
    expect(guardrails.overspendThresholdStop).toBeLessThanOrEqual(1.6);
  });

  test("SUPPORT×GROW×PRE_SALE×HOLD_BACK: 買い控え期間の保護", () => {
    const context: GuardrailContext = {
      role: "SUPPORT",
      lifecycleStage: "GROW",
      salePhase: "PRE_SALE",
      presaleType: "HOLD_BACK",
      lossBudgetState: "SAFE",
    };
    const guardrails = getRoleLifecycleGuardrails(context);

    // STRONG_DOWN禁止
    expect(guardrails.allowStrongDown).toBe(false);
    // STOP閾値強化
    expect(guardrails.minClicksStop).toBeGreaterThanOrEqual(160);
  });
});

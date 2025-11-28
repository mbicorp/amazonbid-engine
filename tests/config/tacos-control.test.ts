/**
 * TACOS × LTV × ライフサイクル制御のテスト
 */
import {
  calculateTheoreticalMaxTacos,
  calculateTheoreticalMaxTacosCapped,
  calculateMaxAdSpendPerUser,
  calculateTheoreticalMaxTacosFromConfig,
  determineTacosZone,
  calculateTacosDelta,
  getStageTacosControlParams,
  buildTacosControlContext,
  adjustTargetAcosByTacos,
  calculateTargetAcosWithTacosAdjustment,
  judgeTacosBasedLifecycle,
  determineBidControlAction,
  clamp,
  ProductConfig,
  TacosControlContext,
  TacosZone,
  SUPPLEMENT_HIGH_LTV_PROFILE,
  SUPPLEMENT_STANDARD_PROFILE,
  SINGLE_PURCHASE_PROFILE,
  DEFAULT_PROFILE,
  GLOBAL_RISK_CONFIG_DEFAULTS,
  TACOS_CONTROL_PARAMS_DEFAULTS,
  LIFECYCLE_TACOS_ZONE_TOLERANCE,
} from "../../src/config/productConfigTypes";

// =============================================================================
// 仕様1: 理論最大TACOSのテスト
// =============================================================================

describe("理論最大TACOS計算（calculateTheoreticalMaxTacos）", () => {
  it("正常なパラメータで理論最大TACOSを計算", () => {
    // marginRate=0.55, repeat=1.7, safety=0.7
    // theoreticalMaxTacos = 0.55 × (1 + 1.7) × 0.7 = 0.55 × 2.7 × 0.7 = 1.0395
    const result = calculateTheoreticalMaxTacos(0.55, 1.7, 0.7);
    expect(result).toBeCloseTo(1.0395, 3);
  });

  it("リピートなし（1.0）の場合", () => {
    // marginRate=0.30, repeat=1.0, safety=0.8
    // theoreticalMaxTacos = 0.30 × (1 + 1.0) × 0.8 = 0.30 × 2.0 × 0.8 = 0.48
    const result = calculateTheoreticalMaxTacos(0.30, 1.0, 0.8);
    expect(result).toBeCloseTo(0.48, 3);
  });

  it("marginRateが0以下の場合は0を返す", () => {
    expect(calculateTheoreticalMaxTacos(0, 1.7, 0.7)).toBe(0);
    expect(calculateTheoreticalMaxTacos(-0.1, 1.7, 0.7)).toBe(0);
  });

  it("リピート回数が1未満の場合は0を返す", () => {
    expect(calculateTheoreticalMaxTacos(0.55, 0.5, 0.7)).toBe(0);
  });

  it("安全係数が0以下の場合は0を返す", () => {
    expect(calculateTheoreticalMaxTacos(0.55, 1.7, 0)).toBe(0);
    expect(calculateTheoreticalMaxTacos(0.55, 1.7, -0.1)).toBe(0);
  });
});

describe("理論最大TACOSキャップ付き（calculateTheoreticalMaxTacosCapped）", () => {
  it("キャップ未満の場合はそのまま返す", () => {
    // marginRate=0.30, repeat=1.0, safety=0.7 → 0.30 × 2.0 × 0.7 = 0.42
    const result = calculateTheoreticalMaxTacosCapped(0.30, 1.0, 0.7, 0.7);
    expect(result).toBeCloseTo(0.42, 3);
  });

  it("キャップ以上の場合はキャップ値を返す", () => {
    // marginRate=0.55, repeat=1.7, safety=0.7 → 1.0395 > 0.7 → 0.7
    const result = calculateTheoreticalMaxTacosCapped(0.55, 1.7, 0.7, 0.7);
    expect(result).toBe(0.7);
  });

  it("デフォルトキャップ（0.7）が適用される", () => {
    const result = calculateTheoreticalMaxTacosCapped(0.55, 1.7, 0.7);
    expect(result).toBe(GLOBAL_RISK_CONFIG_DEFAULTS.tmaxCapGlobal);
  });
});

describe("顧客一人当たり最大広告費（calculateMaxAdSpendPerUser）", () => {
  it("正常なパラメータで最大広告費を計算", () => {
    // price=5000, margin=0.55, repeat=1.7, safety=0.7
    // LTV粗利 = 5000 × 0.55 × 2.7 = 7425
    // maxAdSpend = 7425 × 0.7 = 5197.5
    const result = calculateMaxAdSpendPerUser(5000, 0.55, 1.7, 0.7);
    expect(result).toBeCloseTo(5197.5, 0);
  });

  it("価格が0以下の場合は0を返す", () => {
    expect(calculateMaxAdSpendPerUser(0, 0.55, 1.7, 0.7)).toBe(0);
    expect(calculateMaxAdSpendPerUser(-100, 0.55, 1.7, 0.7)).toBe(0);
  });
});

describe("ProductConfigからの理論最大TACOS計算", () => {
  const baseConfig: ProductConfig = {
    asin: "B001234567",
    isActive: true,
    revenueModel: "LTV",
    lifecycleState: "GROW",
    businessMode: "PROFIT",
    brandType: "GENERIC",
    experimentGroup: "CONTROL",
    ltvMode: "ASSUMED",
    marginRate: 0.3,
    marginRateNormal: 0.55,
    expectedRepeatOrdersAssumed: 1.7,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: 60,
    newCustomersTotal: 100,
    price: 5000,
    isNewProduct: false,
  };

  it("通常商品の場合は設定値を使用", () => {
    const result = calculateTheoreticalMaxTacosFromConfig(
      baseConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    // 0.55 × 2.7 × 0.7 = 1.0395 → cap 0.7
    expect(result.theoreticalMaxTacos).toBeCloseTo(1.0395, 3);
    expect(result.theoreticalMaxTacosCapped).toBe(0.7);
    expect(result.isCapped).toBe(true);
  });

  it("NEW_PRODUCT期間中はprofileのprior値を使用", () => {
    const newProductConfig = { ...baseConfig, isNewProduct: true };
    const result = calculateTheoreticalMaxTacosFromConfig(
      newProductConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    // repeat=1.3, safety=0.5
    // 0.55 × 2.3 × 0.5 = 0.6325
    expect(result.theoreticalMaxTacos).toBeCloseTo(0.6325, 3);
    expect(result.theoreticalMaxTacosCapped).toBeCloseTo(0.6325, 3);
    expect(result.isCapped).toBe(false);
  });

  it("maxAdSpendPerUserも正しく計算される", () => {
    const result = calculateTheoreticalMaxTacosFromConfig(
      baseConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE
    );
    // 5000 × 0.55 × 2.7 × 0.7 = 5197.5
    expect(result.maxAdSpendPerUser).toBeCloseTo(5197.5, 0);
  });
});

// =============================================================================
// 仕様2: TACOSターゲットレンジとゾーン定義のテスト
// =============================================================================

describe("TACOSゾーン判定（determineTacosZone）", () => {
  it("currentTacos <= tacosTargetMid の場合はGREEN", () => {
    expect(determineTacosZone(0.20, 0.35, 0.50)).toBe("GREEN");
    expect(determineTacosZone(0.35, 0.35, 0.50)).toBe("GREEN");
  });

  it("tacosTargetMid < currentTacos <= tacosMax の場合はORANGE", () => {
    expect(determineTacosZone(0.40, 0.35, 0.50)).toBe("ORANGE");
    expect(determineTacosZone(0.50, 0.35, 0.50)).toBe("ORANGE");
  });

  it("currentTacos > tacosMax の場合はRED", () => {
    expect(determineTacosZone(0.51, 0.35, 0.50)).toBe("RED");
    expect(determineTacosZone(0.80, 0.35, 0.50)).toBe("RED");
  });
});

describe("TACOS乖離率計算（calculateTacosDelta）", () => {
  it("currentTacos < tacosTargetMid の場合は正の値", () => {
    // delta = (0.35 - 0.20) / 0.35 = 0.4286
    const result = calculateTacosDelta(0.20, 0.35);
    expect(result).toBeCloseTo(0.4286, 3);
  });

  it("currentTacos == tacosTargetMid の場合は0", () => {
    const result = calculateTacosDelta(0.35, 0.35);
    expect(result).toBe(0);
  });

  it("currentTacos > tacosTargetMid の場合は負の値", () => {
    // delta = (0.35 - 0.50) / 0.35 = -0.4286
    const result = calculateTacosDelta(0.50, 0.35);
    expect(result).toBeCloseTo(-0.4286, 3);
  });

  it("tacosTargetMidが0の場合はepsilonで除算", () => {
    const result = calculateTacosDelta(0.05, 0, 0.01);
    expect(result).toBeCloseTo(-5, 1);
  });
});

describe("ステージ別TACOS制御パラメータ取得", () => {
  it("SUPPLEMENT_HIGH_LTVのGROWパラメータを取得", () => {
    const params = getStageTacosControlParams("SUPPLEMENT_HIGH_LTV", "GROW");
    expect(params.midFactor).toBe(0.75);
    expect(params.tacosAcuity).toBe(1.0);
    expect(params.tacosPenaltyFactorRed).toBe(0.8);
  });

  it("SINGLE_PURCHASEのHARVESTパラメータを取得", () => {
    const params = getStageTacosControlParams("SINGLE_PURCHASE", "HARVEST");
    expect(params.midFactor).toBe(0.75);
    expect(params.tacosAcuity).toBe(1.4);
  });

  it("存在しないプロファイルの場合はDEFAULTを使用", () => {
    const params = getStageTacosControlParams("INVALID" as any, "GROW");
    expect(params).toEqual(TACOS_CONTROL_PARAMS_DEFAULTS.DEFAULT.GROW);
  });
});

describe("TACOS制御コンテキスト構築（buildTacosControlContext）", () => {
  const baseConfig: ProductConfig = {
    asin: "B001234567",
    isActive: true,
    revenueModel: "LTV",
    lifecycleState: "GROW",
    businessMode: "PROFIT",
    brandType: "GENERIC",
    experimentGroup: "CONTROL",
    ltvMode: "ASSUMED",
    marginRate: 0.3,
    marginRateNormal: 0.55,
    expectedRepeatOrdersAssumed: 1.7,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: 60,
    newCustomersTotal: 100,
    price: 5000,
    isNewProduct: false,
    productProfileType: "SUPPLEMENT_HIGH_LTV",
  };

  it("GREENゾーンのコンテキストを構築", () => {
    const ctx = buildTacosControlContext(
      baseConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE,
      0.20 // currentTacos
    );
    expect(ctx.tacosMax).toBe(0.7); // capped
    expect(ctx.tacosTargetMid).toBeCloseTo(0.7 * 0.75, 3); // 0.525
    expect(ctx.tacosZone).toBe("GREEN");
    expect(ctx.tacosDelta).toBeGreaterThan(0);
  });

  it("ORANGEゾーンのコンテキストを構築", () => {
    const ctx = buildTacosControlContext(
      baseConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE,
      0.60 // currentTacos (between mid and max)
    );
    expect(ctx.tacosZone).toBe("ORANGE");
    expect(ctx.tacosDelta).toBeLessThan(0);
  });

  it("REDゾーンのコンテキストを構築", () => {
    const ctx = buildTacosControlContext(
      baseConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE,
      0.80 // currentTacos (above max)
    );
    expect(ctx.tacosZone).toBe("RED");
    expect(ctx.tacosDelta).toBeLessThan(-0.5);
  });

  it("isGrowingCandidateフラグが設定される", () => {
    const ctx = buildTacosControlContext(
      baseConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE,
      0.20,
      GLOBAL_RISK_CONFIG_DEFAULTS,
      true
    );
    expect(ctx.isGrowingCandidate).toBe(true);
  });
});

// =============================================================================
// 仕様3: TACOS乖離によるtargetAcos調整のテスト
// =============================================================================

describe("clamp関数", () => {
  it("値が範囲内の場合はそのまま返す", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("値が最小値未満の場合は最小値を返す", () => {
    expect(clamp(-0.1, 0, 1)).toBe(0);
  });

  it("値が最大値超過の場合は最大値を返す", () => {
    expect(clamp(1.5, 0, 1)).toBe(1);
  });
});

describe("TACOS乖離によるtargetAcos調整（adjustTargetAcosByTacos）", () => {
  it("GREENゾーン（正のdelta）ではtargetAcosが増加", () => {
    const ctx: TacosControlContext = {
      tacosMax: 0.7,
      tacosTargetMid: 0.525,
      currentTacos: 0.30,
      tacosZone: "GREEN",
      tacosDelta: 0.4286, // (0.525 - 0.30) / 0.525
      controlParams: {
        midFactor: 0.75,
        tacosAcuity: 1.0,
        tacosPenaltyFactorRed: 0.8,
        stageAcosMin: 0.10,
        stageAcosMax: 0.60,
      },
    };

    const result = adjustTargetAcosByTacos(0.50, ctx);
    // adjustmentFactor = 1 + 1.0 × 0.4286 = 1.4286
    // rawTargetAcos = 0.50 × 1.4286 = 0.7143
    // clamped to stageAcosMax = 0.60
    expect(result.adjustmentFactor).toBeCloseTo(1.4286, 3);
    expect(result.targetAcos).toBe(0.60);
    expect(result.redPenaltyApplied).toBe(false);
  });

  it("ORANGEゾーン（負のdelta）ではtargetAcosが減少", () => {
    const ctx: TacosControlContext = {
      tacosMax: 0.7,
      tacosTargetMid: 0.525,
      currentTacos: 0.60,
      tacosZone: "ORANGE",
      tacosDelta: -0.1429, // (0.525 - 0.60) / 0.525
      controlParams: {
        midFactor: 0.75,
        tacosAcuity: 1.0,
        tacosPenaltyFactorRed: 0.8,
        stageAcosMin: 0.10,
        stageAcosMax: 0.60,
      },
    };

    const result = adjustTargetAcosByTacos(0.50, ctx);
    // adjustmentFactor = 1 + 1.0 × (-0.1429) = 0.8571
    // rawTargetAcos = 0.50 × 0.8571 = 0.4286
    expect(result.adjustmentFactor).toBeCloseTo(0.8571, 3);
    expect(result.targetAcos).toBeCloseTo(0.4286, 3);
    expect(result.redPenaltyApplied).toBe(false);
  });

  it("REDゾーンではペナルティが適用される", () => {
    const ctx: TacosControlContext = {
      tacosMax: 0.7,
      tacosTargetMid: 0.525,
      currentTacos: 0.80,
      tacosZone: "RED",
      tacosDelta: -0.5238, // (0.525 - 0.80) / 0.525
      controlParams: {
        midFactor: 0.75,
        tacosAcuity: 1.0,
        tacosPenaltyFactorRed: 0.8,
        stageAcosMin: 0.10,
        stageAcosMax: 0.60,
      },
    };

    const result = adjustTargetAcosByTacos(0.50, ctx);
    // penaltyLimit = 0.7 × 0.8 = 0.56
    // rawTargetAcos would be 0.50 × 0.4762 = 0.2381
    // but penalty doesn't apply since 0.2381 < 0.56
    expect(result.tacosZone).toBe("RED");
    // targetAcos should be clamped but not further penalized in this case
    expect(result.targetAcos).toBeGreaterThan(0.10);
  });

  it("stageAcosMinでクランプされる", () => {
    const ctx: TacosControlContext = {
      tacosMax: 0.7,
      tacosTargetMid: 0.525,
      currentTacos: 0.80,
      tacosZone: "RED",
      tacosDelta: -0.9, // 大きな負の値
      controlParams: {
        midFactor: 0.75,
        tacosAcuity: 2.0,
        tacosPenaltyFactorRed: 0.8,
        stageAcosMin: 0.15,
        stageAcosMax: 0.60,
      },
    };

    const result = adjustTargetAcosByTacos(0.50, ctx);
    // adjustmentFactor = 1 + 2.0 × (-0.9) = -0.8
    // rawTargetAcos = 0.50 × -0.8 = -0.4 → clamped to 0.15
    expect(result.targetAcos).toBe(0.15);
  });
});

describe("ProductConfigからのtargetAcos計算（calculateTargetAcosWithTacosAdjustment）", () => {
  const baseConfig: ProductConfig = {
    asin: "B001234567",
    isActive: true,
    revenueModel: "LTV",
    lifecycleState: "GROW",
    businessMode: "PROFIT",
    brandType: "GENERIC",
    experimentGroup: "CONTROL",
    ltvMode: "ASSUMED",
    marginRate: 0.3,
    marginRateNormal: 0.55,
    expectedRepeatOrdersAssumed: 1.7,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: 60,
    newCustomersTotal: 100,
    price: 5000,
    isNewProduct: false,
  };

  it("baseLtvAcosが正しく計算される", () => {
    const ctx: TacosControlContext = {
      tacosMax: 0.7,
      tacosTargetMid: 0.525,
      currentTacos: 0.30,
      tacosZone: "GREEN",
      tacosDelta: 0.4286,
      controlParams: getStageTacosControlParams("SUPPLEMENT_HIGH_LTV", "GROW"),
    };

    const result = calculateTargetAcosWithTacosAdjustment(
      baseConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE,
      ctx
    );
    // baseLtvAcos = 0.55 × 2.7 × 0.7 = 1.0395
    expect(result.baseLtvAcos).toBeCloseTo(1.0395, 3);
  });

  it("NEW_PRODUCT期間中はprior値を使用", () => {
    const newConfig = { ...baseConfig, isNewProduct: true };
    const ctx: TacosControlContext = {
      tacosMax: 0.7,
      tacosTargetMid: 0.525,
      currentTacos: 0.30,
      tacosZone: "GREEN",
      tacosDelta: 0.4286,
      controlParams: getStageTacosControlParams("SUPPLEMENT_HIGH_LTV", "GROW"),
    };

    const result = calculateTargetAcosWithTacosAdjustment(
      newConfig,
      SUPPLEMENT_HIGH_LTV_PROFILE,
      ctx
    );
    // baseLtvAcos = 0.55 × 2.3 × 0.5 = 0.6325
    expect(result.baseLtvAcos).toBeCloseTo(0.6325, 3);
  });
});

// =============================================================================
// 仕様4: ライフサイクルとの連動ポイントのテスト
// =============================================================================

describe("ライフサイクル別TACOSゾーン許容設定", () => {
  it("LAUNCH_HARDはORANGEとREDを許容", () => {
    const tolerance = LIFECYCLE_TACOS_ZONE_TOLERANCE.LAUNCH_HARD;
    expect(tolerance.tolerateOrange).toBe(true);
    expect(tolerance.tolerateRed).toBe(true);
    expect(tolerance.orangeToleranceMonths).toBe(3);
    expect(tolerance.redToleranceMonthsForGrowth).toBe(2);
  });

  it("HARVESTはORANGEもREDも許容しない", () => {
    const tolerance = LIFECYCLE_TACOS_ZONE_TOLERANCE.HARVEST;
    expect(tolerance.tolerateOrange).toBe(false);
    expect(tolerance.tolerateRed).toBe(false);
    expect(tolerance.orangeToleranceMonths).toBe(0);
  });
});

describe("TACOSベースのライフサイクル判定（judgeTacosBasedLifecycle）", () => {
  const greenCtx: TacosControlContext = {
    tacosMax: 0.7,
    tacosTargetMid: 0.525,
    currentTacos: 0.30,
    tacosZone: "GREEN",
    tacosDelta: 0.4286,
    controlParams: getStageTacosControlParams("SUPPLEMENT_HIGH_LTV", "GROW"),
  };

  const orangeCtx: TacosControlContext = {
    tacosMax: 0.7,
    tacosTargetMid: 0.525,
    currentTacos: 0.60,
    tacosZone: "ORANGE",
    tacosDelta: -0.1429,
    controlParams: getStageTacosControlParams("SUPPLEMENT_HIGH_LTV", "GROW"),
    orangeZoneMonths: 2,
  };

  const redCtx: TacosControlContext = {
    tacosMax: 0.7,
    tacosTargetMid: 0.525,
    currentTacos: 0.80,
    tacosZone: "RED",
    tacosDelta: -0.5238,
    controlParams: getStageTacosControlParams("SUPPLEMENT_HIGH_LTV", "GROW"),
    redZoneMonths: 1,
  };

  it("LAUNCH_HARD × GREENは継続推奨", () => {
    const result = judgeTacosBasedLifecycle(greenCtx, "LAUNCH_HARD");
    expect(result.stateChangeRecommended).toBe(false);
    expect(result.bidReductionRecommended).toBe(false);
    expect(result.targetAcosTighteningRecommended).toBe(false);
    expect(result.reasons).toContain("GREENゾーン: 健全な状態、LAUNCH_HARD継続");
  });

  it("LAUNCH_HARD × REDで成長候補なしは移行推奨", () => {
    const ctx = { ...redCtx, isGrowingCandidate: false };
    const result = judgeTacosBasedLifecycle(ctx, "LAUNCH_HARD");
    expect(result.stateChangeRecommended).toBe(true);
    expect(result.recommendedState).toBe("LAUNCH_SOFT");
    expect(result.targetAcosTighteningRecommended).toBe(true);
  });

  it("LAUNCH_HARD × REDで成長候補ありは許容", () => {
    const ctx = { ...redCtx, isGrowingCandidate: true, redZoneMonths: 1 };
    const result = judgeTacosBasedLifecycle(ctx, "LAUNCH_HARD");
    expect(result.stateChangeRecommended).toBe(false);
    expect(result.targetAcosTighteningRecommended).toBe(true);
  });

  it("GROW × ORANGEで許容月数超過は入札削減推奨", () => {
    const ctx = { ...orangeCtx, orangeZoneMonths: 2 };
    const result = judgeTacosBasedLifecycle(ctx, "GROW");
    expect(result.bidReductionRecommended).toBe(true);
    expect(result.targetAcosTighteningRecommended).toBe(true);
  });

  it("GROW × REDはHARVEST移行検討", () => {
    const result = judgeTacosBasedLifecycle(redCtx, "GROW");
    expect(result.stateChangeRecommended).toBe(true);
    expect(result.recommendedState).toBe("HARVEST");
    expect(result.bidReductionRecommended).toBe(true);
  });

  it("HARVEST × ORANGEは入札削減推奨", () => {
    const result = judgeTacosBasedLifecycle(orangeCtx, "HARVEST");
    expect(result.bidReductionRecommended).toBe(true);
    expect(result.warnings).toContain("ORANGEゾーン: HARVESTでは許容しない、入札削減推奨");
  });

  it("HARVEST × REDは入札停止推奨", () => {
    const result = judgeTacosBasedLifecycle(redCtx, "HARVEST");
    expect(result.bidStopRecommended).toBe(true);
    expect(result.warnings).toContain("REDゾーン: 入札停止フラグ推奨");
  });
});

describe("入札制御アクション決定（determineBidControlAction）", () => {
  const greenCtx: TacosControlContext = {
    tacosMax: 0.7,
    tacosTargetMid: 0.525,
    currentTacos: 0.30,
    tacosZone: "GREEN",
    tacosDelta: 0.4286,
    controlParams: getStageTacosControlParams("SUPPLEMENT_HIGH_LTV", "GROW"),
  };

  const redCtx: TacosControlContext = {
    tacosMax: 0.7,
    tacosTargetMid: 0.525,
    currentTacos: 0.80,
    tacosZone: "RED",
    tacosDelta: -0.5238,
    controlParams: getStageTacosControlParams("SUPPLEMENT_HIGH_LTV", "GROW"),
  };

  it("入札停止推奨の場合はstopBidding=true", () => {
    const judgment = {
      currentState: "HARVEST" as const,
      recommendedState: "HARVEST" as const,
      stateChangeRecommended: false,
      bidReductionRecommended: true,
      bidStopRecommended: true,
      targetAcosTighteningRecommended: true,
      reasons: [],
      warnings: [],
    };

    const action = determineBidControlAction(judgment, redCtx);
    expect(action.stopBidding).toBe(true);
    expect(action.bidMultiplierAdjustment).toBe(0);
  });

  it("REDゾーンでの入札削減は20%", () => {
    const judgment = {
      currentState: "GROW" as const,
      recommendedState: "HARVEST" as const,
      stateChangeRecommended: true,
      bidReductionRecommended: true,
      bidStopRecommended: false,
      targetAcosTighteningRecommended: true,
      reasons: [],
      warnings: [],
    };

    const action = determineBidControlAction(judgment, redCtx);
    expect(action.bidMultiplierAdjustment).toBe(0.8);
    expect(action.stopBidding).toBe(false);
  });

  it("targetAcos引き締めはdeltaに応じて決定", () => {
    const judgment = {
      currentState: "GROW" as const,
      recommendedState: "GROW" as const,
      stateChangeRecommended: false,
      bidReductionRecommended: false,
      bidStopRecommended: false,
      targetAcosTighteningRecommended: true,
      reasons: [],
      warnings: [],
    };

    const action = determineBidControlAction(judgment, redCtx);
    // delta = -0.5238, tighteningRate = min(0.5238 × 0.5, 0.2) = 0.2
    // targetAcosAdjustment = 1 - 0.2 = 0.8
    expect(action.targetAcosAdjustment).toBeCloseTo(0.8, 2);
  });

  it("GREENゾーンでは調整なし", () => {
    const judgment = {
      currentState: "GROW" as const,
      recommendedState: "GROW" as const,
      stateChangeRecommended: false,
      bidReductionRecommended: false,
      bidStopRecommended: false,
      targetAcosTighteningRecommended: false,
      reasons: [],
      warnings: [],
    };

    const action = determineBidControlAction(judgment, greenCtx);
    expect(action.bidMultiplierAdjustment).toBe(1.0);
    expect(action.targetAcosAdjustment).toBe(1.0);
    expect(action.stopBidding).toBe(false);
  });
});

// =============================================================================
// 設定値の確認テスト
// =============================================================================

describe("グローバルリスク設定のデフォルト値", () => {
  it("tmaxCapGlobalのデフォルトは0.7", () => {
    expect(GLOBAL_RISK_CONFIG_DEFAULTS.tmaxCapGlobal).toBe(0.7);
  });
});

describe("各プロファイルのTACOS制御パラメータ", () => {
  it("SUPPLEMENT_HIGH_LTVのLAUNCH_HARDは積極的", () => {
    const params = TACOS_CONTROL_PARAMS_DEFAULTS.SUPPLEMENT_HIGH_LTV.LAUNCH_HARD;
    expect(params.midFactor).toBe(0.70);
    expect(params.tacosAcuity).toBe(0.8);
    expect(params.stageAcosMax).toBe(0.80);
  });

  it("SUPPLEMENT_HIGH_LTVのHARVESTは保守的", () => {
    const params = TACOS_CONTROL_PARAMS_DEFAULTS.SUPPLEMENT_HIGH_LTV.HARVEST;
    expect(params.midFactor).toBe(0.80);
    expect(params.tacosAcuity).toBe(1.2);
    expect(params.stageAcosMax).toBe(0.40);
  });

  it("SINGLE_PURCHASEはより厳格", () => {
    const params = TACOS_CONTROL_PARAMS_DEFAULTS.SINGLE_PURCHASE.GROW;
    expect(params.tacosAcuity).toBe(1.2);
    expect(params.stageAcosMax).toBe(0.35);
  });
});

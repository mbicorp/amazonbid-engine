/**
 * ターゲットACOS計算モジュールのテスト
 */

import {
  getStageTacos,
  computeTStageWithSalePhase,
  computeAdSalesShare,
  convertTacosToAcos,
  getLtvStageFactor,
  computeTargetAcosFromLtv,
  computeIntegratedTargetAcos,
  buildTStageParams,
  computeTargetAcosSimple,
} from "../../src/tacos-acos/target-acos-calculator";
import {
  TargetAcosContext,
  TargetAcosConfig,
  DEFAULT_TARGET_ACOS_CONFIG,
} from "../../src/tacos-acos/types";

describe("getStageTacos", () => {
  const tLaunch = 0.20;
  const tGrow = 0.15;
  const tHarvest = 0.10;

  it("LAUNCH_HARD ステージでは T_launch を返す", () => {
    expect(getStageTacos("LAUNCH_HARD", tLaunch, tGrow, tHarvest)).toBe(0.20);
  });

  it("LAUNCH_SOFT ステージでは T_launch を返す", () => {
    expect(getStageTacos("LAUNCH_SOFT", tLaunch, tGrow, tHarvest)).toBe(0.20);
  });

  it("GROW ステージでは T_grow を返す", () => {
    expect(getStageTacos("GROW", tLaunch, tGrow, tHarvest)).toBe(0.15);
  });

  it("HARVEST ステージでは T_harvest を返す", () => {
    expect(getStageTacos("HARVEST", tLaunch, tGrow, tHarvest)).toBe(0.10);
  });
});

describe("computeTStageWithSalePhase", () => {
  const stageTacos = 0.15;
  const config = DEFAULT_TARGET_ACOS_CONFIG;

  it("NORMAL フェーズでは stageTacos をそのまま使用", () => {
    const result = computeTStageWithSalePhase(stageTacos, "NORMAL", config);
    expect(result.tStageUsed).toBe(0.15);
    expect(result.tStageSmode).toBeCloseTo(0.15 * 1.3, 4);
  });

  it("PRE_SALE フェーズでは stageTacos をそのまま使用", () => {
    const result = computeTStageWithSalePhase(stageTacos, "PRE_SALE", config);
    expect(result.tStageUsed).toBe(0.15);
  });

  it("MAIN_SALE フェーズでは T_stage_smode を使用", () => {
    const result = computeTStageWithSalePhase(stageTacos, "MAIN_SALE", config);
    expect(result.tStageUsed).toBeCloseTo(0.15 * 1.3, 4);
    expect(result.tStageSmode).toBeCloseTo(0.15 * 1.3, 4);
  });

  it("COOL_DOWN フェーズでは stageTacos をそのまま使用", () => {
    const result = computeTStageWithSalePhase(stageTacos, "COOL_DOWN", config);
    expect(result.tStageUsed).toBe(0.15);
  });
});

describe("computeAdSalesShare", () => {
  const config = DEFAULT_TARGET_ACOS_CONFIG;

  it("salesTotal が閾値未満の場合はデフォルト値を返す", () => {
    const result = computeAdSalesShare(50000, 15000, config);
    expect(result.effectiveShare).toBe(config.adSalesShareDefault);
    expect(result.rawShare).toBe(0);
  });

  it("salesTotal が閾値以上の場合は計算値を返す", () => {
    const result = computeAdSalesShare(200000, 60000, config);
    expect(result.rawShare).toBeCloseTo(0.30, 4);
    expect(result.effectiveShare).toBeCloseTo(0.30, 4);
  });

  it("計算値が最小値未満の場合は最小値を返す", () => {
    const result = computeAdSalesShare(200000, 10000, config);
    // rawShare = 10000 / 200000 = 0.05 < adSalesShareMin (0.1)
    expect(result.rawShare).toBeCloseTo(0.05, 4);
    expect(result.effectiveShare).toBe(config.adSalesShareMin);
  });
});

describe("convertTacosToAcos", () => {
  it("TACOSを広告売上シェアで割ってACOSに変換する", () => {
    // TACOS 15%, 広告売上シェア 30% → ACOS = 15% / 30% = 50%
    expect(convertTacosToAcos(0.15, 0.30)).toBeCloseTo(0.50, 4);
  });

  it("広告売上シェアが0の場合は0を返す", () => {
    expect(convertTacosToAcos(0.15, 0)).toBe(0);
  });

  it("広告売上シェアが低いとACOSが高くなる", () => {
    // TACOS 15%, 広告売上シェア 10% → ACOS = 15% / 10% = 150%
    expect(convertTacosToAcos(0.15, 0.10)).toBeCloseTo(1.50, 4);
  });
});

describe("getLtvStageFactor", () => {
  const config = DEFAULT_TARGET_ACOS_CONFIG;

  it("LAUNCH_HARD では ltvLaunchFactor を返す", () => {
    expect(getLtvStageFactor("LAUNCH_HARD", config)).toBe(config.ltvLaunchFactor);
  });

  it("LAUNCH_SOFT では ltvLaunchFactor を返す", () => {
    expect(getLtvStageFactor("LAUNCH_SOFT", config)).toBe(config.ltvLaunchFactor);
  });

  it("GROW では ltvGrowFactor を返す", () => {
    expect(getLtvStageFactor("GROW", config)).toBe(config.ltvGrowFactor);
  });

  it("HARVEST では ltvHarvestFactor を返す", () => {
    expect(getLtvStageFactor("HARVEST", config)).toBe(config.ltvHarvestFactor);
  });
});

describe("computeTargetAcosFromLtv", () => {
  const config = DEFAULT_TARGET_ACOS_CONFIG;

  it("LTV ACOSにステージ係数を適用する", () => {
    const result = computeTargetAcosFromLtv(0.40, "LAUNCH_HARD", null, config);
    // 0.40 × 1.1 = 0.44
    expect(result.adjustedLtvAcos).toBeCloseTo(0.44, 4);
    expect(result.cappedLtvAcos).toBeCloseTo(0.44, 4);
  });

  it("ltvHardCap が設定されている場合は上限を適用する", () => {
    const result = computeTargetAcosFromLtv(0.40, "LAUNCH_HARD", 0.35, config);
    expect(result.adjustedLtvAcos).toBeCloseTo(0.44, 4);
    expect(result.cappedLtvAcos).toBe(0.35);
  });

  it("HARVEST では係数が下がる", () => {
    const result = computeTargetAcosFromLtv(0.40, "HARVEST", null, config);
    // 0.40 × 0.9 = 0.36
    expect(result.adjustedLtvAcos).toBeCloseTo(0.36, 4);
  });
});

describe("computeIntegratedTargetAcos", () => {
  const baseContext: TargetAcosContext = {
    marginPotential: 0.55,
    tOpt: 0.15,
    tLaunch: 0.195, // 0.15 × 1.3
    tGrow: 0.15,
    tHarvest: 0.1125, // 0.15 × 0.75
    lifecycleStage: "GROW",
    salePhase: "NORMAL",
    salesTotal30d: 300000,
    adSales30d: 90000, // 30%シェア
    baseLtvAcos: 0.40,
    ltvHardCap: null,
  };

  it("TACOSモデルとLTVモデルの厳しい方を採用する", () => {
    const result = computeIntegratedTargetAcos(baseContext);

    // TACOS → ACOS: 0.15 / 0.30 = 0.50
    // LTV ACOS: 0.40 × 1.0 = 0.40
    // min(0.50, 0.40) = 0.40
    expect(result.targetAcosFromTacos).toBeCloseTo(0.50, 4);
    expect(result.targetAcosFromLtv).toBeCloseTo(0.40, 4);
    expect(result.finalTargetAcos).toBeCloseTo(0.40, 4);
    expect(result.tacosModelSelected).toBe(false); // LTVモデルが採用
  });

  it("TACOSモデルの方が厳しい場合はそちらを採用", () => {
    const context: TargetAcosContext = {
      ...baseContext,
      adSales30d: 150000, // 50%シェア
      baseLtvAcos: 0.50,
    };
    const result = computeIntegratedTargetAcos(context);

    // TACOS → ACOS: 0.15 / 0.50 = 0.30
    // LTV ACOS: 0.50 × 1.0 = 0.50
    // min(0.30, 0.50) = 0.30
    expect(result.targetAcosFromTacos).toBeCloseTo(0.30, 4);
    expect(result.finalTargetAcos).toBeCloseTo(0.30, 4);
    expect(result.tacosModelSelected).toBe(true);
  });

  it("MAIN_SALEフェーズでは T_stage_smode を使用", () => {
    const context: TargetAcosContext = {
      ...baseContext,
      salePhase: "MAIN_SALE",
    };
    const result = computeIntegratedTargetAcos(context);

    // T_stage_smode = 0.15 × 1.3 = 0.195
    // TACOS → ACOS: 0.195 / 0.30 = 0.65
    expect(result.tStageUsed).toBeCloseTo(0.195, 4);
    expect(result.targetAcosFromTacos).toBeCloseTo(0.65, 4);
  });

  it("グローバルACOS上限を超える場合はクリップされる", () => {
    const context: TargetAcosContext = {
      ...baseContext,
      tGrow: 0.50, // 非常に高いTACOS
      baseLtvAcos: 0.90,
    };
    const result = computeIntegratedTargetAcos(context);

    // 計算上は高いACOSになるが、globalAcosMax (0.80) でクリップ
    expect(result.breakdown.wasClipped).toBe(true);
    expect(result.finalTargetAcos).toBe(DEFAULT_TARGET_ACOS_CONFIG.globalAcosMax);
  });

  it("グローバルACOS下限を下回る場合はクリップされる", () => {
    const customConfig: TargetAcosConfig = {
      ...DEFAULT_TARGET_ACOS_CONFIG,
      globalAcosMin: 0.10,
    };
    const context: TargetAcosContext = {
      ...baseContext,
      tGrow: 0.01, // 非常に低いTACOS
      baseLtvAcos: 0.05,
    };
    const result = computeIntegratedTargetAcos(context, customConfig);

    expect(result.breakdown.wasClipped).toBe(true);
    expect(result.finalTargetAcos).toBe(0.10);
  });
});

describe("buildTStageParams", () => {
  it("T_opt と marginPotential から T_stage パラメータを構築する", () => {
    const result = buildTStageParams(0.15, 0.55);

    // T_launch = min(0.55, 0.15 × 1.30) = min(0.55, 0.195) = 0.195
    expect(result.tLaunch).toBeCloseTo(0.195, 4);

    // T_grow = T_opt = 0.15
    expect(result.tGrow).toBe(0.15);

    // T_harvest = max(0, 0.15 × 0.75) = 0.1125
    expect(result.tHarvest).toBeCloseTo(0.1125, 4);
  });

  it("T_launch が marginPotential を超えないようクリップする", () => {
    const result = buildTStageParams(0.50, 0.40);

    // T_launch = min(0.40, 0.50 × 1.30) = min(0.40, 0.65) = 0.40
    expect(result.tLaunch).toBe(0.40);
  });

  it("カスタムのアルファ値を使用できる", () => {
    const result = buildTStageParams(0.20, 0.55, 0.50, 0.30);

    // T_launch = min(0.55, 0.20 × 1.50) = 0.30
    expect(result.tLaunch).toBeCloseTo(0.30, 4);

    // T_harvest = max(0, 0.20 × 0.70) = 0.14
    expect(result.tHarvest).toBeCloseTo(0.14, 4);
  });
});

describe("computeTargetAcosSimple", () => {
  it("基本パラメータからターゲットACOSを計算する", () => {
    const result = computeTargetAcosSimple(
      0.15,      // tOpt
      0.55,      // marginPotential
      "GROW",    // lifecycleStage
      "NORMAL",  // salePhase
      300000,    // salesTotal30d
      90000,     // adSales30d (30%)
      0.40       // baseLtvAcos
    );

    // TACOS → ACOS: 0.15 / 0.30 = 0.50
    // LTV ACOS: 0.40 × 1.0 = 0.40
    // min(0.50, 0.40) = 0.40
    expect(result).toBeCloseTo(0.40, 4);
  });
});

describe("エッジケース", () => {
  it("salesTotal30d が 0 の場合はデフォルト広告売上シェアを使用", () => {
    const context: TargetAcosContext = {
      marginPotential: 0.55,
      tOpt: 0.15,
      tLaunch: 0.195,
      tGrow: 0.15,
      tHarvest: 0.1125,
      lifecycleStage: "GROW",
      salePhase: "NORMAL",
      salesTotal30d: 0,
      adSales30d: 0,
      baseLtvAcos: 0.40,
      ltvHardCap: null,
    };
    const result = computeIntegratedTargetAcos(context);

    expect(result.adSalesShareUsed).toBe(DEFAULT_TARGET_ACOS_CONFIG.adSalesShareDefault);
  });

  it("全てのライフサイクルステージで計算が成功する", () => {
    const stages = ["LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"] as const;

    for (const stage of stages) {
      const context: TargetAcosContext = {
        marginPotential: 0.55,
        tOpt: 0.15,
        tLaunch: 0.195,
        tGrow: 0.15,
        tHarvest: 0.1125,
        lifecycleStage: stage,
        salePhase: "NORMAL",
        salesTotal30d: 300000,
        adSales30d: 90000,
        baseLtvAcos: 0.40,
        ltvHardCap: null,
      };
      const result = computeIntegratedTargetAcos(context);

      expect(result.finalTargetAcos).toBeGreaterThan(0);
      expect(result.finalTargetAcos).toBeLessThanOrEqual(DEFAULT_TARGET_ACOS_CONFIG.globalAcosMax);
    }
  });

  it("全てのセールフェーズで計算が成功する", () => {
    const phases = ["NORMAL", "PRE_SALE", "MAIN_SALE", "COOL_DOWN"] as const;

    for (const phase of phases) {
      const context: TargetAcosContext = {
        marginPotential: 0.55,
        tOpt: 0.15,
        tLaunch: 0.195,
        tGrow: 0.15,
        tHarvest: 0.1125,
        lifecycleStage: "GROW",
        salePhase: phase,
        salesTotal30d: 300000,
        adSales30d: 90000,
        baseLtvAcos: 0.40,
        ltvHardCap: null,
      };
      const result = computeIntegratedTargetAcos(context);

      expect(result.finalTargetAcos).toBeGreaterThan(0);
    }
  });
});

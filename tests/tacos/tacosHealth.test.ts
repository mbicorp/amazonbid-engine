/**
 * TACOS健全性モジュール テスト
 */

import {
  DailyTacosMetrics,
  TacosOptimizationConfig,
  DEFAULT_TACOS_OPTIMIZATION_CONFIG,
  estimateOptimalTacos,
  computeTacosHealthScore,
  computeStrongUpMultiplierFromTacosHealth,
  computeStrongUpMultiplierWithDetails,
  calculateTacos90d,
  getProductTacosConfigForProfile,
  evaluateTacosHealth,
  DEFAULT_STRONG_UP_MULTIPLIER_CONFIG,
  PRODUCT_TACOS_CONFIG_DEFAULTS,
  DEFAULT_PRODUCT_TACOS_CONFIG,
  determineTacosZone,
  applyStrongUpGate,
  calculateTacosMaxForControl,
  TacosZone,
} from "../../src/tacos/tacosHealth";

describe("TACOS健全性モジュール", () => {
  // テスト用のヘルパー関数
  const createDailyMetrics = (
    date: string,
    revenue: number,
    adSpend: number
  ): DailyTacosMetrics => ({
    date,
    revenue,
    adSpend,
  });

  const createDaysWithTacos = (
    tacos: number,
    days: number,
    baseRevenue: number = 100000
  ): DailyTacosMetrics[] => {
    const result: DailyTacosMetrics[] = [];
    for (let i = 0; i < days; i++) {
      const date = `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
      result.push({
        date,
        revenue: baseRevenue,
        adSpend: baseRevenue * tacos,
      });
    }
    return result;
  };

  describe("estimateOptimalTacos", () => {
    it("有効なデータがない場合はnullを返す", () => {
      const result = estimateOptimalTacos([]);
      expect(result.tacosTargetMid).toBeNull();
      expect(result.tacosAggressiveCap).toBeNull();
      expect(result.validBinCount).toBe(0);
    });

    it("売上がゼロの日は除外される", () => {
      const daily: DailyTacosMetrics[] = [
        createDailyMetrics("2024-01-01", 0, 1000),
        createDailyMetrics("2024-01-02", 0, 2000),
      ];
      const result = estimateOptimalTacos(daily);
      expect(result.tacosTargetMid).toBeNull();
      expect(result.calculationNote).toContain("有効なデータがありません");
    });

    it("TACOS範囲外の日は除外される", () => {
      const config: TacosOptimizationConfig = {
        ...DEFAULT_TACOS_OPTIMIZATION_CONFIG,
        minTacos: 0.10,
        maxTacos: 0.30,
      };
      // TACOS = 50% は範囲外
      const daily: DailyTacosMetrics[] = [
        createDailyMetrics("2024-01-01", 10000, 5000), // 50%
      ];
      const result = estimateOptimalTacos(daily, config);
      expect(result.tacosTargetMid).toBeNull();
    });

    it("ビンあたりの最低日数に満たない場合は無効", () => {
      const config: TacosOptimizationConfig = {
        ...DEFAULT_TACOS_OPTIMIZATION_CONFIG,
        minDaysPerBin: 5,
      };
      // 各ビンに2日しかない
      const daily = [
        ...createDaysWithTacos(0.10, 2),
        ...createDaysWithTacos(0.15, 2),
      ];
      const result = estimateOptimalTacos(daily, config);
      expect(result.tacosTargetMid).toBeNull();
      expect(result.calculationNote).toContain("有効なビンがありません");
    });

    it("利益最大のTACOS帯を正しく特定する", () => {
      // marginPotential=0.55の場合
      // TACOS=0.10 → 利益率=0.55-0.10=0.45
      // TACOS=0.20 → 利益率=0.55-0.20=0.35
      // TACOS=0.30 → 利益率=0.55-0.30=0.25
      // 低いTACOSのほうが利益が高い
      const config: TacosOptimizationConfig = {
        ...DEFAULT_TACOS_OPTIMIZATION_CONFIG,
        marginPotential: 0.55,
        binWidth: 0.05,
        minDaysPerBin: 3,
      };
      const daily = [
        ...createDaysWithTacos(0.10, 5),
        ...createDaysWithTacos(0.20, 5),
        ...createDaysWithTacos(0.30, 5),
      ];
      const result = estimateOptimalTacos(daily, config);

      expect(result.tacosTargetMid).not.toBeNull();
      // 最も利益が高いのは0.10前後のビン
      expect(result.tacosTargetMid!).toBeCloseTo(0.10, 1);
      expect(result.tacosAggressiveCap).toBeCloseTo(0.10 + config.theoreticalMaxOffset, 1);
    });

    it("全ビンが赤字の場合はnullを返す", () => {
      // marginPotential=0.10だと、TACOS=0.15でも赤字
      const config: TacosOptimizationConfig = {
        ...DEFAULT_TACOS_OPTIMIZATION_CONFIG,
        marginPotential: 0.10,
        minDaysPerBin: 3,
      };
      const daily = createDaysWithTacos(0.15, 10);
      const result = estimateOptimalTacos(daily, config);
      expect(result.tacosTargetMid).toBeNull();
      expect(result.calculationNote).toContain("平均利益が0以下");
    });

    it("theoreticalMaxOffset が正しく適用される", () => {
      const config: TacosOptimizationConfig = {
        ...DEFAULT_TACOS_OPTIMIZATION_CONFIG,
        theoreticalMaxOffset: 0.08,
        minDaysPerBin: 3,
      };
      const daily = createDaysWithTacos(0.15, 10);
      const result = estimateOptimalTacos(daily, config);

      if (result.tacosTargetMid !== null) {
        expect(result.tacosAggressiveCap).toBeCloseTo(
          result.tacosTargetMid + 0.08,
          2
        );
      }
    });
  });

  describe("computeTacosHealthScore", () => {
    it("tacos90dがnullの場合はニュートラル（0）を返す", () => {
      const result = computeTacosHealthScore({
        tacos90d: null,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      expect(result.score).toBe(0);
      expect(result.healthZone).toBe("NEUTRAL");
    });

    it("tacos90dが0以下の場合はニュートラルを返す", () => {
      const result = computeTacosHealthScore({
        tacos90d: 0,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      expect(result.score).toBe(0);
    });

    it("tacosLow以下の場合はスコア+1（EXCELLENT）", () => {
      // tacosLow = 0.15 - 0.06 = 0.09
      const result = computeTacosHealthScore({
        tacos90d: 0.08,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      expect(result.score).toBe(1);
      expect(result.healthZone).toBe("EXCELLENT");
    });

    it("tacosHigh以上の場合はスコア-1（CRITICAL）", () => {
      const result = computeTacosHealthScore({
        tacos90d: 0.25,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      expect(result.score).toBe(-1);
      expect(result.healthZone).toBe("CRITICAL");
    });

    it("tacosMidちょうどの場合はスコア0に近い", () => {
      const result = computeTacosHealthScore({
        tacos90d: 0.15,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      // tacosLow=0.09, tacosMid=0.15の範囲で0.15はちょうど境界
      // score = 1 - (0.15 - 0.09) / (0.15 - 0.09) = 0
      expect(result.score).toBeCloseTo(0, 1);
    });

    it("tacosLowとtacosMidの中間はスコア0.5付近", () => {
      // tacosLow = 0.09, tacosMid = 0.15
      // 中間 = 0.12
      const result = computeTacosHealthScore({
        tacos90d: 0.12,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      // score = 1 - (0.12 - 0.09) / (0.15 - 0.09) = 1 - 0.5 = 0.5
      expect(result.score).toBeCloseTo(0.5, 1);
      expect(result.healthZone).toBe("HEALTHY");
    });

    it("tacosMidとtacosHighの中間はスコア-0.5付近", () => {
      // tacosMid = 0.15, tacosHigh = 0.22
      // 中間 = 0.185
      const result = computeTacosHealthScore({
        tacos90d: 0.185,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      // score = 0 - (0.185 - 0.15) / (0.22 - 0.15) = -0.5
      expect(result.score).toBeCloseTo(-0.5, 1);
      expect(result.healthZone).toBe("WARNING");
    });

    it("境界値が正しく設定される", () => {
      const result = computeTacosHealthScore({
        tacos90d: 0.15,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      expect(result.boundaries.tacosLow).toBeCloseTo(0.09, 2);
      expect(result.boundaries.tacosMid).toBeCloseTo(0.15, 2);
      expect(result.boundaries.tacosHigh).toBeCloseTo(0.22, 2);
    });

    it("tacosZoneが正しく設定される", () => {
      // GREEN zone (tacos90d <= tacosTargetMid)
      const greenResult = computeTacosHealthScore({
        tacos90d: 0.12,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      expect(greenResult.tacosZone).toBe("GREEN");

      // ORANGE zone (tacosTargetMid < tacos90d <= tacosMax)
      const orangeResult = computeTacosHealthScore({
        tacos90d: 0.18,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      expect(orangeResult.tacosZone).toBe("ORANGE");

      // RED zone (tacos90d > tacosMax)
      const redResult = computeTacosHealthScore({
        tacos90d: 0.25,
        tacosTargetMid: 0.15,
        tacosMax: 0.22,
        lowMargin: 0.06,
      });
      expect(redResult.tacosZone).toBe("RED");
    });
  });

  describe("computeStrongUpMultiplierFromTacosHealth", () => {
    it("スコア+1で最大倍率1.95を返す", () => {
      const multiplier = computeStrongUpMultiplierFromTacosHealth(1);
      expect(multiplier).toBeCloseTo(1.95, 2);
    });

    it("スコア0で基本倍率1.3を返す", () => {
      const multiplier = computeStrongUpMultiplierFromTacosHealth(0);
      expect(multiplier).toBeCloseTo(1.3, 2);
    });

    it("スコア-1で最小倍率1.0を返す", () => {
      // raw = 1.3 × 0.5 = 0.65 → min 1.0にクランプ
      const multiplier = computeStrongUpMultiplierFromTacosHealth(-1);
      expect(multiplier).toBeCloseTo(1.0, 2);
    });

    it("スコア+0.5で中間倍率を返す", () => {
      // raw = 1.3 × (1 + 0.5 × 0.5) = 1.3 × 1.25 = 1.625
      const multiplier = computeStrongUpMultiplierFromTacosHealth(0.5);
      expect(multiplier).toBeCloseTo(1.625, 2);
    });

    it("スコアが範囲外でもクランプされる", () => {
      const high = computeStrongUpMultiplierFromTacosHealth(2);
      const low = computeStrongUpMultiplierFromTacosHealth(-2);
      expect(high).toBeLessThanOrEqual(1.95);
      expect(low).toBeGreaterThanOrEqual(1.0);
    });

    it("カスタム設定を使用できる", () => {
      const multiplier = computeStrongUpMultiplierFromTacosHealth(1, {
        baseMultiplier: 1.5,
        alpha: 0.3,
        minMultiplier: 1.0,
        maxMultiplier: 2.0,
        orangeZoneMaxMultiplier: 1.3,
      });
      // raw = 1.5 × (1 + 0.3 × 1) = 1.5 × 1.3 = 1.95
      expect(multiplier).toBeCloseTo(1.95, 2);
    });
  });

  describe("computeStrongUpMultiplierWithDetails", () => {
    it("詳細情報を含む結果を返す", () => {
      const result = computeStrongUpMultiplierWithDetails(0.5);
      expect(result.multiplier).toBeCloseTo(1.625, 2);
      expect(result.inputScore).toBe(0.5);
      expect(result.clampedScore).toBe(0.5);
      expect(result.rawMultiplier).toBeCloseTo(1.625, 2);
      expect(result.wasClamped).toBe(false);
    });

    it("クランプされた場合にwasClampedがtrueになる", () => {
      const result = computeStrongUpMultiplierWithDetails(-1);
      expect(result.wasClamped).toBe(true);
      expect(result.rawMultiplier).toBeCloseTo(0.65, 2);
      expect(result.multiplier).toBe(1.0);
    });
  });

  describe("calculateTacos90d", () => {
    it("有効なデータから90日TACOSを計算する", () => {
      const daily = [
        createDailyMetrics("2024-01-01", 100000, 15000),
        createDailyMetrics("2024-01-02", 100000, 15000),
        createDailyMetrics("2024-01-03", 100000, 15000),
      ];
      const tacos = calculateTacos90d(daily);
      // 総売上=300000, 総広告費=45000
      // TACOS = 45000 / 300000 = 0.15
      expect(tacos).toBeCloseTo(0.15, 2);
    });

    it("空配列の場合はnullを返す", () => {
      const tacos = calculateTacos90d([]);
      expect(tacos).toBeNull();
    });

    it("売上ゼロの日は除外される", () => {
      const daily = [
        createDailyMetrics("2024-01-01", 100000, 15000),
        createDailyMetrics("2024-01-02", 0, 5000), // 除外
        createDailyMetrics("2024-01-03", 100000, 15000),
      ];
      const tacos = calculateTacos90d(daily);
      // 有効: 200000売上, 30000広告費
      expect(tacos).toBeCloseTo(0.15, 2);
    });

    it("minRevenuePerDayでフィルタリングできる", () => {
      const daily = [
        createDailyMetrics("2024-01-01", 100000, 15000),
        createDailyMetrics("2024-01-02", 50000, 7500), // 除外
        createDailyMetrics("2024-01-03", 100000, 15000),
      ];
      const tacos = calculateTacos90d(daily, 60000);
      // 有効: 200000売上, 30000広告費
      expect(tacos).toBeCloseTo(0.15, 2);
    });
  });

  describe("getProductTacosConfigForProfile", () => {
    it("プロファイル名に対応する設定を返す", () => {
      const config = getProductTacosConfigForProfile("SUPPLEMENT_HIGH_LTV");
      expect(config.marginPotential).toBe(0.55);
      expect(config.lowMargin).toBe(0.08);
    });

    it("存在しないプロファイルの場合はデフォルトを返す", () => {
      const config = getProductTacosConfigForProfile("UNKNOWN_PROFILE");
      expect(config).toEqual(DEFAULT_PRODUCT_TACOS_CONFIG);
    });

    it("undefinedの場合はデフォルトを返す", () => {
      const config = getProductTacosConfigForProfile(undefined);
      expect(config).toEqual(DEFAULT_PRODUCT_TACOS_CONFIG);
    });
  });

  describe("determineTacosZone", () => {
    it("tacos <= tacosTargetMidForControlの場合はGREENを返す", () => {
      const result = determineTacosZone({
        currentTacos: 0.12,
        tacosTargetMidForControl: 0.15,
        tacosMaxForControl: 0.22,
      });
      expect(result.zone).toBe("GREEN");
    });

    it("tacosTargetMidForControl < tacos <= tacosMaxForControlの場合はORANGEを返す", () => {
      const result = determineTacosZone({
        currentTacos: 0.18,
        tacosTargetMidForControl: 0.15,
        tacosMaxForControl: 0.22,
      });
      expect(result.zone).toBe("ORANGE");
    });

    it("tacos > tacosMaxForControlの場合はREDを返す", () => {
      const result = determineTacosZone({
        currentTacos: 0.25,
        tacosTargetMidForControl: 0.15,
        tacosMaxForControl: 0.22,
      });
      expect(result.zone).toBe("RED");
    });

    it("境界値でtacosTargetMidForControlちょうどはGREEN", () => {
      const result = determineTacosZone({
        currentTacos: 0.15,
        tacosTargetMidForControl: 0.15,
        tacosMaxForControl: 0.22,
      });
      expect(result.zone).toBe("GREEN");
    });

    it("境界値でtacosMaxForControlちょうどはORANGE", () => {
      const result = determineTacosZone({
        currentTacos: 0.22,
        tacosTargetMidForControl: 0.15,
        tacosMaxForControl: 0.22,
      });
      expect(result.zone).toBe("ORANGE");
    });

    it("tacosDeltaが正しく計算される", () => {
      const result = determineTacosZone({
        currentTacos: 0.12,
        tacosTargetMidForControl: 0.15,
        tacosMaxForControl: 0.22,
      });
      // delta = (0.15 - 0.12) / 0.15 = 0.2
      expect(result.tacosDelta).toBeCloseTo(0.2, 2);
    });
  });

  describe("applyStrongUpGate", () => {
    it("GREENゾーンではゲートを適用しない", () => {
      const result = applyStrongUpGate({
        tacosHealthScore: 0.5, // 1.625倍になるはず
        tacosZone: "GREEN",
        productBidMultiplier: 1.2,
      });
      expect(result.finalMultiplier).toBeCloseTo(1.625, 2);
      expect(result.gateApplied).toBe(false);
      expect(result.gateReason).toBeNull();
    });

    it("REDゾーンでは強制的に1.0に制限", () => {
      const result = applyStrongUpGate({
        tacosHealthScore: 0.5,
        tacosZone: "RED",
        productBidMultiplier: 1.2,
      });
      expect(result.finalMultiplier).toBe(1.0);
      expect(result.gateApplied).toBe(true);
      expect(result.gateReason).toContain("RED");
    });

    it("ORANGEゾーンではorangeZoneMaxMultiplierに制限", () => {
      const result = applyStrongUpGate({
        tacosHealthScore: 0.5, // 1.625倍になるはず
        tacosZone: "ORANGE",
        productBidMultiplier: 1.2,
      });
      // デフォルトのorangeZoneMaxMultiplierは1.3
      expect(result.finalMultiplier).toBe(1.3);
      expect(result.gateApplied).toBe(true);
      expect(result.gateReason).toContain("ORANGE");
    });

    it("ORANGEゾーンで元の倍率が上限以下の場合は変更なし", () => {
      const result = applyStrongUpGate({
        tacosHealthScore: -0.5, // 計算すると低い倍率
        tacosZone: "ORANGE",
        productBidMultiplier: 1.2,
      });
      // score=-0.5 → raw = 1.3 × (1 - 0.25) = 1.3 × 0.75 = 0.975 → clamped to 1.0
      expect(result.finalMultiplier).toBe(1.0);
      expect(result.gateApplied).toBe(false);
    });

    it("productBidMultiplier < 1.0の場合はorangeZoneMaxMultiplierに制限", () => {
      const result = applyStrongUpGate({
        tacosHealthScore: 0.5, // 1.625倍になるはず
        tacosZone: "GREEN",
        productBidMultiplier: 0.8, // 低いproductBidMultiplier
      });
      expect(result.finalMultiplier).toBe(1.3);
      expect(result.gateApplied).toBe(true);
      expect(result.gateReason).toContain("productBidMultiplier");
    });

    it("productBidMultiplierがundefinedの場合はゲート適用しない", () => {
      const result = applyStrongUpGate({
        tacosHealthScore: 0.5, // 1.625倍
        tacosZone: "GREEN",
        productBidMultiplier: undefined,
      });
      expect(result.finalMultiplier).toBeCloseTo(1.625, 2);
      expect(result.gateApplied).toBe(false);
    });

    it("カスタム設定を適用できる", () => {
      const result = applyStrongUpGate(
        {
          tacosHealthScore: 0.5,
          tacosZone: "ORANGE",
          productBidMultiplier: 1.2,
        },
        {
          ...DEFAULT_STRONG_UP_MULTIPLIER_CONFIG,
          orangeZoneMaxMultiplier: 1.5,
        }
      );
      expect(result.finalMultiplier).toBe(1.5);
    });
  });

  describe("calculateTacosMaxForControl", () => {
    it("empirical上限がLTV上限より小さい場合はempirical上限を使用", () => {
      const result = calculateTacosMaxForControl({
        theoreticalMaxTacosCapped: 0.30,
        empiricalAggressiveCap: 0.25,
        tacosAggressiveCapDefault: 0.21,
      });
      expect(result.tacosMaxForControl).toBe(0.25);
      expect(result.source).toBe("EMPIRICAL");
      expect(result.ltvCapApplied).toBe(false);
    });

    it("LTV上限がempirical上限より小さい場合はLTV上限を使用", () => {
      const result = calculateTacosMaxForControl({
        theoreticalMaxTacosCapped: 0.20,
        empiricalAggressiveCap: 0.25,
        tacosAggressiveCapDefault: 0.21,
      });
      expect(result.tacosMaxForControl).toBe(0.20);
      expect(result.ltvCapApplied).toBe(true);
    });

    it("empiricalAggressiveCapがnullの場合はデフォルトを使用", () => {
      const result = calculateTacosMaxForControl({
        theoreticalMaxTacosCapped: 0.30,
        empiricalAggressiveCap: null,
        tacosAggressiveCapDefault: 0.21,
      });
      expect(result.tacosMaxForControl).toBe(0.21);
      expect(result.source).toBe("DEFAULT");
      expect(result.effectiveAggressiveCap).toBe(0.21);
    });

    it("LTV上限がデフォルト上限より小さい場合はLTV上限を使用", () => {
      const result = calculateTacosMaxForControl({
        theoreticalMaxTacosCapped: 0.18,
        empiricalAggressiveCap: null,
        tacosAggressiveCapDefault: 0.21,
      });
      expect(result.tacosMaxForControl).toBe(0.18);
      expect(result.ltvCapApplied).toBe(true);
    });
  });

  describe("evaluateTacosHealth", () => {
    it("統合評価を正しく実行する", () => {
      const daily = createDaysWithTacos(0.12, 30);
      const result = evaluateTacosHealth({
        dailyMetrics90d: daily,
        theoreticalMaxTacosCapped: 0.30,
        productProfile: "SUPPLEMENT_NORMAL",
      });

      expect(result.tacos90d).toBeCloseTo(0.12, 2);
      expect(result.healthScore.score).toBeGreaterThan(0);
      expect(result.strongUpMultiplier.finalMultiplier).toBeGreaterThan(1.3);
    });

    it("データがない場合はデフォルト値を使用する", () => {
      const result = evaluateTacosHealth({
        dailyMetrics90d: [],
        theoreticalMaxTacosCapped: 0.30,
        productProfile: "SUPPLEMENT_NORMAL",
      });

      expect(result.tacosTargetMidSource).toBe("DEFAULT");
      expect(result.tacosTargetMidForControl).toBe(
        PRODUCT_TACOS_CONFIG_DEFAULTS.SUPPLEMENT_NORMAL.tacosTargetMidDefault
      );
    });

    it("カスタム設定を適用できる", () => {
      const daily = createDaysWithTacos(0.15, 30);
      const result = evaluateTacosHealth({
        dailyMetrics90d: daily,
        theoreticalMaxTacosCapped: 0.30,
        customConfig: {
          marginPotential: 0.60,
          lowMargin: 0.10,
        },
      });

      expect(result.config.marginPotential).toBe(0.60);
      expect(result.config.lowMargin).toBe(0.10);
    });

    it("推計成功時はESTIMATEDソースを返す", () => {
      const daily = createDaysWithTacos(0.15, 30);
      const result = evaluateTacosHealth({
        dailyMetrics90d: daily,
        theoreticalMaxTacosCapped: 0.30,
        productProfile: "SUPPLEMENT_NORMAL",
      });

      if (result.optimization.tacosTargetMid !== null) {
        expect(result.tacosTargetMidSource).toBe("ESTIMATED");
      }
    });

    it("tacosMaxForControlが正しく計算される", () => {
      const daily = createDaysWithTacos(0.15, 30);
      const result = evaluateTacosHealth({
        dailyMetrics90d: daily,
        theoreticalMaxTacosCapped: 0.20, // LTVベースの上限
        productProfile: "SUPPLEMENT_NORMAL",
      });

      // tacosMaxForControl = min(theoreticalMaxTacosCapped, tacosAggressiveCap)
      expect(result.tacosMaxForControl).toBeLessThanOrEqual(0.20);
      expect(result.tacosMaxForControlDetails).toBeDefined();
    });

    it("productBidMultiplierがSTRONG_UPゲートに影響する", () => {
      const daily = createDaysWithTacos(0.12, 30);

      // 高いproductBidMultiplier
      const resultHigh = evaluateTacosHealth({
        dailyMetrics90d: daily,
        theoreticalMaxTacosCapped: 0.30,
        productProfile: "SUPPLEMENT_NORMAL",
        productBidMultiplier: 1.2,
      });

      // 低いproductBidMultiplier
      const resultLow = evaluateTacosHealth({
        dailyMetrics90d: daily,
        theoreticalMaxTacosCapped: 0.30,
        productProfile: "SUPPLEMENT_NORMAL",
        productBidMultiplier: 0.8,
      });

      // 低いproductBidMultiplierの場合はゲートが適用される
      expect(resultLow.strongUpMultiplier.gateApplied).toBe(true);
      expect(resultLow.strongUpMultiplier.finalMultiplier).toBeLessThanOrEqual(1.3);
    });
  });

  describe("DEFAULT_STRONG_UP_MULTIPLIER_CONFIG", () => {
    it("適切なデフォルト値が設定されている", () => {
      expect(DEFAULT_STRONG_UP_MULTIPLIER_CONFIG.baseMultiplier).toBe(1.3);
      expect(DEFAULT_STRONG_UP_MULTIPLIER_CONFIG.alpha).toBe(0.5);
      expect(DEFAULT_STRONG_UP_MULTIPLIER_CONFIG.minMultiplier).toBe(1.0);
      expect(DEFAULT_STRONG_UP_MULTIPLIER_CONFIG.maxMultiplier).toBe(1.95);
      expect(DEFAULT_STRONG_UP_MULTIPLIER_CONFIG.orangeZoneMaxMultiplier).toBe(1.3);
    });
  });

  describe("PRODUCT_TACOS_CONFIG_DEFAULTS", () => {
    it("3つのプロファイル設定がある", () => {
      expect(Object.keys(PRODUCT_TACOS_CONFIG_DEFAULTS)).toHaveLength(3);
      expect(PRODUCT_TACOS_CONFIG_DEFAULTS.SUPPLEMENT_HIGH_LTV).toBeDefined();
      expect(PRODUCT_TACOS_CONFIG_DEFAULTS.SUPPLEMENT_NORMAL).toBeDefined();
      expect(PRODUCT_TACOS_CONFIG_DEFAULTS.LOW_LTV_SUPPLEMENT).toBeDefined();
    });

    it("各プロファイルでmarginPotentialが異なる", () => {
      const high = PRODUCT_TACOS_CONFIG_DEFAULTS.SUPPLEMENT_HIGH_LTV;
      const normal = PRODUCT_TACOS_CONFIG_DEFAULTS.SUPPLEMENT_NORMAL;
      const low = PRODUCT_TACOS_CONFIG_DEFAULTS.LOW_LTV_SUPPLEMENT;

      expect(high.marginPotential).toBeGreaterThan(normal.marginPotential);
      expect(normal.marginPotential).toBeGreaterThan(low.marginPotential);
    });

    it("tacosAggressiveCapDefaultが正しく設定されている", () => {
      const high = PRODUCT_TACOS_CONFIG_DEFAULTS.SUPPLEMENT_HIGH_LTV;
      expect(high.tacosAggressiveCapDefault).toBeDefined();
    });
  });
});

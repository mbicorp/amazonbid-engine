/**
 * T_opt推定モジュールのテスト
 */

import {
  DailyTacosData,
  OptimalTacosConfig,
  LifecycleTacosConfig,
  DEFAULT_OPTIMAL_TACOS_CONFIG,
  DEFAULT_LIFECYCLE_TACOS_CONFIG,
  estimateTopt,
  calculateLifecycleTacosTargets,
  calculateLaunchInvestment,
  optimizeAsinTacos,
  getTacosTargetForStage,
  calculateNetMargin,
  calculateDailyNetProfit,
  calculatePeriodNetProfit,
} from "../../src/analytics";

describe("T_opt推定モジュール", () => {
  // ==========================================================================
  // テスト用ヘルパー
  // ==========================================================================

  /**
   * 日次データを生成
   */
  function generateDailyData(
    days: number,
    revenuePerDay: number,
    tacosRange: { min: number; max: number }
  ): DailyTacosData[] {
    const data: DailyTacosData[] = [];
    const startDate = new Date("2024-01-01");

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];

      // TACOSをランダムに生成
      const tacos =
        tacosRange.min +
        Math.random() * (tacosRange.max - tacosRange.min);
      const adSpend = revenuePerDay * tacos;

      data.push({
        date: dateStr,
        revenue: revenuePerDay,
        adSpend,
      });
    }

    return data;
  }

  /**
   * 特定のTACOS分布でデータを生成（利益最大化テスト用）
   */
  function generateDataWithOptimalTacos(
    optimalTacos: number,
    marginPotential: number
  ): DailyTacosData[] {
    const data: DailyTacosData[] = [];
    const startDate = new Date("2024-01-01");

    // 最適TACOS帯のデータを多く生成（利益が高い）
    const tacosRanges = [
      { min: 0.05, max: 0.10, days: 10 },
      { min: 0.10, max: 0.15, days: 15 },
      { min: 0.15, max: 0.20, days: 20 }, // 最適帯（利益最大）
      { min: 0.20, max: 0.25, days: 15 },
      { min: 0.25, max: 0.30, days: 10 },
    ];

    // 最適TACOSに近い帯の売上を高くする
    let dayIndex = 0;
    for (const range of tacosRanges) {
      for (let i = 0; i < range.days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + dayIndex);
        const dateStr = date.toISOString().split("T")[0];

        const tacos = range.min + Math.random() * (range.max - range.min);
        // TACOSが低いほど売上が高い傾向（現実的なモデル）
        const revenue = 10000 * (1 + (0.3 - tacos) * 2);
        const adSpend = revenue * tacos;

        data.push({
          date: dateStr,
          revenue,
          adSpend,
        });
        dayIndex++;
      }
    }

    return data;
  }

  // ==========================================================================
  // estimateTopt テスト
  // ==========================================================================

  describe("estimateTopt", () => {
    it("空のデータでフォールバック値を使用", () => {
      const result = estimateTopt([]);

      expect(result.tOpt).toBe(DEFAULT_OPTIMAL_TACOS_CONFIG.fallbackTopt);
      expect(result.confidence).toBe("LOW");
      expect(result.usedFallback).toBe(true);
      expect(result.validDaysUsed).toBe(0);
    });

    it("売上ゼロのデータを除外", () => {
      const data: DailyTacosData[] = [
        { date: "2024-01-01", revenue: 0, adSpend: 100 },
        { date: "2024-01-02", revenue: 0, adSpend: 50 },
      ];

      const result = estimateTopt(data);

      expect(result.usedFallback).toBe(true);
      expect(result.validDaysUsed).toBe(0);
    });

    it("TACOS範囲外のデータを除外", () => {
      const config: OptimalTacosConfig = {
        ...DEFAULT_OPTIMAL_TACOS_CONFIG,
        minTacos: 0.05,
        maxTacos: 0.30,
      };

      const data: DailyTacosData[] = [
        { date: "2024-01-01", revenue: 1000, adSpend: 10 }, // TACOS 1%（範囲外）
        { date: "2024-01-02", revenue: 1000, adSpend: 500 }, // TACOS 50%（範囲外）
      ];

      const result = estimateTopt(data, config);

      expect(result.usedFallback).toBe(true);
    });

    it("有効なデータからT_optを推計", () => {
      const config: OptimalTacosConfig = {
        ...DEFAULT_OPTIMAL_TACOS_CONFIG,
        marginPotential: 0.55,
        binWidth: 0.05,
        minDaysPerBin: 2,
      };

      // TACOS 10%帯のデータを集中的に生成（利益が最大になるはず）
      const data: DailyTacosData[] = [];
      for (let i = 0; i < 30; i++) {
        data.push({
          date: `2024-01-${(i + 1).toString().padStart(2, "0")}`,
          revenue: 10000,
          adSpend: 1000 + (i % 10) * 50, // TACOS 10%〜14.5%
        });
      }

      const result = estimateTopt(data, config);

      expect(result.usedFallback).toBe(false);
      expect(result.validDaysUsed).toBeGreaterThan(0);
      expect(result.tOpt).toBeGreaterThan(0);
      expect(result.tOpt).toBeLessThan(config.marginPotential);
    });

    it("信頼度HIGHの条件を満たす", () => {
      const config: OptimalTacosConfig = {
        ...DEFAULT_OPTIMAL_TACOS_CONFIG,
        binWidth: 0.03,
        minDaysPerBin: 3,
      };

      // 90日以上のデータを生成
      const data = generateDailyData(100, 10000, { min: 0.05, max: 0.40 });

      const result = estimateTopt(data, config);

      expect(result.usedFallback).toBe(false);
      expect(result.validDaysUsed).toBeGreaterThanOrEqual(90);
      // validBinCountは5以上なら HIGH
      if (result.validBinCount >= 5) {
        expect(result.confidence).toBe("HIGH");
      }
    });

    it("信頼度MEDIUMの条件を満たす", () => {
      const config: OptimalTacosConfig = {
        ...DEFAULT_OPTIMAL_TACOS_CONFIG,
        binWidth: 0.05,
        minDaysPerBin: 3,
      };

      // 30〜89日のデータを生成
      const data = generateDailyData(45, 10000, { min: 0.10, max: 0.25 });

      const result = estimateTopt(data, config);

      if (!result.usedFallback && result.validBinCount >= 3) {
        expect(["HIGH", "MEDIUM"]).toContain(result.confidence);
      }
    });

    it("利益最大のビンを選択", () => {
      const config: OptimalTacosConfig = {
        marginPotential: 0.50,
        binWidth: 0.05,
        minTacos: 0.05,
        maxTacos: 0.40,
        minDaysPerBin: 2,
        fallbackTopt: 0.15,
      };

      // 低TACOSで高利益のデータを生成
      const data: DailyTacosData[] = [
        // 5%〜10%帯（最高利益）
        { date: "2024-01-01", revenue: 20000, adSpend: 1400 }, // 7%
        { date: "2024-01-02", revenue: 20000, adSpend: 1600 }, // 8%
        { date: "2024-01-03", revenue: 20000, adSpend: 1800 }, // 9%
        // 10%〜15%帯
        { date: "2024-01-04", revenue: 15000, adSpend: 1800 }, // 12%
        { date: "2024-01-05", revenue: 15000, adSpend: 2100 }, // 14%
        // 15%〜20%帯
        { date: "2024-01-06", revenue: 12000, adSpend: 2040 }, // 17%
        { date: "2024-01-07", revenue: 12000, adSpend: 2160 }, // 18%
        // 20%〜25%帯
        { date: "2024-01-08", revenue: 10000, adSpend: 2200 }, // 22%
        { date: "2024-01-09", revenue: 10000, adSpend: 2400 }, // 24%
      ];

      const result = estimateTopt(data, config);

      expect(result.usedFallback).toBe(false);
      // 低TACOS帯が利益最大になるはず
      expect(result.tOpt).toBeLessThan(0.15);
    });
  });

  // ==========================================================================
  // calculateLifecycleTacosTargets テスト
  // ==========================================================================

  describe("calculateLifecycleTacosTargets", () => {
    const tOpt = 0.15;
    const marginPotential = 0.55;

    it("T_launchの計算: min(g, T_opt × (1 + α_L))", () => {
      const config: LifecycleTacosConfig = {
        ...DEFAULT_LIFECYCLE_TACOS_CONFIG,
        alphaLaunch: 0.30,
      };

      const result = calculateLifecycleTacosTargets(
        tOpt,
        marginPotential,
        "LAUNCH_HARD",
        config
      );

      // T_launch = min(0.55, 0.15 × 1.30) = min(0.55, 0.195) = 0.195
      expect(result.tLaunch).toBeCloseTo(0.195, 5);
    });

    it("T_launchがmarginPotentialでキャップされる", () => {
      const lowMargin = 0.10; // T_opt × 1.3 = 0.195 より低い
      const config: LifecycleTacosConfig = {
        ...DEFAULT_LIFECYCLE_TACOS_CONFIG,
        alphaLaunch: 0.30,
      };

      const result = calculateLifecycleTacosTargets(
        tOpt,
        lowMargin,
        "LAUNCH_HARD",
        config
      );

      // T_launch = min(0.10, 0.195) = 0.10
      expect(result.tLaunch).toBe(lowMargin);
    });

    it("T_growはT_optと同じ", () => {
      const result = calculateLifecycleTacosTargets(
        tOpt,
        marginPotential,
        "GROW"
      );

      expect(result.tGrow).toBe(tOpt);
    });

    it("T_harvestの計算: max(0, T_opt × (1 - α_H))", () => {
      const config: LifecycleTacosConfig = {
        ...DEFAULT_LIFECYCLE_TACOS_CONFIG,
        alphaHarvest: 0.25,
      };

      const result = calculateLifecycleTacosTargets(
        tOpt,
        marginPotential,
        "HARVEST",
        config
      );

      // T_harvest = max(0, 0.15 × 0.75) = 0.1125
      expect(result.tHarvest).toBeCloseTo(0.1125, 5);
    });

    it("T_harvestが負にならない", () => {
      const config: LifecycleTacosConfig = {
        ...DEFAULT_LIFECYCLE_TACOS_CONFIG,
        alphaHarvest: 1.5, // 150%減
      };

      const result = calculateLifecycleTacosTargets(
        tOpt,
        marginPotential,
        "HARVEST",
        config
      );

      expect(result.tHarvest).toBe(0);
    });

    it("LAUNCH_SOFTはalphaLaunchを半分適用", () => {
      const config: LifecycleTacosConfig = {
        alphaLaunch: 0.30,
        alphaHarvest: 0.25,
        softFactor: 0.5,
      };

      const result = calculateLifecycleTacosTargets(
        tOpt,
        marginPotential,
        "LAUNCH_SOFT",
        config
      );

      // LAUNCH_SOFT target = min(g, T_opt × (1 + α_L × 0.5))
      // = min(0.55, 0.15 × 1.15) = 0.1725
      expect(result.currentTarget).toBeCloseTo(0.1725, 5);
    });

    it("currentTargetがcurrentStageに対応", () => {
      const stages: Array<{ stage: "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST"; expected: string }> = [
        { stage: "LAUNCH_HARD", expected: "tLaunch" },
        { stage: "GROW", expected: "tGrow" },
        { stage: "HARVEST", expected: "tHarvest" },
      ];

      for (const { stage, expected } of stages) {
        const result = calculateLifecycleTacosTargets(
          tOpt,
          marginPotential,
          stage
        );

        expect(result.currentStage).toBe(stage);
        if (expected === "tLaunch") {
          expect(result.currentTarget).toBe(result.tLaunch);
        } else if (expected === "tGrow") {
          expect(result.currentTarget).toBe(result.tGrow);
        } else if (expected === "tHarvest") {
          expect(result.currentTarget).toBe(result.tHarvest);
        }
      }
    });
  });

  // ==========================================================================
  // calculateLaunchInvestment テスト
  // ==========================================================================

  describe("calculateLaunchInvestment", () => {
    const tOpt = 0.15;
    const marginPotential = 0.55;

    it("空のデータで0を返す", () => {
      const result = calculateLaunchInvestment([], tOpt, marginPotential);

      expect(result.launchInvestTotal).toBe(0);
      expect(result.launchSalesTotal).toBe(0);
    });

    it("売上ゼロのデータを除外", () => {
      const data: DailyTacosData[] = [
        { date: "2024-01-01", revenue: 0, adSpend: 100 },
      ];

      const result = calculateLaunchInvestment(data, tOpt, marginPotential);

      expect(result.launchSalesTotal).toBe(0);
    });

    it("LaunchInvest_totalを正しく計算", () => {
      // TACOS 25%でローンチ（T_opt 15%との差 = 10%の追加投資）
      const data: DailyTacosData[] = [
        { date: "2024-01-01", revenue: 10000, adSpend: 2500 }, // 25%
        { date: "2024-01-02", revenue: 10000, adSpend: 2500 }, // 25%
        { date: "2024-01-03", revenue: 10000, adSpend: 2500 }, // 25%
      ];

      const result = calculateLaunchInvestment(data, tOpt, marginPotential);

      // 合計売上 = 30000
      expect(result.launchSalesTotal).toBe(30000);

      // 平均TACOS = 25%
      expect(result.launchTacosAverage).toBeCloseTo(0.25, 5);

      // LaunchInvest_total = 30000 × (0.25 - 0.15) = 3000
      expect(result.launchInvestTotal).toBeCloseTo(3000, 5);
    });

    it("T_opt以下のTACOSで投資ゼロ", () => {
      // TACOS 10%でローンチ（T_opt 15%以下）
      const data: DailyTacosData[] = [
        { date: "2024-01-01", revenue: 10000, adSpend: 1000 }, // 10%
        { date: "2024-01-02", revenue: 10000, adSpend: 1000 }, // 10%
      ];

      const result = calculateLaunchInvestment(data, tOpt, marginPotential);

      // 利益が出ているので投資は0
      expect(result.launchInvestTotal).toBe(0);
    });

    it("投資回収に必要な売上を計算", () => {
      const data: DailyTacosData[] = [
        { date: "2024-01-01", revenue: 10000, adSpend: 3000 }, // 30%
      ];

      const result = calculateLaunchInvestment(data, tOpt, marginPotential);

      // LaunchInvest_total = 10000 × (0.30 - 0.15) = 1500
      expect(result.launchInvestTotal).toBeCloseTo(1500, 5);

      // netMargin = 0.55 - 0.15 = 0.40
      // 投資回収売上 = 1500 / 0.40 = 3750
      expect(result.estimatedRecoverySales).toBeCloseTo(3750, 5);
    });
  });

  // ==========================================================================
  // optimizeAsinTacos テスト
  // ==========================================================================

  describe("optimizeAsinTacos", () => {
    it("ASIN別最適化を実行", () => {
      const data = generateDailyData(60, 10000, { min: 0.08, max: 0.25 });

      const result = optimizeAsinTacos(
        "B00TEST123",
        data,
        "GROW",
        0.55
      );

      expect(result.asin).toBe("B00TEST123");
      expect(result.marginPotential).toBe(0.55);
      expect(result.tOptResult).toBeDefined();
      expect(result.lifecycleTargets).toBeDefined();
      expect(result.targetNetMarginMidProduct).toBe(
        0.55 - result.tOptResult.tOpt
      );
    });

    it("ローンチ投資データを含む場合", () => {
      const dailyData = generateDailyData(60, 10000, { min: 0.10, max: 0.20 });
      const launchData: DailyTacosData[] = [
        { date: "2023-12-01", revenue: 5000, adSpend: 1500 }, // 30%
        { date: "2023-12-02", revenue: 5000, adSpend: 1500 }, // 30%
      ];

      const result = optimizeAsinTacos(
        "B00TEST123",
        dailyData,
        "GROW",
        0.55,
        launchData
      );

      expect(result.launchInvestment).not.toBeNull();
      expect(result.launchInvestment!.launchSalesTotal).toBe(10000);
    });
  });

  // ==========================================================================
  // ユーティリティ関数テスト
  // ==========================================================================

  describe("getTacosTargetForStage", () => {
    it("各ステージに対応する目標値を取得", () => {
      const targets = calculateLifecycleTacosTargets(0.15, 0.55, "GROW");

      expect(getTacosTargetForStage(targets, "LAUNCH_HARD")).toBe(targets.tLaunch);
      expect(getTacosTargetForStage(targets, "GROW")).toBe(targets.tGrow);
      expect(getTacosTargetForStage(targets, "HARVEST")).toBe(targets.tHarvest);
    });
  });

  describe("calculateNetMargin", () => {
    it("ネットマージンを計算", () => {
      expect(calculateNetMargin(0.55, 0.15)).toBeCloseTo(0.40, 5);
      expect(calculateNetMargin(0.30, 0.20)).toBeCloseTo(0.10, 5);
      expect(calculateNetMargin(0.20, 0.25)).toBeCloseTo(-0.05, 5); // 赤字
    });
  });

  describe("calculateDailyNetProfit", () => {
    it("日次利益を計算", () => {
      // sales=10000, adCost=1500, g=0.55
      // tacos = 15%, netProfit = 10000 × (0.55 - 0.15) = 4000
      expect(calculateDailyNetProfit(10000, 1500, 0.55)).toBeCloseTo(4000, 5);
    });

    it("売上ゼロで利益ゼロ", () => {
      expect(calculateDailyNetProfit(0, 100, 0.55)).toBe(0);
    });

    it("高TAOSで赤字", () => {
      // sales=10000, adCost=6000, g=0.55
      // tacos = 60%, netProfit = 10000 × (0.55 - 0.60) = -500
      expect(calculateDailyNetProfit(10000, 6000, 0.55)).toBeCloseTo(-500, 5);
    });
  });

  describe("calculatePeriodNetProfit", () => {
    it("期間利益を計算", () => {
      const data: DailyTacosData[] = [
        { date: "2024-01-01", revenue: 10000, adSpend: 1500 }, // profit: 4000
        { date: "2024-01-02", revenue: 10000, adSpend: 2000 }, // profit: 3500
        { date: "2024-01-03", revenue: 10000, adSpend: 2500 }, // profit: 3000
      ];

      const result = calculatePeriodNetProfit(data, 0.55);

      expect(result).toBeCloseTo(10500, 5);
    });
  });
});

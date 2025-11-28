/**
 * メトリクス構築のテスト
 */

import {
  buildAttributionAwareMetrics,
  buildFromKeywordMetrics,
  buildFromClusterMetrics,
  calculatePeriodMetrics,
  mergePeriodMetrics,
  DailyPerformanceData,
} from "../../src/engine/attribution-defense";

describe("metrics-builder", () => {
  describe("calculatePeriodMetrics", () => {
    it("正常な指標を計算する", () => {
      const result = calculatePeriodMetrics(1000, 50, 5, 2500, 10000);

      expect(result.impressions).toBe(1000);
      expect(result.clicks).toBe(50);
      expect(result.conversions).toBe(5);
      expect(result.cost).toBe(2500);
      expect(result.sales).toBe(10000);
      expect(result.ctr).toBe(0.05); // 50/1000
      expect(result.cvr).toBe(0.1); // 5/50
      expect(result.acos).toBe(0.25); // 2500/10000
      expect(result.cpc).toBe(50); // 2500/50
    });

    it("クリック0の場合はCVR/CPCがnull", () => {
      const result = calculatePeriodMetrics(1000, 0, 0, 0, 0);

      expect(result.cvr).toBeNull();
      expect(result.cpc).toBeNull();
    });

    it("売上0の場合はACOSがnull", () => {
      const result = calculatePeriodMetrics(1000, 50, 0, 2500, 0);

      expect(result.acos).toBeNull();
    });

    it("インプレッション0の場合はCTRがnull", () => {
      const result = calculatePeriodMetrics(0, 0, 0, 0, 0);

      expect(result.ctr).toBeNull();
    });
  });

  describe("mergePeriodMetrics", () => {
    it("2つのメトリクスを正しく合算する", () => {
      const a = calculatePeriodMetrics(500, 25, 2, 1250, 4000);
      const b = calculatePeriodMetrics(500, 25, 3, 1250, 6000);

      const result = mergePeriodMetrics(a, b);

      expect(result.impressions).toBe(1000);
      expect(result.clicks).toBe(50);
      expect(result.conversions).toBe(5);
      expect(result.cost).toBe(2500);
      expect(result.sales).toBe(10000);
      expect(result.ctr).toBe(0.05);
      expect(result.cvr).toBe(0.1);
      expect(result.acos).toBe(0.25);
    });
  });

  describe("buildAttributionAwareMetrics", () => {
    const createDailyData = (
      daysAgo: number,
      impressions: number,
      clicks: number,
      conversions: number,
      cost: number,
      sales: number,
      referenceDate: Date
    ): DailyPerformanceData => {
      const date = new Date(referenceDate);
      date.setDate(date.getDate() - daysAgo);
      return {
        date: date.toISOString().split("T")[0],
        impressions,
        clicks,
        conversions,
        cost,
        sales,
      };
    };

    it("日次データをstable/recent/totalに正しく分割する", () => {
      const referenceDate = new Date("2024-01-15");

      // 30日分のデータを作成
      const dailyData: DailyPerformanceData[] = [];
      for (let i = 1; i <= 30; i++) {
        dailyData.push(
          createDailyData(i, 100, 10, 1, 500, 2000, referenceDate)
        );
      }

      const result = buildAttributionAwareMetrics(
        "B00EXAMPLE",
        "keyword_123",
        "KEYWORD",
        dailyData,
        2000,
        referenceDate
      );

      // recent期間（直近3日）: 1-3日前のデータ
      expect(result.recent.impressions).toBe(300); // 100 * 3
      expect(result.recent.clicks).toBe(30); // 10 * 3
      expect(result.recent.conversions).toBe(3); // 1 * 3

      // stable期間（4-30日前）: 27日分のデータ
      expect(result.stable.impressions).toBe(2700); // 100 * 27
      expect(result.stable.clicks).toBe(270); // 10 * 27
      expect(result.stable.conversions).toBe(27); // 1 * 27

      // total = stable + recent
      expect(result.total.impressions).toBe(3000); // 100 * 30
      expect(result.total.clicks).toBe(300); // 10 * 30
      expect(result.total.conversions).toBe(30); // 1 * 30
    });

    it("基準日より未来のデータは除外される", () => {
      const referenceDate = new Date("2024-01-15");

      const dailyData: DailyPerformanceData[] = [
        { date: "2024-01-14", impressions: 100, clicks: 10, conversions: 1, cost: 500, sales: 2000 },
        { date: "2024-01-15", impressions: 100, clicks: 10, conversions: 1, cost: 500, sales: 2000 }, // 基準日当日は除外
        { date: "2024-01-16", impressions: 100, clicks: 10, conversions: 1, cost: 500, sales: 2000 }, // 未来は除外
      ];

      const result = buildAttributionAwareMetrics(
        "B00EXAMPLE",
        "keyword_123",
        "KEYWORD",
        dailyData,
        2000,
        referenceDate
      );

      // 1日分のみ（1日前のデータ）
      expect(result.total.impressions).toBe(100);
    });

    it("total期間より古いデータは除外される", () => {
      const referenceDate = new Date("2024-01-31");

      const dailyData: DailyPerformanceData[] = [
        { date: "2024-01-01", impressions: 100, clicks: 10, conversions: 1, cost: 500, sales: 2000 }, // 30日前なのでギリギリ含まれる
        { date: "2023-12-31", impressions: 100, clicks: 10, conversions: 1, cost: 500, sales: 2000 }, // 31日前なので除外
      ];

      const result = buildAttributionAwareMetrics(
        "B00EXAMPLE",
        "keyword_123",
        "KEYWORD",
        dailyData,
        2000,
        referenceDate
      );

      expect(result.stable.impressions).toBe(100); // 1日分のみ
    });

    it("targetCpaが正しく設定される", () => {
      const result = buildAttributionAwareMetrics(
        "B00EXAMPLE",
        "keyword_123",
        "KEYWORD",
        [],
        2500,
        new Date()
      );

      expect(result.targetCpa).toBe(2500);
    });

    it("空のデータでも正しく動作する", () => {
      const result = buildAttributionAwareMetrics(
        "B00EXAMPLE",
        "keyword_123",
        "KEYWORD",
        [],
        2000,
        new Date()
      );

      expect(result.stable.clicks).toBe(0);
      expect(result.recent.clicks).toBe(0);
      expect(result.total.clicks).toBe(0);
    });
  });

  describe("buildFromKeywordMetrics", () => {
    it("KeywordMetrics形式から正しく変換する", () => {
      const result = buildFromKeywordMetrics(
        "B00EXAMPLE",
        "keyword_123",
        { impressions: 1000, clicks: 50, conversions: 5, cost: 2500, sales: 10000 },
        { impressions: 300, clicks: 15, conversions: 2, cost: 750, sales: 4000 },
        { impressions: 1300, clicks: 65, conversions: 7, cost: 3250, sales: 14000 },
        2000
      );

      expect(result.entityType).toBe("KEYWORD");
      expect(result.stable.clicks).toBe(50);
      expect(result.recent.clicks).toBe(15);
      expect(result.total.clicks).toBe(65);
      expect(result.stableDays).toBe(4);
      expect(result.recentDays).toBe(3);
    });
  });

  describe("buildFromClusterMetrics", () => {
    it("クラスターメトリクスから正しく変換する", () => {
      const result = buildFromClusterMetrics(
        "B00EXAMPLE",
        "cluster_abc::generic",
        { impressions: 1000, clicks: 50, conversions: 5, cost: 2500, sales: 10000 },
        { impressions: 300, clicks: 15, conversions: 2, cost: 750, sales: 4000 },
        2000
      );

      expect(result.entityType).toBe("SEARCH_TERM_CLUSTER");
      expect(result.stable.clicks).toBe(50);
      expect(result.recent.clicks).toBe(15);
      expect(result.total.clicks).toBe(65);
    });

    it("recentがnullでも正しく動作する", () => {
      const result = buildFromClusterMetrics(
        "B00EXAMPLE",
        "cluster_abc::generic",
        { impressions: 1000, clicks: 50, conversions: 5, cost: 2500, sales: 10000 },
        null,
        2000
      );

      expect(result.recent.clicks).toBe(0);
      expect(result.total.clicks).toBe(50); // stable のみ
    });
  });
});

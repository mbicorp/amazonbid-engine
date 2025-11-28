/**
 * ExecutionLoggerのテスト
 */

import { ExecutionLogger, createExecutionLogger } from "../../src/logging/executionLogger";

// BigQueryのモック
jest.mock("@google-cloud/bigquery", () => ({
  BigQuery: jest.fn().mockImplementation(() => ({
    dataset: jest.fn().mockReturnValue({
      table: jest.fn().mockReturnValue({
        insert: jest.fn().mockResolvedValue([]),
      }),
    }),
    query: jest.fn().mockResolvedValue([[]]),
  })),
}));

// UUIDのモック
jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("test-execution-id-1234"),
}));

// =============================================================================
// ExecutionLogger テスト
// =============================================================================

describe("ExecutionLogger", () => {
  const options = {
    projectId: "test-project",
    dataset: "test_dataset",
    mode: "SHADOW" as const,
    triggerSource: "API" as const,
    triggeredBy: "test-user",
  };

  describe("インスタンス作成", () => {
    it("正しくインスタンスが作成される", () => {
      const logger = new ExecutionLogger(options);

      expect(logger.getExecutionId()).toBe("test-execution-id-1234");
      expect(logger.getMode()).toBe("SHADOW");
    });
  });

  describe("createExecutionLogger", () => {
    it("ファクトリ関数でインスタンスを作成できる", () => {
      const logger = createExecutionLogger(options);

      expect(logger).toBeInstanceOf(ExecutionLogger);
      expect(logger.getExecutionId()).toBe("test-execution-id-1234");
    });
  });

  describe("統計の更新", () => {
    it("updateStatsで統計を更新できる", () => {
      const logger = new ExecutionLogger(options);

      logger.updateStats({
        totalProductsCount: 10,
        totalKeywordsCount: 100,
      });

      const stats = logger.getStats();
      expect(stats.totalProductsCount).toBe(10);
      expect(stats.totalKeywordsCount).toBe(100);
    });

    it("incrementStatsで統計を加算できる", () => {
      const logger = new ExecutionLogger(options);

      logger.incrementStats("recommendationsCount");
      logger.incrementStats("recommendationsCount");
      logger.incrementStats("appliedCount", 5);

      const stats = logger.getStats();
      expect(stats.recommendationsCount).toBe(2);
      expect(stats.appliedCount).toBe(5);
    });
  });

  describe("getStats", () => {
    it("初期統計が正しい", () => {
      const logger = new ExecutionLogger(options);
      const stats = logger.getStats();

      expect(stats).toEqual({
        totalProductsCount: 0,
        totalKeywordsCount: 0,
        recommendationsCount: 0,
        appliedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        bidIncreasesCount: 0,
        bidDecreasesCount: 0,
        bidUnchangedCount: 0,
      });
    });
  });
});

// =============================================================================
// logRecommendation テスト
// =============================================================================

describe("ExecutionLogger.logRecommendation", () => {
  const options = {
    projectId: "test-project",
    dataset: "test_dataset",
    mode: "SHADOW" as const,
    triggerSource: "API" as const,
  };

  it("推奨ログを記録し統計を更新する（入札上昇）", async () => {
    const logger = new ExecutionLogger(options);

    await logger.logRecommendation({
      asin: "B0TEST1234",
      keywordText: "test keyword",
      oldBid: 100,
      newBid: 120,
      bidChange: 20,
      bidChangePercent: 20,
      reasonCode: "ACOS_LOW",
      isApplied: false,
    });

    const stats = logger.getStats();
    expect(stats.recommendationsCount).toBe(1);
    expect(stats.bidIncreasesCount).toBe(1);
    expect(stats.bidDecreasesCount).toBe(0);
  });

  it("推奨ログを記録し統計を更新する（入札下降）", async () => {
    const logger = new ExecutionLogger(options);

    await logger.logRecommendation({
      asin: "B0TEST1234",
      keywordText: "test keyword",
      oldBid: 100,
      newBid: 80,
      bidChange: -20,
      bidChangePercent: -20,
      reasonCode: "ACOS_HIGH",
      isApplied: false,
    });

    const stats = logger.getStats();
    expect(stats.recommendationsCount).toBe(1);
    expect(stats.bidIncreasesCount).toBe(0);
    expect(stats.bidDecreasesCount).toBe(1);
  });

  it("推奨ログを記録し統計を更新する（入札変更なし）", async () => {
    const logger = new ExecutionLogger(options);

    await logger.logRecommendation({
      asin: "B0TEST1234",
      keywordText: "test keyword",
      oldBid: 100,
      newBid: 100,
      bidChange: 0,
      bidChangePercent: 0,
      reasonCode: "NO_CHANGE",
      isApplied: false,
    });

    const stats = logger.getStats();
    expect(stats.recommendationsCount).toBe(1);
    expect(stats.bidUnchangedCount).toBe(1);
  });

  it("適用された推奨はappliedCountを増やす", async () => {
    const logger = new ExecutionLogger(options);

    await logger.logRecommendation({
      asin: "B0TEST1234",
      keywordText: "test keyword",
      oldBid: 100,
      newBid: 120,
      bidChange: 20,
      bidChangePercent: 20,
      reasonCode: "ACOS_LOW",
      isApplied: true,
    });

    const stats = logger.getStats();
    expect(stats.appliedCount).toBe(1);
  });
});

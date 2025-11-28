/**
 * A/Bテストモジュール ユニットテスト
 */

import {
  // グループ割り当て
  murmurhash3_32,
  normalizeHash,
  createAssignmentKey,
  determineGroup,
  assignToGroup,
  assignMultipleToGroups,
  calculateAssignmentStats,
  validateAssignmentDistribution,
  CachedGroupAssigner,
  createAssigner,
  // テスト管理
  createTestConfig,
  updateTestConfig,
  startTest,
  pauseTest,
  completeTest,
  cancelTest,
  isEntityTargeted,
  isTestInValidPeriod,
  getRemainingDays,
  getElapsedDays,
  validateCreateTestOptions,
  validateOverrides,
  mergeOverrides,
  getOverridesForGroup,
  ABTestManager,
  getABTestManager,
  resetABTestManager,
  // 統計評価
  normalCdf,
  standardError,
  welchTTest,
  calculateCohensD,
  calculateRequiredSampleSize,
  calculatePower,
  evaluateMetric,
  // 型
  ABTestConfig,
  ABTestAssignment,
  BidEngineOverrides,
  DEFAULT_BID_ENGINE_OVERRIDES,
  AB_TEST_CONSTANTS,
} from "../src/ab-test";

// =============================================================================
// MurmurHash3 テスト
// =============================================================================

describe("murmurhash3_32", () => {
  test("同じ入力に対して同じハッシュ値を返す", () => {
    const key = "test-key";
    const hash1 = murmurhash3_32(key);
    const hash2 = murmurhash3_32(key);
    expect(hash1).toBe(hash2);
  });

  test("異なる入力に対して異なるハッシュ値を返す", () => {
    const hash1 = murmurhash3_32("key1");
    const hash2 = murmurhash3_32("key2");
    expect(hash1).not.toBe(hash2);
  });

  test("シードが異なると異なるハッシュ値を返す", () => {
    const key = "test-key";
    const hash1 = murmurhash3_32(key, 0);
    const hash2 = murmurhash3_32(key, 42);
    expect(hash1).not.toBe(hash2);
  });

  test("空文字列でもエラーにならない", () => {
    const hash = murmurhash3_32("");
    expect(typeof hash).toBe("number");
  });

  test("符号なし32bit整数を返す", () => {
    const hash = murmurhash3_32("test");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("normalizeHash", () => {
  test("0を返す（最小ハッシュ）", () => {
    expect(normalizeHash(0)).toBe(0);
  });

  test("1に近い値を返す（最大ハッシュ）", () => {
    expect(normalizeHash(0xffffffff)).toBeCloseTo(1, 5);
  });

  test("0-1の範囲の値を返す", () => {
    const normalized = normalizeHash(0x7fffffff);
    expect(normalized).toBeGreaterThanOrEqual(0);
    expect(normalized).toBeLessThanOrEqual(1);
  });
});

describe("createAssignmentKey", () => {
  test("テストIDとエンティティキーを結合する", () => {
    const key = createAssignmentKey("test-123", "entity-456");
    expect(key).toBe("test-123|entity-456");
  });
});

describe("determineGroup", () => {
  test("ハッシュ値が比率未満ならTESTを返す", () => {
    expect(determineGroup(0.3, 0.5)).toBe("TEST");
  });

  test("ハッシュ値が比率以上ならCONTROLを返す", () => {
    expect(determineGroup(0.7, 0.5)).toBe("CONTROL");
  });

  test("境界値: ちょうど比率ならCONTROLを返す", () => {
    expect(determineGroup(0.5, 0.5)).toBe("CONTROL");
  });
});

describe("assignToGroup", () => {
  test("割り当て結果を返す", () => {
    const assignment = assignToGroup("test-1", "asin-123", "ASIN", 0.5);

    expect(assignment.testId).toBe("test-1");
    expect(assignment.assignmentKey).toBe("asin-123");
    expect(assignment.assignmentLevel).toBe("ASIN");
    expect(["CONTROL", "TEST"]).toContain(assignment.group);
    expect(assignment.assignedAt).toBeInstanceOf(Date);
    expect(typeof assignment.hashValue).toBe("number");
  });

  test("同じ入力で常に同じグループに割り当てられる", () => {
    const assignment1 = assignToGroup("test-1", "asin-123", "ASIN", 0.5);
    const assignment2 = assignToGroup("test-1", "asin-123", "ASIN", 0.5);

    expect(assignment1.group).toBe(assignment2.group);
  });
});

describe("assignMultipleToGroups", () => {
  test("複数エンティティを割り当てる", () => {
    const testConfig: ABTestConfig = {
      testId: "test-1",
      name: "Test",
      description: "Test description",
      status: "RUNNING",
      assignmentLevel: "ASIN",
      testGroupRatio: 0.5,
      testOverrides: {},
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const assignments = assignMultipleToGroups(testConfig, [
      "asin-1",
      "asin-2",
      "asin-3",
    ]);

    expect(assignments).toHaveLength(3);
    assignments.forEach((a) => {
      expect(a.testId).toBe("test-1");
      expect(["CONTROL", "TEST"]).toContain(a.group);
    });
  });
});

describe("calculateAssignmentStats", () => {
  test("統計情報を正しく計算する", () => {
    const assignments: ABTestAssignment[] = [
      {
        testId: "test-1",
        assignmentKey: "key-1",
        assignmentLevel: "ASIN",
        group: "CONTROL",
        assignedAt: new Date(),
      },
      {
        testId: "test-1",
        assignmentKey: "key-2",
        assignmentLevel: "ASIN",
        group: "CONTROL",
        assignedAt: new Date(),
      },
      {
        testId: "test-1",
        assignmentKey: "key-3",
        assignmentLevel: "ASIN",
        group: "TEST",
        assignedAt: new Date(),
      },
    ];

    const stats = calculateAssignmentStats(assignments);

    expect(stats.total).toBe(3);
    expect(stats.controlCount).toBe(2);
    expect(stats.testCount).toBe(1);
    expect(stats.controlRatio).toBeCloseTo(0.667, 2);
    expect(stats.testRatio).toBeCloseTo(0.333, 2);
  });

  test("空配列の場合", () => {
    const stats = calculateAssignmentStats([]);

    expect(stats.total).toBe(0);
    expect(stats.controlRatio).toBe(0);
    expect(stats.testRatio).toBe(0);
  });
});

describe("validateAssignmentDistribution", () => {
  test("均等な分布は有効と判定される", () => {
    const assignments: ABTestAssignment[] = [];
    for (let i = 0; i < 100; i++) {
      assignments.push({
        testId: "test-1",
        assignmentKey: `key-${i}`,
        assignmentLevel: "ASIN",
        group: i < 50 ? "CONTROL" : "TEST",
        assignedAt: new Date(),
      });
    }

    const result = validateAssignmentDistribution(assignments, 0.5);
    expect(result.isValid).toBe(true);
  });

  test("空配列は無効と判定される", () => {
    const result = validateAssignmentDistribution([], 0.5);
    expect(result.isValid).toBe(false);
  });
});

describe("CachedGroupAssigner", () => {
  test("割り当てをキャッシュする", () => {
    const testConfig: ABTestConfig = {
      testId: "test-cache",
      name: "Cache Test",
      description: "Test caching",
      status: "RUNNING",
      assignmentLevel: "ASIN",
      testGroupRatio: 0.5,
      testOverrides: {},
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const assigner = new CachedGroupAssigner(testConfig);

    const assignment1 = assigner.assign("asin-1");
    const assignment2 = assigner.assign("asin-1");

    expect(assignment1).toBe(assignment2); // 同じオブジェクト参照
    expect(assigner.getCacheSize()).toBe(1);
  });

  test("既存の割り当てをロードできる", () => {
    const testConfig: ABTestConfig = {
      testId: "test-load",
      name: "Load Test",
      description: "Test loading",
      status: "RUNNING",
      assignmentLevel: "ASIN",
      testGroupRatio: 0.5,
      testOverrides: {},
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const existingAssignments: ABTestAssignment[] = [
      {
        testId: "test-load",
        assignmentKey: "asin-existing",
        assignmentLevel: "ASIN",
        group: "TEST",
        assignedAt: new Date(),
      },
    ];

    const assigner = createAssigner(testConfig, existingAssignments);

    const cached = assigner.getCachedAssignment("asin-existing");
    expect(cached).toBeDefined();
    expect(cached?.group).toBe("TEST");
  });
});

// =============================================================================
// テスト管理 テスト
// =============================================================================

describe("createTestConfig", () => {
  const validOptions = {
    name: "Test Name",
    description: "Test Description",
    assignmentLevel: "ASIN" as const,
    testGroupRatio: 0.5,
    testOverrides: { targetAcosMultiplier: 1.1 },
    startDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 明日
    endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2週間後
  };

  test("有効なオプションでテスト設定を作成できる", () => {
    const config = createTestConfig(validOptions);

    expect(config.testId).toBeDefined();
    expect(config.name).toBe("Test Name");
    expect(config.description).toBe("Test Description");
    expect(config.status).toBe("DRAFT");
    expect(config.assignmentLevel).toBe("ASIN");
    expect(config.testGroupRatio).toBe(0.5);
  });

  test("デフォルトのテストグループ比率が適用される", () => {
    const optionsWithoutRatio = { ...validOptions };
    delete (optionsWithoutRatio as any).testGroupRatio;

    const config = createTestConfig(optionsWithoutRatio);
    expect(config.testGroupRatio).toBe(AB_TEST_CONSTANTS.DEFAULT_TEST_GROUP_RATIO);
  });

  test("無効なオプションでエラーをスローする", () => {
    const invalidOptions = { ...validOptions, name: "" };
    expect(() => createTestConfig(invalidOptions)).toThrow();
  });
});

describe("validateCreateTestOptions", () => {
  test("有効なオプションを検証する", () => {
    const options = {
      name: "Test",
      description: "Description",
      assignmentLevel: "ASIN" as const,
      testOverrides: {},
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    };

    const result = validateCreateTestOptions(options);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("名前がない場合はエラー", () => {
    const options = {
      name: "",
      description: "Description",
      assignmentLevel: "ASIN" as const,
      testOverrides: {},
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    };

    const result = validateCreateTestOptions(options);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("テスト名"))).toBe(true);
  });

  test("無効なテストグループ比率でエラー", () => {
    const options = {
      name: "Test",
      description: "Description",
      assignmentLevel: "ASIN" as const,
      testGroupRatio: 1.5, // 無効
      testOverrides: {},
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    };

    const result = validateCreateTestOptions(options);
    expect(result.valid).toBe(false);
  });
});

describe("validateOverrides", () => {
  test("有効なオーバーライドを検証する", () => {
    const overrides: BidEngineOverrides = {
      targetAcosMultiplier: 1.1,
      strongUpRate: 0.25,
    };

    const errors = validateOverrides(overrides);
    expect(errors).toHaveLength(0);
  });

  test("無効な目標ACOS乗数でエラー", () => {
    const overrides: BidEngineOverrides = {
      targetAcosMultiplier: 3.0, // 2を超える
    };

    const errors = validateOverrides(overrides);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("テストステータス管理", () => {
  const createDraftConfig = (): ABTestConfig => ({
    testId: "test-status",
    name: "Status Test",
    description: "Testing status changes",
    status: "DRAFT",
    assignmentLevel: "ASIN",
    testGroupRatio: 0.5,
    testOverrides: {},
    startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // 昨日（テスト開始可能）
    endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  test("DRAFTからRUNNINGに変更できる", () => {
    const config = createDraftConfig();
    const started = startTest(config);
    expect(started.status).toBe("RUNNING");
  });

  test("RUNNINGからPAUSEDに変更できる", () => {
    const config = { ...createDraftConfig(), status: "RUNNING" as const };
    const paused = pauseTest(config);
    expect(paused.status).toBe("PAUSED");
  });

  test("RUNNINGからCOMPLETEDに変更できる", () => {
    const config = { ...createDraftConfig(), status: "RUNNING" as const };
    const completed = completeTest(config);
    expect(completed.status).toBe("COMPLETED");
  });

  test("RUNNINGからCANCELLEDに変更できる", () => {
    const config = { ...createDraftConfig(), status: "RUNNING" as const };
    const cancelled = cancelTest(config);
    expect(cancelled.status).toBe("CANCELLED");
  });

  test("COMPLETEDからは変更できない", () => {
    const config = { ...createDraftConfig(), status: "COMPLETED" as const };
    expect(() => cancelTest(config)).toThrow();
  });
});

describe("isEntityTargeted", () => {
  test("フィルターなしの場合は全対象", () => {
    const result = isEntityTargeted(undefined, { asin: "B123" });
    expect(result).toBe(true);
  });

  test("ASINフィルターで対象を絞り込む", () => {
    const filters = { asins: ["B123", "B456"] };
    expect(isEntityTargeted(filters, { asin: "B123" })).toBe(true);
    expect(isEntityTargeted(filters, { asin: "B789" })).toBe(false);
  });

  test("ライフサイクルステートフィルターで対象を絞り込む", () => {
    const filters = { lifecycleStates: ["LAUNCH_HARD", "GROW"] };
    expect(isEntityTargeted(filters, { lifecycleState: "GROW" })).toBe(true);
    expect(isEntityTargeted(filters, { lifecycleState: "HARVEST" })).toBe(false);
  });
});

describe("isTestInValidPeriod", () => {
  test("有効期間内ならtrue", () => {
    const config: ABTestConfig = {
      testId: "test",
      name: "Test",
      description: "Test",
      status: "RUNNING",
      assignmentLevel: "ASIN",
      testGroupRatio: 0.5,
      testOverrides: {},
      startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // 昨日
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1週間後
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(isTestInValidPeriod(config)).toBe(true);
  });

  test("開始前ならfalse", () => {
    const config: ABTestConfig = {
      testId: "test",
      name: "Test",
      description: "Test",
      status: "RUNNING",
      assignmentLevel: "ASIN",
      testGroupRatio: 0.5,
      testOverrides: {},
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1週間後
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(isTestInValidPeriod(config)).toBe(false);
  });
});

describe("getRemainingDays / getElapsedDays", () => {
  const createConfig = (startDaysAgo: number, endDaysFromNow: number): ABTestConfig => ({
    testId: "test",
    name: "Test",
    description: "Test",
    status: "RUNNING",
    assignmentLevel: "ASIN",
    testGroupRatio: 0.5,
    testOverrides: {},
    startDate: new Date(Date.now() - startDaysAgo * 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + endDaysFromNow * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  test("残り日数を計算する", () => {
    const config = createConfig(3, 7);
    expect(getRemainingDays(config)).toBeGreaterThanOrEqual(7);
  });

  test("経過日数を計算する", () => {
    const config = createConfig(3, 7);
    expect(getElapsedDays(config)).toBeGreaterThanOrEqual(3);
  });
});

describe("mergeOverrides", () => {
  test("デフォルト値とオーバーライドをマージする", () => {
    const overrides: BidEngineOverrides = {
      targetAcosMultiplier: 1.2,
    };

    const merged = mergeOverrides(overrides);

    expect(merged.targetAcosMultiplier).toBe(1.2);
    expect(merged.strongUpRate).toBe(DEFAULT_BID_ENGINE_OVERRIDES.strongUpRate);
  });
});

describe("getOverridesForGroup", () => {
  const testConfig: ABTestConfig = {
    testId: "test",
    name: "Test",
    description: "Test",
    status: "RUNNING",
    assignmentLevel: "ASIN",
    testGroupRatio: 0.5,
    testOverrides: { targetAcosMultiplier: 1.1 },
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  test("CONTROLグループはnullを返す", () => {
    expect(getOverridesForGroup(testConfig, "CONTROL")).toBeNull();
  });

  test("TESTグループはオーバーライドを返す", () => {
    const overrides = getOverridesForGroup(testConfig, "TEST");
    expect(overrides).not.toBeNull();
    expect(overrides?.targetAcosMultiplier).toBe(1.1);
  });
});

describe("ABTestManager", () => {
  beforeEach(() => {
    resetABTestManager();
  });

  test("シングルトンインスタンスを取得できる", () => {
    const manager1 = getABTestManager();
    const manager2 = getABTestManager();
    expect(manager1).toBe(manager2);
  });

  test("テストを登録・取得できる", () => {
    const manager = getABTestManager();
    const config: ABTestConfig = {
      testId: "test-manager",
      name: "Manager Test",
      description: "Test",
      status: "DRAFT",
      assignmentLevel: "ASIN",
      testGroupRatio: 0.5,
      testOverrides: {},
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    manager.registerTest(config);

    const retrieved = manager.getTest("test-manager");
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("Manager Test");
  });
});

// =============================================================================
// 統計評価 テスト
// =============================================================================

describe("normalCdf", () => {
  test("z=0でCDF=0.5", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 2);
  });

  test("z=-∞に近い値でCDF≈0", () => {
    expect(normalCdf(-10)).toBeLessThan(0.001);
  });

  test("z=+∞に近い値でCDF≈1", () => {
    expect(normalCdf(10)).toBeGreaterThan(0.999);
  });

  test("z=1.96でCDF≈0.975", () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
  });
});

describe("standardError", () => {
  test("標準誤差を計算する", () => {
    expect(standardError(10, 100)).toBeCloseTo(1, 2);
  });

  test("サンプルサイズ0でも0を返す", () => {
    expect(standardError(10, 0)).toBe(0);
  });
});

describe("welchTTest", () => {
  test("同じ平均の場合はt値が0に近い", () => {
    const result = welchTTest(10, 10, 2, 2, 30, 30);
    expect(result.tStatistic).toBeCloseTo(0, 2);
  });

  test("異なる平均の場合はt値が有意", () => {
    const result = welchTTest(10, 15, 2, 2, 30, 30);
    expect(Math.abs(result.tStatistic)).toBeGreaterThan(1.96);
    expect(result.significanceLevel).not.toBe("NOT_SIGNIFICANT");
  });

  test("サンプルサイズが小さい場合は自由度が小さい", () => {
    const result = welchTTest(10, 15, 2, 2, 3, 3);
    // 平均差が大きく標準偏差が小さい場合、サンプルサイズが小さくても有意になり得る
    // ここでは自由度が適切に計算されることを確認
    expect(result.degreesOfFreedom).toBeGreaterThan(0);
    expect(result.degreesOfFreedom).toBeLessThan(10);
  });

  test("信頼区間を返す", () => {
    const result = welchTTest(10, 12, 2, 2, 30, 30);
    expect(result.confidenceIntervalLower).toBeLessThan(result.confidenceIntervalUpper);
  });
});

describe("calculateCohensD", () => {
  test("同じ平均の場合はd=0", () => {
    const result = calculateCohensD(10, 10, 2, 2, 30, 30);
    expect(result.cohensD).toBeCloseTo(0, 2);
    expect(result.interpretation).toBe("NEGLIGIBLE");
  });

  test("小さな効果量", () => {
    const result = calculateCohensD(10, 10.5, 2, 2, 30, 30);
    expect(Math.abs(result.cohensD)).toBeLessThan(0.5);
    expect(["NEGLIGIBLE", "SMALL"]).toContain(result.interpretation);
  });

  test("大きな効果量", () => {
    const result = calculateCohensD(10, 14, 2, 2, 30, 30);
    expect(Math.abs(result.cohensD)).toBeGreaterThan(0.8);
    expect(["MEDIUM", "LARGE"]).toContain(result.interpretation);
  });
});

describe("calculateRequiredSampleSize", () => {
  test("効果量0.3で適切なサンプルサイズを返す", () => {
    const n = calculateRequiredSampleSize(0.3);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(500);
  });

  test("効果量が小さいほどサンプルサイズが大きい", () => {
    const n1 = calculateRequiredSampleSize(0.2);
    const n2 = calculateRequiredSampleSize(0.5);
    expect(n1).toBeGreaterThan(n2);
  });
});

describe("calculatePower", () => {
  test("サンプルサイズが大きいほど検出力が高い", () => {
    const power1 = calculatePower(50, 50, 0.3);
    const power2 = calculatePower(200, 200, 0.3);
    expect(power2).toBeGreaterThan(power1);
  });

  test("検出力は0-1の範囲", () => {
    const power = calculatePower(100, 100, 0.3);
    expect(power).toBeGreaterThanOrEqual(0);
    expect(power).toBeLessThanOrEqual(1);
  });
});

describe("evaluateMetric", () => {
  test("改善を検出する（高い方が良い指標）", () => {
    const result = evaluateMetric(
      "ROAS",
      3.0, // control
      3.5, // test
      0.5,
      0.5,
      100,
      100,
      true // higher is better
    );

    expect(result.difference).toBeCloseTo(0.5, 2);
    expect(result.isImproved).toBe(true);
  });

  test("改善を検出する（低い方が良い指標）", () => {
    const result = evaluateMetric(
      "ACOS",
      0.25, // control
      0.22, // test
      0.03,
      0.03,
      100,
      100,
      false // lower is better
    );

    expect(result.difference).toBeLessThan(0);
    expect(result.isImproved).toBe(true);
  });

  test("差分パーセントを計算する", () => {
    const result = evaluateMetric(
      "Sales",
      100,
      120,
      10,
      10,
      50,
      50,
      true
    );

    expect(result.differencePercent).toBeCloseTo(20, 1);
  });
});

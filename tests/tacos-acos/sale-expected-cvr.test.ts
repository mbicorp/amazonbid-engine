/**
 * セール用期待CVR計算モジュールのテスト
 */

import {
  getUpliftScheduleValue,
  getUpliftScheduleValueInterpolated,
  computeWLive,
  computeExpectedCvrSale,
  getExpectedCvrForPhase,
  validateUpliftSchedule,
  isNearSaleEnd,
  generateDynamicUpliftSchedule,
} from "../../src/tacos-acos/sale-expected-cvr";
import {
  SaleExpectedCvrInput,
  SaleExpectedCvrConfig,
  DEFAULT_SALE_EXPECTED_CVR_CONFIG,
  UpliftScheduleBand,
} from "../../src/tacos-acos/types";

describe("getUpliftScheduleValue", () => {
  const schedule = DEFAULT_SALE_EXPECTED_CVR_CONFIG.upliftSchedule;

  it("セール開始直後（0-2時間）は高アップリフト", () => {
    expect(getUpliftScheduleValue(0, schedule)).toBe(1.8);
    expect(getUpliftScheduleValue(1, schedule)).toBe(1.8);
    expect(getUpliftScheduleValue(1.9, schedule)).toBe(1.8);
  });

  it("序盤（2-12時間）は中程度のアップリフト", () => {
    expect(getUpliftScheduleValue(2, schedule)).toBe(1.3);
    expect(getUpliftScheduleValue(6, schedule)).toBe(1.3);
    expect(getUpliftScheduleValue(11.9, schedule)).toBe(1.3);
  });

  it("中盤（12-43時間）は低アップリフト", () => {
    expect(getUpliftScheduleValue(12, schedule)).toBe(1.1);
    expect(getUpliftScheduleValue(30, schedule)).toBe(1.1);
    expect(getUpliftScheduleValue(42.9, schedule)).toBe(1.1);
  });

  it("終了間際（43-48時間）は高アップリフト", () => {
    expect(getUpliftScheduleValue(43, schedule)).toBe(1.7);
    expect(getUpliftScheduleValue(46, schedule)).toBe(1.7);
    expect(getUpliftScheduleValue(47.9, schedule)).toBe(1.7);
  });

  it("負の値（セール前）は1.0を返す", () => {
    expect(getUpliftScheduleValue(-1, schedule)).toBe(1.0);
    expect(getUpliftScheduleValue(-10, schedule)).toBe(1.0);
  });

  it("スケジュール外の時間は1.0を返す", () => {
    expect(getUpliftScheduleValue(50, schedule)).toBe(1.0);
    expect(getUpliftScheduleValue(100, schedule)).toBe(1.0);
  });
});

describe("getUpliftScheduleValueInterpolated", () => {
  const schedule = DEFAULT_SALE_EXPECTED_CVR_CONFIG.upliftSchedule;

  it("バンド中央では補間なしの値を返す", () => {
    expect(getUpliftScheduleValueInterpolated(1, schedule, 0.5)).toBe(1.8);
    expect(getUpliftScheduleValueInterpolated(6, schedule, 0.5)).toBe(1.3);
  });

  it("バンド境界付近では線形補間される", () => {
    // 2時間の0.25時間前（1.75時間）
    // uplift 1.8 → 1.3 の遷移中
    const value = getUpliftScheduleValueInterpolated(1.75, schedule, 0.5);
    expect(value).toBeGreaterThan(1.3);
    expect(value).toBeLessThan(1.8);
  });
});

describe("computeWLive", () => {
  const config = DEFAULT_SALE_EXPECTED_CVR_CONFIG;

  it("クリック数が少ないとw_live_minが適用される", () => {
    const result = computeWLive(10, config);

    // 10 / 50 = 0.2 < wMinSale (0.3)
    expect(result.wLiveRaw).toBeCloseTo(0.2, 4);
    expect(result.wLiveClipped).toBeCloseTo(0.2, 4);
    expect(result.wLiveFinal).toBe(0.3);
  });

  it("クリック数が多いとw_liveが高くなる", () => {
    const result = computeWLive(40, config);

    // 40 / 50 = 0.8
    expect(result.wLiveRaw).toBeCloseTo(0.8, 4);
    expect(result.wLiveFinal).toBeCloseTo(0.8, 4);
  });

  it("クリック数がbaseClicksSale以上でも1.0を超えない", () => {
    const result = computeWLive(100, config);

    expect(result.wLiveRaw).toBeCloseTo(2.0, 4);
    expect(result.wLiveClipped).toBe(1.0);
    expect(result.wLiveFinal).toBe(1.0);
  });
});

describe("computeExpectedCvrSale", () => {
  const config = DEFAULT_SALE_EXPECTED_CVR_CONFIG;

  it("セール開始直後は高い期待CVRになる", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 1,
      clicksSale: 20,
      cvrObservedSale: 0.05,
    };
    const result = computeExpectedCvrSale(input, config);

    // uplift = 1.8
    // prior = 0.03 × 1.8 = 0.054
    // w_live = max(0.3, 20/50) = 0.4
    // blended = 0.6 × 0.054 + 0.4 × 0.05 = 0.0324 + 0.02 = 0.0524
    expect(result.expectedCvrSale).toBeCloseTo(0.0524, 4);
  });

  it("クリック数が多いと実績CVRの重みが増す", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 1,
      clicksSale: 50,
      cvrObservedSale: 0.08,
    };
    const result = computeExpectedCvrSale(input, config);

    // w_live = 1.0
    // 完全に実績CVRを使用
    expect(result.breakdown.wLiveFinal).toBe(1.0);
    // ただしmaxUpliftでクリップされる可能性あり
  });

  it("maxUpliftでクリップされる", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 1,
      clicksSale: 50,
      cvrObservedSale: 0.15, // 5倍の観測CVR
    };
    const result = computeExpectedCvrSale(input, config);

    // maxUplift = 2.5
    // max = 0.03 × 2.5 = 0.075
    expect(result.expectedCvrSale).toBe(0.075);
    expect(result.breakdown.wasMaxUpliftApplied).toBe(true);
  });

  it("中盤はアップリフトが控えめ", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 24,
      clicksSale: 30,
      cvrObservedSale: 0.035,
    };
    const result = computeExpectedCvrSale(input, config);

    // uplift = 1.1
    // prior = 0.03 × 1.1 = 0.033
    expect(result.breakdown.expectedCvrSalePrior).toBeCloseTo(0.033, 4);
  });

  it("負のCVRは0にクリップされる", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 1,
      clicksSale: 50,
      cvrObservedSale: -0.05, // 不正な値
    };
    const result = computeExpectedCvrSale(input, config);

    // 結果は0以上
    expect(result.expectedCvrSale).toBeGreaterThanOrEqual(0);
  });
});

describe("getExpectedCvrForPhase", () => {
  it("NORMALフェーズでは通常CVRを返す", () => {
    const result = getExpectedCvrForPhase("NORMAL", 0.03);

    expect(result.expectedCvrUsed).toBe(0.03);
    expect(result.isSaleMode).toBe(false);
  });

  it("PRE_SALEフェーズでは通常CVRを返す", () => {
    const result = getExpectedCvrForPhase("PRE_SALE", 0.03);

    expect(result.expectedCvrUsed).toBe(0.03);
    expect(result.isSaleMode).toBe(false);
  });

  it("COOL_DOWNフェーズでは通常CVRを返す", () => {
    const result = getExpectedCvrForPhase("COOL_DOWN", 0.03);

    expect(result.expectedCvrUsed).toBe(0.03);
    expect(result.isSaleMode).toBe(false);
  });

  it("MAIN_SALEフェーズではセール用CVRを計算", () => {
    const saleInput = {
      hoursSinceMainSaleStart: 1,
      clicksSale: 30,
      cvrObservedSale: 0.05,
    };
    const result = getExpectedCvrForPhase("MAIN_SALE", 0.03, saleInput);

    expect(result.isSaleMode).toBe(true);
    expect(result.expectedCvrUsed).toBeGreaterThan(0.03);
    expect(result.saleResult).toBeDefined();
  });

  it("MAIN_SALEでもsaleInputがなければ通常CVRを使用", () => {
    const result = getExpectedCvrForPhase("MAIN_SALE", 0.03);

    expect(result.expectedCvrUsed).toBe(0.03);
    expect(result.isSaleMode).toBe(false);
  });
});

describe("validateUpliftSchedule", () => {
  it("有効なスケジュールはエラーなし", () => {
    const errors = validateUpliftSchedule(DEFAULT_SALE_EXPECTED_CVR_CONFIG.upliftSchedule);
    expect(errors).toHaveLength(0);
  });

  it("空のスケジュールはエラー", () => {
    const errors = validateUpliftSchedule([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("空です");
  });

  it("startHour >= endHourはエラー", () => {
    const schedule: UpliftScheduleBand[] = [
      { startHour: 5, endHour: 3, uplift: 1.5 },
    ];
    const errors = validateUpliftSchedule(schedule);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("startHour");
  });

  it("uplift <= 0はエラー", () => {
    const schedule: UpliftScheduleBand[] = [
      { startHour: 0, endHour: 5, uplift: -0.5 },
    ];
    const errors = validateUpliftSchedule(schedule);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("uplift");
  });

  it("重複する区間はエラー", () => {
    const schedule: UpliftScheduleBand[] = [
      { startHour: 0, endHour: 5, uplift: 1.5 },
      { startHour: 3, endHour: 8, uplift: 1.3 }, // 0-5と重複
    ];
    const errors = validateUpliftSchedule(schedule);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("重複");
  });
});

describe("isNearSaleEnd", () => {
  it("終了5時間前を正しく判定", () => {
    expect(isNearSaleEnd(43, 48, 5)).toBe(true);
    expect(isNearSaleEnd(45, 48, 5)).toBe(true);
    expect(isNearSaleEnd(47, 48, 5)).toBe(true);
  });

  it("中盤は終了前ではない", () => {
    expect(isNearSaleEnd(20, 48, 5)).toBe(false);
    expect(isNearSaleEnd(42, 48, 5)).toBe(false);
  });

  it("セール終了後は終了前ではない", () => {
    expect(isNearSaleEnd(50, 48, 5)).toBe(false);
  });
});

describe("generateDynamicUpliftSchedule", () => {
  it("48時間セールのスケジュールを生成", () => {
    const schedule = generateDynamicUpliftSchedule(48);

    expect(schedule).toHaveLength(4);
    expect(schedule[0].uplift).toBe(1.8); // 開始直後
    expect(schedule[1].uplift).toBe(1.3); // 序盤
    expect(schedule[2].uplift).toBe(1.1); // 中盤
    expect(schedule[3].uplift).toBe(1.7); // 終了間際
  });

  it("24時間セールのスケジュールを生成", () => {
    const schedule = generateDynamicUpliftSchedule(24);

    expect(schedule).toHaveLength(4);
    // 終了5時間前は19時間から
    expect(schedule[3].startHour).toBe(19);
    expect(schedule[3].endHour).toBe(24);
  });

  it("短いセール（12時間未満）は簡略化されたスケジュール", () => {
    const schedule = generateDynamicUpliftSchedule(8);

    // 短いセールでは中盤がスキップされる
    expect(schedule.length).toBeLessThanOrEqual(3);
  });

  it("カスタムパラメータを指定できる", () => {
    const schedule = generateDynamicUpliftSchedule(48, {
      launchUplift: 2.0,
      earlyUplift: 1.5,
      midUplift: 1.2,
      finalUplift: 2.0,
      hoursBeforeEnd: 3,
    });

    expect(schedule[0].uplift).toBe(2.0);
    expect(schedule[3].startHour).toBe(45); // 48 - 3
  });
});

describe("統合シナリオ", () => {
  it("タイムセール開始直後の高CVR期待", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 0.5,
      clicksSale: 15,
      cvrObservedSale: 0.06,
    };
    const result = computeExpectedCvrSale(input);

    // 開始直後はuplift=1.8
    expect(result.breakdown.upliftScheduleValue).toBe(1.8);
    // 期待CVRは通常より高い
    expect(result.expectedCvrSale).toBeGreaterThan(0.03);
  });

  it("セール中盤の安定期", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 24,
      clicksSale: 100,
      cvrObservedSale: 0.035,
    };
    const result = computeExpectedCvrSale(input);

    // 中盤はuplift=1.1
    expect(result.breakdown.upliftScheduleValue).toBe(1.1);
    // w_live=1.0なので実績CVRが主
    expect(result.breakdown.wLiveFinal).toBe(1.0);
    expect(result.expectedCvrSale).toBeCloseTo(0.035, 4);
  });

  it("セール終了間際の駆け込み需要", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 46,
      clicksSale: 25,
      cvrObservedSale: 0.07,
    };
    const result = computeExpectedCvrSale(input);

    // 終了間際はuplift=1.7
    expect(result.breakdown.upliftScheduleValue).toBe(1.7);
    // 期待CVRは高め
    expect(result.expectedCvrSale).toBeGreaterThan(0.04);
  });
});

describe("エッジケース", () => {
  it("expectedCvrNormalが0でも計算が成功する", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0,
      hoursSinceMainSaleStart: 1,
      clicksSale: 30,
      cvrObservedSale: 0.05,
    };
    const result = computeExpectedCvrSale(input);

    // 事前期待は0だが、実績CVRがあるのでブレンド後は正
    expect(result.expectedCvrSale).toBeGreaterThanOrEqual(0);
  });

  it("clicksSaleが0でもw_min_saleが適用される", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 1,
      clicksSale: 0,
      cvrObservedSale: 0,
    };
    const result = computeExpectedCvrSale(input);

    expect(result.breakdown.wLiveFinal).toBe(DEFAULT_SALE_EXPECTED_CVR_CONFIG.wMinSale);
    expect(result.expectedCvrSale).toBeGreaterThan(0);
  });

  it("非常に大きなhoursSinceMainSaleStartでも計算が成功する", () => {
    const input: SaleExpectedCvrInput = {
      expectedCvrNormal: 0.03,
      hoursSinceMainSaleStart: 1000,
      clicksSale: 30,
      cvrObservedSale: 0.03,
    };
    const result = computeExpectedCvrSale(input);

    // スケジュール外はuplift=1.0
    expect(result.breakdown.upliftScheduleValue).toBe(1.0);
    expect(Number.isFinite(result.expectedCvrSale)).toBe(true);
  });
});

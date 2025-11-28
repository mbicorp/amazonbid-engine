/**
 * 期待CVR計算ヘルパーのテスト
 */

import {
  computeExpectedCvr,
  computeExpectedCvrSimple,
  ExpectedCvrInput,
  ExpectedCvrConfig,
  DEFAULT_EXPECTED_CVR_CONFIG,
  toExpectedCvrLifecycle,
} from "../../src/metrics/expectedCvr";

describe("computeExpectedCvr", () => {
  describe("基本的なCVR計算", () => {
    it("キーワード7日データのみでCVRを計算", () => {
      const input: ExpectedCvrInput = {
        keyword7d: { clicks: 100, orders: 5 }, // CVR = 5%
      };

      const result = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

      // 信頼度: min(1, 100/20) = 1.0
      // 実効重み: 3 * 1.0 = 3
      // カテゴリ重み: 0.5
      // 期待CVR: (3 * 0.05 + 0.5 * 0) / (3 + 0.5) = 0.15 / 3.5 ≈ 0.0429
      expect(result.expectedCvr).toBeCloseTo(0.0429, 3);
      expect(result.breakdown.rawCvr.keyword7d).toBe(0.05);
      expect(result.breakdown.reliability.keyword7d).toBe(1);
    });

    it("複数ソースのデータを重み付け混合", () => {
      const input: ExpectedCvrInput = {
        keyword7d: { clicks: 20, orders: 1 },   // CVR = 5%, 信頼度 = 1.0
        keyword30d: { clicks: 50, orders: 2 },  // CVR = 4%, 信頼度 = 1.0
        asinAds30d: { clicks: 200, orders: 6 }, // CVR = 3%, 信頼度 = 1.0
        categoryBaselineCvr: 0.02,
      };

      const result = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

      // 各ソースの寄与を確認
      expect(result.breakdown.rawCvr.keyword7d).toBe(0.05);
      expect(result.breakdown.rawCvr.keyword30d).toBe(0.04);
      expect(result.breakdown.rawCvr.asinAds).toBe(0.03);
      expect(result.breakdown.rawCvr.category).toBe(0.02);

      // 重み付け平均がベースになる
      expect(result.expectedCvr).toBeGreaterThan(0.02);
      expect(result.expectedCvr).toBeLessThan(0.05);
    });

    it("データが少ないソースは信頼度が低くなる", () => {
      const inputLowClicks: ExpectedCvrInput = {
        keyword7d: { clicks: 5, orders: 1 }, // CVR = 20%, 信頼度 = 0.25
        categoryBaselineCvr: 0.02,
      };

      const inputHighClicks: ExpectedCvrInput = {
        keyword7d: { clicks: 50, orders: 10 }, // CVR = 20%, 信頼度 = 1.0
        categoryBaselineCvr: 0.02,
      };

      const resultLow = computeExpectedCvr(inputLowClicks, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");
      const resultHigh = computeExpectedCvr(inputHighClicks, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

      // 信頼度が低いとカテゴリCVRに近づく
      expect(resultLow.breakdown.reliability.keyword7d).toBe(0.25);
      expect(resultHigh.breakdown.reliability.keyword7d).toBe(1);

      // 高信頼度の方がキーワードCVRに近い
      expect(resultHigh.expectedCvr).toBeGreaterThan(resultLow.expectedCvr);
    });
  });

  describe("ライフサイクル補正", () => {
    it("LAUNCH期はCVRを低めに見積もる", () => {
      const input: ExpectedCvrInput = {
        keyword7d: { clicks: 100, orders: 5 },
      };

      const resultLaunch = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "LAUNCH");
      const resultGrow = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

      expect(resultLaunch.breakdown.lifecycleAdjust).toBe(0.8);
      expect(resultGrow.breakdown.lifecycleAdjust).toBe(1.0);
      expect(resultLaunch.expectedCvr).toBeLessThan(resultGrow.expectedCvr);
    });

    it("HARVEST期はCVRを高めに見積もる", () => {
      const input: ExpectedCvrInput = {
        keyword7d: { clicks: 100, orders: 5 },
      };

      const resultGrow = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");
      const resultHarvest = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "HARVEST");

      expect(resultHarvest.breakdown.lifecycleAdjust).toBe(1.1);
      expect(resultHarvest.expectedCvr).toBeGreaterThan(resultGrow.expectedCvr);
    });

    it("LifecycleStageを直接渡しても動作する", () => {
      const input: ExpectedCvrInput = {
        keyword7d: { clicks: 100, orders: 5 },
      };

      const resultLaunchHard = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "LAUNCH_HARD");
      const resultLaunchSoft = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "LAUNCH_SOFT");

      // 両方ともLAUNCH扱いになる
      expect(resultLaunchHard.breakdown.lifecycleAdjust).toBe(0.8);
      expect(resultLaunchSoft.breakdown.lifecycleAdjust).toBe(0.8);
    });
  });

  describe("エッジケース", () => {
    it("全てのデータがない場合は0を返す", () => {
      const input: ExpectedCvrInput = {};

      const result = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

      expect(result.expectedCvr).toBe(0);
    });

    it("カテゴリCVRのみの場合はカテゴリCVRをベースにする", () => {
      const input: ExpectedCvrInput = {
        categoryBaselineCvr: 0.03,
      };

      const result = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

      // カテゴリ重みのみが効くが、他の実効重みは0なので
      // カテゴリCVRがそのまま返る
      expect(result.expectedCvr).toBeCloseTo(0.03, 3);
    });

    it("クリック0の場合はCVR=0として扱う", () => {
      const input: ExpectedCvrInput = {
        keyword7d: { clicks: 0, orders: 0 },
        categoryBaselineCvr: 0.02,
      };

      const result = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

      expect(result.breakdown.rawCvr.keyword7d).toBe(0);
      expect(result.breakdown.reliability.keyword7d).toBe(0);
    });

    it("CVRが1を超える場合は1にクリップ", () => {
      const input: ExpectedCvrInput = {
        keyword7d: { clicks: 100, orders: 150 }, // CVR = 150%（異常値）
      };

      const result = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "HARVEST");

      expect(result.expectedCvr).toBeLessThanOrEqual(1);
    });
  });

  describe("ビジネスレポートデータ", () => {
    it("セッションベースのCVRを正しく計算", () => {
      const input: ExpectedCvrInput = {
        asinTotal30d: { sessions: 1000, orders: 50 }, // CVR = 5%
      };

      const result = computeExpectedCvr(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

      expect(result.breakdown.rawCvr.asinTotal).toBe(0.05);
      // 信頼度: min(1, 1000/500) = 1.0
      expect(result.breakdown.reliability.asinTotal).toBe(1);
    });
  });
});

describe("computeExpectedCvrSimple", () => {
  it("数値のみを返す", () => {
    const input: ExpectedCvrInput = {
      keyword7d: { clicks: 100, orders: 5 },
    };

    const result = computeExpectedCvrSimple(input, DEFAULT_EXPECTED_CVR_CONFIG, "GROW");

    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });
});

describe("toExpectedCvrLifecycle", () => {
  it("LAUNCH_HARD/LAUNCH_SOFTをLAUNCHに変換", () => {
    expect(toExpectedCvrLifecycle("LAUNCH_HARD")).toBe("LAUNCH");
    expect(toExpectedCvrLifecycle("LAUNCH_SOFT")).toBe("LAUNCH");
  });

  it("GROW/HARVESTはそのまま", () => {
    expect(toExpectedCvrLifecycle("GROW")).toBe("GROW");
    expect(toExpectedCvrLifecycle("HARVEST")).toBe("HARVEST");
  });
});

describe("カスタム設定", () => {
  it("カスタム設定で計算できる", () => {
    const customConfig: ExpectedCvrConfig = {
      baseClicksKeyword7d: 10, // より少ないクリックで信頼度1
      baseClicksKeyword30d: 25,
      baseClicksAsinAds: 100,
      baseSessionsAsinTotal: 250,
      weightKeyword7d: 5,      // キーワード7日をより重視
      weightKeyword30d: 1,
      weightAsinAds: 0.5,
      weightAsinTotal: 0.5,
      weightCategory: 0.1,
      lifecycleAdjust: {
        LAUNCH: 0.7,
        GROW: 1.0,
        HARVEST: 1.2,
      },
    };

    const input: ExpectedCvrInput = {
      keyword7d: { clicks: 10, orders: 1 }, // CVR = 10%, 信頼度 = 1.0
    };

    const result = computeExpectedCvr(input, customConfig, "GROW");

    // キーワード7日の重みが高いのでCVRに近い値になる
    expect(result.expectedCvr).toBeGreaterThan(0.08);
  });
});

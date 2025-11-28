/**
 * 理論最大CPC計算モジュールのテスト
 */

import {
  computeMaxCpcHard,
  computeTheoreticalMaxCpc,
  applyCpcGuard,
  applyTheoreticalMaxCpcGuard,
  computeBreakEvenCpc,
  computeCpcUtilization,
  computeCpcHeadroom,
  computeTheoreticalMaxCpcSimple,
  isBidWithinTheoreticalLimit,
} from "../../src/tacos-acos/theoretical-max-cpc";
import {
  TheoreticalMaxCpcInput,
  TheoreticalMaxCpcConfig,
  DEFAULT_THEORETICAL_MAX_CPC_CONFIG,
} from "../../src/tacos-acos/types";

describe("computeMaxCpcHard", () => {
  it("理論最大CPCを正しく計算する", () => {
    // price=3000円, T_stage=0.15, expectedCvr=0.03, safetyFactor=1.15
    const result = computeMaxCpcHard(3000, 0.15, 0.03, 1.15);

    // maxCpcHard = 3000 × 0.15 × 0.03 = 13.5円
    expect(result.maxCpcHard).toBeCloseTo(13.5, 4);

    // maxCpcWithSafety = 13.5 × 1.15 = 15.525円
    expect(result.maxCpcWithSafety).toBeCloseTo(15.525, 4);
  });

  it("高価格商品ではCPC上限が高くなる", () => {
    const result = computeMaxCpcHard(10000, 0.15, 0.03, 1.15);

    // maxCpcHard = 10000 × 0.15 × 0.03 = 45円
    expect(result.maxCpcHard).toBeCloseTo(45, 4);
    expect(result.maxCpcWithSafety).toBeCloseTo(51.75, 4);
  });

  it("CVRが高いとCPC上限が高くなる", () => {
    const result = computeMaxCpcHard(3000, 0.15, 0.10, 1.15);

    // maxCpcHard = 3000 × 0.15 × 0.10 = 45円
    expect(result.maxCpcHard).toBeCloseTo(45, 4);
  });
});

describe("computeTheoreticalMaxCpc", () => {
  const baseInput: TheoreticalMaxCpcInput = {
    price: 3000,
    tStageNormal: 0.15,
    expectedCvrNormal: 0.03,
    salePhase: "NORMAL",
  };

  it("通常フェーズでは通常時の理論最大CPCを返す", () => {
    const result = computeTheoreticalMaxCpc(baseInput);

    // 13.5 × 1.15 = 15.525円
    expect(result.theoreticalMaxCpc).toBeCloseTo(15.525, 4);
    expect(result.theoreticalMaxCpcNormal).toBeCloseTo(15.525, 4);
    expect(result.wasUpliftCapped).toBe(false);
  });

  it("MAIN_SALEフェーズではセール用パラメータを使用", () => {
    const saleInput: TheoreticalMaxCpcInput = {
      ...baseInput,
      salePhase: "MAIN_SALE",
      tStageSmode: 0.195, // 0.15 × 1.3
      expectedCvrSale: 0.05, // 通常の1.67倍
    };
    const result = computeTheoreticalMaxCpc(saleInput);

    // maxCpcHard = 3000 × 0.195 × 0.05 = 29.25円
    // maxCpcWithSafety = 29.25 × 1.15 = 33.6375円
    expect(result.breakdown.maxCpcHard).toBeCloseTo(29.25, 4);
    expect(result.breakdown.maxCpcWithSafety).toBeCloseTo(33.6375, 4);
  });

  it("セール時のCPC上昇が上限を超える場合はクリップ", () => {
    const saleInput: TheoreticalMaxCpcInput = {
      ...baseInput,
      salePhase: "MAIN_SALE",
      tStageSmode: 0.30, // 2倍
      expectedCvrSale: 0.09, // 3倍
    };
    const result = computeTheoreticalMaxCpc(saleInput);

    // 通常時: 15.525円
    // セール時計算値: 3000 × 0.30 × 0.09 × 1.15 = 93.15円
    // 上限: 15.525 × 2.0 = 31.05円
    expect(result.wasUpliftCapped).toBe(true);
    expect(result.theoreticalMaxCpc).toBeCloseTo(31.05, 4);
  });

  it("PRE_SALEフェーズでは通常値を使用", () => {
    const result = computeTheoreticalMaxCpc({
      ...baseInput,
      salePhase: "PRE_SALE",
    });

    expect(result.theoreticalMaxCpc).toBeCloseTo(15.525, 4);
  });

  it("COOL_DOWNフェーズでは通常値を使用", () => {
    const result = computeTheoreticalMaxCpc({
      ...baseInput,
      salePhase: "COOL_DOWN",
    });

    expect(result.theoreticalMaxCpc).toBeCloseTo(15.525, 4);
  });
});

describe("applyCpcGuard", () => {
  it("推奨入札が理論最大CPC以下ならそのまま返す", () => {
    const result = applyCpcGuard(10, 15);

    expect(result.cappedBid).toBe(10);
    expect(result.wasCapped).toBe(false);
    expect(result.capReason).toBeNull();
  });

  it("推奨入札が理論最大CPCを超えていればクリップ", () => {
    const result = applyCpcGuard(20, 15);

    expect(result.cappedBid).toBe(15);
    expect(result.wasCapped).toBe(true);
    expect(result.capReason).toContain("理論最大CPC");
  });

  it("結果は整数に丸められる", () => {
    const result = applyCpcGuard(20.7, 15.3);

    expect(result.cappedBid).toBe(15);
  });
});

describe("applyTheoreticalMaxCpcGuard", () => {
  const baseInput: TheoreticalMaxCpcInput = {
    price: 3000,
    tStageNormal: 0.15,
    expectedCvrNormal: 0.03,
    salePhase: "NORMAL",
  };

  it("入札計算パイプラインに統合してガードを適用", () => {
    const result = applyTheoreticalMaxCpcGuard(10, baseInput);

    expect(result.finalBid).toBe(10);
    expect(result.guardResult.wasCapped).toBe(false);
  });

  it("理論最大CPCを超える入札をクリップ", () => {
    const result = applyTheoreticalMaxCpcGuard(100, baseInput);

    // 理論最大CPC: 15.525円
    expect(result.guardResult.wasCapped).toBe(true);
    expect(result.finalBid).toBe(16); // 15.525を丸め
  });
});

describe("computeBreakEvenCpc", () => {
  it("損益分岐CPCを正しく計算する", () => {
    // price=3000円, marginPotential=0.50, expectedCvr=0.03
    const breakEvenCpc = computeBreakEvenCpc(3000, 0.50, 0.03);

    // 3000 × 0.50 × 0.03 = 45円
    expect(breakEvenCpc).toBeCloseTo(45, 4);
  });
});

describe("computeCpcUtilization", () => {
  it("CPC使用率を正しく計算する", () => {
    expect(computeCpcUtilization(10, 20)).toBeCloseTo(0.5, 4);
    expect(computeCpcUtilization(20, 20)).toBeCloseTo(1.0, 4);
    expect(computeCpcUtilization(30, 20)).toBeCloseTo(1.5, 4);
  });

  it("理論最大CPCが0の場合はInfinityを返す", () => {
    expect(computeCpcUtilization(10, 0)).toBe(Infinity);
  });

  it("両方0の場合は0を返す", () => {
    expect(computeCpcUtilization(0, 0)).toBe(0);
  });
});

describe("computeCpcHeadroom", () => {
  it("CPC余裕度を正しく計算する", () => {
    expect(computeCpcHeadroom(10, 20)).toBe(10);
    expect(computeCpcHeadroom(20, 20)).toBe(0);
    expect(computeCpcHeadroom(30, 20)).toBe(-10);
  });
});

describe("computeTheoreticalMaxCpcSimple", () => {
  it("最小限のパラメータから理論最大CPCを計算する", () => {
    const result = computeTheoreticalMaxCpcSimple(3000, 0.15, 0.03);

    // 3000 × 0.15 × 0.03 × 1.15 = 15.525円
    expect(result).toBeCloseTo(15.525, 4);
  });

  it("カスタム設定を使用できる", () => {
    const customConfig: TheoreticalMaxCpcConfig = {
      cpcSafetyFactor: 1.0,
      cpcUpliftCap: 2.0,
    };
    const result = computeTheoreticalMaxCpcSimple(3000, 0.15, 0.03, customConfig);

    // 3000 × 0.15 × 0.03 × 1.0 = 13.5円
    expect(result).toBeCloseTo(13.5, 4);
  });
});

describe("isBidWithinTheoreticalLimit", () => {
  it("理論上限内の入札ならtrueを返す", () => {
    // 理論最大CPC: 15.525円
    expect(isBidWithinTheoreticalLimit(10, 3000, 0.15, 0.03)).toBe(true);
    expect(isBidWithinTheoreticalLimit(15, 3000, 0.15, 0.03)).toBe(true);
  });

  it("理論上限を超える入札ならfalseを返す", () => {
    expect(isBidWithinTheoreticalLimit(20, 3000, 0.15, 0.03)).toBe(false);
  });
});

describe("統合シナリオ", () => {
  it("NORMAL日のキーワード入札", () => {
    const input: TheoreticalMaxCpcInput = {
      price: 3000,
      tStageNormal: 0.15,
      expectedCvrNormal: 0.03,
      salePhase: "NORMAL",
    };

    // 推奨入札: 12円（理論最大CPC以下）
    const result = applyTheoreticalMaxCpcGuard(12, input);

    expect(result.finalBid).toBe(12);
    expect(result.guardResult.wasCapped).toBe(false);
  });

  it("MAIN_SALE中のアグレッシブな入札", () => {
    const input: TheoreticalMaxCpcInput = {
      price: 3000,
      tStageNormal: 0.15,
      expectedCvrNormal: 0.03,
      salePhase: "MAIN_SALE",
      tStageSmode: 0.195,
      expectedCvrSale: 0.06, // 2倍のCVR
    };

    // 推奨入札: 50円（セール時は攻め気味）
    const result = applyTheoreticalMaxCpcGuard(50, input);

    // セール時理論最大CPC: 3000 × 0.195 × 0.06 × 1.15 = 40.365円
    // ただし、通常時上限の2倍を超えないようクリップ
    // 通常時: 15.525 × 2 = 31.05円
    expect(result.cpcResult.wasUpliftCapped).toBe(true);
    expect(result.finalBid).toBe(31);
  });

  it("低CVRキーワードの理論最大CPCは低い", () => {
    const result = computeTheoreticalMaxCpcSimple(3000, 0.15, 0.01);

    // 3000 × 0.15 × 0.01 × 1.15 = 5.175円
    expect(result).toBeCloseTo(5.175, 4);
  });

  it("高価格・高CVR商品は高い入札が許容される", () => {
    const result = computeTheoreticalMaxCpcSimple(10000, 0.20, 0.10);

    // 10000 × 0.20 × 0.10 × 1.15 = 230円
    expect(result).toBeCloseTo(230, 4);
  });
});

describe("エッジケース", () => {
  it("価格が0の場合は理論最大CPCも0", () => {
    const result = computeTheoreticalMaxCpcSimple(0, 0.15, 0.03);
    expect(result).toBe(0);
  });

  it("T_stageが0の場合は理論最大CPCも0", () => {
    const result = computeTheoreticalMaxCpcSimple(3000, 0, 0.03);
    expect(result).toBe(0);
  });

  it("expectedCvrが0の場合は理論最大CPCも0", () => {
    const result = computeTheoreticalMaxCpcSimple(3000, 0.15, 0);
    expect(result).toBe(0);
  });

  it("非常に小さい値でも計算が成功する", () => {
    const result = computeTheoreticalMaxCpcSimple(100, 0.01, 0.001);
    // 100 × 0.01 × 0.001 × 1.15 = 0.00115円
    expect(result).toBeCloseTo(0.00115, 6);
  });
});

/**
 * ライフサイクルサジェストロジックのテスト
 */

import {
  computeLifecycleSuggestion,
  LifecycleSuggestionInput,
  SUGGESTION_CONSTANTS,
} from "../src/lifecycle/lifecycleSuggestion";
import { ProductConfig } from "../src/ltv/types";
import { SeoMetrics } from "../src/seo/types";

// =============================================================================
// テストヘルパー
// =============================================================================

/**
 * テスト用のProductConfigを作成
 */
function createProductConfig(
  overrides: Partial<ProductConfig> = {}
): ProductConfig {
  return {
    productId: "prod-001",
    asin: "B0TESTXXXX",
    isActive: true,
    revenueModel: "LTV",
    ltvMode: "ASSUMED",
    businessMode: "PROFIT",
    brandType: "GENERIC",
    experimentGroup: "CONTROL",
    marginRate: 0.4,
    expectedRepeatOrdersAssumed: 2.0,
    expectedRepeatOrdersMeasured: null,
    safetyFactorAssumed: 0.7,
    safetyFactorMeasured: 0.85,
    launchDate: null,
    daysSinceLaunch: null,
    newCustomersTotal: 0,
    lifecycleState: "GROW",
    ...overrides,
  };
}

/**
 * テスト用のSeoMetricsを作成
 */
function createSeoMetrics(
  overrides: Partial<SeoMetrics> = {}
): SeoMetrics {
  return {
    asin: "B0TESTXXXX",
    currentRank: 15,
    prevRank: 15,
    rankTrend: 0,
    rankStatus: "FLAT",
    rankZone: "MID_ZONE",
    ...overrides,
  };
}

/**
 * テスト用の入力を作成
 */
function createInput(
  overrides: Partial<LifecycleSuggestionInput> = {}
): LifecycleSuggestionInput {
  return {
    product: createProductConfig(),
    seo: createSeoMetrics(),
    acosRecent: 0.25,
    cvrRecent: 0.03,
    cvrCategoryAvg: 0.025,
    reviewCount: 50,
    avgRating: 4.0,
    daysOfInventory: 30,
    isBeforeBigSale: false,
    ...overrides,
  };
}

// =============================================================================
// HARVEST判定テスト
// =============================================================================

describe("HARVEST判定", () => {
  describe("在庫日数が少ない場合", () => {
    it("在庫日数がLOW_INVENTORY_DAYS未満ならHARVEST推奨", () => {
      const input = createInput({
        daysOfInventory: SUGGESTION_CONSTANTS.LOW_INVENTORY_DAYS - 1,
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("HARVEST");
      expect(result.reason).toContain("在庫日数が少ない");
    });
  });

  describe("ACOSが大幅に悪化している場合", () => {
    it("ACOSがtarget_acosの1.3倍以上ならHARVEST推奨", () => {
      const targetAcos = 0.25;
      const input = createInput({
        acosRecent: targetAcos * SUGGESTION_CONSTANTS.ACOS_BAD_MULTIPLIER + 0.01,
      });

      const result = computeLifecycleSuggestion(input, targetAcos);

      expect(result.suggestedState).toBe("HARVEST");
      expect(result.reason).toContain("ACOS");
      expect(result.reason).toContain("超過");
    });
  });

  describe("SEO順位が下降トレンドの場合", () => {
    it("TOP_ZONEで下降トレンドならHARVEST推奨", () => {
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "DOWN",
          rankZone: "TOP_ZONE",
          currentRank: 5,
        }),
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("HARVEST");
      expect(result.reason).toContain("SEO順位が下降トレンド");
    });

    it("MID_ZONEで下降トレンドならHARVEST推奨", () => {
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "DOWN",
          rankZone: "MID_ZONE",
          currentRank: 15,
        }),
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("HARVEST");
      expect(result.reason).toContain("SEO順位が下降トレンド");
    });

    it("OUT_OF_RANGEで下降トレンドはHARVEST推奨にならない", () => {
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "DOWN",
          rankZone: "OUT_OF_RANGE",
          currentRank: 30,
        }),
        daysOfInventory: 50, // 在庫十分
        acosRecent: 0.2, // ACOS良好
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).not.toBe("HARVEST");
    });
  });
});

// =============================================================================
// LAUNCH_HARD判定テスト
// =============================================================================

describe("LAUNCH_HARD判定", () => {
  describe("SEO上昇トレンドでMID_ZONEの場合", () => {
    it("上昇トレンドでMID_ZONEならLAUNCH_HARD推奨", () => {
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "UP",
          rankZone: "MID_ZONE",
          currentRank: 12,
          prevRank: 18,
          rankTrend: 6,
        }),
        daysOfInventory: 50,
        acosRecent: 0.2,
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("LAUNCH_HARD");
      expect(result.reason).toContain("SEO順位が上昇トレンド");
      expect(result.reason).toContain("MID_ZONE");
    });
  });

  describe("順位は低いがCVRがカテゴリ平均以上の場合", () => {
    it("CVRがカテゴリ平均以上かつ順位が低いならLAUNCH_HARD推奨", () => {
      const input = createInput({
        seo: createSeoMetrics({
          currentRank: 25,
          rankZone: "OUT_OF_RANGE",
          rankStatus: "FLAT",
        }),
        cvrRecent: 0.04,
        cvrCategoryAvg: 0.03,
        daysOfInventory: 50,
        acosRecent: 0.2,
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("LAUNCH_HARD");
      expect(result.reason).toContain("CVR");
      expect(result.reason).toContain("カテゴリ平均");
    });
  });

  describe("セール前の場合", () => {
    it("セール前ならLAUNCH_HARD推奨", () => {
      const input = createInput({
        isBeforeBigSale: true,
        daysOfInventory: 50,
        acosRecent: 0.2,
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("LAUNCH_HARD");
      expect(result.reason).toContain("セール前");
    });
  });

  describe("レビュー数が少ないがCVRに伸びしろがある場合", () => {
    it("レビュー少＋CVR良好ならLAUNCH_HARD推奨", () => {
      const input = createInput({
        reviewCount: SUGGESTION_CONSTANTS.LOW_REVIEW_THRESHOLD - 5,
        cvrRecent: SUGGESTION_CONSTANTS.MIN_CVR_FOR_LAUNCH + 0.01,
        daysOfInventory: 50,
        acosRecent: 0.2,
        seo: createSeoMetrics({
          rankStatus: "FLAT",
          rankZone: "MID_ZONE",
        }),
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("LAUNCH_HARD");
      expect(result.reason).toContain("レビュー数が少ない");
      expect(result.reason).toContain("伸びしろ");
    });
  });
});

// =============================================================================
// GROW判定テスト
// =============================================================================

describe("GROW判定", () => {
  describe("SEO安定、ACOS安定、在庫十分の場合", () => {
    it("すべての条件を満たせばGROW推奨", () => {
      const targetAcos = 0.3;
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "FLAT",
          rankZone: "TOP_ZONE",
          currentRank: 5,
        }),
        acosRecent: targetAcos, // ターゲットちょうど
        daysOfInventory: SUGGESTION_CONSTANTS.STABLE_INVENTORY_DAYS + 10,
        reviewCount: 100,
        isBeforeBigSale: false,
      });

      const result = computeLifecycleSuggestion(input, targetAcos);

      expect(result.suggestedState).toBe("GROW");
      expect(result.reason).toContain("安定");
    });

    it("MID_ZONEでもGROW推奨になる", () => {
      const targetAcos = 0.3;
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "FLAT",
          rankZone: "MID_ZONE",
          currentRank: 12,
        }),
        acosRecent: targetAcos * 0.95, // ターゲットより少し低い
        daysOfInventory: 30,
        reviewCount: 100,
        isBeforeBigSale: false,
      });

      const result = computeLifecycleSuggestion(input, targetAcos);

      expect(result.suggestedState).toBe("GROW");
    });

    it("rankStatusがUNKNOWNでもGROW推奨になりうる", () => {
      const targetAcos = 0.3;
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "UNKNOWN",
          rankZone: "TOP_ZONE",
        }),
        acosRecent: targetAcos,
        daysOfInventory: 30,
        reviewCount: 100,
        isBeforeBigSale: false,
      });

      const result = computeLifecycleSuggestion(input, targetAcos);

      expect(result.suggestedState).toBe("GROW");
    });
  });
});

// =============================================================================
// LAUNCH_SOFT判定テスト（デフォルト）
// =============================================================================

describe("LAUNCH_SOFT判定（デフォルト）", () => {
  it("どの条件にも当てはまらない場合はLAUNCH_SOFT", () => {
    const input = createInput({
      seo: createSeoMetrics({
        rankStatus: "FLAT",
        rankZone: "OUT_OF_RANGE", // GROWにならない
        currentRank: 30,
      }),
      acosRecent: 0.25,
      cvrRecent: 0.02, // カテゴリ平均未満
      cvrCategoryAvg: 0.03,
      daysOfInventory: 30, // 在庫十分
      reviewCount: 50, // レビュー十分
      isBeforeBigSale: false,
    });

    const result = computeLifecycleSuggestion(input, 0.3);

    expect(result.suggestedState).toBe("LAUNCH_SOFT");
    expect(result.reason).toContain("明確な攻め時でも守り時でもない");
  });
});

// =============================================================================
// 優先順位テスト
// =============================================================================

describe("判定の優先順位", () => {
  it("HARVEST条件とLAUNCH_HARD条件が両方満たされる場合、HARVESTが優先", () => {
    const input = createInput({
      // HARVEST条件: 在庫少ない
      daysOfInventory: 5,
      // LAUNCH_HARD条件: セール前
      isBeforeBigSale: true,
    });

    const result = computeLifecycleSuggestion(input, 0.3);

    expect(result.suggestedState).toBe("HARVEST");
  });

  it("複数のHARVEST条件が満たされる場合、理由が連結される", () => {
    const targetAcos = 0.2;
    const input = createInput({
      // 在庫少ない
      daysOfInventory: 5,
      // ACOS悪化
      acosRecent: 0.5,
    });

    const result = computeLifecycleSuggestion(input, targetAcos);

    expect(result.suggestedState).toBe("HARVEST");
    expect(result.reason).toContain("在庫日数");
    expect(result.reason).toContain("ACOS");
  });

  it("複数のLAUNCH_HARD条件が満たされる場合、理由が連結される", () => {
    const input = createInput({
      // SEO上昇
      seo: createSeoMetrics({
        rankStatus: "UP",
        rankZone: "MID_ZONE",
        currentRank: 12,
      }),
      // セール前
      isBeforeBigSale: true,
      daysOfInventory: 50,
      acosRecent: 0.2,
    });

    const result = computeLifecycleSuggestion(input, 0.3);

    expect(result.suggestedState).toBe("LAUNCH_HARD");
    expect(result.reason).toContain("SEO");
    expect(result.reason).toContain("セール前");
  });
});

// =============================================================================
// null値の処理テスト
// =============================================================================

describe("null値の処理", () => {
  it("acosRecentがnullでもエラーにならない", () => {
    const input = createInput({
      acosRecent: null,
    });

    expect(() => computeLifecycleSuggestion(input, 0.3)).not.toThrow();
  });

  it("daysOfInventoryがnullでもエラーにならない", () => {
    const input = createInput({
      daysOfInventory: null,
    });

    expect(() => computeLifecycleSuggestion(input, 0.3)).not.toThrow();
  });

  it("cvrCategoryAvgがnullでもエラーにならない", () => {
    const input = createInput({
      cvrCategoryAvg: null,
    });

    expect(() => computeLifecycleSuggestion(input, 0.3)).not.toThrow();
  });

  it("すべてnullでもデフォルトのLAUNCH_SOFTが返る", () => {
    const input = createInput({
      acosRecent: null,
      cvrRecent: null,
      cvrCategoryAvg: null,
      reviewCount: null,
      avgRating: null,
      daysOfInventory: null,
      seo: createSeoMetrics({
        currentRank: null,
        prevRank: null,
        rankTrend: null,
        rankStatus: "UNKNOWN",
        rankZone: "UNKNOWN",
      }),
    });

    const result = computeLifecycleSuggestion(input, 0.3);

    expect(result.suggestedState).toBe("LAUNCH_SOFT");
  });
});

// =============================================================================
// ユーザー要件検証テスト
// =============================================================================

describe("ユーザー要件検証", () => {
  describe("SEO上昇局面でLAUNCH_HARDを返す", () => {
    it("20位→15位→10位の上昇でLAUNCH_HARD", () => {
      const input = createInput({
        seo: createSeoMetrics({
          currentRank: 10,
          prevRank: 15,
          rankTrend: 5,
          rankStatus: "UP",
          rankZone: "MID_ZONE",
        }),
        daysOfInventory: 50,
        acosRecent: 0.2,
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("LAUNCH_HARD");
    });
  });

  describe("在庫少ない・ACOS悪化・SEO下降でHARVESTを返す", () => {
    it("在庫が少ないケース", () => {
      const input = createInput({
        daysOfInventory: 5,
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("HARVEST");
    });

    it("ACOSが悪化しているケース", () => {
      const input = createInput({
        acosRecent: 0.5, // target 0.3の1.3倍以上
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("HARVEST");
    });

    it("SEO下降のケース", () => {
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "DOWN",
          rankZone: "TOP_ZONE",
        }),
      });

      const result = computeLifecycleSuggestion(input, 0.3);

      expect(result.suggestedState).toBe("HARVEST");
    });
  });

  describe("SEO安定・ACOS安定・在庫十分でGROWを返す", () => {
    it("すべて安定しているケース", () => {
      const targetAcos = 0.3;
      const input = createInput({
        seo: createSeoMetrics({
          rankStatus: "FLAT",
          rankZone: "TOP_ZONE",
        }),
        acosRecent: targetAcos * 0.95,
        daysOfInventory: 30,
      });

      const result = computeLifecycleSuggestion(input, targetAcos);

      expect(result.suggestedState).toBe("GROW");
    });
  });
});

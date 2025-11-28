/**
 * CORE_SEOスコア計算ヘルパーのテスト
 */

import {
  computeCoreSeoScore,
  computeCoreSeoScoreSimple,
  rankCoreSeoKeywords,
  isCoreSeoCandidate,
  CoreKeywordMetrics,
  CoreScoreConfig,
  DEFAULT_CORE_SCORE_CONFIG,
} from "../../src/metrics/coreSeoScoring";

describe("computeCoreSeoScore", () => {
  describe("基本的なスコア計算", () => {
    it("高関連度・高ボリュームキーワードは高スコア", () => {
      const metrics: CoreKeywordMetrics = {
        searchVolumeMonth: 50000,
        relText: 0.9,           // 高い関連度
        relBrand: 0,            // ジェネリックキーワード
        convShare: 0.3,         // 30%シェア
        cpcPercentile: 0.5,     // 中程度の競合
        sponsoredSlotsNorm: 0.5,
        brandSearchVolume: 5000, // 成長期ブランド
      };

      const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

      // 高い関連度と高いボリュームで高スコア
      expect(result.score).toBeGreaterThan(3);
      expect(result.breakdown.contributions.text).toBeGreaterThan(2); // 3 * 0.9 = 2.7
    });

    it("低関連度キーワードは高関連度より低スコア", () => {
      const metricsLowRel: CoreKeywordMetrics = {
        searchVolumeMonth: 50000,
        relText: 0.2,           // 低い関連度
        relBrand: 0,
        convShare: 0.3,
        cpcPercentile: 0.5,
        sponsoredSlotsNorm: 0.5,
        brandSearchVolume: 5000,
      };

      const metricsHighRel: CoreKeywordMetrics = {
        ...metricsLowRel,
        relText: 0.9,           // 高い関連度
      };

      const resultLow = computeCoreSeoScore(metricsLowRel, DEFAULT_CORE_SCORE_CONFIG);
      const resultHigh = computeCoreSeoScore(metricsHighRel, DEFAULT_CORE_SCORE_CONFIG);

      // 関連度が低い方がスコアも低い
      expect(resultLow.score).toBeLessThan(resultHigh.score);
      // テキスト関連度の寄与の差を確認
      expect(resultHigh.breakdown.contributions.text).toBeGreaterThan(resultLow.breakdown.contributions.text);
    });

    it("競合度が高いとペナルティがかかる", () => {
      const metricsLowComp: CoreKeywordMetrics = {
        searchVolumeMonth: 10000,
        relText: 0.8,
        relBrand: 0,
        convShare: 0.2,
        cpcPercentile: 0.2,       // 低競合
        sponsoredSlotsNorm: 0.2,
        brandSearchVolume: 5000,
      };

      const metricsHighComp: CoreKeywordMetrics = {
        ...metricsLowComp,
        cpcPercentile: 0.9,       // 高競合
        sponsoredSlotsNorm: 0.9,
      };

      const resultLow = computeCoreSeoScore(metricsLowComp, DEFAULT_CORE_SCORE_CONFIG);
      const resultHigh = computeCoreSeoScore(metricsHighComp, DEFAULT_CORE_SCORE_CONFIG);

      expect(resultLow.score).toBeGreaterThan(resultHigh.score);
      expect(resultHigh.breakdown.contributions.competition).toBeLessThan(-0.5);
    });
  });

  describe("ブランド成熟度による調整", () => {
    const baseMetrics: CoreKeywordMetrics = {
      searchVolumeMonth: 5000,
      relText: 0.7,
      relBrand: 1,              // ブランドキーワード
      convShare: 0.4,
      cpcPercentile: 0.5,
      sponsoredSlotsNorm: 0.5,
      brandSearchVolume: 0,     // 後で設定
    };

    it("ブランド未成熟期はブランド重みが40%に低下", () => {
      const metrics: CoreKeywordMetrics = {
        ...baseMetrics,
        brandSearchVolume: 1000, // < 3000: 未成熟
      };

      const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

      // brandWeightEffective = 2.5 * 0.4 = 1.0
      expect(result.breakdown.brandWeightEffective).toBeCloseTo(1.0, 2);
      expect(result.breakdown.contributions.brand).toBeCloseTo(1.0, 2); // 1.0 * 1 = 1.0
    });

    it("ブランド成長期はブランド重みが80%", () => {
      const metrics: CoreKeywordMetrics = {
        ...baseMetrics,
        brandSearchVolume: 5000, // 3000-10000: 成長期
      };

      const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

      // brandWeightEffective = 2.5 * 0.8 = 2.0
      expect(result.breakdown.brandWeightEffective).toBeCloseTo(2.0, 2);
    });

    it("ブランド確立後はブランド重みが100%", () => {
      const metrics: CoreKeywordMetrics = {
        ...baseMetrics,
        brandSearchVolume: 15000, // >= 10000: 確立
      };

      const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

      // brandWeightEffective = 2.5 * 1.0 = 2.5
      expect(result.breakdown.brandWeightEffective).toBeCloseTo(2.5, 2);
      expect(result.breakdown.contributions.brand).toBeCloseTo(2.5, 2); // 2.5 * 1 = 2.5
    });
  });

  describe("検索ボリューム正規化", () => {
    it("対数スケールで正規化される", () => {
      const metricsLow: CoreKeywordMetrics = {
        searchVolumeMonth: 1000,
        relText: 0.5,
        relBrand: 0,
        convShare: 0,
        cpcPercentile: 0,
        sponsoredSlotsNorm: 0,
        brandSearchVolume: 5000,
      };

      const metricsHigh: CoreKeywordMetrics = {
        ...metricsLow,
        searchVolumeMonth: 100000, // 100倍
      };

      const resultLow = computeCoreSeoScore(metricsLow, DEFAULT_CORE_SCORE_CONFIG);
      const resultHigh = computeCoreSeoScore(metricsHigh, DEFAULT_CORE_SCORE_CONFIG);

      // 対数スケールなので100倍の差は大きくならない
      expect(resultHigh.breakdown.volNorm).toBeCloseTo(1, 2); // 最大に近い
      expect(resultLow.breakdown.volNorm).toBeGreaterThan(0.5);
    });

    it("ボリューム0の場合は0", () => {
      const metrics: CoreKeywordMetrics = {
        searchVolumeMonth: 0,
        relText: 0.5,
        relBrand: 0,
        convShare: 0,
        cpcPercentile: 0,
        sponsoredSlotsNorm: 0,
        brandSearchVolume: 0,
      };

      const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

      expect(result.breakdown.volNorm).toBe(0);
      expect(result.breakdown.contributions.volume).toBe(0);
    });
  });

  describe("コンバージョンシェア正規化", () => {
    it("基準値以上は1にクリップ", () => {
      const metrics: CoreKeywordMetrics = {
        searchVolumeMonth: 10000,
        relText: 0.5,
        relBrand: 0,
        convShare: 0.6, // > 0.4 (基準値)
        cpcPercentile: 0,
        sponsoredSlotsNorm: 0,
        brandSearchVolume: 5000,
      };

      const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

      expect(result.breakdown.convNorm).toBe(1);
    });

    it("基準値の半分なら0.5", () => {
      const metrics: CoreKeywordMetrics = {
        searchVolumeMonth: 10000,
        relText: 0.5,
        relBrand: 0,
        convShare: 0.2, // 0.2 / 0.4 = 0.5
        cpcPercentile: 0,
        sponsoredSlotsNorm: 0,
        brandSearchVolume: 5000,
      };

      const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

      expect(result.breakdown.convNorm).toBe(0.5);
    });
  });
});

describe("rankCoreSeoKeywords", () => {
  it("スコア順にソートして上位N件を返す", () => {
    const keywords = [
      {
        keyword: "低スコア",
        metrics: {
          searchVolumeMonth: 1000,
          relText: 0.3,
          relBrand: 0,
          convShare: 0,
          cpcPercentile: 0.8,
          sponsoredSlotsNorm: 0.8,
          brandSearchVolume: 5000,
        },
      },
      {
        keyword: "高スコア",
        metrics: {
          searchVolumeMonth: 50000,
          relText: 0.9,
          relBrand: 0,
          convShare: 0.3,
          cpcPercentile: 0.3,
          sponsoredSlotsNorm: 0.3,
          brandSearchVolume: 5000,
        },
      },
      {
        keyword: "中スコア",
        metrics: {
          searchVolumeMonth: 10000,
          relText: 0.6,
          relBrand: 0,
          convShare: 0.1,
          cpcPercentile: 0.5,
          sponsoredSlotsNorm: 0.5,
          brandSearchVolume: 5000,
        },
      },
    ];

    const ranked = rankCoreSeoKeywords(keywords, DEFAULT_CORE_SCORE_CONFIG, 10);

    expect(ranked[0].keyword).toBe("高スコア");
    expect(ranked[1].keyword).toBe("中スコア");
    expect(ranked[2].keyword).toBe("低スコア");
  });

  it("topN件のみ返す", () => {
    const keywords = Array(20).fill(null).map((_, i) => ({
      keyword: `keyword-${i}`,
      metrics: {
        searchVolumeMonth: 1000 + i * 100,
        relText: 0.5,
        relBrand: 0,
        convShare: 0,
        cpcPercentile: 0.5,
        sponsoredSlotsNorm: 0.5,
        brandSearchVolume: 5000,
      },
    }));

    const ranked = rankCoreSeoKeywords(keywords, DEFAULT_CORE_SCORE_CONFIG, 5);

    expect(ranked.length).toBe(5);
  });
});

describe("isCoreSeoCandidate", () => {
  it("スコアと関連度が閾値以上なら適格", () => {
    const metrics: CoreKeywordMetrics = {
      searchVolumeMonth: 50000,
      relText: 0.8,
      relBrand: 0,
      convShare: 0.3,
      cpcPercentile: 0.3,
      sponsoredSlotsNorm: 0.3,
      brandSearchVolume: 5000,
    };
    const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

    expect(isCoreSeoCandidate(metrics, result, 2.0, 0.5)).toBe(true);
  });

  it("スコアが閾値未満なら不適格", () => {
    const metrics: CoreKeywordMetrics = {
      searchVolumeMonth: 100,
      relText: 0.6,  // 関連度は閾値(0.5)以上だがスコアが低くなるように設定
      relBrand: 0,
      convShare: 0,
      cpcPercentile: 0.95, // 非常に高競合
      sponsoredSlotsNorm: 0.95,
      brandSearchVolume: 500,
    };
    const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

    // 高い競合ペナルティと低ボリュームでスコアが低い
    // partText = 3 * 0.6 = 1.8
    // partComp = 1 * 0.95 = 0.95
    // score ≈ 1.8 - 0.95 + vol ≈ 1.5
    expect(result.score).toBeLessThan(2.0);
    expect(isCoreSeoCandidate(metrics, result, 2.0, 0.5)).toBe(false);
  });

  it("関連度が閾値未満なら不適格", () => {
    const metrics: CoreKeywordMetrics = {
      searchVolumeMonth: 50000,
      relText: 0.3, // 低い関連度
      relBrand: 0,
      convShare: 0.3,
      cpcPercentile: 0.3,
      sponsoredSlotsNorm: 0.3,
      brandSearchVolume: 5000,
    };
    const result = computeCoreSeoScore(metrics, DEFAULT_CORE_SCORE_CONFIG);

    expect(isCoreSeoCandidate(metrics, result, 2.0, 0.5)).toBe(false);
  });
});

describe("computeCoreSeoScoreSimple", () => {
  it("数値のみを返す", () => {
    const metrics: CoreKeywordMetrics = {
      searchVolumeMonth: 10000,
      relText: 0.7,
      relBrand: 0,
      convShare: 0.2,
      cpcPercentile: 0.5,
      sponsoredSlotsNorm: 0.5,
      brandSearchVolume: 5000,
    };

    const score = computeCoreSeoScoreSimple(metrics, DEFAULT_CORE_SCORE_CONFIG);

    expect(typeof score).toBe("number");
  });
});

describe("実際の利用シナリオ", () => {
  it("ブランド未成熟期でのスコア比較", () => {
    // 新ブランド（未成熟期）のケースでブランド重みの低下を確認
    const metricsGeneric: CoreKeywordMetrics = {
      searchVolumeMonth: 50000,
      relText: 0.9,
      relBrand: 0,  // ジェネリック
      convShare: 0.1,
      cpcPercentile: 0.5,
      sponsoredSlotsNorm: 0.5,
      brandSearchVolume: 1000,  // ブランド未成熟
    };

    const metricsBrand: CoreKeywordMetrics = {
      searchVolumeMonth: 5000,
      relText: 0.9,
      relBrand: 1,  // ブランドキーワード
      convShare: 0.1,
      cpcPercentile: 0.5,
      sponsoredSlotsNorm: 0.5,
      brandSearchVolume: 1000,  // ブランド未成熟
    };

    const resultGeneric = computeCoreSeoScore(metricsGeneric, DEFAULT_CORE_SCORE_CONFIG);
    const resultBrand = computeCoreSeoScore(metricsBrand, DEFAULT_CORE_SCORE_CONFIG);

    // ブランド未成熟期ではブランド重みが40%に低下
    expect(resultBrand.breakdown.brandWeightEffective).toBeCloseTo(1.0, 2);

    // ブランドの寄与は2.5 * 0.4 * 1 = 1.0
    expect(resultBrand.breakdown.contributions.brand).toBeCloseTo(1.0, 2);

    // ジェネリックは検索ボリュームが高いので、
    // 検索ボリューム寄与の差がブランド寄与を上回る場合にジェネリックが勝つ
    console.log(`Generic score: ${resultGeneric.score.toFixed(2)}, Brand score: ${resultBrand.score.toFixed(2)}`);
  });

  it("ブランド確立後はブランドキーワードが重要になる", () => {
    // ブランド確立後のケース
    const keywords = [
      {
        keyword: "ビタミンC サプリ",
        metrics: {
          searchVolumeMonth: 20000,
          relText: 0.7,
          relBrand: 0,
          convShare: 0.05,
          cpcPercentile: 0.8,
          sponsoredSlotsNorm: 0.8,
          brandSearchVolume: 15000,  // ブランド確立
        },
      },
      {
        keyword: "[ブランド名] ビタミンC",
        metrics: {
          searchVolumeMonth: 5000,
          relText: 0.9,
          relBrand: 1,               // ブランドキーワード
          convShare: 0.8,
          cpcPercentile: 0.1,
          sponsoredSlotsNorm: 0.2,
          brandSearchVolume: 15000,  // ブランド確立
        },
      },
    ];

    const ranked = rankCoreSeoKeywords(keywords, DEFAULT_CORE_SCORE_CONFIG, 10);

    // ブランド確立後は、ブランドキーワードの重みが100%
    // ブランドキーワードが高スコアになる
    expect(ranked[0].keyword).toBe("[ブランド名] ビタミンC");
    expect(ranked[0].result.breakdown.brandWeightEffective).toBeCloseTo(2.5, 1);
  });
});

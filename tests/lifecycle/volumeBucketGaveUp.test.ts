/**
 * VolumeBucket × tier による動的GAVE_UP閾値のテスト
 */

import {
  VolumeBucket,
  CoreKeywordType,
  KeywordCoreRole,
  SeoLaunchStatus,
  KeywordConfigExtended,
  KeywordRankSummary,
  KeywordConfigWithVolumeBucket,
  DEFAULT_VOLUME_BUCKET_THRESHOLDS,
  DEFAULT_GIVEUP_MULTIPLIERS,
  DEFAULT_GIVEUP_BASE_THRESHOLDS,
  DEFAULT_GIVEUP_RANK_THRESHOLDS,
  DEFAULT_DYNAMIC_GIVEUP_CONFIG,
  DEFAULT_SEO_LAUNCH_CONFIG,
  classifyVolumeBucket,
  computeMedianSearchVolume,
  computeGiveUpThresholdsForKeyword,
  enrichKeywordsWithVolumeBucket,
  evaluateKeywordSeoStatusDynamic,
} from "../../src/lifecycle/seo-launch-evaluator";

// =============================================================================
// classifyVolumeBucket テスト
// =============================================================================

describe("classifyVolumeBucket", () => {
  it("volumeRatio >= 2.0 は HIGH_VOLUME", () => {
    expect(classifyVolumeBucket(2.0)).toBe("HIGH_VOLUME");
    expect(classifyVolumeBucket(3.5)).toBe("HIGH_VOLUME");
    expect(classifyVolumeBucket(10.0)).toBe("HIGH_VOLUME");
  });

  it("0.5 <= volumeRatio < 2.0 は MID_VOLUME", () => {
    expect(classifyVolumeBucket(0.5)).toBe("MID_VOLUME");
    expect(classifyVolumeBucket(1.0)).toBe("MID_VOLUME");
    expect(classifyVolumeBucket(1.99)).toBe("MID_VOLUME");
  });

  it("volumeRatio < 0.5 は LOW_VOLUME", () => {
    expect(classifyVolumeBucket(0.49)).toBe("LOW_VOLUME");
    expect(classifyVolumeBucket(0.1)).toBe("LOW_VOLUME");
    expect(classifyVolumeBucket(0.0)).toBe("LOW_VOLUME");
  });

  it("カスタム閾値を使用できる", () => {
    const customThresholds = {
      highVolumeMin: 3.0,
      midVolumeMin: 1.0,
    };
    expect(classifyVolumeBucket(2.5, customThresholds)).toBe("MID_VOLUME");
    expect(classifyVolumeBucket(3.0, customThresholds)).toBe("HIGH_VOLUME");
    expect(classifyVolumeBucket(0.9, customThresholds)).toBe("LOW_VOLUME");
  });
});

// =============================================================================
// computeMedianSearchVolume テスト
// =============================================================================

describe("computeMedianSearchVolume", () => {
  it("奇数個の場合、中央の値を返す", () => {
    const keywords = [
      { searchVolume: 100 },
      { searchVolume: 200 },
      { searchVolume: 300 },
    ];
    expect(computeMedianSearchVolume(keywords)).toBe(200);
  });

  it("偶数個の場合、中央2つの平均を返す", () => {
    const keywords = [
      { searchVolume: 100 },
      { searchVolume: 200 },
      { searchVolume: 300 },
      { searchVolume: 400 },
    ];
    expect(computeMedianSearchVolume(keywords)).toBe(250);
  });

  it("searchVolumeが0やundefinedの場合は除外して計算", () => {
    const keywords = [
      { searchVolume: 0 },
      { searchVolume: 100 },
      { searchVolume: undefined },
      { searchVolume: 200 },
      { searchVolume: 300 },
    ];
    expect(computeMedianSearchVolume(keywords)).toBe(200);
  });

  it("空配列の場合は0を返す", () => {
    expect(computeMedianSearchVolume([])).toBe(0);
  });

  it("有効な検索ボリュームがない場合は0を返す", () => {
    const keywords = [
      { searchVolume: 0 },
      { searchVolume: undefined },
    ];
    expect(computeMedianSearchVolume(keywords)).toBe(0);
  });
});

// =============================================================================
// computeGiveUpThresholdsForKeyword テスト
// =============================================================================

describe("computeGiveUpThresholdsForKeyword", () => {
  describe("BIG tier", () => {
    it("HIGH_VOLUME: 基礎値×1.3、順位+5", () => {
      const result = computeGiveUpThresholdsForKeyword(
        CoreKeywordType.BIG,
        "HIGH_VOLUME"
      );
      // bigBaseDays=60 × 1.3 = 78
      expect(result.minDays).toBe(78);
      // bigBaseClicks=150 × 1.3 = 195
      expect(result.minClicks).toBe(195);
      // bigRankThreshold=45 + 5 = 50
      expect(result.rankThreshold).toBe(50);
    });

    it("MID_VOLUME: 基礎値×1.0、順位調整なし", () => {
      const result = computeGiveUpThresholdsForKeyword(
        CoreKeywordType.BIG,
        "MID_VOLUME"
      );
      expect(result.minDays).toBe(60);
      expect(result.minClicks).toBe(150);
      expect(result.rankThreshold).toBe(45);
    });

    it("LOW_VOLUME: 基礎値×0.7、順位-5", () => {
      const result = computeGiveUpThresholdsForKeyword(
        CoreKeywordType.BIG,
        "LOW_VOLUME"
      );
      // 60 × 0.7 = 42
      expect(result.minDays).toBe(42);
      // 150 × 0.7 = 105
      expect(result.minClicks).toBe(105);
      // 45 - 5 = 40
      expect(result.rankThreshold).toBe(40);
    });
  });

  describe("MIDDLE tier", () => {
    it("HIGH_VOLUME: 基礎値×1.3、順位+5", () => {
      const result = computeGiveUpThresholdsForKeyword(
        CoreKeywordType.MIDDLE,
        "HIGH_VOLUME"
      );
      // midBaseDays=45 × 1.3 = 58.5 → 59 (四捨五入)
      expect(result.minDays).toBe(59);
      // midBaseClicks=100 × 1.3 = 130
      expect(result.minClicks).toBe(130);
      // midRankThreshold=30 + 5 = 35
      expect(result.rankThreshold).toBe(35);
    });

    it("MID_VOLUME: 基礎値×1.0、順位調整なし", () => {
      const result = computeGiveUpThresholdsForKeyword(
        CoreKeywordType.MIDDLE,
        "MID_VOLUME"
      );
      expect(result.minDays).toBe(45);
      expect(result.minClicks).toBe(100);
      expect(result.rankThreshold).toBe(30);
    });

    it("LOW_VOLUME: 基礎値×0.7、順位-5", () => {
      const result = computeGiveUpThresholdsForKeyword(
        CoreKeywordType.MIDDLE,
        "LOW_VOLUME"
      );
      // 45 × 0.7 = 31.5 → 32 (Math.roundで四捨五入)
      expect(result.minDays).toBe(Math.round(45 * 0.7)); // 31 or 32
      // 100 × 0.7 = 70
      expect(result.minClicks).toBe(70);
      // 30 - 5 = 25
      expect(result.rankThreshold).toBe(25);
    });
  });

  describe("BRAND tier (MID扱い)", () => {
    it("MID tierと同じ閾値になる", () => {
      const result = computeGiveUpThresholdsForKeyword(
        CoreKeywordType.BRAND,
        "MID_VOLUME"
      );
      expect(result.minDays).toBe(45);
      expect(result.minClicks).toBe(100);
      expect(result.rankThreshold).toBe(30);
    });
  });

  it("カスタム設定を使用できる", () => {
    const customConfig = {
      ...DEFAULT_DYNAMIC_GIVEUP_CONFIG,
      baseThresholds: {
        midBaseDays: 30,
        midBaseClicks: 50,
        bigBaseDays: 40,
        bigBaseClicks: 80,
      },
      multipliers: {
        daysHigh: 1.5,
        daysMid: 1.0,
        daysLow: 0.5,
        clicksHigh: 1.5,
        clicksMid: 1.0,
        clicksLow: 0.5,
      },
    };

    const result = computeGiveUpThresholdsForKeyword(
      CoreKeywordType.BIG,
      "HIGH_VOLUME",
      customConfig
    );
    // 40 × 1.5 = 60
    expect(result.minDays).toBe(60);
    // 80 × 1.5 = 120
    expect(result.minClicks).toBe(120);
  });
});

// =============================================================================
// enrichKeywordsWithVolumeBucket テスト
// =============================================================================

describe("enrichKeywordsWithVolumeBucket", () => {
  const createKeyword = (
    id: string,
    searchVolume: number,
    coreType: CoreKeywordType = CoreKeywordType.MIDDLE
  ): KeywordConfigExtended => ({
    keywordId: id,
    asin: "B00TEST123",
    keyword: `テスト${id}`,
    coreRole: KeywordCoreRole.CORE,
    coreType,
    searchVolume,
  });

  it("中央値に基づいてvolumeBucketを分類する", () => {
    const keywords = [
      createKeyword("kw-1", 100),   // 100/200 = 0.5 → MID_VOLUME
      createKeyword("kw-2", 200),   // 200/200 = 1.0 → MID_VOLUME (中央値)
      createKeyword("kw-3", 50),    // 50/200 = 0.25 → LOW_VOLUME
      createKeyword("kw-4", 500),   // 500/200 = 2.5 → HIGH_VOLUME
      createKeyword("kw-5", 300),   // 300/200 = 1.5 → MID_VOLUME
    ];

    const enriched = enrichKeywordsWithVolumeBucket(keywords);

    expect(enriched.find((k) => k.keywordId === "kw-1")?.volumeBucket).toBe("MID_VOLUME");
    expect(enriched.find((k) => k.keywordId === "kw-2")?.volumeBucket).toBe("MID_VOLUME");
    expect(enriched.find((k) => k.keywordId === "kw-3")?.volumeBucket).toBe("LOW_VOLUME");
    expect(enriched.find((k) => k.keywordId === "kw-4")?.volumeBucket).toBe("HIGH_VOLUME");
    expect(enriched.find((k) => k.keywordId === "kw-5")?.volumeBucket).toBe("MID_VOLUME");
  });

  it("tier×volumeBucketに応じた動的閾値が計算される", () => {
    const keywords = [
      createKeyword("kw-big-high", 500, CoreKeywordType.BIG),   // HIGH_VOLUME
      createKeyword("kw-mid-low", 50, CoreKeywordType.MIDDLE),  // LOW_VOLUME
    ];
    keywords[0].searchVolume = 500;
    keywords[1].searchVolume = 50;

    // 中央値は (50+500)/2 = 275 (偶数個なので)
    const enriched = enrichKeywordsWithVolumeBucket(keywords);

    const bigHigh = enriched.find((k) => k.keywordId === "kw-big-high")!;
    expect(bigHigh.volumeBucket).toBe("MID_VOLUME"); // 500/275 ≈ 1.82 < 2.0
    // BIG + MID_VOLUME: 60日, 150クリック, 45位
    expect(bigHigh.computedMinDaysForGiveUp).toBe(60);
    expect(bigHigh.computedMinClicksForGiveUp).toBe(150);
    expect(bigHigh.computedRankThresholdForGiveUp).toBe(45);

    const midLow = enriched.find((k) => k.keywordId === "kw-mid-low")!;
    expect(midLow.volumeBucket).toBe("LOW_VOLUME"); // 50/275 ≈ 0.18 < 0.5
    // MIDDLE + LOW_VOLUME: 31日 (45×0.7=31.5→31), 70クリック, 25位
    expect(midLow.computedMinDaysForGiveUp).toBe(Math.round(45 * 0.7));
    expect(midLow.computedMinClicksForGiveUp).toBe(70);
    expect(midLow.computedRankThresholdForGiveUp).toBe(25);
  });

  it("検索ボリュームがない場合はデフォルトでMID_VOLUMEになる", () => {
    const keywords = [
      createKeyword("kw-no-vol", 0),
    ];
    keywords[0].searchVolume = undefined;

    const enriched = enrichKeywordsWithVolumeBucket(keywords);
    expect(enriched[0].volumeBucket).toBe("MID_VOLUME");
    expect(enriched[0].volumeRatio).toBe(1.0); // 中央値0の場合、デフォルト1.0
  });
});

// =============================================================================
// evaluateKeywordSeoStatusDynamic テスト
// =============================================================================

describe("evaluateKeywordSeoStatusDynamic", () => {
  const createKeyword = (
    overrides: Partial<KeywordConfigWithVolumeBucket> = {}
  ): KeywordConfigWithVolumeBucket => ({
    keywordId: "kw-001",
    asin: "B00TEST123",
    keyword: "テストキーワード",
    coreRole: KeywordCoreRole.CORE,
    coreType: CoreKeywordType.MIDDLE,
    targetRankMin: 1,
    targetRankMax: 5,
    searchVolume: 1000,
    volumeRatio: 1.0,
    volumeBucket: "MID_VOLUME",
    computedMinDaysForGiveUp: 45,
    computedMinClicksForGiveUp: 100,
    computedRankThresholdForGiveUp: 30,
    ...overrides,
  });

  const createRankSummary = (
    overrides: Partial<KeywordRankSummary> = {}
  ): KeywordRankSummary => ({
    keywordId: "kw-001",
    asin: "B00TEST123",
    periodStart: "2025-01-01",
    periodEnd: "2025-01-30",
    currentRank: 15,
    bestRankWindow: 10,
    avgRankWindow: 12,
    impressionsTotal: 1000,
    clicksTotal: 50,
    ordersTotal: 2,
    costTotal: 10000,
    revenueTotal: 25000,
    daysWithRankData: 30,
    firstRankedDate: "2025-01-05",
    ...overrides,
  });

  const targetCpa = 5000;

  describe("ACHIEVED判定", () => {
    it("目標順位到達でACHIEVED", () => {
      const keyword = createKeyword();
      const rankSummary = createRankSummary({
        currentRank: 3,
        impressionsTotal: 1000,
        clicksTotal: 50,
      });

      const result = evaluateKeywordSeoStatusDynamic(
        keyword,
        rankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.ACHIEVED);
      expect(result.volumeBucket).toBe("MID_VOLUME");
      expect(result.tier).toBe(CoreKeywordType.MIDDLE);
    });
  });

  describe("GAVE_UP判定（動的閾値）", () => {
    it("日数・クリック十分で順位が悪い場合はGAVE_UP", () => {
      const keyword = createKeyword({
        volumeBucket: "MID_VOLUME",
        computedMinDaysForGiveUp: 45,
        computedMinClicksForGiveUp: 100,
        computedRankThresholdForGiveUp: 30,
      });
      const rankSummary = createRankSummary({
        currentRank: 50,
        bestRankWindow: 35, // > 30 (順位閾値)
        daysWithRankData: 50, // > 45
        clicksTotal: 150, // > 100
        costTotal: 60000, // > targetCpa * 10
      });

      const result = evaluateKeywordSeoStatusDynamic(
        keyword,
        rankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.GAVE_UP);
      expect(result.reason).toContain("閾値30位");
      expect(result.usedMinDays).toBe(45);
      expect(result.usedMinClicks).toBe(100);
      expect(result.usedRankThreshold).toBe(30);
    });

    it("HIGH_VOLUMEは閾値が緩く、GAVE_UPになりにくい", () => {
      const keyword = createKeyword({
        coreType: CoreKeywordType.BIG,
        volumeBucket: "HIGH_VOLUME",
        computedMinDaysForGiveUp: 78, // BIG × 1.3
        computedMinClicksForGiveUp: 195,
        computedRankThresholdForGiveUp: 50,
      });
      const rankSummary = createRankSummary({
        bestRankWindow: 48, // 50以内なので順位OK
        daysWithRankData: 70, // < 78
        clicksTotal: 180, // < 195
        costTotal: 60000,
      });

      const result = evaluateKeywordSeoStatusDynamic(
        keyword,
        rankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      // 日数・クリック不足でACTIVE
      expect(result.status).toBe(SeoLaunchStatus.ACTIVE);
    });

    it("LOW_VOLUMEは閾値が厳しく、早めにGAVE_UPになる", () => {
      const keyword = createKeyword({
        coreType: CoreKeywordType.MIDDLE,
        volumeBucket: "LOW_VOLUME",
        computedMinDaysForGiveUp: 32, // MID × 0.7
        computedMinClicksForGiveUp: 70,
        computedRankThresholdForGiveUp: 25,
      });
      const rankSummary = createRankSummary({
        bestRankWindow: 28, // > 25 (順位閾値)
        daysWithRankData: 35, // > 32
        clicksTotal: 80, // > 70
        costTotal: 60000,
      });

      const result = evaluateKeywordSeoStatusDynamic(
        keyword,
        rankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.GAVE_UP);
      expect(result.usedMinDays).toBe(32);
      expect(result.usedMinClicks).toBe(70);
      expect(result.usedRankThreshold).toBe(25);
    });

    it("パフォーマンス悪化（CVR低・ACOS高）でもGAVE_UP", () => {
      const keyword = createKeyword();
      const rankSummary = createRankSummary({
        bestRankWindow: 20, // 順位は良い
        daysWithRankData: 50,
        clicksTotal: 150,
        costTotal: 60000,
        ordersTotal: 1, // CVR = 1/150 ≈ 0.7%
        revenueTotal: 5000, // ACOS = 60000/5000 = 1200%
      });

      const result = evaluateKeywordSeoStatusDynamic(
        keyword,
        rankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.GAVE_UP);
      expect(result.reason).toContain("CVR");
      expect(result.reason).toContain("ACOS");
    });
  });

  describe("ACTIVE判定", () => {
    it("条件未達の場合はACTIVEで残り判定条件を表示", () => {
      const keyword = createKeyword({
        computedMinDaysForGiveUp: 45,
        computedMinClicksForGiveUp: 100,
      });
      const rankSummary = createRankSummary({
        bestRankWindow: 35, // 順位悪い
        daysWithRankData: 30, // < 45
        clicksTotal: 60, // < 100
        costTotal: 10000,
      });

      const result = evaluateKeywordSeoStatusDynamic(
        keyword,
        rankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.ACTIVE);
      expect(result.reason).toContain("あと15日"); // 45 - 30
      expect(result.reason).toContain("40クリック"); // 100 - 60
    });
  });

  describe("事前計算なしの場合", () => {
    it("volumeBucketとtierからその場で閾値を計算する", () => {
      const keyword: KeywordConfigWithVolumeBucket = {
        keywordId: "kw-001",
        asin: "B00TEST123",
        keyword: "テスト",
        coreRole: KeywordCoreRole.CORE,
        coreType: CoreKeywordType.BIG,
        targetRankMax: 5,
        volumeBucket: "HIGH_VOLUME",
        // computedMinDaysForGiveUp等は未設定
      };
      const rankSummary = createRankSummary({
        bestRankWindow: 55, // > 50 (BIG + HIGH_VOLUME)
        daysWithRankData: 80, // > 78
        clicksTotal: 200, // > 195
        costTotal: 60000,
      });

      const result = evaluateKeywordSeoStatusDynamic(
        keyword,
        rankSummary,
        DEFAULT_SEO_LAUNCH_CONFIG,
        targetCpa
      );

      expect(result.status).toBe(SeoLaunchStatus.GAVE_UP);
      // その場で計算された閾値
      expect(result.usedMinDays).toBe(78);
      expect(result.usedMinClicks).toBe(195);
      expect(result.usedRankThreshold).toBe(50);
    });
  });
});

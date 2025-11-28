/**
 * SEO目標順位ロジックのテスト
 */

import {
  // 型
  RankTargetConfig,
  SeoProgressConfig,
  RankAdjustmentConfig,
  DEFAULT_RANK_TARGET_CONFIG,
  DEFAULT_SEO_PROGRESS_CONFIG,
  DEFAULT_RANK_ADJUSTMENT_CONFIG,
  getDefaultRankTargetConfigForProfile,
  // LTVプロファイル別設定
  ProductLtvProfile,
  VALID_PRODUCT_LTV_PROFILES,
  isValidProductLtvProfile,
  RANK_ADJUSTMENT_CONFIG_BY_PROFILE,
  getRankAdjustmentConfigForProfile,
  // SEO進捗計算
  calculateRankScoreComponent,
  calculateSovScoreComponent,
  calculateSeoProgressScore,
  computeSeoProgressMetrics,
  determineSeoProgressLevel,
  calculateMedianRank,
  calculateAverageSov,
  // 目標順位調整提案
  RankAdjustmentInput,
  checkUnrealisticConditions,
  calculateUnhealthyTacosMonths,
  determineSuggestedTargetRank,
  generateRankAdjustmentSuggestion,
  // TACOS統合
  adjustTacosParamsBySeoProgress,
} from "../../src/seo";
import { TacosControlContext, StageTacosControlParams, TacosZone } from "../../src/config/productConfigTypes";

describe("SEO目標順位ロジック", () => {
  describe("RankTargetConfig", () => {
    it("デフォルト値が正しく設定されている", () => {
      expect(DEFAULT_RANK_TARGET_CONFIG.idealRank).toBe(1);
      expect(DEFAULT_RANK_TARGET_CONFIG.targetRank).toBe(1);
      expect(DEFAULT_RANK_TARGET_CONFIG.rankTolerance).toBe(2);
    });

    it("プロファイルタイプ別のデフォルト設定が取得できる", () => {
      const supplementHighLtv = getDefaultRankTargetConfigForProfile("SUPPLEMENT_HIGH_LTV");
      expect(supplementHighLtv.idealRank).toBe(1);
      expect(supplementHighLtv.targetRank).toBe(1);
      expect(supplementHighLtv.rankTolerance).toBe(2);

      const singlePurchase = getDefaultRankTargetConfigForProfile("SINGLE_PURCHASE");
      expect(singlePurchase.rankTolerance).toBe(1);

      const unknown = getDefaultRankTargetConfigForProfile("UNKNOWN");
      expect(unknown.idealRank).toBe(1);
    });
  });

  describe("seoProgressScore計算", () => {
    describe("calculateRankScoreComponent", () => {
      it("目標順位に到達している場合は正のスコアを返す", () => {
        // targetRank=5, tolerance=2, organicRank=5
        // (5+2-5)/5 = 2/5 = 0.4
        const score = calculateRankScoreComponent(5, 5, 2);
        expect(score).toBeCloseTo(0.4, 1);

        // targetRank=1, tolerance=2, organicRank=2
        // (1+2-2)/1 = 1
        const score2 = calculateRankScoreComponent(2, 1, 2);
        expect(score2).toBeCloseTo(1.0, 1);

        // targetRank=1, tolerance=2, organicRank=1（目標到達）
        // (1+2-1)/1 = 2 → 1.5にクランプ
        const score3 = calculateRankScoreComponent(1, 1, 2);
        expect(score3).toBeCloseTo(1.5, 1);
      });

      it("順位が目標より悪い場合は1未満を返す", () => {
        // targetRank=1, tolerance=2, organicRank=10
        // (1+2-10)/1 = -7 → 0にクランプ
        const score = calculateRankScoreComponent(10, 1, 2);
        expect(score).toBe(0);
      });

      it("順位が目標内の許容範囲にある場合は正のスコアを返す", () => {
        // targetRank=10, tolerance=2, organicRank=3
        // (10+2-3)/10 = 9/10 = 0.9
        const score = calculateRankScoreComponent(3, 10, 2);
        expect(score).toBeCloseTo(0.9, 1);
        expect(score).toBeLessThanOrEqual(1.5);
      });

      it("極端に悪い順位でも0未満にならない", () => {
        const score = calculateRankScoreComponent(100, 1, 2);
        expect(score).toBeGreaterThanOrEqual(0);
      });
    });

    describe("calculateSovScoreComponent", () => {
      it("目標SOV付近で約1.0を返す", () => {
        const score = calculateSovScoreComponent(5, 5);
        expect(score).toBeCloseTo(1.0, 1);
      });

      it("SOVが目標未満の場合は1未満を返す", () => {
        const score = calculateSovScoreComponent(2, 5);
        expect(score).toBeLessThan(1);
      });

      it("SOVが目標以上の場合は1を超える（最大1.5）", () => {
        const score = calculateSovScoreComponent(8, 5);
        expect(score).toBeGreaterThan(1);
        expect(score).toBeLessThanOrEqual(1.5);
      });
    });

    describe("calculateSeoProgressScore", () => {
      it("両コンポーネントが1.0の場合、全体も1.0を返す", () => {
        const score = calculateSeoProgressScore(1.0, 1.0, 0.6, 0.4);
        expect(score).toBeCloseTo(1.0, 2);
      });

      it("重みが正しく適用される", () => {
        const score = calculateSeoProgressScore(0.5, 1.0, 0.6, 0.4);
        // 0.6 * 0.5 + 0.4 * 1.0 = 0.3 + 0.4 = 0.7
        expect(score).toBeCloseTo(0.7, 2);
      });
    });

    describe("computeSeoProgressMetrics", () => {
      it("入力から正しくメトリクスを計算する", () => {
        const metrics = computeSeoProgressMetrics(
          {
            clusterId: "cluster-1",
            productId: "ASIN123",
            organicRank: 5,
            sov: 5,
          },
          { idealRank: 1, targetRank: 5, rankTolerance: 2 },
          { ...DEFAULT_SEO_PROGRESS_CONFIG, targetSov: 5 }
        );

        expect(metrics.clusterId).toBe("cluster-1");
        expect(metrics.productId).toBe("ASIN123");
        expect(metrics.organicRank).toBe(5);
        expect(metrics.sov).toBe(5);
        expect(metrics.seoProgressScore).toBeGreaterThan(0);
        expect(metrics.calculatedAt).toBeInstanceOf(Date);
      });
    });

    describe("determineSeoProgressLevel", () => {
      it("スコアが低い場合はLOWを返す", () => {
        expect(determineSeoProgressLevel(0.5)).toBe("LOW");
        expect(determineSeoProgressLevel(0.69)).toBe("LOW");
      });

      it("スコアが中程度の場合はON_TARGETを返す", () => {
        expect(determineSeoProgressLevel(0.7)).toBe("ON_TARGET");
        expect(determineSeoProgressLevel(1.0)).toBe("ON_TARGET");
        expect(determineSeoProgressLevel(1.09)).toBe("ON_TARGET");
      });

      it("スコアが高い場合はHIGHを返す", () => {
        expect(determineSeoProgressLevel(1.1)).toBe("HIGH");
        expect(determineSeoProgressLevel(1.3)).toBe("HIGH");
      });
    });
  });

  describe("目標順位調整提案", () => {
    describe("checkUnrealisticConditions", () => {
      const baseInput: RankAdjustmentInput = {
        productId: "ASIN123",
        clusterId: "cluster-1",
        rankTargetConfig: { idealRank: 1, targetRank: 1, rankTolerance: 2 },
        medianOrganicRank90d: 15,
        seoProgressScore90d: 0.5,
        productCumulativeLossLimit: 100000,
        cumulativeLoss: 80000,
        tacosZoneHistory90d: Array(90).fill("ORANGE"),
      };

      it("条件を満たすケースを正しく検出する", () => {
        const result = checkUnrealisticConditions(baseInput);

        expect(result.rankGapExceeded).toBe(true); // 15 - 1 = 14 > 5
        // seoProgressLowerBound=0.3(DEFAULT)なので、0.5 >= 0.3 → 条件を満たさない
        expect(result.seoProgressInsufficient).toBe(false); // 0.5 >= 0.3
        expect(result.lossUsageExceeded).toBe(true); // 0.8 >= 0.7(DEFAULT lossUsageThreshold)
        // unhealthyTacosMonths=3(DEFAULT)なので、3ヶ月連続RED/ORANGE → 条件を満たす
        expect(result.unhealthyTacosExceeded).toBe(true);
        expect(result.conditionsMet).toBe(3);
      });

      it("順位が良い場合は順位ギャップ条件を満たさない", () => {
        const input = { ...baseInput, medianOrganicRank90d: 3 };
        const result = checkUnrealisticConditions(input);
        expect(result.rankGapExceeded).toBe(false);
      });

      it("SEO進捗が良い場合はSEO進捗条件を満たさない", () => {
        const input = { ...baseInput, seoProgressScore90d: 0.9 };
        const result = checkUnrealisticConditions(input);
        expect(result.seoProgressInsufficient).toBe(false);
      });
    });

    describe("determineSuggestedTargetRank", () => {
      it("順位が5位以内の場合は提案しない", () => {
        expect(determineSuggestedTargetRank(3, 1)).toBe(1);
        expect(determineSuggestedTargetRank(5, 1)).toBe(1);
      });

      it("順位が6-10位の場合はtargetRank=5を提案", () => {
        expect(determineSuggestedTargetRank(8, 1)).toBe(5);
        expect(determineSuggestedTargetRank(10, 1)).toBe(5);
      });

      it("順位が11-20位の場合はtargetRank=10を提案", () => {
        expect(determineSuggestedTargetRank(15, 1)).toBe(10);
        expect(determineSuggestedTargetRank(20, 1)).toBe(10);
      });

      it("順位が21位以上の場合はtargetRank=15を提案", () => {
        expect(determineSuggestedTargetRank(25, 1)).toBe(15);
        expect(determineSuggestedTargetRank(50, 1)).toBe(15);
      });

      it("現在のtargetRankより緩い値のみ提案する", () => {
        // 既にtargetRank=10なら、10を超える提案のみ
        expect(determineSuggestedTargetRank(15, 10)).toBe(10);
        expect(determineSuggestedTargetRank(25, 10)).toBe(15);
      });
    });

    describe("generateRankAdjustmentSuggestion", () => {
      it("条件を満たす場合は提案を生成する", () => {
        const input: RankAdjustmentInput = {
          productId: "ASIN123",
          clusterId: "cluster-1",
          rankTargetConfig: { idealRank: 1, targetRank: 1, rankTolerance: 2 },
          medianOrganicRank90d: 15,
          seoProgressScore90d: 0.5,
          productCumulativeLossLimit: 100000,
          cumulativeLoss: 85000,
          tacosZoneHistory90d: Array(90).fill("ORANGE"),
        };

        const suggestion = generateRankAdjustmentSuggestion(input);

        expect(suggestion).not.toBeNull();
        expect(suggestion!.reasonCode).toBe("UNREALISTIC_FOR_IDEAL");
        expect(suggestion!.suggestedTargetRank).toBe(10); // 15位 → targetRank=10
        expect(suggestion!.explanation).toContain("15位");
      });

      it("条件を満たさない場合はnullを返す", () => {
        const input: RankAdjustmentInput = {
          productId: "ASIN123",
          clusterId: "cluster-1",
          rankTargetConfig: { idealRank: 1, targetRank: 1, rankTolerance: 2 },
          medianOrganicRank90d: 3, // 良い順位
          seoProgressScore90d: 1.0, // 良い進捗
          productCumulativeLossLimit: 100000,
          cumulativeLoss: 10000, // 少ない赤字
          tacosZoneHistory90d: Array(90).fill("GREEN"), // 健全
        };

        const suggestion = generateRankAdjustmentSuggestion(input);
        expect(suggestion).toBeNull();
      });

      it("順位が良くても他の条件が悪ければ条件カウントが足りず提案されない", () => {
        const input: RankAdjustmentInput = {
          productId: "ASIN123",
          clusterId: "cluster-1",
          rankTargetConfig: { idealRank: 1, targetRank: 1, rankTolerance: 2 },
          medianOrganicRank90d: 3, // 良い順位 → 条件満たさず
          seoProgressScore90d: 0.5, // 悪い進捗 → 条件満たす
          productCumulativeLossLimit: 100000,
          cumulativeLoss: 10000, // 少ない赤字 → 条件満たさず
          tacosZoneHistory90d: Array(90).fill("GREEN"), // 健全 → 条件満たさず
        };

        // 1条件のみ満たす → minConditionsToTrigger(2)に達しない
        const suggestion = generateRankAdjustmentSuggestion(input);
        expect(suggestion).toBeNull();
      });
    });
  });

  describe("TACOS制御との統合", () => {
    const mockTacosContext: TacosControlContext = {
      tacosMax: 0.5,
      tacosTargetMid: 0.35,
      currentTacos: 0.3,
      tacosZone: "GREEN",
      tacosDelta: 0.14,
      controlParams: {
        midFactor: 0.7,
        tacosAcuity: 1.0,
        tacosPenaltyFactorRed: 0.8,
        stageAcosMin: 0.1,
        stageAcosMax: 0.6,
      },
    };

    describe("adjustTacosParamsBySeoProgress", () => {
      it("SEO進捗が低い場合はtacosTargetMidを上げ、tacosAcuityを下げる", () => {
        const result = adjustTacosParamsBySeoProgress(mockTacosContext, 0.5);

        expect(result.seoProgressLevel).toBe("LOW");
        expect(result.wasAdjusted).toBe(true);
        expect(result.adjustedTacosTargetMid).toBeGreaterThan(result.originalTacosTargetMid);
        expect(result.adjustedTacosAcuity).toBeLessThan(result.originalTacosAcuity);
      });

      it("SEO進捗が高い場合はtacosTargetMidを下げ、tacosAcuityを上げる", () => {
        const result = adjustTacosParamsBySeoProgress(mockTacosContext, 1.2);

        expect(result.seoProgressLevel).toBe("HIGH");
        expect(result.wasAdjusted).toBe(true);
        expect(result.adjustedTacosTargetMid).toBeLessThan(result.originalTacosTargetMid);
        expect(result.adjustedTacosAcuity).toBeGreaterThan(result.originalTacosAcuity);
      });

      it("SEO進捗が中程度の場合は調整しない", () => {
        const result = adjustTacosParamsBySeoProgress(mockTacosContext, 0.9);

        expect(result.seoProgressLevel).toBe("ON_TARGET");
        expect(result.wasAdjusted).toBe(false);
        expect(result.adjustedTacosTargetMid).toBe(result.originalTacosTargetMid);
        expect(result.adjustedTacosAcuity).toBe(result.originalTacosAcuity);
      });
    });
  });

  describe("ユーティリティ関数", () => {
    describe("calculateMedianRank", () => {
      it("奇数個の配列で正しく中央値を計算する", () => {
        expect(calculateMedianRank([1, 3, 5])).toBe(3);
        expect(calculateMedianRank([10, 5, 1, 8, 3])).toBe(5);
      });

      it("偶数個の配列で正しく中央値を計算する", () => {
        expect(calculateMedianRank([1, 3, 5, 7])).toBe(4); // (3+5)/2
        expect(calculateMedianRank([2, 4])).toBe(3); // (2+4)/2
      });

      it("空配列の場合はInfinityを返す", () => {
        expect(calculateMedianRank([])).toBe(Infinity);
      });

      it("単一要素の配列で正しく計算する", () => {
        expect(calculateMedianRank([5])).toBe(5);
      });
    });

    describe("calculateAverageSov", () => {
      it("正しく平均を計算する", () => {
        expect(calculateAverageSov([5, 10, 15])).toBe(10);
        expect(calculateAverageSov([2, 4, 6, 8])).toBe(5);
      });

      it("空配列の場合は0を返す", () => {
        expect(calculateAverageSov([])).toBe(0);
      });
    });
  });

  // =========================================================================
  // LTVプロファイル別RankAdjustmentConfig テスト
  // =========================================================================
  describe("LTVプロファイル別RankAdjustmentConfig", () => {
    describe("ProductLtvProfile型定義", () => {
      it("有効なProductLtvProfileを判定できる", () => {
        expect(isValidProductLtvProfile("SUPPLEMENT_HIGH_LTV")).toBe(true);
        expect(isValidProductLtvProfile("SUPPLEMENT_NORMAL")).toBe(true);
        expect(isValidProductLtvProfile("LOW_LTV_SUPPLEMENT")).toBe(true);
      });

      it("無効な値を判定できる", () => {
        expect(isValidProductLtvProfile("INVALID")).toBe(false);
        expect(isValidProductLtvProfile("")).toBe(false);
        expect(isValidProductLtvProfile(null)).toBe(false);
        expect(isValidProductLtvProfile(undefined)).toBe(false);
      });

      it("VALID_PRODUCT_LTV_PROFILESに全プロファイルが含まれる", () => {
        expect(VALID_PRODUCT_LTV_PROFILES).toContain("SUPPLEMENT_HIGH_LTV");
        expect(VALID_PRODUCT_LTV_PROFILES).toContain("SUPPLEMENT_NORMAL");
        expect(VALID_PRODUCT_LTV_PROFILES).toContain("LOW_LTV_SUPPLEMENT");
        expect(VALID_PRODUCT_LTV_PROFILES.length).toBe(3);
      });
    });

    describe("RANK_ADJUSTMENT_CONFIG_BY_PROFILE", () => {
      it("各プロファイルの設定が存在する", () => {
        expect(RANK_ADJUSTMENT_CONFIG_BY_PROFILE.SUPPLEMENT_HIGH_LTV).toBeDefined();
        expect(RANK_ADJUSTMENT_CONFIG_BY_PROFILE.SUPPLEMENT_NORMAL).toBeDefined();
        expect(RANK_ADJUSTMENT_CONFIG_BY_PROFILE.LOW_LTV_SUPPLEMENT).toBeDefined();
      });

      it("SUPPLEMENT_HIGH_LTVは緩い閾値を持つ", () => {
        const config = RANK_ADJUSTMENT_CONFIG_BY_PROFILE.SUPPLEMENT_HIGH_LTV;
        expect(config.seoProgressLowerBound).toBe(0.25); // 低い閾値
        expect(config.lossUsageThreshold).toBe(0.80);    // 高い許容度
        expect(config.unhealthyTacosMonths).toBe(3);     // 長い期間
      });

      it("SUPPLEMENT_NORMALは標準的な閾値を持つ", () => {
        const config = RANK_ADJUSTMENT_CONFIG_BY_PROFILE.SUPPLEMENT_NORMAL;
        expect(config.seoProgressLowerBound).toBe(0.30);
        expect(config.lossUsageThreshold).toBe(0.70);
        expect(config.unhealthyTacosMonths).toBe(3);
      });

      it("LOW_LTV_SUPPLEMENTは厳しい閾値を持つ", () => {
        const config = RANK_ADJUSTMENT_CONFIG_BY_PROFILE.LOW_LTV_SUPPLEMENT;
        expect(config.seoProgressLowerBound).toBe(0.35); // 高い閾値
        expect(config.lossUsageThreshold).toBe(0.50);    // 低い許容度
        expect(config.unhealthyTacosMonths).toBe(2);     // 短い期間
      });

      it("共通パラメータは全プロファイルで同じ", () => {
        for (const profile of VALID_PRODUCT_LTV_PROFILES) {
          const config = RANK_ADJUSTMENT_CONFIG_BY_PROFILE[profile];
          expect(config.rankGapThreshold).toBe(5);
          expect(config.lookbackDays).toBe(90);
          expect(config.suggestedRankStep).toBe(2);
          expect(config.minConditionsToTrigger).toBe(2);
        }
      });
    });

    describe("getRankAdjustmentConfigForProfile", () => {
      it("有効なプロファイルで対応する設定を返す", () => {
        const highLtv = getRankAdjustmentConfigForProfile("SUPPLEMENT_HIGH_LTV");
        expect(highLtv.lossUsageThreshold).toBe(0.80);

        const normal = getRankAdjustmentConfigForProfile("SUPPLEMENT_NORMAL");
        expect(normal.lossUsageThreshold).toBe(0.70);

        const lowLtv = getRankAdjustmentConfigForProfile("LOW_LTV_SUPPLEMENT");
        expect(lowLtv.lossUsageThreshold).toBe(0.50);
      });

      it("undefinedの場合はデフォルト設定を返す", () => {
        const config = getRankAdjustmentConfigForProfile(undefined);
        expect(config).toEqual(DEFAULT_RANK_ADJUSTMENT_CONFIG);
      });

      it("nullの場合はデフォルト設定を返す", () => {
        const config = getRankAdjustmentConfigForProfile(null);
        expect(config).toEqual(DEFAULT_RANK_ADJUSTMENT_CONFIG);
      });
    });

    describe("calculateUnhealthyTacosMonths", () => {
      it("空履歴の場合は0を返す", () => {
        expect(calculateUnhealthyTacosMonths([])).toBe(0);
      });

      it("全てGREENの場合は0を返す", () => {
        const greenHistory = Array(90).fill("GREEN" as TacosZone);
        expect(calculateUnhealthyTacosMonths(greenHistory)).toBe(0);
      });

      it("全てRED/ORANGEの場合は3を返す（90日=3ヶ月）", () => {
        const redHistory = Array(90).fill("RED" as TacosZone);
        expect(calculateUnhealthyTacosMonths(redHistory)).toBe(3);
      });

      it("最後の1ヶ月だけRED/ORANGEの場合は1を返す", () => {
        const history: TacosZone[] = [
          ...Array(60).fill("GREEN" as TacosZone),
          ...Array(30).fill("RED" as TacosZone),
        ];
        expect(calculateUnhealthyTacosMonths(history)).toBe(1);
      });

      it("最後の2ヶ月がRED/ORANGEの場合は2を返す", () => {
        const history: TacosZone[] = [
          ...Array(30).fill("GREEN" as TacosZone),
          ...Array(60).fill("ORANGE" as TacosZone),
        ];
        expect(calculateUnhealthyTacosMonths(history)).toBe(2);
      });

      it("連続していない場合は最新の連続期間のみカウント", () => {
        const history: TacosZone[] = [
          ...Array(30).fill("RED" as TacosZone),    // 1ヶ月目: RED
          ...Array(30).fill("GREEN" as TacosZone),  // 2ヶ月目: GREEN（中断）
          ...Array(30).fill("RED" as TacosZone),    // 3ヶ月目: RED
        ];
        // 最新月（3ヶ月目）から連続している分だけ=1
        expect(calculateUnhealthyTacosMonths(history)).toBe(1);
      });
    });

    describe("プロファイル別RankAdjustmentSuggestion生成", () => {
      // テストヘルパー: 基本入力データ
      const createBaseInput = (
        overrides: Partial<RankAdjustmentInput> = {}
      ): RankAdjustmentInput => ({
        productId: "B123456789",
        clusterId: "cluster_1",
        rankTargetConfig: { idealRank: 1, targetRank: 1, rankTolerance: 2 },
        medianOrganicRank90d: 8,
        seoProgressScore90d: 0.28,
        productCumulativeLossLimit: 100000,
        cumulativeLoss: 75000,
        tacosZoneHistory90d: Array(90).fill("ORANGE" as TacosZone),
        ...overrides,
      });

      describe("SUPPLEMENT_HIGH_LTV: 粘り強く投資継続", () => {
        it("seoProgressScore=0.28はまだ進捗不足と判定しない", () => {
          // HIGH_LTVのseoProgressLowerBound=0.25なので、0.28は閾値以上
          const input = createBaseInput({
            productLtvProfile: "SUPPLEMENT_HIGH_LTV",
            seoProgressScore90d: 0.28, // > 0.25
            cumulativeLoss: 75000,     // 75% < 80% (lossUsageThreshold)
            tacosZoneHistory90d: [
              ...Array(30).fill("GREEN" as TacosZone),
              ...Array(60).fill("ORANGE" as TacosZone), // 2ヶ月連続 < 3ヶ月
            ],
          });

          const suggestion = generateRankAdjustmentSuggestion(input);

          // 条件1: rankGap=7 > 5 → 満たす
          // 条件2: seoProgress=0.28 >= 0.25 → 満たさない
          // 条件3: lossUsage=0.75 < 0.80 → 満たさない
          // 条件4: unhealthyMonths=2 < 3 → 満たさない
          // 満たす条件数=1 < 2 → 提案なし
          expect(suggestion).toBeNull();
        });

        it("条件が2つ以上揃った場合のみ提案を生成", () => {
          const input = createBaseInput({
            productLtvProfile: "SUPPLEMENT_HIGH_LTV",
            seoProgressScore90d: 0.20, // < 0.25 → 進捗不足
            cumulativeLoss: 85000,     // 85% >= 80% → 消化率超過
          });

          const suggestion = generateRankAdjustmentSuggestion(input);

          // 条件を3つ満たすはず（rankGap, seoProgress, lossUsage）
          expect(suggestion).not.toBeNull();
          expect(suggestion?.productLtvProfile).toBe("SUPPLEMENT_HIGH_LTV");
          expect(suggestion?.rankAdjustmentProfileConfigName).toBe("SUPPLEMENT_HIGH_LTV");
        });
      });

      describe("LOW_LTV_SUPPLEMENT: 早期見切り", () => {
        it("seoProgressScore=0.33は進捗不足と判定しない（境界テスト）", () => {
          // LOW_LTVのseoProgressLowerBound=0.35なので、0.33は閾値未満
          // → 進捗不足と判定
          const input = createBaseInput({
            productLtvProfile: "LOW_LTV_SUPPLEMENT",
            seoProgressScore90d: 0.33, // < 0.35 → 進捗不足
            cumulativeLoss: 52000,     // 52% >= 50% → 消化率超過
            tacosZoneHistory90d: [
              ...Array(30).fill("GREEN" as TacosZone),
              ...Array(60).fill("RED" as TacosZone), // 2ヶ月連続 >= 2
            ],
          });

          const suggestion = generateRankAdjustmentSuggestion(input);

          // 条件1: rankGap=7 > 5 → 満たす
          // 条件2: seoProgress=0.33 < 0.35 → 満たす
          // 条件3: lossUsage=0.52 >= 0.50 → 満たす
          // 条件4: unhealthyMonths=2 >= 2 → 満たす
          // 満たす条件数=4 >= 2 → 提案あり
          expect(suggestion).not.toBeNull();
          expect(suggestion?.productLtvProfile).toBe("LOW_LTV_SUPPLEMENT");
          expect(suggestion?.metrics.unhealthyTacosMonths).toBe(2);
        });

        it("lossUsageThreshold=0.50で早期に警戒", () => {
          const input = createBaseInput({
            productLtvProfile: "LOW_LTV_SUPPLEMENT",
            seoProgressScore90d: 0.40, // > 0.35 → 進捗OK
            cumulativeLoss: 55000,     // 55% >= 50% → 消化率超過
            tacosZoneHistory90d: Array(90).fill("ORANGE" as TacosZone), // 3ヶ月連続
          });

          const suggestion = generateRankAdjustmentSuggestion(input);

          // 条件を2つ満たすはず（rankGap, lossUsage, unhealthyMonths）
          expect(suggestion).not.toBeNull();
        });
      });

      describe("プロファイル未設定: デフォルト設定を使用", () => {
        it("productLtvProfileが未設定の場合はDEFAULT_RANK_ADJUSTMENT_CONFIGを使用", () => {
          const input = createBaseInput({
            productLtvProfile: undefined,
            seoProgressScore90d: 0.25, // < 0.30 (DEFAULT) → 進捗不足
            cumulativeLoss: 75000,     // 75% >= 70% (DEFAULT) → 消化率超過
          });

          const suggestion = generateRankAdjustmentSuggestion(input);

          expect(suggestion).not.toBeNull();
          expect(suggestion?.productLtvProfile).toBeUndefined();
          expect(suggestion?.rankAdjustmentProfileConfigName).toBe("DEFAULT");
        });
      });

      describe("提案出力にプロファイル情報が含まれる", () => {
        it("metricsにunhealthyTacosMonthsが含まれる", () => {
          const input = createBaseInput({
            productLtvProfile: "SUPPLEMENT_NORMAL",
            seoProgressScore90d: 0.20,
            cumulativeLoss: 80000,
          });

          const suggestion = generateRankAdjustmentSuggestion(input);

          expect(suggestion).not.toBeNull();
          expect(suggestion?.metrics.unhealthyTacosMonths).toBeDefined();
          expect(typeof suggestion?.metrics.unhealthyTacosMonths).toBe("number");
        });
      });
    });
  });
});

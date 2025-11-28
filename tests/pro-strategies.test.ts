/**
 * プロ戦略モジュールのテスト
 */

import {
  calculateAnchorKeywordScore,
  identifyAnchorKeywords,
  calculateLaunchModeConfig,
  calculateLaunchBidAdjustment,
  calculateSkuPerformanceScore,
  recommendAdSku,
  determineDemandPhase,
  calculateCampaignHealth,
  validateCampaignChange,
  evaluateKeywordWithStrategies,
  // Revenue-Based Bid
  calculateRevenueBasedBid,
  calculateRevenueBasedBidSimple,
  // Bidding Lifecycle
  determineBiddingLifecycle,
  calculateBiddingLifecycleCoeff,
  // TACOS コントローラ
  calculateLtvMultiplierStage,
  calculateTargetTacosStage,
  calculateProductBidMultiplier,
  calculateProductBidMultiplierSimple,
  AnchorKeywordInput,
  SkuPerformance,
  DemandFollowingInput,
  CampaignHealthInput,
  LaunchModeConfig,
  RevenueBasedBidInput,
  BiddingLifecycleInput,
  TacosControllerInput,
} from "../src/strategies/pro-strategies";

describe("pro-strategies", () => {
  // ==========================================================================
  // 1. アンカーキーワード戦略
  // ==========================================================================
  describe("calculateAnchorKeywordScore", () => {
    it("CVRがカテゴリ平均の2倍でアンカー候補になる", () => {
      const input: AnchorKeywordInput = {
        keyword_id: "kw1",
        keyword_text: "ビタミンC サプリ",
        cvr: 0.04, // 4%
        category_avg_cvr: 0.02, // 2%
        search_volume: 10000,
        relevance_score: 0.9,
      };

      const result = calculateAnchorKeywordScore(input);

      expect(result.cvr_vs_category).toBe(2.0);
      expect(result.is_anchor_candidate).toBe(true);
      expect(result.anchor_score).toBeGreaterThan(1.5);
      expect(result.recommendation).toContain("アンカー");
    });

    it("CVRがカテゴリ平均以下だとアンカー候補にならない", () => {
      const input: AnchorKeywordInput = {
        keyword_id: "kw2",
        keyword_text: "サプリメント",
        cvr: 0.015,
        category_avg_cvr: 0.02,
        search_volume: 50000,
        relevance_score: 0.5,
      };

      const result = calculateAnchorKeywordScore(input);

      expect(result.cvr_vs_category).toBe(0.75);
      expect(result.is_anchor_candidate).toBe(false);
      expect(result.recommendation).toContain("要観察");
    });

    it("関連性が低いとアンカー候補にならない", () => {
      const input: AnchorKeywordInput = {
        keyword_id: "kw3",
        keyword_text: "健康食品",
        cvr: 0.04,
        category_avg_cvr: 0.02,
        search_volume: 10000,
        relevance_score: 0.5, // 低い関連性
      };

      const result = calculateAnchorKeywordScore(input);

      expect(result.cvr_vs_category).toBe(2.0);
      expect(result.is_anchor_candidate).toBe(false); // 関連性が0.7未満
    });
  });

  describe("identifyAnchorKeywords", () => {
    it("アンカースコア降順でソートされる", () => {
      const keywords: AnchorKeywordInput[] = [
        { keyword_id: "kw1", keyword_text: "低スコア", cvr: 0.01, category_avg_cvr: 0.02, search_volume: 1000, relevance_score: 0.5 },
        { keyword_id: "kw2", keyword_text: "高スコア", cvr: 0.05, category_avg_cvr: 0.02, search_volume: 10000, relevance_score: 0.9 },
        { keyword_id: "kw3", keyword_text: "中スコア", cvr: 0.03, category_avg_cvr: 0.02, search_volume: 5000, relevance_score: 0.7 },
      ];

      const results = identifyAnchorKeywords(keywords);

      expect(results[0].keyword_id).toBe("kw2");
      expect(results[0].anchor_score).toBeGreaterThan(results[1].anchor_score);
    });
  });

  // ==========================================================================
  // 2. Revenue-Based Bid
  // ==========================================================================
  describe("calculateRevenueBasedBid", () => {
    it("基本的な計算が正しく行われる", () => {
      const input: RevenueBasedBidInput = {
        avg_order_value: 3000,  // 3000円
        cvr: 0.05,              // 5%
        target_acos: 0.20,      // 20%
      };

      const result = calculateRevenueBasedBid(input);

      // 3000 × 0.05 × 0.20 = 30円（理論値）
      // 30 × 0.9 = 27円（安全マージン適用後）
      expect(result.theoretical_bid).toBe(30);
      expect(result.optimal_bid).toBe(27);
      expect(result.formula).toContain("3000円");
      expect(result.formula).toContain("5.0%");
      expect(result.formula).toContain("20%");
    });

    it("カスタム安全マージンを適用できる", () => {
      const input: RevenueBasedBidInput = {
        avg_order_value: 5000,
        cvr: 0.04,
        target_acos: 0.25,
        safety_margin: 0.8, // 20%引き
      };

      const result = calculateRevenueBasedBid(input);

      // 5000 × 0.04 × 0.25 = 50円
      // 50 × 0.8 = 40円
      expect(result.theoretical_bid).toBe(50);
      expect(result.optimal_bid).toBe(40);
    });

    it("高単価商品でも正しく計算される", () => {
      const input: RevenueBasedBidInput = {
        avg_order_value: 50000,
        cvr: 0.02,
        target_acos: 0.15,
      };

      const result = calculateRevenueBasedBid(input);

      // 50000 × 0.02 × 0.15 = 150円
      // 150 × 0.9 = 135円
      expect(result.theoretical_bid).toBe(150);
      expect(result.optimal_bid).toBe(135);
    });
  });

  describe("calculateRevenueBasedBidSimple", () => {
    it("シンプルな計算が正しい", () => {
      const result = calculateRevenueBasedBidSimple(3000, 0.05, 0.20);

      // 3000 × 0.05 × 0.20 × 0.9 = 27円
      expect(result).toBe(27);
    });

    it("四捨五入される", () => {
      const result = calculateRevenueBasedBidSimple(3333, 0.03, 0.18);

      // 3333 × 0.03 × 0.18 × 0.9 = 16.1982... → 16円
      expect(result).toBe(16);
    });
  });

  // ==========================================================================
  // 6. Bidding Lifecycle
  // ==========================================================================
  describe("determineBiddingLifecycle", () => {
    it("クリック数50未満はPhase1（15%インチアップ）", () => {
      const input: BiddingLifecycleInput = {
        keyword_id: "kw1",
        total_clicks: 30,
        current_acos: 0.35,
        target_acos: 0.20,
        current_bid: 50, // 低めの入札額でRevenue-Based上限に達しない
        avg_order_value: 3000,
        cvr: 0.05,
      };

      const result = determineBiddingLifecycle(input);

      expect(result.phase).toBe("PHASE1_DATA_COLLECTION");
      expect(result.phase_name).toBe("データ収集期");
      expect(result.acos_tolerance_multiplier).toBe(3.0);
      expect(result.bid_strategy).toBe("INCH_UP");
      expect(result.recommended_bid).toBe(57); // 50 × 1.15 = 57.5 → 57円（四捨五入）
      expect(result.reason).toContain("+15%");
    });

    it("クリック数50-99はPhase1（10%インチアップ）", () => {
      const input: BiddingLifecycleInput = {
        keyword_id: "kw1",
        total_clicks: 70,
        current_acos: 0.30,
        target_acos: 0.20,
        current_bid: 50,
        avg_order_value: 3000,
        cvr: 0.05,
      };

      const result = determineBiddingLifecycle(input);

      expect(result.phase).toBe("PHASE1_DATA_COLLECTION");
      expect(result.recommended_bid).toBe(55); // 50 × 1.10 = 55円
      expect(result.reason).toContain("+10%");
    });

    it("Phase1でInch UpがRevenue-Based上限を超えると上限適用", () => {
      const input: BiddingLifecycleInput = {
        keyword_id: "kw1",
        total_clicks: 30,
        current_acos: 0.35,
        target_acos: 0.20,
        current_bid: 100, // 高めの入札額
        avg_order_value: 3000,
        cvr: 0.05,
      };

      const result = determineBiddingLifecycle(input);

      expect(result.phase).toBe("PHASE1_DATA_COLLECTION");
      // Revenue-Based (ACOS 3倍): 3000 × 0.05 × 0.60 × 0.9 = 81円が上限
      // 100 × 1.15 = 115円だが、81円で制限される
      expect(result.recommended_bid).toBe(81);
    });

    it("クリック数100以上はPhase2（Revenue-Based）", () => {
      const input: BiddingLifecycleInput = {
        keyword_id: "kw1",
        total_clicks: 150,
        current_acos: 0.22,
        target_acos: 0.20,
        current_bid: 100,
        avg_order_value: 3000,
        cvr: 0.05,
      };

      const result = determineBiddingLifecycle(input);

      expect(result.phase).toBe("PHASE2_OPTIMIZATION");
      expect(result.phase_name).toBe("最適化期");
      expect(result.acos_tolerance_multiplier).toBe(1.5);
      expect(result.bid_strategy).toBe("REVENUE_BASED");
      // 3000 × 0.05 × 0.20 × 0.9 = 27円
      expect(result.recommended_bid).toBe(27);
    });

    it("ACOS良好（目標の80%未満）でPhase3（アグレッシブ）", () => {
      const input: BiddingLifecycleInput = {
        keyword_id: "kw1",
        total_clicks: 200,
        current_acos: 0.12, // 12% < 20% × 0.8 = 16%
        target_acos: 0.20,
        current_bid: 100,
        avg_order_value: 3000,
        cvr: 0.05,
      };

      const result = determineBiddingLifecycle(input);

      expect(result.phase).toBe("PHASE3_GROWTH");
      expect(result.phase_name).toBe("成長期");
      expect(result.acos_tolerance_multiplier).toBe(1.2);
      expect(result.bid_strategy).toBe("AGGRESSIVE");
      // 現在100円 × 1.2 = 120円（Revenue-Based 27円の1.3倍=35円が上限だが、120円は超えない）
      expect(result.recommended_bid).toBe(35); // min(120, 35) = 35円
    });

    it("Phase3ではRevenue-Basedの1.3倍を上限とする", () => {
      const input: BiddingLifecycleInput = {
        keyword_id: "kw1",
        total_clicks: 300,
        current_acos: 0.10,
        target_acos: 0.20,
        current_bid: 50, // 低めの入札額
        avg_order_value: 3000,
        cvr: 0.05,
      };

      const result = determineBiddingLifecycle(input);

      expect(result.phase).toBe("PHASE3_GROWTH");
      // 現在50円 × 1.2 = 60円だが、Revenue-Based 27円の1.3倍=35円が上限
      expect(result.recommended_bid).toBe(35);
    });
  });

  describe("calculateBiddingLifecycleCoeff", () => {
    it("Phase1は0.8（控えめ）", () => {
      expect(calculateBiddingLifecycleCoeff("PHASE1_DATA_COLLECTION")).toBe(0.8);
    });

    it("Phase2は1.0（標準）", () => {
      expect(calculateBiddingLifecycleCoeff("PHASE2_OPTIMIZATION")).toBe(1.0);
    });

    it("Phase3は1.3（積極的）", () => {
      expect(calculateBiddingLifecycleCoeff("PHASE3_GROWTH")).toBe(1.3);
    });
  });

  // ==========================================================================
  // 3. ローンチ攻め最適化
  // ==========================================================================
  describe("calculateLaunchModeConfig", () => {
    it("ローンチ日がnullの場合はローンチモードOFF", () => {
      const config = calculateLaunchModeConfig(null);

      expect(config.is_launch_mode).toBe(false);
      expect(config.acos_tolerance_multiplier).toBe(1.0);
    });

    it("ローンチ後3日以内は最も積極的", () => {
      const launchDate = new Date();
      launchDate.setDate(launchDate.getDate() - 2); // 2日前

      const config = calculateLaunchModeConfig(launchDate);

      expect(config.is_launch_mode).toBe(true);
      expect(config.days_since_launch).toBe(2);
      expect(config.acos_tolerance_multiplier).toBe(3.0);
      expect(config.min_impressions_3h).toBe(100);
    });

    it("ローンチ後7日以内はやや積極的", () => {
      const launchDate = new Date();
      launchDate.setDate(launchDate.getDate() - 5); // 5日前

      const config = calculateLaunchModeConfig(launchDate);

      expect(config.is_launch_mode).toBe(true);
      expect(config.acos_tolerance_multiplier).toBe(2.0);
      expect(config.min_impressions_3h).toBe(50);
    });

    it("ローンチ後15日以降は通常モード", () => {
      const launchDate = new Date();
      launchDate.setDate(launchDate.getDate() - 20); // 20日前

      const config = calculateLaunchModeConfig(launchDate);

      expect(config.is_launch_mode).toBe(false);
      expect(config.acos_tolerance_multiplier).toBe(1.0);
    });
  });

  describe("calculateLaunchBidAdjustment", () => {
    const launchConfig: LaunchModeConfig = {
      is_launch_mode: true,
      launch_date: new Date(),
      days_since_launch: 2,
      launch_period_days: 14,
      acos_tolerance_multiplier: 3.0,
      min_impressions_3h: 100,
    };

    it("インプレッション目標達成で調整なし", () => {
      const result = calculateLaunchBidAdjustment(120, launchConfig);

      expect(result.adjustment_rate).toBe(0);
      expect(result.reason).toContain("目標達成");
    });

    it("インプレッション50%未満で+30%", () => {
      const result = calculateLaunchBidAdjustment(40, launchConfig);

      expect(result.adjustment_rate).toBe(0.30);
      expect(result.reason).toContain("深刻な不足");
    });

    it("インプレッション50-80%で+15%", () => {
      const result = calculateLaunchBidAdjustment(60, launchConfig);

      expect(result.adjustment_rate).toBe(0.15);
      expect(result.reason).toContain("やや不足");
    });
  });

  // ==========================================================================
  // 4. 広告SKU選択
  // ==========================================================================
  describe("calculateSkuPerformanceScore", () => {
    it("CTR×CVR×インプレッション係数でスコア計算", () => {
      const sku: SkuPerformance = {
        sku: "SKU001",
        asin: "B00TEST",
        variant_name: "60粒",
        ad_ctr: 0.02, // 2%
        ad_cvr: 0.05, // 5%
        ad_roas: 3.0,
        ad_impressions: 10000,
        ad_clicks: 200,
        ad_orders: 10,
        total_sales_rank: 1,
        ad_performance_rank: 1,
      };

      const score = calculateSkuPerformanceScore(sku);

      expect(score).toBeGreaterThan(0);
      // 0.02 * 0.05 * (1 + log10(10000)/4) = 0.001 * 2.0 = 0.002
      expect(score).toBeCloseTo(0.002, 4);
    });

    it("インプレッション100未満はスコア0", () => {
      const sku: SkuPerformance = {
        sku: "SKU002",
        asin: "B00TEST",
        variant_name: "30粒",
        ad_ctr: 0.05,
        ad_cvr: 0.10,
        ad_roas: 5.0,
        ad_impressions: 50,
        ad_clicks: 2,
        ad_orders: 0,
        total_sales_rank: 2,
        ad_performance_rank: 2,
      };

      const score = calculateSkuPerformanceScore(sku);

      expect(score).toBe(0);
    });
  });

  describe("recommendAdSku", () => {
    it("広告パフォーマンスが高いSKUを推奨", () => {
      const skus: SkuPerformance[] = [
        {
          sku: "SKU001",
          asin: "B00TEST",
          variant_name: "60粒",
          ad_ctr: 0.01,
          ad_cvr: 0.03,
          ad_roas: 2.0,
          ad_impressions: 10000,
          ad_clicks: 100,
          ad_orders: 3,
          total_sales_rank: 1, // 売上1位
          ad_performance_rank: 2,
        },
        {
          sku: "SKU002",
          asin: "B00TEST",
          variant_name: "30粒お試し",
          ad_ctr: 0.03, // CTR高い
          ad_cvr: 0.05, // CVR高い
          ad_roas: 4.0,
          ad_impressions: 5000,
          ad_clicks: 150,
          ad_orders: 7,
          total_sales_rank: 3, // 売上3位
          ad_performance_rank: 1,
        },
      ];

      const result = recommendAdSku(skus);

      expect(result).not.toBeNull();
      expect(result!.recommended_sku).toBe("SKU002");
      expect(result!.is_different_from_bestseller).toBe(true);
      expect(result!.reason).toContain("30粒お試し");
    });

    it("データ不足の場合は売上1位を推奨", () => {
      const skus: SkuPerformance[] = [
        {
          sku: "SKU001",
          asin: "B00TEST",
          variant_name: "60粒",
          ad_ctr: 0,
          ad_cvr: 0,
          ad_roas: 0,
          ad_impressions: 50,
          ad_clicks: 0,
          ad_orders: 0,
          total_sales_rank: 1,
          ad_performance_rank: 1,
        },
      ];

      const result = recommendAdSku(skus);

      expect(result!.recommended_sku).toBe("SKU001");
      expect(result!.reason).toContain("データ不足");
    });
  });

  // ==========================================================================
  // 5. 季節性追随
  // ==========================================================================
  describe("determineDemandPhase", () => {
    it("前年比+30%でDEMAND_RISING", () => {
      const input: DemandFollowingInput = {
        keyword_id: "kw1",
        current_sessions_7d: 1300,
        previous_year_sessions_7d: 1000,
        seasonality_score: 0.8,
        is_peak_season: false,
      };

      const result = determineDemandPhase(input);

      expect(result.demand_phase).toBe("DEMAND_RISING");
      expect(result.acos_multiplier).toBe(1.3);
      expect(result.bid_aggression).toBe("AGGRESSIVE");
    });

    it("前年比-25%でPOST_PEAK", () => {
      const input: DemandFollowingInput = {
        keyword_id: "kw1",
        current_sessions_7d: 750,
        previous_year_sessions_7d: 1000,
        seasonality_score: 0.8,
        is_peak_season: false,
      };

      const result = determineDemandPhase(input);

      expect(result.demand_phase).toBe("POST_PEAK");
      expect(result.acos_multiplier).toBe(0.8);
      expect(result.bid_aggression).toBe("CONSERVATIVE");
    });

    it("季節性スコアが低い商品はNORMAL", () => {
      const input: DemandFollowingInput = {
        keyword_id: "kw1",
        current_sessions_7d: 500,
        previous_year_sessions_7d: 1000,
        seasonality_score: 0.2, // 通年型
        is_peak_season: false,
      };

      const result = determineDemandPhase(input);

      expect(result.demand_phase).toBe("OFF_SEASON");
      expect(result.acos_multiplier).toBe(1.0);
      expect(result.reason).toContain("通年型");
    });
  });

  // ==========================================================================
  // 7. キャンペーン保護
  // ==========================================================================
  describe("calculateCampaignHealth", () => {
    it("ROAS改善中で高スコアなら保護対象", () => {
      const input: CampaignHealthInput = {
        campaign_id: "camp1",
        roas_last_7d: 4.5,
        roas_last_14d: 4.0,
        roas_last_30d: 3.5,
        days_since_structure_change: 45,
        total_spend_30d: 150000,
        total_sales_30d: 525000,
      };

      const result = calculateCampaignHealth(input);

      expect(result.roas_trend).toBe("IMPROVING");
      expect(result.health_score).toBeGreaterThanOrEqual(70);
      expect(result.is_protected).toBe(true);
      expect(result.protection_reason).toContain("保護対象");
    });

    it("ROAS低下中は保護対象外", () => {
      const input: CampaignHealthInput = {
        campaign_id: "camp2",
        roas_last_7d: 1.5,
        roas_last_14d: 2.5,
        roas_last_30d: 3.0,
        days_since_structure_change: 10,
        total_spend_30d: 20000,
        total_sales_30d: 30000,
      };

      const result = calculateCampaignHealth(input);

      expect(result.roas_trend).toBe("DECLINING");
      expect(result.is_protected).toBe(false);
    });
  });

  describe("validateCampaignChange", () => {
    const protectedCampaign = {
      campaign_id: "camp1",
      is_protected: true,
      protection_reason: "テスト",
      health_score: 85,
      roas_trend: "STABLE" as const,
      days_since_last_change: 30,
    };

    it("入札変更は常に許可", () => {
      const result = validateCampaignChange(protectedCampaign, "BID_CHANGE");

      expect(result.allowed).toBe(true);
      expect(result.warning).toBeNull();
    });

    it("キーワード追加は警告付きで許可", () => {
      const result = validateCampaignChange(protectedCampaign, "KEYWORD_ADD");

      expect(result.allowed).toBe(true);
      expect(result.warning).toContain("監視を推奨");
    });

    it("構造変更は警告で拒否", () => {
      const result = validateCampaignChange(protectedCampaign, "STRUCTURE_CHANGE");

      expect(result.allowed).toBe(false);
      expect(result.warning).toContain("リスク");
    });
  });

  // ==========================================================================
  // 統合テスト
  // ==========================================================================
  describe("evaluateKeywordWithStrategies", () => {
    it("アンカーKW + ローンチモードで入札倍率が上がる", () => {
      const keyword = {
        keyword_id: "kw1",
        cvr: 0.04,
        category_avg_cvr: 0.02,
        search_volume: 10000,
        relevance_score: 0.9,
        impressions_3h: 30, // 不足
        sessions_7d: 1000,
        sessions_7d_last_year: 1000,
        seasonality_score: 0.3,
        is_peak_season: false,
      };

      const launchConfig: LaunchModeConfig = {
        is_launch_mode: true,
        launch_date: new Date(),
        days_since_launch: 2,
        launch_period_days: 14,
        acos_tolerance_multiplier: 3.0,
        min_impressions_3h: 100,
      };

      const result = evaluateKeywordWithStrategies(keyword, launchConfig);

      expect(result.anchor_score).toBeGreaterThan(1.5);
      expect(result.launch_adjustment).toBeGreaterThan(0);
      expect(result.final_bid_multiplier).toBeGreaterThan(1.3);
      expect(result.recommendations.length).toBeGreaterThanOrEqual(2);
      // Lifecycle関連フィールドはデータ不足でnull
      expect(result.lifecycle_phase).toBeNull();
      expect(result.lifecycle_coeff).toBe(1.0);
      expect(result.revenue_based_bid).toBeNull();
    });

    it("Bidding Lifecycle + Revenue-Based Bidが統合される", () => {
      const keyword = {
        keyword_id: "kw2",
        cvr: 0.05,
        category_avg_cvr: 0.03,
        search_volume: 5000,
        relevance_score: 0.8,
        impressions_3h: 200,
        sessions_7d: 1500,
        sessions_7d_last_year: 1200,
        seasonality_score: 0.5,
        is_peak_season: false,
        // Bidding Lifecycle用データ
        total_clicks: 150,
        current_acos: 0.18,
        target_acos: 0.20,
        current_bid: 50,
        avg_order_value: 3000,
      };

      const launchConfig: LaunchModeConfig = {
        is_launch_mode: false,
        launch_date: null,
        days_since_launch: -1,
        launch_period_days: 14,
        acos_tolerance_multiplier: 1.0,
        min_impressions_3h: 0,
      };

      const result = evaluateKeywordWithStrategies(keyword, launchConfig);

      // Revenue-Based Bid: 3000 × 0.05 × 0.20 × 0.9 = 27円
      expect(result.revenue_based_bid).toBe(27);
      // Phase2（最適化期）
      expect(result.lifecycle_phase).toBe("PHASE2_OPTIMIZATION");
      expect(result.lifecycle_coeff).toBe(1.0);
      expect(result.recommendations).toContainEqual(expect.stringContaining("Revenue-Based Bid"));
      expect(result.recommendations).toContainEqual(expect.stringContaining("最適化期"));
    });

    it("Phase3成長期で係数1.3が適用される", () => {
      const keyword = {
        keyword_id: "kw3",
        cvr: 0.06,
        category_avg_cvr: 0.03,
        search_volume: 8000,
        relevance_score: 0.9,
        impressions_3h: 300,
        sessions_7d: 2000,
        sessions_7d_last_year: 1500,
        seasonality_score: 0.6,
        is_peak_season: true,
        // Bidding Lifecycle用データ - ACOS良好
        total_clicks: 250,
        current_acos: 0.10, // 10% < 20% × 0.8 = 16%
        target_acos: 0.20,
        current_bid: 80,
        avg_order_value: 4000,
      };

      const launchConfig: LaunchModeConfig = {
        is_launch_mode: false,
        launch_date: null,
        days_since_launch: -1,
        launch_period_days: 14,
        acos_tolerance_multiplier: 1.0,
        min_impressions_3h: 0,
      };

      const result = evaluateKeywordWithStrategies(keyword, launchConfig);

      expect(result.lifecycle_phase).toBe("PHASE3_GROWTH");
      expect(result.lifecycle_coeff).toBe(1.3);
      expect(result.recommendations).toContainEqual(expect.stringContaining("成長期"));
      // 係数1.3が適用されている
      expect(result.final_bid_multiplier).toBeGreaterThanOrEqual(1.3);
    });
  });

  // ==========================================================================
  // 8. 商品レベル TACOS コントローラ
  // ==========================================================================
  describe("calculateLtvMultiplierStage", () => {
    it("LTV設定がない場合は1.0", () => {
      const result = calculateLtvMultiplierStage(undefined, undefined, "GROW");
      expect(result).toBe(1.0);
    });

    it("LAUNCH_HARDでLTV倍率が正しく計算される", () => {
      // ltvMultiplierStage = 1 + 1.8 × 1.0 × 0.7 = 1 + 1.26 = 2.26
      const result = calculateLtvMultiplierStage(1.8, 0.7, "LAUNCH_HARD");
      expect(result).toBeCloseTo(2.26, 2);
    });

    it("HARVESTでは係数が低くなる", () => {
      // ltvMultiplierStage = 1 + 1.8 × 0.2 × 0.7 = 1 + 0.252 = 1.252
      const result = calculateLtvMultiplierStage(1.8, 0.7, "HARVEST");
      expect(result).toBeCloseTo(1.252, 2);
    });
  });

  describe("calculateTargetTacosStage", () => {
    it("LAUNCH_HARD + LTV倍率2.0で目標TACOSが計算される", () => {
      // maxTacosStageRaw = 0.25 × 2.0 - 0.00 = 0.50
      // clamp(0.50, 0.25, 0.55) = 0.50
      const result = calculateTargetTacosStage(0.25, 2.0, "LAUNCH_HARD");
      expect(result.maxTacosStageRaw).toBeCloseTo(0.50, 2);
      expect(result.targetTacosStage).toBeCloseTo(0.50, 2);
    });

    it("理論値が高すぎると上限でクランプされる", () => {
      // maxTacosStageRaw = 0.50 × 2.0 - 0.00 = 1.00
      // clamp(1.00, 0.25, 0.55) = 0.55（上限）
      const result = calculateTargetTacosStage(0.50, 2.0, "LAUNCH_HARD");
      expect(result.maxTacosStageRaw).toBeCloseTo(1.00, 2);
      expect(result.targetTacosStage).toBe(0.55);
    });

    it("理論値が低すぎると下限でクランプされる", () => {
      // maxTacosStageRaw = 0.10 × 1.0 - 0.15 = -0.05
      // clamp(-0.05, 0.10, 0.25) = 0.10（下限）
      const result = calculateTargetTacosStage(0.10, 1.0, "HARVEST");
      expect(result.maxTacosStageRaw).toBeCloseTo(-0.05, 2);
      expect(result.targetTacosStage).toBe(0.10);
    });
  });

  describe("calculateProductBidMultiplier", () => {
    it("データ不足の場合は1.0を返す", () => {
      const input: TacosControllerInput = {
        asin: "B001234567",
        totalSales30d: 5000, // 閾値1万円未満
        adSales30d: 3000,
        adSpend30d: 1500,
        organicSales30d: 2000,
        organicSalesPrev30d: 1800,
        marginRate: 0.25,
        lifecycleStage: "GROW",
      };

      const result = calculateProductBidMultiplier(input);

      expect(result.productBidMultiplier).toBe(1.0);
      expect(result.zone).toBe("NEUTRAL");
      expect(result.reason).toContain("データ不足");
    });

    it("強い抑制ゾーン: TACOS高 + 自然検索不調", () => {
      const input: TacosControllerInput = {
        asin: "B001234567",
        totalSales30d: 100000,
        adSales30d: 60000,
        adSpend30d: 35000, // TACOS = 35%
        organicSales30d: 40000,
        organicSalesPrev30d: 42000, // 成長率 = -4.8%
        marginRate: 0.25,
        lifecycleStage: "GROW", // 目標TACOS = 15-35%範囲
      };

      const result = calculateProductBidMultiplier(input);

      // targetTacosStage = 0.25 × 1.0 - 0.10 = 0.15（GROW）
      // TACOS 35% > 15% × 1.2 = 18% かつ 成長率 -4.8% < 2%
      expect(result.zone).toBe("STRONG_SUPPRESSION");
      expect(result.productBidMultiplier).toBe(0.7);
    });

    it("軽い抑制ゾーン: TACOSやや高", () => {
      const input: TacosControllerInput = {
        asin: "B001234567",
        totalSales30d: 100000,
        adSales30d: 50000,
        adSpend30d: 20000, // TACOS = 20%
        organicSales30d: 50000,
        organicSalesPrev30d: 48000, // 成長率 = 4.2%
        marginRate: 0.25,
        lifecycleStage: "GROW", // 目標TACOS = 15%
      };

      const result = calculateProductBidMultiplier(input);

      // TACOS 20% > 15% × 1.05 = 15.75%
      expect(result.zone).toBe("LIGHT_SUPPRESSION");
      expect(result.productBidMultiplier).toBeGreaterThanOrEqual(0.8);
      expect(result.productBidMultiplier).toBeLessThan(1.0);
    });

    it("攻めゾーン: TACOS低 + 自然検索好調", () => {
      const input: TacosControllerInput = {
        asin: "B001234567",
        totalSales30d: 100000,
        adSales30d: 40000,
        adSpend30d: 8000, // TACOS = 8%
        organicSales30d: 60000,
        organicSalesPrev30d: 50000, // 成長率 = 20%
        marginRate: 0.25,
        lifecycleStage: "GROW", // 目標TACOS = 15%
      };

      const result = calculateProductBidMultiplier(input);

      // TACOS 8% < 15% × 0.8 = 12% かつ 成長率 20% > 10%
      expect(result.zone).toBe("AGGRESSIVE");
      expect(result.productBidMultiplier).toBeGreaterThan(1.0);
      expect(result.productBidMultiplier).toBeLessThanOrEqual(1.3);
    });

    it("ニュートラルゾーン: TACOS適正", () => {
      const input: TacosControllerInput = {
        asin: "B001234567",
        totalSales30d: 100000,
        adSales30d: 45000,
        adSpend30d: 14000, // TACOS = 14%
        organicSales30d: 55000,
        organicSalesPrev30d: 53000, // 成長率 = 3.8%
        marginRate: 0.25,
        lifecycleStage: "GROW", // 目標TACOS = 15%
      };

      const result = calculateProductBidMultiplier(input);

      // TACOS 14%は目標15%付近（80-105%範囲内）
      expect(result.zone).toBe("NEUTRAL");
      expect(result.productBidMultiplier).toBe(1.0);
    });

    it("サプリメント（LTV商品）で正しく計算される", () => {
      const input: TacosControllerInput = {
        asin: "B001234567",
        totalSales30d: 200000,
        adSales30d: 100000,
        adSpend30d: 60000, // TACOS = 30%
        organicSales30d: 100000,
        organicSalesPrev30d: 90000, // 成長率 = 11%
        marginRate: 0.30,
        expectedRepeatOrdersAssumed: 1.8,
        ltvSafetyFactor: 0.7,
        lifecycleStage: "LAUNCH_HARD",
      };

      const result = calculateProductBidMultiplier(input);

      // ltvMultiplierStage = 1 + 1.8 × 1.0 × 0.7 = 2.26
      expect(result.ltvMultiplierStage).toBeCloseTo(2.26, 2);
      // maxTacosStageRaw = 0.30 × 2.26 - 0.00 = 0.678
      // targetTacosStage = clamp(0.678, 0.25, 0.55) = 0.55
      expect(result.targetTacosStage).toBe(0.55);
      // TACOS 30% < 55%なのでニュートラルか攻め
      expect(result.productBidMultiplier).toBeGreaterThanOrEqual(1.0);
    });

    it("ステージごとに目標TACOSが異なる", () => {
      const baseInput: Omit<TacosControllerInput, "lifecycleStage"> = {
        asin: "B001234567",
        totalSales30d: 100000,
        adSales30d: 50000,
        adSpend30d: 15000, // TACOS = 15%
        organicSales30d: 50000,
        organicSalesPrev30d: 48000,
        marginRate: 0.25,
      };

      const launchHard = calculateProductBidMultiplier({
        ...baseInput,
        lifecycleStage: "LAUNCH_HARD",
      });
      const harvest = calculateProductBidMultiplier({
        ...baseInput,
        lifecycleStage: "HARVEST",
      });

      // LAUNCH_HARDは許容範囲が広い（25-55%）、HARVESTは厳しい（10-25%）
      expect(launchHard.targetTacosStage).toBeGreaterThan(harvest.targetTacosStage);
    });
  });

  describe("calculateProductBidMultiplierSimple", () => {
    it("数値のみを返す", () => {
      const input: TacosControllerInput = {
        asin: "B001234567",
        totalSales30d: 100000,
        adSales30d: 50000,
        adSpend30d: 15000,
        organicSales30d: 50000,
        organicSalesPrev30d: 48000,
        marginRate: 0.25,
        lifecycleStage: "GROW",
      };

      const result = calculateProductBidMultiplierSimple(input);

      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThan(0);
    });
  });
});

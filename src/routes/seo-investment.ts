/**
 * SEO投資戦略エンドポイント
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import {
  evaluateSeoInvestmentOpportunity,
  calculateDynamicInvestmentLimit,
  updateSeoInvestmentState,
  calculateSeoInvestmentAcosLimit,
  generateSeoInvestmentSummary,
  DEFAULT_SEO_INVESTMENT_CONFIG,
  SeoInvestmentConfig,
  SeoInvestmentState,
  ProductProfitability,
  getLatestProductProfitability,
} from "../unified-strategy";
import { getLatestStrategyAnalysis, JungleScoutMarketplace } from "../jungle-scout";
import {
  notifications,
} from "../utils/notification";

const router = Router();

// インメモリ状態管理（本番ではBigQueryに保存すべき）
const investmentStates = new Map<string, SeoInvestmentState>();

function getStateKey(asin: string, keyword: string, marketplace: string): string {
  return `${marketplace}:${asin}:${keyword}`;
}

/**
 * POST /seo-investment/evaluate
 * キーワードのSEO投資適性を評価
 */
router.post("/evaluate", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin, marketplace = "jp", config } = req.body;

  if (!asin) {
    return res.status(400).json({
      success: false,
      error: "asin is required",
    });
  }

  logger.info("Evaluating SEO investment opportunities", { traceId, asin, marketplace });

  try {
    const mp = marketplace as JungleScoutMarketplace;

    // 商品収益性データを取得
    const product = await getLatestProductProfitability(mp, asin);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: "product-not-found",
        message: "Product profitability data not found. Register via POST /unified/product first.",
      });
    }

    // キーワード戦略分析を取得
    const keywordAnalyses = await getLatestStrategyAnalysis(mp, asin);
    if (keywordAnalyses.length === 0) {
      return res.status(404).json({
        success: false,
        error: "no-keyword-analysis",
        message: "No keyword analysis found. Run /jungle-scout/analyze first.",
      });
    }

    // SEO投資設定
    const seoConfig: SeoInvestmentConfig = {
      ...DEFAULT_SEO_INVESTMENT_CONFIG,
      enabled: true,
      ...(config || {}),
    };

    // 各キーワードを評価
    const recommendations = keywordAnalyses.map((analysis) => {
      // 競合最大SOV（簡易推定）
      const competitorMaxSov = Math.min(analysis.current_sov + 0.2, 0.5);

      return evaluateSeoInvestmentOpportunity(
        product,
        analysis,
        competitorMaxSov,
        seoConfig
      );
    });

    // サマリーを生成
    const summary = generateSeoInvestmentSummary(recommendations);

    logger.info("SEO investment evaluation completed", {
      traceId,
      asin,
      totalKeywords: recommendations.length,
      investCandidates: summary.investment_candidates,
    });

    return res.json({
      success: true,
      asin,
      marketplace: mp,
      config: {
        enabled: seoConfig.enabled,
        targetOrganicRank: seoConfig.target_organic_rank,
        minSearchVolume: seoConfig.min_search_volume,
        allowLossRatio: seoConfig.allow_loss_ratio,
      },
      summary: {
        totalKeywordsAnalyzed: summary.total_keywords_analyzed,
        investmentCandidates: summary.investment_candidates,
        totalEstimatedInvestment: summary.total_estimated_investment,
        totalExpectedMonthlyValue: summary.total_expected_monthly_value,
        weightedPaybackMonths: summary.weighted_payback_months,
        byRiskLevel: summary.by_risk_level,
      },
      topOpportunities: summary.top_opportunities.map((r) => ({
        keyword: r.keyword,
        searchVolume: r.search_volume,
        currentOrganicRank: r.current_organic_rank,
        targetOrganicRank: r.target_organic_rank,
        shouldInvest: r.should_invest,
        recommendedPhase: r.recommended_phase,
        recommendedLossRatio: r.recommended_loss_ratio,
        estimatedInvestmentNeeded: r.estimated_investment_needed,
        estimatedPaybackMonths: r.estimated_payback_months,
        organicValuePerMonth: r.organic_value_per_month,
        riskLevel: r.risk_level,
        riskFactors: r.risk_factors,
        reason: r.recommendation_reason,
      })),
      allRecommendations: recommendations.map((r) => ({
        keyword: r.keyword,
        shouldInvest: r.should_invest,
        riskLevel: r.risk_level,
        estimatedPaybackMonths: r.estimated_payback_months,
      })),
    });
  } catch (error) {
    logger.error("SEO investment evaluation failed", {
      traceId,
      asin,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "seo-investment-evaluation-failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /seo-investment/start
 * キーワードのSEO投資を開始
 */
router.post("/start", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const { asin, keyword, marketplace = "jp", initialOrganicRank } = req.body;

  if (!asin || !keyword) {
    return res.status(400).json({
      success: false,
      error: "asin and keyword are required",
    });
  }

  logger.info("Starting SEO investment", { traceId, asin, keyword, marketplace });

  try {
    const stateKey = getStateKey(asin, keyword, marketplace);

    // 既存の投資状態をチェック
    if (investmentStates.has(stateKey)) {
      const existing = investmentStates.get(stateKey)!;
      if (existing.phase !== "completed" && existing.phase !== "abandoned") {
        return res.status(400).json({
          success: false,
          error: "investment-already-active",
          message: `Investment already active for ${keyword} (phase: ${existing.phase})`,
        });
      }
    }

    // 新しい投資状態を作成
    const newState: SeoInvestmentState = {
      asin,
      keyword,
      marketplace,
      phase: "initial",
      started_at: new Date(),
      current_day: 0,
      rank_history: [],
      initial_organic_rank: initialOrganicRank ?? null,
      current_organic_rank: initialOrganicRank ?? null,
      best_organic_rank: initialOrganicRank ?? null,
      total_investment: 0,
      total_ad_spend: 0,
      total_sales: 0,
      daily_investments: [],
      rank_improvement: 0,
      weeks_without_improvement: 0,
      estimated_organic_value: 0,
      roi_projection: 0,
    };

    investmentStates.set(stateKey, newState);

    logger.info("SEO investment started", { traceId, asin, keyword, marketplace });

    return res.json({
      success: true,
      message: "SEO investment started",
      state: {
        asin: newState.asin,
        keyword: newState.keyword,
        marketplace: newState.marketplace,
        phase: newState.phase,
        startedAt: newState.started_at,
        initialOrganicRank: newState.initial_organic_rank,
      },
    });
  } catch (error) {
    logger.error("Failed to start SEO investment", {
      traceId,
      asin,
      keyword,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "start-investment-failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /seo-investment/update
 * 投資状態を更新（日次バッチで呼ばれる想定）
 */
router.post("/update", async (req: Request, res: Response) => {
  const traceId = (req as any).traceId;
  const {
    asin,
    keyword,
    marketplace = "jp",
    currentOrganicRank,
    todayAdSpend,
    todaySales,
  } = req.body;

  if (!asin || !keyword) {
    return res.status(400).json({
      success: false,
      error: "asin and keyword are required",
    });
  }

  logger.info("Updating SEO investment state", { traceId, asin, keyword });

  try {
    const mp = marketplace as JungleScoutMarketplace;
    const stateKey = getStateKey(asin, keyword, marketplace);

    // 既存状態を取得
    const state = investmentStates.get(stateKey);
    if (!state) {
      return res.status(404).json({
        success: false,
        error: "investment-not-found",
        message: `No active investment found for ${keyword}`,
      });
    }

    // 商品収益性データを取得
    const product = await getLatestProductProfitability(mp, asin);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: "product-not-found",
      });
    }

    // 月間利益を計算
    const monthlyProfit = product.total_sales_30d * product.profit_margin;

    // オーガニック価値を推定（簡易計算）
    const estimatedOrganicValue = monthlyProfit * 0.3; // 30%をオーガニック由来と仮定

    // 状態を更新
    const result = updateSeoInvestmentState(
      state,
      currentOrganicRank ?? null,
      todayAdSpend || 0,
      todaySales || 0,
      monthlyProfit,
      estimatedOrganicValue
    );

    // 更新された状態を保存
    investmentStates.set(stateKey, result.updatedState);

    // 通知チェック
    if (result.investmentLimit) {
      // 投資上限接近通知
      if (result.investmentLimit.utilization > 0.8) {
        await notifications.investmentLimitApproaching({
          asin,
          keyword,
          currentInvestment: result.investmentLimit.current,
          investmentLimit: result.investmentLimit.limit,
          utilizationPercent: result.investmentLimit.utilization * 100,
        });
      }
    }

    // 目標達成通知
    if (result.action === "maintain" && result.updatedState.phase === "completed") {
      await notifications.seoGoalAchieved({
        asin,
        keyword,
        targetRank: DEFAULT_SEO_INVESTMENT_CONFIG.target_organic_rank,
        achievedRank: currentOrganicRank,
        totalInvestment: result.updatedState.total_investment,
        paybackMonths: result.updatedState.roi_projection,
      });
    }

    // 撤退通知
    if (result.action === "abandon") {
      await notifications.seoInvestmentAbandoned({
        asin,
        keyword,
        reason: result.reason,
        totalInvestment: result.updatedState.total_investment,
        daysInvested: result.updatedState.current_day,
        rankImprovement: result.updatedState.rank_improvement,
      });
    }

    logger.info("SEO investment state updated", {
      traceId,
      asin,
      keyword,
      action: result.action,
      phase: result.updatedState.phase,
    });

    return res.json({
      success: true,
      action: result.action,
      reason: result.reason,
      state: {
        phase: result.updatedState.phase,
        currentDay: result.updatedState.current_day,
        currentOrganicRank: result.updatedState.current_organic_rank,
        bestOrganicRank: result.updatedState.best_organic_rank,
        rankImprovement: result.updatedState.rank_improvement,
        totalInvestment: result.updatedState.total_investment,
        totalAdSpend: result.updatedState.total_ad_spend,
        totalSales: result.updatedState.total_sales,
        weeksWithoutImprovement: result.updatedState.weeks_without_improvement,
        roiProjection: result.updatedState.roi_projection,
      },
      investmentLimit: result.investmentLimit,
    });
  } catch (error) {
    logger.error("Failed to update SEO investment", {
      traceId,
      asin,
      keyword,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      success: false,
      error: "update-investment-failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /seo-investment/status/:asin
 * ASIN別のSEO投資状態を取得
 */
router.get("/status/:asin", (req: Request, res: Response) => {
  const { asin } = req.params;
  const marketplace = (req.query.marketplace as string) || "jp";

  const states: SeoInvestmentState[] = [];
  investmentStates.forEach((state, key) => {
    if (key.startsWith(`${marketplace}:${asin}:`)) {
      states.push(state);
    }
  });

  return res.json({
    success: true,
    asin,
    marketplace,
    count: states.length,
    investments: states.map((s) => ({
      keyword: s.keyword,
      phase: s.phase,
      startedAt: s.started_at,
      currentDay: s.current_day,
      initialOrganicRank: s.initial_organic_rank,
      currentOrganicRank: s.current_organic_rank,
      bestOrganicRank: s.best_organic_rank,
      rankImprovement: s.rank_improvement,
      totalInvestment: s.total_investment,
      totalAdSpend: s.total_ad_spend,
      totalSales: s.total_sales,
      weeksWithoutImprovement: s.weeks_without_improvement,
      roiProjection: s.roi_projection,
    })),
  });
});

/**
 * GET /seo-investment/summary/:asin
 * ASIN別のSEO投資サマリー
 */
router.get("/summary/:asin", async (req: Request, res: Response) => {
  const { asin } = req.params;
  const marketplace = (req.query.marketplace as string) || "jp";

  const states: SeoInvestmentState[] = [];
  investmentStates.forEach((state, key) => {
    if (key.startsWith(`${marketplace}:${asin}:`)) {
      states.push(state);
    }
  });

  // フェーズ別集計
  const byPhase: Record<string, number> = {
    initial: 0,
    acceleration: 0,
    maintenance: 0,
    exit: 0,
    completed: 0,
    abandoned: 0,
  };
  states.forEach((s) => {
    byPhase[s.phase] = (byPhase[s.phase] || 0) + 1;
  });

  // 投資合計
  const totalInvestment = states.reduce((sum, s) => sum + s.total_investment, 0);
  const totalAdSpend = states.reduce((sum, s) => sum + s.total_ad_spend, 0);
  const totalSales = states.reduce((sum, s) => sum + s.total_sales, 0);

  // アクティブな投資
  const activeStates = states.filter(
    (s) => !["completed", "abandoned"].includes(s.phase)
  );

  return res.json({
    success: true,
    asin,
    marketplace,
    summary: {
      totalKeywords: states.length,
      activeKeywords: activeStates.length,
      completedKeywords: byPhase.completed,
      abandonedKeywords: byPhase.abandoned,
      byPhase,
      totalInvestment,
      totalAdSpend,
      totalSales,
      netLoss: totalAdSpend - totalSales,
    },
    activeInvestments: activeStates.map((s) => ({
      keyword: s.keyword,
      phase: s.phase,
      currentDay: s.current_day,
      rankImprovement: s.rank_improvement,
      totalInvestment: s.total_investment,
    })),
  });
});

/**
 * GET /seo-investment/acos-limit
 * フェーズ別ACOS上限を計算
 */
router.get("/acos-limit", (req: Request, res: Response) => {
  const profitMargin = parseFloat(req.query.profitMargin as string) || 0.3;
  const phase = (req.query.phase as string) || "initial";

  const validPhases = ["initial", "acceleration", "maintenance", "exit"];
  if (!validPhases.includes(phase)) {
    return res.status(400).json({
      success: false,
      error: "invalid-phase",
      message: `Phase must be one of: ${validPhases.join(", ")}`,
    });
  }

  const acosLimit = calculateSeoInvestmentAcosLimit(
    profitMargin,
    phase as SeoInvestmentState["phase"]
  );

  return res.json({
    success: true,
    profitMargin,
    phase,
    normalAcosLimit: profitMargin,
    seoInvestmentAcosLimit: acosLimit,
    allowedLossRatio: DEFAULT_SEO_INVESTMENT_CONFIG.phase_loss_ratios[
      phase as keyof typeof DEFAULT_SEO_INVESTMENT_CONFIG.phase_loss_ratios
    ],
  });
});

/**
 * GET /seo-investment/investment-limit
 * 動的投資上限を計算
 */
router.get("/investment-limit", (req: Request, res: Response) => {
  const monthlyProfit = parseFloat(req.query.monthlyProfit as string) || 0;
  const estimatedOrganicValue =
    parseFloat(req.query.estimatedOrganicValue as string) || 0;

  if (monthlyProfit <= 0 || estimatedOrganicValue <= 0) {
    return res.status(400).json({
      success: false,
      error: "invalid-params",
      message: "monthlyProfit and estimatedOrganicValue must be positive",
    });
  }

  const limit = calculateDynamicInvestmentLimit(monthlyProfit, estimatedOrganicValue);

  return res.json({
    success: true,
    input: {
      monthlyProfit,
      estimatedOrganicValue,
    },
    limit: {
      profitBasedLimit: limit.profitBasedLimit,
      organicValueBasedLimit: limit.organicValueBasedLimit,
      effectiveLimit: limit.effectiveLimit,
      explanation: limit.explanation,
    },
  });
});

/**
 * DELETE /seo-investment/stop
 * 投資を手動で停止
 */
router.delete("/stop", (req: Request, res: Response) => {
  const { asin, keyword, marketplace = "jp" } = req.body;

  if (!asin || !keyword) {
    return res.status(400).json({
      success: false,
      error: "asin and keyword are required",
    });
  }

  const stateKey = getStateKey(asin, keyword, marketplace);
  const state = investmentStates.get(stateKey);

  if (!state) {
    return res.status(404).json({
      success: false,
      error: "investment-not-found",
    });
  }

  // 撤退フェーズに移行
  state.phase = "abandoned";
  investmentStates.set(stateKey, state);

  logger.info("SEO investment manually stopped", { asin, keyword, marketplace });

  return res.json({
    success: true,
    message: "Investment stopped",
    finalState: {
      keyword: state.keyword,
      phase: state.phase,
      totalInvestment: state.total_investment,
      rankImprovement: state.rank_improvement,
      daysInvested: state.current_day,
    },
  });
});

export default router;

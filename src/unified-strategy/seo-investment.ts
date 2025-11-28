/**
 * SEO投資戦略エンジン
 *
 * 新商品・ビッグキーワードで自然検索上位を狙うための赤字許容投資戦略
 *
 * 戦略コンセプト:
 * 1. 検索ボリュームの大きいキーワードで上位を取れば、広告なしでも売上が立つ
 * 2. そのために一時的に赤字を許容して広告投資を行う
 * 3. ただし無限に赤字を許容するのではなく、明確な撤退条件を設定
 * 4. 投資対効果を常にモニタリングし、回収見込みがない場合は撤退
 */

import { logger } from "../logger";
import {
  SeoInvestmentConfig,
  SeoInvestmentState,
  SeoInvestmentRecommendation,
  ProductProfitability,
} from "./types";
import { KeywordStrategyAnalysis } from "../jungle-scout/types";

// =============================================================================
// デフォルト設定
// =============================================================================

export const DEFAULT_SEO_INVESTMENT_CONFIG: SeoInvestmentConfig = {
  enabled: false, // デフォルトは無効（明示的に有効化が必要）

  // 赤字許容設定
  allow_loss_ratio: 0.5, // 利益率の50%まで赤字許容（利益率30%なら ACOS 45%まで）
  max_loss_per_keyword_daily: 3000, // キーワード別1日3,000円まで
  max_total_loss_daily: 10000, // ASIN全体で1日10,000円まで

  // 目標設定
  target_organic_rank: 10, // 自然検索10位以内を目指す
  target_sponsored_rank: 3, // スポンサー広告3位以内

  // 対象条件
  min_search_volume: 500, // 月間検索500以上（ニッチKWも対象）
  // ※ 検索ボリュームが少ないKWは：
  // - 競合が少なく投資効率が高い
  // - 赤字幅が小さくリスクが低い
  // - 複数の小KWで1位を取れば合計で大きな効果
  min_profit_margin: 0.25, // 利益率25%以上の商品のみ
  max_competition_sov: 0.4, // 1社がSOV40%以上占有なら見送り

  // 撤退条件（動的：商品規模に連動）
  exit_conditions: {
    // 時間ベース
    max_investment_days: 90, // 90日で目標未達なら撤退（Amazonは時間がかかる）

    // 投資効率ベース（商品規模に連動）
    max_investment_ratio_to_monthly_profit: 6.0, // 月間利益の6ヶ月分まで投資可能
    // 最近のAmazonは販売実績の蓄積を重視するため、長期視点が必要
    // 例: 月商100万×利益率30% = 月利益30万 → 180万円まで投資可
    // 例: 月商10万×利益率30% = 月利益3万 → 18万円まで投資可

    max_investment_ratio_to_organic_value: 18.0, // 期待オーガニック価値の18ヶ月分まで
    // 投資回収期間18ヶ月以内を保証（長期投資を許容）

    // 進捗ベース
    min_rank_improvement_per_week: 2, // 週2位以上改善がなければ要検討（緩和）
    stagnant_weeks_limit: 3, // 3週連続改善なしで撤退（猶予を増やす）

    // ROI効率ベース
    min_roi_efficiency: 0.0005, // 投資効率しきい値を緩和（長期投資対応）
    roi_check_after_days: 21, // 21日目以降からROIチェック開始（3週間は様子見）
  },

  // フェーズ別赤字許容率
  phase_loss_ratios: {
    initial: 0.3, // 初期：利益率の30%まで赤字（様子見）
    acceleration: 0.5, // 加速：効果確認後、50%まで拡大
    maintenance: 0.2, // 維持：目標達成後は20%で維持
    exit: 0.1, // 撤退：10%まで縮小しながら撤退
  },
};

// =============================================================================
// SEO投資判定
// =============================================================================

/**
 * キーワードがSEO投資対象として適切かを判定
 */
export function evaluateSeoInvestmentOpportunity(
  product: ProductProfitability,
  keywordAnalysis: KeywordStrategyAnalysis,
  competitorMaxSov: number, // 最大競合のSOV
  config: SeoInvestmentConfig = DEFAULT_SEO_INVESTMENT_CONFIG
): SeoInvestmentRecommendation {
  const riskFactors: string[] = [];
  let riskLevel: "low" | "medium" | "high" | "very_high" = "low";

  // 基本チェック
  if (!config.enabled) {
    return createSkipRecommendation(
      keywordAnalysis,
      "SEO投資モードが無効です",
      riskFactors
    );
  }

  // 検索ボリュームチェック
  if (keywordAnalysis.search_volume < config.min_search_volume) {
    return createSkipRecommendation(
      keywordAnalysis,
      `検索ボリューム ${keywordAnalysis.search_volume} が最小要件 ${config.min_search_volume} 未満`,
      riskFactors
    );
  }

  // 利益率チェック
  if (product.profit_margin < config.min_profit_margin) {
    return createSkipRecommendation(
      keywordAnalysis,
      `利益率 ${(product.profit_margin * 100).toFixed(1)}% が最小要件 ${(config.min_profit_margin * 100).toFixed(1)}% 未満（投資回収困難）`,
      riskFactors
    );
  }

  // 競合SOVチェック
  if (competitorMaxSov > config.max_competition_sov) {
    riskFactors.push(`強力な競合が存在（SOV ${(competitorMaxSov * 100).toFixed(1)}%）`);
    riskLevel = "high";
  }

  // 現在ランクチェック
  const currentRank = keywordAnalysis.current_organic_rank;
  if (currentRank === null || currentRank > 100) {
    riskFactors.push("現在ランク圏外（100位以下）からのスタート");
    riskLevel = riskLevel === "high" ? "very_high" : "high";
  } else if (currentRank <= config.target_organic_rank) {
    return createSkipRecommendation(
      keywordAnalysis,
      `既に目標順位 ${config.target_organic_rank} 位以内を達成（現在 ${currentRank} 位）`,
      riskFactors
    );
  }

  // オーガニック価値を計算
  const organicValuePerMonth = estimateOrganicValue(
    keywordAnalysis.search_volume,
    config.target_organic_rank,
    product.profit_margin,
    product.unit_profit
  );

  // 必要投資額を推定
  const estimatedInvestment = estimateRequiredInvestment(
    currentRank,
    config.target_organic_rank,
    keywordAnalysis.search_volume,
    competitorMaxSov
  );

  // 投資回収期間を計算
  const paybackMonths = estimatedInvestment / organicValuePerMonth;

  // リスク評価を更新
  // 12ヶ月回収は現実的。Amazonでオーガニック順位を安定させるには時間がかかる
  if (paybackMonths > 18) {
    riskFactors.push(`投資回収に ${paybackMonths.toFixed(1)} ヶ月必要（18ヶ月以上はリスク高）`);
    riskLevel = "very_high";
  } else if (paybackMonths > 12) {
    riskFactors.push(`投資回収に ${paybackMonths.toFixed(1)} ヶ月必要（長期投資）`);
    if (riskLevel === "low") riskLevel = "medium";
  } else if (paybackMonths > 6) {
    riskFactors.push(`投資回収 ${paybackMonths.toFixed(1)} ヶ月（標準的）`);
    // 6-12ヶ月は標準的なのでリスク上げない
  }

  // 推奨判定
  // ニッチKW（検索ボリューム小）の場合は条件を緩和
  const isNicheKeyword = keywordAnalysis.search_volume < 2000;
  const minOrganicValue = isNicheKeyword ? 3000 : 10000; // ニッチは月3千円、大KWは月1万円
  const maxPaybackMonths = isNicheKeyword ? 24 : 18; // ニッチは24ヶ月、大KWは18ヶ月まで許容

  const shouldInvest =
    riskLevel !== "very_high" &&
    paybackMonths <= maxPaybackMonths &&
    organicValuePerMonth > minOrganicValue;

  // 推奨フェーズと赤字許容率を決定
  let recommendedPhase: "initial" | "acceleration" | "maintenance" | "exit" | "skip" = "skip";
  let recommendedLossRatio = 0;

  if (shouldInvest) {
    if (isNicheKeyword) {
      // ニッチKWは競合が少なく効率が良いので積極的に
      recommendedPhase = "acceleration";
      recommendedLossRatio = config.phase_loss_ratios.acceleration;
      riskFactors.push("ニッチKW: 競合少・リスク小・効率良");
    } else if (riskLevel === "low") {
      recommendedPhase = "acceleration";
      recommendedLossRatio = config.phase_loss_ratios.acceleration;
    } else if (riskLevel === "medium") {
      recommendedPhase = "initial";
      recommendedLossRatio = config.phase_loss_ratios.initial;
    } else {
      recommendedPhase = "initial";
      recommendedLossRatio = config.phase_loss_ratios.initial * 0.5; // 控えめに
    }
  }

  // 推奨理由を構築
  const reason = buildRecommendationReason(
    shouldInvest,
    keywordAnalysis,
    currentRank,
    config.target_organic_rank,
    organicValuePerMonth,
    paybackMonths,
    riskLevel,
    riskFactors
  );

  return {
    keyword: keywordAnalysis.keyword,
    search_volume: keywordAnalysis.search_volume,
    current_organic_rank: currentRank,
    target_organic_rank: config.target_organic_rank,

    should_invest: shouldInvest,
    recommended_phase: recommendedPhase,
    recommended_loss_ratio: recommendedLossRatio,

    estimated_investment_needed: estimatedInvestment,
    estimated_payback_months: paybackMonths,
    organic_value_per_month: organicValuePerMonth,

    risk_level: riskLevel,
    risk_factors: riskFactors,

    recommendation_reason: reason,
  };
}

// =============================================================================
// 投資状態管理
// =============================================================================

/**
 * 動的撤退上限額を計算
 * 商品規模とオーガニック価値に基づいて撤退上限を決定
 */
export function calculateDynamicInvestmentLimit(
  monthlyProfit: number, // 月間利益（月商 × 利益率）
  estimatedOrganicValue: number, // 期待オーガニック月間価値
  config: SeoInvestmentConfig = DEFAULT_SEO_INVESTMENT_CONFIG
): {
  profitBasedLimit: number;
  organicValueBasedLimit: number;
  effectiveLimit: number;
  explanation: string;
} {
  const exitConditions = config.exit_conditions;

  // 1. 月間利益ベースの上限
  // 「何ヶ月分の利益まで投資するか」
  const profitBasedLimit = monthlyProfit * exitConditions.max_investment_ratio_to_monthly_profit;

  // 2. オーガニック価値ベースの上限
  // 「投資回収期間が何ヶ月以内か」
  const organicValueBasedLimit =
    estimatedOrganicValue * exitConditions.max_investment_ratio_to_organic_value;

  // 3. より保守的な方を採用（両方の条件を満たす）
  const effectiveLimit = Math.min(profitBasedLimit, organicValueBasedLimit);

  const explanation =
    `月間利益 ${monthlyProfit.toLocaleString()}円 × ${exitConditions.max_investment_ratio_to_monthly_profit}ヶ月 = ${profitBasedLimit.toLocaleString()}円、` +
    `オーガニック価値 ${estimatedOrganicValue.toLocaleString()}円/月 × ${exitConditions.max_investment_ratio_to_organic_value}ヶ月 = ${organicValueBasedLimit.toLocaleString()}円、` +
    `→ 撤退上限: ${effectiveLimit.toLocaleString()}円`;

  return {
    profitBasedLimit,
    organicValueBasedLimit,
    effectiveLimit,
    explanation,
  };
}

/**
 * 投資状態を更新し、次のアクションを決定
 * 動的な撤退条件を使用
 */
export function updateSeoInvestmentState(
  state: SeoInvestmentState,
  currentOrganicRank: number | null,
  todayAdSpend: number,
  todaySales: number,
  // 動的撤退計算に必要なパラメータ
  monthlyProfit: number, // 商品の月間利益
  estimatedOrganicValue: number, // このKWの期待オーガニック価値
  config: SeoInvestmentConfig = DEFAULT_SEO_INVESTMENT_CONFIG
): {
  updatedState: SeoInvestmentState;
  action: "continue" | "accelerate" | "maintain" | "exit" | "abandon";
  reason: string;
  investmentLimit?: {
    current: number;
    limit: number;
    utilization: number;
  };
} {
  const today = new Date();
  const loss = todayAdSpend - todaySales;

  // 状態を更新
  const updatedState: SeoInvestmentState = {
    ...state,
    current_day: state.current_day + 1,
    current_organic_rank: currentOrganicRank,
    best_organic_rank:
      currentOrganicRank !== null &&
      (state.best_organic_rank === null || currentOrganicRank < state.best_organic_rank)
        ? currentOrganicRank
        : state.best_organic_rank,
    rank_history: [
      ...state.rank_history,
      { date: today, organic_rank: currentOrganicRank, sponsored_rank: null },
    ],
    total_investment: state.total_investment + Math.max(0, loss),
    total_ad_spend: state.total_ad_spend + todayAdSpend,
    total_sales: state.total_sales + todaySales,
    daily_investments: [
      ...state.daily_investments,
      { date: today, ad_spend: todayAdSpend, sales: todaySales, loss },
    ],
    rank_improvement:
      state.initial_organic_rank !== null && currentOrganicRank !== null
        ? state.initial_organic_rank - currentOrganicRank
        : 0,
    estimated_organic_value: estimatedOrganicValue,
  };

  // 撤退条件チェック
  const exitConditions = config.exit_conditions;

  // 1. 最大投資日数超過
  if (updatedState.current_day > exitConditions.max_investment_days) {
    return {
      updatedState: { ...updatedState, phase: "abandoned" },
      action: "abandon",
      reason: `最大投資日数 ${exitConditions.max_investment_days} 日を超過`,
    };
  }

  // 2. 動的投資上限チェック（商品規模に連動）
  const investmentLimits = calculateDynamicInvestmentLimit(
    monthlyProfit,
    estimatedOrganicValue,
    config
  );

  const investmentUtilization = updatedState.total_investment / investmentLimits.effectiveLimit;

  if (updatedState.total_investment > investmentLimits.effectiveLimit) {
    return {
      updatedState: { ...updatedState, phase: "abandoned" },
      action: "abandon",
      reason:
        `動的投資上限 ${investmentLimits.effectiveLimit.toLocaleString()}円 を超過。` +
        `（現在投資額: ${updatedState.total_investment.toLocaleString()}円）`,
      investmentLimit: {
        current: updatedState.total_investment,
        limit: investmentLimits.effectiveLimit,
        utilization: investmentUtilization,
      },
    };
  }

  // 投資消化率が80%を超えたら警告
  const limitWarning =
    investmentUtilization > 0.8
      ? `⚠️ 投資上限の${(investmentUtilization * 100).toFixed(0)}%を消化。`
      : "";

  // 3. ROI効率チェック（一定期間後から）
  if (updatedState.current_day >= exitConditions.roi_check_after_days) {
    const roiEfficiency =
      updatedState.total_investment > 0
        ? updatedState.rank_improvement / updatedState.total_investment
        : 0;

    if (
      roiEfficiency < exitConditions.min_roi_efficiency &&
      updatedState.rank_improvement <= 0
    ) {
      return {
        updatedState: { ...updatedState, phase: "exit" },
        action: "exit",
        reason:
          `ROI効率が低すぎます。投資 ${updatedState.total_investment.toLocaleString()}円 で ` +
          `ランク改善 ${updatedState.rank_improvement} 位（効率: ${(roiEfficiency * 1000000).toFixed(2)}/100万円）`,
        investmentLimit: {
          current: updatedState.total_investment,
          limit: investmentLimits.effectiveLimit,
          utilization: investmentUtilization,
        },
      };
    }
  }

  // 4. 週次改善チェック（7日ごと）
  if (updatedState.current_day % 7 === 0 && updatedState.current_day >= 7) {
    const weeklyImprovement = calculateWeeklyRankImprovement(updatedState.rank_history);

    if (weeklyImprovement < exitConditions.min_rank_improvement_per_week) {
      updatedState.weeks_without_improvement++;

      if (updatedState.weeks_without_improvement >= exitConditions.stagnant_weeks_limit) {
        return {
          updatedState: { ...updatedState, phase: "abandoned" },
          action: "abandon",
          reason: `${exitConditions.stagnant_weeks_limit} 週連続でランク改善なし`,
          investmentLimit: {
            current: updatedState.total_investment,
            limit: investmentLimits.effectiveLimit,
            utilization: investmentUtilization,
          },
        };
      }
    } else {
      updatedState.weeks_without_improvement = 0;
    }
  }

  // 5. 目標達成チェック
  if (currentOrganicRank !== null && currentOrganicRank <= config.target_organic_rank) {
    // 投資回収期間を更新
    updatedState.roi_projection =
      estimatedOrganicValue > 0
        ? updatedState.total_investment / estimatedOrganicValue
        : 0;

    return {
      updatedState: { ...updatedState, phase: "completed" },
      action: "maintain",
      reason:
        `🎉 目標順位 ${config.target_organic_rank} 位達成！（現在 ${currentOrganicRank} 位）` +
        `投資総額 ${updatedState.total_investment.toLocaleString()}円、` +
        `回収見込み ${updatedState.roi_projection.toFixed(1)} ヶ月`,
      investmentLimit: {
        current: updatedState.total_investment,
        limit: investmentLimits.effectiveLimit,
        utilization: investmentUtilization,
      },
    };
  }

  // 6. フェーズ判定
  if (updatedState.current_day <= 14) {
    // 初期フェーズ（1-2週目）
    return {
      updatedState: { ...updatedState, phase: "initial" },
      action: "continue",
      reason: `初期フェーズ継続中。${limitWarning}`,
      investmentLimit: {
        current: updatedState.total_investment,
        limit: investmentLimits.effectiveLimit,
        utilization: investmentUtilization,
      },
    };
  } else if (updatedState.current_day <= 28 && updatedState.rank_improvement > 10) {
    // 加速フェーズ（効果あり）
    return {
      updatedState: { ...updatedState, phase: "acceleration" },
      action: "accelerate",
      reason: `ランク ${updatedState.rank_improvement} 位改善。加速投資を推奨。${limitWarning}`,
      investmentLimit: {
        current: updatedState.total_investment,
        limit: investmentLimits.effectiveLimit,
        utilization: investmentUtilization,
      },
    };
  } else if (updatedState.rank_improvement > 0) {
    // 維持フェーズ
    return {
      updatedState: { ...updatedState, phase: "maintenance" },
      action: "continue",
      reason: `緩やかに改善中（${updatedState.rank_improvement}位改善）。${limitWarning}`,
      investmentLimit: {
        current: updatedState.total_investment,
        limit: investmentLimits.effectiveLimit,
        utilization: investmentUtilization,
      },
    };
  } else {
    // 効果なし → 撤退検討
    return {
      updatedState: { ...updatedState, phase: "exit" },
      action: "exit",
      reason: `効果が見られません。撤退を検討してください。${limitWarning}`,
      investmentLimit: {
        current: updatedState.total_investment,
        limit: investmentLimits.effectiveLimit,
        utilization: investmentUtilization,
      },
    };
  }
}

/**
 * SEO投資時のACOS上限を計算
 * 通常の利益率ベース上限を超えた赤字を許容
 */
export function calculateSeoInvestmentAcosLimit(
  profitMargin: number,
  phase: SeoInvestmentState["phase"],
  config: SeoInvestmentConfig = DEFAULT_SEO_INVESTMENT_CONFIG
): number {
  // 通常上限 = 利益率
  const normalLimit = profitMargin;

  // フェーズ別の赤字許容率を取得
  let lossRatio: number;
  switch (phase) {
    case "initial":
      lossRatio = config.phase_loss_ratios.initial;
      break;
    case "acceleration":
      lossRatio = config.phase_loss_ratios.acceleration;
      break;
    case "maintenance":
      lossRatio = config.phase_loss_ratios.maintenance;
      break;
    case "exit":
      lossRatio = config.phase_loss_ratios.exit;
      break;
    default:
      lossRatio = 0;
  }

  // 赤字許容ACOS = 利益率 + (利益率 × 赤字許容率)
  // 例: 利益率30% + 30%×50% = 30% + 15% = 45%
  return normalLimit + normalLimit * lossRatio;
}

// =============================================================================
// ヘルパー関数
// =============================================================================

function createSkipRecommendation(
  keywordAnalysis: KeywordStrategyAnalysis,
  reason: string,
  riskFactors: string[]
): SeoInvestmentRecommendation {
  return {
    keyword: keywordAnalysis.keyword,
    search_volume: keywordAnalysis.search_volume,
    current_organic_rank: keywordAnalysis.current_organic_rank,
    target_organic_rank: 10,
    should_invest: false,
    recommended_phase: "skip",
    recommended_loss_ratio: 0,
    estimated_investment_needed: 0,
    estimated_payback_months: 0,
    organic_value_per_month: 0,
    risk_level: "low",
    risk_factors: riskFactors,
    recommendation_reason: reason,
  };
}

/**
 * オーガニック上位の月間価値を推定
 */
function estimateOrganicValue(
  searchVolume: number,
  targetRank: number,
  profitMargin: number,
  unitProfit: number
): number {
  // ランク別クリック率（概算）
  const ctrByRank: Record<number, number> = {
    1: 0.30,
    2: 0.15,
    3: 0.10,
    4: 0.07,
    5: 0.05,
    6: 0.04,
    7: 0.03,
    8: 0.025,
    9: 0.02,
    10: 0.015,
  };

  const estimatedCtr = ctrByRank[targetRank] || 0.01;
  const estimatedCvr = 0.05; // 5%コンバージョン想定

  // 月間オーガニック売上 = 検索ボリューム × CTR × CVR
  const monthlyOrganicOrders = searchVolume * estimatedCtr * estimatedCvr;

  // 月間オーガニック利益 = 注文数 × 1個あたり利益
  return monthlyOrganicOrders * unitProfit;
}

/**
 * 必要投資額を推定
 */
function estimateRequiredInvestment(
  currentRank: number | null,
  targetRank: number,
  searchVolume: number,
  competitorSov: number
): number {
  // ランク差
  const rankGap = (currentRank || 100) - targetRank;

  // 基本投資額 = ランク差 × 検索ボリューム係数 × 競合係数
  const baseInvestment = rankGap * (searchVolume / 100);
  const competitorMultiplier = 1 + competitorSov; // 競合が強いほど必要額増加

  // 1ランク改善に必要な推定広告費（円）
  const costPerRank = 5000;

  return baseInvestment * competitorMultiplier * costPerRank;
}

/**
 * 週次ランク改善を計算
 */
function calculateWeeklyRankImprovement(
  rankHistory: SeoInvestmentState["rank_history"]
): number {
  if (rankHistory.length < 7) return 0;

  const weekAgoIndex = rankHistory.length - 7;
  const weekAgoRank = rankHistory[weekAgoIndex].organic_rank;
  const currentRank = rankHistory[rankHistory.length - 1].organic_rank;

  if (weekAgoRank === null || currentRank === null) return 0;

  return weekAgoRank - currentRank; // 正の値 = 改善
}

/**
 * 推奨理由を構築
 */
function buildRecommendationReason(
  shouldInvest: boolean,
  keywordAnalysis: KeywordStrategyAnalysis,
  currentRank: number | null,
  targetRank: number,
  organicValue: number,
  paybackMonths: number,
  riskLevel: string,
  riskFactors: string[]
): string {
  if (!shouldInvest) {
    return `SEO投資非推奨。${riskFactors.join("、")}`;
  }

  const parts: string[] = [];

  parts.push(
    `【SEO投資推奨】「${keywordAnalysis.keyword}」（月間検索 ${keywordAnalysis.search_volume.toLocaleString()}）`
  );

  parts.push(
    `現在 ${currentRank ?? "圏外"} 位 → 目標 ${targetRank} 位`
  );

  parts.push(
    `オーガニック上位の月間価値: 約 ${Math.round(organicValue / 1000)}千円`
  );

  parts.push(
    `投資回収見込み: ${paybackMonths.toFixed(1)} ヶ月`
  );

  parts.push(`リスク: ${riskLevel}`);

  if (riskFactors.length > 0) {
    parts.push(`注意点: ${riskFactors.join("、")}`);
  }

  return parts.join("。");
}

/**
 * SEO投資戦略サマリーを生成
 */
export function generateSeoInvestmentSummary(
  recommendations: SeoInvestmentRecommendation[]
): {
  total_keywords_analyzed: number;
  investment_candidates: number;
  total_estimated_investment: number;
  total_expected_monthly_value: number;
  weighted_payback_months: number;
  by_risk_level: Record<string, number>;
  top_opportunities: SeoInvestmentRecommendation[];
} {
  const investCandidates = recommendations.filter((r) => r.should_invest);

  const byRiskLevel: Record<string, number> = {
    low: 0,
    medium: 0,
    high: 0,
    very_high: 0,
  };

  for (const r of recommendations) {
    byRiskLevel[r.risk_level]++;
  }

  const totalInvestment = investCandidates.reduce(
    (sum, r) => sum + r.estimated_investment_needed,
    0
  );

  const totalMonthlyValue = investCandidates.reduce(
    (sum, r) => sum + r.organic_value_per_month,
    0
  );

  const weightedPayback =
    totalMonthlyValue > 0 ? totalInvestment / totalMonthlyValue : 0;

  // 上位機会をソート（価値/投資比率で）
  const topOpportunities = [...investCandidates]
    .sort(
      (a, b) =>
        b.organic_value_per_month / (b.estimated_investment_needed || 1) -
        a.organic_value_per_month / (a.estimated_investment_needed || 1)
    )
    .slice(0, 10);

  logger.info("SEO investment summary generated", {
    total: recommendations.length,
    candidates: investCandidates.length,
    totalInvestment,
    totalMonthlyValue,
  });

  return {
    total_keywords_analyzed: recommendations.length,
    investment_candidates: investCandidates.length,
    total_estimated_investment: totalInvestment,
    total_expected_monthly_value: totalMonthlyValue,
    weighted_payback_months: weightedPayback,
    by_risk_level: byRiskLevel,
    top_opportunities: topOpportunities,
  };
}

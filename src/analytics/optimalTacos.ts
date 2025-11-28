/**
 * T_opt推定モジュール（利益最大化TACOS）
 *
 * ASIN単位で利益最大化TACSを推計し、ライフサイクルに応じた
 * TACOS目標値（T_launch, T_grow, T_harvest）を算出する。
 *
 * 主な機能:
 * 1. 過去データからT_opt（利益最大化TACOS）を推計
 * 2. ライフサイクル別TACOS目標値の算出
 *    - T_launch = min(g, T_opt × (1 + α_L))
 *    - T_grow = T_opt
 *    - T_harvest = max(0, T_opt × (1 - α_H))
 * 3. LaunchInvest_total（ローンチ投資額）の計算
 * 4. targetNetMargin_mid_product = g - T_opt
 *
 * 注意:
 * - g = marginPotential_product（広告費を除いた粗利率）
 * - 既存のtacosHealth.tsと連携して動作
 */

import { LifecycleState } from "../config/productConfigTypes";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 日次TAOSメトリクス（BigQueryから取得）
 */
export interface DailyTacosData {
  /** 日付 'YYYY-MM-DD' */
  date: string;
  /** 当日の売上（円） */
  revenue: number;
  /** 当日の広告費（円） */
  adSpend: number;
}

/**
 * T_opt推計設定
 */
export interface OptimalTacosConfig {
  /**
   * 商品のポテンシャル粗利率 g（広告費除外後）
   *
   * g = (売価 - 原価 - 手数料 - 配送費等) / 売価
   * 注意: 広告費は含めない（二重カウント防止）
   */
  marginPotential: number;

  /** TACOSをビン分けする幅（例: 0.03 = 3%刻み） */
  binWidth: number;

  /** 評価対象とするTACOSの下限（例: 0.02） */
  minTacos: number;

  /** 評価対象とするTACOSの上限（例: 0.60） */
  maxTacos: number;

  /** 1ビンあたり最低必要日数（例: 3） */
  minDaysPerBin: number;

  /** T_opt推計が失敗した場合のフォールバック値 */
  fallbackTopt: number;
}

/**
 * デフォルトのT_opt推計設定
 */
export const DEFAULT_OPTIMAL_TACOS_CONFIG: OptimalTacosConfig = {
  marginPotential: 0.55,
  binWidth: 0.03, // 3%刻み（より細かい推計）
  minTacos: 0.02,
  maxTacos: 0.60,
  minDaysPerBin: 3,
  fallbackTopt: 0.15,
};

/**
 * ライフサイクル別TACOS設定
 */
export interface LifecycleTacosConfig {
  /**
   * ローンチ投資期の攻めオフセット α_L
   * T_launch = min(g, T_opt × (1 + α_L))
   */
  alphaLaunch: number;

  /**
   * ハーベスト期の絞りオフセット α_H
   * T_harvest = max(0, T_opt × (1 - α_H))
   */
  alphaHarvest: number;

  /**
   * LAUNCH_HARDとLAUNCH_SOFTの区別
   * LAUNCH_HARD: alphaLaunch をそのまま適用
   * LAUNCH_SOFT: alphaLaunch × softFactor を適用
   */
  softFactor: number;
}

/**
 * デフォルトのライフサイクル別TACOS設定
 */
export const DEFAULT_LIFECYCLE_TACOS_CONFIG: LifecycleTacosConfig = {
  alphaLaunch: 0.30, // ローンチ期は+30%攻め
  alphaHarvest: 0.25, // ハーベスト期は-25%絞り
  softFactor: 0.5, // LAUNCH_SOFTはα_Lの50%
};

/**
 * T_opt推計結果
 */
export interface OptimalTacosResult {
  /** 推計されたT_opt（利益最大化TACOS） */
  tOpt: number;

  /** 推計の信頼度（HIGH/MEDIUM/LOW） */
  confidence: "HIGH" | "MEDIUM" | "LOW";

  /** フォールバック値を使用したか */
  usedFallback: boolean;

  /** 推計に使用した有効日数 */
  validDaysUsed: number;

  /** 有効なビン数 */
  validBinCount: number;

  /** 最適ビンの平均利益（円/日） */
  optimalBinProfit: number | null;

  /** 最適ビンの平均TACOS */
  optimalBinTacos: number | null;

  /** 計算詳細メモ */
  calculationNote: string;
}

/**
 * ライフサイクル別TACOS目標値
 */
export interface LifecycleTacosTargets {
  /** ローンチ期のTACOS目標: T_launch = min(g, T_opt × (1 + α_L)) */
  tLaunch: number;

  /** グロー期のTACOS目標: T_grow = T_opt */
  tGrow: number;

  /** ハーベスト期のTACOS目標: T_harvest = max(0, T_opt × (1 - α_H)) */
  tHarvest: number;

  /** 現在のライフサイクルに対応するTACOS目標 */
  currentTarget: number;

  /** 現在のライフサイクルステージ */
  currentStage: LifecycleState;

  /** 計算の元となったT_opt */
  tOpt: number;

  /** ポテンシャル粗利率 g */
  marginPotential: number;
}

/**
 * ローンチ投資計算結果
 */
export interface LaunchInvestmentMetrics {
  /** ローンチ期間の合計投資額: LaunchInvest_total */
  launchInvestTotal: number;

  /** ローンチ期間の合計売上 */
  launchSalesTotal: number;

  /** ローンチ期間のTACOS平均 */
  launchTacosAverage: number;

  /** グロー移行後の推定投資回収（推定利益） */
  estimatedRecoveryProfit: number | null;

  /** 投資回収に必要な推定売上 */
  estimatedRecoverySales: number | null;

  /** 計算詳細メモ */
  calculationNote: string;
}

/**
 * ASIN別TACOS最適化結果（統合）
 */
export interface AsinTacosOptimization {
  /** ASIN */
  asin: string;

  /** ポテンシャル粗利率 g */
  marginPotential: number;

  /** T_opt推計結果 */
  tOptResult: OptimalTacosResult;

  /** ライフサイクル別TACOS目標値 */
  lifecycleTargets: LifecycleTacosTargets;

  /** ターゲットネットマージン: g - T_opt */
  targetNetMarginMidProduct: number;

  /** ローンチ投資メトリクス（ローンチ期間データがある場合） */
  launchInvestment: LaunchInvestmentMetrics | null;
}

// =============================================================================
// TACOSビン型定義
// =============================================================================

interface TacosBin {
  lowerBound: number;
  upperBound: number;
  days: number;
  averageTacos: number;
  totalProfit: number;
  averageProfit: number;
  dailyData: Array<{ tacos: number; profit: number }>;
}

// =============================================================================
// T_opt推計関数
// =============================================================================

/**
 * 過去データからT_opt（利益最大化TACOS）を推計
 *
 * ロジック:
 * 1. 有効な日のみフィルタリング（revenue > 0, minTacos <= TACOS <= maxTacos）
 * 2. 各日の利益を計算: Profit = revenue × (g - TACOS)
 * 3. TACOSをビン分けして各ビンの合計利益を計算
 * 4. 合計利益が最大のビンの平均TACOSをT_optとして採用
 *
 * @param daily - 日次TACOSデータ配列
 * @param config - T_opt推計設定
 * @returns T_opt推計結果
 */
export function estimateTopt(
  daily: DailyTacosData[],
  config: OptimalTacosConfig = DEFAULT_OPTIMAL_TACOS_CONFIG
): OptimalTacosResult {
  // 1. 有効データのフィルタリング
  const validDays = daily.filter((d) => {
    if (d.revenue <= 0) return false;
    if (d.adSpend < 0) return false;
    const tacos = d.adSpend / d.revenue;
    return tacos >= config.minTacos && tacos <= config.maxTacos;
  });

  if (validDays.length === 0) {
    return {
      tOpt: config.fallbackTopt,
      confidence: "LOW",
      usedFallback: true,
      validDaysUsed: 0,
      validBinCount: 0,
      optimalBinProfit: null,
      optimalBinTacos: null,
      calculationNote:
        "有効なデータがありません（revenue > 0 かつ TACOS範囲内の日がない）。フォールバック値を使用。",
    };
  }

  // 2. 各日の利益を計算
  const dailyWithProfit = validDays.map((d) => {
    const tacos = d.adSpend / d.revenue;
    // Profit = revenue × (g - TACOS)
    const profit = d.revenue * (config.marginPotential - tacos);
    return { ...d, tacos, profit };
  });

  // 3. TACOSビン分け
  const bins = createTacosBins(dailyWithProfit, config);

  // 有効なビンをフィルタ
  const validBins = bins.filter((b) => b.days >= config.minDaysPerBin);

  if (validBins.length === 0) {
    return {
      tOpt: config.fallbackTopt,
      confidence: "LOW",
      usedFallback: true,
      validDaysUsed: validDays.length,
      validBinCount: 0,
      optimalBinProfit: null,
      optimalBinTacos: null,
      calculationNote: `有効なビンがありません（各ビンに最低${config.minDaysPerBin}日必要）。フォールバック値を使用。`,
    };
  }

  // 4. 合計利益が最大のビンを特定
  const optimalBin = validBins.reduce((best, current) =>
    current.totalProfit > best.totalProfit ? current : best
  );

  const tOpt = optimalBin.averageTacos;

  // 信頼度の判定
  const confidence = determineConfidence(validDays.length, validBins.length);

  return {
    tOpt,
    confidence,
    usedFallback: false,
    validDaysUsed: validDays.length,
    validBinCount: validBins.length,
    optimalBinProfit: optimalBin.averageProfit,
    optimalBinTacos: optimalBin.averageTacos,
    calculationNote: `${validDays.length}日のデータから${validBins.length}個の有効ビンを評価。最適ビン(${(optimalBin.lowerBound * 100).toFixed(0)}%〜${(optimalBin.upperBound * 100).toFixed(0)}%)の平均TACOS=${(tOpt * 100).toFixed(1)}%をT_optとして採用。`,
  };
}

/**
 * TACOSビンを作成
 */
function createTacosBins(
  dailyWithProfit: Array<{
    date: string;
    revenue: number;
    adSpend: number;
    tacos: number;
    profit: number;
  }>,
  config: OptimalTacosConfig
): TacosBin[] {
  const bins: TacosBin[] = [];

  for (
    let lower = config.minTacos;
    lower < config.maxTacos;
    lower += config.binWidth
  ) {
    const upper = Math.min(lower + config.binWidth, config.maxTacos);

    const daysInBin = dailyWithProfit.filter(
      (d) => d.tacos >= lower && d.tacos < upper
    );

    if (daysInBin.length === 0) continue;

    const totalProfit = daysInBin.reduce((sum, d) => sum + d.profit, 0);
    const averageProfit = totalProfit / daysInBin.length;
    const averageTacos =
      daysInBin.reduce((sum, d) => sum + d.tacos, 0) / daysInBin.length;

    bins.push({
      lowerBound: lower,
      upperBound: upper,
      days: daysInBin.length,
      averageTacos,
      totalProfit,
      averageProfit,
      dailyData: daysInBin.map((d) => ({ tacos: d.tacos, profit: d.profit })),
    });
  }

  return bins;
}

/**
 * 信頼度を判定
 */
function determineConfidence(
  validDays: number,
  validBins: number
): "HIGH" | "MEDIUM" | "LOW" {
  if (validDays >= 90 && validBins >= 5) {
    return "HIGH";
  }
  if (validDays >= 30 && validBins >= 3) {
    return "MEDIUM";
  }
  return "LOW";
}

// =============================================================================
// ライフサイクル別TACOS目標値計算
// =============================================================================

/**
 * ライフサイクル別TACOS目標値を計算
 *
 * 計算式:
 * - T_launch = min(g, T_opt × (1 + α_L))
 * - T_grow = T_opt
 * - T_harvest = max(0, T_opt × (1 - α_H))
 *
 * @param tOpt - 推計されたT_opt
 * @param marginPotential - ポテンシャル粗利率 g
 * @param currentStage - 現在のライフサイクルステージ
 * @param config - ライフサイクル別TACOS設定
 * @returns ライフサイクル別TACOS目標値
 */
export function calculateLifecycleTacosTargets(
  tOpt: number,
  marginPotential: number,
  currentStage: LifecycleState,
  config: LifecycleTacosConfig = DEFAULT_LIFECYCLE_TACOS_CONFIG
): LifecycleTacosTargets {
  // T_launch = min(g, T_opt × (1 + α_L))
  const tLaunch = Math.min(marginPotential, tOpt * (1 + config.alphaLaunch));

  // T_grow = T_opt
  const tGrow = tOpt;

  // T_harvest = max(0, T_opt × (1 - α_H))
  const tHarvest = Math.max(0, tOpt * (1 - config.alphaHarvest));

  // 現在のステージに対応する目標値を決定
  let currentTarget: number;
  switch (currentStage) {
    case "LAUNCH_HARD":
      currentTarget = tLaunch;
      break;
    case "LAUNCH_SOFT":
      // LAUNCH_SOFTは攻めを半分に
      currentTarget = Math.min(
        marginPotential,
        tOpt * (1 + config.alphaLaunch * config.softFactor)
      );
      break;
    case "GROW":
      currentTarget = tGrow;
      break;
    case "HARVEST":
      currentTarget = tHarvest;
      break;
    default:
      currentTarget = tGrow;
  }

  return {
    tLaunch,
    tGrow,
    tHarvest,
    currentTarget,
    currentStage,
    tOpt,
    marginPotential,
  };
}

// =============================================================================
// ローンチ投資計算
// =============================================================================

/**
 * ローンチ期間の投資メトリクスを計算
 *
 * 計算式:
 * LaunchInvest_total = Σ(S_d × (T_actual_d - T_opt))  [ローンチ期間の各日]
 *
 * @param launchPeriodData - ローンチ期間の日次データ
 * @param tOpt - 推計されたT_opt
 * @param marginPotential - ポテンシャル粗利率 g
 * @returns ローンチ投資メトリクス
 */
export function calculateLaunchInvestment(
  launchPeriodData: DailyTacosData[],
  tOpt: number,
  marginPotential: number
): LaunchInvestmentMetrics {
  if (launchPeriodData.length === 0) {
    return {
      launchInvestTotal: 0,
      launchSalesTotal: 0,
      launchTacosAverage: 0,
      estimatedRecoveryProfit: null,
      estimatedRecoverySales: null,
      calculationNote: "ローンチ期間データがありません。",
    };
  }

  // 有効データのフィルタリング
  const validData = launchPeriodData.filter((d) => d.revenue > 0);

  if (validData.length === 0) {
    return {
      launchInvestTotal: 0,
      launchSalesTotal: 0,
      launchTacosAverage: 0,
      estimatedRecoveryProfit: null,
      estimatedRecoverySales: null,
      calculationNote: "ローンチ期間中に有効な売上データがありません。",
    };
  }

  // 合計売上
  const launchSalesTotal = validData.reduce((sum, d) => sum + d.revenue, 0);

  // 合計広告費
  const launchAdSpendTotal = validData.reduce((sum, d) => sum + d.adSpend, 0);

  // 平均TACOS
  const launchTacosAverage = launchAdSpendTotal / launchSalesTotal;

  // LaunchInvest_total = Σ(S_d × (T_actual_d - T_opt))
  // = 合計広告費 - 合計売上 × T_opt
  // = launchSalesTotal × (launchTacosAverage - tOpt)
  const launchInvestTotal = launchSalesTotal * (launchTacosAverage - tOpt);

  // 投資回収に必要な売上の推定
  // netMargin = g - T_opt
  const netMargin = marginPotential - tOpt;

  let estimatedRecoverySales: number | null = null;
  let estimatedRecoveryProfit: number | null = null;

  if (netMargin > 0 && launchInvestTotal > 0) {
    // 投資回収に必要な売上 = LaunchInvest_total / netMargin
    estimatedRecoverySales = launchInvestTotal / netMargin;

    // その売上で得られる利益
    estimatedRecoveryProfit = launchInvestTotal;
  }

  return {
    launchInvestTotal: Math.max(0, launchInvestTotal), // 負の投資（利益）の場合は0
    launchSalesTotal,
    launchTacosAverage,
    estimatedRecoveryProfit,
    estimatedRecoverySales,
    calculationNote: `${validData.length}日のローンチデータから計算。売上合計=${launchSalesTotal.toFixed(0)}円、TACOS平均=${(launchTacosAverage * 100).toFixed(1)}%、T_opt比の追加投資=${launchInvestTotal.toFixed(0)}円`,
  };
}

// =============================================================================
// 統合関数
// =============================================================================

/**
 * ASIN別TACOS最適化を実行
 *
 * @param asin - ASIN
 * @param dailyData - 日次TACOSデータ（全期間）
 * @param currentStage - 現在のライフサイクルステージ
 * @param marginPotential - ポテンシャル粗利率 g
 * @param launchPeriodData - ローンチ期間の日次データ（オプション）
 * @param optimalConfig - T_opt推計設定
 * @param lifecycleConfig - ライフサイクル別TACOS設定
 * @returns ASIN別TACOS最適化結果
 */
export function optimizeAsinTacos(
  asin: string,
  dailyData: DailyTacosData[],
  currentStage: LifecycleState,
  marginPotential: number,
  launchPeriodData?: DailyTacosData[],
  optimalConfig: OptimalTacosConfig = DEFAULT_OPTIMAL_TACOS_CONFIG,
  lifecycleConfig: LifecycleTacosConfig = DEFAULT_LIFECYCLE_TACOS_CONFIG
): AsinTacosOptimization {
  // 設定のmarginPotentialを上書き
  const configWithMargin = {
    ...optimalConfig,
    marginPotential,
  };

  // T_opt推計
  const tOptResult = estimateTopt(dailyData, configWithMargin);

  // ライフサイクル別TACOS目標値
  const lifecycleTargets = calculateLifecycleTacosTargets(
    tOptResult.tOpt,
    marginPotential,
    currentStage,
    lifecycleConfig
  );

  // ターゲットネットマージン
  const targetNetMarginMidProduct = marginPotential - tOptResult.tOpt;

  // ローンチ投資メトリクス
  let launchInvestment: LaunchInvestmentMetrics | null = null;
  if (launchPeriodData && launchPeriodData.length > 0) {
    launchInvestment = calculateLaunchInvestment(
      launchPeriodData,
      tOptResult.tOpt,
      marginPotential
    );
  }

  return {
    asin,
    marginPotential,
    tOptResult,
    lifecycleTargets,
    targetNetMarginMidProduct,
    launchInvestment,
  };
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * ライフサイクルステージからTACOS目標値を取得
 *
 * @param targets - ライフサイクル別TACOS目標値
 * @param stage - ライフサイクルステージ
 * @returns 対応するTACOS目標値
 */
export function getTacosTargetForStage(
  targets: LifecycleTacosTargets,
  stage: LifecycleState
): number {
  switch (stage) {
    case "LAUNCH_HARD":
      return targets.tLaunch;
    case "LAUNCH_SOFT":
      // LAUNCH_SOFTは中間値（既にcurrentTargetで計算済み）
      return targets.currentStage === "LAUNCH_SOFT"
        ? targets.currentTarget
        : (targets.tLaunch + targets.tGrow) / 2;
    case "GROW":
      return targets.tGrow;
    case "HARVEST":
      return targets.tHarvest;
    default:
      return targets.tGrow;
  }
}

/**
 * ネットマージン（純利益率）を計算
 *
 * netMargin = g - T_opt
 *
 * @param marginPotential - ポテンシャル粗利率 g
 * @param tOpt - 推計されたT_opt
 * @returns ネットマージン
 */
export function calculateNetMargin(
  marginPotential: number,
  tOpt: number
): number {
  return marginPotential - tOpt;
}

/**
 * 日次利益を計算
 *
 * netProfit_d = sales_d × g - adCost_d
 *             = sales_d × (g - TACOS_d)
 *
 * @param sales - 売上
 * @param adCost - 広告費
 * @param marginPotential - ポテンシャル粗利率 g
 * @returns 日次利益
 */
export function calculateDailyNetProfit(
  sales: number,
  adCost: number,
  marginPotential: number
): number {
  if (sales <= 0) return 0;
  const tacos = adCost / sales;
  return sales * (marginPotential - tacos);
}

/**
 * 期間利益を計算
 *
 * @param data - 日次データ配列
 * @param marginPotential - ポテンシャル粗利率 g
 * @returns 期間利益
 */
export function calculatePeriodNetProfit(
  data: DailyTacosData[],
  marginPotential: number
): number {
  return data.reduce(
    (sum, d) => sum + calculateDailyNetProfit(d.revenue, d.adSpend, marginPotential),
    0
  );
}

/**
 * TACOS健全性モジュール
 *
 * TACOS（Total Advertising Cost of Sales）の最適値推計と健全性スコア計算を提供
 *
 * 主な機能:
 * 1. 過去の日次データからTACOS最適値（tacosTargetMidForControl）を推計
 * 2. 現在のTACOSと最適値を比較してtacosHealthScore (-1〜+1) を計算
 * 3. tacosHealthScoreに基づいてSTRONG_UP倍率を動的に調整
 * 4. TACOSゾーン（GREEN/ORANGE/RED）判定とゲートロジック
 *
 * 注意:
 * - LTVベースのtheoreticalMaxTacos（理論最大TACOS）は別途維持される
 * - このモジュールの「攻め上限」はtacosAggressiveCapとして定義
 * - 最終的なtacosMaxForControl = min(theoreticalMaxTacosCapped, tacosAggressiveCap)
 */

// =============================================================================
// 型定義
// =============================================================================

/**
 * 日次TACOSメトリクス（BigQueryから取得）
 */
export interface DailyTacosMetrics {
  /** 日付 'YYYY-MM-DD' */
  date: string;
  /** 当日の売上（円） */
  revenue: number;
  /** 当日の広告費（円） */
  adSpend: number;
}

/**
 * TACOS最適化設定
 */
export interface TacosOptimizationConfig {
  /** 商品のポテンシャル粗利率（基本的にmarginRateNormalと同じ値を渡す） */
  marginPotential: number;
  /** TACOSをビン分けする幅（例: 0.05 = 5%刻み） */
  binWidth: number;
  /** 評価対象とするTACOSの下限（例: 0.05） */
  minTacos: number;
  /** 評価対象とするTACOSの上限（例: 0.50） */
  maxTacos: number;
  /** 1ビンあたり最低必要日数（例: 3） */
  minDaysPerBin: number;
  /** 利益最大ビンからの攻め上限オフセット（例: 0.05〜0.07） */
  theoreticalMaxOffset: number;
}

/**
 * デフォルトのTACOS最適化設定
 */
export const DEFAULT_TACOS_OPTIMIZATION_CONFIG: TacosOptimizationConfig = {
  marginPotential: 0.55,
  binWidth: 0.05,
  minTacos: 0.05,
  maxTacos: 0.50,
  minDaysPerBin: 3,
  theoreticalMaxOffset: 0.06,
};

/**
 * TACOS最適化結果
 *
 * 注意: tacosAggressiveCapはLTVベースのtheoreticalMaxTacosとは別概念
 */
export interface TacosOptimizationResult {
  /** 利益最大化TACOS（見つからなければnull） */
  tacosTargetMid: number | null;
  /** tacosTargetMid + offset に相当する「攻め上限」（見つからなければnull） */
  tacosAggressiveCap: number | null;
  /** 利益最大ビンの中心TACOS */
  optimalBinCenter: number | null;
  /** 利益最大ビンの平均日次利益（円） */
  optimalBinProfit: number | null;
  /** 有効なビン数 */
  validBinCount: number;
  /** 評価に使用した日数 */
  totalDaysUsed: number;
  /** 計算詳細 */
  calculationNote: string;
}

/**
 * TACOSビンの集計結果
 */
interface TacosBin {
  /** ビンの下限TACOS */
  lowerBound: number;
  /** ビンの上限TACOS */
  upperBound: number;
  /** ビン内の日数 */
  days: number;
  /** ビン内の平均TACOS */
  averageTacos: number;
  /** ビン内の平均日次利益（円） */
  averageProfit: number;
  /** ビン内の日次データ */
  dailyData: Array<{ tacos: number; profit: number }>;
}

// =============================================================================
// TACOS最適値推計
// =============================================================================

/**
 * 過去の日次データからTACOS最適値を推計
 *
 * ロジック:
 * 1. 有効な日のみフィルタリング（revenue > 0, minTacos <= TACOS <= maxTacos）
 * 2. 各日の利益を計算: Profit = revenue × (marginPotential - TACOS)
 * 3. TACOSをビン分けして各ビンの平均利益を計算
 * 4. 平均利益が最大のビンを最適TACOSとして採用
 *
 * @param daily - 日次TACOSメトリクス配列
 * @param config - 最適化設定
 * @returns 最適化結果
 */
export function estimateOptimalTacos(
  daily: DailyTacosMetrics[],
  config: TacosOptimizationConfig = DEFAULT_TACOS_OPTIMIZATION_CONFIG
): TacosOptimizationResult {
  // 1. 有効データのフィルタリング
  const validDays = daily.filter((d) => {
    if (d.revenue <= 0) return false;
    if (d.adSpend < 0) return false;
    const tacos = d.adSpend / d.revenue;
    return tacos >= config.minTacos && tacos <= config.maxTacos;
  });

  if (validDays.length === 0) {
    return {
      tacosTargetMid: null,
      tacosAggressiveCap: null,
      optimalBinCenter: null,
      optimalBinProfit: null,
      validBinCount: 0,
      totalDaysUsed: 0,
      calculationNote: "有効なデータがありません（revenue > 0 かつ TACOS範囲内の日がない）",
    };
  }

  // 2. 各日の利益を計算
  const dailyWithProfit = validDays.map((d) => {
    const tacos = d.adSpend / d.revenue;
    // ポテンシャル粗利率を使った利益計算
    // Profit = revenue × (marginPotential - TACOS)
    const profit = d.revenue * (config.marginPotential - tacos);
    return { tacos, profit, revenue: d.revenue };
  });

  // 3. TACOSをビン分け
  const bins: TacosBin[] = [];
  for (let lower = config.minTacos; lower < config.maxTacos; lower += config.binWidth) {
    const upper = Math.min(lower + config.binWidth, config.maxTacos);
    const binData = dailyWithProfit.filter(
      (d) => d.tacos >= lower && d.tacos < upper
    );

    if (binData.length >= config.minDaysPerBin) {
      const avgTacos = binData.reduce((sum, d) => sum + d.tacos, 0) / binData.length;
      const avgProfit = binData.reduce((sum, d) => sum + d.profit, 0) / binData.length;

      bins.push({
        lowerBound: lower,
        upperBound: upper,
        days: binData.length,
        averageTacos: avgTacos,
        averageProfit: avgProfit,
        dailyData: binData.map((d) => ({ tacos: d.tacos, profit: d.profit })),
      });
    }
  }

  if (bins.length === 0) {
    return {
      tacosTargetMid: null,
      tacosAggressiveCap: null,
      optimalBinCenter: null,
      optimalBinProfit: null,
      validBinCount: 0,
      totalDaysUsed: validDays.length,
      calculationNote: `有効なビンがありません（各ビンに最低${config.minDaysPerBin}日必要）`,
    };
  }

  // 4. 利益最大ビンを選択
  const profitableBins = bins.filter((b) => b.averageProfit > 0);

  if (profitableBins.length === 0) {
    return {
      tacosTargetMid: null,
      tacosAggressiveCap: null,
      optimalBinCenter: null,
      optimalBinProfit: null,
      validBinCount: bins.length,
      totalDaysUsed: validDays.length,
      calculationNote: "全ビンの平均利益が0以下のため、明確な最適TACOS帯がありません",
    };
  }

  // 平均利益が最大のビンを選択
  const optimalBin = profitableBins.reduce((best, current) =>
    current.averageProfit > best.averageProfit ? current : best
  );

  const tacosTargetMid = optimalBin.averageTacos;
  const tacosAggressiveCap = tacosTargetMid + config.theoreticalMaxOffset;

  return {
    tacosTargetMid,
    tacosAggressiveCap,
    optimalBinCenter: optimalBin.averageTacos,
    optimalBinProfit: optimalBin.averageProfit,
    validBinCount: bins.length,
    totalDaysUsed: validDays.length,
    calculationNote: `最適TACOS帯: ${(optimalBin.lowerBound * 100).toFixed(0)}%〜${(optimalBin.upperBound * 100).toFixed(0)}%（${optimalBin.days}日分のデータ）`,
  };
}

// =============================================================================
// TACOSゾーン制御
// =============================================================================

/**
 * TACOSゾーン
 */
export type TacosZone = "GREEN" | "ORANGE" | "RED";

/**
 * TACOSゾーン制御コンテキスト
 *
 * 注意:
 * - tacosTargetMidForControl: 利益最大化推計 or ステージ別デフォルト
 * - tacosMaxForControl: min(theoreticalMaxTacosCapped, tacosAggressiveCap)
 */
export interface TacosZoneContext {
  /** 現在のTACOS（90日など） */
  currentTacos: number;
  /** 制御用の目標TACOS（利益最大化推計値 or デフォルト） */
  tacosTargetMidForControl: number;
  /** 制御用の上限TACOS（LTV上限とempirical上限の小さい方） */
  tacosMaxForControl: number;
}

/**
 * TACOSゾーン判定結果
 */
export interface TacosZoneResult {
  /** 判定されたゾーン */
  zone: TacosZone;
  /** TACOS乖離率: (tacosTargetMidForControl - currentTacos) / tacosTargetMidForControl */
  tacosDelta: number;
  /** コンテキスト */
  context: TacosZoneContext;
}

/**
 * TACOSゾーンを判定
 *
 * - GREEN: currentTacos <= tacosTargetMidForControl（健全）
 * - ORANGE: tacosTargetMidForControl < currentTacos <= tacosMaxForControl（注意）
 * - RED: currentTacos > tacosMaxForControl（危険）
 *
 * @param ctx - ゾーン判定コンテキスト
 * @returns ゾーン判定結果
 */
export function determineTacosZone(ctx: TacosZoneContext): TacosZoneResult {
  const { currentTacos, tacosTargetMidForControl, tacosMaxForControl } = ctx;

  // TACOS乖離率: 正なら余裕あり、負なら超過
  const epsilon = 0.0001;
  const tacosDelta = (tacosTargetMidForControl - currentTacos) / Math.max(tacosTargetMidForControl, epsilon);

  let zone: TacosZone;
  if (currentTacos <= tacosTargetMidForControl) {
    zone = "GREEN";
  } else if (currentTacos <= tacosMaxForControl) {
    zone = "ORANGE";
  } else {
    zone = "RED";
  }

  return {
    zone,
    tacosDelta,
    context: ctx,
  };
}

// =============================================================================
// TACOS健全性スコア
// =============================================================================

/**
 * TACOS健全性コンテキスト
 */
export interface TacosHealthContext {
  /** 直近90日のTACOS（売上が十分ある日のみで計算） */
  tacos90d: number | null;
  /** 制御用の目標TACOS（tacosTargetMidForControl） */
  tacosTargetMid: number;
  /** 制御用の上限TACOS（tacosMaxForControl） */
  tacosMax: number;
  /** tacosTargetMidよりどのくらい低ければ「超健康」判定か（例: 0.06〜0.08） */
  lowMargin: number;
}

/**
 * TACOS健全性スコア結果
 */
export interface TacosHealthResult {
  /** 健全性スコア（-1〜+1） */
  score: number;
  /** スコア区分 */
  healthZone: "EXCELLENT" | "HEALTHY" | "NEUTRAL" | "WARNING" | "CRITICAL";
  /** TACOSゾーン（GREEN/ORANGE/RED） */
  tacosZone: TacosZone;
  /** 境界値 */
  boundaries: {
    tacosLow: number;
    tacosMid: number;
    tacosHigh: number;
  };
  /** 計算詳細 */
  calculationNote: string;
}

/**
 * デフォルトの lowMargin 値
 */
export const DEFAULT_LOW_MARGIN = 0.07;

/**
 * TACOS健全性スコアを計算
 *
 * スコアリング:
 * - tacos90d <= tacosLow: score = +1（超健康）
 * - tacos90d >= tacosHigh: score = -1（危険）
 * - tacosLow < tacos90d <= tacosMid: [1, 0] に線形マッピング
 * - tacosMid < tacos90d < tacosHigh: [0, -1] に線形マッピング
 *
 * @param ctx - TACOS健全性コンテキスト
 * @returns 健全性スコア結果
 */
export function computeTacosHealthScore(
  ctx: TacosHealthContext
): TacosHealthResult {
  const { tacos90d, tacosTargetMid, tacosMax, lowMargin } = ctx;

  // 境界値の計算
  const tacosLow = Math.max(0, tacosTargetMid - lowMargin);
  const tacosMid = tacosTargetMid;
  const tacosHigh = tacosMax;

  // 無効データの場合はニュートラル
  if (
    tacos90d === null ||
    tacos90d <= 0 ||
    tacosTargetMid <= 0 ||
    tacosMax <= 0 ||
    tacosTargetMid >= tacosMax
  ) {
    return {
      score: 0,
      healthZone: "NEUTRAL",
      tacosZone: "GREEN",
      boundaries: { tacosLow, tacosMid, tacosHigh },
      calculationNote: "無効なデータまたは設定のため、ニュートラル（0）を返します",
    };
  }

  // TACOSゾーン判定
  let tacosZone: TacosZone;
  if (tacos90d <= tacosMid) {
    tacosZone = "GREEN";
  } else if (tacos90d <= tacosHigh) {
    tacosZone = "ORANGE";
  } else {
    tacosZone = "RED";
  }

  let score: number;
  let healthZone: TacosHealthResult["healthZone"];
  let note: string;

  if (tacos90d <= tacosLow) {
    // 超健康: tacosLow以下
    score = 1;
    healthZone = "EXCELLENT";
    note = `TACOS ${(tacos90d * 100).toFixed(1)}% は下限 ${(tacosLow * 100).toFixed(1)}% 以下（超健康）`;
  } else if (tacos90d >= tacosHigh) {
    // 危険: tacosHigh以上
    score = -1;
    healthZone = "CRITICAL";
    note = `TACOS ${(tacos90d * 100).toFixed(1)}% は上限 ${(tacosHigh * 100).toFixed(1)}% 以上（危険）`;
  } else if (tacos90d <= tacosMid) {
    // 健康〜ニュートラル: [tacosLow, tacosMid] → [1, 0]
    score = 1 - (tacos90d - tacosLow) / (tacosMid - tacosLow);
    healthZone = score >= 0.5 ? "HEALTHY" : "NEUTRAL";
    note = `TACOS ${(tacos90d * 100).toFixed(1)}% は目標 ${(tacosMid * 100).toFixed(1)}% 以下（${healthZone === "HEALTHY" ? "健康" : "ニュートラル"}）`;
  } else {
    // 警告〜危険: [tacosMid, tacosHigh] → [0, -1]
    score = 0 - (tacos90d - tacosMid) / (tacosHigh - tacosMid);
    healthZone = score >= -0.5 ? "WARNING" : "CRITICAL";
    note = `TACOS ${(tacos90d * 100).toFixed(1)}% は目標 ${(tacosMid * 100).toFixed(1)}% を超過（${healthZone === "WARNING" ? "警告" : "危険"}）`;
  }

  // スコアを[-1, 1]にクランプ
  score = Math.max(-1, Math.min(1, score));

  return {
    score,
    healthZone,
    tacosZone,
    boundaries: { tacosLow, tacosMid, tacosHigh },
    calculationNote: note,
  };
}

// =============================================================================
// STRONG_UP倍率計算とゲートロジック
// =============================================================================

/**
 * STRONG_UP倍率設定
 */
export interface StrongUpMultiplierConfig {
  /** 基本倍率（score=0のとき） */
  baseMultiplier: number;
  /** スコア感度係数（0〜1） */
  alpha: number;
  /** 最小倍率（score=-1でもこれ以上） */
  minMultiplier: number;
  /** 最大倍率（score=+1でもこれ以下） */
  maxMultiplier: number;
  /** ORANGEゾーンでの上限倍率 */
  orangeZoneMaxMultiplier: number;
}

/**
 * デフォルトのSTRONG_UP倍率設定
 */
export const DEFAULT_STRONG_UP_MULTIPLIER_CONFIG: StrongUpMultiplierConfig = {
  baseMultiplier: 1.3,
  alpha: 0.5,
  minMultiplier: 1.0,
  maxMultiplier: 1.95,
  orangeZoneMaxMultiplier: 1.3,
};

/**
 * TACOS健全性スコアからSTRONG_UP倍率を計算
 *
 * 計算式:
 * raw = baseMultiplier × (1 + alpha × clampedScore)
 * multiplier = clamp(raw, minMultiplier, maxMultiplier)
 *
 * 結果:
 * - score = +1 → 1.3 × 1.5 = 1.95倍（最大増額）
 * - score = 0  → 1.3 × 1.0 = 1.30倍（標準）
 * - score = -1 → 1.3 × 0.5 = 0.65 → 1.0倍（実質STRONG_UP無効）
 *
 * @param tacosHealthScore - TACOS健全性スコア（-1〜+1）
 * @param config - 倍率設定
 * @returns STRONG_UP倍率
 */
export function computeStrongUpMultiplierFromTacosHealth(
  tacosHealthScore: number,
  config: StrongUpMultiplierConfig = DEFAULT_STRONG_UP_MULTIPLIER_CONFIG
): number {
  const { baseMultiplier, alpha, minMultiplier, maxMultiplier } = config;

  // スコアを[-1, 1]にクランプ
  const clampedScore = Math.max(-1, Math.min(1, tacosHealthScore));

  // 倍率計算
  const raw = baseMultiplier * (1 + alpha * clampedScore);

  // 結果を[minMultiplier, maxMultiplier]にクランプ
  const multiplier = Math.min(maxMultiplier, Math.max(minMultiplier, raw));

  return multiplier;
}

/**
 * STRONG_UP倍率計算結果（詳細情報付き）
 */
export interface StrongUpMultiplierResult {
  /** 計算された倍率 */
  multiplier: number;
  /** 入力されたTACOS健全性スコア */
  inputScore: number;
  /** クランプ後のスコア */
  clampedScore: number;
  /** 生の計算値（クランプ前） */
  rawMultiplier: number;
  /** 使用した設定 */
  config: StrongUpMultiplierConfig;
  /** 倍率が最小/最大にクランプされたか */
  wasClamped: boolean;
}

/**
 * TACOS健全性スコアからSTRONG_UP倍率を計算（詳細情報付き）
 *
 * @param tacosHealthScore - TACOS健全性スコア（-1〜+1）
 * @param config - 倍率設定
 * @returns 倍率と詳細情報
 */
export function computeStrongUpMultiplierWithDetails(
  tacosHealthScore: number,
  config: StrongUpMultiplierConfig = DEFAULT_STRONG_UP_MULTIPLIER_CONFIG
): StrongUpMultiplierResult {
  const { baseMultiplier, alpha, minMultiplier, maxMultiplier } = config;

  const clampedScore = Math.max(-1, Math.min(1, tacosHealthScore));
  const rawMultiplier = baseMultiplier * (1 + alpha * clampedScore);
  const multiplier = Math.min(maxMultiplier, Math.max(minMultiplier, rawMultiplier));

  return {
    multiplier,
    inputScore: tacosHealthScore,
    clampedScore,
    rawMultiplier,
    config,
    wasClamped: rawMultiplier !== multiplier,
  };
}

/**
 * STRONG_UPゲート入力
 */
export interface StrongUpGateInput {
  /** TACOS健全性スコア */
  tacosHealthScore: number;
  /** TACOSゾーン */
  tacosZone: TacosZone;
  /** 現在のproductBidMultiplier（ASIN レベル引き締め係数） */
  productBidMultiplier?: number;
}

/**
 * STRONG_UPゲート結果
 */
export interface StrongUpGateResult {
  /** ゲート通過後の最終倍率 */
  finalMultiplier: number;
  /** ゲートが適用されたか */
  gateApplied: boolean;
  /** ゲート理由 */
  gateReason: string | null;
  /** 元の計算倍率（ゲート前） */
  originalMultiplier: number;
  /** TACOSゾーン */
  tacosZone: TacosZone;
}

/**
 * STRONG_UP倍率にゲートロジックを適用
 *
 * ゲートルール:
 * - REDゾーン: multiplier = 1.0（STRONG_UP無効化）
 * - ORANGEゾーン: multiplier = min(multiplier, orangeZoneMaxMultiplier)
 * - productBidMultiplier < 1.0: multiplier = min(multiplier, orangeZoneMaxMultiplier)
 *
 * @param input - ゲート入力
 * @param config - 倍率設定
 * @returns ゲート結果
 */
export function applyStrongUpGate(
  input: StrongUpGateInput,
  config: StrongUpMultiplierConfig = DEFAULT_STRONG_UP_MULTIPLIER_CONFIG
): StrongUpGateResult {
  const { tacosHealthScore, tacosZone, productBidMultiplier } = input;

  // 元の倍率を計算
  const originalMultiplier = computeStrongUpMultiplierFromTacosHealth(tacosHealthScore, config);

  let finalMultiplier = originalMultiplier;
  let gateApplied = false;
  let gateReason: string | null = null;

  // REDゾーン: STRONG_UP完全無効化
  if (tacosZone === "RED") {
    finalMultiplier = config.minMultiplier;
    gateApplied = true;
    gateReason = "REDゾーンのためSTRONG_UP無効化";
  }
  // ORANGEゾーン: 倍率を上限クランプ
  else if (tacosZone === "ORANGE") {
    if (originalMultiplier > config.orangeZoneMaxMultiplier) {
      finalMultiplier = config.orangeZoneMaxMultiplier;
      gateApplied = true;
      gateReason = `ORANGEゾーンのため倍率を${config.orangeZoneMaxMultiplier}に制限`;
    }
  }

  // productBidMultiplier < 1.0 の場合も制限
  if (productBidMultiplier !== undefined && productBidMultiplier < 1.0) {
    if (finalMultiplier > config.orangeZoneMaxMultiplier) {
      finalMultiplier = config.orangeZoneMaxMultiplier;
      gateApplied = true;
      gateReason = gateReason
        ? `${gateReason}、かつproductBidMultiplierが引き締め中`
        : `productBidMultiplierが${productBidMultiplier.toFixed(2)}で引き締め中のため倍率制限`;
    }
  }

  return {
    finalMultiplier,
    gateApplied,
    gateReason,
    originalMultiplier,
    tacosZone,
  };
}

// =============================================================================
// 90日TACOS計算
// =============================================================================

/**
 * 日次データから90日TACOSを計算
 *
 * @param daily - 日次TACOSメトリクス配列（直近90日分）
 * @param minRevenuePerDay - 有効日とする最小売上（デフォルト: 0）
 * @returns 90日TACOS（有効日がない場合はnull）
 */
export function calculateTacos90d(
  daily: DailyTacosMetrics[],
  minRevenuePerDay: number = 0
): number | null {
  // 有効な日のみフィルタリング
  const validDays = daily.filter((d) => d.revenue > minRevenuePerDay);

  if (validDays.length === 0) {
    return null;
  }

  const totalRevenue = validDays.reduce((sum, d) => sum + d.revenue, 0);
  const totalAdSpend = validDays.reduce((sum, d) => sum + d.adSpend, 0);

  if (totalRevenue <= 0) {
    return null;
  }

  return totalAdSpend / totalRevenue;
}

// =============================================================================
// ProductTacosConfig
// =============================================================================

/**
 * 商品別TACOS設定
 */
export interface ProductTacosConfig {
  /** 商品のポテンシャル粗利率（基本的にmarginRateNormalと同じ） */
  marginPotential: number;
  /** フォールバック用のデフォルトtacosTargetMid */
  tacosTargetMidDefault: number;
  /** フォールバック用のデフォルトtacosAggressiveCap */
  tacosAggressiveCapDefault: number;
  /** TACOSビン幅 */
  tacosBinWidth: number;
  /** TACOS評価範囲の下限 */
  tacosMin: number;
  /** TACOS評価範囲の上限 */
  tacosMax: number;
  /** ビンあたり最低日数 */
  minDaysPerBin: number;
  /** tacosAggressiveCap = tacosTargetMid + offset */
  theoreticalMaxOffset: number;
  /** tacosHealthScore計算用のlowMargin */
  lowMargin: number;
}

/**
 * プロファイル別デフォルトProductTacosConfig
 */
export const PRODUCT_TACOS_CONFIG_DEFAULTS: Record<string, ProductTacosConfig> = {
  SUPPLEMENT_HIGH_LTV: {
    marginPotential: 0.55,
    tacosTargetMidDefault: 0.18,
    tacosAggressiveCapDefault: 0.25,
    tacosBinWidth: 0.05,
    tacosMin: 0.05,
    tacosMax: 0.50,
    minDaysPerBin: 3,
    theoreticalMaxOffset: 0.07,
    lowMargin: 0.08,
  },
  SUPPLEMENT_NORMAL: {
    marginPotential: 0.50,
    tacosTargetMidDefault: 0.15,
    tacosAggressiveCapDefault: 0.21,
    tacosBinWidth: 0.05,
    tacosMin: 0.05,
    tacosMax: 0.45,
    minDaysPerBin: 3,
    theoreticalMaxOffset: 0.06,
    lowMargin: 0.06,
  },
  LOW_LTV_SUPPLEMENT: {
    marginPotential: 0.45,
    tacosTargetMidDefault: 0.12,
    tacosAggressiveCapDefault: 0.17,
    tacosBinWidth: 0.05,
    tacosMin: 0.05,
    tacosMax: 0.40,
    minDaysPerBin: 3,
    theoreticalMaxOffset: 0.05,
    lowMargin: 0.05,
  },
};

/**
 * デフォルトのProductTacosConfig
 */
export const DEFAULT_PRODUCT_TACOS_CONFIG: ProductTacosConfig = PRODUCT_TACOS_CONFIG_DEFAULTS.SUPPLEMENT_NORMAL;

/**
 * プロファイルに対応するProductTacosConfigを取得
 *
 * @param profile - 商品プロファイル名
 * @returns ProductTacosConfig
 */
export function getProductTacosConfigForProfile(profile?: string): ProductTacosConfig {
  if (!profile) {
    return DEFAULT_PRODUCT_TACOS_CONFIG;
  }
  return PRODUCT_TACOS_CONFIG_DEFAULTS[profile] ?? DEFAULT_PRODUCT_TACOS_CONFIG;
}

// =============================================================================
// tacosMaxForControl計算
// =============================================================================

/**
 * tacosMaxForControl計算入力
 */
export interface TacosMaxForControlInput {
  /** LTVベースのtheoreticalMaxTacos（キャップ適用後） */
  theoreticalMaxTacosCapped: number;
  /** empirical推計のtacosAggressiveCap（nullの場合はデフォルト使用） */
  empiricalAggressiveCap: number | null;
  /** フォールバック用のデフォルトtacosAggressiveCap */
  tacosAggressiveCapDefault: number;
}

/**
 * tacosMaxForControl計算結果
 */
export interface TacosMaxForControlResult {
  /** 制御用の上限TACOS */
  tacosMaxForControl: number;
  /** 使用されたempirical攻め上限 */
  effectiveAggressiveCap: number;
  /** 値の出所 */
  source: "EMPIRICAL" | "DEFAULT";
  /** LTVキャップが適用されたか */
  ltvCapApplied: boolean;
}

/**
 * tacosMaxForControlを計算
 *
 * tacosMaxForControl = min(theoreticalMaxTacosCapped, effectiveAggressiveCap)
 *
 * @param input - 計算入力
 * @returns 計算結果
 */
export function calculateTacosMaxForControl(
  input: TacosMaxForControlInput
): TacosMaxForControlResult {
  const { theoreticalMaxTacosCapped, empiricalAggressiveCap, tacosAggressiveCapDefault } = input;

  // effectiveAggressiveCapを決定
  const source = empiricalAggressiveCap !== null ? "EMPIRICAL" : "DEFAULT";
  const effectiveAggressiveCap = empiricalAggressiveCap ?? tacosAggressiveCapDefault;

  // tacosMaxForControl = min(LTV上限, empirical上限)
  const tacosMaxForControl = Math.min(theoreticalMaxTacosCapped, effectiveAggressiveCap);
  const ltvCapApplied = theoreticalMaxTacosCapped < effectiveAggressiveCap;

  return {
    tacosMaxForControl,
    effectiveAggressiveCap,
    source,
    ltvCapApplied,
  };
}

// =============================================================================
// 統合関数
// =============================================================================

/**
 * TACOS健全性評価の完全な入力
 */
export interface TacosHealthEvaluationInput {
  /** 日次TACOSメトリクス（直近90日分） */
  dailyMetrics90d: DailyTacosMetrics[];
  /** LTVベースのtheoreticalMaxTacos（キャップ適用後） */
  theoreticalMaxTacosCapped: number;
  /** 商品プロファイル */
  productProfile?: string;
  /** カスタムProductTacosConfig（指定した場合はprofileより優先） */
  customConfig?: Partial<ProductTacosConfig>;
  /** 現在のproductBidMultiplier（STRONG_UPゲート用） */
  productBidMultiplier?: number;
}

/**
 * TACOS健全性評価の完全な結果
 */
export interface TacosHealthEvaluationResult {
  /** TACOS最適化結果 */
  optimization: TacosOptimizationResult;
  /** 制御用の目標TACOS（推計値またはデフォルト） */
  tacosTargetMidForControl: number;
  /** 制御用の上限TACOS（LTV上限とempirical上限の小さい方） */
  tacosMaxForControl: number;
  /** tacosMaxForControl計算詳細 */
  tacosMaxForControlDetails: TacosMaxForControlResult;
  /** 90日TACOS */
  tacos90d: number | null;
  /** TACOS健全性スコア */
  healthScore: TacosHealthResult;
  /** STRONG_UP倍率（ゲート適用後） */
  strongUpMultiplier: StrongUpGateResult;
  /** 使用した設定 */
  config: ProductTacosConfig;
  /** tacosTargetMidの出所 */
  tacosTargetMidSource: "ESTIMATED" | "DEFAULT";
}

/**
 * TACOS健全性を総合評価
 *
 * 1. 日次データからTACOS最適値を推計
 * 2. 推計失敗時はデフォルト値を使用
 * 3. tacosMaxForControl = min(theoreticalMaxTacosCapped, tacosAggressiveCap)
 * 4. 90日TACOSを計算
 * 5. 健全性スコアを計算
 * 6. STRONG_UP倍率を算出（ゲートロジック適用）
 *
 * @param input - 評価入力
 * @returns 評価結果
 */
export function evaluateTacosHealth(
  input: TacosHealthEvaluationInput
): TacosHealthEvaluationResult {
  const { dailyMetrics90d, theoreticalMaxTacosCapped, productProfile, customConfig, productBidMultiplier } = input;

  // 設定の決定
  const baseConfig = getProductTacosConfigForProfile(productProfile);
  const config: ProductTacosConfig = {
    ...baseConfig,
    ...customConfig,
  };

  // TACOS最適化設定
  const optimizationConfig: TacosOptimizationConfig = {
    marginPotential: config.marginPotential,
    binWidth: config.tacosBinWidth,
    minTacos: config.tacosMin,
    maxTacos: config.tacosMax,
    minDaysPerBin: config.minDaysPerBin,
    theoreticalMaxOffset: config.theoreticalMaxOffset,
  };

  // 最適TACOS推計
  const optimization = estimateOptimalTacos(dailyMetrics90d, optimizationConfig);

  // tacosTargetMidForControlを決定
  const tacosTargetMidSource = optimization.tacosTargetMid !== null ? "ESTIMATED" : "DEFAULT";
  const tacosTargetMidForControl = optimization.tacosTargetMid ?? config.tacosTargetMidDefault;

  // tacosMaxForControlを決定
  const tacosMaxForControlDetails = calculateTacosMaxForControl({
    theoreticalMaxTacosCapped,
    empiricalAggressiveCap: optimization.tacosAggressiveCap,
    tacosAggressiveCapDefault: config.tacosAggressiveCapDefault,
  });
  const tacosMaxForControl = tacosMaxForControlDetails.tacosMaxForControl;

  // 90日TACOS計算
  const tacos90d = calculateTacos90d(dailyMetrics90d);

  // 健全性スコア計算
  const healthScore = computeTacosHealthScore({
    tacos90d,
    tacosTargetMid: tacosTargetMidForControl,
    tacosMax: tacosMaxForControl,
    lowMargin: config.lowMargin,
  });

  // STRONG_UP倍率計算（ゲート適用）
  const strongUpMultiplier = applyStrongUpGate({
    tacosHealthScore: healthScore.score,
    tacosZone: healthScore.tacosZone,
    productBidMultiplier,
  });

  return {
    optimization,
    tacosTargetMidForControl,
    tacosMaxForControl,
    tacosMaxForControlDetails,
    tacos90d,
    healthScore,
    strongUpMultiplier,
    config,
    tacosTargetMidSource,
  };
}

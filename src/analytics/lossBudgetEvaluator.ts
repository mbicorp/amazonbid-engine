/**
 * ASIN投資健全性評価モジュール (lossBudgetEvaluator)
 *
 * ASIN×期間ごとに「ターゲット利益と実績利益のギャップ」を管理し、
 * ライフサイクル別のlossBudget閾値を用いてInvestmentStateを判定する。
 *
 * 主な機能:
 * 1. profitGap = targetNetProfit - actualNetProfit の計算
 * 2. lossBudget_stage = targetNetProfit × lossBudgetMultiple_stage
 * 3. ratio_stage = profitGap / lossBudget_stage
 * 4. InvestmentState (SAFE/WATCH/LIMIT/BREACH) の判定
 * 5. LifecycleStage × InvestmentState によるアクション制御
 *
 * 数式:
 * - targetNetProfit = S × (g - T_opt)
 * - actualNetProfit = S × g - A
 * - profitGap = targetNetProfit - actualNetProfit = A - S × T_opt
 */

import { LifecycleState } from "../config/productConfigTypes";

// =============================================================================
// 投資状態の列挙型
// =============================================================================

/**
 * ASIN単位の投資状態
 *
 * - SAFE: 健全（利益ギャップがlossBudgetの50%未満）
 * - WATCH: 注意（利益ギャップがlossBudgetの50-80%）
 * - LIMIT: 制限（利益ギャップがlossBudgetの80-100%）
 * - BREACH: 超過（利益ギャップがlossBudgetを超過）
 */
export enum InvestmentState {
  SAFE = "SAFE",
  WATCH = "WATCH",
  LIMIT = "LIMIT",
  BREACH = "BREACH",
}

// =============================================================================
// 型定義
// =============================================================================

/**
 * ASINごとの期間パフォーマンス（BigQueryから取得）
 */
export interface AsinPeriodPerformance {
  /** ASIN */
  asin: string;
  /** 評価期間開始日 ISO日付 */
  periodStart: string;
  /** 評価期間終了日 ISO日付 */
  periodEnd: string;
  /** 売上額 S */
  sales: number;
  /** 広告費 A */
  adCost: number;
  /** 現在のライフサイクルステージ */
  lifecycleStage: LifecycleState;
}

/**
 * ライフサイクル別lossBudget倍率設定
 */
export interface LifecycleLossBudgetMultiples {
  /** LAUNCH_HARD期の倍率 */
  LAUNCH_HARD: number;
  /** LAUNCH_SOFT期の倍率 */
  LAUNCH_SOFT: number;
  /** GROW期の倍率 */
  GROW: number;
  /** HARVEST期の倍率 */
  HARVEST: number;
}

/**
 * lossBudget評価用の設定
 */
export interface LossBudgetConfig {
  /** 評価期間の日数（例: 30日ローリング） */
  evaluationWindowDays: number;

  /** ライフサイクル別lossBudget倍率 */
  lossBudgetMultiples: LifecycleLossBudgetMultiples;

  /** SAFE判定閾値（ratio_stage < threshold） */
  thresholdSafe: number;

  /** WATCH判定閾値（thresholdSafe <= ratio_stage < thresholdWatch） */
  thresholdWatch: number;

  /**
   * LIMIT判定（thresholdWatch <= ratio_stage <= 1.0）
   * BREACH判定（ratio_stage > 1.0）
   */
}

/**
 * デフォルトのlossBudget設定
 */
export const DEFAULT_LOSS_BUDGET_CONFIG: LossBudgetConfig = {
  evaluationWindowDays: 30,
  lossBudgetMultiples: {
    LAUNCH_HARD: 2.5, // ローンチ期は大きな投資を許容
    LAUNCH_SOFT: 2.0, // ソフトローンチは少し控えめ
    GROW: 1.5, // 成長期は中程度
    HARVEST: 0.8, // 回収期は厳格
  },
  thresholdSafe: 0.5, // 50%未満ならSAFE
  thresholdWatch: 0.8, // 80%未満ならWATCH
};

/**
 * ASIN単位のlossBudget評価結果
 */
export interface AsinLossBudgetMetrics {
  /** ASIN */
  asin: string;
  /** ライフサイクルステージ */
  lifecycleStage: LifecycleState;
  /** ポテンシャル粗利率 g */
  g: number;
  /** 利益最大化TACOS T_opt */
  tOpt: number;
  /** 売上 S */
  sales: number;
  /** 広告費 A */
  adCost: number;

  /** 中長期ターゲットネット利益率 n_mid = g - T_opt */
  targetNetMarginMid: number;
  /** ターゲットネット利益 = S × (g - T_opt) */
  targetNetProfit: number;
  /** 実績ネット利益 = S × g - A */
  actualNetProfit: number;
  /** 利益ギャップ = targetNetProfit - actualNetProfit */
  profitGap: number;

  /** ステージ別lossBudget倍率 */
  lossBudgetMultiple: number;
  /** ステージ別lossBudget = targetNetProfit × lossBudgetMultiple */
  lossBudgetStage: number;
  /** 利益ギャップ比率 = profitGap / lossBudgetStage */
  ratioStage: number;
  /** 投資状態 */
  investmentState: InvestmentState;

  /** 評価期間開始日 */
  periodStart: string;
  /** 評価期間終了日 */
  periodEnd: string;
  /** 計算詳細メモ */
  calculationNote: string;
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ライフサイクルステージに対応するlossBudget倍率を取得
 */
export function getLossBudgetMultiple(
  lifecycleStage: LifecycleState,
  config: LossBudgetConfig
): number {
  switch (lifecycleStage) {
    case "LAUNCH_HARD":
      return config.lossBudgetMultiples.LAUNCH_HARD;
    case "LAUNCH_SOFT":
      return config.lossBudgetMultiples.LAUNCH_SOFT;
    case "GROW":
      return config.lossBudgetMultiples.GROW;
    case "HARVEST":
      return config.lossBudgetMultiples.HARVEST;
    default:
      return config.lossBudgetMultiples.GROW;
  }
}

/**
 * ratio_stageからInvestmentStateを判定
 */
export function determineInvestmentState(
  ratioStage: number,
  config: LossBudgetConfig
): InvestmentState {
  if (ratioStage < config.thresholdSafe) {
    return InvestmentState.SAFE;
  }
  if (ratioStage < config.thresholdWatch) {
    return InvestmentState.WATCH;
  }
  if (ratioStage <= 1.0) {
    return InvestmentState.LIMIT;
  }
  return InvestmentState.BREACH;
}

// =============================================================================
// メイン評価関数
// =============================================================================

/**
 * ASIN×期間のlossBudget評価を実行
 *
 * 計算式:
 * - targetNetMarginMid = g - T_opt
 * - targetNetProfit = S × targetNetMarginMid
 * - actualNetProfit = S × g - A
 * - profitGap = targetNetProfit - actualNetProfit
 * - lossBudgetStage = targetNetProfit × lossBudgetMultiple_stage
 * - ratioStage = profitGap / lossBudgetStage
 *
 * @param perf - ASIN期間パフォーマンスデータ
 * @param g - ポテンシャル粗利率（marginPotential）
 * @param tOpt - 利益最大化TACOS
 * @param config - lossBudget評価設定
 * @returns ASIN lossBudget評価結果
 */
export function evaluateAsinLossBudget(
  perf: AsinPeriodPerformance,
  g: number,
  tOpt: number,
  config: LossBudgetConfig = DEFAULT_LOSS_BUDGET_CONFIG
): AsinLossBudgetMetrics {
  const { asin, sales, adCost, lifecycleStage, periodStart, periodEnd } = perf;

  // 1. 中長期ターゲットネット利益率
  const targetNetMarginMid = g - tOpt;

  // 2. ターゲットネット利益と実績ネット利益
  const targetNetProfit = sales * targetNetMarginMid;
  const actualNetProfit = sales * g - adCost;

  // 3. 利益ギャップ（正=目標未達、負=目標超過）
  const profitGap = targetNetProfit - actualNetProfit;

  // 4. ライフサイクル別lossBudget倍率
  const lossBudgetMultiple = getLossBudgetMultiple(lifecycleStage, config);

  // 5. lossBudget計算（防御的にゼロ・負を回避）
  const rawLossBudget = targetNetProfit * lossBudgetMultiple;
  // lossBudgetがゼロや負の場合、最小値として売上の1%を使用
  const lossBudgetStage = Math.max(rawLossBudget, sales * 0.01, 1);

  // 6. 利益ギャップ比率の計算
  // profitGapがマイナス（目標超過）の場合はratioStageを0にクリップ
  const ratioStage = profitGap <= 0 ? 0 : profitGap / lossBudgetStage;

  // 7. InvestmentState判定
  const investmentState = determineInvestmentState(ratioStage, config);

  // 計算詳細メモ
  let calculationNote = `期間: ${periodStart}〜${periodEnd}, `;
  calculationNote += `売上=${sales.toFixed(0)}円, 広告費=${adCost.toFixed(0)}円, `;
  calculationNote += `g=${(g * 100).toFixed(1)}%, T_opt=${(tOpt * 100).toFixed(1)}%, `;
  calculationNote += `n_mid=${(targetNetMarginMid * 100).toFixed(1)}%, `;
  calculationNote += `profitGap=${profitGap.toFixed(0)}円, `;
  calculationNote += `lossBudget=${lossBudgetStage.toFixed(0)}円, `;
  calculationNote += `ratio=${(ratioStage * 100).toFixed(1)}%`;

  return {
    asin,
    lifecycleStage,
    g,
    tOpt,
    sales,
    adCost,
    targetNetMarginMid,
    targetNetProfit,
    actualNetProfit,
    profitGap,
    lossBudgetMultiple,
    lossBudgetStage,
    ratioStage,
    investmentState,
    periodStart,
    periodEnd,
    calculationNote,
  };
}

// =============================================================================
// バッチ評価関数
// =============================================================================

/**
 * ASIN lossBudget評価結果のマップ
 */
export type AsinLossBudgetMap = Map<string, AsinLossBudgetMetrics>;

/**
 * 複数ASINの一括評価
 *
 * @param performances - ASIN期間パフォーマンスの配列
 * @param getMarginPotential - ASINからgを取得する関数
 * @param getTopt - ASINからT_optを取得する関数
 * @param config - lossBudget評価設定
 * @returns ASIN -> AsinLossBudgetMetrics のマップ
 */
export function evaluateAllAsins(
  performances: AsinPeriodPerformance[],
  getMarginPotential: (asin: string) => number,
  getTopt: (asin: string) => number,
  config: LossBudgetConfig = DEFAULT_LOSS_BUDGET_CONFIG
): AsinLossBudgetMap {
  const map: AsinLossBudgetMap = new Map();

  for (const perf of performances) {
    const g = getMarginPotential(perf.asin);
    const tOpt = getTopt(perf.asin);
    const metrics = evaluateAsinLossBudget(perf, g, tOpt, config);
    map.set(perf.asin, metrics);
  }

  return map;
}

// =============================================================================
// アクション制約
// =============================================================================

/**
 * bidEngine向けのアクション制約
 */
export interface ActionConstraints {
  /** STRONG_UPを許可するか */
  allowStrongUp: boolean;
  /** UPを許可するか */
  allowUp: boolean;
  /** DOWNを許可するか */
  allowDown: boolean;
  /** STRONG_DOWNを許可するか */
  allowStrongDown: boolean;
  /** STOPを許可するか */
  allowStop: boolean;
  /** NEGを許可するか */
  allowNeg: boolean;

  /** 一回のUP系変動の最大倍率 */
  maxIncreaseMultiplier: number;
  /** 一回のDOWN系変動の最大倍率（1.0から引く値） */
  maxDecreaseMultiplier: number;

  /** STRONG_UP発動閾値の調整係数（大きいほど厳しい） */
  strongUpThresholdMultiplier: number;

  /** T_stage調整係数（1.0未満でT_optに近づける） */
  tStageAdjustmentFactor: number;

  /** 制約の理由 */
  constraintReason: string;
}

/**
 * デフォルトのアクション制約（制限なし）
 */
export const DEFAULT_ACTION_CONSTRAINTS: ActionConstraints = {
  allowStrongUp: true,
  allowUp: true,
  allowDown: true,
  allowStrongDown: true,
  allowStop: true,
  allowNeg: true,
  maxIncreaseMultiplier: 1.3,
  maxDecreaseMultiplier: 0.15,
  strongUpThresholdMultiplier: 1.0,
  tStageAdjustmentFactor: 1.0,
  constraintReason: "制限なし",
};

/**
 * LAUNCH期のアクション制約（STOP/NEG封印ベース）
 */
const LAUNCH_BASE_CONSTRAINTS: Partial<ActionConstraints> = {
  allowStrongDown: false,
  allowStop: false,
  allowNeg: false,
};

/**
 * ライフサイクルステージ × InvestmentState からアクション制約を取得
 *
 * @param lifecycleStage - ライフサイクルステージ
 * @param investmentState - 投資状態
 * @returns アクション制約
 */
export function getActionConstraints(
  lifecycleStage: LifecycleState,
  investmentState: InvestmentState
): ActionConstraints {
  const isLaunch =
    lifecycleStage === "LAUNCH_HARD" || lifecycleStage === "LAUNCH_SOFT";

  // LAUNCH期のルール
  if (isLaunch) {
    return getLaunchConstraints(lifecycleStage, investmentState);
  }

  // GROW期のルール
  if (lifecycleStage === "GROW") {
    return getGrowConstraints(investmentState);
  }

  // HARVEST期のルール
  if (lifecycleStage === "HARVEST") {
    return getHarvestConstraints(investmentState);
  }

  // フォールバック
  return { ...DEFAULT_ACTION_CONSTRAINTS };
}

/**
 * LAUNCH期のアクション制約
 */
function getLaunchConstraints(
  lifecycleStage: LifecycleState,
  investmentState: InvestmentState
): ActionConstraints {
  const base: ActionConstraints = {
    ...DEFAULT_ACTION_CONSTRAINTS,
    ...LAUNCH_BASE_CONSTRAINTS,
    constraintReason: `${lifecycleStage}/${investmentState}`,
  };

  switch (investmentState) {
    case InvestmentState.SAFE:
      return {
        ...base,
        constraintReason: `${lifecycleStage}/SAFE: 通常通り許可（STOP/NEGは封印）`,
      };

    case InvestmentState.WATCH:
      return {
        ...base,
        maxIncreaseMultiplier: 1.2, // 上昇幅を少し抑える
        strongUpThresholdMultiplier: 1.2, // STRONG_UP発動条件を厳しめに
        constraintReason: `${lifecycleStage}/WATCH: 上昇幅を控えめに`,
      };

    case InvestmentState.LIMIT:
      return {
        ...base,
        allowStrongUp: false, // STRONG_UP禁止
        maxIncreaseMultiplier: 1.1, // 上昇幅を大幅に抑える
        tStageAdjustmentFactor: 0.9, // T_launchをT_optに少し近づける
        constraintReason: `${lifecycleStage}/LIMIT: STRONG_UP禁止、UPは限定的`,
      };

    case InvestmentState.BREACH:
      return {
        ...base,
        allowStrongUp: false,
        allowUp: false, // 新規UP禁止
        tStageAdjustmentFactor: 0.8, // T_launchをT_optに近づける
        constraintReason: `${lifecycleStage}/BREACH: UP系禁止、ライフサイクル移行検討`,
      };

    default:
      return base;
  }
}

/**
 * GROW期のアクション制約
 */
function getGrowConstraints(investmentState: InvestmentState): ActionConstraints {
  const base: ActionConstraints = {
    ...DEFAULT_ACTION_CONSTRAINTS,
    constraintReason: `GROW/${investmentState}`,
  };

  switch (investmentState) {
    case InvestmentState.SAFE:
      return {
        ...base,
        constraintReason: "GROW/SAFE: 全アクション通常通り",
      };

    case InvestmentState.WATCH:
      return {
        ...base,
        maxIncreaseMultiplier: 1.2,
        strongUpThresholdMultiplier: 1.2,
        constraintReason: "GROW/WATCH: 上昇幅を控えめに",
      };

    case InvestmentState.LIMIT:
      return {
        ...base,
        allowStrongUp: false,
        maxIncreaseMultiplier: 1.1,
        maxDecreaseMultiplier: 0.2, // DOWNをやや積極的に
        constraintReason: "GROW/LIMIT: STRONG_UP禁止、DOWNやや積極的",
      };

    case InvestmentState.BREACH:
      return {
        ...base,
        allowStrongUp: false,
        allowUp: false,
        maxDecreaseMultiplier: 0.25, // DOWN積極的
        tStageAdjustmentFactor: 0.9, // T_growをHARVEST寄りに
        constraintReason: "GROW/BREACH: UP系禁止、広告規模縮小検討",
      };

    default:
      return base;
  }
}

/**
 * HARVEST期のアクション制約
 */
function getHarvestConstraints(
  investmentState: InvestmentState
): ActionConstraints {
  const base: ActionConstraints = {
    ...DEFAULT_ACTION_CONSTRAINTS,
    // HARVEST期は元々攻めは控えめ
    maxIncreaseMultiplier: 1.15,
    strongUpThresholdMultiplier: 1.3, // STRONG_UP発動条件を厳しく
    constraintReason: `HARVEST/${investmentState}`,
  };

  switch (investmentState) {
    case InvestmentState.SAFE:
      return {
        ...base,
        constraintReason: "HARVEST/SAFE: 限定的なUP許可",
      };

    case InvestmentState.WATCH:
      return {
        ...base,
        allowStrongUp: false,
        maxIncreaseMultiplier: 1.1,
        constraintReason: "HARVEST/WATCH: STRONG_UP禁止",
      };

    case InvestmentState.LIMIT:
      return {
        ...base,
        allowStrongUp: false,
        allowUp: false,
        maxDecreaseMultiplier: 0.2,
        constraintReason: "HARVEST/LIMIT: UP系禁止、DOWNで利益確保",
      };

    case InvestmentState.BREACH:
      return {
        ...base,
        allowStrongUp: false,
        allowUp: false,
        maxDecreaseMultiplier: 0.3, // DOWN/STRONG_DOWN積極的
        constraintReason: "HARVEST/BREACH: 広告規模縮小モード",
      };

    default:
      return base;
  }
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * InvestmentStateが警告レベル以上かどうか
 */
export function isWarningState(state: InvestmentState): boolean {
  return state === InvestmentState.WATCH ||
         state === InvestmentState.LIMIT ||
         state === InvestmentState.BREACH;
}

/**
 * InvestmentStateが危険レベルかどうか
 */
export function isCriticalState(state: InvestmentState): boolean {
  return state === InvestmentState.LIMIT ||
         state === InvestmentState.BREACH;
}

/**
 * InvestmentStateがライフサイクル移行を検討すべきかどうか
 */
export function shouldConsiderLifecycleTransition(
  lifecycleStage: LifecycleState,
  investmentState: InvestmentState
): boolean {
  // LAUNCH期でBREACHの場合、GROWへの移行を検討
  if (
    (lifecycleStage === "LAUNCH_HARD" || lifecycleStage === "LAUNCH_SOFT") &&
    investmentState === InvestmentState.BREACH
  ) {
    return true;
  }

  // GROW期でBREACHの場合、HARVEST移行を検討
  if (
    lifecycleStage === "GROW" &&
    investmentState === InvestmentState.BREACH
  ) {
    return true;
  }

  return false;
}

/**
 * Slack通知用のサマリー情報を生成
 */
export function generateAlertSummary(
  metrics: AsinLossBudgetMetrics
): {
  shouldAlert: boolean;
  alertLevel: "info" | "warning" | "critical";
  message: string;
} {
  const { asin, lifecycleStage, investmentState, ratioStage, profitGap, lossBudgetStage } = metrics;

  if (investmentState === InvestmentState.SAFE) {
    return {
      shouldAlert: false,
      alertLevel: "info",
      message: "",
    };
  }

  const pctUsed = (ratioStage * 100).toFixed(1);

  if (investmentState === InvestmentState.WATCH) {
    return {
      shouldAlert: true,
      alertLevel: "info",
      message: `[WATCH] ASIN ${asin} (${lifecycleStage}): lossBudget ${pctUsed}%使用 (${profitGap.toFixed(0)}/${lossBudgetStage.toFixed(0)}円)`,
    };
  }

  if (investmentState === InvestmentState.LIMIT) {
    return {
      shouldAlert: true,
      alertLevel: "warning",
      message: `[LIMIT] ASIN ${asin} (${lifecycleStage}): lossBudget ${pctUsed}%使用 - 攻め制限中`,
    };
  }

  // BREACH
  return {
    shouldAlert: true,
    alertLevel: "critical",
    message: `[BREACH] ASIN ${asin} (${lifecycleStage}): lossBudget超過 ${pctUsed}% - 戦略見直し必要`,
  };
}

// =============================================================================
// LossBudgetState（簡易3状態）
// =============================================================================

/**
 * 簡易版のlossBudget状態（3状態）
 *
 * InvestmentState（4状態: SAFE/WATCH/LIMIT/BREACH）をシンプルな3状態にマッピング。
 * roleGuardrailsとの統合に使用。
 *
 * - SAFE: 健全（InvestmentState.SAFEに対応）
 * - WARNING: 注意（InvestmentState.WATCHとLIMITに対応）
 * - CRITICAL: 危険（InvestmentState.BREACHに対応）
 */
export type LossBudgetState = "SAFE" | "WARNING" | "CRITICAL";

/**
 * ASIN単位のlossBudget評価サマリー
 *
 * roleGuardrailsやlifecycleEvaluatorに渡す情報をまとめた構造体。
 * ローリング期間とローンチ期間全体の両方の消費率を含む。
 */
export interface LossBudgetSummary {
  /** ASIN */
  asin: string;
  /** 期間w（例えば30日）の損失消費率 (0〜∞) */
  lossBudgetConsumptionRolling: number;
  /** ローンチ期間全体の損失消費率 (0〜∞) */
  lossBudgetConsumptionLaunch: number;
  /** ローンチ追加投資枠の使用率 (0〜∞) */
  launchInvestUsageRatio: number;
  /** 統合されたLossBudgetState */
  state: LossBudgetState;
  /** 最大消費率（rolling, launch, launchInvestのmax） */
  maxConsumption: number;
  /** 評価期間開始日 */
  periodStart: string;
  /** 評価期間終了日 */
  periodEnd: string;
}

/**
 * LossBudgetState判定用の設定
 */
export interface LossBudgetStateConfig {
  /** WARNING判定閾値（maxConsumption >= threshold） */
  warningThreshold: number;
  /** CRITICAL判定閾値（maxConsumption >= threshold） */
  criticalThreshold: number;
  /** LaunchInvest WARNING判定閾値 */
  launchInvestWarningThreshold: number;
  /** LaunchInvest CRITICAL判定閾値 */
  launchInvestCriticalThreshold: number;
}

/**
 * デフォルトのLossBudgetState判定設定
 */
export const DEFAULT_LOSS_BUDGET_STATE_CONFIG: LossBudgetStateConfig = {
  warningThreshold: 0.5,
  criticalThreshold: 0.9,
  launchInvestWarningThreshold: 0.5,
  launchInvestCriticalThreshold: 1.0,
};

/**
 * InvestmentStateからLossBudgetStateへの変換
 *
 * @param investmentState - 4状態のInvestmentState
 * @returns 3状態のLossBudgetState
 */
export function investmentStateToLossBudgetState(
  investmentState: InvestmentState
): LossBudgetState {
  switch (investmentState) {
    case InvestmentState.SAFE:
      return "SAFE";
    case InvestmentState.WATCH:
    case InvestmentState.LIMIT:
      return "WARNING";
    case InvestmentState.BREACH:
      return "CRITICAL";
    default:
      return "SAFE";
  }
}

/**
 * 複数の消費率からLossBudgetStateを判定
 *
 * ローリング消費率、ローンチ消費率、LaunchInvest使用率のうち
 * 最も高い値を基準に判定する。
 *
 * @param rollingConsumption - 期間w（ローリング）の損失消費率
 * @param launchConsumption - ローンチ期間全体の損失消費率
 * @param launchInvestUsage - ローンチ追加投資枠の使用率
 * @param config - 判定設定
 * @returns LossBudgetState
 */
export function resolveLossBudgetState(
  rollingConsumption: number,
  launchConsumption: number,
  launchInvestUsage: number,
  config: LossBudgetStateConfig = DEFAULT_LOSS_BUDGET_STATE_CONFIG
): LossBudgetState {
  // maxConsumption計算（NaNや未定義を0として扱う）
  const maxConsumption = Math.max(
    rollingConsumption || 0,
    launchConsumption || 0,
    launchInvestUsage || 0
  );

  // CRITICAL判定（いずれかが閾値を超えた場合）
  if (
    maxConsumption >= config.criticalThreshold ||
    (launchInvestUsage || 0) >= config.launchInvestCriticalThreshold
  ) {
    return "CRITICAL";
  }

  // WARNING判定
  if (
    maxConsumption >= config.warningThreshold ||
    (launchInvestUsage || 0) >= config.launchInvestWarningThreshold
  ) {
    return "WARNING";
  }

  return "SAFE";
}

/**
 * LossBudgetSummaryを作成
 *
 * @param asin - ASIN
 * @param rollingConsumption - 期間w（ローリング）の損失消費率
 * @param launchConsumption - ローンチ期間全体の損失消費率
 * @param launchInvestUsage - ローンチ追加投資枠の使用率
 * @param periodStart - 評価期間開始日
 * @param periodEnd - 評価期間終了日
 * @param config - 判定設定
 * @returns LossBudgetSummary
 */
export function createLossBudgetSummary(
  asin: string,
  rollingConsumption: number,
  launchConsumption: number,
  launchInvestUsage: number,
  periodStart: string,
  periodEnd: string,
  config: LossBudgetStateConfig = DEFAULT_LOSS_BUDGET_STATE_CONFIG
): LossBudgetSummary {
  const state = resolveLossBudgetState(
    rollingConsumption,
    launchConsumption,
    launchInvestUsage,
    config
  );

  const maxConsumption = Math.max(
    rollingConsumption || 0,
    launchConsumption || 0,
    launchInvestUsage || 0
  );

  return {
    asin,
    lossBudgetConsumptionRolling: rollingConsumption || 0,
    lossBudgetConsumptionLaunch: launchConsumption || 0,
    launchInvestUsageRatio: launchInvestUsage || 0,
    state,
    maxConsumption,
    periodStart,
    periodEnd,
  };
}

/**
 * LossBudgetStateが危険レベルかどうか
 */
export function isLossBudgetCritical(state: LossBudgetState): boolean {
  return state === "CRITICAL";
}

/**
 * LossBudgetStateが警告レベル以上かどうか
 */
export function isLossBudgetWarningOrCritical(state: LossBudgetState): boolean {
  return state === "WARNING" || state === "CRITICAL";
}

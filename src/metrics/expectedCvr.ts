/**
 * 期待CVR計算ヘルパー
 *
 * 複数ソースのCVR（キーワード単体、ASIN広告全体、ASIN全体、カテゴリ平均）を
 * 信頼度付き重み付けで混合し、期待CVRを算出する。
 *
 * 主な用途:
 * - 理論最大CPCの計算（break-even bid = price * marginRate * expectedCvr）
 * - キーワードの価値評価
 * - 入札戦略の最適化
 */

import { LifecycleStage } from "../lifecycle/types";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 単一ソースのCVR元データ
 */
export interface CvrSourceMetrics {
  /** クリック数 */
  clicks: number;
  /** 注文数 */
  orders: number;
}

/**
 * 期待CVR計算に必要な入力
 */
export interface ExpectedCvrInput {
  /** キーワード単体の直近7日データ */
  keyword7d?: CvrSourceMetrics;
  /** キーワード単体の直近30日データ */
  keyword30d?: CvrSourceMetrics;
  /** ASIN全体の広告データ直近30日 */
  asinAds30d?: CvrSourceMetrics;
  /** ASIN全体のビジネスレポート由来CVR */
  asinTotal30d?: {
    /** セッション数 */
    sessions: number;
    /** 注文数 */
    orders: number;
  };
  /** カテゴリ平均CVR(0〜1)。CategoryConfigから供給される想定 */
  categoryBaselineCvr?: number;
}

/**
 * 期待CVR計算の内訳詳細
 */
export interface ExpectedCvrBreakdown {
  /** 各ソースの生CVR */
  rawCvr: {
    keyword7d: number;
    keyword30d: number;
    asinAds: number;
    asinTotal: number;
    category: number;
  };
  /** 各ソースの信頼度（0〜1） */
  reliability: {
    keyword7d: number;
    keyword30d: number;
    asinAds: number;
    asinTotal: number;
  };
  /** 各ソースの実効重み */
  effectiveWeight: {
    keyword7d: number;
    keyword30d: number;
    asinAds: number;
    asinTotal: number;
    category: number;
    total: number;
  };
  /** ライフサイクル補正前の期待CVR */
  baseExpectedCvr: number;
  /** ライフサイクル補正係数 */
  lifecycleAdjust: number;
  /** 最終の期待CVR */
  finalExpectedCvr: number;
}

/**
 * 期待CVR計算結果
 */
export interface ExpectedCvrResult {
  /** 期待CVR（0〜1） */
  expectedCvr: number;
  /** 計算詳細（デバッグ/可視化用） */
  breakdown: ExpectedCvrBreakdown;
}

/**
 * ライフサイクル区分（期待CVR計算用）
 *
 * 既存のLifecycleStageと対応:
 * - LAUNCH_HARD, LAUNCH_SOFT → LAUNCH
 * - GROW → GROW
 * - HARVEST → HARVEST
 */
export type ExpectedCvrLifecycle = "LAUNCH" | "GROW" | "HARVEST";

/**
 * 期待CVR計算のチューニング用設定
 */
export interface ExpectedCvrConfig {
  /** 信頼度が1になる基準クリック数（キーワード7日） */
  baseClicksKeyword7d: number;
  /** 信頼度が1になる基準クリック数（キーワード30日） */
  baseClicksKeyword30d: number;
  /** 信頼度が1になる基準クリック数（ASIN広告） */
  baseClicksAsinAds: number;
  /** 信頼度が1になる基準セッション数（ASIN全体） */
  baseSessionsAsinTotal: number;

  /** 各ソースの基礎重み */
  weightKeyword7d: number;
  weightKeyword30d: number;
  weightAsinAds: number;
  weightAsinTotal: number;
  weightCategory: number;

  /** ライフサイクル別の補正係数 */
  lifecycleAdjust: {
    LAUNCH: number;
    GROW: number;
    HARVEST: number;
  };
}

// =============================================================================
// デフォルト設定
// =============================================================================

/**
 * デフォルトの期待CVR計算設定
 */
export const DEFAULT_EXPECTED_CVR_CONFIG: ExpectedCvrConfig = {
  // 信頼度が1になる基準
  baseClicksKeyword7d: 20,
  baseClicksKeyword30d: 50,
  baseClicksAsinAds: 200,
  baseSessionsAsinTotal: 500,

  // 各ソースの基礎重み
  // キーワード固有のデータを重視しつつ、データ不足時はASIN/カテゴリで補完
  weightKeyword7d: 3,    // 直近7日は最も重視（鮮度が高い）
  weightKeyword30d: 2,   // 30日は安定性があるが鮮度は落ちる
  weightAsinAds: 1.5,    // ASIN広告全体（キーワード横断の傾向）
  weightAsinTotal: 1,    // ASIN全体（広告外も含む）
  weightCategory: 0.5,   // カテゴリ平均（ベースライン）

  // ライフサイクル別補正
  lifecycleAdjust: {
    LAUNCH: 0.8,   // ローンチ期はCVRを低めに見積もる（認知度低い）
    GROW: 1.0,     // 成長期は標準
    HARVEST: 1.1,  // 収穫期は高めに見積もる（リピーター効果）
  },
};

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * LifecycleStageをExpectedCvrLifecycleに変換
 */
export function toExpectedCvrLifecycle(stage: LifecycleStage): ExpectedCvrLifecycle {
  switch (stage) {
    case "LAUNCH_HARD":
    case "LAUNCH_SOFT":
      return "LAUNCH";
    case "GROW":
      return "GROW";
    case "HARVEST":
      return "HARVEST";
    default:
      return "GROW"; // フォールバック
  }
}

/**
 * CVRを計算（0除算対応）
 */
function computeCvr(orders: number, clicks: number): number {
  if (clicks <= 0) return 0;
  return orders / clicks;
}

/**
 * セッションベースCVRを計算（0除算対応）
 */
function computeSessionCvr(orders: number, sessions: number): number {
  if (sessions <= 0) return 0;
  return orders / sessions;
}

/**
 * 信頼度を計算（0〜1にクリップ）
 */
function computeReliability(actual: number, base: number): number {
  if (base <= 0) return 0;
  return Math.min(1, actual / base);
}

/**
 * 値を0〜1にクリップ
 */
function clipToRange(value: number, min: number = 0, max: number = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * 期待CVRを計算
 *
 * 複数ソースのCVRを信頼度付き重み付けで混合し、
 * ライフサイクル補正を適用して期待CVRを算出する。
 *
 * @param input - CVR計算に必要な入力データ
 * @param config - 計算設定（デフォルト設定使用可）
 * @param lifecycleStage - ライフサイクルステージ
 * @returns 期待CVR（0〜1）と計算詳細
 *
 * @example
 * ```typescript
 * const result = computeExpectedCvr(
 *   {
 *     keyword7d: { clicks: 50, orders: 3 },
 *     keyword30d: { clicks: 150, orders: 8 },
 *     categoryBaselineCvr: 0.02,
 *   },
 *   DEFAULT_EXPECTED_CVR_CONFIG,
 *   "GROW"
 * );
 * console.log(result.expectedCvr); // 0.052 など
 * ```
 */
export function computeExpectedCvr(
  input: ExpectedCvrInput,
  config: ExpectedCvrConfig = DEFAULT_EXPECTED_CVR_CONFIG,
  lifecycleStage: ExpectedCvrLifecycle | LifecycleStage = "GROW"
): ExpectedCvrResult {
  // LifecycleStageが渡された場合は変換
  let lifecycle: ExpectedCvrLifecycle;
  if (lifecycleStage === "LAUNCH_HARD" || lifecycleStage === "LAUNCH_SOFT" || lifecycleStage === "LAUNCH") {
    lifecycle = "LAUNCH";
  } else if (lifecycleStage === "HARVEST") {
    lifecycle = "HARVEST";
  } else {
    lifecycle = "GROW";
  }

  // ==========================================================================
  // 1. 各ソースの生CVRを計算
  // ==========================================================================
  const cvrKw7d = input.keyword7d
    ? computeCvr(input.keyword7d.orders, input.keyword7d.clicks)
    : 0;

  const cvrKw30d = input.keyword30d
    ? computeCvr(input.keyword30d.orders, input.keyword30d.clicks)
    : 0;

  const cvrAsinAds = input.asinAds30d
    ? computeCvr(input.asinAds30d.orders, input.asinAds30d.clicks)
    : 0;

  const cvrAsinTotal = input.asinTotal30d
    ? computeSessionCvr(input.asinTotal30d.orders, input.asinTotal30d.sessions)
    : 0;

  const cvrCategory = input.categoryBaselineCvr ?? 0;

  // ==========================================================================
  // 2. 各ソースの信頼度を計算
  // ==========================================================================
  const rKw7d = input.keyword7d
    ? computeReliability(input.keyword7d.clicks, config.baseClicksKeyword7d)
    : 0;

  const rKw30d = input.keyword30d
    ? computeReliability(input.keyword30d.clicks, config.baseClicksKeyword30d)
    : 0;

  const rAsinAds = input.asinAds30d
    ? computeReliability(input.asinAds30d.clicks, config.baseClicksAsinAds)
    : 0;

  const rAsinTotal = input.asinTotal30d
    ? computeReliability(input.asinTotal30d.sessions, config.baseSessionsAsinTotal)
    : 0;

  // ==========================================================================
  // 3. 実効重みを計算
  // ==========================================================================
  const wKw7d = config.weightKeyword7d * rKw7d;
  const wKw30d = config.weightKeyword30d * rKw30d;
  const wAsinAds = config.weightAsinAds * rAsinAds;
  const wAsinTotal = config.weightAsinTotal * rAsinTotal;
  const wCategory = config.weightCategory; // カテゴリは常に少し効かせる

  const totalWeight = wKw7d + wKw30d + wAsinAds + wAsinTotal + wCategory;

  // ==========================================================================
  // 4. ベースの期待CVRを計算
  // ==========================================================================
  let baseExpected: number;

  if (totalWeight > 0) {
    const numerator =
      wKw7d * cvrKw7d +
      wKw30d * cvrKw30d +
      wAsinAds * cvrAsinAds +
      wAsinTotal * cvrAsinTotal +
      wCategory * cvrCategory;

    baseExpected = numerator / totalWeight;
  } else {
    // 全てのデータがない場合はカテゴリCVRまたは0
    baseExpected = cvrCategory;
  }

  // ==========================================================================
  // 5. ライフサイクル補正を適用
  // ==========================================================================
  const adjust = config.lifecycleAdjust[lifecycle];
  let finalExpected = baseExpected * adjust;

  // ==========================================================================
  // 6. クリップして返す
  // ==========================================================================
  finalExpected = clipToRange(finalExpected, 0, 1);

  return {
    expectedCvr: finalExpected,
    breakdown: {
      rawCvr: {
        keyword7d: cvrKw7d,
        keyword30d: cvrKw30d,
        asinAds: cvrAsinAds,
        asinTotal: cvrAsinTotal,
        category: cvrCategory,
      },
      reliability: {
        keyword7d: rKw7d,
        keyword30d: rKw30d,
        asinAds: rAsinAds,
        asinTotal: rAsinTotal,
      },
      effectiveWeight: {
        keyword7d: wKw7d,
        keyword30d: wKw30d,
        asinAds: wAsinAds,
        asinTotal: wAsinTotal,
        category: wCategory,
        total: totalWeight,
      },
      baseExpectedCvr: baseExpected,
      lifecycleAdjust: adjust,
      finalExpectedCvr: finalExpected,
    },
  };
}

/**
 * 期待CVRを簡易計算（戻り値は数値のみ）
 *
 * @param input - CVR計算に必要な入力データ
 * @param config - 計算設定
 * @param lifecycleStage - ライフサイクルステージ
 * @returns 期待CVR（0〜1）
 */
export function computeExpectedCvrSimple(
  input: ExpectedCvrInput,
  config: ExpectedCvrConfig = DEFAULT_EXPECTED_CVR_CONFIG,
  lifecycleStage: ExpectedCvrLifecycle | LifecycleStage = "GROW"
): number {
  return computeExpectedCvr(input, config, lifecycleStage).expectedCvr;
}

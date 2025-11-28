/**
 * プレセール診断ロジック
 *
 * プレセール期間の実績を分析し、
 * 「売れるプレセール」「買い控えプレセール」「グレーゾーン」を判定する。
 */

import {
  SalePhase,
  PresaleType,
  PresaleDiagnosis,
  PresaleDiagnosisInput,
  SaleContextConfig,
  PresaleThresholdConfig,
  PresaleBidPolicy,
  PresaleContext,
  DEFAULT_SALE_CONTEXT_CONFIG,
  DEFAULT_PRESALE_THRESHOLD_CONFIG,
  DEFAULT_PRESALE_POLICIES,
} from "./types";

// =============================================================================
// メトリクス計算ヘルパー
// =============================================================================

/**
 * CVRを計算（クリックが0の場合はnull）
 */
export function calculateCvr(conversions: number, clicks: number): number | null {
  if (clicks <= 0) {
    return null;
  }
  return conversions / clicks;
}

/**
 * ACOSを計算（売上が0の場合はnull）
 */
export function calculateAcos(cost: number, revenue: number | undefined): number | null {
  if (revenue === undefined || revenue <= 0) {
    return null;
  }
  return cost / revenue;
}

/**
 * 最小クリック数を満たしているかチェック
 */
export function hasMinimumClicks(clicks: number, minClicks: number): boolean {
  return clicks >= minClicks;
}

/**
 * 比率を計算（分母が0またはnullの場合はnull）
 */
function calculateRatio(
  numerator: number | null,
  denominator: number | null
): number | null {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

// =============================================================================
// メイン診断関数
// =============================================================================

/**
 * プレセールタイプを診断
 *
 * @param input - プレセール診断の入力データ（baseline + presale）
 * @param saleContextConfig - セールコンテキスト設定
 * @param thresholdConfig - プレセール診断の閾値設定
 * @returns プレセール診断結果
 *
 * @example
 * ```typescript
 * const input: PresaleDiagnosisInput = {
 *   baseline: { clicks: 500, cost: 25000, conversions: 25, revenue: 100000 },
 *   presale: { clicks: 80, cost: 5000, conversions: 2, revenue: 8000 },
 * };
 *
 * const diagnosis = diagnosePresaleType(input, {
 *   ...DEFAULT_SALE_CONTEXT_CONFIG,
 *   salePhase: "PRE_SALE",
 * });
 *
 * // diagnosis.type === "HOLD_BACK" (CVR悪化: 2.5% → 2.5%, ただしACOS悪化)
 * ```
 */
export function diagnosePresaleType(
  input: PresaleDiagnosisInput,
  saleContextConfig: SaleContextConfig = DEFAULT_SALE_CONTEXT_CONFIG,
  thresholdConfig: PresaleThresholdConfig = DEFAULT_PRESALE_THRESHOLD_CONFIG
): PresaleDiagnosis {
  const { baseline, presale } = input;
  const { salePhase, baselineMinClicks, presaleMinClicks } = saleContextConfig;

  // PRE_SALEフェーズ以外は診断対象外
  if (salePhase !== "PRE_SALE") {
    return {
      type: "NONE",
      baselineCvr: null,
      presaleCvr: null,
      baselineAcos: null,
      presaleAcos: null,
      cvrRatio: null,
      acosRatio: null,
      reason: `セールフェーズが${salePhase}のため診断対象外`,
    };
  }

  // メトリクス計算
  const baselineCvr = calculateCvr(baseline.conversions, baseline.clicks);
  const presaleCvr = calculateCvr(presale.conversions, presale.clicks);
  const baselineAcos = calculateAcos(baseline.cost, baseline.revenue);
  const presaleAcos = calculateAcos(presale.cost, presale.revenue);

  // データ不足チェック: baselineのクリック数
  if (baseline.clicks < baselineMinClicks) {
    return {
      type: "MIXED",
      baselineCvr,
      presaleCvr,
      baselineAcos,
      presaleAcos,
      cvrRatio: null,
      acosRatio: null,
      reason: `baselineクリック数(${baseline.clicks})が閾値(${baselineMinClicks})未満のためMIXED判定`,
    };
  }

  // データ不足チェック: presaleのクリック数
  if (presale.clicks < presaleMinClicks) {
    return {
      type: "MIXED",
      baselineCvr,
      presaleCvr,
      baselineAcos,
      presaleAcos,
      cvrRatio: null,
      acosRatio: null,
      reason: `presaleクリック数(${presale.clicks})が閾値(${presaleMinClicks})未満のためMIXED判定`,
    };
  }

  // CVR比率の計算
  const cvrRatio = calculateRatio(presaleCvr, baselineCvr);

  // ACOS比率の計算
  const acosRatio = calculateRatio(presaleAcos, baselineAcos);

  // CVR比率が計算できない場合はMIXED
  if (cvrRatio === null) {
    return {
      type: "MIXED",
      baselineCvr,
      presaleCvr,
      baselineAcos,
      presaleAcos,
      cvrRatio: null,
      acosRatio,
      reason: "CVR比率が計算できないためMIXED判定（baselineまたはpresaleのCVRがnull）",
    };
  }

  // ==========================================================================
  // タイプ判定
  // ==========================================================================

  const {
    minCvrRatioForBuying,
    maxAcosRatioForBuying,
    maxCvrRatioForHoldBack,
    minAcosRatioForHoldBack,
  } = thresholdConfig;

  // BUYING（売れるプレセール）判定
  // - CVR維持（cvrRatio >= 閾値）
  // - ACOS悪化なし（acosRatio <= 閾値）またはACOS計算不可
  const isCvrGoodForBuying = cvrRatio >= minCvrRatioForBuying;
  const isAcosGoodForBuying = acosRatio === null || acosRatio <= maxAcosRatioForBuying;

  if (isCvrGoodForBuying && isAcosGoodForBuying) {
    return {
      type: "BUYING",
      baselineCvr,
      presaleCvr,
      baselineAcos,
      presaleAcos,
      cvrRatio,
      acosRatio,
      reason: `売れるプレセール: CVR比率(${(cvrRatio * 100).toFixed(1)}%)≥${(minCvrRatioForBuying * 100).toFixed(0)}%、ACOS比率${acosRatio !== null ? `(${(acosRatio * 100).toFixed(1)}%)≤${(maxAcosRatioForBuying * 100).toFixed(0)}%` : "N/A"}`,
    };
  }

  // HOLD_BACK（買い控えプレセール）判定
  // - CVR悪化（cvrRatio <= 閾値）
  // - ACOS悪化（acosRatio >= 閾値）またはACOS計算不可（売上がないことも悪いシグナル）
  const isCvrBadForHoldBack = cvrRatio <= maxCvrRatioForHoldBack;
  const isAcosBadForHoldBack = acosRatio === null || acosRatio >= minAcosRatioForHoldBack;

  if (isCvrBadForHoldBack && isAcosBadForHoldBack) {
    return {
      type: "HOLD_BACK",
      baselineCvr,
      presaleCvr,
      baselineAcos,
      presaleAcos,
      cvrRatio,
      acosRatio,
      reason: `買い控えプレセール: CVR比率(${(cvrRatio * 100).toFixed(1)}%)≤${(maxCvrRatioForHoldBack * 100).toFixed(0)}%、ACOS比率${acosRatio !== null ? `(${(acosRatio * 100).toFixed(1)}%)≥${(minAcosRatioForHoldBack * 100).toFixed(0)}%` : "N/A"}`,
    };
  }

  // 上記どちらにも該当しない場合はMIXED
  return {
    type: "MIXED",
    baselineCvr,
    presaleCvr,
    baselineAcos,
    presaleAcos,
    cvrRatio,
    acosRatio,
    reason: `グレーゾーン: CVR比率(${(cvrRatio * 100).toFixed(1)}%)、ACOS比率${acosRatio !== null ? `(${(acosRatio * 100).toFixed(1)}%)` : "N/A"} - BUYINGでもHOLD_BACKでもない中間`,
  };
}

// =============================================================================
// ポリシー取得関数
// =============================================================================

/**
 * プレセールタイプに対応するポリシーを取得
 *
 * @param presaleType - プレセールタイプ
 * @param customPolicies - カスタムポリシー（オプション）
 * @returns プレセール対応ポリシー
 */
export function getPresaleBidPolicy(
  presaleType: PresaleType,
  customPolicies?: Partial<Record<PresaleType, Partial<PresaleBidPolicy>>>
): PresaleBidPolicy {
  const basePolicy = DEFAULT_PRESALE_POLICIES[presaleType];

  if (!customPolicies || !customPolicies[presaleType]) {
    return basePolicy;
  }

  // カスタムポリシーをマージ
  return {
    ...basePolicy,
    ...customPolicies[presaleType],
  };
}

// =============================================================================
// コンテキスト生成関数
// =============================================================================

/**
 * プレセールコンテキストを生成
 *
 * 診断を実行し、対応するポリシーと合わせてコンテキストを返す
 *
 * @param input - プレセール診断の入力データ
 * @param saleContextConfig - セールコンテキスト設定
 * @param thresholdConfig - プレセール診断の閾値設定
 * @param customPolicies - カスタムポリシー（オプション）
 * @returns プレセールコンテキスト
 */
export function createPresaleContext(
  input: PresaleDiagnosisInput,
  saleContextConfig: SaleContextConfig = DEFAULT_SALE_CONTEXT_CONFIG,
  thresholdConfig: PresaleThresholdConfig = DEFAULT_PRESALE_THRESHOLD_CONFIG,
  customPolicies?: Partial<Record<PresaleType, Partial<PresaleBidPolicy>>>
): PresaleContext {
  const diagnosis = diagnosePresaleType(input, saleContextConfig, thresholdConfig);
  const policy = getPresaleBidPolicy(diagnosis.type, customPolicies);

  return {
    salePhase: saleContextConfig.salePhase,
    diagnosis,
    policy,
  };
}

/**
 * 通常時（非プレセール）のデフォルトコンテキストを生成
 *
 * @param salePhase - セールフェーズ（NORMAL, MAIN_SALE, COOL_DOWNのいずれか）
 * @returns プレセールコンテキスト
 */
export function createDefaultPresaleContext(
  salePhase: SalePhase = "NORMAL"
): PresaleContext {
  return {
    salePhase,
    diagnosis: {
      type: "NONE",
      baselineCvr: null,
      presaleCvr: null,
      baselineAcos: null,
      presaleAcos: null,
      cvrRatio: null,
      acosRatio: null,
      reason: `セールフェーズ${salePhase}のためプレセール診断対象外`,
    },
    policy: DEFAULT_PRESALE_POLICIES.NONE,
  };
}

// =============================================================================
// 便利関数
// =============================================================================

/**
 * プレセールタイプがダウンアクションを許可するかチェック
 */
export function isDownActionAllowed(
  presaleType: PresaleType,
  actionType: "DOWN" | "STRONG_DOWN" | "STOP" | "NEG"
): boolean {
  const policy = DEFAULT_PRESALE_POLICIES[presaleType];

  switch (actionType) {
    case "STOP":
    case "NEG":
      return policy.allowStopNeg;
    case "STRONG_DOWN":
      return policy.allowStrongDown;
    case "DOWN":
      return policy.allowDown;
    default:
      return true;
  }
}

/**
 * プレセールタイプがアップアクションを許可するかチェック
 */
export function isUpActionAllowed(
  presaleType: PresaleType,
  actionType: "UP" | "STRONG_UP"
): boolean {
  const policy = DEFAULT_PRESALE_POLICIES[presaleType];

  switch (actionType) {
    case "STRONG_UP":
      return policy.allowStrongUp;
    case "UP":
      return true; // UPは常に許可（倍率で制限）
    default:
      return true;
  }
}

/**
 * プレセールタイプに基づいてDOWN幅を制限
 *
 * @param originalDownPercent - 元のDOWN幅（%、負の値）
 * @param presaleType - プレセールタイプ
 * @returns 制限後のDOWN幅（%、負の値）
 */
export function limitDownPercent(
  originalDownPercent: number,
  presaleType: PresaleType
): number {
  const policy = DEFAULT_PRESALE_POLICIES[presaleType];
  const maxDown = -policy.maxDownPercent; // 負の値に変換

  // 元の値がすでに制限内ならそのまま返す
  if (originalDownPercent >= maxDown) {
    return originalDownPercent;
  }

  // 制限を適用
  return maxDown;
}

/**
 * プレセールタイプに基づいてUP倍率を制限
 *
 * @param originalMultiplier - 元のUP倍率
 * @param presaleType - プレセールタイプ
 * @returns 制限後のUP倍率
 */
export function limitUpMultiplier(
  originalMultiplier: number,
  presaleType: PresaleType
): number {
  const policy = DEFAULT_PRESALE_POLICIES[presaleType];

  if (originalMultiplier <= policy.maxUpMultiplier) {
    return originalMultiplier;
  }

  return policy.maxUpMultiplier;
}

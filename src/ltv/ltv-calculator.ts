/**
 * LTV（顧客生涯価値）ベースのACOS計算ロジック
 *
 * 収益モデル（LTV/単発購入）とライフサイクルステージに基づいて
 * 動的なACOSターゲットを計算
 */

import {
  RevenueModel,
  LtvMode,
  ProductConfig,
  LtvModeThresholds,
  DEFAULT_LTV_MODE_THRESHOLDS,
  ACOS_CONSTANTS,
  BaseLtvAcosDetails,
  FinalTargetAcosDetails,
} from "./types";
import { getMarginRateNormal } from "../config/productConfigTypes";

// =============================================================================
// LTVモード判定
// =============================================================================

/**
 * LTVモードを判定
 *
 * daysSinceLaunchとnewCustomersTotalから適切なLTVモードを決定
 *
 * @param daysSinceLaunch - 発売からの経過日数
 * @param newCustomersTotal - 累計新規顧客数
 * @param thresholds - 判定閾値（オプション）
 * @returns LTVモード
 */
export function determineLtvMode(
  daysSinceLaunch: number | null,
  newCustomersTotal: number,
  thresholds: LtvModeThresholds = DEFAULT_LTV_MODE_THRESHOLDS
): LtvMode {
  // 経過日数が不明な場合はASSUMED
  if (daysSinceLaunch === null) {
    return "ASSUMED";
  }

  // MEASUREDの条件を満たすか
  if (
    daysSinceLaunch >= thresholds.MEASURED_DAYS_MIN &&
    newCustomersTotal >= thresholds.MEASURED_NEW_CUSTOMERS_MIN
  ) {
    return "MEASURED";
  }

  // EARLY_ESTIMATEの条件を満たすか
  if (
    daysSinceLaunch >= thresholds.EARLY_ESTIMATE_DAYS_MIN &&
    newCustomersTotal >= thresholds.EARLY_ESTIMATE_NEW_CUSTOMERS_MIN
  ) {
    return "EARLY_ESTIMATE";
  }

  // どちらも満たさない場合はASSUMED
  return "ASSUMED";
}

/**
 * 経過日数を計算
 *
 * @param launchDate - 発売日
 * @param referenceDate - 基準日（デフォルトは今日）
 * @returns 経過日数（発売日がnullの場合はnull）
 */
export function calculateDaysSinceLaunch(
  launchDate: Date | null,
  referenceDate: Date = new Date()
): number | null {
  if (launchDate === null) {
    return null;
  }

  const diffMs = referenceDate.getTime() - launchDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

// =============================================================================
// ベースLTV ACOS計算
// =============================================================================

/**
 * ベースLTV ACOSを計算
 *
 * 収益モデルとLTVモードに基づいて基本となるACOSターゲットを計算
 *
 * - SINGLE_PURCHASE: marginRate × SINGLE_PURCHASE_SAFETY_FACTOR
 * - LTV (MEASURED): marginRate × expectedRepeatOrdersMeasured × safetyFactorMeasured
 * - LTV (ASSUMED/EARLY_ESTIMATE): marginRate × expectedRepeatOrdersAssumed × safetyFactorAssumed
 *
 * @param config - 商品設定
 * @returns 計算されたベースACOSと詳細
 */
export function computeBaseLtvTargetAcos(config: ProductConfig): {
  acos: number;
  details: BaseLtvAcosDetails;
} {
  const {
    revenueModel,
    ltvMode,
    expectedRepeatOrdersAssumed,
    expectedRepeatOrdersMeasured,
    safetyFactorAssumed,
    safetyFactorMeasured,
  } = config;

  // LTV計算では marginRateNormal を使用する
  // 理論的な「どこまでTACOSを攻めてよいか」を決める計算なので、
  // セール込みの実績値ではなく、平常時の粗利率を使う
  const marginRateNormal = getMarginRateNormal(config);

  // 1. シューズなど単発前提商品の場合
  if (revenueModel === "SINGLE_PURCHASE") {
    // 単発商品の目標ACOSは、粗利率に安全係数を掛けた値
    // 例: 粗利率40%、安全係数0.8 → 目標ACOS約32%
    const baseAcos = marginRateNormal * ACOS_CONSTANTS.SINGLE_PURCHASE_SAFETY_FACTOR;
    const clippedAcos = clipAcos(baseAcos);

    return {
      acos: clippedAcos,
      details: {
        revenueModel,
        ltvMode: null,  // SINGLE_PURCHASEではltvModeは使用しない
        marginRate: marginRateNormal,
        expectedRepeatOrders: 1,
        safetyFactor: ACOS_CONSTANTS.SINGLE_PURCHASE_SAFETY_FACTOR,
        calculatedAcos: baseAcos,
        clipped: baseAcos !== clippedAcos,
      },
    };
  }

  // 2. LTV前提商品の場合
  // ltvModeとexpectedRepeatOrdersを使った既存ロジック
  if (ltvMode === "MEASURED" && expectedRepeatOrdersMeasured != null) {
    const baseAcos = marginRateNormal * expectedRepeatOrdersMeasured * safetyFactorMeasured;
    const clippedAcos = clipAcos(baseAcos);

    return {
      acos: clippedAcos,
      details: {
        revenueModel,
        ltvMode,
        marginRate: marginRateNormal,
        expectedRepeatOrders: expectedRepeatOrdersMeasured,
        safetyFactor: safetyFactorMeasured,
        calculatedAcos: baseAcos,
        clipped: baseAcos !== clippedAcos,
      },
    };
  }

  // ASSUMEDやEARLY_ESTIMATEの期間は仮LTVを使う
  const baseAcos = marginRateNormal * expectedRepeatOrdersAssumed * safetyFactorAssumed;
  const clippedAcos = clipAcos(baseAcos);

  return {
    acos: clippedAcos,
    details: {
      revenueModel,
      ltvMode,
      marginRate: marginRateNormal,
      expectedRepeatOrders: expectedRepeatOrdersAssumed,
      safetyFactor: safetyFactorAssumed,
      calculatedAcos: baseAcos,
      clipped: baseAcos !== clippedAcos,
    },
  };
}

/**
 * ACOSを有効範囲にクリップ
 */
function clipAcos(acos: number): number {
  return Math.min(Math.max(acos, ACOS_CONSTANTS.MIN_ACOS), ACOS_CONSTANTS.MAX_ACOS);
}

// =============================================================================
// 最終ACOS計算
// =============================================================================

/**
 * 最終ACOSターゲットを計算
 *
 * ベースLTV ACOSにライフサイクルステージの係数と上限キャップを適用
 *
 * @param config - 商品設定
 * @returns 計算された最終ACOSと詳細
 */
export function computeFinalTargetAcos(config: ProductConfig): {
  acos: number;
  details: FinalTargetAcosDetails;
} {
  const { acos: baseLtvAcos } = computeBaseLtvTargetAcos(config);
  const { lifecycleState } = config;
  // LTV計算では marginRateNormal を使用する
  const marginRateNormal = getMarginRateNormal(config);

  let finalAcos: number;
  let multiplier: number;
  let cap: number;

  switch (lifecycleState) {
    case "HARVEST":
      // HARVESTモード: 利益回収フェーズ
      // 粗利率ベースで効率重視のACOSを設定
      multiplier = ACOS_CONSTANTS.HARVEST_MARGIN_MULTIPLIER;
      cap = ACOS_CONSTANTS.HARVEST_TARGET_ACOS_CAP;
      const harvestAcos = marginRateNormal * multiplier;
      finalAcos = Math.min(harvestAcos, cap);
      break;

    case "LAUNCH_HARD":
      // LAUNCH_HARDモード: 投資強化フェーズ
      // baseLtvAcosをそのまま使用（上限キャップあり）
      multiplier = 1.0;
      cap = ACOS_CONSTANTS.LAUNCH_HARD_TARGET_ACOS_CAP;
      finalAcos = Math.min(baseLtvAcos, cap);
      break;

    case "LAUNCH_SOFT":
      // LAUNCH_SOFTモード: 投資継続フェーズ
      // baseLtvAcosに係数を掛けて若干抑制
      multiplier = ACOS_CONSTANTS.LAUNCH_SOFT_LTV_MULTIPLIER;
      cap = ACOS_CONSTANTS.LAUNCH_SOFT_TARGET_ACOS_CAP;
      finalAcos = Math.min(baseLtvAcos * multiplier, cap);
      break;

    case "GROW":
    default:
      // GROWモード: 成長バランスフェーズ
      // baseLtvAcosに係数を掛けて効率重視
      multiplier = ACOS_CONSTANTS.GROW_LTV_MULTIPLIER;
      cap = ACOS_CONSTANTS.GROW_TARGET_ACOS_CAP;
      finalAcos = Math.min(baseLtvAcos * multiplier, cap);
      break;
  }

  return {
    acos: finalAcos,
    details: {
      baseLtvAcos,
      lifecycleState,
      multiplier,
      cap,
      finalAcos,
    },
  };
}

// =============================================================================
// 便利関数
// =============================================================================

/**
 * ProductConfigから直接target_acosを取得
 *
 * compute_bid_recommendationsで使用する想定
 */
export function getTargetAcos(config: ProductConfig): number {
  return computeFinalTargetAcos(config).acos;
}

/**
 * ACOS計算の全詳細を取得
 */
export function getTargetAcosWithDetails(config: ProductConfig): {
  targetAcos: number;
  baseLtvAcosDetails: BaseLtvAcosDetails;
  finalAcosDetails: FinalTargetAcosDetails;
} {
  const baseResult = computeBaseLtvTargetAcos(config);
  const finalResult = computeFinalTargetAcos(config);

  return {
    targetAcos: finalResult.acos,
    baseLtvAcosDetails: baseResult.details,
    finalAcosDetails: finalResult.details,
  };
}

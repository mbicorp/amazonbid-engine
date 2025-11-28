/**
 * 実測LTV（measuredLtv）モジュール
 *
 * 既存商品（販売実績のある商品）のLTVをBrand Analyticsのリピート率データと
 * 利益データから実測計算する機能を提供
 *
 * 新商品は事前LTV（prior/assumed）を使用し、既存商品は実測LTVを使用することで
 * より正確な累積損失上限の設定が可能になる
 */

import { ProductLtvProfile, isValidProductLtvProfile, DEFAULT_PRODUCT_LTV_PROFILE } from "../seo/seo-rank-target.types";

// =============================================================================
// 型定義
// =============================================================================

/**
 * Brand Analyticsから取得する1年間のリピート率メトリクス
 */
export interface RepeatMetrics1y {
  /** ASIN */
  asin: string;
  /** 1年間のユニーク顧客数 */
  uniqueCustomers1y: number;
  /** 1年間の総注文数 */
  totalOrders1y: number;
  /** データの集計期間開始日 */
  periodStart: Date;
  /** データの集計期間終了日 */
  periodEnd: Date;
}

/**
 * 1年間の利益メトリクス
 */
export interface ProfitMetrics1y {
  /** ASIN */
  asin: string;
  /** 1年間の総粗利（円） */
  totalGrossProfit1y: number;
  /** 1年間の総注文数 */
  totalOrders1y: number;
  /** 平均販売単価（円） */
  avgSellingPrice1y: number;
  /** 平均粗利率 */
  avgMarginRate1y: number;
}

/**
 * 実測LTV計算の入力
 */
export interface MeasuredLtvInput {
  /** ASIN */
  asin: string;
  /** Brand Analyticsリピート率データ */
  repeatMetrics: RepeatMetrics1y;
  /** 利益データ */
  profitMetrics: ProfitMetrics1y;
  /** 商品発売日 */
  launchDate: Date;
  /** LTVプロファイル（安全係数の決定に使用） */
  productLtvProfile?: ProductLtvProfile;
}

/**
 * LTVソース種別
 * - PRIOR: 事前LTV（テンプレート値、新商品向け）
 * - MEASURED: 実測LTV（既存商品向け）
 */
export type LtvSource = "PRIOR" | "MEASURED";

/**
 * 有効なLTVソース一覧
 */
export const VALID_LTV_SOURCES: readonly LtvSource[] = ["PRIOR", "MEASURED"] as const;

/**
 * LTVソースのバリデーション
 */
export function isValidLtvSource(value: unknown): value is LtvSource {
  return typeof value === "string" && VALID_LTV_SOURCES.includes(value as LtvSource);
}

/**
 * 実測LTV計算結果
 */
export interface MeasuredLtvResult {
  /** ASIN */
  asin: string;
  /** LTVソース */
  ltvSource: LtvSource;
  /** 1注文あたりの平均粗利（円） */
  avgGrossProfitPerOrder1y: number;
  /** 顧客あたりの追加注文数（初回注文を除く） */
  extraOrdersPerCustomer1y: number;
  /** 顧客あたりの総注文数（初回注文含む） */
  totalOrdersPerCustomer1y: number;
  /** 実測LTV粗利（円）= avgGrossProfitPerOrder1y × totalOrdersPerCustomer1y */
  measuredLtvGross: number;
  /** 安全係数（プロファイル別） */
  ltvSafetyFactorMeasured: number;
  /** 安全係数適用後のLTV粗利（円） */
  ltvEffectiveGross: number;
  /** 計算に使用した顧客数 */
  customersUsed: number;
  /** 計算に使用した日数（販売開始からの日数） */
  daysActive: number;
  /** 計算詳細メッセージ */
  calculationNote: string;
}

// =============================================================================
// 定数・設定
// =============================================================================

/**
 * 実測LTV計算の設定
 */
export interface MeasuredLtvConfig {
  /** 実測LTVに切り替えるための最小顧客数 */
  minCustomersForMeasured: number;
  /** 実測LTVに切り替えるための最小販売日数 */
  minDaysActiveForMeasured: number;
  /** プロファイル別の安全係数 */
  ltvSafetyFactorMeasuredByProfile: Record<ProductLtvProfile, number>;
}

/**
 * デフォルトの実測LTV計算設定
 */
export const DEFAULT_MEASURED_LTV_CONFIG: MeasuredLtvConfig = {
  minCustomersForMeasured: 300,
  minDaysActiveForMeasured: 180,
  ltvSafetyFactorMeasuredByProfile: {
    SUPPLEMENT_HIGH_LTV: 0.80,
    SUPPLEMENT_NORMAL: 0.75,
    LOW_LTV_SUPPLEMENT: 0.70,
  },
};

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 販売開始からの日数を計算
 *
 * @param launchDate - 商品発売日
 * @param referenceDate - 基準日（デフォルトは現在日時）
 * @returns 経過日数
 */
export function calculateDaysActive(
  launchDate: Date,
  referenceDate: Date = new Date()
): number {
  const diffMs = referenceDate.getTime() - launchDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * プロファイルに基づいた安全係数を取得
 *
 * @param profile - LTVプロファイル
 * @param config - 設定（オプション）
 * @returns 安全係数
 */
export function getLtvSafetyFactorMeasured(
  profile: ProductLtvProfile,
  config: MeasuredLtvConfig = DEFAULT_MEASURED_LTV_CONFIG
): number {
  return config.ltvSafetyFactorMeasuredByProfile[profile];
}

/**
 * 実測LTV計算が可能かどうかを判定
 *
 * @param uniqueCustomers - ユニーク顧客数
 * @param daysActive - 販売開始からの日数
 * @param config - 設定（オプション）
 * @returns 実測LTV計算可能な場合はtrue
 */
export function canUseMeasuredLtv(
  uniqueCustomers: number,
  daysActive: number,
  config: MeasuredLtvConfig = DEFAULT_MEASURED_LTV_CONFIG
): boolean {
  return (
    uniqueCustomers >= config.minCustomersForMeasured &&
    daysActive >= config.minDaysActiveForMeasured
  );
}

// =============================================================================
// メイン計算関数
// =============================================================================

/**
 * 実測LTVを計算
 *
 * 計算式:
 * 1. extraOrdersPerCustomer1y = max(0, (totalOrders1y - uniqueCustomers1y) / uniqueCustomers1y)
 * 2. totalOrdersPerCustomer1y = 1 + extraOrdersPerCustomer1y
 * 3. avgGrossProfitPerOrder1y = totalGrossProfit1y / totalOrders1y
 * 4. measuredLtvGross = avgGrossProfitPerOrder1y × totalOrdersPerCustomer1y
 * 5. ltvEffectiveGross = measuredLtvGross × ltvSafetyFactorMeasured
 *
 * @param input - 実測LTV計算入力
 * @param config - 設定（オプション）
 * @returns 実測LTV計算結果
 */
export function computeMeasuredLtv(
  input: MeasuredLtvInput,
  config: MeasuredLtvConfig = DEFAULT_MEASURED_LTV_CONFIG
): MeasuredLtvResult {
  const { asin, repeatMetrics, profitMetrics, launchDate, productLtvProfile } = input;

  // プロファイルの決定
  const effectiveProfile = productLtvProfile && isValidProductLtvProfile(productLtvProfile)
    ? productLtvProfile
    : DEFAULT_PRODUCT_LTV_PROFILE;

  // 販売日数の計算
  const daysActive = calculateDaysActive(launchDate);

  // 安全係数の取得
  const ltvSafetyFactorMeasured = getLtvSafetyFactorMeasured(effectiveProfile, config);

  // 実測LTV計算の条件チェック
  const uniqueCustomers = repeatMetrics.uniqueCustomers1y;
  const totalOrders = repeatMetrics.totalOrders1y;

  // 異常値のチェック
  if (uniqueCustomers <= 0 || totalOrders <= 0) {
    return {
      asin,
      ltvSource: "PRIOR",
      avgGrossProfitPerOrder1y: 0,
      extraOrdersPerCustomer1y: 0,
      totalOrdersPerCustomer1y: 1,
      measuredLtvGross: 0,
      ltvSafetyFactorMeasured,
      ltvEffectiveGross: 0,
      customersUsed: uniqueCustomers,
      daysActive,
      calculationNote: "データ不足: 顧客数または注文数がゼロ",
    };
  }

  // 実測LTV使用条件の判定
  const useMeasured = canUseMeasuredLtv(uniqueCustomers, daysActive, config);

  if (!useMeasured) {
    // 条件を満たさない場合はPRIORを返す（値は計算するが、ltvSourceはPRIOR）
    const extraOrders = Math.max(0, (totalOrders - uniqueCustomers) / uniqueCustomers);
    const totalOrdersPerCustomer = 1 + extraOrders;
    const avgGrossProfit = profitMetrics.totalGrossProfit1y / profitMetrics.totalOrders1y;
    const measuredLtvGross = avgGrossProfit * totalOrdersPerCustomer;

    return {
      asin,
      ltvSource: "PRIOR",
      avgGrossProfitPerOrder1y: avgGrossProfit,
      extraOrdersPerCustomer1y: extraOrders,
      totalOrdersPerCustomer1y: totalOrdersPerCustomer,
      measuredLtvGross,
      ltvSafetyFactorMeasured,
      ltvEffectiveGross: measuredLtvGross * ltvSafetyFactorMeasured,
      customersUsed: uniqueCustomers,
      daysActive,
      calculationNote: `実測LTV条件未達: 顧客数=${uniqueCustomers}(必要${config.minCustomersForMeasured}), 日数=${daysActive}(必要${config.minDaysActiveForMeasured})`,
    };
  }

  // 実測LTV計算
  // 1. 追加注文数 = (総注文数 - 初回注文数) / 顧客数
  const extraOrdersPerCustomer1y = Math.max(0, (totalOrders - uniqueCustomers) / uniqueCustomers);

  // 2. 顧客あたり総注文数 = 初回(1) + 追加注文
  const totalOrdersPerCustomer1y = 1 + extraOrdersPerCustomer1y;

  // 3. 1注文あたり平均粗利
  const avgGrossProfitPerOrder1y = profitMetrics.totalGrossProfit1y / profitMetrics.totalOrders1y;

  // 4. 実測LTV粗利
  const measuredLtvGross = avgGrossProfitPerOrder1y * totalOrdersPerCustomer1y;

  // 5. 安全係数適用後LTV
  const ltvEffectiveGross = measuredLtvGross * ltvSafetyFactorMeasured;

  return {
    asin,
    ltvSource: "MEASURED",
    avgGrossProfitPerOrder1y,
    extraOrdersPerCustomer1y,
    totalOrdersPerCustomer1y,
    measuredLtvGross,
    ltvSafetyFactorMeasured,
    ltvEffectiveGross,
    customersUsed: uniqueCustomers,
    daysActive,
    calculationNote: `実測LTV使用: 顧客数=${uniqueCustomers}, リピート率=${(extraOrdersPerCustomer1y * 100).toFixed(1)}%`,
  };
}

// =============================================================================
// LTV解決関数
// =============================================================================

/**
 * LTV解決入力
 */
export interface ResolveLtvInput {
  /** ASIN */
  asin: string;
  /** 新商品フラグ */
  isNewProduct: boolean;
  /** 事前LTV粗利（円）- テンプレート値 */
  priorLtvGross: number;
  /** 事前LTV安全係数 */
  priorSafetyFactor: number;
  /** 実測LTV計算入力（任意、既存商品のみ） */
  measuredLtvInput?: MeasuredLtvInput;
  /** LTVプロファイル */
  productLtvProfile?: ProductLtvProfile;
}

/**
 * LTV解決結果
 */
export interface ResolvedLtvResult {
  /** ASIN */
  asin: string;
  /** 使用されたLTVソース */
  ltvSource: LtvSource;
  /** 有効LTV粗利（円）- 累積損失上限計算に使用する値 */
  ltvEffectiveGross: number;
  /** 実測LTV粗利（円）- MEASURED時のみ有効 */
  measuredLtvGross: number | null;
  /** 事前LTV粗利（円） */
  priorLtvGross: number;
  /** 使用された安全係数 */
  safetyFactorUsed: number;
  /** 詳細情報 */
  details: {
    /** 実測LTV計算結果（計算した場合） */
    measuredLtvResult?: MeasuredLtvResult;
    /** 解決理由 */
    resolutionReason: string;
  };
}

/**
 * 商品のLTVを解決
 *
 * 新商品 → 事前LTV（PRIOR）を使用
 * 既存商品で実測LTV条件を満たす → 実測LTV（MEASURED）を使用
 * 既存商品で実測LTV条件を満たさない → 事前LTV（PRIOR）を使用
 *
 * @param input - LTV解決入力
 * @param config - 設定（オプション）
 * @returns LTV解決結果
 */
export function resolveLtvForProduct(
  input: ResolveLtvInput,
  config: MeasuredLtvConfig = DEFAULT_MEASURED_LTV_CONFIG
): ResolvedLtvResult {
  const { asin, isNewProduct, priorLtvGross, priorSafetyFactor, measuredLtvInput, productLtvProfile } = input;

  // 事前LTVの有効値
  const priorLtvEffective = priorLtvGross * priorSafetyFactor;

  // 新商品の場合は事前LTVを使用
  if (isNewProduct) {
    return {
      asin,
      ltvSource: "PRIOR",
      ltvEffectiveGross: priorLtvEffective,
      measuredLtvGross: null,
      priorLtvGross,
      safetyFactorUsed: priorSafetyFactor,
      details: {
        resolutionReason: "新商品のため事前LTV（PRIOR）を使用",
      },
    };
  }

  // 既存商品で実測LTVデータがない場合は事前LTVを使用
  if (!measuredLtvInput) {
    return {
      asin,
      ltvSource: "PRIOR",
      ltvEffectiveGross: priorLtvEffective,
      measuredLtvGross: null,
      priorLtvGross,
      safetyFactorUsed: priorSafetyFactor,
      details: {
        resolutionReason: "実測LTVデータがないため事前LTV（PRIOR）を使用",
      },
    };
  }

  // 実測LTVを計算
  const measuredLtvResult = computeMeasuredLtv(
    {
      ...measuredLtvInput,
      productLtvProfile: productLtvProfile ?? measuredLtvInput.productLtvProfile,
    },
    config
  );

  // 実測LTV条件を満たす場合
  if (measuredLtvResult.ltvSource === "MEASURED") {
    return {
      asin,
      ltvSource: "MEASURED",
      ltvEffectiveGross: measuredLtvResult.ltvEffectiveGross,
      measuredLtvGross: measuredLtvResult.measuredLtvGross,
      priorLtvGross,
      safetyFactorUsed: measuredLtvResult.ltvSafetyFactorMeasured,
      details: {
        measuredLtvResult,
        resolutionReason: `実測LTV条件達成: 顧客数=${measuredLtvResult.customersUsed}, 日数=${measuredLtvResult.daysActive}`,
      },
    };
  }

  // 実測LTV条件を満たさない場合は事前LTVを使用
  return {
    asin,
    ltvSource: "PRIOR",
    ltvEffectiveGross: priorLtvEffective,
    measuredLtvGross: measuredLtvResult.measuredLtvGross,
    priorLtvGross,
    safetyFactorUsed: priorSafetyFactor,
    details: {
      measuredLtvResult,
      resolutionReason: measuredLtvResult.calculationNote,
    },
  };
}

// =============================================================================
// 累積損失上限計算（LTV解決済み）
// =============================================================================

/**
 * 解決済みLTVを使用して累積損失上限を計算
 *
 * @param resolvedLtv - LTV解決結果
 * @param lossBudgetMultiple - 赤字許容倍率
 * @returns 累積損失上限（円）
 */
export function calculateCumulativeLossLimitFromResolvedLtv(
  resolvedLtv: ResolvedLtvResult,
  lossBudgetMultiple: number
): number {
  if (resolvedLtv.ltvEffectiveGross <= 0 || lossBudgetMultiple <= 0) {
    return 0;
  }
  return resolvedLtv.ltvEffectiveGross * lossBudgetMultiple;
}

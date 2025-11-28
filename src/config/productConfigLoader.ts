/**
 * ProductConfig ローダー
 *
 * BigQueryのproduct_configテーブルから商品設定を読み込む
 * これが商品設定の唯一の正（Single Source of Truth）
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  ProductConfig,
  RevenueModel,
  LifecycleState,
  BusinessMode,
  BrandType,
  ExperimentGroup,
  LtvMode,
} from "../ltv/types";
import { determineLtvMode, calculateDaysSinceLaunch } from "../ltv/ltv-calculator";

// =============================================================================
// 型定義
// =============================================================================

/**
 * BigQuery接続設定
 */
export interface ProductConfigLoaderOptions {
  projectId: string;
  dataset: string;
}

/**
 * BigQueryのproduct_configテーブルの行
 */
interface ProductConfigRow {
  asin: string;
  product_id: string | null;
  sku: string | null;
  is_active: boolean;
  revenue_model: string;
  lifecycle_state: string;
  business_mode: string;
  category: string | null;
  brand_type: string;
  experiment_group: string;
  margin_rate: number | null;
  expected_repeat_orders_assumed: number | null;
  expected_repeat_orders_measured_180d: number | null;
  safety_factor_assumed: number | null;
  safety_factor_measured: number | null;
  launch_date: Date | null;
  new_customers_total: number | null;
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// パース関数
// =============================================================================

/**
 * 文字列からRevenueModelをパース
 */
function parseRevenueModel(value: string | null | undefined): RevenueModel {
  if (value === "SINGLE_PURCHASE") {
    return "SINGLE_PURCHASE";
  }
  return "LTV";
}

/**
 * 文字列からLifecycleStateをパース
 */
function parseLifecycleState(value: string | null | undefined): LifecycleState {
  switch (value) {
    case "LAUNCH_HARD":
      return "LAUNCH_HARD";
    case "LAUNCH_SOFT":
      return "LAUNCH_SOFT";
    case "HARVEST":
      return "HARVEST";
    case "GROW":
    default:
      return "GROW";
  }
}

/**
 * 文字列からBusinessModeをパース
 */
function parseBusinessMode(value: string | null | undefined): BusinessMode {
  if (value === "SHARE") {
    return "SHARE";
  }
  return "PROFIT";
}

/**
 * 文字列からBrandTypeをパース
 */
function parseBrandType(value: string | null | undefined): BrandType {
  switch (value) {
    case "BRAND":
      return "BRAND";
    case "CONQUEST":
      return "CONQUEST";
    case "GENERIC":
    default:
      return "GENERIC";
  }
}

/**
 * 文字列からExperimentGroupをパース
 */
function parseExperimentGroup(value: string | null | undefined): ExperimentGroup {
  switch (value) {
    case "VARIANT_A":
      return "VARIANT_A";
    case "VARIANT_B":
      return "VARIANT_B";
    case "CONTROL":
    default:
      return "CONTROL";
  }
}

// =============================================================================
// ProductConfig組み立て
// =============================================================================

/**
 * BigQueryの行からProductConfigを組み立てる
 */
function buildProductConfigFromRow(
  row: ProductConfigRow,
  referenceDate: Date = new Date()
): ProductConfig {
  // 発売日と経過日数
  const launchDate = row.launch_date ? new Date(row.launch_date) : null;
  const daysSinceLaunch = calculateDaysSinceLaunch(launchDate, referenceDate);

  // LTVモードの判定
  const ltvMode = determineLtvMode(
    daysSinceLaunch,
    row.new_customers_total ?? 0
  );

  return {
    // 識別子
    productId: row.product_id ?? row.asin,
    asin: row.asin,
    sku: row.sku ?? undefined,

    // 有効フラグ
    isActive: row.is_active,

    // 収益モデル
    revenueModel: parseRevenueModel(row.revenue_model),

    // ライフサイクル
    lifecycleState: parseLifecycleState(row.lifecycle_state),

    // ビジネスモード
    businessMode: parseBusinessMode(row.business_mode),

    // カテゴリ・ブランド
    category: row.category ?? undefined,
    brandType: parseBrandType(row.brand_type),

    // 実験グループ
    experimentGroup: parseExperimentGroup(row.experiment_group),

    // LTV関連
    ltvMode,
    marginRate: row.margin_rate ?? 0.3,
    expectedRepeatOrdersAssumed: row.expected_repeat_orders_assumed ?? 1.0,
    expectedRepeatOrdersMeasured: row.expected_repeat_orders_measured_180d,
    safetyFactorAssumed: row.safety_factor_assumed ?? 0.7,
    safetyFactorMeasured: row.safety_factor_measured ?? 0.85,

    // 日付情報
    launchDate,
    daysSinceLaunch,
    newCustomersTotal: row.new_customers_total ?? 0,
  };
}

// =============================================================================
// データ取得
// =============================================================================

/**
 * 全てのアクティブな商品設定を取得
 *
 * @param options - BigQuery接続設定
 * @param includeInactive - 非アクティブな商品も含めるか（デフォルト: false）
 * @returns ASINをキーとするProductConfigのMap
 */
export async function loadAllProductConfigs(
  options: ProductConfigLoaderOptions,
  includeInactive: boolean = false
): Promise<Map<string, ProductConfig>> {
  const bigquery = new BigQuery({ projectId: options.projectId });

  const whereClause = includeInactive ? "1=1" : "is_active = TRUE";

  const query = `
    SELECT
      asin,
      product_id,
      sku,
      is_active,
      revenue_model,
      lifecycle_state,
      business_mode,
      category,
      brand_type,
      experiment_group,
      margin_rate,
      expected_repeat_orders_assumed,
      expected_repeat_orders_measured_180d,
      safety_factor_assumed,
      safety_factor_measured,
      launch_date,
      new_customers_total,
      created_at,
      updated_at
    FROM \`${options.projectId}.${options.dataset}.product_config\`
    WHERE ${whereClause}
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      location: "asia-northeast1",
    });

    const configMap = new Map<string, ProductConfig>();

    for (const row of rows as ProductConfigRow[]) {
      const config = buildProductConfigFromRow(row);
      configMap.set(config.asin, config);
    }

    logger.info("Loaded product configs", {
      totalCount: configMap.size,
      includeInactive,
    });

    return configMap;
  } catch (error) {
    logger.error("Failed to load product configs", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 特定のASINの商品設定を取得
 *
 * @param options - BigQuery接続設定
 * @param asin - ASIN
 * @returns ProductConfigまたはnull
 */
export async function loadProductConfigByAsin(
  options: ProductConfigLoaderOptions,
  asin: string
): Promise<ProductConfig | null> {
  const bigquery = new BigQuery({ projectId: options.projectId });

  const query = `
    SELECT
      asin,
      product_id,
      sku,
      is_active,
      revenue_model,
      lifecycle_state,
      business_mode,
      category,
      brand_type,
      experiment_group,
      margin_rate,
      expected_repeat_orders_assumed,
      expected_repeat_orders_measured_180d,
      safety_factor_assumed,
      safety_factor_measured,
      launch_date,
      new_customers_total,
      created_at,
      updated_at
    FROM \`${options.projectId}.${options.dataset}.product_config\`
    WHERE asin = @asin
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asin },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      logger.warn("Product config not found", { asin });
      return null;
    }

    const row = rows[0] as ProductConfigRow;
    return buildProductConfigFromRow(row);
  } catch (error) {
    logger.error("Failed to load product config", {
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 複数のASINの商品設定を取得
 *
 * @param options - BigQuery接続設定
 * @param asins - ASINリスト
 * @param activeOnly - アクティブな商品のみ取得するか（デフォルト: true）
 * @returns ASINをキーとするProductConfigのMap
 */
export async function loadProductConfigsByAsins(
  options: ProductConfigLoaderOptions,
  asins: string[],
  activeOnly: boolean = true
): Promise<Map<string, ProductConfig>> {
  if (asins.length === 0) {
    return new Map();
  }

  const bigquery = new BigQuery({ projectId: options.projectId });

  const whereClause = activeOnly
    ? "asin IN UNNEST(@asins) AND is_active = TRUE"
    : "asin IN UNNEST(@asins)";

  const query = `
    SELECT
      asin,
      product_id,
      sku,
      is_active,
      revenue_model,
      lifecycle_state,
      business_mode,
      category,
      brand_type,
      experiment_group,
      margin_rate,
      expected_repeat_orders_assumed,
      expected_repeat_orders_measured_180d,
      safety_factor_assumed,
      safety_factor_measured,
      launch_date,
      new_customers_total,
      created_at,
      updated_at
    FROM \`${options.projectId}.${options.dataset}.product_config\`
    WHERE ${whereClause}
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asins },
      location: "asia-northeast1",
    });

    const configMap = new Map<string, ProductConfig>();

    for (const row of rows as ProductConfigRow[]) {
      const config = buildProductConfigFromRow(row);
      configMap.set(config.asin, config);
    }

    logger.info("Loaded product configs by ASINs", {
      requestedCount: asins.length,
      loadedCount: configMap.size,
      activeOnly,
    });

    return configMap;
  } catch (error) {
    logger.error("Failed to load product configs by ASINs", {
      asinCount: asins.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * アクティブな商品のASINリストを取得
 *
 * @param options - BigQuery接続設定
 * @returns アクティブなASINの配列
 */
export async function getActiveAsins(
  options: ProductConfigLoaderOptions
): Promise<string[]> {
  const bigquery = new BigQuery({ projectId: options.projectId });

  const query = `
    SELECT asin
    FROM \`${options.projectId}.${options.dataset}.product_config\`
    WHERE is_active = TRUE
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      location: "asia-northeast1",
    });

    const asins = rows.map((row: { asin: string }) => row.asin);

    logger.info("Fetched active ASINs", {
      count: asins.length,
    });

    return asins;
  } catch (error) {
    logger.error("Failed to fetch active ASINs", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

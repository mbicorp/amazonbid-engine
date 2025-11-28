/**
 * ProductConfig組み立て処理
 *
 * BigQueryからLTVメトリクスを読み込み、ProductConfigを組み立てる
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  RevenueModel,
  LtvMode,
  ProductConfig,
  ProductLtvMetricsRow,
} from "./types";
import {
  determineLtvMode,
  calculateDaysSinceLaunch,
} from "./ltv-calculator";
import { LifecycleStage } from "../lifecycle/types";

// =============================================================================
// 型定義
// =============================================================================

interface BuilderConfig {
  projectId: string;
  dataset: string;
}

/**
 * BigQueryから取得したLTVメトリクスとライフサイクル情報を結合した行
 */
interface ProductLtvWithLifecycleRow extends ProductLtvMetricsRow {
  lifecycle_stage: string | null;
}

// =============================================================================
// 収益モデルのパース
// =============================================================================

/**
 * 文字列からRevenueModelを判定
 *
 * @param value - BigQueryから取得した値
 * @returns RevenueModel（デフォルトはLTV）
 */
export function parseRevenueModel(value: string | null | undefined): RevenueModel {
  if (value === "SINGLE_PURCHASE") {
    return "SINGLE_PURCHASE";
  }
  // "LTV"、null、空文字、その他の値はすべて "LTV" にフォールバック
  return "LTV";
}

/**
 * 文字列からLifecycleStateを判定
 *
 * @param value - BigQueryから取得した値
 * @returns LifecycleState（デフォルトはGROW）
 */
export function parseLifecycleState(
  value: string | null | undefined
): "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST" {
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

// =============================================================================
// ProductConfig組み立て
// =============================================================================

/**
 * BigQueryの行データからProductConfigを組み立てる
 *
 * @param row - BigQueryから取得した行
 * @param referenceDate - 経過日数計算の基準日（デフォルトは今日）
 * @returns ProductConfig
 */
export function buildProductConfig(
  row: ProductLtvWithLifecycleRow,
  referenceDate: Date = new Date()
): ProductConfig {
  // 発売日と経過日数
  const launchDate = row.launch_date ? new Date(row.launch_date) : null;
  const daysSinceLaunch = calculateDaysSinceLaunch(launchDate, referenceDate);

  // 収益モデルのパース
  const revenueModel = parseRevenueModel(row.revenue_model);

  // LTVモードの判定
  // SINGLE_PURCHASE商品でも一応ltvModeは設定する（ログ等で参考情報として使える）
  const ltvMode = determineLtvMode(daysSinceLaunch, row.new_customers_total);

  // ライフサイクルステートのパース
  const lifecycleState = parseLifecycleState(row.lifecycle_stage);

  return {
    productId: row.product_id,
    asin: row.asin,

    // 有効フラグ（デフォルト: true）
    isActive: true,

    // 収益モデル
    revenueModel,

    // ビジネスモード（デフォルト: PROFIT）
    businessMode: "PROFIT" as const,

    // カテゴリ・ブランド
    brandType: "GENERIC" as const,

    // 実験グループ（デフォルト: CONTROL）
    experimentGroup: "CONTROL" as const,

    // LTV関連
    ltvMode,
    marginRate: row.margin_rate,
    expectedRepeatOrdersAssumed: row.expected_repeat_orders_assumed,
    expectedRepeatOrdersMeasured: row.expected_repeat_orders_measured_180d,
    safetyFactorAssumed: row.safety_factor_assumed,
    safetyFactorMeasured: row.safety_factor_measured,

    // 日付情報
    launchDate,
    daysSinceLaunch,
    newCustomersTotal: row.new_customers_total,

    // ライフサイクル
    lifecycleState,
  };
}

// =============================================================================
// BigQueryからデータ取得
// =============================================================================

/**
 * 特定商品のProductConfigを取得
 *
 * @param config - BigQuery接続設定
 * @param productId - 商品ID
 * @returns ProductConfigまたはnull
 */
export async function fetchProductConfig(
  config: BuilderConfig,
  productId: string
): Promise<ProductConfig | null> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT
      ltv.asin,
      ltv.product_id,
      ltv.margin_rate,
      ltv.expected_repeat_orders_assumed,
      ltv.expected_repeat_orders_measured_180d,
      ltv.safety_factor_assumed,
      ltv.safety_factor_measured,
      ltv.launch_date,
      ltv.new_customers_total,
      ltv.revenue_model,
      ps.lifecycle_stage
    FROM \`${config.projectId}.${config.dataset}.product_ltv_metrics\` ltv
    LEFT JOIN \`${config.projectId}.${config.dataset}.product_strategy\` ps
      ON ltv.product_id = ps.product_id
    WHERE ltv.product_id = @productId
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { productId },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      logger.warn("Product LTV metrics not found", { productId });
      return null;
    }

    const row = rows[0] as ProductLtvWithLifecycleRow;
    return buildProductConfig(row);
  } catch (error) {
    logger.error("Failed to fetch product config", {
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 複数商品のProductConfigを取得
 *
 * @param config - BigQuery接続設定
 * @param productIds - 商品IDリスト（省略時は全件取得）
 * @returns ProductConfigのMap
 */
export async function fetchProductConfigs(
  config: BuilderConfig,
  productIds?: string[]
): Promise<Map<string, ProductConfig>> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  let whereClause = "1=1";
  const params: Record<string, unknown> = {};

  if (productIds && productIds.length > 0) {
    whereClause = "ltv.product_id IN UNNEST(@productIds)";
    params.productIds = productIds;
  }

  const query = `
    SELECT
      ltv.asin,
      ltv.product_id,
      ltv.margin_rate,
      ltv.expected_repeat_orders_assumed,
      ltv.expected_repeat_orders_measured_180d,
      ltv.safety_factor_assumed,
      ltv.safety_factor_measured,
      ltv.launch_date,
      ltv.new_customers_total,
      ltv.revenue_model,
      ps.lifecycle_stage
    FROM \`${config.projectId}.${config.dataset}.product_ltv_metrics\` ltv
    LEFT JOIN \`${config.projectId}.${config.dataset}.product_strategy\` ps
      ON ltv.product_id = ps.product_id
    WHERE ${whereClause}
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params,
      location: "asia-northeast1",
    });

    const configMap = new Map<string, ProductConfig>();

    for (const row of rows as ProductLtvWithLifecycleRow[]) {
      const productConfig = buildProductConfig(row);
      // productIdがない場合はasinをキーとして使用
      const key = productConfig.productId ?? productConfig.asin;
      configMap.set(key, productConfig);
    }

    logger.info("Fetched product configs", {
      requestedCount: productIds?.length ?? "all",
      fetchedCount: configMap.size,
    });

    return configMap;
  } catch (error) {
    logger.error("Failed to fetch product configs", {
      productIds: productIds?.length ?? "all",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * ASINからProductConfigを取得
 *
 * @param config - BigQuery接続設定
 * @param asin - ASIN
 * @returns ProductConfigまたはnull
 */
export async function fetchProductConfigByAsin(
  config: BuilderConfig,
  asin: string
): Promise<ProductConfig | null> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT
      ltv.asin,
      ltv.product_id,
      ltv.margin_rate,
      ltv.expected_repeat_orders_assumed,
      ltv.expected_repeat_orders_measured_180d,
      ltv.safety_factor_assumed,
      ltv.safety_factor_measured,
      ltv.launch_date,
      ltv.new_customers_total,
      ltv.revenue_model,
      ps.lifecycle_stage
    FROM \`${config.projectId}.${config.dataset}.product_ltv_metrics\` ltv
    LEFT JOIN \`${config.projectId}.${config.dataset}.product_strategy\` ps
      ON ltv.product_id = ps.product_id
    WHERE ltv.asin = @asin
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asin },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      logger.warn("Product LTV metrics not found by ASIN", { asin });
      return null;
    }

    const row = rows[0] as ProductLtvWithLifecycleRow;
    return buildProductConfig(row);
  } catch (error) {
    logger.error("Failed to fetch product config by ASIN", {
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

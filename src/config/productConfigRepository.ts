/**
 * ProductConfig リポジトリ
 *
 * 商品設定の読み取りを一元化し、バリデーション付きで提供する
 * すべてのロジックはこのリポジトリ経由でProductConfigにアクセスする
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
  PRODUCT_CONFIG_DEFAULTS,
  isValidLifecycleState,
  isValidRevenueModel,
  isValidBusinessMode,
  isValidBrandType,
  isValidExperimentGroup,
} from "./productConfigTypes";
import {
  validateAllProductConfigs,
  validateProductConfig,
  formatBulkValidationResult,
  BulkValidationResult,
} from "./productConfigValidator";

// =============================================================================
// 型定義
// =============================================================================

/**
 * リポジトリ初期化オプション
 */
export interface ProductConfigRepositoryOptions {
  /** BigQuery プロジェクトID */
  projectId: string;
  /** BigQuery データセットID */
  dataset: string;
  /** バリデーションエラー時に例外を投げるか（デフォルト: true） */
  throwOnError?: boolean;
  /** バリデーション警告をログ出力するか（デフォルト: true） */
  logWarnings?: boolean;
}

/**
 * ProductConfig リポジトリインターフェース
 */
export interface ProductConfigRepository {
  /**
   * 全てのアクティブな商品設定を取得
   * @param includeInactive - 非アクティブな商品も含めるか
   */
  loadAll(includeInactive?: boolean): Promise<Map<string, ProductConfig>>;

  /**
   * 特定のASINの商品設定を取得
   * @param profileId - プロファイルID
   * @param asin - ASIN
   */
  getByAsin(profileId: string, asin: string): Promise<ProductConfig | null>;

  /**
   * 複数のASINの商品設定を取得
   * @param profileId - プロファイルID
   * @param asins - ASINリスト
   */
  getByAsins(
    profileId: string,
    asins: string[]
  ): Promise<Map<string, ProductConfig>>;

  /**
   * アクティブなASINリストを取得
   */
  getActiveAsins(): Promise<string[]>;

  /**
   * 最後のバリデーション結果を取得
   */
  getLastValidationResult(): BulkValidationResult | null;
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
  profile_id: string | null;
  auto_exact_enabled: boolean | null;
  max_bid_multiplier: number | null;
  min_bid_multiplier: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

// =============================================================================
// パース関数
// =============================================================================

/**
 * LTVモード判定の閾値
 */
const LTV_MODE_THRESHOLDS = {
  EARLY_ESTIMATE_DAYS_MIN: 60,
  MEASURED_DAYS_MIN: 120,
  EARLY_ESTIMATE_NEW_CUSTOMERS_MIN: 50,
  MEASURED_NEW_CUSTOMERS_MIN: 200,
};

/**
 * 発売日からの経過日数を計算
 */
function calculateDaysSinceLaunch(
  launchDate: Date | null,
  referenceDate: Date = new Date()
): number | null {
  if (!launchDate) {
    return null;
  }
  const diffMs = referenceDate.getTime() - launchDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * LTVモードを決定
 */
function determineLtvMode(
  daysSinceLaunch: number | null,
  newCustomersTotal: number
): LtvMode {
  const days = daysSinceLaunch ?? 0;

  // MEASUREDの条件
  if (
    days >= LTV_MODE_THRESHOLDS.MEASURED_DAYS_MIN &&
    newCustomersTotal >= LTV_MODE_THRESHOLDS.MEASURED_NEW_CUSTOMERS_MIN
  ) {
    return "MEASURED";
  }

  // EARLY_ESTIMATEの条件
  if (
    days >= LTV_MODE_THRESHOLDS.EARLY_ESTIMATE_DAYS_MIN &&
    newCustomersTotal >= LTV_MODE_THRESHOLDS.EARLY_ESTIMATE_NEW_CUSTOMERS_MIN
  ) {
    return "EARLY_ESTIMATE";
  }

  // デフォルトはASSUMED
  return "ASSUMED";
}

/**
 * 文字列からRevenueModelをパース
 */
function parseRevenueModel(value: string | null | undefined): RevenueModel {
  if (isValidRevenueModel(value)) {
    return value;
  }
  return PRODUCT_CONFIG_DEFAULTS.revenueModel;
}

/**
 * 文字列からLifecycleStateをパース
 */
function parseLifecycleState(value: string | null | undefined): LifecycleState {
  if (isValidLifecycleState(value)) {
    return value;
  }
  return PRODUCT_CONFIG_DEFAULTS.lifecycleState;
}

/**
 * 文字列からBusinessModeをパース
 */
function parseBusinessMode(value: string | null | undefined): BusinessMode {
  if (isValidBusinessMode(value)) {
    return value;
  }
  return PRODUCT_CONFIG_DEFAULTS.businessMode;
}

/**
 * 文字列からBrandTypeをパース
 */
function parseBrandType(value: string | null | undefined): BrandType {
  if (isValidBrandType(value)) {
    return value;
  }
  return PRODUCT_CONFIG_DEFAULTS.brandType;
}

/**
 * 文字列からExperimentGroupをパース
 */
function parseExperimentGroup(
  value: string | null | undefined
): ExperimentGroup {
  if (isValidExperimentGroup(value)) {
    return value;
  }
  return PRODUCT_CONFIG_DEFAULTS.experimentGroup;
}

/**
 * BigQueryの行からProductConfigを組み立てる
 */
function buildProductConfigFromRow(
  row: ProductConfigRow,
  referenceDate: Date = new Date()
): ProductConfig {
  const launchDate = row.launch_date ? new Date(row.launch_date) : null;
  const daysSinceLaunch = calculateDaysSinceLaunch(launchDate, referenceDate);
  const newCustomersTotal = row.new_customers_total ?? PRODUCT_CONFIG_DEFAULTS.newCustomersTotal;

  const ltvMode = determineLtvMode(daysSinceLaunch, newCustomersTotal);

  return {
    // 識別子
    profileId: row.profile_id ?? "",
    asin: row.asin,
    productId: row.product_id ?? undefined,
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
    marginRate: row.margin_rate ?? PRODUCT_CONFIG_DEFAULTS.marginRate,
    expectedRepeatOrdersAssumed:
      row.expected_repeat_orders_assumed ??
      PRODUCT_CONFIG_DEFAULTS.expectedRepeatOrdersAssumed,
    expectedRepeatOrdersMeasured: row.expected_repeat_orders_measured_180d,
    safetyFactorAssumed:
      row.safety_factor_assumed ?? PRODUCT_CONFIG_DEFAULTS.safetyFactorAssumed,
    safetyFactorMeasured:
      row.safety_factor_measured ?? PRODUCT_CONFIG_DEFAULTS.safetyFactorMeasured,

    // 日付情報
    launchDate,
    daysSinceLaunch,
    newCustomersTotal,

    // AUTO→EXACT関連
    autoExactEnabled:
      row.auto_exact_enabled ?? PRODUCT_CONFIG_DEFAULTS.autoExactEnabled,

    // 入札倍率
    maxBidMultiplier:
      row.max_bid_multiplier ?? PRODUCT_CONFIG_DEFAULTS.maxBidMultiplier,
    minBidMultiplier:
      row.min_bid_multiplier ?? PRODUCT_CONFIG_DEFAULTS.minBidMultiplier,

    // メタ情報
    notes: row.notes ?? undefined,
  };
}

// =============================================================================
// リポジトリ実装
// =============================================================================

/**
 * ProductConfigリポジトリを作成
 */
export function createProductConfigRepository(
  options: ProductConfigRepositoryOptions
): ProductConfigRepository {
  const bigquery = new BigQuery({ projectId: options.projectId });
  const { projectId, dataset } = options;
  const throwOnError = options.throwOnError ?? true;
  const logWarnings = options.logWarnings ?? true;

  let lastValidationResult: BulkValidationResult | null = null;

  /**
   * バリデーションを実行し、結果に応じて処理
   */
  function runValidation(configs: ProductConfig[]): void {
    lastValidationResult = validateAllProductConfigs(configs);

    if (lastValidationResult.hasWarning && logWarnings) {
      logger.warn("ProductConfig validation warnings detected", {
        warningCount: lastValidationResult.warningCount,
        affectedAsins: Object.keys(lastValidationResult.issuesByAsin),
      });
      logger.debug(formatBulkValidationResult(lastValidationResult));
    }

    if (lastValidationResult.hasError) {
      const errorMessage = `ProductConfig validation failed: ${lastValidationResult.errorCount} errors`;
      logger.error(errorMessage, {
        errorCount: lastValidationResult.errorCount,
        issuesByAsin: lastValidationResult.issuesByAsin,
      });

      if (throwOnError) {
        throw new Error(
          `${errorMessage}\n${formatBulkValidationResult(lastValidationResult)}`
        );
      }
    }

    if (!lastValidationResult.hasError && !lastValidationResult.hasWarning) {
      logger.info("ProductConfig validation completed successfully", {
        configCount: configs.length,
      });
    }
  }

  return {
    async loadAll(includeInactive = false): Promise<Map<string, ProductConfig>> {
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
          profile_id,
          auto_exact_enabled,
          max_bid_multiplier,
          min_bid_multiplier,
          notes,
          created_at,
          updated_at
        FROM \`${projectId}.${dataset}.product_config\`
        WHERE ${whereClause}
      `;

      try {
        const [rows] = await bigquery.query({
          query,
          location: "asia-northeast1",
        });

        const configs: ProductConfig[] = [];
        const configMap = new Map<string, ProductConfig>();

        for (const row of rows as ProductConfigRow[]) {
          const config = buildProductConfigFromRow(row);
          configs.push(config);
          configMap.set(config.asin, config);
        }

        // バリデーション実行
        runValidation(configs);

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
    },

    async getByAsin(
      profileId: string,
      asin: string
    ): Promise<ProductConfig | null> {
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
          profile_id,
          auto_exact_enabled,
          max_bid_multiplier,
          min_bid_multiplier,
          notes,
          created_at,
          updated_at
        FROM \`${projectId}.${dataset}.product_config\`
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
        const config = buildProductConfigFromRow(row);

        // profileIdが一致するか確認（profile_idがnullの場合は許容）
        if (config.profileId && config.profileId !== profileId) {
          logger.warn("Profile ID mismatch", {
            expected: profileId,
            actual: config.profileId,
            asin,
          });
        }

        // 単一設定のバリデーション
        const validationResult = validateProductConfig(config);
        if (!validationResult.ok && throwOnError) {
          throw new Error(
            `ProductConfig validation failed for ASIN ${asin}: ${validationResult.issues
              .map((i) => i.message)
              .join(", ")}`
          );
        }

        return config;
      } catch (error) {
        logger.error("Failed to load product config", {
          asin,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async getByAsins(
      profileId: string,
      asins: string[]
    ): Promise<Map<string, ProductConfig>> {
      if (asins.length === 0) {
        return new Map();
      }

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
          profile_id,
          auto_exact_enabled,
          max_bid_multiplier,
          min_bid_multiplier,
          notes,
          created_at,
          updated_at
        FROM \`${projectId}.${dataset}.product_config\`
        WHERE asin IN UNNEST(@asins)
          AND is_active = TRUE
      `;

      try {
        const [rows] = await bigquery.query({
          query,
          params: { asins },
          location: "asia-northeast1",
        });

        const configs: ProductConfig[] = [];
        const configMap = new Map<string, ProductConfig>();

        for (const row of rows as ProductConfigRow[]) {
          const config = buildProductConfigFromRow(row);
          configs.push(config);
          configMap.set(config.asin, config);
        }

        // バリデーション実行
        runValidation(configs);

        logger.info("Loaded product configs by ASINs", {
          requestedCount: asins.length,
          loadedCount: configMap.size,
        });

        return configMap;
      } catch (error) {
        logger.error("Failed to load product configs by ASINs", {
          asinCount: asins.length,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async getActiveAsins(): Promise<string[]> {
      const query = `
        SELECT asin
        FROM \`${projectId}.${dataset}.product_config\`
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
    },

    getLastValidationResult(): BulkValidationResult | null {
      return lastValidationResult;
    },
  };
}

// =============================================================================
// エクスポート
// =============================================================================

// デフォルトリポジトリインスタンス（遅延初期化用）
let defaultRepository: ProductConfigRepository | null = null;

/**
 * デフォルトのProductConfigリポジトリを取得
 * 環境変数からBigQuery設定を読み込む
 */
export function getDefaultProductConfigRepository(): ProductConfigRepository {
  if (defaultRepository) {
    return defaultRepository;
  }

  const projectId = process.env.BIGQUERY_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET_ID || "amazon_bid_engine";

  if (!projectId) {
    throw new Error(
      "BIGQUERY_PROJECT_ID environment variable is required for ProductConfigRepository"
    );
  }

  defaultRepository = createProductConfigRepository({
    projectId,
    dataset,
  });

  return defaultRepository;
}

/**
 * デフォルトリポジトリをリセット（テスト用）
 */
export function resetDefaultProductConfigRepository(): void {
  defaultRepository = null;
}

/**
 * 自動ガードレール計算モジュール
 *
 * 履歴データ（search_term_bid_buckets_30d）から ASIN × lifecycle_state 別に
 * min_bid / max_bid を自動計算し、product_guardrails_auto テーブルに保存
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  LifecycleState,
  ProductConfig,
  BidBucketRow,
  AutoGuardrailsConfig,
  AutoGuardrailsResult,
  DEFAULT_AUTO_GUARDRAILS_CONFIG,
  GuardrailsMode,
  DEFAULT_GUARDRAILS_MODE,
} from "../ltv/types";
import { loadAllProductConfigs, ProductConfigLoaderOptions } from "../config/productConfigLoader";
import { getTargetAcos } from "../ltv/ltv-calculator";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 自動ガードレール計算オプション
 */
export interface RecomputeGuardrailsOptions extends ProductConfigLoaderOptions {
  /** 自動ガードレール計算設定（省略時はデフォルト値） */
  config?: AutoGuardrailsConfig;
  /** 特定のASINのみ処理する場合 */
  targetAsins?: string[];
  /** ドライラン（テーブル更新しない） */
  dryRun?: boolean;
}

/**
 * 自動ガードレール計算結果サマリー
 */
export interface RecomputeGuardrailsResult {
  /** 処理された合計件数 */
  totalProcessed: number;
  /** HISTORICAL で計算された件数 */
  historicalCount: number;
  /** THEORETICAL で計算された件数 */
  theoreticalCount: number;
  /** FALLBACK で計算された件数 */
  fallbackCount: number;
  /** 計算結果の詳細 */
  results: AutoGuardrailsResult[];
  /** エラー情報 */
  errors: Array<{ asin: string; lifecycle_state: LifecycleState; error: string }>;
}

// =============================================================================
// 入札バケットデータ取得
// =============================================================================

/**
 * search_term_bid_buckets_30d ビューからバケットデータを取得
 */
async function fetchBidBuckets(
  options: ProductConfigLoaderOptions,
  asins?: string[]
): Promise<Map<string, BidBucketRow[]>> {
  const bigquery = new BigQuery({ projectId: options.projectId });

  const whereClause = asins && asins.length > 0
    ? "WHERE asin IN UNNEST(@asins)"
    : "";

  const query = `
    SELECT
      asin,
      lifecycle_state,
      bid_bucket,
      bid_bucket_lower,
      bid_bucket_upper,
      impressions_30d,
      clicks_30d,
      cost_30d,
      conversions_30d,
      revenue_30d,
      avg_bid_30d,
      cpc_30d,
      cvr_30d,
      acos_30d,
      record_count
    FROM \`${options.projectId}.${options.dataset}.search_term_bid_buckets_30d\`
    ${whereClause}
    ORDER BY asin, lifecycle_state, bid_bucket_lower
  `;

  try {
    const queryOptions = asins && asins.length > 0
      ? { query, params: { asins }, location: "asia-northeast1" }
      : { query, location: "asia-northeast1" };

    const [rows] = await bigquery.query(queryOptions);

    // ASIN+lifecycle_state をキーとしてグループ化
    const bucketMap = new Map<string, BidBucketRow[]>();

    for (const row of rows) {
      const key = `${row.asin}|${row.lifecycle_state}`;
      const bucket: BidBucketRow = {
        asin: row.asin,
        lifecycle_state: row.lifecycle_state as LifecycleState,
        bid_bucket: row.bid_bucket,
        bid_bucket_lower: Number(row.bid_bucket_lower),
        bid_bucket_upper: Number(row.bid_bucket_upper),
        impressions_30d: Number(row.impressions_30d ?? 0),
        clicks_30d: Number(row.clicks_30d ?? 0),
        cost_30d: Number(row.cost_30d ?? 0),
        conversions_30d: Number(row.conversions_30d ?? 0),
        revenue_30d: Number(row.revenue_30d ?? 0),
        avg_bid_30d: Number(row.avg_bid_30d ?? 0),
        cpc_30d: row.cpc_30d !== null ? Number(row.cpc_30d) : null,
        cvr_30d: row.cvr_30d !== null ? Number(row.cvr_30d) : null,
        acos_30d: row.acos_30d !== null ? Number(row.acos_30d) : null,
        record_count: Number(row.record_count ?? 0),
      };

      if (!bucketMap.has(key)) {
        bucketMap.set(key, []);
      }
      bucketMap.get(key)!.push(bucket);
    }

    logger.info("Fetched bid bucket data", {
      uniqueKeys: bucketMap.size,
      totalRows: rows.length,
    });

    return bucketMap;
  } catch (error) {
    logger.error("Failed to fetch bid bucket data", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// 有望バケット判定
// =============================================================================

/**
 * バケットが有望かどうかを判定
 *
 * Rule of Three 条件:
 * 1. clicks >= min_clicks_threshold
 * 2. acos <= target_acos * margin_acos
 * 3. cvr >= baseline_cvr * min_cvr_ratio
 */
function isPromisingBucket(
  bucket: BidBucketRow,
  targetAcos: number,
  config: AutoGuardrailsConfig
): boolean {
  // 条件1: 最小クリック数
  if (bucket.clicks_30d < config.min_clicks_threshold) {
    return false;
  }

  // 条件2: ACOS条件
  if (bucket.acos_30d === null || bucket.acos_30d > targetAcos * config.margin_acos) {
    return false;
  }

  // 条件3: CVR条件
  if (bucket.cvr_30d === null || bucket.cvr_30d < config.baseline_cvr_estimate * config.min_cvr_ratio) {
    return false;
  }

  return true;
}

/**
 * 有望バケットをフィルタリング
 */
function filterPromisingBuckets(
  buckets: BidBucketRow[],
  targetAcos: number,
  config: AutoGuardrailsConfig
): BidBucketRow[] {
  return buckets.filter((bucket) => isPromisingBucket(bucket, targetAcos, config));
}

// =============================================================================
// ガードレール計算
// =============================================================================

/**
 * 有望バケットからガードレールを計算（HISTORICAL）
 */
function calculateFromHistoricalBuckets(
  promisingBuckets: BidBucketRow[],
  lifecycleState: LifecycleState,
  config: AutoGuardrailsConfig
): { min_bid: number; max_bid: number; clicks_used: number } {
  // avg_bid でソート
  const sortedBuckets = [...promisingBuckets].sort(
    (a, b) => a.avg_bid_30d - b.avg_bid_30d
  );

  // 最小値と最大値を取得
  const minBucket = sortedBuckets[0];
  const maxBucket = sortedBuckets[sortedBuckets.length - 1];

  // ライフサイクル別の係数を適用
  const minBeta = config.min_beta[lifecycleState];
  const maxAlpha = config.max_alpha[lifecycleState];

  const min_bid = Math.round(minBucket.avg_bid_30d * minBeta);
  const max_bid = Math.round(maxBucket.avg_bid_30d * maxAlpha);

  // 合計クリック数
  const clicks_used = promisingBuckets.reduce((sum, b) => sum + b.clicks_30d, 0);

  return {
    min_bid: Math.max(min_bid, 1), // 最低1円
    max_bid: Math.max(max_bid, min_bid + 10), // min_bid より必ず大きく
    clicks_used,
  };
}

/**
 * CPC break-even からガードレールを計算（THEORETICAL）
 */
function calculateFromTheoretical(
  productConfig: ProductConfig,
  lifecycleState: LifecycleState,
  config: AutoGuardrailsConfig
): { min_bid: number; max_bid: number } {
  // cpc_break_even = price × target_acos × baseline_cvr_estimate
  // 価格が不明な場合は marginRate から逆算（仮定: 利益率30%で3000円程度）
  const estimatedPrice = productConfig.marginRate > 0
    ? 3000 / productConfig.marginRate
    : 3000;

  const targetAcos = getTargetAcos(productConfig);
  const cpcBreakEven = estimatedPrice * targetAcos * config.baseline_cvr_estimate;

  // ライフサイクル別の係数を適用
  const minBeta = config.min_beta[lifecycleState];
  const maxAlpha = config.max_alpha[lifecycleState];

  const min_bid = Math.round(cpcBreakEven * minBeta);
  const max_bid = Math.round(cpcBreakEven * maxAlpha);

  return {
    min_bid: Math.max(min_bid, 1),
    max_bid: Math.max(max_bid, min_bid + 10),
  };
}

/**
 * 単一 ASIN × lifecycle_state のガードレールを計算
 */
function computeGuardrailsForAsinLifecycle(
  asin: string,
  lifecycleState: LifecycleState,
  buckets: BidBucketRow[],
  productConfig: ProductConfig,
  config: AutoGuardrailsConfig
): AutoGuardrailsResult {
  const targetAcos = getTargetAcos(productConfig);

  // 有望バケットをフィルタリング
  const promisingBuckets = filterPromisingBuckets(buckets, targetAcos, config);

  // Rule 1: 有望バケットが存在する場合 → HISTORICAL
  if (promisingBuckets.length > 0) {
    const { min_bid, max_bid, clicks_used } = calculateFromHistoricalBuckets(
      promisingBuckets,
      lifecycleState,
      config
    );

    return {
      asin,
      lifecycle_state: lifecycleState,
      min_bid_auto: min_bid,
      max_bid_auto: max_bid,
      data_source: "HISTORICAL",
      clicks_used,
    };
  }

  // Rule 2: 有望バケットがないが、cpc_break_even を計算できる場合 → THEORETICAL
  if (productConfig.marginRate > 0) {
    const { min_bid, max_bid } = calculateFromTheoretical(
      productConfig,
      lifecycleState,
      config
    );

    return {
      asin,
      lifecycle_state: lifecycleState,
      min_bid_auto: min_bid,
      max_bid_auto: max_bid,
      data_source: "THEORETICAL",
      clicks_used: 0,
    };
  }

  // Rule 3: 完全なフォールバック
  return {
    asin,
    lifecycle_state: lifecycleState,
    min_bid_auto: config.fallback_min_bid,
    max_bid_auto: config.fallback_max_bid,
    data_source: "FALLBACK",
    clicks_used: 0,
  };
}

// =============================================================================
// BigQuery 保存
// =============================================================================

/**
 * 計算結果を product_guardrails_auto テーブルに保存（MERGE）
 */
async function saveGuardrailsToTable(
  options: ProductConfigLoaderOptions,
  results: AutoGuardrailsResult[]
): Promise<void> {
  if (results.length === 0) {
    logger.info("No guardrails to save");
    return;
  }

  const bigquery = new BigQuery({ projectId: options.projectId });

  // 一時テーブルに挿入してからMERGE
  const tempTableId = `temp_guardrails_${Date.now()}`;
  const tempTableRef = `${options.projectId}.${options.dataset}.${tempTableId}`;
  const targetTableRef = `${options.projectId}.${options.dataset}.product_guardrails_auto`;

  try {
    // 一時テーブル作成
    await bigquery.query({
      query: `
        CREATE TEMP TABLE \`${tempTableId}\` (
          asin STRING,
          lifecycle_state STRING,
          min_bid_auto NUMERIC,
          max_bid_auto NUMERIC,
          data_source STRING,
          clicks_used INT64
        )
      `,
      location: "asia-northeast1",
    });

    // データ挿入（バッチ）
    const values = results.map((r) =>
      `('${r.asin}', '${r.lifecycle_state}', ${r.min_bid_auto}, ${r.max_bid_auto}, '${r.data_source}', ${r.clicks_used})`
    ).join(",\n");

    await bigquery.query({
      query: `INSERT INTO \`${tempTableId}\` VALUES ${values}`,
      location: "asia-northeast1",
    });

    // MERGE で更新
    await bigquery.query({
      query: `
        MERGE \`${targetTableRef}\` AS target
        USING \`${tempTableId}\` AS source
        ON target.asin = source.asin AND target.lifecycle_state = source.lifecycle_state
        WHEN MATCHED THEN
          UPDATE SET
            min_bid_auto = source.min_bid_auto,
            max_bid_auto = source.max_bid_auto,
            data_source = source.data_source,
            clicks_used = source.clicks_used,
            updated_at = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN
          INSERT (asin, lifecycle_state, min_bid_auto, max_bid_auto, data_source, clicks_used, updated_at)
          VALUES (source.asin, source.lifecycle_state, source.min_bid_auto, source.max_bid_auto, source.data_source, source.clicks_used, CURRENT_TIMESTAMP())
      `,
      location: "asia-northeast1",
    });

    logger.info("Saved guardrails to BigQuery", {
      count: results.length,
    });
  } catch (error) {
    logger.error("Failed to save guardrails to BigQuery", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * 全商品の自動ガードレールを再計算
 *
 * 処理フロー:
 * 1. product_config から全 ASIN を取得
 * 2. search_term_bid_buckets_30d からバケットデータを取得
 * 3. 各 ASIN × lifecycle_state について:
 *    - 有望バケットがあれば HISTORICAL で計算
 *    - なければ THEORETICAL（cpc_break_even ベース）
 *    - それも無理なら FALLBACK
 * 4. 結果を product_guardrails_auto にMERGE
 */
export async function recomputeGuardrailsForAllProducts(
  options: RecomputeGuardrailsOptions
): Promise<RecomputeGuardrailsResult> {
  const config = options.config ?? DEFAULT_AUTO_GUARDRAILS_CONFIG;
  const allLifecycleStates: LifecycleState[] = [
    "LAUNCH_HARD",
    "LAUNCH_SOFT",
    "GROW",
    "HARVEST",
  ];

  const result: RecomputeGuardrailsResult = {
    totalProcessed: 0,
    historicalCount: 0,
    theoreticalCount: 0,
    fallbackCount: 0,
    results: [],
    errors: [],
  };

  try {
    // 1. 商品設定を取得
    logger.info("Loading product configs...");
    const productConfigs = await loadAllProductConfigs(options, true); // 非アクティブも含める

    // ターゲットASINでフィルタ
    const targetAsins = options.targetAsins ?? Array.from(productConfigs.keys());
    const filteredConfigs = new Map<string, ProductConfig>();
    for (const asin of targetAsins) {
      const cfg = productConfigs.get(asin);
      if (cfg) {
        filteredConfigs.set(asin, cfg);
      }
    }

    logger.info("Processing products", {
      totalConfigs: productConfigs.size,
      targetCount: filteredConfigs.size,
    });

    if (filteredConfigs.size === 0) {
      logger.warn("No products to process");
      return result;
    }

    // 2. バケットデータを取得
    logger.info("Fetching bid bucket data...");
    const bucketMap = await fetchBidBuckets(options, Array.from(filteredConfigs.keys()));

    // 3. 各 ASIN × lifecycle_state について計算
    for (const [asin, productConfig] of filteredConfigs) {
      for (const lifecycleState of allLifecycleStates) {
        try {
          const key = `${asin}|${lifecycleState}`;
          const buckets = bucketMap.get(key) ?? [];

          const guardrailResult = computeGuardrailsForAsinLifecycle(
            asin,
            lifecycleState,
            buckets,
            productConfig,
            config
          );

          result.results.push(guardrailResult);
          result.totalProcessed++;

          // カウント更新
          switch (guardrailResult.data_source) {
            case "HISTORICAL":
              result.historicalCount++;
              break;
            case "THEORETICAL":
              result.theoreticalCount++;
              break;
            case "FALLBACK":
              result.fallbackCount++;
              break;
          }
        } catch (error) {
          result.errors.push({
            asin,
            lifecycle_state: lifecycleState,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // 4. 結果を保存
    if (!options.dryRun && result.results.length > 0) {
      logger.info("Saving guardrails to BigQuery...");
      await saveGuardrailsToTable(options, result.results);
    } else if (options.dryRun) {
      logger.info("Dry run - skipping save to BigQuery");
    }

    logger.info("Guardrails recomputation completed", {
      totalProcessed: result.totalProcessed,
      historicalCount: result.historicalCount,
      theoreticalCount: result.theoreticalCount,
      fallbackCount: result.fallbackCount,
      errorCount: result.errors.length,
    });

    return result;
  } catch (error) {
    logger.error("Failed to recompute guardrails", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// 自動ガードレール取得
// =============================================================================

/**
 * product_guardrails_auto から自動ガードレールを取得
 */
export async function loadAutoGuardrails(
  options: ProductConfigLoaderOptions,
  asin: string,
  lifecycleState: LifecycleState
): Promise<AutoGuardrailsResult | null> {
  const bigquery = new BigQuery({ projectId: options.projectId });

  const query = `
    SELECT
      asin,
      lifecycle_state,
      min_bid_auto,
      max_bid_auto,
      data_source,
      clicks_used,
      updated_at
    FROM \`${options.projectId}.${options.dataset}.product_guardrails_auto\`
    WHERE asin = @asin AND lifecycle_state = @lifecycle_state
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asin, lifecycle_state: lifecycleState },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      asin: row.asin,
      lifecycle_state: row.lifecycle_state as LifecycleState,
      min_bid_auto: Number(row.min_bid_auto),
      max_bid_auto: Number(row.max_bid_auto),
      data_source: row.data_source as "HISTORICAL" | "THEORETICAL" | "FALLBACK",
      clicks_used: Number(row.clicks_used),
    };
  } catch (error) {
    logger.error("Failed to load auto guardrails", {
      asin,
      lifecycleState,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 複数 ASIN の自動ガードレールを一括取得
 */
export async function loadAutoGuardrailsBulk(
  options: ProductConfigLoaderOptions,
  asins: string[]
): Promise<Map<string, AutoGuardrailsResult>> {
  if (asins.length === 0) {
    return new Map();
  }

  const bigquery = new BigQuery({ projectId: options.projectId });

  const query = `
    SELECT
      asin,
      lifecycle_state,
      min_bid_auto,
      max_bid_auto,
      data_source,
      clicks_used,
      updated_at
    FROM \`${options.projectId}.${options.dataset}.product_guardrails_auto\`
    WHERE asin IN UNNEST(@asins)
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asins },
      location: "asia-northeast1",
    });

    // asin|lifecycle_state をキーとするMap
    const resultMap = new Map<string, AutoGuardrailsResult>();

    for (const row of rows) {
      const key = `${row.asin}|${row.lifecycle_state}`;
      resultMap.set(key, {
        asin: row.asin,
        lifecycle_state: row.lifecycle_state as LifecycleState,
        min_bid_auto: Number(row.min_bid_auto),
        max_bid_auto: Number(row.max_bid_auto),
        data_source: row.data_source as "HISTORICAL" | "THEORETICAL" | "FALLBACK",
        clicks_used: Number(row.clicks_used),
      });
    }

    logger.info("Loaded auto guardrails in bulk", {
      requestedAsins: asins.length,
      loadedRecords: resultMap.size,
    });

    return resultMap;
  } catch (error) {
    logger.error("Failed to load auto guardrails in bulk", {
      asinCount: asins.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// ガードレール適用
// =============================================================================

/**
 * ガードレール適用の入力パラメータ
 */
export interface ApplyGuardrailsInput {
  /** 推奨入札額 */
  recommendedBid: number;
  /** 現在の入札額 */
  currentBid: number;
  /** ASIN */
  asin: string;
  /** ライフサイクルステート */
  lifecycleState: LifecycleState;
  /** use_auto_min_max が有効か */
  useAutoMinMax: boolean;
  /** 自動ガードレール（事前に取得済み） */
  autoGuardrails?: AutoGuardrailsResult | null;
  /** デフォルトガードレール設定 */
  defaultGuardrails: {
    min_bid: number;
    max_bid: number;
    max_up_ratio: number;
    max_down_ratio: number;
  };
  /**
   * ガードレール適用モード
   * - OFF: 計算しない
   * - SHADOW: 計算するがログのみ（デフォルト）
   * - ENFORCE: 実際の入札値に適用する
   */
  guardrailsMode?: GuardrailsMode;
}

/**
 * ガードレール適用の結果
 */
export interface ApplyGuardrailsResult {
  /** ガードレール適用後の入札額 */
  clippedBid: number;
  /** クリップされたか */
  wasClipped: boolean;
  /** クリップ理由 */
  clipReason: string | null;
  /** 使用した min_bid */
  effectiveMinBid: number;
  /** 使用した max_bid */
  effectiveMaxBid: number;
  /** データソース（auto の場合） */
  autoDataSource: "HISTORICAL" | "THEORETICAL" | "FALLBACK" | null;
  /** 適用されたガードレールモード */
  guardrailsMode: GuardrailsMode;
  /**
   * ガードレールが実際に入札値に適用されるか
   * - ENFORCE かつ wasClipped が true の場合のみ true
   */
  guardrailsApplied: boolean;
}

/**
 * ガードレールを適用して入札額をクリップ
 *
 * 動作モード:
 * - OFF: 計算をスキップし、recommendedBid をそのまま返す
 * - SHADOW: 計算するがログのみ（guardrailsApplied = false）
 * - ENFORCE: 計算結果を実際に適用（guardrailsApplied = wasClipped）
 *
 * 適用順序:
 * 1. max_up_ratio / max_down_ratio による変動率制限
 * 2. min_bid / max_bid による絶対値制限
 *    - use_auto_min_max が true かつ auto ガードレールがある場合は auto を使用
 *    - それ以外は default を使用
 */
export function applyGuardrails(input: ApplyGuardrailsInput): ApplyGuardrailsResult {
  const {
    recommendedBid,
    currentBid,
    useAutoMinMax,
    autoGuardrails,
    defaultGuardrails,
    guardrailsMode = DEFAULT_GUARDRAILS_MODE,
  } = input;

  // OFF モードの場合は計算をスキップ
  if (guardrailsMode === "OFF") {
    return {
      clippedBid: Math.round(recommendedBid),
      wasClipped: false,
      clipReason: null,
      effectiveMinBid: defaultGuardrails.min_bid,
      effectiveMaxBid: defaultGuardrails.max_bid,
      autoDataSource: null,
      guardrailsMode,
      guardrailsApplied: false,
    };
  }

  let clippedBid = recommendedBid;
  let wasClipped = false;
  let clipReason: string | null = null;

  // 1. 変動率制限を適用
  const maxUpBid = currentBid * defaultGuardrails.max_up_ratio;
  const minDownBid = currentBid * defaultGuardrails.max_down_ratio;

  if (clippedBid > maxUpBid) {
    clippedBid = maxUpBid;
    wasClipped = true;
    clipReason = `max_up_ratio (${defaultGuardrails.max_up_ratio})`;
  } else if (clippedBid < minDownBid) {
    clippedBid = minDownBid;
    wasClipped = true;
    clipReason = `max_down_ratio (${defaultGuardrails.max_down_ratio})`;
  }

  // 2. min_bid / max_bid 制限を適用
  let effectiveMinBid: number;
  let effectiveMaxBid: number;
  let autoDataSource: "HISTORICAL" | "THEORETICAL" | "FALLBACK" | null = null;

  if (useAutoMinMax && autoGuardrails) {
    // 自動ガードレールを使用
    effectiveMinBid = autoGuardrails.min_bid_auto;
    effectiveMaxBid = autoGuardrails.max_bid_auto;
    autoDataSource = autoGuardrails.data_source;
  } else {
    // デフォルトガードレールを使用
    effectiveMinBid = defaultGuardrails.min_bid;
    effectiveMaxBid = defaultGuardrails.max_bid;
  }

  if (clippedBid < effectiveMinBid) {
    clippedBid = effectiveMinBid;
    wasClipped = true;
    clipReason = `min_bid (${effectiveMinBid}${autoDataSource ? ` [${autoDataSource}]` : ""})`;
  } else if (clippedBid > effectiveMaxBid) {
    clippedBid = effectiveMaxBid;
    wasClipped = true;
    clipReason = `max_bid (${effectiveMaxBid}${autoDataSource ? ` [${autoDataSource}]` : ""})`;
  }

  // 整数に丸める
  clippedBid = Math.round(clippedBid);

  // ENFORCE モードの場合のみ guardrailsApplied = true
  const guardrailsApplied = guardrailsMode === "ENFORCE" && wasClipped;

  return {
    clippedBid,
    wasClipped,
    clipReason,
    effectiveMinBid,
    effectiveMaxBid,
    autoDataSource,
    guardrailsMode,
    guardrailsApplied,
  };
}

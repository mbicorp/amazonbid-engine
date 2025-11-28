/**
 * ライフサイクルサジェストのProductConfigへの反映処理
 *
 * SEOメトリクスを取得し、サジェストを計算してProductConfigに反映する
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import { ProductConfig } from "../ltv/types";
import { getSeoMetricsForAsin, getSeoMetricsForAsins } from "../seo/seoMetrics";
import { SeoQueryConfig, SeoMetrics } from "../seo/types";
import {
  computeLifecycleSuggestion,
  LifecycleSuggestionInput,
  LifecycleSuggestionResult,
} from "./lifecycleSuggestion";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 追加メトリクスを取得するための設定
 */
export interface MetricsQueryConfig {
  projectId: string;
  dataset: string;
}

/**
 * 追加メトリクス（BigQueryから取得）
 */
export interface AdditionalMetrics {
  acosRecent: number | null;
  cvrRecent: number | null;
  cvrCategoryAvg: number | null;
  reviewCount: number | null;
  avgRating: number | null;
  daysOfInventory: number | null;
}

/**
 * サジェスト反映オプション
 */
export interface ApplySuggestionOptions {
  isBeforeBigSale?: boolean;
  referenceDate?: Date;
}

// =============================================================================
// メトリクス取得
// =============================================================================

/**
 * BigQueryから追加メトリクスを取得
 *
 * @param config - BigQuery接続設定
 * @param asin - ASIN
 * @returns 追加メトリクス
 */
export async function fetchAdditionalMetrics(
  config: MetricsQueryConfig,
  asin: string
): Promise<AdditionalMetrics> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  // 複数テーブルからメトリクスを取得
  // 実際のテーブル構造に合わせて調整が必要
  const query = `
    WITH recent_metrics AS (
      -- 直近30日のACOS/CVRを取得（テーブル名は仮）
      SELECT
        asin,
        AVG(acos) as acos_recent,
        AVG(cvr) as cvr_recent
      FROM \`${config.projectId}.${config.dataset}.keyword_metrics_60d\`
      WHERE asin = @asin
        AND date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      GROUP BY asin
    ),
    category_avg AS (
      -- カテゴリ平均CVR（テーブル名は仮）
      SELECT
        p.asin,
        AVG(k.cvr) as cvr_category_avg
      FROM \`${config.projectId}.${config.dataset}.product_strategy\` p
      JOIN \`${config.projectId}.${config.dataset}.keyword_metrics_60d\` k
        ON p.category = (
          SELECT category FROM \`${config.projectId}.${config.dataset}.product_strategy\`
          WHERE asin = @asin
          LIMIT 1
        )
      WHERE k.date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      GROUP BY p.asin
      HAVING p.asin = @asin
    ),
    product_info AS (
      -- 商品情報（レビュー数、評価、在庫日数）
      SELECT
        asin,
        review_count,
        avg_rating,
        days_of_inventory
      FROM \`${config.projectId}.${config.dataset}.product_strategy\`
      WHERE asin = @asin
    )
    SELECT
      COALESCE(r.acos_recent, NULL) as acos_recent,
      COALESCE(r.cvr_recent, NULL) as cvr_recent,
      COALESCE(c.cvr_category_avg, NULL) as cvr_category_avg,
      COALESCE(p.review_count, NULL) as review_count,
      COALESCE(p.avg_rating, NULL) as avg_rating,
      COALESCE(p.days_of_inventory, NULL) as days_of_inventory
    FROM (SELECT @asin as asin) base
    LEFT JOIN recent_metrics r ON base.asin = r.asin
    LEFT JOIN category_avg c ON base.asin = c.asin
    LEFT JOIN product_info p ON base.asin = p.asin
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asin },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      return {
        acosRecent: null,
        cvrRecent: null,
        cvrCategoryAvg: null,
        reviewCount: null,
        avgRating: null,
        daysOfInventory: null,
      };
    }

    const row = rows[0];
    return {
      acosRecent: row.acos_recent ?? null,
      cvrRecent: row.cvr_recent ?? null,
      cvrCategoryAvg: row.cvr_category_avg ?? null,
      reviewCount: row.review_count ?? null,
      avgRating: row.avg_rating ?? null,
      daysOfInventory: row.days_of_inventory ?? null,
    };
  } catch (error) {
    logger.warn("Failed to fetch additional metrics", {
      asin,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      acosRecent: null,
      cvrRecent: null,
      cvrCategoryAvg: null,
      reviewCount: null,
      avgRating: null,
      daysOfInventory: null,
    };
  }
}

// =============================================================================
// サジェスト反映
// =============================================================================

/**
 * 単一商品にサジェストを反映
 *
 * @param config - BigQuery接続設定
 * @param product - 商品設定
 * @param options - オプション
 * @returns サジェストが反映されたProductConfig
 */
export async function applySuggestionToProduct(
  config: SeoQueryConfig & MetricsQueryConfig,
  product: ProductConfig,
  options: ApplySuggestionOptions = {}
): Promise<ProductConfig> {
  const { isBeforeBigSale = false, referenceDate = new Date() } = options;

  // SEOメトリクスを取得
  const seoMetrics = await getSeoMetricsForAsin(
    config,
    product.asin,
    referenceDate
  );

  // 追加メトリクスを取得
  const additionalMetrics = await fetchAdditionalMetrics(config, product.asin);

  // サジェスト入力を構築
  const input: LifecycleSuggestionInput = {
    product,
    seo: seoMetrics,
    acosRecent: additionalMetrics.acosRecent,
    cvrRecent: additionalMetrics.cvrRecent,
    cvrCategoryAvg: additionalMetrics.cvrCategoryAvg,
    reviewCount: additionalMetrics.reviewCount,
    avgRating: additionalMetrics.avgRating,
    daysOfInventory: additionalMetrics.daysOfInventory,
    isBeforeBigSale,
  };

  // サジェストを計算
  const suggestion = computeLifecycleSuggestion(input);

  // ProductConfigに反映（lifecycle_stateは変更しない）
  return {
    ...product,
    lifecycleSuggestedState: suggestion.suggestedState,
    lastLifecycleSuggestedReason: suggestion.reason,
  };
}

/**
 * 複数商品にサジェストを一括反映
 *
 * @param config - BigQuery接続設定
 * @param products - 商品設定リスト
 * @param options - オプション
 * @returns サジェストが反映されたProductConfigリスト
 */
export async function applySuggestionToProducts(
  config: SeoQueryConfig & MetricsQueryConfig,
  products: ProductConfig[],
  options: ApplySuggestionOptions = {}
): Promise<ProductConfig[]> {
  const { isBeforeBigSale = false, referenceDate = new Date() } = options;

  if (products.length === 0) {
    return [];
  }

  // ASINリストを取得
  const asins = products.map((p) => p.asin);

  // SEOメトリクスを一括取得
  const seoMetricsMap = await getSeoMetricsForAsins(
    config,
    asins,
    referenceDate
  );

  // 各商品にサジェストを反映
  const results: ProductConfig[] = [];

  for (const product of products) {
    const seoMetrics = seoMetricsMap.get(product.asin) ?? {
      asin: product.asin,
      currentRank: null,
      prevRank: null,
      rankTrend: null,
      rankStatus: "UNKNOWN" as const,
      rankZone: "UNKNOWN" as const,
    };

    // 追加メトリクスを取得（個別に取得）
    const additionalMetrics = await fetchAdditionalMetrics(config, product.asin);

    const input: LifecycleSuggestionInput = {
      product,
      seo: seoMetrics,
      acosRecent: additionalMetrics.acosRecent,
      cvrRecent: additionalMetrics.cvrRecent,
      cvrCategoryAvg: additionalMetrics.cvrCategoryAvg,
      reviewCount: additionalMetrics.reviewCount,
      avgRating: additionalMetrics.avgRating,
      daysOfInventory: additionalMetrics.daysOfInventory,
      isBeforeBigSale,
    };

    const suggestion = computeLifecycleSuggestion(input);

    results.push({
      ...product,
      lifecycleSuggestedState: suggestion.suggestedState,
      lastLifecycleSuggestedReason: suggestion.reason,
    });
  }

  logger.info("Applied lifecycle suggestions", {
    productCount: products.length,
    suggestionsApplied: results.filter((r) => r.lifecycleSuggestedState).length,
  });

  return results;
}

/**
 * サジェスト結果をBigQueryに保存
 *
 * @param config - BigQuery接続設定
 * @param products - サジェスト済み商品リスト
 */
export async function saveSuggestionsToDatabase(
  config: MetricsQueryConfig,
  products: ProductConfig[]
): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const rows = products
    .filter((p) => p.lifecycleSuggestedState != null)
    .map((p) => ({
      asin: p.asin,
      product_id: p.productId,
      current_lifecycle_state: p.lifecycleState,
      suggested_lifecycle_state: p.lifecycleSuggestedState,
      suggestion_reason: p.lastLifecycleSuggestedReason,
      suggested_at: new Date().toISOString(),
    }));

  if (rows.length === 0) {
    logger.info("No suggestions to save");
    return;
  }

  try {
    await bigquery
      .dataset(config.dataset)
      .table("lifecycle_suggestions")
      .insert(rows);

    logger.info("Saved lifecycle suggestions", {
      count: rows.length,
    });
  } catch (error) {
    logger.error("Failed to save lifecycle suggestions", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

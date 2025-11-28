/**
 * ライフサイクル状態更新ジョブ
 *
 * 各商品の月次データとSEOスコアを評価し、
 * ライフサイクルステージの遷移を実行
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../../logger";
import {
  LifecycleStage,
  ProductStrategy,
  MonthlyProfit,
  SeoScore,
  LifecycleTransitionInput,
  LifecycleTransitionResult,
  LifecycleConfig,
  DEFAULT_LIFECYCLE_CONFIG,
} from "../../lifecycle/types";
import {
  evaluateLifecycleTransition,
  checkGlobalSafety,
  checkInvestmentExtension,
} from "../../lifecycle/transition-logic";
import {
  notifyLifecycleChange,
  notifyForcedHarvest,
  notifyLifecycleUpdateSummary,
  LifecycleChange,
  HarvestAlert,
} from "../../lib/lifecycleNotifier";

interface UpdaterConfig {
  projectId: string;
  dataset: string;
  dryRun?: boolean;
  lifecycleConfig?: LifecycleConfig;
}

interface TransitionRecord {
  product_id: string;
  old_stage: LifecycleStage;
  new_stage: LifecycleStage;
  transition_reason: string;
  extended_months: number | null;
  warnings: string[];
  force_harvest: boolean;
}

/**
 * 商品戦略データを取得
 */
async function fetchProductStrategies(
  bigquery: BigQuery,
  config: UpdaterConfig
): Promise<ProductStrategy[]> {
  const query = `
    SELECT
      product_id,
      lifecycle_stage,
      strategy_pattern,
      sustainable_tacos,
      invest_tacos_cap,
      invest_max_loss_per_month_jpy,
      invest_max_months_base,
      invest_max_months_dynamic,
      invest_start_date,
      profit_margin,
      unit_price_jpy,
      reinvest_allowed,
      product_group_id,
      review_rating,
      review_count,
      brand_keywords,
      product_core_terms,
      created_at,
      updated_at
    FROM \`${config.projectId}.${config.dataset}.product_strategy\`
    WHERE lifecycle_stage IS NOT NULL
  `;

  const [results] = await bigquery.query({
    query,
    location: "asia-northeast1",
  });

  return results.map((row: Record<string, unknown>) => ({
    ...row,
    invest_start_date: row.invest_start_date ? new Date(row.invest_start_date as string) : null,
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
    brand_keywords: row.brand_keywords || [],
    product_core_terms: row.product_core_terms || [],
  })) as ProductStrategy[];
}

/**
 * 月次利益データを取得（直近2ヶ月分）
 */
async function fetchMonthlyProfits(
  bigquery: BigQuery,
  config: UpdaterConfig,
  productIds: string[]
): Promise<Map<string, MonthlyProfit[]>> {
  if (productIds.length === 0) return new Map();

  const query = `
    SELECT
      product_id,
      year_month,
      revenue_total_jpy,
      cogs_total_jpy,
      gross_profit_before_ads_jpy,
      ad_spend_total_jpy,
      ad_sales_total_jpy,
      tacos_monthly,
      acos_monthly,
      roas_monthly,
      net_profit_monthly,
      net_profit_cumulative,
      months_since_launch
    FROM \`${config.projectId}.${config.dataset}.monthly_profit_by_product\`
    WHERE product_id IN UNNEST(@productIds)
    AND year_month >= FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH))
    ORDER BY product_id, year_month DESC
  `;

  const [results] = await bigquery.query({
    query,
    params: { productIds },
    location: "asia-northeast1",
  });

  const profitMap = new Map<string, MonthlyProfit[]>();

  for (const row of results) {
    const productId = row.product_id as string;
    if (!profitMap.has(productId)) {
      profitMap.set(productId, []);
    }
    profitMap.get(productId)!.push(row as MonthlyProfit);
  }

  return profitMap;
}

/**
 * SEOスコアを取得（直近月）
 */
async function fetchSeoScores(
  bigquery: BigQuery,
  config: UpdaterConfig,
  productIds: string[]
): Promise<Map<string, SeoScore>> {
  if (productIds.length === 0) return new Map();

  const query = `
    SELECT
      product_id,
      year_month,
      seo_score,
      seo_score_trend,
      seo_score_prev_month,
      seo_score_change,
      brand_score,
      core_score,
      support_score,
      longtail_score,
      brand_keyword_count,
      core_keyword_count,
      support_keyword_count,
      longtail_keyword_count,
      total_keyword_count,
      avg_organic_rank,
      best_organic_rank,
      worst_organic_rank,
      keywords_in_top10,
      keywords_in_top20,
      seo_level
    FROM \`${config.projectId}.${config.dataset}.seo_score_by_product\`
    WHERE product_id IN UNNEST(@productIds)
    AND year_month = (
      SELECT MAX(year_month) FROM \`${config.projectId}.${config.dataset}.seo_score_by_product\`
    )
  `;

  const [results] = await bigquery.query({
    query,
    params: { productIds },
    location: "asia-northeast1",
  });

  const scoreMap = new Map<string, SeoScore>();

  for (const row of results) {
    scoreMap.set(row.product_id as string, row as SeoScore);
  }

  return scoreMap;
}

/**
 * ライフサイクルステージを更新
 */
async function updateProductStrategy(
  bigquery: BigQuery,
  config: UpdaterConfig,
  productId: string,
  newStage: LifecycleStage,
  newDynamicMonths: number | null,
  reason: string
): Promise<void> {
  const strategyPattern = newStage.toLowerCase() as
    | "launch_hard"
    | "launch_soft"
    | "grow"
    | "harvest";

  const query = `
    UPDATE \`${config.projectId}.${config.dataset}.product_strategy\`
    SET
      lifecycle_stage = @newStage,
      strategy_pattern = @strategyPattern,
      invest_max_months_dynamic = @newDynamicMonths,
      updated_at = CURRENT_TIMESTAMP()
    WHERE product_id = @productId
  `;

  await bigquery.query({
    query,
    params: {
      productId,
      newStage,
      strategyPattern,
      newDynamicMonths,
    },
    location: "asia-northeast1",
  });

  logger.info("Product strategy updated", {
    productId,
    newStage,
    newDynamicMonths,
    reason,
  });
}

/**
 * 遷移履歴をログテーブルに記録
 */
async function logTransition(
  bigquery: BigQuery,
  config: UpdaterConfig,
  record: TransitionRecord
): Promise<void> {
  // 遷移ログテーブルが存在する場合は記録
  // 存在しない場合はloggerにのみ記録
  logger.info("Lifecycle transition recorded", {
    ...record,
    warnings: record.warnings.join("; "),
  });
}

/**
 * ライフサイクル状態更新を実行
 */
export async function runLifecycleUpdate(
  config: UpdaterConfig
): Promise<{
  processedCount: number;
  transitionCount: number;
  forceHarvestCount: number;
  extensionCount: number;
  transitions: TransitionRecord[];
}> {
  const bigquery = new BigQuery({ projectId: config.projectId });
  const lifecycleConfig = config.lifecycleConfig || DEFAULT_LIFECYCLE_CONFIG;

  logger.info("Starting lifecycle update job", {
    projectId: config.projectId,
    dataset: config.dataset,
    dryRun: config.dryRun,
  });

  // 1. 商品戦略データを取得
  const products = await fetchProductStrategies(bigquery, config);
  logger.info(`Fetched ${products.length} products`);

  if (products.length === 0) {
    return {
      processedCount: 0,
      transitionCount: 0,
      forceHarvestCount: 0,
      extensionCount: 0,
      transitions: [],
    };
  }

  const productIds = products.map((p) => p.product_id);

  // 2. 月次利益データとSEOスコアを取得
  const [profitMap, seoScoreMap] = await Promise.all([
    fetchMonthlyProfits(bigquery, config, productIds),
    fetchSeoScores(bigquery, config, productIds),
  ]);

  // 3. 各商品の遷移を評価
  const transitions: TransitionRecord[] = [];
  let transitionCount = 0;
  let forceHarvestCount = 0;
  let extensionCount = 0;

  for (const product of products) {
    const profits = profitMap.get(product.product_id) || [];
    const seoScore = seoScoreMap.get(product.product_id);

    if (profits.length === 0) {
      logger.warn(`No profit data for product ${product.product_id}, skipping`);
      continue;
    }

    const currentProfit = profits[0];
    const prevProfit = profits[1];

    // SEOスコアがない場合はデフォルト値を使用
    const effectiveSeoScore: SeoScore = seoScore || {
      product_id: product.product_id,
      year_month: currentProfit.year_month,
      seo_score: 0,
      seo_score_trend: "FLAT",
      seo_score_prev_month: null,
      seo_score_change: null,
      brand_score: null,
      core_score: null,
      support_score: null,
      longtail_score: null,
      brand_keyword_count: 0,
      core_keyword_count: 0,
      support_keyword_count: 0,
      longtail_keyword_count: 0,
      total_keyword_count: 0,
      avg_organic_rank: null,
      best_organic_rank: null,
      worst_organic_rank: null,
      keywords_in_top10: 0,
      keywords_in_top20: 0,
      seo_level: "LOW",
    };

    // 遷移判定
    const input: LifecycleTransitionInput = {
      product,
      monthlyProfit: currentProfit,
      seoScore: effectiveSeoScore,
      prevMonthlyProfit: prevProfit,
      globalCumulativeLossLimit: lifecycleConfig.safety.global_cumulative_loss_limit,
    };

    const result = evaluateLifecycleTransition(
      input,
      profits,
      lifecycleConfig
    );

    // 遷移が必要な場合
    if (result.should_transition || result.extend_investment) {
      const record: TransitionRecord = {
        product_id: product.product_id,
        old_stage: result.current_stage,
        new_stage: result.recommended_stage,
        transition_reason: result.transition_reason,
        extended_months: result.extend_investment
          ? result.new_invest_max_months_dynamic
          : null,
        warnings: result.warnings,
        force_harvest: result.force_harvest,
      };

      transitions.push(record);

      if (result.should_transition) {
        transitionCount++;
      }
      if (result.force_harvest) {
        forceHarvestCount++;
      }
      if (result.extend_investment) {
        extensionCount++;
      }

      // 実際の更新
      if (!config.dryRun) {
        await updateProductStrategy(
          bigquery,
          config,
          product.product_id,
          result.recommended_stage,
          result.new_invest_max_months_dynamic,
          result.transition_reason
        );
        await logTransition(bigquery, config, record);

        // Slack通知を送信
        if (result.should_transition) {
          const change: LifecycleChange = {
            productId: product.product_id,
            fromStage: result.current_stage,
            toStage: result.recommended_stage,
            reason: result.transition_reason,
            seoScore: effectiveSeoScore.seo_score,
            monthlyProfit: currentProfit.net_profit_monthly,
          };
          await notifyLifecycleChange(change);
        }

        // 強制HARVESTの場合は追加アラート
        if (result.force_harvest) {
          const alert: HarvestAlert = {
            productId: product.product_id,
            trigger: detectForcedHarvestTrigger(result, product, currentProfit, prevProfit),
            details: result.transition_reason,
            cumulativeLoss: (currentProfit.net_profit_cumulative ?? 0) < 0
              ? (currentProfit.net_profit_cumulative ?? undefined)
              : undefined,
            consecutiveLossMonths: countConsecutiveLossMonths(profits),
            reviewScore: product.review_rating ?? undefined,
            reviewCount: product.review_count ?? undefined,
          };
          await notifyForcedHarvest(alert);
        }
      } else {
        logger.info("[DRY RUN] Would update product", {
          product_id: record.product_id,
          old_stage: record.old_stage,
          new_stage: record.new_stage,
          transition_reason: record.transition_reason,
        });
      }
    }
  }

  const summary = {
    processedCount: products.length,
    transitionCount,
    forceHarvestCount,
    extensionCount,
    transitions,
  };

  logger.info("Lifecycle update job completed", summary);

  // ジョブ完了サマリーを通知
  await notifyLifecycleUpdateSummary({
    totalProducts: products.length,
    transitioned: transitionCount,
    forcedHarvest: forceHarvestCount,
    errors: 0,
    dryRun: config.dryRun ?? false,
  });

  return summary;
}

/**
 * 強制HARVESTのトリガータイプを検出
 */
function detectForcedHarvestTrigger(
  result: LifecycleTransitionResult,
  product: ProductStrategy,
  currentProfit: MonthlyProfit,
  prevProfit: MonthlyProfit | undefined
): HarvestAlert["trigger"] {
  // レビュー崩壊チェック
  if (
    product.review_rating !== null &&
    product.review_count !== null &&
    product.review_rating < 3.0 &&
    product.review_count >= 20
  ) {
    return "review_collapse";
  }

  // 累積赤字上限チェック
  if ((currentProfit.net_profit_cumulative ?? 0) < -2_000_000) {
    return "cumulative_loss";
  }

  // 連続赤字チェック
  if (
    currentProfit.net_profit_monthly < 0 &&
    prevProfit &&
    prevProfit.net_profit_monthly < 0
  ) {
    return "consecutive_loss";
  }

  // デフォルト
  return "cumulative_loss";
}

/**
 * 連続赤字月数をカウント
 */
function countConsecutiveLossMonths(profits: MonthlyProfit[]): number {
  let count = 0;
  for (const profit of profits) {
    if (profit.net_profit_monthly < 0) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * 特定商品のライフサイクルを手動で変更
 */
export async function manualLifecycleChange(
  config: UpdaterConfig,
  productId: string,
  newStage: LifecycleStage,
  reason: string
): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  logger.info("Manual lifecycle change requested", {
    productId,
    newStage,
    reason,
  });

  if (config.dryRun) {
    logger.info("[DRY RUN] Would change lifecycle", {
      productId,
      newStage,
      reason,
    });
    return;
  }

  await updateProductStrategy(bigquery, config, productId, newStage, null, reason);
}

/**
 * CLI実行用
 */
async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET || "amazon_bid_engine";
  const dryRun = process.argv.includes("--dry-run");

  if (!projectId) {
    console.error("Error: GOOGLE_CLOUD_PROJECT_ID environment variable is required");
    process.exit(1);
  }

  console.log("=== Lifecycle Update Job ===");
  console.log(`Project: ${projectId}`);
  console.log(`Dataset: ${dataset}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log("");

  const result = await runLifecycleUpdate({
    projectId,
    dataset,
    dryRun,
  });

  console.log("\n=== Results ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.transitions.length > 0) {
    console.log("\n=== Transitions ===");
    for (const t of result.transitions) {
      console.log(`  ${t.product_id}: ${t.old_stage} → ${t.new_stage}`);
      console.log(`    Reason: ${t.transition_reason}`);
      if (t.warnings.length > 0) {
        console.log(`    Warnings: ${t.warnings.join(", ")}`);
      }
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}

/**
 * 月次利益集計ジョブ
 *
 * daily_sales_by_product と daily_ads_by_product を集計し、
 * 月次利益データを計算（VIEWの更新をトリガー）
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../../logger";

interface AggregatorConfig {
  projectId: string;
  dataset: string;
  dryRun?: boolean;
}

/**
 * 月次利益データを取得（VIEWからの読み取り）
 *
 * monthly_profit_by_product はVIEWとして定義されているため、
 * このジョブは主にデータの整合性チェックと集計サマリーの生成を行う
 */
export async function getMonthlyProfitSummary(
  config: AggregatorConfig,
  yearMonth?: string
): Promise<{
  totalProducts: number;
  profitableProducts: number;
  lossProducts: number;
  totalNetProfit: number;
  averageTacos: number;
}> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const targetMonth = yearMonth || `FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY))`;

  const query = `
    SELECT
      COUNT(DISTINCT product_id) as total_products,
      COUNTIF(net_profit_monthly > 0) as profitable_products,
      COUNTIF(net_profit_monthly <= 0) as loss_products,
      SUM(net_profit_monthly) as total_net_profit,
      AVG(tacos_monthly) as average_tacos
    FROM \`${config.projectId}.${config.dataset}.monthly_profit_by_product\`
    WHERE year_month = ${yearMonth ? `'${yearMonth}'` : targetMonth}
  `;

  logger.info("Fetching monthly profit summary", {
    projectId: config.projectId,
    dataset: config.dataset,
    targetMonth,
  });

  const [results] = await bigquery.query({
    query,
    location: "asia-northeast1",
  });

  const summary = results[0] || {
    total_products: 0,
    profitable_products: 0,
    loss_products: 0,
    total_net_profit: 0,
    average_tacos: 0,
  };

  const result = {
    totalProducts: summary.total_products,
    profitableProducts: summary.profitable_products,
    lossProducts: summary.loss_products,
    totalNetProfit: Math.round(summary.total_net_profit),
    averageTacos: Math.round(summary.average_tacos * 1000) / 1000,
  };

  logger.info("Monthly profit summary retrieved", result);

  return result;
}

/**
 * 商品別の月次利益詳細を取得
 */
export async function getProductMonthlyProfit(
  config: AggregatorConfig,
  productId: string,
  months: number = 12
): Promise<
  Array<{
    year_month: string;
    revenue_total_jpy: number;
    ad_spend_total_jpy: number;
    net_profit_monthly: number;
    net_profit_cumulative: number | null;
    tacos_monthly: number | null;
    months_since_launch: number | null;
  }>
> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT
      year_month,
      revenue_total_jpy,
      ad_spend_total_jpy,
      net_profit_monthly,
      net_profit_cumulative,
      tacos_monthly,
      months_since_launch
    FROM \`${config.projectId}.${config.dataset}.monthly_profit_by_product\`
    WHERE product_id = @productId
    ORDER BY year_month DESC
    LIMIT @months
  `;

  const [results] = await bigquery.query({
    query,
    params: { productId, months },
    location: "asia-northeast1",
  });

  return results.reverse();
}

/**
 * 連続赤字月数を計算
 */
export async function getConsecutiveLossMonths(
  config: AggregatorConfig,
  productId: string
): Promise<number> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    WITH ordered_months AS (
      SELECT
        year_month,
        net_profit_monthly,
        ROW_NUMBER() OVER (ORDER BY year_month DESC) as row_num
      FROM \`${config.projectId}.${config.dataset}.monthly_profit_by_product\`
      WHERE product_id = @productId
      ORDER BY year_month DESC
    ),
    streak AS (
      SELECT
        year_month,
        net_profit_monthly,
        row_num,
        CASE WHEN net_profit_monthly < 0 THEN 1 ELSE 0 END as is_loss
      FROM ordered_months
    )
    SELECT
      COUNT(*) as consecutive_loss_months
    FROM (
      SELECT
        row_num,
        is_loss,
        SUM(CASE WHEN is_loss = 0 THEN 1 ELSE 0 END) OVER (ORDER BY row_num) as break_group
      FROM streak
    )
    WHERE break_group = 0 AND is_loss = 1
  `;

  const [results] = await bigquery.query({
    query,
    params: { productId },
    location: "asia-northeast1",
  });

  return results[0]?.consecutive_loss_months || 0;
}

/**
 * 累積赤字額を取得（投資開始からの合計）
 */
export async function getCumulativeLoss(
  config: AggregatorConfig,
  productId: string,
  investStartDate?: string
): Promise<number> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  let whereClause = "product_id = @productId";
  const params: Record<string, string> = { productId };

  if (investStartDate) {
    whereClause += " AND year_month >= @startMonth";
    params.startMonth = investStartDate.substring(0, 7); // YYYY-MM形式
  }

  const query = `
    SELECT
      SUM(CASE WHEN net_profit_monthly < 0 THEN net_profit_monthly ELSE 0 END) as cumulative_loss
    FROM \`${config.projectId}.${config.dataset}.monthly_profit_by_product\`
    WHERE ${whereClause}
  `;

  const [results] = await bigquery.query({
    query,
    params,
    location: "asia-northeast1",
  });

  return Math.abs(results[0]?.cumulative_loss || 0);
}

/**
 * 投資フェーズの商品一覧と現在のステータスを取得
 */
export async function getInvestingProducts(
  config: AggregatorConfig
): Promise<
  Array<{
    product_id: string;
    lifecycle_stage: string;
    months_since_launch: number;
    invest_max_months_dynamic: number;
    net_profit_cumulative: number;
    current_tacos: number;
    sustainable_tacos: number;
  }>
> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT
      ps.product_id,
      ps.lifecycle_stage,
      mp.months_since_launch,
      ps.invest_max_months_dynamic,
      mp.net_profit_cumulative,
      mp.tacos_monthly as current_tacos,
      ps.sustainable_tacos
    FROM \`${config.projectId}.${config.dataset}.product_strategy\` ps
    JOIN (
      SELECT *
      FROM \`${config.projectId}.${config.dataset}.monthly_profit_by_product\`
      WHERE year_month = (
        SELECT MAX(year_month) FROM \`${config.projectId}.${config.dataset}.monthly_profit_by_product\`
      )
    ) mp ON ps.product_id = mp.product_id
    WHERE ps.lifecycle_stage IN ('LAUNCH_HARD', 'LAUNCH_SOFT')
    ORDER BY mp.net_profit_cumulative ASC
  `;

  const [results] = await bigquery.query({
    query,
    location: "asia-northeast1",
  });

  return results;
}

/**
 * 月次データの整合性チェック
 */
export async function validateMonthlyData(
  config: AggregatorConfig,
  yearMonth: string
): Promise<{
  valid: boolean;
  issues: string[];
}> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const issues: string[] = [];

  // 1. 売上データの存在確認
  const salesCheckQuery = `
    SELECT COUNT(DISTINCT product_id) as product_count
    FROM \`${config.projectId}.${config.dataset}.daily_sales_by_product\`
    WHERE FORMAT_DATE('%Y-%m', report_date) = @yearMonth
  `;

  const [salesResults] = await bigquery.query({
    query: salesCheckQuery,
    params: { yearMonth },
    location: "asia-northeast1",
  });

  if (salesResults[0]?.product_count === 0) {
    issues.push(`No sales data found for ${yearMonth}`);
  }

  // 2. 広告データの存在確認
  const adsCheckQuery = `
    SELECT COUNT(DISTINCT product_id) as product_count
    FROM \`${config.projectId}.${config.dataset}.daily_ads_by_product\`
    WHERE FORMAT_DATE('%Y-%m', report_date) = @yearMonth
  `;

  const [adsResults] = await bigquery.query({
    query: adsCheckQuery,
    params: { yearMonth },
    location: "asia-northeast1",
  });

  if (adsResults[0]?.product_count === 0) {
    issues.push(`No ads data found for ${yearMonth}`);
  }

  // 3. 異常値チェック（TACOS > 200%）
  const anomalyCheckQuery = `
    SELECT
      product_id,
      tacos_monthly
    FROM \`${config.projectId}.${config.dataset}.monthly_profit_by_product\`
    WHERE year_month = @yearMonth
    AND tacos_monthly > 2.0
  `;

  const [anomalyResults] = await bigquery.query({
    query: anomalyCheckQuery,
    params: { yearMonth },
    location: "asia-northeast1",
  });

  if (anomalyResults.length > 0) {
    issues.push(
      `${anomalyResults.length} products have TACOS > 200%: ${anomalyResults
        .slice(0, 3)
        .map((r: Record<string, unknown>) => r.product_id)
        .join(", ")}${anomalyResults.length > 3 ? "..." : ""}`
    );
  }

  logger.info("Monthly data validation completed", {
    yearMonth,
    valid: issues.length === 0,
    issueCount: issues.length,
  });

  return {
    valid: issues.length === 0,
    issues,
  };
}

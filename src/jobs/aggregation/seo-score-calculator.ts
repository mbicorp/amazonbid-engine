/**
 * SEOスコア計算ジョブ
 *
 * seo_keywords_by_productの順位データを基に
 * 各商品のSEOスコア（0-100）を計算してseo_score_by_productに保存
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../../logger";

interface CalculatorConfig {
  projectId: string;
  dataset: string;
  dryRun?: boolean;
}

/**
 * SEOスコア計算の重み設定
 */
interface ScoreWeights {
  brand: number;
  core: number;
  support: number;
  longtail_experiment: number;
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  brand: 0.30,           // ブランドKWは30%
  core: 0.40,            // コアKWは40%
  support: 0.20,         // サポートKWは20%
  longtail_experiment: 0.10,  // ロングテールは10%
};

/**
 * 順位をスコアに変換する関数
 * rank 1-3: 100点
 * rank 4-10: 線形減衰で70-99点
 * rank 11-20: 線形減衰で40-69点
 * rank 21-50: 線形減衰で10-39点
 * rank 51+: 線形減衰で0-9点
 * NULL: 0点
 */
function getRankScoreFormula(): string {
  return `
    CASE
      WHEN organic_rank IS NULL THEN 0
      WHEN organic_rank <= 3 THEN 100
      WHEN organic_rank <= 10 THEN 100 - (organic_rank - 3) * 4.29  -- 70-99
      WHEN organic_rank <= 20 THEN 70 - (organic_rank - 10) * 3    -- 40-69
      WHEN organic_rank <= 50 THEN 40 - (organic_rank - 20) * 1    -- 10-39
      ELSE GREATEST(0, 10 - (organic_rank - 50) * 0.2)             -- 0-9
    END
  `;
}

/**
 * SEOスコア計算クエリを生成
 */
function generateScoreQuery(
  config: CalculatorConfig,
  weights: ScoreWeights = DEFAULT_WEIGHTS
): string {
  const { projectId, dataset } = config;
  const rankScoreFormula = getRankScoreFormula();

  return `
-- SEOスコア計算
-- 各商品のキーワード順位からSEOスコア（0-100）を計算

DECLARE target_month STRING DEFAULT FORMAT_DATE('%Y-%m', CURRENT_DATE());

-- 1. 既存の当月データを削除
DELETE FROM \`${projectId}.${dataset}.seo_score_by_product\`
WHERE year_month = target_month;

-- 2. SEOスコアを計算して挿入
INSERT INTO \`${projectId}.${dataset}.seo_score_by_product\`
(
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
)
WITH
-- キーワード別スコアを計算
keyword_scores AS (
  SELECT
    product_id,
    keyword,
    role,
    organic_rank,
    ${rankScoreFormula} AS rank_score
  FROM \`${projectId}.${dataset}.seo_keywords_by_product\`
  WHERE selected_flag = TRUE
),

-- 役割別スコアを集計
role_scores AS (
  SELECT
    product_id,
    -- 役割別の平均スコア
    AVG(CASE WHEN role = 'brand' THEN rank_score END) AS brand_score,
    AVG(CASE WHEN role = 'core' THEN rank_score END) AS core_score,
    AVG(CASE WHEN role = 'support' THEN rank_score END) AS support_score,
    AVG(CASE WHEN role = 'longtail_experiment' THEN rank_score END) AS longtail_score,
    -- 役割別のキーワード数
    COUNTIF(role = 'brand') AS brand_keyword_count,
    COUNTIF(role = 'core') AS core_keyword_count,
    COUNTIF(role = 'support') AS support_keyword_count,
    COUNTIF(role = 'longtail_experiment') AS longtail_keyword_count,
    COUNT(*) AS total_keyword_count,
    -- 順位統計
    AVG(organic_rank) AS avg_organic_rank,
    MIN(organic_rank) AS best_organic_rank,
    MAX(organic_rank) AS worst_organic_rank,
    COUNTIF(organic_rank <= 10) AS keywords_in_top10,
    COUNTIF(organic_rank <= 20) AS keywords_in_top20
  FROM keyword_scores
  GROUP BY product_id
),

-- 重み付きSEOスコアを計算
weighted_scores AS (
  SELECT
    r.*,
    -- 重み付きスコア計算（各役割に実際のキーワードがある場合のみ重みを適用）
    (
      COALESCE(r.brand_score, 0) * ${weights.brand} * (CASE WHEN r.brand_keyword_count > 0 THEN 1 ELSE 0 END) +
      COALESCE(r.core_score, 0) * ${weights.core} * (CASE WHEN r.core_keyword_count > 0 THEN 1 ELSE 0 END) +
      COALESCE(r.support_score, 0) * ${weights.support} * (CASE WHEN r.support_keyword_count > 0 THEN 1 ELSE 0 END) +
      COALESCE(r.longtail_score, 0) * ${weights.longtail_experiment} * (CASE WHEN r.longtail_keyword_count > 0 THEN 1 ELSE 0 END)
    ) / NULLIF(
      ${weights.brand} * (CASE WHEN r.brand_keyword_count > 0 THEN 1 ELSE 0 END) +
      ${weights.core} * (CASE WHEN r.core_keyword_count > 0 THEN 1 ELSE 0 END) +
      ${weights.support} * (CASE WHEN r.support_keyword_count > 0 THEN 1 ELSE 0 END) +
      ${weights.longtail_experiment} * (CASE WHEN r.longtail_keyword_count > 0 THEN 1 ELSE 0 END),
      0
    ) AS seo_score
  FROM role_scores r
),

-- 前月スコアを取得
prev_month_scores AS (
  SELECT
    product_id,
    seo_score AS prev_seo_score
  FROM \`${projectId}.${dataset}.seo_score_by_product\`
  WHERE year_month = FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))
),

-- 3ヶ月前のスコアを取得（トレンド計算用）
three_months_ago AS (
  SELECT
    product_id,
    seo_score AS score_3m_ago
  FROM \`${projectId}.${dataset}.seo_score_by_product\`
  WHERE year_month = FORMAT_DATE('%Y-%m', DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH))
)

-- 最終結果
SELECT
  w.product_id,
  target_month AS year_month,
  ROUND(w.seo_score, 2) AS seo_score,
  -- トレンド計算（3ヶ月の傾き）
  CASE
    WHEN t.score_3m_ago IS NULL THEN 'FLAT'
    WHEN w.seo_score - t.score_3m_ago > 5 THEN 'UP'
    WHEN w.seo_score - t.score_3m_ago < -5 THEN 'DOWN'
    ELSE 'FLAT'
  END AS seo_score_trend,
  p.prev_seo_score AS seo_score_prev_month,
  ROUND(w.seo_score - COALESCE(p.prev_seo_score, w.seo_score), 2) AS seo_score_change,
  ROUND(w.brand_score, 2) AS brand_score,
  ROUND(w.core_score, 2) AS core_score,
  ROUND(w.support_score, 2) AS support_score,
  ROUND(w.longtail_score, 2) AS longtail_score,
  w.brand_keyword_count,
  w.core_keyword_count,
  w.support_keyword_count,
  w.longtail_keyword_count,
  w.total_keyword_count,
  ROUND(w.avg_organic_rank, 1) AS avg_organic_rank,
  w.best_organic_rank,
  w.worst_organic_rank,
  w.keywords_in_top10,
  w.keywords_in_top20,
  -- SEOレベル判定
  CASE
    WHEN w.seo_score >= 70 THEN 'HIGH'
    WHEN w.seo_score >= 40 THEN 'MID'
    ELSE 'LOW'
  END AS seo_level
FROM weighted_scores w
LEFT JOIN prev_month_scores p ON w.product_id = p.product_id
LEFT JOIN three_months_ago t ON w.product_id = t.product_id;
`;
}

/**
 * SEOスコア計算を実行
 */
export async function runSeoScoreCalculation(
  config: CalculatorConfig,
  weights: ScoreWeights = DEFAULT_WEIGHTS
): Promise<{
  processedCount: number;
  avgScore: number;
  distribution: { HIGH: number; MID: number; LOW: number };
}> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  logger.info("Starting SEO score calculation", {
    projectId: config.projectId,
    dataset: config.dataset,
    weights,
    dryRun: config.dryRun,
  });

  const query = generateScoreQuery(config, weights);

  if (config.dryRun) {
    logger.info("[DRY RUN] Would execute score calculation query", {
      queryPreview: query.substring(0, 500) + "...",
    });
    return {
      processedCount: 0,
      avgScore: 0,
      distribution: { HIGH: 0, MID: 0, LOW: 0 },
    };
  }

  try {
    const [job] = await bigquery.createQueryJob({
      query,
      location: "asia-northeast1",
    });

    logger.info("Score calculation job created", { jobId: job.id });

    await job.getQueryResults();

    // 結果の集計
    const summaryQuery = `
      SELECT
        COUNT(*) as total_count,
        AVG(seo_score) as avg_score,
        COUNTIF(seo_level = 'HIGH') as high_count,
        COUNTIF(seo_level = 'MID') as mid_count,
        COUNTIF(seo_level = 'LOW') as low_count
      FROM \`${config.projectId}.${config.dataset}.seo_score_by_product\`
      WHERE year_month = FORMAT_DATE('%Y-%m', CURRENT_DATE())
    `;
    const [summaryResults] = await bigquery.query(summaryQuery);

    const summary = summaryResults[0] || {
      total_count: 0,
      avg_score: 0,
      high_count: 0,
      mid_count: 0,
      low_count: 0,
    };

    const result = {
      processedCount: summary.total_count,
      avgScore: Math.round(summary.avg_score * 100) / 100,
      distribution: {
        HIGH: summary.high_count,
        MID: summary.mid_count,
        LOW: summary.low_count,
      },
    };

    logger.info("SEO score calculation completed", result);

    return result;
  } catch (error) {
    logger.error("SEO score calculation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 特定商品のSEOスコア履歴を取得
 */
export async function getSeoScoreHistory(
  config: CalculatorConfig,
  productId: string,
  months: number = 12
): Promise<
  Array<{
    year_month: string;
    seo_score: number;
    seo_level: string;
    seo_score_trend: string;
  }>
> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT
      year_month,
      seo_score,
      seo_level,
      seo_score_trend
    FROM \`${config.projectId}.${config.dataset}.seo_score_by_product\`
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

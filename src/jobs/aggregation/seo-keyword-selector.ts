/**
 * SEOキーワード選定ジョブ
 *
 * keyword_metrics_60dから最新データを取得し、
 * 各商品のSEO追跡対象キーワードを選定してseo_keywords_by_productに保存
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../../logger";

interface SelectorConfig {
  projectId: string;
  dataset: string;
  dryRun?: boolean;
}

/**
 * キーワード選定基準
 */
interface SelectionCriteria {
  // 各ロールで選定するキーワード数
  brand_count: number;
  core_count: number;
  support_count: number;
  longtail_count: number;
}

const DEFAULT_CRITERIA: SelectionCriteria = {
  brand_count: 5,      // ブランドKWは最大5個
  core_count: 10,      // コアKWは最大10個
  support_count: 15,   // サポートKWは最大15個
  longtail_count: 10,  // ロングテールは最大10個
};

/**
 * SEOキーワード選定クエリを生成
 */
function generateSelectionQuery(
  config: SelectorConfig,
  criteria: SelectionCriteria = DEFAULT_CRITERIA
): string {
  const { projectId, dataset } = config;

  return `
-- SEOキーワード選定
-- 各商品について、カテゴリ別にパフォーマンススコア上位のキーワードを選定

DECLARE current_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP();

-- 1. 既存の選定を非アクティブ化（deselected_atを設定）
UPDATE \`${projectId}.${dataset}.seo_keywords_by_product\`
SET
  selected_flag = FALSE,
  deselected_at = current_ts
WHERE selected_flag = TRUE;

-- 2. 新規選定キーワードを挿入/更新
MERGE INTO \`${projectId}.${dataset}.seo_keywords_by_product\` AS target
USING (
  WITH ranked_keywords AS (
    SELECT
      product_id,
      keyword,
      category AS role,
      volume_score,
      traffic_score,
      -- パフォーマンススコアはカテゴリに応じて使い分け
      CASE category
        WHEN 'brand' THEN 1.0  -- ブランドは常に最優先
        WHEN 'core' THEN performance_core_score
        WHEN 'support' THEN performance_support_score
        WHEN 'longtail_experiment' THEN performance_longtail_score
        ELSE 0.5
      END AS performance_score,
      search_volume,
      -- ランク付け
      ROW_NUMBER() OVER (
        PARTITION BY product_id, category
        ORDER BY
          CASE category
            WHEN 'brand' THEN 1.0
            WHEN 'core' THEN performance_core_score
            WHEN 'support' THEN performance_support_score
            WHEN 'longtail_experiment' THEN performance_longtail_score
            ELSE 0.5
          END DESC,
          search_volume DESC NULLS LAST
      ) AS rank_in_category
    FROM \`${projectId}.${dataset}.keyword_metrics_60d\`
    WHERE period_end = (
      SELECT MAX(period_end) FROM \`${projectId}.${dataset}.keyword_metrics_60d\`
    )
    AND has_sufficient_data = TRUE
  )
  SELECT
    product_id,
    keyword,
    role,
    volume_score,
    traffic_score,
    performance_score,
    search_volume,
    -- 選定理由を生成
    CONCAT(
      'Selected as top ', rank_in_category,
      ' ', role, ' keyword',
      ' (perf_score: ', ROUND(COALESCE(performance_score, 0), 3), ')',
      CASE WHEN search_volume IS NOT NULL
        THEN CONCAT(' (vol: ', search_volume, ')')
        ELSE ''
      END
    ) AS selection_reason
  FROM ranked_keywords
  WHERE
    (role = 'brand' AND rank_in_category <= ${criteria.brand_count})
    OR (role = 'core' AND rank_in_category <= ${criteria.core_count})
    OR (role = 'support' AND rank_in_category <= ${criteria.support_count})
    OR (role = 'longtail_experiment' AND rank_in_category <= ${criteria.longtail_count})
) AS source
ON target.product_id = source.product_id AND target.keyword = source.keyword

-- 既存レコードを更新
WHEN MATCHED THEN UPDATE SET
  role = source.role,
  selected_flag = TRUE,
  selection_reason = source.selection_reason,
  volume_score = source.volume_score,
  traffic_score = source.traffic_score,
  performance_score = source.performance_score,
  search_volume = source.search_volume,
  selected_at = current_ts,
  deselected_at = NULL

-- 新規レコードを挿入
WHEN NOT MATCHED THEN INSERT (
  product_id,
  keyword,
  role,
  selected_flag,
  selection_reason,
  volume_score,
  traffic_score,
  performance_score,
  search_volume,
  selected_at,
  deselected_at,
  organic_rank,
  sponsored_rank
) VALUES (
  source.product_id,
  source.keyword,
  source.role,
  TRUE,
  source.selection_reason,
  source.volume_score,
  source.traffic_score,
  source.performance_score,
  source.search_volume,
  current_ts,
  NULL,
  NULL,
  NULL
);
`;
}

/**
 * SEOキーワード選定を実行
 */
export async function runSeoKeywordSelection(
  config: SelectorConfig,
  criteria: SelectionCriteria = DEFAULT_CRITERIA
): Promise<{
  selectedCount: number;
  byRole: Record<string, number>;
}> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  logger.info("Starting SEO keyword selection", {
    projectId: config.projectId,
    dataset: config.dataset,
    criteria,
    dryRun: config.dryRun,
  });

  const query = generateSelectionQuery(config, criteria);

  if (config.dryRun) {
    logger.info("[DRY RUN] Would execute selection query", {
      queryPreview: query.substring(0, 500) + "...",
    });
    return { selectedCount: 0, byRole: {} };
  }

  try {
    const [job] = await bigquery.createQueryJob({
      query,
      location: "asia-northeast1",
    });

    logger.info("Selection job created", { jobId: job.id });

    await job.getQueryResults();

    // 選定結果の集計
    const summaryQuery = `
      SELECT
        role,
        COUNT(*) as count
      FROM \`${config.projectId}.${config.dataset}.seo_keywords_by_product\`
      WHERE selected_flag = TRUE
      GROUP BY role
    `;
    const [summaryResults] = await bigquery.query(summaryQuery);

    const byRole: Record<string, number> = {};
    let selectedCount = 0;

    for (const row of summaryResults) {
      byRole[row.role] = row.count;
      selectedCount += row.count;
    }

    logger.info("SEO keyword selection completed", {
      selectedCount,
      byRole,
    });

    return { selectedCount, byRole };
  } catch (error) {
    logger.error("SEO keyword selection failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 手動でキーワードを選定に追加
 */
export async function addManualKeyword(
  config: SelectorConfig,
  productId: string,
  keyword: string,
  role: string,
  reason: string = "Manual selection"
): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    MERGE INTO \`${config.projectId}.${config.dataset}.seo_keywords_by_product\` AS target
    USING (
      SELECT
        @productId AS product_id,
        @keyword AS keyword,
        @role AS role,
        @reason AS selection_reason
    ) AS source
    ON target.product_id = source.product_id AND target.keyword = source.keyword
    WHEN MATCHED THEN UPDATE SET
      role = source.role,
      selected_flag = TRUE,
      selection_reason = source.selection_reason,
      selected_at = CURRENT_TIMESTAMP(),
      deselected_at = NULL
    WHEN NOT MATCHED THEN INSERT (
      product_id,
      keyword,
      role,
      selected_flag,
      selection_reason,
      selected_at
    ) VALUES (
      source.product_id,
      source.keyword,
      source.role,
      TRUE,
      source.selection_reason,
      CURRENT_TIMESTAMP()
    )
  `;

  await bigquery.query({
    query,
    params: { productId, keyword, role, reason },
    location: "asia-northeast1",
  });

  logger.info("Manual keyword added", { productId, keyword, role });
}

/**
 * キーワードを選定から除外
 */
export async function removeKeyword(
  config: SelectorConfig,
  productId: string,
  keyword: string
): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    UPDATE \`${config.projectId}.${config.dataset}.seo_keywords_by_product\`
    SET
      selected_flag = FALSE,
      deselected_at = CURRENT_TIMESTAMP()
    WHERE product_id = @productId AND keyword = @keyword
  `;

  await bigquery.query({
    query,
    params: { productId, keyword },
    location: "asia-northeast1",
  });

  logger.info("Keyword removed from selection", { productId, keyword });
}

/**
 * 実行履歴ダッシュボード用APIエンドポイント
 *
 * - GET /admin/executions - 実行一覧
 * - GET /admin/executions/:executionId/asin-summary - ASIN別サマリー
 * - GET /admin/executions/:executionId/keyword-details - キーワード詳細
 */

import { Router, Request, Response } from "express";
import { BigQuery } from "@google-cloud/bigquery";
import { BIGQUERY } from "../constants";
import { logger } from "../logger";

const router = Router();

// BigQueryクライアント
const bigquery = new BigQuery({
  projectId: process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID,
});

const datasetId = process.env.BIGQUERY_DATASET_ID || BIGQUERY.DATASET_ID;
const projectId = process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID;

// =============================================================================
// 型定義
// =============================================================================

interface ExecutionListItem {
  execution_id: string;
  profile_id: string;
  execution_type: string;
  mode: string;
  status: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  total_keywords: number;
  reco_count: number;
  action_strong_up: number;
  action_up: number;
  action_down: number;
  action_stop: number;
  action_keep: number;
  note: string | null;
}

interface AsinSummaryItem {
  execution_id: string;
  profile_id: string;
  execution_type: string;
  mode: string;
  started_at: string;
  execution_status: string;
  asin: string;
  total_keywords: number;
  action_up_count: number;
  action_down_count: number;
  action_keep_count: number;
  avg_bid_change_ratio: number;
  max_bid_change_ratio: number;
  min_bid_change_ratio: number;
  total_bid_change: number;
  total_impressions: number;
  total_clicks: number;
  total_orders: number;
  total_sales: number;
  total_cost: number;
  calculated_acos: number | null;
  calculated_cvr: number | null;
  auto_exact_candidates: number;
}

interface KeywordDetailItem {
  execution_id: string;
  profile_id: string;
  execution_type: string;
  mode: string;
  started_at: string;
  execution_status: string;
  keyword_id: string;
  keyword_text: string | null;
  match_type: string | null;
  campaign_id: string;
  ad_group_id: string;
  asin: string | null;
  lifecycle_state: string | null;
  current_bid: number;
  recommended_bid: number;
  bid_change: number;
  bid_change_ratio: number;
  target_acos: number | null;
  reason_codes: string | null;
  impressions: number | null;
  clicks: number | null;
  orders: number | null;
  sales: number | null;
  cost: number | null;
  cvr: number | null;
  acos: number | null;
  is_auto_exact_candidate: boolean;
  suggested_exact_keyword: string | null;
  auto_exact_confidence: number | null;
  auto_exact_reason: string | null;
  created_at: string;
}

// =============================================================================
// GET /admin/executions - 実行一覧
// =============================================================================

router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const profileId = req.query.profile_id as string | undefined;
    const executionType = req.query.execution_type as string | undefined;

    let whereClause = "WHERE 1=1";
    const params: Record<string, string | number> = { limit, offset };

    if (profileId) {
      whereClause += " AND profile_id = @profileId";
      params.profileId = profileId;
    }

    if (executionType) {
      whereClause += " AND execution_type = @executionType";
      params.executionType = executionType;
    }

    const query = `
      SELECT
        execution_id,
        profile_id,
        execution_type,
        mode,
        status,
        started_at,
        finished_at AS ended_at,
        duration_ms,
        total_keywords,
        reco_count,
        action_strong_up,
        action_up,
        action_down,
        action_stop,
        action_keep,
        note
      FROM \`${projectId}.${datasetId}.${BIGQUERY.EXECUTIONS_TABLE_ID}\`
      ${whereClause}
      ORDER BY started_at DESC
      LIMIT @limit
      OFFSET @offset
    `;

    logger.debug("Querying executions list", { limit, offset, profileId, executionType });

    const [rows] = await bigquery.query({ query, params });
    const executions = rows as ExecutionListItem[];

    // 総件数を取得
    const countQuery = `
      SELECT COUNT(*) as total
      FROM \`${projectId}.${datasetId}.${BIGQUERY.EXECUTIONS_TABLE_ID}\`
      ${whereClause}
    `;
    const [countRows] = await bigquery.query({ query: countQuery, params });
    const total = (countRows[0] as { total: number }).total;

    res.json({
      success: true,
      data: executions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + executions.length < total,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch executions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: "Failed to fetch executions",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// =============================================================================
// GET /admin/executions/:executionId/asin-summary - ASIN別サマリー
// =============================================================================

router.get("/:executionId/asin-summary", async (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    // ビューを使わず直接クエリ（ビューがデプロイされていない場合のフォールバック）
    const query = `
      SELECT
        e.execution_id,
        e.profile_id,
        e.execution_type,
        e.mode,
        e.started_at,
        e.status AS execution_status,
        br.asin,
        COUNT(DISTINCT br.keyword_id) AS total_keywords,
        COUNTIF(br.bid_change > 0) AS action_up_count,
        COUNTIF(br.bid_change < 0) AS action_down_count,
        COUNTIF(br.bid_change = 0) AS action_keep_count,
        AVG(br.bid_change_ratio) AS avg_bid_change_ratio,
        MAX(br.bid_change_ratio) AS max_bid_change_ratio,
        MIN(br.bid_change_ratio) AS min_bid_change_ratio,
        SUM(br.bid_change) AS total_bid_change,
        SUM(br.impressions) AS total_impressions,
        SUM(br.clicks) AS total_clicks,
        SUM(br.orders) AS total_orders,
        SUM(br.sales) AS total_sales,
        SUM(br.cost) AS total_cost,
        SAFE_DIVIDE(SUM(br.cost), SUM(br.sales)) AS calculated_acos,
        SAFE_DIVIDE(SUM(br.orders), SUM(br.clicks)) AS calculated_cvr,
        COALESCE(aeps.auto_exact_candidates, 0) AS auto_exact_candidates
      FROM
        \`${projectId}.${datasetId}.${BIGQUERY.EXECUTIONS_TABLE_ID}\` e
      INNER JOIN
        \`${projectId}.${datasetId}.${BIGQUERY.BID_RECOMMENDATIONS_TABLE_ID}\` br
        ON e.execution_id = br.execution_id
      LEFT JOIN (
        SELECT
          execution_id,
          asin,
          COUNT(*) AS auto_exact_candidates
        FROM
          \`${projectId}.${datasetId}.${BIGQUERY.AUTO_EXACT_PROMOTION_SUGGESTIONS_TABLE_ID}\`
        GROUP BY execution_id, asin
      ) aeps
        ON br.execution_id = aeps.execution_id
        AND br.asin = aeps.asin
      WHERE
        e.execution_id = @executionId
        AND br.asin IS NOT NULL
      GROUP BY
        e.execution_id,
        e.profile_id,
        e.execution_type,
        e.mode,
        e.started_at,
        e.status,
        br.asin,
        aeps.auto_exact_candidates
      ORDER BY
        total_keywords DESC
      LIMIT @limit
      OFFSET @offset
    `;

    logger.debug("Querying ASIN summary", { executionId, limit, offset });

    const [rows] = await bigquery.query({
      query,
      params: { executionId, limit, offset },
    });
    const summaries = rows as AsinSummaryItem[];

    // 総ASIN数を取得
    const countQuery = `
      SELECT COUNT(DISTINCT br.asin) as total
      FROM \`${projectId}.${datasetId}.${BIGQUERY.BID_RECOMMENDATIONS_TABLE_ID}\` br
      WHERE br.execution_id = @executionId
      AND br.asin IS NOT NULL
    `;
    const [countRows] = await bigquery.query({
      query: countQuery,
      params: { executionId },
    });
    const total = (countRows[0] as { total: number }).total;

    res.json({
      success: true,
      data: summaries,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + summaries.length < total,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch ASIN summary", {
      executionId: req.params.executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: "Failed to fetch ASIN summary",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// =============================================================================
// GET /admin/executions/:executionId/keyword-details - キーワード詳細
// =============================================================================

router.get("/:executionId/keyword-details", async (req: Request, res: Response) => {
  try {
    const { executionId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const asin = req.query.asin as string | undefined;
    const autoExactOnly = req.query.auto_exact_only === "true";

    let whereClause = "WHERE e.execution_id = @executionId";
    const params: Record<string, string | number | boolean> = { executionId, limit, offset };

    if (asin) {
      whereClause += " AND br.asin = @asin";
      params.asin = asin;
    }

    if (autoExactOnly) {
      whereClause += " AND aeps.source_keyword_id IS NOT NULL";
    }

    // ビューを使わず直接クエリ
    const query = `
      SELECT
        e.execution_id,
        e.profile_id,
        e.execution_type,
        e.mode,
        e.started_at,
        e.status AS execution_status,
        br.keyword_id,
        br.keyword_text,
        br.match_type,
        br.campaign_id,
        br.ad_group_id,
        br.asin,
        br.lifecycle_state,
        br.current_bid,
        br.recommended_bid,
        br.bid_change,
        br.bid_change_ratio,
        br.target_acos,
        br.reason_codes,
        br.impressions,
        br.clicks,
        br.orders,
        br.sales,
        br.cost,
        br.cvr,
        br.acos,
        CASE
          WHEN aeps.source_keyword_id IS NOT NULL THEN TRUE
          ELSE FALSE
        END AS is_auto_exact_candidate,
        aeps.exact_keyword AS suggested_exact_keyword,
        aeps.confidence_score AS auto_exact_confidence,
        aeps.reason AS auto_exact_reason,
        br.created_at
      FROM
        \`${projectId}.${datasetId}.${BIGQUERY.EXECUTIONS_TABLE_ID}\` e
      INNER JOIN
        \`${projectId}.${datasetId}.${BIGQUERY.BID_RECOMMENDATIONS_TABLE_ID}\` br
        ON e.execution_id = br.execution_id
      LEFT JOIN
        \`${projectId}.${datasetId}.${BIGQUERY.AUTO_EXACT_PROMOTION_SUGGESTIONS_TABLE_ID}\` aeps
        ON br.execution_id = aeps.execution_id
        AND br.keyword_id = aeps.source_keyword_id
      ${whereClause}
      ORDER BY
        br.asin,
        br.bid_change_ratio DESC
      LIMIT @limit
      OFFSET @offset
    `;

    logger.debug("Querying keyword details", { executionId, limit, offset, asin, autoExactOnly });

    const [rows] = await bigquery.query({ query, params });
    const details = rows as KeywordDetailItem[];

    // 総件数を取得
    let countWhereClause = "WHERE br.execution_id = @executionId";
    if (asin) {
      countWhereClause += " AND br.asin = @countAsin";
      params.countAsin = asin;
    }

    const countQuery = `
      SELECT COUNT(*) as total
      FROM \`${projectId}.${datasetId}.${BIGQUERY.BID_RECOMMENDATIONS_TABLE_ID}\` br
      ${autoExactOnly ? `
      INNER JOIN \`${projectId}.${datasetId}.${BIGQUERY.AUTO_EXACT_PROMOTION_SUGGESTIONS_TABLE_ID}\` aeps
        ON br.execution_id = aeps.execution_id
        AND br.keyword_id = aeps.source_keyword_id
      ` : ""}
      ${countWhereClause}
    `;
    const [countRows] = await bigquery.query({ query: countQuery, params });
    const total = (countRows[0] as { total: number }).total;

    res.json({
      success: true,
      data: details,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + details.length < total,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch keyword details", {
      executionId: req.params.executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      error: "Failed to fetch keyword details",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;

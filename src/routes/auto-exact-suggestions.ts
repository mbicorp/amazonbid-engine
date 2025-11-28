/**
 * AUTO→EXACT 昇格候補 管理 API ルート
 *
 * 候補の一覧取得、承認、却下を行うエンドポイント
 * Amazon Ads API への適用は別のエンドポイントで行う（将来実装）
 */

import { Router, Request, Response } from "express";
import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import { PromotionSuggestionStatus } from "../auto-exact/types";
import {
  applyApprovedAutoExactPromotions,
  loadAutoExactApplyConfig,
} from "../auto-exact/auto-exact-applier";

const router = Router();

// =============================================================================
// 設定
// =============================================================================

function getConfig() {
  return {
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || "",
    dataset: process.env.BIGQUERY_DATASET || "amazon_bid_engine",
  };
}

function getBigQueryClient(projectId: string): BigQuery {
  return new BigQuery({ projectId });
}

// =============================================================================
// 型定義
// =============================================================================

interface AutoExactSuggestionListQuery {
  status?: PromotionSuggestionStatus;
  asin?: string;
  lifecycleState?: string;
  minScore?: number;
  limit?: number;
  offset?: number;
}

interface ApproveRequest {
  suggestionIds: string[];
  approvedBy: string;
}

interface RejectRequest {
  suggestionIds: string[];
  rejectedBy: string;
  reason?: string;
}

interface ApplyQueuedRequest {
  dryRun?: boolean;
  maxItems?: number;
}

// =============================================================================
// グローバル設定取得
// =============================================================================

/**
 * AUTO→EXACT APPLY モードが有効かどうかを取得
 * 環境変数 AUTO_EXACT_APPLY_ENABLED="true" のときのみ true
 */
function isAutoExactApplyEnabled(): boolean {
  return process.env.AUTO_EXACT_APPLY_ENABLED === "true";
}

// =============================================================================
// エンドポイント
// =============================================================================

/**
 * GET /admin/auto-exact-suggestions
 * AUTO→EXACT 昇格候補の一覧を取得
 *
 * クエリパラメータ:
 * - status: フィルタ（PENDING, APPROVED, REJECTED, APPLIED）
 * - asin: ASINでフィルタ
 * - lifecycleState: ライフサイクルステートでフィルタ（LAUNCH_HARD, LAUNCH_SOFT, GROW, HARVEST）
 * - minScore: 最小スコアでフィルタ（優先度が高い候補を抽出）
 * - limit: 取得件数（デフォルト: 100, 最大: 1000）
 * - offset: オフセット（デフォルト: 0）
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const {
      status,
      asin,
      lifecycleState,
      minScore: minScoreStr,
      limit: limitStr,
      offset: offsetStr,
    } = req.query as Record<string, string | undefined>;

    const limit = Math.min(parseInt(limitStr || "100", 10), 1000);
    const offset = parseInt(offsetStr || "0", 10);
    const minScore = minScoreStr ? parseFloat(minScoreStr) : undefined;

    logger.info("Fetching auto-exact promotion suggestions", {
      status,
      asin,
      lifecycleState,
      minScore,
      limit,
      offset,
    });

    // クエリ構築
    const conditions: string[] = [];
    const params: Record<string, string | number> = {};

    if (status) {
      conditions.push("status = @status");
      params.status = status;
    }

    if (asin) {
      conditions.push("asin = @asin");
      params.asin = asin;
    }

    if (lifecycleState) {
      conditions.push("lifecycle_state = @lifecycleState");
      params.lifecycleState = lifecycleState;
    }

    if (minScore !== undefined) {
      conditions.push("score >= @minScore");
      params.minScore = minScore;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT
        suggestion_id,
        execution_id,
        profile_id,
        campaign_id_auto,
        ad_group_id_auto,
        campaign_id_manual_target,
        ad_group_id_manual_target,
        asin,
        search_term,
        intent_cluster_id,
        intent_cluster_label,
        match_type,
        lookback_days,
        impressions,
        clicks,
        orders,
        sales,
        cost,
        cvr,
        acos,
        cluster_clicks,
        cluster_cvr,
        asin_baseline_cvr,
        effective_baseline_cvr,
        target_acos,
        score,
        reason_codes,
        reason_detail,
        lifecycle_state,
        status,
        approved_at,
        approved_by,
        rejected_at,
        rejected_by,
        rejection_reason,
        is_applied,
        applied_at,
        suggested_at
      FROM \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      ${whereClause}
      ORDER BY score DESC, suggested_at DESC
      LIMIT @limit
      OFFSET @offset
    `;

    const bigquery = getBigQueryClient(config.projectId);
    const [rows] = await bigquery.query({
      query,
      params: { ...params, limit, offset },
      location: "asia-northeast1",
    });

    // 総件数を取得
    const countQuery = `
      SELECT COUNT(*) as total
      FROM \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      ${whereClause}
    `;

    const [countRows] = await bigquery.query({
      query: countQuery,
      params,
      location: "asia-northeast1",
    });

    const total = countRows[0]?.total || 0;

    res.json({
      success: true,
      data: {
        suggestions: rows,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + rows.length < total,
        },
      },
    });
  } catch (error) {
    logger.error("Failed to fetch auto-exact promotion suggestions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /admin/auto-exact-suggestions/summary
 * ステータス別のサマリーを取得
 */
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const { asin } = req.query as Record<string, string | undefined>;

    logger.info("Fetching auto-exact suggestions summary", { asin });

    let whereClause = "";
    const params: Record<string, string> = {};

    if (asin) {
      whereClause = "WHERE asin = @asin";
      params.asin = asin;
    }

    const query = `
      SELECT
        status,
        COUNT(*) as count,
        SUM(cost) as total_cost_30d,
        SUM(sales) as total_sales_30d,
        AVG(score) as avg_score,
        COUNT(DISTINCT asin) as unique_asins
      FROM \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      ${whereClause}
      GROUP BY status
      ORDER BY status
    `;

    const bigquery = getBigQueryClient(config.projectId);
    const [rows] = await bigquery.query({
      query,
      params,
      location: "asia-northeast1",
    });

    // ステータス別に整形
    const summary: Record<string, {
      count: number;
      totalCost30d: number;
      totalSales30d: number;
      avgScore: number;
      uniqueAsins: number;
    }> = {
      PENDING: { count: 0, totalCost30d: 0, totalSales30d: 0, avgScore: 0, uniqueAsins: 0 },
      APPROVED: { count: 0, totalCost30d: 0, totalSales30d: 0, avgScore: 0, uniqueAsins: 0 },
      REJECTED: { count: 0, totalCost30d: 0, totalSales30d: 0, avgScore: 0, uniqueAsins: 0 },
      APPLIED: { count: 0, totalCost30d: 0, totalSales30d: 0, avgScore: 0, uniqueAsins: 0 },
    };

    for (const row of rows) {
      if (row.status && summary[row.status]) {
        summary[row.status] = {
          count: Number(row.count) || 0,
          totalCost30d: Number(row.total_cost_30d) || 0,
          totalSales30d: Number(row.total_sales_30d) || 0,
          avgScore: Number(row.avg_score) || 0,
          uniqueAsins: Number(row.unique_asins) || 0,
        };
      }
    }

    res.json({
      success: true,
      data: {
        summary,
        total: Object.values(summary).reduce((sum, s) => sum + s.count, 0),
      },
    });
  } catch (error) {
    logger.error("Failed to fetch auto-exact suggestions summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /admin/auto-exact-suggestions/top
 * 高スコアの候補トップNを取得（クイックレビュー用）
 *
 * クエリパラメータ:
 * - limit: 取得件数（デフォルト: 20, 最大: 100）
 * - asin: ASINでフィルタ（任意）
 */
router.get("/top", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const { limit: limitStr, asin } = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt(limitStr || "20", 10), 100);

    logger.info("Fetching top auto-exact suggestions", { limit, asin });

    let whereClause = "WHERE status = 'PENDING'";
    const params: Record<string, string | number> = { limit };

    if (asin) {
      whereClause += " AND asin = @asin";
      params.asin = asin;
    }

    const query = `
      SELECT
        suggestion_id,
        asin,
        search_term,
        intent_cluster_label,
        clicks,
        orders,
        cvr,
        acos,
        target_acos,
        score,
        reason_codes,
        lifecycle_state,
        suggested_at
      FROM \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      ${whereClause}
      ORDER BY score DESC
      LIMIT @limit
    `;

    const bigquery = getBigQueryClient(config.projectId);
    const [rows] = await bigquery.query({
      query,
      params,
      location: "asia-northeast1",
    });

    res.json({
      success: true,
      data: {
        suggestions: rows,
        count: rows.length,
      },
    });
  } catch (error) {
    logger.error("Failed to fetch top auto-exact suggestions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /admin/auto-exact-suggestions/approve
 * 候補を承認する
 *
 * リクエストボディ:
 * - suggestionIds: 承認する候補IDの配列
 * - approvedBy: 承認者
 */
router.post("/approve", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const { suggestionIds, approvedBy } = req.body as ApproveRequest;

    // バリデーション
    if (!suggestionIds || !Array.isArray(suggestionIds) || suggestionIds.length === 0) {
      return res.status(400).json({
        error: "suggestionIds is required and must be a non-empty array",
      });
    }

    if (!approvedBy || typeof approvedBy !== "string") {
      return res.status(400).json({
        error: "approvedBy is required",
      });
    }

    logger.info("Approving auto-exact promotion suggestions", {
      count: suggestionIds.length,
      approvedBy,
    });

    const bigquery = getBigQueryClient(config.projectId);

    // PENDING状態の候補のみを承認
    const query = `
      UPDATE \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      SET
        status = 'APPROVED',
        approved_at = CURRENT_TIMESTAMP(),
        approved_by = @approvedBy
      WHERE suggestion_id IN UNNEST(@suggestionIds)
        AND status = 'PENDING'
    `;

    const [job] = await bigquery.createQueryJob({
      query,
      params: {
        suggestionIds,
        approvedBy,
      },
      location: "asia-northeast1",
    });

    const [result] = await job.getQueryResults();
    const affectedRows = job.metadata?.statistics?.query?.numDmlAffectedRows || 0;

    logger.info("Approved auto-exact promotion suggestions", {
      requested: suggestionIds.length,
      approved: affectedRows,
    });

    res.json({
      success: true,
      data: {
        requested: suggestionIds.length,
        approved: Number(affectedRows),
        message: `${affectedRows} suggestions approved`,
      },
    });
  } catch (error) {
    logger.error("Failed to approve auto-exact promotion suggestions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /admin/auto-exact-suggestions/reject
 * 候補を却下する
 *
 * リクエストボディ:
 * - suggestionIds: 却下する候補IDの配列
 * - rejectedBy: 却下者
 * - reason: 却下理由（任意）
 */
router.post("/reject", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const { suggestionIds, rejectedBy, reason } = req.body as RejectRequest;

    // バリデーション
    if (!suggestionIds || !Array.isArray(suggestionIds) || suggestionIds.length === 0) {
      return res.status(400).json({
        error: "suggestionIds is required and must be a non-empty array",
      });
    }

    if (!rejectedBy || typeof rejectedBy !== "string") {
      return res.status(400).json({
        error: "rejectedBy is required",
      });
    }

    logger.info("Rejecting auto-exact promotion suggestions", {
      count: suggestionIds.length,
      rejectedBy,
      reason,
    });

    const bigquery = getBigQueryClient(config.projectId);

    // PENDING または APPROVED 状態の候補を却下可能
    const query = `
      UPDATE \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      SET
        status = 'REJECTED',
        rejected_at = CURRENT_TIMESTAMP(),
        rejected_by = @rejectedBy,
        rejection_reason = @reason
      WHERE suggestion_id IN UNNEST(@suggestionIds)
        AND status IN ('PENDING', 'APPROVED')
    `;

    const [job] = await bigquery.createQueryJob({
      query,
      params: {
        suggestionIds,
        rejectedBy,
        reason: reason || null,
      },
      location: "asia-northeast1",
    });

    const [result] = await job.getQueryResults();
    const affectedRows = job.metadata?.statistics?.query?.numDmlAffectedRows || 0;

    logger.info("Rejected auto-exact promotion suggestions", {
      requested: suggestionIds.length,
      rejected: affectedRows,
    });

    res.json({
      success: true,
      data: {
        requested: suggestionIds.length,
        rejected: Number(affectedRows),
        message: `${affectedRows} suggestions rejected`,
      },
    });
  } catch (error) {
    logger.error("Failed to reject auto-exact promotion suggestions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /admin/auto-exact-suggestions/apply-queued
 * APPROVED 状態の候補を Amazon Ads API に適用
 *
 * リクエストボディ:
 * - dryRun: boolean (省略可) - true の場合、対象件数のみ計算し適用しない
 * - maxItems: number (省略可) - 一度に処理する最大件数
 *
 * 処理内容:
 * - APPROVED 状態の候補を取得
 * - ターゲットMANUALキャンペーンにEXACTキーワードを作成
 * - AUTOキャンペーンにネガティブEXACTを登録（カニバリゼーション防止）
 * - 成功したら status を APPLIED に更新
 */
router.post("/apply-queued", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const { dryRun, maxItems } = req.body as ApplyQueuedRequest;
    const applyConfig = loadAutoExactApplyConfig();

    logger.info("Apply-queued endpoint called for auto-exact", {
      applyEnabled: applyConfig.enabled,
      dryRun: dryRun ?? false,
      maxItems: maxItems ?? "unlimited",
    });

    // APPROVED 状態の候補件数を取得
    const bigquery = getBigQueryClient(config.projectId);
    const countQuery = `
      SELECT COUNT(*) as count
      FROM \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      WHERE status = 'APPROVED'
        AND is_applied = FALSE
        AND campaign_id_manual_target IS NOT NULL
        AND ad_group_id_manual_target IS NOT NULL
    `;

    const [countRows] = await bigquery.query({
      query: countQuery,
      location: "asia-northeast1",
    });

    const approvedCount = Number(countRows[0]?.count) || 0;
    const wouldProcess = maxItems != null
      ? Math.min(maxItems, approvedCount, applyConfig.maxApplyPerRun)
      : Math.min(approvedCount, applyConfig.maxApplyPerRun);

    // applyEnabled が false の場合
    if (!applyConfig.enabled) {
      logger.info("Auto-exact apply is not enabled", {
        approvedCount,
        wouldProcess,
      });

      return res.json({
        success: true,
        data: {
          applyEnabled: false,
          message:
            "Auto-exact keyword apply is not enabled. " +
            "Set AUTO_EXACT_APPLY_ENABLED=true to enable.",
          approvedCount,
          wouldProcess,
          dryRun: dryRun ?? false,
        },
      });
    }

    // 適用を実行
    const result = await applyApprovedAutoExactPromotions({
      dryRun: dryRun ?? false,
      maxItems: maxItems,
    });

    logger.info("Apply-queued completed for auto-exact", {
      totalProcessed: result.totalProcessed,
      successCount: result.successCount,
      partialSuccessCount: result.partialSuccessCount,
      failedCount: result.failedCount,
    });

    res.json({
      success: true,
      data: {
        applyEnabled: true,
        message: dryRun
          ? `Dry run completed. Would apply ${result.totalProcessed} AUTO→EXACT promotions.`
          : `Applied ${result.successCount} promotions (${result.partialSuccessCount} partial). ${result.failedCount} failed.`,
        approvedCount,
        wouldProcess,
        dryRun: dryRun ?? false,
        appliedCount: result.successCount,
        partialSuccessCount: result.partialSuccessCount,
        failedCount: result.failedCount,
        skippedCount: result.skippedCount,
        results: result.results,
      },
    });
  } catch (error) {
    logger.error("Failed to process apply-queued request for auto-exact", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /admin/auto-exact-suggestions/:suggestionId
 * 候補の詳細を取得
 */
router.get("/:suggestionId", async (req: Request, res: Response) => {
  try {
    const config = getConfig();

    if (!config.projectId) {
      return res.status(500).json({
        error: "GOOGLE_CLOUD_PROJECT_ID is not configured",
      });
    }

    const { suggestionId } = req.params;

    logger.info("Fetching auto-exact promotion suggestion detail", { suggestionId });

    const query = `
      SELECT *
      FROM \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      WHERE suggestion_id = @suggestionId
    `;

    const bigquery = getBigQueryClient(config.projectId);
    const [rows] = await bigquery.query({
      query,
      params: { suggestionId },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Suggestion not found",
      });
    }

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    logger.error("Failed to fetch auto-exact promotion suggestion detail", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;

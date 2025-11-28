/**
 * ネガティブキーワード候補 管理 API ルート
 *
 * 候補の一覧取得、承認、却下を行うエンドポイント
 * Amazon Ads API への適用は別のエンドポイントで行う（将来実装）
 */

import { Router, Request, Response } from "express";
import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import { NegativeSuggestionStatus } from "../negative-keywords/types";
import {
  applyApprovedNegativeKeywords,
  loadNegativeApplyConfig,
} from "../negative-keywords/negative-keyword-applier";

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

interface NegativeSuggestionListQuery {
  status?: NegativeSuggestionStatus;
  asin?: string;
  role?: string;
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
 * ネガティブキーワード APPLY モードが有効かどうかを取得
 * 環境変数 NEGATIVE_APPLY_ENABLED="true" のときのみ true
 */
function isNegativeApplyEnabled(): boolean {
  return process.env.NEGATIVE_APPLY_ENABLED === "true";
}

// =============================================================================
// エンドポイント
// =============================================================================

/**
 * GET /admin/negative-suggestions
 * ネガティブキーワード候補の一覧を取得
 *
 * クエリパラメータ:
 * - status: フィルタ（PENDING, APPROVED, REJECTED, APPLIED）
 * - asin: ASINでフィルタ
 * - role: ロールでフィルタ（GENERIC, BRAND_OWN, BRAND_CONQUEST, OTHER）
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
      role,
      limit: limitStr,
      offset: offsetStr,
    } = req.query as Record<string, string | undefined>;

    const limit = Math.min(parseInt(limitStr || "100", 10), 1000);
    const offset = parseInt(offsetStr || "0", 10);

    logger.info("Fetching negative keyword suggestions", {
      status,
      asin,
      role,
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

    if (role) {
      conditions.push("role = @role");
      params.role = role;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
      SELECT
        suggestion_id,
        execution_id,
        asin,
        query,
        match_type,
        role,
        clicks_30d,
        conversions_30d,
        cost_30d,
        cpc_30d,
        cvr_30d,
        acos_30d,
        baseline_asin_cvr_30d,
        reason_codes,
        reason_detail,
        status,
        approved_at,
        approved_by,
        rejected_at,
        rejected_by,
        rejection_reason,
        is_applied,
        applied_at,
        lifecycle_state,
        suggested_at
      FROM \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
      ${whereClause}
      ORDER BY suggested_at DESC
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
      FROM \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
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
    logger.error("Failed to fetch negative keyword suggestions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /admin/negative-suggestions/summary
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

    logger.info("Fetching negative suggestions summary", { asin });

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
        SUM(cost_30d) as total_cost_30d,
        COUNT(DISTINCT asin) as unique_asins
      FROM \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
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
    const summary: Record<string, { count: number; totalCost30d: number; uniqueAsins: number }> = {
      PENDING: { count: 0, totalCost30d: 0, uniqueAsins: 0 },
      APPROVED: { count: 0, totalCost30d: 0, uniqueAsins: 0 },
      REJECTED: { count: 0, totalCost30d: 0, uniqueAsins: 0 },
      APPLIED: { count: 0, totalCost30d: 0, uniqueAsins: 0 },
    };

    for (const row of rows) {
      if (row.status && summary[row.status]) {
        summary[row.status] = {
          count: Number(row.count) || 0,
          totalCost30d: Number(row.total_cost_30d) || 0,
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
    logger.error("Failed to fetch negative suggestions summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /admin/negative-suggestions/approve
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

    logger.info("Approving negative keyword suggestions", {
      count: suggestionIds.length,
      approvedBy,
    });

    const bigquery = getBigQueryClient(config.projectId);

    // PENDING状態の候補のみを承認
    const query = `
      UPDATE \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
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

    logger.info("Approved negative keyword suggestions", {
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
    logger.error("Failed to approve negative keyword suggestions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /admin/negative-suggestions/reject
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

    logger.info("Rejecting negative keyword suggestions", {
      count: suggestionIds.length,
      rejectedBy,
      reason,
    });

    const bigquery = getBigQueryClient(config.projectId);

    // PENDING または APPROVED 状態の候補を却下可能
    const query = `
      UPDATE \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
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

    logger.info("Rejected negative keyword suggestions", {
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
    logger.error("Failed to reject negative keyword suggestions", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /admin/negative-suggestions/apply-queued
 * APPROVED 状態の候補を Amazon Ads API に適用
 *
 * リクエストボディ:
 * - dryRun: boolean (省略可) - true の場合、対象件数のみ計算し適用しない
 * - maxItems: number (省略可) - 一度に処理する最大件数
 * - includeAutoApply: boolean (省略可) - 高信頼度のPENDING候補も自動適用する
 *
 * 処理内容:
 * - APPROVED 状態の候補を取得
 * - Amazon Ads API にネガティブキーワードとして登録
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

    const { dryRun, maxItems, includeAutoApply } = req.body as ApplyQueuedRequest & {
      includeAutoApply?: boolean;
    };
    const applyConfig = loadNegativeApplyConfig();

    logger.info("Apply-queued endpoint called", {
      applyEnabled: applyConfig.enabled,
      dryRun: dryRun ?? false,
      maxItems: maxItems ?? "unlimited",
      includeAutoApply: includeAutoApply ?? false,
    });

    // APPROVED 状態の候補件数を取得
    const bigquery = getBigQueryClient(config.projectId);
    const countQuery = `
      SELECT COUNT(*) as count
      FROM \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
      WHERE status = 'APPROVED'
        AND is_applied = FALSE
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
      logger.info("Negative apply is not enabled", {
        approvedCount,
        wouldProcess,
      });

      return res.json({
        success: true,
        data: {
          applyEnabled: false,
          message:
            "Negative keyword apply is not enabled. " +
            "Set NEGATIVE_APPLY_ENABLED=true to enable.",
          approvedCount,
          wouldProcess,
          dryRun: dryRun ?? false,
        },
      });
    }

    // 適用を実行
    const result = await applyApprovedNegativeKeywords({
      dryRun: dryRun ?? false,
      maxItems: maxItems,
      includeAutoApply: includeAutoApply ?? false,
    });

    logger.info("Apply-queued completed", {
      totalProcessed: result.totalProcessed,
      successCount: result.successCount,
      failedCount: result.failedCount,
    });

    res.json({
      success: true,
      data: {
        applyEnabled: true,
        message: dryRun
          ? `Dry run completed. Would apply ${result.totalProcessed} negative keywords.`
          : `Applied ${result.successCount} negative keywords. ${result.failedCount} failed.`,
        approvedCount,
        wouldProcess,
        dryRun: dryRun ?? false,
        appliedCount: result.successCount,
        failedCount: result.failedCount,
        skippedCount: result.skippedCount,
        appliedIds: result.appliedIds,
        errors: result.errors,
      },
    });
  } catch (error) {
    logger.error("Failed to process apply-queued request", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /admin/negative-suggestions/:suggestionId
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

    logger.info("Fetching negative keyword suggestion detail", { suggestionId });

    const query = `
      SELECT *
      FROM \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
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
    logger.error("Failed to fetch negative keyword suggestion detail", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;

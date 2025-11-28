/**
 * デバッグエンドポイント
 *
 * 開発・検証用のエンドポイント群
 * 本番環境では適切なアクセス制御が必要
 */

import { Router, Request, Response } from "express";
import { logger } from "../logger";
import {
  runAutoExactShadowOnce,
  RunAutoExactShadowOnceOptions,
} from "../auto-exact";
import { sendExecutionSummaryToSlack } from "../slack";

const router = Router();

/**
 * GET /debug/run-auto-exact-shadow
 *
 * AUTO→EXACT 昇格ロジックをデバッグ実行
 * BigQuery からデータを取得し、昇格候補を計算して返す（保存なし）
 *
 * Query Parameters:
 *   - profileId (required): プロファイルID
 *   - asin (optional): ASIN フィルタ（カンマ区切りで複数指定可）
 */
router.get(
  "/run-auto-exact-shadow",
  async (req: Request, res: Response) => {
    const { profileId, asin } = req.query;

    // profileId は必須
    if (!profileId || typeof profileId !== "string") {
      return res.status(400).json({
        success: false,
        error: "bad-request",
        message: "profileId query parameter is required",
      });
    }

    // asin は任意（カンマ区切りで複数指定可）
    let asinList: string[] | undefined;
    if (asin && typeof asin === "string") {
      asinList = asin.split(",").map((a) => a.trim()).filter((a) => a.length > 0);
    }

    logger.info("Debug: run-auto-exact-shadow requested", {
      profileId,
      asinList: asinList ?? "(all)",
    });

    try {
      const options: RunAutoExactShadowOnceOptions = {
        profileId,
        asinList,
        persistToBigQuery: false, // デバッグ用なので保存しない
      };

      const result = await runAutoExactShadowOnce(options);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: "execution-failed",
          message: result.errorMessage ?? "Unknown error",
          executionId: result.executionId,
        });
      }

      // 成功レスポンス
      return res.status(200).json({
        success: true,
        executionId: result.executionId,
        mode: "SHADOW",
        profileId,
        asinList,
        candidateCount: result.candidateCount,
        candidates: result.candidates ?? [],
        stats: result.stats,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Debug: run-auto-exact-shadow failed", {
        profileId,
        asinList,
        error: errorMessage,
      });

      return res.status(500).json({
        success: false,
        error: "internal-error",
        message: errorMessage,
      });
    }
  }
);

/**
 * POST /debug/send-execution-summary
 *
 * 過去の execution_id を指定して Slack 実行サマリーを手動送信
 * デバッグ・検証用エンドポイント
 *
 * Request Body:
 *   - executionId (required): 送信対象の実行ID
 *   - maxAsins (optional): 表示する ASIN 数（デフォルト: 5）
 */
router.post(
  "/send-execution-summary",
  async (req: Request, res: Response) => {
    const { executionId, maxAsins } = req.body;

    // executionId は必須
    if (!executionId || typeof executionId !== "string") {
      return res.status(400).json({
        success: false,
        error: "bad-request",
        message: "executionId is required in request body",
      });
    }

    logger.info("Debug: send-execution-summary requested", {
      executionId,
      maxAsins: maxAsins ?? "(default)",
    });

    try {
      const result = await sendExecutionSummaryToSlack({
        executionId,
        maxAsins: typeof maxAsins === "number" ? maxAsins : undefined,
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: "send-failed",
          message: result.error ?? "Unknown error",
          executionId,
          asinCount: result.asinCount,
        });
      }

      // 成功レスポンス
      return res.status(200).json({
        success: true,
        executionId,
        asinCount: result.asinCount,
        message: "Slack execution summary sent successfully",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Debug: send-execution-summary failed", {
        executionId,
        error: errorMessage,
      });

      return res.status(500).json({
        success: false,
        error: "internal-error",
        message: errorMessage,
      });
    }
  }
);

export default router;

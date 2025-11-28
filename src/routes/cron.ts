/**
 * Cronジョブエンドポイント
 */

import { Router, Request, Response } from "express";
import { compute_bid_recommendations, KeywordMetrics, KeywordRecommendation } from "../../index";
import { GlobalConfig } from "../../types";
import {
  insertExecution,
  insertRecommendations,
  insertBidRecommendations,
  ExecutionRecord,
  RecommendationRecord,
  BidRecommendationRow,
  ExecutionMode,
} from "../bigqueryClient";
import { fetchKeywordMetrics, getMockKeywordMetrics } from "../amazonAdsClient";
import { logger } from "../logger";
import { recomputeGuardrailsForAllProducts } from "../guardrails";
import { runAutoExactPromotionJob, runAutoExactShadowOnce } from "../auto-exact";
import { runPlacementEngine, PlacementEngineConfig } from "../placement";
import { runBudgetEngine, BudgetEngineConfig } from "../budget";
import { runKeywordDiscoveryJob, createKeywordDiscoveryHandler } from "../keywordDiscovery";
import {
  createSeasonalityUpdateHandler,
  createSeasonalityQueryHandler,
  createActiveAdjustmentsHandler,
  createAdjustmentStatsHandler,
} from "../seasonality";

const router = Router();

// =============================================================================
// ヘルパー関数
// =============================================================================

// snake_case と camelCase の両方に対応して値を取り出す
function getField<T>(rec: any, snake: string, camel: string): T | null {
  if (rec[snake] !== undefined && rec[snake] !== null) {
    return rec[snake] as T;
  }
  if (rec[camel] !== undefined && rec[camel] !== null) {
    return rec[camel] as T;
  }
  return null;
}

// 推奨結果を RecommendationRecord に変換
function mapToRecommendationRecord(
  rec: any,
  executionId: string,
  mode: ExecutionMode
): RecommendationRecord {
  return {
    execution_id: executionId,
    mode,
    keyword_id: getField<string>(rec, "keyword_id", "keywordId"),
    campaign_id: getField<string>(rec, "campaign_id", "campaignId"),
    ad_group_id: getField<string>(rec, "ad_group_id", "adGroupId"),
    action: getField<string>(rec, "action", "action"),
    old_bid: getField<number>(rec, "old_bid", "oldBid"),
    new_bid: getField<number>(rec, "new_bid", "newBid"),
    change_rate: getField<number>(rec, "change_rate", "changeRate"),
    clipped: getField<boolean>(rec, "clipped", "clipped"),
    clip_reason: getField<string>(rec, "clip_reason", "clipReason"),
    priority_score: getField<number>(rec, "priority_score", "priorityScore"),
    rank_current: getField<number>(rec, "rank_current", "rankCurrent"),
    rank_target: getField<number>(rec, "rank_target", "rankTarget"),
    cvr_recent: getField<number>(rec, "cvr_recent", "cvrRecent"),
    cvr_baseline: getField<number>(rec, "cvr_baseline", "cvrBaseline"),
    ctr_recent: getField<number>(rec, "ctr_recent", "ctrRecent"),
    ctr_baseline: getField<number>(rec, "ctr_baseline", "ctrBaseline"),
    acos_actual: getField<number>(rec, "acos_actual", "acosActual"),
    acos_target: getField<number>(rec, "acos_target", "acosTarget"),
    tos_targeted: getField<boolean>(rec, "tos_targeted", "tosTargeted"),
    tos_eligible_200: getField<boolean>(rec, "tos_eligible_200", "tosEligible200"),
    base_change_rate: getField<number>(rec, "base_change_rate", "baseChangeRate"),
    phase_coeff: getField<number>(rec, "phase_coeff", "phaseCoeff"),
    cvr_coeff: getField<number>(rec, "cvr_coeff", "cvrCoeff"),
    rank_gap_coeff: getField<number>(rec, "rank_gap_coeff", "rankGapCoeff"),
    competitor_coeff: getField<number>(rec, "competitor_coeff", "competitorCoeff"),
    brand_coeff: getField<number>(rec, "brand_coeff", "brandCoeff"),
    stats_coeff: getField<number>(rec, "stats_coeff", "statsCoeff"),
    tos_coeff: getField<number>(rec, "tos_coeff", "tosCoeff"),
    reason_facts: getField<string>(rec, "reason_facts", "reasonFacts"),
    reason_logic: getField<string>(rec, "reason_logic", "reasonLogic"),
    reason_impact: getField<string>(rec, "reason_impact", "reasonImpact"),
    created_at: new Date(),
  };
}

// アクション別の件数を集計
function countActions(recs: any[]): {
  STRONG_UP: number;
  UP: number;
  DOWN: number;
  STOP: number;
  KEEP: number;
} {
  const counts = {
    STRONG_UP: 0,
    UP: 0,
    DOWN: 0,
    STOP: 0,
    KEEP: 0,
  };

  for (const rec of recs) {
    const action = rec.action || rec.ACTION;
    if (action === "STRONG_UP") counts.STRONG_UP++;
    else if (action === "MILD_UP") counts.UP++;
    else if (action === "MILD_DOWN" || action === "STRONG_DOWN") counts.DOWN++;
    else if (action === "STOP") counts.STOP++;
    else if (action === "KEEP") counts.KEEP++;
  }

  return counts;
}

// execution_type を mode と trigger_type から導出
function deriveExecutionType(mode: ExecutionMode, triggerType: string): string {
  if (triggerType === "CRON_NORMAL" || triggerType === "MANUAL_API" && mode === "NORMAL") {
    return "run-bid-normal";
  }
  if (triggerType === "CRON_SMODE" || triggerType === "MANUAL_API" && mode === "S_MODE") {
    return "run-bid-smode";
  }
  return `run-bid-${mode.toLowerCase()}`;
}

/**
 * KeywordRecommendation と KeywordMetrics を BidRecommendationRow に変換
 */
function mapToBidRecommendationRows(
  executionId: string,
  profileId: string,
  recommendations: KeywordRecommendation[],
  keywordMetricsMap: Map<string, KeywordMetrics>,
  now: Date
): BidRecommendationRow[] {
  return recommendations.map((rec) => {
    const metrics = keywordMetricsMap.get(rec.keyword_id);
    const currentBid = metrics?.current_bid ?? 0;
    const recommendedBid = rec.new_bid;
    const bidChange = recommendedBid - currentBid;
    const bidChangeRatio = currentBid > 0 ? recommendedBid / currentBid : 1;

    // 理由コードを生成（アクションと主要係数を含む）
    const reasonCodes = [
      rec.action,
      rec.tos_targeted ? "TOS_TARGETED" : null,
      rec.clipped ? "CLIPPED" : null,
    ]
      .filter(Boolean)
      .join(",");

    return {
      execution_id: executionId,
      profile_id: profileId,
      campaign_id: rec.campaign_id,
      ad_group_id: rec.ad_group_id,
      keyword_id: rec.keyword_id,
      keyword_text: null, // KeywordMetrics には keyword_text がない
      match_type: null, // KeywordMetrics には match_type がない
      asin: null, // KeywordMetrics には asin がない
      lifecycle_state: metrics?.phase_type ?? null,
      target_acos: metrics?.acos_target ?? null,
      current_bid: currentBid,
      recommended_bid: recommendedBid,
      bid_change: bidChange,
      bid_change_ratio: bidChangeRatio,
      reason_codes: reasonCodes,
      impressions: metrics ? metrics.impressions_3h : null,
      clicks: metrics ? metrics.clicks_3h : null,
      orders: null, // KeywordMetrics には orders がない
      sales: null, // KeywordMetrics には sales がない
      cost: null, // KeywordMetrics には cost がない
      cvr: metrics?.cvr_recent ?? null,
      acos: metrics?.acos_actual ?? null,
      created_at: now,
    };
  });
}

// =============================================================================
// Cronジョブ共通ロジック
// =============================================================================

export async function runCronJob(
  mode: ExecutionMode,
  triggerType: string,
  useMockData: boolean = false
) {
  const startedAt = new Date();
  const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const profileId = process.env.AMAZON_ADS_PROFILE_ID || "";
  const executionType = deriveExecutionType(mode, triggerType);

  logger.info("Starting cron job", {
    executionId,
    mode,
    triggerType,
    executionType,
    profileId,
    useMockData,
  });

  // GlobalConfig を定義
  const globalConfig: GlobalConfig = {
    mode,
    manual_mode: false,
    max_change_rate_normal: 0.6,
    max_change_rate_smode_default: 1.5,
    max_change_rate_smode_tos: 2.0,
    min_clicks_for_decision: 5,
    min_clicks_for_confident: 20,
    min_clicks_for_tos: 40,
    acos_hard_stop_multiplier: 3.0,
    acos_soft_down_multiplier: 1.5,
    currency: "JPY",
  };

  try {
    // キーワードデータを取得
    let keywords: KeywordMetrics[];

    if (useMockData) {
      keywords = getMockKeywordMetrics(50) as KeywordMetrics[];
      logger.info("Using mock keyword data", { count: keywords.length });
    } else {
      keywords = await fetchKeywordMetrics({
        profileId,
        lookbackDays: 7,
        sponsoredType: "SPONSORED_PRODUCTS",
        phaseType: mode === "S_MODE" ? "S_NORMAL" : "NORMAL",
      }) as KeywordMetrics[];
    }

    logger.info("Fetched keywords", {
      executionId,
      keywordCount: keywords.length,
    });

    // キーワードIDでメトリクスをマップ化（BidRecommendationRow生成用）
    const keywordMetricsMap = new Map<string, KeywordMetrics>();
    for (const kw of keywords) {
      keywordMetricsMap.set(kw.keyword_id, kw);
    }

    // 入札推奨を計算
    const recommendationsRaw = compute_bid_recommendations(keywords, globalConfig);

    // 正常終了時の処理
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();

    // アクション別の件数を集計
    const actionCounts = countActions(recommendationsRaw);

    // RecommendationRecord 配列を作成（旧形式、互換性維持）
    const recommendationRecords = recommendationsRaw.map((rec) =>
      mapToRecommendationRecord(rec, executionId, mode)
    );

    // BidRecommendationRow 配列を作成（新形式）
    const bidRecommendationRows = mapToBidRecommendationRows(
      executionId,
      profileId,
      recommendationsRaw,
      keywordMetricsMap,
      endedAt
    );

    // BigQuery に recommendations を保存（旧形式）
    await insertRecommendations(recommendationRecords);

    // BigQuery に bid_recommendations を保存（新形式）
    await insertBidRecommendations(bidRecommendationRows);

    // ExecutionRecord を作成
    const executionRecord: ExecutionRecord = {
      execution_id: executionId,
      profile_id: profileId,
      mode,
      execution_type: executionType,
      trigger_type: triggerType,
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: durationMs,
      total_keywords: keywords.length,
      reco_count: recommendationsRaw.length,
      action_strong_up: actionCounts.STRONG_UP,
      action_up: actionCounts.UP,
      action_down: actionCounts.DOWN,
      action_stop: actionCounts.STOP,
      action_keep: actionCounts.KEEP,
      status: "SUCCESS",
      error_message: null,
      config_snapshot: JSON.stringify(globalConfig),
    };

    // BigQuery に execution を保存
    await insertExecution(executionRecord);

    logger.info("Cron job completed successfully", {
      executionId,
      profileId,
      executionType,
      durationMs,
      recommendationCount: recommendationsRaw.length,
    });

    return {
      success: true,
      executionId,
      profileId,
      mode,
      executionType,
      count: recommendationsRaw.length,
      durationMs,
      recommendations: recommendationsRaw,
    };
  } catch (error) {
    logger.error("Cron job failed", {
      executionId,
      profileId,
      executionType,
      error: error instanceof Error ? error.message : String(error),
    });

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();
    const errorMessage =
      error instanceof Error ? error.message.substring(0, 1000) : "Unknown error";

    // エラー時の ExecutionRecord を作成
    const executionRecord: ExecutionRecord = {
      execution_id: executionId,
      profile_id: profileId,
      mode,
      execution_type: executionType,
      trigger_type: triggerType,
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: durationMs,
      total_keywords: 0,
      reco_count: 0,
      action_strong_up: 0,
      action_up: 0,
      action_down: 0,
      action_stop: 0,
      action_keep: 0,
      status: "ERROR",
      error_message: errorMessage,
      note: errorMessage,
      config_snapshot: JSON.stringify(globalConfig),
    };

    // BigQuery に ERROR ステータスの execution を保存
    try {
      await insertExecution(executionRecord);
    } catch (bqError) {
      logger.error("Failed to log error to BigQuery", {
        error: bqError instanceof Error ? bqError.message : String(bqError),
      });
    }

    throw error;
  }
}

// =============================================================================
// エンドポイント
// =============================================================================

// 汎用Cronエンドポイント
router.post("/run", async (req: Request, res: Response) => {
  const mode = req.body.mode as ExecutionMode;
  const useMockData = req.body.useMockData === true;

  if (!mode || (mode !== "NORMAL" && mode !== "S_MODE")) {
    return res.status(400).json({
      error: "Invalid request",
      details: ["mode must be NORMAL or S_MODE"],
    });
  }

  try {
    const result = await runCronJob(mode, "MANUAL_API", useMockData);
    return res.json(result);
  } catch (err) {
    logger.error("Cron /run error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ success: false, error: "cron-run-failed" });
  }
});

// NORMAL モード固定
router.post("/run-normal", async (req: Request, res: Response) => {
  const useMockData = req.body?.useMockData === true;

  try {
    const result = await runCronJob("NORMAL", "CRON_NORMAL", useMockData);
    return res.json(result);
  } catch (err) {
    logger.error("Cron /run-normal error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ success: false, error: "cron-run-failed" });
  }
});

// S_MODE 固定
router.post("/run-smode", async (req: Request, res: Response) => {
  const useMockData = req.body?.useMockData === true;

  try {
    const result = await runCronJob("S_MODE", "CRON_SMODE", useMockData);
    return res.json(result);
  } catch (err) {
    logger.error("Cron /run-smode error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ success: false, error: "cron-run-failed" });
  }
});

// =============================================================================
// 自動ガードレール再計算
// =============================================================================

/**
 * POST /cron/recompute-guardrails
 *
 * 全商品の自動ガードレール（min_bid / max_bid）を再計算し、
 * product_guardrails_auto テーブルに保存します。
 *
 * リクエストボディ:
 * - targetAsins?: string[] - 特定のASINのみ処理する場合
 * - dryRun?: boolean - true の場合、計算のみ行いテーブル更新しない
 *
 * レスポンス:
 * - success: boolean
 * - totalProcessed: number
 * - historicalCount: number
 * - theoreticalCount: number
 * - fallbackCount: number
 * - errorCount: number
 * - results?: AutoGuardrailsResult[] (dryRun 時のみ)
 */
router.post("/recompute-guardrails", async (req: Request, res: Response) => {
  const startTime = Date.now();

  const projectId = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || "";
  const dataset = process.env.BQ_DATASET || "amazon_bid_engine";

  if (!projectId) {
    return res.status(500).json({
      success: false,
      error: "GCP_PROJECT_ID environment variable is not set",
    });
  }

  const targetAsins = req.body?.targetAsins as string[] | undefined;
  const dryRun = req.body?.dryRun === true;

  logger.info("Starting guardrails recomputation", {
    targetAsins: targetAsins?.length ?? "all",
    dryRun,
  });

  try {
    const result = await recomputeGuardrailsForAllProducts({
      projectId,
      dataset,
      targetAsins,
      dryRun,
    });

    const durationMs = Date.now() - startTime;

    logger.info("Guardrails recomputation completed", {
      durationMs,
      totalProcessed: result.totalProcessed,
      errorCount: result.errors.length,
    });

    const response: any = {
      success: true,
      durationMs,
      totalProcessed: result.totalProcessed,
      historicalCount: result.historicalCount,
      theoreticalCount: result.theoreticalCount,
      fallbackCount: result.fallbackCount,
      errorCount: result.errors.length,
    };

    // dryRun の場合は結果も返す
    if (dryRun) {
      response.results = result.results;
    }

    // エラーがあれば含める
    if (result.errors.length > 0) {
      response.errors = result.errors;
    }

    return res.json(response);
  } catch (err) {
    logger.error("Guardrails recomputation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({
      success: false,
      error: "guardrails-recomputation-failed",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// =============================================================================
// AUTO→EXACT 昇格ジョブ
// =============================================================================

/**
 * POST /cron/run-auto-exact-promotion
 *
 * AUTO キャンペーンから EXACT キーワードへの昇格候補を計算し、
 * auto_exact_promotion_suggestions テーブルに保存します。
 *
 * SHADOWモード専用: Amazon Ads API への自動登録は行いません
 *
 * リクエストボディ:
 * - profileId?: string - 特定のプロファイルのみ処理する場合
 * - dryRun?: boolean - true の場合、計算のみ行いテーブル更新しない
 *
 * レスポンス:
 * - success: boolean
 * - executionId: string
 * - mode: "SHADOW"
 * - candidatesCount: number
 * - stats: { ... }
 */
router.post(
  "/run-auto-exact-promotion",
  async (req: Request, res: Response) => {
    const startTime = Date.now();

    const projectId =
      process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || "";
    const dataset = process.env.BQ_DATASET || "amazon_bid_engine";

    if (!projectId) {
      return res.status(500).json({
        success: false,
        error: "GCP_PROJECT_ID environment variable is not set",
      });
    }

    const profileId = req.body?.profileId as string | undefined;
    const dryRun = req.body?.dryRun === true;

    logger.info("Starting AUTO→EXACT promotion job via cron", {
      profileId: profileId || "(all)",
      dryRun,
    });

    try {
      const result = await runAutoExactPromotionJob({
        projectId,
        dataset,
        profileId,
        dryRun,
      });

      const durationMs = Date.now() - startTime;

      logger.info("AUTO→EXACT promotion job completed via cron", {
        durationMs,
        executionId: result.executionId,
        candidatesCount: result.candidatesCount,
      });

      return res.json({
        success: result.success,
        durationMs,
        executionId: result.executionId,
        mode: result.mode,
        candidatesCount: result.candidatesCount,
        stats: result.stats,
        errorMessage: result.errorMessage,
      });
    } catch (err) {
      logger.error("AUTO→EXACT promotion job failed via cron", {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({
        success: false,
        error: "auto-exact-promotion-failed",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// =============================================================================
// AUTO→EXACT SHADOWモードジョブ（BigQuery保存付き）
// =============================================================================

/**
 * POST /cron/run-auto-exact-shadow
 *
 * AUTO キャンペーンから EXACT キーワードへの昇格候補を計算し、
 * auto_exact_promotion_suggestions テーブルに保存します。
 * 同時に executions テーブルにも実行ログを保存します。
 *
 * Cloud Scheduler から毎日呼び出すことを想定しています。
 * 対象 profileId は環境変数 AUTO_EXACT_SHADOW_PROFILE_ID で指定します。
 *
 * レスポンス:
 * - success: boolean
 * - executionId: string
 * - candidateCount: number
 * - stats: { ... }
 */
router.post(
  "/run-auto-exact-shadow",
  async (req: Request, res: Response) => {
    const startedAt = new Date();
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const executionType = "run-auto-exact-shadow";

    const profileId = process.env.AUTO_EXACT_SHADOW_PROFILE_ID;

    if (!profileId) {
      logger.error("AUTO_EXACT_SHADOW_PROFILE_ID is not set");
      return res.status(500).json({
        success: false,
        error: "config-missing",
        message: "AUTO_EXACT_SHADOW_PROFILE_ID environment variable is not set",
      });
    }

    const projectId =
      process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || "";
    const dataset = process.env.BQ_DATASET || "amazon_bid_engine";

    if (!projectId) {
      return res.status(500).json({
        success: false,
        error: "config-missing",
        message: "GCP_PROJECT_ID environment variable is not set",
      });
    }

    logger.info("Starting AUTO→EXACT shadow job via cron", {
      executionId,
      profileId,
      projectId,
      dataset,
    });

    try {
      // runAutoExactShadowOnce に execution_id を渡す
      const result = await runAutoExactShadowOnce({
        profileId,
        executionId, // 外部から渡す
        persistToBigQuery: true,
        projectId,
        dataset,
      });

      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();

      // executions テーブルに保存
      const executionRecord: ExecutionRecord = {
        execution_id: executionId,
        profile_id: profileId,
        mode: "NORMAL", // AUTO→EXACT は NORMAL モードで実行
        execution_type: executionType,
        trigger_type: "CRON_AUTO_EXACT_SHADOW",
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: durationMs,
        total_keywords: 0, // AUTO→EXACT ではキーワード数ではなく候補数を使う
        reco_count: result.candidateCount,
        action_strong_up: 0,
        action_up: 0,
        action_down: 0,
        action_stop: 0,
        action_keep: 0,
        status: result.success ? "SUCCESS" : "ERROR",
        error_message: result.errorMessage ?? null,
        note: `AUTO→EXACT promotion candidates: ${result.candidateCount}`,
        config_snapshot: JSON.stringify({
          profileId,
          projectId,
          dataset,
          stats: result.stats,
        }),
      };

      await insertExecution(executionRecord);

      logger.info("AUTO→EXACT shadow job completed via cron", {
        executionId,
        durationMs,
        candidateCount: result.candidateCount,
        success: result.success,
      });

      return res.json({
        success: result.success,
        durationMs,
        executionId: result.executionId,
        profileId,
        executionType,
        candidateCount: result.candidateCount,
        stats: result.stats,
        errorMessage: result.errorMessage,
      });
    } catch (err) {
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();
      const errorMessage = err instanceof Error ? err.message : String(err);

      logger.error("AUTO→EXACT shadow job failed via cron", {
        executionId,
        durationMs,
        profileId,
        error: errorMessage,
      });

      // エラー時も executions テーブルに保存
      try {
        const executionRecord: ExecutionRecord = {
          execution_id: executionId,
          profile_id: profileId,
          mode: "NORMAL",
          execution_type: executionType,
          trigger_type: "CRON_AUTO_EXACT_SHADOW",
          started_at: startedAt,
          ended_at: endedAt,
          duration_ms: durationMs,
          total_keywords: 0,
          reco_count: 0,
          action_strong_up: 0,
          action_up: 0,
          action_down: 0,
          action_stop: 0,
          action_keep: 0,
          status: "ERROR",
          error_message: errorMessage.substring(0, 1000),
          note: errorMessage.substring(0, 500),
          config_snapshot: JSON.stringify({ profileId, projectId, dataset }),
        };
        await insertExecution(executionRecord);
      } catch (bqError) {
        logger.error("Failed to log error to BigQuery", {
          error: bqError instanceof Error ? bqError.message : String(bqError),
        });
      }

      return res.status(500).json({
        success: false,
        error: "auto-exact-shadow-failed",
        executionId,
        message: errorMessage,
      });
    }
  }
);

// =============================================================================
// 掲載位置（Placement）最適化ジョブ
// =============================================================================

/**
 * POST /cron/run-placement-optimization
 *
 * Top of Search Impression Share を考慮した掲載位置入札調整比率の最適化
 *
 * インプレッションシェアによる「偽の限界点（Local Maximum）」回避ロジック:
 * - パターンA（勝ちパターン）: ACOS良好 → BOOST
 * - パターンB（オポチュニティ・ジャンプ）: ACOS悪い + IS低い → TEST_BOOST
 * - パターンC（撤退判断）: ACOS悪い + IS高い → DECREASE
 *
 * BID_ENGINE_EXECUTION_MODE 環境変数（SHADOW/APPLY）に従う
 *
 * リクエストボディ:
 * - targetCampaignIds?: string[] - 特定のキャンペーンのみ処理する場合
 * - dryRun?: boolean - true の場合、計算のみ行いテーブル更新しない
 *
 * レスポンス:
 * - success: boolean
 * - executionId: string
 * - mode: "SHADOW" | "APPLY"
 * - totalCampaigns: number
 * - totalPlacements: number
 * - recommendationsCount: number
 * - actionCounts: { BOOST, TEST_BOOST, DECREASE, NO_ACTION }
 * - opportunityJumpCount: number
 */
router.post(
  "/run-placement-optimization",
  async (req: Request, res: Response) => {
    const startTime = Date.now();

    const projectId =
      process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || "";
    const dataset = process.env.BQ_DATASET || "amazon_bid_engine";

    if (!projectId) {
      return res.status(500).json({
        success: false,
        error: "GCP_PROJECT_ID environment variable is not set",
      });
    }

    const targetCampaignIds = req.body?.targetCampaignIds as string[] | undefined;
    const dryRun = req.body?.dryRun === true;

    logger.info("Starting placement optimization job via cron", {
      targetCampaigns: targetCampaignIds?.length ?? "all",
      dryRun,
    });

    try {
      const engineConfig: PlacementEngineConfig = {
        projectId,
        dataset,
        targetCampaignIds,
        triggerSource: "CRON",
        dryRun,
      };

      const result = await runPlacementEngine(engineConfig);

      const durationMs = Date.now() - startTime;

      logger.info("Placement optimization job completed via cron", {
        durationMs,
        executionId: result.executionId,
        mode: result.mode,
        totalCampaigns: result.totalCampaigns,
        totalPlacements: result.totalPlacements,
        recommendationsCount: result.recommendationsCount,
        opportunityJumpCount: result.opportunityJumpCount,
      });

      return res.json({
        success: result.success,
        durationMs,
        executionId: result.executionId,
        mode: result.mode,
        totalCampaigns: result.totalCampaigns,
        totalPlacements: result.totalPlacements,
        recommendationsCount: result.recommendationsCount,
        actionCounts: result.actionCounts,
        opportunityJumpCount: result.opportunityJumpCount,
        // SHADOW モードでも推奨の概要を返す
        recommendations: result.recommendations.map((r) => ({
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          placement: r.placement,
          action: r.action,
          oldModifier: r.oldModifier,
          newModifier: r.newModifier,
          modifierChange: r.modifierChange,
          reasonCode: r.reasonCode,
          isOpportunityJump: r.isOpportunityJump,
        })),
        errorMessage: result.errorMessage,
      });
    } catch (err) {
      logger.error("Placement optimization job failed via cron", {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({
        success: false,
        error: "placement-optimization-failed",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// =============================================================================
// 日予算（Budget）最適化ジョブ
// =============================================================================

/**
 * POST /cron/run-budget-optimization
 *
 * Lost Impression Share (Budget) と ACOS を考慮した日予算の最適化
 *
 * コアコンセプト:
 * 「予算が足りない（Usageが高い または Lost ISがある）」かつ「利益が出ている（ACOSが低い）」
 * 場合のみ、予算を引き上げる。無駄遣いしているキャンペーンの予算は増やさない。
 *
 * BID_ENGINE_EXECUTION_MODE 環境変数（SHADOW/APPLY）に従う
 *
 * リクエストボディ:
 * - targetCampaignIds?: string[] - 特定のキャンペーンのみ処理する場合
 * - dryRun?: boolean - true の場合、計算のみ行いテーブル更新しない
 *
 * レスポンス:
 * - success: boolean
 * - executionId: string
 * - mode: "SHADOW" | "APPLY"
 * - totalCampaigns: number
 * - recommendationsCount: number
 * - actionCounts: { BOOST, KEEP, CURB }
 */
router.post(
  "/run-budget-optimization",
  async (req: Request, res: Response) => {
    const startTime = Date.now();

    const projectId =
      process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || "";
    const dataset = process.env.BQ_DATASET || "amazon_bid_engine";

    if (!projectId) {
      return res.status(500).json({
        success: false,
        error: "GCP_PROJECT_ID environment variable is not set",
      });
    }

    const targetCampaignIds = req.body?.targetCampaignIds as string[] | undefined;
    const dryRun = req.body?.dryRun === true;

    logger.info("Starting budget optimization job via cron", {
      targetCampaigns: targetCampaignIds?.length ?? "all",
      dryRun,
    });

    try {
      const engineConfig: BudgetEngineConfig = {
        projectId,
        dataset,
        targetCampaignIds,
        triggerSource: "CRON",
        dryRun,
      };

      const result = await runBudgetEngine(engineConfig);

      const durationMs = Date.now() - startTime;

      // 予算変更の総額を計算
      let totalBudgetIncrease = 0;
      let totalBudgetDecrease = 0;
      for (const rec of result.recommendations) {
        if (rec.budgetChange > 0) {
          totalBudgetIncrease += rec.budgetChange;
        } else if (rec.budgetChange < 0) {
          totalBudgetDecrease += Math.abs(rec.budgetChange);
        }
      }

      logger.info("Budget optimization job completed via cron", {
        durationMs,
        executionId: result.executionId,
        mode: result.mode,
        totalCampaigns: result.totalCampaigns,
        recommendationsCount: result.recommendationsCount,
        boostCount: result.actionCounts.BOOST,
        curbCount: result.actionCounts.CURB,
        totalBudgetIncrease,
        totalBudgetDecrease,
      });

      return res.json({
        success: result.success,
        durationMs,
        executionId: result.executionId,
        mode: result.mode,
        totalCampaigns: result.totalCampaigns,
        recommendationsCount: result.recommendationsCount,
        actionCounts: result.actionCounts,
        totalBudgetIncrease,
        totalBudgetDecrease,
        netBudgetChange: totalBudgetIncrease - totalBudgetDecrease,
        // SHADOW モードでも推奨の概要を返す
        recommendations: result.recommendations.map((r) => ({
          campaignId: r.campaignId,
          campaignName: r.campaignName,
          action: r.action,
          oldBudget: r.oldBudget,
          newBudget: r.newBudget,
          budgetChange: r.budgetChange,
          budgetChangePercent: r.budgetChangePercent,
          reasonCode: r.reasonCode,
          budgetUsagePercent: r.budgetUsagePercent,
          lostImpressionShareBudget: r.lostImpressionShareBudget,
          currentAcos7d: r.currentAcos7d,
          targetAcos: r.targetAcos,
          wasGuardClamped: r.wasGuardClamped,
        })),
        errorMessage: result.errorMessage,
      });
    } catch (err) {
      logger.error("Budget optimization job failed via cron", {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({
        success: false,
        error: "budget-optimization-failed",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// =============================================================================
// キーワード自動発見ジョブ
// =============================================================================

/**
 * POST /cron/run-keyword-discovery
 *
 * 検索語レポートから新しい有望キーワード候補を自動抽出し、
 * keyword_discovery_candidates テーブルに保存します。
 *
 * SHADOWモード専用: 自動でキャンペーンに追加はしない。人間レビュー前提。
 *
 * リクエストボディ:
 * - profileId?: string - 特定のプロファイルのみ処理する場合
 * - lookbackDays?: number - 検索語レポートのルックバック日数（デフォルト: 7）
 * - dryRun?: boolean - true の場合、計算のみ行いテーブル更新しない
 * - enableJungleScout?: boolean - Jungle Scout連携を有効にする（フェーズ二用）
 * - skipSlackNotification?: boolean - Slack通知をスキップする
 *
 * レスポンス:
 * - success: boolean
 * - executionId: string
 * - candidatesCount: number
 * - stats: { ... }
 * - slackNotificationSent: boolean
 */
router.post(
  "/run-keyword-discovery",
  async (req: Request, res: Response) => {
    const startTime = Date.now();

    const projectId =
      process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || "";
    const dataset = process.env.BQ_DATASET || "amazon_bid_engine";

    if (!projectId) {
      return res.status(500).json({
        success: false,
        error: "GCP_PROJECT_ID environment variable is not set",
      });
    }

    const profileId = req.body?.profileId as string | undefined;
    const lookbackDays = req.body?.lookbackDays as number | undefined;
    const dryRun = req.body?.dryRun === true;
    const enableJungleScout = req.body?.enableJungleScout === true;
    const skipSlackNotification = req.body?.skipSlackNotification === true;

    logger.info("Starting keyword discovery job via cron", {
      profileId: profileId ?? "(all)",
      lookbackDays: lookbackDays ?? 7,
      dryRun,
      enableJungleScout,
    });

    try {
      const result = await runKeywordDiscoveryJob({
        projectId,
        dataset,
        profileId,
        lookbackDays,
        dryRun,
        skipSlackNotification,
        config: {
          enableJungleScout,
        },
      });

      const durationMs = Date.now() - startTime;

      logger.info("Keyword discovery job completed via cron", {
        durationMs,
        executionId: result.executionId,
        candidatesCount: result.candidatesCount,
        success: result.success,
      });

      return res.json({
        success: result.success,
        durationMs,
        executionId: result.executionId,
        candidatesCount: result.candidatesCount,
        stats: result.stats,
        slackNotificationSent: result.slackNotificationSent,
        errorMessage: result.errorMessage,
        // dryRunの場合のみ候補を返す（サイズが大きくなる可能性があるため）
        candidates: dryRun ? result.candidates?.slice(0, 100).map((c) => ({
          asin: c.asin,
          query: c.query,
          score: c.score,
          source: c.source,
          suggestedMatchType: c.suggestedMatchType,
          impressions7d: c.searchTermMetrics?.impressions7d,
          clicks7d: c.searchTermMetrics?.clicks7d,
          orders7d: c.searchTermMetrics?.orders7d,
          acos7d: c.searchTermMetrics?.acos7d,
        })) : undefined,
      });
    } catch (err) {
      logger.error("Keyword discovery job failed via cron", {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({
        success: false,
        error: "keyword-discovery-failed",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// =============================================================================
// 季節性予測による先行入札調整ジョブ
// =============================================================================

/**
 * POST /cron/seasonality-update
 *
 * Jungle Scoutの検索ボリューム履歴データを使用して季節性予測を更新し、
 * seasonality_predictions テーブルに保存します。
 *
 * Pre-peak期間（ピークの7-30日前）に入札倍率を計算し、
 * bidEngineでの入札調整に使用されます。
 *
 * リクエストクエリ:
 * - projectId?: string - BigQueryプロジェクトID
 * - dataset?: string - BigQueryデータセット
 * - limit?: number - 処理するキーワード数の上限（デバッグ用）
 * - forceRefresh?: boolean - 有効期限内でも強制更新
 *
 * レスポンス:
 * - success: boolean
 * - executionId: string
 * - stats: { ... }
 */
router.post("/seasonality-update", createSeasonalityUpdateHandler());

/**
 * GET /cron/seasonality/:keyword
 *
 * 個別キーワードの季節性予測を取得します。
 * 必要に応じてJungle Scoutからデータを取得し、予測を更新します。
 *
 * パスパラメータ:
 * - keyword: string - 検索キーワード（URLエンコード）
 *
 * クエリパラメータ:
 * - projectId?: string - BigQueryプロジェクトID
 * - dataset?: string - BigQueryデータセット
 * - forceRefresh?: boolean - キャッシュを無視して強制更新
 * - debug?: boolean - デバッグ情報を含める
 *
 * レスポンス:
 * - success: boolean
 * - prediction: { ... }
 */
router.get("/seasonality/:keyword", createSeasonalityQueryHandler());

/**
 * GET /cron/seasonality/active-adjustments
 *
 * 現在アクティブな季節性調整（Pre-peak期間中）の一覧を取得します。
 *
 * クエリパラメータ:
 * - projectId?: string - BigQueryプロジェクトID
 * - dataset?: string - BigQueryデータセット
 * - asin?: string - ASINでフィルタ
 * - minMultiplier?: number - 最小倍率でフィルタ
 * - limit?: number - 取得件数上限
 * - offset?: number - オフセット
 *
 * レスポンス:
 * - success: boolean
 * - count: number
 * - adjustments: [ ... ]
 */
router.get("/seasonality/active-adjustments", createActiveAdjustmentsHandler());

/**
 * GET /cron/seasonality/stats
 *
 * 季節性調整ログの統計を取得します（SHADOW/APPLYの比較分析用）。
 *
 * クエリパラメータ:
 * - projectId?: string - BigQueryプロジェクトID
 * - dataset?: string - BigQueryデータセット
 * - daysBack?: number - 集計期間（デフォルト: 7日）
 *
 * レスポンス:
 * - success: boolean
 * - daysBack: number
 * - stats: { shadow: { ... }, apply: { ... } }
 */
router.get("/seasonality/stats", createAdjustmentStatsHandler());

export default router;

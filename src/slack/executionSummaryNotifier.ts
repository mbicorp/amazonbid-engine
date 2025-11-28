/**
 * Slack 実行サマリー通知モジュール
 *
 * ================================================================================
 * 【このファイルの役割】
 * ================================================================================
 *
 * この Slack 実行サマリー通知は、以下の両方を目的としています：
 *
 *   1. SHADOW モード検証用
 *      - 入札ロジックが正しく動作しているか確認
 *      - 異常な提案がないかチェック
 *
 *   2. APPLY モード本番運用時の監視用
 *      - 実際に適用される入札変更の傾向を把握
 *      - ロジック暴走を早期検出
 *
 * ================================================================================
 * 【重要: APPLY 移行後の運用について】
 * ================================================================================
 *
 * APPLY に移行した後も、このサマリー通知は基本的に有効のまま運用する前提です。
 *
 * 通知内容は、広告ロジックがどの ASIN に、どれくらい入札変更や
 * AUTO→EXACT 昇格候補を出しているかを人間が確認するための重要な監視レイヤーです。
 *
 * 将来この通知を無効化したり頻度を下げる場合は、必ず以下を確認してください：
 *
 *   1. BigQuery ダッシュボードなど、代替となる監視手段が十分に整っているか
 *   2. APPLY ロジックの挙動が安定しており、異常時にすぐ気付ける体制になっているか
 *
 * このコメントは、APPLY モードが安定稼働し、別の監視が整ったと判断できるまでは
 * 削除しないでください。
 *
 * ================================================================================
 */

import { BigQuery } from "@google-cloud/bigquery";
import { slackNotifier } from "../lib/slackNotifier";
import { logger } from "../logger";

// =============================================================================
// 定数
// =============================================================================

/**
 * 入札変更率に基づくラベル判定の閾値
 *
 * - AGGRESSIVE_THRESHOLD (1.2): avg_bid_change_ratio がこれ以上なら「攻め気味」
 * - DEFENSIVE_THRESHOLD (0.8): avg_bid_change_ratio がこれ以下なら「抑え気味」
 */
const AGGRESSIVE_THRESHOLD = 1.2;
const DEFENSIVE_THRESHOLD = 0.8;

/**
 * デフォルトの表示 ASIN 数
 */
const DEFAULT_MAX_ASINS = 5;

// =============================================================================
// 型定義
// =============================================================================

/**
 * 実行サマリー送信オプション
 */
export interface ExecutionSummaryOptions {
  /** 実行ID */
  executionId: string;
  /** 表示する ASIN の最大数（デフォルト: 5） */
  maxAsins?: number;
  /** BigQuery プロジェクトID（環境変数から取得しない場合） */
  projectId?: string;
  /** BigQuery データセット（環境変数から取得しない場合） */
  dataset?: string;
}

/**
 * 実行情報（executions テーブルから取得）
 */
interface ExecutionInfo {
  execution_id: string;
  profile_id: string;
  execution_type: string;
  mode: string;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
}

/**
 * ASIN サマリー（v_execution_asin_summary から取得）
 */
interface AsinSummary {
  asin: string;
  total_keywords: number;
  avg_bid_change_ratio: number | null;
  action_up_count: number;
  action_down_count: number;
  action_keep_count: number;
  calculated_acos: number | null;
  calculated_cvr: number | null;
  auto_exact_candidates: number;
}

/**
 * 送信結果
 */
export interface SendExecutionSummaryResult {
  success: boolean;
  asinCount: number;
  error?: string;
}

// =============================================================================
// 環境変数によるモード制御
// =============================================================================

/**
 * 指定されたモードで Slack 実行サマリーが有効かどうかを判定
 *
 * 環境変数 ENABLE_SLACK_EXECUTION_SUMMARY_MODES にカンマ区切りでモードを指定
 * 例: "SHADOW,APPLY"
 *
 * 【注意】
 * この設定で指定されたモードだけ、Slack 実行サマリーが送信されます。
 * APPLY モードを本番運用している間は、基本的に APPLY を一覧から外さない運用を想定しています。
 * 本番で完全に通知を止める場合は：
 *   1. BigQuery ダッシュボードなどで同等以上の監視ができているか
 *   2. ロジック暴走時に気付ける別の仕組みがあるか
 * を確認した上で判断してください。
 *
 * @param mode - 実行モード（"SHADOW" | "APPLY" など）
 * @returns 有効な場合 true
 */
export function isSlackExecutionSummaryEnabledForMode(mode: string): boolean {
  const enabledModes = process.env.ENABLE_SLACK_EXECUTION_SUMMARY_MODES ?? "";
  if (!enabledModes) {
    return false;
  }

  const modeList = enabledModes
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter((m) => m.length > 0);

  return modeList.includes(mode.toUpperCase());
}

// =============================================================================
// BigQuery データ取得
// =============================================================================

/**
 * 実行情報を取得
 */
async function fetchExecutionInfo(
  bigquery: BigQuery,
  projectId: string,
  dataset: string,
  executionId: string
): Promise<ExecutionInfo | null> {
  const query = `
    SELECT
      execution_id,
      profile_id,
      execution_type,
      mode,
      status,
      started_at,
      finished_at,
      duration_ms
    FROM \`${projectId}.${dataset}.executions\`
    WHERE execution_id = @executionId
    LIMIT 1
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { executionId },
      location: "asia-northeast1",
    });

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      execution_id: row.execution_id,
      profile_id: row.profile_id ?? "unknown",
      execution_type: row.execution_type ?? "unknown",
      mode: row.mode ?? "unknown",
      status: row.status ?? "unknown",
      started_at: row.started_at ? new Date(row.started_at.value ?? row.started_at) : new Date(),
      finished_at: row.finished_at ? new Date(row.finished_at.value ?? row.finished_at) : null,
      duration_ms: row.duration_ms ?? null,
    };
  } catch (error) {
    logger.error("Failed to fetch execution info", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * ASIN サマリーを取得
 */
async function fetchAsinSummaries(
  bigquery: BigQuery,
  projectId: string,
  dataset: string,
  executionId: string,
  maxAsins: number
): Promise<AsinSummary[]> {
  // ビューが存在しない場合に備えて、実テーブルから直接集計するクエリも用意
  const query = `
    SELECT
      br.asin,
      COUNT(DISTINCT br.keyword_id) AS total_keywords,
      AVG(br.bid_change_ratio) AS avg_bid_change_ratio,
      COUNTIF(br.bid_change > 0) AS action_up_count,
      COUNTIF(br.bid_change < 0) AS action_down_count,
      COUNTIF(br.bid_change = 0) AS action_keep_count,
      SAFE_DIVIDE(SUM(br.cost), SUM(br.sales)) AS calculated_acos,
      SAFE_DIVIDE(SUM(br.orders), SUM(br.clicks)) AS calculated_cvr,
      COALESCE(aeps.auto_exact_candidates, 0) AS auto_exact_candidates
    FROM \`${projectId}.${dataset}.bid_recommendations\` br
    LEFT JOIN (
      SELECT
        execution_id,
        asin,
        COUNT(*) AS auto_exact_candidates
      FROM \`${projectId}.${dataset}.auto_exact_promotion_suggestions\`
      WHERE execution_id = @executionId
      GROUP BY execution_id, asin
    ) aeps
      ON br.execution_id = aeps.execution_id AND br.asin = aeps.asin
    WHERE br.execution_id = @executionId
      AND br.asin IS NOT NULL
    GROUP BY br.asin, aeps.auto_exact_candidates
    ORDER BY
      auto_exact_candidates DESC,
      total_keywords DESC
    LIMIT @maxAsins
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { executionId, maxAsins },
      location: "asia-northeast1",
    });

    return rows.map((row: Record<string, unknown>) => ({
      asin: row.asin as string,
      total_keywords: Number(row.total_keywords) || 0,
      avg_bid_change_ratio: row.avg_bid_change_ratio != null ? Number(row.avg_bid_change_ratio) : null,
      action_up_count: Number(row.action_up_count) || 0,
      action_down_count: Number(row.action_down_count) || 0,
      action_keep_count: Number(row.action_keep_count) || 0,
      calculated_acos: row.calculated_acos != null ? Number(row.calculated_acos) : null,
      calculated_cvr: row.calculated_cvr != null ? Number(row.calculated_cvr) : null,
      auto_exact_candidates: Number(row.auto_exact_candidates) || 0,
    }));
  } catch (error) {
    logger.error("Failed to fetch ASIN summaries", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// =============================================================================
// メッセージ構築
// =============================================================================

/**
 * 攻め具合ラベルを取得
 */
function getBidDirectionLabel(avgBidChangeRatio: number | null): string {
  if (avgBidChangeRatio === null) {
    return "";
  }
  if (avgBidChangeRatio >= AGGRESSIVE_THRESHOLD) {
    return " [攻め気味]";
  }
  if (avgBidChangeRatio <= DEFENSIVE_THRESHOLD) {
    return " [抑え気味]";
  }
  return "";
}

/**
 * 実行サマリーのSlackメッセージを構築
 */
function buildSummaryMessage(
  execution: ExecutionInfo,
  asinSummaries: AsinSummary[]
): string {
  const lines: string[] = [];

  // ヘッダー
  lines.push("*Amazon Bid Engine 実行サマリー*");
  lines.push("");

  // 概要部分
  lines.push("```");
  lines.push(`実行ID:      ${execution.execution_id}`);
  lines.push(`プロファイル: ${execution.profile_id}`);
  lines.push(`モード:      ${execution.mode}`);
  lines.push(`タイプ:      ${execution.execution_type}`);
  lines.push(`ステータス:  ${execution.status}`);

  // 開始時刻と所要時間
  const startedAt = execution.started_at.toISOString().replace("T", " ").substring(0, 19);
  lines.push(`開始時刻:    ${startedAt}`);

  if (execution.duration_ms !== null) {
    const durationSec = (execution.duration_ms / 1000).toFixed(1);
    lines.push(`所要時間:    ${durationSec} 秒`);
  }
  lines.push("```");

  // ASIN サマリー
  if (asinSummaries.length === 0) {
    lines.push("");
    lines.push("_該当する ASIN データがありません_");
  } else {
    lines.push("");
    lines.push("*ASIN サマリー（上位）*");
    lines.push("");

    for (const summary of asinSummaries) {
      const bidLabel = getBidDirectionLabel(summary.avg_bid_change_ratio);
      const ratioStr = summary.avg_bid_change_ratio !== null
        ? `${(summary.avg_bid_change_ratio * 100 - 100).toFixed(1)}%`
        : "N/A";
      const acosStr = summary.calculated_acos !== null
        ? `${(summary.calculated_acos * 100).toFixed(1)}%`
        : "N/A";

      lines.push(`• *${summary.asin}*${bidLabel}`);
      lines.push(`  KW: ${summary.total_keywords} | 変化率: ${ratioStr} | ACOS: ${acosStr} | AUTO→EXACT候補: ${summary.auto_exact_candidates}`);
      lines.push(`  (UP: ${summary.action_up_count} / DOWN: ${summary.action_down_count} / KEEP: ${summary.action_keep_count})`);
    }
  }

  return lines.join("\n");
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * 実行サマリーを Slack に送信
 *
 * @param options - 送信オプション
 * @returns 送信結果
 */
export async function sendExecutionSummaryToSlack(
  options: ExecutionSummaryOptions
): Promise<SendExecutionSummaryResult> {
  const {
    executionId,
    maxAsins = DEFAULT_MAX_ASINS,
    projectId = process.env.GCP_PROJECT_ID ?? "",
    dataset = process.env.BQ_DATASET ?? "amazon_bid_engine",
  } = options;

  if (!projectId) {
    logger.warn("Slack実行サマリースキップ: GCP_PROJECT_ID未設定");
    return { success: false, asinCount: 0, error: "GCP_PROJECT_ID not set" };
  }

  // Slack が設定されていない場合はスキップ
  if (!slackNotifier.isConfigured()) {
    logger.warn("Slack実行サマリースキップ: Slack未設定");
    return { success: false, asinCount: 0, error: "Slack not configured" };
  }

  const bigquery = new BigQuery({ projectId });

  try {
    // 1. 実行情報を取得
    const execution = await fetchExecutionInfo(bigquery, projectId, dataset, executionId);

    if (!execution) {
      logger.warn("Slack実行サマリースキップ: 実行情報が見つかりません", { executionId });
      return { success: false, asinCount: 0, error: "Execution not found" };
    }

    // 2. ASIN サマリーを取得
    const asinSummaries = await fetchAsinSummaries(
      bigquery,
      projectId,
      dataset,
      executionId,
      maxAsins
    );

    // 3. メッセージを構築
    const message = buildSummaryMessage(execution, asinSummaries);

    // 4. Slack に送信
    const success = await slackNotifier.send(message, "info");

    if (success) {
      logger.info("Slack実行サマリー送信成功", {
        executionId,
        asinCount: asinSummaries.length,
      });
    } else {
      logger.warn("Slack実行サマリー送信失敗", { executionId });
    }

    return {
      success,
      asinCount: asinSummaries.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Slack実行サマリー送信エラー", {
      executionId,
      error: errorMessage,
    });

    // エラーを投げ直さない（通知失敗でもメイン処理は続行させる）
    return {
      success: false,
      asinCount: 0,
      error: errorMessage,
    };
  }
}

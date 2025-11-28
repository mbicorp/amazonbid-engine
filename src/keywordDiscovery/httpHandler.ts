/**
 * キーワード発見機能 HTTP ハンドラー
 *
 * 日次バッチの入口となる関数を提供。
 * Cloud Scheduler または手動トリガーから呼び出される想定。
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import { BIGQUERY } from "../constants";
import { slackNotifier } from "../lib/slackNotifier";
import {
  KeywordDiscoveryConfig,
  DEFAULT_KEYWORD_DISCOVERY_CONFIG,
  KeywordDiscoveryResult,
  KeywordDiscoveryStats,
  CandidateKeyword,
} from "./types";
import {
  runKeywordDiscovery,
  normalizeKeyword,
} from "./engine";
import {
  getKeywordDiscoveryRepository,
  KeywordDiscoveryRepository,
} from "./repository";

// =============================================================================
// ジョブオプション
// =============================================================================

/**
 * キーワード発見ジョブのオプション
 */
export interface RunKeywordDiscoveryJobOptions {
  /** BigQuery プロジェクトID */
  projectId?: string;

  /** BigQuery データセット */
  dataset?: string;

  /** プロファイルID（特定プロファイルのみ処理する場合） */
  profileId?: string;

  /** 検索語レポートのルックバック日数（デフォルト: 7） */
  lookbackDays?: number;

  /** キーワード発見設定 */
  config?: Partial<KeywordDiscoveryConfig>;

  /** 実行ID（省略時は自動生成） */
  executionId?: string;

  /** ドライラン（true の場合、BigQueryに保存しない） */
  dryRun?: boolean;

  /** Slack通知を無効化 */
  skipSlackNotification?: boolean;
}

/**
 * キーワード発見ジョブの結果
 */
export interface RunKeywordDiscoveryJobResult extends KeywordDiscoveryResult {
  /** 処理日時 */
  executedAt: Date;

  /** 設定 */
  configUsed: KeywordDiscoveryConfig;

  /** Slack通知結果 */
  slackNotificationSent?: boolean;
}

// =============================================================================
// メインジョブ関数
// =============================================================================

/**
 * キーワード発見ジョブを実行
 *
 * 処理フロー:
 * 1. 対象期間の検索語レポートを BigQuery から取得
 * 2. 既存のキーワード一覧を取得
 * 3. engine の discoverNewKeywordsFromSearchTerms を呼び出し候補生成
 * 4. config.enableJungleScout の値を見て、将来は discoverNewKeywordsFromJungleScout も呼び出す
 * 5. mergeAndScoreCandidates で統合
 * 6. keyword_discovery_candidates テーブルへ upsert
 * 7. 実行件数や上位候補の概要をログ出力し、Slack通知を送る
 */
export async function runKeywordDiscoveryJob(
  options: RunKeywordDiscoveryJobOptions = {}
): Promise<RunKeywordDiscoveryJobResult> {
  const startTime = Date.now();
  const executedAt = new Date();
  const executionId = options.executionId ?? uuidv4();

  const projectId = options.projectId ?? BIGQUERY.PROJECT_ID;
  const dataset = options.dataset ?? BIGQUERY.DATASET_ID;
  const profileId = options.profileId;
  const lookbackDays = options.lookbackDays ?? 7;
  const dryRun = options.dryRun ?? false;
  const skipSlackNotification = options.skipSlackNotification ?? false;

  // 設定をマージ
  const config: KeywordDiscoveryConfig = {
    ...DEFAULT_KEYWORD_DISCOVERY_CONFIG,
    ...options.config,
  };

  logger.info("Starting keyword discovery job", {
    executionId,
    projectId,
    dataset,
    profileId: profileId ?? "(all)",
    lookbackDays,
    dryRun,
    enableJungleScout: config.enableJungleScout,
  });

  try {
    // リポジトリを取得
    const repository = getKeywordDiscoveryRepository(projectId, dataset);

    // 1. 検索語レポートを取得
    logger.info("Fetching search term report...", { executionId });
    const searchTerms = await repository.fetchSearchTermReport(profileId, lookbackDays);
    logger.info("Fetched search term report", {
      executionId,
      count: searchTerms.length,
    });

    // 2. 既存キーワードを取得
    logger.info("Fetching existing keywords...", { executionId });
    const existingKeywords = await repository.fetchExistingKeywords(profileId);
    logger.info("Fetched existing keywords", {
      executionId,
      count: existingKeywords.length,
    });

    // 3. 商品設定を取得
    logger.info("Fetching product configs...", { executionId });
    const productConfigs = await repository.fetchProductConfigs();
    logger.info("Fetched product configs", {
      executionId,
      count: productConfigs.size,
    });

    // 4. キーワード発見を実行
    logger.info("Running keyword discovery...", { executionId });
    const { candidates, stats } = await runKeywordDiscovery(
      searchTerms,
      existingKeywords,
      productConfigs,
      config
    );

    // 5. BigQueryに保存（ドライランでなければ）
    if (!dryRun && candidates.length > 0) {
      logger.info("Upserting candidates to BigQuery...", {
        executionId,
        count: candidates.length,
      });
      await repository.upsertCandidateKeywords(candidates);
      logger.info("Upserted candidates to BigQuery", {
        executionId,
        count: candidates.length,
      });
    } else if (dryRun) {
      logger.info("Dry run mode - skipping BigQuery upsert", {
        executionId,
        candidatesCount: candidates.length,
      });
    }

    // 6. Slack通知
    let slackNotificationSent = false;
    if (!skipSlackNotification && candidates.length > 0) {
      slackNotificationSent = await sendSlackNotification(
        executionId,
        executedAt,
        candidates,
        stats,
        dryRun,
        repository
      );
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info("Completed keyword discovery job", {
      executionId,
      candidatesCount: candidates.length,
      processingTimeMs,
      slackNotificationSent,
    });

    return {
      executionId,
      success: true,
      candidatesCount: candidates.length,
      stats: {
        ...stats,
        processingTimeMs,
      },
      candidates: dryRun ? candidates : undefined,
      executedAt,
      configUsed: config,
      slackNotificationSent,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Failed keyword discovery job", {
      executionId,
      error: errorMessage,
      processingTimeMs,
    });

    return {
      executionId,
      success: false,
      candidatesCount: 0,
      stats: {
        totalAsinsProcessed: 0,
        totalSearchTermsProcessed: 0,
        duplicatesExcluded: 0,
        belowThresholdExcluded: 0,
        searchTermCandidates: 0,
        jungleScoutCandidates: 0,
        finalCandidates: 0,
        processingTimeMs,
      },
      errorMessage,
      executedAt,
      configUsed: config,
    };
  }
}

// =============================================================================
// Slack通知
// =============================================================================

/**
 * Slack通知を送信
 */
async function sendSlackNotification(
  executionId: string,
  executedAt: Date,
  candidates: CandidateKeyword[],
  stats: KeywordDiscoveryStats,
  dryRun: boolean,
  repository: KeywordDiscoveryRepository
): Promise<boolean> {
  try {
    if (!slackNotifier.isConfigured()) {
      logger.warn("Slack is not configured, skipping notification");
      return false;
    }

    // 対象ASIN数をカウント
    const uniqueAsins = new Set(candidates.map((c) => c.asin));

    // 上位候補を取得
    const topCandidates = candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // メッセージを構築
    const lines: string[] = [];
    lines.push("*キーワード自動発見 実行サマリー*");
    lines.push("");
    lines.push("```");
    lines.push(`実行ID:      ${executionId}`);
    lines.push(`対象日:      ${executedAt.toISOString().split("T")[0]}`);
    lines.push(`モード:      ${dryRun ? "DRY RUN" : "SHADOW"}`);
    lines.push("```");
    lines.push("");
    lines.push("*結果*");
    lines.push(`- 新規候補キーワード数: *${candidates.length}* 件`);
    lines.push(`- 対象ASIN数: *${uniqueAsins.size}* 件`);
    lines.push(`- 処理した検索語数: ${stats.totalSearchTermsProcessed} 件`);
    lines.push(`- 重複除外: ${stats.duplicatesExcluded} 件`);
    lines.push(`- 閾値未満除外: ${stats.belowThresholdExcluded} 件`);

    if (topCandidates.length > 0) {
      lines.push("");
      lines.push("*上位候補例*");
      for (const candidate of topCandidates) {
        const source = candidate.source === "BOTH" ? "両方" :
          candidate.source === "SEARCH_TERM" ? "検索語" : "JS";
        lines.push(`• ${candidate.asin} | "${candidate.query}" | スコア: ${candidate.score} | ソース: ${source}`);
      }
    }

    lines.push("");
    lines.push(`_処理時間: ${(stats.processingTimeMs / 1000).toFixed(1)}秒_`);

    const message = lines.join("\n");
    const success = await slackNotifier.send(message, "info");

    if (success) {
      logger.info("Sent Slack notification for keyword discovery", {
        executionId,
        candidatesCount: candidates.length,
      });
    }

    return success;
  } catch (error) {
    logger.error("Failed to send Slack notification", {
      executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// =============================================================================
// Express ルートハンドラー用のファクトリ関数
// =============================================================================

/**
 * Express ルートハンドラーを生成
 *
 * 使用例:
 * router.post("/run-keyword-discovery", createKeywordDiscoveryHandler());
 */
export function createKeywordDiscoveryHandler() {
  return async (req: any, res: any) => {
    const startTime = Date.now();

    const projectId = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || "";
    const dataset = process.env.BQ_DATASET || "amazon_bid_engine";

    if (!projectId) {
      return res.status(500).json({
        success: false,
        error: "GCP_PROJECT_ID environment variable is not set",
      });
    }

    // リクエストボディからオプションを取得
    const profileId = req.body?.profileId as string | undefined;
    const lookbackDays = req.body?.lookbackDays as number | undefined;
    const dryRun = req.body?.dryRun === true;
    const enableJungleScout = req.body?.enableJungleScout === true;
    const skipSlackNotification = req.body?.skipSlackNotification === true;

    logger.info("Starting keyword discovery job via HTTP", {
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

      logger.info("Keyword discovery job completed via HTTP", {
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
        // dryRunの場合のみ候補を返す
        candidates: dryRun ? result.candidates?.map((c) => ({
          asin: c.asin,
          query: c.query,
          score: c.score,
          source: c.source,
          suggestedMatchType: c.suggestedMatchType,
          metrics: c.searchTermMetrics ? {
            impressions7d: c.searchTermMetrics.impressions7d,
            clicks7d: c.searchTermMetrics.clicks7d,
            orders7d: c.searchTermMetrics.orders7d,
            acos7d: c.searchTermMetrics.acos7d,
            cvr7d: c.searchTermMetrics.cvr7d,
          } : null,
        })) : undefined,
      });
    } catch (err) {
      logger.error("Keyword discovery job failed via HTTP", {
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({
        success: false,
        error: "keyword-discovery-failed",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

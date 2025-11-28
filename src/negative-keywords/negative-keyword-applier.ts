/**
 * ネガティブキーワード候補の適用ロジック
 *
 * 承認済み（APPROVED）の候補をAmazon Ads APIに適用し、
 * BigQueryのステータスを更新する
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  createNegativeKeywords,
  CreateNegativeKeywordRequest,
} from "../amazonAdsClient";
import { NegativeMatchType } from "./types";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 適用対象のネガティブキーワード候補
 */
export interface NegativeKeywordApplyCandidate {
  suggestionId: string;
  asin: string;
  query: string;
  matchType: NegativeMatchType;
  campaignId: string;
  adGroupId: string;
  role: string;
  clicks30d: number;
  cost30d: number;
}

/**
 * 適用設定
 */
export interface NegativeApplyConfig {
  /** 適用機能が有効かどうか */
  enabled: boolean;

  /** 1回の実行で適用する最大件数 */
  maxApplyPerRun: number;

  /** 自動適用を許可する最小クリック数（高信頼度基準） */
  autoApplyMinClicks: number;

  /** 自動適用を許可する最小コスト（高信頼度基準） */
  autoApplyMinCost: number;

  /** BigQuery プロジェクトID */
  projectId: string;

  /** BigQuery データセット */
  dataset: string;
}

/**
 * 適用結果
 */
export interface NegativeApplyResult {
  /** 処理した候補数 */
  totalProcessed: number;

  /** 適用成功件数 */
  successCount: number;

  /** 適用失敗件数 */
  failedCount: number;

  /** スキップ件数（上限超過など） */
  skippedCount: number;

  /** 成功した候補ID */
  appliedIds: string[];

  /** 失敗した候補とエラー */
  errors: Array<{
    suggestionId: string;
    error: string;
  }>;
}

// =============================================================================
// 設定ローダー
// =============================================================================

/**
 * 環境変数からネガティブキーワード適用設定を読み込む
 */
export function loadNegativeApplyConfig(): NegativeApplyConfig {
  return {
    enabled: process.env.NEGATIVE_APPLY_ENABLED === "true",
    maxApplyPerRun: parseInt(process.env.MAX_APPLY_CHANGES_PER_RUN || "100", 10),
    autoApplyMinClicks: parseInt(process.env.NEGATIVE_AUTO_APPLY_MIN_CLICKS || "50", 10),
    autoApplyMinCost: parseFloat(process.env.NEGATIVE_AUTO_APPLY_MIN_COST || "2000"),
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || "",
    dataset: process.env.BIGQUERY_DATASET || "amazon_bid_engine",
  };
}

// =============================================================================
// BigQuery 操作
// =============================================================================

/**
 * 承認済みの候補を取得
 *
 * 条件A: status = 'APPROVED'（人間が承認済み）
 * campaign_idとad_group_idが設定されている候補のみ取得
 */
async function fetchApprovedCandidates(
  bigquery: BigQuery,
  config: NegativeApplyConfig,
  limit: number
): Promise<NegativeKeywordApplyCandidate[]> {
  const query = `
    SELECT
      suggestion_id,
      asin,
      query,
      match_type,
      campaign_id,
      ad_group_id,
      role,
      clicks_30d,
      cost_30d
    FROM \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
    WHERE status = 'APPROVED'
      AND is_applied = FALSE
      AND campaign_id IS NOT NULL
      AND ad_group_id IS NOT NULL
    ORDER BY cost_30d DESC
    LIMIT @limit
  `;

  const [rows] = await bigquery.query({
    query,
    params: { limit },
    location: "asia-northeast1",
  });

  return rows.map((row: Record<string, unknown>) => ({
    suggestionId: String(row.suggestion_id),
    asin: String(row.asin),
    query: String(row.query),
    matchType: String(row.match_type) as NegativeMatchType,
    campaignId: String(row.campaign_id),
    adGroupId: String(row.ad_group_id),
    role: String(row.role),
    clicks30d: Number(row.clicks_30d) || 0,
    cost30d: Number(row.cost_30d) || 0,
  }));
}

/**
 * 高信頼度で自動適用可能な候補を取得
 *
 * 条件B: status = 'PENDING' かつ信頼度が高い
 * （クリック数・コストが閾値以上 かつ CVR=0）
 * campaign_idとad_group_idが設定されている候補のみ取得
 */
async function fetchAutoApplyCandidates(
  bigquery: BigQuery,
  config: NegativeApplyConfig,
  limit: number
): Promise<NegativeKeywordApplyCandidate[]> {
  const query = `
    SELECT
      suggestion_id,
      asin,
      query,
      match_type,
      campaign_id,
      ad_group_id,
      role,
      clicks_30d,
      cost_30d
    FROM \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
    WHERE status = 'PENDING'
      AND is_applied = FALSE
      AND campaign_id IS NOT NULL
      AND ad_group_id IS NOT NULL
      AND clicks_30d >= @minClicks
      AND cost_30d >= @minCost
      AND (cvr_30d IS NULL OR cvr_30d = 0)
      AND conversions_30d = 0
    ORDER BY cost_30d DESC
    LIMIT @limit
  `;

  const [rows] = await bigquery.query({
    query,
    params: {
      limit,
      minClicks: config.autoApplyMinClicks,
      minCost: config.autoApplyMinCost,
    },
    location: "asia-northeast1",
  });

  return rows.map((row: Record<string, unknown>) => ({
    suggestionId: String(row.suggestion_id),
    asin: String(row.asin),
    query: String(row.query),
    matchType: String(row.match_type) as NegativeMatchType,
    campaignId: String(row.campaign_id),
    adGroupId: String(row.ad_group_id),
    role: String(row.role),
    clicks30d: Number(row.clicks_30d) || 0,
    cost30d: Number(row.cost_30d) || 0,
  }));
}

/**
 * 候補のステータスを APPLIED に更新
 */
async function markAsApplied(
  bigquery: BigQuery,
  config: NegativeApplyConfig,
  suggestionIds: string[]
): Promise<void> {
  if (suggestionIds.length === 0) return;

  const query = `
    UPDATE \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
    SET
      status = 'APPLIED',
      is_applied = TRUE,
      applied_at = CURRENT_TIMESTAMP()
    WHERE suggestion_id IN UNNEST(@suggestionIds)
  `;

  await bigquery.query({
    query,
    params: { suggestionIds },
    location: "asia-northeast1",
  });
}

/**
 * 候補のエラーを記録
 */
async function markAsError(
  bigquery: BigQuery,
  config: NegativeApplyConfig,
  suggestionId: string,
  error: string
): Promise<void> {
  const query = `
    UPDATE \`${config.projectId}.${config.dataset}.negative_keyword_suggestions\`
    SET
      apply_error = @error
    WHERE suggestion_id = @suggestionId
  `;

  await bigquery.query({
    query,
    params: { suggestionId, error },
    location: "asia-northeast1",
  });
}

// =============================================================================
// マッチタイプ変換
// =============================================================================

/**
 * 内部マッチタイプをAmazon Ads APIのネガティブマッチタイプに変換
 */
function toNegativeMatchType(
  matchType: NegativeMatchType
): "NEGATIVE_EXACT" | "NEGATIVE_PHRASE" {
  switch (matchType) {
    case "EXACT":
      return "NEGATIVE_EXACT";
    case "PHRASE":
      return "NEGATIVE_PHRASE";
    case "AUTO":
      // AUTOの場合はEXACTとして登録（最も安全）
      return "NEGATIVE_EXACT";
    default:
      return "NEGATIVE_EXACT";
  }
}

// =============================================================================
// メイン適用ロジック
// =============================================================================

/**
 * 承認済みネガティブキーワード候補をAmazon Ads APIに適用
 *
 * @param options オプション
 * @returns 適用結果
 */
export async function applyApprovedNegativeKeywords(options: {
  dryRun?: boolean;
  maxItems?: number;
  includeAutoApply?: boolean;
}): Promise<NegativeApplyResult> {
  const config = loadNegativeApplyConfig();

  logger.info("Starting negative keyword apply process", {
    enabled: config.enabled,
    dryRun: options.dryRun ?? false,
    maxItems: options.maxItems,
    includeAutoApply: options.includeAutoApply ?? false,
  });

  // 結果オブジェクト
  const result: NegativeApplyResult = {
    totalProcessed: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    appliedIds: [],
    errors: [],
  };

  // 機能が無効の場合
  if (!config.enabled) {
    logger.warn("Negative keyword apply is disabled");
    return result;
  }

  // プロジェクトIDチェック
  if (!config.projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT_ID is not configured");
  }

  const bigquery = new BigQuery({ projectId: config.projectId });
  const maxItems = Math.min(
    options.maxItems ?? config.maxApplyPerRun,
    config.maxApplyPerRun
  );

  // 候補を取得
  let candidates: NegativeKeywordApplyCandidate[] = [];

  // 条件A: 承認済み候補
  const approvedCandidates = await fetchApprovedCandidates(
    bigquery,
    config,
    maxItems
  );
  candidates.push(...approvedCandidates);

  logger.info("Fetched approved candidates", {
    count: approvedCandidates.length,
  });

  // 条件B: 自動適用対象（オプション）
  if (options.includeAutoApply && candidates.length < maxItems) {
    const remainingSlots = maxItems - candidates.length;
    const autoApplyCandidates = await fetchAutoApplyCandidates(
      bigquery,
      config,
      remainingSlots
    );
    candidates.push(...autoApplyCandidates);

    logger.info("Fetched auto-apply candidates", {
      count: autoApplyCandidates.length,
    });
  }

  result.totalProcessed = candidates.length;

  if (candidates.length === 0) {
    logger.info("No candidates to apply");
    return result;
  }

  // Dry run の場合はここで終了
  if (options.dryRun) {
    logger.info("Dry run - skipping actual API calls", {
      wouldApply: candidates.length,
    });
    result.skippedCount = candidates.length;
    return result;
  }

  // Amazon Ads APIリクエストを構築
  const requests: Array<CreateNegativeKeywordRequest & { suggestionId: string }> =
    candidates.map((candidate) => ({
      suggestionId: candidate.suggestionId,
      campaignId: candidate.campaignId,
      adGroupId: candidate.adGroupId,
      keywordText: candidate.query,
      matchType: toNegativeMatchType(candidate.matchType),
    }));

  // バッチでAPIに送信
  try {
    const apiResult = await createNegativeKeywords(
      requests.map(({ suggestionId, ...req }) => req)
    );

    // 成功した候補を記録
    const successIds: string[] = [];
    for (let i = 0; i < apiResult.success.length; i++) {
      // 成功した候補のIDを特定（レスポンスの順序は保証されない場合があるため注意）
      if (i < requests.length) {
        successIds.push(requests[i].suggestionId);
      }
    }

    // 失敗した候補を記録
    for (const error of apiResult.errors) {
      if (error.index < requests.length) {
        result.errors.push({
          suggestionId: requests[error.index].suggestionId,
          error: `${error.code}: ${error.details}`,
        });
      }
    }

    result.successCount = apiResult.success.length;
    result.failedCount = apiResult.errors.length;
    result.appliedIds = successIds;

    // BigQueryを更新
    if (successIds.length > 0) {
      await markAsApplied(bigquery, config, successIds);
      logger.info("Marked candidates as applied", { count: successIds.length });
    }

    // エラーを記録
    for (const err of result.errors) {
      await markAsError(bigquery, config, err.suggestionId, err.error);
    }
  } catch (error) {
    logger.error("Failed to apply negative keywords via API", {
      error: error instanceof Error ? error.message : String(error),
    });

    // 全候補をエラーとして記録
    for (const candidate of candidates) {
      result.errors.push({
        suggestionId: candidate.suggestionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    result.failedCount = candidates.length;
  }

  logger.info("Negative keyword apply process completed", {
    totalProcessed: result.totalProcessed,
    successCount: result.successCount,
    failedCount: result.failedCount,
  });

  return result;
}

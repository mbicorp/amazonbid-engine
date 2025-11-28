/**
 * AUTO→EXACT 昇格候補の適用ロジック
 *
 * 承認済み（APPROVED）の候補をAmazon Ads APIに適用し、
 * BigQueryのステータスを更新する
 *
 * 適用時の処理:
 * 1. ターゲットMANUALキャンペーンにEXACTキーワードを作成
 * 2. 元のAUTOキャンペーンにネガティブEXACTを登録（カニバリゼーション防止）
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  createKeywords,
  createCampaignNegativeKeywords,
  CreateKeywordRequest,
} from "../amazonAdsClient";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 適用対象のAUTO→EXACT昇格候補
 */
export interface AutoExactApplyCandidate {
  suggestionId: string;
  profileId: string;
  asin: string;
  searchTerm: string;
  campaignIdAuto: string;
  adGroupIdAuto: string;
  campaignIdManualTarget: string | null;
  adGroupIdManualTarget: string | null;
  cvr: number;
  acos: number;
  targetAcos: number;
  score: number;
  recommendedBid: number;
}

/**
 * 適用設定
 */
export interface AutoExactApplyConfig {
  /** 適用機能が有効かどうか */
  enabled: boolean;

  /** 1回の実行で適用する最大件数 */
  maxApplyPerRun: number;

  /** デフォルト入札額（recommended_bidがない場合） */
  defaultBid: number;

  /** BigQuery プロジェクトID */
  projectId: string;

  /** BigQuery データセット */
  dataset: string;
}

/**
 * 個別の適用結果
 */
export interface AutoExactApplyItemResult {
  suggestionId: string;
  searchTerm: string;
  keywordCreated: boolean;
  keywordId?: string;
  negativeCreated: boolean;
  negativeKeywordId?: string;
  error?: string;
}

/**
 * 適用結果
 */
export interface AutoExactApplyResult {
  /** 処理した候補数 */
  totalProcessed: number;

  /** 完全に成功した件数（キーワード作成 + ネガティブ登録 両方成功） */
  successCount: number;

  /** 部分的に成功した件数（キーワード作成のみ成功） */
  partialSuccessCount: number;

  /** 失敗件数 */
  failedCount: number;

  /** スキップ件数（上限超過など） */
  skippedCount: number;

  /** 個別結果 */
  results: AutoExactApplyItemResult[];
}

// =============================================================================
// 設定ローダー
// =============================================================================

/**
 * 環境変数からAUTO→EXACT適用設定を読み込む
 */
export function loadAutoExactApplyConfig(): AutoExactApplyConfig {
  return {
    enabled: process.env.AUTO_EXACT_APPLY_ENABLED === "true",
    maxApplyPerRun: parseInt(process.env.MAX_APPLY_CHANGES_PER_RUN || "100", 10),
    defaultBid: parseFloat(process.env.AUTO_EXACT_DEFAULT_BID || "100"),
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || "",
    dataset: process.env.BIGQUERY_DATASET || "amazon_bid_engine",
  };
}

// =============================================================================
// BigQuery 操作
// =============================================================================

/**
 * 承認済みの候補を取得
 */
async function fetchApprovedCandidates(
  bigquery: BigQuery,
  config: AutoExactApplyConfig,
  limit: number
): Promise<AutoExactApplyCandidate[]> {
  const query = `
    SELECT
      suggestion_id,
      profile_id,
      asin,
      search_term,
      campaign_id_auto,
      ad_group_id_auto,
      campaign_id_manual_target,
      ad_group_id_manual_target,
      cvr,
      acos,
      target_acos,
      score,
      COALESCE(recommended_bid, @defaultBid) as recommended_bid
    FROM \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
    WHERE status = 'APPROVED'
      AND is_applied = FALSE
      AND campaign_id_manual_target IS NOT NULL
      AND ad_group_id_manual_target IS NOT NULL
    ORDER BY score DESC
    LIMIT @limit
  `;

  const [rows] = await bigquery.query({
    query,
    params: { limit, defaultBid: config.defaultBid },
    location: "asia-northeast1",
  });

  return rows.map((row: Record<string, unknown>) => ({
    suggestionId: String(row.suggestion_id),
    profileId: String(row.profile_id),
    asin: String(row.asin),
    searchTerm: String(row.search_term),
    campaignIdAuto: String(row.campaign_id_auto),
    adGroupIdAuto: String(row.ad_group_id_auto),
    campaignIdManualTarget: row.campaign_id_manual_target
      ? String(row.campaign_id_manual_target)
      : null,
    adGroupIdManualTarget: row.ad_group_id_manual_target
      ? String(row.ad_group_id_manual_target)
      : null,
    cvr: Number(row.cvr) || 0,
    acos: Number(row.acos) || 0,
    targetAcos: Number(row.target_acos) || 0.2,
    score: Number(row.score) || 0,
    recommendedBid: Number(row.recommended_bid) || config.defaultBid,
  }));
}

/**
 * 候補のステータスを APPLIED に更新
 */
async function markAsApplied(
  bigquery: BigQuery,
  config: AutoExactApplyConfig,
  suggestionIds: string[],
  keywordIds: Map<string, string>
): Promise<void> {
  if (suggestionIds.length === 0) return;

  // 各候補を個別に更新（keywordIdを記録するため）
  for (const suggestionId of suggestionIds) {
    const keywordId = keywordIds.get(suggestionId) || null;
    const query = `
      UPDATE \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
      SET
        status = 'APPLIED',
        is_applied = TRUE,
        applied_at = CURRENT_TIMESTAMP(),
        applied_keyword_id = @keywordId
      WHERE suggestion_id = @suggestionId
    `;

    await bigquery.query({
      query,
      params: { suggestionId, keywordId },
      location: "asia-northeast1",
    });
  }
}

/**
 * 候補のエラーを記録
 */
async function markAsError(
  bigquery: BigQuery,
  config: AutoExactApplyConfig,
  suggestionId: string,
  error: string
): Promise<void> {
  const query = `
    UPDATE \`${config.projectId}.${config.dataset}.auto_exact_promotion_suggestions\`
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
// メイン適用ロジック
// =============================================================================

/**
 * 承認済みAUTO→EXACT昇格候補をAmazon Ads APIに適用
 *
 * @param options オプション
 * @returns 適用結果
 */
export async function applyApprovedAutoExactPromotions(options: {
  dryRun?: boolean;
  maxItems?: number;
}): Promise<AutoExactApplyResult> {
  const config = loadAutoExactApplyConfig();

  logger.info("Starting AUTO→EXACT apply process", {
    enabled: config.enabled,
    dryRun: options.dryRun ?? false,
    maxItems: options.maxItems,
  });

  // 結果オブジェクト
  const result: AutoExactApplyResult = {
    totalProcessed: 0,
    successCount: 0,
    partialSuccessCount: 0,
    failedCount: 0,
    skippedCount: 0,
    results: [],
  };

  // 機能が無効の場合
  if (!config.enabled) {
    logger.warn("AUTO→EXACT apply is disabled");
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
  const candidates = await fetchApprovedCandidates(bigquery, config, maxItems);
  result.totalProcessed = candidates.length;

  logger.info("Fetched approved candidates", {
    count: candidates.length,
  });

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

  // 各候補を処理
  const successIds: string[] = [];
  const keywordIds = new Map<string, string>();

  for (const candidate of candidates) {
    const itemResult: AutoExactApplyItemResult = {
      suggestionId: candidate.suggestionId,
      searchTerm: candidate.searchTerm,
      keywordCreated: false,
      negativeCreated: false,
    };

    try {
      // ターゲットキャンペーン/広告グループが設定されていることを確認
      if (!candidate.campaignIdManualTarget || !candidate.adGroupIdManualTarget) {
        throw new Error("Target MANUAL campaign/ad group not configured");
      }

      // Step 1: EXACTキーワードを作成
      logger.info("Creating EXACT keyword", {
        suggestionId: candidate.suggestionId,
        searchTerm: candidate.searchTerm,
        targetCampaign: candidate.campaignIdManualTarget,
        targetAdGroup: candidate.adGroupIdManualTarget,
        bid: candidate.recommendedBid,
      });

      const keywordRequest: CreateKeywordRequest = {
        campaignId: candidate.campaignIdManualTarget,
        adGroupId: candidate.adGroupIdManualTarget,
        keywordText: candidate.searchTerm,
        matchType: "EXACT",
        bid: candidate.recommendedBid,
        state: "ENABLED",
      };

      const keywordResult = await createKeywords([keywordRequest]);

      if (keywordResult.success.length > 0) {
        itemResult.keywordCreated = true;
        itemResult.keywordId = keywordResult.success[0].keywordId;
        keywordIds.set(candidate.suggestionId, keywordResult.success[0].keywordId);

        logger.info("EXACT keyword created successfully", {
          suggestionId: candidate.suggestionId,
          keywordId: itemResult.keywordId,
        });
      } else if (keywordResult.errors.length > 0) {
        throw new Error(
          `Keyword creation failed: ${keywordResult.errors[0].code} - ${keywordResult.errors[0].details}`
        );
      }

      // Step 2: AUTOキャンペーンにネガティブEXACTを登録（カニバリゼーション防止）
      logger.info("Creating campaign-level negative EXACT", {
        suggestionId: candidate.suggestionId,
        searchTerm: candidate.searchTerm,
        autoCampaign: candidate.campaignIdAuto,
      });

      const negativeResult = await createCampaignNegativeKeywords([
        {
          campaignId: candidate.campaignIdAuto,
          keywordText: candidate.searchTerm,
          matchType: "NEGATIVE_EXACT",
        },
      ]);

      if (negativeResult.success.length > 0) {
        itemResult.negativeCreated = true;
        itemResult.negativeKeywordId = negativeResult.success[0].keywordId;

        logger.info("Negative EXACT created successfully", {
          suggestionId: candidate.suggestionId,
          negativeKeywordId: itemResult.negativeKeywordId,
        });
      } else if (negativeResult.errors.length > 0) {
        // ネガティブ作成失敗は警告レベル（キーワード自体は作成済み）
        logger.warn("Failed to create negative keyword", {
          suggestionId: candidate.suggestionId,
          error: negativeResult.errors[0],
        });
        itemResult.error = `Negative creation failed: ${negativeResult.errors[0].code}`;
      }

      // 結果を判定
      if (itemResult.keywordCreated) {
        successIds.push(candidate.suggestionId);
        if (itemResult.negativeCreated) {
          result.successCount++;
        } else {
          result.partialSuccessCount++;
        }
      } else {
        result.failedCount++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      itemResult.error = errorMessage;
      result.failedCount++;

      logger.error("Failed to apply AUTO→EXACT promotion", {
        suggestionId: candidate.suggestionId,
        error: errorMessage,
      });

      // エラーをBigQueryに記録
      await markAsError(bigquery, config, candidate.suggestionId, errorMessage);
    }

    result.results.push(itemResult);
  }

  // 成功した候補をBigQueryで更新
  if (successIds.length > 0) {
    await markAsApplied(bigquery, config, successIds, keywordIds);
    logger.info("Marked candidates as applied", { count: successIds.length });
  }

  logger.info("AUTO→EXACT apply process completed", {
    totalProcessed: result.totalProcessed,
    successCount: result.successCount,
    partialSuccessCount: result.partialSuccessCount,
    failedCount: result.failedCount,
  });

  return result;
}

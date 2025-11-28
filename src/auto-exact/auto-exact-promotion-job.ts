/**
 * AUTO→EXACT 昇格エンジン - BigQuery ジョブ
 *
 * BigQuery からデータを取得し、昇格候補を計算して保存するジョブ
 * SHADOWモード専用で、Amazon Ads API への自動登録は行いません
 */

import { BigQuery } from "@google-cloud/bigquery";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import { ExecutionMode } from "../logging/types";
import { BIGQUERY } from "../constants";
import {
  SearchTermStats30dRow,
  IntentClusterStats30dRow,
  AsinBaselineStats30dRow,
  ProductConfigForPromotion,
  TargetManualCampaignRow,
  ExistingExactKeywordRow,
  PromotionCandidate,
  PromotionCandidatesResult,
  AutoExactPromotionSuggestionRow,
  PromotionExecutionContext,
  LifecycleState,
} from "./types";
import { computeAutoExactPromotionCandidates } from "./auto-exact-promotion-engine";

// =============================================================================
// BigQuery クライアント
// =============================================================================

let bigqueryClient: BigQuery | null = null;

function getBigQueryClient(projectId?: string): BigQuery {
  if (!bigqueryClient) {
    bigqueryClient = new BigQuery({
      projectId: projectId ?? BIGQUERY.PROJECT_ID,
    });
  }
  return bigqueryClient;
}

// =============================================================================
// テーブル名定数
// =============================================================================

const TABLES = {
  SEARCH_TERM_STATS: "search_term_stats_30d",
  INTENT_CLUSTER_STATS: "intent_cluster_stats_30d",
  ASIN_BASELINE_STATS: "asin_baseline_stats_30d",
  PRODUCT_CONFIG: "product_config",
  MANUAL_KEYWORDS: "keyword_metrics_60d",  // 既存 EXACT キーワード取得用
  AUTO_EXACT_PROMOTIONS: "auto_exact_promotion_suggestions",
  NEGATIVE_SUGGESTIONS: "negative_keyword_suggestions",
} as const;

// =============================================================================
// データ取得関数
// =============================================================================

/**
 * 検索語統計を取得
 */
async function fetchSearchTermStats(
  projectId: string,
  dataset: string,
  profileId: string
): Promise<SearchTermStats30dRow[]> {
  const bq = getBigQueryClient(projectId);

  // profile_id カラムがない場合は、全件取得してフィルタする設計
  // ビューに profile_id がある前提で記述
  const query = `
    SELECT
      COALESCE(profile_id, '') AS profile_id,
      campaign_id,
      ad_group_id,
      asin,
      search_term,
      match_type,
      intent_cluster_id,
      intent_cluster_label,
      impressions AS impressions,
      clicks AS clicks,
      cost AS cost,
      sales AS sales,
      orders AS orders,
      SAFE_DIVIDE(orders, clicks) AS cvr,
      SAFE_DIVIDE(cost, sales) AS acos
    FROM \`${projectId}.${dataset}.${TABLES.SEARCH_TERM_STATS}\`
    WHERE match_type = 'AUTO'
  `;

  try {
    const [rows] = await bq.query({
      query,
      location: "asia-northeast1",
    });

    logger.debug("Fetched search term stats", {
      count: rows.length,
      profileId,
    });

    return rows.map((row: Record<string, unknown>) => ({
      profile_id: String(row.profile_id ?? ""),
      campaign_id: String(row.campaign_id ?? ""),
      ad_group_id: String(row.ad_group_id ?? ""),
      asin: String(row.asin ?? ""),
      search_term: String(row.search_term ?? ""),
      match_type: String(row.match_type ?? ""),
      intent_cluster_id: row.intent_cluster_id
        ? String(row.intent_cluster_id)
        : null,
      intent_cluster_label: row.intent_cluster_label
        ? String(row.intent_cluster_label)
        : null,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      cost: Number(row.cost ?? 0),
      sales: Number(row.sales ?? 0),
      orders: Number(row.orders ?? 0),
      cvr: row.cvr != null ? Number(row.cvr) : null,
      acos: row.acos != null ? Number(row.acos) : null,
    }));
  } catch (error) {
    logger.error("Failed to fetch search term stats", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * クラスタ統計を取得
 */
async function fetchIntentClusterStats(
  projectId: string,
  dataset: string,
  profileId: string
): Promise<IntentClusterStats30dRow[]> {
  const bq = getBigQueryClient(projectId);

  const query = `
    SELECT
      COALESCE(profile_id, '') AS profile_id,
      asin,
      intent_cluster_id,
      intent_cluster_label,
      impressions AS impressions,
      clicks AS clicks,
      cost AS cost,
      sales AS sales,
      orders AS orders,
      SAFE_DIVIDE(orders, clicks) AS cvr,
      SAFE_DIVIDE(cost, sales) AS acos
    FROM \`${projectId}.${dataset}.${TABLES.INTENT_CLUSTER_STATS}\`
  `;

  try {
    const [rows] = await bq.query({
      query,
      location: "asia-northeast1",
    });

    logger.debug("Fetched intent cluster stats", {
      count: rows.length,
      profileId,
    });

    return rows.map((row: Record<string, unknown>) => ({
      profile_id: String(row.profile_id ?? ""),
      asin: String(row.asin ?? ""),
      intent_cluster_id: String(row.intent_cluster_id ?? ""),
      intent_cluster_label: row.intent_cluster_label
        ? String(row.intent_cluster_label)
        : null,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      cost: Number(row.cost ?? 0),
      sales: Number(row.sales ?? 0),
      orders: Number(row.orders ?? 0),
      cvr: row.cvr != null ? Number(row.cvr) : null,
      acos: row.acos != null ? Number(row.acos) : null,
    }));
  } catch (error) {
    logger.error("Failed to fetch intent cluster stats", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * ASIN ベースライン統計を取得
 */
async function fetchAsinBaselineStats(
  projectId: string,
  dataset: string,
  profileId: string
): Promise<AsinBaselineStats30dRow[]> {
  const bq = getBigQueryClient(projectId);

  const query = `
    SELECT
      COALESCE(profile_id, '') AS profile_id,
      asin,
      impressions,
      clicks,
      orders,
      sales,
      SAFE_DIVIDE(orders, clicks) AS cvr,
      SAFE_DIVIDE(cost, sales) AS acos
    FROM \`${projectId}.${dataset}.${TABLES.ASIN_BASELINE_STATS}\`
  `;

  try {
    const [rows] = await bq.query({
      query,
      location: "asia-northeast1",
    });

    logger.debug("Fetched ASIN baseline stats", {
      count: rows.length,
      profileId,
    });

    return rows.map((row: Record<string, unknown>) => ({
      profile_id: String(row.profile_id ?? ""),
      asin: String(row.asin ?? ""),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      orders: Number(row.orders ?? 0),
      sales: Number(row.sales ?? 0),
      cvr: Number(row.cvr ?? 0),
      acos: Number(row.acos ?? 0),
    }));
  } catch (error) {
    logger.error("Failed to fetch ASIN baseline stats", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 商品設定を取得
 */
async function fetchProductConfigs(
  projectId: string,
  dataset: string
): Promise<ProductConfigForPromotion[]> {
  const bq = getBigQueryClient(projectId);

  const query = `
    SELECT
      asin,
      COALESCE(profile_id, '') AS profile_id,
      COALESCE(lifecycle_state, 'GROW') AS lifecycle_state,
      COALESCE(margin_rate, 0.3) AS target_acos
    FROM \`${projectId}.${dataset}.${TABLES.PRODUCT_CONFIG}\`
    WHERE is_active = TRUE
  `;

  try {
    const [rows] = await bq.query({
      query,
      location: "asia-northeast1",
    });

    logger.debug("Fetched product configs", {
      count: rows.length,
    });

    return rows.map((row: Record<string, unknown>) => ({
      asin: String(row.asin ?? ""),
      profileId: String(row.profile_id ?? ""),
      lifecycleState: String(row.lifecycle_state ?? "GROW") as LifecycleState,
      targetAcos: Number(row.target_acos ?? 0.3),
    }));
  } catch (error) {
    logger.error("Failed to fetch product configs", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * ターゲット MANUAL キャンペーン情報を取得
 */
async function fetchTargetManualCampaigns(
  projectId: string,
  dataset: string,
  profileId: string
): Promise<TargetManualCampaignRow[]> {
  const bq = getBigQueryClient(projectId);

  // MANUAL EXACT キャンペーンを探す（存在するなら）
  const query = `
    SELECT DISTINCT
      COALESCE(profile_id, '') AS profile_id,
      campaign_id,
      ad_group_id,
      asin,
      campaign_name,
      ad_group_name
    FROM \`${projectId}.${dataset}.${TABLES.MANUAL_KEYWORDS}\`
    WHERE match_type = 'EXACT'
  `;

  try {
    const [rows] = await bq.query({
      query,
      location: "asia-northeast1",
    });

    logger.debug("Fetched target manual campaigns", {
      count: rows.length,
      profileId,
    });

    return rows.map((row: Record<string, unknown>) => ({
      profile_id: String(row.profile_id ?? ""),
      campaign_id: String(row.campaign_id ?? ""),
      ad_group_id: String(row.ad_group_id ?? ""),
      asin: String(row.asin ?? ""),
      campaign_name: String(row.campaign_name ?? ""),
      ad_group_name: String(row.ad_group_name ?? ""),
    }));
  } catch (error) {
    logger.warn("Failed to fetch target manual campaigns (may not exist)", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * 既存の EXACT キーワードを取得
 */
async function fetchExistingExactKeywords(
  projectId: string,
  dataset: string,
  profileId: string
): Promise<ExistingExactKeywordRow[]> {
  const bq = getBigQueryClient(projectId);

  const query = `
    SELECT DISTINCT
      COALESCE(profile_id, '') AS profile_id,
      campaign_id,
      ad_group_id,
      asin,
      keyword AS keyword_text
    FROM \`${projectId}.${dataset}.${TABLES.MANUAL_KEYWORDS}\`
    WHERE match_type = 'EXACT'
  `;

  try {
    const [rows] = await bq.query({
      query,
      location: "asia-northeast1",
    });

    logger.debug("Fetched existing EXACT keywords", {
      count: rows.length,
      profileId,
    });

    return rows.map((row: Record<string, unknown>) => ({
      profile_id: String(row.profile_id ?? ""),
      campaign_id: String(row.campaign_id ?? ""),
      ad_group_id: String(row.ad_group_id ?? ""),
      asin: String(row.asin ?? ""),
      keyword_text: String(row.keyword_text ?? ""),
    }));
  } catch (error) {
    logger.warn("Failed to fetch existing EXACT keywords", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * ネガティブキーワード候補のクエリセットを取得
 */
async function fetchNegativeKeywordQueries(
  projectId: string,
  dataset: string
): Promise<Set<string>> {
  const bq = getBigQueryClient(projectId);

  const query = `
    SELECT DISTINCT
      asin,
      query
    FROM \`${projectId}.${dataset}.${TABLES.NEGATIVE_SUGGESTIONS}\`
    WHERE status IN ('PENDING', 'APPROVED')
  `;

  try {
    const [rows] = await bq.query({
      query,
      location: "asia-northeast1",
    });

    const querySet = new Set<string>();
    for (const row of rows) {
      const key = `${row.asin}:${String(row.query).toLowerCase().trim()}`;
      querySet.add(key);
    }

    logger.debug("Fetched negative keyword queries", {
      count: querySet.size,
    });

    return querySet;
  } catch (error) {
    logger.warn("Failed to fetch negative keyword queries", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set();
  }
}

// =============================================================================
// 保存関数
// =============================================================================

/**
 * PromotionCandidate を AutoExactPromotionSuggestionRow にマッピング
 */
function mapCandidateToRow(
  candidate: PromotionCandidate,
  executionId: string,
  mode: string
): AutoExactPromotionSuggestionRow {
  return {
    execution_id: executionId,
    profile_id: candidate.profileId,
    campaign_id_auto: candidate.campaignIdAuto,
    ad_group_id_auto: candidate.adGroupIdAuto,
    campaign_id_manual_target: candidate.campaignIdManualTarget,
    ad_group_id_manual_target: candidate.adGroupIdManualTarget,
    asin: candidate.asin,
    search_term: candidate.searchTerm,
    intent_cluster_id: candidate.intentClusterId,
    intent_cluster_label: candidate.intentClusterLabel,
    match_type: candidate.matchType,
    lookback_days: 30,
    impressions: candidate.impressions,
    clicks: candidate.clicks,
    orders: candidate.orders,
    sales: candidate.sales,
    cost: candidate.cost,
    cvr: candidate.cvr,
    acos: candidate.acos,
    cluster_clicks: candidate.clusterClicks,
    cluster_cvr: candidate.clusterCvr,
    asin_baseline_cvr: candidate.asinBaselineCvr,
    effective_baseline_cvr: candidate.effectiveBaselineCvr,
    target_acos: candidate.targetAcos,
    score: candidate.score,
    status: "PENDING",
    mode,
    created_at: new Date(),
  };
}

/**
 * 昇格候補を BigQuery に保存
 */
async function savePromotionSuggestions(
  projectId: string,
  dataset: string,
  executionId: string,
  mode: string,
  candidates: PromotionCandidate[]
): Promise<void> {
  if (candidates.length === 0) {
    logger.info("No promotion candidates to save");
    return;
  }

  const bq = getBigQueryClient(projectId);
  const table = bq.dataset(dataset).table(TABLES.AUTO_EXACT_PROMOTIONS);

  const rows: AutoExactPromotionSuggestionRow[] = candidates.map((candidate) =>
    mapCandidateToRow(candidate, executionId, mode)
  );

  // バッチサイズで分割して保存
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await table.insert(batch);
      logger.debug("Saved promotion suggestions batch", {
        executionId,
        batchStart: i,
        batchSize: batch.length,
      });
    } catch (error) {
      logger.error("Failed to save promotion suggestions batch", {
        executionId,
        batchStart: i,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  logger.info("Saved all promotion suggestions to BigQuery", {
    executionId,
    count: rows.length,
  });
}

// =============================================================================
// メインジョブ関数
// =============================================================================

/**
 * AUTO→EXACT 昇格ジョブの実行オプション
 */
export interface RunAutoExactPromotionJobOptions {
  /** BigQuery プロジェクトID */
  projectId?: string;
  /** BigQuery データセットID */
  dataset?: string;
  /** プロファイルID（省略時は全プロファイル） */
  profileId?: string;
  /** 実行ID（省略時は自動生成） */
  executionId?: string;
  /** ドライラン（true の場合、保存しない） */
  dryRun?: boolean;
}

/**
 * AUTO→EXACT 昇格ジョブの実行結果
 */
export interface RunAutoExactPromotionJobResult {
  /** 実行ID */
  executionId: string;
  /** 実行モード */
  mode: ExecutionMode;
  /** 成功/失敗 */
  success: boolean;
  /** 候補数 */
  candidatesCount: number;
  /** 処理統計 */
  stats: PromotionCandidatesResult["stats"];
  /** エラーメッセージ（失敗時） */
  errorMessage?: string;
}

/**
 * runAutoExactShadowOnce のオプション
 */
export interface RunAutoExactShadowOnceOptions {
  /** プロファイルID（必須） */
  profileId: string;
  /** ASIN リスト（省略時は全ASIN） */
  asinList?: string[];
  /** 実行ID（省略時は自動生成） */
  executionId?: string;
  /** BigQuery に保存するかどうか（省略時は false） */
  persistToBigQuery?: boolean;
  /** BigQuery プロジェクトID */
  projectId?: string;
  /** BigQuery データセットID */
  dataset?: string;
}

/**
 * runAutoExactShadowOnce の結果
 */
export interface RunAutoExactShadowOnceResult {
  /** 実行ID */
  executionId: string;
  /** 候補数 */
  candidateCount: number;
  /** 成功/失敗 */
  success: boolean;
  /** 昇格候補リスト（persistToBigQuery: false の場合のみ） */
  candidates?: PromotionCandidate[];
  /** 処理統計 */
  stats: PromotionCandidatesResult["stats"];
  /** エラーメッセージ（失敗時） */
  errorMessage?: string;
}

/**
 * AUTO→EXACT 昇格を SHADOW モードで実行
 *
 * 単一の profileId に対して昇格候補を計算する。
 * persistToBigQuery が true の場合のみ BigQuery に保存。
 */
export async function runAutoExactShadowOnce(
  options: RunAutoExactShadowOnceOptions
): Promise<RunAutoExactShadowOnceResult> {
  const { profileId, asinList } = options;
  const projectId = options.projectId ?? BIGQUERY.PROJECT_ID;
  const dataset = options.dataset ?? BIGQUERY.DATASET_ID;
  const executionId = options.executionId ?? uuidv4();
  const persistToBigQuery = options.persistToBigQuery ?? false;
  const mode = "SHADOW";

  logger.info("Starting AUTO→EXACT shadow execution", {
    executionId,
    projectId,
    dataset,
    profileId,
    asinList: asinList ?? "(all)",
    persistToBigQuery,
    mode,
  });

  try {
    // 1. データ取得（並列実行）
    const [
      searchTerms,
      clusters,
      baselines,
      productConfigs,
      targetCampaigns,
      existingKeywords,
      negativeQueries,
    ] = await Promise.all([
      fetchSearchTermStats(projectId, dataset, profileId),
      fetchIntentClusterStats(projectId, dataset, profileId),
      fetchAsinBaselineStats(projectId, dataset, profileId),
      fetchProductConfigs(projectId, dataset),
      fetchTargetManualCampaigns(projectId, dataset, profileId),
      fetchExistingExactKeywords(projectId, dataset, profileId),
      fetchNegativeKeywordQueries(projectId, dataset),
    ]);

    // 2. ASIN フィルタを適用（指定された場合）
    let filteredSearchTerms = searchTerms;
    let filteredClusters = clusters;
    let filteredBaselines = baselines;
    let filteredProductConfigs = productConfigs;

    if (asinList && asinList.length > 0) {
      const asinSet = new Set(asinList);
      filteredSearchTerms = searchTerms.filter((t) => asinSet.has(t.asin));
      filteredClusters = clusters.filter((c) => asinSet.has(c.asin));
      filteredBaselines = baselines.filter((b) => asinSet.has(b.asin));
      filteredProductConfigs = productConfigs.filter((p) => asinSet.has(p.asin));
    }

    logger.info("Fetched and filtered data for shadow execution", {
      executionId,
      searchTermsCount: filteredSearchTerms.length,
      clustersCount: filteredClusters.length,
      baselinesCount: filteredBaselines.length,
      productConfigsCount: filteredProductConfigs.length,
      asinFilter: asinList ?? "(none)",
    });

    // 3. 昇格候補を計算
    const result = computeAutoExactPromotionCandidates(
      filteredSearchTerms,
      filteredClusters,
      filteredBaselines,
      filteredProductConfigs,
      targetCampaigns,
      existingKeywords,
      negativeQueries,
      profileId,
      mode
    );

    // 4. BigQuery に保存（persistToBigQuery が true の場合のみ）
    if (persistToBigQuery && result.candidates.length > 0) {
      await savePromotionSuggestions(
        projectId,
        dataset,
        executionId,
        mode,
        result.candidates
      );
      logger.info("Persisted promotion suggestions to BigQuery", {
        executionId,
        candidateCount: result.candidates.length,
      });
    }

    logger.info("Completed AUTO→EXACT shadow execution", {
      executionId,
      candidateCount: result.candidates.length,
      persisted: persistToBigQuery,
      stats: result.stats,
    });

    return {
      executionId,
      candidateCount: result.candidates.length,
      success: true,
      // 保存しない場合のみ candidates を返す（デバッグ用）
      candidates: persistToBigQuery ? undefined : result.candidates,
      stats: result.stats,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error("Failed AUTO→EXACT shadow execution", {
      executionId,
      profileId,
      error: errorMessage,
    });

    return {
      executionId,
      candidateCount: 0,
      success: false,
      stats: {
        totalAsinsProcessed: 0,
        totalClustersProcessed: 0,
        clustersPassedFilter: 0,
        totalSearchTermsProcessed: 0,
        searchTermsPassedFilter: 0,
        duplicatesExcluded: 0,
        negativesExcluded: 0,
      },
      errorMessage,
    };
  }
}

/**
 * AUTO→EXACT 昇格ジョブを実行
 */
export async function runAutoExactPromotionJob(
  options: RunAutoExactPromotionJobOptions = {}
): Promise<RunAutoExactPromotionJobResult> {
  const projectId = options.projectId ?? BIGQUERY.PROJECT_ID;
  const dataset = options.dataset ?? BIGQUERY.DATASET_ID;
  const executionId = options.executionId ?? uuidv4();
  const profileId = options.profileId ?? "";
  const dryRun = options.dryRun ?? false;
  const mode: ExecutionMode = "SHADOW";

  logger.info("Starting AUTO→EXACT promotion job", {
    executionId,
    projectId,
    dataset,
    profileId: profileId || "(all)",
    dryRun,
    mode,
  });

  try {
    // 1. データ取得（並列実行）
    const [
      searchTerms,
      clusters,
      baselines,
      productConfigs,
      targetCampaigns,
      existingKeywords,
      negativeQueries,
    ] = await Promise.all([
      fetchSearchTermStats(projectId, dataset, profileId),
      fetchIntentClusterStats(projectId, dataset, profileId),
      fetchAsinBaselineStats(projectId, dataset, profileId),
      fetchProductConfigs(projectId, dataset),
      fetchTargetManualCampaigns(projectId, dataset, profileId),
      fetchExistingExactKeywords(projectId, dataset, profileId),
      fetchNegativeKeywordQueries(projectId, dataset),
    ]);

    logger.info("Fetched all data for promotion job", {
      executionId,
      searchTermsCount: searchTerms.length,
      clustersCount: clusters.length,
      baselinesCount: baselines.length,
      productConfigsCount: productConfigs.length,
      targetCampaignsCount: targetCampaigns.length,
      existingKeywordsCount: existingKeywords.length,
      negativeQueriesCount: negativeQueries.size,
    });

    // 2. 昇格候補を計算
    const result = computeAutoExactPromotionCandidates(
      searchTerms,
      clusters,
      baselines,
      productConfigs,
      targetCampaigns,
      existingKeywords,
      negativeQueries,
      profileId,
      mode
    );

    logger.info("Computed promotion candidates", {
      executionId,
      candidatesCount: result.candidates.length,
      stats: result.stats,
    });

    // 3. 保存（ドライランでなければ）
    if (!dryRun && result.candidates.length > 0) {
      await savePromotionSuggestions(
        projectId,
        dataset,
        executionId,
        mode,
        result.candidates
      );
    } else if (dryRun) {
      logger.info("Dry run mode - skipping save", {
        executionId,
        candidatesCount: result.candidates.length,
      });
    }

    logger.info("Completed AUTO→EXACT promotion job", {
      executionId,
      success: true,
      candidatesCount: result.candidates.length,
    });

    return {
      executionId,
      mode,
      success: true,
      candidatesCount: result.candidates.length,
      stats: result.stats,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error("Failed AUTO→EXACT promotion job", {
      executionId,
      error: errorMessage,
    });

    return {
      executionId,
      mode,
      success: false,
      candidatesCount: 0,
      stats: {
        totalAsinsProcessed: 0,
        totalClustersProcessed: 0,
        clustersPassedFilter: 0,
        totalSearchTermsProcessed: 0,
        searchTermsPassedFilter: 0,
        duplicatesExcluded: 0,
        negativesExcluded: 0,
      },
      errorMessage,
    };
  }
}

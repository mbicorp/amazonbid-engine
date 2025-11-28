/**
 * キーワード発見候補 BigQuery リポジトリ
 *
 * keyword_discovery_candidates テーブルの読み書きを担当
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import { BIGQUERY } from "../constants";
import {
  CandidateKeyword,
  KeywordDiscoveryCandidateRow,
  CandidateFilterOptions,
  CandidateState,
  SearchTermReportRow,
  ExistingKeyword,
  ProductConfigForDiscovery,
} from "./types";

// =============================================================================
// テーブル名定数
// =============================================================================

const TABLES = {
  KEYWORD_DISCOVERY_CANDIDATES: "keyword_discovery_candidates",
  SEARCH_TERM_REPORT: "search_term_report",
  KEYWORD_METRICS: "keyword_metrics_60d",
  PRODUCT_CONFIG: "product_config",
} as const;

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
// 変換ユーティリティ
// =============================================================================

/**
 * CandidateKeyword を BigQuery 行に変換
 */
function candidateToRow(candidate: CandidateKeyword): KeywordDiscoveryCandidateRow {
  return {
    id: candidate.id,
    asin: candidate.asin,
    query: candidate.query,
    normalized_query: candidate.normalizedQuery,
    suggested_match_type: candidate.suggestedMatchType,
    source: candidate.source,
    score: candidate.score,

    // 検索語由来の指標
    impressions_7d: candidate.searchTermMetrics?.impressions7d ?? null,
    clicks_7d: candidate.searchTermMetrics?.clicks7d ?? null,
    orders_7d: candidate.searchTermMetrics?.orders7d ?? null,
    sales_7d: candidate.searchTermMetrics?.sales7d ?? null,
    cost_7d: candidate.searchTermMetrics?.cost7d ?? null,
    acos_7d: candidate.searchTermMetrics?.acos7d ?? null,
    cvr_7d: candidate.searchTermMetrics?.cvr7d ?? null,
    cpc_7d: candidate.searchTermMetrics?.cpc7d ?? null,

    // Jungle Scout由来の指標
    js_search_volume_exact: candidate.jungleScoutMetrics?.searchVolumeExact ?? null,
    js_search_volume_broad: candidate.jungleScoutMetrics?.searchVolumeBroad ?? null,
    js_competition_score: candidate.jungleScoutMetrics?.competitionScore ?? null,
    js_ease_of_ranking_score: candidate.jungleScoutMetrics?.easeOfRankingScore ?? null,
    js_relevancy_score: candidate.jungleScoutMetrics?.relevancyScore ?? null,
    js_suggested_bid_low: candidate.jungleScoutMetrics?.suggestedBidLow ?? null,
    js_suggested_bid_high: candidate.jungleScoutMetrics?.suggestedBidHigh ?? null,
    js_trending_direction: candidate.jungleScoutMetrics?.trendingDirection ?? null,
    js_trending_percentage: candidate.jungleScoutMetrics?.trendingPercentage ?? null,
    js_fetched_at: candidate.jungleScoutMetrics?.fetchedAt ?? null,

    // スコア内訳
    score_search_term: candidate.scoreBreakdown.searchTermScore,
    score_jungle_scout: candidate.scoreBreakdown.jungleScoutScore,
    weight_search_term: candidate.scoreBreakdown.weights.searchTerm,
    weight_jungle_scout: candidate.scoreBreakdown.weights.jungleScout,

    // ステータス
    state: candidate.state,

    // メタ情報
    profile_id: candidate.profileId ?? null,
    campaign_id: candidate.campaignId ?? null,
    ad_group_id: candidate.adGroupId ?? null,
    discovered_at: candidate.discoveredAt,
    updated_at: candidate.updatedAt,

    // 承認フロー情報（初期状態）
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    applied_at: null,
  };
}

/**
 * BigQuery 行を CandidateKeyword に変換
 */
function rowToCandidate(row: Record<string, unknown>): CandidateKeyword {
  return {
    id: String(row.id ?? ""),
    asin: String(row.asin ?? ""),
    query: String(row.query ?? ""),
    normalizedQuery: String(row.normalized_query ?? ""),
    suggestedMatchType: String(row.suggested_match_type ?? "EXACT") as CandidateKeyword["suggestedMatchType"],
    source: String(row.source ?? "SEARCH_TERM") as CandidateKeyword["source"],
    score: Number(row.score ?? 0),

    searchTermMetrics: row.impressions_7d != null ? {
      impressions7d: Number(row.impressions_7d),
      clicks7d: Number(row.clicks_7d ?? 0),
      orders7d: Number(row.orders_7d ?? 0),
      sales7d: Number(row.sales_7d ?? 0),
      cost7d: Number(row.cost_7d ?? 0),
      acos7d: row.acos_7d != null ? Number(row.acos_7d) : null,
      cvr7d: row.cvr_7d != null ? Number(row.cvr_7d) : null,
      cpc7d: row.cpc_7d != null ? Number(row.cpc_7d) : null,
    } : null,

    jungleScoutMetrics: row.js_search_volume_exact != null ? {
      searchVolumeExact: Number(row.js_search_volume_exact),
      searchVolumeBroad: row.js_search_volume_broad != null ? Number(row.js_search_volume_broad) : null,
      competitionScore: row.js_competition_score != null ? Number(row.js_competition_score) : null,
      easeOfRankingScore: row.js_ease_of_ranking_score != null ? Number(row.js_ease_of_ranking_score) : null,
      relevancyScore: row.js_relevancy_score != null ? Number(row.js_relevancy_score) : null,
      suggestedBidLow: row.js_suggested_bid_low != null ? Number(row.js_suggested_bid_low) : null,
      suggestedBidHigh: row.js_suggested_bid_high != null ? Number(row.js_suggested_bid_high) : null,
      trendingDirection: row.js_trending_direction as "up" | "down" | "flat" | null,
      trendingPercentage: row.js_trending_percentage != null ? Number(row.js_trending_percentage) : null,
      fetchedAt: row.js_fetched_at ? new Date(row.js_fetched_at as string) : null,
    } : null,

    scoreBreakdown: {
      searchTermScore: Number(row.score_search_term ?? 0),
      jungleScoutScore: Number(row.score_jungle_scout ?? 0),
      weights: {
        searchTerm: Number(row.weight_search_term ?? 1),
        jungleScout: Number(row.weight_jungle_scout ?? 0),
      },
    },

    state: String(row.state ?? "PENDING_REVIEW") as CandidateState,
    discoveredAt: row.discovered_at ? new Date(row.discovered_at as string) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at as string) : new Date(),
    profileId: row.profile_id ? String(row.profile_id) : undefined,
    campaignId: row.campaign_id ? String(row.campaign_id) : undefined,
    adGroupId: row.ad_group_id ? String(row.ad_group_id) : undefined,
  };
}

// =============================================================================
// リポジトリクラス
// =============================================================================

export class KeywordDiscoveryRepository {
  private projectId: string;
  private dataset: string;

  constructor(projectId?: string, dataset?: string) {
    this.projectId = projectId ?? BIGQUERY.PROJECT_ID;
    this.dataset = dataset ?? BIGQUERY.DATASET_ID;
  }

  // ===========================================================================
  // UPSERT: 候補の追加・更新
  // ===========================================================================

  /**
   * キーワード候補を upsert（同一 asin + query の組み合わせで更新）
   */
  async upsertCandidateKeywords(candidates: CandidateKeyword[]): Promise<void> {
    if (candidates.length === 0) {
      logger.info("No candidates to upsert");
      return;
    }

    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.KEYWORD_DISCOVERY_CANDIDATES}`;

    // MERGE文を使用してupsert
    // BigQuery の MERGE は同一テーブルに対して直接実行できないため、
    // 一時テーブル経由で実行する

    const rows = candidates.map(candidateToRow);
    const now = new Date().toISOString();

    // バッチ処理
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      try {
        // まず既存レコードを削除（asin + normalized_query で一致するもの）
        const deleteConditions = batch
          .map((row) => `(asin = '${row.asin}' AND normalized_query = '${row.normalized_query.replace(/'/g, "\\'")}')`)
          .join(" OR ");

        const deleteQuery = `
          DELETE FROM \`${tableId}\`
          WHERE ${deleteConditions}
        `;

        await bq.query({
          query: deleteQuery,
          location: "asia-northeast1",
        });

        // 新しいレコードを挿入
        const table = bq.dataset(this.dataset).table(TABLES.KEYWORD_DISCOVERY_CANDIDATES);
        await table.insert(batch);

        logger.debug("Upserted keyword discovery candidates batch", {
          batchStart: i,
          batchSize: batch.length,
        });
      } catch (error) {
        logger.error("Failed to upsert keyword discovery candidates batch", {
          batchStart: i,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    logger.info("Upserted all keyword discovery candidates", {
      count: rows.length,
    });
  }

  // ===========================================================================
  // READ: 候補の取得
  // ===========================================================================

  /**
   * レビュー用に候補を取得
   */
  async listCandidatesForReview(
    filters: CandidateFilterOptions = {}
  ): Promise<CandidateKeyword[]> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.KEYWORD_DISCOVERY_CANDIDATES}`;

    // WHERE句を構築
    const conditions: string[] = [];

    if (filters.asin) {
      conditions.push(`asin = '${filters.asin}'`);
    }
    if (filters.state) {
      conditions.push(`state = '${filters.state}'`);
    }
    if (filters.source) {
      conditions.push(`source = '${filters.source}'`);
    }
    if (filters.minScore != null) {
      conditions.push(`score >= ${filters.minScore}`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // ORDER BY句
    let orderBy = "score DESC";
    if (filters.orderBy === "score_asc") {
      orderBy = "score ASC";
    } else if (filters.orderBy === "discovered_at_desc") {
      orderBy = "discovered_at DESC";
    } else if (filters.orderBy === "discovered_at_asc") {
      orderBy = "discovered_at ASC";
    }

    // LIMIT/OFFSET
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const query = `
      SELECT *
      FROM \`${tableId}\`
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      logger.debug("Listed candidates for review", {
        filters,
        count: rows.length,
      });

      return rows.map(rowToCandidate);
    } catch (error) {
      logger.error("Failed to list candidates for review", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * PENDING_REVIEW の候補数を取得
   */
  async countPendingReviewCandidates(): Promise<number> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.KEYWORD_DISCOVERY_CANDIDATES}`;

    const query = `
      SELECT COUNT(*) as count
      FROM \`${tableId}\`
      WHERE state = 'PENDING_REVIEW'
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      return Number(rows[0]?.count ?? 0);
    } catch (error) {
      logger.error("Failed to count pending review candidates", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  // ===========================================================================
  // データ取得: 検索語レポート
  // ===========================================================================

  /**
   * 検索語レポートを取得（過去7日間）
   */
  async fetchSearchTermReport(
    profileId?: string,
    lookbackDays: number = 7
  ): Promise<SearchTermReportRow[]> {
    const bq = getBigQueryClient(this.projectId);

    const profileFilter = profileId
      ? `AND profile_id = '${profileId}'`
      : "";

    const query = `
      SELECT
        COALESCE(profile_id, '') AS profile_id,
        campaign_id,
        ad_group_id,
        asin,
        query,
        match_type,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        SUM(cost) AS cost,
        SUM(sales) AS sales,
        SUM(orders) AS orders,
        SAFE_DIVIDE(SUM(orders), SUM(clicks)) AS cvr,
        SAFE_DIVIDE(SUM(cost), SUM(sales)) AS acos
      FROM \`${this.projectId}.${this.dataset}.${TABLES.SEARCH_TERM_REPORT}\`
      WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${lookbackDays} DAY)
        ${profileFilter}
      GROUP BY profile_id, campaign_id, ad_group_id, asin, query, match_type
      HAVING impressions >= 10
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      logger.debug("Fetched search term report", {
        count: rows.length,
        profileId: profileId ?? "(all)",
        lookbackDays,
      });

      return rows.map((row: Record<string, unknown>) => ({
        profile_id: String(row.profile_id ?? ""),
        campaign_id: String(row.campaign_id ?? ""),
        ad_group_id: String(row.ad_group_id ?? ""),
        asin: String(row.asin ?? ""),
        query: String(row.query ?? ""),
        match_type: String(row.match_type ?? ""),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        cost: Number(row.cost ?? 0),
        sales: Number(row.sales ?? 0),
        orders: Number(row.orders ?? 0),
        cvr: row.cvr != null ? Number(row.cvr) : null,
        acos: row.acos != null ? Number(row.acos) : null,
      }));
    } catch (error) {
      logger.error("Failed to fetch search term report", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ===========================================================================
  // データ取得: 既存キーワード
  // ===========================================================================

  /**
   * 既存のキーワード一覧を取得
   */
  async fetchExistingKeywords(profileId?: string): Promise<ExistingKeyword[]> {
    const bq = getBigQueryClient(this.projectId);

    const profileFilter = profileId
      ? `WHERE profile_id = '${profileId}'`
      : "";

    const query = `
      SELECT DISTINCT
        asin,
        keyword,
        LOWER(TRIM(keyword)) AS normalized_keyword,
        match_type
      FROM \`${this.projectId}.${this.dataset}.${TABLES.KEYWORD_METRICS}\`
      ${profileFilter}
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      logger.debug("Fetched existing keywords", {
        count: rows.length,
        profileId: profileId ?? "(all)",
      });

      return rows.map((row: Record<string, unknown>) => ({
        asin: String(row.asin ?? ""),
        keyword: String(row.keyword ?? ""),
        normalizedKeyword: String(row.normalized_keyword ?? ""),
        matchType: String(row.match_type ?? ""),
      }));
    } catch (error) {
      logger.error("Failed to fetch existing keywords", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ===========================================================================
  // データ取得: 商品設定
  // ===========================================================================

  /**
   * 商品設定を取得
   */
  async fetchProductConfigs(): Promise<Map<string, ProductConfigForDiscovery>> {
    const bq = getBigQueryClient(this.projectId);

    const query = `
      SELECT
        asin,
        COALESCE(profile_id, '') AS profile_id,
        COALESCE(margin_rate, 0.3) AS target_acos,
        COALESCE(lifecycle_state, 'GROW') AS lifecycle_state
      FROM \`${this.projectId}.${this.dataset}.${TABLES.PRODUCT_CONFIG}\`
      WHERE is_active = TRUE
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      const configMap = new Map<string, ProductConfigForDiscovery>();
      for (const row of rows) {
        configMap.set(String(row.asin ?? ""), {
          asin: String(row.asin ?? ""),
          profileId: String(row.profile_id ?? ""),
          targetAcos: Number(row.target_acos ?? 0.3),
          lifecycleState: String(row.lifecycle_state ?? "GROW"),
        });
      }

      logger.debug("Fetched product configs", {
        count: configMap.size,
      });

      return configMap;
    } catch (error) {
      logger.error("Failed to fetch product configs", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ===========================================================================
  // ステータス更新
  // ===========================================================================

  /**
   * 候補のステータスを更新
   */
  async updateCandidateState(
    candidateId: string,
    newState: CandidateState,
    userId?: string,
    reason?: string
  ): Promise<void> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.KEYWORD_DISCOVERY_CANDIDATES}`;
    const now = new Date().toISOString();

    let additionalFields = "";
    if (newState === "APPROVED" && userId) {
      additionalFields = `, approved_at = TIMESTAMP('${now}'), approved_by = '${userId}'`;
    } else if (newState === "REJECTED") {
      additionalFields = `, rejected_at = TIMESTAMP('${now}')`;
      if (userId) {
        additionalFields += `, rejected_by = '${userId}'`;
      }
      if (reason) {
        additionalFields += `, rejection_reason = '${reason.replace(/'/g, "\\'")}'`;
      }
    } else if (newState === "APPLIED") {
      additionalFields = `, applied_at = TIMESTAMP('${now}')`;
    }

    const query = `
      UPDATE \`${tableId}\`
      SET state = '${newState}', updated_at = TIMESTAMP('${now}')${additionalFields}
      WHERE id = '${candidateId}'
    `;

    try {
      await bq.query({
        query,
        location: "asia-northeast1",
      });

      logger.info("Updated candidate state", {
        candidateId,
        newState,
        userId,
      });
    } catch (error) {
      logger.error("Failed to update candidate state", {
        candidateId,
        newState,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ===========================================================================
  // 上位候補の取得（Slack通知用）
  // ===========================================================================

  /**
   * 上位候補を取得（Slack通知用）
   */
  async getTopCandidatesForNotification(
    executionDate: Date,
    limit: number = 5
  ): Promise<Array<{ asin: string; query: string; score: number; source: string }>> {
    const bq = getBigQueryClient(this.projectId);
    const tableId = `${this.projectId}.${this.dataset}.${TABLES.KEYWORD_DISCOVERY_CANDIDATES}`;
    const dateStr = executionDate.toISOString().split("T")[0];

    const query = `
      SELECT asin, query, score, source
      FROM \`${tableId}\`
      WHERE DATE(discovered_at) = '${dateStr}'
        AND state = 'PENDING_REVIEW'
      ORDER BY score DESC
      LIMIT ${limit}
    `;

    try {
      const [rows] = await bq.query({
        query,
        location: "asia-northeast1",
      });

      return rows.map((row: Record<string, unknown>) => ({
        asin: String(row.asin ?? ""),
        query: String(row.query ?? ""),
        score: Number(row.score ?? 0),
        source: String(row.source ?? ""),
      }));
    } catch (error) {
      logger.error("Failed to get top candidates for notification", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}

// =============================================================================
// シングルトンインスタンス
// =============================================================================

let repositoryInstance: KeywordDiscoveryRepository | null = null;

/**
 * リポジトリインスタンスを取得
 */
export function getKeywordDiscoveryRepository(
  projectId?: string,
  dataset?: string
): KeywordDiscoveryRepository {
  if (!repositoryInstance || projectId || dataset) {
    repositoryInstance = new KeywordDiscoveryRepository(projectId, dataset);
  }
  return repositoryInstance;
}

/**
 * リポジトリインスタンスをリセット（テスト用）
 */
export function resetKeywordDiscoveryRepository(): void {
  repositoryInstance = null;
}

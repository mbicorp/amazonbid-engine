/**
 * Jungle Scout API クライアント（キーワード発見用）
 *
 * フェーズ二で本番利用するためのインターフェースを定義。
 * 現在はダミー実装で、enableJungleScout が false の場合は空配列を返す。
 *
 * 環境変数:
 * - JUNGLE_SCOUT_API_KEY: APIキー
 * - JUNGLE_SCOUT_API_BASE_URL: ベースURL（オプション）
 * - JUNGLE_SCOUT_KEY_NAME: キー名（オプション）
 */

import { logger } from "../logger";
import {
  CandidateKeyword,
  JungleScoutMetrics,
  KeywordDiscoveryConfig,
  createEmptyJungleScoutMetrics,
} from "./types";

// =============================================================================
// 設定
// =============================================================================

/**
 * Jungle Scout キーワード発見用クライアント設定
 */
export interface JungleScoutDiscoveryConfig {
  /** APIキー */
  apiKey: string;

  /** ベースURL */
  baseUrl: string;

  /** キー名（認証用） */
  keyName?: string;

  /** マーケットプレイス */
  marketplace: string;

  /** タイムアウト（ミリ秒） */
  timeoutMs: number;

  /** 最大リトライ回数 */
  maxRetries: number;
}

const DEFAULT_CONFIG: Partial<JungleScoutDiscoveryConfig> = {
  baseUrl: "https://developer.junglescout.com/api",
  marketplace: "jp",
  timeoutMs: 30000,
  maxRetries: 3,
};

// =============================================================================
// Jungle Scout APIレスポンス型（参考用）
// =============================================================================

/**
 * Jungle Scout Keywords by ASIN APIのレスポンス型
 *
 * 実際のエンドポイント: POST /keywords/keywords_by_asin_query
 *
 * リクエストボディ:
 * {
 *   "data": {
 *     "type": "keywords_by_asin_query",
 *     "attributes": {
 *       "asins": ["B0XXXXXXXXX"],
 *       "include_variants": true,
 *       "filter_options": {
 *         "min_monthly_search_volume_exact": 100
 *       }
 *     }
 *   }
 * }
 *
 * レスポンス構造（参考）:
 * {
 *   "data": [
 *     {
 *       "type": "keywords_by_asin",
 *       "id": "...",
 *       "attributes": {
 *         "name": "keyword text",
 *         "country": "jp",
 *         "monthly_search_volume_exact": 5000,
 *         "monthly_search_volume_broad": 8000,
 *         "ppc_bid_broad": 50,
 *         "ppc_bid_exact": 70,
 *         "ease_of_ranking_score": 45,
 *         "relevancy_score": 80,
 *         "organic_product_count": 1000,
 *         "sponsored_product_count": 20,
 *         "trending": {
 *           "direction": "up",
 *           "percentage_change": 15
 *         }
 *       }
 *     }
 *   ]
 * }
 */
interface JungleScoutKeywordByAsinResponse {
  data: Array<{
    type: string;
    id: string;
    attributes: {
      name: string;
      country: string;
      monthly_search_volume_exact: number;
      monthly_search_volume_broad: number;
      ppc_bid_broad: number;
      ppc_bid_exact: number;
      ease_of_ranking_score: number;
      relevancy_score: number;
      organic_product_count: number;
      sponsored_product_count: number;
      trending: {
        direction: "up" | "down" | "flat";
        percentage_change: number;
      };
    };
  }>;
}

/**
 * Jungle Scout Keyword by Keyword APIのレスポンス型
 *
 * 実際のエンドポイント: POST /keywords/keyword_by_keyword
 *
 * リクエストボディ:
 * {
 *   "data": {
 *     "type": "keyword_by_keyword_query",
 *     "attributes": {
 *       "search_terms": ["seed keyword"],
 *       "marketplace": "jp"
 *     }
 *   }
 * }
 */
interface JungleScoutKeywordByKeywordResponse {
  data: Array<{
    type: string;
    id: string;
    attributes: {
      name: string;
      country: string;
      monthly_search_volume_exact: number;
      monthly_search_volume_broad: number;
      ppc_bid_broad: number;
      ppc_bid_exact: number;
      ease_of_ranking_score: number;
      relevancy_score: number;
      organic_product_count: number;
      sponsored_product_count: number;
      trending: {
        direction: "up" | "down" | "flat";
        percentage_change: number;
      };
    };
  }>;
}

// =============================================================================
// クライアントクラス
// =============================================================================

/**
 * Jungle Scout API クライアント（キーワード発見用）
 *
 * フェーズ二で以下の機能を本番実装する予定:
 * 1. fetchRelatedKeywordsForAsin - ASINに関連するキーワードを取得
 * 2. fetchRelatedKeywordsForSeed - シードキーワードから関連キーワードを取得
 */
export class JungleScoutDiscoveryClient {
  private config: JungleScoutDiscoveryConfig | null;
  private enabled: boolean;

  constructor(discoveryConfig?: KeywordDiscoveryConfig) {
    this.enabled = discoveryConfig?.enableJungleScout ?? false;

    if (!this.enabled) {
      this.config = null;
      logger.info("JungleScoutDiscoveryClient initialized in disabled mode");
      return;
    }

    // 環境変数から設定を読み込み
    const apiKey = process.env.JUNGLE_SCOUT_API_KEY;
    const baseUrl = process.env.JUNGLE_SCOUT_API_BASE_URL || DEFAULT_CONFIG.baseUrl!;
    const keyName = process.env.JUNGLE_SCOUT_KEY_NAME;
    const marketplace = process.env.JUNGLE_SCOUT_MARKETPLACE || DEFAULT_CONFIG.marketplace!;

    if (!apiKey) {
      logger.warn("JUNGLE_SCOUT_API_KEY is not set, disabling Jungle Scout integration");
      this.enabled = false;
      this.config = null;
      return;
    }

    this.config = {
      apiKey: keyName ? `${keyName}:${apiKey}` : apiKey,
      baseUrl,
      keyName,
      marketplace,
      timeoutMs: DEFAULT_CONFIG.timeoutMs!,
      maxRetries: DEFAULT_CONFIG.maxRetries!,
    };

    logger.info("JungleScoutDiscoveryClient initialized", {
      marketplace: this.config.marketplace,
      baseUrl: this.config.baseUrl,
    });
  }

  /**
   * クライアントが有効かどうか
   */
  isEnabled(): boolean {
    return this.enabled && this.config !== null;
  }

  /**
   * ASINに関連するキーワード候補を取得
   *
   * フェーズ二で実装予定:
   * - Keywords by ASIN API を呼び出し
   * - レスポンスを CandidateKeyword 形式に変換
   * - 競合スコアや検索ボリュームなどの指標を含める
   *
   * @param asin - 対象ASIN
   * @returns キーワード候補の配列（現在は空配列）
   */
  async fetchRelatedKeywordsForAsin(asin: string): Promise<JungleScoutKeywordResult[]> {
    if (!this.isEnabled()) {
      logger.debug("Jungle Scout is disabled, returning empty array for ASIN", { asin });
      return [];
    }

    logger.info("Fetching related keywords for ASIN from Jungle Scout", { asin });

    // ============================================================
    // TODO: フェーズ二で以下を実装
    // ============================================================
    // 1. POST /keywords/keywords_by_asin_query を呼び出し
    // 2. レスポンスを JungleScoutKeywordResult に変換
    // 3. エラーハンドリング（レート制限、認証エラーなど）
    //
    // 実装例（コメントアウト）:
    // try {
    //   const response = await this.makeRequest<JungleScoutKeywordByAsinResponse>(
    //     "/keywords/keywords_by_asin_query",
    //     "POST",
    //     {
    //       data: {
    //         type: "keywords_by_asin_query",
    //         attributes: {
    //           asins: [asin],
    //           include_variants: true,
    //           filter_options: {
    //             min_monthly_search_volume_exact: 100,
    //           },
    //         },
    //       },
    //     }
    //   );
    //
    //   return response.data.map((item) => this.mapToKeywordResult(item, asin));
    // } catch (error) {
    //   logger.error("Failed to fetch keywords from Jungle Scout", {
    //     asin,
    //     error: error instanceof Error ? error.message : String(error),
    //   });
    //   // エラー時は空配列を返し、検索語由来の処理には影響を与えない
    //   return [];
    // }
    // ============================================================

    // ダミー実装: 空配列を返す
    logger.debug("Jungle Scout fetchRelatedKeywordsForAsin: returning dummy empty array", { asin });
    return [];
  }

  /**
   * シードキーワードから関連キーワード候補を取得
   *
   * フェーズ二で実装予定:
   * - Keyword by Keyword API を呼び出し
   * - レスポンスを CandidateKeyword 形式に変換
   *
   * @param seed - シードキーワード
   * @returns キーワード候補の配列（現在は空配列）
   */
  async fetchRelatedKeywordsForSeed(seed: string): Promise<JungleScoutKeywordResult[]> {
    if (!this.isEnabled()) {
      logger.debug("Jungle Scout is disabled, returning empty array for seed", { seed });
      return [];
    }

    logger.info("Fetching related keywords for seed from Jungle Scout", { seed });

    // ============================================================
    // TODO: フェーズ二で以下を実装
    // ============================================================
    // 1. POST /keywords/keyword_by_keyword を呼び出し
    // 2. レスポンスを JungleScoutKeywordResult に変換
    // 3. エラーハンドリング（レート制限、認証エラーなど）
    //
    // 実装例（コメントアウト）:
    // try {
    //   const response = await this.makeRequest<JungleScoutKeywordByKeywordResponse>(
    //     "/keywords/keyword_by_keyword",
    //     "POST",
    //     {
    //       data: {
    //         type: "keyword_by_keyword_query",
    //         attributes: {
    //           search_terms: [seed],
    //           marketplace: this.config!.marketplace,
    //         },
    //       },
    //     }
    //   );
    //
    //   return response.data.map((item) => this.mapToKeywordResultFromSeed(item));
    // } catch (error) {
    //   logger.error("Failed to fetch keywords from Jungle Scout", {
    //     seed,
    //     error: error instanceof Error ? error.message : String(error),
    //   });
    //   // エラー時は空配列を返し、検索語由来の処理には影響を与えない
    //   return [];
    // }
    // ============================================================

    // ダミー実装: 空配列を返す
    logger.debug("Jungle Scout fetchRelatedKeywordsForSeed: returning dummy empty array", { seed });
    return [];
  }

  /**
   * 複数ASINに対してキーワードを一括取得
   *
   * @param asins - 対象ASIN配列
   * @returns ASIN をキーとしたキーワード結果のMap
   */
  async fetchRelatedKeywordsForAsins(
    asins: string[]
  ): Promise<Map<string, JungleScoutKeywordResult[]>> {
    const results = new Map<string, JungleScoutKeywordResult[]>();

    if (!this.isEnabled()) {
      logger.debug("Jungle Scout is disabled, returning empty map");
      return results;
    }

    for (const asin of asins) {
      try {
        const keywords = await this.fetchRelatedKeywordsForAsin(asin);
        results.set(asin, keywords);
      } catch (error) {
        logger.warn("Failed to fetch keywords for ASIN, skipping", {
          asin,
          error: error instanceof Error ? error.message : String(error),
        });
        results.set(asin, []);
      }
    }

    return results;
  }

  // ===========================================================================
  // Private Methods（フェーズ二で実装）
  // ===========================================================================

  /**
   * APIリクエストを実行（フェーズ二で実装）
   *
   * @param endpoint - エンドポイントパス
   * @param method - HTTPメソッド
   * @param body - リクエストボディ
   */
  // private async makeRequest<T>(
  //   endpoint: string,
  //   method: "GET" | "POST",
  //   body?: unknown
  // ): Promise<T> {
  //   if (!this.config) {
  //     throw new Error("Jungle Scout client is not configured");
  //   }
  //
  //   const url = `${this.config.baseUrl}${endpoint}`;
  //   const headers: Record<string, string> = {
  //     Authorization: this.config.apiKey,
  //     "X-API-Type": "junglescout",
  //     "Content-Type": "application/vnd.api+json",
  //     Accept: "application/vnd.junglescout.v1+json",
  //   };
  //
  //   const options: RequestInit = {
  //     method,
  //     headers,
  //     body: body ? JSON.stringify(body) : undefined,
  //   };
  //
  //   const response = await fetch(url, options);
  //
  //   if (!response.ok) {
  //     throw new Error(`Jungle Scout API error: ${response.status} ${response.statusText}`);
  //   }
  //
  //   return response.json() as Promise<T>;
  // }

  /**
   * APIレスポンスを JungleScoutKeywordResult に変換（フェーズ二で実装）
   */
  // private mapToKeywordResult(
  //   item: JungleScoutKeywordByAsinResponse["data"][0],
  //   asin: string
  // ): JungleScoutKeywordResult {
  //   const attr = item.attributes;
  //   return {
  //     keyword: attr.name,
  //     asin,
  //     metrics: {
  //       searchVolumeExact: attr.monthly_search_volume_exact,
  //       searchVolumeBroad: attr.monthly_search_volume_broad,
  //       competitionScore: this.calculateCompetitionScore(attr.organic_product_count, attr.sponsored_product_count),
  //       easeOfRankingScore: attr.ease_of_ranking_score,
  //       relevancyScore: attr.relevancy_score,
  //       suggestedBidLow: attr.ppc_bid_broad,
  //       suggestedBidHigh: attr.ppc_bid_exact,
  //       trendingDirection: attr.trending.direction,
  //       trendingPercentage: attr.trending.percentage_change,
  //       fetchedAt: new Date(),
  //     },
  //   };
  // }
}

// =============================================================================
// Result Type
// =============================================================================

/**
 * Jungle Scout から取得したキーワード結果
 */
export interface JungleScoutKeywordResult {
  /** キーワード */
  keyword: string;

  /** 関連ASIN（Keywords by ASINの場合） */
  asin?: string;

  /** Jungle Scout メトリクス */
  metrics: JungleScoutMetrics;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Jungle Scout Discovery Client を作成
 *
 * @param config - キーワード発見設定
 * @returns クライアントインスタンス
 */
export function createJungleScoutDiscoveryClient(
  config?: KeywordDiscoveryConfig
): JungleScoutDiscoveryClient {
  return new JungleScoutDiscoveryClient(config);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * JungleScoutKeywordResult を JungleScoutMetrics に変換
 */
export function extractJungleScoutMetrics(
  result: JungleScoutKeywordResult | null
): JungleScoutMetrics {
  if (!result) {
    return createEmptyJungleScoutMetrics();
  }
  return result.metrics;
}

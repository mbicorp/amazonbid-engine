/**
 * Jungle Scout Cobalt API クライアント
 *
 * Jungle Scout APIを使用してキーワードインテリジェンスを取得する
 * APIドキュメント: https://developer.junglescout.com/
 */

import { logger } from "../logger";
import {
  withRetry,
  getCircuitBreakerStatus,
  RetryConfig,
  CircuitBreakerConfig,
} from "../utils/retry";
import { notifyCircuitBreakerTripped } from "../utils/notification";
import {
  JungleScoutMarketplace,
  JungleScoutApiResponse,
  JungleScoutApiError,
  KeywordsByAsinRequest,
  KeywordByAsinData,
  ShareOfVoiceRequest,
  ShareOfVoiceData,
  HistoricalSearchVolumeRequest,
  HistoricalSearchVolumeData,
  KeywordByKeywordRequest,
  KeywordByKeywordData,
  KeywordIntelligence,
  AsinShareOfVoice,
  KeywordVolumeHistory,
} from "./types";

// =============================================================================
// 設定
// =============================================================================

/**
 * Jungle Scout API設定
 */
export interface JungleScoutConfig {
  apiKey: string;
  baseUrl?: string;
  defaultMarketplace?: JungleScoutMarketplace;
  rateLimitPerMinute?: number;
  retryConfig?: Partial<RetryConfig>;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  circuitBreakerName?: string;
}

const DEFAULT_BASE_URL = "https://developer.junglescout.com/api";
const DEFAULT_RATE_LIMIT = 60; // リクエスト/分
const DEFAULT_CIRCUIT_BREAKER_NAME = "jungle-scout-api";

// =============================================================================
// レート制限
// =============================================================================

class RateLimiter {
  private timestamps: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldestTimestamp = this.timestamps[0];
      const waitTime = this.windowMs - (now - oldestTimestamp) + 100;
      logger.debug(`Rate limit reached, waiting ${waitTime}ms`);
      await this.sleep(waitTime);
    }

    this.timestamps.push(Date.now());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// APIクライアント
// =============================================================================

export class JungleScoutClient {
  private config: {
    apiKey: string;
    baseUrl: string;
    defaultMarketplace: JungleScoutMarketplace;
    rateLimitPerMinute: number;
    retryConfig: Partial<RetryConfig>;
    circuitBreakerConfig: Partial<CircuitBreakerConfig>;
    circuitBreakerName: string;
  };
  private rateLimiter: RateLimiter;

  constructor(config: JungleScoutConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      defaultMarketplace: config.defaultMarketplace || "jp",
      rateLimitPerMinute: config.rateLimitPerMinute || DEFAULT_RATE_LIMIT,
      retryConfig: {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        retryableErrors: ["408", "429", "500", "502", "503", "504", "ETIMEDOUT", "ECONNRESET"],
        ...config.retryConfig,
      },
      circuitBreakerConfig: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        halfOpenRequests: 3,
        ...config.circuitBreakerConfig,
      },
      circuitBreakerName: config.circuitBreakerName || DEFAULT_CIRCUIT_BREAKER_NAME,
    };

    this.rateLimiter = new RateLimiter(this.config.rateLimitPerMinute);
  }

  /**
   * サーキットブレーカーの状態を取得
   */
  getCircuitBreakerStatus() {
    return getCircuitBreakerStatus(this.config.circuitBreakerName);
  }

  // ===========================================================================
  // 基本リクエスト
  // ===========================================================================

  private async makeRequest<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
    params?: Record<string, string | number | undefined>
  ): Promise<T> {
    await this.rateLimiter.waitIfNeeded();

    let url = `${this.config.baseUrl}${endpoint}`;

    // クエリパラメータを追加
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const headers: Record<string, string> = {
      Authorization: this.config.apiKey, // KEY_NAME:API_KEY 形式
      "X-API-Type": "junglescout",
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.junglescout.v1+json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method === "POST") {
      options.body = JSON.stringify(body);
    }

    logger.debug("Making Jungle Scout API request", { method, endpoint });

    // リトライとサーキットブレーカーを使用
    return withRetry(
      async () => {
        const response = await fetch(url, options);

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage: string;

          try {
            const errorJson = JSON.parse(errorBody) as JungleScoutApiError;
            errorMessage = errorJson.errors
              .map((e) => `${e.title}: ${e.detail}`)
              .join("; ");
          } catch {
            errorMessage = errorBody;
          }

          logger.error("Jungle Scout API request failed", {
            method,
            endpoint,
            status: response.status,
            error: errorMessage,
          });

          // ステータスコードをエラーに付与してリトライ判定に使用
          const apiError = new JungleScoutApiException(
            response.status,
            errorMessage,
            endpoint
          );
          (apiError as any).code = response.status.toString();
          throw apiError;
        }

        return response.json() as Promise<T>;
      },
      {
        name: this.config.circuitBreakerName,
        retryConfig: this.config.retryConfig,
        circuitBreakerConfig: this.config.circuitBreakerConfig,
      }
    ).catch((error) => {
      // サーキットブレーカーがオープンした場合に通知
      if ((error as any).code === "CIRCUIT_BREAKER_OPEN") {
        notifyCircuitBreakerTripped({
          serviceName: this.config.circuitBreakerName,
          failures: 5, // デフォルトのしきい値
          state: "OPEN",
        }).catch((e) => logger.warn("Failed to send notification", { error: e }));
      }
      throw error;
    });
  }

  // ===========================================================================
  // Keywords by ASIN
  // ===========================================================================

  /**
   * ASINに関連するキーワードを取得
   */
  async getKeywordsByAsin(
    request: KeywordsByAsinRequest
  ): Promise<KeywordByAsinData[]> {
    const marketplace = request.marketplace || this.config.defaultMarketplace;

    logger.info("Fetching keywords by ASIN", {
      asin: request.asin,
      marketplace,
    });

    // リクエストボディを構築
    // ASINは "asins" キーで配列形式で渡す
    const attributes: {
      asins: string[];
      include_variants?: boolean;
      filter_options?: {
        min_monthly_search_volume_exact?: number;
        max_monthly_search_volume_exact?: number;
        min_word_count?: number;
        max_word_count?: number;
      };
    } = {
      asins: [request.asin],
      include_variants: true,
    };

    if (request.filter_options) {
      attributes.filter_options = request.filter_options;
    }

    const requestBody = {
      data: {
        type: "keywords_by_asin_query",
        attributes,
      },
    };

    // クエリパラメータでsort, page, page_sizeを渡す
    const queryParams: Record<string, string | number | undefined> = {
      marketplace,
    };
    if (request.sort_option) {
      queryParams.sort = request.sort_option;
    }
    if (request.page) {
      queryParams.page = request.page;
    }
    if (request.page_size) {
      queryParams.page_size = request.page_size;
    }

    const response = await this.makeRequest<
      JungleScoutApiResponse<KeywordByAsinData[]>
    >(`/keywords/keywords_by_asin_query`, "POST", requestBody, queryParams);

    logger.info("Keywords by ASIN fetched", {
      asin: request.asin,
      count: response.data.length,
    });

    return response.data;
  }

  /**
   * ASINのキーワードを全ページ取得
   */
  async getAllKeywordsByAsin(
    asin: string,
    marketplace?: JungleScoutMarketplace,
    maxPages: number = 10
  ): Promise<KeywordByAsinData[]> {
    const allKeywords: KeywordByAsinData[] = [];
    let currentPage = 1;

    while (currentPage <= maxPages) {
      const keywords = await this.getKeywordsByAsin({
        asin,
        marketplace: marketplace || this.config.defaultMarketplace,
        page: currentPage,
        page_size: 100,
        sort_option: "monthly_search_volume_exact_desc",
      });

      if (keywords.length === 0) {
        break;
      }

      allKeywords.push(...keywords);
      currentPage++;

      // 100件未満なら最終ページ
      if (keywords.length < 100) {
        break;
      }
    }

    logger.info("All keywords by ASIN fetched", {
      asin,
      totalCount: allKeywords.length,
      pages: currentPage - 1,
    });

    return allKeywords;
  }

  // ===========================================================================
  // Share of Voice
  // ===========================================================================

  /**
   * キーワードのShare of Voiceを取得
   */
  async getShareOfVoice(
    request: ShareOfVoiceRequest
  ): Promise<ShareOfVoiceData> {
    const marketplace = request.marketplace || this.config.defaultMarketplace;

    logger.info("Fetching Share of Voice", {
      keyword: request.keyword,
      marketplace,
    });

    const response = await this.makeRequest<
      JungleScoutApiResponse<ShareOfVoiceData>
    >(`/share_of_voice`, "POST", {
      data: {
        type: "share_of_voice_query",
        attributes: {
          keyword: request.keyword,
          marketplace,
        },
      },
    });

    logger.info("Share of Voice fetched", {
      keyword: request.keyword,
      productCount: response.data.attributes.products.length,
    });

    return response.data;
  }

  /**
   * 複数キーワードのShare of Voiceを取得
   */
  async getShareOfVoiceForKeywords(
    keywords: string[],
    marketplace?: JungleScoutMarketplace
  ): Promise<Map<string, ShareOfVoiceData>> {
    const results = new Map<string, ShareOfVoiceData>();
    const mp = marketplace || this.config.defaultMarketplace;

    for (const keyword of keywords) {
      try {
        const sov = await this.getShareOfVoice({
          keyword,
          marketplace: mp,
        });
        results.set(keyword, sov);
      } catch (error) {
        logger.warn("Failed to fetch Share of Voice for keyword", {
          keyword,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  // ===========================================================================
  // Historical Search Volume
  // ===========================================================================

  /**
   * キーワードの検索ボリューム履歴を取得
   */
  async getHistoricalSearchVolume(
    request: HistoricalSearchVolumeRequest
  ): Promise<HistoricalSearchVolumeData> {
    const marketplace = request.marketplace || this.config.defaultMarketplace;

    logger.info("Fetching historical search volume", {
      keyword: request.keyword,
      marketplace,
    });

    const params: Record<string, string | undefined> = {
      marketplace,
      start_date: request.start_date,
      end_date: request.end_date,
    };

    const response = await this.makeRequest<
      JungleScoutApiResponse<HistoricalSearchVolumeData>
    >(
      `/keywords/historical_search_volume`,
      "POST",
      {
        data: {
          type: "historical_search_volume_query",
          attributes: {
            keyword: request.keyword,
            marketplace,
            start_date: request.start_date,
            end_date: request.end_date,
          },
        },
      },
      params
    );

    logger.info("Historical search volume fetched", {
      keyword: request.keyword,
      dataPoints: response.data.attributes.estimates.length,
    });

    return response.data;
  }

  // ===========================================================================
  // Keyword by Keyword（キーワード詳細）
  // ===========================================================================

  /**
   * 特定のキーワードの詳細情報を取得
   */
  async getKeywordDetails(
    request: KeywordByKeywordRequest
  ): Promise<KeywordByKeywordData[]> {
    const marketplace = request.marketplace || this.config.defaultMarketplace;

    logger.info("Fetching keyword details", {
      keywords: request.search_terms,
      marketplace,
    });

    const response = await this.makeRequest<
      JungleScoutApiResponse<KeywordByKeywordData[]>
    >(`/keywords/keyword_by_keyword`, "POST", {
      data: {
        type: "keyword_by_keyword_query",
        attributes: {
          search_terms: request.search_terms,
          marketplace,
        },
      },
    });

    logger.info("Keyword details fetched", {
      count: response.data.length,
    });

    return response.data;
  }

  // ===========================================================================
  // 変換ユーティリティ
  // ===========================================================================

  /**
   * KeywordByAsinDataをKeywordIntelligenceに変換
   */
  convertToKeywordIntelligence(
    data: KeywordByAsinData,
    asin: string,
    marketplace: JungleScoutMarketplace
  ): KeywordIntelligence {
    const attr = data.attributes;

    return {
      keyword: attr.name,
      marketplace,
      asin,
      monthly_search_volume_exact: attr.monthly_search_volume_exact,
      monthly_search_volume_broad: attr.monthly_search_volume_broad,
      ppc_bid_broad: attr.ppc_bid_broad,
      ppc_bid_exact: attr.ppc_bid_exact,
      sp_brand_ad_bid: attr.sp_brand_ad_bid,
      ease_of_ranking_score: attr.ease_of_ranking_score,
      relevancy_score: attr.relevancy_score,
      organic_product_count: attr.organic_product_count,
      sponsored_product_count: attr.sponsored_product_count,
      trending_direction: attr.trending.direction,
      trending_percentage: attr.trending.percentage_change,
      dominant_category: attr.dominant_category,
      fetched_at: new Date(),
      updated_at: attr.updated_at,
    };
  }

  /**
   * ShareOfVoiceDataから特定ASINのShareOfVoice情報を抽出
   */
  extractAsinShareOfVoice(
    sovData: ShareOfVoiceData,
    targetAsin: string,
    marketplace: JungleScoutMarketplace
  ): AsinShareOfVoice | null {
    const product = sovData.attributes.products.find(
      (p) => p.asin === targetAsin
    );

    if (!product) {
      return null;
    }

    return {
      keyword: sovData.attributes.keyword,
      marketplace,
      asin: targetAsin,
      search_volume: sovData.attributes.search_volume,
      organic_rank: product.organic_rank,
      sponsored_rank: product.sponsored_rank,
      combined_rank: product.combined_rank,
      organic_sov: product.organic_share_of_voice,
      sponsored_sov: product.sponsored_share_of_voice,
      combined_sov: product.combined_share_of_voice,
      is_amazon_choice: product.is_amazon_choice,
      is_best_seller: product.is_best_seller,
      fetched_at: new Date(),
    };
  }

  /**
   * HistoricalSearchVolumeDataをKeywordVolumeHistory配列に変換
   */
  convertToVolumeHistory(
    data: HistoricalSearchVolumeData,
    marketplace: JungleScoutMarketplace
  ): KeywordVolumeHistory[] {
    const keyword = data.attributes.keyword;
    const now = new Date();

    return data.attributes.estimates.map((estimate) => ({
      keyword,
      marketplace,
      date: estimate.date,
      search_volume_exact: estimate.estimated_exact_search_volume,
      search_volume_broad: estimate.estimated_broad_search_volume,
      fetched_at: now,
    }));
  }
}

// =============================================================================
// 例外クラス
// =============================================================================

export class JungleScoutApiException extends Error {
  public readonly statusCode: number;
  public readonly endpoint: string;

  constructor(statusCode: number, message: string, endpoint: string) {
    super(`Jungle Scout API Error [${statusCode}] at ${endpoint}: ${message}`);
    this.name = "JungleScoutApiException";
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }
}

// =============================================================================
// シングルトンインスタンス管理
// =============================================================================

let clientInstance: JungleScoutClient | null = null;

/**
 * 環境変数からJungle Scout Clientを作成
 */
export function createJungleScoutClient(): JungleScoutClient {
  const apiKey = process.env.JUNGLE_SCOUT_API_KEY;
  const keyName = process.env.JUNGLE_SCOUT_KEY_NAME;

  if (!apiKey) {
    throw new Error(
      "JUNGLE_SCOUT_API_KEY environment variable is not set"
    );
  }

  // KEY_NAME:API_KEY 形式で認証
  // キー名がない場合はAPIキーをそのまま使用（既にKEY_NAME:API_KEY形式の場合）
  const authKey = keyName ? `${keyName}:${apiKey}` : apiKey;

  return new JungleScoutClient({
    apiKey: authKey,
    defaultMarketplace: (process.env.JUNGLE_SCOUT_MARKETPLACE as JungleScoutMarketplace) || "jp",
  });
}

/**
 * シングルトンクライアントを取得
 */
export function getJungleScoutClient(): JungleScoutClient {
  if (!clientInstance) {
    clientInstance = createJungleScoutClient();
  }
  return clientInstance;
}

/**
 * シングルトンをリセット（テスト用）
 */
export function resetJungleScoutClient(): void {
  clientInstance = null;
}

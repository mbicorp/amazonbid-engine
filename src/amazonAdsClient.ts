/**
 * Amazon Ads API クライアント
 * Sponsored Products のキーワード指標を取得して KeywordMetrics に変換する
 * v3 非同期レポートAPIに対応
 *
 * 改善点:
 * - カスタムエラークラスによる適切なエラー分類
 * - Circuit Breakerによる障害時の保護
 * - リトライ戦略の最適化（429はバックオフ、401はリトライなし）
 */

import { AMAZON_ADS_API, ACOS_THRESHOLDS, SCORE_RANK_THRESHOLDS, PRIORITY_SCORE } from "./constants";
import { logger } from "./logger";
import { loadEnvConfig, EnvConfig } from "./config";
import {
  AmazonAdsApiError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
} from "./errors";
import { withRetry, withRetryAndTimeout } from "./utils/retry";

// =============================================================================
// 型定義
// =============================================================================

export type PhaseType =
  | "NORMAL"
  | "S_PRE1"
  | "S_PRE2"
  | "S_FREEZE"
  | "S_NORMAL"
  | "S_FINAL"
  | "S_REVERT";

export type BrandType = "BRAND" | "CONQUEST" | "GENERIC";
export type ScoreRank = "S" | "A" | "B" | "C";

export interface KeywordMetrics {
  keyword_id: string;
  campaign_id: string;
  ad_group_id: string;
  phase_type: PhaseType;
  brand_type: BrandType;
  score_rank: ScoreRank;
  current_bid: number;
  baseline_cpc: number;
  acos_target: number;
  acos_actual: number;
  cvr_recent: number;
  cvr_baseline: number;
  ctr_recent: number;
  ctr_baseline: number;
  clicks_1h: number;
  clicks_3h: number;
  impressions_1h: number;
  impressions_3h: number;
  rank_current: number | null;
  rank_target: number | null;
  competitor_cpc_current: number;
  competitor_cpc_baseline: number;
  comp_strength: number;
  risk_penalty: number;
  priority_score: number;
  tos_ctr_mult: number;
  tos_cvr_mult: number;
  tos_gap_cpc: number;
  campaign_budget_remaining: number;
  expected_clicks_3h: number;
  time_in_phase_minutes: number;
}

/**
 * Amazon Ads API のレポートレスポンス型
 */
interface AmazonAdsKeywordReport {
  keywordId: string;
  campaignId: string;
  adGroupId: string;
  keywordText: string;
  matchType: string;
  state: string;
  bid: number;
  impressions: number;
  clicks: number;
  cost: number;
  attributedConversions14d: number;
  attributedSales14d: number;
}

/**
 * レポートステータスレスポンス
 */
interface ReportStatusResponse {
  reportId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  statusDetails?: string;
  url?: string;
}

// =============================================================================
// OAuth トークン管理
// =============================================================================

let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Amazon Ads API からアクセストークンを取得
 * 認証エラーはリトライ不可として扱う
 */
async function getAccessToken(config: EnvConfig): Promise<string> {
  // キャッシュされたトークンが有効ならそれを返す
  if (cachedAccessToken && Date.now() < tokenExpiresAt) {
    return cachedAccessToken;
  }

  logger.info("Refreshing Amazon Ads API access token");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.amazonAdsRefreshToken,
    client_id: config.amazonAdsClientId,
    client_secret: config.amazonAdsClientSecret,
  });

  const response = await fetch(AMAZON_ADS_API.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("Failed to obtain access token", {
      status: response.status,
      error: errorText,
    });

    // 認証エラーは専用のエラークラスで投げる（リトライ不可）
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError(
        `Amazon Ads authentication failed: ${response.status}`,
        { responseBody: errorText }
      );
    }

    // その他のエラーはAmazonAdsApiErrorとして分類
    throw AmazonAdsApiError.fromHttpStatus(response.status, errorText);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedAccessToken = data.access_token;
  tokenExpiresAt =
    Date.now() + (data.expires_in - AMAZON_ADS_API.TOKEN_CACHE_BUFFER_SECONDS) * 1000;

  logger.info("Access token refreshed successfully");
  return cachedAccessToken;
}

// =============================================================================
// API リクエスト
// =============================================================================

/**
 * Amazon Ads API にリクエストを送信（エラー分類付き）
 * Circuit Breaker と リトライ を内部で適用
 */
async function makeAmazonAdsRequest<T>(
  config: EnvConfig,
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<T> {
  const requestId = `amazon-ads-${Date.now()}`;

  // Circuit Breaker付きリトライでラップ
  return withRetry(
    async () => {
      const accessToken = await getAccessToken(config);
      const url = `${config.amazonAdsApiBaseUrl}${endpoint}`;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Amazon-Advertising-API-ClientId": config.amazonAdsClientId,
        "Amazon-Advertising-API-Scope": config.amazonAdsProfileId,
        "Content-Type": "application/json",
        Accept: "application/vnd.spkeyword.v3+json",
        "X-Request-ID": requestId,
      };

      const options: RequestInit = {
        method,
        headers,
      };

      if (body && method === "POST") {
        options.body = JSON.stringify(body);
      }

      logger.debug("Making Amazon Ads API request", { method, endpoint, requestId });

      const response = await fetch(url, options);
      const amazonRequestId = response.headers.get("x-amz-request-id") || undefined;

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Amazon Ads API request failed", {
          method,
          endpoint,
          status: response.status,
          error: errorText,
          requestId,
          amazonRequestId,
        });

        // HTTPステータスに応じたエラーを投げる
        throw AmazonAdsApiError.fromHttpStatus(response.status, errorText, amazonRequestId);
      }

      return response.json() as Promise<T>;
    },
    {
      name: "amazon-ads-api",
      retryConfig: {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 60000,
      },
      circuitBreakerConfig: {
        failureThreshold: 5,
        resetTimeoutMs: 60000, // 1分
        halfOpenRequests: 2,
      },
    }
  );
}

/**
 * レポートの完了を待機（ポーリング）
 */
async function waitForReportCompletion(
  config: EnvConfig,
  reportId: string
): Promise<string> {
  logger.info("Waiting for report completion", { reportId });

  for (let attempt = 0; attempt < AMAZON_ADS_API.REPORT_POLL_MAX_ATTEMPTS; attempt++) {
    const status = await makeAmazonAdsRequest<ReportStatusResponse>(
      config,
      `/reporting/reports/${reportId}`,
      "GET"
    );

    logger.debug("Report status check", {
      reportId,
      status: status.status,
      attempt: attempt + 1,
    });

    if (status.status === AMAZON_ADS_API.REPORT_STATUS_COMPLETED) {
      if (!status.url) {
        throw new Error("Report completed but no download URL provided");
      }
      logger.info("Report completed successfully", { reportId });
      return status.url;
    }

    if (status.status === AMAZON_ADS_API.REPORT_STATUS_FAILED) {
      throw new Error(
        `Report generation failed: ${status.statusDetails || "Unknown error"}`
      );
    }

    // 待機
    await sleep(AMAZON_ADS_API.REPORT_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Report generation timed out after ${AMAZON_ADS_API.REPORT_POLL_MAX_ATTEMPTS} attempts`
  );
}

/**
 * レポートをダウンロード
 */
async function downloadReport(url: string): Promise<AmazonAdsKeywordReport[]> {
  logger.info("Downloading report", { url: url.substring(0, 50) + "..." });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download report: ${response.status}`);
  }

  // gzip圧縮されている場合はブラウザが自動解凍する
  const data = await response.json();
  return data as AmazonAdsKeywordReport[];
}

/**
 * 遅延
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// レポート取得
// =============================================================================

/**
 * Sponsored Products のキーワードレポートを取得（v3 非同期API）
 */
async function fetchKeywordReportFromAmazon(
  config: EnvConfig,
  lookbackDays: number
): Promise<AmazonAdsKeywordReport[]> {
  // 日付範囲の計算
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  logger.info("Requesting keyword report", {
    startDate: startDateStr,
    endDate: endDateStr,
    lookbackDays,
  });

  // v3 非同期レポートリクエスト
  const reportRequest = {
    name: `Keyword Performance Report ${Date.now()}`,
    startDate: startDateStr,
    endDate: endDateStr,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["keyword"],
      columns: [
        "keywordId",
        "campaignId",
        "adGroupId",
        "keywordText",
        "matchType",
        "state",
        "bid",
        "impressions",
        "clicks",
        "cost",
        "purchases14d",
        "sales14d",
      ],
      reportTypeId: "spKeywords",
      timeUnit: "SUMMARY",
      format: "GZIP_JSON",
    },
  };

  // レポート生成リクエスト
  const createResponse = await makeAmazonAdsRequest<{ reportId: string }>(
    config,
    "/reporting/reports",
    "POST",
    reportRequest
  );

  logger.info("Report creation requested", { reportId: createResponse.reportId });

  // レポート完了を待機
  const downloadUrl = await waitForReportCompletion(config, createResponse.reportId);

  // レポートをダウンロード
  const report = await downloadReport(downloadUrl);

  logger.info("Report downloaded successfully", { recordCount: report.length });

  return report;
}

// =============================================================================
// データ変換
// =============================================================================

/**
 * キーワードテキストからブランドタイプを推定
 */
function estimateBrandType(
  keywordText: string,
  ownBrands: string[] = [],
  competitorBrands: string[] = []
): BrandType {
  const keyword = keywordText.toLowerCase();

  if (ownBrands.some((brand) => keyword.includes(brand.toLowerCase()))) {
    return "BRAND";
  }

  if (competitorBrands.some((brand) => keyword.includes(brand.toLowerCase()))) {
    return "CONQUEST";
  }

  return "GENERIC";
}

/**
 * ACOS と CVR からスコアランクを推定
 */
function estimateScoreRank(acos: number, cvr: number): ScoreRank {
  if (acos <= SCORE_RANK_THRESHOLDS.S_MAX_ACOS && cvr >= SCORE_RANK_THRESHOLDS.S_MIN_CVR) {
    return "S";
  }
  if (acos <= SCORE_RANK_THRESHOLDS.A_MAX_ACOS && cvr >= SCORE_RANK_THRESHOLDS.A_MIN_CVR) {
    return "A";
  }
  if (acos <= SCORE_RANK_THRESHOLDS.B_MAX_ACOS) {
    return "B";
  }
  return "C";
}

/**
 * Priority Score を計算
 */
function calculatePriorityScore(
  acos: number,
  cvr: number,
  ctr: number
): number {
  const acosScore = Math.max(0, 1 - acos / PRIORITY_SCORE.ACOS_MAX);
  const cvrScore = Math.min(1, cvr / PRIORITY_SCORE.CVR_MAX);
  const ctrScore = Math.min(1, ctr / PRIORITY_SCORE.CTR_MAX);

  return (
    acosScore * PRIORITY_SCORE.ACOS_WEIGHT +
    cvrScore * PRIORITY_SCORE.CVR_WEIGHT +
    ctrScore * PRIORITY_SCORE.CTR_WEIGHT
  );
}

/**
 * Amazon Ads API のメトリクスを KeywordMetrics にマッピング
 */
function mapAmazonMetricsToKeywordMetrics(
  rawData: AmazonAdsKeywordReport[],
  phaseType: PhaseType = "NORMAL",
  ownBrands: string[] = [],
  competitorBrands: string[] = []
): KeywordMetrics[] {
  return rawData.map((raw) => {
    // 基本メトリクスの計算
    const ctr = raw.impressions > 0 ? raw.clicks / raw.impressions : 0;
    const cvr = raw.clicks > 0 ? raw.attributedConversions14d / raw.clicks : 0;
    const cpc = raw.clicks > 0 ? raw.cost / raw.clicks : 0;
    const acos =
      raw.attributedSales14d > 0 ? raw.cost / raw.attributedSales14d : 0;

    const brandType = estimateBrandType(raw.keywordText, ownBrands, competitorBrands);
    const scoreRank = estimateScoreRank(acos, cvr);

    const metrics: KeywordMetrics = {
      keyword_id: raw.keywordId.toString(),
      campaign_id: raw.campaignId.toString(),
      ad_group_id: raw.adGroupId.toString(),

      phase_type: phaseType,
      brand_type: brandType,
      score_rank: scoreRank,

      current_bid: raw.bid,
      baseline_cpc: cpc * 0.9,

      acos_target: ACOS_THRESHOLDS.DEFAULT_TARGET,
      acos_actual: acos,

      cvr_recent: cvr,
      cvr_baseline: cvr * 0.95,
      ctr_recent: ctr,
      ctr_baseline: ctr * 0.95,

      clicks_1h: Math.round(raw.clicks / 24),
      clicks_3h: Math.round((raw.clicks / 24) * 3),
      impressions_1h: Math.round(raw.impressions / 24),
      impressions_3h: Math.round((raw.impressions / 24) * 3),

      rank_current: null,
      rank_target: null,

      competitor_cpc_current: cpc * 1.1,
      competitor_cpc_baseline: cpc * 1.05,
      comp_strength: 0.5,

      risk_penalty: raw.clicks < 10 ? 0.5 : raw.clicks < 50 ? 0.2 : 0.0,

      priority_score: calculatePriorityScore(acos, cvr, ctr),
      tos_ctr_mult: ctr > 0.05 ? 1.2 : 1.0,
      tos_cvr_mult: cvr > 0.02 ? 1.3 : 1.0,
      tos_gap_cpc: cpc * 0.2,

      campaign_budget_remaining: 50000,
      expected_clicks_3h: Math.round((raw.clicks / 24) * 3 * 1.1),
      time_in_phase_minutes: 60,
    };

    return metrics;
  });
}

// =============================================================================
// エクスポート関数
// =============================================================================

export interface FetchKeywordMetricsParams {
  profileId: string;
  lookbackDays: number;
  sponsoredType: "SPONSORED_PRODUCTS";
  phaseType?: PhaseType;
  ownBrands?: string[];
  competitorBrands?: string[];
}

/**
 * Amazon Ads API からキーワード指標を取得して KeywordMetrics に変換
 */
export async function fetchKeywordMetrics(
  params: FetchKeywordMetricsParams
): Promise<KeywordMetrics[]> {
  const config = loadEnvConfig();

  logger.info("Fetching keyword metrics from Amazon Ads API", {
    profileId: params.profileId,
    lookbackDays: params.lookbackDays,
    phaseType: params.phaseType,
  });

  const rawReport = await fetchKeywordReportFromAmazon(
    config,
    params.lookbackDays
  );

  logger.info("Raw report fetched", { recordCount: rawReport.length });

  const metrics = mapAmazonMetricsToKeywordMetrics(
    rawReport,
    params.phaseType || "NORMAL",
    params.ownBrands || [],
    params.competitorBrands || []
  );

  logger.info("Metrics mapped successfully", { metricsCount: metrics.length });

  return metrics;
}

/**
 * テスト用：モックデータを返す
 */
export function getMockKeywordMetrics(count: number = 10): KeywordMetrics[] {
  const metrics: KeywordMetrics[] = [];

  for (let i = 0; i < count; i++) {
    metrics.push({
      keyword_id: `kw${String(i).padStart(3, "0")}`,
      campaign_id: `camp${String(Math.floor(i / 3)).padStart(3, "0")}`,
      ad_group_id: `ag${String(i).padStart(3, "0")}`,
      phase_type: "NORMAL",
      brand_type: i % 3 === 0 ? "BRAND" : i % 3 === 1 ? "CONQUEST" : "GENERIC",
      score_rank: ["S", "A", "B", "C"][i % 4] as ScoreRank,
      current_bid: 100 + Math.random() * 200,
      baseline_cpc: 80 + Math.random() * 100,
      acos_target: 0.2,
      acos_actual: 0.1 + Math.random() * 0.4,
      cvr_recent: 0.01 + Math.random() * 0.1,
      cvr_baseline: 0.01 + Math.random() * 0.08,
      ctr_recent: 0.01 + Math.random() * 0.05,
      ctr_baseline: 0.01 + Math.random() * 0.04,
      clicks_1h: Math.floor(Math.random() * 20),
      clicks_3h: Math.floor(Math.random() * 60),
      impressions_1h: Math.floor(Math.random() * 1000),
      impressions_3h: Math.floor(Math.random() * 3000),
      rank_current: Math.floor(Math.random() * 10) + 1,
      rank_target: Math.floor(Math.random() * 5) + 1,
      competitor_cpc_current: 100 + Math.random() * 150,
      competitor_cpc_baseline: 90 + Math.random() * 120,
      comp_strength: Math.random(),
      risk_penalty: Math.random() * 0.5,
      priority_score: Math.random(),
      tos_ctr_mult: 1 + Math.random() * 0.5,
      tos_cvr_mult: 1 + Math.random() * 0.5,
      tos_gap_cpc: Math.random() * 50,
      campaign_budget_remaining: 10000 + Math.random() * 90000,
      expected_clicks_3h: Math.floor(Math.random() * 100),
      time_in_phase_minutes: Math.floor(Math.random() * 180),
    });
  }

  return metrics;
}

// =============================================================================
// キーワード作成・更新 API (Sponsored Products)
// =============================================================================

/**
 * キーワード作成リクエストの型
 */
export interface CreateKeywordRequest {
  campaignId: string;
  adGroupId: string;
  keywordText: string;
  matchType: "EXACT" | "PHRASE" | "BROAD";
  bid: number;
  state?: "ENABLED" | "PAUSED";
}

/**
 * キーワード作成レスポンスの型
 */
export interface CreateKeywordResponse {
  keywordId: string;
  code: string;
  details?: string;
}

/**
 * ネガティブキーワード作成リクエストの型
 */
export interface CreateNegativeKeywordRequest {
  campaignId: string;
  adGroupId?: string; // 省略時はキャンペーンレベル
  keywordText: string;
  matchType: "NEGATIVE_EXACT" | "NEGATIVE_PHRASE";
  state?: "ENABLED";
}

/**
 * ネガティブキーワード作成レスポンスの型
 */
export interface CreateNegativeKeywordResponse {
  keywordId: string;
  code: string;
  details?: string;
}

/**
 * バッチ操作結果の型
 */
export interface BatchOperationResult<T> {
  success: T[];
  errors: Array<{
    index: number;
    code: string;
    details: string;
  }>;
}

/**
 * Sponsored Products キーワードを作成
 *
 * @param requests キーワード作成リクエストの配列
 * @returns 作成結果
 */
export async function createKeywords(
  requests: CreateKeywordRequest[]
): Promise<BatchOperationResult<CreateKeywordResponse>> {
  const config = loadEnvConfig();

  logger.info("Creating keywords via Amazon Ads API", {
    count: requests.length,
  });

  // Amazon Ads API v3 の Sponsored Products Keywords エンドポイント
  // POST /sp/keywords
  const payload = {
    keywords: requests.map((req) => ({
      campaignId: req.campaignId,
      adGroupId: req.adGroupId,
      keywordText: req.keywordText,
      matchType: req.matchType,
      bid: req.bid,
      state: req.state || "ENABLED",
    })),
  };

  try {
    const response = await makeAmazonAdsRequest<{
      keywords: Array<{
        keywordId?: string;
        index: number;
        code: string;
        details?: string;
      }>;
    }>(config, "/sp/keywords", "POST", payload);

    const success: CreateKeywordResponse[] = [];
    const errors: Array<{ index: number; code: string; details: string }> = [];

    for (const item of response.keywords || []) {
      if (item.code === "SUCCESS" && item.keywordId) {
        success.push({
          keywordId: item.keywordId,
          code: item.code,
          details: item.details,
        });
      } else {
        errors.push({
          index: item.index,
          code: item.code,
          details: item.details || "Unknown error",
        });
      }
    }

    logger.info("Keywords creation completed", {
      successCount: success.length,
      errorCount: errors.length,
    });

    return { success, errors };
  } catch (error) {
    logger.error("Failed to create keywords", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Sponsored Products ネガティブキーワードを作成
 *
 * @param requests ネガティブキーワード作成リクエストの配列
 * @returns 作成結果
 */
export async function createNegativeKeywords(
  requests: CreateNegativeKeywordRequest[]
): Promise<BatchOperationResult<CreateNegativeKeywordResponse>> {
  const config = loadEnvConfig();

  logger.info("Creating negative keywords via Amazon Ads API", {
    count: requests.length,
  });

  // Amazon Ads API v3 の Sponsored Products Negative Keywords エンドポイント
  // POST /sp/negativeKeywords
  const payload = {
    negativeKeywords: requests.map((req) => ({
      campaignId: req.campaignId,
      adGroupId: req.adGroupId, // 省略時はキャンペーンレベル
      keywordText: req.keywordText,
      matchType: req.matchType,
      state: req.state || "ENABLED",
    })),
  };

  try {
    const response = await makeAmazonAdsRequest<{
      negativeKeywords: Array<{
        keywordId?: string;
        index: number;
        code: string;
        details?: string;
      }>;
    }>(config, "/sp/negativeKeywords", "POST", payload);

    const success: CreateNegativeKeywordResponse[] = [];
    const errors: Array<{ index: number; code: string; details: string }> = [];

    for (const item of response.negativeKeywords || []) {
      if (item.code === "SUCCESS" && item.keywordId) {
        success.push({
          keywordId: item.keywordId,
          code: item.code,
          details: item.details,
        });
      } else {
        errors.push({
          index: item.index,
          code: item.code,
          details: item.details || "Unknown error",
        });
      }
    }

    logger.info("Negative keywords creation completed", {
      successCount: success.length,
      errorCount: errors.length,
    });

    return { success, errors };
  } catch (error) {
    logger.error("Failed to create negative keywords", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * キャンペーンレベルのネガティブキーワードを作成
 *
 * @param requests キャンペーンネガティブキーワード作成リクエストの配列
 * @returns 作成結果
 */
export async function createCampaignNegativeKeywords(
  requests: Array<{
    campaignId: string;
    keywordText: string;
    matchType: "NEGATIVE_EXACT" | "NEGATIVE_PHRASE";
  }>
): Promise<BatchOperationResult<CreateNegativeKeywordResponse>> {
  const config = loadEnvConfig();

  logger.info("Creating campaign-level negative keywords via Amazon Ads API", {
    count: requests.length,
  });

  // Amazon Ads API v3 の Sponsored Products Campaign Negative Keywords エンドポイント
  // POST /sp/campaignNegativeKeywords
  const payload = {
    campaignNegativeKeywords: requests.map((req) => ({
      campaignId: req.campaignId,
      keywordText: req.keywordText,
      matchType: req.matchType,
      state: "ENABLED",
    })),
  };

  try {
    const response = await makeAmazonAdsRequest<{
      campaignNegativeKeywords: Array<{
        keywordId?: string;
        index: number;
        code: string;
        details?: string;
      }>;
    }>(config, "/sp/campaignNegativeKeywords", "POST", payload);

    const success: CreateNegativeKeywordResponse[] = [];
    const errors: Array<{ index: number; code: string; details: string }> = [];

    for (const item of response.campaignNegativeKeywords || []) {
      if (item.code === "SUCCESS" && item.keywordId) {
        success.push({
          keywordId: item.keywordId,
          code: item.code,
          details: item.details,
        });
      } else {
        errors.push({
          index: item.index,
          code: item.code,
          details: item.details || "Unknown error",
        });
      }
    }

    logger.info("Campaign negative keywords creation completed", {
      successCount: success.length,
      errorCount: errors.length,
    });

    return { success, errors };
  } catch (error) {
    logger.error("Failed to create campaign negative keywords", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

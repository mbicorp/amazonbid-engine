/**
 * Amazon広告自動入札提案エンジン - 環境変数設定
 */

import { SERVER, AMAZON_ADS_API, BIGQUERY } from "./constants";
import {
  EventMode,
  isValidEventMode,
  EventModeSource,
  isValidEventModeSource,
  EventModeDecision,
  determineEventMode,
  SALE_EVENT_CALENDAR,
} from "./event";
import {
  GuardrailsMode,
  isValidGuardrailsMode,
  DEFAULT_GUARDRAILS_MODE,
} from "./guardrails";

/**
 * 環境変数の設定インターフェース
 */
export interface EnvConfig {
  // サーバー設定
  port: number;
  nodeEnv: string;

  // Amazon Ads API設定
  amazonAdsApiBaseUrl: string;
  amazonAdsClientId: string;
  amazonAdsClientSecret: string;
  amazonAdsRefreshToken: string;
  amazonAdsProfileId: string;

  // BigQuery設定
  bigqueryProjectId: string;
  bigqueryDatasetId: string;

  // 認証設定
  apiKey?: string;
  enableOidcAuth: boolean;
  googleCloudProjectId?: string;

  // ネガティブキーワード設定
  /**
   * ネガティブキーワード APPLY モードを有効化するかどうか
   * - 環境変数 NEGATIVE_APPLY_ENABLED="true" で有効化
   * - デフォルト: false（無効）
   * - 将来、APPROVED 状態の候補を Amazon Ads API に適用する際に使用
   */
  negativeApplyEnabled: boolean;

  // イベントオーバーライド設定
  /**
   * 現在のイベントモード
   * - 環境変数 EVENT_MODE で設定
   * - 有効値: "NONE", "BIG_SALE_PREP", "BIG_SALE_DAY"
   * - 不正な値や未設定の場合は "NONE" にフォールバック
   * - 大型セール時に「守りのロジック」を緩和するために使用
   */
  eventMode: EventMode;

  /**
   * EventMode決定ソース
   * - 環境変数 EVENT_MODE_SOURCE で設定
   * - 有効値: "MANUAL", "CALENDAR"
   * - MANUAL: 環境変数 EVENT_MODE から手動設定（従来の方式）
   * - CALENDAR: イベントカレンダーから自動判定
   * - 不正な値や未設定の場合は "MANUAL" にフォールバック
   */
  eventModeSource: EventModeSource;

  // ガードレール設定
  /**
   * ガードレール適用モード
   * - 環境変数 GUARDRAILS_MODE で設定
   * - 有効値: "OFF", "SHADOW", "ENFORCE"
   * - OFF: ガードレール計算を行わない（トラブルシュート用）
   * - SHADOW: 計算するがログのみ、実際の入札値には適用しない（デフォルト）
   * - ENFORCE: 計算結果を実際の入札値に適用する
   * - 不正な値や未設定の場合は "SHADOW" にフォールバック
   */
  guardrailsMode: GuardrailsMode;
}

/**
 * 必須環境変数のリスト
 */
const REQUIRED_ENV_VARS = [
  "AMAZON_ADS_CLIENT_ID",
  "AMAZON_ADS_CLIENT_SECRET",
  "AMAZON_ADS_REFRESH_TOKEN",
  "AMAZON_ADS_PROFILE_ID",
] as const;

/**
 * 環境変数の欠落エラー
 */
export class MissingEnvVarError extends Error {
  constructor(varName: string) {
    super(`Required environment variable "${varName}" is not set`);
    this.name = "MissingEnvVarError";
  }
}

/**
 * 環境変数を検証し、設定オブジェクトを返す
 * @throws {MissingEnvVarError} 必須環境変数が設定されていない場合
 */
export function loadEnvConfig(): EnvConfig {
  const missingVars: string[] = [];

  // 必須環境変数のチェック
  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    throw new MissingEnvVarError(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
  }

  return {
    // サーバー設定
    port: parseInt(process.env.PORT || String(SERVER.DEFAULT_PORT), 10),
    nodeEnv: process.env.NODE_ENV || "development",

    // Amazon Ads API設定
    amazonAdsApiBaseUrl:
      process.env.AMAZON_ADS_API_BASE_URL || AMAZON_ADS_API.DEFAULT_BASE_URL,
    amazonAdsClientId: process.env.AMAZON_ADS_CLIENT_ID!,
    amazonAdsClientSecret: process.env.AMAZON_ADS_CLIENT_SECRET!,
    amazonAdsRefreshToken: process.env.AMAZON_ADS_REFRESH_TOKEN!,
    amazonAdsProfileId: process.env.AMAZON_ADS_PROFILE_ID!,

    // BigQuery設定
    bigqueryProjectId: process.env.BIGQUERY_PROJECT_ID || BIGQUERY.PROJECT_ID,
    bigqueryDatasetId: process.env.BIGQUERY_DATASET_ID || BIGQUERY.DATASET_ID,

    // 認証設定
    apiKey: process.env.API_KEY,
    enableOidcAuth: process.env.ENABLE_OIDC_AUTH === "true",
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT_ID,

    // ネガティブキーワード設定
    // 環境変数が明示的に "true" の場合のみ有効化、それ以外は全て false
    negativeApplyEnabled: process.env.NEGATIVE_APPLY_ENABLED === "true",

    // イベントオーバーライド設定
    // 有効な値でない場合は "NONE" にフォールバック
    eventMode: parseEventMode(process.env.EVENT_MODE),

    // EventMode決定ソース
    // 有効な値でない場合は "MANUAL" にフォールバック
    eventModeSource: parseEventModeSource(process.env.EVENT_MODE_SOURCE),

    // ガードレール設定
    // 有効な値でない場合は "SHADOW" にフォールバック（安全デフォルト）
    guardrailsMode: parseGuardrailsMode(process.env.GUARDRAILS_MODE),
  };
}

/**
 * EVENT_MODE環境変数をパースしてEventModeを返す
 * 不正な値や未設定の場合は "NONE" を返す
 */
function parseEventMode(value: string | undefined): EventMode {
  if (value && isValidEventMode(value)) {
    return value;
  }
  return "NONE";
}

/**
 * EVENT_MODE_SOURCE環境変数をパースしてEventModeSourceを返す
 * 不正な値や未設定の場合は "MANUAL" を返す
 */
function parseEventModeSource(value: string | undefined): EventModeSource {
  if (value && isValidEventModeSource(value)) {
    return value;
  }
  return "MANUAL";
}

/**
 * GUARDRAILS_MODE環境変数をパースしてGuardrailsModeを返す
 * 不正な値や未設定の場合は "SHADOW" を返す（安全デフォルト）
 */
function parseGuardrailsMode(value: string | undefined): GuardrailsMode {
  if (value && isValidGuardrailsMode(value)) {
    return value;
  }
  return DEFAULT_GUARDRAILS_MODE;
}

/**
 * EventModeを決定（カレンダー自動判定または手動設定）
 *
 * @param now - 現在時刻
 * @param envConfig - 環境設定
 * @returns EventMode決定結果
 */
export function resolveEventModeDecision(
  now: Date,
  envConfig: EnvConfig
): EventModeDecision {
  return determineEventMode(now, envConfig.eventMode, SALE_EVENT_CALENDAR);
}

/**
 * 環境変数を検証のみ行う（起動時チェック用）
 * @returns 検証結果とエラーメッセージ
 */
export function validateEnvConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }

  // ポート番号の検証
  const port = parseInt(process.env.PORT || String(SERVER.DEFAULT_PORT), 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT value: ${process.env.PORT}`);
  }

  // OIDC認証が有効な場合、Google Cloud Project IDが必要
  if (
    process.env.ENABLE_OIDC_AUTH === "true" &&
    !process.env.GOOGLE_CLOUD_PROJECT_ID
  ) {
    errors.push(
      "GOOGLE_CLOUD_PROJECT_ID is required when ENABLE_OIDC_AUTH is true"
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 環境変数の設定例を出力（デバッグ用）
 */
export function printEnvTemplate(): void {
  console.log(`
# Amazon Ads API設定（必須）
AMAZON_ADS_CLIENT_ID=your_client_id
AMAZON_ADS_CLIENT_SECRET=your_client_secret
AMAZON_ADS_REFRESH_TOKEN=your_refresh_token
AMAZON_ADS_PROFILE_ID=your_profile_id

# Amazon Ads APIベースURL（オプション）
AMAZON_ADS_API_BASE_URL=https://advertising-api.amazon.com

# サーバー設定（オプション）
PORT=8080
NODE_ENV=production

# BigQuery設定（オプション）
BIGQUERY_PROJECT_ID=rpptool
BIGQUERY_DATASET_ID=amazon_bid_engine

# 認証設定（オプション）
API_KEY=your_api_key
ENABLE_OIDC_AUTH=false
GOOGLE_CLOUD_PROJECT_ID=your_gcp_project_id

# ネガティブキーワード設定（オプション）
NEGATIVE_APPLY_ENABLED=false

# イベントオーバーライド設定（オプション）
# 有効値: NONE, BIG_SALE_PREP, BIG_SALE_DAY
EVENT_MODE=NONE

# EventMode決定ソース設定（オプション）
# 有効値: MANUAL, CALENDAR
# MANUAL: 環境変数 EVENT_MODE から手動設定（デフォルト）
# CALENDAR: イベントカレンダーから自動判定
EVENT_MODE_SOURCE=MANUAL

# ガードレール設定（オプション）
# 有効値: OFF, SHADOW, ENFORCE
# OFF: ガードレール計算を行わない（トラブルシュート用）
# SHADOW: 計算するがログのみ（デフォルト）
# ENFORCE: 計算結果を実際の入札値に適用する
GUARDRAILS_MODE=SHADOW
  `);
}

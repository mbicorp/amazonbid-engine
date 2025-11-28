/**
 * 入札エンジン
 *
 * ProductConfigを唯一の正として、入札推奨を計算・適用するメインエンジン
 * シャドーモード対応・全処理ログ記録
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import { ProductConfig } from "../ltv/types";
import { loadAllProductConfigs, ProductConfigLoaderOptions } from "../config/productConfigLoader";
import { getTargetAcosWithDetails } from "../ltv/ltv-calculator";
import {
  ExecutionLogger,
  ExecutionLoggerOptions,
  createExecutionLogger,
  getExecutionMode,
  isShadowMode,
  applyBidWithMode,
  logExecutionModeOnStartup,
  ReasonCode,
  TriggerSource,
} from "../logging";
import {
  calculateTargetAcos,
  determineBidAction,
  calculateRecommendedBid,
  LifecycleGlobalConfig,
  DEFAULT_LIFECYCLE_GLOBAL_CONFIG,
} from "../lifecycle/bid-integration";
import {
  applyGuardrails,
  loadAutoGuardrailsBulk,
  DEFAULT_GUARDRAILS_PER_LIFECYCLE,
  AutoGuardrailsResult,
  GuardrailsMode,
  DEFAULT_GUARDRAILS_MODE,
} from "../guardrails";
import {
  sendExecutionSummaryToSlack,
  isSlackExecutionSummaryEnabledForMode,
} from "../slack";
import { evaluateAndNotify, getAlertConfig } from "../monitoring";
import {
  createInventoryRepository,
  InventoryRepository,
  AsinInventorySnapshot,
  applyInventoryGuard,
  extractInventoryGuardConfig,
  InventoryGuardResult,
} from "../inventory";
import {
  EventMode,
  EventBidPolicy,
  getEventBidPolicy,
} from "../event";
import { loadEnvConfig } from "../config";

// =============================================================================
// 型定義
// =============================================================================

/**
 * エンジン設定
 */
export interface BidEngineConfig {
  projectId: string;
  dataset: string;
  triggerSource?: TriggerSource;
  triggeredBy?: string;
}

/**
 * キーワードメトリクス（BigQueryから取得）
 *
 * アトリビューション遅延対策として、以下の3種類の指標を持つ:
 * - 7d系: 直近7日間のフル集計（アップ判定用）
 * - 7dExclRecent系: 直近3日を除いた7日間（ダウン判定用）
 * - last3d系: 直近3日間のみ（安全弁判定用）
 * - 30d系: 直近30日間（長期トレンド確認用）
 */
export interface KeywordMetrics {
  asin: string;
  keywordId: string;
  keywordText: string;
  matchType: string;
  campaignId: string;
  adGroupId: string;
  currentBid: number;
  currentAcos: number | null;

  // ========================================
  // 7日フル集計（アップ判定用）
  // ========================================
  impressions7d: number;
  clicks7d: number;
  conversions7d: number;
  spend7d: number;
  sales7d: number;
  ctr7d: number | null;
  cvr7d: number | null;

  // ========================================
  // 直近3日除外集計（ダウン判定用）
  // アトリビューション遅延対策: 直近3日はCV計上が遅れるため除外
  // ========================================
  impressions7dExclRecent: number;
  clicks7dExclRecent: number;
  conversions7dExclRecent: number;
  spend7dExclRecent: number;
  sales7dExclRecent: number;
  ctr7dExclRecent: number | null;
  cvr7dExclRecent: number | null;
  acos7dExclRecent: number | null;

  // ========================================
  // 直近3日のみ（安全弁判定用）
  // 直近が好調ならダウン幅を抑える
  // ========================================
  impressionsLast3d: number;
  clicksLast3d: number;
  conversionsLast3d: number;
  spendLast3d: number;
  salesLast3d: number;
  ctrLast3d: number | null;
  cvrLast3d: number | null;
  acosLast3d: number | null;

  // ========================================
  // 30日集計（長期トレンド確認用）
  // ========================================
  impressions30d: number;
  clicks30d: number;
  conversions30d: number;
  spend30d: number;
  sales30d: number;
  ctr30d: number | null;
  cvr30d: number | null;
  acos30d: number | null;

  // オーガニック順位情報
  organicRank: number | null;
  organicRankTrend: number | null;
  organicRankZone: string | null;
}

// =============================================================================
// アトリビューション遅延対策の定数
// =============================================================================

/**
 * アトリビューション遅延対策の設定
 */
export const ATTRIBUTION_DELAY_CONFIG = {
  /**
   * 緩衝期間日数: ダウン判定時に除外する直近日数
   * Amazon広告のCV計上は通常2-3日遅れるため、3日に設定
   */
  SAFE_WINDOW_DAYS: 3,

  /**
   * ダウン判定に必要な最小クリック数（直近3日除外後）
   */
  MIN_CLICKS_FOR_DOWN: 10,

  /**
   * ACOS高すぎ判定の乗数（7日除外版）
   * acos7dExclRecent > targetAcos * この値 でACOS_HIGH判定
   */
  DOWN_ACOS_MULTIPLIER_7D_EXCL: 1.2,

  /**
   * ACOS高すぎ判定の乗数（30日版）
   * acos30d > targetAcos * この値 でACOS_HIGH判定（長期確認）
   */
  DOWN_ACOS_MULTIPLIER_30D: 1.05,

  /**
   * NO_CONVERSION判定のための30日最大注文数
   * orders30d がこの値以下の場合、長期でも売れていないと判定
   */
  NO_CONVERSION_MAX_ORDERS_30D: 1,

  /**
   * 直近3日好調判定: CVR改善率閾値
   * cvrLast3d >= cvr7dExclRecent * この値 なら直近好調
   */
  RECENT_GOOD_CVR_RATIO: 1.2,

  /**
   * 直近3日好調時のダウン幅抑制
   * 通常-30%のところを、この値（-15%）に抑える
   */
  REDUCED_DOWN_RATE: -0.15,
} as const;

/**
 * 入札推奨
 */
export interface BidRecommendation {
  asin: string;
  keywordId: string;
  keywordText: string;
  matchType: string;
  campaignId: string;
  adGroupId: string;
  oldBid: number;
  newBid: number;
  bidChange: number;
  bidChangePercent: number;
  targetAcos: number;
  currentAcos: number | null;
  reasonCode: ReasonCode;
  reasonDetail: string;
  product: ProductConfig;
  metrics: KeywordMetrics;

  // ガードレール情報（ログ用）
  /** 入札ロジックが計算した生の推奨値（ガードレール適用前） */
  rawNewBid: number;
  /** ガードレール適用後の値 */
  guardedNewBid: number;
  /** ガードでクリップされたかどうか */
  wasGuardClamped: boolean;
  /** クランプ理由 */
  guardClampReason: string | null;
  /** ガードレールの min_bid */
  guardrailsMinBid: number | null;
  /** ガードレールの max_bid */
  guardrailsMaxBid: number | null;
  /** ガードレールのデータソース */
  guardrailsAutoDataSource: "HISTORICAL" | "THEORETICAL" | "FALLBACK" | null;
  /** 使用されたガードレールモード (OFF/SHADOW/ENFORCE) */
  guardrailsMode: "OFF" | "SHADOW" | "ENFORCE";
  /** ガードレールが実際に newBid に適用されたか（ENFORCE かつ wasGuardClamped） */
  guardrailsApplied: boolean;

  // 在庫ガード情報（ログ用）
  /** 在庫日数 */
  daysOfInventory: number | null;
  /** 在庫リスクステータス */
  inventoryRiskStatus: string | null;
  /** 在庫ガードが適用されたかどうか */
  inventoryGuardApplied: boolean;
  /** 在庫ガードの種類 */
  inventoryGuardType: "HARD_KILL" | "SOFT_THROTTLE" | "NONE";
  /** 在庫ガード適用理由 */
  inventoryGuardReason: string | null;
  /** 在庫ガードで推奨をスキップするか */
  shouldSkipRecommendation: boolean;
}

/**
 * エンジン実行結果
 */
export interface BidEngineResult {
  executionId: string;
  mode: "APPLY" | "SHADOW";
  status: "SUCCESS" | "ERROR" | "PARTIAL_ERROR";
  stats: {
    totalProducts: number;
    totalKeywords: number;
    recommendations: number;
    applied: number;
    skipped: number;
    errors: number;
  };
  recommendations: BidRecommendation[];
  error?: Error;
}

// =============================================================================
// キーワードメトリクス取得
// =============================================================================

/**
 * キーワードメトリクスを取得
 *
 * アトリビューション遅延対策として、以下の指標を取得:
 * - 7d系: 直近7日間のフル集計（アップ判定用）
 * - 7dExclRecent系: 直近3日を除いた7日間（ダウン判定用）
 * - last3d系: 直近3日間のみ（安全弁判定用）
 * - 30d系: 直近30日間（長期トレンド確認用）
 */
async function fetchKeywordMetrics(
  config: BidEngineConfig,
  asins: string[]
): Promise<Map<string, KeywordMetrics[]>> {
  if (asins.length === 0) {
    return new Map();
  }

  const bigquery = new BigQuery({ projectId: config.projectId });

  // keyword_metrics_7d ビューから取得（アトリビューション遅延対策版）
  const query = `
    WITH keyword_metrics AS (
      SELECT
        km.asin,
        km.keyword_text,
        km.match_type,
        km.campaign_id,
        km.ad_group_id,
        km.current_bid,
        km.acos_7d AS current_acos,

        -- 7日フル集計（アップ判定用）
        km.impressions_7d,
        km.clicks_7d,
        km.orders_7d,
        km.sales_7d,
        km.cost_7d,
        km.ctr_7d,
        km.cvr_7d,

        -- 直近3日除外集計（ダウン判定用）
        km.impressions_7d_excl_recent,
        km.clicks_7d_excl_recent,
        km.orders_7d_excl_recent,
        km.sales_7d_excl_recent,
        km.cost_7d_excl_recent,
        km.ctr_7d_excl_recent,
        km.cvr_7d_excl_recent,
        km.acos_7d_excl_recent,

        -- 直近3日のみ（安全弁判定用）
        km.impressions_last3d,
        km.clicks_last3d,
        km.orders_last3d,
        km.sales_last3d,
        km.cost_last3d,
        km.ctr_last3d,
        km.cvr_last3d,
        km.acos_last3d,

        -- 30日集計（長期トレンド確認用）
        km.impressions_30d,
        km.clicks_30d,
        km.orders_30d,
        km.sales_30d,
        km.cost_30d,
        km.ctr_30d,
        km.cvr_30d,
        km.acos_30d

      FROM \`${config.projectId}.${config.dataset}.keyword_metrics_7d\` km
      WHERE km.asin IN UNNEST(@asins)
    ),
    seo_data AS (
      SELECT
        asin,
        keyword AS keyword_text,
        current_rank AS organic_rank,
        rank_trend AS organic_rank_trend,
        rank_zone AS organic_rank_zone
      FROM \`${config.projectId}.${config.dataset}.product_seo_rank_history\`
      WHERE asin IN UNNEST(@asins)
        AND recorded_at = (
          SELECT MAX(recorded_at) FROM \`${config.projectId}.${config.dataset}.product_seo_rank_history\`
          WHERE asin IN UNNEST(@asins)
        )
    )
    SELECT
      km.*,
      sd.organic_rank,
      sd.organic_rank_trend,
      sd.organic_rank_zone
    FROM keyword_metrics km
    LEFT JOIN seo_data sd ON km.asin = sd.asin AND km.keyword_text = sd.keyword_text
  `;

  try {
    const [rows] = await bigquery.query({
      query,
      params: { asins },
      location: "asia-northeast1",
    });

    const metricsMap = new Map<string, KeywordMetrics[]>();

    for (const row of rows) {
      const asin = row.asin as string;
      const metrics: KeywordMetrics = {
        asin,
        keywordId: row.keyword_id ?? "",
        keywordText: row.keyword_text ?? "",
        matchType: row.match_type ?? "BROAD",
        campaignId: row.campaign_id ?? "",
        adGroupId: row.ad_group_id ?? "",
        currentBid: row.current_bid ?? 0,
        currentAcos: row.current_acos ?? null,

        // 7日フル集計
        impressions7d: row.impressions_7d ?? 0,
        clicks7d: row.clicks_7d ?? 0,
        conversions7d: row.orders_7d ?? 0,
        spend7d: row.cost_7d ?? 0,
        sales7d: row.sales_7d ?? 0,
        ctr7d: row.ctr_7d ?? null,
        cvr7d: row.cvr_7d ?? null,

        // 直近3日除外集計（アトリビューション遅延対策）
        impressions7dExclRecent: row.impressions_7d_excl_recent ?? 0,
        clicks7dExclRecent: row.clicks_7d_excl_recent ?? 0,
        conversions7dExclRecent: row.orders_7d_excl_recent ?? 0,
        spend7dExclRecent: row.cost_7d_excl_recent ?? 0,
        sales7dExclRecent: row.sales_7d_excl_recent ?? 0,
        ctr7dExclRecent: row.ctr_7d_excl_recent ?? null,
        cvr7dExclRecent: row.cvr_7d_excl_recent ?? null,
        acos7dExclRecent: row.acos_7d_excl_recent ?? null,

        // 直近3日のみ（安全弁判定用）
        impressionsLast3d: row.impressions_last3d ?? 0,
        clicksLast3d: row.clicks_last3d ?? 0,
        conversionsLast3d: row.orders_last3d ?? 0,
        spendLast3d: row.cost_last3d ?? 0,
        salesLast3d: row.sales_last3d ?? 0,
        ctrLast3d: row.ctr_last3d ?? null,
        cvrLast3d: row.cvr_last3d ?? null,
        acosLast3d: row.acos_last3d ?? null,

        // 30日集計（長期トレンド確認用）
        impressions30d: row.impressions_30d ?? 0,
        clicks30d: row.clicks_30d ?? 0,
        conversions30d: row.orders_30d ?? 0,
        spend30d: row.cost_30d ?? 0,
        sales30d: row.sales_30d ?? 0,
        ctr30d: row.ctr_30d ?? null,
        cvr30d: row.cvr_30d ?? null,
        acos30d: row.acos_30d ?? null,

        // オーガニック順位情報
        organicRank: row.organic_rank ?? null,
        organicRankTrend: row.organic_rank_trend ?? null,
        organicRankZone: row.organic_rank_zone ?? null,
      };

      if (!metricsMap.has(asin)) {
        metricsMap.set(asin, []);
      }
      metricsMap.get(asin)!.push(metrics);
    }

    return metricsMap;
  } catch (error) {
    logger.error("Failed to fetch keyword metrics", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// =============================================================================
// 入札推奨計算
// =============================================================================

// =============================================================================
// アトリビューション遅延対策のヘルパー関数
// =============================================================================

/**
 * 直近3日が好調かどうかを判定
 *
 * 以下のいずれかを満たす場合、直近3日は好調と判定:
 * 1. 直近3日に少なくとも1件の注文がある
 * 2. 直近3日のCVRが7dExclRecentのCVRより明らかに良い（1.2倍以上）
 *
 * @returns 直近3日が好調ならtrue
 */
export function isRecentPerformanceGood(metrics: KeywordMetrics): boolean {
  const { RECENT_GOOD_CVR_RATIO } = ATTRIBUTION_DELAY_CONFIG;

  // 直近3日に注文がある場合は好調と判定
  if (metrics.conversionsLast3d >= 1) {
    return true;
  }

  // CVR比較（両方ともnullでない場合）
  if (
    metrics.cvrLast3d !== null &&
    metrics.cvr7dExclRecent !== null &&
    metrics.cvr7dExclRecent > 0
  ) {
    if (metrics.cvrLast3d >= metrics.cvr7dExclRecent * RECENT_GOOD_CVR_RATIO) {
      return true;
    }
  }

  return false;
}

/**
 * NO_CONVERSION判定（アトリビューション遅延対策版 + イベントオーバーライド対応）
 *
 * 以下のすべてを満たす場合のみNO_CONVERSIONと判定:
 * 1. 直近3日を除いた7日分で十分なクリックがある
 * 2. 直近3日を除いた7日分で注文がゼロ
 * 3. 30日で見てもほとんど注文がない（MAX_ORDERS_30D以下）
 *
 * イベントモードで allowNoConversionDown = false の場合は常にfalseを返す
 *
 * @param metrics - キーワードメトリクス
 * @param eventPolicy - イベントモードの入札ポリシー（オプション）
 * @returns NO_CONVERSION条件を満たすならtrue
 */
export function shouldBeNoConversion(
  metrics: KeywordMetrics,
  eventPolicy?: EventBidPolicy
): boolean {
  // イベントモードでNO_CONVERSIONダウンが無効化されている場合
  if (eventPolicy && !eventPolicy.allowNoConversionDown) {
    return false;
  }

  const { MIN_CLICKS_FOR_DOWN, NO_CONVERSION_MAX_ORDERS_30D } = ATTRIBUTION_DELAY_CONFIG;

  // 条件1: 直近3日除外で十分なクリック
  if (metrics.clicks7dExclRecent < MIN_CLICKS_FOR_DOWN) {
    return false;
  }

  // 条件2: 直近3日除外で注文ゼロ
  if (metrics.conversions7dExclRecent > 0) {
    return false;
  }

  // 条件3: 30日で見てもほとんど注文がない
  if (metrics.conversions30d > NO_CONVERSION_MAX_ORDERS_30D) {
    return false;
  }

  return true;
}

/**
 * ACOS高すぎ判定（アトリビューション遅延対策版 + イベントオーバーライド対応）
 *
 * 以下のすべてを満たす場合のみACOS_HIGHと判定:
 * 1. 直近3日を除いた7日分でACOSがtarget*乗数を超過
 * 2. 30日でもACOSがtarget*乗数を超過
 *
 * イベントモードに応じて乗数を調整（セール時は判定を緩める）
 *
 * @param metrics - キーワードメトリクス
 * @param targetAcos - 目標ACOS
 * @param eventPolicy - イベントモードの入札ポリシー（オプション）
 * @returns ACOS_HIGH条件を満たすならtrue
 */
export function shouldBeAcosHigh(
  metrics: KeywordMetrics,
  targetAcos: number,
  eventPolicy?: EventBidPolicy
): boolean {
  // イベントポリシーがあればそちらの乗数を使用、なければデフォルト
  const multiplier7dExcl = eventPolicy
    ? eventPolicy.acosHighMultiplierFor7dExcl
    : ATTRIBUTION_DELAY_CONFIG.DOWN_ACOS_MULTIPLIER_7D_EXCL;
  const multiplier30d = eventPolicy
    ? eventPolicy.acosHighMultiplierFor30d
    : ATTRIBUTION_DELAY_CONFIG.DOWN_ACOS_MULTIPLIER_30D;

  // 両方のACOSがnullでないことを確認
  if (metrics.acos7dExclRecent === null || metrics.acos30d === null) {
    return false;
  }

  // 条件1: 7日除外版ACOSが高い
  const acos7dExclHigh = metrics.acos7dExclRecent > targetAcos * multiplier7dExcl;

  // 条件2: 30日版ACOSも高い
  const acos30dHigh = metrics.acos30d > targetAcos * multiplier30d;

  return acos7dExclHigh && acos30dHigh;
}

/**
 * ダウンアクションに対する安全弁を適用（イベントオーバーライド対応）
 *
 * 直近3日が好調な場合、強いダウンを軽いダウンに抑制する
 * イベントモードで allowStrongDown = false の場合、STRONG_DOWN/STOPを一律MILD_DOWNに抑制
 *
 * @param action - 元のアクション
 * @param metrics - キーワードメトリクス
 * @param eventPolicy - イベントモードの入札ポリシー（オプション）
 * @returns 調整後のアクション
 */
export function applyRecentGoodSafetyValve(
  action: "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP",
  metrics: KeywordMetrics,
  eventPolicy?: EventBidPolicy
): "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP" {
  // アップまたはKEEPの場合はそのまま返す
  if (action === "STRONG_UP" || action === "MILD_UP" || action === "KEEP") {
    return action;
  }

  // イベントモードで強いダウンが禁止されている場合
  if (eventPolicy && !eventPolicy.allowStrongDown) {
    if (action === "STOP" || action === "STRONG_DOWN") {
      return "MILD_DOWN";
    }
  }

  // ダウン系のアクションで、直近3日が好調な場合
  if (isRecentPerformanceGood(metrics)) {
    // STOP → MILD_DOWN に緩和
    if (action === "STOP") {
      return "MILD_DOWN";
    }
    // STRONG_DOWN → MILD_DOWN に緩和
    if (action === "STRONG_DOWN") {
      return "MILD_DOWN";
    }
    // MILD_DOWN はそのまま
  }

  return action;
}

/**
 * 入札推奨の理由コードを判定（アトリビューション遅延対策版）
 *
 * ダウン系の判定では、直近3日を除外した7日分と30日分を併用
 */
function determineReasonCode(
  product: ProductConfig,
  metrics: KeywordMetrics,
  action: string
): ReasonCode {
  // ライフサイクルベースの判定
  if (product.lifecycleState === "LAUNCH_HARD" || product.lifecycleState === "LAUNCH_SOFT") {
    if (action === "STRONG_UP" || action === "MILD_UP") {
      return "LIFECYCLE_LAUNCH";
    }
  }

  if (product.lifecycleState === "HARVEST") {
    if (action === "MILD_DOWN" || action === "STRONG_DOWN") {
      return "LIFECYCLE_HARVEST";
    }
  }

  // オーガニック順位ベースの判定
  if (metrics.organicRank !== null) {
    if (metrics.organicRank <= 7 && (action === "MILD_DOWN" || action === "STRONG_DOWN")) {
      return "ORGANIC_STRONG";
    }
    if (metrics.organicRank > 20 && (action === "STRONG_UP" || action === "MILD_UP")) {
      return "ORGANIC_WEAK";
    }
  }

  // インプレッション不足（7日フルで判定）
  if (metrics.impressions7d < 100) {
    return "LOW_IMPRESSIONS";
  }

  // コンバージョンなし判定（アトリビューション遅延対策版）
  // ダウン判定のため、7dExclRecent + 30dを使用
  if (shouldBeNoConversion(metrics)) {
    return "NO_CONVERSION";
  }

  // ACOSベースの判定
  const targetAcos = getTargetAcosWithDetails(product).targetAcos;

  // アップ判定は従来通り7dフルを使用
  if (metrics.currentAcos !== null && metrics.currentAcos < targetAcos * 0.7) {
    return "ACOS_LOW";
  }

  // ダウン判定はアトリビューション遅延対策版を使用
  if (shouldBeAcosHigh(metrics, targetAcos)) {
    return "ACOS_HIGH";
  }

  // 変更なし
  if (action === "KEEP") {
    return "NO_CHANGE";
  }

  // デフォルト
  return "NO_CHANGE";
}

/**
 * 単一キーワードの入札推奨を計算（アトリビューション遅延対策・在庫ガード・イベントオーバーライド・ガードレール対応版）
 *
 * 処理順序:
 * 1. 通常ロジックでnewBidを決定
 * 2. アトリビューション遅延対策（ダウン方向の安全弁）
 * 3. イベントオーバーライド（セール時のダウン抑制・アップブースト）
 * 4. 在庫ガードロジック（ハードキル・ソフトスロットル）
 * 5. ガードレール適用（ENFORCE モードの場合のみ newBid に反映）
 *
 * @param product - 商品設定
 * @param metrics - キーワードメトリクス
 * @param lifecycleConfig - ライフサイクル設定
 * @param autoGuardrails - 自動ガードレール（事前に取得済み、オプション）
 * @param inventory - 在庫スナップショット（事前に取得済み、オプション）
 * @param eventMode - 現在のイベントモード（オプション、デフォルトはNONE）
 * @param guardrailsMode - ガードレール適用モード（オプション、デフォルトはSHADOW）
 */
function computeRecommendation(
  product: ProductConfig,
  metrics: KeywordMetrics,
  lifecycleConfig: LifecycleGlobalConfig = DEFAULT_LIFECYCLE_GLOBAL_CONFIG,
  autoGuardrails?: AutoGuardrailsResult | null,
  inventory?: AsinInventorySnapshot | null,
  eventMode: EventMode = "NONE",
  guardrailsMode: GuardrailsMode = DEFAULT_GUARDRAILS_MODE
): BidRecommendation {
  // イベントモードに対応したポリシーを取得
  const eventPolicy = getEventBidPolicy(eventMode);

  // 目標ACOSを計算（LTVベース）
  const acosDetails = getTargetAcosWithDetails(product);
  let targetAcos = acosDetails.targetAcos;

  // アクションを決定（7日フルデータを使用）
  const isInvestMode =
    product.lifecycleState === "LAUNCH_HARD" || product.lifecycleState === "LAUNCH_SOFT";
  let action = determineBidAction(
    metrics.currentAcos,
    targetAcos,
    metrics.clicks7d,
    isInvestMode
  );

  // ダウン系アクションの場合、アトリビューション遅延対策 + イベントオーバーライドを適用
  if (action === "MILD_DOWN" || action === "STRONG_DOWN" || action === "STOP") {
    // ダウン判定の厳格化: 7dExclRecent + 30dの両方で条件を満たす必要あり
    // イベントポリシーに応じて判定閾値を緩める
    const shouldDownByAcos = shouldBeAcosHigh(metrics, targetAcos, eventPolicy);
    const shouldDownByNoConv = shouldBeNoConversion(metrics, eventPolicy);

    // ACOS高すぎもNO_CONVERSIONも満たさない場合、KEEPに戻す
    if (!shouldDownByAcos && !shouldDownByNoConv) {
      // 7日フルでは悪く見えるが、実は直近3日除外+30日では問題ない
      // → アトリビューション遅延の可能性が高いのでダウンを見送る
      action = "KEEP";
    } else {
      // ダウン条件を満たす場合でも、直近3日の安全弁を適用
      // イベントモードで強いダウンが禁止されている場合も抑制
      action = applyRecentGoodSafetyValve(action, metrics, eventPolicy);
    }
  }

  // 推奨入札額を計算（これが rawNewBid になる）
  const { recommendedBid: rawRecommendedBid } = calculateRecommendedBid(
    metrics.currentBid || 100,
    action,
    lifecycleConfig
  );

  const currentBid = metrics.currentBid || 100;

  // ========================================
  // イベントオーバーライドによる入札額クリッピング
  // ========================================
  // eventPolicy.maxBidUpMultiplier/maxBidDownMultiplierを使用して
  // 入札額の変動幅を制限する
  const maxBid = currentBid * eventPolicy.maxBidUpMultiplier;
  const minBid = currentBid * eventPolicy.maxBidDownMultiplier;
  let recommendedBid = Math.min(Math.max(rawRecommendedBid, minBid), maxBid);

  // ただし、在庫ガードの max_loss_daily 等の安全ガードは維持
  // （これらはセール時でも動作させる）

  // ========================================
  // 在庫ガードロジックを適用
  // ========================================
  const inventoryGuardConfig = extractInventoryGuardConfig(product);
  const defaultGuardrails = DEFAULT_GUARDRAILS_PER_LIFECYCLE[product.lifecycleState];
  const inventoryGuardResult = applyInventoryGuard(
    inventory ?? null,
    recommendedBid,
    currentBid,
    inventoryGuardConfig,
    defaultGuardrails.max_up_ratio,
    targetAcos
  );

  // 在庫ガード適用後の入札額を使用
  let finalBid = inventoryGuardResult.adjustedBid;
  let finalReasonCode: ReasonCode = determineReasonCode(product, metrics, action);

  // 在庫ゼロ時はReasonCodeを上書き
  if (inventoryGuardResult.guardType === "HARD_KILL") {
    finalReasonCode = "INVENTORY_OUT_OF_STOCK";
    finalBid = 0; // 在庫ゼロ時は確実にゼロ
  } else if (inventoryGuardResult.guardType === "SOFT_THROTTLE" && inventoryGuardResult.wasApplied) {
    // ソフトスロットルが適用された場合もReasonCodeを変更
    finalReasonCode = "INVENTORY_LOW_STOCK";
  }

  // 在庫ガードでtargetAcosが調整された場合、更新
  if (inventoryGuardResult.adjustedTargetAcos !== null) {
    targetAcos = inventoryGuardResult.adjustedTargetAcos;
  }

  const bidChange = finalBid - currentBid;
  const bidChangePercent = currentBid > 0 ? (bidChange / currentBid) * 100 : 0;

  // 理由詳細を生成（在庫情報を含む）
  let reasonDetail = buildReasonDetail(product, metrics, action, targetAcos, finalReasonCode);
  if (inventoryGuardResult.reason) {
    reasonDetail += ` / 在庫ガード: ${inventoryGuardResult.reason}`;
  }

  // ========================================
  // ガードレールを適用
  // ========================================
  // See: architecture.md Section 10. Auto Guardrails
  // guardrailsMode によって動作が変わる:
  // - OFF: 計算をスキップ
  // - SHADOW: 計算するがログのみ（newBid は finalBid のまま）
  // - ENFORCE: 計算結果を実際に newBid に適用
  const guardrailResult = applyGuardrails({
    recommendedBid: finalBid,
    currentBid,
    asin: product.asin,
    lifecycleState: product.lifecycleState,
    useAutoMinMax: defaultGuardrails.use_auto_min_max,
    autoGuardrails: autoGuardrails ?? null,
    defaultGuardrails,
    guardrailsMode,
  });

  // ENFORCE モードの場合、ガードレール適用後の値を newBid として使用
  // SHADOW/OFF モードでは finalBid（在庫ガード適用後）をそのまま使用
  const effectiveNewBid = guardrailResult.guardrailsApplied
    ? guardrailResult.clippedBid
    : finalBid;

  // ガードレールで変更があった場合、bidChange/bidChangePercent を再計算
  const effectiveBidChange = effectiveNewBid - currentBid;
  const effectiveBidChangePercent = currentBid > 0
    ? (effectiveBidChange / currentBid) * 100
    : 0;

  // ガードレールでクリップされた場合、reasonDetail に追記
  if (guardrailResult.guardrailsApplied && guardrailResult.clipReason) {
    reasonDetail += ` / ガードレール: ${guardrailResult.clipReason}`;
  }

  return {
    asin: product.asin,
    keywordId: metrics.keywordId,
    keywordText: metrics.keywordText,
    matchType: metrics.matchType,
    campaignId: metrics.campaignId,
    adGroupId: metrics.adGroupId,
    oldBid: currentBid,
    // newBid: ENFORCE モードではガードレール適用後、それ以外は在庫ガード適用後
    newBid: effectiveNewBid,
    bidChange: effectiveBidChange,
    bidChangePercent: effectiveBidChangePercent,
    targetAcos,
    currentAcos: metrics.currentAcos,
    reasonCode: finalReasonCode,
    reasonDetail,
    product,
    metrics,
    // ガードレール情報
    rawNewBid: finalBid, // ガードレール適用前（在庫ガード適用後）
    guardedNewBid: guardrailResult.clippedBid,
    wasGuardClamped: guardrailResult.wasClipped,
    guardClampReason: guardrailResult.clipReason,
    guardrailsMinBid: guardrailResult.effectiveMinBid,
    guardrailsMaxBid: guardrailResult.effectiveMaxBid,
    guardrailsAutoDataSource: guardrailResult.autoDataSource,
    guardrailsMode: guardrailResult.guardrailsMode,
    guardrailsApplied: guardrailResult.guardrailsApplied,
    // 在庫ガード情報（ログ用）
    daysOfInventory: inventory?.daysOfInventory ?? null,
    inventoryRiskStatus: inventoryGuardResult.inventoryStatus,
    inventoryGuardApplied: inventoryGuardResult.wasApplied,
    inventoryGuardType: inventoryGuardResult.guardType,
    inventoryGuardReason: inventoryGuardResult.reason,
    shouldSkipRecommendation: inventoryGuardResult.shouldSkipRecommendation,
  };
}

/**
 * 理由詳細を生成
 */
function buildReasonDetail(
  product: ProductConfig,
  metrics: KeywordMetrics,
  action: string,
  targetAcos: number,
  reasonCode: ReasonCode
): string {
  const parts: string[] = [];

  // ライフサイクル情報
  parts.push(`ライフサイクル: ${product.lifecycleState}`);

  // 収益モデル情報
  parts.push(`収益モデル: ${product.revenueModel}`);
  if (product.revenueModel === "LTV") {
    parts.push(`LTVモード: ${product.ltvMode}`);
  }

  // 目標ACOS
  parts.push(`目標ACOS: ${(targetAcos * 100).toFixed(1)}%`);

  // 現在ACOS
  if (metrics.currentAcos !== null) {
    parts.push(`現在ACOS: ${(metrics.currentAcos * 100).toFixed(1)}%`);
    const gap = metrics.currentAcos - targetAcos;
    parts.push(`ギャップ: ${gap > 0 ? "+" : ""}${(gap * 100).toFixed(1)}%`);
  }

  // オーガニック順位
  if (metrics.organicRank !== null) {
    parts.push(`オーガニック順位: ${metrics.organicRank}位 (${metrics.organicRankZone})`);
  }

  // アクション
  parts.push(`アクション: ${action}`);

  return parts.join(" / ");
}

// =============================================================================
// メインエンジン
// =============================================================================

/**
 * 入札エンジンを実行
 *
 * @param config - エンジン設定
 * @returns 実行結果
 */
export async function runBidEngine(config: BidEngineConfig): Promise<BidEngineResult> {
  // 実行モードをログ出力
  logExecutionModeOnStartup();

  const mode = getExecutionMode();

  // イベントモードとガードレールモードを取得
  let eventMode: EventMode = "NONE";
  let guardrailsMode: GuardrailsMode = DEFAULT_GUARDRAILS_MODE;
  try {
    const envConfig = loadEnvConfig();
    eventMode = envConfig.eventMode;
    guardrailsMode = envConfig.guardrailsMode;

    if (eventMode !== "NONE") {
      logger.info(`Event override mode active: ${eventMode}`, {
        policy: getEventBidPolicy(eventMode),
      });
    }

    // ガードレールモードをログ出力
    logger.info(`Guardrails mode: ${guardrailsMode}`, {
      guardrailsMode,
      description: guardrailsMode === "ENFORCE"
        ? "ガードレールを実際に適用"
        : guardrailsMode === "SHADOW"
          ? "ガードレールを計算するがログのみ（デフォルト）"
          : "ガードレール計算をスキップ",
    });
  } catch {
    // 環境変数取得に失敗した場合はデフォルト値を使用
    logger.warn("Failed to load config, using defaults (eventMode=NONE, guardrailsMode=SHADOW)");
  }

  // ExecutionLoggerを作成
  const executionLogger = createExecutionLogger({
    projectId: config.projectId,
    dataset: config.dataset,
    mode,
    triggerSource: config.triggerSource ?? "API",
    triggeredBy: config.triggeredBy,
  });

  const recommendations: BidRecommendation[] = [];

  try {
    // 実行開始を記録
    await executionLogger.start();

    // 1. アクティブな商品設定を取得
    logger.info("Loading active product configs...");
    const productConfigs = await loadAllProductConfigs({
      projectId: config.projectId,
      dataset: config.dataset,
    });

    executionLogger.updateStats({
      totalProductsCount: productConfigs.size,
    });

    if (productConfigs.size === 0) {
      logger.info("No active products found");
      await executionLogger.finish();
      return {
        executionId: executionLogger.getExecutionId(),
        mode,
        status: "SUCCESS",
        stats: {
          totalProducts: 0,
          totalKeywords: 0,
          recommendations: 0,
          applied: 0,
          skipped: 0,
          errors: 0,
        },
        recommendations: [],
      };
    }

    // 2. キーワードメトリクスを取得
    logger.info("Fetching keyword metrics...");
    const asins = Array.from(productConfigs.keys());
    const keywordMetricsMap = await fetchKeywordMetrics(config, asins);

    let totalKeywords = 0;
    for (const keywords of keywordMetricsMap.values()) {
      totalKeywords += keywords.length;
    }
    executionLogger.updateStats({
      totalKeywordsCount: totalKeywords,
    });

    // 3. 自動ガードレールを事前取得（ログ用）
    logger.info("Loading auto guardrails...");
    let autoGuardrailsMap: Map<string, AutoGuardrailsResult> = new Map();
    try {
      autoGuardrailsMap = await loadAutoGuardrailsBulk(
        { projectId: config.projectId, dataset: config.dataset },
        asins
      );
      logger.info("Auto guardrails loaded", {
        count: autoGuardrailsMap.size,
      });
    } catch (error) {
      // ガードレール取得に失敗してもログ用なので処理は続行
      logger.warn("Failed to load auto guardrails, continuing without", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // 4. 在庫スナップショットを事前取得
    logger.info("Loading inventory snapshots...");
    let inventoryMap: Map<string, AsinInventorySnapshot> = new Map();
    try {
      const inventoryRepo = createInventoryRepository({
        projectId: config.projectId,
        dataset: config.dataset,
      });
      // profileIdは product_configテーブルには含まれないため、
      // configから渡す必要がある。現状はASIN単位で取得
      // 複数profileIdがある場合は将来的に拡張が必要
      const profileId = config.projectId; // 仮。実際は実行コンテキストから取得
      inventoryMap = await inventoryRepo.getInventorySnapshots(profileId, asins);
      logger.info("Inventory snapshots loaded", {
        count: inventoryMap.size,
        outOfStockCount: Array.from(inventoryMap.values()).filter(
          (inv) => inv.status === "OUT_OF_STOCK"
        ).length,
        lowStockCount: Array.from(inventoryMap.values()).filter(
          (inv) => inv.status === "LOW_STOCK" || inv.status === "LOW_STOCK_STRICT"
        ).length,
      });
    } catch (error) {
      // 在庫取得に失敗しても処理は続行（在庫ガードはUNKNOWNとして処理）
      logger.warn("Failed to load inventory snapshots, continuing without", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info("Processing keywords", {
      productCount: productConfigs.size,
      keywordCount: totalKeywords,
    });

    // 5. 各商品・キーワードごとに入札推奨を計算
    for (const [asin, product] of productConfigs) {
      const keywords = keywordMetricsMap.get(asin) || [];

      // このASIN × lifecycleState の自動ガードレールを取得
      const autoGuardrailsKey = `${asin}|${product.lifecycleState}`;
      const autoGuardrails = autoGuardrailsMap.get(autoGuardrailsKey) ?? null;

      // このASINの在庫スナップショットを取得
      const inventory = inventoryMap.get(asin) ?? null;

      for (const keyword of keywords) {
        // 推奨を計算（ガードレール情報・在庫情報・イベントオーバーライド・ガードレールモードを含む）
        const recommendation = computeRecommendation(
          product,
          keyword,
          DEFAULT_LIFECYCLE_GLOBAL_CONFIG,
          autoGuardrails,
          inventory,
          eventMode,
          guardrailsMode
        );

        // 在庫ゼロでSKIP_RECOMMENDATIONポリシーの場合はスキップ
        if (recommendation.shouldSkipRecommendation) {
          logger.debug("Skipping recommendation due to out of stock policy", {
            asin: recommendation.asin,
            keywordId: recommendation.keywordId,
            policy: product.outOfStockBidPolicy,
          });
          executionLogger.incrementStats("skippedCount");
          continue;
        }

        recommendations.push(recommendation);

        // ログに記録（is_appliedはfalseで初期化）
        await executionLogger.logRecommendation({
          asin: recommendation.asin,
          keywordId: recommendation.keywordId,
          keywordText: recommendation.keywordText,
          matchType: recommendation.matchType,
          campaignId: recommendation.campaignId,
          adGroupId: recommendation.adGroupId,
          oldBid: recommendation.oldBid,
          newBid: recommendation.newBid,
          bidChange: recommendation.bidChange,
          bidChangePercent: recommendation.bidChangePercent,
          targetAcos: recommendation.targetAcos,
          currentAcos: recommendation.currentAcos ?? undefined,
          acosGap:
            recommendation.currentAcos !== null
              ? recommendation.currentAcos - recommendation.targetAcos
              : undefined,
          reasonCode: recommendation.reasonCode,
          reasonDetail: recommendation.reasonDetail,
          lifecycleState: product.lifecycleState,
          revenueModel: product.revenueModel,
          ltvMode: product.ltvMode,
          businessMode: product.businessMode,
          brandType: product.brandType,
          experimentGroup: product.experimentGroup,
          seoRankCurrent: keyword.organicRank ?? undefined,
          seoRankTrend: keyword.organicRankTrend ?? undefined,
          seoRankZone: keyword.organicRankZone ?? undefined,
          impressions7d: keyword.impressions7d,
          clicks7d: keyword.clicks7d,
          conversions7d: keyword.conversions7d,
          spend7d: keyword.spend7d,
          sales7d: keyword.sales7d,
          ctr7d: keyword.ctr7d ?? undefined,
          cvr7d: keyword.cvr7d ?? undefined,
          // ガードレール情報（ログ用）
          rawNewBid: recommendation.rawNewBid,
          guardedNewBid: recommendation.guardedNewBid,
          wasGuardClamped: recommendation.wasGuardClamped,
          guardClampReason: recommendation.guardClampReason,
          guardrailsMinBid: recommendation.guardrailsMinBid,
          guardrailsMaxBid: recommendation.guardrailsMaxBid,
          guardrailsAutoDataSource: recommendation.guardrailsAutoDataSource,
          guardrailsMode: recommendation.guardrailsMode,
          guardrailsApplied: recommendation.guardrailsApplied,
          // 在庫ガード情報（ログ用）
          daysOfInventory: recommendation.daysOfInventory ?? undefined,
          inventoryRiskStatus: recommendation.inventoryRiskStatus ?? undefined,
          inventoryGuardApplied: recommendation.inventoryGuardApplied,
          inventoryGuardType: recommendation.inventoryGuardType,
          inventoryGuardReason: recommendation.inventoryGuardReason ?? undefined,
          isApplied: false, // 初期値はfalse
        });

        // 6. シャドーモードでなければAPIを呼び出して適用
        if (recommendation.bidChange !== 0) {
          const { wasApplied, error } = await applyBidWithMode(
            async () => {
              // TODO: 実際のAmazon Ads API呼び出しをここに実装
              // await amazonAdsClient.updateKeywordBid({
              //   keywordId: recommendation.keywordId,
              //   newBid: recommendation.newBid,
              // });
              logger.info("Bid applied (placeholder)", {
                keywordId: recommendation.keywordId,
                oldBid: recommendation.oldBid,
                newBid: recommendation.newBid,
              });
            },
            {
              keywordId: recommendation.keywordId,
              keywordText: recommendation.keywordText,
              oldBid: recommendation.oldBid,
              newBid: recommendation.newBid,
            }
          );

          if (wasApplied) {
            executionLogger.incrementStats("appliedCount");
          } else if (error) {
            executionLogger.incrementStats("errorCount");
          } else {
            // SHADOWモードでスキップ
            executionLogger.incrementStats("skippedCount");
          }
        }
      }
    }

    // 5. 完了
    await executionLogger.finish();

    const stats = executionLogger.getStats();
    const executionId = executionLogger.getExecutionId();

    logger.info("Bid engine completed successfully", {
      executionId,
      mode,
      stats,
    });

    // 6. 監視・アラート評価とSlack通知
    // 【注意】
    // この通知は SHADOW モード検証用と APPLY モード本番監視用の両方を兼ねています。
    // APPLY 移行後も基本的に有効のまま運用し、ロジック暴走を早期検出するために使用します。
    // 通知を無効にする前に、BigQuery ダッシュボード等の代替監視手段を必ず整備してください。
    //
    // アラート機能:
    // - ALERT_ENABLED=true で有効（デフォルト: true）
    // - 閾値を超えた場合に警告メッセージを送信
    // - 正常時はサマリーを送信（ALERT_SEND_SUMMARY_ON_SUCCESS で制御）
    const alertConfig = getAlertConfig();
    if (alertConfig.enabled) {
      try {
        await evaluateAndNotify(executionId, config.projectId, config.dataset);
      } catch (alertError) {
        // アラート送信エラーはログ出力のみ、例外は投げ直さない
        logger.warn("アラート評価・通知に失敗しましたが、処理は正常完了しています", {
          executionId,
          error: alertError instanceof Error ? alertError.message : String(alertError),
        });
      }
    } else if (isSlackExecutionSummaryEnabledForMode(mode)) {
      // アラートが無効の場合は従来のサマリー通知を使用
      try {
        await sendExecutionSummaryToSlack({
          executionId,
          maxAsins: 5,
          projectId: config.projectId,
          dataset: config.dataset,
        });
      } catch (slackError) {
        // Slack 送信エラーはログ出力のみ、例外は投げ直さない
        logger.warn("Slack実行サマリー送信に失敗しましたが、処理は正常完了しています", {
          executionId,
          error: slackError instanceof Error ? slackError.message : String(slackError),
        });
      }
    }

    return {
      executionId,
      mode,
      status: "SUCCESS",
      stats: {
        totalProducts: stats.totalProductsCount,
        totalKeywords: stats.totalKeywordsCount,
        recommendations: stats.recommendationsCount,
        applied: stats.appliedCount,
        skipped: stats.skippedCount,
        errors: stats.errorCount,
      },
      recommendations,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    logger.error("Bid engine failed", {
      executionId: executionLogger.getExecutionId(),
      error: err.message,
    });

    await executionLogger.finishWithError(err);

    const stats = executionLogger.getStats();

    return {
      executionId: executionLogger.getExecutionId(),
      mode,
      status: "ERROR",
      stats: {
        totalProducts: stats.totalProductsCount,
        totalKeywords: stats.totalKeywordsCount,
        recommendations: stats.recommendationsCount,
        applied: stats.appliedCount,
        skipped: stats.skippedCount,
        errors: stats.errorCount,
      },
      recommendations,
      error: err,
    };
  }
}

// =============================================================================
// エクスポート
// =============================================================================

export { getExecutionMode, isShadowMode, logExecutionModeOnStartup };

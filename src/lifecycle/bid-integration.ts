/**
 * ライフサイクル × Bidエンジン統合
 *
 * 商品ライフサイクルステージとキーワード役割に基づいて
 * 動的なACOSターゲットと入札戦略を計算
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  LifecycleStage,
  KeywordRole,
  ProductStrategy,
  SeoScore,
  LifecycleConfig,
  DEFAULT_LIFECYCLE_CONFIG,
} from "./types";
import { EventMode, EventBidPolicy, getEventBidPolicy } from "../event";
import { LifecycleState } from "../config/productConfigTypes";
import { SalePhase } from "../tacos-acos/types";
import {
  KeywordRole as GuardrailKeywordRole,
  PresaleType,
  LossBudgetState,
  GuardrailContext,
  RoleLifecycleGuardrails,
  getRoleLifecycleGuardrails,
  computeOverspendRatio,
  meetsActionThreshold,
  fallbackAction,
  clipDownRatio,
} from "../engine/roleGuardrails";

// =============================================================================
// 型定義
// =============================================================================

/**
 * ライフサイクル拡張GlobalConfig
 */
export interface LifecycleGlobalConfig {
  // 基本設定（既存）
  default_acos_target: number;
  min_bid: number;
  max_bid_increase_rate: number;
  max_bid_decrease_rate: number;

  // ライフサイクル拡張
  lifecycle_enabled: boolean;
  lifecycle_config: LifecycleConfig;

  // ライフサイクルステージ別ACOS乗数
  stage_acos_multipliers: Record<LifecycleStage, number>;

  // キーワード役割別ACOS乗数
  role_acos_multipliers: Record<KeywordRole, number>;

  // 投資モード設定
  invest_mode: {
    max_loss_per_keyword_daily: number;
    max_total_loss_daily: number;
  };

  // イベントオーバーライド設定
  event_mode: EventMode;
}

/**
 * デフォルトのライフサイクル拡張設定
 */
export const DEFAULT_LIFECYCLE_GLOBAL_CONFIG: LifecycleGlobalConfig = {
  default_acos_target: 0.20,
  min_bid: 2,
  max_bid_increase_rate: 1.5,
  max_bid_decrease_rate: -0.8,

  lifecycle_enabled: true,
  lifecycle_config: DEFAULT_LIFECYCLE_CONFIG,

  // ライフサイクルステージ別ACOS乗数
  // LAUNCH_HARD: 積極投資で赤字許容
  // LAUNCH_SOFT: やや赤字許容
  // GROW: バランス
  // HARVEST: 効率重視
  stage_acos_multipliers: {
    LAUNCH_HARD: 2.5,  // 基準ACOSの2.5倍まで許容
    LAUNCH_SOFT: 1.8,  // 基準ACOSの1.8倍まで許容
    GROW: 1.2,         // 基準ACOSの1.2倍まで許容
    HARVEST: 0.7,      // 基準ACOSの0.7倍以下を目標
  },

  // キーワード役割別ACOS乗数
  // brand: ブランドKWは効率重視
  // core: コアKWは投資優先
  // support: サポートKWはバランス
  // longtail_experiment: 実験KWは慎重に
  role_acos_multipliers: {
    brand: 0.8,            // ブランドは効率重視
    core: 1.3,             // コアKWは投資優先
    support: 1.0,          // サポートは基準通り
    longtail_experiment: 0.9,  // ロングテールは慎重に
    other: 0.7,            // その他は効率重視
  },

  invest_mode: {
    max_loss_per_keyword_daily: 5000,   // キーワード別1日最大赤字5,000円
    max_total_loss_daily: 50000,        // ASIN全体1日最大赤字50,000円
  },

  // イベントオーバーライド
  event_mode: "NONE",
};

/**
 * キーワードメトリクス（ライフサイクル拡張）
 */
export interface LifecycleKeywordMetrics {
  // 識別子
  product_id: string;
  keyword: string;
  keyword_id: string;
  campaign_id: string;
  ad_group_id: string;

  // 商品ライフサイクル情報
  lifecycle_stage: LifecycleStage;
  sustainable_tacos: number;
  invest_tacos_cap: number | null;
  profit_margin: number;
  invest_mode_enabled: boolean;

  // キーワード役割
  keyword_role: KeywordRole;

  // パフォーマンス指標
  current_acos: number | null;
  current_cvr: number | null;
  current_ctr: number | null;
  current_bid: number;
  clicks_60d: number;
  impressions_60d: number;
  orders_60d: number;
  ad_spend_60d: number;
  ad_sales_60d: number;

  // SEO情報
  organic_rank: number | null;
  search_volume: number | null;

  // 動的ACOS計算結果
  target_acos: number;
  acos_calculation_details: {
    base_acos: number;
    stage_multiplier: number;
    role_multiplier: number;
    profit_cap: number;
    final_acos: number;
    invest_mode_active: boolean;
  };
}

/**
 * 入札推奨結果
 */
export interface BidRecommendation {
  keyword_id: string;
  product_id: string;
  keyword: string;

  // 現在値
  current_bid: number;
  current_acos: number | null;

  // 推奨値
  target_acos: number;
  recommended_bid: number;
  bid_change_rate: number;

  // アクション
  action: "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP";

  // コンテキスト
  lifecycle_stage: LifecycleStage;
  keyword_role: KeywordRole;
  invest_mode_enabled: boolean;

  // 理由
  reason: string;
  constraints: string[];
}

// =============================================================================
// ACOS計算ロジック
// =============================================================================

/**
 * 動的ACOSターゲットを計算
 *
 * 計算式:
 * target_acos = min(
 *   base_acos × stage_multiplier × role_multiplier,
 *   profit_margin × 0.9  // 利益率の90%を上限
 * )
 *
 * 投資モード時:
 * target_acos = invest_tacos_cap (例: 0.60)
 */
export function calculateTargetAcos(
  baseAcos: number,
  lifecycleStage: LifecycleStage,
  keywordRole: KeywordRole,
  profitMargin: number,
  investTacosCap: number | null,
  config: LifecycleGlobalConfig = DEFAULT_LIFECYCLE_GLOBAL_CONFIG
): {
  targetAcos: number;
  details: {
    base_acos: number;
    stage_multiplier: number;
    role_multiplier: number;
    profit_cap: number;
    final_acos: number;
    invest_mode_active: boolean;
  };
} {
  const stageMultiplier = config.stage_acos_multipliers[lifecycleStage];
  const roleMultiplier = config.role_acos_multipliers[keywordRole];

  // 利益率ベースの上限（利益率の90%）
  const profitCap = profitMargin * 0.9;

  // 投資モード判定（LAUNCH_HARD/LAUNCH_SOFT）
  const isInvestMode =
    lifecycleStage === "LAUNCH_HARD" || lifecycleStage === "LAUNCH_SOFT";

  let finalAcos: number;

  if (isInvestMode && investTacosCap !== null) {
    // 投資モード: invest_tacos_capを使用
    finalAcos = investTacosCap;
  } else {
    // 通常モード: 計算式を適用
    const calculatedAcos = baseAcos * stageMultiplier * roleMultiplier;
    finalAcos = Math.min(calculatedAcos, profitCap);
  }

  // 最低ACOS（5%）を保証
  finalAcos = Math.max(finalAcos, 0.05);

  return {
    targetAcos: finalAcos,
    details: {
      base_acos: baseAcos,
      stage_multiplier: stageMultiplier,
      role_multiplier: roleMultiplier,
      profit_cap: profitCap,
      final_acos: finalAcos,
      invest_mode_active: isInvestMode,
    },
  };
}

/**
 * 入札アクションを決定
 */
export function determineBidAction(
  currentAcos: number | null,
  targetAcos: number,
  clicks: number,
  investModeEnabled: boolean
): "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP" {
  // データ不足の場合
  if (currentAcos === null || clicks < 10) {
    // 投資モードなら積極的に
    if (investModeEnabled) {
      return "MILD_UP";
    }
    return "KEEP";
  }

  const acosRatio = currentAcos / targetAcos;

  // 投資モードの場合
  if (investModeEnabled) {
    if (acosRatio < 0.7) {
      return "STRONG_UP"; // ACOSに余裕があれば積極増額
    }
    if (acosRatio < 0.9) {
      return "MILD_UP";
    }
    if (acosRatio < 1.1) {
      return "KEEP";
    }
    if (acosRatio < 1.3) {
      return "MILD_DOWN"; // 投資モードでも上限超過は減額
    }
    return "STRONG_DOWN";
  }

  // 通常モード
  if (acosRatio < 0.5) {
    return "STRONG_UP";
  }
  if (acosRatio < 0.8) {
    return "MILD_UP";
  }
  if (acosRatio < 1.2) {
    return "KEEP";
  }
  if (acosRatio < 1.5) {
    return "MILD_DOWN";
  }
  if (acosRatio < 2.0) {
    return "STRONG_DOWN";
  }
  return "STOP";
}

/**
 * 推奨入札額を計算
 */
export function calculateRecommendedBid(
  currentBid: number,
  action: "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP",
  config: LifecycleGlobalConfig = DEFAULT_LIFECYCLE_GLOBAL_CONFIG
): {
  recommendedBid: number;
  changeRate: number;
} {
  const actionRates: Record<string, number> = {
    STRONG_UP: 0.30,
    MILD_UP: 0.15,
    KEEP: 0,
    MILD_DOWN: -0.15,
    STRONG_DOWN: -0.30,
    STOP: -0.80,
  };

  let changeRate = actionRates[action] || 0;

  // 制限を適用
  changeRate = Math.max(changeRate, config.max_bid_decrease_rate);
  changeRate = Math.min(changeRate, config.max_bid_increase_rate);

  const recommendedBid = Math.max(
    currentBid * (1 + changeRate),
    config.min_bid
  );

  return {
    recommendedBid: Math.round(recommendedBid),
    changeRate,
  };
}

// =============================================================================
// ガードレール対応版のアクション決定
// =============================================================================

/**
 * ガードレール対応版の入力パラメータ
 */
export interface DetermineBidActionWithGuardrailsInput {
  /** 現在のACOS（null=データなし） */
  currentAcos: number | null;
  /** 目標ACOS */
  targetAcos: number;
  /** 加重クリック数（例: 7日間） */
  clicksW: number;
  /** 投資モードが有効か */
  investModeEnabled: boolean;
  /** キーワードロール */
  keywordRole: GuardrailKeywordRole;
  /** ライフサイクルステージ */
  lifecycleStage: LifecycleState;
  /** セールフェーズ */
  salePhase: SalePhase;
  /** プレセールタイプ */
  presaleType: PresaleType;
  /** lossBudget状態 */
  lossBudgetState: LossBudgetState;
}

/**
 * ガードレール対応版のアクション決定結果
 */
export interface DetermineBidActionWithGuardrailsResult {
  /** 最終アクション（ガードレール適用後） */
  action: "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP";
  /** 元のアクション（ガードレール適用前） */
  originalAction: "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP";
  /** ガードレールによってアクションが変更されたか */
  wasModifiedByGuardrails: boolean;
  /** 適用されたガードレール */
  guardrails: RoleLifecycleGuardrails;
  /** overspendRatio */
  overspendRatio: number;
  /** DOWNアクションがガードレールの閾値を満たしたか */
  meetsDownThreshold: boolean;
  /** STRONG_DOWNアクションがガードレールの閾値を満たしたか */
  meetsStrongDownThreshold: boolean;
  /** STOPアクションがガードレールの閾値を満たしたか */
  meetsStopThreshold: boolean;
  /** 変更理由 */
  modificationReason: string | null;
}

/**
 * ガードレール対応版の入札アクション決定
 *
 * role, lifecycleStage, salePhase, presaleType, lossBudgetStateを考慮して
 * DOWN/STRONG_DOWN/STOPの許可・禁止と閾値を制御する。
 *
 * @param input - 入力パラメータ
 * @returns アクション決定結果
 *
 * @example
 * ```typescript
 * const result = determineBidActionWithGuardrails({
 *   currentAcos: 0.35,
 *   targetAcos: 0.25,
 *   clicksW: 50,
 *   investModeEnabled: false,
 *   keywordRole: "CORE",
 *   lifecycleStage: "LAUNCH_HARD",
 *   salePhase: "NORMAL",
 *   presaleType: "NONE",
 *   lossBudgetState: "SAFE",
 * });
 *
 * // CORE×LAUNCH_HARD ではSTOPが禁止されるため、
 * // 元がSTOPでもMILD_DOWNにフォールバック
 * ```
 */
export function determineBidActionWithGuardrails(
  input: DetermineBidActionWithGuardrailsInput
): DetermineBidActionWithGuardrailsResult {
  const {
    currentAcos,
    targetAcos,
    clicksW,
    investModeEnabled,
    keywordRole,
    lifecycleStage,
    salePhase,
    presaleType,
    lossBudgetState,
  } = input;

  // 1. ガードレールを取得
  const guardrailContext: GuardrailContext = {
    role: keywordRole,
    lifecycleStage,
    salePhase,
    presaleType,
    lossBudgetState,
  };
  const guardrails = getRoleLifecycleGuardrails(guardrailContext);

  // 2. overspendRatioを計算
  const overspendRatio = computeOverspendRatio(currentAcos, targetAcos);

  // 3. 各アクションの閾値条件をチェック
  const meetsDownThreshold = meetsActionThreshold("DOWN", clicksW, overspendRatio, guardrails);
  const meetsStrongDownThreshold = meetsActionThreshold("STRONG_DOWN", clicksW, overspendRatio, guardrails);
  const meetsStopThreshold = meetsActionThreshold("STOP", clicksW, overspendRatio, guardrails);

  // 4. 元のアクションを決定（従来ロジック）
  const originalAction = determineBidAction(
    currentAcos,
    targetAcos,
    clicksW,
    investModeEnabled
  );

  // 5. ガードレールによる制限を適用
  let finalAction = originalAction;
  let wasModifiedByGuardrails = false;
  let modificationReason: string | null = null;

  // DOWN系アクションの場合、閾値条件をチェック
  if (originalAction === "MILD_DOWN" || originalAction === "STRONG_DOWN" || originalAction === "STOP") {
    // STOPの場合
    if (originalAction === "STOP") {
      if (!guardrails.allowStop) {
        // STOPが禁止されている → フォールバック
        finalAction = fallbackAction(originalAction, guardrails, keywordRole);
        wasModifiedByGuardrails = true;
        modificationReason = `STOP禁止 (${guardrails.reason})`;
      } else if (!meetsStopThreshold) {
        // STOPの閾値を満たさない → STRONG_DOWNかMILD_DOWNにフォールバック
        if (guardrails.allowStrongDown && meetsStrongDownThreshold) {
          finalAction = "STRONG_DOWN";
        } else if (meetsDownThreshold) {
          finalAction = "MILD_DOWN";
        } else {
          finalAction = "KEEP";
        }
        wasModifiedByGuardrails = true;
        modificationReason = `STOP閾値未達 (clicks=${clicksW}, overspend=${overspendRatio.toFixed(2)})`;
      }
    }
    // STRONG_DOWNの場合
    else if (originalAction === "STRONG_DOWN") {
      if (!guardrails.allowStrongDown) {
        // STRONG_DOWNが禁止されている → MILD_DOWNにフォールバック
        finalAction = "MILD_DOWN";
        wasModifiedByGuardrails = true;
        modificationReason = `STRONG_DOWN禁止 (${guardrails.reason})`;
      } else if (!meetsStrongDownThreshold) {
        // STRONG_DOWNの閾値を満たさない → MILD_DOWNかKEEPにフォールバック
        if (meetsDownThreshold) {
          finalAction = "MILD_DOWN";
        } else {
          finalAction = "KEEP";
        }
        wasModifiedByGuardrails = true;
        modificationReason = `STRONG_DOWN閾値未達 (clicks=${clicksW}, overspend=${overspendRatio.toFixed(2)})`;
      }
    }
    // MILD_DOWNの場合
    else if (originalAction === "MILD_DOWN") {
      if (!meetsDownThreshold) {
        // DOWN閾値を満たさない → KEEPにフォールバック
        finalAction = "KEEP";
        wasModifiedByGuardrails = true;
        modificationReason = `DOWN閾値未達 (clicks=${clicksW}, overspend=${overspendRatio.toFixed(2)})`;
      }
    }
  }

  return {
    action: finalAction,
    originalAction,
    wasModifiedByGuardrails,
    guardrails,
    overspendRatio,
    meetsDownThreshold,
    meetsStrongDownThreshold,
    meetsStopThreshold,
    modificationReason,
  };
}

/**
 * ガードレール対応版の推奨入札額計算
 *
 * ガードレールのmaxDownStepRatioを考慮してDOWN幅を制限する。
 *
 * @param currentBid - 現在の入札額
 * @param action - アクション
 * @param guardrails - 適用するガードレール
 * @param config - ライフサイクル設定
 * @returns 推奨入札額と変動率
 */
export function calculateRecommendedBidWithGuardrails(
  currentBid: number,
  action: "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP",
  guardrails: RoleLifecycleGuardrails,
  config: LifecycleGlobalConfig = DEFAULT_LIFECYCLE_GLOBAL_CONFIG
): {
  recommendedBid: number;
  changeRate: number;
  wasClippedByGuardrails: boolean;
} {
  const actionRates: Record<string, number> = {
    STRONG_UP: 0.30,
    MILD_UP: 0.15,
    KEEP: 0,
    MILD_DOWN: -0.15,
    STRONG_DOWN: -0.30,
    STOP: -0.80,
  };

  let changeRate = actionRates[action] || 0;
  let wasClippedByGuardrails = false;

  // DOWN系アクションの場合、ガードレールのmaxDownStepRatioを適用
  if (changeRate < 0) {
    const requestedDownRatio = Math.abs(changeRate);
    const clippedDownRatio = clipDownRatio(requestedDownRatio, guardrails);

    if (clippedDownRatio < requestedDownRatio) {
      wasClippedByGuardrails = true;
      changeRate = -clippedDownRatio;
    }
  }

  // 既存の制限も適用
  changeRate = Math.max(changeRate, config.max_bid_decrease_rate);
  changeRate = Math.min(changeRate, config.max_bid_increase_rate);

  const recommendedBid = Math.max(
    currentBid * (1 + changeRate),
    config.min_bid
  );

  return {
    recommendedBid: Math.round(recommendedBid),
    changeRate,
    wasClippedByGuardrails,
  };
}

// =============================================================================
// BigQueryからデータ取得
// =============================================================================

interface IntegrationConfig {
  projectId: string;
  dataset: string;
}

/**
 * ライフサイクル拡張キーワードメトリクスを取得
 */
export async function fetchLifecycleKeywordMetrics(
  config: IntegrationConfig,
  productIds?: string[]
): Promise<LifecycleKeywordMetrics[]> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  let whereClause = "1=1";
  const params: Record<string, unknown> = {};

  if (productIds && productIds.length > 0) {
    whereClause = "ps.product_id IN UNNEST(@productIds)";
    params.productIds = productIds;
  }

  const query = `
    WITH latest_metrics AS (
      SELECT
        km.*
      FROM \`${config.projectId}.${config.dataset}.keyword_metrics_60d\` km
      WHERE km.period_end = (
        SELECT MAX(period_end) FROM \`${config.projectId}.${config.dataset}.keyword_metrics_60d\`
      )
    ),
    seo_keywords AS (
      SELECT
        product_id,
        keyword,
        role,
        organic_rank
      FROM \`${config.projectId}.${config.dataset}.seo_keywords_by_product\`
      WHERE selected_flag = TRUE
    )
    SELECT
      ps.product_id,
      km.keyword,
      COALESCE(sk.role, km.category, 'other') AS keyword_role,
      ps.lifecycle_stage,
      ps.sustainable_tacos,
      ps.invest_tacos_cap,
      ps.profit_margin,
      ps.lifecycle_stage IN ('LAUNCH_HARD', 'LAUNCH_SOFT') AS invest_mode_enabled,
      km.acos_60d AS current_acos,
      km.cvr_60d AS current_cvr,
      km.ctr_60d AS current_ctr,
      km.impressions_60d,
      km.clicks_60d,
      km.orders_60d,
      km.ad_spend_60d,
      km.ad_sales_60d,
      sk.organic_rank,
      km.search_volume
    FROM \`${config.projectId}.${config.dataset}.product_strategy\` ps
    JOIN latest_metrics km ON ps.product_id = km.product_id
    LEFT JOIN seo_keywords sk ON km.product_id = sk.product_id AND km.keyword = sk.keyword
    WHERE ${whereClause}
  `;

  const [results] = await bigquery.query({
    query,
    params,
    location: "asia-northeast1",
  });

  return results.map((row: Record<string, unknown>) => {
    const lifecycleStage = row.lifecycle_stage as LifecycleStage;
    const keywordRole = row.keyword_role as KeywordRole;
    const sustainableTacos = (row.sustainable_tacos as number) || 0.20;
    const investTacosCap = row.invest_tacos_cap as number | null;
    const profitMargin = (row.profit_margin as number) || 0.30;

    // 動的ACOS計算
    const acosResult = calculateTargetAcos(
      sustainableTacos,
      lifecycleStage,
      keywordRole,
      profitMargin,
      investTacosCap
    );

    return {
      product_id: row.product_id as string,
      keyword: row.keyword as string,
      keyword_id: "", // 別途取得が必要
      campaign_id: "",
      ad_group_id: "",
      lifecycle_stage: lifecycleStage,
      sustainable_tacos: sustainableTacos,
      invest_tacos_cap: investTacosCap,
      profit_margin: profitMargin,
      invest_mode_enabled: row.invest_mode_enabled as boolean,
      keyword_role: keywordRole,
      current_acos: row.current_acos as number | null,
      current_cvr: row.current_cvr as number | null,
      current_ctr: row.current_ctr as number | null,
      current_bid: 0, // 別途取得が必要
      clicks_60d: (row.clicks_60d as number) || 0,
      impressions_60d: (row.impressions_60d as number) || 0,
      orders_60d: (row.orders_60d as number) || 0,
      ad_spend_60d: (row.ad_spend_60d as number) || 0,
      ad_sales_60d: (row.ad_sales_60d as number) || 0,
      organic_rank: row.organic_rank as number | null,
      search_volume: row.search_volume as number | null,
      target_acos: acosResult.targetAcos,
      acos_calculation_details: acosResult.details,
    } as LifecycleKeywordMetrics;
  });
}

/**
 * 入札推奨を生成
 */
export function generateBidRecommendations(
  metrics: LifecycleKeywordMetrics[],
  config: LifecycleGlobalConfig = DEFAULT_LIFECYCLE_GLOBAL_CONFIG
): BidRecommendation[] {
  return metrics.map((m) => {
    const action = determineBidAction(
      m.current_acos,
      m.target_acos,
      m.clicks_60d,
      m.invest_mode_enabled
    );

    const { recommendedBid, changeRate } = calculateRecommendedBid(
      m.current_bid || 100, // デフォルト100円
      action,
      config
    );

    const constraints: string[] = [];

    if (m.invest_mode_enabled) {
      constraints.push("投資モード有効");
    }
    if (m.current_acos && m.current_acos > m.target_acos) {
      constraints.push(`ACOS超過 (${(m.current_acos * 100).toFixed(1)}% > ${(m.target_acos * 100).toFixed(1)}%)`);
    }
    if (m.clicks_60d < 30) {
      constraints.push("データ不足（クリック数30未満）");
    }

    const reason = buildRecommendationReason(m, action);

    return {
      keyword_id: m.keyword_id,
      product_id: m.product_id,
      keyword: m.keyword,
      current_bid: m.current_bid,
      current_acos: m.current_acos,
      target_acos: m.target_acos,
      recommended_bid: recommendedBid,
      bid_change_rate: changeRate,
      action,
      lifecycle_stage: m.lifecycle_stage,
      keyword_role: m.keyword_role,
      invest_mode_enabled: m.invest_mode_enabled,
      reason,
      constraints,
    };
  });
}

/**
 * 推奨理由を生成
 */
function buildRecommendationReason(
  metrics: LifecycleKeywordMetrics,
  action: string
): string {
  const parts: string[] = [];

  // ライフサイクルステージ
  const stageDescriptions: Record<LifecycleStage, string> = {
    LAUNCH_HARD: "投資強化フェーズ（赤字許容）",
    LAUNCH_SOFT: "投資継続フェーズ",
    GROW: "成長バランスフェーズ",
    HARVEST: "利益回収フェーズ",
  };
  parts.push(stageDescriptions[metrics.lifecycle_stage]);

  // キーワード役割
  const roleDescriptions: Record<KeywordRole, string> = {
    brand: "ブランドKW",
    core: "コアKW",
    support: "サポートKW",
    longtail_experiment: "ロングテール",
    other: "その他KW",
  };
  parts.push(roleDescriptions[metrics.keyword_role]);

  // ACOS状況
  if (metrics.current_acos !== null) {
    const acosStatus =
      metrics.current_acos < metrics.target_acos
        ? "ACOS良好"
        : "ACOS超過";
    parts.push(acosStatus);
  }

  return `${parts.join(" / ")} → ${action}`;
}

/**
 * 投資モード商品のサマリーを取得
 */
export async function getInvestModeProductsSummary(
  config: IntegrationConfig
): Promise<
  Array<{
    product_id: string;
    lifecycle_stage: LifecycleStage;
    invest_mode_enabled: boolean;
    keyword_count: number;
    total_ad_spend_60d: number;
    avg_target_acos: number;
    actions_breakdown: Record<string, number>;
  }>
> {
  const metrics = await fetchLifecycleKeywordMetrics(config);
  const recommendations = generateBidRecommendations(metrics);

  // 商品別に集計
  const productMap = new Map<
    string,
    {
      product_id: string;
      lifecycle_stage: LifecycleStage;
      invest_mode_enabled: boolean;
      keywords: LifecycleKeywordMetrics[];
      recommendations: BidRecommendation[];
    }
  >();

  for (const m of metrics) {
    if (!productMap.has(m.product_id)) {
      productMap.set(m.product_id, {
        product_id: m.product_id,
        lifecycle_stage: m.lifecycle_stage,
        invest_mode_enabled: m.invest_mode_enabled,
        keywords: [],
        recommendations: [],
      });
    }
    productMap.get(m.product_id)!.keywords.push(m);
  }

  for (const r of recommendations) {
    if (productMap.has(r.product_id)) {
      productMap.get(r.product_id)!.recommendations.push(r);
    }
  }

  return Array.from(productMap.values()).map((p) => {
    const actionsBreakdown: Record<string, number> = {
      STRONG_UP: 0,
      MILD_UP: 0,
      KEEP: 0,
      MILD_DOWN: 0,
      STRONG_DOWN: 0,
      STOP: 0,
    };

    for (const r of p.recommendations) {
      actionsBreakdown[r.action]++;
    }

    return {
      product_id: p.product_id,
      lifecycle_stage: p.lifecycle_stage,
      invest_mode_enabled: p.invest_mode_enabled,
      keyword_count: p.keywords.length,
      total_ad_spend_60d: p.keywords.reduce((sum, k) => sum + k.ad_spend_60d, 0),
      avg_target_acos:
        p.keywords.reduce((sum, k) => sum + k.target_acos, 0) / p.keywords.length,
      actions_breakdown: actionsBreakdown,
    };
  });
}

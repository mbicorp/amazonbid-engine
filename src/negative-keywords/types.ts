/**
 * ネガティブキーワード候補検出 - 型定義
 *
 * 統計的に安全な方法でネガティブキーワード候補をサジェストするための型定義
 * SHADOWモード専用で、自動でのネガティブ登録は行いません
 */

import { ExecutionMode } from "../logging/types";

// =============================================================================
// 検索クエリの役割
// =============================================================================

/**
 * 検索クエリの役割タイプ
 */
export type QueryRole = "GENERIC" | "BRAND_OWN" | "BRAND_CONQUEST" | "OTHER";

/**
 * マッチタイプ
 */
export type NegativeMatchType = "AUTO" | "PHRASE" | "EXACT";

// =============================================================================
// 理由コード
// =============================================================================

/**
 * ネガティブキーワード候補の理由コード
 */
export type NegativeReasonCode =
  | "NG_NO_CONVERSION"           // CVR=0 かつクリック数がしきい値超え
  | "NG_WASTED_SPEND"            // CPCが全体より高く、コストがかさみ過ぎ
  | "NG_CLUSTER_NO_CONVERSION"   // クラスタ単位でCVR=0
  | "NG_INTENT_MISMATCH";        // 検索意図が商品と不一致

/**
 * ネガティブキーワード候補のステータス
 */
export type NegativeSuggestionStatus =
  | "PENDING"    // 未処理（レビュー待ち）
  | "APPROVED"   // 承認済（適用待ち）
  | "REJECTED"   // 却下
  | "APPLIED";   // Amazon Ads API に適用済

// =============================================================================
// ネガティブキーワード候補
// =============================================================================

/**
 * ネガティブキーワード候補
 */
export interface NegativeKeywordCandidate {
  /** ASIN */
  asin: string;

  /** 検索クエリ */
  query: string;

  /** マッチタイプ */
  matchType: NegativeMatchType;

  /** 検索意図クラスタID（NULL許容） */
  intentClusterId: string | null;

  /** クエリの役割 */
  role: QueryRole;

  /** 30日間のクリック数 */
  clicks30d: number;

  /** 30日間のコンバージョン数 */
  conversions30d: number;

  /** 30日間の広告費 */
  cost30d: number;

  /** 30日間の平均CPC */
  cpc30d: number;

  /** 30日間のCVR */
  cvr30d: number | null;

  /** 30日間のACOS */
  acos30d: number | null;

  /** クラスタ単位の30日間クリック数（オプション） */
  clusterClicks30d?: number;

  /** クラスタ単位の30日間コンバージョン数（オプション） */
  clusterConversions30d?: number;

  /** クラスタ単位の30日間広告費（オプション） */
  clusterCost30d?: number;

  /** クラスタ単位の30日間CVR（オプション） */
  clusterCvr30d?: number;

  /** ASIN全体のベースラインCVR */
  baselineAsinCvr30d: number;

  /** 理由コードの配列 */
  reasonCodes: NegativeReasonCode[];

  /** 詳細説明（オプション） */
  reasonDetail?: string;

  /** ルールオブスリーによる必要クリック数 */
  requiredClicks?: number;

  /** role別の最小クリック数閾値 */
  minClicksByRole?: number;
}

// =============================================================================
// 設定
// =============================================================================

/**
 * ネガティブ候補サジェスト設定
 */
export interface NegativeSuggestConfig {
  /** GENERIC クエリの最小クリック数閾値 */
  minClicksGeneric: number;

  /** BRAND_OWN クエリの最小クリック数閾値 */
  minClicksBrandOwn: number;

  /** BRAND_CONQUEST クエリの最小クリック数閾値 */
  minClicksBrandConquest: number;

  /** クラスタ単位の最小クリック数閾値 */
  minClusterClicks: number;

  /**
   * リスク許容度（0-1）
   * 低い値 = より保守的（多くのクリックが必要）
   * 高い値 = より積極的（少ないクリックで判定）
   */
  riskTolerance: number;

  /** 最小コスト閾値（この金額以上の無駄遣いがある場合に候補とする） */
  minWastedCost?: number;

  /** CPC比率閾値（ASIN平均CPCの何倍以上でNG_WASTED_SPENDとするか） */
  cpcRatioThreshold?: number;

  /** 最小ベースラインCVR（データ不足時の下限） */
  minimumBaselineCvr?: number;
}

/**
 * デフォルトのネガティブ候補サジェスト設定
 */
export const DEFAULT_NEGATIVE_SUGGEST_CONFIG: NegativeSuggestConfig = {
  minClicksGeneric: 30,
  minClicksBrandOwn: 50,
  minClicksBrandConquest: 40,
  minClusterClicks: 50,
  riskTolerance: 0.5,
  minWastedCost: 1000,      // 1000円以上
  cpcRatioThreshold: 1.5,   // 平均CPCの1.5倍以上
  minimumBaselineCvr: 0.01, // 最小1%
};

// =============================================================================
// BigQuery行形式
// =============================================================================

/**
 * search_term_stats_30d ビューの行
 */
export interface SearchTermStats30dRow {
  asin: string;
  query: string;
  match_type: string;
  intent_cluster_id: string | null;
  impressions_30d: number;
  clicks_30d: number;
  cost_30d: number;
  conversions_30d: number;
  revenue_30d: number;
  cpc_30d: number | null;
  cvr_30d: number | null;
  acos_30d: number | null;
}

/**
 * intent_cluster_stats_30d ビューの行
 */
export interface IntentClusterStats30dRow {
  asin: string;
  intent_cluster_id: string;
  cluster_impressions_30d: number;
  cluster_clicks_30d: number;
  cluster_cost_30d: number;
  cluster_conversions_30d: number;
  cluster_revenue_30d: number;
  cluster_cpc_30d: number | null;
  cluster_cvr_30d: number | null;
  cluster_acos_30d: number | null;
  queries_in_cluster: number;
}

/**
 * negative_keyword_suggestions テーブルの行
 */
export interface NegativeKeywordSuggestionRow {
  suggestion_id: string;
  execution_id: string;
  execution_mode: string;
  asin: string;
  query: string;
  match_type: string;
  intent_cluster_id: string | null;
  role: string;
  clicks_30d: number;
  conversions_30d: number;
  cost_30d: number;
  cpc_30d: number | null;
  cvr_30d: number | null;
  acos_30d: number | null;
  cluster_clicks_30d: number | null;
  cluster_conversions_30d: number | null;
  cluster_cost_30d: number | null;
  cluster_cvr_30d: number | null;
  baseline_asin_cvr_30d: number;
  required_clicks: number;
  min_clicks_by_role: number;
  reason_codes: string[];
  reason_detail: string | null;
  // 承認フロー情報
  status: string;              // "PENDING", "APPROVED", "REJECTED", "APPLIED"
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  // 適用状態
  is_applied: boolean;
  applied_at: string | null;
  apply_error: string | null;
  lifecycle_state: string | null;
  suggested_at: string;
  created_at: string;
}

// =============================================================================
// 計算結果
// =============================================================================

/**
 * ネガティブキーワード候補計算の結果
 */
export interface NegativeKeywordCandidatesResult {
  /** ASIN */
  asin: string;

  /** 実行モード */
  mode: ExecutionMode;

  /** 候補リスト */
  candidates: NegativeKeywordCandidate[];

  /** ベースラインCVR */
  baselineAsinCvr30d: number;

  /** ルールオブスリーによる必要クリック数 */
  requiredClicks: number;

  /** 処理した検索クエリ数 */
  totalQueriesProcessed: number;

  /** 候補クラスタ数 */
  candidateClustersCount: number;

  /** 統計情報 */
  stats: {
    totalClicks30d: number;
    totalConversions30d: number;
    totalCost30d: number;
  };
}

// =============================================================================
// ローンチフェーズ判定
// =============================================================================

/**
 * ネガティブ候補を生成すべきでないライフサイクルステート
 *
 * ローンチ期はデータが不十分なため、ネガティブ候補の生成を抑制
 */
export const EXCLUDED_LIFECYCLE_STATES = [
  "LAUNCH_HARD",
  "LAUNCH_SOFT",
] as const;

/**
 * ライフサイクルステートがネガティブ候補生成から除外されるべきかを判定
 */
export function isExcludedLifecycleState(state: string | null | undefined): boolean {
  if (!state) return false;
  return EXCLUDED_LIFECYCLE_STATES.includes(state as typeof EXCLUDED_LIFECYCLE_STATES[number]);
}

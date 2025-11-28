/**
 * AUTO→EXACT 昇格エンジン - 型定義
 *
 * AUTO キャンペーンから EXACT キーワードへの昇格候補をサジェストするための型定義
 * SHADOWモード専用で、Amazon Ads API への自動登録は行いません
 */

import { ExecutionMode } from "../logging/types";

// =============================================================================
// ライフサイクルステート（再エクスポート）
// =============================================================================

// LifecycleState は config/productConfigTypes.ts からインポート
import type { LifecycleState as _LifecycleState } from "../config/productConfigTypes";

// 型を再エクスポート
export type LifecycleState = _LifecycleState;

// =============================================================================
// 昇格候補のステータス
// =============================================================================

/**
 * 昇格候補のステータス
 */
export type PromotionSuggestionStatus =
  | "PENDING"    // 未処理（レビュー待ち）
  | "APPROVED"   // 承認済（適用待ち）
  | "REJECTED"   // 却下
  | "APPLIED";   // Amazon Ads API に適用済

// =============================================================================
// 昇格判定理由コード
// =============================================================================

/**
 * 昇格判定理由コード
 */
export type PromotionReasonCode =
  | "HIGH_CVR"              // CVR が基準を上回る
  | "LOW_ACOS"              // ACOS が目標以下
  | "HIGH_VOLUME"           // クリック数・注文数が十分
  | "CLUSTER_PERFORMER"     // クラスタ内で特に優秀
  | "LIFECYCLE_BOOST";      // ライフサイクル緩和により昇格

// =============================================================================
// 昇格設定
// =============================================================================

/**
 * 昇格判定の設定
 */
export interface PromotionConfig {
  // ----- クラスタフィルタ閾値 -----
  /** クラスタの最小クリック数（デフォルト: 50） */
  clusterMinClicks: number;

  /** クラスタの最小注文数（デフォルト: 3） */
  clusterMinOrders: number;

  /** クラスタ CVR 比率（effective_baseline_cvr × この値以上で通過、デフォルト: 1.0） */
  clusterCvrRatio: number;

  /** クラスタ ACOS 比率（target_acos × この値以下で通過、デフォルト: 1.3） */
  clusterAcosRatio: number;

  // ----- 検索語フィルタ閾値 -----
  /** 検索語の最小クリック数（デフォルト: 10） */
  keywordMinClicks: number;

  /** 検索語の最小注文数（デフォルト: 2） */
  keywordMinOrders: number;

  /** 検索語 CVR 比率（max(cluster_cvr, effective_baseline_cvr) × この値以上、デフォルト: 1.1） */
  keywordCvrRatio: number;

  /** 検索語 ACOS 比率（target_acos × この値以下、デフォルト: 1.2） */
  keywordAcosRatio: number;
}

/**
 * ライフサイクル別のデフォルト昇格設定
 */
export const LIFECYCLE_PROMOTION_CONFIGS: Record<LifecycleState, PromotionConfig> = {
  // LAUNCH_HARD: 積極的に昇格（緩和した閾値）
  LAUNCH_HARD: {
    clusterMinClicks: 40,
    clusterMinOrders: 2,
    clusterCvrRatio: 0.9,
    clusterAcosRatio: 1.5,
    keywordMinClicks: 8,
    keywordMinOrders: 1,
    keywordCvrRatio: 1.05,
    keywordAcosRatio: 1.4,
  },
  // LAUNCH_SOFT: やや緩和
  LAUNCH_SOFT: {
    clusterMinClicks: 45,
    clusterMinOrders: 2,
    clusterCvrRatio: 0.95,
    clusterAcosRatio: 1.4,
    keywordMinClicks: 9,
    keywordMinOrders: 2,
    keywordCvrRatio: 1.08,
    keywordAcosRatio: 1.3,
  },
  // GROW: 標準設定
  GROW: {
    clusterMinClicks: 50,
    clusterMinOrders: 3,
    clusterCvrRatio: 1.0,
    clusterAcosRatio: 1.3,
    keywordMinClicks: 10,
    keywordMinOrders: 2,
    keywordCvrRatio: 1.1,
    keywordAcosRatio: 1.2,
  },
  // HARVEST: 厳格な閾値
  HARVEST: {
    clusterMinClicks: 60,
    clusterMinOrders: 4,
    clusterCvrRatio: 1.1,
    clusterAcosRatio: 1.1,
    keywordMinClicks: 15,
    keywordMinOrders: 3,
    keywordCvrRatio: 1.2,
    keywordAcosRatio: 1.1,
  },
};

/**
 * デフォルトの昇格設定（GROW相当）
 */
export const DEFAULT_PROMOTION_CONFIG: PromotionConfig = LIFECYCLE_PROMOTION_CONFIGS.GROW;

// =============================================================================
// BigQuery 入力データ型
// =============================================================================

/**
 * search_term_stats_30d ビューの行
 */
export interface SearchTermStats30dRow {
  profile_id: string;
  campaign_id: string;
  ad_group_id: string;
  asin: string;
  search_term: string;
  match_type: string;
  intent_cluster_id: string | null;
  intent_cluster_label: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  cvr: number | null;
  acos: number | null;
}

/**
 * intent_cluster_stats_30d ビューの行
 */
export interface IntentClusterStats30dRow {
  profile_id: string;
  asin: string;
  intent_cluster_id: string;
  intent_cluster_label: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  cvr: number | null;
  acos: number | null;
}

/**
 * asin_baseline_stats_30d ビューの行
 */
export interface AsinBaselineStats30dRow {
  profile_id: string;
  asin: string;
  impressions: number;
  clicks: number;
  orders: number;
  sales: number;
  cvr: number;   // asin_baseline_cvr
  acos: number;  // asin_baseline_acos
}

/**
 * 既存の MANUAL EXACT キーワード（重複チェック用）
 */
export interface ExistingExactKeywordRow {
  profile_id: string;
  campaign_id: string;
  ad_group_id: string;
  asin: string;
  keyword_text: string;
}

/**
 * ターゲット MANUAL キャンペーン情報
 */
export interface TargetManualCampaignRow {
  profile_id: string;
  campaign_id: string;
  ad_group_id: string;
  asin: string;
  campaign_name: string;
  ad_group_name: string;
}

// =============================================================================
// 商品設定
// =============================================================================

/**
 * 商品設定（product_config から取得）
 */
export interface ProductConfigForPromotion {
  asin: string;
  profileId: string;
  lifecycleState: LifecycleState;
  targetAcos: number;
  /** ポートフォリオベースラインCVR（同一ブランド/商品グループの中央値） */
  portfolioBaselineCvr?: number;
}

// =============================================================================
// 昇格候補
// =============================================================================

/**
 * 昇格候補ドメイン型
 */
export interface PromotionCandidate {
  // ----- 識別情報 -----
  /** プロファイルID */
  profileId: string;

  /** ASIN */
  asin: string;

  /** 検索語 */
  searchTerm: string;

  /** マッチタイプ（常に "EXACT"） */
  matchType: "EXACT";

  // ----- AUTO キャンペーン情報 -----
  /** AUTO キャンペーンID */
  campaignIdAuto: string;

  /** AUTO 広告グループID */
  adGroupIdAuto: string;

  // ----- ターゲット MANUAL キャンペーン情報 -----
  /** ターゲット MANUAL キャンペーンID */
  campaignIdManualTarget: string | null;

  /** ターゲット MANUAL 広告グループID */
  adGroupIdManualTarget: string | null;

  // ----- クラスタ情報 -----
  /** 検索意図クラスタID */
  intentClusterId: string | null;

  /** 検索意図クラスタラベル */
  intentClusterLabel: string | null;

  // ----- 検索語パフォーマンス（30日） -----
  /** クリック数 */
  clicks: number;

  /** インプレッション数 */
  impressions: number;

  /** 注文数 */
  orders: number;

  /** 売上 */
  sales: number;

  /** 広告費 */
  cost: number;

  /** CVR */
  cvr: number;

  /** ACOS */
  acos: number;

  // ----- クラスタパフォーマンス -----
  /** クラスタのクリック数 */
  clusterClicks: number | null;

  /** クラスタのCVR */
  clusterCvr: number | null;

  // ----- 基準値 -----
  /** ASIN ベースラインCVR */
  asinBaselineCvr: number;

  /** ポートフォリオベースラインCVR */
  portfolioBaselineCvr: number;

  /** 有効ベースラインCVR（max(asin, portfolio)） */
  effectiveBaselineCvr: number;

  /** ターゲットACOS */
  targetAcos: number;

  // ----- 判定情報 -----
  /** 昇格優先度スコア（cvr / (acos / target_acos)） */
  score: number;

  /** 判定理由コード */
  reasonCodes: PromotionReasonCode[];

  /** 詳細説明 */
  reasonDetail: string | null;

  /** ライフサイクルステート */
  lifecycleState: LifecycleState;
}

// =============================================================================
// BigQuery 出力データ型
// =============================================================================

/**
 * auto_exact_promotion_suggestions テーブルの行
 *
 * BigQuery DDL（参考）:
 * ```sql
 * CREATE TABLE IF NOT EXISTS `{project}.amazon_bid_engine.auto_exact_promotion_suggestions` (
 *   execution_id STRING NOT NULL,
 *   profile_id STRING NOT NULL,
 *   campaign_id_auto STRING NOT NULL,
 *   ad_group_id_auto STRING NOT NULL,
 *   campaign_id_manual_target STRING,
 *   ad_group_id_manual_target STRING,
 *   asin STRING NOT NULL,
 *   search_term STRING NOT NULL,
 *   intent_cluster_id STRING,
 *   intent_cluster_label STRING,
 *   match_type STRING NOT NULL,
 *   lookback_days INT64 NOT NULL,
 *   impressions INT64 NOT NULL,
 *   clicks INT64 NOT NULL,
 *   orders INT64 NOT NULL,
 *   sales NUMERIC NOT NULL,
 *   cost NUMERIC NOT NULL,
 *   cvr NUMERIC NOT NULL,
 *   acos NUMERIC NOT NULL,
 *   cluster_clicks INT64,
 *   cluster_cvr NUMERIC,
 *   asin_baseline_cvr NUMERIC NOT NULL,
 *   effective_baseline_cvr NUMERIC NOT NULL,
 *   target_acos NUMERIC NOT NULL,
 *   score NUMERIC NOT NULL,
 *   status STRING NOT NULL,
 *   mode STRING NOT NULL,
 *   created_at TIMESTAMP NOT NULL
 * )
 * PARTITION BY DATE(created_at)
 * CLUSTER BY profile_id, asin;
 * ```
 */
export interface AutoExactPromotionSuggestionRow {
  /** 実行ID */
  execution_id: string;

  /** プロファイルID */
  profile_id: string;

  /** AUTO キャンペーンID */
  campaign_id_auto: string;

  /** AUTO 広告グループID */
  ad_group_id_auto: string;

  /** ターゲット MANUAL キャンペーンID */
  campaign_id_manual_target: string | null;

  /** ターゲット MANUAL 広告グループID */
  ad_group_id_manual_target: string | null;

  /** ASIN */
  asin: string;

  /** 検索語 */
  search_term: string;

  /** 検索意図クラスタID */
  intent_cluster_id: string | null;

  /** 検索意図クラスタラベル */
  intent_cluster_label: string | null;

  /** マッチタイプ（"EXACT" 固定） */
  match_type: string;

  /** ルックバック日数 */
  lookback_days: number;

  /** インプレッション数 */
  impressions: number;

  /** クリック数 */
  clicks: number;

  /** 注文数 */
  orders: number;

  /** 売上 */
  sales: number;

  /** 広告費 */
  cost: number;

  /** CVR */
  cvr: number;

  /** ACOS */
  acos: number;

  /** クラスタのクリック数 */
  cluster_clicks: number | null;

  /** クラスタのCVR */
  cluster_cvr: number | null;

  /** ASIN ベースラインCVR */
  asin_baseline_cvr: number;

  /** 有効ベースラインCVR */
  effective_baseline_cvr: number;

  /** ターゲットACOS */
  target_acos: number;

  /** 昇格優先度スコア */
  score: number;

  /** ステータス（"PENDING" 固定） */
  status: string;

  /** 実行モード（"SHADOW" 固定） */
  mode: string;

  /** 作成日時 */
  created_at: Date;
}

// =============================================================================
// 計算結果
// =============================================================================

/**
 * 昇格候補計算の結果
 */
export interface PromotionCandidatesResult {
  /** プロファイルID */
  profileId: string;

  /** 実行モード */
  mode: ExecutionMode;

  /** 候補リスト */
  candidates: PromotionCandidate[];

  /** 処理統計 */
  stats: {
    /** 処理した ASIN 数 */
    totalAsinsProcessed: number;

    /** 処理したクラスタ数 */
    totalClustersProcessed: number;

    /** クラスタフィルタ通過数 */
    clustersPassedFilter: number;

    /** 処理した検索語数 */
    totalSearchTermsProcessed: number;

    /** 検索語フィルタ通過数 */
    searchTermsPassedFilter: number;

    /** 重複除外数 */
    duplicatesExcluded: number;

    /** ネガティブ除外数 */
    negativesExcluded: number;
  };
}

// =============================================================================
// 実行コンテキスト
// =============================================================================

/**
 * 昇格エンジン実行コンテキスト
 */
export interface PromotionExecutionContext {
  /** プロファイルID */
  profileId: string;

  /** 実行ID */
  executionId: string;

  /** 実行モード（今回は常に "SHADOW"） */
  mode: ExecutionMode;

  /** BigQuery プロジェクトID */
  projectId: string;

  /** BigQuery データセットID */
  dataset: string;
}

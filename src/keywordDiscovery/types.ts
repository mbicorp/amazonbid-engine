/**
 * キーワード自動発見・拡張機能 - 型定義
 *
 * フェーズ一: Amazon検索語レポートから新しい有望キーワード候補を自動抽出
 * フェーズ二: Jungle Scout API との統合（設計とダミー実装）
 *
 * SHADOWモード専用: 自動でキャンペーンに追加はしない。人間レビュー前提。
 */

// =============================================================================
// Discovery Source（候補のデータソース）
// =============================================================================

/**
 * キーワード候補の発見ソース
 */
export type DiscoverySource =
  | "SEARCH_TERM"    // Amazon検索語レポート由来
  | "JUNGLE_SCOUT"   // Jungle Scout API由来
  | "BOTH";          // 両方のソースで発見

// =============================================================================
// Candidate State（候補のステータス）
// =============================================================================

/**
 * キーワード候補のステータス
 */
export type CandidateState =
  | "PENDING_REVIEW"  // レビュー待ち（初期状態）
  | "APPROVED"        // 承認済（適用待ち）
  | "REJECTED"        // 却下
  | "APPLIED";        // キャンペーンに適用済

// =============================================================================
// Match Type
// =============================================================================

/**
 * 推奨されるマッチタイプ
 */
export type SuggestedMatchType = "EXACT" | "PHRASE" | "BROAD";

// =============================================================================
// Jungle Scout Metrics（フェーズ二用）
// =============================================================================

/**
 * Jungle Scout API から取得できる指標
 * フェーズ二で本番利用する際に実データが入る
 */
export interface JungleScoutMetrics {
  /** 月間検索ボリューム（EXACT） */
  searchVolumeExact: number | null;

  /** 月間検索ボリューム（BROAD） */
  searchVolumeBroad: number | null;

  /** 競合スコア（0-100、高いほど競合が激しい） */
  competitionScore: number | null;

  /** ランキングの難易度スコア（0-100、高いほど難しい） */
  easeOfRankingScore: number | null;

  /** 関連度スコア（0-100） */
  relevancyScore: number | null;

  /** 推奨入札額（下限） */
  suggestedBidLow: number | null;

  /** 推奨入札額（上限） */
  suggestedBidHigh: number | null;

  /** トレンド方向 */
  trendingDirection: "up" | "down" | "flat" | null;

  /** トレンド変化率（%） */
  trendingPercentage: number | null;

  /** データ取得日時 */
  fetchedAt: Date | null;
}

/**
 * 空のJungleScoutMetrics（フェーズ一ではこれを使用）
 */
export function createEmptyJungleScoutMetrics(): JungleScoutMetrics {
  return {
    searchVolumeExact: null,
    searchVolumeBroad: null,
    competitionScore: null,
    easeOfRankingScore: null,
    relevancyScore: null,
    suggestedBidLow: null,
    suggestedBidHigh: null,
    trendingDirection: null,
    trendingPercentage: null,
    fetchedAt: null,
  };
}

// =============================================================================
// Search Term Metrics（検索語レポート由来の指標）
// =============================================================================

/**
 * 検索語レポートから取得したパフォーマンス指標
 */
export interface SearchTermMetrics {
  /** 表示回数（7日間） */
  impressions7d: number;

  /** クリック数（7日間） */
  clicks7d: number;

  /** 注文数（7日間） */
  orders7d: number;

  /** 売上（7日間） */
  sales7d: number;

  /** 広告費（7日間） */
  cost7d: number;

  /** ACOS（7日間）- 計算値 */
  acos7d: number | null;

  /** CVR（7日間）- 計算値 */
  cvr7d: number | null;

  /** CPC（7日間）- 計算値 */
  cpc7d: number | null;
}

// =============================================================================
// Candidate Keyword（キーワード候補）
// =============================================================================

/**
 * キーワード候補ドメイン型
 */
export interface CandidateKeyword {
  // ----- 識別情報 -----
  /** 候補ID（UUIDで生成） */
  id: string;

  /** ASIN */
  asin: string;

  /** キーワード（検索クエリ） */
  query: string;

  /** 正規化されたキーワード（比較用：小文字、全角→半角変換） */
  normalizedQuery: string;

  // ----- 推奨情報 -----
  /** 推奨マッチタイプ */
  suggestedMatchType: SuggestedMatchType;

  /** データソース */
  source: DiscoverySource;

  // ----- 検索語由来の指標 -----
  /** 検索語レポートのパフォーマンス指標 */
  searchTermMetrics: SearchTermMetrics | null;

  // ----- Jungle Scout由来の指標（フェーズ二） -----
  /** Jungle Scout API の指標 */
  jungleScoutMetrics: JungleScoutMetrics | null;

  // ----- スコアリング -----
  /** 総合スコア（0-100） */
  score: number;

  /** スコアの詳細内訳 */
  scoreBreakdown: ScoreBreakdown;

  // ----- ステータス -----
  /** 候補の状態 */
  state: CandidateState;

  // ----- メタ情報 -----
  /** 発見日時 */
  discoveredAt: Date;

  /** 最終更新日時 */
  updatedAt: Date;

  /** プロファイルID */
  profileId?: string;

  /** キャンペーンID（発見元） */
  campaignId?: string;

  /** 広告グループID（発見元） */
  adGroupId?: string;
}

/**
 * スコアの詳細内訳
 */
export interface ScoreBreakdown {
  /** 検索語由来スコア（0-100） */
  searchTermScore: number;

  /** Jungle Scout由来スコア（0-100、フェーズ二で使用） */
  jungleScoutScore: number;

  /** 適用された重み */
  weights: {
    searchTerm: number;
    jungleScout: number;
  };
}

// =============================================================================
// Keyword Discovery Config（設定）
// =============================================================================

/**
 * キーワード発見機能の設定
 */
export interface KeywordDiscoveryConfig {
  // ----- Feature Flags -----
  /** Jungle Scout連携を有効にするか（フェーズ一では false） */
  enableJungleScout: boolean;

  // ----- 検索語フィルタ閾値 -----
  /** 候補とするための最小表示回数（7日） */
  minImpressions7d: number;

  /** 候補とするための最小クリック数（7日） */
  minClicks7d: number;

  /** 候補とするための最小注文数（7日） */
  minOrders7d: number;

  /** 候補とするための最大ACOS（target_acosに対する倍率） */
  maxAcosMultiplier: number;

  /** 候補とするための最小CVR（カテゴリ平均に対する倍率） */
  minCvrMultiplier: number;

  // ----- 除外条件 -----
  /** 除外するための最大表示回数閾値（これ未満は除外） */
  excludeBelowImpressions: number;

  /** 除外するためのクリックゼロ判定（true: クリック0は除外） */
  excludeZeroClicks: boolean;

  // ----- スコアリング重み -----
  /** 検索語由来スコアの重み（0-1） */
  searchTermWeight: number;

  /** Jungle Scout由来スコアの重み（0-1） */
  jungleScoutWeight: number;

  // ----- スコア計算パラメータ -----
  /** 注文数スコアの最大値に対応する注文数 */
  ordersScoreMax: number;

  /** クリック数スコアの最大値に対応するクリック数 */
  clicksScoreMax: number;

  /** 表示回数スコアの最大値に対応する表示回数 */
  impressionsScoreMax: number;

  /** ACOSスコアの最高評価となるACOS */
  acosScoreBest: number;

  /** ACOSスコアが0点になるACOS */
  acosScoreWorst: number;
}

/**
 * デフォルトの設定値
 */
export const DEFAULT_KEYWORD_DISCOVERY_CONFIG: KeywordDiscoveryConfig = {
  // Feature Flags
  enableJungleScout: false,

  // 検索語フィルタ閾値
  minImpressions7d: 100,
  minClicks7d: 3,
  minOrders7d: 1,
  maxAcosMultiplier: 2.0,    // target_acos の 2倍以内
  minCvrMultiplier: 0.8,     // カテゴリ平均の 80% 以上

  // 除外条件
  excludeBelowImpressions: 50,
  excludeZeroClicks: true,

  // スコアリング重み（フェーズ一では検索語100%）
  searchTermWeight: 1.0,
  jungleScoutWeight: 0.0,

  // スコア計算パラメータ
  ordersScoreMax: 10,        // 10注文以上で満点
  clicksScoreMax: 50,        // 50クリック以上で満点
  impressionsScoreMax: 1000, // 1000表示以上で満点
  acosScoreBest: 0.1,        // ACOS 10%以下で満点
  acosScoreWorst: 0.5,       // ACOS 50%以上で0点
};

// =============================================================================
// BigQuery Row Types
// =============================================================================

/**
 * keyword_discovery_candidates テーブルの行
 */
export interface KeywordDiscoveryCandidateRow {
  /** UUID */
  id: string;

  /** ASIN */
  asin: string;

  /** 検索クエリ */
  query: string;

  /** 正規化されたクエリ */
  normalized_query: string;

  /** 推奨マッチタイプ */
  suggested_match_type: string;

  /** データソース（SEARCH_TERM, JUNGLE_SCOUT, BOTH） */
  source: string;

  /** 総合スコア */
  score: number;

  // ----- 検索語由来の指標 -----
  impressions_7d: number | null;
  clicks_7d: number | null;
  orders_7d: number | null;
  sales_7d: number | null;
  cost_7d: number | null;
  acos_7d: number | null;
  cvr_7d: number | null;
  cpc_7d: number | null;

  // ----- Jungle Scout由来の指標 -----
  js_search_volume_exact: number | null;
  js_search_volume_broad: number | null;
  js_competition_score: number | null;
  js_ease_of_ranking_score: number | null;
  js_relevancy_score: number | null;
  js_suggested_bid_low: number | null;
  js_suggested_bid_high: number | null;
  js_trending_direction: string | null;
  js_trending_percentage: number | null;
  js_fetched_at: Date | null;

  // ----- スコア内訳 -----
  score_search_term: number;
  score_jungle_scout: number;
  weight_search_term: number;
  weight_jungle_scout: number;

  // ----- ステータス -----
  state: string;

  // ----- メタ情報 -----
  profile_id: string | null;
  campaign_id: string | null;
  ad_group_id: string | null;
  discovered_at: Date;
  updated_at: Date;

  // ----- 承認フロー情報 -----
  approved_at: Date | null;
  approved_by: string | null;
  rejected_at: Date | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  applied_at: Date | null;
}

// =============================================================================
// Input Types（入力データ型）
// =============================================================================

/**
 * 検索語レポートの行（BigQueryから取得）
 */
export interface SearchTermReportRow {
  profile_id: string;
  campaign_id: string;
  ad_group_id: string;
  asin: string;
  query: string;
  match_type: string;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  cvr: number | null;
  acos: number | null;
}

/**
 * 既存のキーワード情報（重複チェック用）
 */
export interface ExistingKeyword {
  asin: string;
  keyword: string;
  normalizedKeyword: string;
  matchType: string;
}

/**
 * 商品設定（product_configから取得）
 */
export interface ProductConfigForDiscovery {
  asin: string;
  profileId: string;
  targetAcos: number;
  lifecycleState: string;
  categoryBaselineCvr?: number;
}

// =============================================================================
// Result Types（結果型）
// =============================================================================

/**
 * キーワード発見ジョブの実行結果
 */
export interface KeywordDiscoveryResult {
  /** 実行ID */
  executionId: string;

  /** 成功/失敗 */
  success: boolean;

  /** 発見された候補数 */
  candidatesCount: number;

  /** 処理統計 */
  stats: KeywordDiscoveryStats;

  /** エラーメッセージ（失敗時） */
  errorMessage?: string;

  /** 候補リスト（オプション） */
  candidates?: CandidateKeyword[];
}

/**
 * キーワード発見の処理統計
 */
export interface KeywordDiscoveryStats {
  /** 処理したASIN数 */
  totalAsinsProcessed: number;

  /** 処理した検索語数 */
  totalSearchTermsProcessed: number;

  /** 重複として除外された数 */
  duplicatesExcluded: number;

  /** 閾値未満で除外された数 */
  belowThresholdExcluded: number;

  /** 検索語由来の候補数 */
  searchTermCandidates: number;

  /** Jungle Scout由来の候補数 */
  jungleScoutCandidates: number;

  /** 統合後の最終候補数 */
  finalCandidates: number;

  /** 処理時間（ミリ秒） */
  processingTimeMs: number;
}

// =============================================================================
// Filter Options（フィルタオプション）
// =============================================================================

/**
 * 候補一覧取得時のフィルタオプション
 */
export interface CandidateFilterOptions {
  /** ASIN でフィルタ */
  asin?: string;

  /** 状態でフィルタ */
  state?: CandidateState;

  /** ソースでフィルタ */
  source?: DiscoverySource;

  /** 最小スコアでフィルタ */
  minScore?: number;

  /** 最大件数 */
  limit?: number;

  /** オフセット */
  offset?: number;

  /** ソート順（score_desc がデフォルト） */
  orderBy?: "score_desc" | "score_asc" | "discovered_at_desc" | "discovered_at_asc";
}

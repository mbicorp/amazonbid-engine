/**
 * 検索意図クラスター - 型定義
 *
 * ASIN×検索意図クラスター単位でのSTOP/NEG判定を実現するためのデータモデル
 *
 * クラスターキー構造:
 *   queryClusterId = `${canonicalQuery}::${queryIntentTag}`
 *
 * - canonicalQuery: 正規化された検索クエリ（全角半角統一、カタカナ/ひらがな正規化、大文字小文字統一）
 * - queryIntentTag: 検索意図タグ（child, adult, concern, info, generic）
 */

// =============================================================================
// 検索意図タグ
// =============================================================================

/**
 * 検索意図タグ
 *
 * 検索クエリから推定される購買意図のカテゴリ
 */
export type QueryIntentTag =
  | "child"    // 子供向け（キッズ、子ども、ベビー等）
  | "adult"    // 大人向け（大人、メンズ、レディース等）
  | "concern"  // 悩み系（かゆみ、痛み、対策、ケア等）
  | "info"     // 情報探索（おすすめ、比較、ランキング等）
  | "generic"; // 汎用（上記に該当しない）

/**
 * 検索意図タグの表示名
 */
export const QUERY_INTENT_TAG_LABELS: Record<QueryIntentTag, string> = {
  child: "子供向け",
  adult: "大人向け",
  concern: "悩み系",
  info: "情報探索",
  generic: "汎用",
};

// =============================================================================
// クラスター判定フェーズ
// =============================================================================

/**
 * クラスター判定フェーズ
 *
 * クリック数に基づく判定フェーズ
 */
export type ClusterJudgmentPhase =
  | "LEARNING"          // 学習中（クリック < minLearning）: STOP/NEG禁止
  | "LIMITED_ACTION"    // 限定アクション（minLearning <= クリック < minStopCandidate）: MILD_DOWN/STRONG_DOWNのみ許可
  | "STOP_CANDIDATE";   // STOP候補（クリック >= minStopCandidate）: STOP/NEG可能

/**
 * クラスター判定フェーズのしきい値設定
 */
export interface ClusterPhaseThresholds {
  /** 学習フェーズの最小クリック数（これ未満は学習中） */
  clusterClicksMinLearning: number;

  /** STOP候補フェーズの最小クリック数（これ以上でSTOP/NEG候補） */
  clusterClicksMinStopCandidate: number;
}

/**
 * デフォルトのクラスターフェーズしきい値
 */
export const DEFAULT_CLUSTER_PHASE_THRESHOLDS: ClusterPhaseThresholds = {
  clusterClicksMinLearning: 20,
  clusterClicksMinStopCandidate: 60,
};

// =============================================================================
// クラスターメトリクス
// =============================================================================

/**
 * ASIN×検索意図クラスター単位のメトリクス
 *
 * 検索語レベルのメトリクスを集約した結果
 */
export interface QueryClusterMetrics {
  /** ASIN */
  asin: string;

  /** クラスターID（`${canonicalQuery}::${queryIntentTag}`形式） */
  queryClusterId: string;

  /** 正規化されたクエリ */
  canonicalQuery: string;

  /** 検索意図タグ */
  queryIntentTag: QueryIntentTag;

  /** 集計期間（日数） */
  windowDays: number;

  /** インプレッション数 */
  impressions: number;

  /** クリック数 */
  clicks: number;

  /** 広告費（円） */
  cost: number;

  /** コンバージョン数 */
  conversions: number;

  /** 売上（円） */
  revenue: number;

  /** 平均CPC（円、クリック0の場合はnull） */
  cpc: number | null;

  /** CVR（クリック0の場合はnull） */
  cvr: number | null;

  /** ACOS（売上0の場合はnull） */
  acos: number | null;

  /** このクラスターに含まれる検索クエリ数 */
  queriesInCluster: number;

  /** このクラスターに含まれる検索クエリのリスト */
  queryList: string[];
}

// =============================================================================
// クラスター判定結果
// =============================================================================

/**
 * クラスター単位のSTOP/NEG判定結果
 */
export interface ClusterJudgmentResult {
  /** ASIN */
  asin: string;

  /** クラスターID */
  queryClusterId: string;

  /** 判定フェーズ */
  phase: ClusterJudgmentPhase;

  /** STOP/NEG推奨かどうか */
  isStopCandidate: boolean;

  /** クラスターレベルでのNEG推奨かどうか */
  isNegativeCandidate: boolean;

  /** 判定理由コード */
  reasonCode: ClusterJudgmentReasonCode;

  /** 判定理由の詳細説明 */
  reasonDetail: string;

  /** クラスターメトリクス */
  clusterMetrics: QueryClusterMetrics;

  /** ルールオブスリーによる必要クリック数 */
  requiredClicksByRuleOfThree: number;

  /** 実際のクリック数が必要クリック数を満たしているか */
  meetsClickThreshold: boolean;
}

/**
 * クラスター判定理由コード
 */
export type ClusterJudgmentReasonCode =
  | "CLUSTER_LEARNING"              // 学習中（クリック不足）
  | "CLUSTER_LIMITED_ACTION"        // 限定アクション（中間フェーズ）
  | "CLUSTER_NO_CONVERSION"         // クラスタ単位でCVR=0
  | "CLUSTER_LOW_CVR"               // クラスタ単位でCVR低い
  | "CLUSTER_HIGH_ACOS"             // クラスタ単位でACOS高い
  | "CLUSTER_OK"                    // 問題なし
  | "CLUSTER_LONG_TAIL_REVIEW";     // ロングテール（レビュー推奨）

// =============================================================================
// 重要キーワード設定
// =============================================================================

/**
 * 重要キーワード設定
 *
 * クラスター判定をオーバーライドできるキーワードの設定
 */
export interface ImportantKeywordConfig {
  /** 自動検出を有効にするか */
  autoDetectEnabled: boolean;

  /** 自動検出: 広告費上位N件を重要キーワードとする */
  autoDetectTopN: number;

  /** 自動検出: 最小広告費しきい値（円） */
  autoDetectMinSpend: number;

  /** 手動ホワイトリスト（ASIN別） */
  manualWhitelist: Map<string, Set<string>>;

  /** グローバルホワイトリスト（全ASIN共通） */
  globalWhitelist: Set<string>;
}

/**
 * デフォルトの重要キーワード設定
 */
export const DEFAULT_IMPORTANT_KEYWORD_CONFIG: ImportantKeywordConfig = {
  autoDetectEnabled: true,
  autoDetectTopN: 20,
  autoDetectMinSpend: 5000, // 5,000円以上
  manualWhitelist: new Map(),
  globalWhitelist: new Set(),
};

/**
 * 重要キーワード判定結果
 */
export interface ImportantKeywordCheckResult {
  /** 重要キーワードかどうか */
  isImportant: boolean;

  /** 重要キーワードの理由 */
  reason: ImportantKeywordReason;

  /** 広告費（自動検出の場合） */
  adSpend?: number;

  /** 広告費ランキング（自動検出の場合） */
  spendRank?: number;
}

/**
 * 重要キーワードの理由
 */
export type ImportantKeywordReason =
  | "AUTO_TOP_SPEND"    // 広告費上位N件
  | "MANUAL_WHITELIST"  // ASIN別手動ホワイトリスト
  | "GLOBAL_WHITELIST"  // グローバルホワイトリスト
  | "NOT_IMPORTANT";    // 重要キーワードではない

// =============================================================================
// ハイブリッド判定結果
// =============================================================================

/**
 * ハイブリッド判定結果（クラスター + 単一キーワード）
 *
 * クラスター判定をベースに、重要キーワードの場合は単一キーワード判定で緩和可能
 */
export interface HybridJudgmentResult {
  /** ASIN */
  asin: string;

  /** 検索クエリ */
  query: string;

  /** クラスターID */
  queryClusterId: string;

  /** クラスター判定結果 */
  clusterJudgment: ClusterJudgmentResult;

  /** 重要キーワードチェック結果 */
  importantKeywordCheck: ImportantKeywordCheckResult;

  /** 単一キーワード判定結果（重要キーワードの場合のみ） */
  singleKeywordJudgment?: SingleKeywordJudgmentResult;

  /** 最終判定: STOP候補かどうか */
  finalIsStopCandidate: boolean;

  /** 最終判定: NEG候補かどうか */
  finalIsNegativeCandidate: boolean;

  /** オーバーライドが適用されたか */
  overrideApplied: boolean;

  /** オーバーライドの方向（緩和のみ許可） */
  overrideDirection?: "LOOSENED";

  /** 最終判定理由 */
  finalReasonCode: string;

  /** 最終判定理由の詳細 */
  finalReasonDetail: string;
}

/**
 * 単一キーワード判定結果
 */
export interface SingleKeywordJudgmentResult {
  /** 検索クエリ */
  query: string;

  /** クリック数 */
  clicks: number;

  /** コンバージョン数 */
  conversions: number;

  /** CVR */
  cvr: number | null;

  /** ACOS */
  acos: number | null;

  /** STOP候補かどうか */
  isStopCandidate: boolean;

  /** NEG候補かどうか */
  isNegativeCandidate: boolean;

  /** 判定理由 */
  reasonCode: string;

  /** 判定理由の詳細 */
  reasonDetail: string;
}

// =============================================================================
// ロングテール判定
// =============================================================================

/**
 * ロングテールクラスター判定しきい値
 */
export interface LongTailThresholds {
  /** インプレッション数しきい値（これ未満でロングテール候補） */
  maxImpressions: number;

  /** クリック数しきい値（これ未満でロングテール候補） */
  maxClicks: number;
}

/**
 * デフォルトのロングテール判定しきい値
 */
export const DEFAULT_LONG_TAIL_THRESHOLDS: LongTailThresholds = {
  maxImpressions: 200,
  maxClicks: 5,
};

/**
 * ロングテール判定結果
 */
export interface LongTailCheckResult {
  /** ロングテールクラスターかどうか */
  isLongTail: boolean;

  /** インプレッション数 */
  impressions: number;

  /** クリック数 */
  clicks: number;

  /** レビュー推奨フラグ */
  needsReview: boolean;

  /** 推奨アクション */
  recommendedAction: "AUTO_STOP" | "MANUAL_REVIEW" | "CONTINUE";
}

// =============================================================================
// 設定
// =============================================================================

/**
 * クラスターベースSTOP/NEG判定の設定
 */
export interface ClusterBasedNegativeConfig {
  /** クラスターフェーズしきい値 */
  phaseThresholds: ClusterPhaseThresholds;

  /** 重要キーワード設定 */
  importantKeywordConfig: ImportantKeywordConfig;

  /** ロングテール判定しきい値 */
  longTailThresholds: LongTailThresholds;

  /** リスク許容度（ルールオブスリー計算用、0-1） */
  riskTolerance: number;

  /** 最小ベースラインCVR（データ不足時の下限） */
  minimumBaselineCvr: number;
}

/**
 * デフォルトのクラスターベースSTOP/NEG判定設定
 */
export const DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG: ClusterBasedNegativeConfig = {
  phaseThresholds: DEFAULT_CLUSTER_PHASE_THRESHOLDS,
  importantKeywordConfig: DEFAULT_IMPORTANT_KEYWORD_CONFIG,
  longTailThresholds: DEFAULT_LONG_TAIL_THRESHOLDS,
  riskTolerance: 0.5,
  minimumBaselineCvr: 0.01,
};

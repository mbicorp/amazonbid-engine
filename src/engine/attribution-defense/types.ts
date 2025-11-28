/**
 * アトリビューション防御ロジック - 型定義
 *
 * Amazon広告のCV計上遅延（2-3日）を考慮し、
 * DOWN/STRONG_DOWN/STOP/NEGの判定を安定期間（stable期間）ベースで行う。
 *
 * 期間定義:
 * - stable期間: 過去データのうちアトリビューション遅延が発生していない安定した期間（例: 4-30日前）
 * - recent期間: 直近のアトリビューション遅延が発生しうる期間（例: 過去3日）
 * - total期間: stable + recent の合計（例: 過去30日全体）
 */

// =============================================================================
// アトリビューション対応メトリクス
// =============================================================================

/**
 * 期間別の基本指標
 */
export interface PeriodMetrics {
  /** インプレッション数 */
  impressions: number;
  /** クリック数 */
  clicks: number;
  /** コンバージョン（注文）数 */
  conversions: number;
  /** 広告費（コスト） */
  cost: number;
  /** 売上 */
  sales: number;

  /** クリック率（CTR）= clicks / impressions */
  ctr: number | null;
  /** コンバージョン率（CVR）= conversions / clicks */
  cvr: number | null;
  /** 広告費用対効果（ACOS）= cost / sales */
  acos: number | null;
  /** 平均クリック単価（CPC）= cost / clicks */
  cpc: number | null;
}

/**
 * アトリビューション対応メトリクス
 *
 * stable/recent/totalの3期間に分けて指標を保持。
 * 防御アクション（DOWN/STOP/NEG）の判定はstable期間のみを使用。
 */
export interface AttributionAwareMetrics {
  /** ASIN */
  asin: string;
  /** キーワードID または 検索語クラスターID */
  entityId: string;
  /** エンティティタイプ: キーワード or 検索語クラスター */
  entityType: "KEYWORD" | "SEARCH_TERM_CLUSTER";

  /**
   * 安定期間（stable期間）
   * アトリビューション遅延が発生していない期間
   * 例: 4-30日前のデータ
   */
  stable: PeriodMetrics;

  /**
   * 直近期間（recent期間）
   * アトリビューション遅延が発生しうる期間
   * 例: 直近3日のデータ
   */
  recent: PeriodMetrics;

  /**
   * 合計期間（total期間）
   * stable + recent の合計
   * 既存のロジック（アップ判定など）で使用
   */
  total: PeriodMetrics;

  /** stable期間の日数 */
  stableDays: number;

  /** recent期間の日数 */
  recentDays: number;

  /** 目標CPA（targetAcosから算出） */
  targetCpa: number;
}

// =============================================================================
// 防御閾値設定
// =============================================================================

/**
 * 防御アクション種別
 */
export type DefenseActionType =
  | "STOP"
  | "NEG"
  | "STRONG_DOWN"
  | "DOWN";

/**
 * 単一防御アクションの閾値設定
 */
export interface SingleDefenseThreshold {
  /**
   * 防御判定に必要な最小クリック数（stable期間）
   * このクリック数未満の場合は統計的に不十分とみなし、防御を発動しない
   */
  minStableClicks: number;

  /**
   * 防御判定に必要な最小コスト対目標CPA比率
   * stableCost / targetCPA がこの値以上の場合のみ防御を発動
   *
   * 例: 3.0 の場合、目標CPA ¥2,000なら ¥6,000以上の広告費が必要
   */
  minStableCostToTargetCpaRatio: number;
}

/**
 * 防御閾値設定（全アクション）
 *
 * 防御アクションごとに異なる閾値を設定可能。
 * 一般に、重い防御アクション（STOP/NEG）ほど厳しい閾値を設定。
 */
export interface DefenseThresholdConfig {
  /** STOP/NEG用の閾値（最も厳格） */
  stopNeg: SingleDefenseThreshold;

  /** STRONG_DOWN用の閾値 */
  strongDown: SingleDefenseThreshold;

  /** DOWN用の閾値（最も緩い） */
  down: SingleDefenseThreshold;
}

/**
 * デフォルトの防御閾値設定
 *
 * Rule of Three に基づく設定:
 * - CVR 3%想定: 必要クリック = 3 / 0.03 = 100
 * - CVR 5%想定: 必要クリック = 3 / 0.05 = 60
 * - CVR 1%想定: 必要クリック = 3 / 0.01 = 300
 *
 * コスト対CPA比率:
 * - STOP/NEG: 3.0倍（3回分のCPA相当の広告費を使ってもCVなし）
 * - STRONG_DOWN: 2.0倍
 * - DOWN: 1.0倍
 */
export const DEFAULT_DEFENSE_THRESHOLD_CONFIG: DefenseThresholdConfig = {
  stopNeg: {
    minStableClicks: 60,
    minStableCostToTargetCpaRatio: 3.0,
  },
  strongDown: {
    minStableClicks: 40,
    minStableCostToTargetCpaRatio: 2.0,
  },
  down: {
    minStableClicks: 20,
    minStableCostToTargetCpaRatio: 1.0,
  },
};

// =============================================================================
// ライフサイクル別の特殊設定
// =============================================================================

/**
 * ライフサイクルステート
 */
export type LifecycleState =
  | "LAUNCH_HARD"
  | "LAUNCH_SOFT"
  | "GROWTH"
  | "STEADY"
  | "HARVEST"
  | "ZOMBIE";

/**
 * ライフサイクル別の防御ポリシー
 */
export interface LifecycleDefensePolicy {
  /** 防御閾値の乗数（1.0 = デフォルト、2.0 = 2倍厳格） */
  thresholdMultiplier: number;

  /** STOP/NEGを完全に禁止するか */
  blockStopNeg: boolean;

  /** STRONG_DOWNを禁止するか */
  blockStrongDown: boolean;

  /** DOWNを禁止するか */
  blockDown: boolean;
}

/**
 * デフォルトのライフサイクル別防御ポリシー
 *
 * LAUNCH期: STOP/NEGを完全禁止、STRONG_DOWNも禁止
 * その他: 通常の防御ロジックを適用
 */
export const DEFAULT_LIFECYCLE_DEFENSE_POLICIES: Record<LifecycleState, LifecycleDefensePolicy> = {
  LAUNCH_HARD: {
    thresholdMultiplier: 2.0,
    blockStopNeg: true,
    blockStrongDown: true,
    blockDown: true,
  },
  LAUNCH_SOFT: {
    thresholdMultiplier: 1.5,
    blockStopNeg: true,
    blockStrongDown: true,
    blockDown: false,
  },
  GROWTH: {
    thresholdMultiplier: 1.2,
    blockStopNeg: false,
    blockStrongDown: false,
    blockDown: false,
  },
  STEADY: {
    thresholdMultiplier: 1.0,
    blockStopNeg: false,
    blockStrongDown: false,
    blockDown: false,
  },
  HARVEST: {
    thresholdMultiplier: 0.8,
    blockStopNeg: false,
    blockStrongDown: false,
    blockDown: false,
  },
  ZOMBIE: {
    thresholdMultiplier: 1.0,
    blockStopNeg: false,
    blockStrongDown: false,
    blockDown: false,
  },
};

// =============================================================================
// 判定結果
// =============================================================================

/**
 * 防御判定結果
 */
export interface DefenseJudgmentResult {
  /**
   * 防御条件を満たすか
   * true: stable期間で十分なデータがあり、パフォーマンスが悪い
   * false: データ不足 or パフォーマンスが良好 or ライフサイクルポリシーでブロック
   */
  shouldDefend: boolean;

  /**
   * 推奨される防御アクション
   * shouldDefend=false の場合は null
   */
  recommendedAction: DefenseActionType | null;

  /**
   * 判定理由コード
   */
  reasonCode: DefenseReasonCode;

  /**
   * 判定理由の詳細説明
   */
  reasonDetail: string;

  /**
   * stable期間のクリック閾値を満たしているか
   */
  meetsClickThreshold: boolean;

  /**
   * stable期間のコスト対CPA比率閾値を満たしているか
   */
  meetsCostThreshold: boolean;

  /**
   * ライフサイクルポリシーでブロックされたか
   */
  blockedByLifecyclePolicy: boolean;

  /**
   * 直近期間（recent）が好調かどうか
   * true の場合、強い防御アクションを緩和する可能性あり
   */
  recentPerformanceGood: boolean;

  /**
   * 使用された閾値（ライフサイクル乗数適用後）
   */
  effectiveThreshold: SingleDefenseThreshold;
}

/**
 * 防御判定理由コード
 */
export type DefenseReasonCode =
  // 防御発動
  | "DEFENSE_STOP_NO_CONVERSION"      // stable期間でCV=0、STOP推奨
  | "DEFENSE_NEG_NO_CONVERSION"       // stable期間でCV=0、NEG推奨
  | "DEFENSE_STRONG_DOWN_HIGH_ACOS"   // stable期間でACOS高すぎ、STRONG_DOWN推奨
  | "DEFENSE_DOWN_HIGH_ACOS"          // stable期間でACOS高め、DOWN推奨

  // 防御見送り
  | "DEFENSE_BLOCKED_INSUFFICIENT_CLICKS"       // stable期間のクリック不足
  | "DEFENSE_BLOCKED_INSUFFICIENT_COST"         // stable期間のコスト不足（CPA比率未達）
  | "DEFENSE_BLOCKED_LIFECYCLE_POLICY"          // ライフサイクルポリシーでブロック
  | "DEFENSE_BLOCKED_RECENT_GOOD_PERFORMANCE"   // 直近期間が好調なため緩和
  | "DEFENSE_NOT_NEEDED_GOOD_PERFORMANCE"       // stable期間のパフォーマンスが良好

  // その他
  | "DEFENSE_EVALUATION_ERROR";                 // 評価エラー

// =============================================================================
// UP/STRONG_UP用の安定比率チェック
// =============================================================================

/**
 * アップ判定の安定比率チェック結果
 */
export interface StableRatioCheckResult {
  /**
   * アップ判定を許可するか
   */
  allowUp: boolean;

  /**
   * stable期間のACOS
   */
  stableAcos: number | null;

  /**
   * total期間のACOS
   */
  totalAcos: number | null;

  /**
   * stable期間とtotal期間のACOS乖離率
   * (totalAcos - stableAcos) / stableAcos
   */
  acosDivergenceRatio: number | null;

  /**
   * チェック結果の理由
   */
  reason: string;
}

/**
 * 安定比率チェックの閾値設定
 */
export interface StableRatioThresholds {
  /**
   * ACOS乖離率の最大許容値
   * totalAcosがstableAcosよりもこの割合以上悪化している場合、アップを抑制
   * 例: 0.2 = 20%以上の悪化でアップ抑制
   */
  maxAcosDivergenceRatio: number;

  /**
   * stable期間に最低限必要なクリック数
   * この数未満の場合はチェックをスキップ（データ不足）
   */
  minStableClicks: number;
}

/**
 * デフォルトの安定比率チェック閾値
 */
export const DEFAULT_STABLE_RATIO_THRESHOLDS: StableRatioThresholds = {
  maxAcosDivergenceRatio: 0.25,
  minStableClicks: 15,
};

// =============================================================================
// 日次データ入力型
// =============================================================================

/**
 * 日次パフォーマンスデータ
 *
 * BigQueryの日次集計データからAttributionAwareMetricsを構築するための入力型
 */
export interface DailyPerformanceData {
  /** 日付（YYYY-MM-DD形式） */
  date: string;
  /** インプレッション数 */
  impressions: number;
  /** クリック数 */
  clicks: number;
  /** コンバージョン数 */
  conversions: number;
  /** コスト（広告費） */
  cost: number;
  /** 売上 */
  sales: number;
}

/**
 * メトリクス構築設定
 */
export interface MetricsBuildConfig {
  /**
   * recent期間の日数（アトリビューション遅延日数）
   * デフォルト: 3日
   */
  recentDays: number;

  /**
   * total期間の日数
   * デフォルト: 30日
   */
  totalDays: number;
}

/**
 * デフォルトのメトリクス構築設定
 */
export const DEFAULT_METRICS_BUILD_CONFIG: MetricsBuildConfig = {
  recentDays: 3,
  totalDays: 30,
};

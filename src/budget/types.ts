/**
 * Budget（日予算）最適化 - 型定義
 *
 * 「予算によるインプレッションシェア損失（Lost IS Budget）」と「ACOSの健全性」に基づいて
 * キャンペーンの日予算を動的に最適化するためのモジュール
 *
 * コアコンセプト:
 * 「予算が足りない（Usageが高い または Lost ISがある）」かつ「利益が出ている（ACOSが低い）」
 * 場合のみ、予算を引き上げる。無駄遣いしているキャンペーンの予算は増やさない。
 */

// =============================================================================
// アクションタイプ
// =============================================================================

/**
 * 予算調整のアクションタイプ
 */
export type BudgetAction =
  | "BOOST"       // 予算を引き上げる（高パフォーマンス＆予算逼迫）
  | "KEEP"        // 現状維持
  | "CURB";       // 予算を削減する（低パフォーマンス＆余剰予算）

/**
 * 有効な BudgetAction 一覧
 */
export const VALID_BUDGET_ACTIONS: readonly BudgetAction[] = [
  "BOOST",
  "KEEP",
  "CURB",
] as const;

/**
 * 値が BudgetAction かどうかを判定
 */
export function isValidBudgetAction(value: unknown): value is BudgetAction {
  return (
    typeof value === "string" &&
    VALID_BUDGET_ACTIONS.includes(value as BudgetAction)
  );
}

// =============================================================================
// 理由コード
// =============================================================================

/**
 * 予算調整の理由コード
 */
export type BudgetReasonCode =
  | "HIGH_PERFORMANCE_LOST_IS"    // 高パフォーマンス＆Lost IS Budget が高い
  | "HIGH_PERFORMANCE_HIGH_USAGE" // 高パフォーマンス＆予算消化率が高い
  | "MODERATE_PERFORMANCE"        // 目標付近のACOS、現状維持
  | "BUDGET_AVAILABLE"            // 予算に余裕がある、現状維持
  | "LOW_PERFORMANCE_SURPLUS"     // 低パフォーマンス＆余剰予算、削減推奨
  | "MAX_BUDGET_REACHED"          // 最大予算上限に到達
  | "MIN_BUDGET_REACHED"          // 最小予算下限に到達
  | "INSUFFICIENT_DATA";          // データ不足で判断不可

/**
 * 有効な BudgetReasonCode 一覧
 */
export const VALID_BUDGET_REASON_CODES: readonly BudgetReasonCode[] = [
  "HIGH_PERFORMANCE_LOST_IS",
  "HIGH_PERFORMANCE_HIGH_USAGE",
  "MODERATE_PERFORMANCE",
  "BUDGET_AVAILABLE",
  "LOW_PERFORMANCE_SURPLUS",
  "MAX_BUDGET_REACHED",
  "MIN_BUDGET_REACHED",
  "INSUFFICIENT_DATA",
] as const;

// =============================================================================
// 予算メトリクス
// =============================================================================

/**
 * キャンペーンごとの予算関連メトリクス
 *
 * BigQuery の campaign_budget_metrics ビューから取得
 */
export interface BudgetMetrics {
  // ----- 識別子 -----
  /** キャンペーンID */
  campaignId: string;

  /** キャンペーン名 */
  campaignName: string;

  // ----- 予算情報 -----
  /** 現在の日予算設定額（円） */
  dailyBudget: number;

  /** 当日の消化額（円） */
  todaySpend: number;

  /** 予算消化率（%）= todaySpend / dailyBudget * 100 */
  budgetUsagePercent: number;

  // ----- インプレッションシェア損失（重要） -----
  /**
   * 予算不足によるインプレッションシェア損失（%）
   *
   * Amazon Ads API の "Lost Impression Share (budget)" から取得
   * この値が高いほど、予算不足による機会損失が大きい
   */
  lostImpressionShareBudget: number | null;

  // ----- パフォーマンス指標（過去7日） -----
  /** 広告費（円） - 7日 */
  spend7d: number;

  /** 売上（円） - 7日 */
  sales7d: number;

  /** 注文数 - 7日 */
  orders7d: number;

  /** ACOS - 7日 */
  acos7d: number | null;

  /** CVR - 7日 */
  cvr7d: number | null;

  // ----- パフォーマンス指標（過去30日） -----
  /** 広告費（円） - 30日 */
  spend30d: number;

  /** 売上（円） - 30日 */
  sales30d: number;

  /** 注文数 - 30日 */
  orders30d: number;

  /** ACOS - 30日 */
  acos30d: number | null;

  /** CVR - 30日 */
  cvr30d: number | null;

  // ----- 目標値 -----
  /** 目標 ACOS（商品設定から取得） */
  targetAcos: number;

  // ----- 低予算消化継続日数（CURB判定用） -----
  /** 予算消化率が50%未満の連続日数 */
  lowUsageDays: number;
}

// =============================================================================
// 推奨結果
// =============================================================================

/**
 * 日予算最適化の推奨結果
 */
export interface BudgetRecommendation {
  // ----- 識別子 -----
  /** キャンペーンID */
  campaignId: string;

  /** キャンペーン名 */
  campaignName: string;

  // ----- 推奨値 -----
  /** アクションタイプ */
  action: BudgetAction;

  /** 現在の日予算（円） */
  oldBudget: number;

  /** 推奨日予算（円） */
  newBudget: number;

  /** 変更幅（円） */
  budgetChange: number;

  /** 変更率（%） */
  budgetChangePercent: number;

  // ----- 判断根拠 -----
  /** 理由コード */
  reasonCode: BudgetReasonCode;

  /** 理由詳細 */
  reasonDetail: string;

  // ----- コンテキスト情報 -----
  /** 予算消化率（%） */
  budgetUsagePercent: number;

  /** 予算不足によるIS損失（%） */
  lostImpressionShareBudget: number | null;

  /** 現在の ACOS（7日） */
  currentAcos7d: number | null;

  /** 現在の ACOS（30日） */
  currentAcos30d: number | null;

  /** 目標 ACOS */
  targetAcos: number;

  /** ACOS ギャップ比率（currentAcos / targetAcos） */
  acosGapRatio: number | null;

  // ----- ガードレール情報 -----
  /** ガードレールによりクリップされたか */
  wasGuardClamped: boolean;

  /** クランプ理由（MAX_BUDGET / MIN_BUDGET） */
  guardClampReason: string | null;

  /** 適用された最大予算上限（円） */
  maxBudgetCap: number;

  // ----- メタ情報 -----
  /** 推奨生成日時 */
  recommendedAt: Date;
}

// =============================================================================
// 設定
// =============================================================================

/**
 * 日予算最適化の設定
 */
export interface BudgetOptimizerConfig {
  // ----- 増額判定閾値 -----
  /**
   * 増額判定に必要な予算消化率（%）
   * budgetUsagePercent > boostUsageThreshold で増額候補
   */
  boostUsageThreshold: number;

  /**
   * 増額判定に必要な Lost IS Budget（%）
   * lostImpressionShareBudget > boostLostIsThreshold で増額候補
   */
  boostLostIsThreshold: number;

  /**
   * 増額に必要な ACOS パフォーマンス閾値
   * currentAcos < targetAcos * boostAcosRatio で高パフォーマンス判定
   * 例: 0.9 = 目標より10%以上良い場合のみ増額
   */
  boostAcosRatio: number;

  // ----- 減額判定閾値 -----
  /**
   * 減額判定の予算消化率（%）
   * budgetUsagePercent < curbUsageThreshold が継続で減額候補
   */
  curbUsageThreshold: number;

  /**
   * 減額判定に必要な低消化継続日数
   * lowUsageDays >= curbLowUsageDays で減額候補
   */
  curbLowUsageDays: number;

  /**
   * 減額判定の ACOS 閾値
   * currentAcos > targetAcos * curbAcosRatio で低パフォーマンス判定
   * 例: 1.5 = 目標より50%以上悪い場合に減額
   */
  curbAcosRatio: number;

  // ----- 調整幅 -----
  /**
   * 増額率（%）
   * 例: 20 = +20%増額
   */
  boostPercent: number;

  /**
   * 減額率（%）
   * 例: 10 = -10%減額
   */
  curbPercent: number;

  // ----- ガードレール -----
  /**
   * キャンペーンごとの絶対上限額（円）
   * 計算結果がこれを超える場合は上限値でクリップ
   */
  globalMaxBudgetCap: number;

  /**
   * 現在予算に対する最大倍率
   * 例: 2.0 = 現在の予算の2倍まで
   */
  maxBudgetMultiplier: number;

  /**
   * 最小予算額（円）
   * これ以下には減額しない
   */
  minBudget: number;

  // ----- データ有意性 -----
  /**
   * 判断に必要な最小注文数（7日）
   */
  minOrdersForDecision: number;
}

/**
 * デフォルトの日予算最適化設定
 */
export const DEFAULT_BUDGET_OPTIMIZER_CONFIG: BudgetOptimizerConfig = {
  // 増額判定
  boostUsageThreshold: 90,       // 消化率 90% 超で増額候補
  boostLostIsThreshold: 10,      // Lost IS 10% 超で増額候補
  boostAcosRatio: 0.9,           // 目標ACOSの90%以下で高パフォーマンス

  // 減額判定
  curbUsageThreshold: 50,        // 消化率 50% 未満が継続で減額候補
  curbLowUsageDays: 7,           // 7日間継続で減額
  curbAcosRatio: 1.5,            // 目標ACOSの150%超で低パフォーマンス

  // 調整幅
  boostPercent: 20,              // +20% 増額
  curbPercent: 10,               // -10% 減額

  // ガードレール
  globalMaxBudgetCap: 20000,     // 最大 20,000円
  maxBudgetMultiplier: 2.0,      // 現在の2倍まで
  minBudget: 500,                // 最小 500円

  // データ有意性
  minOrdersForDecision: 3,       // 最低3注文
};

// =============================================================================
// 実行結果
// =============================================================================

/**
 * 予算エンジンの実行結果
 */
export interface BudgetEngineResult {
  /** 成功フラグ */
  success: boolean;

  /** 実行ID */
  executionId: string;

  /** 実行モード（SHADOW / APPLY） */
  mode: "SHADOW" | "APPLY";

  /** 処理開始時刻 */
  startedAt: Date;

  /** 処理終了時刻 */
  finishedAt: Date;

  /** 処理時間（ミリ秒） */
  durationMs: number;

  /** 処理したキャンペーン数 */
  totalCampaigns: number;

  /** 推奨件数 */
  recommendationsCount: number;

  /** アクション別件数 */
  actionCounts: {
    BOOST: number;
    KEEP: number;
    CURB: number;
  };

  /** 推奨結果 */
  recommendations: BudgetRecommendation[];

  /** エラーメッセージ（エラー時のみ） */
  errorMessage?: string;
}

// =============================================================================
// BigQuery 行型
// =============================================================================

/**
 * campaign_budget_metrics ビューの行
 */
export interface CampaignBudgetMetricsRow {
  campaign_id: string;
  campaign_name: string;
  daily_budget: number;
  today_spend: number;
  budget_usage_percent: number;
  lost_impression_share_budget: number | null;
  spend_7d: number;
  sales_7d: number;
  orders_7d: number;
  acos_7d: number | null;
  cvr_7d: number | null;
  spend_30d: number;
  sales_30d: number;
  orders_30d: number;
  acos_30d: number | null;
  cvr_30d: number | null;
  target_acos: number;
  low_usage_days: number;
}

/**
 * budget_recommendations テーブルの行
 */
export interface BudgetRecommendationRow {
  execution_id: string;
  campaign_id: string;
  campaign_name: string;
  action: string;
  old_budget: number;
  new_budget: number;
  budget_change: number;
  budget_change_percent: number;
  reason_code: string;
  reason_detail: string | null;
  budget_usage_percent: number;
  lost_impression_share_budget: number | null;
  current_acos_7d: number | null;
  current_acos_30d: number | null;
  target_acos: number;
  acos_gap_ratio: number | null;
  was_guard_clamped: boolean;
  guard_clamp_reason: string | null;
  max_budget_cap: number;
  is_applied: boolean;
  applied_at: string | null;
  apply_error: string | null;
  recommended_at: string;
}

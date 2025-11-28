/**
 * Placement（掲載位置）最適化 - 型定義
 *
 * Top of Search Impression Share を考慮した掲載位置入札調整比率の自動最適化
 * 「偽の限界点（Local Maximum）」を回避するためのロジック
 */

// =============================================================================
// 掲載位置タイプ
// =============================================================================

/**
 * Amazon Ads の掲載位置タイプ
 */
export type PlacementType =
  | "TOP_OF_SEARCH"      // 検索結果ページの最上部（1ページ目）
  | "PRODUCT_PAGES"      // 商品詳細ページ
  | "REST_OF_SEARCH";    // 検索結果ページのその他

/**
 * API レスポンスの placement 文字列を PlacementType に変換
 */
export const PLACEMENT_TYPE_MAP: Record<string, PlacementType> = {
  "Top of Search (first page)": "TOP_OF_SEARCH",
  "Product pages": "PRODUCT_PAGES",
  "Rest of Search": "REST_OF_SEARCH",
};

/**
 * 有効な PlacementType 一覧
 */
export const VALID_PLACEMENT_TYPES: readonly PlacementType[] = [
  "TOP_OF_SEARCH",
  "PRODUCT_PAGES",
  "REST_OF_SEARCH",
] as const;

/**
 * 値が PlacementType かどうかを判定
 */
export function isValidPlacementType(value: unknown): value is PlacementType {
  return (
    typeof value === "string" &&
    VALID_PLACEMENT_TYPES.includes(value as PlacementType)
  );
}

// =============================================================================
// 掲載位置メトリクス
// =============================================================================

/**
 * キャンペーン×掲載位置ごとのパフォーマンスメトリクス
 *
 * BigQuery の campaign_placement_metrics_30d ビューから取得
 */
export interface PlacementMetrics {
  // ----- 識別子 -----
  /** キャンペーンID */
  campaignId: string;

  /** キャンペーン名 */
  campaignName: string;

  /** 掲載位置タイプ */
  placement: PlacementType;

  // ----- 現在の設定値 -----
  /**
   * 現在の入札調整比率（0-900%）
   * 0 = 調整なし、100 = +100%（2倍）、900 = +900%（10倍）
   */
  currentBidModifier: number;

  // ----- インプレッションシェア（重要） -----
  /**
   * Top of Search インプレッションシェア（0-100%）
   *
   * キャンペーンレポートから取得
   * TOS の真のパフォーマンスを判断するための重要指標
   */
  topOfSearchImpressionShare: number | null;

  // ----- パフォーマンス指標（過去30日） -----
  /** インプレッション数 */
  impressions30d: number;

  /** クリック数 */
  clicks30d: number;

  /** 広告費（円） */
  spend30d: number;

  /** 注文数 */
  orders30d: number;

  /** 売上（円） */
  sales30d: number;

  // ----- 計算指標 -----
  /** コンバージョン率（orders / clicks） */
  cvr30d: number | null;

  /** ACOS（spend / sales） */
  acos30d: number | null;

  /** CTR（clicks / impressions） */
  ctr30d: number | null;

  /** CPC（spend / clicks） */
  cpc30d: number | null;

  // ----- 目標値 -----
  /** 目標 ACOS（商品設定から取得） */
  targetAcos: number;

  // ----- 予算情報 -----
  /** キャンペーンの日予算（円） */
  dailyBudget: number | null;

  /** 本日の消化済み予算（円） */
  todaySpend: number | null;
}

// =============================================================================
// アクションタイプ
// =============================================================================

/**
 * 掲載位置調整のアクションタイプ
 */
export type PlacementAction =
  | "BOOST"              // 入札調整比率を上げる（勝ちパターン）
  | "TEST_BOOST"         // テスト的に大きく上げる（オポチュニティ・ジャンプ）
  | "DECREASE"           // 入札調整比率を下げる（撤退判断）
  | "NO_ACTION";         // 変更なし

/**
 * 有効な PlacementAction 一覧
 */
export const VALID_PLACEMENT_ACTIONS: readonly PlacementAction[] = [
  "BOOST",
  "TEST_BOOST",
  "DECREASE",
  "NO_ACTION",
] as const;

/**
 * 値が PlacementAction かどうかを判定
 */
export function isValidPlacementAction(value: unknown): value is PlacementAction {
  return (
    typeof value === "string" &&
    VALID_PLACEMENT_ACTIONS.includes(value as PlacementAction)
  );
}

// =============================================================================
// 推奨結果
// =============================================================================

/**
 * 掲載位置最適化の推奨結果
 */
export interface PlacementRecommendation {
  // ----- 識別子 -----
  /** キャンペーンID */
  campaignId: string;

  /** キャンペーン名 */
  campaignName: string;

  /** 掲載位置タイプ */
  placement: PlacementType;

  // ----- 推奨値 -----
  /** アクションタイプ */
  action: PlacementAction;

  /** 現在の入札調整比率（0-900%） */
  oldModifier: number;

  /** 推奨入札調整比率（0-900%） */
  newModifier: number;

  /** 変更幅（newModifier - oldModifier） */
  modifierChange: number;

  // ----- 判断根拠 -----
  /** 理由コード */
  reasonCode: PlacementReasonCode;

  /** 理由詳細 */
  reasonDetail: string;

  // ----- コンテキスト情報 -----
  /** インプレッションシェア（判断に使用） */
  impressionShare: number | null;

  /** 現在の ACOS */
  currentAcos: number | null;

  /** 目標 ACOS */
  targetAcos: number;

  /** ACOS ギャップ（currentAcos / targetAcos） */
  acosGapRatio: number | null;

  /** クリック数（データ有意性判定に使用） */
  clicks30d: number;

  // ----- オポチュニティ・ジャンプ情報 -----
  /**
   * オポチュニティ・ジャンプかどうか
   *
   * true の場合、IS が低いためテスト的に強く入札して
   * 真の TOS パフォーマンスを確認しようとしている
   */
  isOpportunityJump: boolean;

  // ----- メタ情報 -----
  /** 推奨生成日時 */
  recommendedAt: Date;
}

/**
 * 推奨理由コード
 */
export type PlacementReasonCode =
  | "STRONG_PERFORMANCE"      // ACOSが目標を達成、BOOSTする
  | "OPPORTUNITY_JUMP"        // ISが低くACOSが悪い、テスト的にBOOSTする
  | "TRUE_WEAKNESS"           // ISが高くACOSが悪い、撤退
  | "MODERATE_PERFORMANCE"    // ACOSが目標付近、現状維持
  | "INSUFFICIENT_DATA"       // データ不足で判断不可
  | "BUDGET_LIMITED"          // 予算制限のためテストブースト不可
  | "MAX_MODIFIER_REACHED";   // 最大調整比率に到達

/**
 * 有効な PlacementReasonCode 一覧
 */
export const VALID_PLACEMENT_REASON_CODES: readonly PlacementReasonCode[] = [
  "STRONG_PERFORMANCE",
  "OPPORTUNITY_JUMP",
  "TRUE_WEAKNESS",
  "MODERATE_PERFORMANCE",
  "INSUFFICIENT_DATA",
  "BUDGET_LIMITED",
  "MAX_MODIFIER_REACHED",
] as const;

// =============================================================================
// 設定
// =============================================================================

/**
 * 掲載位置最適化の設定
 */
export interface PlacementOptimizerConfig {
  // ----- データ有意性閾値 -----
  /** 判断に必要な最小クリック数 */
  minClicksForDecision: number;

  // ----- ACOS 判定閾値 -----
  /**
   * 勝ちパターン判定の閾値
   * current_acos < target_acos * strongPerformanceThreshold
   */
  strongPerformanceThreshold: number;

  /**
   * オポチュニティ・ジャンプ判定の ACOS 上限
   * current_acos > target_acos * opportunityJumpAcosMin
   */
  opportunityJumpAcosMin: number;

  /**
   * 撤退判断の ACOS 閾値
   * current_acos > target_acos * trueWeaknessAcosThreshold
   */
  trueWeaknessAcosThreshold: number;

  // ----- インプレッションシェア閾値 -----
  /**
   * オポチュニティ・ジャンプの IS 上限
   * impression_share < opportunityJumpIsMax の場合に適用
   */
  opportunityJumpIsMax: number;

  /**
   * 撤退判断の IS 下限
   * impression_share > trueWeaknessIsMin の場合に撤退
   */
  trueWeaknessIsMin: number;

  // ----- 調整幅 -----
  /** BOOST 時の増加幅（%） */
  boostIncrement: number;

  /** TEST_BOOST 時の増加幅（%） */
  testBoostIncrement: number;

  /** DECREASE 時の減少幅（%） */
  decreaseDecrement: number;

  // ----- ガードレール -----
  /** 最大調整比率（%） */
  maxModifier: number;

  /** 最小調整比率（%） */
  minModifier: number;

  // ----- 予算安全装置 -----
  /**
   * TEST_BOOST 適用に必要な予算残存率
   * (dailyBudget - todaySpend) / dailyBudget > budgetSafetyRatio
   */
  budgetSafetyRatio: number;
}

/**
 * デフォルトの掲載位置最適化設定
 */
export const DEFAULT_PLACEMENT_OPTIMIZER_CONFIG: PlacementOptimizerConfig = {
  // データ有意性
  minClicksForDecision: 20,

  // ACOS 判定
  strongPerformanceThreshold: 0.9,    // target_acos * 0.9 未満で勝ちパターン
  opportunityJumpAcosMin: 1.0,        // target_acos * 1.0 超でオポチュニティ候補
  trueWeaknessAcosThreshold: 1.2,     // target_acos * 1.2 超で撤退候補

  // IS 判定
  opportunityJumpIsMax: 20,           // IS < 20% でオポチュニティ・ジャンプ
  trueWeaknessIsMin: 50,              // IS > 50% で撤退判断

  // 調整幅
  boostIncrement: 15,                 // +15%
  testBoostIncrement: 40,             // +40%（中央値：30-50%の指定）
  decreaseDecrement: 20,              // -20%（中央値：10-30%の指定）

  // ガードレール
  maxModifier: 900,                   // 最大 900%
  minModifier: 0,                     // 最小 0%

  // 予算安全装置
  budgetSafetyRatio: 0.3,             // 予算残存率 30% 以上でテストブースト可
};

// =============================================================================
// 実行結果
// =============================================================================

/**
 * 掲載位置エンジンの実行結果
 */
export interface PlacementEngineResult {
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

  /** 処理した掲載位置数 */
  totalPlacements: number;

  /** 推奨件数 */
  recommendationsCount: number;

  /** アクション別件数 */
  actionCounts: {
    BOOST: number;
    TEST_BOOST: number;
    DECREASE: number;
    NO_ACTION: number;
  };

  /** オポチュニティ・ジャンプ件数 */
  opportunityJumpCount: number;

  /** 推奨結果（SHADOW モードでも含める） */
  recommendations: PlacementRecommendation[];

  /** エラーメッセージ（エラー時のみ） */
  errorMessage?: string;
}

// =============================================================================
// BigQuery 行型
// =============================================================================

/**
 * campaign_placement_metrics_30d ビューの行
 */
export interface CampaignPlacementMetricsRow {
  campaign_id: string;
  campaign_name: string;
  placement: string;
  current_bid_modifier: number;
  top_of_search_impression_share: number | null;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  cvr: number | null;
  acos: number | null;
  ctr: number | null;
  cpc: number | null;
  target_acos: number;
  daily_budget: number | null;
  today_spend: number | null;
}

/**
 * placement_recommendations テーブルの行
 */
export interface PlacementRecommendationRow {
  execution_id: string;
  campaign_id: string;
  campaign_name: string;
  placement: string;
  action: string;
  old_modifier: number;
  new_modifier: number;
  modifier_change: number;
  reason_code: string;
  reason_detail: string;
  impression_share: number | null;
  current_acos: number | null;
  target_acos: number;
  acos_gap_ratio: number | null;
  clicks_30d: number;
  is_opportunity_jump: boolean;
  is_applied: boolean;
  applied_at: string | null;
  apply_error: string | null;
  recommended_at: string;
}

/**
 * ログ記録関連の型定義
 */

// =============================================================================
// 実行モード
// =============================================================================

/**
 * 実行モード
 * - APPLY: 実際にAmazon Ads APIを呼び出して入札を適用（安全制限付き）
 * - SHADOW: 推奨は計算・記録するが、APIは呼び出さない
 */
export type ExecutionMode = "APPLY" | "SHADOW";

// =============================================================================
// APPLY スキップ理由
// =============================================================================

/**
 * APPLY をスキップした理由
 */
export type ApplySkipReason =
  | "SHADOW_MODE"                // SHADOWモードのためスキップ
  | "NOT_IN_ALLOWLIST"           // キャンペーンがallowlistに含まれていない
  | "APPLY_LIMIT_REACHED"        // max_apply_changes_per_run の上限に達した
  | "NO_SIGNIFICANT_CHANGE"      // 変更幅が閾値未満
  | "API_ERROR";                 // API呼び出しエラー

/**
 * 実行ステータス
 */
export type ExecutionStatus = "RUNNING" | "SUCCESS" | "ERROR" | "PARTIAL_ERROR";

/**
 * トリガー元
 */
export type TriggerSource = "SCHEDULER" | "MANUAL" | "API";

// =============================================================================
// 実行ログ
// =============================================================================

/**
 * 実行ログエントリ
 */
export interface ExecutionLogEntry {
  executionId: string;
  startedAt: Date;
  finishedAt: Date | null;
  mode: ExecutionMode;
  status: ExecutionStatus;

  // 処理対象統計
  totalProductsCount: number;
  totalKeywordsCount: number;

  // 処理結果統計
  recommendationsCount: number;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;

  // 変更サマリー
  bidIncreasesCount: number;
  bidDecreasesCount: number;
  bidUnchangedCount: number;

  // APPLY フィルタリング統計
  /** APPLY候補件数（allowlistに含まれ、変更幅がしきい値以上） */
  totalApplyCandidates?: number;
  /** API呼び出し失敗件数 */
  totalApplyFailed?: number;
  /** スキップ理由: SHADOWモード */
  skipCountShadowMode?: number;
  /** スキップ理由: allowlist外 */
  skipCountNotInAllowlist?: number;
  /** スキップ理由: APPLY上限到達 */
  skipCountApplyLimitReached?: number;
  /** スキップ理由: 変更幅不足 */
  skipCountNoSignificantChange?: number;

  // エラー情報
  errorMessage?: string;
  errorStack?: string;

  // 実行環境
  triggerSource: TriggerSource;
  triggeredBy: string;
  environment: string;
}

// =============================================================================
// キーワード推奨ログ
// =============================================================================

/**
 * 推奨理由コード
 */
export type ReasonCode =
  | "ACOS_HIGH"              // ACOSが目標より高い
  | "ACOS_LOW"               // ACOSが目標より低い（機会損失）
  | "NO_CONVERSION"          // コンバージョンなし
  | "LOW_IMPRESSIONS"        // インプレッション不足
  | "ORGANIC_STRONG"         // オーガニック順位強い
  | "ORGANIC_WEAK"           // オーガニック順位弱い
  | "LIFECYCLE_LAUNCH"       // ローンチ期投資
  | "LIFECYCLE_HARVEST"      // 収穫期抑制
  | "NO_CHANGE"              // 変更不要
  | "BUDGET_CAP"             // 予算上限
  | "MIN_BID"                // 最低入札額制限
  | "MAX_BID"                // 最高入札額制限
  | "INVENTORY_OUT_OF_STOCK" // 在庫ゼロ（ハードキル）
  | "INVENTORY_LOW_STOCK";   // 在庫薄（ソフトスロットル）

/**
 * キーワード推奨ログエントリ
 */
export interface KeywordRecommendationLogEntry {
  // 実行リンク
  executionId: string;

  // 対象識別子
  asin: string;
  keywordId?: string;
  keywordText: string;
  matchType?: string;
  campaignId?: string;
  adGroupId?: string;

  // 入札額
  oldBid: number;
  newBid: number;
  bidChange: number;
  bidChangePercent: number;

  // ACOS関連
  targetAcos?: number;
  currentAcos?: number;
  acosGap?: number;

  // 判定理由
  reasonCode: ReasonCode;
  reasonDetail?: string;

  // コンテキスト情報
  lifecycleState?: string;
  revenueModel?: string;
  ltvMode?: string;
  businessMode?: string;
  brandType?: string;
  experimentGroup?: string;

  // SEO情報
  seoRankCurrent?: number;
  seoRankTrend?: number;
  seoRankZone?: string;

  // パフォーマンスメトリクス
  impressions7d?: number;
  clicks7d?: number;
  conversions7d?: number;
  spend7d?: number;
  sales7d?: number;
  ctr7d?: number;
  cvr7d?: number;

  // ガードレール情報（ログ用）
  /** 入札ロジックが計算した生の推奨値（ガードレール適用前） */
  rawNewBid?: number;
  /** ガードレール適用後の値 */
  guardedNewBid?: number;
  /** ガードでクリップされたかどうか */
  wasGuardClamped?: boolean;
  /** クランプ理由 */
  guardClampReason?: string | null;
  /** ガードレールの min_bid */
  guardrailsMinBid?: number | null;
  /** ガードレールの max_bid */
  guardrailsMaxBid?: number | null;
  /** ガードレールのデータソース */
  guardrailsAutoDataSource?: "HISTORICAL" | "THEORETICAL" | "FALLBACK" | null;
  /** 使用されたガードレールモード (OFF/SHADOW/ENFORCE) */
  guardrailsMode?: "OFF" | "SHADOW" | "ENFORCE";
  /** ガードレールが実際に newBid に適用されたか（ENFORCE かつ wasGuardClamped） */
  guardrailsApplied?: boolean;

  // 在庫ガード情報（ログ用）
  /** 在庫日数 */
  daysOfInventory?: number | null;
  /** 在庫リスクステータス */
  inventoryRiskStatus?: string | null;
  /** 在庫ガードが適用されたかどうか */
  inventoryGuardApplied?: boolean;
  /** 在庫ガードの種類 */
  inventoryGuardType?: "HARD_KILL" | "SOFT_THROTTLE" | "NONE" | null;
  /** 在庫ガード適用理由 */
  inventoryGuardReason?: string | null;

  // 適用状態
  isApplied: boolean;
  appliedAt?: Date;
  applyError?: string;

  // APPLY フィルタリング情報
  /** APPLY候補かどうか（allowlistに含まれ、変更幅がしきい値以上） */
  isApplyCandidate?: boolean;
  /** APPLYスキップ理由（スキップされた場合のみ） */
  applySkipReason?: ApplySkipReason;

  // メタ情報
  recommendedAt: Date;
}

// =============================================================================
// BigQuery行形式
// =============================================================================

/**
 * executionsテーブルの行
 */
export interface ExecutionRow {
  execution_id: string;
  started_at: string;
  finished_at: string | null;
  mode: string;
  status: string;
  total_products_count: number;
  total_keywords_count: number;
  recommendations_count: number;
  applied_count: number;
  skipped_count: number;
  error_count: number;
  bid_increases_count: number;
  bid_decreases_count: number;
  bid_unchanged_count: number;
  error_message: string | null;
  error_stack: string | null;
  trigger_source: string;
  triggered_by: string;
  environment: string;
  created_at: string;
}

/**
 * keyword_recommendations_logテーブルの行
 */
export interface KeywordRecommendationRow {
  execution_id: string;
  asin: string;
  keyword_id: string | null;
  keyword_text: string;
  match_type: string | null;
  campaign_id: string | null;
  ad_group_id: string | null;
  old_bid: number;
  new_bid: number;
  bid_change: number | null;
  bid_change_percent: number | null;
  target_acos: number | null;
  current_acos: number | null;
  acos_gap: number | null;
  reason_code: string;
  reason_detail: string | null;
  lifecycle_state: string | null;
  revenue_model: string | null;
  ltv_mode: string | null;
  business_mode: string | null;
  brand_type: string | null;
  experiment_group: string | null;
  seo_rank_current: number | null;
  seo_rank_trend: number | null;
  seo_rank_zone: string | null;
  impressions_7d: number | null;
  clicks_7d: number | null;
  conversions_7d: number | null;
  spend_7d: number | null;
  sales_7d: number | null;
  ctr_7d: number | null;
  cvr_7d: number | null;
  // ガードレール情報（ログ用）
  raw_new_bid: number | null;
  guarded_new_bid: number | null;
  was_guard_clamped: boolean | null;
  guard_clamp_reason: string | null;
  guardrails_min_bid: number | null;
  guardrails_max_bid: number | null;
  guardrails_auto_data_source: string | null;
  guardrails_mode: string | null;
  guardrails_applied: boolean | null;
  // 在庫ガード情報（ログ用）
  days_of_inventory: number | null;
  inventory_risk_status: string | null;
  inventory_guard_applied: boolean | null;
  inventory_guard_type: string | null;
  inventory_guard_reason: string | null;
  // 適用状態
  is_applied: boolean;
  applied_at: string | null;
  apply_error: string | null;
  // APPLY フィルタリング情報
  is_apply_candidate: boolean | null;
  apply_skip_reason: string | null;
  recommended_at: string;
}

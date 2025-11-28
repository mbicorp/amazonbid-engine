/**
 * Dayparting (時間帯別入札最適化) - 型定義
 *
 * 時間帯別のパフォーマンス分析に基づき、
 * 統計的に有意な時間帯にのみ入札乗数を適用する機能
 */

// =============================================================================
// 基本型
// =============================================================================

/**
 * 時間帯 (0-23)
 */
export type HourOfDay = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
  12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23;

/**
 * 曜日 (0=日曜, 6=土曜)
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Dayparting動作モード
 */
export type DaypartingMode = "OFF" | "SHADOW" | "APPLY";

/**
 * 有効なDaypartingモード値
 */
export const VALID_DAYPARTING_MODES: readonly DaypartingMode[] = ["OFF", "SHADOW", "APPLY"] as const;

/**
 * Daypartingモードの型ガード
 */
export function isValidDaypartingMode(value: unknown): value is DaypartingMode {
  return typeof value === "string" && VALID_DAYPARTING_MODES.includes(value as DaypartingMode);
}

/**
 * 信頼度レベル
 */
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";

/**
 * 有効な信頼度レベル
 */
export const VALID_CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = [
  "HIGH", "MEDIUM", "LOW", "INSUFFICIENT"
] as const;

/**
 * 時間帯分類
 */
export type HourClassification = "PEAK" | "GOOD" | "AVERAGE" | "POOR" | "DEAD";

/**
 * 有効な時間帯分類
 */
export const VALID_HOUR_CLASSIFICATIONS: readonly HourClassification[] = [
  "PEAK", "GOOD", "AVERAGE", "POOR", "DEAD"
] as const;

// =============================================================================
// 時間帯別メトリクス
// =============================================================================

/**
 * 時間帯別パフォーマンスメトリクス
 */
export interface HourlyPerformanceMetrics {
  /** ASIN */
  asin: string;
  /** キャンペーンID */
  campaignId: string;
  /** 広告グループID */
  adGroupId: string;
  /** 時間帯 (0-23) */
  hour: HourOfDay;
  /** 曜日 (0=日曜, 6=土曜) */
  dayOfWeek: DayOfWeek;

  // 集計データ
  /** インプレッション数 */
  impressions: number;
  /** クリック数 */
  clicks: number;
  /** コンバージョン数 */
  conversions: number;
  /** 広告費用 */
  spend: number;
  /** 売上 */
  sales: number;

  // 計算済み指標
  /** CTR (Click-Through Rate) */
  ctr: number | null;
  /** CVR (Conversion Rate) */
  cvr: number | null;
  /** ACOS (Advertising Cost of Sales) */
  acos: number | null;
  /** ROAS (Return on Ad Spend) */
  roas: number | null;
  /** CPC (Cost Per Click) */
  cpc: number | null;

  /** データポイント数（サンプルサイズ） */
  dataPoints: number;
  /** 集計期間開始日 */
  periodStart: Date;
  /** 集計期間終了日 */
  periodEnd: Date;
}

/**
 * 時間帯分析結果
 */
export interface HourlyAnalysisResult {
  /** 時間帯 */
  hour: HourOfDay;
  /** 曜日 (null の場合は全曜日平均) */
  dayOfWeek: DayOfWeek | null;

  // 基本統計量
  /** 平均CVR */
  meanCvr: number;
  /** CVR標準偏差 */
  stdCvr: number;
  /** 平均ROAS */
  meanRoas: number;
  /** ROAS標準偏差 */
  stdRoas: number;
  /** サンプル数 */
  sampleSize: number;

  // 全体平均との比較
  /** 全体平均CVR */
  overallMeanCvr: number;
  /** 全体平均ROAS */
  overallMeanRoas: number;
  /** CVR相対パフォーマンス (この時間帯のCVR / 全体平均CVR) */
  relativeCvrPerformance: number;
  /** ROAS相対パフォーマンス */
  relativeRoasPerformance: number;

  // 統計的検定結果
  /** t統計量 (CVR) */
  tStatCvr: number;
  /** p値 (CVR) */
  pValueCvr: number;
  /** t統計量 (ROAS) */
  tStatRoas: number;
  /** p値 (ROAS) */
  pValueRoas: number;

  /** 信頼度レベル */
  confidence: ConfidenceLevel;
  /** 時間帯分類 */
  classification: HourClassification;
  /** 推奨乗数 */
  recommendedMultiplier: number;
}

/**
 * 時間帯別入札乗数
 */
export interface HourlyBidMultiplier {
  /** ASIN */
  asin: string;
  /** キャンペーンID */
  campaignId: string;
  /** 広告グループID (null = キャンペーン全体) */
  adGroupId: string | null;
  /** 時間帯 */
  hour: HourOfDay;
  /** 曜日 (null = 全曜日共通) */
  dayOfWeek: DayOfWeek | null;

  /** 入札乗数 (1.0 = 変更なし, 1.2 = 20%増, 0.8 = 20%減) */
  multiplier: number;
  /** 信頼度 */
  confidence: ConfidenceLevel;
  /** 分類 */
  classification: HourClassification;

  /** 有効期間開始 */
  effectiveFrom: Date;
  /** 有効期間終了 */
  effectiveTo: Date | null;
  /** アクティブかどうか */
  isActive: boolean;

  /** 作成日時 */
  createdAt: Date;
  /** 更新日時 */
  updatedAt: Date;
}

// =============================================================================
// 設定
// =============================================================================

/**
 * Dayparting設定
 */
export interface DaypartingConfig {
  /** ASIN */
  asin: string;
  /** キャンペーンID */
  campaignId: string;
  /** 広告グループID (null = キャンペーン全体) */
  adGroupId: string | null;

  /** 動作モード */
  mode: DaypartingMode;
  /** 有効かどうか */
  enabled: boolean;

  // 乗数制限
  /** 最大乗数 (例: 1.5 = 50%増まで) */
  maxMultiplier: number;
  /** 最小乗数 (例: 0.5 = 50%減まで) */
  minMultiplier: number;

  // 統計設定
  /** 有意水準 (例: 0.05 = 5%) */
  significanceLevel: number;
  /** 最小サンプルサイズ */
  minSampleSize: number;
  /** 分析対象期間（日数） */
  analysisWindowDays: number;

  // 安全設定
  /** 日次最大損失許容額 */
  maxDailyLoss: number;
  /** ロールバック閾値 (パフォーマンス低下率) */
  rollbackThreshold: number;

  /** 作成日時 */
  createdAt: Date;
  /** 更新日時 */
  updatedAt: Date;
}

/**
 * デフォルトのDayparting設定値
 */
export const DEFAULT_DAYPARTING_CONFIG: Omit<DaypartingConfig, "asin" | "campaignId" | "adGroupId" | "createdAt" | "updatedAt"> = {
  mode: "SHADOW",
  enabled: false,
  maxMultiplier: 1.3,
  minMultiplier: 0.7,
  significanceLevel: 0.05,
  minSampleSize: 30,
  analysisWindowDays: 14,
  maxDailyLoss: 5000,
  rollbackThreshold: 0.15,
};

// =============================================================================
// フィードバック・評価
// =============================================================================

/**
 * Daypartingフィードバックレコード
 */
export interface DaypartingFeedbackRecord {
  /** フィードバックID */
  feedbackId: string;
  /** ASIN */
  asin: string;
  /** キャンペーンID */
  campaignId: string;
  /** 広告グループID */
  adGroupId: string | null;
  /** 時間帯 */
  hour: HourOfDay;
  /** 曜日 */
  dayOfWeek: DayOfWeek | null;

  /** 適用された乗数 */
  appliedMultiplier: number;
  /** 適用日時 */
  appliedAt: Date;
  /** 評価日時 */
  evaluatedAt: Date | null;

  // 適用前メトリクス
  /** 適用前CVR */
  cvrBefore: number;
  /** 適用前ROAS */
  roasBefore: number;
  /** 適用前クリック数 */
  clicksBefore: number;
  /** 適用前コンバージョン数 */
  conversionsBefore: number;

  // 適用後メトリクス
  /** 適用後CVR */
  cvrAfter: number | null;
  /** 適用後ROAS */
  roasAfter: number | null;
  /** 適用後クリック数 */
  clicksAfter: number | null;
  /** 適用後コンバージョン数 */
  conversionsAfter: number | null;

  // 評価結果
  /** 成功判定 */
  isSuccess: boolean | null;
  /** 成功スコア (0-1) */
  successScore: number | null;
  /** 評価済みフラグ */
  evaluated: boolean;
}

/**
 * 日次サマリーメトリクス
 */
export interface DaypartingDailySummary {
  /** 日付 */
  date: Date;
  /** ASIN */
  asin: string;
  /** キャンペーンID */
  campaignId: string;

  // 乗数適用なしの場合の推定値（シャドウモード用）
  /** 推定インプレッション */
  estimatedImpressionsWithoutMultiplier: number;
  /** 推定クリック */
  estimatedClicksWithoutMultiplier: number;
  /** 推定コンバージョン */
  estimatedConversionsWithoutMultiplier: number;
  /** 推定売上 */
  estimatedSalesWithoutMultiplier: number;

  // 実際の値
  /** 実際のインプレッション */
  actualImpressions: number;
  /** 実際のクリック */
  actualClicks: number;
  /** 実際のコンバージョン */
  actualConversions: number;
  /** 実際の売上 */
  actualSales: number;
  /** 実際の広告費 */
  actualSpend: number;

  // 効果測定
  /** 増分インプレッション */
  incrementalImpressions: number;
  /** 増分クリック */
  incrementalClicks: number;
  /** 増分コンバージョン */
  incrementalConversions: number;
  /** 増分売上 */
  incrementalSales: number;

  /** モード */
  mode: DaypartingMode;
}

// =============================================================================
// 安全機構
// =============================================================================

/**
 * 安全チェック結果
 */
export interface SafetyCheckResult {
  /** 安全かどうか */
  isSafe: boolean;
  /** 警告メッセージ */
  warnings: string[];
  /** ブロック理由 (安全でない場合) */
  blockReason: string | null;
  /** 推奨アクション */
  recommendedAction: "APPLY" | "REDUCE" | "SKIP" | "ROLLBACK";
  /** 調整後の乗数 (REDUCE の場合) */
  adjustedMultiplier: number | null;
}

/**
 * ロールバック情報
 */
export interface RollbackInfo {
  /** ロールバックID */
  rollbackId: string;
  /** ASIN */
  asin: string;
  /** キャンペーンID */
  campaignId: string;
  /** ロールバック理由 */
  reason: string;
  /** ロールバック前の乗数設定 */
  previousMultipliers: HourlyBidMultiplier[];
  /** ロールバック日時 */
  rolledBackAt: Date;
  /** 復元日時 (null = まだ復元されていない) */
  restoredAt: Date | null;
}

// =============================================================================
// BigQueryレコード型
// =============================================================================

/**
 * BigQuery: hourly_metrics テーブルレコード
 */
export interface HourlyMetricsRecord {
  asin: string;
  campaign_id: string;
  ad_group_id: string;
  hour: number;
  day_of_week: number;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  sales: number;
  ctr: number | null;
  cvr: number | null;
  acos: number | null;
  roas: number | null;
  cpc: number | null;
  data_points: number;
  period_start: string;
  period_end: string;
  recorded_at: string;
}

/**
 * BigQuery: dayparting_multipliers テーブルレコード
 */
export interface DaypartingMultiplierRecord {
  multiplier_id: string;
  asin: string;
  campaign_id: string;
  ad_group_id: string | null;
  hour: number;
  day_of_week: number | null;
  multiplier: number;
  confidence: string;
  classification: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * BigQuery: dayparting_configs テーブルレコード
 */
export interface DaypartingConfigRecord {
  config_id: string;
  asin: string;
  campaign_id: string;
  ad_group_id: string | null;
  mode: string;
  enabled: boolean;
  max_multiplier: number;
  min_multiplier: number;
  significance_level: number;
  min_sample_size: number;
  analysis_window_days: number;
  max_daily_loss: number;
  rollback_threshold: number;
  created_at: string;
  updated_at: string;
}

/**
 * BigQuery: dayparting_feedback テーブルレコード
 */
export interface DaypartingFeedbackRecordBQ {
  feedback_id: string;
  asin: string;
  campaign_id: string;
  ad_group_id: string | null;
  hour: number;
  day_of_week: number | null;
  applied_multiplier: number;
  applied_at: string;
  evaluated_at: string | null;
  cvr_before: number;
  roas_before: number;
  clicks_before: number;
  conversions_before: number;
  cvr_after: number | null;
  roas_after: number | null;
  clicks_after: number | null;
  conversions_after: number | null;
  is_success: boolean | null;
  success_score: number | null;
  evaluated: boolean;
}

/**
 * BigQuery: dayparting_rollbacks テーブルレコード
 */
export interface DaypartingRollbackRecord {
  rollback_id: string;
  asin: string;
  campaign_id: string;
  reason: string;
  previous_multipliers_json: string;
  rolled_back_at: string;
  restored_at: string | null;
}

// =============================================================================
// エラーコード
// =============================================================================

/**
 * Daypartingエラーコード
 */
export const DaypartingErrorCode = {
  /** 設定が見つからない */
  CONFIG_NOT_FOUND: "DAYPARTING_CONFIG_NOT_FOUND",
  /** 無効な設定 */
  INVALID_CONFIG: "DAYPARTING_INVALID_CONFIG",
  /** データ不足 */
  INSUFFICIENT_DATA: "DAYPARTING_INSUFFICIENT_DATA",
  /** 統計的に有意でない */
  NOT_SIGNIFICANT: "DAYPARTING_NOT_SIGNIFICANT",
  /** 安全チェック失敗 */
  SAFETY_CHECK_FAILED: "DAYPARTING_SAFETY_CHECK_FAILED",
  /** ロールバック発生 */
  ROLLBACK_TRIGGERED: "DAYPARTING_ROLLBACK_TRIGGERED",
  /** BigQueryエラー */
  BIGQUERY_ERROR: "DAYPARTING_BIGQUERY_ERROR",
  /** 無効な時間帯 */
  INVALID_HOUR: "DAYPARTING_INVALID_HOUR",
  /** 乗数範囲外 */
  MULTIPLIER_OUT_OF_RANGE: "DAYPARTING_MULTIPLIER_OUT_OF_RANGE",
} as const;

export type DaypartingErrorCodeType = typeof DaypartingErrorCode[keyof typeof DaypartingErrorCode];

// =============================================================================
// 定数
// =============================================================================

/**
 * Dayparting関連定数
 */
export const DAYPARTING_CONSTANTS = {
  /** 1日の時間数 */
  HOURS_PER_DAY: 24,
  /** 1週間の日数 */
  DAYS_PER_WEEK: 7,
  /** デフォルト乗数 (変更なし) */
  DEFAULT_MULTIPLIER: 1.0,
  /** 乗数のステップ */
  MULTIPLIER_STEP: 0.05,
  /** 最小データポイント数 */
  MIN_DATA_POINTS: 10,
  /** 高信頼度の最小サンプル数 */
  HIGH_CONFIDENCE_MIN_SAMPLES: 100,
  /** 中信頼度の最小サンプル数 */
  MEDIUM_CONFIDENCE_MIN_SAMPLES: 50,
  /** 低信頼度の最小サンプル数 */
  LOW_CONFIDENCE_MIN_SAMPLES: 30,
  /** PEAK分類の相対パフォーマンス閾値 */
  PEAK_RELATIVE_THRESHOLD: 1.3,
  /** GOOD分類の相対パフォーマンス閾値 */
  GOOD_RELATIVE_THRESHOLD: 1.1,
  /** POOR分類の相対パフォーマンス閾値 */
  POOR_RELATIVE_THRESHOLD: 0.9,
  /** DEAD分類の相対パフォーマンス閾値 */
  DEAD_RELATIVE_THRESHOLD: 0.7,
} as const;

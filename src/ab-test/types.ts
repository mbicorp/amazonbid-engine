/**
 * A/Bテスト型定義
 *
 * 入札ロジックの変更を安全にテストするための型定義
 * テストグループとコントロールグループを比較して、
 * 統計的有意性に基づいて新ロジックの効果を評価する
 */

// =============================================================================
// 基本型
// =============================================================================

/**
 * A/Bテストのステータス
 */
export type ABTestStatus =
  | "DRAFT"      // 下書き（まだ開始していない）
  | "RUNNING"    // 実行中
  | "PAUSED"     // 一時停止
  | "COMPLETED"  // 完了（結果確定）
  | "CANCELLED"; // キャンセル

/**
 * 有効なA/Bテストステータス一覧
 */
export const VALID_AB_TEST_STATUSES: readonly ABTestStatus[] = [
  "DRAFT",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
] as const;

/**
 * 値がABTestStatusかどうかを判定
 */
export function isValidABTestStatus(value: unknown): value is ABTestStatus {
  return (
    typeof value === "string" &&
    VALID_AB_TEST_STATUSES.includes(value as ABTestStatus)
  );
}

/**
 * グループ割り当ての粒度
 *
 * - CAMPAIGN: キャンペーン単位で割り当て
 * - ASIN: 商品（ASIN）単位で割り当て
 * - KEYWORD: キーワード単位で割り当て
 */
export type AssignmentLevel = "CAMPAIGN" | "ASIN" | "KEYWORD";

/**
 * 有効な割り当て粒度一覧
 */
export const VALID_ASSIGNMENT_LEVELS: readonly AssignmentLevel[] = [
  "CAMPAIGN",
  "ASIN",
  "KEYWORD",
] as const;

/**
 * 値がAssignmentLevelかどうかを判定
 */
export function isValidAssignmentLevel(value: unknown): value is AssignmentLevel {
  return (
    typeof value === "string" &&
    VALID_ASSIGNMENT_LEVELS.includes(value as AssignmentLevel)
  );
}

/**
 * テストグループ
 */
export type TestGroup = "CONTROL" | "TEST";

/**
 * 有効なテストグループ一覧
 */
export const VALID_TEST_GROUPS: readonly TestGroup[] = [
  "CONTROL",
  "TEST",
] as const;

/**
 * 値がTestGroupかどうかを判定
 */
export function isValidTestGroup(value: unknown): value is TestGroup {
  return (
    typeof value === "string" &&
    VALID_TEST_GROUPS.includes(value as TestGroup)
  );
}

// =============================================================================
// 入札ロジックオーバーライド
// =============================================================================

/**
 * 入札エンジン設定のオーバーライド
 *
 * テストグループに適用する入札ロジックの変更
 * 各フィールドはオプションで、指定されたもののみ上書きされる
 */
export interface BidEngineOverrides {
  // ----- ACOS関連 -----
  /**
   * 目標ACOS乗数（現在の目標ACOSに掛ける）
   * 例: 1.1 = 10%緩和、0.9 = 10%厳格化
   */
  targetAcosMultiplier?: number;

  // ----- 閾値関連 -----
  /**
   * ACOS高すぎ判定の乗数（7日除外版）
   * デフォルト: 1.2
   */
  acosHighMultiplier7dExcl?: number;

  /**
   * ACOS高すぎ判定の乗数（30日版）
   * デフォルト: 1.05
   */
  acosHighMultiplier30d?: number;

  /**
   * NO_CONVERSION判定に必要な最小クリック数
   * デフォルト: 10
   */
  minClicksForDown?: number;

  /**
   * NO_CONVERSION判定の30日最大注文数
   * デフォルト: 1
   */
  noConversionMaxOrders30d?: number;

  // ----- 入札変動幅 -----
  /**
   * STRONG_UPアクションの変動率（0-1）
   * デフォルト: 0.3 (30%)
   */
  strongUpRate?: number;

  /**
   * MILD_UPアクションの変動率（0-1）
   * デフォルト: 0.15 (15%)
   */
  mildUpRate?: number;

  /**
   * MILD_DOWNアクションの変動率（0-1、負の値）
   * デフォルト: -0.15 (-15%)
   */
  mildDownRate?: number;

  /**
   * STRONG_DOWNアクションの変動率（0-1、負の値）
   * デフォルト: -0.30 (-30%)
   */
  strongDownRate?: number;

  // ----- E-Score関連 -----
  /**
   * E-Score重み付けを有効にするか
   */
  escoreWeightEnabled?: boolean;

  /**
   * E-Score重み乗数
   * デフォルト: 1.0
   */
  escoreWeightMultiplier?: number;

  // ----- ガードレール関連 -----
  /**
   * ガードレールモードのオーバーライド
   */
  guardrailsMode?: "OFF" | "SHADOW" | "ENFORCE";

  // ----- その他 -----
  /**
   * カスタムパラメータ（将来拡張用）
   */
  customParams?: Record<string, unknown>;
}

/**
 * BidEngineOverridesのデフォルト値（参照用）
 */
export const DEFAULT_BID_ENGINE_OVERRIDES: Required<Omit<BidEngineOverrides, "customParams">> = {
  targetAcosMultiplier: 1.0,
  acosHighMultiplier7dExcl: 1.2,
  acosHighMultiplier30d: 1.05,
  minClicksForDown: 10,
  noConversionMaxOrders30d: 1,
  strongUpRate: 0.3,
  mildUpRate: 0.15,
  mildDownRate: -0.15,
  strongDownRate: -0.30,
  escoreWeightEnabled: false,
  escoreWeightMultiplier: 1.0,
  guardrailsMode: "SHADOW",
};

// =============================================================================
// A/Bテスト設定
// =============================================================================

/**
 * A/Bテスト設定
 */
export interface ABTestConfig {
  /** テストID（UUID） */
  testId: string;

  /** テスト名 */
  name: string;

  /** テストの説明 */
  description: string;

  /** テストのステータス */
  status: ABTestStatus;

  /** グループ割り当ての粒度 */
  assignmentLevel: AssignmentLevel;

  /**
   * テストグループへの割り当て比率（0-1）
   * 例: 0.5 = 50%がテストグループ
   */
  testGroupRatio: number;

  /**
   * テストグループに適用するオーバーライド設定
   * コントロールグループは既存ロジックを使用
   */
  testOverrides: BidEngineOverrides;

  /**
   * 対象フィルター
   * 指定しない場合は全対象
   */
  targetFilters?: ABTestTargetFilters;

  /** テスト開始日 */
  startDate: Date;

  /** テスト終了予定日 */
  endDate: Date;

  /** 作成日時 */
  createdAt: Date;

  /** 更新日時 */
  updatedAt: Date;

  /** 作成者 */
  createdBy?: string;

  /** メモ・備考 */
  notes?: string;
}

/**
 * A/Bテスト対象フィルター
 */
export interface ABTestTargetFilters {
  /** 対象ASIN一覧（指定時のみフィルタ） */
  asins?: string[];

  /** 対象キャンペーンID一覧 */
  campaignIds?: string[];

  /** 対象ライフサイクルステート */
  lifecycleStates?: string[];

  /** 対象カテゴリ */
  categories?: string[];
}

// =============================================================================
// グループ割り当て
// =============================================================================

/**
 * A/Bテストグループ割り当て
 */
export interface ABTestAssignment {
  /** テストID */
  testId: string;

  /** 割り当てキー（campaignId / asin / keywordId） */
  assignmentKey: string;

  /** 割り当て粒度 */
  assignmentLevel: AssignmentLevel;

  /** 割り当てられたグループ */
  group: TestGroup;

  /** 割り当て日時 */
  assignedAt: Date;

  /** ハッシュ値（デバッグ用） */
  hashValue?: number;
}

// =============================================================================
// メトリクス
// =============================================================================

/**
 * A/Bテスト日次メトリクス
 */
export interface ABTestDailyMetrics {
  /** テストID */
  testId: string;

  /** 日付 */
  date: Date;

  /** グループ */
  group: TestGroup;

  /** インプレッション数 */
  impressions: number;

  /** クリック数 */
  clicks: number;

  /** コンバージョン数 */
  conversions: number;

  /** 売上 */
  sales: number;

  /** 広告費 */
  spend: number;

  /** CTR */
  ctr: number | null;

  /** CVR */
  cvr: number | null;

  /** ACOS */
  acos: number | null;

  /** ROAS */
  roas: number | null;

  /** 推奨生成数 */
  recommendationCount: number;

  /** 入札アップ数 */
  bidUpCount: number;

  /** 入札ダウン数 */
  bidDownCount: number;

  /** 変更なし数 */
  noChangeCount: number;

  /** 平均入札変動率 */
  avgBidChangePercent: number | null;
}

/**
 * A/Bテストメトリクス集計
 */
export interface ABTestMetricsAggregate {
  /** テストID */
  testId: string;

  /** グループ */
  group: TestGroup;

  /** 集計期間（日数） */
  periodDays: number;

  /** 合計インプレッション */
  totalImpressions: number;

  /** 合計クリック */
  totalClicks: number;

  /** 合計コンバージョン */
  totalConversions: number;

  /** 合計売上 */
  totalSales: number;

  /** 合計広告費 */
  totalSpend: number;

  /** 平均CTR */
  avgCtr: number | null;

  /** 平均CVR */
  avgCvr: number | null;

  /** 平均ACOS */
  avgAcos: number | null;

  /** 平均ROAS */
  avgRoas: number | null;

  /** 合計推奨数 */
  totalRecommendations: number;

  /** 合計入札アップ数 */
  totalBidUp: number;

  /** 合計入札ダウン数 */
  totalBidDown: number;

  /** サンプルサイズ（割り当て数） */
  sampleSize: number;
}

// =============================================================================
// 統計評価結果
// =============================================================================

/**
 * 統計的有意性の判定結果
 */
export type SignificanceLevel =
  | "NOT_SIGNIFICANT"  // 有意差なし
  | "SIGNIFICANT_95"   // 95%信頼水準で有意
  | "SIGNIFICANT_99";  // 99%信頼水準で有意

/**
 * t検定結果
 */
export interface TTestResult {
  /** t値 */
  tStatistic: number;

  /** p値 */
  pValue: number;

  /** 自由度 */
  degreesOfFreedom: number;

  /** 有意性レベル */
  significanceLevel: SignificanceLevel;

  /** 信頼区間（95%）の下限 */
  confidenceIntervalLower: number;

  /** 信頼区間（95%）の上限 */
  confidenceIntervalUpper: number;
}

/**
 * 効果量（Cohen's d）の解釈
 */
export type EffectSizeInterpretation =
  | "NEGLIGIBLE"  // 無視できる (|d| < 0.2)
  | "SMALL"       // 小 (0.2 <= |d| < 0.5)
  | "MEDIUM"      // 中 (0.5 <= |d| < 0.8)
  | "LARGE";      // 大 (|d| >= 0.8)

/**
 * 効果量結果
 */
export interface EffectSizeResult {
  /** Cohen's d */
  cohensD: number;

  /** 効果量の解釈 */
  interpretation: EffectSizeInterpretation;
}

/**
 * 単一指標の評価結果
 */
export interface MetricEvaluationResult {
  /** 指標名 */
  metricName: string;

  /** コントロールグループの平均 */
  controlMean: number;

  /** テストグループの平均 */
  testMean: number;

  /** コントロールグループの標準偏差 */
  controlStdDev: number;

  /** テストグループの標準偏差 */
  testStdDev: number;

  /** 差分（test - control） */
  difference: number;

  /** 差分率（%） */
  differencePercent: number;

  /** t検定結果 */
  tTest: TTestResult;

  /** 効果量 */
  effectSize: EffectSizeResult;

  /** 改善したか（positive = 改善の方向） */
  isImproved: boolean;
}

/**
 * A/Bテスト評価結果
 */
export interface ABTestEvaluationResult {
  /** テストID */
  testId: string;

  /** 評価日時 */
  evaluatedAt: Date;

  /** 評価期間（日数） */
  periodDays: number;

  /** コントロールグループのサンプルサイズ */
  controlSampleSize: number;

  /** テストグループのサンプルサイズ */
  testSampleSize: number;

  /** ACOS評価 */
  acosEvaluation: MetricEvaluationResult;

  /** ROAS評価 */
  roasEvaluation: MetricEvaluationResult;

  /** CVR評価 */
  cvrEvaluation: MetricEvaluationResult;

  /** 売上評価 */
  salesEvaluation: MetricEvaluationResult;

  /** 全体の推奨（勝者） */
  overallWinner: TestGroup | "INCONCLUSIVE";

  /** 推奨の根拠 */
  winnerReason: string;

  /** サンプルサイズが十分か */
  hasAdequateSampleSize: boolean;

  /** 最小必要サンプルサイズ */
  minRequiredSampleSize: number;

  /** 検出力（実現値） */
  achievedPower: number;

  /** 備考 */
  notes?: string;
}

// =============================================================================
// BigQuery保存用レコード
// =============================================================================

/**
 * BigQuery ab_tests テーブル用レコード
 */
export interface ABTestRecord {
  test_id: string;
  name: string;
  description: string;
  status: ABTestStatus;
  assignment_level: AssignmentLevel;
  test_group_ratio: number;
  test_overrides: string; // JSON文字列
  target_filters: string | null; // JSON文字列
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  created_by: string | null;
  notes: string | null;
}

/**
 * BigQuery ab_test_assignments テーブル用レコード
 */
export interface ABTestAssignmentRecord {
  test_id: string;
  assignment_key: string;
  assignment_level: AssignmentLevel;
  group: TestGroup;
  assigned_at: string; // ISO 8601
  hash_value: number | null;
}

/**
 * BigQuery ab_test_daily_metrics テーブル用レコード
 */
export interface ABTestDailyMetricsRecord {
  test_id: string;
  date: string; // YYYY-MM-DD
  group: TestGroup;
  impressions: number;
  clicks: number;
  conversions: number;
  sales: number;
  spend: number;
  ctr: number | null;
  cvr: number | null;
  acos: number | null;
  roas: number | null;
  recommendation_count: number;
  bid_up_count: number;
  bid_down_count: number;
  no_change_count: number;
  avg_bid_change_percent: number | null;
}

/**
 * BigQuery ab_test_evaluations テーブル用レコード
 */
export interface ABTestEvaluationRecord {
  test_id: string;
  evaluated_at: string; // ISO 8601
  period_days: number;
  control_sample_size: number;
  test_sample_size: number;
  acos_evaluation: string; // JSON文字列
  roas_evaluation: string; // JSON文字列
  cvr_evaluation: string; // JSON文字列
  sales_evaluation: string; // JSON文字列
  overall_winner: TestGroup | "INCONCLUSIVE";
  winner_reason: string;
  has_adequate_sample_size: boolean;
  min_required_sample_size: number;
  achieved_power: number;
  notes: string | null;
}

// =============================================================================
// エラーコード
// =============================================================================

/**
 * A/Bテスト関連のエラーコード
 */
export const ABTestErrorCode = {
  TEST_NOT_FOUND: "AB_TEST_NOT_FOUND",
  TEST_ALREADY_EXISTS: "AB_TEST_ALREADY_EXISTS",
  TEST_NOT_RUNNING: "AB_TEST_NOT_RUNNING",
  TEST_ALREADY_RUNNING: "AB_TEST_ALREADY_RUNNING",
  INVALID_DATE_RANGE: "AB_TEST_INVALID_DATE_RANGE",
  INVALID_RATIO: "AB_TEST_INVALID_RATIO",
  INSUFFICIENT_SAMPLE_SIZE: "AB_TEST_INSUFFICIENT_SAMPLE_SIZE",
  ASSIGNMENT_CONFLICT: "AB_TEST_ASSIGNMENT_CONFLICT",
  EVALUATION_FAILED: "AB_TEST_EVALUATION_FAILED",
} as const;

export type ABTestErrorCodeType = (typeof ABTestErrorCode)[keyof typeof ABTestErrorCode];

// =============================================================================
// 通知用データ
// =============================================================================

/**
 * A/Bテスト結果のSlack通知用データ
 */
export interface ABTestNotificationData {
  testId: string;
  testName: string;
  status: ABTestStatus;
  periodDays: number;
  controlSampleSize: number;
  testSampleSize: number;
  acosResult: {
    controlMean: number;
    testMean: number;
    differencePercent: number;
    isSignificant: boolean;
    isImproved: boolean;
  };
  roasResult: {
    controlMean: number;
    testMean: number;
    differencePercent: number;
    isSignificant: boolean;
    isImproved: boolean;
  };
  overallWinner: TestGroup | "INCONCLUSIVE";
  winnerReason: string;
  hasAdequateSampleSize: boolean;
}

// =============================================================================
// 定数
// =============================================================================

/**
 * A/Bテスト関連の定数
 */
export const AB_TEST_CONSTANTS = {
  /** デフォルトのテストグループ比率 */
  DEFAULT_TEST_GROUP_RATIO: 0.5,

  /** 最小サンプルサイズ（検出力80%、効果量0.3想定） */
  MIN_SAMPLE_SIZE_DEFAULT: 100,

  /** 有意水準（デフォルト: 0.05 = 95%信頼水準） */
  ALPHA_DEFAULT: 0.05,

  /** 検出力目標（デフォルト: 0.80 = 80%） */
  POWER_TARGET: 0.80,

  /** 最小テスト期間（日） */
  MIN_TEST_DURATION_DAYS: 7,

  /** 最大テスト期間（日） */
  MAX_TEST_DURATION_DAYS: 90,

  /** 効果量の閾値 */
  EFFECT_SIZE_THRESHOLDS: {
    SMALL: 0.2,
    MEDIUM: 0.5,
    LARGE: 0.8,
  },
} as const;

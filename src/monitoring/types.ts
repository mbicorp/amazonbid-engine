/**
 * 監視・アラート - 型定義
 *
 * 実行単位での「健康状態」を評価するための監視指標と
 * 異常判定のための閾値設定
 */

// =============================================================================
// 監視指標（Execution Health Metrics）
// =============================================================================

/**
 * 実行単位の監視指標
 *
 * BigQuery の keyword_recommendations_log から集計して計算
 */
export interface ExecutionHealthMetrics {
  // ----- 識別情報 -----
  /** 実行ID */
  executionId: string;

  /** 実行時刻 */
  executionTime: Date;

  /** 実行モード (SHADOW / APPLY) */
  mode: string;

  /** ガードレールモード (OFF / SHADOW / ENFORCE) */
  guardrailsMode: string | null;

  // ----- 基本カウント -----
  /** 処理対象キーワード数 */
  totalKeywords: number;

  /** 推奨を出したキーワード数 */
  totalRecommendations: number;

  /** 実際にAPIへ適用した件数 */
  totalApplied: number;

  /** APIエラーなどで失敗した件数 */
  totalApplyFailed: number;

  // ----- 変更方向 -----
  /** 強いUP判定の件数（bid_change_percent > 50%） */
  strongUpCount: number;

  /** 強いDOWN判定の件数（bid_change_percent < -30%） */
  strongDownCount: number;

  /** UP系全体の件数 */
  upCount: number;

  /** DOWN系全体の件数 */
  downCount: number;

  /** KEEP（変更なし）の件数 */
  keepCount: number;

  // ----- 比率指標 -----
  /** UP比率 (upCount / totalKeywords) */
  upRatio: number;

  /** DOWN比率 (downCount / totalKeywords) */
  downRatio: number;

  /** ガードレールクリップ比率 */
  guardrailsClippedRatio: number;

  /** 適用失敗比率 (totalApplyFailed / totalApplied) */
  applyFailedRatio: number;

  // ----- 入札変更統計 -----
  /** 平均の入札変更率 */
  avgBidChangeRatio: number;

  /** 最大の入札変更率 */
  maxBidChangeRatio: number;

  /** 最小の入札変更率（最大の下落） */
  minBidChangeRatio: number;

  // ----- 実行時間 -----
  /** 実行時間（秒） */
  executionDurationSec: number | null;
}

// =============================================================================
// アラート閾値設定
// =============================================================================

/**
 * アラート閾値設定
 *
 * これらの値を超えた場合に「異常」と判定
 */
export interface AlertThresholds {
  /** DOWN比率の上限（これを超えると異常） - デフォルト: 0.5 */
  maxDownRatio: number;

  /** UP比率の上限（これを超えると異常） - デフォルト: 0.5 */
  maxUpRatio: number;

  /** ガードレールクリップ比率の上限 - デフォルト: 0.3 */
  maxGuardrailsClippedRatio: number;

  /** 適用失敗比率の上限 - デフォルト: 0.2 */
  maxApplyFailedRatio: number;

  /** 適用失敗件数の絶対上限 - デフォルト: 10 */
  maxApplyFailedCount: number;

  /** 最大入札変更率の上限（倍率） - デフォルト: 3.0 (300%) */
  maxBidChangeRatio: number;

  /** 強いUP判定の閾値（入札変更率%） - デフォルト: 50 */
  strongUpThresholdPercent: number;

  /** 強いDOWN判定の閾値（入札変更率%） - デフォルト: -30 */
  strongDownThresholdPercent: number;
}

/**
 * デフォルトのアラート閾値
 */
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  maxDownRatio: 0.5,
  maxUpRatio: 0.5,
  maxGuardrailsClippedRatio: 0.3,
  maxApplyFailedRatio: 0.2,
  maxApplyFailedCount: 10,
  maxBidChangeRatio: 3.0,
  strongUpThresholdPercent: 50,
  strongDownThresholdPercent: -30,
};

// =============================================================================
// アラート設定
// =============================================================================

/**
 * アラート設定
 */
export interface AlertConfig {
  /** アラート機能の有効/無効 - デフォルト: true */
  enabled: boolean;

  /** アラート閾値 */
  thresholds: AlertThresholds;

  /** 正常時もサマリーを送信するか - デフォルト: true */
  sendSummaryOnSuccess: boolean;

  /** アラート送信先チャンネル（省略時はデフォルトチャンネル） */
  alertChannel?: string;
}

/**
 * デフォルトのアラート設定
 */
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  thresholds: DEFAULT_ALERT_THRESHOLDS,
  sendSummaryOnSuccess: true,
};

// =============================================================================
// アラート結果
// =============================================================================

/**
 * 検出された問題
 */
export interface DetectedIssue {
  /** 問題のコード */
  code: AlertIssueCode;

  /** 人間可読なメッセージ */
  message: string;

  /** 検出された値 */
  actualValue: number;

  /** 閾値 */
  threshold: number;
}

/**
 * 問題コード
 */
export type AlertIssueCode =
  | "DOWN_RATIO_HIGH"
  | "UP_RATIO_HIGH"
  | "GUARDRAILS_CLIPPED_HIGH"
  | "APPLY_FAILED_RATIO_HIGH"
  | "APPLY_FAILED_COUNT_HIGH"
  | "BID_CHANGE_RATIO_HIGH";

/**
 * アラート評価結果
 */
export interface AlertEvaluationResult {
  /** 異常が検出されたか */
  isAnomaly: boolean;

  /** 検出された問題の一覧 */
  issues: DetectedIssue[];

  /** 評価対象のメトリクス */
  metrics: ExecutionHealthMetrics;
}

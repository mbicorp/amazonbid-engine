/**
 * バックテスト機能 - 型定義
 *
 * 過去データを使って入札エンジンの成果をシミュレーションするための型定義
 */

import { ReasonCode } from "../logging";

// =============================================================================
// バックテスト設定
// =============================================================================

/**
 * バックテスト設定
 */
export interface BacktestConfig {
  /** 開始日（ISO形式 "2024-01-01"） */
  startDate: string;
  /** 終了日（ISO形式 "2024-01-31"） */
  endDate: string;
  /** 対象ASIN（省略時は全ASIN） */
  targetAsins?: string[];
  /** 対象キャンペーンID */
  targetCampaignIds?: string[];
  /** 集計粒度 */
  granularity: "DAILY" | "WEEKLY";
}

/**
 * バックテストパラメータ（シミュレーション計算用）
 */
export interface BacktestParameters {
  /**
   * 入札弾力性係数
   * 入札額の変化に対するインプレッションの変化率
   * 例: 0.5 → 入札10%増でインプレッション5%増
   */
  bidElasticity: number;

  /**
   * CPC変動係数
   * 入札増加時のCPC上昇率
   * 例: 0.3 → 入札10%増でCPC3%増
   */
  cpcChangeRatio: number;

  /**
   * CVR変動なしと仮定するか
   * true: CVRは一定と仮定（デフォルト）
   * false: 順位変動に応じてCVRも変化
   */
  assumeConstantCvr: boolean;
}

/**
 * デフォルトのバックテストパラメータ
 */
export const DEFAULT_BACKTEST_PARAMETERS: BacktestParameters = {
  bidElasticity: 0.5,
  cpcChangeRatio: 0.3,
  assumeConstantCvr: true,
};

// =============================================================================
// 過去データ（BigQueryから取得）
// =============================================================================

/**
 * 過去の入札推奨ログ（keyword_recommendations_logから取得）
 */
export interface HistoricalRecommendation {
  /** 推奨ID */
  recommendationId: string;
  /** 実行ID */
  executionId: string;
  /** 日付 */
  date: string;
  /** ASIN */
  asin: string;
  /** キーワードID */
  keywordId: string;
  /** キーワードテキスト */
  keywordText: string;
  /** マッチタイプ */
  matchType: string;
  /** キャンペーンID */
  campaignId: string;
  /** 広告グループID */
  adGroupId: string;

  /** 推奨時の入札額（旧） */
  oldBid: number;
  /** 推奨入札額（新） */
  newBid: number;
  /** 入札変更額 */
  bidChange: number;
  /** 入札変更率 */
  bidChangePercent: number;

  /** 目標ACOS */
  targetAcos: number;
  /** 現在ACOS */
  currentAcos: number | null;
  /** 理由コード */
  reasonCode: ReasonCode;
  /** 理由詳細 */
  reasonDetail: string;

  /** 実際に適用されたか */
  isApplied: boolean;
  /** 実際の入札額（適用後） */
  actualBid: number;
}

/**
 * 過去の実績データ（日別パフォーマンス）
 */
export interface HistoricalPerformance {
  /** 日付 */
  date: string;
  /** ASIN */
  asin: string;
  /** キーワードID */
  keywordId: string;
  /** キャンペーンID */
  campaignId: string;

  /** インプレッション */
  impressions: number;
  /** クリック数 */
  clicks: number;
  /** コンバージョン数 */
  conversions: number;
  /** 広告費 */
  spend: number;
  /** 広告売上 */
  sales: number;

  /** CTR */
  ctr: number | null;
  /** CVR */
  cvr: number | null;
  /** CPC */
  cpc: number | null;
  /** ACOS */
  acos: number | null;

  /** 平均入札額 */
  avgBid: number;
  /** 平均順位 */
  avgRank: number | null;
}

// =============================================================================
// シミュレーション結果
// =============================================================================

/**
 * シミュレーション結果（キーワード×日別）
 */
export interface SimulatedResult {
  /** 日付 */
  date: string;
  /** ASIN */
  asin: string;
  /** キーワードID */
  keywordId: string;
  /** キャンペーンID */
  campaignId: string;

  /** 実際の入札額 */
  actualBid: number;
  /** 推奨入札額 */
  recommendedBid: number;
  /** 入札変更率 */
  bidChangeRate: number;

  /** 実績値 */
  actual: {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    acos: number | null;
  };

  /** シミュレーション値 */
  simulated: {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    sales: number;
    acos: number | null;
  };

  /** 判定精度 */
  decision: {
    action: string;
    wasCorrect: boolean;
    correctnessReason: string;
  };
}

/**
 * 日別集計結果
 */
export interface DailyAggregate {
  /** 日付 */
  date: string;

  /** 実績値 */
  actual: {
    spend: number;
    sales: number;
    conversions: number;
    acos: number | null;
    roas: number | null;
  };

  /** シミュレーション値 */
  simulated: {
    spend: number;
    sales: number;
    conversions: number;
    acos: number | null;
    roas: number | null;
  };

  /** 判定数 */
  decisionsCount: number;
  /** 正解数 */
  correctDecisions: number;
}

// =============================================================================
// バックテスト結果
// =============================================================================

/**
 * アクション別精度
 */
export interface ActionAccuracy {
  /** 総判定数 */
  total: number;
  /** 正解数 */
  correct: number;
  /** 正解率 */
  rate: number;
}

/**
 * 判定精度
 */
export interface DecisionAccuracy {
  /** 総判定数 */
  totalDecisions: number;
  /** 正解数 */
  correctDecisions: number;
  /** 正解率 */
  accuracyRate: number;
  /** アクション別精度 */
  byAction: {
    STRONG_UP: ActionAccuracy;
    MILD_UP: ActionAccuracy;
    KEEP: ActionAccuracy;
    MILD_DOWN: ActionAccuracy;
    STRONG_DOWN: ActionAccuracy;
    STOP: ActionAccuracy;
  };
}

/**
 * 期間サマリー
 */
export interface PeriodSummary {
  /** 開始日 */
  start: string;
  /** 終了日 */
  end: string;
  /** 日数 */
  days: number;
}

/**
 * 実績/シミュレーション値のサマリー
 */
export interface PerformanceSummary {
  /** 総広告費 */
  totalSpend: number;
  /** 総広告売上 */
  totalSales: number;
  /** 総コンバージョン数 */
  totalOrders: number;
  /** ACOS */
  acos: number;
  /** ROAS */
  roas: number;
}

/**
 * 改善率サマリー
 */
export interface ImprovementSummary {
  /** 広告費差分（円） */
  spendDiff: number;
  /** 広告費差分率（%） */
  spendDiffPercent: number;
  /** ACOS差分（ポイント） */
  acosDiff: number;
  /** ROAS差分 */
  roasDiff: number;
  /** 推定利益改善額 */
  estimatedProfitGain: number;
}

/**
 * バックテスト結果
 */
export interface BacktestResult {
  /** 実行ID */
  executionId: string;
  /** 設定 */
  config: BacktestConfig;
  /** 期間サマリー */
  period: PeriodSummary;

  /** 実績値 */
  actual: PerformanceSummary;
  /** シミュレーション値 */
  simulated: PerformanceSummary;
  /** 改善率 */
  improvement: ImprovementSummary;

  /** 判定精度 */
  accuracy: DecisionAccuracy;

  /** 日別/週別詳細 */
  timeSeries: BacktestTimeSeriesEntry[];

  /** メタデータ */
  meta: {
    /** 実行開始時刻 */
    startedAt: string;
    /** 実行完了時刻 */
    completedAt: string;
    /** 処理時間（ミリ秒） */
    durationMs: number;
    /** 処理したキーワード数 */
    keywordsProcessed: number;
    /** 処理した推奨数 */
    recommendationsProcessed: number;
  };
}

/**
 * 時系列エントリ
 */
export interface BacktestTimeSeriesEntry {
  /** 日付 */
  date: string;
  /** 実績広告費 */
  actualSpend: number;
  /** 実績広告売上 */
  actualSales: number;
  /** 実績ACOS */
  actualAcos: number | null;
  /** シミュレーション広告費 */
  simulatedSpend: number;
  /** シミュレーション広告売上 */
  simulatedSales: number;
  /** シミュレーションACOS */
  simulatedAcos: number | null;
  /** 判定数 */
  decisions: number;
  /** 正解数 */
  correctDecisions: number;
}

// =============================================================================
// バックテスト実行一覧
// =============================================================================

/**
 * バックテスト実行サマリー（一覧表示用）
 */
export interface BacktestExecutionSummary {
  /** 実行ID */
  executionId: string;
  /** 開始日 */
  startDate: string;
  /** 終了日 */
  endDate: string;
  /** 対象ASIN数 */
  asinCount: number;
  /** 実績ACOS */
  actualAcos: number;
  /** シミュレーションACOS */
  simulatedAcos: number;
  /** ACOS改善（ポイント） */
  acosDiff: number;
  /** 推定利益改善額 */
  estimatedProfitGain: number;
  /** 判定正解率 */
  accuracyRate: number;
  /** 実行日時 */
  createdAt: string;
}

// =============================================================================
// Slack通知用
// =============================================================================

/**
 * バックテスト完了通知用データ
 */
export interface BacktestNotificationData {
  /** 実行ID */
  executionId: string;
  /** 期間 */
  period: {
    start: string;
    end: string;
    days: number;
  };
  /** 実績 vs シミュレーション */
  comparison: {
    actualSpend: number;
    simulatedSpend: number;
    spendDiffPercent: number;
    actualAcos: number;
    simulatedAcos: number;
    acosDiff: number;
    estimatedProfitGain: number;
  };
  /** 判定精度 */
  accuracy: {
    total: number;
    correct: number;
    rate: number;
  };
}

// =============================================================================
// エラー型
// =============================================================================

/**
 * バックテストエラーコード
 */
export const BacktestErrorCode = {
  /** データ不足 */
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  /** 無効な期間 */
  INVALID_PERIOD: "INVALID_PERIOD",
  /** 設定エラー */
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  /** BigQueryエラー */
  BIGQUERY_ERROR: "BIGQUERY_ERROR",
} as const;

export type BacktestErrorCodeType =
  (typeof BacktestErrorCode)[keyof typeof BacktestErrorCode];

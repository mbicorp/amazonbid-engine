/**
 * 季節性予測による先行入札調整機能 - 型定義
 *
 * Jungle Scoutの検索ボリューム履歴データを活用し、
 * 季節的なピークを予測してピーク到来前に入札を調整する機能
 */

// =============================================================================
// Seasonality Mode（実行モード）
// =============================================================================

/**
 * 季節性調整の実行モード
 */
export type SeasonalityMode =
  | "SHADOW" // ログ出力のみ、実際の入札調整は行わない
  | "APPLY"; // 実際に入札調整を適用

// =============================================================================
// Data Source（データソース）
// =============================================================================

/**
 * 予測データのソース
 */
export type SeasonalityDataSource =
  | "JS_ONLY" // Jungle Scoutデータのみ
  | "CATEGORY_HINT" // カテゴリヒントのみ（JSデータ不足時）
  | "COMBINED"; // 両方を統合

// =============================================================================
// Peak Info（ピーク情報）
// =============================================================================

/**
 * 検出されたピーク情報
 */
export interface PeakInfo {
  /** ピーク月（1-12） */
  month: number;

  /** 信頼度（0-1） */
  confidence: number;

  /** 予測されたピーク日（現在年ベース） */
  predictedPeakDate: Date;

  /** このピークはカテゴリヒント由来か */
  fromCategoryHint: boolean;

  /** 平均検索ボリュームからの上昇率（例: 1.5 = 50%増） */
  volumeMultiplier: number;
}

// =============================================================================
// Monthly Volume Stats（月別検索ボリューム統計）
// =============================================================================

/**
 * 月別検索ボリューム統計
 */
export interface MonthlyVolumeStats {
  /** 月（1-12） */
  month: number;

  /** 平均検索ボリューム */
  avgVolume: number;

  /** 標準偏差 */
  stdDev: number;

  /** サンプル数（何年分のデータがあるか） */
  sampleCount: number;
}

// =============================================================================
// Seasonality Prediction（季節性予測）
// =============================================================================

/**
 * キーワードに対する季節性予測結果
 */
export interface SeasonalityPrediction {
  // ----- 識別情報 -----
  /** キーワード */
  keyword: string;

  /** ASIN（オプション） */
  asin?: string;

  // ----- ピーク情報 -----
  /** 検出されたピーク一覧（年間複数ピーク対応） */
  predictedPeaks: PeakInfo[];

  /** 次のピークまでの日数（null = ピークなし） */
  daysUntilNextPeak: number | null;

  /** 現在Pre-peak期間中か */
  isPrePeakPeriod: boolean;

  // ----- 調整情報 -----
  /** 現在の推奨入札倍率（1.0 = 調整なし） */
  currentMultiplier: number;

  /** 調整理由 */
  adjustmentReason: string;

  // ----- データソース情報 -----
  /** データソース */
  dataSource: SeasonalityDataSource;

  /** カテゴリヒント（使用された場合） */
  categoryHint?: string;

  /** 総合信頼度スコア（0-1） */
  confidenceScore: number;

  // ----- 生データ -----
  /** 月別検索ボリューム統計 */
  monthlyStats: MonthlyVolumeStats[];

  /** ベースライン検索ボリューム（全月平均） */
  baselineVolume: number;

  // ----- メタ情報 -----
  /** 予測生成日時 */
  generatedAt: Date;

  /** 予測有効期限 */
  expiresAt: Date;
}

// =============================================================================
// Seasonality Adjustment（入札調整結果）
// =============================================================================

/**
 * bidEngineに渡す入札調整結果
 */
export interface SeasonalityAdjustment {
  /** 適用すべき入札倍率（1.0 = 調整なし） */
  multiplier: number;

  /** 実際に適用されたか（SHADOW時はfalse） */
  applied: boolean;

  /** モード */
  mode: SeasonalityMode;

  /** 元の推奨入札額 */
  originalBid: number;

  /** 調整後の入札額 */
  adjustedBid: number;

  /** 調整額の上限キャップが適用されたか */
  cappedByMaxBid: boolean;

  /** LTV制限が適用されたか */
  cappedByLtv: boolean;

  /** 在庫制限が適用されたか */
  cappedByInventory: boolean;

  /** 調整理由の詳細 */
  reason: string;

  /** 予測情報（ログ用） */
  prediction: SeasonalityPrediction | null;
}

// =============================================================================
// Category Hint（カテゴリヒント）
// =============================================================================

/**
 * サプリメントカテゴリのピークヒント
 */
export interface CategoryHint {
  /** カテゴリ識別子 */
  category: string;

  /** 期待されるピーク月（1-12の配列） */
  expectedPeakMonths: number[];

  /** 日本語説明 */
  description: string;

  /** ヒントの信頼度（0-1） */
  confidence: number;
}

// =============================================================================
// Seasonality Config（設定）
// =============================================================================

/**
 * 季節性予測機能の設定
 */
export interface SeasonalityConfig {
  // ----- Feature Flags -----
  /** 機能有効化 */
  enabled: boolean;

  /** 実行モード */
  mode: SeasonalityMode;

  /** イベントオーバーライド（S-MODE）中は無効化 */
  disableDuringEventOverride: boolean;

  // ----- Pre-peak期間設定 -----
  /** Pre-peak期間開始（ピークの何日前から） */
  prePeakDaysMin: number;

  /** Pre-peak期間終了（ピークの何日前まで） */
  prePeakDaysMax: number;

  // ----- 入札調整設定 -----
  /** 最大入札倍率（例: 1.3 = 30%増） */
  maxMultiplier: number;

  /** 最小信頼度閾値（これ未満は調整しない） */
  confidenceThreshold: number;

  // ----- ピーク検出設定 -----
  /** ピーク判定の標準偏差倍率（baselineからの乖離） */
  peakStdDevMultiplier: number;

  /** 最小サンプル数（月別データ） */
  minSampleCount: number;

  // ----- カテゴリヒント設定 -----
  /** カテゴリヒントを使用するか */
  useCategoryHints: boolean;

  /** カテゴリヒントのみの場合の重み（0-1） */
  categoryHintOnlyWeight: number;

  /** JSデータとカテゴリヒントの統合時のJS重み（0-1） */
  jsDataWeight: number;

  // ----- データ更新設定 -----
  /** 予測の有効期間（日） */
  predictionValidityDays: number;

  /** Jungle Scoutデータの取得期間（月） */
  jsLookbackMonths: number;
}

/**
 * デフォルトの設定値
 */
export const DEFAULT_SEASONALITY_CONFIG: SeasonalityConfig = {
  // Feature Flags
  enabled: false,
  mode: "SHADOW",
  disableDuringEventOverride: true,

  // Pre-peak期間設定
  prePeakDaysMin: 7,
  prePeakDaysMax: 30,

  // 入札調整設定
  maxMultiplier: 1.3,
  confidenceThreshold: 0.6,

  // ピーク検出設定
  peakStdDevMultiplier: 1.5,
  minSampleCount: 2,

  // カテゴリヒント設定
  useCategoryHints: true,
  categoryHintOnlyWeight: 0.7,
  jsDataWeight: 0.7,

  // データ更新設定
  predictionValidityDays: 7,
  jsLookbackMonths: 24,
};

// =============================================================================
// BigQuery Row Types
// =============================================================================

/**
 * seasonality_predictions テーブルの行
 */
export interface SeasonalityPredictionRow {
  /** キーワード */
  keyword: string;

  /** ASIN */
  asin: string | null;

  /** 検出されたピーク（JSON配列） */
  predicted_peaks: string; // JSON: Array<{month: number, confidence: number}>

  /** 現在の入札倍率 */
  current_multiplier: number;

  /** Pre-peak期間中か */
  is_pre_peak_period: boolean;

  /** 次のピークまでの日数 */
  days_until_peak: number | null;

  /** カテゴリヒント */
  category_hint: string | null;

  /** データソース */
  data_source: string;

  /** 信頼度スコア */
  confidence_score: number;

  /** 予測生成日時 */
  generated_at: Date;

  /** 最終更新日時 */
  last_updated: Date;

  /** 有効期限 */
  expires_at: Date;

  /** 月別ボリューム統計（JSON） */
  monthly_stats: string; // JSON: Array<MonthlyVolumeStats>

  /** ベースラインボリューム */
  baseline_volume: number;

  /** 調整理由 */
  adjustment_reason: string;
}

// =============================================================================
// Job Result Types（ジョブ結果）
// =============================================================================

/**
 * 季節性更新ジョブの実行結果
 */
export interface SeasonalityJobResult {
  /** 実行ID */
  executionId: string;

  /** 成功/失敗 */
  success: boolean;

  /** 処理統計 */
  stats: SeasonalityJobStats;

  /** エラーメッセージ（失敗時） */
  errorMessage?: string;

  /** 処理時間（ミリ秒） */
  processingTimeMs: number;
}

/**
 * 季節性更新ジョブの統計
 */
export interface SeasonalityJobStats {
  /** 処理したキーワード数 */
  totalKeywordsProcessed: number;

  /** Jungle Scoutからデータ取得成功 */
  jsDataFetched: number;

  /** Jungle Scoutデータ取得失敗（レート制限等） */
  jsDataFailed: number;

  /** カテゴリヒントのみで予測 */
  categoryHintOnly: number;

  /** 予測生成数 */
  predictionsGenerated: number;

  /** Pre-peak期間のキーワード数 */
  prePeakKeywords: number;

  /** 信頼度不足でスキップ */
  lowConfidenceSkipped: number;
}

// =============================================================================
// HTTP Handler Types
// =============================================================================

/**
 * 季節性更新ジョブのオプション
 */
export interface RunSeasonalityJobOptions {
  /** BigQueryプロジェクトID */
  projectId: string;

  /** BigQueryデータセット */
  dataset: string;

  /** 対象キーワードの制限（デバッグ用） */
  keywordLimit?: number;

  /** 強制更新（有効期限内でも更新） */
  forceRefresh?: boolean;

  /** 設定オーバーライド */
  configOverride?: Partial<SeasonalityConfig>;
}

/**
 * アクティブな調整一覧取得のフィルタ
 */
export interface ActiveAdjustmentsFilter {
  /** ASINでフィルタ */
  asin?: string;

  /** 最小倍率でフィルタ */
  minMultiplier?: number;

  /** 最大件数 */
  limit?: number;

  /** オフセット */
  offset?: number;
}

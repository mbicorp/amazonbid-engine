/**
 * 自適応型Eスコア最適化システム - 型定義
 */

// =============================================================================
// 基本型
// =============================================================================

export type OperationMode = "NORMAL" | "S_MODE";
export type BrandCategory = "BRAND" | "CONQUEST" | "GENERIC";
export type Season = "Q1" | "Q2" | "Q3" | "Q4";
export type SuccessLevel = "EXCELLENT" | "GOOD" | "ACCEPTABLE" | "POOR";
export type ActionType = "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP";

// =============================================================================
// Eスコア関連
// =============================================================================

/**
 * Eスコアの重み設定
 */
export interface EScoreWeights {
  /** 成果スコアの重み (0-1) */
  performance: number;
  /** 効率スコアの重み (0-1) */
  efficiency: number;
  /** ポテンシャルスコアの重み (0-1) */
  potential: number;
}

/**
 * Eスコア計算に使用する各スコア
 */
export interface EScoreComponents {
  /** 成果スコア (0-100) - 売上、クリック数等 */
  performanceScore: number;
  /** 効率スコア (0-100) - ACOS、CVR等 */
  efficiencyScore: number;
  /** ポテンシャルスコア (0-100) - 成長余地、競合状況等 */
  potentialScore: number;
}

/**
 * Eスコアランク
 */
export type EScoreRank = "S" | "A" | "B" | "C" | "D";

/**
 * Eスコア計算結果
 */
export interface EScoreResult {
  /** 総合Eスコア (0-100) */
  score: number;
  /** ランク */
  rank: EScoreRank;
  /** 各成分スコア */
  components: EScoreComponents;
  /** 使用した重み */
  weights: EScoreWeights;
}

// =============================================================================
// フィードバックデータ
// =============================================================================

/**
 * 推奨実行前のメトリクス（スナップショット）
 */
export interface MetricsSnapshot {
  cvr: number;
  ctr: number;
  acos: number;
  sales: number;
  clicks: number;
  impressions: number;
  rank: number | null;
  bid: number;
}

/**
 * フィードバックレコード - BigQueryに保存
 */
export interface FeedbackRecord {
  /** ユニークID */
  feedback_id: string;
  /** 推奨実行ID */
  execution_id: string;
  /** キーワードID */
  keyword_id: string;
  /** キャンペーンID */
  campaign_id: string;
  /** 広告グループID */
  ad_group_id: string;

  /** 推奨時刻 */
  recommendation_timestamp: Date;
  /** 評価時刻（3時間後） */
  evaluation_timestamp: Date;

  /** 動作モード */
  mode: OperationMode;
  /** ブランドカテゴリ */
  brand_type: BrandCategory;
  /** 季節 */
  season: Season;

  /** 算出時のEスコア */
  e_score: number;
  /** 予測ランク */
  predicted_rank: EScoreRank;
  /** 各成分スコア */
  performance_score: number;
  efficiency_score: number;
  potential_score: number;

  /** 使用した重み */
  weight_performance: number;
  weight_efficiency: number;
  weight_potential: number;

  /** 実行アクション */
  action_taken: ActionType;
  /** 変更率 */
  change_rate: number;

  /** 実行前メトリクス */
  cvr_before: number;
  ctr_before: number;
  acos_before: number;
  sales_before: number;
  clicks_before: number;
  bid_before: number;

  /** 実行後メトリクス（3時間後） */
  cvr_after: number | null;
  ctr_after: number | null;
  acos_after: number | null;
  sales_after: number | null;
  clicks_after: number | null;
  bid_after: number | null;

  /** 評価結果 */
  success_level: SuccessLevel | null;
  success_score: number | null;

  /** 評価済みフラグ */
  evaluated: boolean;
}

// =============================================================================
// 重み最適化
// =============================================================================

/**
 * 重みの制約条件
 */
export interface WeightConstraints {
  /** 各重みの許容範囲 */
  bounds: {
    performance: { min: number; max: number };
    efficiency: { min: number; max: number };
    potential: { min: number; max: number };
  };
  /** 1回の更新での最大変動幅 */
  maxDeltaPerUpdate: number;
}

/**
 * 学習済み重み設定
 */
export interface LearnedWeights {
  /** 現在の重み */
  weights: EScoreWeights;
  /** 初期重み */
  initialWeights: EScoreWeights;
  /** 学習に使用したデータ数 */
  dataCount: number;
  /** 最終更新日時 */
  lastUpdated: Date;
  /** 予測精度（成功率） */
  accuracy: number;
  /** バージョン */
  version: number;
}

/**
 * モード別・カテゴリ別の重み設定
 */
export interface AdaptiveWeightConfig {
  /** モード別重み */
  byMode: {
    NORMAL: LearnedWeights;
    S_MODE: LearnedWeights;
  };
  /** ブランドタイプ別重み */
  byBrandType: {
    BRAND: LearnedWeights;
    CONQUEST: LearnedWeights;
    GENERIC: LearnedWeights;
  };
  /** 季節別重み */
  bySeason: {
    Q1: LearnedWeights;
    Q2: LearnedWeights;
    Q3: LearnedWeights;
    Q4: LearnedWeights;
  };
}

/**
 * 重み最適化の結果
 */
export interface OptimizationResult {
  /** 最適化前の重み */
  previousWeights: EScoreWeights;
  /** 最適化後の重み */
  newWeights: EScoreWeights;
  /** 変化量 */
  delta: EScoreWeights;
  /** 使用したデータ数 */
  dataCount: number;
  /** 最適化前の精度 */
  previousAccuracy: number;
  /** 予測精度 */
  estimatedAccuracy: number;
  /** 最適化タイムスタンプ */
  optimizedAt: Date;
}

// =============================================================================
// ロールバック関連
// =============================================================================

/**
 * 重み履歴（ロールバック用）
 */
export interface WeightHistory {
  /** 履歴ID */
  history_id: string;
  /** 対象（mode, brand_type, season など） */
  target_type: "mode" | "brand_type" | "season";
  /** 対象の値 */
  target_value: string;
  /** 重み */
  weights: EScoreWeights;
  /** 精度 */
  accuracy: number;
  /** データ数 */
  data_count: number;
  /** 保存日時 */
  saved_at: Date;
  /** ロールバック済みフラグ */
  rolled_back: boolean;
}

/**
 * ロールバック閾値設定
 */
export interface RollbackThresholds {
  /** 成功率低下の閾値 */
  successRateDrop: number;
  /** ACOS悪化の閾値 */
  acosDegradation: number;
  /** 監視期間（時間） */
  monitoringPeriodHours: number;
}

// =============================================================================
// 統計情報
// =============================================================================

/**
 * 最適化統計
 */
export interface OptimizationStats {
  /** 総最適化回数 */
  totalOptimizations: number;
  /** 成功した最適化回数 */
  successfulOptimizations: number;
  /** ロールバック回数 */
  rollbackCount: number;
  /** 平均精度改善 */
  avgAccuracyImprovement: number;
  /** 最高精度 */
  bestAccuracy: number;
  /** 総処理データ数 */
  totalDataProcessed: number;
}

// =============================================================================
// 設定
// =============================================================================

/**
 * 自適応Eスコアシステムの設定
 */
export interface AdaptiveEScoreConfig {
  /** 学習率 */
  learningRate: number;
  /** 最小学習データ数 */
  minDataForLearning: number;
  /** 学習に使用する期間（日） */
  learningWindowDays: number;
  /** 重みの制約 */
  constraints: WeightConstraints;
  /** ロールバック閾値 */
  rollbackThresholds: RollbackThresholds;
  /** デフォルト重み（フォールバック用） */
  defaultWeights: {
    NORMAL: EScoreWeights;
    S_MODE: EScoreWeights;
  };
  /** Eスコアランク閾値 */
  rankThresholds: {
    S: number; // 80以上
    A: number; // 60以上
    B: number; // 40以上
    C: number; // 20以上
    // D: 20未満
  };
}

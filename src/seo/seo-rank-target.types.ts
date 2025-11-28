/**
 * SEO目標順位（SEO Target Rank）関連 - 型定義
 *
 * キーワードクラスタごとの理想順位と運用目標順位を管理するための型定義
 */

// =============================================================================
// RankTargetConfig - キーワードクラスタ単位の目標順位設定
// =============================================================================

/**
 * キーワードクラスタ単位の目標順位設定
 *
 * ProductProfileConfigのdefaultRankTargetConfigからデフォルト値を継承し、
 * クラスタ単位でオーバーライド可能
 */
export interface RankTargetConfig {
  /**
   * 理想目標順位
   * 原則1（1位）を設定。特定クラスタで非現実的な場合のみ変更可能
   */
  idealRank: number;

  /**
   * 運用上の目標順位
   * 初期値はidealRankと同じ。データに基づき段階的に下げていく
   * ツールは直接変更せず、提案として出力し、人間が承認して変更する
   */
  targetRank: number;

  /**
   * 許容誤差（順位）
   * 例: 1〜2。targetRank=5、rankTolerance=2なら、3〜7位が許容範囲
   */
  rankTolerance: number;
}

/**
 * RankTargetConfigのデフォルト値
 */
export const DEFAULT_RANK_TARGET_CONFIG: RankTargetConfig = {
  idealRank: 1,
  targetRank: 1,
  rankTolerance: 2,
};

// =============================================================================
// SeoProgressMetrics - SEO進捗メトリクス
// =============================================================================

/**
 * キーワードクラスタ単位のSEO進捗メトリクス
 *
 * 「運用上のtargetRankにどれだけ近づいているか」を評価する
 */
export interface SeoProgressMetrics {
  /**
   * クラスタ識別子
   * 既存のクラスタ識別子に合わせる
   */
  clusterId: string;

  /**
   * 商品識別子（ASIN）
   */
  productId: string;

  /**
   * 代表キーワードのオーガニック順位
   * 直近30日または90日ベースの中央値
   */
  organicRank: number;

  /**
   * Share of Voice（パーセントで表現）
   * 同期間の平均値。0-100の範囲
   */
  sov: number;

  /**
   * 運用上の目標順位（RankTargetConfig.targetRank）
   */
  targetRank: number;

  /**
   * 許容誤差（RankTargetConfig.rankTolerance）
   */
  rankTolerance: number;

  /**
   * SEO進捗スコア
   * 0〜約1.5程度の範囲
   * - ≒1.0: ちょうど目標レベル
   * - >1.1〜1.2: 目標以上に取れている（上振れ）
   * - <0.7: まだ目標から遠い
   */
  seoProgressScore: number;

  /**
   * 順位コンポーネントスコア（内訳）
   */
  rankScoreComponent: number;

  /**
   * SOVコンポーネントスコア（内訳）
   */
  sovScoreComponent: number;

  /**
   * 計算日時
   */
  calculatedAt: Date;
}

// =============================================================================
// SeoProgressConfig - SEO進捗計算の設定
// =============================================================================

/**
 * SEO進捗計算の設定パラメータ
 */
export interface SeoProgressConfig {
  /**
   * 目標SOV（Share of Voice）
   * パーセントで表現（例: 5 = 5%）
   */
  targetSov: number;

  /**
   * SOV許容誤差
   */
  sovTolerance: number;

  /**
   * 順位の重み（wRank）
   */
  rankWeight: number;

  /**
   * SOVの重み（wSov）
   */
  sovWeight: number;

  /**
   * ルックバック日数（データ集計期間）
   */
  lookbackDays: number;

  /**
   * SEO進捗スコアの低い閾値
   * これ以下で「まだ目標から遠い」と判断
   */
  seoProgressLowThreshold: number;

  /**
   * SEO進捗スコアの高い閾値
   * これ以上で「目標以上に取れている」と判断
   */
  seoProgressHighThreshold: number;

  /**
   * TACOS調整におけるSEO進捗の影響度
   */
  seoInfluenceOnTacosTarget: number;
}

/**
 * SEO進捗計算のデフォルト設定
 */
export const DEFAULT_SEO_PROGRESS_CONFIG: SeoProgressConfig = {
  targetSov: 5, // 5%
  sovTolerance: 2,
  rankWeight: 0.6,
  sovWeight: 0.4,
  lookbackDays: 90,
  seoProgressLowThreshold: 0.7,
  seoProgressHighThreshold: 1.1,
  seoInfluenceOnTacosTarget: 0.1,
};

// =============================================================================
// RankAdjustmentSuggestion - 目標順位ダウン提案
// =============================================================================

/**
 * 目標順位ダウン提案の理由コード
 */
export type RankAdjustmentReasonCode =
  | "UNREALISTIC_FOR_IDEAL" // 理想1位に対して無理筋気味
  | "STABLE_ABOVE_TARGET"; // 目標以上で安定（保守側に寄せる余地あり）

/**
 * 目標順位の調整提案
 *
 * 目標順位を下げた方が良さそうなクラスタについて、
 * 提案情報を構造化して出力
 */
export interface RankAdjustmentSuggestion {
  /**
   * 商品識別子（ASIN）
   */
  productId: string;

  /**
   * クラスタ識別子
   */
  clusterId: string;

  /**
   * 理想目標順位
   */
  idealRank: number;

  /**
   * 現在の運用目標順位
   */
  currentTargetRank: number;

  /**
   * 提案する運用目標順位
   */
  suggestedTargetRank: number;

  /**
   * 提案理由コード
   */
  reasonCode: RankAdjustmentReasonCode;

  /**
   * 人間が読める短い日本語メッセージ
   */
  explanation: string;

  /**
   * 判定に使用したメトリクス
   */
  metrics: {
    /** 直近90日のオーガニック順位中央値 */
    medianOrganicRank90d: number;
    /** 直近90日のSEO進捗スコア */
    seoProgressScore90d: number;
    /** 累積赤字の上限に対する消化率 */
    lossUsageRatio: number;
    /** TACOS ORANGE+REDゾーンの割合 */
    unhealthyTacosRatio: number;
    /** TACOS不健全月数（連続） */
    unhealthyTacosMonths?: number;
  };

  /**
   * 提案生成日時
   */
  suggestedAt: Date;

  /**
   * 使用した商品LTVプロファイル（ログ用）
   */
  productLtvProfile?: ProductLtvProfile;

  /**
   * 使用した設定の識別子（ログ用）
   * productLtvProfileが設定されていれば同じ値、未設定なら"DEFAULT"
   */
  rankAdjustmentProfileConfigName?: string;
}

// =============================================================================
// RankAdjustmentConfig - 目標順位調整の判定設定
// =============================================================================

/**
 * 目標順位調整の判定設定
 */
export interface RankAdjustmentConfig {
  /**
   * 無理筋判定のルックバック日数（evaluationPeriodDays相当）
   */
  lookbackDays: number;

  /**
   * 順位ギャップ閾値
   * medianOrganicRank90d > idealRank + rankGapThreshold で無理筋気味と判定
   */
  rankGapThreshold: number;

  /**
   * SEO進捗スコア下限（seoProgressThreshold相当）
   * seoProgressScore90d < seoProgressLowerBound で無理筋気味と判定
   */
  seoProgressLowerBound: number;

  /**
   * 累積赤字消化率閾値
   * lossUsageRatio >= lossUsageThreshold で無理筋気味と判定
   */
  lossUsageThreshold: number;

  /**
   * TACOS不健全割合閾値（後方互換用）
   * unhealthyTacosRatio >= unhealthyTacosThreshold で無理筋気味と判定
   * @deprecated unhealthyTacosMonthsを使用してください
   */
  unhealthyTacosThreshold: number;

  /**
   * TACOS不健全月数閾値
   * TACOSがRED/ORANGEの月がこの月数以上連続したら「TACOS不健全継続」と判定
   * lookbackDays=90の場合、3ヶ月分のデータから連続月数を計算
   */
  unhealthyTacosMonths?: number;

  /**
   * 最小判定条件数
   * この数以上の条件を満たした場合に無理筋と判定
   */
  minConditionsToTrigger: number;

  /**
   * suggestedTargetRankの算出ルール
   * organicRank の範囲に対して推奨するtargetRank
   */
  suggestedRankRules: SuggestedRankRule[];

  /**
   * 目標順位ダウン提案時の下げ幅
   * 例: 2の場合、1位→3位、3位→5位
   * @default 2
   */
  suggestedRankStep?: number;
}

/**
 * suggestedTargetRankの算出ルール
 */
export interface SuggestedRankRule {
  /** organicRankの下限（この値以上） */
  organicRankMin: number;
  /** organicRankの上限（この値以下） */
  organicRankMax: number;
  /** 推奨するtargetRank */
  suggestedTargetRank: number;
}

/**
 * 目標順位調整のデフォルト設定（SUPPLEMENT_NORMAL相当）
 */
export const DEFAULT_RANK_ADJUSTMENT_CONFIG: RankAdjustmentConfig = {
  lookbackDays: 90,
  rankGapThreshold: 5,
  seoProgressLowerBound: 0.3,  // seoProgressThreshold相当
  lossUsageThreshold: 0.7,
  unhealthyTacosThreshold: 0.33, // 後方互換用（3ヶ月相当）
  unhealthyTacosMonths: 3,       // RED/ORANGEが3ヶ月続いたら不健全
  minConditionsToTrigger: 2,
  suggestedRankRules: [
    { organicRankMin: 1, organicRankMax: 5, suggestedTargetRank: 1 }, // 5位以内は提案なし
    { organicRankMin: 6, organicRankMax: 10, suggestedTargetRank: 5 },
    { organicRankMin: 11, organicRankMax: 20, suggestedTargetRank: 10 },
    { organicRankMin: 21, organicRankMax: Infinity, suggestedTargetRank: 15 },
  ],
  suggestedRankStep: 2,
};

// =============================================================================
// ProductLtvProfile - 商品LTVプロファイル
// =============================================================================

/**
 * 商品LTVプロファイル
 *
 * サプリメント専用ツールとしてのSEO投資マインドセットを反映:
 * - SUPPLEMENT_HIGH_LTV: 高LTV商品。粘り強くSEO投資を継続
 * - SUPPLEMENT_NORMAL: 標準的なサプリ。バランス型
 * - LOW_LTV_SUPPLEMENT: 低LTV商品。早期見切り型
 */
export type ProductLtvProfile =
  | "SUPPLEMENT_HIGH_LTV"
  | "SUPPLEMENT_NORMAL"
  | "LOW_LTV_SUPPLEMENT";

/**
 * 有効なProductLtvProfile一覧
 */
export const VALID_PRODUCT_LTV_PROFILES: readonly ProductLtvProfile[] = [
  "SUPPLEMENT_HIGH_LTV",
  "SUPPLEMENT_NORMAL",
  "LOW_LTV_SUPPLEMENT",
];

/**
 * 値がProductLtvProfileかどうかを判定
 */
export function isValidProductLtvProfile(
  value: unknown
): value is ProductLtvProfile {
  return (
    typeof value === "string" &&
    VALID_PRODUCT_LTV_PROFILES.includes(value as ProductLtvProfile)
  );
}

/**
 * デフォルトのProductLtvProfile
 */
export const DEFAULT_PRODUCT_LTV_PROFILE: ProductLtvProfile = "SUPPLEMENT_NORMAL";

// =============================================================================
// プロファイル別RankAdjustmentConfig
// =============================================================================

/**
 * プロファイル別RankAdjustmentConfig定数マップ
 *
 * 設計意図:
 * - SUPPLEMENT_HIGH_LTV: 「かなり粘ってから目標順位ダウン提案」
 *   - lossUsageThreshold=0.80 (80%まで許容)
 *   - seoProgressLowerBound=0.25 (0.25未満のみ進捗不足)
 *   - unhealthyTacosMonths=3 (3ヶ月連続RED/ORANGEで不健全)
 *
 * - SUPPLEMENT_NORMAL: 「バランス型（現状値をほぼ維持）」
 *   - lossUsageThreshold=0.70 (70%まで許容)
 *   - seoProgressLowerBound=0.30 (標準的な閾値)
 *   - unhealthyTacosMonths=3 (3ヶ月連続RED/ORANGEで不健全)
 *
 * - LOW_LTV_SUPPLEMENT: 「早めに見切って目標順位を下げる」
 *   - lossUsageThreshold=0.50 (50%で警戒)
 *   - seoProgressLowerBound=0.35 (厳しめの判定)
 *   - unhealthyTacosMonths=2 (2ヶ月連続RED/ORANGEで不健全)
 */
export const RANK_ADJUSTMENT_CONFIG_BY_PROFILE: Record<
  ProductLtvProfile,
  RankAdjustmentConfig
> = {
  SUPPLEMENT_HIGH_LTV: {
    lookbackDays: 90,
    rankGapThreshold: 5,
    seoProgressLowerBound: 0.25,   // SEO進捗0.25未満のみ「進捗不足」
    lossUsageThreshold: 0.80,      // 累積損失上限の80%まで許容
    unhealthyTacosThreshold: 0.33, // 後方互換用
    unhealthyTacosMonths: 3,       // RED/ORANGEが3ヶ月連続で「TACOS不健全継続」
    minConditionsToTrigger: 2,
    suggestedRankRules: [
      { organicRankMin: 1, organicRankMax: 5, suggestedTargetRank: 1 },
      { organicRankMin: 6, organicRankMax: 10, suggestedTargetRank: 5 },
      { organicRankMin: 11, organicRankMax: 20, suggestedTargetRank: 10 },
      { organicRankMin: 21, organicRankMax: Infinity, suggestedTargetRank: 15 },
    ],
    suggestedRankStep: 2,
  },
  SUPPLEMENT_NORMAL: {
    lookbackDays: 90,
    rankGapThreshold: 5,
    seoProgressLowerBound: 0.30,   // SEO進捗0.30未満で「進捗不足」
    lossUsageThreshold: 0.70,      // 累積損失上限の70%まで許容
    unhealthyTacosThreshold: 0.33, // 後方互換用
    unhealthyTacosMonths: 3,       // RED/ORANGEが3ヶ月連続で「TACOS不健全継続」
    minConditionsToTrigger: 2,
    suggestedRankRules: [
      { organicRankMin: 1, organicRankMax: 5, suggestedTargetRank: 1 },
      { organicRankMin: 6, organicRankMax: 10, suggestedTargetRank: 5 },
      { organicRankMin: 11, organicRankMax: 20, suggestedTargetRank: 10 },
      { organicRankMin: 21, organicRankMax: Infinity, suggestedTargetRank: 15 },
    ],
    suggestedRankStep: 2,
  },
  LOW_LTV_SUPPLEMENT: {
    lookbackDays: 90,
    rankGapThreshold: 5,
    seoProgressLowerBound: 0.35,   // SEO進捗0.35未満で「進捗不足」（厳しめ）
    lossUsageThreshold: 0.50,      // 累積損失上限の50%で警戒
    unhealthyTacosThreshold: 0.22, // 後方互換用
    unhealthyTacosMonths: 2,       // RED/ORANGEが2ヶ月連続で「TACOS不健全継続」
    minConditionsToTrigger: 2,
    suggestedRankRules: [
      { organicRankMin: 1, organicRankMax: 5, suggestedTargetRank: 1 },
      { organicRankMin: 6, organicRankMax: 10, suggestedTargetRank: 5 },
      { organicRankMin: 11, organicRankMax: 20, suggestedTargetRank: 10 },
      { organicRankMin: 21, organicRankMax: Infinity, suggestedTargetRank: 15 },
    ],
    suggestedRankStep: 2,
  },
};

/**
 * プロファイルに基づいてRankAdjustmentConfigを取得
 *
 * @param profile - ProductLtvProfile（undefinedまたは無効な値の場合はデフォルト）
 * @returns RankAdjustmentConfig
 */
export function getRankAdjustmentConfigForProfile(
  profile: ProductLtvProfile | undefined | null
): RankAdjustmentConfig {
  if (profile && isValidProductLtvProfile(profile)) {
    return RANK_ADJUSTMENT_CONFIG_BY_PROFILE[profile];
  }
  return DEFAULT_RANK_ADJUSTMENT_CONFIG;
}

// =============================================================================
// KeywordClusterConfig - キーワードクラスタ設定（RankTargetConfig統合）
// =============================================================================

/**
 * キーワードクラスタ設定
 *
 * キーワードクラスタ単位の設定を保持。
 * RankTargetConfigを含む。
 */
export interface KeywordClusterConfig {
  /**
   * クラスタ識別子
   */
  clusterId: string;

  /**
   * クラスタ名（表示用）
   */
  clusterName: string;

  /**
   * クラスタに含まれる代表キーワード
   */
  representativeKeywords: string[];

  /**
   * 目標順位設定
   */
  rankTargetConfig: RankTargetConfig;

  /**
   * クラスタ優先度（1が最高）
   */
  priority: number;

  /**
   * 有効フラグ
   */
  isActive: boolean;

  /**
   * 手動オーバーライドフラグ
   * trueの場合、ツールの自動変更を受け付けない
   */
  isManualOverride: boolean;

  /**
   * 最終更新日時
   */
  updatedAt: Date;
}

/**
 * KeywordClusterConfigのデフォルト値を生成
 */
export function createDefaultKeywordClusterConfig(
  clusterId: string,
  clusterName: string,
  representativeKeywords: string[],
  defaultRankTargetConfig: RankTargetConfig = DEFAULT_RANK_TARGET_CONFIG
): KeywordClusterConfig {
  return {
    clusterId,
    clusterName,
    representativeKeywords,
    rankTargetConfig: { ...defaultRankTargetConfig },
    priority: 1,
    isActive: true,
    isManualOverride: false,
    updatedAt: new Date(),
  };
}

// =============================================================================
// ProductProfileConfig拡張 - デフォルトRankTargetConfig
// =============================================================================

/**
 * ProductProfile用のRankTargetデフォルト設定
 *
 * ProductProfileに追加するフィールドとして使用
 */
export interface ProductProfileRankTargetDefaults {
  /**
   * デフォルトの理想順位
   */
  defaultIdealRank: number;

  /**
   * デフォルトの運用目標順位
   */
  defaultTargetRank: number;

  /**
   * デフォルトの許容誤差
   */
  defaultRankTolerance: number;
}

/**
 * プロファイルタイプ別のデフォルト設定
 */
export const PROFILE_RANK_TARGET_DEFAULTS: Record<string, ProductProfileRankTargetDefaults> = {
  SUPPLEMENT_HIGH_LTV: {
    defaultIdealRank: 1,
    defaultTargetRank: 1,
    defaultRankTolerance: 2,
  },
  SUPPLEMENT_STANDARD: {
    defaultIdealRank: 1,
    defaultTargetRank: 1,
    defaultRankTolerance: 2,
  },
  SINGLE_PURCHASE: {
    defaultIdealRank: 1,
    defaultTargetRank: 1,
    defaultRankTolerance: 1,
  },
  DEFAULT: {
    defaultIdealRank: 1,
    defaultTargetRank: 1,
    defaultRankTolerance: 2,
  },
};

/**
 * プロファイルタイプからデフォルトのRankTargetConfigを取得
 */
export function getDefaultRankTargetConfigForProfile(
  profileType: string
): RankTargetConfig {
  const defaults = PROFILE_RANK_TARGET_DEFAULTS[profileType] ??
    PROFILE_RANK_TARGET_DEFAULTS.DEFAULT;

  return {
    idealRank: defaults.defaultIdealRank,
    targetRank: defaults.defaultTargetRank,
    rankTolerance: defaults.defaultRankTolerance,
  };
}

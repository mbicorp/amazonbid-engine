/**
 * SEOローンチ評価モジュール
 *
 * コアSEOキーワードの進捗状況を評価し、ローンチ終了条件を判定する。
 *
 * 主な機能:
 * 1. KeywordCoreRole: キーワードのSEO重要度分類（CORE/SUPPORT/EXPERIMENT）
 * 2. SeoLaunchStatus: キーワード単位のローンチ進捗状態（ACTIVE/ACHIEVED/GAVE_UP）
 * 3. AsinSeoLaunchProgress: ASIN単位のコアSEOキーワード進捗率
 * 4. LaunchExitDecision: ローンチ終了判定（通常終了/緊急終了）
 */

import { LifecycleStage } from "./types";
import { InvestmentState, AsinLossBudgetMetrics } from "../analytics/lossBudgetEvaluator";

// =============================================================================
// キーワード役割（コアSEO重要度）
// =============================================================================

/**
 * キーワードのSEO上押し重要度
 *
 * - CORE: 本気で上位を取りに行くコアSEOキーワード
 * - SUPPORT: 周辺や補助キーワード
 * - EXPERIMENT: 実験枠や評価前
 */
export enum KeywordCoreRole {
  CORE = "CORE",
  SUPPORT = "SUPPORT",
  EXPERIMENT = "EXPERIMENT",
}

/**
 * コアSEOキーワードのサブタイプ
 */
export enum CoreKeywordType {
  BIG = "BIG",           // ビッグキーワード（1-3語程度）
  MIDDLE = "MIDDLE",     // ミドルレンジ（3-7語程度）
  BRAND = "BRAND",       // ブランド名・指名系（1-3語程度）
}

// =============================================================================
// キーワード設定拡張
// =============================================================================

/**
 * コアSEOキーワード設定の上限
 */
export interface CoreKeywordLimits {
  /** ビッグキーワードの最大数（デフォルト3） */
  maxCoreBigPerAsin: number;
  /** ミドルレンジの最大数（デフォルト7） */
  maxCoreMiddlePerAsin: number;
  /** ブランド・指名系の最大数（デフォルト3） */
  maxCoreBrandPerAsin: number;
  /** CORE合計の最大数（デフォルト12） */
  maxCoreTotalPerAsin: number;
}

/**
 * デフォルトのコアキーワード上限設定
 */
export const DEFAULT_CORE_KEYWORD_LIMITS: CoreKeywordLimits = {
  maxCoreBigPerAsin: 3,
  maxCoreMiddlePerAsin: 7,
  maxCoreBrandPerAsin: 3,
  maxCoreTotalPerAsin: 12,
};

/**
 * 拡張キーワード設定（SEOローンチ用）
 */
export interface KeywordConfigExtended {
  /** キーワードID（BigQuery上の一意識別子） */
  keywordId: string;
  /** ASIN */
  asin: string;
  /** キーワード文字列 */
  keyword: string;
  /** SEO上押し重要度 */
  coreRole: KeywordCoreRole;
  /** コアキーワードのサブタイプ（COREの場合のみ） */
  coreType?: CoreKeywordType;
  /** 目標順位帯の下限（最良）例: 1 */
  targetRankMin?: number;
  /** 目標順位帯の上限（最低許容）例: ビッグなら3位、ミドルなら5位 */
  targetRankMax?: number;
  /** 検索ボリューム */
  searchVolume?: number;
  /** AEI（広告効率インデックス） */
  aei?: number;
  /** コアへの昇格日 */
  promotedToCoreAt?: string;
}

// =============================================================================
// キーワード順位メトリクス
// =============================================================================

/**
 * キーワード単位の順位・パフォーマンスデータ（BigQueryから取得）
 */
export interface KeywordRankMetrics {
  /** ASIN */
  asin: string;
  /** キーワードID */
  keywordId: string;
  /** 日付（ISO形式） */
  date: string;
  /** オーガニック順位（nullは圏外） */
  organicRank: number | null;
  /** インプレッション数 */
  impressions: number;
  /** クリック数 */
  clicks: number;
  /** 注文数 */
  orders: number;
  /** 広告費 */
  cost: number;
  /** 売上 */
  revenue: number;
}

/**
 * キーワード単位の集計済み順位データ
 */
export interface KeywordRankSummary {
  /** キーワードID */
  keywordId: string;
  /** ASIN */
  asin: string;
  /** 評価期間開始日 */
  periodStart: string;
  /** 評価期間終了日 */
  periodEnd: string;
  /** 直近7日間の平均順位（null=圏外のみ） */
  currentRank: number | null;
  /** 評価期間内の最良順位 */
  bestRankWindow: number | null;
  /** 評価期間内の平均順位 */
  avgRankWindow: number | null;
  /** 評価期間のインプレッション合計 */
  impressionsTotal: number;
  /** 評価期間のクリック合計 */
  clicksTotal: number;
  /** 評価期間の注文合計 */
  ordersTotal: number;
  /** 評価期間の広告費合計 */
  costTotal: number;
  /** 評価期間の売上合計 */
  revenueTotal: number;
  /** 順位データがある日数 */
  daysWithRankData: number;
  /** 最初に順位が付いた日 */
  firstRankedDate: string | null;
}

// =============================================================================
// SEOローンチステータス
// =============================================================================

/**
 * コアSEOキーワードのローンチ進捗状態
 *
 * - ACTIVE: まだSEOを押し上げ中
 * - ACHIEVED: 目標順位帯まで到達
 * - GAVE_UP: コストと期間から見て、これ以上は現実的ではないと判断
 */
export enum SeoLaunchStatus {
  ACTIVE = "ACTIVE",
  ACHIEVED = "ACHIEVED",
  GAVE_UP = "GAVE_UP",
}

// =============================================================================
// SEOローンチ設定
// =============================================================================

/**
 * GAVE_UP判定用の設定
 */
export interface SeoGiveUpConfig {
  /** 十分試したとみなすクリック数 */
  minClicksForGiveUp: number;
  /** ターゲットCPA何倍相当かで設定（例: 目標CPAの10倍） */
  minCostMultiplierForGiveUp: number;
  /** 例: 20位より上に一度も来ていない */
  maxBestRankForGiveUp: number;
  /** ローンチとして少なくとも何日試したか */
  minDaysActive: number;
  /** CVRがこの値以下かつACOSがmaxAcosForGiveUpを超える場合 */
  maxCvrForGiveUp: number;
  /** ACOSがこの値以上かつCVRがmaxCvrForGiveUp以下の場合 */
  maxAcosForGiveUp: number;
}

/**
 * SEOローンチ評価設定
 */
export interface SeoLaunchConfig {
  /** ACHIEVED判定：順位評価に必要な最小インプレッション */
  minImpressionsForRank: number;
  /** ACHIEVED判定：順位評価に必要な最小クリック */
  minClicksForRank: number;
  /** ACHIEVED判定：直近何日間の順位を見るか */
  recentDaysForCurrentRank: number;
  /** GAVE_UP判定設定 */
  giveUp: SeoGiveUpConfig;
}

/**
 * デフォルトのSEOローンチ評価設定
 */
export const DEFAULT_SEO_LAUNCH_CONFIG: SeoLaunchConfig = {
  minImpressionsForRank: 500,
  minClicksForRank: 30,
  recentDaysForCurrentRank: 7,
  giveUp: {
    minClicksForGiveUp: 200,
    minCostMultiplierForGiveUp: 10,
    maxBestRankForGiveUp: 20,
    minDaysActive: 30,
    maxCvrForGiveUp: 0.02,
    maxAcosForGiveUp: 1.0,
  },
};

// =============================================================================
// VolumeBucket（検索ボリューム区分）による動的GAVE_UP閾値
// =============================================================================

/**
 * 検索ボリューム区分
 *
 * ASIN内のコアキーワード集合における中央値（medianVolume_core）に対する
 * 各キーワードの検索ボリューム比率（volumeRatio_k）で分類:
 * - HIGH_VOLUME: volumeRatio_k >= 2.0（中央値の2倍以上）
 * - MID_VOLUME:  0.5 <= volumeRatio_k < 2.0
 * - LOW_VOLUME:  volumeRatio_k < 0.5（中央値の半分未満）
 */
export type VolumeBucket = "HIGH_VOLUME" | "MID_VOLUME" | "LOW_VOLUME";

/**
 * VolumeBucket分類の閾値
 */
export interface VolumeBucketThresholds {
  /** HIGH_VOLUME下限（これ以上はHIGH_VOLUME） */
  highVolumeMin: number;
  /** MID_VOLUME下限（これ以上でhighVolume未満はMID_VOLUME） */
  midVolumeMin: number;
}

/**
 * デフォルトのVolumeBucket閾値
 */
export const DEFAULT_VOLUME_BUCKET_THRESHOLDS: VolumeBucketThresholds = {
  highVolumeMin: 2.0,
  midVolumeMin: 0.5,
};

/**
 * tier別・bucket別のGAVE_UP閾値倍率
 *
 * 日数とクリック数の閾値を検索ボリュームに応じて伸縮させる
 * - HIGH_VOLUME: 大きいキーワードには時間とクリックを多く与える
 * - LOW_VOLUME: 小さいキーワードは早めに見切りを付ける
 */
export interface GiveUpThresholdMultipliers {
  /** HIGH_VOLUMEの日数倍率 */
  daysHigh: number;
  /** MID_VOLUMEの日数倍率 */
  daysMid: number;
  /** LOW_VOLUMEの日数倍率 */
  daysLow: number;
  /** HIGH_VOLUMEのクリック数倍率 */
  clicksHigh: number;
  /** MID_VOLUMEのクリック数倍率 */
  clicksMid: number;
  /** LOW_VOLUMEのクリック数倍率 */
  clicksLow: number;
}

/**
 * デフォルトのGAVE_UP閾値倍率
 */
export const DEFAULT_GIVEUP_MULTIPLIERS: GiveUpThresholdMultipliers = {
  daysHigh: 1.3,
  daysMid: 1.0,
  daysLow: 0.7,
  clicksHigh: 1.3,
  clicksMid: 1.0,
  clicksLow: 0.7,
};

/**
 * tier別のGAVE_UP基礎閾値
 *
 * MID（ミドルキーワード）とBIG（ビッグキーワード）で
 * 必要な日数とクリック数の基礎値が異なる
 */
export interface GiveUpBaseThresholds {
  /** MIDキーワードの基礎日数 */
  midBaseDays: number;
  /** MIDキーワードの基礎クリック数 */
  midBaseClicks: number;
  /** BIGキーワードの基礎日数 */
  bigBaseDays: number;
  /** BIGキーワードの基礎クリック数 */
  bigBaseClicks: number;
}

/**
 * デフォルトのtier別GAVE_UP基礎閾値
 */
export const DEFAULT_GIVEUP_BASE_THRESHOLDS: GiveUpBaseThresholds = {
  midBaseDays: 45,
  midBaseClicks: 100,
  bigBaseDays: 60,
  bigBaseClicks: 150,
};

/**
 * tier別の順位閾値（GAVE_UP判定用）
 *
 * 順位閾値はtier固定を基本とし、検索ボリュームによる調整は軽微に留める
 */
export interface GiveUpRankThresholds {
  /** MIDキーワードの順位閾値 */
  midRankThreshold: number;
  /** BIGキーワードの順位閾値 */
  bigRankThreshold: number;
  /** HIGH_VOLUMEの順位閾値調整（加算） */
  highVolumeRankAdjust: number;
  /** LOW_VOLUMEの順位閾値調整（減算） */
  lowVolumeRankAdjust: number;
}

/**
 * デフォルトの順位閾値
 */
export const DEFAULT_GIVEUP_RANK_THRESHOLDS: GiveUpRankThresholds = {
  midRankThreshold: 30,
  bigRankThreshold: 45,
  highVolumeRankAdjust: 5,   // HIGH_VOLUMEは+5位まで許容
  lowVolumeRankAdjust: 5,    // LOW_VOLUMEは-5位で見切り
};

/**
 * 動的GAVE_UP設定の統合インターフェース
 */
export interface DynamicGiveUpConfig {
  /** VolumeBucket分類閾値 */
  volumeBucketThresholds: VolumeBucketThresholds;
  /** bucket別の倍率 */
  multipliers: GiveUpThresholdMultipliers;
  /** tier別の基礎閾値 */
  baseThresholds: GiveUpBaseThresholds;
  /** 順位閾値 */
  rankThresholds: GiveUpRankThresholds;
  /** CVRがこの値以下かつACOSがmaxAcosForGiveUpを超える場合 */
  maxCvrForGiveUp: number;
  /** ACOSがこの値以上かつCVRがmaxCvrForGiveUp以下の場合 */
  maxAcosForGiveUp: number;
  /** ターゲットCPA何倍相当かで設定（例: 目標CPAの10倍） */
  minCostMultiplierForGiveUp: number;
}

/**
 * デフォルトの動的GAVE_UP設定
 */
export const DEFAULT_DYNAMIC_GIVEUP_CONFIG: DynamicGiveUpConfig = {
  volumeBucketThresholds: DEFAULT_VOLUME_BUCKET_THRESHOLDS,
  multipliers: DEFAULT_GIVEUP_MULTIPLIERS,
  baseThresholds: DEFAULT_GIVEUP_BASE_THRESHOLDS,
  rankThresholds: DEFAULT_GIVEUP_RANK_THRESHOLDS,
  maxCvrForGiveUp: 0.02,
  maxAcosForGiveUp: 1.0,
  minCostMultiplierForGiveUp: 10,
};

// =============================================================================
// VolumeBucket計算・閾値計算関数
// =============================================================================

/**
 * volumeRatioからVolumeBucketを決定
 *
 * @param volumeRatio - searchVolume_k / medianVolume_core
 * @param thresholds - 分類閾値
 * @returns VolumeBucket
 */
export function classifyVolumeBucket(
  volumeRatio: number,
  thresholds: VolumeBucketThresholds = DEFAULT_VOLUME_BUCKET_THRESHOLDS
): VolumeBucket {
  if (volumeRatio >= thresholds.highVolumeMin) {
    return "HIGH_VOLUME";
  }
  if (volumeRatio >= thresholds.midVolumeMin) {
    return "MID_VOLUME";
  }
  return "LOW_VOLUME";
}

/**
 * ASIN内コアキーワードの検索ボリューム中央値を計算
 *
 * @param coreKeywords - コアキーワードリスト（searchVolumeを持つ）
 * @returns 中央値（0件の場合は0）
 */
export function computeMedianSearchVolume(
  coreKeywords: Array<{ searchVolume?: number }>
): number {
  const volumes = coreKeywords
    .map((k) => k.searchVolume ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  if (volumes.length === 0) {
    return 0;
  }

  const mid = Math.floor(volumes.length / 2);
  if (volumes.length % 2 === 0) {
    return (volumes[mid - 1] + volumes[mid]) / 2;
  }
  return volumes[mid];
}

/**
 * キーワードごとのGAVE_UP判定閾値を計算
 *
 * tier（BIG/MID）とvolumeBucketに応じて、
 * 日数・クリック数・順位の閾値を動的に算出する。
 *
 * @param tier - キーワードのtier（BIG or MID）
 * @param volumeBucket - 検索ボリューム区分
 * @param config - 動的GAVE_UP設定
 * @returns 計算された閾値
 */
export function computeGiveUpThresholdsForKeyword(
  tier: CoreKeywordType,
  volumeBucket: VolumeBucket,
  config: DynamicGiveUpConfig = DEFAULT_DYNAMIC_GIVEUP_CONFIG
): {
  minDays: number;
  minClicks: number;
  rankThreshold: number;
} {
  const { baseThresholds, multipliers, rankThresholds } = config;

  // 1. tierに応じて基礎値を選択
  let baseDays: number;
  let baseClicks: number;
  let baseRankThreshold: number;

  if (tier === CoreKeywordType.BIG) {
    baseDays = baseThresholds.bigBaseDays;
    baseClicks = baseThresholds.bigBaseClicks;
    baseRankThreshold = rankThresholds.bigRankThreshold;
  } else {
    // MID, MIDDLE, BRAND はすべてMID扱い
    baseDays = baseThresholds.midBaseDays;
    baseClicks = baseThresholds.midBaseClicks;
    baseRankThreshold = rankThresholds.midRankThreshold;
  }

  // 2. volumeBucketに応じて倍率を選択
  let daysMultiplier: number;
  let clicksMultiplier: number;
  let rankAdjust: number;

  switch (volumeBucket) {
    case "HIGH_VOLUME":
      daysMultiplier = multipliers.daysHigh;
      clicksMultiplier = multipliers.clicksHigh;
      rankAdjust = rankThresholds.highVolumeRankAdjust;
      break;
    case "MID_VOLUME":
      daysMultiplier = multipliers.daysMid;
      clicksMultiplier = multipliers.clicksMid;
      rankAdjust = 0;
      break;
    case "LOW_VOLUME":
      daysMultiplier = multipliers.daysLow;
      clicksMultiplier = multipliers.clicksLow;
      rankAdjust = -rankThresholds.lowVolumeRankAdjust;
      break;
  }

  // 3. 閾値を計算（四捨五入）
  const minDays = Math.round(baseDays * daysMultiplier);
  const minClicks = Math.round(baseClicks * clicksMultiplier);
  const rankThreshold = Math.max(1, baseRankThreshold + rankAdjust);

  return {
    minDays,
    minClicks,
    rankThreshold,
  };
}

/**
 * 拡張キーワード設定（VolumeBucket情報付き）
 */
export interface KeywordConfigWithVolumeBucket extends KeywordConfigExtended {
  /** 検索ボリューム比率（searchVolume / medianVolume） */
  volumeRatio?: number;
  /** 検索ボリューム区分 */
  volumeBucket?: VolumeBucket;
  /** 動的に計算されたGAVE_UP用最小日数 */
  computedMinDaysForGiveUp?: number;
  /** 動的に計算されたGAVE_UP用最小クリック数 */
  computedMinClicksForGiveUp?: number;
  /** 動的に計算されたGAVE_UP用順位閾値 */
  computedRankThresholdForGiveUp?: number;
}

/**
 * コアキーワードリストにVolumeBucketと動的閾値を付与
 *
 * @param coreKeywords - コアキーワードリスト
 * @param config - 動的GAVE_UP設定
 * @returns VolumeBucket情報付きのキーワードリスト
 */
export function enrichKeywordsWithVolumeBucket(
  coreKeywords: KeywordConfigExtended[],
  config: DynamicGiveUpConfig = DEFAULT_DYNAMIC_GIVEUP_CONFIG
): KeywordConfigWithVolumeBucket[] {
  // 中央値を計算
  const medianVolume = computeMedianSearchVolume(coreKeywords);

  return coreKeywords.map((kw) => {
    const searchVolume = kw.searchVolume ?? 0;
    const volumeRatio = medianVolume > 0 ? searchVolume / medianVolume : 1.0;
    const volumeBucket = classifyVolumeBucket(volumeRatio, config.volumeBucketThresholds);

    // tierを決定（coreTypeがない場合はMIDDLE扱い）
    const tier = kw.coreType ?? CoreKeywordType.MIDDLE;

    // 動的閾値を計算
    const thresholds = computeGiveUpThresholdsForKeyword(tier, volumeBucket, config);

    return {
      ...kw,
      volumeRatio,
      volumeBucket,
      computedMinDaysForGiveUp: thresholds.minDays,
      computedMinClicksForGiveUp: thresholds.minClicks,
      computedRankThresholdForGiveUp: thresholds.rankThreshold,
    };
  });
}

// =============================================================================
// キーワード単位のSEOステータス評価
// =============================================================================

/**
 * キーワード単位のSEOローンチステータス評価結果
 */
export interface KeywordSeoStatusResult {
  /** キーワードID */
  keywordId: string;
  /** ステータス */
  status: SeoLaunchStatus;
  /** 判定理由 */
  reason: string;
  /** 現在の順位 */
  currentRank: number | null;
  /** 目標順位（上限） */
  targetRankMax: number | null;
  /** 最良順位 */
  bestRank: number | null;
  /** 評価期間のクリック合計 */
  clicksTotal: number;
  /** 評価期間のコスト合計 */
  costTotal: number;
}

/**
 * キーワード単位のSEOローンチステータスを評価
 *
 * 評価順序:
 * 1. ACHIEVED判定（目標順位到達）
 * 2. GAVE_UP判定（現実的でない）
 * 3. それ以外はACTIVE
 *
 * @param keyword - キーワード設定
 * @param rankSummary - 順位集計データ
 * @param config - 評価設定
 * @param targetCpa - 目標CPA（GAVE_UP判定に使用）
 * @returns ステータス評価結果
 */
export function evaluateKeywordSeoStatus(
  keyword: KeywordConfigExtended,
  rankSummary: KeywordRankSummary,
  config: SeoLaunchConfig,
  targetCpa: number
): KeywordSeoStatusResult {
  const { keywordId, coreRole, targetRankMax } = keyword;
  const {
    currentRank,
    bestRankWindow,
    impressionsTotal,
    clicksTotal,
    costTotal,
    ordersTotal,
    revenueTotal,
    daysWithRankData,
  } = rankSummary;

  // COREでない場合は評価対象外
  if (coreRole !== KeywordCoreRole.CORE) {
    return {
      keywordId,
      status: SeoLaunchStatus.ACTIVE,
      reason: "コアキーワードではないため評価対象外",
      currentRank,
      targetRankMax: targetRankMax ?? null,
      bestRank: bestRankWindow,
      clicksTotal,
      costTotal,
    };
  }

  // targetRankMaxが設定されていない場合はデフォルト10位
  const effectiveTargetRankMax = targetRankMax ?? 10;

  // ==========================================================================
  // 1. ACHIEVED判定
  // ==========================================================================
  if (
    currentRank !== null &&
    currentRank <= effectiveTargetRankMax &&
    impressionsTotal >= config.minImpressionsForRank &&
    clicksTotal >= config.minClicksForRank
  ) {
    return {
      keywordId,
      status: SeoLaunchStatus.ACHIEVED,
      reason: `目標順位${effectiveTargetRankMax}位以内を達成（現在${currentRank}位）`,
      currentRank,
      targetRankMax: effectiveTargetRankMax,
      bestRank: bestRankWindow,
      clicksTotal,
      costTotal,
    };
  }

  // ==========================================================================
  // 2. GAVE_UP判定
  // ==========================================================================
  const giveUpConfig = config.giveUp;
  const minCostForGiveUp = targetCpa * giveUpConfig.minCostMultiplierForGiveUp;

  // CVRとACOS計算
  // CVR = 注文数 / クリック数
  const cvr = clicksTotal > 0 ? ordersTotal / clicksTotal : 0;
  // ACOS = 広告費 / 売上（標準定義）
  const acos = revenueTotal > 0 ? costTotal / revenueTotal : Infinity;

  const clicksEnough = clicksTotal >= giveUpConfig.minClicksForGiveUp;
  const costEnough = costTotal >= minCostForGiveUp;
  const rankBad =
    bestRankWindow === null || bestRankWindow > giveUpConfig.maxBestRankForGiveUp;
  const daysEnough = daysWithRankData >= giveUpConfig.minDaysActive;
  const performanceBad =
    cvr <= giveUpConfig.maxCvrForGiveUp && acos >= giveUpConfig.maxAcosForGiveUp;

  if (clicksEnough && costEnough && rankBad && daysEnough) {
    return {
      keywordId,
      status: SeoLaunchStatus.GAVE_UP,
      reason: `${giveUpConfig.minDaysActive}日以上かつ${clicksTotal}クリック投下したが、最良順位${bestRankWindow ?? "圏外"}で目標達成困難`,
      currentRank,
      targetRankMax: effectiveTargetRankMax,
      bestRank: bestRankWindow,
      clicksTotal,
      costTotal,
    };
  }

  // パフォーマンスが悪く、十分試した場合
  if (clicksEnough && costEnough && performanceBad) {
    return {
      keywordId,
      status: SeoLaunchStatus.GAVE_UP,
      reason: `CVR ${(cvr * 100).toFixed(1)}%、ACOS ${(acos * 100).toFixed(0)}%と効率が悪く、投資継続は非効率`,
      currentRank,
      targetRankMax: effectiveTargetRankMax,
      bestRank: bestRankWindow,
      clicksTotal,
      costTotal,
    };
  }

  // ==========================================================================
  // 3. ACTIVE（継続）
  // ==========================================================================
  return {
    keywordId,
    status: SeoLaunchStatus.ACTIVE,
    reason: "SEO押し上げ継続中",
    currentRank,
    targetRankMax: effectiveTargetRankMax,
    bestRank: bestRankWindow,
    clicksTotal,
    costTotal,
  };
}

/**
 * 動的GAVE_UP閾値を使用したキーワードSEOステータス評価結果（拡張版）
 */
export interface KeywordSeoStatusResultDynamic extends KeywordSeoStatusResult {
  /** 検索ボリューム区分 */
  volumeBucket?: VolumeBucket;
  /** tier（BIG/MID/BRAND） */
  tier?: CoreKeywordType;
  /** 使用した動的閾値: 最小日数 */
  usedMinDays?: number;
  /** 使用した動的閾値: 最小クリック数 */
  usedMinClicks?: number;
  /** 使用した動的閾値: 順位閾値 */
  usedRankThreshold?: number;
}

/**
 * 動的閾値を使用したキーワード単位のSEOローンチステータス評価
 *
 * tier×volumeBucketに応じた動的閾値でGAVE_UP判定を行う。
 * 強いビッグキーワードには十分な期間とクリックを与え、
 * 弱いミドルやロング寄りミドルは早めに見切りを付ける。
 *
 * @param keyword - キーワード設定（VolumeBucket情報付き）
 * @param rankSummary - 順位集計データ
 * @param config - 評価設定（ACHIEVEDの閾値）
 * @param targetCpa - 目標CPA（コスト閾値計算に使用）
 * @param dynamicConfig - 動的GAVE_UP設定
 * @returns ステータス評価結果（動的閾値情報付き）
 */
export function evaluateKeywordSeoStatusDynamic(
  keyword: KeywordConfigWithVolumeBucket,
  rankSummary: KeywordRankSummary,
  config: SeoLaunchConfig,
  targetCpa: number,
  dynamicConfig: DynamicGiveUpConfig = DEFAULT_DYNAMIC_GIVEUP_CONFIG
): KeywordSeoStatusResultDynamic {
  const { keywordId, coreRole, targetRankMax, coreType } = keyword;
  const {
    currentRank,
    bestRankWindow,
    impressionsTotal,
    clicksTotal,
    costTotal,
    ordersTotal,
    revenueTotal,
    daysWithRankData,
  } = rankSummary;

  // COREでない場合は評価対象外
  if (coreRole !== KeywordCoreRole.CORE) {
    return {
      keywordId,
      status: SeoLaunchStatus.ACTIVE,
      reason: "コアキーワードではないため評価対象外",
      currentRank,
      targetRankMax: targetRankMax ?? null,
      bestRank: bestRankWindow,
      clicksTotal,
      costTotal,
    };
  }

  // targetRankMaxが設定されていない場合はデフォルト10位
  const effectiveTargetRankMax = targetRankMax ?? 10;

  // ==========================================================================
  // 1. ACHIEVED判定（従来通り）
  // ==========================================================================
  if (
    currentRank !== null &&
    currentRank <= effectiveTargetRankMax &&
    impressionsTotal >= config.minImpressionsForRank &&
    clicksTotal >= config.minClicksForRank
  ) {
    return {
      keywordId,
      status: SeoLaunchStatus.ACHIEVED,
      reason: `目標順位${effectiveTargetRankMax}位以内を達成（現在${currentRank}位）`,
      currentRank,
      targetRankMax: effectiveTargetRankMax,
      bestRank: bestRankWindow,
      clicksTotal,
      costTotal,
      volumeBucket: keyword.volumeBucket,
      tier: coreType,
    };
  }

  // ==========================================================================
  // 2. GAVE_UP判定（動的閾値を使用）
  // ==========================================================================

  // 動的閾値を取得（事前計算済みの場合はそれを使用、なければ計算）
  const tier = coreType ?? CoreKeywordType.MIDDLE;
  const volumeBucket = keyword.volumeBucket ?? "MID_VOLUME";

  let minDaysForGiveUp: number;
  let minClicksForGiveUp: number;
  let rankThreshold: number;

  if (
    keyword.computedMinDaysForGiveUp !== undefined &&
    keyword.computedMinClicksForGiveUp !== undefined &&
    keyword.computedRankThresholdForGiveUp !== undefined
  ) {
    // 事前計算済みの閾値を使用
    minDaysForGiveUp = keyword.computedMinDaysForGiveUp;
    minClicksForGiveUp = keyword.computedMinClicksForGiveUp;
    rankThreshold = keyword.computedRankThresholdForGiveUp;
  } else {
    // その場で計算
    const computed = computeGiveUpThresholdsForKeyword(tier, volumeBucket, dynamicConfig);
    minDaysForGiveUp = computed.minDays;
    minClicksForGiveUp = computed.minClicks;
    rankThreshold = computed.rankThreshold;
  }

  // コスト閾値
  const minCostForGiveUp = targetCpa * dynamicConfig.minCostMultiplierForGiveUp;

  // CVRとACOS計算
  const cvr = clicksTotal > 0 ? ordersTotal / clicksTotal : 0;
  const acos = revenueTotal > 0 ? costTotal / revenueTotal : Infinity;

  // 判定条件
  const clicksEnough = clicksTotal >= minClicksForGiveUp;
  const costEnough = costTotal >= minCostForGiveUp;
  const daysEnough = daysWithRankData >= minDaysForGiveUp;
  const rankBad = bestRankWindow === null || bestRankWindow > rankThreshold;
  const performanceBad =
    cvr <= dynamicConfig.maxCvrForGiveUp && acos >= dynamicConfig.maxAcosForGiveUp;

  // 基本情報（結果に含める）
  const baseResult = {
    volumeBucket,
    tier,
    usedMinDays: minDaysForGiveUp,
    usedMinClicks: minClicksForGiveUp,
    usedRankThreshold: rankThreshold,
  };

  // パターン1: 順位が土俵に乗っていない（日数・クリック・コスト十分）
  if (daysEnough && clicksEnough && costEnough && rankBad) {
    return {
      keywordId,
      status: SeoLaunchStatus.GAVE_UP,
      reason: `${minDaysForGiveUp}日以上・${minClicksForGiveUp}クリック以上投下したが、` +
        `最良順位${bestRankWindow ?? "圏外"}（閾値${rankThreshold}位）で目標達成困難`,
      currentRank,
      targetRankMax: effectiveTargetRankMax,
      bestRank: bestRankWindow,
      clicksTotal,
      costTotal,
      ...baseResult,
    };
  }

  // パターン2: パフォーマンスが悪い（日数・クリック・コスト十分）
  if (daysEnough && clicksEnough && costEnough && performanceBad) {
    return {
      keywordId,
      status: SeoLaunchStatus.GAVE_UP,
      reason: `CVR ${(cvr * 100).toFixed(1)}%、ACOS ${(acos * 100).toFixed(0)}%と効率が悪く、` +
        `投資継続は非効率（${volumeBucket}/${tier}）`,
      currentRank,
      targetRankMax: effectiveTargetRankMax,
      bestRank: bestRankWindow,
      clicksTotal,
      costTotal,
      ...baseResult,
    };
  }

  // ==========================================================================
  // 3. ACTIVE（継続）
  // ==========================================================================
  const remainingDays = Math.max(0, minDaysForGiveUp - daysWithRankData);
  const remainingClicks = Math.max(0, minClicksForGiveUp - clicksTotal);

  return {
    keywordId,
    status: SeoLaunchStatus.ACTIVE,
    reason: `SEO押し上げ継続中（あと${remainingDays}日/${remainingClicks}クリックで判定）`,
    currentRank,
    targetRankMax: effectiveTargetRankMax,
    bestRank: bestRankWindow,
    clicksTotal,
    costTotal,
    ...baseResult,
  };
}

// =============================================================================
// ASIN単位のSEOローンチ進捗
// =============================================================================

/**
 * ASIN単位のSEOローンチ進捗
 */
export interface AsinSeoLaunchProgress {
  /** ASIN */
  asin: string;
  /** コアSEOキーワードの総数 */
  totalCoreKeywords: number;
  /** ACHIEVED数 */
  achievedCount: number;
  /** GAVE_UP数 */
  gaveUpCount: number;
  /** ACTIVE数 */
  activeCount: number;
  /** 完了率 = (achievedCount + gaveUpCount) / totalCoreKeywords */
  completionRatio: number;
  /** 成功率 = achievedCount / totalCoreKeywords */
  successRatio: number;
  /** キーワード別のステータス詳細 */
  keywordStatuses: KeywordSeoStatusResult[];
}

/**
 * ASIN単位のSEOローンチ進捗を集計
 *
 * @param asin - ASIN
 * @param keywordConfigs - キーワード設定リスト
 * @param seoStatusMap - keywordId -> SeoLaunchStatus のマップ
 * @returns 進捗集計結果
 */
export function summarizeAsinSeoLaunchProgress(
  asin: string,
  keywordConfigs: KeywordConfigExtended[],
  seoStatusResults: KeywordSeoStatusResult[]
): AsinSeoLaunchProgress {
  // このASINのCOREキーワードのみ抽出
  const coreKeywords = keywordConfigs.filter(
    (k) => k.asin === asin && k.coreRole === KeywordCoreRole.CORE
  );

  const coreKeywordIds = new Set(coreKeywords.map((k) => k.keywordId));
  const relevantStatuses = seoStatusResults.filter((s) =>
    coreKeywordIds.has(s.keywordId)
  );

  const totalCoreKeywords = coreKeywords.length;
  const achievedCount = relevantStatuses.filter(
    (s) => s.status === SeoLaunchStatus.ACHIEVED
  ).length;
  const gaveUpCount = relevantStatuses.filter(
    (s) => s.status === SeoLaunchStatus.GAVE_UP
  ).length;
  const activeCount = relevantStatuses.filter(
    (s) => s.status === SeoLaunchStatus.ACTIVE
  ).length;

  const completionRatio =
    totalCoreKeywords > 0 ? (achievedCount + gaveUpCount) / totalCoreKeywords : 0;
  const successRatio = totalCoreKeywords > 0 ? achievedCount / totalCoreKeywords : 0;

  return {
    asin,
    totalCoreKeywords,
    achievedCount,
    gaveUpCount,
    activeCount,
    completionRatio,
    successRatio,
    keywordStatuses: relevantStatuses,
  };
}

// =============================================================================
// ローンチ終了条件
// =============================================================================

/**
 * ローンチ終了判定の閾値設定（後方互換性のため残す）
 */
export interface LaunchExitThresholds {
  /** ローンチとして最低限続ける日数（例: 45日） */
  minLaunchDays: number;
  /** ASIN累計クリック閾値（例: 2000-3000） */
  minAsinClicksTotal: number;
  /** ASIN累計注文閾値（例: 80前後） */
  minAsinOrdersTotal: number;
  /** コアSEO完了率の下限（例: 0.7 = 70%） */
  minCoreCompletionRatio: number;
  /** 緊急終了とみなすlossBudget比率（例: 1.2） */
  emergencyLossRatioThreshold: number;
}

/**
 * デフォルトのローンチ終了閾値（後方互換性のため残す）
 */
export const DEFAULT_LAUNCH_EXIT_THRESHOLDS: LaunchExitThresholds = {
  minLaunchDays: 45,
  minAsinClicksTotal: 2500,
  minAsinOrdersTotal: 80,
  minCoreCompletionRatio: 0.7,
  emergencyLossRatioThreshold: 1.2,
};

// =============================================================================
// ASIN固有スケーリングロジック
// =============================================================================

/**
 * プロファイルレベルのローンチ終了ベース閾値
 *
 * ASIN固有のvolumeScaleで調整される前の基準値。
 * これらの値はプロファイル全体で共有される。
 */
export interface LaunchExitBaseThresholds {
  /** ベース：ローンチ最低日数（スケーリングなし） */
  baseMinLaunchDays: number;
  /** ベース：ASIN累計クリック閾値 */
  baseMinAsinClicksTotal: number;
  /** ベース：ASIN累計注文閾値 */
  baseMinAsinOrdersTotal: number;
  /** コアSEO完了率の下限（スケーリングなし） */
  minCoreCompletionRatio: number;
  /** 緊急終了とみなすlossBudget比率（スケーリングなし） */
  emergencyLossRatioThreshold: number;
  /** 基準日販数（volumeScale算出用） */
  refDailySales: number;
  /** volumeScaleの下限 */
  minVolumeScale: number;
  /** volumeScaleの上限 */
  maxVolumeScale: number;
}

/**
 * デフォルトのベース閾値設定
 */
export const DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS: LaunchExitBaseThresholds = {
  baseMinLaunchDays: 45,
  baseMinAsinClicksTotal: 2500,
  baseMinAsinOrdersTotal: 80,
  minCoreCompletionRatio: 0.7,
  emergencyLossRatioThreshold: 1.2,
  refDailySales: 20,
  minVolumeScale: 0.5,
  maxVolumeScale: 2.0,
};

/**
 * ASIN固有のスケーリング済み閾値
 *
 * volumeScale_asin = clamp(avgDailySales30d / refDailySales, minVolumeScale, maxVolumeScale)
 * に基づいて計算された、特定ASINに適用される閾値。
 */
export interface LaunchExitThresholdsComputed {
  /** ASIN */
  asin: string;
  /** 計算に使用したvolumeScale */
  volumeScale: number;
  /** 計算に使用したavgDailySales30d */
  avgDailySales30d: number;
  /** スケーリング済み：ローンチ最低日数（現在はスケーリングなし） */
  minLaunchDays: number;
  /** スケーリング済み：ASIN累計クリック閾値 */
  minAsinClicksTotal: number;
  /** スケーリング済み：ASIN累計注文閾値 */
  minAsinOrdersTotal: number;
  /** コアSEO完了率の下限（スケーリングなし） */
  minCoreCompletionRatio: number;
  /** 緊急終了とみなすlossBudget比率（スケーリングなし） */
  emergencyLossRatioThreshold: number;
}

/**
 * ASIN固有のローンチ終了閾値を計算
 *
 * volumeScale_asin = clamp(avgDailySales30d / refDailySales, minVolumeScale, maxVolumeScale)
 *
 * スケーリング対象:
 * - minAsinClicksTotal_asin = round(baseMinAsinClicksTotal × volumeScale_asin)
 * - minAsinOrdersTotal_asin = round(baseMinAsinOrdersTotal × volumeScale_asin)
 *
 * スケーリングなし（固定）:
 * - minLaunchDays（時間は販売量に関係なく一定）
 * - minCoreCompletionRatio（SEO完了率は販売量に関係なく一定）
 * - emergencyLossRatioThreshold（緊急終了閾値は販売量に関係なく一定）
 *
 * @param asin - ASIN
 * @param base - プロファイルレベルのベース閾値
 * @param avgDailySales30d - 直近30日の平均日販数
 * @returns ASIN固有のスケーリング済み閾値
 */
export function computeLaunchExitThresholdsForAsin(
  asin: string,
  base: LaunchExitBaseThresholds,
  avgDailySales30d: number
): LaunchExitThresholdsComputed {
  // volumeScale計算: clamp(avgDailySales30d / refDailySales, min, max)
  const volumeRaw = avgDailySales30d / base.refDailySales;
  const volumeScale = Math.max(
    base.minVolumeScale,
    Math.min(base.maxVolumeScale, volumeRaw)
  );

  return {
    asin,
    volumeScale,
    avgDailySales30d,
    // 時間はスケーリングしない
    minLaunchDays: base.baseMinLaunchDays,
    // データ量はvolumeScaleでスケーリング
    minAsinClicksTotal: Math.round(base.baseMinAsinClicksTotal * volumeScale),
    minAsinOrdersTotal: Math.round(base.baseMinAsinOrdersTotal * volumeScale),
    // 以下はスケーリングなし
    minCoreCompletionRatio: base.minCoreCompletionRatio,
    emergencyLossRatioThreshold: base.emergencyLossRatioThreshold,
  };
}

/**
 * ローンチ終了判定結果
 */
export interface LaunchExitDecision {
  /** ASIN */
  asin: string;
  /** 全体としてLAUNCHを抜けるか */
  shouldExitLaunch: boolean;
  /** lossBudgetによる緊急終了かどうか */
  isEmergencyExit: boolean;
  /** 判定理由コード */
  reasonCodes: LaunchExitReasonCode[];
  /** 判定理由の詳細メッセージ */
  reasonMessage: string;
  /** 推奨される次のライフサイクルステージ */
  recommendedNextStage: LifecycleStage;
  /** SEO進捗情報 */
  seoProgress: AsinSeoLaunchProgress;
  /** lossBudget情報（あれば） */
  lossBudgetMetrics?: AsinLossBudgetMetrics;
  /** 使用したvolumeScale（スケーリング済み閾値を使用した場合） */
  volumeScale?: number;
  /** 使用した閾値（デバッグ・監査用） */
  thresholdsUsed?: {
    minLaunchDays: number;
    minAsinClicksTotal: number;
    minAsinOrdersTotal: number;
    minCoreCompletionRatio: number;
    emergencyLossRatioThreshold: number;
  };
}

/**
 * ローンチ終了理由コード
 */
export type LaunchExitReasonCode =
  | "CORE_COMPLETION"        // コアSEO完了率達成
  | "DAYS_OR_DATA"           // 時間またはデータ量条件達成
  | "LOSS_BUDGET_EMERGENCY"  // lossBudgetによる緊急終了
  | "LOSS_BUDGET_BREACH"     // lossBudget BREACH状態
  | "NOT_READY";             // 終了条件未達

/**
 * ローンチ終了を判定
 *
 * 判定方針:
 * 1. まず緊急終了を判定（lossBudget超過）
 * 2. 通常終了を判定（SEO完了率 + 時間/データ条件）
 * 3. それ以外は継続
 *
 * @param asin - ASIN
 * @param lifecycleStage - 現在のライフサイクルステージ
 * @param daysSinceLaunch - ローンチ開始からの日数
 * @param asinClicksTotal - ASIN累計クリック
 * @param asinOrdersTotal - ASIN累計注文
 * @param progress - ASIN SEO進捗
 * @param lossBudget - lossBudget評価結果
 * @param thresholds - 終了判定閾値
 * @returns 終了判定結果
 */
export function decideLaunchExit(
  asin: string,
  lifecycleStage: LifecycleStage,
  daysSinceLaunch: number,
  asinClicksTotal: number,
  asinOrdersTotal: number,
  progress: AsinSeoLaunchProgress,
  lossBudget: AsinLossBudgetMetrics | null,
  thresholds: LaunchExitThresholds = DEFAULT_LAUNCH_EXIT_THRESHOLDS
): LaunchExitDecision {
  const isLaunchStage =
    lifecycleStage === "LAUNCH_HARD" || lifecycleStage === "LAUNCH_SOFT";

  // LAUNCH期でない場合は判定不要
  if (!isLaunchStage) {
    return {
      asin,
      shouldExitLaunch: false,
      isEmergencyExit: false,
      reasonCodes: ["NOT_READY"],
      reasonMessage: "LAUNCH期ではないため判定対象外",
      recommendedNextStage: lifecycleStage,
      seoProgress: progress,
      lossBudgetMetrics: lossBudget ?? undefined,
    };
  }

  // ==========================================================================
  // 1. 緊急終了判定（lossBudget）
  // ==========================================================================
  if (lossBudget) {
    const isBreachState = lossBudget.investmentState === InvestmentState.BREACH;
    const isOverEmergencyThreshold =
      lossBudget.ratioStage > thresholds.emergencyLossRatioThreshold;

    if (isBreachState || isOverEmergencyThreshold) {
      return {
        asin,
        shouldExitLaunch: true,
        isEmergencyExit: true,
        reasonCodes: ["LOSS_BUDGET_EMERGENCY"],
        reasonMessage: `lossBudget超過による緊急終了: ratioStage=${(lossBudget.ratioStage * 100).toFixed(1)}%, state=${lossBudget.investmentState}`,
        recommendedNextStage: "GROW",
        seoProgress: progress,
        lossBudgetMetrics: lossBudget,
      };
    }
  }

  // ==========================================================================
  // 2. 通常終了判定
  // ==========================================================================

  // SEO完了率条件
  const seoCompletionMet =
    progress.completionRatio >= thresholds.minCoreCompletionRatio;

  // 時間/データ条件（いずれか1つ以上）
  const daysConditionMet = daysSinceLaunch >= thresholds.minLaunchDays;
  const clicksConditionMet = asinClicksTotal >= thresholds.minAsinClicksTotal;
  const ordersConditionMet = asinOrdersTotal >= thresholds.minAsinOrdersTotal;
  const trialConditionMet =
    daysConditionMet || clicksConditionMet || ordersConditionMet;

  // 両方を満たしたら通常終了
  if (seoCompletionMet && trialConditionMet) {
    const reasonCodes: LaunchExitReasonCode[] = ["CORE_COMPLETION", "DAYS_OR_DATA"];

    const trialDetails: string[] = [];
    if (daysConditionMet) trialDetails.push(`${daysSinceLaunch}日経過`);
    if (clicksConditionMet) trialDetails.push(`${asinClicksTotal}クリック`);
    if (ordersConditionMet) trialDetails.push(`${asinOrdersTotal}注文`);

    return {
      asin,
      shouldExitLaunch: true,
      isEmergencyExit: false,
      reasonCodes,
      reasonMessage:
        `コアSEO完了率${(progress.completionRatio * 100).toFixed(0)}%達成` +
        `（ACHIEVED=${progress.achievedCount}, GAVE_UP=${progress.gaveUpCount}）` +
        `、試行条件クリア（${trialDetails.join(", ")}）`,
      recommendedNextStage: "GROW",
      seoProgress: progress,
      lossBudgetMetrics: lossBudget ?? undefined,
    };
  }

  // ==========================================================================
  // 3. 継続
  // ==========================================================================
  const missingConditions: string[] = [];
  if (!seoCompletionMet) {
    missingConditions.push(
      `SEO完了率${(progress.completionRatio * 100).toFixed(0)}% < ${thresholds.minCoreCompletionRatio * 100}%`
    );
  }
  if (!trialConditionMet) {
    missingConditions.push(
      `試行条件未達（${daysSinceLaunch}日/${thresholds.minLaunchDays}日, ` +
        `${asinClicksTotal}/${thresholds.minAsinClicksTotal}クリック, ` +
        `${asinOrdersTotal}/${thresholds.minAsinOrdersTotal}注文）`
    );
  }

  return {
    asin,
    shouldExitLaunch: false,
    isEmergencyExit: false,
    reasonCodes: ["NOT_READY"],
    reasonMessage: `ローンチ継続: ${missingConditions.join("; ")}`,
    recommendedNextStage: lifecycleStage,
    seoProgress: progress,
    lossBudgetMetrics: lossBudget ?? undefined,
  };
}

/**
 * ASIN固有のスケーリング済み閾値を使ってローンチ終了を判定
 *
 * この関数はcomputeLaunchExitThresholdsForAsinで計算されたASIN固有の閾値を使用し、
 * 結果にvolumeScaleと使用した閾値を含めます。
 *
 * @param asin - ASIN
 * @param lifecycleStage - 現在のライフサイクルステージ
 * @param daysSinceLaunch - ローンチ開始からの日数
 * @param asinClicksTotal - ASIN累計クリック
 * @param asinOrdersTotal - ASIN累計注文
 * @param progress - ASIN SEO進捗
 * @param lossBudget - lossBudget評価結果
 * @param computedThresholds - ASIN固有のスケーリング済み閾値
 * @returns 終了判定結果（volumeScaleと使用閾値を含む）
 */
export function decideLaunchExitWithScaling(
  asin: string,
  lifecycleStage: LifecycleStage,
  daysSinceLaunch: number,
  asinClicksTotal: number,
  asinOrdersTotal: number,
  progress: AsinSeoLaunchProgress,
  lossBudget: AsinLossBudgetMetrics | null,
  computedThresholds: LaunchExitThresholdsComputed
): LaunchExitDecision {
  // 基本判定は既存関数を使用
  const decision = decideLaunchExit(
    asin,
    lifecycleStage,
    daysSinceLaunch,
    asinClicksTotal,
    asinOrdersTotal,
    progress,
    lossBudget,
    computedThresholds
  );

  // スケーリング情報を追加
  return {
    ...decision,
    volumeScale: computedThresholds.volumeScale,
    thresholdsUsed: {
      minLaunchDays: computedThresholds.minLaunchDays,
      minAsinClicksTotal: computedThresholds.minAsinClicksTotal,
      minAsinOrdersTotal: computedThresholds.minAsinOrdersTotal,
      minCoreCompletionRatio: computedThresholds.minCoreCompletionRatio,
      emergencyLossRatioThreshold: computedThresholds.emergencyLossRatioThreshold,
    },
  };
}

// =============================================================================
// 一括評価関数
// =============================================================================

/**
 * 複数キーワードのSEOステータスを一括評価
 *
 * @param keywords - キーワード設定リスト
 * @param rankSummaries - 順位集計データリスト
 * @param config - 評価設定
 * @param targetCpaMap - ASIN -> 目標CPAのマップ
 * @returns キーワードID -> ステータス評価結果のマップ
 */
export function evaluateAllKeywordsSeoStatus(
  keywords: KeywordConfigExtended[],
  rankSummaries: KeywordRankSummary[],
  config: SeoLaunchConfig,
  targetCpaMap: Map<string, number>
): Map<string, KeywordSeoStatusResult> {
  const summaryMap = new Map(rankSummaries.map((s) => [s.keywordId, s]));
  const results = new Map<string, KeywordSeoStatusResult>();

  for (const keyword of keywords) {
    const summary = summaryMap.get(keyword.keywordId);
    if (!summary) continue;

    const targetCpa = targetCpaMap.get(keyword.asin) ?? 5000; // デフォルト5000円
    const result = evaluateKeywordSeoStatus(keyword, summary, config, targetCpa);
    results.set(keyword.keywordId, result);
  }

  return results;
}

/**
 * 順位データから集計サマリーを作成
 *
 * @param metrics - 日次順位データリスト
 * @param periodStart - 評価期間開始日
 * @param periodEnd - 評価期間終了日
 * @param recentDays - 直近何日間を「現在順位」とするか
 * @returns キーワードID -> 集計サマリーのマップ
 */
export function aggregateKeywordRankMetrics(
  metrics: KeywordRankMetrics[],
  periodStart: string,
  periodEnd: string,
  recentDays: number = 7
): Map<string, KeywordRankSummary> {
  // キーワードIDでグループ化
  const grouped = new Map<string, KeywordRankMetrics[]>();
  for (const m of metrics) {
    const list = grouped.get(m.keywordId) || [];
    list.push(m);
    grouped.set(m.keywordId, list);
  }

  const summaries = new Map<string, KeywordRankSummary>();
  const periodEndDate = new Date(periodEnd);

  for (const [keywordId, keywordMetrics] of grouped) {
    if (keywordMetrics.length === 0) continue;

    const asin = keywordMetrics[0].asin;

    // 全期間の集計
    let impressionsTotal = 0;
    let clicksTotal = 0;
    let ordersTotal = 0;
    let costTotal = 0;
    let revenueTotal = 0;
    let daysWithRankData = 0;
    let bestRankWindow: number | null = null;
    let rankSum = 0;
    let rankCount = 0;
    let firstRankedDate: string | null = null;

    // 直近7日間用
    const recentRanks: number[] = [];

    for (const m of keywordMetrics) {
      impressionsTotal += m.impressions;
      clicksTotal += m.clicks;
      ordersTotal += m.orders;
      costTotal += m.cost;
      revenueTotal += m.revenue;

      if (m.organicRank !== null) {
        daysWithRankData++;
        rankSum += m.organicRank;
        rankCount++;

        if (bestRankWindow === null || m.organicRank < bestRankWindow) {
          bestRankWindow = m.organicRank;
        }

        if (firstRankedDate === null || m.date < firstRankedDate) {
          firstRankedDate = m.date;
        }

        // 直近N日間かチェック
        const metricDate = new Date(m.date);
        const daysDiff =
          (periodEndDate.getTime() - metricDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff <= recentDays) {
          recentRanks.push(m.organicRank);
        }
      }
    }

    // 現在順位（直近N日間の平均）
    const currentRank =
      recentRanks.length > 0
        ? recentRanks.reduce((a, b) => a + b, 0) / recentRanks.length
        : null;

    // 期間平均順位
    const avgRankWindow = rankCount > 0 ? rankSum / rankCount : null;

    summaries.set(keywordId, {
      keywordId,
      asin,
      periodStart,
      periodEnd,
      currentRank,
      bestRankWindow,
      avgRankWindow,
      impressionsTotal,
      clicksTotal,
      ordersTotal,
      costTotal,
      revenueTotal,
      daysWithRankData,
      firstRankedDate,
    });
  }

  return summaries;
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * コアSEO進捗からアラートサマリーを生成
 */
export function generateSeoLaunchAlertSummary(
  decision: LaunchExitDecision
): {
  shouldAlert: boolean;
  alertLevel: "info" | "warning" | "critical";
  message: string;
} {
  if (!decision.shouldExitLaunch) {
    // 継続の場合、進捗が良くない場合のみinfo
    if (decision.seoProgress.completionRatio < 0.3) {
      return {
        shouldAlert: true,
        alertLevel: "info",
        message:
          `[SEO進捗低] ASIN ${decision.asin}: 完了率${(decision.seoProgress.completionRatio * 100).toFixed(0)}%` +
          ` (ACHIEVED=${decision.seoProgress.achievedCount}, ACTIVE=${decision.seoProgress.activeCount})`,
      };
    }
    return { shouldAlert: false, alertLevel: "info", message: "" };
  }

  if (decision.isEmergencyExit) {
    return {
      shouldAlert: true,
      alertLevel: "critical",
      message:
        `[緊急終了] ASIN ${decision.asin}: ${decision.reasonMessage}`,
    };
  }

  // 通常終了
  return {
    shouldAlert: true,
    alertLevel: "info",
    message:
      `[ローンチ完了] ASIN ${decision.asin}: ${decision.reasonMessage}` +
      ` → ${decision.recommendedNextStage}へ移行推奨`,
  };
}

/**
 * ライフサイクルステージがLAUNCH期かどうか
 */
export function isLaunchStage(stage: LifecycleStage): boolean {
  return stage === "LAUNCH_HARD" || stage === "LAUNCH_SOFT";
}

// =============================================================================
// LAUNCH終了評価統合関数
// =============================================================================

/**
 * ASIN単位のLAUNCH終了評価の入力パラメータ
 */
export interface EvaluateLaunchExitForAsinParams {
  /** ASIN */
  asin: string;
  /** 現在のライフサイクルステージ */
  lifecycleStage: LifecycleStage;
  /** ローンチ開始からの日数 */
  daysSinceLaunch: number;
  /** ASIN累計クリック */
  asinClicksTotal: number;
  /** ASIN累計注文 */
  asinOrdersTotal: number;
  /** 直近30日の平均日販数 */
  avgDailySales30d: number;
  /** ASIN SEOローンチ進捗 */
  progress: AsinSeoLaunchProgress;
  /** lossBudget評価結果（オプション） */
  lossBudget: AsinLossBudgetMetrics | null;
  /** プロファイルレベルのベース閾値 */
  baseThresholds: LaunchExitBaseThresholds;
}

/**
 * ASIN単位のLAUNCH終了評価結果
 */
export interface EvaluateLaunchExitForAsinResult {
  /** ローンチ終了判定結果 */
  decision: LaunchExitDecision;
  /** ASIN固有のスケーリング済み閾値 */
  thresholds: LaunchExitThresholdsComputed;
  /** ASIN SEOローンチ進捗 */
  progress: AsinSeoLaunchProgress;
}

/**
 * ASIN単位のLAUNCH終了を評価する統合関数
 *
 * docs/bid_core.md 35章の仕様に基づき、以下を実行:
 * 1. computeLaunchExitThresholdsForAsin でASIN固有の閾値を計算
 * 2. decideLaunchExitWithScaling でローンチ終了判定を実行
 * 3. decision, thresholds, progress をまとめて返す
 *
 * @param params - 評価に必要な入力パラメータ
 * @returns LAUNCH終了評価結果
 */
export function evaluateLaunchExitForAsin(
  params: EvaluateLaunchExitForAsinParams
): EvaluateLaunchExitForAsinResult {
  const {
    asin,
    lifecycleStage,
    daysSinceLaunch,
    asinClicksTotal,
    asinOrdersTotal,
    avgDailySales30d,
    progress,
    lossBudget,
    baseThresholds,
  } = params;

  // 1. ASIN固有のスケーリング済み閾値を計算
  const thresholds = computeLaunchExitThresholdsForAsin(
    asin,
    baseThresholds,
    avgDailySales30d
  );

  // 2. スケーリング済み閾値でローンチ終了判定を実行
  const decision = decideLaunchExitWithScaling(
    asin,
    lifecycleStage,
    daysSinceLaunch,
    asinClicksTotal,
    asinOrdersTotal,
    progress,
    lossBudget,
    thresholds
  );

  // 3. 結果をまとめて返す
  return {
    decision,
    thresholds,
    progress,
  };
}

// =============================================================================
// 三軸ライフサイクル遷移判定
// =============================================================================

import {
  LossBudgetSummary,
  LossBudgetState,
  LossBudgetStateConfig,
  DEFAULT_LOSS_BUDGET_STATE_CONFIG,
} from "../analytics/lossBudgetEvaluator";

/**
 * 三軸遷移判定の入力
 */
export interface ThreeAxisTransitionInput {
  /** ASIN */
  asin: string;
  /** 現在のライフサイクルステージ */
  currentStage: LifecycleStage;
  /** A軸: コアSEOキーワードの完了率 (ACHIEVED + GAVE_UP) / total */
  seoCompletionRatio: number;
  /** B軸: ローンチとしての最低日数を満たしているか */
  minDaysSatisfied: boolean;
  /** B軸: クリック数・注文数などのサンプルが十分か */
  sampleEnough: boolean;
  /** C軸: lossBudgetSummary */
  lossBudgetSummary: LossBudgetSummary;
}

/**
 * 三軸遷移判定の設定
 */
export interface ThreeAxisTransitionConfig {
  /** A軸: SEO完了率の閾値（通常終了用） */
  seoCompletionThreshold: number;
  /** A軸: SEO完了率の警告閾値（早期終了用） */
  seoCompletionWarningThreshold: number;
  /** C軸: LossBudgetState判定設定 */
  lossBudgetStateConfig: LossBudgetStateConfig;
}

/**
 * デフォルトの三軸遷移判定設定
 */
export const DEFAULT_THREE_AXIS_TRANSITION_CONFIG: ThreeAxisTransitionConfig = {
  seoCompletionThreshold: 0.7,        // 70%完了で通常終了
  seoCompletionWarningThreshold: 0.4, // 40%完了でWARNING時に早期終了
  lossBudgetStateConfig: DEFAULT_LOSS_BUDGET_STATE_CONFIG,
};

/**
 * 三軸遷移判定の結果
 */
export interface ThreeAxisTransitionResult {
  /** ASIN */
  asin: string;
  /** 遷移すべきか */
  shouldTransition: boolean;
  /** 推奨される次のステージ */
  nextStage: LifecycleStage;
  /** 遷移理由コード */
  reasonCode: ThreeAxisReasonCode;
  /** 遷移理由の詳細メッセージ */
  reasonMessage: string;
  /** 緊急終了かどうか（C軸CRITICAL） */
  isEmergencyStop: boolean;
  /** 三軸の評価結果 */
  axisEvaluation: {
    /** A軸: SEO条件達成 */
    seoConditionMet: boolean;
    /** B軸: 時間/サンプル条件達成 */
    trialConditionMet: boolean;
    /** C軸: lossBudget状態 */
    lossBudgetState: LossBudgetState;
    /** C軸: 緊急終了トリガー */
    emergencyStop: boolean;
    /** C軸: 警告ゾーンかどうか */
    warningZone: boolean;
  };
}

/**
 * 三軸遷移理由コード
 */
export type ThreeAxisReasonCode =
  | "LOSS_BUDGET_EMERGENCY"     // C軸CRITICAL: 緊急終了
  | "NORMAL_COMPLETION"         // A+B両方達成: 通常終了
  | "LOSS_BUDGET_EARLY_EXIT"    // C軸WARNING + A軸部分達成: 早期終了
  | "CONTINUE_LAUNCH";          // 継続

/**
 * 三軸によるLAUNCH→GROW遷移を判定
 *
 * 判定ロジック:
 * 1. 緊急終了（C軸CRITICAL）
 *    - lossBudgetConsumption_launch >= criticalThreshold
 *    - または launchInvestUsageRatio >= launchInvestCriticalThreshold
 *    → 即座にGROWへ移行
 *
 * 2. 通常終了（A+B両方達成）
 *    - A軸: seoCompletionRatio >= seoCompletionThreshold
 *    - B軸: minDaysSatisfied && sampleEnough
 *    → GROWへ移行
 *
 * 3. 早期終了（C軸WARNING + A軸部分達成）
 *    - C軸: WARNING状態（CRITICAL未満）
 *    - A軸: seoCompletionRatio >= seoCompletionWarningThreshold
 *    → GROWへ移行
 *
 * 4. それ以外
 *    → LAUNCH継続
 *
 * @param input - 三軸遷移判定入力
 * @param config - 判定設定
 * @returns 遷移判定結果
 */
export function evaluateThreeAxisTransition(
  input: ThreeAxisTransitionInput,
  config: ThreeAxisTransitionConfig = DEFAULT_THREE_AXIS_TRANSITION_CONFIG
): ThreeAxisTransitionResult {
  const { asin, currentStage, seoCompletionRatio, minDaysSatisfied, sampleEnough, lossBudgetSummary } = input;
  const { seoCompletionThreshold, seoCompletionWarningThreshold, lossBudgetStateConfig } = config;

  // LAUNCH期でない場合は判定不要
  if (!isLaunchStage(currentStage)) {
    return {
      asin,
      shouldTransition: false,
      nextStage: currentStage,
      reasonCode: "CONTINUE_LAUNCH",
      reasonMessage: "LAUNCH期ではないため判定対象外",
      isEmergencyStop: false,
      axisEvaluation: {
        seoConditionMet: false,
        trialConditionMet: false,
        lossBudgetState: lossBudgetSummary.state,
        emergencyStop: false,
        warningZone: false,
      },
    };
  }

  // ==========================================================================
  // 三軸の評価
  // ==========================================================================

  // A軸: SEO条件
  const seoConditionMet = seoCompletionRatio >= seoCompletionThreshold;
  const seoPartiallyMet = seoCompletionRatio >= seoCompletionWarningThreshold;

  // B軸: 時間/サンプル条件
  const trialConditionMet = minDaysSatisfied && sampleEnough;

  // C軸: lossBudget条件
  const lossBudgetState = lossBudgetSummary.state;
  const { lossBudgetConsumptionRolling, lossBudgetConsumptionLaunch, launchInvestUsageRatio } = lossBudgetSummary;

  // 緊急終了判定（いずれかがCRITICAL閾値を超えた場合）
  const emergencyStop =
    lossBudgetConsumptionRolling >= lossBudgetStateConfig.criticalThreshold ||
    lossBudgetConsumptionLaunch >= lossBudgetStateConfig.criticalThreshold ||
    launchInvestUsageRatio >= lossBudgetStateConfig.launchInvestCriticalThreshold;

  // 警告ゾーン判定（いずれかがWARNING閾値を超えた場合）
  const warningZone =
    !emergencyStop &&
    (lossBudgetConsumptionRolling >= lossBudgetStateConfig.warningThreshold ||
     lossBudgetConsumptionLaunch >= lossBudgetStateConfig.warningThreshold ||
     launchInvestUsageRatio >= lossBudgetStateConfig.launchInvestWarningThreshold);

  const axisEvaluation = {
    seoConditionMet,
    trialConditionMet,
    lossBudgetState,
    emergencyStop,
    warningZone,
  };

  // ==========================================================================
  // 1. 緊急終了判定（C軸CRITICAL）
  // ==========================================================================
  if (emergencyStop) {
    return {
      asin,
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "LOSS_BUDGET_EMERGENCY",
      reasonMessage: `lossBudget緊急終了: consumption=${(lossBudgetConsumptionLaunch * 100).toFixed(1)}%, ` +
        `launchInvestUsage=${(launchInvestUsageRatio * 100).toFixed(1)}%`,
      isEmergencyStop: true,
      axisEvaluation,
    };
  }

  // ==========================================================================
  // 2. 通常終了判定（A+B両方達成）
  // ==========================================================================
  if (seoConditionMet && trialConditionMet) {
    return {
      asin,
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "NORMAL_COMPLETION",
      reasonMessage: `通常終了: SEO完了率=${(seoCompletionRatio * 100).toFixed(1)}% >= ${seoCompletionThreshold * 100}%, ` +
        `時間/サンプル条件達成`,
      isEmergencyStop: false,
      axisEvaluation,
    };
  }

  // ==========================================================================
  // 3. 早期終了判定（C軸WARNING + A軸部分達成）
  // ==========================================================================
  if (warningZone && seoPartiallyMet) {
    return {
      asin,
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "LOSS_BUDGET_EARLY_EXIT",
      reasonMessage: `早期終了: lossBudget WARNING状態でSEO完了率=${(seoCompletionRatio * 100).toFixed(1)}% >= ` +
        `${seoCompletionWarningThreshold * 100}%`,
      isEmergencyStop: false,
      axisEvaluation,
    };
  }

  // ==========================================================================
  // 4. 継続
  // ==========================================================================
  const missingConditions: string[] = [];
  if (!seoConditionMet) {
    missingConditions.push(`SEO完了率${(seoCompletionRatio * 100).toFixed(1)}% < ${seoCompletionThreshold * 100}%`);
  }
  if (!trialConditionMet) {
    if (!minDaysSatisfied) missingConditions.push("最低日数未達");
    if (!sampleEnough) missingConditions.push("サンプル不足");
  }

  return {
    asin,
    shouldTransition: false,
    nextStage: currentStage,
    reasonCode: "CONTINUE_LAUNCH",
    reasonMessage: `LAUNCH継続: ${missingConditions.join(", ")}`,
    isEmergencyStop: false,
    axisEvaluation,
  };
}

/**
 * 三軸遷移判定のアラートサマリーを生成
 */
export function generateThreeAxisAlertSummary(
  result: ThreeAxisTransitionResult
): {
  shouldAlert: boolean;
  alertLevel: "info" | "warning" | "critical";
  message: string;
} {
  if (!result.shouldTransition) {
    // 継続の場合、WARNING状態なら警告
    if (result.axisEvaluation.warningZone) {
      return {
        shouldAlert: true,
        alertLevel: "warning",
        message: `[WARNING] ASIN ${result.asin}: lossBudget WARNING状態、早期終了の可能性あり`,
      };
    }
    return { shouldAlert: false, alertLevel: "info", message: "" };
  }

  if (result.isEmergencyStop) {
    return {
      shouldAlert: true,
      alertLevel: "critical",
      message: `[緊急終了] ASIN ${result.asin}: ${result.reasonMessage}`,
    };
  }

  if (result.reasonCode === "LOSS_BUDGET_EARLY_EXIT") {
    return {
      shouldAlert: true,
      alertLevel: "warning",
      message: `[早期終了] ASIN ${result.asin}: ${result.reasonMessage}`,
    };
  }

  // 通常終了
  return {
    shouldAlert: true,
    alertLevel: "info",
    message: `[通常終了] ASIN ${result.asin}: ${result.reasonMessage}`,
  };
}

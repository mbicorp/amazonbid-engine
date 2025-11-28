/**
 * 目標順位ダウン提案ロジック
 *
 * 「理想1位に対して無理筋気味」なクラスタを検出し、
 * targetRankを現実的な値に下げる提案を生成する
 *
 * LTVプロファイル別の設定に対応:
 * - SUPPLEMENT_HIGH_LTV: 粘り強く投資継続（緩い閾値）
 * - SUPPLEMENT_NORMAL: バランス型（標準閾値）
 * - LOW_LTV_SUPPLEMENT: 早期撤退型（厳しい閾値）
 */

import {
  RankAdjustmentSuggestion,
  RankAdjustmentReasonCode,
  RankAdjustmentConfig,
  RankTargetConfig,
  SeoProgressMetrics,
  DEFAULT_RANK_ADJUSTMENT_CONFIG,
  ProductLtvProfile,
  getRankAdjustmentConfigForProfile,
} from "./seo-rank-target.types";
import { TacosZone } from "../config/productConfigTypes";

// =============================================================================
// 判定入力データ
// =============================================================================

/**
 * 目標順位調整判定の入力データ
 */
export interface RankAdjustmentInput {
  /** 商品識別子（ASIN） */
  productId: string;

  /** クラスタ識別子 */
  clusterId: string;

  /** 現在のRankTargetConfig */
  rankTargetConfig: RankTargetConfig;

  /** 直近90日のオーガニック順位中央値 */
  medianOrganicRank90d: number;

  /** 直近90日のSEO進捗スコア */
  seoProgressScore90d: number;

  /** 商品別累積赤字上限（円） */
  productCumulativeLossLimit: number;

  /** 現在の累積赤字（円） */
  cumulativeLoss: number;

  /** 直近90日のTACOSゾーン履歴 */
  tacosZoneHistory90d: TacosZone[];

  /**
   * 商品のLTVプロファイル
   * 未指定の場合はDEFAULT_RANK_ADJUSTMENT_CONFIGを使用
   */
  productLtvProfile?: ProductLtvProfile;
}

// =============================================================================
// 判定ロジック
// =============================================================================

/**
 * 無理筋判定の条件チェック結果
 */
interface UnrealisticConditions {
  /** 順位ギャップ超過 */
  rankGapExceeded: boolean;
  /** SEO進捗スコア不足 */
  seoProgressInsufficient: boolean;
  /** 累積赤字消化率超過 */
  lossUsageExceeded: boolean;
  /** TACOS不健全割合超過 */
  unhealthyTacosExceeded: boolean;
  /** 満たした条件数 */
  conditionsMet: number;
  /** 計算に使用した値 */
  metrics: {
    rankGap: number;
    lossUsageRatio: number;
    unhealthyTacosRatio: number;
    /** RED/ORANGEが連続した月数 */
    unhealthyTacosMonths: number;
  };
}

/**
 * TACOS履歴から連続不健全月数を計算
 *
 * @param tacosZoneHistory - TACOSゾーン履歴（日次）
 * @returns 連続不健全月数（概算）
 */
export function calculateUnhealthyTacosMonths(
  tacosZoneHistory: TacosZone[]
): number {
  if (tacosZoneHistory.length === 0) {
    return 0;
  }

  // 月単位でグループ化（30日を1ヶ月とする簡易計算）
  const daysPerMonth = 30;
  const totalMonths = Math.ceil(tacosZoneHistory.length / daysPerMonth);

  // 各月の不健全日数をカウント
  const monthlyUnhealthyDays: number[] = [];
  for (let i = 0; i < totalMonths; i++) {
    const startIndex = i * daysPerMonth;
    const endIndex = Math.min(startIndex + daysPerMonth, tacosZoneHistory.length);
    const monthDays = tacosZoneHistory.slice(startIndex, endIndex);

    const unhealthyDaysInMonth = monthDays.filter(
      (zone) => zone === "ORANGE" || zone === "RED"
    ).length;

    // その月の半分以上が不健全なら「不健全月」とカウント
    const daysInMonth = monthDays.length;
    if (unhealthyDaysInMonth >= daysInMonth / 2) {
      monthlyUnhealthyDays.push(1);
    } else {
      monthlyUnhealthyDays.push(0);
    }
  }

  // 連続不健全月数を計算（最新月から逆順で連続している月数）
  let consecutiveMonths = 0;
  for (let i = monthlyUnhealthyDays.length - 1; i >= 0; i--) {
    if (monthlyUnhealthyDays[i] === 1) {
      consecutiveMonths++;
    } else {
      break;
    }
  }

  return consecutiveMonths;
}

/**
 * 無理筋判定の条件をチェック
 *
 * @param input - 判定入力データ
 * @param config - 判定設定
 * @returns 条件チェック結果
 */
export function checkUnrealisticConditions(
  input: RankAdjustmentInput,
  config: RankAdjustmentConfig = DEFAULT_RANK_ADJUSTMENT_CONFIG
): UnrealisticConditions {
  const { idealRank } = input.rankTargetConfig;

  // 順位ギャップチェック
  const rankGap = input.medianOrganicRank90d - idealRank;
  const rankGapExceeded = rankGap > config.rankGapThreshold;

  // SEO進捗スコアチェック
  const seoProgressInsufficient =
    input.seoProgressScore90d < config.seoProgressLowerBound;

  // 累積赤字消化率チェック
  const lossUsageRatio =
    input.productCumulativeLossLimit > 0
      ? input.cumulativeLoss / input.productCumulativeLossLimit
      : 0;
  const lossUsageExceeded = lossUsageRatio >= config.lossUsageThreshold;

  // TACOS不健全割合チェック（後方互換用）
  const unhealthyDays = input.tacosZoneHistory90d.filter(
    (zone) => zone === "ORANGE" || zone === "RED"
  ).length;
  const unhealthyTacosRatio =
    input.tacosZoneHistory90d.length > 0
      ? unhealthyDays / input.tacosZoneHistory90d.length
      : 0;

  // TACOS不健全月数チェック（新方式を優先）
  const unhealthyTacosMonths = calculateUnhealthyTacosMonths(
    input.tacosZoneHistory90d
  );

  // unhealthyTacosMonths設定がある場合は月数ベースで判定、なければ割合ベース
  const unhealthyTacosExceeded =
    config.unhealthyTacosMonths !== undefined
      ? unhealthyTacosMonths >= config.unhealthyTacosMonths
      : unhealthyTacosRatio >= config.unhealthyTacosThreshold;

  // 満たした条件数をカウント
  const conditionsMet = [
    rankGapExceeded,
    seoProgressInsufficient,
    lossUsageExceeded,
    unhealthyTacosExceeded,
  ].filter(Boolean).length;

  return {
    rankGapExceeded,
    seoProgressInsufficient,
    lossUsageExceeded,
    unhealthyTacosExceeded,
    conditionsMet,
    metrics: {
      rankGap,
      lossUsageRatio,
      unhealthyTacosRatio,
      unhealthyTacosMonths,
    },
  };
}

/**
 * organicRankから推奨targetRankを決定
 *
 * @param organicRank - オーガニック順位（中央値）
 * @param currentTargetRank - 現在のtargetRank
 * @param config - 判定設定
 * @returns 推奨targetRank（変更なしの場合は現在値を返す）
 */
export function determineSuggestedTargetRank(
  organicRank: number,
  currentTargetRank: number,
  config: RankAdjustmentConfig = DEFAULT_RANK_ADJUSTMENT_CONFIG
): number {
  for (const rule of config.suggestedRankRules) {
    if (
      organicRank >= rule.organicRankMin &&
      organicRank <= rule.organicRankMax
    ) {
      // 現在のtargetRankより大きい（=緩い）値のみ提案
      if (rule.suggestedTargetRank > currentTargetRank) {
        return rule.suggestedTargetRank;
      }
      break;
    }
  }

  return currentTargetRank;
}

/**
 * 提案説明文を生成
 *
 * @param input - 判定入力データ
 * @param conditions - 条件チェック結果
 * @param suggestedTargetRank - 推奨targetRank
 * @returns 説明文
 */
export function generateExplanation(
  input: RankAdjustmentInput,
  conditions: UnrealisticConditions,
  suggestedTargetRank: number
): string {
  const parts: string[] = [];

  parts.push(
    `過去90日間、オーガニック順位の中央値が${Math.round(input.medianOrganicRank90d)}位で頭打ちになっています。`
  );

  if (conditions.unhealthyTacosExceeded) {
    const ratio = Math.round(conditions.metrics.unhealthyTacosRatio * 100);
    parts.push(`TACOSもオレンジ〜レッドゾーンが${ratio}%の期間で継続。`);
  }

  if (conditions.lossUsageExceeded) {
    const ratio = Math.round(conditions.metrics.lossUsageRatio * 100);
    parts.push(`累積投資もLTV上限の${ratio}%に達しています。`);
  }

  parts.push(
    `理想は${input.rankTargetConfig.idealRank}位ですが、このクラスタについては運用上の目標順位を${input.rankTargetConfig.targetRank}位→${suggestedTargetRank}位に下げることを検討してください。`
  );

  return parts.join("");
}

// =============================================================================
// 提案生成
// =============================================================================

/**
 * 単一クラスタの目標順位調整提案を生成
 *
 * 入力にproductLtvProfileが含まれている場合、プロファイル別設定を自動的に使用。
 * configパラメータで明示的に設定を渡した場合はそちらを優先。
 *
 * @param input - 判定入力データ（productLtvProfileを含むことができる）
 * @param config - 判定設定（省略時はproductLtvProfileから自動決定）
 * @returns 提案（条件を満たさない場合はnull）
 */
export function generateRankAdjustmentSuggestion(
  input: RankAdjustmentInput,
  config?: RankAdjustmentConfig
): RankAdjustmentSuggestion | null {
  // プロファイル別設定を決定
  const effectiveConfig =
    config ?? getRankAdjustmentConfigForProfile(input.productLtvProfile);

  // 使用した設定名を記録
  const profileConfigName = input.productLtvProfile ?? "DEFAULT";

  // 条件チェック
  const conditions = checkUnrealisticConditions(input, effectiveConfig);

  // 最小条件数を満たしているかチェック
  if (conditions.conditionsMet < effectiveConfig.minConditionsToTrigger) {
    return null;
  }

  // 推奨targetRankを決定
  const suggestedTargetRank = determineSuggestedTargetRank(
    input.medianOrganicRank90d,
    input.rankTargetConfig.targetRank,
    effectiveConfig
  );

  // 変更がない場合は提案しない
  if (suggestedTargetRank <= input.rankTargetConfig.targetRank) {
    return null;
  }

  // 理由コードを決定
  const reasonCode: RankAdjustmentReasonCode = "UNREALISTIC_FOR_IDEAL";

  // 説明文を生成
  const explanation = generateExplanation(input, conditions, suggestedTargetRank);

  return {
    productId: input.productId,
    clusterId: input.clusterId,
    idealRank: input.rankTargetConfig.idealRank,
    currentTargetRank: input.rankTargetConfig.targetRank,
    suggestedTargetRank,
    reasonCode,
    explanation,
    metrics: {
      medianOrganicRank90d: input.medianOrganicRank90d,
      seoProgressScore90d: input.seoProgressScore90d,
      lossUsageRatio: conditions.metrics.lossUsageRatio,
      unhealthyTacosRatio: conditions.metrics.unhealthyTacosRatio,
      unhealthyTacosMonths: conditions.metrics.unhealthyTacosMonths,
    },
    suggestedAt: new Date(),
    productLtvProfile: input.productLtvProfile,
    rankAdjustmentProfileConfigName: profileConfigName,
  };
}

/**
 * 複数クラスタの目標順位調整提案をバルク生成
 *
 * 各入力のproductLtvProfileに応じて個別にプロファイル別設定を適用。
 * configパラメータで明示的に設定を渡した場合はすべてにその設定を適用。
 *
 * @param inputs - 判定入力データ配列
 * @param config - 判定設定（省略時は各入力のproductLtvProfileから自動決定）
 * @returns 提案配列（条件を満たすクラスタのみ）
 */
export function generateBulkRankAdjustmentSuggestions(
  inputs: RankAdjustmentInput[],
  config?: RankAdjustmentConfig
): RankAdjustmentSuggestion[] {
  const suggestions: RankAdjustmentSuggestion[] = [];

  for (const input of inputs) {
    const suggestion = generateRankAdjustmentSuggestion(input, config);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  return suggestions;
}

// =============================================================================
// 安定上振れ判定（STABLE_ABOVE_TARGET）
// =============================================================================

/**
 * 目標以上で安定しているかの判定入力
 */
export interface StableAboveTargetInput {
  /** 商品識別子（ASIN） */
  productId: string;

  /** クラスタ識別子 */
  clusterId: string;

  /** 現在のRankTargetConfig */
  rankTargetConfig: RankTargetConfig;

  /** 直近90日のSEO進捗メトリクス */
  seoProgressMetrics: SeoProgressMetrics;

  /** 直近90日のTACOSゾーン履歴 */
  tacosZoneHistory90d: TacosZone[];
}

/**
 * 目標以上で安定している場合の提案を生成
 *
 * seoProgressScore >= 1.1 かつ TACOSがGREEN中心の場合、
 * 「利益回収モードに寄せる余地がある」という提案を生成
 *
 * @param input - 判定入力データ
 * @returns 提案（条件を満たさない場合はnull）
 */
export function generateStableAboveTargetSuggestion(
  input: StableAboveTargetInput
): RankAdjustmentSuggestion | null {
  const { seoProgressMetrics, tacosZoneHistory90d, rankTargetConfig } = input;

  // SEO進捗スコアが高いか
  if (seoProgressMetrics.seoProgressScore < 1.1) {
    return null;
  }

  // TACOSがGREEN中心か
  const greenDays = tacosZoneHistory90d.filter(
    (zone) => zone === "GREEN"
  ).length;
  const greenRatio =
    tacosZoneHistory90d.length > 0
      ? greenDays / tacosZoneHistory90d.length
      : 0;

  if (greenRatio < 0.7) {
    return null;
  }

  // この場合、targetRankを下げる必要はないが、
  // 「利益回収モードに寄せてもよい」という情報提供として出力
  const explanation =
    `SEO順位が目標以上で安定しています（SEO進捗スコア: ${seoProgressMetrics.seoProgressScore.toFixed(2)}）。` +
    `TACOSもグリーンゾーン中心（${Math.round(greenRatio * 100)}%）で健全です。` +
    `このクラスタは利益回収モードに移行する余地があります。`;

  return {
    productId: input.productId,
    clusterId: input.clusterId,
    idealRank: rankTargetConfig.idealRank,
    currentTargetRank: rankTargetConfig.targetRank,
    suggestedTargetRank: rankTargetConfig.targetRank, // 変更なし
    reasonCode: "STABLE_ABOVE_TARGET",
    explanation,
    metrics: {
      medianOrganicRank90d: seoProgressMetrics.organicRank,
      seoProgressScore90d: seoProgressMetrics.seoProgressScore,
      lossUsageRatio: 0, // この判定では使用しない
      unhealthyTacosRatio: 1 - greenRatio,
    },
    suggestedAt: new Date(),
  };
}

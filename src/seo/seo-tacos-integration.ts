/**
 * SEO進捗とTACOS制御の統合
 *
 * seoProgressScoreをTACOSターゲット調整に反映する
 */

import {
  SeoProgressMetrics,
  SeoProgressConfig,
  DEFAULT_SEO_PROGRESS_CONFIG,
} from "./seo-rank-target.types";
import {
  TacosControlContext,
  StageTacosControlParams,
  TacosZone,
} from "../config/productConfigTypes";
import { determineSeoProgressLevel, SeoProgressLevel } from "./seo-progress-calculator";

// =============================================================================
// SEO進捗によるTACOS制御パラメータ調整
// =============================================================================

/**
 * SEO進捗を考慮したTACOS制御パラメータ調整結果
 */
export interface SeoAdjustedTacosParams {
  /** 元のtacosTargetMid */
  originalTacosTargetMid: number;

  /** 調整後のtacosTargetMid */
  adjustedTacosTargetMid: number;

  /** 元のtacosAcuity */
  originalTacosAcuity: number;

  /** 調整後のtacosAcuity */
  adjustedTacosAcuity: number;

  /** 適用されたSEO進捗レベル */
  seoProgressLevel: SeoProgressLevel;

  /** 調整が適用されたか */
  wasAdjusted: boolean;

  /** 調整理由 */
  adjustmentReason: string;
}

/**
 * SEO進捗を考慮してTACOS制御パラメータを調整
 *
 * - seoProgressScoreが1.0を大きく下回る場合:
 *   - まだ目標順位に届いていないため、「許容範囲内なら攻め続ける」方向にバイアス
 *   - tacosTargetMidを少し上側にシフト
 *   - tacosAcuityをやや下げる（TACOSの上振れに対して過敏に反応しない）
 *
 * - seoProgressScoreが1.1以上の場合:
 *   - 目標順位以上を安定して取れているため、「利益回収モード」に寄せる
 *   - tacosTargetMidをやや下側にシフト
 *   - tacosAcuityを高め、TACOSが上がったらすぐ締める
 *
 * @param tacosContext - 現在のTACOS制御コンテキスト
 * @param seoProgressScore - SEO進捗スコア
 * @param config - SEO進捗設定
 * @returns 調整されたTACOS制御パラメータ
 */
export function adjustTacosParamsBySeoProgress(
  tacosContext: TacosControlContext,
  seoProgressScore: number,
  config: SeoProgressConfig = DEFAULT_SEO_PROGRESS_CONFIG
): SeoAdjustedTacosParams {
  const seoProgressLevel = determineSeoProgressLevel(seoProgressScore, config);
  const { tacosTargetMid, controlParams } = tacosContext;
  const { tacosAcuity } = controlParams;
  const influence = config.seoInfluenceOnTacosTarget;

  let adjustedTacosTargetMid = tacosTargetMid;
  let adjustedTacosAcuity = tacosAcuity;
  let wasAdjusted = false;
  let adjustmentReason = "SEO進捗は目標レベル付近のため調整なし";

  switch (seoProgressLevel) {
    case "LOW":
      // まだ目標順位に届いていない → 攻め続ける
      // tacosTargetMidを上げる（より高いTACOSを許容）
      adjustedTacosTargetMid = tacosTargetMid * (1 + influence);
      // tacosAcuityを下げる（TACOSの上振れに鈍感に）
      adjustedTacosAcuity = tacosAcuity * (1 - influence * 0.5);
      wasAdjusted = true;
      adjustmentReason =
        `SEO進捗が低い（${seoProgressScore.toFixed(2)}）ため、攻め継続モード。` +
        `tacosTargetMidを${(influence * 100).toFixed(0)}%上方シフト。`;
      break;

    case "HIGH":
      // 目標以上に取れている → 利益回収モード
      // tacosTargetMidを下げる（より低いTACOSを目指す）
      adjustedTacosTargetMid = tacosTargetMid * (1 - influence);
      // tacosAcuityを上げる（TACOSの上振れに敏感に）
      adjustedTacosAcuity = tacosAcuity * (1 + influence * 0.5);
      wasAdjusted = true;
      adjustmentReason =
        `SEO進捗が高い（${seoProgressScore.toFixed(2)}）ため、利益回収モード。` +
        `tacosTargetMidを${(influence * 100).toFixed(0)}%下方シフト。`;
      break;

    case "ON_TARGET":
    default:
      // 目標レベル付近 → 調整なし
      break;
  }

  return {
    originalTacosTargetMid: tacosTargetMid,
    adjustedTacosTargetMid,
    originalTacosAcuity: tacosAcuity,
    adjustedTacosAcuity,
    seoProgressLevel,
    wasAdjusted,
    adjustmentReason,
  };
}

// =============================================================================
// 統合TACOS制御コンテキスト
// =============================================================================

/**
 * SEO進捗を考慮した統合TACOS制御コンテキスト
 */
export interface SeoIntegratedTacosContext extends TacosControlContext {
  /** SEO進捗メトリクス（あれば） */
  seoProgressMetrics?: SeoProgressMetrics;

  /** SEO調整結果 */
  seoAdjustment?: SeoAdjustedTacosParams;

  /** 調整前のオリジナルコンテキスト */
  originalContext: TacosControlContext;
}

/**
 * SEO進捗を考慮した統合TACOS制御コンテキストを構築
 *
 * @param tacosContext - 元のTACOS制御コンテキスト
 * @param seoProgressMetrics - SEO進捗メトリクス（オプション）
 * @param config - SEO進捗設定
 * @returns 統合TACOS制御コンテキスト
 */
export function buildSeoIntegratedTacosContext(
  tacosContext: TacosControlContext,
  seoProgressMetrics?: SeoProgressMetrics,
  config: SeoProgressConfig = DEFAULT_SEO_PROGRESS_CONFIG
): SeoIntegratedTacosContext {
  // SEO進捗メトリクスがない場合はそのまま返す
  if (!seoProgressMetrics) {
    return {
      ...tacosContext,
      originalContext: tacosContext,
    };
  }

  // SEO進捗によるパラメータ調整
  const seoAdjustment = adjustTacosParamsBySeoProgress(
    tacosContext,
    seoProgressMetrics.seoProgressScore,
    config
  );

  // 調整後のコンテキストを構築
  const adjustedContext: SeoIntegratedTacosContext = {
    ...tacosContext,
    tacosTargetMid: seoAdjustment.adjustedTacosTargetMid,
    controlParams: {
      ...tacosContext.controlParams,
      tacosAcuity: seoAdjustment.adjustedTacosAcuity,
    },
    // TACOSゾーンを再計算
    tacosZone: determineTacosZoneWithAdjustedMid(
      tacosContext.currentTacos,
      seoAdjustment.adjustedTacosTargetMid,
      tacosContext.tacosMax
    ),
    // TACOS乖離率を再計算
    tacosDelta: calculateTacosDeltaWithAdjustedMid(
      tacosContext.currentTacos,
      seoAdjustment.adjustedTacosTargetMid
    ),
    seoProgressMetrics,
    seoAdjustment,
    originalContext: tacosContext,
  };

  return adjustedContext;
}

/**
 * 調整後のtacosTargetMidでTACOSゾーンを判定
 */
function determineTacosZoneWithAdjustedMid(
  currentTacos: number,
  adjustedTacosTargetMid: number,
  tacosMax: number
): TacosZone {
  if (currentTacos <= adjustedTacosTargetMid) {
    return "GREEN";
  } else if (currentTacos <= tacosMax) {
    return "ORANGE";
  } else {
    return "RED";
  }
}

/**
 * 調整後のtacosTargetMidでTACOS乖離率を計算
 */
function calculateTacosDeltaWithAdjustedMid(
  currentTacos: number,
  adjustedTacosTargetMid: number,
  epsilon: number = 0.01
): number {
  const denominator = Math.max(adjustedTacosTargetMid, epsilon);
  return (adjustedTacosTargetMid - currentTacos) / denominator;
}

// =============================================================================
// targetAcos調整（SEO進捗統合版）
// =============================================================================

/**
 * SEO進捗を考慮したtargetAcos調整結果
 */
export interface SeoAdjustedTargetAcosResult {
  /** ベースLTV ACOS */
  baseLtvAcos: number;

  /** TACOS調整後のtargetAcos（SEO調整前） */
  tacosAdjustedTargetAcos: number;

  /** 最終targetAcos（SEO調整後） */
  finalTargetAcos: number;

  /** SEO調整が適用されたか */
  seoAdjustmentApplied: boolean;

  /** SEO進捗レベル */
  seoProgressLevel?: SeoProgressLevel;

  /** 調整詳細 */
  adjustmentDetails: string;
}

/**
 * SEO進捗を考慮した最終targetAcosを計算
 *
 * @param baseLtvAcos - ベースLTV ACOS
 * @param tacosAdjustedTargetAcos - TACOS調整後のtargetAcos
 * @param seoProgressMetrics - SEO進捗メトリクス（オプション）
 * @param config - SEO進捗設定
 * @returns SEO調整後のtargetAcos結果
 */
export function calculateFinalTargetAcosWithSeo(
  baseLtvAcos: number,
  tacosAdjustedTargetAcos: number,
  seoProgressMetrics?: SeoProgressMetrics,
  config: SeoProgressConfig = DEFAULT_SEO_PROGRESS_CONFIG
): SeoAdjustedTargetAcosResult {
  // SEO進捗メトリクスがない場合は調整なし
  if (!seoProgressMetrics) {
    return {
      baseLtvAcos,
      tacosAdjustedTargetAcos,
      finalTargetAcos: tacosAdjustedTargetAcos,
      seoAdjustmentApplied: false,
      adjustmentDetails: "SEO進捗メトリクスなし、調整なし",
    };
  }

  const seoProgressLevel = determineSeoProgressLevel(
    seoProgressMetrics.seoProgressScore,
    config
  );
  const influence = config.seoInfluenceOnTacosTarget;

  let finalTargetAcos = tacosAdjustedTargetAcos;
  let seoAdjustmentApplied = false;
  let adjustmentDetails = "";

  switch (seoProgressLevel) {
    case "LOW":
      // まだ目標順位に届いていない → targetAcosを上げる（攻め継続）
      finalTargetAcos = tacosAdjustedTargetAcos * (1 + influence);
      seoAdjustmentApplied = true;
      adjustmentDetails =
        `SEO進捗が低い（${seoProgressMetrics.seoProgressScore.toFixed(2)}）ため、` +
        `targetAcosを${(influence * 100).toFixed(0)}%上方調整（攻め継続）`;
      break;

    case "HIGH":
      // 目標以上に取れている → targetAcosを下げる（利益回収）
      finalTargetAcos = tacosAdjustedTargetAcos * (1 - influence);
      seoAdjustmentApplied = true;
      adjustmentDetails =
        `SEO進捗が高い（${seoProgressMetrics.seoProgressScore.toFixed(2)}）ため、` +
        `targetAcosを${(influence * 100).toFixed(0)}%下方調整（利益回収）`;
      break;

    case "ON_TARGET":
    default:
      adjustmentDetails = "SEO進捗は目標レベル付近のため調整なし";
      break;
  }

  return {
    baseLtvAcos,
    tacosAdjustedTargetAcos,
    finalTargetAcos,
    seoAdjustmentApplied,
    seoProgressLevel,
    adjustmentDetails,
  };
}

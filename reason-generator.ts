/**
 * Amazon広告自動入札提案エンジン - 理由テキスト生成
 */

import {
  ActionType,
  KeywordMetrics,
  GlobalConfig,
  BrandType,
  PhaseType,
  ScoreRank,
} from "./types";
import { calculateCVRBoost, calculateACOSDiff } from "./action-logic";

/**
 * アクションの日本語名を取得
 */
function getActionName(action: ActionType): string {
  const actionNames: Record<ActionType, string> = {
    STRONG_UP: "大幅引き上げ",
    MILD_UP: "引き上げ",
    KEEP: "維持",
    MILD_DOWN: "引き下げ",
    STRONG_DOWN: "大幅引き下げ",
    STOP: "停止",
  };
  return actionNames[action];
}

/**
 * ブランドタイプの日本語名を取得
 */
function getBrandTypeName(brandType: BrandType): string {
  const brandTypeNames: Record<BrandType, string> = {
    BRAND: "自社ブランド",
    CONQUEST: "競合ブランド",
    GENERIC: "一般キーワード",
  };
  return brandTypeNames[brandType];
}

/**
 * フェーズタイプの日本語名を取得
 */
function getPhaseTypeName(phaseType: PhaseType): string {
  const phaseTypeNames: Record<PhaseType, string> = {
    NORMAL: "通常期",
    S_PRE1: "セール前3時間",
    S_PRE2: "セール前1時間",
    S_FREEZE: "セール開始直後（凍結）",
    S_NORMAL: "セール中",
    S_FINAL: "セール終了6時間前",
    S_REVERT: "セール終了後",
  };
  return phaseTypeNames[phaseType];
}

/**
 * スコアランクの日本語名を取得
 */
function getScoreRankName(scoreRank: ScoreRank): string {
  const scoreRankNames: Record<ScoreRank, string> = {
    S: "最優秀",
    A: "優秀",
    B: "標準",
    C: "要改善",
  };
  return scoreRankNames[scoreRank];
}

/**
 * Facts（事実）を生成
 */
export function generateReasonFacts(
  metrics: KeywordMetrics,
  _config: GlobalConfig,
  _action: ActionType
): string {
  const cvrBoost = calculateCVRBoost(metrics.cvr_recent, metrics.cvr_baseline);
  const acosDiff = calculateACOSDiff(metrics.acos_actual, metrics.acos_target);

  const facts: string[] = [];

  // 基本情報
  facts.push(
    `現在の入札額: ${metrics.current_bid.toFixed(0)}円 | ` +
      `フェーズ: ${getPhaseTypeName(metrics.phase_type)} | ` +
      `スコア: ${getScoreRankName(metrics.score_rank)}ランク`
  );

  // CVR情報
  facts.push(
    `CVR: ${(metrics.cvr_recent * 100).toFixed(2)}% ` +
      `(ベースライン: ${(metrics.cvr_baseline * 100).toFixed(2)}%, ` +
      `変化率: ${(cvrBoost * 100).toFixed(1)}%)`
  );

  // ACOS情報
  facts.push(
    `ACOS: ${(metrics.acos_actual * 100).toFixed(1)}% ` +
      `(目標: ${(metrics.acos_target * 100).toFixed(1)}%, ` +
      `差分: ${(acosDiff * 100).toFixed(1)}%)`
  );

  // クリック数
  facts.push(`直近3時間のクリック数: ${metrics.clicks_3h}回`);

  // ブランドタイプ
  facts.push(`キーワード種別: ${getBrandTypeName(metrics.brand_type)}`);

  // 順位情報（ある場合）
  if (metrics.rank_current !== null && metrics.rank_target !== null) {
    facts.push(
      `現在順位: ${metrics.rank_current}位 (目標: ${metrics.rank_target}位)`
    );
  }

  // リスク情報
  if (metrics.risk_penalty > 0.3) {
    facts.push(`リスクペナルティ: ${(metrics.risk_penalty * 100).toFixed(0)}%`);
  }

  return facts.join(" | ");
}

/**
 * Logic（判断根拠）を生成
 */
export function generateReasonLogic(
  metrics: KeywordMetrics,
  config: GlobalConfig,
  action: ActionType,
  isTOSTargeted: boolean,
  coefficients: {
    phase_coeff: number;
    cvr_coeff: number;
    rank_gap_coeff: number;
    competitor_coeff: number;
    brand_coeff: number;
    stats_coeff: number;
    tos_coeff: number;
  }
): string {
  const cvrBoost = calculateCVRBoost(metrics.cvr_recent, metrics.cvr_baseline);
  const acosDiff = calculateACOSDiff(metrics.acos_actual, metrics.acos_target);

  const logics: string[] = [];

  // アクション決定理由
  logics.push(`判定: ${getActionName(action)}`);

  // データ十分性
  if (metrics.clicks_3h < config.min_clicks_for_decision) {
    logics.push("データ不足のため慎重に維持");
    return logics.join(" → ");
  }

  // ACOS基準の判定
  if (
    metrics.acos_target > 0 &&
    metrics.acos_actual >= metrics.acos_target * config.acos_hard_stop_multiplier
  ) {
    logics.push("ACOS基準超過により停止判定");
    return logics.join(" → ");
  }

  if (
    metrics.acos_target > 0 &&
    metrics.acos_actual >= metrics.acos_target * config.acos_soft_down_multiplier
  ) {
    logics.push("ACOS基準により大幅引き下げ判定");
  }

  // CVRベースの判定
  if (cvrBoost > 0.3) {
    logics.push("CVR大幅向上により引き上げ判定");
  } else if (cvrBoost > 0.1) {
    logics.push("CVR向上により引き上げ判定");
  } else if (cvrBoost < -0.3) {
    logics.push("CVR大幅低下により引き下げ判定");
  } else if (cvrBoost < -0.1) {
    logics.push("CVR低下により引き下げ判定");
  }

  // ACOS良好
  if (acosDiff < -metrics.acos_target * 0.2 && metrics.risk_penalty < 0.3) {
    logics.push("ACOS良好かつ低リスクにより引き上げ促進");
  }

  // 順位ギャップ
  if (metrics.rank_current !== null && metrics.rank_target !== null) {
    const rankGap = metrics.rank_current - metrics.rank_target;
    if (rankGap > 3) {
      logics.push("目標順位に未達のため引き上げ促進");
    }
  }

  // 競合状況
  if (
    metrics.comp_strength > 0.7 &&
    coefficients.competitor_coeff > 1.0
  ) {
    logics.push("競合入札増加により対抗");
  }

  // ブランド調整
  if (metrics.brand_type === "BRAND") {
    logics.push("自社ブランドのため積極的に");
  }

  // TOS攻め
  if (isTOSTargeted) {
    logics.push("TOS攻め対象として上限緩和");
  }

  // フェーズ調整
  if (config.mode === "S_MODE") {
    if (metrics.phase_type === "S_PRE1" || metrics.phase_type === "S_PRE2") {
      logics.push("セール前の準備期間として積極的に");
    } else if (metrics.phase_type === "S_FINAL") {
      logics.push("セール終盤として最大限攻める");
    } else if (metrics.phase_type === "S_FREEZE") {
      logics.push("セール開始直後のため凍結");
    }
  }

  return logics.join(" → ");
}

/**
 * Impact（影響予測）を生成
 */
export function generateReasonImpact(
  metrics: KeywordMetrics,
  _config: GlobalConfig,
  action: ActionType,
  newBid: number,
  changeRate: number,
  clipped: boolean
): string {
  const impacts: string[] = [];

  // 入札額変化
  const bidChange = newBid - metrics.current_bid;
  const bidChangePercent = (changeRate * 100).toFixed(1);

  if (action === "STOP") {
    impacts.push("入札を停止し、予算を他キーワードへ振り分け");
  } else if (action === "KEEP") {
    impacts.push("入札額を維持し、パフォーマンスを監視");
  } else {
    impacts.push(
      `入札額を${metrics.current_bid.toFixed(0)}円から` +
        `${newBid.toFixed(0)}円へ変更 (${bidChangePercent >= "0" ? "+" : ""}${bidChangePercent}%)`
    );

    if (bidChange > 0) {
      impacts.push(
        `クリック数とインプレッションの増加を期待 ` +
          `(予想3時間クリック: ${metrics.expected_clicks_3h.toFixed(1)}回)`
      );
    } else {
      impacts.push("コスト効率の改善とACOS低減を期待");
    }
  }

  // クリップ警告
  if (clipped) {
    impacts.push("⚠️ 変化率または上限額により調整済み");
  }

  // 予算警告
  if (action === "STRONG_UP" || action === "MILD_UP") {
    const estimatedCost = newBid * metrics.expected_clicks_3h;
    if (estimatedCost > metrics.campaign_budget_remaining * 0.5) {
      impacts.push("⚠️ キャンペーン予算の消化に注意");
    }
  }

  return impacts.join(" | ");
}

/**
 * 完全な理由テキストを生成
 */
export function generateReasonTexts(
  metrics: KeywordMetrics,
  config: GlobalConfig,
  action: ActionType,
  newBid: number,
  changeRate: number,
  clipped: boolean,
  isTOSTargeted: boolean,
  coefficients: {
    phase_coeff: number;
    cvr_coeff: number;
    rank_gap_coeff: number;
    competitor_coeff: number;
    brand_coeff: number;
    stats_coeff: number;
    tos_coeff: number;
  }
): {
  reason_facts: string;
  reason_logic: string;
  reason_impact: string;
} {
  return {
    reason_facts: generateReasonFacts(metrics, config, action),
    reason_logic: generateReasonLogic(
      metrics,
      config,
      action,
      isTOSTargeted,
      coefficients
    ),
    reason_impact: generateReasonImpact(
      metrics,
      config,
      action,
      newBid,
      changeRate,
      clipped
    ),
  };
}

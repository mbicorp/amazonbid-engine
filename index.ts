/**
 * Amazon広告自動入札提案エンジン - メインエントリーポイント
 *
 * このモジュールは3時間ごとに外部スケジューラから呼び出される想定です。
 * 複数のキーワード指標を入力として受け取り、各キーワードごとの入札提案を返します。
 */

import {
  KeywordMetrics,
  GlobalConfig,
  KeywordRecommendation,
  ActionType,
} from "./types";
import {
  determineAction,
  adjustActionForBrandOwn,
  getBaseChangeRate,
} from "./action-logic";
import { calculateAllCoefficients } from "./coefficients";
import { isTOSTargeted, isTOSEligible200 } from "./tos-logic";
import { computeBidAmount } from "./bid-calculation";
import { generateReasonTexts } from "./reason-generator";

/**
 * 単一キーワードの入札推奨を計算
 */
function computeSingleKeywordRecommendation(
  metrics: KeywordMetrics,
  config: GlobalConfig
): KeywordRecommendation {
  // 1. アクションを決定
  let action: ActionType = determineAction(metrics, config);

  // 2. Brand Own の場合、StrongDown と Stop を MildDown に変換
  action = adjustActionForBrandOwn(action, metrics.brand_type);

  // 3. S_FREEZE フェーズの場合は強制的に KEEP
  if (metrics.phase_type === "S_FREEZE") {
    action = "KEEP";
  }

  // 4. TOS判定
  const tosTargeted = isTOSTargeted(metrics, config);
  const tosEligible200 = isTOSEligible200(metrics, config);

  // 5. 基本変化率を取得
  const baseChangeRate = getBaseChangeRate(metrics.score_rank, action);

  // 6. 全係数を計算
  const coefficients = calculateAllCoefficients(
    metrics,
    config,
    action,
    tosTargeted
  );

  // 7. 入札額を計算
  const { change_rate, new_bid, clipped, clip_reason } = computeBidAmount(
    metrics,
    config,
    baseChangeRate,
    coefficients,
    action,
    tosEligible200
  );

  // 8. 理由テキストを生成
  const { reason_facts, reason_logic, reason_impact } = generateReasonTexts(
    metrics,
    config,
    action,
    new_bid,
    change_rate,
    clipped,
    tosTargeted,
    coefficients
  );

  // 9. 推奨結果を返す
  return {
    keyword_id: metrics.keyword_id,
    campaign_id: metrics.campaign_id,
    ad_group_id: metrics.ad_group_id,
    action,
    change_rate,
    new_bid,
    clipped,
    clip_reason,
    tos_targeted: tosTargeted,
    tos_eligible_200: tosEligible200,
    debug_coefficients: {
      base_change_rate: baseChangeRate,
      phase_coeff: coefficients.phase_coeff,
      cvr_coeff: coefficients.cvr_coeff,
      rank_gap_coeff: coefficients.rank_gap_coeff,
      competitor_coeff: coefficients.competitor_coeff,
      brand_coeff: coefficients.brand_coeff,
      stats_coeff: coefficients.stats_coeff,
      tos_coeff: coefficients.tos_coeff,
    },
    reason_facts,
    reason_logic,
    reason_impact,
  };
}

/**
 * メイン関数: 複数キーワードの入札推奨を計算
 *
 * @param keywordMetrics - キーワード指標の配列
 * @param config - グローバル設定
 * @returns キーワード推奨の配列
 */
export function compute_bid_recommendations(
  keywordMetrics: KeywordMetrics[],
  config: GlobalConfig
): KeywordRecommendation[] {
  // バリデーション
  if (!keywordMetrics || keywordMetrics.length === 0) {
    console.warn("入力されたキーワード指標が空です");
    return [];
  }

  if (config.manual_mode) {
    console.info("マニュアルモードが有効です。推奨のみを生成します。");
  }

  // 各キーワードについて推奨を計算
  const recommendations: KeywordRecommendation[] = keywordMetrics.map(
    (metrics) => {
      try {
        return computeSingleKeywordRecommendation(metrics, config);
      } catch (error) {
        console.error(
          `キーワード ${metrics.keyword_id} の処理中にエラーが発生しました:`,
          error
        );
        // エラーが発生した場合は KEEP を返す
        return {
          keyword_id: metrics.keyword_id,
          campaign_id: metrics.campaign_id,
          ad_group_id: metrics.ad_group_id,
          action: "KEEP",
          change_rate: 0,
          new_bid: metrics.current_bid,
          clipped: false,
          clip_reason: null,
          tos_targeted: false,
          tos_eligible_200: false,
          reason_facts: "エラーが発生しました",
          reason_logic: `処理中にエラー: ${error}`,
          reason_impact: "入札額を維持します",
        };
      }
    }
  );

  // 統計情報をログ出力
  logRecommendationSummary(recommendations, config);

  return recommendations;
}

/**
 * 推奨結果のサマリーをログ出力
 */
function logRecommendationSummary(
  recommendations: KeywordRecommendation[],
  config: GlobalConfig
): void {
  const total = recommendations.length;
  const actionCounts: Record<ActionType, number> = {
    STRONG_UP: 0,
    MILD_UP: 0,
    KEEP: 0,
    MILD_DOWN: 0,
    STRONG_DOWN: 0,
    STOP: 0,
  };

  let tosTargetedCount = 0;
  let tosEligible200Count = 0;
  let clippedCount = 0;

  recommendations.forEach((rec) => {
    actionCounts[rec.action]++;
    if (rec.tos_targeted) tosTargetedCount++;
    if (rec.tos_eligible_200) tosEligible200Count++;
    if (rec.clipped) clippedCount++;
  });

  console.log("\n=== 入札推奨サマリー ===");
  console.log(`モード: ${config.mode}`);
  console.log(`総キーワード数: ${total}`);
  console.log(`\nアクション別内訳:`);
  console.log(`  大幅引き上げ: ${actionCounts.STRONG_UP} (${((actionCounts.STRONG_UP / total) * 100).toFixed(1)}%)`);
  console.log(`  引き上げ: ${actionCounts.MILD_UP} (${((actionCounts.MILD_UP / total) * 100).toFixed(1)}%)`);
  console.log(`  維持: ${actionCounts.KEEP} (${((actionCounts.KEEP / total) * 100).toFixed(1)}%)`);
  console.log(`  引き下げ: ${actionCounts.MILD_DOWN} (${((actionCounts.MILD_DOWN / total) * 100).toFixed(1)}%)`);
  console.log(`  大幅引き下げ: ${actionCounts.STRONG_DOWN} (${((actionCounts.STRONG_DOWN / total) * 100).toFixed(1)}%)`);
  console.log(`  停止: ${actionCounts.STOP} (${((actionCounts.STOP / total) * 100).toFixed(1)}%)`);
  console.log(`\nTOS攻め対象: ${tosTargetedCount} (${((tosTargetedCount / total) * 100).toFixed(1)}%)`);
  console.log(`TOS 200%許可: ${tosEligible200Count} (${((tosEligible200Count / total) * 100).toFixed(1)}%)`);
  console.log(`クリップされた: ${clippedCount} (${((clippedCount / total) * 100).toFixed(1)}%)`);
  console.log("========================\n");
}

// デフォルトエクスポート
export default compute_bid_recommendations;

// 型定義も再エクスポート
export * from "./types";

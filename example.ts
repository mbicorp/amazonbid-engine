/**
 * Amazon広告自動入札提案エンジン - 使用例
 */

import {
  compute_bid_recommendations,
  KeywordMetrics,
  GlobalConfig,
} from "./index";

// グローバル設定の例
const globalConfig: GlobalConfig = {
  mode: "S_MODE", // または "NORMAL"
  manual_mode: false,

  max_change_rate_normal: 0.6, // 通常日の最大変化率 60%
  max_change_rate_smode_default: 1.5, // セール日の最大変化率 150%
  max_change_rate_smode_tos: 2.0, // TOS攻め時の最大変化率 200%

  min_clicks_for_decision: 5, // 判定に必要な最低クリック数
  min_clicks_for_confident: 20, // 確信度の高い判定に必要なクリック数
  min_clicks_for_tos: 40, // TOS攻め対象とするための最低クリック数

  acos_hard_stop_multiplier: 3.0, // ACOS がターゲットの3倍で停止
  acos_soft_down_multiplier: 1.5, // ACOS がターゲットの1.5倍で引き下げ

  currency: "JPY",
};

// キーワード指標のサンプルデータ
const sampleKeywords: KeywordMetrics[] = [
  // 例1: 高パフォーマンスキーワード（セール前）
  {
    keyword_id: "kw001",
    campaign_id: "camp001",
    ad_group_id: "ag001",

    phase_type: "S_PRE1", // セール3時間前
    brand_type: "BRAND",
    score_rank: "S",

    current_bid: 150,
    baseline_cpc: 120,

    acos_target: 0.20,
    acos_actual: 0.15, // 目標より良好

    cvr_recent: 0.08,
    cvr_baseline: 0.06, // CVR向上中
    ctr_recent: 0.025,
    ctr_baseline: 0.020,

    clicks_1h: 15,
    clicks_3h: 50, // 十分なデータ
    impressions_1h: 600,
    impressions_3h: 2000,

    rank_current: 5,
    rank_target: 3, // 目標順位に未達

    competitor_cpc_current: 180,
    competitor_cpc_baseline: 160,
    comp_strength: 0.7,

    risk_penalty: 0.1, // 低リスク

    priority_score: 0.95, // 高優先度
    tos_ctr_mult: 1.8,
    tos_cvr_mult: 1.5,
    tos_gap_cpc: 30,

    campaign_budget_remaining: 50000,
    expected_clicks_3h: 60,

    time_in_phase_minutes: 120,
  },

  // 例2: 改善が必要なキーワード
  {
    keyword_id: "kw002",
    campaign_id: "camp001",
    ad_group_id: "ag002",

    phase_type: "S_NORMAL",
    brand_type: "GENERIC",
    score_rank: "C",

    current_bid: 200,
    baseline_cpc: 150,

    acos_target: 0.25,
    acos_actual: 0.40, // 目標より悪化

    cvr_recent: 0.03,
    cvr_baseline: 0.05, // CVR低下
    ctr_recent: 0.015,
    ctr_baseline: 0.020,

    clicks_1h: 8,
    clicks_3h: 25,
    impressions_1h: 500,
    impressions_3h: 1500,

    rank_current: 8,
    rank_target: 5,

    competitor_cpc_current: 220,
    competitor_cpc_baseline: 210,
    comp_strength: 0.8,

    risk_penalty: 0.6, // 高リスク

    priority_score: 0.3,
    tos_ctr_mult: 0.8,
    tos_cvr_mult: 0.7,
    tos_gap_cpc: -10,

    campaign_budget_remaining: 20000,
    expected_clicks_3h: 30,

    time_in_phase_minutes: 360,
  },

  // 例3: 通常パフォーマンスキーワード（凍結期間）
  {
    keyword_id: "kw003",
    campaign_id: "camp002",
    ad_group_id: "ag003",

    phase_type: "S_FREEZE", // セール開始直後（凍結）
    brand_type: "CONQUEST",
    score_rank: "B",

    current_bid: 100,
    baseline_cpc: 95,

    acos_target: 0.30,
    acos_actual: 0.28,

    cvr_recent: 0.05,
    cvr_baseline: 0.05,
    ctr_recent: 0.018,
    ctr_baseline: 0.018,

    clicks_1h: 10,
    clicks_3h: 35,
    impressions_1h: 550,
    impressions_3h: 1800,

    rank_current: 6,
    rank_target: 6,

    competitor_cpc_current: 105,
    competitor_cpc_baseline: 100,
    comp_strength: 0.5,

    risk_penalty: 0.3,

    priority_score: 0.6,
    tos_ctr_mult: 1.1,
    tos_cvr_mult: 1.0,
    tos_gap_cpc: 5,

    campaign_budget_remaining: 30000,
    expected_clicks_3h: 40,

    time_in_phase_minutes: 90,
  },
];

// 推奨を計算
console.log("Amazon広告自動入札提案エンジン - 実行例\n");
console.log(`処理対象キーワード数: ${sampleKeywords.length}\n`);

const recommendations = compute_bid_recommendations(
  sampleKeywords,
  globalConfig
);

// 結果を表示
console.log("\n=== 入札推奨結果 ===\n");
recommendations.forEach((rec, index) => {
  console.log(`\n[${index + 1}] キーワードID: ${rec.keyword_id}`);
  console.log(`    アクション: ${rec.action}`);
  console.log(`    現在入札額 → 推奨入札額: ${sampleKeywords[index].current_bid}円 → ${rec.new_bid}円`);
  console.log(`    変化率: ${(rec.change_rate * 100).toFixed(1)}%`);
  console.log(`    TOS対象: ${rec.tos_targeted ? "はい" : "いいえ"}`);
  console.log(`    TOS 200%許可: ${rec.tos_eligible_200 ? "はい" : "いいえ"}`);
  console.log(`    クリップ: ${rec.clipped ? "あり" : "なし"}`);
  if (rec.clip_reason) {
    console.log(`    クリップ理由: ${rec.clip_reason}`);
  }
  console.log(`\n    【事実】\n    ${rec.reason_facts}`);
  console.log(`\n    【判断根拠】\n    ${rec.reason_logic}`);
  console.log(`\n    【影響予測】\n    ${rec.reason_impact}`);

  if (rec.debug_coefficients) {
    console.log(`\n    【デバッグ情報】`);
    console.log(`      基本変化率: ${(rec.debug_coefficients.base_change_rate * 100).toFixed(1)}%`);
    console.log(`      フェーズ係数: ${rec.debug_coefficients.phase_coeff.toFixed(2)}`);
    console.log(`      CVR係数: ${rec.debug_coefficients.cvr_coeff.toFixed(2)}`);
    console.log(`      順位ギャップ係数: ${rec.debug_coefficients.rank_gap_coeff.toFixed(2)}`);
    console.log(`      競合係数: ${rec.debug_coefficients.competitor_coeff.toFixed(2)}`);
    console.log(`      ブランド係数: ${rec.debug_coefficients.brand_coeff.toFixed(2)}`);
    console.log(`      統計係数: ${rec.debug_coefficients.stats_coeff.toFixed(2)}`);
    console.log(`      TOS係数: ${rec.debug_coefficients.tos_coeff.toFixed(2)}`);
  }
});

console.log("\n\n=== 実行完了 ===");

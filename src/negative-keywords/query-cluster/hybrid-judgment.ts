/**
 * ハイブリッド判定ロジック
 *
 * クラスター判定をベースに、重要キーワードの場合は単一キーワード判定で緩和可能
 *
 * 重要キーワードの定義:
 * 1. 自動検出: 広告費上位N件
 * 2. 手動ホワイトリスト: ASIN別 or グローバル
 *
 * 重要キーワードのオーバーライドルール:
 * - クラスター判定より「緩和」方向のみ許可
 * - 「厳格化」方向（クラスターOKなのに単一でNG）は許可しない
 */

import {
  ClusterJudgmentResult,
  HybridJudgmentResult,
  SingleKeywordJudgmentResult,
  ImportantKeywordConfig,
  ImportantKeywordCheckResult,
  ImportantKeywordReason,
  ClusterBasedNegativeConfig,
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG,
} from "./types";
import { judgeCluster, calculateRequiredClicksByRuleOfThree } from "./cluster-judgment";

// =============================================================================
// 重要キーワード判定
// =============================================================================

/**
 * 広告費ランキングを計算
 *
 * @param searchTermStats - 検索語統計（ASIN別）
 * @returns クエリ→ランクのマップ
 */
export function calculateSpendRanking(
  searchTermStats: Array<{ query: string; cost: number }>
): Map<string, number> {
  // コスト降順でソート
  const sorted = [...searchTermStats].sort((a, b) => b.cost - a.cost);

  // ランク付け
  const rankMap = new Map<string, number>();
  sorted.forEach((stat, index) => {
    rankMap.set(stat.query, index + 1);
  });

  return rankMap;
}

/**
 * 重要キーワードかどうかをチェック
 *
 * @param query - 検索クエリ
 * @param asin - ASIN
 * @param config - 重要キーワード設定
 * @param spendRanking - 広告費ランキング（オプション、自動検出用）
 * @param querySpend - クエリの広告費（オプション、自動検出用）
 * @returns 重要キーワードチェック結果
 */
export function checkImportantKeyword(
  query: string,
  asin: string,
  config: ImportantKeywordConfig,
  spendRanking?: Map<string, number>,
  querySpend?: number
): ImportantKeywordCheckResult {
  // 1. グローバルホワイトリストをチェック
  if (config.globalWhitelist.has(query)) {
    return {
      isImportant: true,
      reason: "GLOBAL_WHITELIST",
    };
  }

  // 2. ASIN別ホワイトリストをチェック
  const asinWhitelist = config.manualWhitelist.get(asin);
  if (asinWhitelist?.has(query)) {
    return {
      isImportant: true,
      reason: "MANUAL_WHITELIST",
    };
  }

  // 3. 自動検出（広告費上位N件）
  if (config.autoDetectEnabled && spendRanking && querySpend !== undefined) {
    const rank = spendRanking.get(query);
    if (
      rank !== undefined &&
      rank <= config.autoDetectTopN &&
      querySpend >= config.autoDetectMinSpend
    ) {
      return {
        isImportant: true,
        reason: "AUTO_TOP_SPEND",
        adSpend: querySpend,
        spendRank: rank,
      };
    }
  }

  return {
    isImportant: false,
    reason: "NOT_IMPORTANT",
  };
}

// =============================================================================
// 単一キーワード判定
// =============================================================================

/**
 * 単一キーワードのSTOP/NEG判定
 *
 * @param query - 検索クエリ
 * @param stats - 単一キーワードの統計
 * @param baselineCvr - ASINのベースラインCVR
 * @param config - 判定設定
 * @returns 単一キーワード判定結果
 */
export function judgeSingleKeyword(
  query: string,
  stats: {
    clicks: number;
    conversions: number;
    cost: number;
    revenue: number;
  },
  baselineCvr: number,
  config: ClusterBasedNegativeConfig
): SingleKeywordJudgmentResult {
  const { riskTolerance, minimumBaselineCvr } = config;

  // CVRの計算
  const cvr = stats.clicks > 0 ? stats.conversions / stats.clicks : null;
  const acos = stats.revenue > 0 ? stats.cost / stats.revenue : null;

  // ルールオブスリーによる必要クリック数
  const requiredClicks = calculateRequiredClicksByRuleOfThree(
    baselineCvr,
    riskTolerance,
    minimumBaselineCvr
  );

  // 判定
  let isStopCandidate = false;
  let isNegativeCandidate = false;
  let reasonCode: string;
  let reasonDetail: string;

  if (stats.conversions > 0) {
    // コンバージョンがある場合はSTOP/NEG対象外
    isStopCandidate = false;
    isNegativeCandidate = false;
    reasonCode = "SINGLE_HAS_CONVERSION";
    reasonDetail = `コンバージョンあり（${stats.conversions}件）。STOP/NEG対象外。`;
  } else if (stats.clicks < requiredClicks) {
    // ルールオブスリー未達
    isStopCandidate = false;
    isNegativeCandidate = false;
    reasonCode = "SINGLE_INSUFFICIENT_CLICKS";
    reasonDetail = `クリック不足（${stats.clicks} < 必要: ${requiredClicks}）。判定保留。`;
  } else {
    // CVR=0でルールオブスリー達成
    isStopCandidate = true;
    isNegativeCandidate = true;
    reasonCode = "SINGLE_NO_CONVERSION";
    reasonDetail = `CVR=0（クリック: ${stats.clicks} >= 必要: ${requiredClicks}）。STOP/NEG候補。`;
  }

  return {
    query,
    clicks: stats.clicks,
    conversions: stats.conversions,
    cvr,
    acos,
    isStopCandidate,
    isNegativeCandidate,
    reasonCode,
    reasonDetail,
  };
}

// =============================================================================
// ハイブリッド判定
// =============================================================================

/**
 * オーバーライドが許可されるかを判定
 *
 * 緩和方向のみ許可:
 * - クラスター: STOP候補 → 単一: 非候補 = 緩和（許可）
 * - クラスター: 非候補 → 単一: STOP候補 = 厳格化（禁止）
 *
 * @param clusterIsStopCandidate - クラスター判定がSTOP候補か
 * @param singleIsStopCandidate - 単一キーワード判定がSTOP候補か
 * @returns 緩和オーバーライドが適用されるか
 */
function isLooseningOverride(
  clusterIsStopCandidate: boolean,
  singleIsStopCandidate: boolean
): boolean {
  // クラスターがSTOP候補で、単一が非候補 = 緩和
  return clusterIsStopCandidate && !singleIsStopCandidate;
}

/**
 * ハイブリッド判定を実行
 *
 * @param query - 検索クエリ
 * @param asin - ASIN
 * @param clusterJudgment - クラスター判定結果
 * @param importantKeywordCheck - 重要キーワードチェック結果
 * @param singleKeywordStats - 単一キーワード統計（重要キーワードの場合）
 * @param baselineCvr - ASINのベースラインCVR
 * @param config - 判定設定
 * @returns ハイブリッド判定結果
 */
export function executeHybridJudgment(
  query: string,
  asin: string,
  clusterJudgment: ClusterJudgmentResult,
  importantKeywordCheck: ImportantKeywordCheckResult,
  singleKeywordStats?: {
    clicks: number;
    conversions: number;
    cost: number;
    revenue: number;
  },
  baselineCvr?: number,
  config: ClusterBasedNegativeConfig = DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
): HybridJudgmentResult {
  // 基本値はクラスター判定に従う
  let finalIsStopCandidate = clusterJudgment.isStopCandidate;
  let finalIsNegativeCandidate = clusterJudgment.isNegativeCandidate;
  let overrideApplied = false;
  let overrideDirection: "LOOSENED" | undefined = undefined;
  let singleKeywordJudgment: SingleKeywordJudgmentResult | undefined = undefined;

  // 重要キーワードの場合、単一キーワード判定でオーバーライド可能
  if (
    importantKeywordCheck.isImportant &&
    singleKeywordStats &&
    baselineCvr !== undefined
  ) {
    // 単一キーワード判定を実行
    singleKeywordJudgment = judgeSingleKeyword(
      query,
      singleKeywordStats,
      baselineCvr,
      config
    );

    // 緩和方向のオーバーライドのみ許可
    if (isLooseningOverride(clusterJudgment.isStopCandidate, singleKeywordJudgment.isStopCandidate)) {
      finalIsStopCandidate = singleKeywordJudgment.isStopCandidate;
      finalIsNegativeCandidate = singleKeywordJudgment.isNegativeCandidate;
      overrideApplied = true;
      overrideDirection = "LOOSENED";
    }
    // 厳格化方向は無視（クラスター判定を維持）
  }

  // 最終判定理由の生成
  let finalReasonCode: string;
  let finalReasonDetail: string;

  if (overrideApplied) {
    finalReasonCode = `HYBRID_OVERRIDE_${overrideDirection}`;
    finalReasonDetail = `重要キーワード（${importantKeywordCheck.reason}）による緩和オーバーライド適用。` +
      `クラスター判定: ${clusterJudgment.reasonCode} → 単一キーワード判定: ${singleKeywordJudgment!.reasonCode}。` +
      `${singleKeywordJudgment!.reasonDetail}`;
  } else if (importantKeywordCheck.isImportant && singleKeywordJudgment) {
    // 重要キーワードだがオーバーライドなし（クラスターと同じ結論 or 厳格化は禁止）
    finalReasonCode = "HYBRID_NO_OVERRIDE";
    finalReasonDetail = `重要キーワード（${importantKeywordCheck.reason}）だがオーバーライドなし。` +
      `クラスター判定と単一キーワード判定が一致、または厳格化は禁止。` +
      `最終判定はクラスター判定に従う: ${clusterJudgment.reasonDetail}`;
  } else {
    // 通常キーワード（クラスター判定をそのまま適用）
    finalReasonCode = `CLUSTER_${clusterJudgment.reasonCode}`;
    finalReasonDetail = clusterJudgment.reasonDetail;
  }

  return {
    asin,
    query,
    queryClusterId: clusterJudgment.queryClusterId,
    clusterJudgment,
    importantKeywordCheck,
    singleKeywordJudgment,
    finalIsStopCandidate,
    finalIsNegativeCandidate,
    overrideApplied,
    overrideDirection,
    finalReasonCode,
    finalReasonDetail,
  };
}

// =============================================================================
// バッチ処理
// =============================================================================

/**
 * 検索語リストに対してハイブリッド判定をバッチ実行
 *
 * @param searchTerms - 検索語統計のリスト
 * @param clusterJudgments - クラスター判定結果のマップ（queryClusterId → 結果）
 * @param asin - ASIN
 * @param baselineCvr - ASINのベースラインCVR
 * @param importantKeywordConfig - 重要キーワード設定
 * @param config - 判定設定
 * @returns ハイブリッド判定結果のリスト
 */
export function executeHybridJudgmentBatch(
  searchTerms: Array<{
    query: string;
    queryClusterId: string;
    clicks: number;
    conversions: number;
    cost: number;
    revenue: number;
  }>,
  clusterJudgments: Map<string, ClusterJudgmentResult>,
  asin: string,
  baselineCvr: number,
  importantKeywordConfig: ImportantKeywordConfig,
  config: ClusterBasedNegativeConfig = DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
): HybridJudgmentResult[] {
  // 広告費ランキングを計算
  const spendRanking = calculateSpendRanking(searchTerms);

  const results: HybridJudgmentResult[] = [];

  for (const term of searchTerms) {
    // クラスター判定を取得
    const clusterJudgment = clusterJudgments.get(term.queryClusterId);
    if (!clusterJudgment) {
      // クラスター判定がない場合はスキップ（エラーログ推奨）
      continue;
    }

    // 重要キーワードチェック
    const importantKeywordCheck = checkImportantKeyword(
      term.query,
      asin,
      importantKeywordConfig,
      spendRanking,
      term.cost
    );

    // ハイブリッド判定
    const result = executeHybridJudgment(
      term.query,
      asin,
      clusterJudgment,
      importantKeywordCheck,
      {
        clicks: term.clicks,
        conversions: term.conversions,
        cost: term.cost,
        revenue: term.revenue,
      },
      baselineCvr,
      config
    );

    results.push(result);
  }

  return results;
}

// =============================================================================
// 統計・サマリー
// =============================================================================

/**
 * ハイブリッド判定結果のサマリーを生成
 */
export interface HybridJudgmentSummary {
  totalQueries: number;
  stopCandidates: number;
  negativeCandidates: number;
  importantKeywords: {
    total: number;
    autoDetected: number;
    manualWhitelist: number;
    globalWhitelist: number;
  };
  overrides: {
    total: number;
    loosened: number;
  };
  byClusterPhase: {
    learning: number;
    limitedAction: number;
    stopCandidate: number;
  };
}

/**
 * ハイブリッド判定結果のサマリーを計算
 *
 * @param results - ハイブリッド判定結果のリスト
 * @returns サマリー
 */
export function summarizeHybridJudgmentResults(
  results: HybridJudgmentResult[]
): HybridJudgmentSummary {
  const summary: HybridJudgmentSummary = {
    totalQueries: results.length,
    stopCandidates: 0,
    negativeCandidates: 0,
    importantKeywords: {
      total: 0,
      autoDetected: 0,
      manualWhitelist: 0,
      globalWhitelist: 0,
    },
    overrides: {
      total: 0,
      loosened: 0,
    },
    byClusterPhase: {
      learning: 0,
      limitedAction: 0,
      stopCandidate: 0,
    },
  };

  for (const result of results) {
    // STOP/NEG候補カウント
    if (result.finalIsStopCandidate) summary.stopCandidates++;
    if (result.finalIsNegativeCandidate) summary.negativeCandidates++;

    // 重要キーワードカウント
    if (result.importantKeywordCheck.isImportant) {
      summary.importantKeywords.total++;
      switch (result.importantKeywordCheck.reason) {
        case "AUTO_TOP_SPEND":
          summary.importantKeywords.autoDetected++;
          break;
        case "MANUAL_WHITELIST":
          summary.importantKeywords.manualWhitelist++;
          break;
        case "GLOBAL_WHITELIST":
          summary.importantKeywords.globalWhitelist++;
          break;
      }
    }

    // オーバーライドカウント
    if (result.overrideApplied) {
      summary.overrides.total++;
      if (result.overrideDirection === "LOOSENED") {
        summary.overrides.loosened++;
      }
    }

    // クラスターフェーズ別カウント
    switch (result.clusterJudgment.phase) {
      case "LEARNING":
        summary.byClusterPhase.learning++;
        break;
      case "LIMITED_ACTION":
        summary.byClusterPhase.limitedAction++;
        break;
      case "STOP_CANDIDATE":
        summary.byClusterPhase.stopCandidate++;
        break;
    }
  }

  return summary;
}

/**
 * クラスターベースSTOP/NEG判定ロジック
 *
 * ASIN×検索意図クラスター単位でのSTOP/NEG判定を実行
 *
 * 判定フェーズ:
 * 1. LEARNING（クリック < 20）: STOP/NEG禁止、学習中
 * 2. LIMITED_ACTION（20 <= クリック < 60）: MILD_DOWN/STRONG_DOWNのみ許可
 * 3. STOP_CANDIDATE（クリック >= 60）: STOP/NEG候補
 */

import {
  QueryClusterMetrics,
  ClusterJudgmentPhase,
  ClusterJudgmentResult,
  ClusterJudgmentReasonCode,
  ClusterPhaseThresholds,
  LongTailThresholds,
  LongTailCheckResult,
  ClusterBasedNegativeConfig,
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG,
} from "./types";

// =============================================================================
// ルールオブスリー計算
// =============================================================================

/**
 * ルールオブスリーによる必要クリック数を計算
 *
 * CVR=0の検出には統計的に3/pクリック（p=期待CVR）が必要
 * リスク許容度で調整：高い=少ないクリックで判定、低い=多くのクリックが必要
 *
 * @param baselineCvr - ベースラインCVR（ASIN全体のCVR）
 * @param riskTolerance - リスク許容度（0-1、デフォルト0.5）
 * @param minimumCvr - 最小CVR（データ不足時の下限、デフォルト0.01）
 * @returns 必要クリック数
 */
export function calculateRequiredClicksByRuleOfThree(
  baselineCvr: number,
  riskTolerance: number = 0.5,
  minimumCvr: number = 0.01
): number {
  // ベースラインCVRの下限を適用
  const effectiveCvr = Math.max(baselineCvr, minimumCvr);

  // ルールオブスリー: 3 / CVR
  const baseRequiredClicks = 3 / effectiveCvr;

  // リスク許容度による調整
  // riskTolerance = 0.5 → 調整なし
  // riskTolerance = 1.0 → 50%減（より少ないクリックで判定）
  // riskTolerance = 0.0 → 50%増（より多くのクリックが必要）
  const adjustmentFactor = 1 - (riskTolerance - 0.5);
  const adjustedClicks = baseRequiredClicks * adjustmentFactor;

  // 最低10クリックは必要
  return Math.max(10, Math.ceil(adjustedClicks));
}

// =============================================================================
// フェーズ判定
// =============================================================================

/**
 * クリック数からクラスター判定フェーズを決定
 *
 * @param clicks - クラスターのクリック数
 * @param thresholds - フェーズしきい値
 * @returns クラスター判定フェーズ
 */
export function determineClusterPhase(
  clicks: number,
  thresholds: ClusterPhaseThresholds
): ClusterJudgmentPhase {
  if (clicks < thresholds.clusterClicksMinLearning) {
    return "LEARNING";
  } else if (clicks < thresholds.clusterClicksMinStopCandidate) {
    return "LIMITED_ACTION";
  } else {
    return "STOP_CANDIDATE";
  }
}

// =============================================================================
// ロングテール判定
// =============================================================================

/**
 * ロングテールクラスターかどうかを判定
 *
 * インプレッション < 200 かつ クリック < 5 のクラスターは
 * ロングテールとして扱い、自動停止ではなくレビュー推奨とする
 *
 * @param clusterMetrics - クラスターメトリクス
 * @param thresholds - ロングテール判定しきい値
 * @returns ロングテール判定結果
 */
export function checkLongTail(
  clusterMetrics: QueryClusterMetrics,
  thresholds: LongTailThresholds
): LongTailCheckResult {
  const isLongTail =
    clusterMetrics.impressions < thresholds.maxImpressions &&
    clusterMetrics.clicks < thresholds.maxClicks;

  // ロングテールの場合はレビュー推奨
  // ただし、コンバージョンがある場合は継続
  let recommendedAction: "AUTO_STOP" | "MANUAL_REVIEW" | "CONTINUE";
  let needsReview = false;

  if (!isLongTail) {
    recommendedAction = "CONTINUE";
  } else if (clusterMetrics.conversions > 0) {
    // コンバージョンがあるロングテールは継続
    recommendedAction = "CONTINUE";
  } else if (clusterMetrics.clicks === 0) {
    // クリックがないロングテールはレビュー推奨
    recommendedAction = "MANUAL_REVIEW";
    needsReview = true;
  } else {
    // クリックはあるがコンバージョンがないロングテール
    recommendedAction = "MANUAL_REVIEW";
    needsReview = true;
  }

  return {
    isLongTail,
    impressions: clusterMetrics.impressions,
    clicks: clusterMetrics.clicks,
    needsReview,
    recommendedAction,
  };
}

// =============================================================================
// クラスター判定ロジック
// =============================================================================

/**
 * クラスター単位でのSTOP/NEG判定を実行
 *
 * @param clusterMetrics - クラスターメトリクス
 * @param baselineCvr - ASINのベースラインCVR
 * @param config - 判定設定
 * @returns クラスター判定結果
 */
export function judgeCluster(
  clusterMetrics: QueryClusterMetrics,
  baselineCvr: number,
  config: ClusterBasedNegativeConfig = DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
): ClusterJudgmentResult {
  const { phaseThresholds, longTailThresholds, riskTolerance, minimumBaselineCvr } = config;

  // ルールオブスリーによる必要クリック数
  const requiredClicksByRuleOfThree = calculateRequiredClicksByRuleOfThree(
    baselineCvr,
    riskTolerance,
    minimumBaselineCvr
  );

  // フェーズ判定
  const phase = determineClusterPhase(clusterMetrics.clicks, phaseThresholds);

  // ロングテール判定
  const longTailCheck = checkLongTail(clusterMetrics, longTailThresholds);

  // 必要クリック数を満たしているか
  const meetsClickThreshold = clusterMetrics.clicks >= requiredClicksByRuleOfThree;

  // 判定結果の初期化
  let isStopCandidate = false;
  let isNegativeCandidate = false;
  let reasonCode: ClusterJudgmentReasonCode;
  let reasonDetail: string;

  // フェーズ別の判定
  switch (phase) {
    case "LEARNING":
      // 学習中: STOP/NEG禁止
      reasonCode = "CLUSTER_LEARNING";
      reasonDetail = `学習中（クリック: ${clusterMetrics.clicks} < ${phaseThresholds.clusterClicksMinLearning}）。データ蓄積中のためSTOP/NEG判定を保留。`;
      break;

    case "LIMITED_ACTION":
      // 限定アクション: MILD_DOWN/STRONG_DOWNのみ許可
      if (clusterMetrics.conversions === 0 && meetsClickThreshold) {
        // CVR=0でルールオブスリーを満たす場合、注意喚起
        reasonCode = "CLUSTER_LIMITED_ACTION";
        reasonDetail = `限定アクション（クリック: ${clusterMetrics.clicks}）。CVR=0でルールオブスリー（${requiredClicksByRuleOfThree}クリック）を満たすが、STOP候補しきい値（${phaseThresholds.clusterClicksMinStopCandidate}）未達のためDOWNのみ許可。`;
      } else {
        reasonCode = "CLUSTER_LIMITED_ACTION";
        reasonDetail = `限定アクション（クリック: ${clusterMetrics.clicks}）。STOP候補しきい値（${phaseThresholds.clusterClicksMinStopCandidate}）未達のためDOWNアクションのみ許可。`;
      }
      break;

    case "STOP_CANDIDATE":
      // STOP候補: ロングテールとCVR=0をチェック

      // ロングテールの場合はレビュー推奨
      if (longTailCheck.isLongTail && longTailCheck.needsReview) {
        reasonCode = "CLUSTER_LONG_TAIL_REVIEW";
        reasonDetail = `ロングテールクラスター（インプレッション: ${clusterMetrics.impressions}, クリック: ${clusterMetrics.clicks}）。手動レビューを推奨。`;
        break;
      }

      // CVR=0でルールオブスリーを満たす場合はSTOP/NEG候補
      if (clusterMetrics.conversions === 0 && meetsClickThreshold) {
        isStopCandidate = true;
        isNegativeCandidate = true;
        reasonCode = "CLUSTER_NO_CONVERSION";
        reasonDetail = `STOP/NEG候補: CVR=0（クリック: ${clusterMetrics.clicks} >= 必要クリック: ${requiredClicksByRuleOfThree}）。クラスター全体でコンバージョンなし。`;
        break;
      }

      // CVR=0だがルールオブスリー未達
      if (clusterMetrics.conversions === 0) {
        reasonCode = "CLUSTER_LIMITED_ACTION";
        reasonDetail = `CVR=0だがルールオブスリー未達（クリック: ${clusterMetrics.clicks} < 必要: ${requiredClicksByRuleOfThree}）。引き続きデータ蓄積中。`;
        break;
      }

      // CVRが低い場合（ベースラインの50%未満）
      if (clusterMetrics.cvr !== null && clusterMetrics.cvr < baselineCvr * 0.5) {
        reasonCode = "CLUSTER_LOW_CVR";
        reasonDetail = `低CVR（クラスターCVR: ${(clusterMetrics.cvr * 100).toFixed(2)}% < ベースライン: ${(baselineCvr * 100).toFixed(2)}%の50%）。入札DOWNを検討。`;
        break;
      }

      // ACOSが高い場合（利益率を超える）
      // 注: 利益率はここでは判定できないため、ACOSのみチェック
      if (clusterMetrics.acos !== null && clusterMetrics.acos > 1.0) {
        reasonCode = "CLUSTER_HIGH_ACOS";
        reasonDetail = `高ACOS（クラスターACOS: ${(clusterMetrics.acos * 100).toFixed(1)}% > 100%）。赤字のためDOWN検討。`;
        break;
      }

      // 問題なし
      reasonCode = "CLUSTER_OK";
      reasonDetail = `問題なし（クリック: ${clusterMetrics.clicks}, CVR: ${clusterMetrics.cvr !== null ? (clusterMetrics.cvr * 100).toFixed(2) + "%" : "N/A"}, ACOS: ${clusterMetrics.acos !== null ? (clusterMetrics.acos * 100).toFixed(1) + "%" : "N/A"}）。`;
      break;

    default:
      reasonCode = "CLUSTER_OK";
      reasonDetail = "判定エラー";
  }

  return {
    asin: clusterMetrics.asin,
    queryClusterId: clusterMetrics.queryClusterId,
    phase,
    isStopCandidate,
    isNegativeCandidate,
    reasonCode,
    reasonDetail,
    clusterMetrics,
    requiredClicksByRuleOfThree,
    meetsClickThreshold,
  };
}

// =============================================================================
// クラスターメトリクス集約
// =============================================================================

/**
 * 検索語レベルのメトリクスからクラスターメトリクスを集約
 *
 * @param asin - ASIN
 * @param queryClusterId - クラスターID
 * @param canonicalQuery - 正規化クエリ
 * @param queryIntentTag - 検索意図タグ
 * @param searchTermStats - 検索語統計の配列
 * @param windowDays - 集計期間（日数）
 * @returns クラスターメトリクス
 */
export function aggregateClusterMetrics(
  asin: string,
  queryClusterId: string,
  canonicalQuery: string,
  queryIntentTag: string,
  searchTermStats: Array<{
    query: string;
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    revenue: number;
  }>,
  windowDays: number = 30
): QueryClusterMetrics {
  // 集約
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalCost = 0;
  let totalConversions = 0;
  let totalRevenue = 0;
  const queryList: string[] = [];

  for (const stat of searchTermStats) {
    totalImpressions += stat.impressions;
    totalClicks += stat.clicks;
    totalCost += stat.cost;
    totalConversions += stat.conversions;
    totalRevenue += stat.revenue;
    queryList.push(stat.query);
  }

  // 派生値の計算
  const cpc = totalClicks > 0 ? totalCost / totalClicks : null;
  const cvr = totalClicks > 0 ? totalConversions / totalClicks : null;
  const acos = totalRevenue > 0 ? totalCost / totalRevenue : null;

  return {
    asin,
    queryClusterId,
    canonicalQuery,
    queryIntentTag: queryIntentTag as QueryClusterMetrics["queryIntentTag"],
    windowDays,
    impressions: totalImpressions,
    clicks: totalClicks,
    cost: totalCost,
    conversions: totalConversions,
    revenue: totalRevenue,
    cpc,
    cvr,
    acos,
    queriesInCluster: searchTermStats.length,
    queryList,
  };
}

// =============================================================================
// バッチ判定
// =============================================================================

/**
 * 複数のクラスターを一括判定
 *
 * @param clusterMetricsList - クラスターメトリクスのリスト
 * @param baselineCvrByAsin - ASIN別のベースラインCVR
 * @param config - 判定設定
 * @returns クラスター判定結果のリスト
 */
export function judgeClustersBatch(
  clusterMetricsList: QueryClusterMetrics[],
  baselineCvrByAsin: Map<string, number>,
  config: ClusterBasedNegativeConfig = DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
): ClusterJudgmentResult[] {
  const results: ClusterJudgmentResult[] = [];

  for (const clusterMetrics of clusterMetricsList) {
    const baselineCvr = baselineCvrByAsin.get(clusterMetrics.asin) ?? config.minimumBaselineCvr;
    const result = judgeCluster(clusterMetrics, baselineCvr, config);
    results.push(result);
  }

  return results;
}

/**
 * 判定結果をフィルタリング
 *
 * @param results - クラスター判定結果のリスト
 * @param filter - フィルタ条件
 * @returns フィルタされた判定結果
 */
export function filterJudgmentResults(
  results: ClusterJudgmentResult[],
  filter: {
    stopCandidatesOnly?: boolean;
    negativeCandidatesOnly?: boolean;
    phases?: ClusterJudgmentPhase[];
    reasonCodes?: ClusterJudgmentReasonCode[];
  }
): ClusterJudgmentResult[] {
  return results.filter((result) => {
    if (filter.stopCandidatesOnly && !result.isStopCandidate) {
      return false;
    }
    if (filter.negativeCandidatesOnly && !result.isNegativeCandidate) {
      return false;
    }
    if (filter.phases && !filter.phases.includes(result.phase)) {
      return false;
    }
    if (filter.reasonCodes && !filter.reasonCodes.includes(result.reasonCode)) {
      return false;
    }
    return true;
  });
}

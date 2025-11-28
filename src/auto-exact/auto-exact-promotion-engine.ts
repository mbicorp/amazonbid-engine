/**
 * AUTO→EXACT 昇格エンジン - コアロジック
 *
 * AUTO キャンペーンの検索語データから EXACT キーワードへの昇格候補を計算する純粋関数群
 * SHADOWモード専用で、Amazon Ads API への自動登録は行いません
 */

import {
  PromotionConfig,
  PromotionCandidate,
  PromotionCandidatesResult,
  PromotionReasonCode,
  SearchTermStats30dRow,
  IntentClusterStats30dRow,
  AsinBaselineStats30dRow,
  ProductConfigForPromotion,
  ExistingExactKeywordRow,
  TargetManualCampaignRow,
  LifecycleState,
  LIFECYCLE_PROMOTION_CONFIGS,
  DEFAULT_PROMOTION_CONFIG,
} from "./types";
import { ExecutionMode } from "../logging/types";

// =============================================================================
// 基準 CVR 計算
// =============================================================================

/**
 * ASIN ベースラインCVR を取得
 */
export function getAsinBaselineCvr(
  asin: string,
  baselines: AsinBaselineStats30dRow[]
): number {
  const baseline = baselines.find((b) => b.asin === asin);
  return baseline?.cvr ?? 0;
}

/**
 * ポートフォリオベースラインCVR を取得
 *
 * 現時点では productConfig から取得するが、
 * 将来的にはポートフォリオ内の CVR 中央値を計算するビューから取得
 */
export function getPortfolioBaselineCvr(
  productConfig: ProductConfigForPromotion
): number {
  // ポートフォリオベースラインが設定されていればそれを使用
  if (productConfig.portfolioBaselineCvr != null) {
    return productConfig.portfolioBaselineCvr;
  }
  // 未設定の場合は 0 を返す（effective では asin_baseline が使われる）
  return 0;
}

/**
 * 有効ベースラインCVR を計算
 * effective_baseline_cvr = max(asin_baseline_cvr, portfolio_baseline_cvr)
 */
export function getEffectiveBaselineCvr(
  asinBaselineCvr: number,
  portfolioBaselineCvr: number
): number {
  return Math.max(asinBaselineCvr, portfolioBaselineCvr);
}

// =============================================================================
// ライフサイクル別設定取得
// =============================================================================

/**
 * ライフサイクルステートに応じた PromotionConfig を取得
 */
export function getPromotionConfigForLifecycle(
  lifecycleState: LifecycleState | string | null | undefined
): PromotionConfig {
  if (!lifecycleState) {
    return DEFAULT_PROMOTION_CONFIG;
  }
  const state = lifecycleState as LifecycleState;
  return LIFECYCLE_PROMOTION_CONFIGS[state] ?? DEFAULT_PROMOTION_CONFIG;
}

// =============================================================================
// クラスタフィルタ
// =============================================================================

/**
 * クラスタがフィルタ条件を通過するかを判定
 */
export function isClusterEligible(
  cluster: IntentClusterStats30dRow,
  effectiveBaselineCvr: number,
  targetAcos: number,
  config: PromotionConfig
): boolean {
  // 条件1: 最小クリック数
  if (cluster.clicks < config.clusterMinClicks) {
    return false;
  }

  // 条件2: 最小注文数
  if (cluster.orders < config.clusterMinOrders) {
    return false;
  }

  // 条件3: CVR が基準以上
  const clusterCvr = cluster.cvr ?? 0;
  const cvrThreshold = effectiveBaselineCvr * config.clusterCvrRatio;
  if (clusterCvr < cvrThreshold) {
    return false;
  }

  // 条件4: ACOS が目標以下
  const clusterAcos = cluster.acos ?? Infinity;
  const acosThreshold = targetAcos * config.clusterAcosRatio;
  if (clusterAcos > acosThreshold) {
    return false;
  }

  return true;
}

/**
 * 昇格対象となるクラスタをフィルタ
 */
export function filterEligibleClusters(
  clusters: IntentClusterStats30dRow[],
  asin: string,
  effectiveBaselineCvr: number,
  targetAcos: number,
  config: PromotionConfig
): IntentClusterStats30dRow[] {
  return clusters.filter(
    (cluster) =>
      cluster.asin === asin &&
      isClusterEligible(cluster, effectiveBaselineCvr, targetAcos, config)
  );
}

// =============================================================================
// 検索語フィルタ
// =============================================================================

/**
 * 検索語がフィルタ条件を通過するかを判定
 */
export function isSearchTermEligible(
  searchTerm: SearchTermStats30dRow,
  clusterCvr: number | null,
  effectiveBaselineCvr: number,
  targetAcos: number,
  config: PromotionConfig
): boolean {
  // 条件1: 最小クリック数
  if (searchTerm.clicks < config.keywordMinClicks) {
    return false;
  }

  // 条件2: 最小注文数
  if (searchTerm.orders < config.keywordMinOrders) {
    return false;
  }

  // 条件3: CVR が基準以上
  const searchTermCvr = searchTerm.cvr ?? 0;
  const baseCvr = Math.max(clusterCvr ?? 0, effectiveBaselineCvr);
  const cvrThreshold = baseCvr * config.keywordCvrRatio;
  if (searchTermCvr < cvrThreshold) {
    return false;
  }

  // 条件4: ACOS が目標以下
  const searchTermAcos = searchTerm.acos ?? Infinity;
  const acosThreshold = targetAcos * config.keywordAcosRatio;
  if (searchTermAcos > acosThreshold) {
    return false;
  }

  return true;
}

// =============================================================================
// 重複・除外チェック
// =============================================================================

/**
 * 既存の EXACT キーワードに重複があるかをチェック
 */
export function isDuplicateExactKeyword(
  searchTerm: string,
  profileId: string,
  existingKeywords: ExistingExactKeywordRow[]
): boolean {
  const normalizedSearchTerm = searchTerm.toLowerCase().trim();
  return existingKeywords.some(
    (kw) =>
      kw.profile_id === profileId &&
      kw.keyword_text.toLowerCase().trim() === normalizedSearchTerm
  );
}

/**
 * ネガティブキーワード候補に含まれているかをチェック
 */
export function isNegativeKeywordCandidate(
  searchTerm: string,
  asin: string,
  negativeKeywordQueries: Set<string>
): boolean {
  // ネガティブキーワードセットのキーは "asin:query" 形式を想定
  const key = `${asin}:${searchTerm.toLowerCase().trim()}`;
  return negativeKeywordQueries.has(key);
}

// =============================================================================
// スコア計算
// =============================================================================

/**
 * 昇格優先度スコアを計算
 * score = cvr / (acos / target_acos)
 * CVR が高く、ACOS が低いほど高スコア
 */
export function calculatePromotionScore(
  cvr: number,
  acos: number,
  targetAcos: number
): number {
  if (acos <= 0 || targetAcos <= 0) {
    // ACOS が 0 以下の場合は高スコア（非常に効率的）
    return cvr * 100;
  }
  const acosRatio = acos / targetAcos;
  return cvr / acosRatio;
}

// =============================================================================
// 理由コード決定
// =============================================================================

/**
 * 昇格理由コードを決定
 */
export function determineReasonCodes(
  searchTermCvr: number,
  searchTermAcos: number,
  effectiveBaselineCvr: number,
  targetAcos: number,
  clusterCvr: number | null,
  lifecycleState: LifecycleState,
  config: PromotionConfig
): PromotionReasonCode[] {
  const reasons: PromotionReasonCode[] = [];

  // HIGH_CVR: CVR が基準を大きく上回る
  const baseCvr = Math.max(clusterCvr ?? 0, effectiveBaselineCvr);
  if (searchTermCvr >= baseCvr * 1.2) {
    reasons.push("HIGH_CVR");
  }

  // LOW_ACOS: ACOS が目標を大きく下回る
  if (searchTermAcos <= targetAcos * 0.8) {
    reasons.push("LOW_ACOS");
  }

  // CLUSTER_PERFORMER: クラスタ CVR を上回る
  if (clusterCvr != null && searchTermCvr >= clusterCvr * 1.1) {
    reasons.push("CLUSTER_PERFORMER");
  }

  // LIFECYCLE_BOOST: ライフサイクル緩和による昇格
  if (
    lifecycleState === "LAUNCH_HARD" ||
    lifecycleState === "LAUNCH_SOFT"
  ) {
    reasons.push("LIFECYCLE_BOOST");
  }

  // デフォルトで HIGH_VOLUME を追加（フィルタを通過しているため）
  if (reasons.length === 0) {
    reasons.push("HIGH_VOLUME");
  }

  return reasons;
}

/**
 * 理由の詳細説明を生成
 */
export function generateReasonDetail(
  searchTermCvr: number,
  searchTermAcos: number,
  effectiveBaselineCvr: number,
  targetAcos: number,
  clusterCvr: number | null,
  reasonCodes: PromotionReasonCode[]
): string {
  const parts: string[] = [];

  parts.push(`CVR: ${(searchTermCvr * 100).toFixed(2)}%`);
  parts.push(`ACOS: ${(searchTermAcos * 100).toFixed(2)}%`);
  parts.push(`Baseline CVR: ${(effectiveBaselineCvr * 100).toFixed(2)}%`);
  parts.push(`Target ACOS: ${(targetAcos * 100).toFixed(2)}%`);

  if (clusterCvr != null) {
    parts.push(`Cluster CVR: ${(clusterCvr * 100).toFixed(2)}%`);
  }

  parts.push(`Reasons: ${reasonCodes.join(", ")}`);

  return parts.join(" | ");
}

// =============================================================================
// ターゲット MANUAL キャンペーン検索
// =============================================================================

/**
 * ターゲット MANUAL キャンペーンを検索
 */
export function findTargetManualCampaign(
  asin: string,
  profileId: string,
  targetCampaigns: TargetManualCampaignRow[]
): TargetManualCampaignRow | null {
  // 同一 ASIN を扱っている MANUAL キャンペーンを探す
  const candidate = targetCampaigns.find(
    (c) => c.asin === asin && c.profile_id === profileId
  );
  return candidate ?? null;
}

// =============================================================================
// メイン計算関数
// =============================================================================

/**
 * AUTO→EXACT 昇格候補を計算
 *
 * @param searchTerms - search_term_stats_30d から取得した検索語データ
 * @param clusters - intent_cluster_stats_30d から取得したクラスタデータ
 * @param baselines - asin_baseline_stats_30d から取得したベースラインデータ
 * @param productConfigs - product_config から取得した商品設定
 * @param targetCampaigns - ターゲット MANUAL キャンペーン情報
 * @param existingKeywords - 既存の EXACT キーワード（重複除外用）
 * @param negativeKeywordQueries - ネガティブキーワード候補のクエリセット
 * @param profileId - プロファイルID
 * @param mode - 実行モード（"SHADOW" 固定）
 * @returns 昇格候補の計算結果
 */
export function computeAutoExactPromotionCandidates(
  searchTerms: SearchTermStats30dRow[],
  clusters: IntentClusterStats30dRow[],
  baselines: AsinBaselineStats30dRow[],
  productConfigs: ProductConfigForPromotion[],
  targetCampaigns: TargetManualCampaignRow[],
  existingKeywords: ExistingExactKeywordRow[],
  negativeKeywordQueries: Set<string>,
  profileId: string,
  mode: ExecutionMode
): PromotionCandidatesResult {
  const candidates: PromotionCandidate[] = [];
  const stats = {
    totalAsinsProcessed: 0,
    totalClustersProcessed: 0,
    clustersPassedFilter: 0,
    totalSearchTermsProcessed: 0,
    searchTermsPassedFilter: 0,
    duplicatesExcluded: 0,
    negativesExcluded: 0,
  };

  // 商品設定をASINでインデックス化
  const productConfigMap = new Map<string, ProductConfigForPromotion>();
  for (const config of productConfigs) {
    productConfigMap.set(config.asin, config);
  }

  // クラスタをASINでグループ化
  const clustersByAsin = new Map<string, IntentClusterStats30dRow[]>();
  for (const cluster of clusters) {
    const asinClusters = clustersByAsin.get(cluster.asin) ?? [];
    asinClusters.push(cluster);
    clustersByAsin.set(cluster.asin, asinClusters);
  }

  // 検索語をクラスタIDでグループ化
  const searchTermsByCluster = new Map<string, SearchTermStats30dRow[]>();
  for (const term of searchTerms) {
    if (term.intent_cluster_id) {
      const key = `${term.asin}:${term.intent_cluster_id}`;
      const terms = searchTermsByCluster.get(key) ?? [];
      terms.push(term);
      searchTermsByCluster.set(key, terms);
    }
  }

  // 処理済み検索語を追跡（重複防止）
  const processedSearchTerms = new Set<string>();

  // 各 ASIN について処理
  const processedAsins = new Set<string>();
  for (const [asin, asinClusters] of clustersByAsin) {
    if (processedAsins.has(asin)) continue;
    processedAsins.add(asin);
    stats.totalAsinsProcessed++;

    // 商品設定を取得
    const productConfig = productConfigMap.get(asin);
    if (!productConfig) continue;

    // 基準値を計算
    const asinBaselineCvr = getAsinBaselineCvr(asin, baselines);
    const portfolioBaselineCvr = getPortfolioBaselineCvr(productConfig);
    const effectiveBaselineCvr = getEffectiveBaselineCvr(
      asinBaselineCvr,
      portfolioBaselineCvr
    );

    // ライフサイクル別設定を取得
    const promotionConfig = getPromotionConfigForLifecycle(
      productConfig.lifecycleState
    );

    // 1. クラスタフィルタ
    stats.totalClustersProcessed += asinClusters.length;
    const eligibleClusters = filterEligibleClusters(
      asinClusters,
      asin,
      effectiveBaselineCvr,
      productConfig.targetAcos,
      promotionConfig
    );
    stats.clustersPassedFilter += eligibleClusters.length;

    // 2. 各クラスタの検索語をフィルタ
    for (const cluster of eligibleClusters) {
      const clusterKey = `${asin}:${cluster.intent_cluster_id}`;
      const clusterSearchTerms = searchTermsByCluster.get(clusterKey) ?? [];

      for (const term of clusterSearchTerms) {
        stats.totalSearchTermsProcessed++;

        // 重複チェック（同じ検索語が複数のクラスタに属する可能性）
        const termKey = `${profileId}:${asin}:${term.search_term.toLowerCase()}`;
        if (processedSearchTerms.has(termKey)) {
          continue;
        }

        // 既存 EXACT キーワードとの重複チェック
        if (isDuplicateExactKeyword(term.search_term, profileId, existingKeywords)) {
          stats.duplicatesExcluded++;
          processedSearchTerms.add(termKey);
          continue;
        }

        // ネガティブキーワード候補との重複チェック
        if (isNegativeKeywordCandidate(term.search_term, asin, negativeKeywordQueries)) {
          stats.negativesExcluded++;
          processedSearchTerms.add(termKey);
          continue;
        }

        // 検索語フィルタ
        if (
          !isSearchTermEligible(
            term,
            cluster.cvr,
            effectiveBaselineCvr,
            productConfig.targetAcos,
            promotionConfig
          )
        ) {
          continue;
        }

        stats.searchTermsPassedFilter++;
        processedSearchTerms.add(termKey);

        // ターゲット MANUAL キャンペーンを検索
        const targetCampaign = findTargetManualCampaign(
          asin,
          profileId,
          targetCampaigns
        );

        // スコア計算
        const cvr = term.cvr ?? 0;
        const acos = term.acos ?? 0;
        const score = calculatePromotionScore(cvr, acos, productConfig.targetAcos);

        // 理由コード決定
        const reasonCodes = determineReasonCodes(
          cvr,
          acos,
          effectiveBaselineCvr,
          productConfig.targetAcos,
          cluster.cvr,
          productConfig.lifecycleState,
          promotionConfig
        );

        // 理由詳細生成
        const reasonDetail = generateReasonDetail(
          cvr,
          acos,
          effectiveBaselineCvr,
          productConfig.targetAcos,
          cluster.cvr,
          reasonCodes
        );

        // 候補を追加
        candidates.push({
          profileId,
          asin,
          searchTerm: term.search_term,
          matchType: "EXACT",
          campaignIdAuto: term.campaign_id,
          adGroupIdAuto: term.ad_group_id,
          campaignIdManualTarget: targetCampaign?.campaign_id ?? null,
          adGroupIdManualTarget: targetCampaign?.ad_group_id ?? null,
          intentClusterId: cluster.intent_cluster_id,
          intentClusterLabel: cluster.intent_cluster_label ?? null,
          clicks: term.clicks,
          impressions: term.impressions,
          orders: term.orders,
          sales: term.sales,
          cost: term.cost,
          cvr,
          acos,
          clusterClicks: cluster.clicks,
          clusterCvr: cluster.cvr,
          asinBaselineCvr,
          portfolioBaselineCvr,
          effectiveBaselineCvr,
          targetAcos: productConfig.targetAcos,
          score,
          reasonCodes,
          reasonDetail,
          lifecycleState: productConfig.lifecycleState,
        });
      }
    }
  }

  // スコア降順でソート
  candidates.sort((a, b) => b.score - a.score);

  return {
    profileId,
    mode,
    candidates,
    stats,
  };
}

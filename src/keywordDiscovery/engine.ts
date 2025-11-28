/**
 * キーワード自動発見エンジン
 *
 * 検索語レポート起点でのキーワード候補抽出とスコアリングを行う。
 * フェーズ二では Jungle Scout からの候補も統合可能な設計。
 */

import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import {
  CandidateKeyword,
  DiscoverySource,
  SearchTermMetrics,
  JungleScoutMetrics,
  KeywordDiscoveryConfig,
  DEFAULT_KEYWORD_DISCOVERY_CONFIG,
  SearchTermReportRow,
  ExistingKeyword,
  ProductConfigForDiscovery,
  KeywordDiscoveryStats,
  ScoreBreakdown,
  SuggestedMatchType,
  createEmptyJungleScoutMetrics,
} from "./types";
import {
  JungleScoutDiscoveryClient,
  JungleScoutKeywordResult,
  createJungleScoutDiscoveryClient,
} from "./jungleScoutClient";

// =============================================================================
// 正規化ユーティリティ
// =============================================================================

/**
 * キーワードを正規化（比較用）
 * - 小文字に変換
 * - 全角を半角に変換
 * - 前後の空白を除去
 * - 連続する空白を単一スペースに
 */
export function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    // 全角英数字を半角に
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xfee0)
    )
    // 全角スペースを半角に
    .replace(/　/g, " ")
    // 全角記号を半角に（一部）
    .replace(/[！-～]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xfee0)
    )
    .trim()
    .replace(/\s+/g, " ");
}

// =============================================================================
// スコアリングユーティリティ
// =============================================================================

/**
 * 検索語由来のスコアを計算
 *
 * スコア構成（各0-25点、合計0-100点）:
 * 1. 注文数スコア: 注文が多いほど高評価
 * 2. クリック数スコア: クリックが多いほど高評価
 * 3. CVRスコア: CVRが高いほど高評価
 * 4. ACOSスコア: ACOSが低いほど高評価
 */
function calculateSearchTermScore(
  metrics: SearchTermMetrics,
  config: KeywordDiscoveryConfig,
  targetAcos: number
): number {
  // 注文数スコア（0-25点）
  const ordersScore = Math.min(25, (metrics.orders7d / config.ordersScoreMax) * 25);

  // クリック数スコア（0-25点）
  const clicksScore = Math.min(25, (metrics.clicks7d / config.clicksScoreMax) * 25);

  // CVRスコア（0-25点）
  const cvr = metrics.cvr7d ?? 0;
  const cvrScore = Math.min(25, cvr * 500); // CVR 5%で満点

  // ACOSスコア（0-25点）- ACOSが低いほど高得点
  const acos = metrics.acos7d ?? 1;
  let acosScore = 0;
  if (acos <= config.acosScoreBest) {
    acosScore = 25;
  } else if (acos >= config.acosScoreWorst) {
    acosScore = 0;
  } else {
    // 線形補間
    const range = config.acosScoreWorst - config.acosScoreBest;
    acosScore = 25 * (1 - (acos - config.acosScoreBest) / range);
  }

  // target_acosに対する相対評価ボーナス
  let targetAcosBonus = 0;
  if (acos < targetAcos * 0.5) {
    targetAcosBonus = 10; // 目標の50%未満なら+10点
  } else if (acos < targetAcos * 0.8) {
    targetAcosBonus = 5; // 目標の80%未満なら+5点
  }

  const totalScore = ordersScore + clicksScore + cvrScore + acosScore + targetAcosBonus;

  // 0-100に正規化
  return Math.min(100, Math.max(0, totalScore));
}

/**
 * Jungle Scout 由来のスコアを計算
 * フェーズ二で実装予定。現在は常に0を返す。
 *
 * スコア構成（予定）:
 * 1. 検索ボリュームスコア
 * 2. 競合スコア（低いほど高評価）
 * 3. 関連度スコア
 * 4. トレンドスコア
 */
function calculateJungleScoutScore(
  metrics: JungleScoutMetrics | null,
  config: KeywordDiscoveryConfig
): number {
  if (!metrics || !config.enableJungleScout) {
    return 0;
  }

  // ============================================================
  // TODO: フェーズ二で以下を実装
  // ============================================================
  // 検索ボリュームスコア（0-25点）
  // const volumeScore = Math.min(25, (metrics.searchVolumeExact ?? 0) / 10000 * 25);
  //
  // 競合スコア（0-25点）- 競合が少ないほど高得点
  // const competitionScore = metrics.competitionScore != null
  //   ? 25 * (1 - metrics.competitionScore / 100)
  //   : 12.5;
  //
  // 関連度スコア（0-25点）
  // const relevancyScore = (metrics.relevancyScore ?? 50) / 4;
  //
  // トレンドスコア（0-25点）
  // let trendScore = 12.5;
  // if (metrics.trendingDirection === "up") {
  //   trendScore = 25;
  // } else if (metrics.trendingDirection === "down") {
  //   trendScore = 0;
  // }
  //
  // return volumeScore + competitionScore + relevancyScore + trendScore;
  // ============================================================

  return 0;
}

/**
 * 総合スコアを計算
 */
function calculateTotalScore(
  searchTermScore: number,
  jungleScoutScore: number,
  config: KeywordDiscoveryConfig
): { score: number; breakdown: ScoreBreakdown } {
  const weights = {
    searchTerm: config.searchTermWeight,
    jungleScout: config.jungleScoutWeight,
  };

  // 重みの正規化
  const totalWeight = weights.searchTerm + weights.jungleScout;
  const normalizedWeights = {
    searchTerm: totalWeight > 0 ? weights.searchTerm / totalWeight : 1,
    jungleScout: totalWeight > 0 ? weights.jungleScout / totalWeight : 0,
  };

  const score =
    searchTermScore * normalizedWeights.searchTerm +
    jungleScoutScore * normalizedWeights.jungleScout;

  return {
    score: Math.round(score * 10) / 10, // 小数点1桁
    breakdown: {
      searchTermScore,
      jungleScoutScore,
      weights: normalizedWeights,
    },
  };
}

// =============================================================================
// マッチタイプ推奨ロジック
// =============================================================================

/**
 * 推奨マッチタイプを決定
 *
 * 判定ロジック:
 * - 注文数が多い（3以上）: EXACT推奨
 * - 2語以下の短いキーワード: EXACT推奨
 * - 3語以上のロングテール: PHRASE推奨
 */
function determineSuggestedMatchType(
  query: string,
  metrics: SearchTermMetrics
): SuggestedMatchType {
  const wordCount = query.trim().split(/\s+/).length;

  // 注文実績が十分ある場合はEXACT
  if (metrics.orders7d >= 3) {
    return "EXACT";
  }

  // 短いキーワードはEXACT
  if (wordCount <= 2) {
    return "EXACT";
  }

  // ロングテールはPHRASE
  return "PHRASE";
}

// =============================================================================
// メイン関数: 検索語レポートからキーワード候補を抽出
// =============================================================================

/**
 * 検索語レポートからキーワード候補を抽出
 *
 * @param searchTerms - 検索語レポートデータ
 * @param existingKeywords - 既存のキーワード一覧（重複除外用）
 * @param productConfigs - 商品設定
 * @param config - 設定
 * @returns キーワード候補の配列
 */
export function discoverNewKeywordsFromSearchTerms(
  searchTerms: SearchTermReportRow[],
  existingKeywords: ExistingKeyword[],
  productConfigs: Map<string, ProductConfigForDiscovery>,
  config: KeywordDiscoveryConfig = DEFAULT_KEYWORD_DISCOVERY_CONFIG
): { candidates: CandidateKeyword[]; stats: Partial<KeywordDiscoveryStats> } {
  const startTime = Date.now();
  const candidates: CandidateKeyword[] = [];

  // 既存キーワードを正規化してSetに
  const existingKeywordSet = new Set<string>(
    existingKeywords.map((kw) => `${kw.asin}:${kw.normalizedKeyword}`)
  );

  // 統計情報
  let totalSearchTermsProcessed = 0;
  let duplicatesExcluded = 0;
  let belowThresholdExcluded = 0;
  const processedAsins = new Set<string>();

  for (const row of searchTerms) {
    totalSearchTermsProcessed++;
    processedAsins.add(row.asin);

    const normalizedQuery = normalizeKeyword(row.query);
    const asinKey = `${row.asin}:${normalizedQuery}`;

    // 1. 既存キーワードとの重複チェック
    if (existingKeywordSet.has(asinKey)) {
      duplicatesExcluded++;
      continue;
    }

    // 商品設定を取得
    const productConfig = productConfigs.get(row.asin);
    const targetAcos = productConfig?.targetAcos ?? 0.3;
    const categoryBaselineCvr = productConfig?.categoryBaselineCvr ?? 0.02;

    // 2. 除外条件チェック
    // 表示回数が閾値未満
    if (row.impressions < config.excludeBelowImpressions) {
      belowThresholdExcluded++;
      continue;
    }

    // クリックゼロ除外
    if (config.excludeZeroClicks && row.clicks === 0) {
      belowThresholdExcluded++;
      continue;
    }

    // 3. 候補条件チェック
    // 最小表示回数
    if (row.impressions < config.minImpressions7d) {
      belowThresholdExcluded++;
      continue;
    }

    // 最小クリック数
    if (row.clicks < config.minClicks7d) {
      belowThresholdExcluded++;
      continue;
    }

    // 注文数またはCVR条件
    const cvr = row.cvr ?? (row.clicks > 0 ? row.orders / row.clicks : 0);
    const meetsOrderCondition = row.orders >= config.minOrders7d;
    const meetsCvrCondition = cvr >= categoryBaselineCvr * config.minCvrMultiplier;

    if (!meetsOrderCondition && !meetsCvrCondition) {
      belowThresholdExcluded++;
      continue;
    }

    // ACOS条件（クリックがあり売上がある場合のみ評価）
    const acos = row.acos ?? (row.sales > 0 ? row.cost / row.sales : null);
    if (acos !== null && acos > targetAcos * config.maxAcosMultiplier) {
      belowThresholdExcluded++;
      continue;
    }

    // 極端にパフォーマンスが悪い検索語を除外
    // クリックは多いのに注文ゼロかつACOSが極端に悪い
    if (row.clicks >= 20 && row.orders === 0) {
      belowThresholdExcluded++;
      continue;
    }

    // 4. 検索語指標を構築
    const searchTermMetrics: SearchTermMetrics = {
      impressions7d: row.impressions,
      clicks7d: row.clicks,
      orders7d: row.orders,
      sales7d: row.sales,
      cost7d: row.cost,
      acos7d: acos,
      cvr7d: cvr,
      cpc7d: row.clicks > 0 ? row.cost / row.clicks : null,
    };

    // 5. スコア計算
    const searchTermScore = calculateSearchTermScore(searchTermMetrics, config, targetAcos);
    const { score, breakdown } = calculateTotalScore(searchTermScore, 0, config);

    // 6. マッチタイプ決定
    const suggestedMatchType = determineSuggestedMatchType(row.query, searchTermMetrics);

    // 7. 候補を作成
    const candidate: CandidateKeyword = {
      id: uuidv4(),
      asin: row.asin,
      query: row.query,
      normalizedQuery,
      suggestedMatchType,
      source: "SEARCH_TERM",
      searchTermMetrics,
      jungleScoutMetrics: null,
      score,
      scoreBreakdown: breakdown,
      state: "PENDING_REVIEW",
      discoveredAt: new Date(),
      updatedAt: new Date(),
      profileId: row.profile_id,
      campaignId: row.campaign_id,
      adGroupId: row.ad_group_id,
    };

    candidates.push(candidate);

    // 重複防止のためSetに追加
    existingKeywordSet.add(asinKey);
  }

  const processingTimeMs = Date.now() - startTime;

  logger.info("Discovered new keywords from search terms", {
    totalSearchTermsProcessed,
    duplicatesExcluded,
    belowThresholdExcluded,
    candidatesCount: candidates.length,
    processingTimeMs,
  });

  return {
    candidates,
    stats: {
      totalAsinsProcessed: processedAsins.size,
      totalSearchTermsProcessed,
      duplicatesExcluded,
      belowThresholdExcluded,
      searchTermCandidates: candidates.length,
      processingTimeMs,
    },
  };
}

// =============================================================================
// メイン関数: Jungle Scout からキーワード候補を抽出（フェーズ二）
// =============================================================================

/**
 * Jungle Scout からキーワード候補を抽出
 *
 * フェーズ二で本実装予定。現在は空配列を返す。
 *
 * @param asins - 対象ASIN配列
 * @param existingKeywords - 既存のキーワード一覧
 * @param config - 設定
 * @returns キーワード候補の配列
 */
export async function discoverNewKeywordsFromJungleScout(
  asins: string[],
  existingKeywords: ExistingKeyword[],
  config: KeywordDiscoveryConfig = DEFAULT_KEYWORD_DISCOVERY_CONFIG
): Promise<{ candidates: CandidateKeyword[]; stats: Partial<KeywordDiscoveryStats> }> {
  if (!config.enableJungleScout) {
    logger.info("Jungle Scout is disabled, skipping keyword discovery from Jungle Scout");
    return {
      candidates: [],
      stats: {
        jungleScoutCandidates: 0,
      },
    };
  }

  logger.info("Starting keyword discovery from Jungle Scout", {
    asinCount: asins.length,
  });

  const startTime = Date.now();
  const candidates: CandidateKeyword[] = [];

  // 既存キーワードを正規化してSetに
  const existingKeywordSet = new Set<string>(
    existingKeywords.map((kw) => `${kw.asin}:${kw.normalizedKeyword}`)
  );

  // Jungle Scout クライアントを作成
  const jsClient = createJungleScoutDiscoveryClient(config);

  if (!jsClient.isEnabled()) {
    logger.warn("Jungle Scout client is not enabled, returning empty array");
    return {
      candidates: [],
      stats: {
        jungleScoutCandidates: 0,
      },
    };
  }

  // 各ASINに対してキーワードを取得
  const keywordsMap = await jsClient.fetchRelatedKeywordsForAsins(asins);

  for (const [asin, jsKeywords] of keywordsMap) {
    for (const jsKeyword of jsKeywords) {
      const normalizedQuery = normalizeKeyword(jsKeyword.keyword);
      const asinKey = `${asin}:${normalizedQuery}`;

      // 重複チェック
      if (existingKeywordSet.has(asinKey)) {
        continue;
      }

      // Jungle Scout スコア計算
      const jungleScoutScore = calculateJungleScoutScore(jsKeyword.metrics, config);
      const { score, breakdown } = calculateTotalScore(0, jungleScoutScore, config);

      // 候補を作成
      const candidate: CandidateKeyword = {
        id: uuidv4(),
        asin,
        query: jsKeyword.keyword,
        normalizedQuery,
        suggestedMatchType: "EXACT", // Jungle Scout由来はデフォルトEXACT
        source: "JUNGLE_SCOUT",
        searchTermMetrics: null,
        jungleScoutMetrics: jsKeyword.metrics,
        score,
        scoreBreakdown: breakdown,
        state: "PENDING_REVIEW",
        discoveredAt: new Date(),
        updatedAt: new Date(),
      };

      candidates.push(candidate);
      existingKeywordSet.add(asinKey);
    }
  }

  const processingTimeMs = Date.now() - startTime;

  logger.info("Discovered new keywords from Jungle Scout", {
    candidatesCount: candidates.length,
    processingTimeMs,
  });

  return {
    candidates,
    stats: {
      jungleScoutCandidates: candidates.length,
      processingTimeMs,
    },
  };
}

// =============================================================================
// メイン関数: 候補の統合とスコアリング
// =============================================================================

/**
 * 検索語由来と Jungle Scout 由来の候補を統合
 *
 * 同じ asin + query の組み合わせは一行にまとめ、source を BOTH に設定。
 * スコアは両方の指標を考慮して再計算。
 *
 * @param searchTermCandidates - 検索語由来の候補
 * @param jungleScoutCandidates - Jungle Scout 由来の候補
 * @param config - 設定
 * @returns 統合された候補の配列
 */
export function mergeAndScoreCandidates(
  searchTermCandidates: CandidateKeyword[],
  jungleScoutCandidates: CandidateKeyword[],
  config: KeywordDiscoveryConfig = DEFAULT_KEYWORD_DISCOVERY_CONFIG
): CandidateKeyword[] {
  // asin:normalizedQuery をキーとしたマップを作成
  const candidateMap = new Map<string, CandidateKeyword>();

  // 検索語由来の候補を追加
  for (const candidate of searchTermCandidates) {
    const key = `${candidate.asin}:${candidate.normalizedQuery}`;
    candidateMap.set(key, { ...candidate });
  }

  // Jungle Scout 由来の候補を統合
  for (const jsCandidate of jungleScoutCandidates) {
    const key = `${jsCandidate.asin}:${jsCandidate.normalizedQuery}`;
    const existing = candidateMap.get(key);

    if (existing) {
      // 既存の候補に Jungle Scout 情報を追加
      const merged: CandidateKeyword = {
        ...existing,
        source: "BOTH",
        jungleScoutMetrics: jsCandidate.jungleScoutMetrics,
        updatedAt: new Date(),
      };

      // スコアを再計算
      const searchTermScore = existing.scoreBreakdown.searchTermScore;
      const jungleScoutScore = calculateJungleScoutScore(
        jsCandidate.jungleScoutMetrics,
        config
      );
      const { score, breakdown } = calculateTotalScore(
        searchTermScore,
        jungleScoutScore,
        config
      );

      merged.score = score;
      merged.scoreBreakdown = breakdown;

      candidateMap.set(key, merged);
    } else {
      // 新規候補として追加
      candidateMap.set(key, { ...jsCandidate });
    }
  }

  // スコア降順でソート
  const merged = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score);

  logger.info("Merged and scored candidates", {
    searchTermCount: searchTermCandidates.length,
    jungleScoutCount: jungleScoutCandidates.length,
    mergedCount: merged.length,
    bothSourceCount: merged.filter((c) => c.source === "BOTH").length,
  });

  return merged;
}

// =============================================================================
// 統合実行関数
// =============================================================================

/**
 * キーワード発見処理を統合実行
 *
 * @param searchTerms - 検索語レポートデータ
 * @param existingKeywords - 既存のキーワード一覧
 * @param productConfigs - 商品設定
 * @param config - 設定
 * @returns 発見されたキーワード候補と統計情報
 */
export async function runKeywordDiscovery(
  searchTerms: SearchTermReportRow[],
  existingKeywords: ExistingKeyword[],
  productConfigs: Map<string, ProductConfigForDiscovery>,
  config: KeywordDiscoveryConfig = DEFAULT_KEYWORD_DISCOVERY_CONFIG
): Promise<{ candidates: CandidateKeyword[]; stats: KeywordDiscoveryStats }> {
  const startTime = Date.now();

  logger.info("Starting keyword discovery", {
    searchTermCount: searchTerms.length,
    existingKeywordCount: existingKeywords.length,
    productConfigCount: productConfigs.size,
    enableJungleScout: config.enableJungleScout,
  });

  // 1. 検索語レポートからキーワード候補を抽出
  const searchTermResult = discoverNewKeywordsFromSearchTerms(
    searchTerms,
    existingKeywords,
    productConfigs,
    config
  );

  // 2. Jungle Scout からキーワード候補を抽出（有効な場合）
  const asins = Array.from(productConfigs.keys());
  const jungleScoutResult = await discoverNewKeywordsFromJungleScout(
    asins,
    existingKeywords,
    config
  );

  // 3. 候補を統合
  const mergedCandidates = mergeAndScoreCandidates(
    searchTermResult.candidates,
    jungleScoutResult.candidates,
    config
  );

  const totalProcessingTimeMs = Date.now() - startTime;

  // 統計情報を統合
  const stats: KeywordDiscoveryStats = {
    totalAsinsProcessed: searchTermResult.stats.totalAsinsProcessed ?? 0,
    totalSearchTermsProcessed: searchTermResult.stats.totalSearchTermsProcessed ?? 0,
    duplicatesExcluded: searchTermResult.stats.duplicatesExcluded ?? 0,
    belowThresholdExcluded: searchTermResult.stats.belowThresholdExcluded ?? 0,
    searchTermCandidates: searchTermResult.stats.searchTermCandidates ?? 0,
    jungleScoutCandidates: jungleScoutResult.stats.jungleScoutCandidates ?? 0,
    finalCandidates: mergedCandidates.length,
    processingTimeMs: totalProcessingTimeMs,
  };

  logger.info("Completed keyword discovery", {
    finalCandidates: mergedCandidates.length,
    stats,
  });

  return {
    candidates: mergedCandidates,
    stats,
  };
}

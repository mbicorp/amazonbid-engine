/**
 * CORE_SEO候補スコア計算ヘルパー
 *
 * 「このASINについて本気でSEO上位を取りに行くべきキーワード候補」をスコアリングする。
 *
 * CORE_SEOキーワードとは:
 * このASINについて「本気でSEO上位を取りに行く」対象キーワードです。
 * LAUNCH期に最も優先的に投資し、オーガニック順位を押し上げることを目的としています。
 *
 * スコアリング要素:
 * - 検索ボリューム（search volume）
 * - テキスト関連度（商品タイトル/説明との一致度）
 * - ブランド指名性（ブランド名を含むか）
 * - コンバージョンシェア（その検索語での自社シェア）
 * - 競合度（CPC高さ、スポンサー枠の多さ）
 *
 * ブランド成熟度による動的調整:
 * - ブランド未成熟期: ブランド指名キーワードの重みを下げる
 * - ブランド成長期: 徐々に重みを上げる
 * - ブランド確立後: 指名キーワードを本格的に活用
 */

// =============================================================================
// 型定義
// =============================================================================

/**
 * CORE_SEOスコア計算用の入力メトリクス
 */
export interface CoreKeywordMetrics {
  /** 月間検索ボリューム（Brand Analyticsや外部ツールから） */
  searchVolumeMonth: number;

  /** 商品テキスト（タイトル/説明/検索用キーワード等）との意味的関連度 0〜1 */
  relText: number;

  /** ブランド指名性（ブランド名/シリーズ名を含むかどうか）0, 0.5, 1 など */
  relBrand: number;

  /** その検索語に対する自社コンバージョンシェア 0〜1 */
  convShare: number;

  /** その検索語の推奨CPCがカテゴリ内でどれくらい高いか（0〜1） */
  cpcPercentile: number;

  /** 検索結果1ページあたりのスポンサー枠の多さ（0〜1正規化） */
  sponsoredSlotsNorm: number;

  /** ブランド名を含む全検索語の月間検索ボリューム合計（ブランドの育ち具合） */
  brandSearchVolume: number;
}

/**
 * CORE_SEOスコア計算用の設定
 */
export interface CoreScoreConfig {
  /** 検索ボリューム正規化用: カテゴリ内での最大想定ボリューム */
  maxSearchVolumeInCategory: number;

  /** 自社コンバージョンシェアの基準値（これ以上は頭打ち） */
  convShareRef: number;

  /** ブランド成熟度のしきい値（ステージ1: 未成熟） */
  brandVolumeStage1: number;

  /** ブランド成熟度のしきい値（ステージ2: 成長期） */
  brandVolumeStage2: number;

  /** 各要素の基礎係数 */
  weightVolume: number;       // 検索ボリュームの重要度
  weightText: number;         // 商品との関連性の重要度
  weightBrandBase: number;    // ブランド指名性の基礎係数
  weightConv: number;         // コンバージョンシェアの重要度
  weightCompetition: number;  // 競合度ペナルティの強さ
}

/**
 * CORE_SEOスコア計算の内訳詳細
 */
export interface CoreScoreBreakdown {
  /** 検索ボリュームの正規化値（0〜1） */
  volNorm: number;
  /** コンバージョンシェアの正規化値（0〜1） */
  convNorm: number;
  /** 競合度スコア（0〜1） */
  compScore: number;
  /** ブランド成熟度に応じた実効ブランド重み */
  brandWeightEffective: number;
  /** 各要素の寄与度 */
  contributions: {
    volume: number;
    text: number;
    brand: number;
    conv: number;
    competition: number;  // これはマイナス寄与
  };
  /** 最終スコア */
  score: number;
}

/**
 * CORE_SEOスコア計算結果
 */
export interface CoreScoreResult {
  /** 最終スコア */
  score: number;
  /** 計算詳細 */
  breakdown: CoreScoreBreakdown;
}

// =============================================================================
// デフォルト設定
// =============================================================================

/**
 * デフォルトのCORE_SEOスコア計算設定
 *
 * サプリメントカテゴリ向けの初期設定。
 * 実運用では商品カテゴリやブランド状況に応じて調整が必要。
 */
export const DEFAULT_CORE_SCORE_CONFIG: CoreScoreConfig = {
  // 検索ボリューム正規化: サプリカテゴリでの大まかな最大値
  maxSearchVolumeInCategory: 100000,

  // コンバージョンシェア基準: 40%シェアで頭打ち
  convShareRef: 0.4,

  // ブランド成熟度しきい値
  brandVolumeStage1: 3000,   // 月間3000回未満: 未成熟
  brandVolumeStage2: 10000,  // 月間10000回以上: 確立

  // 各要素の重み
  weightVolume: 2,           // 検索ボリューム
  weightText: 3,             // 商品との関連性（最重要）
  weightBrandBase: 2.5,      // ブランド指名性の基礎
  weightConv: 1.5,           // コンバージョンシェア
  weightCompetition: 1,      // 競合度ペナルティ
};

// =============================================================================
// メイン関数
// =============================================================================

/**
 * CORE_SEOスコアを計算
 *
 * 複数の要素を組み合わせて、キーワードのCORE_SEO候補としての優先度をスコアリングする。
 *
 * @param m - キーワードメトリクス
 * @param config - 計算設定（デフォルト設定使用可）
 * @returns スコアと計算詳細
 *
 * @example
 * ```typescript
 * const result = computeCoreSeoScore({
 *   searchVolumeMonth: 5000,
 *   relText: 0.8,
 *   relBrand: 0,
 *   convShare: 0.15,
 *   cpcPercentile: 0.6,
 *   sponsoredSlotsNorm: 0.5,
 *   brandSearchVolume: 2000,
 * });
 * console.log(result.score); // 3.5 など
 * ```
 */
export function computeCoreSeoScore(
  m: CoreKeywordMetrics,
  config: CoreScoreConfig = DEFAULT_CORE_SCORE_CONFIG
): CoreScoreResult {
  // ==========================================================================
  // 1. 検索ボリュームの正規化（対数スケール、0〜1）
  // ==========================================================================
  const maxVol = config.maxSearchVolumeInCategory;
  let volNorm = 0;
  if (maxVol > 0 && m.searchVolumeMonth > 0) {
    // 対数スケールで正規化（大きなボリュームの差を緩和）
    volNorm = Math.log(1 + m.searchVolumeMonth) / Math.log(1 + maxVol);
    volNorm = Math.min(1, Math.max(0, volNorm));
  }

  // ==========================================================================
  // 2. コンバージョンシェアの正規化（基準値でクリップ）
  // ==========================================================================
  const convRef = config.convShareRef;
  let convNorm = 0;
  if (convRef > 0 && m.convShare > 0) {
    const ratio = m.convShare / convRef;
    convNorm = ratio < 1 ? ratio : 1;
  }

  // ==========================================================================
  // 3. 競合度スコア（CPC高さとスポンサー枠の平均）
  // ==========================================================================
  const compScore = 0.5 * m.cpcPercentile + 0.5 * m.sponsoredSlotsNorm;

  // ==========================================================================
  // 4. ブランド成熟度によるブランド係数の調整
  // ==========================================================================
  let brandWeightEffective = config.weightBrandBase;

  if (m.brandSearchVolume < config.brandVolumeStage1) {
    // ブランド未成熟: 指名語の重みを大幅に下げる（40%）
    // → ジェネリックキーワードでの認知獲得を優先
    brandWeightEffective = config.weightBrandBase * 0.4;
  } else if (m.brandSearchVolume < config.brandVolumeStage2) {
    // 成長期: 中程度の重み（80%）
    // → ブランドキーワードも徐々に活用開始
    brandWeightEffective = config.weightBrandBase * 0.8;
  } else {
    // 確立後: 基礎係数そのまま（100%）
    // → ブランドキーワードを本格的に活用
    brandWeightEffective = config.weightBrandBase;
  }

  // ==========================================================================
  // 5. 各要素の寄与を計算
  // ==========================================================================
  const partVolume = config.weightVolume * volNorm;
  const partText = config.weightText * m.relText;
  const partBrand = brandWeightEffective * m.relBrand;
  const partConv = config.weightConv * convNorm;
  const partComp = config.weightCompetition * compScore;

  // ==========================================================================
  // 6. 最終スコアを計算
  // ==========================================================================
  const score = partVolume + partText + partBrand + partConv - partComp;

  return {
    score,
    breakdown: {
      volNorm,
      convNorm,
      compScore,
      brandWeightEffective,
      contributions: {
        volume: partVolume,
        text: partText,
        brand: partBrand,
        conv: partConv,
        competition: -partComp,  // マイナス寄与として表示
      },
      score,
    },
  };
}

/**
 * CORE_SEOスコアを簡易計算（戻り値は数値のみ）
 *
 * @param m - キーワードメトリクス
 * @param config - 計算設定
 * @returns スコア値
 */
export function computeCoreSeoScoreSimple(
  m: CoreKeywordMetrics,
  config: CoreScoreConfig = DEFAULT_CORE_SCORE_CONFIG
): number {
  return computeCoreSeoScore(m, config).score;
}

/**
 * スコアに基づいてキーワードをランク付け
 *
 * @param keywords - キーワードメトリクスの配列
 * @param config - 計算設定
 * @param topN - 上位何件を返すか（デフォルト10）
 * @returns スコア順にソートされたキーワードと計算結果
 */
export function rankCoreSeoKeywords(
  keywords: Array<{ keyword: string; metrics: CoreKeywordMetrics }>,
  config: CoreScoreConfig = DEFAULT_CORE_SCORE_CONFIG,
  topN: number = 10
): Array<{ keyword: string; metrics: CoreKeywordMetrics; result: CoreScoreResult }> {
  const scored = keywords.map((kw) => ({
    keyword: kw.keyword,
    metrics: kw.metrics,
    result: computeCoreSeoScore(kw.metrics, config),
  }));

  // スコア降順でソート
  scored.sort((a, b) => b.result.score - a.result.score);

  // 上位N件を返す
  return scored.slice(0, topN);
}

/**
 * キーワードがCORE_SEO候補として適格かどうかを判定
 *
 * @param result - スコア計算結果
 * @param minScore - 最低スコア（デフォルト2.0）
 * @param minRelText - 最低テキスト関連度（デフォルト0.5）
 * @returns 適格かどうか
 */
export function isCoreSeoCandidate(
  metrics: CoreKeywordMetrics,
  result: CoreScoreResult,
  minScore: number = 2.0,
  minRelText: number = 0.5
): boolean {
  // スコアが最低値以上
  if (result.score < minScore) return false;

  // テキスト関連度が最低値以上（関連のないキーワードは除外）
  if (metrics.relText < minRelText) return false;

  return true;
}

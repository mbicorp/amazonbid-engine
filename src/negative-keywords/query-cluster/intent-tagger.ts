/**
 * 検索意図タグ検出 - Query Intent Tagger
 *
 * 検索クエリから検索意図（child, adult, concern, info, generic）を推定
 *
 * 判定優先順位:
 * 1. child（子供向け）
 * 2. adult（大人向け）
 * 3. concern（悩み系）
 * 4. info（情報探索）
 * 5. generic（汎用）
 */

import { QueryIntentTag } from "./types";
import { toCanonicalQuery } from "./normalizer";

// =============================================================================
// キーワードパターン定義
// =============================================================================

/**
 * 子供向けキーワードパターン
 */
const CHILD_KEYWORDS: string[] = [
  // 子供一般
  "キッズ", "こども", "子ども", "子供", "コドモ",
  "ベビー", "ベイビー", "赤ちゃん", "あかちゃん", "乳児", "幼児",
  "キッズ用", "子供用", "こども用", "ベビー用",
  // 年齢
  "0歳", "1歳", "2歳", "3歳", "4歳", "5歳", "6歳", "7歳", "8歳", "9歳", "10歳",
  "0さい", "1さい", "2さい", "3さい", "4さい", "5さい",
  "新生児", "乳幼児", "園児", "保育園", "幼稚園", "小学生", "小学校",
  // 学年
  "1年生", "2年生", "3年生", "4年生", "5年生", "6年生",
  // その他
  "ジュニア", "ジュニア用", "jr", "jr.", "kids",
  "チャイルド", "チルドレン", "children",
];

/**
 * 大人向けキーワードパターン
 */
const ADULT_KEYWORDS: string[] = [
  // 性別・年齢
  "メンズ", "mens", "men's", "男性", "男性用", "紳士", "紳士用",
  "レディース", "レディス", "ladies", "women's", "女性", "女性用", "婦人", "婦人用",
  "大人", "大人用", "おとな", "アダルト", "adult",
  // 年齢層
  "シニア", "シニア用", "高齢者", "高齢者用", "お年寄り",
  "20代", "30代", "40代", "50代", "60代", "70代", "80代",
  // ビジネス
  "ビジネス", "ビジネス用", "オフィス", "仕事用",
  "プロ", "プロ用", "プロフェッショナル", "professional",
];

/**
 * 悩み系キーワードパターン
 */
const CONCERN_KEYWORDS: string[] = [
  // 症状・状態
  "かゆみ", "痒み", "カユミ", "かゆい", "痒い",
  "痛み", "いたみ", "イタミ", "痛い", "いたい",
  "乾燥", "かんそう", "カンソウ", "乾燥肌",
  "敏感", "敏感肌", "デリケート",
  "フケ", "ふけ", "頭皮", "とうひ",
  "臭い", "におい", "ニオイ", "体臭", "加齢臭",
  "抜け毛", "ぬけげ", "薄毛", "うすげ", "ハゲ", "はげ", "育毛", "発毛",
  "ニキビ", "にきび", "吹き出物", "肌荒れ", "はだあれ",
  "シミ", "しみ", "シワ", "しわ", "たるみ", "タルミ",
  "むくみ", "ムクミ", "浮腫み",
  "アトピー", "アレルギー", "湿疹", "しっしん",
  "水虫", "みずむし", "白癬",
  // 対策・ケア
  "対策", "たいさく", "ケア", "care",
  "改善", "かいぜん", "解消", "かいしょう",
  "予防", "よぼう", "防止", "ぼうし",
  "治療", "ちりょう", "治す", "なおす",
  // 成分（悩み解決系）
  "薬用", "やくよう", "医薬部外品",
  "無添加", "むてんか", "低刺激", "ていしげき",
  "オーガニック", "organic", "天然", "てんねん", "自然派",
];

/**
 * 情報探索キーワードパターン
 */
const INFO_KEYWORDS: string[] = [
  // 比較・ランキング
  "おすすめ", "オススメ", "お勧め", "オスメ", "recommend",
  "ランキング", "ranking", "人気", "にんき", "売れ筋", "うれすじ",
  "比較", "ひかく", "compare", "vs", "versus",
  "口コミ", "くちこみ", "クチコミ", "レビュー", "review", "評判", "ひょうばん",
  // 選び方・情報
  "選び方", "えらびかた", "how to", "howto", "方法", "ほうほう",
  "違い", "ちがい", "difference", "とは", "とは?",
  "効果", "こうか", "effect", "メリット", "デメリット",
  // 質問系
  "なぜ", "なに", "どこ", "どれ", "どの", "どう", "いつ",
  "why", "what", "where", "which", "how", "when",
];

// =============================================================================
// 正規化済みキーワードセット（パフォーマンス最適化）
// =============================================================================

/**
 * 正規化済みキーワードセットを生成
 */
function createNormalizedKeywordSet(keywords: string[]): Set<string> {
  return new Set(keywords.map((kw) => toCanonicalQuery(kw)));
}

// 正規化済みキーワードセット（モジュール初期化時に生成）
const NORMALIZED_CHILD_KEYWORDS = createNormalizedKeywordSet(CHILD_KEYWORDS);
const NORMALIZED_ADULT_KEYWORDS = createNormalizedKeywordSet(ADULT_KEYWORDS);
const NORMALIZED_CONCERN_KEYWORDS = createNormalizedKeywordSet(CONCERN_KEYWORDS);
const NORMALIZED_INFO_KEYWORDS = createNormalizedKeywordSet(INFO_KEYWORDS);

// =============================================================================
// 意図タグ検出関数
// =============================================================================

/**
 * クエリに特定のキーワードが含まれるかチェック
 *
 * @param normalizedQuery - 正規化済みクエリ
 * @param keywordSet - 正規化済みキーワードセット
 * @returns キーワードが含まれる場合true
 */
function containsAnyKeyword(normalizedQuery: string, keywordSet: Set<string>): boolean {
  for (const keyword of keywordSet) {
    if (normalizedQuery.includes(keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * クエリにマッチするキーワードを取得
 *
 * @param normalizedQuery - 正規化済みクエリ
 * @param keywordSet - 正規化済みキーワードセット
 * @returns マッチしたキーワードのリスト
 */
function findMatchingKeywords(normalizedQuery: string, keywordSet: Set<string>): string[] {
  const matches: string[] = [];
  for (const keyword of keywordSet) {
    if (normalizedQuery.includes(keyword)) {
      matches.push(keyword);
    }
  }
  return matches;
}

/**
 * 検索クエリから検索意図タグを推定
 *
 * @param query - 検索クエリ（正規化前でも可）
 * @returns 検索意図タグ
 *
 * @example
 * ```typescript
 * detectQueryIntentTag("キッズ シャンプー");
 * // => "child"
 *
 * detectQueryIntentTag("メンズ シャンプー");
 * // => "adult"
 *
 * detectQueryIntentTag("フケ 対策 シャンプー");
 * // => "concern"
 *
 * detectQueryIntentTag("シャンプー おすすめ");
 * // => "info"
 *
 * detectQueryIntentTag("シャンプー");
 * // => "generic"
 * ```
 */
export function detectQueryIntentTag(query: string): QueryIntentTag {
  const normalizedQuery = toCanonicalQuery(query);

  // 優先順位順にチェック
  // 1. 子供向け
  if (containsAnyKeyword(normalizedQuery, NORMALIZED_CHILD_KEYWORDS)) {
    return "child";
  }

  // 2. 大人向け
  if (containsAnyKeyword(normalizedQuery, NORMALIZED_ADULT_KEYWORDS)) {
    return "adult";
  }

  // 3. 悩み系
  if (containsAnyKeyword(normalizedQuery, NORMALIZED_CONCERN_KEYWORDS)) {
    return "concern";
  }

  // 4. 情報探索
  if (containsAnyKeyword(normalizedQuery, NORMALIZED_INFO_KEYWORDS)) {
    return "info";
  }

  // 5. 汎用（デフォルト）
  return "generic";
}

/**
 * 検索意図タグ検出の詳細結果
 */
export interface IntentTagDetectionResult {
  /** 検出された意図タグ */
  intentTag: QueryIntentTag;

  /** 正規化されたクエリ */
  normalizedQuery: string;

  /** マッチしたキーワード（各カテゴリ） */
  matchedKeywords: {
    child: string[];
    adult: string[];
    concern: string[];
    info: string[];
  };

  /** 信頼度スコア（マッチしたキーワード数に基づく） */
  confidence: "high" | "medium" | "low";
}

/**
 * 検索クエリから検索意図タグを推定（詳細版）
 *
 * @param query - 検索クエリ
 * @returns 検出結果の詳細
 */
export function detectQueryIntentTagWithDetails(query: string): IntentTagDetectionResult {
  const normalizedQuery = toCanonicalQuery(query);

  // 各カテゴリでマッチするキーワードを検出
  const matchedKeywords = {
    child: findMatchingKeywords(normalizedQuery, NORMALIZED_CHILD_KEYWORDS),
    adult: findMatchingKeywords(normalizedQuery, NORMALIZED_ADULT_KEYWORDS),
    concern: findMatchingKeywords(normalizedQuery, NORMALIZED_CONCERN_KEYWORDS),
    info: findMatchingKeywords(normalizedQuery, NORMALIZED_INFO_KEYWORDS),
  };

  // 優先順位順に意図タグを決定
  let intentTag: QueryIntentTag = "generic";
  let matchCount = 0;

  if (matchedKeywords.child.length > 0) {
    intentTag = "child";
    matchCount = matchedKeywords.child.length;
  } else if (matchedKeywords.adult.length > 0) {
    intentTag = "adult";
    matchCount = matchedKeywords.adult.length;
  } else if (matchedKeywords.concern.length > 0) {
    intentTag = "concern";
    matchCount = matchedKeywords.concern.length;
  } else if (matchedKeywords.info.length > 0) {
    intentTag = "info";
    matchCount = matchedKeywords.info.length;
  }

  // 信頼度の判定
  let confidence: "high" | "medium" | "low";
  if (matchCount >= 2) {
    confidence = "high";
  } else if (matchCount === 1) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    intentTag,
    normalizedQuery,
    matchedKeywords,
    confidence,
  };
}

/**
 * クエリクラスターIDを生成
 *
 * @param query - 検索クエリ
 * @returns クラスターID（`${canonicalQuery}::${queryIntentTag}`形式）
 *
 * @example
 * ```typescript
 * generateQueryClusterId("キッズ シャンプー");
 * // => "キッズ シャンプー::child"
 *
 * generateQueryClusterId("シャンプー");
 * // => "シャンプー::generic"
 * ```
 */
export function generateQueryClusterId(query: string): string {
  const canonicalQuery = toCanonicalQuery(query);
  const intentTag = detectQueryIntentTag(query);
  return `${canonicalQuery}::${intentTag}`;
}

/**
 * クラスターIDからcanonicalQueryとintentTagを抽出
 *
 * @param queryClusterId - クラスターID
 * @returns { canonicalQuery, intentTag } または null（無効な形式の場合）
 */
export function parseQueryClusterId(
  queryClusterId: string
): { canonicalQuery: string; intentTag: QueryIntentTag } | null {
  const parts = queryClusterId.split("::");
  if (parts.length !== 2) {
    return null;
  }

  const [canonicalQuery, intentTagStr] = parts;
  const validTags: QueryIntentTag[] = ["child", "adult", "concern", "info", "generic"];

  if (!validTags.includes(intentTagStr as QueryIntentTag)) {
    return null;
  }

  return {
    canonicalQuery,
    intentTag: intentTagStr as QueryIntentTag,
  };
}

// =============================================================================
// カスタムキーワード追加（拡張用）
// =============================================================================

/**
 * カスタムキーワードを追加
 *
 * 運用中に新しいキーワードパターンを追加する場合に使用
 */
export function addCustomKeywords(
  intentTag: Exclude<QueryIntentTag, "generic">,
  keywords: string[]
): void {
  const normalizedKeywords = keywords.map((kw) => toCanonicalQuery(kw));

  switch (intentTag) {
    case "child":
      normalizedKeywords.forEach((kw) => NORMALIZED_CHILD_KEYWORDS.add(kw));
      break;
    case "adult":
      normalizedKeywords.forEach((kw) => NORMALIZED_ADULT_KEYWORDS.add(kw));
      break;
    case "concern":
      normalizedKeywords.forEach((kw) => NORMALIZED_CONCERN_KEYWORDS.add(kw));
      break;
    case "info":
      normalizedKeywords.forEach((kw) => NORMALIZED_INFO_KEYWORDS.add(kw));
      break;
  }
}

// =============================================================================
// エクスポート（テスト用）
// =============================================================================

export const _internal = {
  CHILD_KEYWORDS,
  ADULT_KEYWORDS,
  CONCERN_KEYWORDS,
  INFO_KEYWORDS,
  containsAnyKeyword,
  findMatchingKeywords,
};

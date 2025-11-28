/**
 * クエリ正規化 - Canonical Query 生成
 *
 * 検索クエリを正規化して、表記揺れを統一したcanonicalQueryを生成
 *
 * 正規化ルール:
 * 1. 全角英数字 → 半角英数字
 * 2. 半角カタカナ → 全角カタカナ
 * 3. ひらがな → カタカナ（オプション、デフォルト有効）
 * 4. 大文字 → 小文字
 * 5. 連続空白 → 単一空白
 * 6. 前後空白のトリム
 */

// =============================================================================
// 正規化設定
// =============================================================================

/**
 * クエリ正規化設定
 */
export interface QueryNormalizerConfig {
  /** ひらがなをカタカナに変換するか */
  convertHiraganaToKatakana: boolean;

  /** カタカナをひらがなに変換するか（convertHiraganaToKatakanaと排他） */
  convertKatakanaToHiragana: boolean;

  /** 長音符を正規化するか（ー、ｰ、−、‐ → ー） */
  normalizeLongVowelMark: boolean;

  /** 句読点・記号を除去するか */
  removePunctuation: boolean;
}

/**
 * デフォルトの正規化設定
 */
export const DEFAULT_NORMALIZER_CONFIG: QueryNormalizerConfig = {
  convertHiraganaToKatakana: true,
  convertKatakanaToHiragana: false,
  normalizeLongVowelMark: true,
  removePunctuation: false,
};

// =============================================================================
// 文字コード変換テーブル
// =============================================================================

/**
 * 全角英数字 → 半角英数字のマッピング
 */
const FULLWIDTH_TO_HALFWIDTH: Record<string, string> = {
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  "Ａ": "a", "Ｂ": "b", "Ｃ": "c", "Ｄ": "d", "Ｅ": "e",
  "Ｆ": "f", "Ｇ": "g", "Ｈ": "h", "Ｉ": "i", "Ｊ": "j",
  "Ｋ": "k", "Ｌ": "l", "Ｍ": "m", "Ｎ": "n", "Ｏ": "o",
  "Ｐ": "p", "Ｑ": "q", "Ｒ": "r", "Ｓ": "s", "Ｔ": "t",
  "Ｕ": "u", "Ｖ": "v", "Ｗ": "w", "Ｘ": "x", "Ｙ": "y",
  "Ｚ": "z",
  "ａ": "a", "ｂ": "b", "ｃ": "c", "ｄ": "d", "ｅ": "e",
  "ｆ": "f", "ｇ": "g", "ｈ": "h", "ｉ": "i", "ｊ": "j",
  "ｋ": "k", "ｌ": "l", "ｍ": "m", "ｎ": "n", "ｏ": "o",
  "ｐ": "p", "ｑ": "q", "ｒ": "r", "ｓ": "s", "ｔ": "t",
  "ｕ": "u", "ｖ": "v", "ｗ": "w", "ｘ": "x", "ｙ": "y",
  "ｚ": "z",
  // 全角スペース
  "　": " ",
};

/**
 * 半角カタカナ → 全角カタカナのマッピング
 */
const HALFWIDTH_KATAKANA_TO_FULLWIDTH: Record<string, string> = {
  "ｱ": "ア", "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ", "ｵ": "オ",
  "ｶ": "カ", "ｷ": "キ", "ｸ": "ク", "ｹ": "ケ", "ｺ": "コ",
  "ｻ": "サ", "ｼ": "シ", "ｽ": "ス", "ｾ": "セ", "ｿ": "ソ",
  "ﾀ": "タ", "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ", "ﾄ": "ト",
  "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ", "ﾉ": "ノ",
  "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ", "ﾍ": "ヘ", "ﾎ": "ホ",
  "ﾏ": "マ", "ﾐ": "ミ", "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ",
  "ﾔ": "ヤ", "ﾕ": "ユ", "ﾖ": "ヨ",
  "ﾗ": "ラ", "ﾘ": "リ", "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ",
  "ﾜ": "ワ", "ｦ": "ヲ", "ﾝ": "ン",
  "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ", "ｪ": "ェ", "ｫ": "ォ",
  "ｯ": "ッ", "ｬ": "ャ", "ｭ": "ュ", "ｮ": "ョ",
  "ﾞ": "゛", "ﾟ": "゜",
  "ｰ": "ー",
};

/**
 * 半角カタカナ濁点・半濁点の合成パターン
 */
const HALFWIDTH_KATAKANA_VOICED: Record<string, string> = {
  // 濁点
  "ｶﾞ": "ガ", "ｷﾞ": "ギ", "ｸﾞ": "グ", "ｹﾞ": "ゲ", "ｺﾞ": "ゴ",
  "ｻﾞ": "ザ", "ｼﾞ": "ジ", "ｽﾞ": "ズ", "ｾﾞ": "ゼ", "ｿﾞ": "ゾ",
  "ﾀﾞ": "ダ", "ﾁﾞ": "ヂ", "ﾂﾞ": "ヅ", "ﾃﾞ": "デ", "ﾄﾞ": "ド",
  "ﾊﾞ": "バ", "ﾋﾞ": "ビ", "ﾌﾞ": "ブ", "ﾍﾞ": "ベ", "ﾎﾞ": "ボ",
  "ｳﾞ": "ヴ",
  // 半濁点
  "ﾊﾟ": "パ", "ﾋﾟ": "ピ", "ﾌﾟ": "プ", "ﾍﾟ": "ペ", "ﾎﾟ": "ポ",
};

/**
 * 長音符の正規化パターン
 */
const LONG_VOWEL_MARKS = ["ー", "ｰ", "−", "‐", "－", "―", "─"];

// =============================================================================
// 正規化関数
// =============================================================================

/**
 * 全角英数字を半角に変換
 */
function convertFullwidthToHalfwidth(text: string): string {
  let result = "";
  for (const char of text) {
    result += FULLWIDTH_TO_HALFWIDTH[char] ?? char;
  }
  return result;
}

/**
 * 半角カタカナを全角に変換（濁点・半濁点の合成を含む）
 */
function convertHalfwidthKatakanaToFullwidth(text: string): string {
  // まず濁点・半濁点の合成パターンを変換
  let result = text;
  for (const [pattern, replacement] of Object.entries(HALFWIDTH_KATAKANA_VOICED)) {
    result = result.split(pattern).join(replacement);
  }

  // 残りの半角カタカナを変換
  let finalResult = "";
  for (const char of result) {
    finalResult += HALFWIDTH_KATAKANA_TO_FULLWIDTH[char] ?? char;
  }
  return finalResult;
}

/**
 * ひらがなをカタカナに変換
 *
 * Unicode: ひらがな 0x3041-0x3096, カタカナ 0x30A1-0x30F6
 * 差分: 0x60
 */
function convertHiraganaToKatakana(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    // ひらがな範囲: 0x3041 (ぁ) - 0x3096 (ゖ)
    if (code >= 0x3041 && code <= 0x3096) {
      result += String.fromCharCode(code + 0x60);
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * カタカナをひらがなに変換
 */
function convertKatakanaToHiragana(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    // カタカナ範囲: 0x30A1 (ァ) - 0x30F6 (ヶ)
    if (code >= 0x30A1 && code <= 0x30F6) {
      result += String.fromCharCode(code - 0x60);
    } else {
      result += char;
    }
  }
  return result;
}

/**
 * 長音符を正規化（すべて全角長音符「ー」に統一）
 */
function normalizeLongVowelMark(text: string): string {
  let result = text;
  for (const mark of LONG_VOWEL_MARKS) {
    if (mark !== "ー") {
      result = result.split(mark).join("ー");
    }
  }
  return result;
}

/**
 * 句読点・記号を除去
 */
function removePunctuation(text: string): string {
  // 日本語の句読点と一般的な記号を除去
  return text.replace(/[、。，．・！？!?,.]/g, "");
}

/**
 * 連続空白を単一空白に正規化し、前後をトリム
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 大文字を小文字に変換
 */
function toLowerCase(text: string): string {
  return text.toLowerCase();
}

// =============================================================================
// メイン正規化関数
// =============================================================================

/**
 * クエリを正規化してcanonicalQueryを生成
 *
 * @param query - 元の検索クエリ
 * @param config - 正規化設定（オプション）
 * @returns 正規化されたクエリ
 *
 * @example
 * ```typescript
 * normalizeQuery("キッズ　シャンプー");
 * // => "キッズ シャンプー"
 *
 * normalizeQuery("ＡＢＣシャンプー");
 * // => "abcシャンプー"
 *
 * normalizeQuery("きっず しゃんぷー");
 * // => "キッズ シャンプー" (convertHiraganaToKatakana: true)
 * ```
 */
export function normalizeQuery(
  query: string,
  config: QueryNormalizerConfig = DEFAULT_NORMALIZER_CONFIG
): string {
  if (!query) {
    return "";
  }

  let result = query;

  // 1. 全角英数字 → 半角英数字
  result = convertFullwidthToHalfwidth(result);

  // 2. 半角カタカナ → 全角カタカナ
  result = convertHalfwidthKatakanaToFullwidth(result);

  // 3. ひらがな ⇔ カタカナ変換（排他的）
  if (config.convertHiraganaToKatakana && !config.convertKatakanaToHiragana) {
    result = convertHiraganaToKatakana(result);
  } else if (config.convertKatakanaToHiragana && !config.convertHiraganaToKatakana) {
    result = convertKatakanaToHiragana(result);
  }

  // 4. 長音符の正規化
  if (config.normalizeLongVowelMark) {
    result = normalizeLongVowelMark(result);
  }

  // 5. 句読点・記号の除去（オプション）
  if (config.removePunctuation) {
    result = removePunctuation(result);
  }

  // 6. 大文字 → 小文字
  result = toLowerCase(result);

  // 7. 空白の正規化
  result = normalizeWhitespace(result);

  return result;
}

/**
 * クエリからcanonicalQueryを生成（デフォルト設定）
 *
 * @param query - 元の検索クエリ
 * @returns 正規化されたクエリ
 */
export function toCanonicalQuery(query: string): string {
  return normalizeQuery(query, DEFAULT_NORMALIZER_CONFIG);
}

// =============================================================================
// エクスポート（内部関数のテスト用）
// =============================================================================

export const _internal = {
  convertFullwidthToHalfwidth,
  convertHalfwidthKatakanaToFullwidth,
  convertHiraganaToKatakana,
  convertKatakanaToHiragana,
  normalizeLongVowelMark,
  removePunctuation,
  normalizeWhitespace,
  toLowerCase,
};

/**
 * 季節性予測機能 - 設定とカテゴリヒント
 *
 * サプリメント・健康食品カテゴリの事前知識（ドメイン知識）を定義
 * データが不足している場合でも、カテゴリに基づいた予測が可能
 */

import { CategoryHint, SeasonalityConfig, DEFAULT_SEASONALITY_CONFIG } from "./types";

// =============================================================================
// サプリメントカテゴリヒント
// =============================================================================

/**
 * サプリメント・健康食品カテゴリのピーク月ヒント
 *
 * 日本市場における季節性パターンの事前知識
 */
export const SUPPLEMENT_CATEGORY_HINTS: Record<string, CategoryHint> = {
  // ダイエット系
  diet: {
    category: "diet",
    expectedPeakMonths: [1, 5], // 正月明け、GW前
    description: "ダイエット系サプリ（正月明けと夏前にピーク）",
    confidence: 0.85,
  },

  // 免疫系
  immune: {
    category: "immune",
    expectedPeakMonths: [11, 12, 1], // 風邪・インフルシーズン
    description: "免疫系サプリ（風邪シーズンにピーク）",
    confidence: 0.9,
  },

  // 花粉・アレルギー系
  allergy: {
    category: "allergy",
    expectedPeakMonths: [2, 3, 4], // 花粉シーズン
    description: "花粉・アレルギー対策（花粉シーズンにピーク）",
    confidence: 0.95,
  },

  // UV・美白系
  uv: {
    category: "uv",
    expectedPeakMonths: [4, 5, 6, 7, 8], // 紫外線シーズン
    description: "UV対策・美白サプリ（紫外線シーズンにピーク）",
    confidence: 0.85,
  },

  // NMN・アンチエイジング系
  nmn: {
    category: "nmn",
    expectedPeakMonths: [12, 1], // 年末年始の健康意識
    description: "NMN・アンチエイジング（年末年始にピーク）",
    confidence: 0.7,
  },

  // GABA・睡眠・ストレス系
  gaba: {
    category: "gaba",
    expectedPeakMonths: [3, 4, 9], // 新生活・異動シーズン
    description: "GABA・睡眠系（環境変化シーズンにピーク）",
    confidence: 0.75,
  },

  // ビタミンD系
  vitamin_d: {
    category: "vitamin_d",
    expectedPeakMonths: [10, 11, 12, 1, 2], // 日照不足シーズン
    description: "ビタミンD（日照不足シーズンにピーク）",
    confidence: 0.8,
  },

  // プロテイン・筋トレ系
  protein: {
    category: "protein",
    expectedPeakMonths: [1, 4, 9], // 新年・新生活・運動開始シーズン
    description: "プロテイン（トレーニング開始シーズンにピーク）",
    confidence: 0.75,
  },

  // ギフト系（贈答用）
  gift: {
    category: "gift",
    expectedPeakMonths: [12, 2], // クリスマス・バレンタイン
    description: "ギフト用健康食品（贈答シーズンにピーク）",
    confidence: 0.8,
  },

  // 疲労回復系
  fatigue: {
    category: "fatigue",
    expectedPeakMonths: [6, 7, 8, 9], // 夏バテシーズン
    description: "疲労回復系（夏バテシーズンにピーク）",
    confidence: 0.8,
  },

  // 目の健康（ブルーベリー・ルテイン）
  eye: {
    category: "eye",
    expectedPeakMonths: [4, 9], // 新生活でのPC作業増加
    description: "目の健康系（新生活シーズンにピーク）",
    confidence: 0.7,
  },

  // 関節系（グルコサミン・コンドロイチン）
  joint: {
    category: "joint",
    expectedPeakMonths: [11, 12, 1, 2], // 寒さによる関節痛増加
    description: "関節系サプリ（寒冷シーズンにピーク）",
    confidence: 0.75,
  },

  // 鉄分・貧血系
  iron: {
    category: "iron",
    expectedPeakMonths: [3, 4, 5, 6], // 新生活での疲労
    description: "鉄分・貧血対策（新生活シーズンにピーク）",
    confidence: 0.7,
  },

  // 腸活・乳酸菌系
  probiotics: {
    category: "probiotics",
    expectedPeakMonths: [1, 3, 9], // 新年・年度替わり
    description: "腸活・乳酸菌系（生活改善シーズンにピーク）",
    confidence: 0.75,
  },

  // コラーゲン・美容系
  collagen: {
    category: "collagen",
    expectedPeakMonths: [10, 11, 12, 1], // 乾燥シーズン
    description: "コラーゲン・美容系（乾燥シーズンにピーク）",
    confidence: 0.8,
  },
};

// =============================================================================
// キーワードからカテゴリを推定
// =============================================================================

/**
 * キーワードからカテゴリを推定するパターン
 */
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  // ダイエット系
  { pattern: /ダイエット|diet|痩|燃焼|脂肪/i, category: "diet" },
  { pattern: /酵素.*ダイエット|置き換え/i, category: "diet" },

  // 免疫系
  { pattern: /免疫|immunity|ビタミンC|エキナセア|プロポリス/i, category: "immune" },
  { pattern: /風邪.*予防|インフル/i, category: "immune" },

  // 花粉・アレルギー系
  { pattern: /花粉|アレルギー|allergy|甜茶|じゃばら/i, category: "allergy" },

  // UV・美白系
  { pattern: /UV|紫外線|美白|whitening|日焼け|トラネキサム/i, category: "uv" },

  // NMN・アンチエイジング系
  { pattern: /NMN|NAD|アンチエイジング|anti.?aging|レスベラトロール/i, category: "nmn" },

  // GABA・睡眠・ストレス系
  { pattern: /GABA|睡眠|sleep|ストレス|stress|テアニン|リラックス/i, category: "gaba" },

  // ビタミンD系
  { pattern: /ビタミン.*D|vitamin.*D|カルシウム.*D/i, category: "vitamin_d" },

  // プロテイン・筋トレ系
  { pattern: /プロテイン|protein|BCAA|HMB|筋肉|muscle|EAA/i, category: "protein" },

  // 疲労回復系
  { pattern: /疲労|fatigue|夏バテ|滋養|強壮|マカ|ニンニク|にんにく/i, category: "fatigue" },

  // 目の健康系
  { pattern: /ブルーベリー|ルテイン|アントシアニン|目.*健康|eye.*health/i, category: "eye" },

  // 関節系
  { pattern: /グルコサミン|コンドロイチン|関節|ひざ|膝|MSM/i, category: "joint" },

  // 鉄分系
  { pattern: /鉄分|鉄.*サプリ|iron|貧血|ヘム鉄/i, category: "iron" },

  // 腸活系
  { pattern: /乳酸菌|ビフィズス|腸活|腸内|probiotics|整腸/i, category: "probiotics" },

  // コラーゲン・美容系
  { pattern: /コラーゲン|collagen|ヒアルロン|セラミド|美容/i, category: "collagen" },

  // ギフト系
  { pattern: /ギフト|gift|贈り物|プレゼント|お歳暮|お中元/i, category: "gift" },
];

/**
 * キーワードからカテゴリを推定
 *
 * @param keyword 検索キーワード
 * @returns 推定されたカテゴリ、マッチしない場合はnull
 */
export function detectCategoryFromKeyword(keyword: string): string | null {
  const normalizedKeyword = keyword.toLowerCase();

  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(normalizedKeyword)) {
      return category;
    }
  }

  return null;
}

/**
 * カテゴリからヒントを取得
 *
 * @param category カテゴリ識別子
 * @returns カテゴリヒント、存在しない場合はnull
 */
export function getCategoryHint(category: string): CategoryHint | null {
  return SUPPLEMENT_CATEGORY_HINTS[category] || null;
}

/**
 * キーワードに対するカテゴリヒントを取得
 *
 * @param keyword 検索キーワード
 * @returns カテゴリヒント、マッチしない場合はnull
 */
export function getCategoryHintForKeyword(keyword: string): CategoryHint | null {
  const category = detectCategoryFromKeyword(keyword);
  if (!category) {
    return null;
  }
  return getCategoryHint(category);
}

// =============================================================================
// 設定の作成とマージ
// =============================================================================

/**
 * 環境変数から設定を作成
 */
export function createSeasonalityConfigFromEnv(): SeasonalityConfig {
  return {
    // Feature Flags
    enabled: process.env.SEASONALITY_ENABLED === "true",
    mode: (process.env.SEASONALITY_MODE as "SHADOW" | "APPLY") || "SHADOW",
    disableDuringEventOverride:
      process.env.SEASONALITY_DISABLE_DURING_EVENT !== "false",

    // Pre-peak期間設定
    prePeakDaysMin: parseInt(process.env.SEASONALITY_PRE_PEAK_DAYS_MIN || "7", 10),
    prePeakDaysMax: parseInt(process.env.SEASONALITY_PRE_PEAK_DAYS_MAX || "30", 10),

    // 入札調整設定
    maxMultiplier: parseFloat(process.env.SEASONALITY_MAX_MULTIPLIER || "1.3"),
    confidenceThreshold: parseFloat(
      process.env.SEASONALITY_CONFIDENCE_THRESHOLD || "0.6"
    ),

    // ピーク検出設定
    peakStdDevMultiplier: parseFloat(
      process.env.SEASONALITY_PEAK_STDDEV_MULTIPLIER || "1.5"
    ),
    minSampleCount: parseInt(process.env.SEASONALITY_MIN_SAMPLE_COUNT || "2", 10),

    // カテゴリヒント設定
    useCategoryHints: process.env.SEASONALITY_USE_CATEGORY_HINTS !== "false",
    categoryHintOnlyWeight: parseFloat(
      process.env.SEASONALITY_CATEGORY_HINT_WEIGHT || "0.7"
    ),
    jsDataWeight: parseFloat(process.env.SEASONALITY_JS_DATA_WEIGHT || "0.7"),

    // データ更新設定
    predictionValidityDays: parseInt(
      process.env.SEASONALITY_PREDICTION_VALIDITY_DAYS || "7",
      10
    ),
    jsLookbackMonths: parseInt(process.env.SEASONALITY_JS_LOOKBACK_MONTHS || "24", 10),
  };
}

/**
 * 設定をマージ（部分的なオーバーライドを適用）
 */
export function mergeSeasonalityConfig(
  base: SeasonalityConfig,
  override: Partial<SeasonalityConfig>
): SeasonalityConfig {
  return {
    ...base,
    ...override,
  };
}

/**
 * 設定を検証
 */
export function validateSeasonalityConfig(config: SeasonalityConfig): string[] {
  const errors: string[] = [];

  if (config.prePeakDaysMin < 1) {
    errors.push("prePeakDaysMin must be at least 1");
  }

  if (config.prePeakDaysMax <= config.prePeakDaysMin) {
    errors.push("prePeakDaysMax must be greater than prePeakDaysMin");
  }

  if (config.maxMultiplier < 1.0 || config.maxMultiplier > 2.0) {
    errors.push("maxMultiplier must be between 1.0 and 2.0");
  }

  if (config.confidenceThreshold < 0 || config.confidenceThreshold > 1) {
    errors.push("confidenceThreshold must be between 0 and 1");
  }

  if (config.peakStdDevMultiplier < 1.0) {
    errors.push("peakStdDevMultiplier must be at least 1.0");
  }

  if (config.categoryHintOnlyWeight < 0 || config.categoryHintOnlyWeight > 1) {
    errors.push("categoryHintOnlyWeight must be between 0 and 1");
  }

  if (config.jsDataWeight < 0 || config.jsDataWeight > 1) {
    errors.push("jsDataWeight must be between 0 and 1");
  }

  return errors;
}

// =============================================================================
// エクスポート
// =============================================================================

export { DEFAULT_SEASONALITY_CONFIG };

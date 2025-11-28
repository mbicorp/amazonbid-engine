/**
 * Amazon広告自動入札提案エンジン - 定数定義
 */

// =============================================================================
// CVR関連しきい値
// =============================================================================
export const CVR_THRESHOLDS = {
  /** CVR大幅向上の判定しきい値 */
  SIGNIFICANT_BOOST: 0.3,
  /** CVR向上の判定しきい値 */
  MILD_BOOST: 0.1,
  /** CVR低下の判定しきい値 */
  MILD_DECLINE: -0.1,
  /** CVR大幅低下の判定しきい値 */
  SIGNIFICANT_DECLINE: -0.2,
  /** CVR大幅低下（強い）の判定しきい値 */
  SEVERE_DECLINE: -0.3,
  /** CVR危機的低下の判定しきい値 */
  CRITICAL_DECLINE: -0.4,
} as const;

// =============================================================================
// ACOS関連しきい値
// =============================================================================
export const ACOS_THRESHOLDS = {
  /** ACOS良好判定の係数（目標の20%以下） */
  GOOD_MULTIPLIER: 0.2,
  /** ACOS警告判定の係数（目標の30%超過） */
  WARNING_MULTIPLIER: 0.3,
  /** ACOS危険判定の係数（目標の50%超過） */
  DANGER_MULTIPLIER: 0.5,
  /** デフォルトACOS目標値 */
  DEFAULT_TARGET: 0.2,
} as const;

// =============================================================================
// 競合関連しきい値
// =============================================================================
export const COMPETITOR_THRESHOLDS = {
  /** 競合強度が高いと判断するしきい値 */
  HIGH_STRENGTH: 0.7,
  /** 競合強度が中程度と判断するしきい値 */
  MEDIUM_STRENGTH: 0.6,
  /** 競合強度が標準と判断するしきい値 */
  NORMAL_STRENGTH: 0.5,
  /** 競合CPC上昇が大きいと判断する比率 */
  CPC_SIGNIFICANT_INCREASE: 1.2,
  /** 競合CPC上昇が中程度と判断する比率 */
  CPC_MILD_INCREASE: 1.1,
  /** 競合CPC下落と判断する比率 */
  CPC_DECREASE: 0.9,
} as const;

// =============================================================================
// リスク関連しきい値
// =============================================================================
export const RISK_THRESHOLDS = {
  /** 高リスクと判断するしきい値 */
  HIGH: 0.5,
  /** 中リスクと判断するしきい値 */
  MEDIUM: 0.3,
  /** 低リスクと判断するしきい値 */
  LOW: 0.2,
  /** TOS攻め対象の最大リスクしきい値 */
  TOS_MAX: 0.4,
} as const;

// =============================================================================
// ランクギャップ関連しきい値
// =============================================================================
export const RANK_GAP_THRESHOLDS = {
  /** 大きなギャップ（目標より大幅に下位） */
  LARGE_GAP: 5,
  /** 中程度のギャップ */
  MEDIUM_GAP: 3,
  /** 小さなギャップ */
  SMALL_GAP: 1,
} as const;

// =============================================================================
// TOS関連しきい値
// =============================================================================
export const TOS_THRESHOLDS = {
  /** TOS攻め対象の最小優先度スコア */
  MIN_PRIORITY_SCORE: 0.8,
  /** TOS 200%許可の最小優先度スコア */
  MIN_PRIORITY_SCORE_200: 0.9,
  /** TOS攻め対象の最小TOS Value */
  MIN_TOS_VALUE: 1.5,
  /** TOS 200%許可の最小TOS Value */
  MIN_TOS_VALUE_200: 2.0,
  /** TOS高価値と判断するTOS Value */
  HIGH_TOS_VALUE: 2.0,
  /** TOS中価値と判断するTOS Value */
  MEDIUM_TOS_VALUE: 1.5,
  /** TOS標準価値と判断するTOS Value */
  NORMAL_TOS_VALUE: 1.2,
} as const;

// =============================================================================
// 係数値
// =============================================================================
export const COEFFICIENTS = {
  // フェーズ係数
  PHASE: {
    NORMAL: 1.0,
    S_PRE1: 1.2,
    S_PRE2: 1.5,
    S_FREEZE: 0.0,
    S_NORMAL: 1.3,
    S_FINAL: 1.8,
    S_REVERT: 0.8,
  },
  // CVR係数（NORMALモード）
  CVR_NORMAL: {
    HIGH_BOOST: 1.15,
    MILD_BOOST: 1.08,
    MILD_DECLINE: 0.92,
    HIGH_DECLINE: 0.85,
    NEUTRAL: 1.0,
  },
  // CVR係数（S_MODE）
  CVR_SMODE: {
    HIGH_BOOST: 1.5,
    MEDIUM_BOOST: 1.3,
    MILD_BOOST: 1.15,
    HIGH_DECLINE: 0.7,
    MEDIUM_DECLINE: 0.85,
    NEUTRAL: 1.0,
  },
  // ランクギャップ係数
  RANK_GAP: {
    LARGE_UP: 1.3,
    MEDIUM_UP: 1.2,
    SMALL_UP: 1.1,
    MEDIUM_DOWN: 1.15,
    SMALL_DOWN: 1.08,
    NEUTRAL: 1.0,
  },
  // 競合係数
  COMPETITOR: {
    HIGH_INCREASE: 1.25,
    MILD_INCREASE: 1.15,
    DECREASE: 1.1,
    NEUTRAL: 1.0,
  },
  // ブランド係数
  BRAND: {
    OWN_UP: 1.2,
    OWN_DOWN: 0.8,
    CONQUEST_UP: 0.9,
    NEUTRAL: 1.0,
  },
  // リスク係数
  RISK: {
    HIGH: 0.8,
    MEDIUM: 0.9,
    LOW: 1.1,
    NEUTRAL: 1.0,
  },
  // 統計係数
  STATS: {
    INSUFFICIENT: 0.5,
    LOW_CONFIDENCE: 0.7,
    MEDIUM_CONFIDENCE: 0.85,
    HIGH_CONFIDENCE: 1.1,
    NEUTRAL: 1.0,
  },
  // TOS係数
  TOS: {
    HIGH_VALUE: 1.8,
    MEDIUM_VALUE: 1.5,
    NORMAL_VALUE: 1.3,
    MIN_VALUE: 1.2,
    NEUTRAL: 1.0,
  },
} as const;

// =============================================================================
// 入札関連定数
// =============================================================================
export const BID_LIMITS = {
  /** 最低入札額（円） */
  MIN_BID: 10,
  /** 現在入札額に対する上限倍率 */
  MAX_CURRENT_BID_MULTIPLIER: 3.0,
  /** 競合CPCに対する上限倍率 */
  MAX_COMPETITOR_CPC_MULTIPLIER: 1.15,
  /** ベースラインCPCに対する上限倍率 */
  MAX_BASELINE_CPC_MULTIPLIER: 2.5,
} as const;

// =============================================================================
// Amazon Ads API関連定数
// =============================================================================
export const AMAZON_ADS_API = {
  /** デフォルトベースURL */
  DEFAULT_BASE_URL: "https://advertising-api.amazon.com",
  /** トークンURL */
  TOKEN_URL: "https://api.amazon.com/auth/o2/token",
  /** トークンキャッシュの余裕時間（秒） */
  TOKEN_CACHE_BUFFER_SECONDS: 300,
  /** レポートポーリング間隔（ミリ秒） */
  REPORT_POLL_INTERVAL_MS: 5000,
  /** レポートポーリング最大回数 */
  REPORT_POLL_MAX_ATTEMPTS: 60,
  /** レポートステータス: 完了 */
  REPORT_STATUS_COMPLETED: "COMPLETED",
  /** レポートステータス: 失敗 */
  REPORT_STATUS_FAILED: "FAILED",
} as const;

// =============================================================================
// BigQuery関連定数
// =============================================================================
export const BIGQUERY = {
  /** プロジェクトID */
  PROJECT_ID: "rpptool",
  /** データセットID */
  DATASET_ID: "amazon_bid_engine",
  /** 実行テーブルID */
  EXECUTIONS_TABLE_ID: "executions",
  /** 推奨テーブルID（旧形式、互換性維持用） */
  RECOMMENDATIONS_TABLE_ID: "recommendations",
  /** 入札推奨テーブルID（新形式） */
  BID_RECOMMENDATIONS_TABLE_ID: "bid_recommendations",
  /** AUTO→EXACT昇格候補テーブルID */
  AUTO_EXACT_PROMOTION_SUGGESTIONS_TABLE_ID: "auto_exact_promotion_suggestions",
  /** リトライ最大回数 */
  MAX_RETRY_ATTEMPTS: 3,
  /** リトライ初期遅延（ミリ秒） */
  INITIAL_RETRY_DELAY_MS: 1000,
  /** リトライ最大遅延（ミリ秒） */
  MAX_RETRY_DELAY_MS: 10000,
} as const;

// =============================================================================
// スコアランク判定しきい値
// =============================================================================
export const SCORE_RANK_THRESHOLDS = {
  /** Sランク: ACOS上限 */
  S_MAX_ACOS: 0.2,
  /** Sランク: CVR下限 */
  S_MIN_CVR: 0.02,
  /** Aランク: ACOS上限 */
  A_MAX_ACOS: 0.3,
  /** Aランク: CVR下限 */
  A_MIN_CVR: 0.01,
  /** Bランク: ACOS上限 */
  B_MAX_ACOS: 0.5,
} as const;

// =============================================================================
// Priority Score計算用定数
// =============================================================================
export const PRIORITY_SCORE = {
  /** ACOS最大値（これ以上は0点） */
  ACOS_MAX: 0.5,
  /** CVR満点値 */
  CVR_MAX: 0.05,
  /** CTR満点値 */
  CTR_MAX: 0.1,
  /** ACOS重み */
  ACOS_WEIGHT: 0.5,
  /** CVR重み */
  CVR_WEIGHT: 0.3,
  /** CTR重み */
  CTR_WEIGHT: 0.2,
} as const;

// =============================================================================
// サーバー関連定数
// =============================================================================
export const SERVER = {
  /** デフォルトポート */
  DEFAULT_PORT: 8080,
  /** リクエストタイムアウト（ミリ秒） */
  REQUEST_TIMEOUT_MS: 30000,
} as const;

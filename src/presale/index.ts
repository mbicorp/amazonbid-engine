/**
 * プレセール診断モジュール
 *
 * Amazon広告の「先行セール（プレセール）」期間を診断し、
 * 「売れるプレセール」と「買い控えプレセール」を数値で判定する機能を提供。
 *
 * プレセールのタイプに応じて、防御ロジック（DOWN/STOP/NEG）と
 * 攻めロジック（UP/STRONG_UP）の挙動を切り替える。
 */

// =============================================================================
// 型定義
// =============================================================================

export {
  // セールフェーズ
  SalePhase,
  VALID_SALE_PHASES,
  isValidSalePhase,

  // プレセールタイプ
  PresaleType,
  VALID_PRESALE_TYPES,
  isValidPresaleType,

  // メトリクスと入力
  PresalePeriodMetrics,
  PresaleDiagnosisInput,

  // 診断結果
  PresaleDiagnosis,

  // 設定
  SaleContextConfig,
  DEFAULT_SALE_CONTEXT_CONFIG,
  PresaleThresholdConfig,
  DEFAULT_PRESALE_THRESHOLD_CONFIG,

  // ポリシー
  PresaleBidPolicy,
  DEFAULT_PRESALE_POLICIES,

  // コンテキスト
  PresaleContext,
  PresaleDiagnosisSkipReason,
} from "./types";

// =============================================================================
// 診断関数
// =============================================================================

export {
  // メイン診断関数
  diagnosePresaleType,

  // ポリシー取得
  getPresaleBidPolicy,

  // コンテキスト生成
  createPresaleContext,

  // ヘルパー関数
  calculateCvr,
  calculateAcos,
  hasMinimumClicks,
} from "./diagnosis";

// =============================================================================
// 防御ロジック統合
// =============================================================================

export {
  // 防御アクション型
  DefenseAction,

  // 防御判定結果
  PresaleAwareDefenseResult,

  // 防御アクション調整
  adjustDefenseAction,

  // DOWN制限適用
  applyPresaleDownLimit,

  // HOLD_BACKでのDOWN許可判定
  shouldAllowDownInHoldBack,

  // 統合防御関数
  applyPresaleDefense,
} from "./defense-integration";

// =============================================================================
// 攻めロジック統合
// =============================================================================

export {
  // 攻めアクション型
  OffenseAction,

  // 攻め判定結果
  PresaleAwareOffenseResult,

  // 攻めアクション調整
  adjustOffenseAction,

  // プレセールタイプ別アップ戦略
  applyBuyingUpStrategy,
  applyHoldBackUpStrategy,
  applyMixedUpStrategy,

  // 統合アップ戦略
  applyPresaleUpStrategy,

  // 統合攻め関数
  applyPresaleOffense,
} from "./offense-integration";

/**
 * イベントオーバーライド機構 - 型定義
 *
 * 大型セール時に「守りのロジック」が効きすぎることを防ぐための
 * イベントモード別の入札ポリシーを定義する
 *
 * See: architecture.md Section 17. Event Override
 */

// =============================================================================
// EventMode 定義
// =============================================================================

/**
 * イベントモード
 *
 * - NONE: 通常日（デフォルト）
 * - BIG_SALE_PREP: セール準備期間（セール前2-3日）
 * - BIG_SALE_DAY: セール当日
 */
export type EventMode = "NONE" | "BIG_SALE_PREP" | "BIG_SALE_DAY";

/**
 * 有効なEventModeの配列（バリデーション用）
 */
export const VALID_EVENT_MODES: readonly EventMode[] = [
  "NONE",
  "BIG_SALE_PREP",
  "BIG_SALE_DAY",
] as const;

/**
 * EventModeのバリデーション
 */
export function isValidEventMode(value: unknown): value is EventMode {
  return (
    typeof value === "string" && VALID_EVENT_MODES.includes(value as EventMode)
  );
}

// =============================================================================
// EventBidPolicy 定義
// =============================================================================

/**
 * イベントモード別の入札ポリシー
 *
 * 各モードで、アップ・ダウンの挙動を制御するための係数セット
 */
export interface EventBidPolicy {
  /**
   * アップ方向の最大倍率
   * 例: 1.5 = 現在の入札額の1.5倍まで上げられる
   */
  maxBidUpMultiplier: number;

  /**
   * ダウン方向の最大倍率（1未満の値）
   * 例: 0.9 = 現在の入札額の90%まで（=10%減）が下限
   */
  maxBidDownMultiplier: number;

  /**
   * ACOS高すぎ判定の乗数（7日除外版）
   * targetAcos × この値を超えたらACOS_HIGH判定
   * 値が大きいほど判定が緩くなる
   */
  acosHighMultiplierFor7dExcl: number;

  /**
   * ACOS高すぎ判定の乗数（30日版）
   * targetAcos × この値を超えたらACOS_HIGH判定
   * 値が大きいほど判定が緩くなる
   */
  acosHighMultiplierFor30d: number;

  /**
   * 強いダウン（STRONG_DOWN, STOP）を許可するかどうか
   * falseの場合、MILD_DOWNまでに抑制される
   */
  allowStrongDown: boolean;

  /**
   * NO_CONVERSION判定を許可するかどうか
   * falseの場合、NO_CONVERSIONによるダウン判定を無効化
   */
  allowNoConversionDown: boolean;
}

// =============================================================================
// デフォルトポリシー
// =============================================================================

/**
 * 通常日（NONE）のポリシー
 * 既存のATTRIBUTION_DELAY_CONFIGと整合性を保つ
 */
export const EVENT_POLICY_NONE: EventBidPolicy = {
  maxBidUpMultiplier: 1.3,
  maxBidDownMultiplier: 0.7,
  acosHighMultiplierFor7dExcl: 1.2,
  acosHighMultiplierFor30d: 1.05,
  allowStrongDown: true,
  allowNoConversionDown: true,
};

/**
 * セール準備期間（BIG_SALE_PREP）のポリシー
 * ややアップ側に振る、ダウン判定は若干緩める
 */
export const EVENT_POLICY_BIG_SALE_PREP: EventBidPolicy = {
  maxBidUpMultiplier: 1.4,
  maxBidDownMultiplier: 0.85,
  acosHighMultiplierFor7dExcl: 1.3,
  acosHighMultiplierFor30d: 1.1,
  allowStrongDown: true,
  allowNoConversionDown: true,
};

/**
 * セール当日（BIG_SALE_DAY）のポリシー
 * アップ側を大きくブースト、ダウン判定を大幅に緩める
 * 強いダウンは封じる
 */
export const EVENT_POLICY_BIG_SALE_DAY: EventBidPolicy = {
  maxBidUpMultiplier: 1.5,
  maxBidDownMultiplier: 0.9,
  acosHighMultiplierFor7dExcl: 1.5,
  acosHighMultiplierFor30d: 1.15,
  allowStrongDown: false,
  allowNoConversionDown: false,
};

/**
 * EventModeに対応するポリシーを取得
 */
export function getEventBidPolicy(eventMode: EventMode): EventBidPolicy {
  switch (eventMode) {
    case "BIG_SALE_DAY":
      return EVENT_POLICY_BIG_SALE_DAY;
    case "BIG_SALE_PREP":
      return EVENT_POLICY_BIG_SALE_PREP;
    case "NONE":
    default:
      return EVENT_POLICY_NONE;
  }
}

// =============================================================================
// イベントモード設定の型定義
// =============================================================================

/**
 * イベントモード設定（GlobalConfigに追加される）
 */
export interface EventModeConfig {
  /**
   * 現在のイベントモード
   */
  eventMode: EventMode;

  /**
   * イベントモード別のカスタムポリシー（オプション）
   * 指定しない場合はデフォルトポリシーを使用
   */
  customPolicies?: Partial<Record<EventMode, Partial<EventBidPolicy>>>;
}

/**
 * デフォルトのイベントモード設定
 */
export const DEFAULT_EVENT_MODE_CONFIG: EventModeConfig = {
  eventMode: "NONE",
};

/**
 * カスタムポリシーを適用したEventBidPolicyを取得
 */
export function getEffectiveEventBidPolicy(
  eventMode: EventMode,
  customPolicies?: Partial<Record<EventMode, Partial<EventBidPolicy>>>
): EventBidPolicy {
  const basePolicy = getEventBidPolicy(eventMode);

  if (!customPolicies || !customPolicies[eventMode]) {
    return basePolicy;
  }

  // カスタムポリシーをマージ
  return {
    ...basePolicy,
    ...customPolicies[eventMode],
  };
}

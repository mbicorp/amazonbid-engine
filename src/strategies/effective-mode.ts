/**
 * effectiveMode決定ロジック
 *
 * GlobalConfig.mode（NORMAL / S_MODE）、EventMode、bigSaleStrategy の
 * 3つの要素から、SKUごとの「effectiveMode」を決定する
 *
 * effectiveModeは、クールダウン、最小絶対変動額、S_MODE特有の倍率など
 * 「modeによって変化するすべての挙動」に対して使用される
 */

import { EventMode } from "../event";
import { BigSaleStrategy, DEFAULT_BIG_SALE_STRATEGY } from "../config/productConfigTypes";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 操作モード（グローバル設定）
 */
export type OperationMode = "NORMAL" | "S_MODE";

/**
 * 有効なOperationMode一覧
 */
export const VALID_OPERATION_MODES: readonly OperationMode[] = [
  "NORMAL",
  "S_MODE",
] as const;

/**
 * 値がOperationModeかどうかを判定
 */
export function isValidOperationMode(value: unknown): value is OperationMode {
  return (
    typeof value === "string" &&
    VALID_OPERATION_MODES.includes(value as OperationMode)
  );
}

/**
 * effectiveMode（SKU単位の有効モード）
 *
 * - NORMAL: 通常モード（S_MODEの攻めロジックを適用しない）
 * - S_MODE: セールモード（フルS_MODE）
 * - S_MODE_LIGHT: 控えめセールモード（S_MODEの攻め係数を半分程度にスケール）
 */
export type EffectiveMode = "NORMAL" | "S_MODE" | "S_MODE_LIGHT";

/**
 * effectiveMode決定の入力
 */
export interface EffectiveModeInput {
  /** グローバル操作モード */
  globalMode: OperationMode;
  /** 現在のイベントモード */
  eventMode: EventMode;
  /** SKUごとのビッグセール戦略 */
  bigSaleStrategy: BigSaleStrategy;
}

/**
 * effectiveMode決定結果
 */
export interface EffectiveModeResult {
  /** 決定されたeffectiveMode */
  effectiveMode: EffectiveMode;
  /** 決定理由 */
  reason: string;
  /** S_MODE攻め係数のスケール（0.0〜1.0） */
  sModeScale: number;
}

// =============================================================================
// S_MODE攻め係数のスケール設定
// =============================================================================

/**
 * S_MODEスケール設定
 */
export interface SModeScaleConfig {
  /** AGGRESSIVE時のスケール（フルパワー） */
  aggressive: number;
  /** LIGHT時のスケール（控えめ） */
  light: number;
  /** NONE時のスケール（無効） */
  none: number;
}

/**
 * デフォルトのS_MODEスケール設定
 */
export const DEFAULT_S_MODE_SCALE_CONFIG: SModeScaleConfig = {
  aggressive: 1.0,  // 100%（フルS_MODE）
  light: 0.5,       // 50%（半分程度にスケール）
  none: 0.0,        // 0%（S_MODE無効、NORMAL扱い）
};

// =============================================================================
// effectiveMode決定関数
// =============================================================================

/**
 * effectiveModeを決定
 *
 * ルール:
 * 1. globalMode === 'NORMAL' の場合
 *    → effectiveMode は常に 'NORMAL'
 *    → EventMode や bigSaleStrategy に関わらず、既存の NORMAL モードの挙動を維持
 *
 * 2. globalMode === 'S_MODE' かつ eventMode が 'BIG_SALE_DAY' の場合
 *    - bigSaleStrategy === 'AGGRESSIVE' → effectiveMode: 'S_MODE'
 *    - bigSaleStrategy === 'LIGHT' → effectiveMode: 'S_MODE_LIGHT'
 *    - bigSaleStrategy === 'NONE' → effectiveMode: 'NORMAL'
 *
 * 3. globalMode === 'S_MODE' かつ eventMode が 'BIG_SALE_PREP' の場合
 *    - bigSaleStrategy === 'AGGRESSIVE' → effectiveMode: 'S_MODE_LIGHT'（準備期間は控えめ）
 *    - bigSaleStrategy === 'LIGHT' → effectiveMode: 'NORMAL'（準備期間は適用しない）
 *    - bigSaleStrategy === 'NONE' → effectiveMode: 'NORMAL'
 *
 * 4. globalMode === 'S_MODE' かつ eventMode が 'NONE' の場合
 *    → effectiveMode は常に 'NORMAL'（セール日でないためS_MODEを適用しない）
 *
 * @param input - effectiveMode決定入力
 * @param scaleConfig - S_MODEスケール設定（オプション）
 * @returns effectiveMode決定結果
 */
export function determineEffectiveMode(
  input: EffectiveModeInput,
  scaleConfig: SModeScaleConfig = DEFAULT_S_MODE_SCALE_CONFIG
): EffectiveModeResult {
  const { globalMode, eventMode, bigSaleStrategy } = input;

  // 1. globalMode === 'NORMAL' の場合は常にNORMAL
  if (globalMode === "NORMAL") {
    return {
      effectiveMode: "NORMAL",
      reason: "globalMode is NORMAL",
      sModeScale: scaleConfig.none,
    };
  }

  // 以下、globalMode === 'S_MODE' の場合

  // 4. eventMode === 'NONE' の場合は NORMAL
  if (eventMode === "NONE") {
    return {
      effectiveMode: "NORMAL",
      reason: "S_MODE but eventMode is NONE (not sale day)",
      sModeScale: scaleConfig.none,
    };
  }

  // 3. eventMode === 'BIG_SALE_PREP' の場合
  if (eventMode === "BIG_SALE_PREP") {
    switch (bigSaleStrategy) {
      case "AGGRESSIVE":
        return {
          effectiveMode: "S_MODE_LIGHT",
          reason: "S_MODE + BIG_SALE_PREP + AGGRESSIVE → S_MODE_LIGHT (prep period)",
          sModeScale: scaleConfig.light,
        };
      case "LIGHT":
      case "NONE":
      default:
        return {
          effectiveMode: "NORMAL",
          reason: `S_MODE + BIG_SALE_PREP + ${bigSaleStrategy} → NORMAL (not participating in prep)`,
          sModeScale: scaleConfig.none,
        };
    }
  }

  // 2. eventMode === 'BIG_SALE_DAY' の場合
  if (eventMode === "BIG_SALE_DAY") {
    switch (bigSaleStrategy) {
      case "AGGRESSIVE":
        return {
          effectiveMode: "S_MODE",
          reason: "S_MODE + BIG_SALE_DAY + AGGRESSIVE → full S_MODE",
          sModeScale: scaleConfig.aggressive,
        };
      case "LIGHT":
        return {
          effectiveMode: "S_MODE_LIGHT",
          reason: "S_MODE + BIG_SALE_DAY + LIGHT → S_MODE_LIGHT (scaled)",
          sModeScale: scaleConfig.light,
        };
      case "NONE":
      default:
        return {
          effectiveMode: "NORMAL",
          reason: `S_MODE + BIG_SALE_DAY + ${bigSaleStrategy} → NORMAL (not participating)`,
          sModeScale: scaleConfig.none,
        };
    }
  }

  // フォールバック（通常は到達しない）
  return {
    effectiveMode: "NORMAL",
    reason: "fallback to NORMAL",
    sModeScale: scaleConfig.none,
  };
}

/**
 * ProductConfigからbigSaleStrategyを取得（デフォルト値あり）
 */
export function getBigSaleStrategy(
  bigSaleStrategy: BigSaleStrategy | undefined
): BigSaleStrategy {
  return bigSaleStrategy ?? DEFAULT_BIG_SALE_STRATEGY;
}

// =============================================================================
// S_MODE攻め係数のスケーリング
// =============================================================================

/**
 * S_MODE攻め係数をスケーリング
 *
 * S_MODE用の攻めパラメータ（入札アップ倍率、ACOS緩和係数など）を
 * effectiveModeに応じてスケーリングする
 *
 * @param baseValue - S_MODEでの基本値
 * @param normalValue - NORMALモードでの値
 * @param sModeScale - S_MODEスケール（0.0〜1.0）
 * @returns スケーリング後の値
 *
 * 計算式: normalValue + (baseValue - normalValue) × sModeScale
 */
export function scaleSmodeParameter(
  baseValue: number,
  normalValue: number,
  sModeScale: number
): number {
  const delta = baseValue - normalValue;
  return normalValue + delta * sModeScale;
}

/**
 * 入札アップ倍率のスケーリング
 *
 * 例: NORMAL=1.3, S_MODE=1.5 の場合
 * - sModeScale=1.0 → 1.5
 * - sModeScale=0.5 → 1.4
 * - sModeScale=0.0 → 1.3
 */
export function scaleBidUpMultiplier(
  sModeMultiplier: number,
  normalMultiplier: number,
  sModeScale: number
): number {
  return scaleSmodeParameter(sModeMultiplier, normalMultiplier, sModeScale);
}

/**
 * 入札ダウン倍率のスケーリング
 *
 * 例: NORMAL=0.7, S_MODE=0.9 の場合
 * - sModeScale=1.0 → 0.9
 * - sModeScale=0.5 → 0.8
 * - sModeScale=0.0 → 0.7
 */
export function scaleBidDownMultiplier(
  sModeMultiplier: number,
  normalMultiplier: number,
  sModeScale: number
): number {
  return scaleSmodeParameter(sModeMultiplier, normalMultiplier, sModeScale);
}

/**
 * ACOS緩和係数のスケーリング
 *
 * 例: NORMAL=1.2, S_MODE=1.5 の場合
 * - sModeScale=1.0 → 1.5
 * - sModeScale=0.5 → 1.35
 * - sModeScale=0.0 → 1.2
 */
export function scaleAcosMultiplier(
  sModeMultiplier: number,
  normalMultiplier: number,
  sModeScale: number
): number {
  return scaleSmodeParameter(sModeMultiplier, normalMultiplier, sModeScale);
}

// =============================================================================
// effectiveMode適用済みのEventBidPolicy
// =============================================================================

/**
 * effectiveModeを考慮したEventBidPolicyのパラメータ
 */
export interface EffectiveEventBidParams {
  /** アップ方向の最大倍率 */
  maxBidUpMultiplier: number;
  /** ダウン方向の最大倍率 */
  maxBidDownMultiplier: number;
  /** ACOS高すぎ判定の乗数（7日除外版） */
  acosHighMultiplierFor7dExcl: number;
  /** ACOS高すぎ判定の乗数（30日版） */
  acosHighMultiplierFor30d: number;
  /** 強いダウンを許可するか */
  allowStrongDown: boolean;
  /** NO_CONVERSION判定を許可するか */
  allowNoConversionDown: boolean;
  /** effectiveMode */
  effectiveMode: EffectiveMode;
  /** S_MODEスケール */
  sModeScale: number;
}

/**
 * NORMAL/S_MODEのEventBidPolicy基本値
 */
export interface EventBidPolicyPair {
  normal: {
    maxBidUpMultiplier: number;
    maxBidDownMultiplier: number;
    acosHighMultiplierFor7dExcl: number;
    acosHighMultiplierFor30d: number;
  };
  sMode: {
    maxBidUpMultiplier: number;
    maxBidDownMultiplier: number;
    acosHighMultiplierFor7dExcl: number;
    acosHighMultiplierFor30d: number;
  };
}

/**
 * デフォルトのEventBidPolicyペア（BIG_SALE_DAY用）
 */
export const DEFAULT_BIG_SALE_DAY_POLICY_PAIR: EventBidPolicyPair = {
  normal: {
    maxBidUpMultiplier: 1.3,
    maxBidDownMultiplier: 0.7,
    acosHighMultiplierFor7dExcl: 1.2,
    acosHighMultiplierFor30d: 1.05,
  },
  sMode: {
    maxBidUpMultiplier: 1.5,
    maxBidDownMultiplier: 0.9,
    acosHighMultiplierFor7dExcl: 1.5,
    acosHighMultiplierFor30d: 1.15,
  },
};

/**
 * effectiveModeを考慮したEventBidPolicyパラメータを計算
 *
 * @param effectiveModeResult - effectiveMode決定結果
 * @param eventMode - 現在のイベントモード
 * @param policyPair - NORMAL/S_MODEのポリシーペア
 * @returns effectiveMode適用済みのパラメータ
 */
export function calculateEffectiveEventBidParams(
  effectiveModeResult: EffectiveModeResult,
  eventMode: EventMode,
  policyPair: EventBidPolicyPair = DEFAULT_BIG_SALE_DAY_POLICY_PAIR
): EffectiveEventBidParams {
  const { effectiveMode, sModeScale } = effectiveModeResult;
  const { normal, sMode } = policyPair;

  // スケーリング済みの値を計算
  const maxBidUpMultiplier = scaleBidUpMultiplier(
    sMode.maxBidUpMultiplier,
    normal.maxBidUpMultiplier,
    sModeScale
  );

  const maxBidDownMultiplier = scaleBidDownMultiplier(
    sMode.maxBidDownMultiplier,
    normal.maxBidDownMultiplier,
    sModeScale
  );

  const acosHighMultiplierFor7dExcl = scaleAcosMultiplier(
    sMode.acosHighMultiplierFor7dExcl,
    normal.acosHighMultiplierFor7dExcl,
    sModeScale
  );

  const acosHighMultiplierFor30d = scaleAcosMultiplier(
    sMode.acosHighMultiplierFor30d,
    normal.acosHighMultiplierFor30d,
    sModeScale
  );

  // 強いダウン・NO_CONVERSION判定の制御
  // BIG_SALE_DAYでS_MODEまたはS_MODE_LIGHTの場合は抑制
  const isSaleDayWithSmode =
    eventMode === "BIG_SALE_DAY" &&
    (effectiveMode === "S_MODE" || effectiveMode === "S_MODE_LIGHT");

  const allowStrongDown = !isSaleDayWithSmode;
  const allowNoConversionDown = !isSaleDayWithSmode;

  return {
    maxBidUpMultiplier,
    maxBidDownMultiplier,
    acosHighMultiplierFor7dExcl,
    acosHighMultiplierFor30d,
    allowStrongDown,
    allowNoConversionDown,
    effectiveMode,
    sModeScale,
  };
}

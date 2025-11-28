/**
 * プレセール対応防御ロジック統合
 *
 * 既存のAttribution Defense判定にプレセールコンテキストを統合し、
 * プレセールタイプに応じた防御アクションの制御を行う。
 */

import {
  PresaleType,
  PresaleBidPolicy,
  PresaleContext,
  DEFAULT_PRESALE_POLICIES,
} from "./types";
import { getPresaleBidPolicy } from "./diagnosis";

// =============================================================================
// 防御アクション型定義
// =============================================================================

/**
 * 防御アクションタイプ
 */
export type DefenseAction = "STOP" | "NEG" | "STRONG_DOWN" | "DOWN" | "KEEP";

/**
 * 防御判定結果（プレセール統合版）
 */
export interface PresaleAwareDefenseResult {
  /** 最終的な防御アクション */
  finalAction: DefenseAction;

  /** 元の防御アクション（プレセール調整前） */
  originalAction: DefenseAction;

  /** プレセールによって調整されたか */
  adjustedByPresale: boolean;

  /** 調整理由 */
  adjustmentReason: string | null;

  /** 適用されたプレセールタイプ */
  presaleType: PresaleType;

  /** 適用されたポリシー */
  policy: PresaleBidPolicy;
}

// =============================================================================
// 防御アクション調整関数
// =============================================================================

/**
 * プレセールコンテキストに基づいて防御アクションを調整
 *
 * @param originalAction - 元の防御アクション
 * @param presaleContext - プレセールコンテキスト
 * @returns プレセール調整後の防御判定結果
 *
 * @example
 * ```typescript
 * // 買い控えプレセール時はSTOPがKEEPに変換される
 * const result = adjustDefenseAction("STOP", holdBackContext);
 * // result.finalAction === "KEEP"
 * // result.adjustedByPresale === true
 * ```
 */
export function adjustDefenseAction(
  originalAction: DefenseAction,
  presaleContext: PresaleContext
): PresaleAwareDefenseResult {
  const { diagnosis, policy } = presaleContext;
  const presaleType = diagnosis.type;

  // NONE（プレセール期間外）の場合はそのまま
  if (presaleType === "NONE") {
    return {
      finalAction: originalAction,
      originalAction,
      adjustedByPresale: false,
      adjustmentReason: null,
      presaleType,
      policy,
    };
  }

  // KEEPの場合は調整不要
  if (originalAction === "KEEP") {
    return {
      finalAction: "KEEP",
      originalAction,
      adjustedByPresale: false,
      adjustmentReason: null,
      presaleType,
      policy,
    };
  }

  // STOP/NEGの判定
  if (originalAction === "STOP" || originalAction === "NEG") {
    if (!policy.allowStopNeg) {
      return {
        finalAction: "KEEP",
        originalAction,
        adjustedByPresale: true,
        adjustmentReason: `プレセールタイプ${presaleType}のためSTOP/NEGを禁止 → KEEP`,
        presaleType,
        policy,
      };
    }
    // 許可されている場合はそのまま
    return {
      finalAction: originalAction,
      originalAction,
      adjustedByPresale: false,
      adjustmentReason: null,
      presaleType,
      policy,
    };
  }

  // STRONG_DOWNの判定
  if (originalAction === "STRONG_DOWN") {
    if (!policy.allowStrongDown) {
      // STRONG_DOWN禁止 → DOWNが許可されていればDOWN、なければKEEP
      if (policy.allowDown) {
        return {
          finalAction: "DOWN",
          originalAction,
          adjustedByPresale: true,
          adjustmentReason: `プレセールタイプ${presaleType}のためSTRONG_DOWN禁止 → DOWN`,
          presaleType,
          policy,
        };
      }
      return {
        finalAction: "KEEP",
        originalAction,
        adjustedByPresale: true,
        adjustmentReason: `プレセールタイプ${presaleType}のためSTRONG_DOWN禁止 → KEEP`,
        presaleType,
        policy,
      };
    }
    // 許可されている場合はそのまま
    return {
      finalAction: originalAction,
      originalAction,
      adjustedByPresale: false,
      adjustmentReason: null,
      presaleType,
      policy,
    };
  }

  // DOWNの判定
  if (originalAction === "DOWN") {
    if (!policy.allowDown) {
      return {
        finalAction: "KEEP",
        originalAction,
        adjustedByPresale: true,
        adjustmentReason: `プレセールタイプ${presaleType}のためDOWN禁止 → KEEP`,
        presaleType,
        policy,
      };
    }
    // DOWNは許可されているがそのまま（DOWN幅の制限は別途適用）
    return {
      finalAction: "DOWN",
      originalAction,
      adjustedByPresale: false,
      adjustmentReason: null,
      presaleType,
      policy,
    };
  }

  // その他のアクション（通常はここに来ない）
  return {
    finalAction: originalAction,
    originalAction,
    adjustedByPresale: false,
    adjustmentReason: null,
    presaleType,
    policy,
  };
}

// =============================================================================
// 入札額調整関数
// =============================================================================

/**
 * プレセールコンテキストに基づいてDOWN幅を制限した入札額を計算
 *
 * @param currentBid - 現在の入札額
 * @param rawDownPercent - 計算されたDOWN幅（%、例: -15 = 15%減）
 * @param presaleContext - プレセールコンテキスト
 * @returns 調整後の入札額と調整情報
 */
export function applyPresaleDownLimit(
  currentBid: number,
  rawDownPercent: number,
  presaleContext: PresaleContext
): {
  adjustedBid: number;
  adjustedDownPercent: number;
  wasLimited: boolean;
  limitReason: string | null;
} {
  const { diagnosis, policy } = presaleContext;
  const presaleType = diagnosis.type;

  // プレセール期間外はそのまま
  if (presaleType === "NONE") {
    const adjustedBid = currentBid * (1 + rawDownPercent / 100);
    return {
      adjustedBid,
      adjustedDownPercent: rawDownPercent,
      wasLimited: false,
      limitReason: null,
    };
  }

  // 最大DOWN幅を取得
  const maxDownPercent = -policy.maxDownPercent; // 負の値

  // 制限が必要かチェック
  if (rawDownPercent >= maxDownPercent) {
    // 制限不要
    const adjustedBid = currentBid * (1 + rawDownPercent / 100);
    return {
      adjustedBid,
      adjustedDownPercent: rawDownPercent,
      wasLimited: false,
      limitReason: null,
    };
  }

  // 制限を適用
  const adjustedDownPercent = maxDownPercent;
  const adjustedBid = currentBid * (1 + adjustedDownPercent / 100);

  return {
    adjustedBid,
    adjustedDownPercent,
    wasLimited: true,
    limitReason: `プレセールタイプ${presaleType}のためDOWN幅を${rawDownPercent}%から${adjustedDownPercent}%に制限`,
  };
}

/**
 * プレセールコンテキストに基づいてUP幅を制限した入札額を計算
 *
 * @param currentBid - 現在の入札額
 * @param rawUpMultiplier - 計算されたUP倍率（例: 1.3 = 30%増）
 * @param presaleContext - プレセールコンテキスト
 * @returns 調整後の入札額と調整情報
 */
export function applyPresaleUpLimit(
  currentBid: number,
  rawUpMultiplier: number,
  presaleContext: PresaleContext
): {
  adjustedBid: number;
  adjustedMultiplier: number;
  wasLimited: boolean;
  limitReason: string | null;
} {
  const { diagnosis, policy } = presaleContext;
  const presaleType = diagnosis.type;

  // プレセール期間外はそのまま
  if (presaleType === "NONE") {
    const adjustedBid = currentBid * rawUpMultiplier;
    return {
      adjustedBid,
      adjustedMultiplier: rawUpMultiplier,
      wasLimited: false,
      limitReason: null,
    };
  }

  // 最大UP倍率を取得
  const maxUpMultiplier = policy.maxUpMultiplier;

  // 制限が必要かチェック
  if (rawUpMultiplier <= maxUpMultiplier) {
    // 制限不要
    const adjustedBid = currentBid * rawUpMultiplier;
    return {
      adjustedBid,
      adjustedMultiplier: rawUpMultiplier,
      wasLimited: false,
      limitReason: null,
    };
  }

  // 制限を適用
  const adjustedMultiplier = maxUpMultiplier;
  const adjustedBid = currentBid * adjustedMultiplier;

  return {
    adjustedBid,
    adjustedMultiplier,
    wasLimited: true,
    limitReason: `プレセールタイプ${presaleType}のためUP倍率を${rawUpMultiplier.toFixed(2)}から${adjustedMultiplier.toFixed(2)}に制限`,
  };
}

// =============================================================================
// HOLD_BACK専用の追加判定
// =============================================================================

/**
 * HOLD_BACKプレセールでDOWNを許可するかの二重条件チェック
 *
 * HOLD_BACK時は以下の二重条件を満たす場合のみDOWNを許可:
 * 1. baselineの安定期間でも明確に悪い
 * 2. presaleでも悪化継続
 *
 * @param baselineAcos - 通常期間のACOS
 * @param presaleAcos - プレセール期間のACOS
 * @param targetAcos - 目標ACOS
 * @param baselineCvr - 通常期間のCVR
 * @param presaleCvr - プレセール期間のCVR
 * @param targetCvr - 目標CVR（オプション）
 * @returns DOWNを許可するか
 */
export function shouldAllowDownInHoldBack(
  baselineAcos: number | null,
  presaleAcos: number | null,
  targetAcos: number,
  baselineCvr: number | null,
  presaleCvr: number | null,
  targetCvr?: number
): {
  allowDown: boolean;
  reason: string;
} {
  // ACOS条件: baselineでもtargetを20%以上超過、かつpresaleでさらに悪化
  const acosCondition = (() => {
    if (baselineAcos === null) {
      return { met: false, reason: "baselineACOSが不明" };
    }
    if (presaleAcos === null) {
      return { met: false, reason: "presaleACOSが不明" };
    }

    const baselineBad = baselineAcos > targetAcos * 1.2;
    const presaleWorse = presaleAcos >= baselineAcos;

    if (baselineBad && presaleWorse) {
      return {
        met: true,
        reason: `baselineACOS(${(baselineAcos * 100).toFixed(1)}%)がtarget(${(targetAcos * 100).toFixed(1)}%)の120%超過、presaleACOS(${(presaleAcos * 100).toFixed(1)}%)も悪化継続`,
      };
    }

    return { met: false, reason: "ACOS条件未達" };
  })();

  // CVR条件: targetCvrがある場合、baselineでも目標を下回っている
  const cvrCondition = (() => {
    if (targetCvr === undefined) {
      // targetCvrが指定されていない場合はACOS条件のみで判断
      return { met: true, reason: "targetCvr未指定のためスキップ" };
    }
    if (baselineCvr === null) {
      return { met: false, reason: "baselineCVRが不明" };
    }

    const baselineBad = baselineCvr < targetCvr * 0.8;
    if (baselineBad) {
      return {
        met: true,
        reason: `baselineCVR(${(baselineCvr * 100).toFixed(1)}%)がtarget(${(targetCvr * 100).toFixed(1)}%)の80%未満`,
      };
    }

    return { met: false, reason: "CVR条件未達" };
  })();

  // 両条件を満たす場合のみDOWN許可
  if (acosCondition.met && cvrCondition.met) {
    return {
      allowDown: true,
      reason: `HOLD_BACK二重条件クリア: ${acosCondition.reason}; ${cvrCondition.reason}`,
    };
  }

  return {
    allowDown: false,
    reason: `HOLD_BACK二重条件未達: ACOS=${acosCondition.reason}, CVR=${cvrCondition.reason}`,
  };
}

// =============================================================================
// 統合判定関数
// =============================================================================

/**
 * プレセールを考慮した防御アクションの最終判定
 *
 * Attribution Defenseの判定結果にプレセールコンテキストを適用し、
 * 最終的な防御アクションを決定する。
 *
 * @param originalAction - Attribution Defenseが判定した防御アクション
 * @param presaleContext - プレセールコンテキスト
 * @param targetAcos - 目標ACOS（HOLD_BACKの二重条件チェック用）
 * @param targetCvr - 目標CVR（オプション、HOLD_BACKの二重条件チェック用）
 * @returns 最終的な防御判定結果
 */
export function applyPresaleDefense(
  originalAction: DefenseAction,
  presaleContext: PresaleContext,
  targetAcos?: number,
  targetCvr?: number
): PresaleAwareDefenseResult {
  const { diagnosis, policy } = presaleContext;
  const presaleType = diagnosis.type;

  // まず基本的なアクション調整を適用
  const baseResult = adjustDefenseAction(originalAction, presaleContext);

  // HOLD_BACKでDOWNの場合は二重条件チェック
  if (
    presaleType === "HOLD_BACK" &&
    baseResult.finalAction === "DOWN" &&
    targetAcos !== undefined
  ) {
    const holdBackCheck = shouldAllowDownInHoldBack(
      diagnosis.baselineAcos,
      diagnosis.presaleAcos,
      targetAcos,
      diagnosis.baselineCvr,
      diagnosis.presaleCvr,
      targetCvr
    );

    if (!holdBackCheck.allowDown) {
      return {
        ...baseResult,
        finalAction: "KEEP",
        adjustedByPresale: true,
        adjustmentReason: `HOLD_BACK二重条件未達のためDOWN → KEEP: ${holdBackCheck.reason}`,
      };
    }
  }

  return baseResult;
}

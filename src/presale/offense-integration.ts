/**
 * プレセール対応攻めロジック統合
 *
 * プレセールタイプに応じたUP/STRONG_UPアクションの制御を行う。
 */

import {
  PresaleType,
  PresaleBidPolicy,
  PresaleContext,
  DEFAULT_PRESALE_POLICIES,
} from "./types";

// =============================================================================
// 攻めアクション型定義
// =============================================================================

/**
 * 攻めアクションタイプ
 */
export type OffenseAction = "STRONG_UP" | "MILD_UP" | "KEEP";

/**
 * 攻め判定結果（プレセール統合版）
 */
export interface PresaleAwareOffenseResult {
  /** 最終的な攻めアクション */
  finalAction: OffenseAction;

  /** 元の攻めアクション（プレセール調整前） */
  originalAction: OffenseAction;

  /** プレセールによって調整されたか */
  adjustedByPresale: boolean;

  /** 調整理由 */
  adjustmentReason: string | null;

  /** 最終的なUP倍率 */
  finalMultiplier: number;

  /** 元のUP倍率（プレセール調整前） */
  originalMultiplier: number;

  /** 適用されたプレセールタイプ */
  presaleType: PresaleType;

  /** 適用されたポリシー */
  policy: PresaleBidPolicy;
}

// =============================================================================
// 攻めアクション調整関数
// =============================================================================

/**
 * プレセールコンテキストに基づいて攻めアクションを調整
 *
 * @param originalAction - 元の攻めアクション
 * @param originalMultiplier - 元のUP倍率
 * @param presaleContext - プレセールコンテキスト
 * @returns プレセール調整後の攻め判定結果
 *
 * @example
 * ```typescript
 * // 買い控えプレセール時はSTRONG_UPがMILD_UPに変換される
 * const result = adjustOffenseAction("STRONG_UP", 1.4, holdBackContext);
 * // result.finalAction === "MILD_UP"
 * // result.finalMultiplier === 1.1
 * ```
 */
export function adjustOffenseAction(
  originalAction: OffenseAction,
  originalMultiplier: number,
  presaleContext: PresaleContext
): PresaleAwareOffenseResult {
  const { diagnosis, policy } = presaleContext;
  const presaleType = diagnosis.type;

  // NONE（プレセール期間外）の場合はそのまま
  if (presaleType === "NONE") {
    return {
      finalAction: originalAction,
      originalAction,
      adjustedByPresale: false,
      adjustmentReason: null,
      finalMultiplier: originalMultiplier,
      originalMultiplier,
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
      finalMultiplier: 1.0,
      originalMultiplier: 1.0,
      presaleType,
      policy,
    };
  }

  // STRONG_UPの判定
  if (originalAction === "STRONG_UP") {
    if (!policy.allowStrongUp) {
      // STRONG_UP禁止 → MILD_UPに変換
      const adjustedMultiplier = Math.min(originalMultiplier, policy.maxUpMultiplier);
      return {
        finalAction: "MILD_UP",
        originalAction,
        adjustedByPresale: true,
        adjustmentReason: `プレセールタイプ${presaleType}のためSTRONG_UP禁止 → MILD_UP`,
        finalMultiplier: adjustedMultiplier,
        originalMultiplier,
        presaleType,
        policy,
      };
    }

    // STRONG_UPは許可されているが、倍率は制限する可能性あり
    const adjustedMultiplier = Math.min(originalMultiplier, policy.maxUpMultiplier);
    const wasLimited = adjustedMultiplier < originalMultiplier;

    return {
      finalAction: "STRONG_UP",
      originalAction,
      adjustedByPresale: wasLimited,
      adjustmentReason: wasLimited
        ? `プレセールタイプ${presaleType}のためUP倍率を${originalMultiplier.toFixed(2)}から${adjustedMultiplier.toFixed(2)}に制限`
        : null,
      finalMultiplier: adjustedMultiplier,
      originalMultiplier,
      presaleType,
      policy,
    };
  }

  // MILD_UPの判定
  if (originalAction === "MILD_UP") {
    // MILD_UPは常に許可されるが、倍率は制限する可能性あり
    const adjustedMultiplier = Math.min(originalMultiplier, policy.maxUpMultiplier);
    const wasLimited = adjustedMultiplier < originalMultiplier;

    return {
      finalAction: "MILD_UP",
      originalAction,
      adjustedByPresale: wasLimited,
      adjustmentReason: wasLimited
        ? `プレセールタイプ${presaleType}のためUP倍率を${originalMultiplier.toFixed(2)}から${adjustedMultiplier.toFixed(2)}に制限`
        : null,
      finalMultiplier: adjustedMultiplier,
      originalMultiplier,
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
    finalMultiplier: originalMultiplier,
    originalMultiplier,
    presaleType,
    policy,
  };
}

// =============================================================================
// プレセールタイプ別のアップ戦略
// =============================================================================

/**
 * BUYINGプレセールのアップ戦略を適用
 *
 * 売れるプレセールでは、MAIN_SALEに余地を残しつつ積極的に攻める
 *
 * @param currentBid - 現在の入札額
 * @param targetBid - 目標入札額
 * @param presaleContext - プレセールコンテキスト
 * @returns 調整後の入札額と調整情報
 */
export function applyBuyingUpStrategy(
  currentBid: number,
  targetBid: number,
  presaleContext: PresaleContext
): {
  adjustedBid: number;
  strategy: string;
} {
  const { policy } = presaleContext;

  // 目標入札額が現在入札額より低い場合は調整不要
  if (targetBid <= currentBid) {
    return {
      adjustedBid: targetBid,
      strategy: "目標入札額が現在入札額以下のため調整なし",
    };
  }

  // 倍率を計算
  const rawMultiplier = targetBid / currentBid;

  // ポリシーの最大倍率で制限
  const limitedMultiplier = Math.min(rawMultiplier, policy.maxUpMultiplier);
  const adjustedBid = currentBid * limitedMultiplier;

  if (limitedMultiplier < rawMultiplier) {
    return {
      adjustedBid,
      strategy: `BUYINGプレセール: 倍率を${rawMultiplier.toFixed(2)}から${limitedMultiplier.toFixed(2)}に制限（MAIN_SALEに余地を残す）`,
    };
  }

  return {
    adjustedBid,
    strategy: "BUYINGプレセール: 積極的アップを許可",
  };
}

/**
 * HOLD_BACKプレセールのアップ戦略を適用
 *
 * 買い控えプレセールでは、アップを控えめにする
 *
 * @param currentBid - 現在の入札額
 * @param targetBid - 目標入札額
 * @param presaleContext - プレセールコンテキスト
 * @returns 調整後の入札額と調整情報
 */
export function applyHoldBackUpStrategy(
  currentBid: number,
  targetBid: number,
  presaleContext: PresaleContext
): {
  adjustedBid: number;
  strategy: string;
} {
  const { policy } = presaleContext;

  // 目標入札額が現在入札額より低い場合は調整不要
  if (targetBid <= currentBid) {
    return {
      adjustedBid: targetBid,
      strategy: "目標入札額が現在入札額以下のため調整なし",
    };
  }

  // 倍率を計算
  const rawMultiplier = targetBid / currentBid;

  // HOLD_BACKでは特に控えめに制限
  const limitedMultiplier = Math.min(rawMultiplier, policy.maxUpMultiplier);
  const adjustedBid = currentBid * limitedMultiplier;

  if (limitedMultiplier < rawMultiplier) {
    return {
      adjustedBid,
      strategy: `HOLD_BACKプレセール: 倍率を${rawMultiplier.toFixed(2)}から${limitedMultiplier.toFixed(2)}に制限（買い控え期間のため控えめ）`,
    };
  }

  return {
    adjustedBid,
    strategy: "HOLD_BACKプレセール: 控えめアップ",
  };
}

/**
 * MIXEDプレセールのアップ戦略を適用
 *
 * グレーゾーンでは、中間的な制限を適用
 *
 * @param currentBid - 現在の入札額
 * @param targetBid - 目標入札額
 * @param presaleContext - プレセールコンテキスト
 * @returns 調整後の入札額と調整情報
 */
export function applyMixedUpStrategy(
  currentBid: number,
  targetBid: number,
  presaleContext: PresaleContext
): {
  adjustedBid: number;
  strategy: string;
} {
  const { policy } = presaleContext;

  // 目標入札額が現在入札額より低い場合は調整不要
  if (targetBid <= currentBid) {
    return {
      adjustedBid: targetBid,
      strategy: "目標入札額が現在入札額以下のため調整なし",
    };
  }

  // 倍率を計算
  const rawMultiplier = targetBid / currentBid;

  // MIXEDでは中間的な制限
  const limitedMultiplier = Math.min(rawMultiplier, policy.maxUpMultiplier);
  const adjustedBid = currentBid * limitedMultiplier;

  if (limitedMultiplier < rawMultiplier) {
    return {
      adjustedBid,
      strategy: `MIXEDプレセール: 倍率を${rawMultiplier.toFixed(2)}から${limitedMultiplier.toFixed(2)}に制限（グレーゾーンのため中間的制限）`,
    };
  }

  return {
    adjustedBid,
    strategy: "MIXEDプレセール: 中間的アップ",
  };
}

// =============================================================================
// 統合アップ戦略
// =============================================================================

/**
 * プレセールを考慮したアップ戦略を適用
 *
 * @param currentBid - 現在の入札額
 * @param targetBid - 目標入札額
 * @param presaleContext - プレセールコンテキスト
 * @returns 調整後の入札額と戦略情報
 */
export function applyPresaleUpStrategy(
  currentBid: number,
  targetBid: number,
  presaleContext: PresaleContext
): {
  adjustedBid: number;
  strategy: string;
  presaleType: PresaleType;
} {
  const presaleType = presaleContext.diagnosis.type;

  switch (presaleType) {
    case "BUYING":
      const buyingResult = applyBuyingUpStrategy(currentBid, targetBid, presaleContext);
      return { ...buyingResult, presaleType };

    case "HOLD_BACK":
      const holdBackResult = applyHoldBackUpStrategy(currentBid, targetBid, presaleContext);
      return { ...holdBackResult, presaleType };

    case "MIXED":
      const mixedResult = applyMixedUpStrategy(currentBid, targetBid, presaleContext);
      return { ...mixedResult, presaleType };

    case "NONE":
    default:
      return {
        adjustedBid: targetBid,
        strategy: "プレセール期間外のため調整なし",
        presaleType,
      };
  }
}

// =============================================================================
// 統合判定関数
// =============================================================================

/**
 * プレセールを考慮した攻めアクションの最終判定
 *
 * @param originalAction - 元の攻めアクション
 * @param originalMultiplier - 元のUP倍率
 * @param presaleContext - プレセールコンテキスト
 * @returns 最終的な攻め判定結果
 */
export function applyPresaleOffense(
  originalAction: OffenseAction,
  originalMultiplier: number,
  presaleContext: PresaleContext
): PresaleAwareOffenseResult {
  return adjustOffenseAction(originalAction, originalMultiplier, presaleContext);
}

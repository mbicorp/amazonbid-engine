/**
 * 在庫ガードロジック
 *
 * 在庫状況に応じて入札を調整する二段階のガード:
 * 1. ハードキル: 在庫ゼロ時に入札をゼロ（または推奨スキップ）
 * 2. ソフトスロットル: 在庫薄時に入札アップを抑制
 */

import {
  AsinInventorySnapshot,
  InventoryRiskStatus,
  InventoryGuardResult,
  InventoryGuardMode,
  OutOfStockBidPolicy,
  INVENTORY_GUARD_DEFAULTS,
} from "./types";
import { calculateInventoryRiskStatus } from "./inventoryRepository";

// =============================================================================
// 在庫ガード設定（ProductConfigから渡される）
// =============================================================================

/**
 * 在庫ガード設定
 */
export interface InventoryGuardConfig {
  /** 在庫ガードモード */
  inventoryGuardMode: InventoryGuardMode;

  /** 在庫ゼロ時のポリシー */
  outOfStockBidPolicy: OutOfStockBidPolicy;

  /** 「攻め」モード禁止閾値（日数） */
  minDaysOfInventoryForGrowth: number;

  /** 「通常」モード抑制閾値（日数） */
  minDaysOfInventoryForNormal: number;
}

/**
 * デフォルトの在庫ガード設定
 */
export const DEFAULT_INVENTORY_GUARD_CONFIG: InventoryGuardConfig = {
  inventoryGuardMode: "NORMAL",
  outOfStockBidPolicy: "SET_ZERO",
  minDaysOfInventoryForGrowth: INVENTORY_GUARD_DEFAULTS.MIN_DAYS_FOR_GROWTH,
  minDaysOfInventoryForNormal: INVENTORY_GUARD_DEFAULTS.MIN_DAYS_FOR_NORMAL,
};

// =============================================================================
// ハードキル判定
// =============================================================================

/**
 * ハードキル（在庫ゼロ時の処理）を適用
 *
 * @param inventory - 在庫スナップショット
 * @param originalBid - 元の推奨入札額
 * @param config - 在庫ガード設定
 * @returns ガード適用結果
 */
export function applyHardKill(
  inventory: AsinInventorySnapshot | null,
  originalBid: number,
  config: InventoryGuardConfig = DEFAULT_INVENTORY_GUARD_CONFIG
): InventoryGuardResult {
  // 在庫ガードがOFFの場合は適用しない
  if (config.inventoryGuardMode === "OFF") {
    return createNoGuardResult(inventory, originalBid);
  }

  // 在庫情報がない、またはUNKNOWNの場合は適用しない
  if (!inventory || inventory.status === "UNKNOWN") {
    return createNoGuardResult(inventory, originalBid);
  }

  // OUT_OF_STOCKの場合のみハードキル適用
  if (inventory.status !== "OUT_OF_STOCK") {
    return createNoGuardResult(inventory, originalBid);
  }

  // ハードキル適用
  if (config.outOfStockBidPolicy === "SKIP_RECOMMENDATION") {
    return {
      adjustedBid: 0,
      originalBid,
      wasApplied: true,
      guardType: "HARD_KILL",
      inventoryStatus: "OUT_OF_STOCK",
      reason: `在庫ゼロのため推奨をスキップ（days_of_inventory=${inventory.daysOfInventory}）`,
      shouldSkipRecommendation: true,
      adjustedMaxUpRatio: null,
      adjustedTargetAcos: null,
    };
  }

  // SET_ZERO: 入札をゼロに設定
  return {
    adjustedBid: 0,
    originalBid,
    wasApplied: true,
    guardType: "HARD_KILL",
    inventoryStatus: "OUT_OF_STOCK",
    reason: `在庫ゼロのため入札をゼロに設定（days_of_inventory=${inventory.daysOfInventory}）`,
    shouldSkipRecommendation: false,
    adjustedMaxUpRatio: null,
    adjustedTargetAcos: null,
  };
}

// =============================================================================
// ソフトスロットル計算
// =============================================================================

/**
 * ソフトスロットル用のパラメータを計算
 *
 * 在庫が少ないほど「攻めを抑え、守りを強く」する係数を返す
 *
 * @param inventory - 在庫スナップショット
 * @param config - 在庫ガード設定
 * @param originalMaxUpRatio - 元のmax_up_ratio（例: 1.3）
 * @param originalTargetAcos - 元のtargetAcos
 * @returns 調整後のmax_up_ratioとtargetAcos
 */
export function calculateSoftThrottleParams(
  inventory: AsinInventorySnapshot | null,
  config: InventoryGuardConfig,
  originalMaxUpRatio: number,
  originalTargetAcos: number
): {
  adjustedMaxUpRatio: number;
  adjustedTargetAcos: number;
  inventoryStatus: InventoryRiskStatus;
  wasAdjusted: boolean;
  reason: string | null;
} {
  // 在庫ガードがOFFの場合は適用しない
  if (config.inventoryGuardMode === "OFF") {
    return {
      adjustedMaxUpRatio: originalMaxUpRatio,
      adjustedTargetAcos: originalTargetAcos,
      inventoryStatus: inventory?.status ?? "UNKNOWN",
      wasAdjusted: false,
      reason: null,
    };
  }

  // 在庫情報がない、またはUNKNOWNの場合は適用しない
  if (!inventory || inventory.status === "UNKNOWN") {
    return {
      adjustedMaxUpRatio: originalMaxUpRatio,
      adjustedTargetAcos: originalTargetAcos,
      inventoryStatus: "UNKNOWN",
      wasAdjusted: false,
      reason: null,
    };
  }

  // 在庫リスクステータスに応じて係数を調整
  // ※OUT_OF_STOCKはハードキルで処理済みなので、ここには来ない想定
  const status = inventory.status;

  switch (status) {
    case "LOW_STOCK_STRICT": {
      // 非常に在庫が少ない: 攻めをほぼ禁止
      const adjustedMaxUpRatio = Math.min(
        originalMaxUpRatio,
        INVENTORY_GUARD_DEFAULTS.LOW_STOCK_STRICT_MAX_UP_RATIO
      );
      // STRICTモードの場合はtargetAcosも厳しく
      const acosMultiplier =
        config.inventoryGuardMode === "STRICT"
          ? INVENTORY_GUARD_DEFAULTS.LOW_STOCK_STRICT_ACOS_MULTIPLIER * 0.9 // より厳しく
          : INVENTORY_GUARD_DEFAULTS.LOW_STOCK_STRICT_ACOS_MULTIPLIER;
      const adjustedTargetAcos = originalTargetAcos * acosMultiplier;

      return {
        adjustedMaxUpRatio,
        adjustedTargetAcos,
        inventoryStatus: status,
        wasAdjusted: true,
        reason: `在庫日数が非常に少ない（${inventory.daysOfInventory}日 < ${config.minDaysOfInventoryForGrowth}日）ため入札上昇を強く抑制`,
      };
    }

    case "LOW_STOCK": {
      // 在庫が少ない: 攻めを抑制
      const adjustedMaxUpRatio = Math.min(
        originalMaxUpRatio,
        INVENTORY_GUARD_DEFAULTS.LOW_STOCK_MAX_UP_RATIO
      );
      // targetAcosは変更なし（LOWレベルでは厳しくしない）

      return {
        adjustedMaxUpRatio,
        adjustedTargetAcos: originalTargetAcos,
        inventoryStatus: status,
        wasAdjusted: true,
        reason: `在庫日数が少ない（${inventory.daysOfInventory}日 < ${config.minDaysOfInventoryForNormal}日）ため入札上昇を抑制`,
      };
    }

    case "NORMAL":
    case "OUT_OF_STOCK": // OUT_OF_STOCKはハードキルで処理されるはず
    default:
      return {
        adjustedMaxUpRatio: originalMaxUpRatio,
        adjustedTargetAcos: originalTargetAcos,
        inventoryStatus: status,
        wasAdjusted: false,
        reason: null,
      };
  }
}

// =============================================================================
// 統合在庫ガード適用
// =============================================================================

/**
 * 在庫ガードを適用
 *
 * ハードキルとソフトスロットルを統合して適用
 *
 * @param inventory - 在庫スナップショット
 * @param recommendedBid - 元の推奨入札額
 * @param currentBid - 現在の入札額
 * @param config - 在庫ガード設定
 * @param originalMaxUpRatio - 元のmax_up_ratio
 * @param originalTargetAcos - 元のtargetAcos
 * @returns ガード適用結果
 */
export function applyInventoryGuard(
  inventory: AsinInventorySnapshot | null,
  recommendedBid: number,
  currentBid: number,
  config: InventoryGuardConfig = DEFAULT_INVENTORY_GUARD_CONFIG,
  originalMaxUpRatio: number = 1.3,
  originalTargetAcos: number = 0.3
): InventoryGuardResult {
  // 1. まずハードキルをチェック
  const hardKillResult = applyHardKill(inventory, recommendedBid, config);
  if (hardKillResult.wasApplied) {
    return hardKillResult;
  }

  // 2. ソフトスロットルパラメータを計算
  const throttleParams = calculateSoftThrottleParams(
    inventory,
    config,
    originalMaxUpRatio,
    originalTargetAcos
  );

  // ソフトスロットルが適用されない場合
  if (!throttleParams.wasAdjusted) {
    return createNoGuardResult(inventory, recommendedBid);
  }

  // 3. ソフトスロットルを適用して入札額を調整
  // max_up_ratioを適用した上限を計算
  const maxAllowedBid = currentBid * throttleParams.adjustedMaxUpRatio;

  // 推奨入札額が上限を超えている場合、上限にクリップ
  const adjustedBid = Math.min(recommendedBid, maxAllowedBid);

  // 実際に調整が行われたかどうか
  const wasActuallyAdjusted = adjustedBid < recommendedBid;

  return {
    adjustedBid,
    originalBid: recommendedBid,
    wasApplied: wasActuallyAdjusted,
    guardType: wasActuallyAdjusted ? "SOFT_THROTTLE" : "NONE",
    inventoryStatus: throttleParams.inventoryStatus,
    reason: wasActuallyAdjusted
      ? throttleParams.reason
      : null,
    shouldSkipRecommendation: false,
    adjustedMaxUpRatio: throttleParams.adjustedMaxUpRatio,
    adjustedTargetAcos: throttleParams.adjustedTargetAcos,
  };
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ガード適用なしの結果を作成
 */
function createNoGuardResult(
  inventory: AsinInventorySnapshot | null,
  originalBid: number
): InventoryGuardResult {
  return {
    adjustedBid: originalBid,
    originalBid,
    wasApplied: false,
    guardType: "NONE",
    inventoryStatus: inventory?.status ?? "UNKNOWN",
    reason: null,
    shouldSkipRecommendation: false,
    adjustedMaxUpRatio: null,
    adjustedTargetAcos: null,
  };
}

/**
 * ProductConfigから在庫ガード設定を抽出
 *
 * ProductConfigの在庫関連フィールドからInventoryGuardConfigを生成
 */
export function extractInventoryGuardConfig(productConfig: {
  inventoryGuardMode?: InventoryGuardMode;
  outOfStockBidPolicy?: OutOfStockBidPolicy;
  minDaysOfInventoryForGrowth?: number;
  minDaysOfInventoryForNormal?: number;
}): InventoryGuardConfig {
  return {
    inventoryGuardMode:
      productConfig.inventoryGuardMode ??
      DEFAULT_INVENTORY_GUARD_CONFIG.inventoryGuardMode,
    outOfStockBidPolicy:
      productConfig.outOfStockBidPolicy ??
      DEFAULT_INVENTORY_GUARD_CONFIG.outOfStockBidPolicy,
    minDaysOfInventoryForGrowth:
      productConfig.minDaysOfInventoryForGrowth ??
      DEFAULT_INVENTORY_GUARD_CONFIG.minDaysOfInventoryForGrowth,
    minDaysOfInventoryForNormal:
      productConfig.minDaysOfInventoryForNormal ??
      DEFAULT_INVENTORY_GUARD_CONFIG.minDaysOfInventoryForNormal,
  };
}

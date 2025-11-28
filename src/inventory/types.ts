/**
 * 在庫関連の型定義
 *
 * 在庫ガードロジックで使用する型を定義
 * - ハードキル（在庫ゼロ時の入札停止）
 * - ソフトスロットル（在庫薄時の入札抑制）
 */

// =============================================================================
// 在庫リスクステータス
// =============================================================================

/**
 * 在庫リスクステータス
 *
 * - OUT_OF_STOCK: 在庫ゼロまたは販売不可状態
 * - LOW_STOCK_STRICT: 在庫が非常に少ない（攻め禁止レベル）
 * - LOW_STOCK: 在庫が少ない（攻め抑制レベル）
 * - NORMAL: 通常在庫
 * - UNKNOWN: 在庫情報不明（ガード適用せず）
 */
export type InventoryRiskStatus =
  | "OUT_OF_STOCK"
  | "LOW_STOCK_STRICT"
  | "LOW_STOCK"
  | "NORMAL"
  | "UNKNOWN";

/**
 * 有効な在庫リスクステータス一覧
 */
export const VALID_INVENTORY_RISK_STATUSES: readonly InventoryRiskStatus[] = [
  "OUT_OF_STOCK",
  "LOW_STOCK_STRICT",
  "LOW_STOCK",
  "NORMAL",
  "UNKNOWN",
] as const;

/**
 * 値がInventoryRiskStatusかどうかを判定
 */
export function isValidInventoryRiskStatus(
  value: unknown
): value is InventoryRiskStatus {
  return (
    typeof value === "string" &&
    VALID_INVENTORY_RISK_STATUSES.includes(value as InventoryRiskStatus)
  );
}

// =============================================================================
// 在庫スナップショット
// =============================================================================

/**
 * ASINごとの在庫スナップショット
 *
 * BigQueryのproduct_strategyテーブルから取得した在庫情報
 */
export interface AsinInventorySnapshot {
  /** Amazon Adsプロファイル ID */
  profileId: string;

  /** ASIN */
  asin: string;

  /**
   * 在庫日数（Days of Inventory）
   *
   * 現在の販売ペースで在庫が何日持つかを示す
   * - null: 在庫情報が不明
   * - 0以下: 在庫切れ
   * - 正の値: 在庫日数
   */
  daysOfInventory: number | null;

  /**
   * 手持ち在庫数（オプション）
   *
   * FBA倉庫にある実在庫数
   */
  onHandUnits?: number | null;

  /**
   * 在庫リスクステータス
   *
   * daysOfInventoryと閾値から自動計算される
   */
  status: InventoryRiskStatus;

  /**
   * 最終更新日時（オプション）
   */
  lastUpdatedAt?: Date;
}

// =============================================================================
// 在庫ガード設定（定数）
// =============================================================================

/**
 * 在庫ガードのデフォルト設定
 */
export const INVENTORY_GUARD_DEFAULTS = {
  /**
   * 「攻め」モード（LAUNCH_HARD/LAUNCH_SOFT）を禁止する在庫日数閾値
   *
   * この日数を下回ったら、ライフサイクルに関わらず攻めない
   * デフォルト: 10日
   */
  MIN_DAYS_FOR_GROWTH: 10,

  /**
   * 「通常」モードも抑制する在庫日数閾値
   *
   * この日数を下回ったら、さらに守り寄りにシフト
   * デフォルト: 20日
   */
  MIN_DAYS_FOR_NORMAL: 20,

  /**
   * LOW_STOCK時の最大入札上昇率
   *
   * 通常のmax_up_ratio（例: 1.3）をこの値に抑制
   * デフォルト: 1.15 (+15%まで)
   */
  LOW_STOCK_MAX_UP_RATIO: 1.15,

  /**
   * LOW_STOCK_STRICT時の最大入札上昇率
   *
   * ほぼ入札上昇を禁止
   * デフォルト: 1.05 (+5%まで)
   */
  LOW_STOCK_STRICT_MAX_UP_RATIO: 1.05,

  /**
   * LOW_STOCK_STRICT時のtargetACOS補正係数
   *
   * targetAcosをこの係数で掛けて厳しくする
   * デフォルト: 0.9 (target × 0.9)
   */
  LOW_STOCK_STRICT_ACOS_MULTIPLIER: 0.9,
} as const;

// =============================================================================
// 在庫ガードモード（ProductConfig用）
// =============================================================================

/**
 * 在庫ガードモード
 *
 * - OFF: 在庫連動ロジックを無視（実験用）
 * - NORMAL: 通常のガード設定
 * - STRICT: より保守的なガード設定
 */
export type InventoryGuardMode = "OFF" | "NORMAL" | "STRICT";

/**
 * 有効な在庫ガードモード一覧
 */
export const VALID_INVENTORY_GUARD_MODES: readonly InventoryGuardMode[] = [
  "OFF",
  "NORMAL",
  "STRICT",
] as const;

/**
 * 値がInventoryGuardModeかどうかを判定
 */
export function isValidInventoryGuardMode(
  value: unknown
): value is InventoryGuardMode {
  return (
    typeof value === "string" &&
    VALID_INVENTORY_GUARD_MODES.includes(value as InventoryGuardMode)
  );
}

// =============================================================================
// 在庫ゼロ時のポリシー（ProductConfig用）
// =============================================================================

/**
 * 在庫ゼロ時の入札ポリシー
 *
 * - SET_ZERO: 入札をゼロに設定
 * - SKIP_RECOMMENDATION: 推奨レコードを生成しない
 */
export type OutOfStockBidPolicy = "SET_ZERO" | "SKIP_RECOMMENDATION";

/**
 * 有効な在庫ゼロ時ポリシー一覧
 */
export const VALID_OUT_OF_STOCK_POLICIES: readonly OutOfStockBidPolicy[] = [
  "SET_ZERO",
  "SKIP_RECOMMENDATION",
] as const;

/**
 * 値がOutOfStockBidPolicyかどうかを判定
 */
export function isValidOutOfStockBidPolicy(
  value: unknown
): value is OutOfStockBidPolicy {
  return (
    typeof value === "string" &&
    VALID_OUT_OF_STOCK_POLICIES.includes(value as OutOfStockBidPolicy)
  );
}

// =============================================================================
// 在庫ガード適用結果
// =============================================================================

/**
 * 在庫ガード適用結果
 */
export interface InventoryGuardResult {
  /** 適用後の推奨入札額 */
  adjustedBid: number;

  /** 元の推奨入札額 */
  originalBid: number;

  /** ガードが適用されたかどうか */
  wasApplied: boolean;

  /** 適用されたガードの種類 */
  guardType: "HARD_KILL" | "SOFT_THROTTLE" | "NONE";

  /** 在庫リスクステータス */
  inventoryStatus: InventoryRiskStatus;

  /** ガード適用理由 */
  reason: string | null;

  /** 推奨をスキップするべきかどうか（SKIP_RECOMMENDATION時のみtrue） */
  shouldSkipRecommendation: boolean;

  /** 調整後のmax_up_ratio（ソフトスロットル適用後） */
  adjustedMaxUpRatio: number | null;

  /** 調整後のtargetAcos（ソフトスロットル適用後） */
  adjustedTargetAcos: number | null;
}

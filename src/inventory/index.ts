/**
 * 在庫モジュール - エクスポート
 */

// 型定義
export {
  InventoryRiskStatus,
  VALID_INVENTORY_RISK_STATUSES,
  isValidInventoryRiskStatus,
  AsinInventorySnapshot,
  INVENTORY_GUARD_DEFAULTS,
  InventoryGuardMode,
  VALID_INVENTORY_GUARD_MODES,
  isValidInventoryGuardMode,
  OutOfStockBidPolicy,
  VALID_OUT_OF_STOCK_POLICIES,
  isValidOutOfStockBidPolicy,
  InventoryGuardResult,
} from "./types";

// リポジトリ
export {
  InventoryRepository,
  InventoryRepositoryConfig,
  createInventoryRepository,
  calculateInventoryRiskStatus,
} from "./inventoryRepository";

// ガードロジック
export {
  InventoryGuardConfig,
  DEFAULT_INVENTORY_GUARD_CONFIG,
  applyHardKill,
  calculateSoftThrottleParams,
  applyInventoryGuard,
  extractInventoryGuardConfig,
} from "./inventoryGuard";

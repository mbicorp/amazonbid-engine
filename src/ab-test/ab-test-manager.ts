/**
 * A/Bテスト管理
 *
 * テストの作成、開始、停止、ステータス管理を行う
 */

import * as crypto from "crypto";
import { logger } from "../logger";

/**
 * UUID v4を生成
 */
function generateUuid(): string {
  return crypto.randomUUID();
}
import {
  ABTestConfig,
  ABTestStatus,
  ABTestAssignment,
  BidEngineOverrides,
  ABTestTargetFilters,
  AssignmentLevel,
  ABTestErrorCode,
  AB_TEST_CONSTANTS,
  DEFAULT_BID_ENGINE_OVERRIDES,
} from "./types";
import { createAssigner, CachedGroupAssigner } from "./ab-test-assigner";

// =============================================================================
// 型定義
// =============================================================================

/**
 * テスト作成オプション
 */
export interface CreateTestOptions {
  name: string;
  description: string;
  assignmentLevel: AssignmentLevel;
  testGroupRatio?: number;
  testOverrides: BidEngineOverrides;
  targetFilters?: ABTestTargetFilters;
  startDate: Date;
  endDate: Date;
  createdBy?: string;
  notes?: string;
}

/**
 * テスト更新オプション
 */
export interface UpdateTestOptions {
  name?: string;
  description?: string;
  testOverrides?: BidEngineOverrides;
  targetFilters?: ABTestTargetFilters;
  endDate?: Date;
  notes?: string;
}

/**
 * BigQuery設定
 */
export interface BigQueryConfig {
  projectId: string;
  dataset: string;
}

// =============================================================================
// バリデーション
// =============================================================================

/**
 * テスト作成オプションをバリデート
 */
export function validateCreateTestOptions(options: CreateTestOptions): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 名前
  if (!options.name || options.name.trim().length === 0) {
    errors.push("テスト名は必須です");
  }

  // 説明
  if (!options.description || options.description.trim().length === 0) {
    errors.push("テストの説明は必須です");
  }

  // テストグループ比率
  const ratio = options.testGroupRatio ?? AB_TEST_CONSTANTS.DEFAULT_TEST_GROUP_RATIO;
  if (ratio <= 0 || ratio >= 1) {
    errors.push(`テストグループ比率は0より大きく1より小さい値である必要があります: ${ratio}`);
  }

  // 日付
  if (!options.startDate || !options.endDate) {
    errors.push("開始日と終了日は必須です");
  } else {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const startDate = new Date(options.startDate);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(options.endDate);
    endDate.setHours(0, 0, 0, 0);

    if (startDate < now) {
      errors.push("開始日は今日以降である必要があります");
    }

    if (endDate <= startDate) {
      errors.push("終了日は開始日より後である必要があります");
    }

    const durationDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (durationDays < AB_TEST_CONSTANTS.MIN_TEST_DURATION_DAYS) {
      errors.push(
        `テスト期間は最低${AB_TEST_CONSTANTS.MIN_TEST_DURATION_DAYS}日必要です: ${durationDays}日`
      );
    }

    if (durationDays > AB_TEST_CONSTANTS.MAX_TEST_DURATION_DAYS) {
      errors.push(
        `テスト期間は最大${AB_TEST_CONSTANTS.MAX_TEST_DURATION_DAYS}日です: ${durationDays}日`
      );
    }
  }

  // オーバーライド設定
  if (options.testOverrides) {
    const overrideErrors = validateOverrides(options.testOverrides);
    errors.push(...overrideErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * オーバーライド設定をバリデート
 */
export function validateOverrides(overrides: BidEngineOverrides): string[] {
  const errors: string[] = [];

  if (overrides.targetAcosMultiplier !== undefined) {
    if (overrides.targetAcosMultiplier <= 0 || overrides.targetAcosMultiplier > 2) {
      errors.push(
        `目標ACOS乗数は0より大きく2以下である必要があります: ${overrides.targetAcosMultiplier}`
      );
    }
  }

  if (overrides.acosHighMultiplier7dExcl !== undefined) {
    if (overrides.acosHighMultiplier7dExcl <= 1) {
      errors.push(
        `ACOS高すぎ乗数（7日除外版）は1より大きい必要があります: ${overrides.acosHighMultiplier7dExcl}`
      );
    }
  }

  if (overrides.strongUpRate !== undefined) {
    if (overrides.strongUpRate <= 0 || overrides.strongUpRate > 1) {
      errors.push(
        `STRONG_UP率は0より大きく1以下である必要があります: ${overrides.strongUpRate}`
      );
    }
  }

  if (overrides.mildUpRate !== undefined) {
    if (overrides.mildUpRate <= 0 || overrides.mildUpRate > 1) {
      errors.push(
        `MILD_UP率は0より大きく1以下である必要があります: ${overrides.mildUpRate}`
      );
    }
  }

  if (overrides.mildDownRate !== undefined) {
    if (overrides.mildDownRate >= 0 || overrides.mildDownRate < -1) {
      errors.push(
        `MILD_DOWN率は0より小さく-1より大きい必要があります: ${overrides.mildDownRate}`
      );
    }
  }

  if (overrides.strongDownRate !== undefined) {
    if (overrides.strongDownRate >= 0 || overrides.strongDownRate < -1) {
      errors.push(
        `STRONG_DOWN率は0より小さく-1より大きい必要があります: ${overrides.strongDownRate}`
      );
    }
  }

  return errors;
}

// =============================================================================
// テスト設定の作成・更新
// =============================================================================

/**
 * 新しいテスト設定を作成
 */
export function createTestConfig(options: CreateTestOptions): ABTestConfig {
  const validation = validateCreateTestOptions(options);
  if (!validation.valid) {
    throw new Error(`Invalid test options: ${validation.errors.join(", ")}`);
  }

  const now = new Date();
  const testId = generateUuid();

  return {
    testId,
    name: options.name.trim(),
    description: options.description.trim(),
    status: "DRAFT",
    assignmentLevel: options.assignmentLevel,
    testGroupRatio: options.testGroupRatio ?? AB_TEST_CONSTANTS.DEFAULT_TEST_GROUP_RATIO,
    testOverrides: options.testOverrides,
    targetFilters: options.targetFilters,
    startDate: options.startDate,
    endDate: options.endDate,
    createdAt: now,
    updatedAt: now,
    createdBy: options.createdBy,
    notes: options.notes,
  };
}

/**
 * テスト設定を更新
 */
export function updateTestConfig(
  config: ABTestConfig,
  options: UpdateTestOptions
): ABTestConfig {
  // RUNNING状態では更新制限あり
  if (config.status === "RUNNING") {
    if (options.testOverrides !== undefined) {
      throw new Error("実行中のテストでは入札ロジックオーバーライドは変更できません");
    }
  }

  // COMPLETED/CANCELLEDでは更新不可
  if (config.status === "COMPLETED" || config.status === "CANCELLED") {
    throw new Error("完了/キャンセル済みのテストは更新できません");
  }

  return {
    ...config,
    name: options.name ?? config.name,
    description: options.description ?? config.description,
    testOverrides: options.testOverrides ?? config.testOverrides,
    targetFilters: options.targetFilters ?? config.targetFilters,
    endDate: options.endDate ?? config.endDate,
    notes: options.notes ?? config.notes,
    updatedAt: new Date(),
  };
}

// =============================================================================
// ステータス管理
// =============================================================================

/**
 * テストを開始
 */
export function startTest(config: ABTestConfig): ABTestConfig {
  if (config.status !== "DRAFT" && config.status !== "PAUSED") {
    throw new Error(
      `テストを開始できません。現在のステータス: ${config.status}`
    );
  }

  const now = new Date();

  // 開始日チェック（DRAFTからの開始時のみ）
  if (config.status === "DRAFT") {
    const startDate = new Date(config.startDate);
    startDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (startDate > today) {
      throw new Error(
        `テストの開始日はまだ到来していません: ${config.startDate.toISOString().split("T")[0]}`
      );
    }
  }

  logger.info("A/Bテストを開始", {
    testId: config.testId,
    name: config.name,
    previousStatus: config.status,
  });

  return {
    ...config,
    status: "RUNNING",
    updatedAt: now,
  };
}

/**
 * テストを一時停止
 */
export function pauseTest(config: ABTestConfig): ABTestConfig {
  if (config.status !== "RUNNING") {
    throw new Error(
      `実行中でないテストは一時停止できません。現在のステータス: ${config.status}`
    );
  }

  logger.info("A/Bテストを一時停止", {
    testId: config.testId,
    name: config.name,
  });

  return {
    ...config,
    status: "PAUSED",
    updatedAt: new Date(),
  };
}

/**
 * テストを完了
 */
export function completeTest(config: ABTestConfig): ABTestConfig {
  if (config.status !== "RUNNING" && config.status !== "PAUSED") {
    throw new Error(
      `テストを完了できません。現在のステータス: ${config.status}`
    );
  }

  logger.info("A/Bテストを完了", {
    testId: config.testId,
    name: config.name,
    previousStatus: config.status,
  });

  return {
    ...config,
    status: "COMPLETED",
    updatedAt: new Date(),
  };
}

/**
 * テストをキャンセル
 */
export function cancelTest(config: ABTestConfig): ABTestConfig {
  if (config.status === "COMPLETED" || config.status === "CANCELLED") {
    throw new Error(
      `既に終了しているテストはキャンセルできません。現在のステータス: ${config.status}`
    );
  }

  logger.info("A/Bテストをキャンセル", {
    testId: config.testId,
    name: config.name,
    previousStatus: config.status,
  });

  return {
    ...config,
    status: "CANCELLED",
    updatedAt: new Date(),
  };
}

// =============================================================================
// オーバーライドのマージ
// =============================================================================

/**
 * デフォルト値とテストオーバーライドをマージ
 *
 * @param overrides - テストオーバーライド設定
 * @returns マージされた設定
 */
export function mergeOverrides(
  overrides: BidEngineOverrides
): Required<Omit<BidEngineOverrides, "customParams">> {
  return {
    ...DEFAULT_BID_ENGINE_OVERRIDES,
    ...overrides,
  };
}

/**
 * テストグループに応じたオーバーライドを取得
 *
 * @param testConfig - テスト設定
 * @param group - 割り当てられたグループ
 * @returns オーバーライド設定（CONTROLの場合はnull）
 */
export function getOverridesForGroup(
  testConfig: ABTestConfig,
  group: "CONTROL" | "TEST"
): BidEngineOverrides | null {
  if (group === "CONTROL") {
    // コントロールグループはデフォルトロジックを使用
    return null;
  }

  // テストグループはオーバーライドを適用
  return testConfig.testOverrides;
}

// =============================================================================
// フィルタリング
// =============================================================================

/**
 * エンティティがテスト対象かどうかをチェック
 *
 * @param filters - 対象フィルター
 * @param entity - チェック対象のエンティティ
 * @returns 対象ならtrue
 */
export function isEntityTargeted(
  filters: ABTestTargetFilters | undefined,
  entity: {
    asin?: string;
    campaignId?: string;
    lifecycleState?: string;
    category?: string;
  }
): boolean {
  // フィルターが指定されていない場合は全対象
  if (!filters) {
    return true;
  }

  // ASINフィルター
  if (filters.asins && filters.asins.length > 0) {
    if (!entity.asin || !filters.asins.includes(entity.asin)) {
      return false;
    }
  }

  // キャンペーンIDフィルター
  if (filters.campaignIds && filters.campaignIds.length > 0) {
    if (!entity.campaignId || !filters.campaignIds.includes(entity.campaignId)) {
      return false;
    }
  }

  // ライフサイクルステートフィルター
  if (filters.lifecycleStates && filters.lifecycleStates.length > 0) {
    if (
      !entity.lifecycleState ||
      !filters.lifecycleStates.includes(entity.lifecycleState)
    ) {
      return false;
    }
  }

  // カテゴリフィルター
  if (filters.categories && filters.categories.length > 0) {
    if (!entity.category || !filters.categories.includes(entity.category)) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// テスト期間チェック
// =============================================================================

/**
 * テストが有効期間内かどうかをチェック
 *
 * @param config - テスト設定
 * @param date - チェック対象日（デフォルト: 現在）
 * @returns 有効期間内ならtrue
 */
export function isTestInValidPeriod(
  config: ABTestConfig,
  date: Date = new Date()
): boolean {
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);

  const startDate = new Date(config.startDate);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(config.endDate);
  endDate.setHours(23, 59, 59, 999);

  return checkDate >= startDate && checkDate <= endDate;
}

/**
 * テストの残り日数を計算
 *
 * @param config - テスト設定
 * @param date - 基準日（デフォルト: 現在）
 * @returns 残り日数（終了している場合は0）
 */
export function getRemainingDays(
  config: ABTestConfig,
  date: Date = new Date()
): number {
  const endDate = new Date(config.endDate);
  endDate.setHours(23, 59, 59, 999);

  const diffMs = endDate.getTime() - date.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * テストの経過日数を計算
 *
 * @param config - テスト設定
 * @param date - 基準日（デフォルト: 現在）
 * @returns 経過日数（開始前の場合は0）
 */
export function getElapsedDays(
  config: ABTestConfig,
  date: Date = new Date()
): number {
  const startDate = new Date(config.startDate);
  startDate.setHours(0, 0, 0, 0);

  const diffMs = date.getTime() - startDate.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// =============================================================================
// ABTestManager クラス
// =============================================================================

/**
 * A/Bテストマネージャー
 *
 * テストの作成、管理、割り当てを一元的に管理
 */
export class ABTestManager {
  private tests: Map<string, ABTestConfig> = new Map();
  private assigners: Map<string, CachedGroupAssigner> = new Map();

  /**
   * テストを登録
   */
  registerTest(config: ABTestConfig): void {
    this.tests.set(config.testId, config);
    this.assigners.set(config.testId, createAssigner(config));

    logger.info("A/Bテストを登録", {
      testId: config.testId,
      name: config.name,
      status: config.status,
    });
  }

  /**
   * テストを取得
   */
  getTest(testId: string): ABTestConfig | undefined {
    return this.tests.get(testId);
  }

  /**
   * 全テストを取得
   */
  getAllTests(): ABTestConfig[] {
    return Array.from(this.tests.values());
  }

  /**
   * 実行中のテストを取得
   */
  getRunningTests(): ABTestConfig[] {
    return this.getAllTests().filter((t) => t.status === "RUNNING");
  }

  /**
   * テストを更新
   */
  updateTest(testId: string, options: UpdateTestOptions): ABTestConfig {
    const config = this.tests.get(testId);
    if (!config) {
      throw new Error(`テストが見つかりません: ${testId}`);
    }

    const updated = updateTestConfig(config, options);
    this.tests.set(testId, updated);

    return updated;
  }

  /**
   * テストのステータスを変更
   */
  changeStatus(
    testId: string,
    action: "start" | "pause" | "complete" | "cancel"
  ): ABTestConfig {
    const config = this.tests.get(testId);
    if (!config) {
      throw new Error(`テストが見つかりません: ${testId}`);
    }

    let updated: ABTestConfig;
    switch (action) {
      case "start":
        updated = startTest(config);
        break;
      case "pause":
        updated = pauseTest(config);
        break;
      case "complete":
        updated = completeTest(config);
        break;
      case "cancel":
        updated = cancelTest(config);
        break;
      default:
        throw new Error(`不明なアクション: ${action}`);
    }

    this.tests.set(testId, updated);
    return updated;
  }

  /**
   * エンティティをグループに割り当て
   */
  assignToGroup(
    testId: string,
    entityKey: string
  ): ABTestAssignment | null {
    const config = this.tests.get(testId);
    if (!config) {
      logger.warn("A/Bテストが見つかりません", { testId });
      return null;
    }

    // 実行中でない場合は割り当てしない
    if (config.status !== "RUNNING") {
      return null;
    }

    // 有効期間外の場合は割り当てしない
    if (!isTestInValidPeriod(config)) {
      return null;
    }

    const assigner = this.assigners.get(testId);
    if (!assigner) {
      return null;
    }

    return assigner.assign(entityKey);
  }

  /**
   * エンティティのグループを取得（既に割り当て済みの場合）
   */
  getCachedGroup(testId: string, entityKey: string): ABTestAssignment | undefined {
    const assigner = this.assigners.get(testId);
    return assigner?.getCachedAssignment(entityKey);
  }

  /**
   * 既存の割り当てを読み込み
   */
  loadAssignments(testId: string, assignments: ABTestAssignment[]): void {
    const assigner = this.assigners.get(testId);
    if (assigner) {
      assigner.loadAssignments(assignments);
    }
  }

  /**
   * テストを削除
   */
  removeTest(testId: string): boolean {
    this.assigners.delete(testId);
    return this.tests.delete(testId);
  }

  /**
   * 全テストをクリア
   */
  clear(): void {
    this.tests.clear();
    this.assigners.clear();
  }
}

// =============================================================================
// シングルトンインスタンス
// =============================================================================

let managerInstance: ABTestManager | null = null;

/**
 * ABTestManagerのシングルトンインスタンスを取得
 */
export function getABTestManager(): ABTestManager {
  if (!managerInstance) {
    managerInstance = new ABTestManager();
  }
  return managerInstance;
}

/**
 * ABTestManagerをリセット（テスト用）
 */
export function resetABTestManager(): void {
  if (managerInstance) {
    managerInstance.clear();
  }
  managerInstance = null;
}

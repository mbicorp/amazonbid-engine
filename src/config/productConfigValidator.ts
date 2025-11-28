/**
 * ProductConfig バリデーター
 *
 * 設定値の範囲や必須項目を集中管理し、異常値を早期検出する
 */

import {
  ProductConfig,
  LifecycleState,
  RevenueModel,
  BusinessMode,
  BrandType,
  ExperimentGroup,
  LtvMode,
  RiskLevel,
  InventoryGuardMode,
  OutOfStockBidPolicy,
  PRODUCT_CONFIG_BOUNDS,
  isValidLifecycleState,
  isValidRevenueModel,
  isValidBusinessMode,
  isValidBrandType,
  isValidExperimentGroup,
  isValidLtvMode,
  isValidRiskLevel,
  isValidInventoryGuardMode,
  isValidOutOfStockBidPolicy,
} from "./productConfigTypes";

// =============================================================================
// 型定義
// =============================================================================

/**
 * バリデーション結果の重要度
 */
export type ValidationSeverity = "warning" | "error";

/**
 * バリデーション問題
 */
export interface ValidationIssue {
  /** 問題のあったフィールド名 */
  field: string;
  /** 問題の説明 */
  message: string;
  /** 重要度（warning: 警告のみ、error: 処理停止） */
  severity: ValidationSeverity;
  /** 実際の値（デバッグ用） */
  actualValue?: unknown;
}

/**
 * 単一設定のバリデーション結果
 */
export interface ValidationResult {
  /** バリデーション成功（errorがない）かどうか */
  ok: boolean;
  /** 検出された問題リスト */
  issues: ValidationIssue[];
}

/**
 * 複数設定のバリデーション結果
 */
export interface BulkValidationResult {
  /** エラーが一つでもあるか */
  hasError: boolean;
  /** 警告が一つでもあるか */
  hasWarning: boolean;
  /** ASIN別の問題リスト */
  issuesByAsin: Record<string, ValidationIssue[]>;
  /** 全問題の合計数 */
  totalIssueCount: number;
  /** エラー数 */
  errorCount: number;
  /** 警告数 */
  warningCount: number;
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 問題を作成
 */
function createIssue(
  field: string,
  message: string,
  severity: ValidationSeverity,
  actualValue?: unknown
): ValidationIssue {
  return { field, message, severity, actualValue };
}

/**
 * 文字列が空でないかをチェック
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 数値が範囲内かをチェック
 */
function isInRange(
  value: number,
  min: number,
  max: number,
  exclusive: { minExclusive?: boolean; maxExclusive?: boolean } = {}
): boolean {
  const minCheck = exclusive.minExclusive ? value > min : value >= min;
  const maxCheck = exclusive.maxExclusive ? value < max : value <= max;
  return minCheck && maxCheck;
}

// =============================================================================
// 個別フィールドバリデーション
// =============================================================================

/**
 * 識別子のバリデーション
 */
function validateIdentifiers(
  config: ProductConfig,
  issues: ValidationIssue[]
): void {
  // profileId: オプションだが、設定されている場合は空文字禁止
  // （BigQueryのproduct_configテーブルには含まれないため、実行時に設定される）
  if (config.profileId !== undefined && !isNonEmptyString(config.profileId)) {
    issues.push(
      createIssue(
        "profileId",
        "profileIdが設定されている場合は空文字列は禁止です",
        "error",
        config.profileId
      )
    );
  }

  // asin: 必須、空文字禁止
  if (!isNonEmptyString(config.asin)) {
    issues.push(
      createIssue(
        "asin",
        "asinは必須です（空文字列は禁止）",
        "error",
        config.asin
      )
    );
  }
}

/**
 * 列挙型フィールドのバリデーション
 */
function validateEnumFields(
  config: ProductConfig,
  issues: ValidationIssue[]
): void {
  // lifecycleState
  if (!isValidLifecycleState(config.lifecycleState)) {
    issues.push(
      createIssue(
        "lifecycleState",
        `lifecycleStateが不正です。有効な値: LAUNCH_HARD, LAUNCH_SOFT, GROW, HARVEST`,
        "error",
        config.lifecycleState
      )
    );
  }

  // revenueModel
  if (!isValidRevenueModel(config.revenueModel)) {
    issues.push(
      createIssue(
        "revenueModel",
        `revenueModelが不正です。有効な値: LTV, SINGLE_PURCHASE`,
        "error",
        config.revenueModel
      )
    );
  }

  // businessMode
  if (!isValidBusinessMode(config.businessMode)) {
    issues.push(
      createIssue(
        "businessMode",
        `businessModeが不正です。有効な値: PROFIT, SHARE`,
        "error",
        config.businessMode
      )
    );
  }

  // brandType
  if (!isValidBrandType(config.brandType)) {
    issues.push(
      createIssue(
        "brandType",
        `brandTypeが不正です。有効な値: BRAND, GENERIC, CONQUEST`,
        "error",
        config.brandType
      )
    );
  }

  // experimentGroup
  if (!isValidExperimentGroup(config.experimentGroup)) {
    issues.push(
      createIssue(
        "experimentGroup",
        `experimentGroupが不正です。有効な値: CONTROL, VARIANT_A, VARIANT_B`,
        "error",
        config.experimentGroup
      )
    );
  }

  // ltvMode
  if (!isValidLtvMode(config.ltvMode)) {
    issues.push(
      createIssue(
        "ltvMode",
        `ltvModeが不正です。有効な値: ASSUMED, EARLY_ESTIMATE, MEASURED`,
        "error",
        config.ltvMode
      )
    );
  }

  // riskLevel（オプション）
  if (config.riskLevel != null && !isValidRiskLevel(config.riskLevel)) {
    issues.push(
      createIssue(
        "riskLevel",
        `riskLevelが不正です。有効な値: AGGRESSIVE, BALANCED, CONSERVATIVE`,
        "error",
        config.riskLevel
      )
    );
  }

  // inventoryGuardMode（オプション）
  if (
    config.inventoryGuardMode != null &&
    !isValidInventoryGuardMode(config.inventoryGuardMode)
  ) {
    issues.push(
      createIssue(
        "inventoryGuardMode",
        `inventoryGuardModeが不正です。有効な値: OFF, NORMAL, STRICT`,
        "error",
        config.inventoryGuardMode
      )
    );
  }

  // outOfStockBidPolicy（オプション）
  if (
    config.outOfStockBidPolicy != null &&
    !isValidOutOfStockBidPolicy(config.outOfStockBidPolicy)
  ) {
    issues.push(
      createIssue(
        "outOfStockBidPolicy",
        `outOfStockBidPolicyが不正です。有効な値: SET_ZERO, SKIP_RECOMMENDATION`,
        "error",
        config.outOfStockBidPolicy
      )
    );
  }
}

/**
 * 数値フィールドのバリデーション
 */
function validateNumericFields(
  config: ProductConfig,
  issues: ValidationIssue[]
): void {
  const bounds = PRODUCT_CONFIG_BOUNDS;

  // marginRate
  if (typeof config.marginRate !== "number" || isNaN(config.marginRate)) {
    issues.push(
      createIssue(
        "marginRate",
        "marginRateは数値である必要があります",
        "error",
        config.marginRate
      )
    );
  } else {
    if (!isInRange(config.marginRate, bounds.marginRate.min, bounds.marginRate.max)) {
      issues.push(
        createIssue(
          "marginRate",
          `marginRateは${bounds.marginRate.min}以上${bounds.marginRate.max}以下である必要があります`,
          "error",
          config.marginRate
        )
      );
    } else if (config.marginRate < bounds.marginRate.warningMin) {
      issues.push(
        createIssue(
          "marginRate",
          `marginRateが${bounds.marginRate.warningMin * 100}%未満です。値を確認してください`,
          "warning",
          config.marginRate
        )
      );
    }
  }

  // targetAcos（オプション）
  if (config.targetAcos != null) {
    if (typeof config.targetAcos !== "number" || isNaN(config.targetAcos)) {
      issues.push(
        createIssue(
          "targetAcos",
          "targetAcosは数値である必要があります",
          "error",
          config.targetAcos
        )
      );
    } else {
      if (config.targetAcos <= bounds.targetAcos.min) {
        issues.push(
          createIssue(
            "targetAcos",
            `targetAcosは${bounds.targetAcos.min}より大きい必要があります`,
            "error",
            config.targetAcos
          )
        );
      } else if (config.targetAcos >= bounds.targetAcos.max) {
        issues.push(
          createIssue(
            "targetAcos",
            `targetAcosが${bounds.targetAcos.max * 100}%以上です。異常値の可能性があります`,
            "error",
            config.targetAcos
          )
        );
      } else if (config.targetAcos > bounds.targetAcos.warningMax) {
        issues.push(
          createIssue(
            "targetAcos",
            `targetAcosが${bounds.targetAcos.warningMax * 100}%を超えています。値を確認してください`,
            "warning",
            config.targetAcos
          )
        );
      }
    }
  }

  // expectedRepeatOrdersAssumed
  if (
    typeof config.expectedRepeatOrdersAssumed !== "number" ||
    isNaN(config.expectedRepeatOrdersAssumed)
  ) {
    issues.push(
      createIssue(
        "expectedRepeatOrdersAssumed",
        "expectedRepeatOrdersAssumedは数値である必要があります",
        "error",
        config.expectedRepeatOrdersAssumed
      )
    );
  } else {
    if (config.expectedRepeatOrdersAssumed < bounds.expectedRepeatOrdersAssumed.min) {
      issues.push(
        createIssue(
          "expectedRepeatOrdersAssumed",
          `expectedRepeatOrdersAssumedは${bounds.expectedRepeatOrdersAssumed.min}以上である必要があります`,
          "error",
          config.expectedRepeatOrdersAssumed
        )
      );
    } else if (
      config.expectedRepeatOrdersAssumed > bounds.expectedRepeatOrdersAssumed.warningMax
    ) {
      issues.push(
        createIssue(
          "expectedRepeatOrdersAssumed",
          `expectedRepeatOrdersAssumedが${bounds.expectedRepeatOrdersAssumed.warningMax}を超えています。値を確認してください`,
          "warning",
          config.expectedRepeatOrdersAssumed
        )
      );
    }
  }

  // safetyFactorAssumed
  if (
    typeof config.safetyFactorAssumed !== "number" ||
    isNaN(config.safetyFactorAssumed)
  ) {
    issues.push(
      createIssue(
        "safetyFactorAssumed",
        "safetyFactorAssumedは数値である必要があります",
        "error",
        config.safetyFactorAssumed
      )
    );
  } else {
    if (
      !isInRange(
        config.safetyFactorAssumed,
        bounds.safetyFactor.min,
        bounds.safetyFactor.max,
        { minExclusive: true }
      )
    ) {
      issues.push(
        createIssue(
          "safetyFactorAssumed",
          `safetyFactorAssumedは${bounds.safetyFactor.min}より大きく${bounds.safetyFactor.max}以下である必要があります`,
          "error",
          config.safetyFactorAssumed
        )
      );
    }
  }

  // safetyFactorMeasured
  if (
    typeof config.safetyFactorMeasured !== "number" ||
    isNaN(config.safetyFactorMeasured)
  ) {
    issues.push(
      createIssue(
        "safetyFactorMeasured",
        "safetyFactorMeasuredは数値である必要があります",
        "error",
        config.safetyFactorMeasured
      )
    );
  } else {
    if (
      !isInRange(
        config.safetyFactorMeasured,
        bounds.safetyFactor.min,
        bounds.safetyFactor.max,
        { minExclusive: true }
      )
    ) {
      issues.push(
        createIssue(
          "safetyFactorMeasured",
          `safetyFactorMeasuredは${bounds.safetyFactor.min}より大きく${bounds.safetyFactor.max}以下である必要があります`,
          "error",
          config.safetyFactorMeasured
        )
      );
    }
  }

  // maxBidMultiplier（オプション）
  if (config.maxBidMultiplier != null) {
    if (
      typeof config.maxBidMultiplier !== "number" ||
      isNaN(config.maxBidMultiplier)
    ) {
      issues.push(
        createIssue(
          "maxBidMultiplier",
          "maxBidMultiplierは数値である必要があります",
          "error",
          config.maxBidMultiplier
        )
      );
    } else {
      if (
        !isInRange(
          config.maxBidMultiplier,
          bounds.maxBidMultiplier.min,
          bounds.maxBidMultiplier.max
        )
      ) {
        issues.push(
          createIssue(
            "maxBidMultiplier",
            `maxBidMultiplierは${bounds.maxBidMultiplier.min}以上${bounds.maxBidMultiplier.max}以下である必要があります`,
            "error",
            config.maxBidMultiplier
          )
        );
      } else if (config.maxBidMultiplier > bounds.maxBidMultiplier.warningMax) {
        issues.push(
          createIssue(
            "maxBidMultiplier",
            `maxBidMultiplierが${bounds.maxBidMultiplier.warningMax}を超えています。値を確認してください`,
            "warning",
            config.maxBidMultiplier
          )
        );
      }
    }
  }

  // minBidMultiplier（オプション）
  if (config.minBidMultiplier != null) {
    if (
      typeof config.minBidMultiplier !== "number" ||
      isNaN(config.minBidMultiplier)
    ) {
      issues.push(
        createIssue(
          "minBidMultiplier",
          "minBidMultiplierは数値である必要があります",
          "error",
          config.minBidMultiplier
        )
      );
    } else {
      if (
        !isInRange(
          config.minBidMultiplier,
          bounds.minBidMultiplier.min,
          bounds.minBidMultiplier.max,
          { minExclusive: true }
        )
      ) {
        issues.push(
          createIssue(
            "minBidMultiplier",
            `minBidMultiplierは${bounds.minBidMultiplier.min}より大きく${bounds.minBidMultiplier.max}以下である必要があります`,
            "error",
            config.minBidMultiplier
          )
        );
      } else if (config.minBidMultiplier < bounds.minBidMultiplier.warningMin) {
        issues.push(
          createIssue(
            "minBidMultiplier",
            `minBidMultiplierが${bounds.minBidMultiplier.warningMin}未満です。値を確認してください`,
            "warning",
            config.minBidMultiplier
          )
        );
      }
    }
  }

  // newCustomersTotal
  if (
    typeof config.newCustomersTotal !== "number" ||
    isNaN(config.newCustomersTotal)
  ) {
    issues.push(
      createIssue(
        "newCustomersTotal",
        "newCustomersTotalは数値である必要があります",
        "error",
        config.newCustomersTotal
      )
    );
  } else if (config.newCustomersTotal < bounds.newCustomersTotal.min) {
    issues.push(
      createIssue(
        "newCustomersTotal",
        `newCustomersTotalは${bounds.newCustomersTotal.min}以上である必要があります`,
        "error",
        config.newCustomersTotal
      )
    );
  }

  // minDaysOfInventoryForGrowth（オプション）
  if (config.minDaysOfInventoryForGrowth != null) {
    if (
      typeof config.minDaysOfInventoryForGrowth !== "number" ||
      isNaN(config.minDaysOfInventoryForGrowth)
    ) {
      issues.push(
        createIssue(
          "minDaysOfInventoryForGrowth",
          "minDaysOfInventoryForGrowthは数値である必要があります",
          "error",
          config.minDaysOfInventoryForGrowth
        )
      );
    } else {
      if (
        !isInRange(
          config.minDaysOfInventoryForGrowth,
          bounds.minDaysOfInventoryForGrowth.min,
          bounds.minDaysOfInventoryForGrowth.max
        )
      ) {
        issues.push(
          createIssue(
            "minDaysOfInventoryForGrowth",
            `minDaysOfInventoryForGrowthは${bounds.minDaysOfInventoryForGrowth.min}以上${bounds.minDaysOfInventoryForGrowth.max}以下である必要があります`,
            "error",
            config.minDaysOfInventoryForGrowth
          )
        );
      } else if (
        config.minDaysOfInventoryForGrowth < bounds.minDaysOfInventoryForGrowth.warningMin
      ) {
        issues.push(
          createIssue(
            "minDaysOfInventoryForGrowth",
            `minDaysOfInventoryForGrowthが${bounds.minDaysOfInventoryForGrowth.warningMin}日未満です。値を確認してください`,
            "warning",
            config.minDaysOfInventoryForGrowth
          )
        );
      } else if (
        config.minDaysOfInventoryForGrowth > bounds.minDaysOfInventoryForGrowth.warningMax
      ) {
        issues.push(
          createIssue(
            "minDaysOfInventoryForGrowth",
            `minDaysOfInventoryForGrowthが${bounds.minDaysOfInventoryForGrowth.warningMax}日を超えています。値を確認してください`,
            "warning",
            config.minDaysOfInventoryForGrowth
          )
        );
      }
    }
  }

  // minDaysOfInventoryForNormal（オプション）
  if (config.minDaysOfInventoryForNormal != null) {
    if (
      typeof config.minDaysOfInventoryForNormal !== "number" ||
      isNaN(config.minDaysOfInventoryForNormal)
    ) {
      issues.push(
        createIssue(
          "minDaysOfInventoryForNormal",
          "minDaysOfInventoryForNormalは数値である必要があります",
          "error",
          config.minDaysOfInventoryForNormal
        )
      );
    } else {
      if (
        !isInRange(
          config.minDaysOfInventoryForNormal,
          bounds.minDaysOfInventoryForNormal.min,
          bounds.minDaysOfInventoryForNormal.max
        )
      ) {
        issues.push(
          createIssue(
            "minDaysOfInventoryForNormal",
            `minDaysOfInventoryForNormalは${bounds.minDaysOfInventoryForNormal.min}以上${bounds.minDaysOfInventoryForNormal.max}以下である必要があります`,
            "error",
            config.minDaysOfInventoryForNormal
          )
        );
      } else if (
        config.minDaysOfInventoryForNormal < bounds.minDaysOfInventoryForNormal.warningMin
      ) {
        issues.push(
          createIssue(
            "minDaysOfInventoryForNormal",
            `minDaysOfInventoryForNormalが${bounds.minDaysOfInventoryForNormal.warningMin}日未満です。値を確認してください`,
            "warning",
            config.minDaysOfInventoryForNormal
          )
        );
      } else if (
        config.minDaysOfInventoryForNormal > bounds.minDaysOfInventoryForNormal.warningMax
      ) {
        issues.push(
          createIssue(
            "minDaysOfInventoryForNormal",
            `minDaysOfInventoryForNormalが${bounds.minDaysOfInventoryForNormal.warningMax}日を超えています。値を確認してください`,
            "warning",
            config.minDaysOfInventoryForNormal
          )
        );
      }
    }
  }
}

/**
 * 論理的整合性のバリデーション
 */
function validateLogicalConsistency(
  config: ProductConfig,
  issues: ValidationIssue[]
): void {
  // maxBidMultiplier と minBidMultiplier の整合性
  if (config.maxBidMultiplier != null && config.minBidMultiplier != null) {
    if (config.maxBidMultiplier < config.minBidMultiplier) {
      issues.push(
        createIssue(
          "maxBidMultiplier",
          `maxBidMultiplier(${config.maxBidMultiplier})がminBidMultiplier(${config.minBidMultiplier})より小さいです`,
          "error"
        )
      );
    }
  }

  // LTVモードとrevenueModelの整合性
  if (config.revenueModel === "SINGLE_PURCHASE" && config.ltvMode !== "ASSUMED") {
    issues.push(
      createIssue(
        "ltvMode",
        `revenueModelがSINGLE_PURCHASEの場合、ltvModeはASSUMEDである必要があります`,
        "warning",
        config.ltvMode
      )
    );
  }

  // HARVESTステージでのリスクレベル
  if (
    config.lifecycleState === "HARVEST" &&
    config.riskLevel === "AGGRESSIVE"
  ) {
    issues.push(
      createIssue(
        "riskLevel",
        `HARVESTステージでAGGRESSIVEリスクレベルは推奨されません`,
        "warning"
      )
    );
  }

  // 在庫閾値の整合性（ForGrowth <= ForNormal）
  if (
    config.minDaysOfInventoryForGrowth != null &&
    config.minDaysOfInventoryForNormal != null
  ) {
    if (config.minDaysOfInventoryForGrowth > config.minDaysOfInventoryForNormal) {
      issues.push(
        createIssue(
          "minDaysOfInventoryForGrowth",
          `minDaysOfInventoryForGrowth(${config.minDaysOfInventoryForGrowth})がminDaysOfInventoryForNormal(${config.minDaysOfInventoryForNormal})より大きいです。ForGrowth <= ForNormal である必要があります`,
          "error"
        )
      );
    }
  }

  // STRICTモードでの閾値必須チェック
  if (config.inventoryGuardMode === "STRICT") {
    if (
      config.minDaysOfInventoryForGrowth == null &&
      config.minDaysOfInventoryForNormal == null
    ) {
      issues.push(
        createIssue(
          "inventoryGuardMode",
          `inventoryGuardModeがSTRICTの場合、minDaysOfInventoryForGrowthまたはminDaysOfInventoryForNormalの少なくとも一方を設定してください`,
          "warning"
        )
      );
    }
  }
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * 単一のProductConfigをバリデーション
 *
 * @param config - バリデーション対象の設定
 * @returns バリデーション結果
 */
export function validateProductConfig(config: ProductConfig): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 各種バリデーションを実行
  validateIdentifiers(config, issues);
  validateEnumFields(config, issues);
  validateNumericFields(config, issues);
  validateLogicalConsistency(config, issues);
  validateInventoryGuardFields(config, issues);

  // errorがなければok
  const ok = !issues.some((issue) => issue.severity === "error");

  return { ok, issues };
}

/**
 * 在庫ガード関連フィールドのバリデーション
 */
function validateInventoryGuardFields(
  config: ProductConfig,
  issues: ValidationIssue[]
): void {
  // inventoryGuardMode と outOfStockBidPolicy は validateEnumFields で処理済み
  // minDaysOfInventoryForGrowth と minDaysOfInventoryForNormal は validateNumericFields で処理済み
  // 整合性チェックは validateLogicalConsistency で処理済み

  // 追加のビジネスロジック警告

  // LAUNCH系ライフサイクルで在庫ガードがOFFの場合に警告
  if (
    (config.lifecycleState === "LAUNCH_HARD" || config.lifecycleState === "LAUNCH_SOFT") &&
    config.inventoryGuardMode === "OFF"
  ) {
    issues.push(
      createIssue(
        "inventoryGuardMode",
        `LAUNCH系ライフサイクルで在庫ガードをOFFにすると、在庫切れ時に無駄な広告費が発生する可能性があります`,
        "warning"
      )
    );
  }
}

/**
 * 複数のProductConfigをバリデーション
 *
 * @param configs - バリデーション対象の設定配列
 * @returns バリデーション結果
 */
export function validateAllProductConfigs(
  configs: ProductConfig[]
): BulkValidationResult {
  const issuesByAsin: Record<string, ValidationIssue[]> = {};
  let errorCount = 0;
  let warningCount = 0;

  for (const config of configs) {
    const result = validateProductConfig(config);
    if (result.issues.length > 0) {
      issuesByAsin[config.asin] = result.issues;
      for (const issue of result.issues) {
        if (issue.severity === "error") {
          errorCount++;
        } else {
          warningCount++;
        }
      }
    }
  }

  return {
    hasError: errorCount > 0,
    hasWarning: warningCount > 0,
    issuesByAsin,
    totalIssueCount: errorCount + warningCount,
    errorCount,
    warningCount,
  };
}

/**
 * バリデーション結果を人間が読みやすい形式でフォーマット
 */
export function formatValidationResult(result: ValidationResult): string {
  if (result.ok && result.issues.length === 0) {
    return "Validation passed";
  }

  const lines: string[] = [];
  for (const issue of result.issues) {
    const prefix = issue.severity === "error" ? "[ERROR]" : "[WARNING]";
    lines.push(`${prefix} ${issue.field}: ${issue.message}`);
    if (issue.actualValue !== undefined) {
      lines.push(`  Actual value: ${JSON.stringify(issue.actualValue)}`);
    }
  }

  return lines.join("\n");
}

/**
 * 一括バリデーション結果を人間が読みやすい形式でフォーマット
 */
export function formatBulkValidationResult(
  result: BulkValidationResult
): string {
  if (!result.hasError && !result.hasWarning) {
    return "All configurations passed validation";
  }

  const lines: string[] = [];
  lines.push(
    `Validation completed: ${result.errorCount} errors, ${result.warningCount} warnings`
  );

  for (const [asin, issues] of Object.entries(result.issuesByAsin)) {
    lines.push(`\nASIN: ${asin}`);
    for (const issue of issues) {
      const prefix = issue.severity === "error" ? "  [ERROR]" : "  [WARNING]";
      lines.push(`${prefix} ${issue.field}: ${issue.message}`);
    }
  }

  return lines.join("\n");
}

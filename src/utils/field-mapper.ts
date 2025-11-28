/**
 * 型安全なフィールドマッピングユーティリティ
 *
 * BigQueryやAmazon APIの応答を内部型に安全に変換する
 * snake_case ↔ camelCase の変換も統一的に処理
 */

import { z, ZodSchema, ZodError } from "zod";
import { ValidationError, ValidationErrorDetail } from "../errors";

// =============================================================================
// 型定義
// =============================================================================

/**
 * フィールドマッピング定義
 */
export interface FieldMapping<T> {
  /** 入力側のフィールド名（優先順） */
  from: string[];
  /** デフォルト値 */
  default?: T;
  /** 変換関数 */
  transform?: (value: unknown) => T;
  /** 必須フィールドか */
  required?: boolean;
}

/**
 * オブジェクトマッピングスキーマ
 */
export type MappingSchema<T> = {
  [K in keyof T]: FieldMapping<T[K]>;
};

// =============================================================================
// フィールド値取得
// =============================================================================

/**
 * 複数の候補フィールド名から値を取得
 */
export function getFieldValue<T>(
  record: Record<string, unknown>,
  fieldNames: string[],
  defaultValue?: T
): T | undefined {
  for (const name of fieldNames) {
    const value = record[name];
    if (value !== undefined && value !== null) {
      return value as T;
    }
  }
  return defaultValue;
}

/**
 * 文字列として値を取得
 */
export function getString(
  record: Record<string, unknown>,
  fieldNames: string[],
  defaultValue: string = ""
): string {
  const value = getFieldValue(record, fieldNames);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return String(value);
}

/**
 * 数値として値を取得
 */
export function getNumber(
  record: Record<string, unknown>,
  fieldNames: string[],
  defaultValue: number = 0
): number {
  const value = getFieldValue(record, fieldNames);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * 整数として値を取得
 */
export function getInteger(
  record: Record<string, unknown>,
  fieldNames: string[],
  defaultValue: number = 0
): number {
  return Math.round(getNumber(record, fieldNames, defaultValue));
}

/**
 * 真偽値として値を取得
 */
export function getBoolean(
  record: Record<string, unknown>,
  fieldNames: string[],
  defaultValue: boolean = false
): boolean {
  const value = getFieldValue(record, fieldNames);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return Boolean(value);
}

/**
 * 日付として値を取得
 */
export function getDate(
  record: Record<string, unknown>,
  fieldNames: string[],
  defaultValue?: Date
): Date | undefined {
  const value = getFieldValue(record, fieldNames);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(String(value));
  return isNaN(date.getTime()) ? defaultValue : date;
}

/**
 * 配列として値を取得
 */
export function getArray<T>(
  record: Record<string, unknown>,
  fieldNames: string[],
  defaultValue: T[] = []
): T[] {
  const value = getFieldValue(record, fieldNames);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (Array.isArray(value)) {
    return value as T[];
  }
  return defaultValue;
}

// =============================================================================
// オブジェクトマッパー
// =============================================================================

/**
 * 型安全なオブジェクトマッパー
 */
export class ObjectMapper<T extends Record<string, unknown>> {
  private schema: MappingSchema<T>;

  constructor(schema: MappingSchema<T>) {
    this.schema = schema;
  }

  /**
   * 単一レコードをマップ
   */
  map(record: Record<string, unknown>): T {
    const result: Partial<T> = {};
    const errors: ValidationErrorDetail[] = [];

    for (const [key, mapping] of Object.entries(this.schema) as [keyof T, FieldMapping<unknown>][]) {
      const value = getFieldValue(record, mapping.from);

      if (value === undefined || value === null) {
        if (mapping.required) {
          errors.push({
            field: String(key),
            message: `Required field missing: ${mapping.from.join(" or ")}`,
          });
          continue;
        }
        result[key] = mapping.default as T[typeof key];
        continue;
      }

      try {
        result[key] = (mapping.transform ? mapping.transform(value) : value) as T[typeof key];
      } catch (error) {
        errors.push({
          field: String(key),
          message: `Transform failed: ${error instanceof Error ? error.message : String(error)}`,
          received: value,
        });
      }
    }

    if (errors.length > 0) {
      throw new ValidationError(errors, "Object mapping failed");
    }

    return result as T;
  }

  /**
   * 複数レコードをマップ
   */
  mapMany(records: Record<string, unknown>[]): T[] {
    return records.map((record, index) => {
      try {
        return this.map(record);
      } catch (error) {
        if (error instanceof ValidationError) {
          // インデックス情報を追加
          const errorsWithIndex = error.errors.map((e) => ({
            ...e,
            field: `[${index}].${e.field}`,
          }));
          throw new ValidationError(errorsWithIndex, `Mapping failed at index ${index}`);
        }
        throw error;
      }
    });
  }
}

// =============================================================================
// Zod統合
// =============================================================================

/**
 * Zodスキーマで検証付きマッピング
 */
export function mapWithSchema<T>(
  record: Record<string, unknown>,
  zodSchema: ZodSchema<T>,
  fieldMapping?: Record<string, string[]>
): T {
  // フィールドマッピングがある場合は先に適用
  let mappedRecord = record;
  if (fieldMapping) {
    mappedRecord = {};
    for (const [targetField, sourceFields] of Object.entries(fieldMapping)) {
      mappedRecord[targetField] = getFieldValue(record, sourceFields);
    }
  }

  // Zodで検証
  const result = zodSchema.safeParse(mappedRecord);
  if (!result.success) {
    throw ValidationError.fromZodError(result.error);
  }

  return result.data;
}

/**
 * 配列をZodスキーマで検証付きマッピング
 */
export function mapManyWithSchema<T>(
  records: Record<string, unknown>[],
  zodSchema: ZodSchema<T>,
  fieldMapping?: Record<string, string[]>
): T[] {
  const results: T[] = [];
  const errors: ValidationErrorDetail[] = [];

  for (let i = 0; i < records.length; i++) {
    try {
      results.push(mapWithSchema(records[i], zodSchema, fieldMapping));
    } catch (error) {
      if (error instanceof ValidationError) {
        for (const e of error.errors) {
          errors.push({
            ...e,
            field: `[${i}].${e.field}`,
          });
        }
      } else {
        errors.push({
          field: `[${i}]`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors, `${errors.length} validation errors in array`);
  }

  return results;
}

// =============================================================================
// ケース変換ユーティリティ
// =============================================================================

/**
 * snake_case から camelCase に変換
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * camelCase から snake_case に変換
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * オブジェクトのキーをsnake_caseからcamelCaseに変換
 */
export function convertKeysToCamel<T extends Record<string, unknown>>(
  obj: Record<string, unknown>
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[camelKey] = convertKeysToCamel(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map((item) =>
        item !== null && typeof item === "object"
          ? convertKeysToCamel(item as Record<string, unknown>)
          : item
      );
    } else {
      result[camelKey] = value;
    }
  }
  return result as T;
}

/**
 * オブジェクトのキーをcamelCaseからsnake_caseに変換
 */
export function convertKeysToSnake<T extends Record<string, unknown>>(
  obj: Record<string, unknown>
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[snakeKey] = convertKeysToSnake(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map((item) =>
        item !== null && typeof item === "object"
          ? convertKeysToSnake(item as Record<string, unknown>)
          : item
      );
    } else {
      result[snakeKey] = value;
    }
  }
  return result as T;
}

// =============================================================================
// よく使うフィールドマッピング
// =============================================================================

/**
 * snake_case と camelCase の両方に対応するフィールド名を生成
 */
export function bothCases(snakeCase: string): string[] {
  return [snakeCase, snakeToCamel(snakeCase)];
}

/**
 * 一般的なID系フィールドのマッピング
 */
export const commonFieldMappings = {
  keywordId: bothCases("keyword_id"),
  campaignId: bothCases("campaign_id"),
  adGroupId: bothCases("ad_group_id"),
  profileId: bothCases("profile_id"),
  asin: ["asin", "ASIN"],
  suggestionId: bothCases("suggestion_id"),
  executionId: bothCases("execution_id"),
} as const;

// =============================================================================
// 範囲検証ユーティリティ
// =============================================================================

/**
 * 数値が範囲内にあるか検証
 */
export function assertInRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): void {
  if (value < min || value > max) {
    throw new ValidationError([
      {
        field: fieldName,
        message: `Value must be between ${min} and ${max}`,
        received: value,
      },
    ]);
  }
}

/**
 * 値が正の数か検証
 */
export function assertPositive(value: number, fieldName: string): void {
  if (value < 0) {
    throw new ValidationError([
      {
        field: fieldName,
        message: "Value must be positive",
        received: value,
      },
    ]);
  }
}

/**
 * 値が許可リストにあるか検証
 */
export function assertOneOf<T>(value: T, allowed: T[], fieldName: string): void {
  if (!allowed.includes(value)) {
    throw new ValidationError([
      {
        field: fieldName,
        message: `Value must be one of: ${allowed.join(", ")}`,
        received: value,
      },
    ]);
  }
}

/**
 * BigQuery用 AdminJS Resource アダプタ
 *
 * AdminJS の BaseResource を継承し、BigQuery テーブル/ビューをリソースとして扱えるようにする。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseResource, BaseRecord, ParamsType, Filter, ValidationError, BaseProperty } from "adminjs";
import { executeQuery, executeDml, getFullTableName, getProjectId, getDatasetId } from "../../bigquery/client";
import { logger } from "../../logger";

// =============================================================================
// 型定義
// =============================================================================

export interface BigQueryResourceOptions {
  /** テーブル名 */
  tableName: string;
  /** データセット名（省略時はデフォルトデータセット） */
  datasetName?: string;
  /** 主キーとして扱うフィールド */
  idField: string;
  /** 編集可能なフィールド（省略時は編集不可） */
  editableFields?: string[];
  /** プロパティ定義（列名とその型） */
  properties: BigQueryPropertyDefinition[];
  /** バリデーション関数（編集時に呼び出される） */
  validate?: (params: Record<string, unknown>) => { valid: boolean; errors: Record<string, { message: string }> };
}

export interface BigQueryPropertyDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "datetime" | "date" | "float" | "mixed" | "reference" | "key-value" | "textarea" | "richtext" | "password" | "currency" | "phone" | "uuid";
  isId?: boolean;
  isTitle?: boolean;
}

// =============================================================================
// BigQueryResource クラス
// =============================================================================

/**
 * BigQuery Resource Adapter for AdminJS
 */
export class BigQueryResource extends BaseResource {
  private _tableName: string;
  private _datasetName: string;
  private _idField: string;
  private _editableFields: string[];
  private _propertyDefs: BigQueryPropertyDefinition[];
  private _propertiesArray: BaseProperty[] | null = null;
  private _propertiesMap: Record<string, BaseProperty> = {};
  private _validateFn?: (params: Record<string, unknown>) => { valid: boolean; errors: Record<string, { message: string }> };

  // AdminJS アダプタ判定用のマーカー
  static readonly _isBigQueryResource = true;

  constructor(options: BigQueryResourceOptions) {
    // BaseResource に余計なプロパティを渡さないように空オブジェクトで初期化
    super({});
    this._tableName = options.tableName;
    this._datasetName = options.datasetName || getDatasetId();
    this._idField = options.idField;
    this._editableFields = options.editableFields || [];
    this._validateFn = options.validate;

    // properties を安全に配列として初期化
    // options.properties が配列でない場合（undefined, null, オブジェクト等）は空配列にフォールバック
    if (Array.isArray(options.properties)) {
      this._propertyDefs = options.properties;
    } else if (options.properties && typeof options.properties === "object") {
      // オブジェクトの場合は Object.values で配列化を試みる
      this._propertyDefs = Object.values(options.properties) as BigQueryPropertyDefinition[];
    } else {
      this._propertyDefs = [];
    }

    // プロパティ配列とマップを構築
    this._buildProperties();
  }

  /**
   * プロパティ配列とマップを構築
   */
  private _buildProperties(): void {
    // _propertyDefs が配列であることを再確認（防御的プログラミング）
    const defs = Array.isArray(this._propertyDefs) ? this._propertyDefs : [];

    this._propertiesArray = defs.map((def) => {
      return new BaseProperty({
        path: def.name,
        type: def.type as any,
        isId: def.isId || false,
        isSortable: true,
      });
    });

    this._propertiesMap = {};
    for (const prop of this._propertiesArray) {
      this._propertiesMap[prop.path()] = prop;
    }
  }

  /**
   * このアダプタが対象のリソースをサポートするかどうかを判定
   *
   * 注意: BigQueryResource インスタンスが渡された場合は false を返す。
   * これは AdminJS の resources-factory が `new BigQueryResource(resourceObject)` を呼び出すのを防ぐため。
   * BigQueryResource は BaseResource を継承しているため、アダプタ登録なしで直接使用できる。
   */
  static isAdapterFor(rawResource: unknown): boolean {
    // 既存の BigQueryResource インスタンスは再ラップしない
    if (rawResource instanceof BigQueryResource) {
      return false;
    }
    // _isBigQueryResource マーカーがある場合もインスタンスなので再ラップしない
    if (rawResource && typeof rawResource === "object" && "_isBigQueryResource" in (rawResource as any)) {
      return false;
    }
    // BigQueryResourceOptions として渡された場合のみアダプタを使用
    // （将来的に Database 経由でリソースを取得する場合など）
    if (rawResource && typeof rawResource === "object" && "tableName" in rawResource && "idField" in rawResource) {
      return true;
    }
    return false;
  }

  /**
   * データベース名を返す
   */
  databaseName(): string {
    return `${getProjectId()}.${this._datasetName}`;
  }

  /**
   * データベースタイプを返す
   */
  databaseType(): string {
    return "bigquery";
  }

  /**
   * リソースID（テーブル名）を返す
   */
  id(): string {
    return this._tableName;
  }

  /**
   * プロパティ一覧を返す
   */
  properties(): BaseProperty[] {
    return this._propertiesArray || [];
  }

  /**
   * 指定されたパスのプロパティを返す
   */
  property(path: string): BaseProperty | null {
    return this._propertiesMap[path] || null;
  }

  /**
   * レコード件数を取得
   */
  async count(filter: Filter): Promise<number> {
    const fullTableName = getFullTableName(this._tableName, this._datasetName);

    const { whereClause, params } = this._buildWhereClause(filter);

    const query = `
      SELECT COUNT(*) as total
      FROM \`${fullTableName}\`
      ${whereClause}
    `;

    try {
      const result = await executeQuery<{ total: number }>(query, params);
      return result[0]?.total || 0;
    } catch (error) {
      logger.error("BigQueryResource.count failed", {
        tableName: this._tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * レコード一覧を取得
   */
  async find(filter: Filter, options: { limit?: number; offset?: number; sort?: { sortBy?: string; direction?: "asc" | "desc" } } = {}): Promise<BaseRecord[]> {
    const fullTableName = getFullTableName(this._tableName, this._datasetName);

    const { whereClause, params } = this._buildWhereClause(filter);

    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const sortBy = options.sort?.sortBy || this._getDefaultSortColumn();
    const direction = options.sort?.direction || "desc";

    // SELECT 句を構築（日付型は STRING にキャスト）
    const defs = this._getPropertyDefsArray();
    const selectColumns = defs
      .map((prop) => {
        if (prop.type === "datetime" || prop.type === "date") {
          return `CAST(${prop.name} AS STRING) as ${prop.name}`;
        }
        return prop.name;
      })
      .join(", ");

    const query = `
      SELECT ${selectColumns}
      FROM \`${fullTableName}\`
      ${whereClause}
      ORDER BY ${sortBy} ${direction.toUpperCase()}
      LIMIT @limit
      OFFSET @offset
    `;

    try {
      const rows = await executeQuery<Record<string, unknown>>(query, { ...params, limit, offset });
      return rows.map((row) => this._buildRecord(row));
    } catch (error) {
      logger.error("BigQueryResource.find failed", {
        tableName: this._tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 1件のレコードを取得
   */
  async findOne(id: string | number): Promise<BaseRecord | null> {
    const fullTableName = getFullTableName(this._tableName, this._datasetName);

    // SELECT 句を構築
    const defs = this._getPropertyDefsArray();
    const selectColumns = defs
      .map((prop) => {
        if (prop.type === "datetime" || prop.type === "date") {
          return `CAST(${prop.name} AS STRING) as ${prop.name}`;
        }
        return prop.name;
      })
      .join(", ");

    const query = `
      SELECT ${selectColumns}
      FROM \`${fullTableName}\`
      WHERE ${this._idField} = @id
      LIMIT 1
    `;

    try {
      const rows = await executeQuery<Record<string, unknown>>(query, { id: String(id) });
      if (rows.length === 0) {
        return null;
      }
      return this._buildRecord(rows[0]);
    } catch (error) {
      logger.error("BigQueryResource.findOne failed", {
        tableName: this._tableName,
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * 複数IDでレコードを取得
   */
  async findMany(ids: (string | number)[]): Promise<BaseRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const records = await Promise.all(ids.map((id) => this.findOne(id)));
    return records.filter((r): r is BaseRecord => r !== null);
  }

  /**
   * レコードを更新
   */
  async update(id: string | number, params: Record<string, unknown>): Promise<ParamsType> {
    if (this._editableFields.length === 0) {
      throw new ValidationError({
        [this._idField]: {
          message: "このリソースは編集できません",
        },
      });
    }

    // バリデーション実行
    if (this._validateFn) {
      const validation = this._validateFn(params);
      if (!validation.valid) {
        throw new ValidationError(validation.errors);
      }
    }

    const fullTableName = getFullTableName(this._tableName, this._datasetName);

    // 編集可能フィールドのみを更新
    const setClauses: string[] = [];
    const updateParams: Record<string, unknown> = { id: String(id) };

    for (const field of this._editableFields) {
      if (field in params && params[field] !== undefined) {
        setClauses.push(`${field} = @${field}`);
        updateParams[field] = params[field];
      }
    }

    if (setClauses.length === 0) {
      // 更新するフィールドがない場合は現在のレコードを返す
      const record = await this.findOne(id);
      const recordParams = record?.params as unknown as Record<string, unknown>;
      return (recordParams as ParamsType) || ({} as ParamsType);
    }

    // updated_at カラムがあれば更新
    const defs = this._getPropertyDefsArray();
    const hasUpdatedAt = defs.some((p) => p.name === "updated_at");
    if (hasUpdatedAt) {
      setClauses.push("updated_at = CURRENT_DATETIME()");
    }

    const query = `
      UPDATE \`${fullTableName}\`
      SET ${setClauses.join(", ")}
      WHERE ${this._idField} = @id
    `;

    try {
      await executeDml(query, updateParams);

      logger.info("BigQueryResource.update succeeded", {
        tableName: this._tableName,
        id,
        updatedFields: Object.keys(updateParams).filter((k) => k !== "id"),
      });

      // 更新後のレコードを取得して返す
      const updatedRecord = await this.findOne(id);
      const updatedParams = updatedRecord?.params as unknown as Record<string, unknown>;
      return (updatedParams as ParamsType) || ({} as ParamsType);
    } catch (error) {
      logger.error("BigQueryResource.update failed", {
        tableName: this._tableName,
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ValidationError({
        [this._idField]: {
          message: `更新に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    }
  }

  /**
   * 新規作成（未サポート）
   */
  async create(_params: Record<string, unknown>): Promise<ParamsType> {
    throw new ValidationError({
      [this._idField]: {
        message: "新規作成はサポートされていません",
      },
    });
  }

  /**
   * 削除（未サポート）
   */
  async delete(_id: string | number): Promise<void> {
    throw new ValidationError({
      [this._idField]: {
        message: "削除はサポートされていません",
      },
    });
  }

  // =============================================================================
  // プライベートメソッド
  // =============================================================================

  /**
   * フィルタからWHERE句とパラメータを構築
   */
  private _buildWhereClause(filter: Filter): { whereClause: string; params: Record<string, unknown> } {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter && filter.filters) {
      Object.entries(filter.filters).forEach(([key, filterValue]) => {
        if (filterValue && filterValue.value !== undefined && filterValue.value !== "") {
          const value = filterValue.value;
          const paramName = `filter_${key}`;

          // 文字列の場合
          if (typeof value === "string") {
            const lowerValue = value.toLowerCase();
            if (lowerValue === "true") {
              conditions.push(`${key} = TRUE`);
            } else if (lowerValue === "false") {
              conditions.push(`${key} = FALSE`);
            } else {
              conditions.push(`${key} LIKE @${paramName}`);
              params[paramName] = `%${value}%`;
            }
          } else if (typeof value === "boolean") {
            conditions.push(`${key} = ${value ? "TRUE" : "FALSE"}`);
          } else {
            conditions.push(`${key} = @${paramName}`);
            params[paramName] = value;
          }
        }
      });
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return { whereClause, params };
  }

  /**
   * デフォルトのソートカラムを取得
   */
  private _getDefaultSortColumn(): string {
    // created_at, updated_at, calculated_at, started_at などがあればそれを使う
    const dateColumns = ["created_at", "updated_at", "calculated_at", "started_at"];
    const defs = this._getPropertyDefsArray();
    for (const col of dateColumns) {
      if (defs.some((p) => p.name === col)) {
        return col;
      }
    }
    // なければ idField を使う
    return this._idField;
  }

  /**
   * _propertyDefs を安全に配列として取得するヘルパー
   */
  private _getPropertyDefsArray(): BigQueryPropertyDefinition[] {
    return Array.isArray(this._propertyDefs) ? this._propertyDefs : [];
  }

  /**
   * BigQuery の行データから BaseRecord を構築
   */
  private _buildRecord(row: Record<string, unknown>): BaseRecord {
    return new BaseRecord(row as ParamsType, this);
  }
}

// =============================================================================
// バリデーションヘルパー
// =============================================================================

/**
 * product_config 用のバリデーション関数
 */
export function createProductConfigValidator(): (params: Record<string, unknown>) => { valid: boolean; errors: Record<string, { message: string }> } {
  const VALID_LIFECYCLE_STATES = ["LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"];
  const VALID_PROFILE_TYPES = ["STANDARD", "AGGRESSIVE", "CONSERVATIVE", "CUSTOM"];

  return (params: Record<string, unknown>) => {
    const errors: Record<string, { message: string }> = {};

    if (params.lifecycle_state !== undefined) {
      if (!VALID_LIFECYCLE_STATES.includes(String(params.lifecycle_state))) {
        errors.lifecycle_state = {
          message: `ライフサイクルは ${VALID_LIFECYCLE_STATES.join(", ")} のいずれかを指定してください`,
        };
      }
    }

    if (params.target_tacos !== undefined) {
      const value = Number(params.target_tacos);
      if (isNaN(value) || value < 0 || value > 1) {
        errors.target_tacos = {
          message: "目標TACOSは0から1の範囲で指定してください",
        };
      }
    }

    if (params.max_bid !== undefined) {
      const value = Number(params.max_bid);
      if (isNaN(value) || value < 0 || value > 5) {
        errors.max_bid = {
          message: "入札上限は0から5の範囲で指定してください",
        };
      }
    }

    if (params.profile_type !== undefined) {
      if (!VALID_PROFILE_TYPES.includes(String(params.profile_type))) {
        errors.profile_type = {
          message: `プロファイル種別は ${VALID_PROFILE_TYPES.join(", ")} のいずれかを指定してください`,
        };
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  };
}

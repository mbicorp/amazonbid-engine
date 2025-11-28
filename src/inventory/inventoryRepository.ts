/**
 * 在庫リポジトリ
 *
 * BigQueryから在庫情報を取得し、AsinInventorySnapshotを返す
 * 入札エンジンへの在庫情報の注入レイヤー
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  AsinInventorySnapshot,
  InventoryRiskStatus,
  INVENTORY_GUARD_DEFAULTS,
} from "./types";

// =============================================================================
// リポジトリインターフェース
// =============================================================================

/**
 * 在庫リポジトリインターフェース
 */
export interface InventoryRepository {
  /**
   * 単一ASINの在庫スナップショットを取得
   *
   * @param profileId - Amazon AdsプロファイルID
   * @param asin - ASIN
   * @returns 在庫スナップショット（見つからない場合はnull）
   */
  getInventorySnapshot(
    profileId: string,
    asin: string
  ): Promise<AsinInventorySnapshot | null>;

  /**
   * 複数ASINの在庫スナップショットを一括取得
   *
   * @param profileId - Amazon AdsプロファイルID
   * @param asins - ASINリスト
   * @returns ASINをキーとするMapで返す
   */
  getInventorySnapshots(
    profileId: string,
    asins: string[]
  ): Promise<Map<string, AsinInventorySnapshot>>;
}

// =============================================================================
// 在庫リスクステータス計算
// =============================================================================

/**
 * 在庫日数から在庫リスクステータスを計算
 *
 * @param daysOfInventory - 在庫日数（nullは不明）
 * @param minDaysForGrowth - 「攻め」モード禁止閾値
 * @param minDaysForNormal - 「通常」モード抑制閾値
 * @returns 在庫リスクステータス
 */
export function calculateInventoryRiskStatus(
  daysOfInventory: number | null,
  minDaysForGrowth: number = INVENTORY_GUARD_DEFAULTS.MIN_DAYS_FOR_GROWTH,
  minDaysForNormal: number = INVENTORY_GUARD_DEFAULTS.MIN_DAYS_FOR_NORMAL
): InventoryRiskStatus {
  // 在庫情報が不明な場合
  if (daysOfInventory === null) {
    return "UNKNOWN";
  }

  // 在庫ゼロまたは負の値
  if (daysOfInventory <= 0) {
    return "OUT_OF_STOCK";
  }

  // 在庫が非常に少ない（攻め禁止レベル）
  if (daysOfInventory < minDaysForGrowth) {
    return "LOW_STOCK_STRICT";
  }

  // 在庫が少ない（攻め抑制レベル）
  if (daysOfInventory < minDaysForNormal) {
    return "LOW_STOCK";
  }

  // 通常在庫
  return "NORMAL";
}

// =============================================================================
// BigQueryリポジトリ実装
// =============================================================================

/**
 * BigQuery接続設定
 */
export interface InventoryRepositoryConfig {
  projectId: string;
  dataset: string;
}

/**
 * BigQueryベースの在庫リポジトリ実装
 */
class BigQueryInventoryRepository implements InventoryRepository {
  private bigquery: BigQuery;
  private config: InventoryRepositoryConfig;

  constructor(config: InventoryRepositoryConfig) {
    this.bigquery = new BigQuery({ projectId: config.projectId });
    this.config = config;
  }

  /**
   * 単一ASINの在庫スナップショットを取得
   */
  async getInventorySnapshot(
    profileId: string,
    asin: string
  ): Promise<AsinInventorySnapshot | null> {
    const snapshots = await this.getInventorySnapshots(profileId, [asin]);
    return snapshots.get(asin) ?? null;
  }

  /**
   * 複数ASINの在庫スナップショットを一括取得
   *
   * BigQueryのproduct_strategyテーブルからdays_of_inventoryを取得
   */
  async getInventorySnapshots(
    profileId: string,
    asins: string[]
  ): Promise<Map<string, AsinInventorySnapshot>> {
    const result = new Map<string, AsinInventorySnapshot>();

    if (asins.length === 0) {
      return result;
    }

    // product_strategyテーブルから在庫日数を取得
    // ※BigQueryのテーブル構造に応じてクエリを調整
    const query = `
      SELECT
        asin,
        days_of_inventory,
        -- on_hand_units は product_strategy に存在する場合のみ
        -- COALESCE(on_hand_units, NULL) as on_hand_units,
        updated_at
      FROM \`${this.config.projectId}.${this.config.dataset}.product_strategy\`
      WHERE asin IN UNNEST(@asins)
    `;

    try {
      const [rows] = await this.bigquery.query({
        query,
        params: { asins },
        location: "asia-northeast1",
      });

      for (const row of rows) {
        const asin = row.asin as string;
        const daysOfInventory = row.days_of_inventory ?? null;

        const snapshot: AsinInventorySnapshot = {
          profileId,
          asin,
          daysOfInventory,
          onHandUnits: row.on_hand_units ?? null,
          status: calculateInventoryRiskStatus(daysOfInventory),
          lastUpdatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
        };

        result.set(asin, snapshot);
      }

      logger.debug("Fetched inventory snapshots", {
        profileId,
        requestedCount: asins.length,
        foundCount: result.size,
      });
    } catch (error) {
      logger.warn("Failed to fetch inventory snapshots from BigQuery", {
        profileId,
        asinCount: asins.length,
        error: error instanceof Error ? error.message : String(error),
      });
      // エラー時は空のMapを返す（在庫ガードは適用されない）
    }

    return result;
  }
}

// =============================================================================
// スタブリポジトリ実装（在庫ビュー未実装時用）
// =============================================================================

/**
 * スタブリポジトリ
 *
 * BigQueryに在庫ビューがまだ存在しない場合に使用
 * すべてのASINについてUNKNOWN（在庫ガード適用なし）を返す
 */
class StubInventoryRepository implements InventoryRepository {
  async getInventorySnapshot(
    profileId: string,
    asin: string
  ): Promise<AsinInventorySnapshot | null> {
    // スタブ実装: 在庫情報不明として返す
    // 在庫ビュー実装後にBigQueryInventoryRepositoryに差し替える
    return {
      profileId,
      asin,
      daysOfInventory: null,
      status: "UNKNOWN",
    };
  }

  async getInventorySnapshots(
    profileId: string,
    asins: string[]
  ): Promise<Map<string, AsinInventorySnapshot>> {
    const result = new Map<string, AsinInventorySnapshot>();

    for (const asin of asins) {
      result.set(asin, {
        profileId,
        asin,
        daysOfInventory: null,
        status: "UNKNOWN",
      });
    }

    logger.debug("Using stub inventory repository (all UNKNOWN)", {
      profileId,
      asinCount: asins.length,
    });

    return result;
  }
}

// =============================================================================
// ファクトリ関数
// =============================================================================

/**
 * 在庫リポジトリを作成
 *
 * @param config - BigQuery接続設定（指定時はBigQueryリポジトリ、未指定時はスタブ）
 * @returns 在庫リポジトリ
 */
export function createInventoryRepository(
  config?: InventoryRepositoryConfig
): InventoryRepository {
  if (config) {
    return new BigQueryInventoryRepository(config);
  }
  // 設定がない場合はスタブを返す
  // TODO: 在庫ビュー実装後、常にBigQueryInventoryRepositoryを使用するよう変更
  return new StubInventoryRepository();
}

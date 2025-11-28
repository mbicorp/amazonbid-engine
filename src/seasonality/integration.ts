/**
 * 季節性予測機能 - bidEngine 統合
 *
 * bidEngine の computeRecommendation 関数で使用される
 * 季節性に基づく入札調整ロジック
 */

import { logger } from "../logger";
import {
  SeasonalityPrediction,
  SeasonalityConfig,
  SeasonalityAdjustment,
  SeasonalityMode,
  DEFAULT_SEASONALITY_CONFIG,
} from "./types";
import { createSeasonalityConfigFromEnv } from "./config";
import { getSeasonalityRepository } from "./repository";
import { shouldAdjustBid } from "./predictor";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 入札調整に必要なコンテキスト情報
 */
export interface BidAdjustmentContext {
  /** キーワード */
  keyword: string;

  /** ASIN */
  asin?: string;

  /** 元の推奨入札額 */
  originalBid: number;

  /** 最大入札額（maxBid制限） */
  maxBid?: number;

  /** LTV上限入札額 */
  ltvMaxBid?: number;

  /** 在庫制限入札額 */
  inventoryMaxBid?: number;

  /** イベントオーバーライド（S-MODE）がアクティブか */
  isEventOverrideActive?: boolean;
}

// =============================================================================
// 入札調整の適用
// =============================================================================

/**
 * 季節性に基づいて入札額を調整
 *
 * @param context 入札調整コンテキスト
 * @param prediction 季節性予測（null の場合はリポジトリから取得）
 * @param config 設定（省略時は環境変数から）
 * @returns 調整結果
 */
export async function applySeasonalityAdjustment(
  context: BidAdjustmentContext,
  prediction?: SeasonalityPrediction | null,
  config?: SeasonalityConfig
): Promise<SeasonalityAdjustment> {
  // 設定を取得
  const effectiveConfig = config ?? createSeasonalityConfigFromEnv();

  // デフォルトの結果（調整なし）
  const noAdjustment: SeasonalityAdjustment = {
    multiplier: 1.0,
    applied: false,
    mode: effectiveConfig.mode,
    originalBid: context.originalBid,
    adjustedBid: context.originalBid,
    cappedByMaxBid: false,
    cappedByLtv: false,
    cappedByInventory: false,
    reason: "調整なし",
    prediction: null,
  };

  // 機能が無効の場合
  if (!effectiveConfig.enabled) {
    return {
      ...noAdjustment,
      reason: "季節性調整機能が無効",
    };
  }

  // イベントオーバーライド中の場合
  if (context.isEventOverrideActive && effectiveConfig.disableDuringEventOverride) {
    return {
      ...noAdjustment,
      reason: "S-MODE中は季節性調整を無効化",
    };
  }

  // 予測を取得（渡されていない場合はリポジトリから）
  let effectivePrediction = prediction;
  if (effectivePrediction === undefined) {
    const repository = getSeasonalityRepository();
    effectivePrediction = await repository.getPrediction(context.keyword);
  }

  // 予測がない場合
  if (!effectivePrediction) {
    return {
      ...noAdjustment,
      reason: "季節性予測データなし",
    };
  }

  // 調整が必要かチェック
  if (!shouldAdjustBid(effectivePrediction, effectiveConfig)) {
    return {
      ...noAdjustment,
      reason: effectivePrediction.adjustmentReason,
      prediction: effectivePrediction,
    };
  }

  // 調整後の入札額を計算
  const multiplier = effectivePrediction.currentMultiplier;
  let adjustedBid = context.originalBid * multiplier;

  // キャップ情報
  let cappedByMaxBid = false;
  let cappedByLtv = false;
  let cappedByInventory = false;

  // maxBid制限
  if (context.maxBid && adjustedBid > context.maxBid) {
    adjustedBid = context.maxBid;
    cappedByMaxBid = true;
  }

  // LTV制限
  if (context.ltvMaxBid && adjustedBid > context.ltvMaxBid) {
    adjustedBid = context.ltvMaxBid;
    cappedByLtv = true;
  }

  // 在庫制限
  if (context.inventoryMaxBid && adjustedBid > context.inventoryMaxBid) {
    adjustedBid = context.inventoryMaxBid;
    cappedByInventory = true;
  }

  // SHADOW モードの場合は実際に適用しない
  const applied = effectiveConfig.mode === "APPLY";

  // 理由文を構築
  const cappedReasons: string[] = [];
  if (cappedByMaxBid) cappedReasons.push("maxBid");
  if (cappedByLtv) cappedReasons.push("LTV");
  if (cappedByInventory) cappedReasons.push("在庫");

  let reason = effectivePrediction.adjustmentReason;
  if (cappedReasons.length > 0) {
    reason += ` [${cappedReasons.join(", ")}で制限]`;
  }
  if (!applied) {
    reason += " [SHADOWモード]";
  }

  const adjustment: SeasonalityAdjustment = {
    multiplier,
    applied,
    mode: effectiveConfig.mode,
    originalBid: context.originalBid,
    adjustedBid,
    cappedByMaxBid,
    cappedByLtv,
    cappedByInventory,
    reason,
    prediction: effectivePrediction,
  };

  // ログを記録
  logger.debug("Seasonality adjustment calculated", {
    keyword: context.keyword,
    mode: effectiveConfig.mode,
    originalBid: context.originalBid,
    adjustedBid,
    multiplier,
    applied,
    cappedByMaxBid,
    cappedByLtv,
    cappedByInventory,
  });

  return adjustment;
}

// =============================================================================
// バッチ処理用
// =============================================================================

/**
 * 複数キーワードの季節性調整を一括計算
 *
 * @param contexts 入札調整コンテキストの配列
 * @param config 設定（省略時は環境変数から）
 * @returns キーワードをキーとする調整結果のMap
 */
export async function applySeasonalityAdjustmentBatch(
  contexts: BidAdjustmentContext[],
  config?: SeasonalityConfig
): Promise<Map<string, SeasonalityAdjustment>> {
  const effectiveConfig = config ?? createSeasonalityConfigFromEnv();
  const result = new Map<string, SeasonalityAdjustment>();

  // 機能が無効の場合は全て調整なし
  if (!effectiveConfig.enabled) {
    for (const ctx of contexts) {
      result.set(ctx.keyword, {
        multiplier: 1.0,
        applied: false,
        mode: effectiveConfig.mode,
        originalBid: ctx.originalBid,
        adjustedBid: ctx.originalBid,
        cappedByMaxBid: false,
        cappedByLtv: false,
        cappedByInventory: false,
        reason: "季節性調整機能が無効",
        prediction: null,
      });
    }
    return result;
  }

  // キーワード一覧を抽出
  const keywords = contexts.map((ctx) => ctx.keyword);

  // 予測を一括取得
  const repository = getSeasonalityRepository();
  const predictions = await repository.getPredictions(keywords);

  // 各コンテキストに対して調整を計算
  for (const ctx of contexts) {
    const prediction = predictions.get(ctx.keyword) ?? null;
    const adjustment = await applySeasonalityAdjustment(ctx, prediction, effectiveConfig);
    result.set(ctx.keyword, adjustment);
  }

  return result;
}

// =============================================================================
// 調整ログの記録
// =============================================================================

/**
 * 調整結果をBigQueryに記録
 */
export async function logSeasonalityAdjustment(
  keyword: string,
  adjustment: SeasonalityAdjustment,
  asin?: string
): Promise<void> {
  try {
    const repository = getSeasonalityRepository();
    await repository.logAdjustment(keyword, adjustment, asin);
  } catch (error) {
    // ログの失敗は致命的ではない
    logger.error("Failed to log seasonality adjustment", {
      keyword,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 現在の設定を取得（デバッグ用）
 */
export function getCurrentSeasonalityConfig(): SeasonalityConfig {
  return createSeasonalityConfigFromEnv();
}

/**
 * 季節性調整が有効かどうかを確認
 */
export function isSeasonalityEnabled(): boolean {
  const config = createSeasonalityConfigFromEnv();
  return config.enabled;
}

/**
 * 現在のモードを取得
 */
export function getSeasonalityMode(): SeasonalityMode {
  const config = createSeasonalityConfigFromEnv();
  return config.mode;
}

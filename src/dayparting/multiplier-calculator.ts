/**
 * Dayparting (時間帯別入札最適化) - 入札乗数計算
 *
 * 分析結果に基づいて時間帯別の入札乗数を計算し、
 * 設定された制約の範囲内に収める機能
 */

import * as crypto from "crypto";
import { logger } from "../logger";
import {
  HourlyAnalysisResult,
  HourlyBidMultiplier,
  DaypartingConfig,
  HourOfDay,
  DayOfWeek,
  ConfidenceLevel,
  HourClassification,
  DAYPARTING_CONSTANTS,
} from "./types";
import {
  CONFIDENCE_MULTIPLIER_FACTORS,
  CLASSIFICATION_BASE_MULTIPLIERS,
} from "./config";

// =============================================================================
// 型定義
// =============================================================================

/**
 * 乗数計算オプション
 */
export interface MultiplierCalculationOptions {
  /** 最大乗数 */
  maxMultiplier?: number;
  /** 最小乗数 */
  minMultiplier?: number;
  /** 信頼度による調整を適用するか */
  applyConfidenceAdjustment?: boolean;
  /** スムージングを適用するか (隣接時間帯との平均) */
  applySmoothing?: boolean;
  /** スムージング重み (0-1, 中央の重み) */
  smoothingWeight?: number;
}

/**
 * 乗数計算結果
 */
export interface MultiplierCalculationResult {
  /** 計算された乗数 */
  multipliers: HourlyBidMultiplier[];
  /** 計算統計 */
  stats: {
    /** 計算された乗数の数 */
    totalCount: number;
    /** 1.0より大きい乗数の数 */
    boostCount: number;
    /** 1.0より小さい乗数の数 */
    reduceCount: number;
    /** 変更なし(1.0)の数 */
    neutralCount: number;
    /** 平均乗数 */
    avgMultiplier: number;
    /** 最大乗数 */
    maxMultiplier: number;
    /** 最小乗数 */
    minMultiplier: number;
  };
}

// =============================================================================
// 乗数計算
// =============================================================================

/**
 * 分析結果から乗数を計算
 */
export function calculateMultipliers(
  analysisResults: HourlyAnalysisResult[],
  config: DaypartingConfig,
  options: MultiplierCalculationOptions = {}
): MultiplierCalculationResult {
  const maxMultiplier = options.maxMultiplier ?? config.maxMultiplier;
  const minMultiplier = options.minMultiplier ?? config.minMultiplier;
  const applyConfidenceAdjustment = options.applyConfidenceAdjustment ?? true;
  const applySmoothing = options.applySmoothing ?? false;
  const smoothingWeight = options.smoothingWeight ?? 0.6;

  const multipliers: HourlyBidMultiplier[] = [];
  const now = new Date();

  // まず生の乗数を計算
  const rawMultipliers = new Map<string, number>();

  for (const result of analysisResults) {
    const key = `${result.hour}|${result.dayOfWeek ?? "all"}`;
    let multiplier = result.recommendedMultiplier;

    // 信頼度による調整
    if (applyConfidenceAdjustment && result.confidence !== "INSUFFICIENT") {
      const confidenceFactor = CONFIDENCE_MULTIPLIER_FACTORS[result.confidence];
      multiplier = 1.0 + (multiplier - 1.0) * confidenceFactor;
    }

    // 信頼度不十分の場合は1.0
    if (result.confidence === "INSUFFICIENT") {
      multiplier = DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER;
    }

    rawMultipliers.set(key, multiplier);
  }

  // スムージングを適用
  const smoothedMultipliers = applySmoothing
    ? applySmoothingToMultipliers(rawMultipliers, smoothingWeight)
    : rawMultipliers;

  // 乗数をクリップして結果を構築
  for (const result of analysisResults) {
    const key = `${result.hour}|${result.dayOfWeek ?? "all"}`;
    let multiplier = smoothedMultipliers.get(key) ?? DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER;

    // 制約範囲にクリップ
    multiplier = Math.max(minMultiplier, Math.min(maxMultiplier, multiplier));

    // 小数点2桁に丸める
    multiplier = Math.round(multiplier * 100) / 100;

    multipliers.push({
      asin: config.asin,
      campaignId: config.campaignId,
      adGroupId: config.adGroupId,
      hour: result.hour,
      dayOfWeek: result.dayOfWeek,
      multiplier,
      confidence: result.confidence,
      classification: result.classification,
      effectiveFrom: now,
      effectiveTo: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 統計を計算
  const stats = calculateMultiplierStats(multipliers);

  return { multipliers, stats };
}

/**
 * スムージングを適用
 * 隣接する時間帯との加重平均を計算
 */
function applySmoothingToMultipliers(
  rawMultipliers: Map<string, number>,
  centerWeight: number
): Map<string, number> {
  const smoothed = new Map<string, number>();
  const adjacentWeight = (1 - centerWeight) / 2;

  // 時間帯のみ（全曜日）のスムージング
  for (let h = 0; h < 24; h++) {
    const key = `${h}|all`;
    const prevKey = `${(h + 23) % 24}|all`;
    const nextKey = `${(h + 1) % 24}|all`;

    const current = rawMultipliers.get(key) ?? 1.0;
    const prev = rawMultipliers.get(prevKey) ?? 1.0;
    const next = rawMultipliers.get(nextKey) ?? 1.0;

    const smoothedValue = current * centerWeight + prev * adjacentWeight + next * adjacentWeight;
    smoothed.set(key, smoothedValue);
  }

  // 時間帯×曜日のスムージング
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const key = `${h}|${d}`;
      const prevKey = `${(h + 23) % 24}|${d}`;
      const nextKey = `${(h + 1) % 24}|${d}`;

      const current = rawMultipliers.get(key);
      if (current === undefined) continue;

      const prev = rawMultipliers.get(prevKey) ?? current;
      const next = rawMultipliers.get(nextKey) ?? current;

      const smoothedValue = current * centerWeight + prev * adjacentWeight + next * adjacentWeight;
      smoothed.set(key, smoothedValue);
    }
  }

  return smoothed;
}

/**
 * 乗数の統計を計算
 */
function calculateMultiplierStats(multipliers: HourlyBidMultiplier[]): {
  totalCount: number;
  boostCount: number;
  reduceCount: number;
  neutralCount: number;
  avgMultiplier: number;
  maxMultiplier: number;
  minMultiplier: number;
} {
  if (multipliers.length === 0) {
    return {
      totalCount: 0,
      boostCount: 0,
      reduceCount: 0,
      neutralCount: 0,
      avgMultiplier: 1.0,
      maxMultiplier: 1.0,
      minMultiplier: 1.0,
    };
  }

  let boostCount = 0;
  let reduceCount = 0;
  let neutralCount = 0;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;

  for (const m of multipliers) {
    sum += m.multiplier;
    max = Math.max(max, m.multiplier);
    min = Math.min(min, m.multiplier);

    if (m.multiplier > 1.01) {
      boostCount++;
    } else if (m.multiplier < 0.99) {
      reduceCount++;
    } else {
      neutralCount++;
    }
  }

  return {
    totalCount: multipliers.length,
    boostCount,
    reduceCount,
    neutralCount,
    avgMultiplier: sum / multipliers.length,
    maxMultiplier: max,
    minMultiplier: min,
  };
}

// =============================================================================
// 乗数適用
// =============================================================================

/**
 * 現在時刻に対応する乗数を取得
 */
export function getMultiplierForCurrentTime(
  multipliers: HourlyBidMultiplier[],
  currentHour: HourOfDay,
  currentDayOfWeek: DayOfWeek
): HourlyBidMultiplier | null {
  // まず時間帯×曜日で検索
  const exactMatch = multipliers.find(
    (m) => m.hour === currentHour && m.dayOfWeek === currentDayOfWeek && m.isActive
  );
  if (exactMatch) return exactMatch;

  // 時間帯のみで検索（全曜日共通）
  const hourMatch = multipliers.find(
    (m) => m.hour === currentHour && m.dayOfWeek === null && m.isActive
  );
  if (hourMatch) return hourMatch;

  return null;
}

/**
 * 入札額に乗数を適用
 */
export function applyMultiplierToBid(
  baseBid: number,
  multiplier: number,
  minBid: number = 1,
  maxBid: number = 10000
): number {
  const adjustedBid = Math.round(baseBid * multiplier);
  return Math.max(minBid, Math.min(maxBid, adjustedBid));
}

/**
 * 乗数の差分を計算（前回からの変更）
 */
export function calculateMultiplierDiff(
  newMultipliers: HourlyBidMultiplier[],
  oldMultipliers: HourlyBidMultiplier[]
): {
  added: HourlyBidMultiplier[];
  removed: HourlyBidMultiplier[];
  changed: Array<{ old: HourlyBidMultiplier; new: HourlyBidMultiplier; diff: number }>;
  unchanged: HourlyBidMultiplier[];
} {
  const added: HourlyBidMultiplier[] = [];
  const removed: HourlyBidMultiplier[] = [];
  const changed: Array<{ old: HourlyBidMultiplier; new: HourlyBidMultiplier; diff: number }> = [];
  const unchanged: HourlyBidMultiplier[] = [];

  // oldのキーをマップに
  const oldMap = new Map<string, HourlyBidMultiplier>();
  for (const m of oldMultipliers) {
    const key = `${m.hour}|${m.dayOfWeek ?? "all"}`;
    oldMap.set(key, m);
  }

  // newを処理
  const processedKeys = new Set<string>();
  for (const newM of newMultipliers) {
    const key = `${newM.hour}|${newM.dayOfWeek ?? "all"}`;
    processedKeys.add(key);

    const oldM = oldMap.get(key);
    if (!oldM) {
      added.push(newM);
    } else if (Math.abs(newM.multiplier - oldM.multiplier) > 0.01) {
      changed.push({ old: oldM, new: newM, diff: newM.multiplier - oldM.multiplier });
    } else {
      unchanged.push(newM);
    }
  }

  // 削除されたものを検出
  for (const [key, oldM] of oldMap) {
    if (!processedKeys.has(key)) {
      removed.push(oldM);
    }
  }

  return { added, removed, changed, unchanged };
}

// =============================================================================
// 乗数生成ヘルパー
// =============================================================================

/**
 * 全時間帯に対してデフォルト乗数を生成
 */
export function generateDefaultMultipliers(
  config: DaypartingConfig,
  includeByDay: boolean = false
): HourlyBidMultiplier[] {
  const multipliers: HourlyBidMultiplier[] = [];
  const now = new Date();

  // 時間帯のみ（全曜日共通）
  for (let h = 0; h < 24; h++) {
    multipliers.push({
      asin: config.asin,
      campaignId: config.campaignId,
      adGroupId: config.adGroupId,
      hour: h as HourOfDay,
      dayOfWeek: null,
      multiplier: DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER,
      confidence: "INSUFFICIENT",
      classification: "AVERAGE",
      effectiveFrom: now,
      effectiveTo: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 時間帯×曜日
  if (includeByDay) {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        multipliers.push({
          asin: config.asin,
          campaignId: config.campaignId,
          adGroupId: config.adGroupId,
          hour: h as HourOfDay,
          dayOfWeek: d as DayOfWeek,
          multiplier: DAYPARTING_CONSTANTS.DEFAULT_MULTIPLIER,
          confidence: "INSUFFICIENT",
          classification: "AVERAGE",
          effectiveFrom: now,
          effectiveTo: null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  return multipliers;
}

/**
 * 乗数のIDを生成
 */
export function generateMultiplierId(): string {
  return `daypart_${crypto.randomUUID()}`;
}

/**
 * 乗数をマージ（新しい値で上書き）
 */
export function mergeMultipliers(
  existing: HourlyBidMultiplier[],
  updates: HourlyBidMultiplier[]
): HourlyBidMultiplier[] {
  const merged = new Map<string, HourlyBidMultiplier>();

  // 既存を追加
  for (const m of existing) {
    const key = `${m.hour}|${m.dayOfWeek ?? "all"}`;
    merged.set(key, m);
  }

  // 更新で上書き
  for (const m of updates) {
    const key = `${m.hour}|${m.dayOfWeek ?? "all"}`;
    merged.set(key, {
      ...m,
      updatedAt: new Date(),
    });
  }

  return Array.from(merged.values());
}

/**
 * 乗数を無効化
 */
export function deactivateMultipliers(
  multipliers: HourlyBidMultiplier[]
): HourlyBidMultiplier[] {
  const now = new Date();
  return multipliers.map((m) => ({
    ...m,
    isActive: false,
    effectiveTo: now,
    updatedAt: now,
  }));
}

// =============================================================================
// ログ出力
// =============================================================================

/**
 * 乗数計算結果をログ出力
 */
export function logMultiplierCalculation(
  result: MultiplierCalculationResult,
  asin: string,
  campaignId: string
): void {
  logger.info("Multiplier calculation completed", {
    asin,
    campaignId,
    totalCount: result.stats.totalCount,
    boostCount: result.stats.boostCount,
    reduceCount: result.stats.reduceCount,
    neutralCount: result.stats.neutralCount,
    avgMultiplier: result.stats.avgMultiplier.toFixed(2),
    maxMultiplier: result.stats.maxMultiplier.toFixed(2),
    minMultiplier: result.stats.minMultiplier.toFixed(2),
  });
}

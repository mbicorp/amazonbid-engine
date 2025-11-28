/**
 * セール用期待CVR計算モジュール
 *
 * ビッグセール時のCVR跳ね上がりを考慮した期待CVRを計算する。
 *
 * 計算ロジック:
 * 1. 時間帯別アップリフト uplift_schedule(h) を取得
 * 2. 事前期待CVR expectedCvr_sale_prior(h) = expectedCvr_normal × uplift_schedule(h)
 * 3. セール中実績CVRとブレンド（w_live 下限付き）
 * 4. max_uplift でクリップ
 */

import {
  SalePhase,
  SaleExpectedCvrConfig,
  SaleExpectedCvrInput,
  SaleExpectedCvrResult,
  SaleExpectedCvrBreakdown,
  UpliftScheduleBand,
  DEFAULT_SALE_EXPECTED_CVR_CONFIG,
} from "./types";

// =============================================================================
// 時間帯別アップリフト計算
// =============================================================================

/**
 * セール経過時間に対応するアップリフト値を取得
 *
 * @param hoursSinceSaleStart - セール開始からの経過時間（時間単位）
 * @param schedule - アップリフトスケジュール
 * @returns アップリフト値（該当なしの場合は1.0）
 */
export function getUpliftScheduleValue(
  hoursSinceSaleStart: number,
  schedule: UpliftScheduleBand[]
): number {
  // 負の値（セール前）は1.0を返す
  if (hoursSinceSaleStart < 0) {
    return 1.0;
  }

  // 該当するバンドを探す
  for (const band of schedule) {
    if (hoursSinceSaleStart >= band.startHour && hoursSinceSaleStart < band.endHour) {
      return band.uplift;
    }
  }

  // どのバンドにも該当しない場合（セール終了後など）は1.0
  return 1.0;
}

/**
 * 線形補間でアップリフト値を取得（オプション）
 *
 * バンド境界で急激な変化を避けたい場合に使用
 *
 * @param hoursSinceSaleStart - セール開始からの経過時間
 * @param schedule - アップリフトスケジュール
 * @param interpolationWidth - 補間幅（時間単位、例: 0.5 = 30分間で遷移）
 * @returns 補間されたアップリフト値
 */
export function getUpliftScheduleValueInterpolated(
  hoursSinceSaleStart: number,
  schedule: UpliftScheduleBand[],
  interpolationWidth: number = 0.5
): number {
  if (hoursSinceSaleStart < 0) {
    return 1.0;
  }

  // 現在のバンドを特定
  let currentBand: UpliftScheduleBand | null = null;
  let nextBand: UpliftScheduleBand | null = null;

  for (let i = 0; i < schedule.length; i++) {
    const band = schedule[i];
    if (hoursSinceSaleStart >= band.startHour && hoursSinceSaleStart < band.endHour) {
      currentBand = band;
      nextBand = schedule[i + 1] ?? null;
      break;
    }
  }

  if (!currentBand) {
    return 1.0;
  }

  // バンド境界付近でない場合はそのまま返す
  const distanceToEnd = currentBand.endHour - hoursSinceSaleStart;
  if (distanceToEnd > interpolationWidth || !nextBand) {
    return currentBand.uplift;
  }

  // 線形補間
  const t = 1 - distanceToEnd / interpolationWidth;
  return currentBand.uplift * (1 - t) + nextBand.uplift * t;
}

// =============================================================================
// w_live（実績信頼度）計算
// =============================================================================

/**
 * セール中実績CVRの信頼度（w_live）を計算
 *
 * @param clicksSale - セール中の実績クリック数
 * @param config - 設定
 * @returns w_live値（0〜1）
 */
export function computeWLive(
  clicksSale: number,
  config: SaleExpectedCvrConfig
): { wLiveRaw: number; wLiveClipped: number; wLiveFinal: number } {
  // 生のw_live値を計算
  const wLiveRaw = clicksSale / config.baseClicksSale;

  // 1.0でクリップ
  const wLiveClipped = Math.min(1.0, wLiveRaw);

  // 最小値を適用
  const wLiveFinal = Math.max(config.wMinSale, wLiveClipped);

  return { wLiveRaw, wLiveClipped, wLiveFinal };
}

// =============================================================================
// セール用期待CVR計算
// =============================================================================

/**
 * セール用期待CVRを計算
 *
 * 計算式:
 * 1. expectedCvr_sale_prior(h) = expectedCvr_normal × uplift_schedule(h)
 *    ただし <= expectedCvr_normal × max_uplift
 *
 * 2. expectedCvr_sale(h) = (1 - w_live) × expectedCvr_sale_prior + w_live × cvr_observed_sale
 *    ただし <= expectedCvr_normal × max_uplift
 *
 * @param input - 入力パラメータ
 * @param config - 設定
 * @returns セール用期待CVR計算結果
 */
export function computeExpectedCvrSale(
  input: SaleExpectedCvrInput,
  config: SaleExpectedCvrConfig = DEFAULT_SALE_EXPECTED_CVR_CONFIG
): SaleExpectedCvrResult {
  const {
    expectedCvrNormal,
    hoursSinceMainSaleStart,
    clicksSale,
    cvrObservedSale,
  } = input;

  // 1. 時間帯別アップリフトを取得
  const upliftScheduleValue = getUpliftScheduleValue(
    hoursSinceMainSaleStart,
    config.upliftSchedule
  );

  // 2. 事前期待CVRを計算
  const expectedCvrSalePriorRaw = expectedCvrNormal * upliftScheduleValue;

  // max_uplift でクリップ
  const maxExpectedCvr = expectedCvrNormal * config.maxUplift;
  const expectedCvrSalePrior = Math.min(expectedCvrSalePriorRaw, maxExpectedCvr);

  // 3. w_live を計算
  const { wLiveRaw, wLiveClipped, wLiveFinal } = computeWLive(clicksSale, config);

  // 4. ブレンド
  // expectedCvr_sale = (1 - w_live) × prior + w_live × observed
  const blendedCvrRaw =
    (1 - wLiveFinal) * expectedCvrSalePrior + wLiveFinal * cvrObservedSale;

  // 5. 最終結果を max_uplift でクリップ
  let expectedCvrSale = Math.min(blendedCvrRaw, maxExpectedCvr);

  // 負値やNaNの場合は0にクリップ
  if (!Number.isFinite(expectedCvrSale) || expectedCvrSale < 0) {
    expectedCvrSale = 0;
  }

  // 計算詳細
  const breakdown: SaleExpectedCvrBreakdown = {
    expectedCvrNormal,
    upliftScheduleValue,
    expectedCvrSalePriorRaw,
    expectedCvrSalePrior,
    wLiveRaw,
    wLiveClipped,
    wLiveFinal,
    blendedCvrRaw,
    wasMaxUpliftApplied: blendedCvrRaw > maxExpectedCvr,
  };

  return {
    expectedCvrSale,
    breakdown,
  };
}

// =============================================================================
// 統合期待CVR計算
// =============================================================================

/**
 * セールフェーズに応じた期待CVRを取得
 *
 * - MAIN_SALE: セール用期待CVRを計算
 * - その他: 通常時期待CVRをそのまま返す
 *
 * @param salePhase - 現在のセールフェーズ
 * @param expectedCvrNormal - 通常時の期待CVR
 * @param saleInput - セール用期待CVR計算入力（MAIN_SALE時に必要）
 * @param config - 設定
 * @returns 使用する期待CVR
 */
export function getExpectedCvrForPhase(
  salePhase: SalePhase,
  expectedCvrNormal: number,
  saleInput?: Omit<SaleExpectedCvrInput, "expectedCvrNormal">,
  config: SaleExpectedCvrConfig = DEFAULT_SALE_EXPECTED_CVR_CONFIG
): { expectedCvrUsed: number; isSaleMode: boolean; saleResult?: SaleExpectedCvrResult } {
  // MAIN_SALE以外は通常時の値を使用
  if (salePhase !== "MAIN_SALE") {
    return {
      expectedCvrUsed: expectedCvrNormal,
      isSaleMode: false,
    };
  }

  // MAIN_SALEだがセール入力がない場合も通常値を使用
  if (!saleInput) {
    return {
      expectedCvrUsed: expectedCvrNormal,
      isSaleMode: false,
    };
  }

  // セール用期待CVRを計算
  const fullInput: SaleExpectedCvrInput = {
    expectedCvrNormal,
    ...saleInput,
  };

  const saleResult = computeExpectedCvrSale(fullInput, config);

  return {
    expectedCvrUsed: saleResult.expectedCvrSale,
    isSaleMode: true,
    saleResult,
  };
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * アップリフトスケジュールを検証
 *
 * @param schedule - アップリフトスケジュール
 * @returns 検証結果（エラーがあればエラーメッセージ配列）
 */
export function validateUpliftSchedule(schedule: UpliftScheduleBand[]): string[] {
  const errors: string[] = [];

  if (schedule.length === 0) {
    errors.push("アップリフトスケジュールが空です");
    return errors;
  }

  for (let i = 0; i < schedule.length; i++) {
    const band = schedule[i];

    // 区間の妥当性チェック
    if (band.startHour >= band.endHour) {
      errors.push(
        `バンド${i}: startHour(${band.startHour}) >= endHour(${band.endHour})`
      );
    }

    if (band.uplift <= 0) {
      errors.push(`バンド${i}: uplift(${band.uplift}) <= 0`);
    }

    // 連続性チェック
    if (i > 0) {
      const prevBand = schedule[i - 1];
      if (band.startHour < prevBand.endHour) {
        errors.push(
          `バンド${i}: startHour(${band.startHour}) がバンド${i - 1}のendHour(${prevBand.endHour})と重複`
        );
      }
    }
  }

  return errors;
}

/**
 * セール継続時間からセール終了前の時間帯を判定
 *
 * @param hoursSinceSaleStart - セール開始からの経過時間
 * @param saleDurationHours - セール全体の継続時間
 * @param hoursBeforeEnd - 終了前とみなす時間数
 * @returns 終了前の時間帯かどうか
 */
export function isNearSaleEnd(
  hoursSinceSaleStart: number,
  saleDurationHours: number,
  hoursBeforeEnd: number = 5
): boolean {
  const hoursRemaining = saleDurationHours - hoursSinceSaleStart;
  return hoursRemaining >= 0 && hoursRemaining <= hoursBeforeEnd;
}

/**
 * 動的アップリフトスケジュールを生成
 *
 * セール継続時間に応じて終了前の時間帯を自動調整
 *
 * @param saleDurationHours - セール継続時間
 * @param config - 各フェーズのアップリフト値
 * @returns 動的に生成されたアップリフトスケジュール
 */
export function generateDynamicUpliftSchedule(
  saleDurationHours: number,
  config: {
    launchUplift: number;      // 開始直後（0-2時間）
    earlyUplift: number;       // 序盤（2-12時間）
    midUplift: number;         // 中盤
    finalUplift: number;       // 終了間際
    hoursBeforeEnd: number;    // 終了前フェーズの長さ
  } = {
    launchUplift: 1.8,
    earlyUplift: 1.3,
    midUplift: 1.1,
    finalUplift: 1.7,
    hoursBeforeEnd: 5,
  }
): UpliftScheduleBand[] {
  const midEndHour = saleDurationHours - config.hoursBeforeEnd;

  // 短いセール（12時間未満）の場合は簡略化
  if (saleDurationHours < 12) {
    return [
      { startHour: 0, endHour: 2, uplift: config.launchUplift },
      { startHour: 2, endHour: midEndHour, uplift: config.earlyUplift },
      { startHour: midEndHour, endHour: saleDurationHours, uplift: config.finalUplift },
    ].filter(band => band.startHour < band.endHour);
  }

  return [
    { startHour: 0, endHour: 2, uplift: config.launchUplift },
    { startHour: 2, endHour: 12, uplift: config.earlyUplift },
    { startHour: 12, endHour: midEndHour, uplift: config.midUplift },
    { startHour: midEndHour, endHour: saleDurationHours, uplift: config.finalUplift },
  ];
}

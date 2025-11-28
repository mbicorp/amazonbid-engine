/**
 * A/Bテスト結果評価
 *
 * 統計的有意性の検定と効果量の計算
 * Welch's t検定とCohen's dを使用
 */

import {
  ABTestConfig,
  ABTestMetricsAggregate,
  ABTestEvaluationResult,
  MetricEvaluationResult,
  TTestResult,
  EffectSizeResult,
  SignificanceLevel,
  EffectSizeInterpretation,
  ABTestNotificationData,
  AB_TEST_CONSTANTS,
} from "./types";

// =============================================================================
// 統計関数
// =============================================================================

/**
 * 正規分布のCDF（累積分布関数）の近似計算
 *
 * Abramowitz and Stegun approximation
 */
export function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * t分布のCDF（累積分布関数）の近似計算
 *
 * @param t - t値
 * @param df - 自由度
 * @returns 累積確率
 */
export function tCdf(t: number, df: number): number {
  // 自由度が大きい場合は正規分布で近似
  if (df > 100) {
    return normalCdf(t);
  }

  // Beta関数を使った正確な計算は複雑なので、
  // ここでは正規分布近似を使用
  // より正確な計算が必要な場合は専用ライブラリを使用
  const x = df / (df + t * t);
  const approx = normalCdf(t * Math.sqrt((df + 1) / (df + 0.5)));
  return approx;
}

/**
 * 標準誤差を計算
 *
 * @param stdDev - 標準偏差
 * @param n - サンプルサイズ
 * @returns 標準誤差
 */
export function standardError(stdDev: number, n: number): number {
  if (n <= 0) return 0;
  return stdDev / Math.sqrt(n);
}

// =============================================================================
// Welch's t検定
// =============================================================================

/**
 * Welch's t検定を実行
 *
 * 等分散を仮定しないt検定
 *
 * @param mean1 - グループ1の平均
 * @param mean2 - グループ2の平均
 * @param stdDev1 - グループ1の標準偏差
 * @param stdDev2 - グループ2の標準偏差
 * @param n1 - グループ1のサンプルサイズ
 * @param n2 - グループ2のサンプルサイズ
 * @returns t検定結果
 */
export function welchTTest(
  mean1: number,
  mean2: number,
  stdDev1: number,
  stdDev2: number,
  n1: number,
  n2: number
): TTestResult {
  // サンプルサイズが不十分な場合
  if (n1 < 2 || n2 < 2) {
    return {
      tStatistic: 0,
      pValue: 1,
      degreesOfFreedom: 0,
      significanceLevel: "NOT_SIGNIFICANT",
      confidenceIntervalLower: mean2 - mean1,
      confidenceIntervalUpper: mean2 - mean1,
    };
  }

  // 標準誤差
  const se1 = standardError(stdDev1, n1);
  const se2 = standardError(stdDev2, n2);

  // 結合標準誤差
  const pooledSE = Math.sqrt(se1 * se1 + se2 * se2);

  // t統計量（ゼロ除算防止）
  const tStatistic = pooledSE > 0 ? (mean2 - mean1) / pooledSE : 0;

  // Welch-Satterthwaite自由度
  const var1 = (stdDev1 * stdDev1) / n1;
  const var2 = (stdDev2 * stdDev2) / n2;
  const varSum = var1 + var2;

  let df: number;
  if (varSum > 0) {
    df =
      (varSum * varSum) /
      ((var1 * var1) / (n1 - 1) + (var2 * var2) / (n2 - 1));
  } else {
    df = n1 + n2 - 2;
  }

  // 両側検定のp値
  const pValue = 2 * (1 - tCdf(Math.abs(tStatistic), df));

  // 有意性レベルの判定
  let significanceLevel: SignificanceLevel;
  if (pValue < 0.01) {
    significanceLevel = "SIGNIFICANT_99";
  } else if (pValue < 0.05) {
    significanceLevel = "SIGNIFICANT_95";
  } else {
    significanceLevel = "NOT_SIGNIFICANT";
  }

  // 95%信頼区間（t分布の臨界値は約1.96として近似）
  const tCritical = 1.96; // 厳密にはdf依存だが簡略化
  const marginOfError = tCritical * pooledSE;
  const difference = mean2 - mean1;

  return {
    tStatistic,
    pValue,
    degreesOfFreedom: df,
    significanceLevel,
    confidenceIntervalLower: difference - marginOfError,
    confidenceIntervalUpper: difference + marginOfError,
  };
}

// =============================================================================
// 効果量（Cohen's d）
// =============================================================================

/**
 * Cohen's dを計算
 *
 * 効果量の標準化指標
 *
 * @param mean1 - グループ1の平均
 * @param mean2 - グループ2の平均
 * @param stdDev1 - グループ1の標準偏差
 * @param stdDev2 - グループ2の標準偏差
 * @param n1 - グループ1のサンプルサイズ
 * @param n2 - グループ2のサンプルサイズ
 * @returns 効果量結果
 */
export function calculateCohensD(
  mean1: number,
  mean2: number,
  stdDev1: number,
  stdDev2: number,
  n1: number,
  n2: number
): EffectSizeResult {
  // プールされた標準偏差（Hedges' g用の加重平均）
  let pooledStdDev: number;

  if (n1 + n2 - 2 > 0) {
    const pooledVariance =
      ((n1 - 1) * stdDev1 * stdDev1 + (n2 - 1) * stdDev2 * stdDev2) /
      (n1 + n2 - 2);
    pooledStdDev = Math.sqrt(pooledVariance);
  } else {
    // フォールバック：単純平均
    pooledStdDev = (stdDev1 + stdDev2) / 2;
  }

  // Cohen's d
  const cohensD = pooledStdDev > 0 ? (mean2 - mean1) / pooledStdDev : 0;

  // 効果量の解釈
  const absCohensD = Math.abs(cohensD);
  let interpretation: EffectSizeInterpretation;

  if (absCohensD < AB_TEST_CONSTANTS.EFFECT_SIZE_THRESHOLDS.SMALL) {
    interpretation = "NEGLIGIBLE";
  } else if (absCohensD < AB_TEST_CONSTANTS.EFFECT_SIZE_THRESHOLDS.MEDIUM) {
    interpretation = "SMALL";
  } else if (absCohensD < AB_TEST_CONSTANTS.EFFECT_SIZE_THRESHOLDS.LARGE) {
    interpretation = "MEDIUM";
  } else {
    interpretation = "LARGE";
  }

  return {
    cohensD,
    interpretation,
  };
}

// =============================================================================
// サンプルサイズ計算
// =============================================================================

/**
 * 必要なサンプルサイズを計算
 *
 * 検出力分析に基づく最小サンプルサイズ
 *
 * @param effectSize - 検出したい効果量（Cohen's d）
 * @param power - 検出力（デフォルト: 0.8）
 * @param alpha - 有意水準（デフォルト: 0.05）
 * @returns 各グループに必要なサンプルサイズ
 */
export function calculateRequiredSampleSize(
  effectSize: number = 0.3,
  power: number = AB_TEST_CONSTANTS.POWER_TARGET,
  alpha: number = AB_TEST_CONSTANTS.ALPHA_DEFAULT
): number {
  // z値の近似計算
  // alpha=0.05 -> z_alpha/2 ≈ 1.96
  // power=0.80 -> z_beta ≈ 0.84
  const zAlpha = 1.96; // 両側検定
  const zBeta = power === 0.8 ? 0.84 : power === 0.9 ? 1.28 : 0.84;

  // サンプルサイズの公式: n = 2 * ((z_alpha/2 + z_beta) / d)^2
  const n = 2 * Math.pow((zAlpha + zBeta) / effectSize, 2);

  return Math.ceil(n);
}

/**
 * 検出力を計算
 *
 * @param n1 - グループ1のサンプルサイズ
 * @param n2 - グループ2のサンプルサイズ
 * @param effectSize - 検出したい効果量
 * @param alpha - 有意水準
 * @returns 検出力（0-1）
 */
export function calculatePower(
  n1: number,
  n2: number,
  effectSize: number = 0.3,
  alpha: number = AB_TEST_CONSTANTS.ALPHA_DEFAULT
): number {
  // 調和平均サンプルサイズ
  const nHarmonic = (2 * n1 * n2) / (n1 + n2);

  // 非心パラメータ
  const ncp = effectSize * Math.sqrt(nHarmonic / 2);

  // zアルファ
  const zAlpha = alpha === 0.05 ? 1.96 : alpha === 0.01 ? 2.576 : 1.96;

  // 検出力の近似計算
  const power = normalCdf(ncp - zAlpha);

  return Math.max(0, Math.min(1, power));
}

// =============================================================================
// 指標評価
// =============================================================================

/**
 * 単一指標を評価
 *
 * @param metricName - 指標名
 * @param controlMean - コントロールグループの平均
 * @param testMean - テストグループの平均
 * @param controlStdDev - コントロールグループの標準偏差
 * @param testStdDev - テストグループの標準偏差
 * @param controlN - コントロールグループのサンプルサイズ
 * @param testN - テストグループのサンプルサイズ
 * @param higherIsBetter - 高い方が良い指標かどうか
 * @returns 指標評価結果
 */
export function evaluateMetric(
  metricName: string,
  controlMean: number,
  testMean: number,
  controlStdDev: number,
  testStdDev: number,
  controlN: number,
  testN: number,
  higherIsBetter: boolean = true
): MetricEvaluationResult {
  // 差分計算
  const difference = testMean - controlMean;
  const differencePercent =
    controlMean !== 0 ? (difference / controlMean) * 100 : 0;

  // t検定
  const tTest = welchTTest(
    controlMean,
    testMean,
    controlStdDev,
    testStdDev,
    controlN,
    testN
  );

  // 効果量
  const effectSize = calculateCohensD(
    controlMean,
    testMean,
    controlStdDev,
    testStdDev,
    controlN,
    testN
  );

  // 改善判定
  const isImproved = higherIsBetter ? difference > 0 : difference < 0;

  return {
    metricName,
    controlMean,
    testMean,
    controlStdDev,
    testStdDev,
    difference,
    differencePercent,
    tTest,
    effectSize,
    isImproved,
  };
}

// =============================================================================
// A/Bテスト評価
// =============================================================================

/**
 * A/Bテストを評価
 *
 * @param testConfig - テスト設定
 * @param controlMetrics - コントロールグループの集計メトリクス
 * @param testMetrics - テストグループの集計メトリクス
 * @param controlDailyData - コントロールグループの日次データ（標準偏差計算用）
 * @param testDailyData - テストグループの日次データ（標準偏差計算用）
 * @returns 評価結果
 */
export function evaluateABTest(
  testConfig: ABTestConfig,
  controlMetrics: ABTestMetricsAggregate,
  testMetrics: ABTestMetricsAggregate,
  controlDailyData: { acos: number[]; roas: number[]; cvr: number[]; sales: number[] },
  testDailyData: { acos: number[]; roas: number[]; cvr: number[]; sales: number[] }
): ABTestEvaluationResult {
  // 標準偏差を計算
  const controlAcosStdDev = calculateStdDev(controlDailyData.acos);
  const testAcosStdDev = calculateStdDev(testDailyData.acos);
  const controlRoasStdDev = calculateStdDev(controlDailyData.roas);
  const testRoasStdDev = calculateStdDev(testDailyData.roas);
  const controlCvrStdDev = calculateStdDev(controlDailyData.cvr);
  const testCvrStdDev = calculateStdDev(testDailyData.cvr);
  const controlSalesStdDev = calculateStdDev(controlDailyData.sales);
  const testSalesStdDev = calculateStdDev(testDailyData.sales);

  // 各指標を評価
  const acosEvaluation = evaluateMetric(
    "ACOS",
    controlMetrics.avgAcos ?? 0,
    testMetrics.avgAcos ?? 0,
    controlAcosStdDev,
    testAcosStdDev,
    controlMetrics.sampleSize,
    testMetrics.sampleSize,
    false // ACOSは低い方が良い
  );

  const roasEvaluation = evaluateMetric(
    "ROAS",
    controlMetrics.avgRoas ?? 0,
    testMetrics.avgRoas ?? 0,
    controlRoasStdDev,
    testRoasStdDev,
    controlMetrics.sampleSize,
    testMetrics.sampleSize,
    true // ROASは高い方が良い
  );

  const cvrEvaluation = evaluateMetric(
    "CVR",
    controlMetrics.avgCvr ?? 0,
    testMetrics.avgCvr ?? 0,
    controlCvrStdDev,
    testCvrStdDev,
    controlMetrics.sampleSize,
    testMetrics.sampleSize,
    true // CVRは高い方が良い
  );

  const salesEvaluation = evaluateMetric(
    "Sales",
    controlMetrics.totalSales,
    testMetrics.totalSales,
    controlSalesStdDev,
    testSalesStdDev,
    controlMetrics.sampleSize,
    testMetrics.sampleSize,
    true // 売上は高い方が良い
  );

  // サンプルサイズチェック
  const minRequired = calculateRequiredSampleSize(0.3);
  const hasAdequateSampleSize =
    controlMetrics.sampleSize >= minRequired &&
    testMetrics.sampleSize >= minRequired;

  // 実現検出力
  const achievedPower = calculatePower(
    controlMetrics.sampleSize,
    testMetrics.sampleSize,
    0.3
  );

  // 勝者判定
  const { winner, reason } = determineWinner(
    acosEvaluation,
    roasEvaluation,
    salesEvaluation,
    hasAdequateSampleSize
  );

  return {
    testId: testConfig.testId,
    evaluatedAt: new Date(),
    periodDays: controlMetrics.periodDays,
    controlSampleSize: controlMetrics.sampleSize,
    testSampleSize: testMetrics.sampleSize,
    acosEvaluation,
    roasEvaluation,
    cvrEvaluation,
    salesEvaluation,
    overallWinner: winner,
    winnerReason: reason,
    hasAdequateSampleSize,
    minRequiredSampleSize: minRequired,
    achievedPower,
  };
}

/**
 * 標準偏差を計算
 */
function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);

  return Math.sqrt(variance);
}

/**
 * 勝者を判定
 */
function determineWinner(
  acosEval: MetricEvaluationResult,
  roasEval: MetricEvaluationResult,
  salesEval: MetricEvaluationResult,
  hasAdequateSampleSize: boolean
): { winner: "CONTROL" | "TEST" | "INCONCLUSIVE"; reason: string } {
  // サンプルサイズが不十分な場合
  if (!hasAdequateSampleSize) {
    return {
      winner: "INCONCLUSIVE",
      reason: "サンプルサイズが不十分です。より長い期間のデータが必要です。",
    };
  }

  // 有意な結果の数をカウント
  const significantImprovements = [acosEval, roasEval, salesEval].filter(
    (e) => e.tTest.significanceLevel !== "NOT_SIGNIFICANT" && e.isImproved
  ).length;

  const significantRegressions = [acosEval, roasEval, salesEval].filter(
    (e) => e.tTest.significanceLevel !== "NOT_SIGNIFICANT" && !e.isImproved
  ).length;

  // 主要指標（ACOS）で判定
  if (acosEval.tTest.significanceLevel !== "NOT_SIGNIFICANT") {
    if (acosEval.isImproved) {
      return {
        winner: "TEST",
        reason: `テストグループのACOSが有意に改善（${acosEval.differencePercent.toFixed(1)}%、p=${acosEval.tTest.pValue.toFixed(4)}）`,
      };
    } else {
      return {
        winner: "CONTROL",
        reason: `テストグループのACOSが有意に悪化（${acosEval.differencePercent.toFixed(1)}%、p=${acosEval.tTest.pValue.toFixed(4)}）`,
      };
    }
  }

  // ACOSが有意でない場合、売上で判定
  if (salesEval.tTest.significanceLevel !== "NOT_SIGNIFICANT") {
    if (salesEval.isImproved) {
      return {
        winner: "TEST",
        reason: `テストグループの売上が有意に改善（${salesEval.differencePercent.toFixed(1)}%、p=${salesEval.tTest.pValue.toFixed(4)}）`,
      };
    } else {
      return {
        winner: "CONTROL",
        reason: `テストグループの売上が有意に悪化（${salesEval.differencePercent.toFixed(1)}%、p=${salesEval.tTest.pValue.toFixed(4)}）`,
      };
    }
  }

  // 有意な結果がない場合
  return {
    winner: "INCONCLUSIVE",
    reason: "統計的に有意な差は検出されませんでした。",
  };
}

// =============================================================================
// 通知用データ変換
// =============================================================================

/**
 * 評価結果を通知用データに変換
 */
export function toNotificationData(
  testConfig: ABTestConfig,
  evaluation: ABTestEvaluationResult
): ABTestNotificationData {
  return {
    testId: testConfig.testId,
    testName: testConfig.name,
    status: testConfig.status,
    periodDays: evaluation.periodDays,
    controlSampleSize: evaluation.controlSampleSize,
    testSampleSize: evaluation.testSampleSize,
    acosResult: {
      controlMean: evaluation.acosEvaluation.controlMean,
      testMean: evaluation.acosEvaluation.testMean,
      differencePercent: evaluation.acosEvaluation.differencePercent,
      isSignificant:
        evaluation.acosEvaluation.tTest.significanceLevel !== "NOT_SIGNIFICANT",
      isImproved: evaluation.acosEvaluation.isImproved,
    },
    roasResult: {
      controlMean: evaluation.roasEvaluation.controlMean,
      testMean: evaluation.roasEvaluation.testMean,
      differencePercent: evaluation.roasEvaluation.differencePercent,
      isSignificant:
        evaluation.roasEvaluation.tTest.significanceLevel !== "NOT_SIGNIFICANT",
      isImproved: evaluation.roasEvaluation.isImproved,
    },
    overallWinner: evaluation.overallWinner,
    winnerReason: evaluation.winnerReason,
    hasAdequateSampleSize: evaluation.hasAdequateSampleSize,
  };
}

// =============================================================================
// Slack通知フォーマット
// =============================================================================

/**
 * Slack通知用メッセージをフォーマット
 */
export function formatSlackMessage(data: ABTestNotificationData): {
  text: string;
  blocks: unknown[];
} {
  const statusEmoji =
    data.overallWinner === "TEST"
      ? ":tada:"
      : data.overallWinner === "CONTROL"
        ? ":warning:"
        : ":hourglass:";

  const winnerText =
    data.overallWinner === "TEST"
      ? "テストグループ勝利"
      : data.overallWinner === "CONTROL"
        ? "コントロールグループ勝利"
        : "結論未確定";

  const acosEmoji = data.acosResult.isImproved ? ":chart_with_downwards_trend:" : ":chart_with_upwards_trend:";
  const roasEmoji = data.roasResult.isImproved ? ":chart_with_upwards_trend:" : ":chart_with_downwards_trend:";

  return {
    text: `A/Bテスト結果: ${data.testName} - ${winnerText}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${statusEmoji} A/Bテスト結果: ${data.testName}`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*テストID:*\n\`${data.testId}\``,
          },
          {
            type: "mrkdwn",
            text: `*テスト期間:*\n${data.periodDays}日間`,
          },
          {
            type: "mrkdwn",
            text: `*コントロール:*\n${data.controlSampleSize}件`,
          },
          {
            type: "mrkdwn",
            text: `*テスト:*\n${data.testSampleSize}件`,
          },
        ],
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${acosEmoji} ACOS*\nコントロール: ${(data.acosResult.controlMean * 100).toFixed(1)}% → テスト: ${(data.acosResult.testMean * 100).toFixed(1)}%\n差分: ${data.acosResult.differencePercent.toFixed(1)}% ${data.acosResult.isSignificant ? "(有意)" : "(有意差なし)"}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${roasEmoji} ROAS*\nコントロール: ${data.roasResult.controlMean.toFixed(2)} → テスト: ${data.roasResult.testMean.toFixed(2)}\n差分: ${data.roasResult.differencePercent.toFixed(1)}% ${data.roasResult.isSignificant ? "(有意)" : "(有意差なし)"}`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*判定:* ${winnerText}\n${data.winnerReason}`,
        },
      },
      ...(data.hasAdequateSampleSize
        ? []
        : [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: ":warning: サンプルサイズが不十分です。結果は参考値です。",
                },
              ],
            },
          ]),
    ],
  };
}

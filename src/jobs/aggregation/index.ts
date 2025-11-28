/**
 * 集計ジョブ - エントリーポイント
 *
 * 全集計ジョブをまとめて実行するためのオーケストレーター
 */

import { logger } from "../../logger";
import { runKeywordMetricsAggregation } from "./keyword-metrics-aggregator";
import { runSeoKeywordSelection } from "./seo-keyword-selector";
import { runSeoScoreCalculation } from "./seo-score-calculator";
import {
  getMonthlyProfitSummary,
  validateMonthlyData,
} from "./monthly-profit-aggregator";

// 個別エクスポート
export * from "./keyword-metrics-aggregator";
export * from "./seo-keyword-selector";
export * from "./seo-score-calculator";
export * from "./monthly-profit-aggregator";

/**
 * 集計ジョブ設定
 */
export interface AggregationJobConfig {
  projectId: string;
  dataset: string;
  dryRun?: boolean;
  skipKeywordMetrics?: boolean;
  skipSeoKeywordSelection?: boolean;
  skipSeoScoreCalculation?: boolean;
  skipMonthlyProfitValidation?: boolean;
}

/**
 * 集計ジョブ結果
 */
export interface AggregationJobResult {
  success: boolean;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  keywordMetrics?: {
    processedCount: number;
  };
  seoKeywordSelection?: {
    selectedCount: number;
    byRole: Record<string, number>;
  };
  seoScoreCalculation?: {
    processedCount: number;
    avgScore: number;
    distribution: { HIGH: number; MID: number; LOW: number };
  };
  monthlyProfitValidation?: {
    valid: boolean;
    issues: string[];
  };
  errors: string[];
}

/**
 * 全集計ジョブを順番に実行
 *
 * 実行順序:
 * 1. キーワードメトリクス集計（60日）
 * 2. SEOキーワード選定
 * 3. SEOスコア計算
 * 4. 月次利益データ検証
 */
export async function runAllAggregationJobs(
  config: AggregationJobConfig
): Promise<AggregationJobResult> {
  const startTime = new Date();
  const errors: string[] = [];
  const result: AggregationJobResult = {
    success: true,
    startTime,
    endTime: startTime,
    durationMs: 0,
    errors: [],
  };

  logger.info("Starting all aggregation jobs", {
    projectId: config.projectId,
    dataset: config.dataset,
    dryRun: config.dryRun,
  });

  // 1. キーワードメトリクス集計
  if (!config.skipKeywordMetrics) {
    try {
      logger.info("Step 1/4: Running keyword metrics aggregation...");
      result.keywordMetrics = await runKeywordMetricsAggregation({
        projectId: config.projectId,
        dataset: config.dataset,
        dryRun: config.dryRun,
      });
      logger.info("Keyword metrics aggregation completed", result.keywordMetrics);
    } catch (error) {
      const errorMsg = `Keyword metrics aggregation failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      errors.push(errorMsg);
      logger.error(errorMsg);
      result.success = false;
    }
  }

  // 2. SEOキーワード選定
  if (!config.skipSeoKeywordSelection) {
    try {
      logger.info("Step 2/4: Running SEO keyword selection...");
      result.seoKeywordSelection = await runSeoKeywordSelection({
        projectId: config.projectId,
        dataset: config.dataset,
        dryRun: config.dryRun,
      });
      logger.info("SEO keyword selection completed", result.seoKeywordSelection);
    } catch (error) {
      const errorMsg = `SEO keyword selection failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      errors.push(errorMsg);
      logger.error(errorMsg);
      result.success = false;
    }
  }

  // 3. SEOスコア計算
  if (!config.skipSeoScoreCalculation) {
    try {
      logger.info("Step 3/4: Running SEO score calculation...");
      result.seoScoreCalculation = await runSeoScoreCalculation({
        projectId: config.projectId,
        dataset: config.dataset,
        dryRun: config.dryRun,
      });
      logger.info("SEO score calculation completed", result.seoScoreCalculation);
    } catch (error) {
      const errorMsg = `SEO score calculation failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      errors.push(errorMsg);
      logger.error(errorMsg);
      result.success = false;
    }
  }

  // 4. 月次利益データ検証
  if (!config.skipMonthlyProfitValidation && !config.dryRun) {
    try {
      logger.info("Step 4/4: Validating monthly profit data...");
      const currentMonth = new Date().toISOString().substring(0, 7);
      result.monthlyProfitValidation = await validateMonthlyData(
        {
          projectId: config.projectId,
          dataset: config.dataset,
        },
        currentMonth
      );

      // サマリーも取得
      const summary = await getMonthlyProfitSummary({
        projectId: config.projectId,
        dataset: config.dataset,
      });

      logger.info("Monthly profit validation completed", {
        validation: result.monthlyProfitValidation,
        summary,
      });
    } catch (error) {
      const errorMsg = `Monthly profit validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      errors.push(errorMsg);
      logger.error(errorMsg);
      // 検証失敗は致命的エラーとはしない
    }
  }

  // 完了
  const endTime = new Date();
  result.endTime = endTime;
  result.durationMs = endTime.getTime() - startTime.getTime();
  result.errors = errors;

  logger.info("All aggregation jobs completed", {
    success: result.success,
    durationMs: result.durationMs,
    errorCount: errors.length,
  });

  return result;
}

/**
 * CLI実行用のメイン関数
 */
async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const dataset = process.env.BIGQUERY_DATASET || "amazon_bid_engine";
  const dryRun = process.argv.includes("--dry-run");

  if (!projectId) {
    console.error("Error: GOOGLE_CLOUD_PROJECT_ID environment variable is required");
    process.exit(1);
  }

  console.log("=== Aggregation Jobs ===");
  console.log(`Project: ${projectId}`);
  console.log(`Dataset: ${dataset}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log("");

  const result = await runAllAggregationJobs({
    projectId,
    dataset,
    dryRun,
  });

  console.log("\n=== Results ===");
  console.log(JSON.stringify(result, null, 2));

  if (!result.success) {
    process.exit(1);
  }
}

// CLI実行時のみmainを実行
if (require.main === module) {
  main().catch(console.error);
}

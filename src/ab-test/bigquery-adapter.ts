/**
 * A/Bテスト BigQueryアダプター
 *
 * テスト設定、割り当て、メトリクス、評価結果の永続化
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  ABTestConfig,
  ABTestAssignment,
  ABTestDailyMetrics,
  ABTestMetricsAggregate,
  ABTestEvaluationResult,
  ABTestRecord,
  ABTestAssignmentRecord,
  ABTestDailyMetricsRecord,
  ABTestEvaluationRecord,
  ABTestStatus,
  AssignmentLevel,
  TestGroup,
} from "./types";

// =============================================================================
// 型定義
// =============================================================================

/**
 * BigQuery設定
 */
export interface BigQueryConfig {
  projectId: string;
  dataset: string;
}

/**
 * テーブル名
 */
export const AB_TEST_TABLES = {
  TESTS: "ab_tests",
  ASSIGNMENTS: "ab_test_assignments",
  DAILY_METRICS: "ab_test_daily_metrics",
  EVALUATIONS: "ab_test_evaluations",
} as const;

// =============================================================================
// データ変換
// =============================================================================

/**
 * ABTestConfigをBigQueryレコードに変換
 */
export function configToRecord(config: ABTestConfig): ABTestRecord {
  return {
    test_id: config.testId,
    name: config.name,
    description: config.description,
    status: config.status,
    assignment_level: config.assignmentLevel,
    test_group_ratio: config.testGroupRatio,
    test_overrides: JSON.stringify(config.testOverrides),
    target_filters: config.targetFilters
      ? JSON.stringify(config.targetFilters)
      : null,
    start_date: config.startDate.toISOString().split("T")[0],
    end_date: config.endDate.toISOString().split("T")[0],
    created_at: config.createdAt.toISOString(),
    updated_at: config.updatedAt.toISOString(),
    created_by: config.createdBy ?? null,
    notes: config.notes ?? null,
  };
}

/**
 * BigQueryレコードをABTestConfigに変換
 */
export function recordToConfig(row: Record<string, unknown>): ABTestConfig {
  return {
    testId: row.test_id as string,
    name: row.name as string,
    description: row.description as string,
    status: row.status as ABTestStatus,
    assignmentLevel: row.assignment_level as AssignmentLevel,
    testGroupRatio: row.test_group_ratio as number,
    testOverrides: JSON.parse(row.test_overrides as string),
    targetFilters: row.target_filters
      ? JSON.parse(row.target_filters as string)
      : undefined,
    startDate: new Date(row.start_date as string),
    endDate: new Date(row.end_date as string),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    createdBy: (row.created_by as string) ?? undefined,
    notes: (row.notes as string) ?? undefined,
  };
}

/**
 * ABTestAssignmentをBigQueryレコードに変換
 */
export function assignmentToRecord(
  assignment: ABTestAssignment
): ABTestAssignmentRecord {
  return {
    test_id: assignment.testId,
    assignment_key: assignment.assignmentKey,
    assignment_level: assignment.assignmentLevel,
    group: assignment.group,
    assigned_at: assignment.assignedAt.toISOString(),
    hash_value: assignment.hashValue ?? null,
  };
}

/**
 * BigQueryレコードをABTestAssignmentに変換
 */
export function recordToAssignment(
  row: Record<string, unknown>
): ABTestAssignment {
  return {
    testId: row.test_id as string,
    assignmentKey: row.assignment_key as string,
    assignmentLevel: row.assignment_level as AssignmentLevel,
    group: row.group as TestGroup,
    assignedAt: new Date(row.assigned_at as string),
    hashValue: (row.hash_value as number) ?? undefined,
  };
}

/**
 * ABTestDailyMetricsをBigQueryレコードに変換
 */
export function metricsToRecord(
  metrics: ABTestDailyMetrics
): ABTestDailyMetricsRecord {
  return {
    test_id: metrics.testId,
    date: metrics.date.toISOString().split("T")[0],
    group: metrics.group,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    conversions: metrics.conversions,
    sales: metrics.sales,
    spend: metrics.spend,
    ctr: metrics.ctr,
    cvr: metrics.cvr,
    acos: metrics.acos,
    roas: metrics.roas,
    recommendation_count: metrics.recommendationCount,
    bid_up_count: metrics.bidUpCount,
    bid_down_count: metrics.bidDownCount,
    no_change_count: metrics.noChangeCount,
    avg_bid_change_percent: metrics.avgBidChangePercent,
  };
}

/**
 * BigQueryレコードをABTestDailyMetricsに変換
 */
export function recordToMetrics(
  row: Record<string, unknown>
): ABTestDailyMetrics {
  return {
    testId: row.test_id as string,
    date: new Date(row.date as string),
    group: row.group as TestGroup,
    impressions: row.impressions as number,
    clicks: row.clicks as number,
    conversions: row.conversions as number,
    sales: row.sales as number,
    spend: row.spend as number,
    ctr: (row.ctr as number) ?? null,
    cvr: (row.cvr as number) ?? null,
    acos: (row.acos as number) ?? null,
    roas: (row.roas as number) ?? null,
    recommendationCount: row.recommendation_count as number,
    bidUpCount: row.bid_up_count as number,
    bidDownCount: row.bid_down_count as number,
    noChangeCount: row.no_change_count as number,
    avgBidChangePercent: (row.avg_bid_change_percent as number) ?? null,
  };
}

/**
 * ABTestEvaluationResultをBigQueryレコードに変換
 */
export function evaluationToRecord(
  evaluation: ABTestEvaluationResult
): ABTestEvaluationRecord {
  return {
    test_id: evaluation.testId,
    evaluated_at: evaluation.evaluatedAt.toISOString(),
    period_days: evaluation.periodDays,
    control_sample_size: evaluation.controlSampleSize,
    test_sample_size: evaluation.testSampleSize,
    acos_evaluation: JSON.stringify(evaluation.acosEvaluation),
    roas_evaluation: JSON.stringify(evaluation.roasEvaluation),
    cvr_evaluation: JSON.stringify(evaluation.cvrEvaluation),
    sales_evaluation: JSON.stringify(evaluation.salesEvaluation),
    overall_winner: evaluation.overallWinner,
    winner_reason: evaluation.winnerReason,
    has_adequate_sample_size: evaluation.hasAdequateSampleSize,
    min_required_sample_size: evaluation.minRequiredSampleSize,
    achieved_power: evaluation.achievedPower,
    notes: evaluation.notes ?? null,
  };
}

// =============================================================================
// テーブル作成
// =============================================================================

/**
 * A/Bテスト関連テーブルを作成
 */
export async function createABTestTables(
  config: BigQueryConfig
): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });
  const datasetId = config.dataset;

  // ab_tests テーブル
  const testsSchema = [
    { name: "test_id", type: "STRING", mode: "REQUIRED" },
    { name: "name", type: "STRING", mode: "REQUIRED" },
    { name: "description", type: "STRING", mode: "REQUIRED" },
    { name: "status", type: "STRING", mode: "REQUIRED" },
    { name: "assignment_level", type: "STRING", mode: "REQUIRED" },
    { name: "test_group_ratio", type: "FLOAT64", mode: "REQUIRED" },
    { name: "test_overrides", type: "STRING", mode: "REQUIRED" },
    { name: "target_filters", type: "STRING", mode: "NULLABLE" },
    { name: "start_date", type: "DATE", mode: "REQUIRED" },
    { name: "end_date", type: "DATE", mode: "REQUIRED" },
    { name: "created_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "updated_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "created_by", type: "STRING", mode: "NULLABLE" },
    { name: "notes", type: "STRING", mode: "NULLABLE" },
  ];

  // ab_test_assignments テーブル
  const assignmentsSchema = [
    { name: "test_id", type: "STRING", mode: "REQUIRED" },
    { name: "assignment_key", type: "STRING", mode: "REQUIRED" },
    { name: "assignment_level", type: "STRING", mode: "REQUIRED" },
    { name: "group", type: "STRING", mode: "REQUIRED" },
    { name: "assigned_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "hash_value", type: "INT64", mode: "NULLABLE" },
  ];

  // ab_test_daily_metrics テーブル（日付パーティション）
  const metricsSchema = [
    { name: "test_id", type: "STRING", mode: "REQUIRED" },
    { name: "date", type: "DATE", mode: "REQUIRED" },
    { name: "group", type: "STRING", mode: "REQUIRED" },
    { name: "impressions", type: "INT64", mode: "REQUIRED" },
    { name: "clicks", type: "INT64", mode: "REQUIRED" },
    { name: "conversions", type: "INT64", mode: "REQUIRED" },
    { name: "sales", type: "FLOAT64", mode: "REQUIRED" },
    { name: "spend", type: "FLOAT64", mode: "REQUIRED" },
    { name: "ctr", type: "FLOAT64", mode: "NULLABLE" },
    { name: "cvr", type: "FLOAT64", mode: "NULLABLE" },
    { name: "acos", type: "FLOAT64", mode: "NULLABLE" },
    { name: "roas", type: "FLOAT64", mode: "NULLABLE" },
    { name: "recommendation_count", type: "INT64", mode: "REQUIRED" },
    { name: "bid_up_count", type: "INT64", mode: "REQUIRED" },
    { name: "bid_down_count", type: "INT64", mode: "REQUIRED" },
    { name: "no_change_count", type: "INT64", mode: "REQUIRED" },
    { name: "avg_bid_change_percent", type: "FLOAT64", mode: "NULLABLE" },
  ];

  // ab_test_evaluations テーブル
  const evaluationsSchema = [
    { name: "test_id", type: "STRING", mode: "REQUIRED" },
    { name: "evaluated_at", type: "TIMESTAMP", mode: "REQUIRED" },
    { name: "period_days", type: "INT64", mode: "REQUIRED" },
    { name: "control_sample_size", type: "INT64", mode: "REQUIRED" },
    { name: "test_sample_size", type: "INT64", mode: "REQUIRED" },
    { name: "acos_evaluation", type: "STRING", mode: "REQUIRED" },
    { name: "roas_evaluation", type: "STRING", mode: "REQUIRED" },
    { name: "cvr_evaluation", type: "STRING", mode: "REQUIRED" },
    { name: "sales_evaluation", type: "STRING", mode: "REQUIRED" },
    { name: "overall_winner", type: "STRING", mode: "REQUIRED" },
    { name: "winner_reason", type: "STRING", mode: "REQUIRED" },
    { name: "has_adequate_sample_size", type: "BOOL", mode: "REQUIRED" },
    { name: "min_required_sample_size", type: "INT64", mode: "REQUIRED" },
    { name: "achieved_power", type: "FLOAT64", mode: "REQUIRED" },
    { name: "notes", type: "STRING", mode: "NULLABLE" },
  ];

  const tables = [
    { name: AB_TEST_TABLES.TESTS, schema: testsSchema },
    { name: AB_TEST_TABLES.ASSIGNMENTS, schema: assignmentsSchema },
    {
      name: AB_TEST_TABLES.DAILY_METRICS,
      schema: metricsSchema,
      partitioning: { type: "DAY", field: "date" },
    },
    { name: AB_TEST_TABLES.EVALUATIONS, schema: evaluationsSchema },
  ];

  for (const table of tables) {
    try {
      const [exists] = await bigquery
        .dataset(datasetId)
        .table(table.name)
        .exists();

      if (!exists) {
        const options: {
          schema: typeof table.schema;
          timePartitioning?: { type: string; field: string };
        } = {
          schema: table.schema,
        };

        if ("partitioning" in table && table.partitioning) {
          options.timePartitioning = table.partitioning;
        }

        await bigquery.dataset(datasetId).createTable(table.name, options);
        logger.info(`Created table: ${datasetId}.${table.name}`);
      }
    } catch (error) {
      logger.error(`Failed to create table: ${table.name}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// =============================================================================
// テスト設定 CRUD
// =============================================================================

/**
 * テスト設定を保存
 */
export async function saveTest(
  config: BigQueryConfig,
  test: ABTestConfig
): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });
  const table = bigquery.dataset(config.dataset).table(AB_TEST_TABLES.TESTS);

  const record = configToRecord(test);

  await table.insert([record]);

  logger.info("Saved A/B test config", {
    testId: test.testId,
    name: test.name,
  });
}

/**
 * テスト設定を更新
 */
export async function updateTest(
  config: BigQueryConfig,
  test: ABTestConfig
): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });
  const record = configToRecord(test);

  const query = `
    UPDATE \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.TESTS}\`
    SET
      name = @name,
      description = @description,
      status = @status,
      test_overrides = @test_overrides,
      target_filters = @target_filters,
      end_date = @end_date,
      updated_at = @updated_at,
      notes = @notes
    WHERE test_id = @test_id
  `;

  await bigquery.query({
    query,
    params: {
      test_id: record.test_id,
      name: record.name,
      description: record.description,
      status: record.status,
      test_overrides: record.test_overrides,
      target_filters: record.target_filters,
      end_date: record.end_date,
      updated_at: record.updated_at,
      notes: record.notes,
    },
    location: "asia-northeast1",
  });

  logger.info("Updated A/B test config", {
    testId: test.testId,
    status: test.status,
  });
}

/**
 * テスト設定を取得
 */
export async function fetchTest(
  config: BigQueryConfig,
  testId: string
): Promise<ABTestConfig | null> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.TESTS}\`
    WHERE test_id = @testId
  `;

  const [rows] = await bigquery.query({
    query,
    params: { testId },
    location: "asia-northeast1",
  });

  if (rows.length === 0) {
    return null;
  }

  return recordToConfig(rows[0]);
}

/**
 * テスト設定一覧を取得
 */
export async function fetchTests(
  config: BigQueryConfig,
  options?: {
    status?: ABTestStatus;
    limit?: number;
  }
): Promise<ABTestConfig[]> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  let query = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.TESTS}\`
  `;

  const params: Record<string, unknown> = {};

  if (options?.status) {
    query += " WHERE status = @status";
    params.status = options.status;
  }

  query += " ORDER BY created_at DESC";

  if (options?.limit) {
    query += ` LIMIT ${options.limit}`;
  }

  const [rows] = await bigquery.query({
    query,
    params,
    location: "asia-northeast1",
  });

  return rows.map(recordToConfig);
}

/**
 * 実行中のテストを取得
 */
export async function fetchRunningTests(
  config: BigQueryConfig
): Promise<ABTestConfig[]> {
  return fetchTests(config, { status: "RUNNING" });
}

// =============================================================================
// 割り当て CRUD
// =============================================================================

/**
 * 割り当てを保存
 */
export async function saveAssignments(
  config: BigQueryConfig,
  assignments: ABTestAssignment[]
): Promise<void> {
  if (assignments.length === 0) return;

  const bigquery = new BigQuery({ projectId: config.projectId });
  const table = bigquery
    .dataset(config.dataset)
    .table(AB_TEST_TABLES.ASSIGNMENTS);

  const records = assignments.map(assignmentToRecord);

  // バッチ挿入（1000件ずつ）
  const batchSize = 1000;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await table.insert(batch);
  }

  logger.info("Saved A/B test assignments", {
    count: assignments.length,
    testId: assignments[0].testId,
  });
}

/**
 * テストの割り当てを取得
 */
export async function fetchAssignments(
  config: BigQueryConfig,
  testId: string
): Promise<ABTestAssignment[]> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.ASSIGNMENTS}\`
    WHERE test_id = @testId
  `;

  const [rows] = await bigquery.query({
    query,
    params: { testId },
    location: "asia-northeast1",
  });

  return rows.map(recordToAssignment);
}

/**
 * 特定エンティティの割り当てを取得
 */
export async function fetchAssignment(
  config: BigQueryConfig,
  testId: string,
  assignmentKey: string
): Promise<ABTestAssignment | null> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.ASSIGNMENTS}\`
    WHERE test_id = @testId AND assignment_key = @assignmentKey
  `;

  const [rows] = await bigquery.query({
    query,
    params: { testId, assignmentKey },
    location: "asia-northeast1",
  });

  if (rows.length === 0) {
    return null;
  }

  return recordToAssignment(rows[0]);
}

// =============================================================================
// メトリクス CRUD
// =============================================================================

/**
 * 日次メトリクスを保存
 */
export async function saveDailyMetrics(
  config: BigQueryConfig,
  metrics: ABTestDailyMetrics[]
): Promise<void> {
  if (metrics.length === 0) return;

  const bigquery = new BigQuery({ projectId: config.projectId });
  const table = bigquery
    .dataset(config.dataset)
    .table(AB_TEST_TABLES.DAILY_METRICS);

  const records = metrics.map(metricsToRecord);

  await table.insert(records);

  logger.info("Saved A/B test daily metrics", {
    count: metrics.length,
    testId: metrics[0].testId,
  });
}

/**
 * テストの日次メトリクスを取得
 */
export async function fetchDailyMetrics(
  config: BigQueryConfig,
  testId: string,
  startDate?: Date,
  endDate?: Date
): Promise<ABTestDailyMetrics[]> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  let query = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.DAILY_METRICS}\`
    WHERE test_id = @testId
  `;

  const params: Record<string, unknown> = { testId };

  if (startDate) {
    query += " AND date >= @startDate";
    params.startDate = startDate.toISOString().split("T")[0];
  }

  if (endDate) {
    query += " AND date <= @endDate";
    params.endDate = endDate.toISOString().split("T")[0];
  }

  query += " ORDER BY date, group";

  const [rows] = await bigquery.query({
    query,
    params,
    location: "asia-northeast1",
  });

  return rows.map(recordToMetrics);
}

/**
 * グループ別メトリクス集計を取得
 */
export async function fetchMetricsAggregate(
  config: BigQueryConfig,
  testId: string,
  group: TestGroup,
  startDate?: Date,
  endDate?: Date
): Promise<ABTestMetricsAggregate | null> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  let dateFilter = "";
  const params: Record<string, unknown> = { testId, group };

  if (startDate) {
    dateFilter += " AND date >= @startDate";
    params.startDate = startDate.toISOString().split("T")[0];
  }

  if (endDate) {
    dateFilter += " AND date <= @endDate";
    params.endDate = endDate.toISOString().split("T")[0];
  }

  const query = `
    SELECT
      test_id,
      @group as group,
      COUNT(DISTINCT date) as period_days,
      SUM(impressions) as total_impressions,
      SUM(clicks) as total_clicks,
      SUM(conversions) as total_conversions,
      SUM(sales) as total_sales,
      SUM(spend) as total_spend,
      SAFE_DIVIDE(SUM(clicks), SUM(impressions)) as avg_ctr,
      SAFE_DIVIDE(SUM(conversions), SUM(clicks)) as avg_cvr,
      SAFE_DIVIDE(SUM(spend), SUM(sales)) as avg_acos,
      SAFE_DIVIDE(SUM(sales), SUM(spend)) as avg_roas,
      SUM(recommendation_count) as total_recommendations,
      SUM(bid_up_count) as total_bid_up,
      SUM(bid_down_count) as total_bid_down,
      (SELECT COUNT(DISTINCT assignment_key)
       FROM \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.ASSIGNMENTS}\`
       WHERE test_id = @testId AND group = @group) as sample_size
    FROM \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.DAILY_METRICS}\`
    WHERE test_id = @testId AND group = @group ${dateFilter}
    GROUP BY test_id
  `;

  const [rows] = await bigquery.query({
    query,
    params,
    location: "asia-northeast1",
  });

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    testId: row.test_id as string,
    group: row.group as TestGroup,
    periodDays: row.period_days as number,
    totalImpressions: row.total_impressions as number,
    totalClicks: row.total_clicks as number,
    totalConversions: row.total_conversions as number,
    totalSales: row.total_sales as number,
    totalSpend: row.total_spend as number,
    avgCtr: (row.avg_ctr as number) ?? null,
    avgCvr: (row.avg_cvr as number) ?? null,
    avgAcos: (row.avg_acos as number) ?? null,
    avgRoas: (row.avg_roas as number) ?? null,
    totalRecommendations: row.total_recommendations as number,
    totalBidUp: row.total_bid_up as number,
    totalBidDown: row.total_bid_down as number,
    sampleSize: row.sample_size as number,
  };
}

// =============================================================================
// 評価結果 CRUD
// =============================================================================

/**
 * 評価結果を保存
 */
export async function saveEvaluation(
  config: BigQueryConfig,
  evaluation: ABTestEvaluationResult
): Promise<void> {
  const bigquery = new BigQuery({ projectId: config.projectId });
  const table = bigquery
    .dataset(config.dataset)
    .table(AB_TEST_TABLES.EVALUATIONS);

  const record = evaluationToRecord(evaluation);

  await table.insert([record]);

  logger.info("Saved A/B test evaluation", {
    testId: evaluation.testId,
    winner: evaluation.overallWinner,
  });
}

/**
 * テストの評価結果一覧を取得
 */
export async function fetchEvaluations(
  config: BigQueryConfig,
  testId: string
): Promise<ABTestEvaluationResult[]> {
  const bigquery = new BigQuery({ projectId: config.projectId });

  const query = `
    SELECT *
    FROM \`${config.projectId}.${config.dataset}.${AB_TEST_TABLES.EVALUATIONS}\`
    WHERE test_id = @testId
    ORDER BY evaluated_at DESC
  `;

  const [rows] = await bigquery.query({
    query,
    params: { testId },
    location: "asia-northeast1",
  });

  return rows.map((row) => ({
    testId: row.test_id as string,
    evaluatedAt: new Date(row.evaluated_at as string),
    periodDays: row.period_days as number,
    controlSampleSize: row.control_sample_size as number,
    testSampleSize: row.test_sample_size as number,
    acosEvaluation: JSON.parse(row.acos_evaluation as string),
    roasEvaluation: JSON.parse(row.roas_evaluation as string),
    cvrEvaluation: JSON.parse(row.cvr_evaluation as string),
    salesEvaluation: JSON.parse(row.sales_evaluation as string),
    overallWinner: row.overall_winner as "CONTROL" | "TEST" | "INCONCLUSIVE",
    winnerReason: row.winner_reason as string,
    hasAdequateSampleSize: row.has_adequate_sample_size as boolean,
    minRequiredSampleSize: row.min_required_sample_size as number,
    achievedPower: row.achieved_power as number,
    notes: (row.notes as string) ?? undefined,
  }));
}

/**
 * 最新の評価結果を取得
 */
export async function fetchLatestEvaluation(
  config: BigQueryConfig,
  testId: string
): Promise<ABTestEvaluationResult | null> {
  const evaluations = await fetchEvaluations(config, testId);
  return evaluations.length > 0 ? evaluations[0] : null;
}

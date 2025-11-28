/**
 * LossBudget リポジトリ
 *
 * BigQueryからASIN単位のlossBudget指標を取得し、
 * LossBudgetSummaryを構築する。
 *
 * 依存ビュー:
 *   - asin_rolling_30d_summary: 30日ローリング集計
 *   - asin_launch_invest_summary: ローンチ投資サマリー
 */

import { BigQuery } from "@google-cloud/bigquery";
import { logger } from "../logger";
import {
  LossBudgetSummary,
  LossBudgetState,
  LossBudgetStateConfig,
  DEFAULT_LOSS_BUDGET_STATE_CONFIG,
  createLossBudgetSummary,
} from "./lossBudgetEvaluator";

// =============================================================================
// 型定義
// =============================================================================

/**
 * リポジトリ初期化オプション
 */
export interface LossBudgetRepositoryOptions {
  /** BigQuery プロジェクトID */
  projectId: string;
  /** BigQuery データセットID */
  dataset: string;
  /** LossBudgetState判定設定 */
  stateConfig?: LossBudgetStateConfig;
}

/**
 * asin_rolling_30d_summary ビューの行
 */
export interface RollingSummaryRow {
  asin: string;
  period_start: { value: string };
  period_end: { value: string };
  lifecycle_stage_w: string;
  g: number;
  t_opt: number;
  loss_budget_multiple_stage: number;
  sales_w: number;
  ad_cost_w: number;
  impressions_w: number;
  clicks_w: number;
  orders_w: number;
  target_net_margin_mid: number;
  net_profit_real_w: number;
  net_profit_target_w: number;
  loss_gap_w: number;
  loss_budget_allowed_w: number;
  loss_budget_consumption_w: number;
  tacos_w: number | null;
  acos_w: number | null;
}

/**
 * asin_launch_invest_summary ビューの行
 */
export interface LaunchInvestSummaryRow {
  asin: string;
  launch_start_date: { value: string };
  launch_end_date: { value: string };
  current_lifecycle_stage: string;
  days_in_launch: number;
  g: number;
  t_opt: number;
  t_launch: number;
  sales_launch: number;
  ad_cost_launch: number;
  impressions_launch: number;
  clicks_launch: number;
  orders_launch: number;
  ad_cost_opt_launch: number;
  extra_ad_cost_launch_real: number;
  launch_invest_total_design: number;
  launch_invest_usage_ratio: number;
  tacos_launch: number | null;
  net_profit_launch: number;
  net_profit_target_launch: number;
  loss_gap_launch: number;
  loss_budget_allowed_launch: number;
  loss_budget_consumption_launch: number;
}

/**
 * ASIN単位の統合lossBudgetデータ
 */
export interface AsinLossBudgetData {
  asin: string;
  /** 30日ローリングサマリー */
  rolling: RollingSummaryRow | null;
  /** ローンチ投資サマリー */
  launchInvest: LaunchInvestSummaryRow | null;
  /** 統合されたLossBudgetSummary */
  summary: LossBudgetSummary;
}

// =============================================================================
// リポジトリ実装
// =============================================================================

/**
 * LossBudgetリポジトリ
 */
export class LossBudgetRepository {
  private bigquery: BigQuery;
  private projectId: string;
  private dataset: string;
  private stateConfig: LossBudgetStateConfig;

  constructor(options: LossBudgetRepositoryOptions) {
    this.projectId = options.projectId;
    this.dataset = options.dataset;
    this.stateConfig = options.stateConfig ?? DEFAULT_LOSS_BUDGET_STATE_CONFIG;
    this.bigquery = new BigQuery({ projectId: this.projectId });
  }

  /**
   * 30日ローリングサマリーを取得
   */
  async fetchRollingSummaries(): Promise<Map<string, RollingSummaryRow>> {
    const query = `
      SELECT *
      FROM \`${this.projectId}.${this.dataset}.asin_rolling_30d_summary\`
    `;

    try {
      const [rows] = await this.bigquery.query({ query });
      const map = new Map<string, RollingSummaryRow>();
      for (const row of rows as RollingSummaryRow[]) {
        map.set(row.asin, row);
      }
      logger.info("Fetched rolling summaries", { count: map.size });
      return map;
    } catch (error) {
      logger.error("Failed to fetch rolling summaries", { error });
      return new Map();
    }
  }

  /**
   * ローンチ投資サマリーを取得
   */
  async fetchLaunchInvestSummaries(): Promise<Map<string, LaunchInvestSummaryRow>> {
    const query = `
      SELECT *
      FROM \`${this.projectId}.${this.dataset}.asin_launch_invest_summary\`
    `;

    try {
      const [rows] = await this.bigquery.query({ query });
      const map = new Map<string, LaunchInvestSummaryRow>();
      for (const row of rows as LaunchInvestSummaryRow[]) {
        map.set(row.asin, row);
      }
      logger.info("Fetched launch invest summaries", { count: map.size });
      return map;
    } catch (error) {
      logger.error("Failed to fetch launch invest summaries", { error });
      return new Map();
    }
  }

  /**
   * 特定のASINリストのLossBudgetSummaryを取得
   */
  async fetchLossBudgetSummaryForAsins(
    asins: string[]
  ): Promise<Map<string, LossBudgetSummary>> {
    if (asins.length === 0) {
      return new Map();
    }

    const asinList = asins.map((a) => `'${a}'`).join(",");

    // ローリングサマリーとローンチ投資サマリーを並行取得
    const rollingQuery = `
      SELECT *
      FROM \`${this.projectId}.${this.dataset}.asin_rolling_30d_summary\`
      WHERE asin IN (${asinList})
    `;

    const launchQuery = `
      SELECT *
      FROM \`${this.projectId}.${this.dataset}.asin_launch_invest_summary\`
      WHERE asin IN (${asinList})
    `;

    try {
      const [rollingRows, launchRows] = await Promise.all([
        this.bigquery.query({ query: rollingQuery }),
        this.bigquery.query({ query: launchQuery }),
      ]);

      const rollingMap = new Map<string, RollingSummaryRow>();
      for (const row of rollingRows[0] as RollingSummaryRow[]) {
        rollingMap.set(row.asin, row);
      }

      const launchMap = new Map<string, LaunchInvestSummaryRow>();
      for (const row of launchRows[0] as LaunchInvestSummaryRow[]) {
        launchMap.set(row.asin, row);
      }

      // LossBudgetSummaryを構築
      const summaryMap = new Map<string, LossBudgetSummary>();
      for (const asin of asins) {
        const rolling = rollingMap.get(asin);
        const launch = launchMap.get(asin);

        const summary = this.buildLossBudgetSummary(asin, rolling, launch);
        summaryMap.set(asin, summary);
      }

      logger.info("Fetched loss budget summaries for ASINs", {
        requested: asins.length,
        found: summaryMap.size,
      });

      return summaryMap;
    } catch (error) {
      logger.error("Failed to fetch loss budget summaries", { error, asins });
      // エラー時はデフォルト値を返す
      const defaultMap = new Map<string, LossBudgetSummary>();
      for (const asin of asins) {
        defaultMap.set(asin, this.createDefaultSummary(asin));
      }
      return defaultMap;
    }
  }

  /**
   * 全ASINの統合LossBudgetデータを取得
   */
  async fetchAllLossBudgetData(): Promise<Map<string, AsinLossBudgetData>> {
    const [rollingMap, launchMap] = await Promise.all([
      this.fetchRollingSummaries(),
      this.fetchLaunchInvestSummaries(),
    ]);

    // 全ASINを収集
    const allAsins = new Set<string>([
      ...rollingMap.keys(),
      ...launchMap.keys(),
    ]);

    const result = new Map<string, AsinLossBudgetData>();
    for (const asin of allAsins) {
      const rolling = rollingMap.get(asin) ?? null;
      const launchInvest = launchMap.get(asin) ?? null;
      const summary = this.buildLossBudgetSummary(asin, rolling, launchInvest);

      result.set(asin, {
        asin,
        rolling,
        launchInvest,
        summary,
      });
    }

    logger.info("Fetched all loss budget data", { count: result.size });
    return result;
  }

  /**
   * LossBudgetSummaryを構築
   */
  private buildLossBudgetSummary(
    asin: string,
    rolling: RollingSummaryRow | null | undefined,
    launch: LaunchInvestSummaryRow | null | undefined
  ): LossBudgetSummary {
    const rollingConsumption = rolling?.loss_budget_consumption_w ?? 0;
    const launchConsumption = launch?.loss_budget_consumption_launch ?? 0;
    const launchInvestUsage = launch?.launch_invest_usage_ratio ?? 0;

    const periodStart = rolling?.period_start?.value ?? this.getDefaultPeriodStart();
    const periodEnd = rolling?.period_end?.value ?? this.getDefaultPeriodEnd();

    return createLossBudgetSummary(
      asin,
      rollingConsumption,
      launchConsumption,
      launchInvestUsage,
      periodStart,
      periodEnd,
      this.stateConfig
    );
  }

  /**
   * デフォルトのLossBudgetSummaryを作成
   */
  private createDefaultSummary(asin: string): LossBudgetSummary {
    return createLossBudgetSummary(
      asin,
      0,
      0,
      0,
      this.getDefaultPeriodStart(),
      this.getDefaultPeriodEnd(),
      this.stateConfig
    );
  }

  /**
   * デフォルトの期間開始日を取得
   */
  private getDefaultPeriodStart(): string {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split("T")[0];
  }

  /**
   * デフォルトの期間終了日を取得
   */
  private getDefaultPeriodEnd(): string {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date.toISOString().split("T")[0];
  }
}

// =============================================================================
// ファクトリ関数
// =============================================================================

/**
 * LossBudgetRepositoryを作成
 */
export function createLossBudgetRepository(
  options: LossBudgetRepositoryOptions
): LossBudgetRepository {
  return new LossBudgetRepository(options);
}

// =============================================================================
// 便利関数
// =============================================================================

/**
 * LossBudgetStateでフィルタリング
 */
export function filterByLossBudgetState(
  summaries: Map<string, LossBudgetSummary>,
  states: LossBudgetState[]
): Map<string, LossBudgetSummary> {
  const filtered = new Map<string, LossBudgetSummary>();
  for (const [asin, summary] of summaries) {
    if (states.includes(summary.state)) {
      filtered.set(asin, summary);
    }
  }
  return filtered;
}

/**
 * CRITICALのASINを抽出
 */
export function getCriticalAsins(
  summaries: Map<string, LossBudgetSummary>
): string[] {
  return Array.from(summaries.entries())
    .filter(([_, s]) => s.state === "CRITICAL")
    .map(([asin, _]) => asin);
}

/**
 * WARNING以上のASINを抽出
 */
export function getWarningOrCriticalAsins(
  summaries: Map<string, LossBudgetSummary>
): string[] {
  return Array.from(summaries.entries())
    .filter(([_, s]) => s.state === "WARNING" || s.state === "CRITICAL")
    .map(([asin, _]) => asin);
}

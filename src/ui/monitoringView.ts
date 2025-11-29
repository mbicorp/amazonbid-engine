/**
 * 監視ビュー
 *
 * BigQuery execution_health_recent ビューのデータをHTML形式で表示
 * 入札エンジン実行ごとの健康状態と異常検出状況を一覧表示する
 */

import { Request, Response } from "express";
import { executeQuery, getFullTableName } from "../bigquery/client";
import { logger } from "../logger";
import { renderLayout, buildErrorContent, escapeHtml } from "./layout";
import { fetchGlobalAlert } from "./globalAlert";

// =============================================================================
// 定数
// =============================================================================

const DEFAULT_LIMIT = 50;
const ALLOWED_LIMITS = [20, 50, 100, 200];

// =============================================================================
// 型定義
// =============================================================================

/**
 * フィルタ条件
 */
interface MonitoringFilterParams {
  limit: number;
  mode?: "SHADOW" | "APPLY";
  anomaly: "all" | "anomalies";
}

/**
 * 実行ヘルス指標レコード
 */
interface ExecutionHealthRecord {
  execution_id: string;
  execution_time: string;
  mode: string;
  guardrails_mode: string | null;
  total_keywords: number;
  total_recommendations: number;
  total_applied: number;
  total_apply_failed: number;
  strong_up_count: number;
  strong_down_count: number;
  up_ratio: number | null;
  down_ratio: number | null;
  guardrails_clipped_ratio: number | null;
  apply_failed_ratio: number | null;
  avg_bid_change_ratio: number | null;
  max_bid_change_ratio: number | null;
  is_anomaly_basic: boolean;
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 日時を読みやすい形式に変換
 */
function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  } catch {
    return dateStr;
  }
}

/**
 * パーセンテージをフォーマット
 */
function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * 数値をフォーマット（小数点以下の桁数指定）
 */
function formatNumber(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return "-";
  return value.toFixed(decimals);
}


/**
 * クエリパラメータをパース
 */
function parseMonitoringFilterParams(req: Request): MonitoringFilterParams {
  // limit
  const limitParam = parseInt(req.query.limit as string, 10);
  const limit = ALLOWED_LIMITS.includes(limitParam) ? limitParam : DEFAULT_LIMIT;

  // mode
  const modeParam = req.query.mode as string;
  let mode: "SHADOW" | "APPLY" | undefined = undefined;
  if (modeParam === "SHADOW" || modeParam === "APPLY") {
    mode = modeParam;
  }

  // anomaly
  const anomalyParam = req.query.anomaly as string;
  let anomaly: "all" | "anomalies" = "all";
  if (anomalyParam === "anomalies") {
    anomaly = anomalyParam;
  }

  return { limit, mode, anomaly };
}

// =============================================================================
// BigQuery クエリ
// =============================================================================

/**
 * 実行ヘルス指標レコードを取得
 */
async function listExecutionHealth(
  filters: MonitoringFilterParams
): Promise<{ records: ExecutionHealthRecord[]; total: number }> {
  const tableName = getFullTableName("execution_health_recent");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit: filters.limit };

  if (filters.mode) {
    conditions.push("mode = @mode");
    params.mode = filters.mode;
  }

  if (filters.anomaly === "anomalies") {
    conditions.push("is_anomaly_basic = TRUE");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // 総件数を取得
  const countQuery = `
    SELECT COUNT(*) as total
    FROM \`${tableName}\`
    ${whereClause}
  `;
  const countResult = await executeQuery<{ total: number }>(countQuery, params);
  const total = countResult[0]?.total || 0;

  // データを取得
  const dataQuery = `
    SELECT
      execution_id,
      CAST(execution_time AS STRING) as execution_time,
      mode,
      guardrails_mode,
      total_keywords,
      total_recommendations,
      total_applied,
      total_apply_failed,
      strong_up_count,
      strong_down_count,
      up_ratio,
      down_ratio,
      guardrails_clipped_ratio,
      apply_failed_ratio,
      avg_bid_change_ratio,
      max_bid_change_ratio,
      is_anomaly_basic
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY execution_time DESC
    LIMIT @limit
  `;

  const records = await executeQuery<ExecutionHealthRecord>(dataQuery, params);

  logger.debug("listExecutionHealth", { filters, total, count: records.length });

  return { records, total };
}

// =============================================================================
// コンテンツ生成
// =============================================================================

/**
 * 監視ビューページ固有のスタイル
 */
const monitoringExtraStyles = `
  .anomaly-row {
    background-color: #fff5f5;
  }
  .mode-apply {
    color: #805ad5;
    font-weight: 600;
  }
  .mode-shadow {
    color: #718096;
    font-weight: 600;
  }
  .status-anomaly {
    background: #fed7d7;
    color: #c53030;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .status-normal {
    background: #c6f6d5;
    color: #276749;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
  }
  .legend {
    background: white;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    font-size: 0.85rem;
    color: #4a5568;
  }
  .legend strong {
    color: #2d3748;
  }
`;

/**
 * 監視ビューコンテンツを生成
 */
function buildMonitoringContent(
  records: ExecutionHealthRecord[],
  total: number,
  filters: MonitoringFilterParams
): string {
  // サマリー統計を計算
  const anomalyCount = records.filter((r) => r.is_anomaly_basic).length;
  const applyCount = records.filter((r) => r.mode === "APPLY").length;
  const shadowCount = records.filter((r) => r.mode === "SHADOW").length;

  // 比率の警告色を取得するヘルパー
  const getWarningColor = (value: number | null, threshold: number): string => {
    if (value === null) return "#718096";
    return value > threshold ? "#e53e3e" : "#38a169";
  };

  const tableRows = records
    .map((rec) => {
      // 異常行はハイライト
      const rowClass = rec.is_anomaly_basic ? 'class="anomaly-row"' : "";

      // モードの色分け
      const modeClass = rec.mode === "APPLY" ? "mode-apply" : "mode-shadow";

      // 直リンクURL
      const execLink = `/ui/executions?executionId=${encodeURIComponent(rec.execution_id)}`;
      const recoLink = `/ui/recommendations?executionId=${encodeURIComponent(rec.execution_id)}`;

      return `
        <tr ${rowClass}>
          <td>${formatDateTime(rec.execution_time)}</td>
          <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(rec.execution_id?.substring(0, 8))}...</td>
          <td><span class="${modeClass}">${escapeHtml(rec.mode)}</span></td>
          <td>${escapeHtml(rec.guardrails_mode) || "-"}</td>
          <td style="text-align: right;">${rec.total_keywords ?? "-"}</td>
          <td style="text-align: right;">${rec.total_recommendations ?? "-"}</td>
          <td style="text-align: right;">${rec.total_applied ?? "-"}</td>
          <td style="text-align: right; color: ${rec.total_apply_failed > 0 ? "#e53e3e" : "#718096"};">${rec.total_apply_failed ?? "-"}</td>
          <td style="text-align: right;">${rec.strong_up_count ?? "-"}</td>
          <td style="text-align: right;">${rec.strong_down_count ?? "-"}</td>
          <td style="text-align: right; color: ${getWarningColor(rec.up_ratio, 0.5)};">${formatPercent(rec.up_ratio)}</td>
          <td style="text-align: right; color: ${getWarningColor(rec.down_ratio, 0.5)};">${formatPercent(rec.down_ratio)}</td>
          <td style="text-align: right; color: ${getWarningColor(rec.guardrails_clipped_ratio, 0.3)};">${formatPercent(rec.guardrails_clipped_ratio)}</td>
          <td style="text-align: right; color: ${getWarningColor(rec.apply_failed_ratio, 0.2)};">${formatPercent(rec.apply_failed_ratio)}</td>
          <td style="text-align: right;">${formatNumber(rec.avg_bid_change_ratio)}</td>
          <td style="text-align: right;">${formatNumber(rec.max_bid_change_ratio)}</td>
          <td style="text-align: center;">
            ${rec.is_anomaly_basic
              ? '<span class="status-anomaly">異常</span>'
              : '<span class="status-normal">正常</span>'
            }
          </td>
          <td>
            <div class="ex-row-actions">
              <a href="${execLink}" class="ex-row-action-btn ex-row-action-exec" title="実行履歴で確認">履歴</a>
              <a href="${recoLink}" class="ex-row-action-btn ex-row-action-reco" title="推奨入札を確認">推奨</a>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  const limitOptions = ALLOWED_LIMITS
    .map((l) => `<option value="${l}" ${filters.limit === l ? "selected" : ""}>${l}</option>`)
    .join("");

  const modeOptions = [
    { value: "", label: "すべて" },
    { value: "SHADOW", label: "SHADOW" },
    { value: "APPLY", label: "APPLY" },
  ]
    .map((opt) => `<option value="${opt.value}" ${filters.mode === opt.value ? "selected" : ""}>${opt.label}</option>`)
    .join("");

  const anomalyOptions = [
    { value: "all", label: "すべて" },
    { value: "anomalies", label: "異常のみ" },
  ]
    .map((opt) => `<option value="${opt.value}" ${filters.anomaly === opt.value ? "selected" : ""}>${opt.label}</option>`)
    .join("");

  // プリセットリンクを生成
  const presetLinks = `
    <div class="monitoring-presets">
      <span class="monitoring-presets-label">クイックプリセット:</span>
      <a href="/ui/monitoring?mode=APPLY&anomaly=anomalies&limit=50" class="monitoring-preset-link">APPLY 異常のみ 50件</a>
      <a href="/ui/monitoring?anomaly=anomalies&limit=50" class="monitoring-preset-link">全モード異常のみ 50件</a>
      <a href="/ui/monitoring?mode=APPLY&limit=100" class="monitoring-preset-link">APPLY 全件 100件</a>
      <a href="/ui/monitoring?mode=SHADOW&limit=100" class="monitoring-preset-link">SHADOW 全件 100件</a>
      <a href="/ui/monitoring?limit=200" class="monitoring-preset-link">全モード 200件</a>
    </div>
  `;

  return `
    <p class="view-description">入札エンジンの健全性指標と異常検知結果を確認できます。</p>

    ${presetLinks}

    <div class="monitoring-summary">
      <div class="monitoring-summary-item">
        <span class="label">表示件数:</span>
        <span class="value">${records.length} / ${total}</span>
      </div>
      <div class="monitoring-summary-item">
        <span class="label">異常検出:</span>
        <span class="value${anomalyCount > 0 ? " anomaly" : ""}">${anomalyCount}件</span>
      </div>
      <div class="monitoring-summary-item">
        <span class="label">APPLY:</span>
        <span class="value apply">${applyCount}件</span>
      </div>
      <div class="monitoring-summary-item">
        <span class="label">SHADOW:</span>
        <span class="value shadow">${shadowCount}件</span>
      </div>
    </div>

    <form class="filters" method="GET" action="/ui/monitoring">
      <label>
        表示件数:
        <select name="limit">
          ${limitOptions}
        </select>
      </label>
      <label>
        モード:
        <select name="mode">
          ${modeOptions}
        </select>
      </label>
      <label>
        異常フィルタ:
        <select name="anomaly">
          ${anomalyOptions}
        </select>
      </label>
      <button type="submit">フィルター適用</button>
    </form>

    <div class="legend">
      <strong>閾値:</strong>
      UP/DOWN比率 > 50%、ガードレール適用比率 > 30%、APPLY失敗比率 > 20% で異常判定。
      赤字は閾値超過を示します。
    </div>

    <div class="summary">
      全 ${total} 件中 ${records.length} 件を表示
    </div>

    ${
      records.length === 0
        ? '<div class="empty-state">該当するデータはありません（フィルタ条件や期間を見直してください）。</div>'
        : `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>実行日時</th>
            <th>実行ID</th>
            <th>モード</th>
            <th>GR Mode</th>
            <th class="numeric">総KW</th>
            <th class="numeric">推奨</th>
            <th class="numeric">適用</th>
            <th class="numeric">失敗</th>
            <th class="numeric">強UP</th>
            <th class="numeric">強DOWN</th>
            <th class="numeric">UP率</th>
            <th class="numeric">DOWN率</th>
            <th class="numeric">GR適用率</th>
            <th class="numeric">失敗率</th>
            <th class="numeric">平均変動</th>
            <th class="numeric">最大変動</th>
            <th>状態</th>
            <th>リンク</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
    `
    }
  `;
}

// =============================================================================
// メインハンドラー
// =============================================================================

/**
 * 監視ビューをレンダリング
 */
export async function renderMonitoringView(req: Request, res: Response): Promise<void> {
  const env = process.env.NODE_ENV || "development";

  // グローバルアラートを取得
  const globalAlert = await fetchGlobalAlert();

  try {
    // クエリパラメータをパース
    const filters = parseMonitoringFilterParams(req);

    logger.debug("renderMonitoringView", { filters });

    // BigQueryから監視データを取得
    const { records, total } = await listExecutionHealth(filters);

    // コンテンツを生成
    const contentHtml = buildMonitoringContent(records, total, filters);

    // 共通レイアウトでレンダリング
    const html = renderLayout({
      title: "監視ビュー",
      subtitle: "入札エンジンの実行ヘルス指標を確認します。",
      env,
      contentHtml,
      extraStyles: monitoringExtraStyles,
      currentPath: "/ui/monitoring",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  } catch (error) {
    // ログにはエラー詳細を記録（スタックトレース含む）
    logger.error("Failed to render monitoring view", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // エラーコンテンツを生成
    const errorMessage = error instanceof Error ? error.message : String(error);
    const contentHtml = buildErrorContent(
      errorMessage,
      "監視データの取得中にエラーが発生しました。BigQuery 接続エラーや権限エラーの可能性があります。"
    );

    // 共通レイアウトでエラーページをレンダリング（HTTP 200）
    const html = renderLayout({
      title: "監視ビュー エラー",
      subtitle: "監視データの取得中にエラーが発生しました。",
      env,
      contentHtml,
      currentPath: "/ui/monitoring",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  }
}

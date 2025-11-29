/**
 * 実行履歴ビュー
 *
 * BigQuery executions テーブルのデータをHTML形式で表示
 */

import { Request, Response } from "express";
import { listExecutions, Execution, ExecutionFilter } from "../admin/repositories/executionsRepo";
import { logger } from "../logger";
import { renderLayout, buildErrorContent, escapeHtml } from "./layout";
import { fetchGlobalAlert } from "./globalAlert";

// =============================================================================
// 定数
// =============================================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ステータスに応じた色を返す
 */
function getStatusColor(status: string): string {
  switch (status?.toUpperCase()) {
    case "SUCCESS":
      return "#48bb78"; // green
    case "FAILED":
      return "#f56565"; // red
    case "PARTIAL":
      return "#ed8936"; // orange
    case "RUNNING":
      return "#4299e1"; // blue
    default:
      return "#a0aec0"; // gray
  }
}

/**
 * ミリ秒を読みやすい形式に変換
 */
function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

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

// =============================================================================
// コンテンツ生成
// =============================================================================

/**
 * 実行履歴ページ固有のスタイル
 */
const executionsExtraStyles = `
  .status-badge {
    color: white;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.85rem;
  }
  .mode-badge {
    font-weight: 600;
  }
  .mode-apply {
    color: #805ad5;
  }
  .mode-shadow {
    color: #718096;
  }
  .error-row {
    background-color: #fff5f5;
  }
`;

/**
 * 実行履歴コンテンツを生成
 */
function buildExecutionsContent(
  executions: Execution[],
  total: number,
  limit: number,
  filters: ExecutionFilter,
  executionId?: string
): string {
  const tableRows = executions
    .map((exec) => {
      const statusColor = getStatusColor(exec.status);
      const errorStyle = exec.status === "FAILED" ? 'class="error-row"' : "";
      const executionIdLink = `/ui/recommendations?executionId=${encodeURIComponent(exec.execution_id)}`;

      return `
        <tr ${errorStyle}>
          <td><a href="${executionIdLink}" class="execution-id-link" title="この実行の推奨入札を見る">${escapeHtml(exec.execution_id.substring(0, 8))}...</a></td>
          <td>${formatDateTime(exec.started_at)}</td>
          <td>${formatDateTime(exec.ended_at)}</td>
          <td>${formatDuration(exec.duration_ms)}</td>
          <td><span class="mode-badge ${exec.mode === "APPLY" ? "mode-apply" : "mode-shadow"}">${escapeHtml(exec.mode)}</span></td>
          <td><span class="status-badge" style="background-color: ${statusColor};">${escapeHtml(exec.status)}</span></td>
          <td style="text-align: right;">${exec.total_keywords ?? "-"}</td>
          <td style="text-align: right;">${exec.reco_count ?? "-"}</td>
          <td style="text-align: right;">${exec.action_up ?? "-"}</td>
          <td style="text-align: right;">${exec.action_down ?? "-"}</td>
          <td style="text-align: right;">${exec.action_keep ?? "-"}</td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(exec.error_message)}">${escapeHtml(exec.error_message) || "-"}</td>
        </tr>
      `;
    })
    .join("");

  const modeOptions = ["", "SHADOW", "APPLY"]
    .map(
      (m) =>
        `<option value="${m}" ${filters.mode === m ? "selected" : ""}>${m || "すべて"}</option>`
    )
    .join("");

  const statusOptions = ["", "SUCCESS", "FAILED", "PARTIAL", "RUNNING"]
    .map(
      (s) =>
        `<option value="${s}" ${filters.status === s ? "selected" : ""}>${s || "すべて"}</option>`
    )
    .join("");

  // フィルタ情報バナー（executionIdが指定されている場合）
  const filterInfoBanner = executionId
    ? `
    <div class="filter-info">
      <span class="filter-label">実行IDでフィルタ中:</span>
      <span class="filter-value">${escapeHtml(executionId)}</span>
      <a href="/ui/executions">フィルタを解除</a>
    </div>
    `
    : "";

  return `
    <p class="view-description">入札エンジンの実行ログとモードの履歴を確認できます。</p>

    ${filterInfoBanner}
    <form class="filters" method="GET" action="/ui/executions">
      <label>
        表示件数:
        <select name="limit">
          <option value="20" ${limit === 20 ? "selected" : ""}>20</option>
          <option value="50" ${limit === 50 ? "selected" : ""}>50</option>
          <option value="100" ${limit === 100 ? "selected" : ""}>100</option>
          <option value="200" ${limit === 200 ? "selected" : ""}>200</option>
        </select>
      </label>
      <label>
        モード:
        <select name="mode">
          ${modeOptions}
        </select>
      </label>
      <label>
        ステータス:
        <select name="status">
          ${statusOptions}
        </select>
      </label>
      <button type="submit">フィルター適用</button>
    </form>

    <div class="summary">
      全 ${total} 件中 ${executions.length} 件を表示
    </div>

    ${
      executions.length === 0
        ? '<div class="empty-state">該当するデータはありません（フィルタ条件や期間を見直してください）。</div>'
        : `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>実行ID</th>
            <th>開始日時</th>
            <th>終了日時</th>
            <th>所要時間</th>
            <th>モード</th>
            <th>ステータス</th>
            <th class="numeric">総KW数</th>
            <th class="numeric">推奨数</th>
            <th class="numeric">UP</th>
            <th class="numeric">DOWN</th>
            <th class="numeric">KEEP</th>
            <th>エラー</th>
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
 * 実行履歴ビューをレンダリング
 */
export async function renderExecutionsView(req: Request, res: Response): Promise<void> {
  const env = process.env.NODE_ENV || "development";

  // グローバルアラートを取得
  const globalAlert = await fetchGlobalAlert();

  try {
    // クエリパラメータを取得
    const limitParam = parseInt(req.query.limit as string, 10);
    const limit = Math.min(
      Math.max(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, 1),
      MAX_LIMIT
    );

    const filters: ExecutionFilter = {};
    if (req.query.mode && typeof req.query.mode === "string") {
      filters.mode = req.query.mode;
    }
    if (req.query.status && typeof req.query.status === "string") {
      filters.status = req.query.status;
    }
    // executionIdフィルタ
    const executionId = typeof req.query.executionId === "string" && req.query.executionId.trim()
      ? req.query.executionId.trim()
      : undefined;
    if (executionId) {
      filters.execution_id = executionId;
    }

    logger.debug("renderExecutionsView", { limit, filters, executionId });

    // BigQueryから実行履歴を取得
    const { records, total } = await listExecutions(limit, 0, filters);

    // コンテンツを生成
    const contentHtml = buildExecutionsContent(records, total, limit, filters, executionId);

    // 共通レイアウトでレンダリング
    const html = renderLayout({
      title: "実行履歴ビュー",
      subtitle: "入札エンジンの実行状況を確認します。",
      env,
      contentHtml,
      extraStyles: executionsExtraStyles,
      currentPath: "/ui/executions",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  } catch (error) {
    // ログにはエラー詳細を記録（スタックトレース含む）
    logger.error("Failed to render executions view", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // エラーコンテンツを生成
    const errorMessage = error instanceof Error ? error.message : String(error);
    const contentHtml = buildErrorContent(
      errorMessage,
      "実行履歴の取得中にエラーが発生しました。BigQuery 接続エラーの可能性があります。"
    );

    // 共通レイアウトでエラーページをレンダリング（HTTP 200）
    const html = renderLayout({
      title: "実行履歴ビュー エラー",
      subtitle: "実行履歴の取得中にエラーが発生しました。",
      env,
      contentHtml,
      currentPath: "/ui/executions",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  }
}

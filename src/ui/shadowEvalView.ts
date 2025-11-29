/**
 * SHADOW評価ビュー
 *
 * BigQuery shadow_eval_keyword_7d ビューのデータをHTML形式で表示
 * SHADOWモードで提案された入札が事後的に正しかったか評価する
 */

import { Request, Response } from "express";
import { logger } from "../logger";
import { renderLayout, buildErrorContent, escapeHtml } from "./layout";
import { fetchGlobalAlert } from "./globalAlert";
import {
  listShadowEval,
  countShadowEval,
  getShadowEvalAccuracySummary,
  ShadowEvalRow,
  ShadowEvalListParams,
} from "../admin/repositories/shadowEvalRepo";

// =============================================================================
// 定数
// =============================================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ALLOWED_LIMITS = [20, 50, 100, 200];

// =============================================================================
// 型定義
// =============================================================================

/**
 * フィルタ条件
 */
interface ShadowEvalFilterParams {
  limit: number;
  executionId?: string;
  lifecycleStage?: string;
  onlyBad?: boolean;
  direction?: string;
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
 * 数値をフォーマット（小数点以下の桁数指定）
 */
function formatNumber(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return "-";
  return value.toFixed(decimals);
}

/**
 * パーセンテージをフォーマット
 */
function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * クエリパラメータをパース
 */
function parseFilterParams(req: Request): ShadowEvalFilterParams {
  // limit
  const limitParam = parseInt(req.query.limit as string, 10);
  const limit = ALLOWED_LIMITS.includes(limitParam) ? limitParam : DEFAULT_LIMIT;

  // executionId
  const executionId = typeof req.query.executionId === "string" && req.query.executionId.trim()
    ? req.query.executionId.trim()
    : undefined;

  // lifecycleStage
  const lifecycleStage = typeof req.query.lifecycleStage === "string" && req.query.lifecycleStage.trim()
    ? req.query.lifecycleStage.trim()
    : undefined;

  // onlyBad
  const onlyBad = req.query.onlyBad === "1";

  // direction
  const direction = typeof req.query.direction === "string" && req.query.direction.trim()
    ? req.query.direction.trim()
    : undefined;

  return { limit, executionId, lifecycleStage, onlyBad, direction };
}

// =============================================================================
// コンテンツ生成
// =============================================================================

/**
 * SHADOW評価ページ固有のスタイル
 */
const shadowEvalExtraStyles = `
  .bad-decision-row {
    background-color: #fff5f5;
  }
  .good-decision-row {
    background-color: #f0fff4;
  }
  .direction-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .direction-up {
    background: #c6f6d5;
    color: #22543d;
  }
  .direction-down {
    background: #fed7d7;
    color: #742a2a;
  }
  .direction-keep {
    background: #e2e8f0;
    color: #4a5568;
  }
  .decision-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .decision-good {
    background: #c6f6d5;
    color: #22543d;
  }
  .decision-bad {
    background: #fed7d7;
    color: #742a2a;
  }
  .decision-unknown {
    background: #e2e8f0;
    color: #4a5568;
  }
  .accuracy-summary {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }
  .accuracy-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem 1.5rem;
    min-width: 180px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .accuracy-card-title {
    font-size: 0.85rem;
    color: #718096;
    margin-bottom: 0.5rem;
  }
  .accuracy-card-value {
    font-size: 1.5rem;
    font-weight: 700;
  }
  .accuracy-card-detail {
    font-size: 0.75rem;
    color: #a0aec0;
    margin-top: 0.25rem;
  }
`;

/**
 * 精度サマリーカードを生成
 */
function buildAccuracySummaryHtml(
  summary: Array<{ direction: string; good_count: number; total: number; accuracy: number | null }>
): string {
  if (summary.length === 0) {
    return '<div class="accuracy-summary"><p>精度データはまだありません。</p></div>';
  }

  const cards = summary.map((item) => {
    const accuracyText = item.accuracy !== null
      ? `${(item.accuracy * 100).toFixed(1)}%`
      : "-";

    let colorClass = "";
    if (item.accuracy !== null) {
      if (item.accuracy >= 0.7) colorClass = "color: #38a169;";
      else if (item.accuracy >= 0.5) colorClass = "color: #d69e2e;";
      else colorClass = "color: #e53e3e;";
    }

    return `
      <div class="accuracy-card">
        <div class="accuracy-card-title">${escapeHtml(item.direction)} 方向</div>
        <div class="accuracy-card-value" style="${colorClass}">${accuracyText}</div>
        <div class="accuracy-card-detail">${item.good_count} / ${item.total} 件正解</div>
      </div>
    `;
  }).join("");

  return `<div class="accuracy-summary">${cards}</div>`;
}

/**
 * SHADOW評価コンテンツを生成
 */
function buildShadowEvalContent(
  records: ShadowEvalRow[],
  total: number,
  filters: ShadowEvalFilterParams,
  accuracySummary: Array<{ direction: string; good_count: number; total: number; accuracy: number | null }>
): string {
  const tableRows = records
    .map((rec) => {
      // 行クラスを決定
      let rowClass = "";
      if (rec.was_good_decision === true) {
        rowClass = "good-decision-row";
      } else if (rec.was_good_decision === false) {
        rowClass = "bad-decision-row";
      }

      // 方向バッジ
      let directionBadge = "";
      if (rec.direction === "UP") {
        directionBadge = '<span class="direction-badge direction-up">UP</span>';
      } else if (rec.direction === "DOWN") {
        directionBadge = '<span class="direction-badge direction-down">DOWN</span>';
      } else if (rec.direction === "KEEP") {
        directionBadge = '<span class="direction-badge direction-keep">KEEP</span>';
      } else {
        directionBadge = '<span class="direction-badge">-</span>';
      }

      // 判定バッジ
      let decisionBadge = "";
      if (rec.was_good_decision === true) {
        decisionBadge = '<span class="decision-badge decision-good">正解</span>';
      } else if (rec.was_good_decision === false) {
        decisionBadge = '<span class="decision-badge decision-bad">外れ</span>';
      } else {
        decisionBadge = '<span class="decision-badge decision-unknown">未評価</span>';
      }

      // 入札差額の表示
      const bidGapColor = rec.bid_gap > 0 ? "#38a169" : rec.bid_gap < 0 ? "#e53e3e" : "#718096";

      return `
        <tr class="${rowClass}">
          <td style="font-family: monospace; font-size: 0.75rem;">${escapeHtml(rec.execution_id?.substring(0, 8))}...</td>
          <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(rec.keyword_text)}">${escapeHtml(rec.keyword_text)}</td>
          <td>${escapeHtml(rec.asin)}</td>
          <td style="text-align: right;">$${formatNumber(rec.bid_recommended)}</td>
          <td style="text-align: right;">$${formatNumber(rec.bid_actual)}</td>
          <td style="text-align: right; color: ${bidGapColor};">${rec.bid_gap > 0 ? "+" : ""}${formatNumber(rec.bid_gap)}</td>
          <td style="text-align: right;">${formatPercent(rec.bid_gap_rate)}</td>
          <td style="text-align: right;">${rec.clicks ?? "-"}</td>
          <td style="text-align: right;">${rec.orders ?? "-"}</td>
          <td style="text-align: right;">$${rec.sales !== null ? formatNumber(rec.sales, 0) : "-"}</td>
          <td style="text-align: right;">$${rec.cost !== null ? formatNumber(rec.cost, 0) : "-"}</td>
          <td style="text-align: right;">${formatPercent(rec.acos)}</td>
          <td style="text-align: right;">${formatPercent(rec.tacos)}</td>
          <td>${directionBadge}</td>
          <td>${decisionBadge}</td>
          <td>${formatDateTime(rec.recommended_at)}</td>
        </tr>
      `;
    })
    .join("");

  const limitOptions = ALLOWED_LIMITS
    .map((l) => `<option value="${l}" ${filters.limit === l ? "selected" : ""}>${l}</option>`)
    .join("");

  const directionOptions = [
    { value: "", label: "すべて" },
    { value: "UP", label: "UP のみ" },
    { value: "DOWN", label: "DOWN のみ" },
    { value: "KEEP", label: "KEEP のみ" },
  ]
    .map((opt) => `<option value="${opt.value}" ${filters.direction === opt.value ? "selected" : ""}>${opt.label}</option>`)
    .join("");

  // クイックフィルタURL
  const buildQuickFilterUrl = (onlyBad: boolean): string => {
    const params = new URLSearchParams();
    if (filters.limit !== DEFAULT_LIMIT) params.set("limit", String(filters.limit));
    if (filters.executionId) params.set("executionId", filters.executionId);
    if (filters.lifecycleStage) params.set("lifecycleStage", filters.lifecycleStage);
    if (filters.direction) params.set("direction", filters.direction);
    if (onlyBad) params.set("onlyBad", "1");
    const qs = params.toString();
    return `/ui/shadow-eval${qs ? "?" + qs : ""}`;
  };

  const onlyBadUrl = buildQuickFilterUrl(!filters.onlyBad);
  const onlyBadClass = filters.onlyBad ? "rec-quick-filter-btn rec-quick-filter-btn-active" : "rec-quick-filter-btn";

  return `
    <p class="view-description">SHADOWモードで提案された入札の事後評価です。was_good_decision が「外れ」の行は赤くハイライトされます。</p>

    <h3 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">方向別精度</h3>
    ${buildAccuracySummaryHtml(accuracySummary)}

    <form class="filters" method="GET" action="/ui/shadow-eval">
      <label>
        表示件数:
        <select name="limit">
          ${limitOptions}
        </select>
      </label>
      <label>
        方向:
        <select name="direction">
          ${directionOptions}
        </select>
      </label>
      <label>
        execution_id:
        <input type="text" name="executionId" value="${escapeHtml(filters.executionId)}" placeholder="例: exec_20241126_...">
      </label>
      <label>
        lifecycle_stage:
        <input type="text" name="lifecycleStage" value="${escapeHtml(filters.lifecycleStage)}" placeholder="例: growth">
      </label>
      <button type="submit">フィルター適用</button>
    </form>

    <div class="rec-quick-filters">
      <a href="${onlyBadUrl}" class="${onlyBadClass}">外れのみ表示</a>
    </div>

    <div class="summary">
      全 ${total} 件中 ${records.length} 件を表示
    </div>

    ${
      records.length === 0
        ? '<div class="empty-state">該当するデータはありません。SHADOWモードでの実行履歴がない可能性があります。</div>'
        : `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>実行ID</th>
            <th>キーワード</th>
            <th>ASIN</th>
            <th class="numeric">推奨入札</th>
            <th class="numeric">実入札</th>
            <th class="numeric">差額</th>
            <th class="numeric">乖離率</th>
            <th class="numeric">Click</th>
            <th class="numeric">注文</th>
            <th class="numeric">売上</th>
            <th class="numeric">コスト</th>
            <th class="numeric">ACOS</th>
            <th class="numeric">TACOS</th>
            <th>方向</th>
            <th>判定</th>
            <th>推奨日時</th>
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
 * SHADOW評価ビューをレンダリング
 */
export async function renderShadowEvalView(req: Request, res: Response): Promise<void> {
  const env = process.env.NODE_ENV || "development";

  // グローバルアラートを取得
  const globalAlert = await fetchGlobalAlert();

  try {
    // クエリパラメータをパース
    const filters = parseFilterParams(req);

    logger.debug("renderShadowEvalView", { filters });

    // パラメータを変換
    const repoParams: ShadowEvalListParams = {
      limit: filters.limit,
      executionId: filters.executionId,
      lifecycleStage: filters.lifecycleStage,
      onlyBad: filters.onlyBad,
      direction: filters.direction,
    };

    // 並列でデータを取得
    const [records, total, accuracySummary] = await Promise.all([
      listShadowEval(repoParams),
      countShadowEval(repoParams),
      getShadowEvalAccuracySummary(),
    ]);

    // コンテンツを生成
    const contentHtml = buildShadowEvalContent(records, total, filters, accuracySummary);

    // 共通レイアウトでレンダリング
    const html = renderLayout({
      title: "SHADOW評価ビュー",
      subtitle: "SHADOWモードの入札提案が正しかったか事後評価します。",
      env,
      contentHtml,
      extraStyles: shadowEvalExtraStyles,
      currentPath: "/ui/shadow-eval",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  } catch (error) {
    // ログにはエラー詳細を記録
    logger.error("Failed to render shadow eval view", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // エラーコンテンツを生成
    const errorMessage = error instanceof Error ? error.message : String(error);
    const contentHtml = buildErrorContent(
      errorMessage,
      "SHADOW評価データの取得中にエラーが発生しました。BigQueryビュー shadow_eval_keyword_7d が存在しない可能性があります。"
    );

    // 共通レイアウトでエラーページをレンダリング
    const html = renderLayout({
      title: "SHADOW評価ビュー エラー",
      subtitle: "SHADOW評価データの取得中にエラーが発生しました。",
      env,
      contentHtml,
      currentPath: "/ui/shadow-eval",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  }
}

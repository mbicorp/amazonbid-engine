/**
 * 推奨入札ビュー
 *
 * BigQuery keyword_recommendations_log テーブルのデータをHTML形式で表示
 * 閲覧専用であり、この画面から入札適用は行わない
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
const MAX_LIMIT = 200;
const ALLOWED_LIMITS = [20, 50, 100, 200];

// =============================================================================
// 型定義
// =============================================================================

/**
 * フィルタ条件
 */
interface RecommendationFilterParams {
  limit: number;
  applied: "all" | "applied" | "pending";
  reason?: string;
  executionId?: string;
  strongOnly?: boolean;
  pendingOnly?: boolean;
}

/**
 * 推奨入札レコード
 */
interface RecommendationRecord {
  recommended_at: string;
  execution_id: string;
  asin: string;
  keyword_text: string;
  match_type: string | null;
  old_bid: number;
  new_bid: number;
  bid_change: number | null;
  target_acos: number | null;
  current_acos: number | null;
  acos_gap: number | null;
  reason_code: string;
  lifecycle_state: string | null;
  impressions_7d: number | null;
  clicks_7d: number | null;
  conversions_7d: number | null;
  sales_7d: number | null;
  cvr_7d: number | null;
  is_applied: boolean;
  applied_at: string | null;
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
function parseFilterParams(req: Request): RecommendationFilterParams {
  // limit
  const limitParam = parseInt(req.query.limit as string, 10);
  const limit = ALLOWED_LIMITS.includes(limitParam) ? limitParam : DEFAULT_LIMIT;

  // applied
  const appliedParam = req.query.applied as string;
  let applied: "all" | "applied" | "pending" = "all";
  if (appliedParam === "applied" || appliedParam === "pending") {
    applied = appliedParam;
  }

  // reason
  const reason = typeof req.query.reason === "string" && req.query.reason.trim()
    ? req.query.reason.trim()
    : undefined;

  // executionId
  const executionId = typeof req.query.executionId === "string" && req.query.executionId.trim()
    ? req.query.executionId.trim()
    : undefined;

  // strongOnly
  const strongOnly = req.query.strongOnly === "1";

  // pendingOnly
  const pendingOnly = req.query.pendingOnly === "1";

  return { limit, applied, reason, executionId, strongOnly, pendingOnly };
}

// =============================================================================
// BigQuery クエリ
// =============================================================================

/**
 * 推奨入札レコードを取得
 */
async function listRecommendations(
  filters: RecommendationFilterParams
): Promise<{ records: RecommendationRecord[]; total: number }> {
  const tableName = getFullTableName("keyword_recommendations_log");

  // フィルタ条件を構築
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit: filters.limit };

  if (filters.applied === "applied") {
    conditions.push("is_applied = TRUE");
  } else if (filters.applied === "pending") {
    conditions.push("is_applied = FALSE");
  }

  if (filters.reason) {
    conditions.push("reason_code = @reason");
    params.reason = filters.reason;
  }

  if (filters.executionId) {
    conditions.push("execution_id = @executionId");
    params.executionId = filters.executionId;
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
      CAST(recommended_at AS STRING) as recommended_at,
      execution_id,
      asin,
      keyword_text,
      match_type,
      old_bid,
      new_bid,
      bid_change,
      target_acos,
      current_acos,
      acos_gap,
      reason_code,
      lifecycle_state,
      impressions_7d,
      clicks_7d,
      conversions_7d,
      sales_7d,
      cvr_7d,
      is_applied,
      CAST(applied_at AS STRING) as applied_at
    FROM \`${tableName}\`
    ${whereClause}
    ORDER BY recommended_at DESC
    LIMIT @limit
  `;

  const records = await executeQuery<RecommendationRecord>(dataQuery, params);

  logger.debug("listRecommendations", { filters, total, count: records.length });

  return { records, total };
}

// =============================================================================
// コンテンツ生成
// =============================================================================

/**
 * 推奨入札ページ固有のスタイル
 */
const recommendationsExtraStyles = `
  .applied-row {
    background-color: #f0fff4;
  }
  .reason-badge {
    background: #edf2f7;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.8rem;
  }
`;

/**
 * 推奨入札コンテンツを生成
 */
function buildRecommendationsContent(
  records: RecommendationRecord[],
  total: number,
  filters: RecommendationFilterParams
): string {
  // クライアントサイドフィルタリング（strongOnly, pendingOnly）
  let filteredRecords = records;

  if (filters.strongOnly) {
    filteredRecords = filteredRecords.filter((rec) => {
      const changeRatio = rec.old_bid > 0 && rec.bid_change !== null
        ? Math.abs(rec.bid_change) / rec.old_bid
        : 0;
      return changeRatio >= 0.5;
    });
  }

  if (filters.pendingOnly) {
    filteredRecords = filteredRecords.filter((rec) => !rec.is_applied);
  }

  const tableRows = filteredRecords
    .map((rec) => {
      // 大幅変動かどうか判定（50%以上の変動率）
      const changeRatio = rec.old_bid > 0 && rec.bid_change !== null
        ? Math.abs(rec.bid_change) / rec.old_bid
        : 0;
      const isStrongChange = changeRatio >= 0.5;

      // 行クラスを構築（適用済み、大幅変動）
      const rowClasses: string[] = [];
      if (rec.is_applied) rowClasses.push("applied-row");
      if (isStrongChange) rowClasses.push("recommendation-strong");
      const rowClassAttr = rowClasses.length > 0 ? `class="${rowClasses.join(" ")}"` : "";

      const bidChangeColor = rec.bid_change !== null
        ? rec.bid_change > 0 ? "#38a169" : rec.bid_change < 0 ? "#e53e3e" : "#718096"
        : "#718096";

      // ステータスバッジを生成
      const statusBadge = rec.is_applied
        ? '<span class="status-badge status-badge-applied">適用済</span>'
        : '<span class="status-badge status-badge-pending">未適用</span>';

      return `
        <tr ${rowClassAttr}>
          <td>${formatDateTime(rec.recommended_at)}</td>
          <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(rec.execution_id?.substring(0, 8))}...</td>
          <td>${escapeHtml(rec.asin)}</td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(rec.keyword_text)}">${escapeHtml(rec.keyword_text)}</td>
          <td>${escapeHtml(rec.match_type) || "-"}</td>
          <td style="text-align: right;">$${formatNumber(rec.old_bid)}</td>
          <td style="text-align: right;">$${formatNumber(rec.new_bid)}</td>
          <td style="text-align: right; color: ${bidChangeColor}; font-weight: 600;">${rec.bid_change !== null ? (rec.bid_change > 0 ? "+" : "") + formatNumber(rec.bid_change) : "-"}</td>
          <td style="text-align: right;">${formatPercent(rec.target_acos)}</td>
          <td style="text-align: right;">${formatPercent(rec.current_acos)}</td>
          <td style="text-align: right;">${formatPercent(rec.acos_gap)}</td>
          <td><span class="reason-badge">${escapeHtml(rec.reason_code)}</span></td>
          <td>${statusBadge}</td>
          <td style="text-align: right;">${rec.impressions_7d ?? "-"}</td>
          <td style="text-align: right;">${rec.clicks_7d ?? "-"}</td>
          <td style="text-align: right;">${rec.conversions_7d ?? "-"}</td>
          <td style="text-align: right;">$${rec.sales_7d !== null ? formatNumber(rec.sales_7d, 0) : "-"}</td>
          <td style="text-align: right;">${formatPercent(rec.cvr_7d)}</td>
        </tr>
      `;
    })
    .join("");

  const limitOptions = ALLOWED_LIMITS
    .map((l) => `<option value="${l}" ${filters.limit === l ? "selected" : ""}>${l}</option>`)
    .join("");

  const appliedOptions = [
    { value: "all", label: "すべて" },
    { value: "applied", label: "適用済のみ" },
    { value: "pending", label: "未適用のみ" },
  ]
    .map((opt) => `<option value="${opt.value}" ${filters.applied === opt.value ? "selected" : ""}>${opt.label}</option>`)
    .join("");

  // フィルタ情報バナー（executionIdが指定されている場合）
  const filterInfoBanner = filters.executionId
    ? `
    <div class="filter-info">
      <span class="filter-label">実行IDでフィルタ中:</span>
      <span class="filter-value">${escapeHtml(filters.executionId)}</span>
      <a href="/ui/recommendations">フィルタを解除</a>
    </div>
    `
    : "";

  // クイックフィルタボタンのURL生成
  const buildQuickFilterUrl = (toggle: "strongOnly" | "pendingOnly"): string => {
    const params = new URLSearchParams();
    if (filters.limit !== DEFAULT_LIMIT) params.set("limit", String(filters.limit));
    if (filters.applied !== "all") params.set("applied", filters.applied);
    if (filters.reason) params.set("reason", filters.reason);
    if (filters.executionId) params.set("executionId", filters.executionId);

    // トグル動作: 現在ONならOFFに、OFFならONに
    if (toggle === "strongOnly") {
      if (!filters.strongOnly) params.set("strongOnly", "1");
      // 他のフィルタは維持
      if (filters.pendingOnly) params.set("pendingOnly", "1");
    } else {
      if (!filters.pendingOnly) params.set("pendingOnly", "1");
      // 他のフィルタは維持
      if (filters.strongOnly) params.set("strongOnly", "1");
    }

    const qs = params.toString();
    return `/ui/recommendations${qs ? "?" + qs : ""}`;
  };

  const strongOnlyUrl = buildQuickFilterUrl("strongOnly");
  const pendingOnlyUrl = buildQuickFilterUrl("pendingOnly");
  const strongOnlyClass = filters.strongOnly ? "rec-quick-filter-btn rec-quick-filter-btn-active" : "rec-quick-filter-btn";
  const pendingOnlyClass = filters.pendingOnly ? "rec-quick-filter-btn rec-quick-filter-btn-active" : "rec-quick-filter-btn";

  // サマリーテキスト（クイックフィルタ適用後の件数を表示）
  const summaryText = (filters.strongOnly || filters.pendingOnly)
    ? `全 ${total} 件中 ${records.length} 件取得、クイックフィルタ適用後 ${filteredRecords.length} 件表示`
    : `全 ${total} 件中 ${filteredRecords.length} 件を表示`;

  return `
    <p class="view-description">選択した実行IDの推奨入札結果とステータスを確認できます。</p>

    ${filterInfoBanner}
    <form class="filters" method="GET" action="/ui/recommendations">
      <label>
        表示件数:
        <select name="limit">
          ${limitOptions}
        </select>
      </label>
      <label>
        適用状態:
        <select name="applied">
          ${appliedOptions}
        </select>
      </label>
      <label>
        reason_code:
        <input type="text" name="reason" value="${escapeHtml(filters.reason)}" placeholder="例: ACOS_HIGH">
      </label>
      <label>
        execution_id:
        <input type="text" name="executionId" value="${escapeHtml(filters.executionId)}" placeholder="例: exec_20241126_...">
      </label>
      <button type="submit">フィルター適用</button>
    </form>

    <div class="rec-quick-filters">
      <a href="${strongOnlyUrl}" class="${strongOnlyClass}">強い変更のみ</a>
      <a href="${pendingOnlyUrl}" class="${pendingOnlyClass}">PENDINGのみ</a>
    </div>

    <div class="summary">
      ${summaryText}
    </div>

    ${
      filteredRecords.length === 0
        ? '<div class="empty-state">該当するデータはありません（フィルタ条件や期間を見直してください）。</div>'
        : `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>推奨日時</th>
            <th>実行ID</th>
            <th>ASIN</th>
            <th>キーワード</th>
            <th>マッチ</th>
            <th class="numeric">旧入札</th>
            <th class="numeric">新入札</th>
            <th class="numeric">変更額</th>
            <th class="numeric">目標ACOS</th>
            <th class="numeric">現ACOS</th>
            <th class="numeric">ACOS差</th>
            <th>理由</th>
            <th>適用</th>
            <th class="numeric">IMP</th>
            <th class="numeric">Click</th>
            <th class="numeric">CV</th>
            <th class="numeric">売上</th>
            <th class="numeric">CVR</th>
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
 * 推奨入札ビューをレンダリング
 */
export async function renderRecommendationsView(req: Request, res: Response): Promise<void> {
  const env = process.env.NODE_ENV || "development";

  // グローバルアラートを取得
  const globalAlert = await fetchGlobalAlert();

  try {
    // クエリパラメータをパース
    const filters = parseFilterParams(req);

    logger.debug("renderRecommendationsView", { filters });

    // BigQueryから推奨入札データを取得
    const { records, total } = await listRecommendations(filters);

    // コンテンツを生成
    const contentHtml = buildRecommendationsContent(records, total, filters);

    // 共通レイアウトでレンダリング
    const html = renderLayout({
      title: "推奨入札ビュー",
      subtitle: "入札エンジンの推奨入札結果を確認します。",
      env,
      contentHtml,
      extraStyles: recommendationsExtraStyles,
      currentPath: "/ui/recommendations",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  } catch (error) {
    // ログにはエラー詳細を記録（スタックトレース含む）
    logger.error("Failed to render recommendations view", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // エラーコンテンツを生成
    const errorMessage = error instanceof Error ? error.message : String(error);
    const contentHtml = buildErrorContent(
      errorMessage,
      "推奨入札の取得中にエラーが発生しました。BigQuery 接続エラーの可能性があります。"
    );

    // 共通レイアウトでエラーページをレンダリング（HTTP 200）
    const html = renderLayout({
      title: "推奨入札ビュー エラー",
      subtitle: "推奨入札の取得中にエラーが発生しました。",
      env,
      contentHtml,
      currentPath: "/ui/recommendations",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  }
}

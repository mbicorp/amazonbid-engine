/**
 * SHADOW日次サマリービュー
 *
 * BigQuery daily_shadow_summary ビューのデータをHTML形式で表示
 * SHADOWモードの入札提案の日次精度を俯瞰し、AI分析用テキストを生成する
 */

import { Request, Response } from "express";
import { logger } from "../logger";
import { renderLayout, buildErrorContent, escapeHtml } from "./layout";
import { fetchGlobalAlert } from "./globalAlert";
import {
  listDailyShadowSummary,
  getLatestDailyShadowSummary,
  DailyShadowSummary,
} from "../bigquery/dailyShadowSummaryRepo";

// =============================================================================
// 定数
// =============================================================================

const DEFAULT_LIMIT = 30;
const ALLOWED_LIMITS = [20, 30, 60];

// =============================================================================
// ヘルパー関数
// =============================================================================

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
function parseLimitParam(req: Request): number {
  const limitParam = parseInt(req.query.limit as string, 10);
  return ALLOWED_LIMITS.includes(limitParam) ? limitParam : DEFAULT_LIMIT;
}

/**
 * AI分析用サマリーテキストを生成
 */
function buildAiSummaryText(latest: DailyShadowSummary | null): string {
  if (!latest) {
    return "";
  }

  const badRatePercent = (latest.badRate * 100).toFixed(1);

  return `直近の日次SHADOWサマリー（${latest.date}）: SHADOW実行 ${latest.shadowExecutions}回、推奨入札 ${latest.totalRecommendations}件、そのうち外した提案 ${latest.badRecommendations}件（${badRatePercent}%）。この結果をもとに、どのライフサイクルやキーワードタイプで閾値調整が必要か分析してください。`;
}

// =============================================================================
// コンテンツ生成
// =============================================================================

/**
 * SHADOW日次サマリーページ固有のスタイル
 */
const dailyShadowSummaryExtraStyles = `
  .shadow-summary-bad-row {
    background-color: #fff5f5;
  }
  .ai-summary-block {
    margin: 1.5rem 0;
    padding: 1rem;
    background: #f7fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
  }
  .ai-summary-block h4 {
    margin: 0 0 0.75rem 0;
    font-size: 0.9rem;
    color: #4a5568;
  }
  .ai-summary-textarea {
    width: 100%;
    min-height: 80px;
    padding: 0.75rem;
    border: 1px solid #cbd5e0;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.875rem;
    line-height: 1.5;
    resize: vertical;
    background: #fff;
  }
  .ai-summary-textarea:focus {
    outline: none;
    border-color: #4299e1;
    box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.15);
  }
  .copy-button {
    margin-top: 0.5rem;
    padding: 0.5rem 1rem;
    background: #4299e1;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .copy-button:hover {
    background: #3182ce;
  }
  .bad-rate-high {
    color: #e53e3e;
    font-weight: 600;
  }
  .bad-rate-medium {
    color: #d69e2e;
    font-weight: 600;
  }
  .bad-rate-low {
    color: #38a169;
  }
  .stats-row {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 1.5rem;
  }
  .stats-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem 1.5rem;
    min-width: 150px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .stats-card-title {
    font-size: 0.8rem;
    color: #718096;
    margin-bottom: 0.25rem;
  }
  .stats-card-value {
    font-size: 1.25rem;
    font-weight: 700;
  }
`;

/**
 * SHADOW日次サマリーコンテンツを生成
 */
function buildDailyShadowSummaryContent(
  records: DailyShadowSummary[],
  latest: DailyShadowSummary | null,
  limit: number
): string {
  // AI用サマリーテキスト
  const aiSummaryText = buildAiSummaryText(latest);

  // テーブル行を生成
  const tableRows = records
    .map((rec) => {
      // 外れ率に応じて行クラスとスタイルを設定
      let rowClass = "";
      let badRateClass = "bad-rate-low";
      if (rec.badRate >= 0.4) {
        rowClass = "shadow-summary-bad-row";
        badRateClass = "bad-rate-high";
      } else if (rec.badRate >= 0.25) {
        badRateClass = "bad-rate-medium";
      }

      return `
        <tr class="${rowClass}">
          <td>${escapeHtml(rec.date)}</td>
          <td style="text-align: right;">${rec.shadowExecutions}</td>
          <td style="text-align: right;">${rec.totalRecommendations}</td>
          <td style="text-align: right;">${rec.badRecommendations}</td>
          <td style="text-align: right;" class="${badRateClass}">${formatPercent(rec.badRate)}</td>
        </tr>
      `;
    })
    .join("");

  // limit選択肢
  const limitOptions = ALLOWED_LIMITS
    .map((l) => `<option value="${l}" ${limit === l ? "selected" : ""}>${l}日間</option>`)
    .join("");

  // 統計サマリー（最新日のデータ）
  let statsHtml = "";
  if (latest) {
    const avgBadRateClass = latest.badRate >= 0.4 ? "bad-rate-high" : latest.badRate >= 0.25 ? "bad-rate-medium" : "bad-rate-low";
    statsHtml = `
      <div class="stats-row">
        <div class="stats-card">
          <div class="stats-card-title">最新日</div>
          <div class="stats-card-value">${escapeHtml(latest.date)}</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-title">SHADOW実行回数</div>
          <div class="stats-card-value">${latest.shadowExecutions}回</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-title">提案件数</div>
          <div class="stats-card-value">${latest.totalRecommendations}件</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-title">外した提案</div>
          <div class="stats-card-value">${latest.badRecommendations}件</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-title">外れ率</div>
          <div class="stats-card-value ${avgBadRateClass}">${formatPercent(latest.badRate)}</div>
        </div>
      </div>
    `;
  }

  // AI用サマリーブロック
  let aiSummaryHtml = "";
  if (aiSummaryText) {
    aiSummaryHtml = `
      <div class="ai-summary-block">
        <h4>AI分析用サマリーテキスト</h4>
        <textarea class="ai-summary-textarea" id="aiSummaryText" readonly>${escapeHtml(aiSummaryText)}</textarea>
        <button type="button" class="copy-button" onclick="copyAiSummary()">クリップボードにコピー</button>
      </div>
      <script>
        function copyAiSummary() {
          const textarea = document.getElementById('aiSummaryText');
          textarea.select();
          document.execCommand('copy');
          const btn = document.querySelector('.copy-button');
          const originalText = btn.textContent;
          btn.textContent = 'コピーしました！';
          setTimeout(() => { btn.textContent = originalText; }, 2000);
        }
      </script>
    `;
  }

  return `
    <p class="view-description">SHADOWモードの提案が日ごとにどれくらい当たっているかをサマリーで確認できます。</p>

    ${statsHtml}

    ${aiSummaryHtml}

    <form class="filters" method="GET" action="/ui/daily-shadow-summary">
      <label>
        表示期間:
        <select name="limit">
          ${limitOptions}
        </select>
      </label>
      <button type="submit">適用</button>
    </form>

    ${
      records.length === 0
        ? '<div class="empty-state">SHADOWモードのデータがまだありません（SHADOWモードで数日間実行してから再度ご確認ください）。</div>'
        : `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>日付</th>
            <th class="numeric">SHADOW実行回数</th>
            <th class="numeric">提案件数</th>
            <th class="numeric">外した提案件数</th>
            <th class="numeric">外した率</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
    `
    }

    <div style="margin-top: 1.5rem; padding: 1rem; background: #edf2f7; border-radius: 8px; font-size: 0.875rem; color: #4a5568;">
      <strong>💡 使い方</strong><br>
      このサマリーで外れ率が高い日を特定し、<a href="/ui/shadow-eval">SHADOW評価ビュー</a>でその日の詳細を確認してください。<br>
      AI分析用テキストをコピーしてChatGPTやClaudeに貼り付けると、改善点の分析ができます。
    </div>
  `;
}

// =============================================================================
// メインハンドラー
// =============================================================================

/**
 * SHADOW日次サマリービューをレンダリング
 */
export async function renderDailyShadowSummaryView(req: Request, res: Response): Promise<void> {
  const env = process.env.NODE_ENV || "development";

  // グローバルアラートを取得
  const globalAlert = await fetchGlobalAlert();

  try {
    // クエリパラメータをパース
    const limit = parseLimitParam(req);

    logger.debug("renderDailyShadowSummaryView", { limit });

    // 並列でデータを取得
    const [records, latest] = await Promise.all([
      listDailyShadowSummary({ limit }),
      getLatestDailyShadowSummary(),
    ]);

    // コンテンツを生成
    const contentHtml = buildDailyShadowSummaryContent(records, latest, limit);

    // 共通レイアウトでレンダリング
    const html = renderLayout({
      title: "SHADOW日次サマリー",
      subtitle: "SHADOWモードの入札提案の当たり外れを日次単位で集計した結果を確認できます。",
      env,
      contentHtml,
      extraStyles: dailyShadowSummaryExtraStyles,
      currentPath: "/ui/daily-shadow-summary",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  } catch (error) {
    // ログにはエラー詳細を記録
    logger.error("Failed to render daily shadow summary view", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // エラーコンテンツを生成
    const errorMessage = error instanceof Error ? error.message : String(error);
    const contentHtml = buildErrorContent(
      errorMessage,
      "SHADOW日次サマリーの取得中にエラーが発生しました。BigQueryビュー daily_shadow_summary が存在しない可能性があります。"
    );

    // 共通レイアウトでエラーページをレンダリング
    const html = renderLayout({
      title: "SHADOW日次サマリー エラー",
      subtitle: "SHADOW日次サマリーの取得中にエラーが発生しました。",
      env,
      contentHtml,
      currentPath: "/ui/daily-shadow-summary",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  }
}

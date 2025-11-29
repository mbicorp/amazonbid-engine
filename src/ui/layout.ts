/**
 * 管理UI共通レイアウト
 *
 * 全ての管理UIビュー（実行履歴、推奨入札、監視）で統一されたヘッダー・フッターを提供
 */

import { GlobalAlert } from "./globalAlert";

// =============================================================================
// 型定義
// =============================================================================

/**
 * レイアウトオプション
 */
export interface LayoutOptions {
  /** ページタイトル */
  title: string;
  /** ページサブタイトル（任意） */
  subtitle?: string;
  /** 環境名（NODE_ENV） */
  env: string;
  /** ページ固有のコンテンツHTML */
  contentHtml: string;
  /** ページ固有の追加スタイル（任意） */
  extraStyles?: string;
  /** 現在のページパス（ナビゲーションのアクティブ判定用） */
  currentPath?: string;
  /** グローバルアラート（任意） */
  globalAlert?: GlobalAlert | null;
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * HTMLエスケープ
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// =============================================================================
// 共通レイアウト
// =============================================================================

/**
 * 共通レイアウトでHTMLをレンダリング
 */
export function renderLayout(options: LayoutOptions): string {
  const { title, subtitle, env, contentHtml, extraStyles, currentPath, globalAlert } = options;

  const commonStyles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans CJK JP", sans-serif;
      background: #f7fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .layout-header {
      background: linear-gradient(135deg, #1e3a5f, #2d5a87);
      color: white;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .layout-header-left {
      display: flex;
      flex-direction: column;
    }
    .layout-header h1 {
      font-size: 1.4rem;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .layout-header .subtitle {
      font-size: 0.9rem;
      opacity: 0.9;
    }
    .layout-header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .env-badge {
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .env-badge.production {
      background: #e53e3e;
    }
    .env-badge.development {
      background: #38a169;
    }
    .nav-links {
      display: flex;
      gap: 12px;
    }
    .nav-links a {
      color: rgba(255,255,255,0.9);
      text-decoration: none;
      font-size: 0.85rem;
      padding: 4px 8px;
      border-radius: 4px;
      transition: background 0.15s ease;
    }
    .nav-links a:hover {
      background: rgba(255,255,255,0.15);
    }
    /* タブ風ナビゲーションバー */
    .layout-nav {
      background: white;
      padding: 0 24px;
      display: flex;
      gap: 0;
      border-bottom: 1px solid #e2e8f0;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .layout-nav-item {
      display: inline-block;
      padding: 12px 20px;
      text-decoration: none;
      color: #4a5568;
      font-size: 0.9rem;
      font-weight: 500;
      border-bottom: 3px solid transparent;
      transition: all 0.15s ease;
      margin-bottom: -1px;
    }
    .layout-nav-item:hover {
      color: #2d3748;
      background: #f7fafc;
    }
    .layout-nav-item-active {
      color: #667eea;
      font-weight: 600;
      border-bottom-color: #667eea;
    }
    .layout-nav-item-active:hover {
      color: #667eea;
      background: transparent;
    }
    .layout-nav-admin {
      margin-left: auto;
      color: #805ad5;
    }
    .layout-nav-admin:hover {
      color: #6b46c1;
      background: #faf5ff;
    }
    .layout-main {
      flex: 1;
      padding: 24px;
      max-width: 1800px;
      width: 100%;
      margin: 0 auto;
    }
    .layout-footer {
      background: #2d3748;
      color: #a0aec0;
      padding: 16px 24px;
      text-align: center;
      font-size: 0.85rem;
    }
    .layout-footer a {
      color: #63b3ed;
      text-decoration: none;
      margin-left: 8px;
    }
    .layout-footer a:hover {
      text-decoration: underline;
    }
    /* 共通テーブルスタイル */
    .filters {
      background: white;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filters label {
      color: #4a5568;
      font-size: 0.9rem;
    }
    .filters select, .filters input {
      padding: 8px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .filters input {
      width: 180px;
    }
    .filters button {
      background: #667eea;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .filters button:hover {
      background: #5a67d8;
    }
    .summary {
      color: #718096;
      font-size: 0.9rem;
      margin-bottom: 16px;
    }
    .table-wrapper {
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow-x: auto;
      max-height: 70vh;
      overflow-y: auto;
    }
    table, .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    th, .data-table thead th {
      background: #f7fafc;
      color: #4a5568;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    tr:hover, .data-table tbody tr:hover {
      background: #edf2f7;
    }
    /* 数値カラム右揃え */
    .numeric {
      text-align: right;
    }
    /* 画面説明テキスト */
    .view-description {
      color: #4a5568;
      font-size: 0.9rem;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    /* データなし時の空状態メッセージ */
    .empty-state {
      text-align: center;
      padding: 32px 24px;
      margin-top: 16px;
      background: #f7fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      color: #4a5568;
      font-size: 0.9rem;
    }
    /* エラーページ用スタイル */
    .error-content {
      max-width: 600px;
      margin: 48px auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      padding: 32px;
    }
    .error-content .error-icon {
      font-size: 48px;
      text-align: center;
      margin-bottom: 16px;
    }
    .error-content .error-title {
      font-size: 1.25rem;
      color: #1a202c;
      margin-bottom: 16px;
      text-align: center;
    }
    .error-content .error-description {
      color: #4a5568;
      margin-bottom: 16px;
      line-height: 1.6;
    }
    .error-content .error-message {
      background: #fff5f5;
      border: 1px solid #feb2b2;
      padding: 12px 16px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.85rem;
      color: #c53030;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 200px;
      overflow-y: auto;
    }
    /* リンクスタイル */
    .execution-id-link {
      color: #667eea;
      text-decoration: none;
      font-family: monospace;
      font-size: 0.85rem;
    }
    .execution-id-link:hover {
      text-decoration: underline;
    }
    /* フィルタ情報バナー */
    .filter-info {
      background: #ebf8ff;
      border: 1px solid #90cdf4;
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .filter-info .filter-label {
      color: #2b6cb0;
      font-weight: 600;
    }
    .filter-info .filter-value {
      font-family: monospace;
      background: white;
      padding: 2px 8px;
      border-radius: 4px;
      color: #2d3748;
    }
    .filter-info a {
      color: #3182ce;
      text-decoration: none;
      margin-left: auto;
    }
    .filter-info a:hover {
      text-decoration: underline;
    }
    /* 行内リンクボタン */
    .ex-row-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-start;
    }
    .ex-row-action-btn {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.75rem;
      text-decoration: none;
      border: 1px solid #e2e8f0;
      background: #f7fafc;
      white-space: nowrap;
    }
    .ex-row-action-btn:hover {
      background: #edf2f7;
    }
    .ex-row-action-exec {
      color: #805ad5;
      border-color: rgba(128, 90, 213, 0.4);
    }
    .ex-row-action-exec:hover {
      background: #faf5ff;
    }
    .ex-row-action-reco {
      color: #3182ce;
      border-color: rgba(49, 130, 206, 0.4);
    }
    .ex-row-action-reco:hover {
      background: #ebf8ff;
    }
    /* 簡易フィルタボタン */
    .rec-quick-filters {
      display: flex;
      gap: 8px;
      margin: 8px 0 12px;
      flex-wrap: wrap;
    }
    .rec-quick-filter-btn {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.8rem;
      text-decoration: none;
      border: 1px solid #e2e8f0;
      background: #f7fafc;
      color: #4a5568;
      cursor: pointer;
    }
    .rec-quick-filter-btn:hover {
      background: #edf2f7;
    }
    .rec-quick-filter-btn-active {
      background: #ebf8ff;
      border-color: #3182ce;
      color: #2b6cb0;
    }
    .rec-quick-filter-btn-active:hover {
      background: #bee3f8;
    }
    /* 監視サマリー */
    .monitoring-summary {
      margin-top: 8px;
      margin-bottom: 12px;
      padding: 12px 16px;
      border-radius: 6px;
      background: #edf2f7;
      font-size: 0.9rem;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    .monitoring-summary-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .monitoring-summary-item .label {
      color: #4a5568;
    }
    .monitoring-summary-item .value {
      font-weight: 600;
      color: #2d3748;
    }
    .monitoring-summary-item .value.anomaly {
      color: #e53e3e;
    }
    .monitoring-summary-item .value.apply {
      color: #805ad5;
    }
    .monitoring-summary-item .value.shadow {
      color: #718096;
    }
    /* 推奨入札の強調行（大幅変動） */
    tr.recommendation-strong {
      border-left: 4px solid #ecc94b;
      background: #fffff0;
    }
    tr.recommendation-strong:hover {
      background: #fefcbf;
    }
    /* ステータスバッジ */
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.8rem;
      line-height: 1.4;
      white-space: nowrap;
    }
    .status-badge-applied {
      background: #c6f6d5;
      color: #276749;
    }
    .status-badge-pending {
      background: #e2e8f0;
      color: #4a5568;
    }
    .status-badge-failed {
      background: #fed7d7;
      color: #c53030;
    }
    /* グローバルアラートバー */
    .global-alert {
      margin: 0 24px 0;
      padding: 10px 16px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 0.9rem;
    }
    .global-alert-message {
      flex: 1;
    }
    .global-alert-link {
      text-decoration: underline;
      white-space: nowrap;
    }
    .global-alert-info {
      background: rgba(52, 152, 219, 0.15);
      color: #2980b9;
    }
    .global-alert-info .global-alert-link {
      color: #2980b9;
    }
    .global-alert-warning {
      background: rgba(241, 196, 15, 0.2);
      color: #b7950b;
    }
    .global-alert-warning .global-alert-link {
      color: #b7950b;
    }
    .global-alert-danger {
      background: rgba(231, 76, 60, 0.15);
      color: #c0392b;
    }
    .global-alert-danger .global-alert-link {
      color: #c0392b;
    }
    /* 監視ビュー プリセットリンク */
    .monitoring-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 12px;
    }
    .monitoring-preset-link {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.8rem;
      border: 1px solid #e2e8f0;
      background: #f7fafc;
      color: #4a5568;
      text-decoration: none;
    }
    .monitoring-preset-link:hover {
      background: #edf2f7;
      border-color: #cbd5e0;
    }
    /* トップページのカードバッジ */
    .top-card-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 10px;
      font-size: 0.75rem;
      font-weight: 600;
      color: white;
      margin-left: 8px;
    }
    .top-card-badge-warning {
      background: #dd6b20;
    }
    .top-card-badge-danger {
      background: #e53e3e;
    }
    .top-card-badge-info {
      background: #3182ce;
    }
  `;

  const envBadgeClass = env === "production" ? "production" : "development";

  // グローバルアラートバーのHTML生成
  const globalAlertHtml = globalAlert
    ? `
  <div class="global-alert global-alert-${globalAlert.level}">
    <span class="global-alert-message">${escapeHtml(globalAlert.message)}</span>
    ${globalAlert.linkHref
      ? `<a href="${globalAlert.linkHref}" class="global-alert-link">${escapeHtml(globalAlert.linkLabel ?? "詳細を確認")}</a>`
      : ""
    }
  </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Amazon 広告自動入札ツール</title>
  <style>
    ${commonStyles}
    ${extraStyles || ""}
  </style>
</head>
<body>
  <header class="layout-header">
    <div class="layout-header-left">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
    </div>
    <div class="layout-header-right">
      <span class="env-badge ${envBadgeClass}">${escapeHtml(env)}</span>
      <nav class="nav-links">
        <a href="/">トップ</a>
        <a href="/ui/executions">実行履歴</a>
        <a href="/ui/recommendations">推奨入札</a>
        <a href="/ui/monitoring">監視</a>
        <a href="/admin-panel">管理画面</a>
      </nav>
    </div>
  </header>

  <nav class="layout-nav">
    <a href="/ui/executions" class="layout-nav-item${currentPath === "/ui/executions" ? " layout-nav-item-active" : ""}">実行履歴</a>
    <a href="/ui/recommendations" class="layout-nav-item${currentPath === "/ui/recommendations" ? " layout-nav-item-active" : ""}">推奨入札</a>
    <a href="/ui/monitoring" class="layout-nav-item${currentPath === "/ui/monitoring" ? " layout-nav-item-active" : ""}">監視ビュー</a>
    <a href="/ui/shadow-eval" class="layout-nav-item${currentPath === "/ui/shadow-eval" ? " layout-nav-item-active" : ""}">SHADOW評価</a>
    <a href="/ui/ops-playbook" class="layout-nav-item${currentPath === "/ui/ops-playbook" ? " layout-nav-item-active" : ""}">オペフロー</a>
    <a href="/admin-panel" class="layout-nav-item layout-nav-admin${currentPath === "/admin-panel" ? " layout-nav-item-active" : ""}">Admin</a>
  </nav>
  ${globalAlertHtml}
  <main class="layout-main">
    ${contentHtml}
  </main>

  <footer class="layout-footer">
    Amazon広告自動入札エンジン 管理UI
    <a href="/">トップページへ戻る</a>
  </footer>
</body>
</html>`;
}

/**
 * エラーコンテンツを生成
 */
export function buildErrorContent(errorMessage: string, description: string): string {
  return `
    <div class="error-content">
      <div class="error-icon">&#9888;</div>
      <h2 class="error-title">エラーが発生しました</h2>
      <p class="error-description">${escapeHtml(description)}</p>
      <pre class="error-message">${escapeHtml(errorMessage)}</pre>
    </div>
  `;
}

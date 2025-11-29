/**
 * 運用オペフローページ
 *
 * 日次オペレーションの手順をステップ形式で表示
 * 各監視画面へのリンクを含める
 */

import { Request, Response } from "express";
import { logger } from "../logger";
import { renderLayout } from "./layout";
import { fetchGlobalAlert } from "./globalAlert";

// =============================================================================
// コンテンツ生成
// =============================================================================

/**
 * オペフローページ固有のスタイル
 */
const opsPlaybookExtraStyles = `
  .playbook-container {
    max-width: 900px;
  }
  .playbook-intro {
    background: #f7fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }
  .playbook-intro h3 {
    margin: 0 0 0.5rem 0;
    color: #2d3748;
  }
  .playbook-intro p {
    margin: 0;
    color: #4a5568;
  }
  .playbook-step {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1rem;
    position: relative;
    padding-left: 4rem;
  }
  .playbook-step-number {
    position: absolute;
    left: 1rem;
    top: 1.5rem;
    width: 2rem;
    height: 2rem;
    background: #4299e1;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1rem;
  }
  .playbook-step-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: #2d3748;
    margin-bottom: 0.5rem;
  }
  .playbook-step-description {
    color: #4a5568;
    margin-bottom: 0.75rem;
    line-height: 1.6;
  }
  .playbook-step-links {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .playbook-step-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: #ebf8ff;
    color: #2b6cb0;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 500;
    transition: background 0.2s;
  }
  .playbook-step-link:hover {
    background: #bee3f8;
  }
  .playbook-step-link-external {
    background: #f0fff4;
    color: #276749;
  }
  .playbook-step-link-external:hover {
    background: #c6f6d5;
  }
  .playbook-checklist {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0 0;
  }
  .playbook-checklist li {
    padding: 0.25rem 0;
    padding-left: 1.5rem;
    position: relative;
    color: #4a5568;
  }
  .playbook-checklist li::before {
    content: "\\2610";
    position: absolute;
    left: 0;
    color: #a0aec0;
  }
  .playbook-section-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: #2d3748;
    margin: 2rem 0 1rem 0;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid #e2e8f0;
  }
  .playbook-note {
    background: #fffaf0;
    border: 1px solid #fbd38d;
    border-radius: 8px;
    padding: 1rem 1.5rem;
    margin: 1.5rem 0;
    color: #744210;
  }
  .playbook-note-title {
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
`;

/**
 * オペフローコンテンツを生成
 */
function buildOpsPlaybookContent(): string {
  return `
    <div class="playbook-container">
      <div class="playbook-intro">
        <h3>日次オペレーションガイド</h3>
        <p>このページでは、Amazon自動入札エンジンの日次運用フローを説明します。各ステップの手順に従って、入札状況の確認と必要なアクションを実施してください。</p>
      </div>

      <h2 class="playbook-section-title">朝の確認作業（毎日 9:00〜10:00 推奨）</h2>

      <div class="playbook-step">
        <div class="playbook-step-number">1</div>
        <div class="playbook-step-title">グローバルアラートの確認</div>
        <div class="playbook-step-description">
          各ページのヘッダーに表示されるグローバルアラートを確認します。赤いアラートが表示されている場合は、予算超過や異常が発生しています。
        </div>
        <ul class="playbook-checklist">
          <li>予算損失BREACH状態のASINがないか確認</li>
          <li>実行ヘルス異常がないか確認</li>
        </ul>
        <div class="playbook-step-links">
          <a href="/" class="playbook-step-link">トップページを開く</a>
        </div>
      </div>

      <div class="playbook-step">
        <div class="playbook-step-number">2</div>
        <div class="playbook-step-title">実行ログの確認</div>
        <div class="playbook-step-description">
          直近24時間の入札エンジン実行状況を確認します。実行エラーや異常がないかチェックし、正常に動作していることを確認します。
        </div>
        <ul class="playbook-checklist">
          <li>最新の実行が正常終了しているか確認</li>
          <li>エラーや警告が出ていないか確認</li>
          <li>処理件数が期待通りか確認</li>
        </ul>
        <div class="playbook-step-links">
          <a href="/ui/executions" class="playbook-step-link">実行ログを開く</a>
        </div>
      </div>

      <div class="playbook-step">
        <div class="playbook-step-number">3</div>
        <div class="playbook-step-title">監視ダッシュボードの確認</div>
        <div class="playbook-step-description">
          入札エンジンのヘルス状態と異常検知を確認します。予算推移や実行トレンドをチェックし、問題がないか確認します。
        </div>
        <ul class="playbook-checklist">
          <li>異常検知（Anomaly）タブで異常がないか確認</li>
          <li>トレンドが正常範囲内か確認</li>
        </ul>
        <div class="playbook-step-links">
          <a href="/ui/monitoring" class="playbook-step-link">監視ダッシュボードを開く</a>
          <a href="/ui/monitoring?anomaly=anomalies" class="playbook-step-link">異常のみ表示</a>
        </div>
      </div>

      <h2 class="playbook-section-title">入札レビュー作業</h2>

      <div class="playbook-step">
        <div class="playbook-step-number">4</div>
        <div class="playbook-step-title">推奨入札の確認</div>
        <div class="playbook-step-description">
          入札エンジンが提案した入札変更を確認します。特に「強い変更」（50%以上の変動）は注意深く確認してください。
        </div>
        <ul class="playbook-checklist">
          <li>強い変更（大幅な入札変動）を確認</li>
          <li>未適用（PENDING）の入札を確認</li>
          <li>reason_codeが適切か確認</li>
        </ul>
        <div class="playbook-step-links">
          <a href="/ui/recommendations" class="playbook-step-link">推奨入札を開く</a>
          <a href="/ui/recommendations?strongOnly=1" class="playbook-step-link">強い変更のみ</a>
          <a href="/ui/recommendations?pendingOnly=1" class="playbook-step-link">未適用のみ</a>
        </div>
      </div>

      <div class="playbook-step">
        <div class="playbook-step-number">5</div>
        <div class="playbook-step-title">SHADOW評価の確認（週次）</div>
        <div class="playbook-step-description">
          SHADOWモードで提案された入札が事後的に正しかったか評価します。「外れ」が多い場合は、入札ロジックの調整が必要かもしれません。
        </div>
        <ul class="playbook-checklist">
          <li>方向別精度（UP/DOWN/KEEP）を確認</li>
          <li>「外れ」が多いパターンを分析</li>
          <li>必要に応じてロジック改善を検討</li>
        </ul>
        <div class="playbook-step-links">
          <a href="/ui/shadow-eval" class="playbook-step-link">SHADOW評価を開く</a>
          <a href="/ui/shadow-eval?onlyBad=1" class="playbook-step-link">外れのみ表示</a>
        </div>
      </div>

      <h2 class="playbook-section-title">予算・損失管理</h2>

      <div class="playbook-step">
        <div class="playbook-step-number">6</div>
        <div class="playbook-step-title">予算損失モニタの確認</div>
        <div class="playbook-step-description">
          ASIN別の予算消化状況と損失を確認します。BREACH状態のASINがある場合は、入札を下げるか、予算を調整する必要があります。
        </div>
        <ul class="playbook-checklist">
          <li>BREACH状態のASINがないか確認</li>
          <li>WARNING状態のASINを監視</li>
          <li>投資対効果が悪いASINを特定</li>
        </ul>
        <div class="playbook-step-links">
          <a href="/admin-panel/resources/loss_budget_7d" class="playbook-step-link playbook-step-link-external">予算損失（7日）</a>
          <a href="/admin-panel/resources/loss_budget_30d" class="playbook-step-link playbook-step-link-external">予算損失（30日）</a>
        </div>
      </div>

      <div class="playbook-note">
        <div class="playbook-note-title">注意事項</div>
        <ul style="margin: 0; padding-left: 1.25rem;">
          <li>APPLYモードでの実行は本番環境に影響します。テスト時は必ずSHADOWモードを使用してください。</li>
          <li>大幅な入札変更は慎重に確認し、必要に応じて手動で調整してください。</li>
          <li>異常が検知された場合は、まずログを確認し、原因を特定してから対応してください。</li>
        </ul>
      </div>

      <h2 class="playbook-section-title">追加リソース</h2>

      <div class="playbook-step" style="padding-left: 1.5rem;">
        <div class="playbook-step-title">AdminJSパネル</div>
        <div class="playbook-step-description">
          BigQueryのテーブルやビューを直接確認・操作できる管理パネルです。
        </div>
        <div class="playbook-step-links">
          <a href="/admin-panel" class="playbook-step-link playbook-step-link-external">AdminJSパネルを開く</a>
        </div>
      </div>
    </div>
  `;
}

// =============================================================================
// メインハンドラー
// =============================================================================

/**
 * オペフローページをレンダリング
 */
export async function renderOpsPlaybookView(req: Request, res: Response): Promise<void> {
  const env = process.env.NODE_ENV || "development";

  // グローバルアラートを取得
  const globalAlert = await fetchGlobalAlert();

  try {
    logger.debug("renderOpsPlaybookView");

    // コンテンツを生成
    const contentHtml = buildOpsPlaybookContent();

    // 共通レイアウトでレンダリング
    const html = renderLayout({
      title: "運用オペフロー",
      subtitle: "日次オペレーションの手順とチェックリスト",
      env,
      contentHtml,
      extraStyles: opsPlaybookExtraStyles,
      currentPath: "/ui/ops-playbook",
      globalAlert,
    });

    res.status(200).type("html").send(html);
  } catch (error) {
    logger.error("Failed to render ops playbook view", {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).type("text").send("Internal Server Error");
  }
}

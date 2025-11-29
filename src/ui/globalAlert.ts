/**
 * グローバルアラートモジュール
 *
 * 全 UI ルートで共通の「グローバルアラート判定」を提供
 * BigQuery の監視系ビューから異常状態を検出し、アラートを返す
 */

import { executeQuery, getFullTableName } from "../bigquery/client";
import { logger } from "../logger";

// =============================================================================
// 型定義
// =============================================================================

/**
 * グローバルアラート
 */
export interface GlobalAlert {
  /** アラートレベル */
  level: "info" | "warning" | "danger";
  /** メッセージ */
  message: string;
  /** リンク先URL（任意） */
  linkHref?: string;
  /** リンクラベル（任意） */
  linkLabel?: string;
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * グローバルアラートを取得
 *
 * 次の順序で異常を検出し、最も深刻なアラートを返す:
 * 1. loss_budget_7d/30d に BREACH 状態がある → danger
 * 2. execution_health_recent に異常がある → warning
 * 3. いずれも無い → null
 */
export async function fetchGlobalAlert(): Promise<GlobalAlert | null> {
  try {
    // 1. 予算損失の異常をチェック（BREACH状態）
    const breachAlert = await checkLossBudgetBreach();
    if (breachAlert) {
      return breachAlert;
    }

    // 2. 実行ヘルスの異常をチェック
    const healthAlert = await checkExecutionHealthAnomaly();
    if (healthAlert) {
      return healthAlert;
    }

    // 異常なし
    return null;
  } catch (error) {
    // エラー時はログに記録するが、アラートは表示しない（UIが壊れないようにする）
    logger.warn("Failed to fetch global alert", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * loss_budget_7d / loss_budget_30d の BREACH 状態をチェック
 */
async function checkLossBudgetBreach(): Promise<GlobalAlert | null> {
  try {
    // 7日間と30日間の両方をチェック
    const table7d = getFullTableName("loss_budget_7d");
    const table30d = getFullTableName("loss_budget_30d");

    const query = `
      SELECT 'loss_budget_7d' as source, COUNT(*) as breach_count
      FROM \`${table7d}\`
      WHERE investment_state = 'BREACH'
      UNION ALL
      SELECT 'loss_budget_30d' as source, COUNT(*) as breach_count
      FROM \`${table30d}\`
      WHERE investment_state = 'BREACH'
    `;

    const results = await executeQuery<{ source: string; breach_count: number }>(query, {});

    const total7d = results.find((r) => r.source === "loss_budget_7d")?.breach_count ?? 0;
    const total30d = results.find((r) => r.source === "loss_budget_30d")?.breach_count ?? 0;
    const totalBreach = total7d + total30d;

    if (totalBreach > 0) {
      logger.debug("Global alert: BREACH detected", { total7d, total30d });
      return {
        level: "danger",
        message: `警告: 予算損失が許容上限を超えている ASIN が ${totalBreach} 件存在します。予算モニタを確認してください。`,
        linkHref: "/admin-panel/resources/loss_budget_7d",
        linkLabel: "予算・損失モニタを開く",
      };
    }

    return null;
  } catch (error) {
    // テーブルが存在しない場合などはスキップ
    logger.debug("checkLossBudgetBreach skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * execution_health_recent の異常をチェック
 */
async function checkExecutionHealthAnomaly(): Promise<GlobalAlert | null> {
  try {
    const tableName = getFullTableName("execution_health_recent");

    // 直近24時間の異常件数を取得
    const query = `
      SELECT COUNT(*) as anomaly_count
      FROM \`${tableName}\`
      WHERE is_anomaly_basic = TRUE
        AND execution_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
    `;

    const results = await executeQuery<{ anomaly_count: number }>(query, {});
    const anomalyCount = results[0]?.anomaly_count ?? 0;

    if (anomalyCount > 0) {
      logger.debug("Global alert: Execution health anomaly detected", { anomalyCount });
      return {
        level: "warning",
        message: `警告: 直近24時間の入札エンジン実行で ${anomalyCount} 件の異常が検知されています。監視ビューを確認してください。`,
        linkHref: "/ui/monitoring?anomaly=anomalies",
        linkLabel: "監視ビューを開く",
      };
    }

    return null;
  } catch (error) {
    // テーブルが存在しない場合などはスキップ
    logger.debug("checkExecutionHealthAnomaly skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

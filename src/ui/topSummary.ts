/**
 * トップページサマリーモジュール
 *
 * トップページのカードに表示する「要対応タスク数」を集計する
 * - 強い変更かつ未適用の推奨入札件数
 * - BREACH状態のASIN件数
 */

import { executeQuery, getFullTableName } from "../bigquery/client";
import { logger } from "../logger";

// =============================================================================
// 型定義
// =============================================================================

/**
 * トップページサマリー
 */
export interface TopSummary {
  /** 強い変更かつ未適用の推奨入札件数 */
  strongPendingCount: number;
  /** BREACH状態のASIN件数（7日 + 30日） */
  breachCount: number;
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * トップページのサマリー情報を取得
 */
export async function fetchTopSummary(): Promise<TopSummary> {
  // デフォルト値
  const result: TopSummary = {
    strongPendingCount: 0,
    breachCount: 0,
  };

  // 並列で取得
  const [strongPending, breach] = await Promise.all([
    fetchStrongPendingCount(),
    fetchBreachCount(),
  ]);

  result.strongPendingCount = strongPending;
  result.breachCount = breach;

  logger.debug("fetchTopSummary", { result });

  return result;
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * 強い変更かつ未適用の推奨入札件数を取得
 *
 * 「強い変更」の定義: bid_change / old_bid >= 0.5 (50%以上の変動)
 */
async function fetchStrongPendingCount(): Promise<number> {
  try {
    const tableName = getFullTableName("keyword_recommendations_log");

    // 直近7日間の未適用かつ強い変更のみをカウント
    const query = `
      SELECT COUNT(*) as count
      FROM \`${tableName}\`
      WHERE is_applied = FALSE
        AND recommended_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        AND old_bid > 0
        AND ABS(bid_change) / old_bid >= 0.5
    `;

    const rows = await executeQuery<{ count: number }>(query, {});
    return rows[0]?.count ?? 0;
  } catch (error) {
    logger.warn("Failed to fetch strong pending count", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * BREACH状態のASIN件数を取得（7日 + 30日の合計）
 */
async function fetchBreachCount(): Promise<number> {
  try {
    const table7d = getFullTableName("loss_budget_7d");
    const table30d = getFullTableName("loss_budget_30d");

    // 両方のテーブルからBREACH状態をカウント
    // ASINの重複を避けるためにUNIONでユニーク化
    const query = `
      SELECT COUNT(DISTINCT asin) as count
      FROM (
        SELECT asin FROM \`${table7d}\` WHERE investment_state = 'BREACH'
        UNION ALL
        SELECT asin FROM \`${table30d}\` WHERE investment_state = 'BREACH'
      )
    `;

    const rows = await executeQuery<{ count: number }>(query, {});
    return rows[0]?.count ?? 0;
  } catch (error) {
    // テーブルが存在しない場合などはスキップ
    logger.debug("fetchBreachCount skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

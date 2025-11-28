/**
 * 通知システム
 *
 * ACOS急上昇、投資上限接近、サーキットブレーカー発動などの
 * 重要イベントをSlackに通知
 */

import { logger } from "../logger";

// =============================================================================
// 設定
// =============================================================================

export interface NotificationConfig {
  enabled: boolean;
  slackWebhookUrl: string | null;
  channel?: string;
  username?: string;
  iconEmoji?: string;
}

export interface AlertThresholds {
  acosIncreasePercent: number; // ACOS上昇率（例: 50 = 50%上昇で通知）
  investmentUtilizationPercent: number; // 投資上限消化率（例: 80 = 80%で通知）
  successRateDropPercent: number; // 成功率低下（例: 20 = 20%低下で通知）
}

let notificationConfig: NotificationConfig = {
  enabled: false,
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || null,
  channel: process.env.SLACK_CHANNEL || "#amazon-ads-alerts",
  username: "Amazon Bid Engine",
  iconEmoji: ":robot_face:",
};

const DEFAULT_THRESHOLDS: AlertThresholds = {
  acosIncreasePercent: 50,
  investmentUtilizationPercent: 80,
  successRateDropPercent: 20,
};

// =============================================================================
// 設定管理
// =============================================================================

export function configureNotifications(config: Partial<NotificationConfig>): void {
  notificationConfig = { ...notificationConfig, ...config };
  logger.info("Notification config updated", {
    enabled: notificationConfig.enabled,
    hasWebhook: !!notificationConfig.slackWebhookUrl,
  });
}

export function getNotificationConfig(): NotificationConfig {
  return { ...notificationConfig };
}

// =============================================================================
// Slack通知
// =============================================================================

interface SlackMessage {
  channel?: string;
  username?: string;
  icon_emoji?: string;
  text?: string;
  attachments?: SlackAttachment[];
}

interface SlackAttachment {
  color: string;
  title: string;
  text: string;
  fields?: { title: string; value: string; short?: boolean }[];
  footer?: string;
  ts?: number;
}

async function sendSlackMessage(message: SlackMessage): Promise<boolean> {
  if (!notificationConfig.enabled || !notificationConfig.slackWebhookUrl) {
    logger.debug("Slack notification skipped (disabled or no webhook)", {
      enabled: notificationConfig.enabled,
    });
    return false;
  }

  try {
    const response = await fetch(notificationConfig.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: message.channel || notificationConfig.channel,
        username: message.username || notificationConfig.username,
        icon_emoji: message.icon_emoji || notificationConfig.iconEmoji,
        ...message,
      }),
    });

    if (!response.ok) {
      logger.error("Slack notification failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    logger.info("Slack notification sent");
    return true;
  } catch (error) {
    logger.error("Slack notification error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

// =============================================================================
// アラート通知関数
// =============================================================================

/**
 * ACOS急上昇アラート
 */
export async function notifyAcosIncrease(params: {
  asin: string;
  keyword: string;
  previousAcos: number;
  currentAcos: number;
  increasePercent: number;
}): Promise<boolean> {
  const color = params.increasePercent > 100 ? "danger" : "warning";

  return sendSlackMessage({
    attachments: [
      {
        color,
        title: "⚠️ ACOS急上昇アラート",
        text: `キーワード「${params.keyword}」のACOSが急上昇しています`,
        fields: [
          { title: "ASIN", value: params.asin, short: true },
          { title: "キーワード", value: params.keyword, short: true },
          {
            title: "ACOS変化",
            value: `${(params.previousAcos * 100).toFixed(1)}% → ${(params.currentAcos * 100).toFixed(1)}%`,
            short: true,
          },
          {
            title: "上昇率",
            value: `+${params.increasePercent.toFixed(1)}%`,
            short: true,
          },
        ],
        footer: "Amazon Bid Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * SEO投資上限接近アラート
 */
export async function notifyInvestmentLimitApproaching(params: {
  asin: string;
  keyword: string;
  currentInvestment: number;
  investmentLimit: number;
  utilizationPercent: number;
}): Promise<boolean> {
  const color = params.utilizationPercent > 90 ? "danger" : "warning";

  return sendSlackMessage({
    attachments: [
      {
        color,
        title: "💰 投資上限接近アラート",
        text: `SEO投資の上限に近づいています`,
        fields: [
          { title: "ASIN", value: params.asin, short: true },
          { title: "キーワード", value: params.keyword, short: true },
          {
            title: "現在の投資額",
            value: `¥${params.currentInvestment.toLocaleString()}`,
            short: true,
          },
          {
            title: "投資上限",
            value: `¥${params.investmentLimit.toLocaleString()}`,
            short: true,
          },
          {
            title: "消化率",
            value: `${params.utilizationPercent.toFixed(1)}%`,
            short: true,
          },
        ],
        footer: "Amazon Bid Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * SEO投資目標達成通知
 */
export async function notifySeoGoalAchieved(params: {
  asin: string;
  keyword: string;
  targetRank: number;
  achievedRank: number;
  totalInvestment: number;
  paybackMonths: number;
}): Promise<boolean> {
  return sendSlackMessage({
    attachments: [
      {
        color: "good",
        title: "🎉 SEO投資目標達成！",
        text: `オーガニック順位目標を達成しました`,
        fields: [
          { title: "ASIN", value: params.asin, short: true },
          { title: "キーワード", value: params.keyword, short: true },
          {
            title: "達成順位",
            value: `${params.achievedRank}位（目標: ${params.targetRank}位以内）`,
            short: true,
          },
          {
            title: "総投資額",
            value: `¥${params.totalInvestment.toLocaleString()}`,
            short: true,
          },
          {
            title: "投資回収見込み",
            value: `${params.paybackMonths.toFixed(1)}ヶ月`,
            short: true,
          },
        ],
        footer: "Amazon Bid Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * SEO投資撤退通知
 */
export async function notifySeoInvestmentAbandoned(params: {
  asin: string;
  keyword: string;
  reason: string;
  totalInvestment: number;
  daysInvested: number;
  rankImprovement: number;
}): Promise<boolean> {
  return sendSlackMessage({
    attachments: [
      {
        color: "warning",
        title: "🛑 SEO投資撤退",
        text: `撤退条件に該当したため投資を終了します`,
        fields: [
          { title: "ASIN", value: params.asin, short: true },
          { title: "キーワード", value: params.keyword, short: true },
          { title: "撤退理由", value: params.reason, short: false },
          {
            title: "総投資額",
            value: `¥${params.totalInvestment.toLocaleString()}`,
            short: true,
          },
          {
            title: "投資日数",
            value: `${params.daysInvested}日`,
            short: true,
          },
          {
            title: "ランク改善",
            value: `${params.rankImprovement}位`,
            short: true,
          },
        ],
        footer: "Amazon Bid Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * サーキットブレーカー発動通知
 */
export async function notifyCircuitBreakerTripped(params: {
  serviceName: string;
  failures: number;
  state: string;
}): Promise<boolean> {
  return sendSlackMessage({
    attachments: [
      {
        color: "danger",
        title: "🔴 サーキットブレーカー発動",
        text: `外部サービスへの接続に問題が発生しています`,
        fields: [
          { title: "サービス", value: params.serviceName, short: true },
          { title: "失敗回数", value: `${params.failures}回`, short: true },
          { title: "状態", value: params.state, short: true },
        ],
        footer: "Amazon Bid Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * サーキットブレーカー復旧通知
 */
export async function notifyCircuitBreakerRecovered(params: {
  serviceName: string;
}): Promise<boolean> {
  return sendSlackMessage({
    attachments: [
      {
        color: "good",
        title: "🟢 サーキットブレーカー復旧",
        text: `外部サービスへの接続が復旧しました`,
        fields: [{ title: "サービス", value: params.serviceName, short: true }],
        footer: "Amazon Bid Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * E-Score最適化成功率低下アラート
 */
export async function notifySuccessRateDrop(params: {
  previousRate: number;
  currentRate: number;
  dropPercent: number;
}): Promise<boolean> {
  return sendSlackMessage({
    attachments: [
      {
        color: "warning",
        title: "📉 成功率低下アラート",
        text: `入札推奨の成功率が低下しています`,
        fields: [
          {
            title: "成功率変化",
            value: `${(params.previousRate * 100).toFixed(1)}% → ${(params.currentRate * 100).toFixed(1)}%`,
            short: true,
          },
          {
            title: "低下率",
            value: `-${params.dropPercent.toFixed(1)}%`,
            short: true,
          },
        ],
        footer: "Amazon Bid Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

/**
 * 日次サマリー通知
 */
export async function notifyDailySummary(params: {
  date: string;
  totalKeywordsAnalyzed: number;
  actionsBreakdown: Record<string, number>;
  avgAcos: number;
  seoInvestmentSummary?: {
    activeKeywords: number;
    totalInvestment: number;
    goalsAchieved: number;
  };
}): Promise<boolean> {
  const actionText = Object.entries(params.actionsBreakdown)
    .map(([action, count]) => `${action}: ${count}件`)
    .join("\n");

  const fields = [
    { title: "分析キーワード数", value: `${params.totalKeywordsAnalyzed}件`, short: true },
    { title: "平均ACOS", value: `${(params.avgAcos * 100).toFixed(1)}%`, short: true },
    { title: "アクション内訳", value: actionText, short: false },
  ];

  if (params.seoInvestmentSummary) {
    fields.push(
      {
        title: "SEO投資中KW",
        value: `${params.seoInvestmentSummary.activeKeywords}件`,
        short: true,
      },
      {
        title: "SEO投資額",
        value: `¥${params.seoInvestmentSummary.totalInvestment.toLocaleString()}`,
        short: true,
      },
      {
        title: "目標達成数",
        value: `${params.seoInvestmentSummary.goalsAchieved}件`,
        short: true,
      }
    );
  }

  return sendSlackMessage({
    attachments: [
      {
        color: "#36a64f",
        title: `📊 日次レポート (${params.date})`,
        text: "本日の入札最適化サマリーです",
        fields,
        footer: "Amazon Bid Engine",
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  });
}

// =============================================================================
// エクスポート
// =============================================================================

export const notifications = {
  configure: configureNotifications,
  getConfig: getNotificationConfig,
  acosIncrease: notifyAcosIncrease,
  investmentLimitApproaching: notifyInvestmentLimitApproaching,
  seoGoalAchieved: notifySeoGoalAchieved,
  seoInvestmentAbandoned: notifySeoInvestmentAbandoned,
  circuitBreakerTripped: notifyCircuitBreakerTripped,
  circuitBreakerRecovered: notifyCircuitBreakerRecovered,
  successRateDrop: notifySuccessRateDrop,
  dailySummary: notifyDailySummary,
};

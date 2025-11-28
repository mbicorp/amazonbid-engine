/**
 * Slack通知モジュール
 * Slack APIを使用してメッセージを送信
 */

import { SLACK_CONFIG, assertSlackConfig } from "../config/slack";
import { logger } from "../logger";

/** 通知レベル */
export type NotificationLevel = "info" | "warn" | "error";

/** レベル別の絵文字プレフィックス */
const LEVEL_EMOJI: Record<NotificationLevel, string> = {
  info: "ℹ️",
  warn: "⚠️",
  error: "🚨",
};

/** Slack API レスポンス */
interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

/**
 * Slack通知クラス
 */
export class SlackNotifier {
  private botToken: string | undefined;
  private defaultChannel: string;

  constructor() {
    this.botToken = SLACK_CONFIG.botToken;
    this.defaultChannel = SLACK_CONFIG.defaultChannel;
  }

  /**
   * Slackにメッセージを送信
   * @param message メッセージ本文
   * @param level 通知レベル（info, warn, error）
   * @param channel 送信先チャンネル（省略時はデフォルトチャンネル）
   */
  async send(
    message: string,
    level: NotificationLevel = "info",
    channel?: string
  ): Promise<boolean> {
    // 設定チェック
    if (!this.botToken) {
      logger.warn("Slack通知スキップ: SLACK_BOT_TOKEN未設定");
      return false;
    }

    const targetChannel = channel ?? this.defaultChannel;
    const emoji = LEVEL_EMOJI[level];
    const formattedMessage = `${emoji} ${message}`;

    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${this.botToken}`,
        },
        body: JSON.stringify({
          channel: targetChannel,
          text: formattedMessage,
          mrkdwn: true,
        }),
      });

      const data = (await response.json()) as SlackResponse;

      if (!data.ok) {
        logger.error("Slack送信失敗", { error: data.error, channel: targetChannel });
        return false;
      }

      logger.debug("Slack送信成功", { channel: targetChannel, ts: data.ts });
      return true;
    } catch (error) {
      logger.error("Slack送信エラー", {
        error: error instanceof Error ? error.message : String(error),
        channel: targetChannel,
      });
      return false;
    }
  }

  /**
   * 設定が有効かどうかを確認
   */
  isConfigured(): boolean {
    return !!this.botToken;
  }
}

/** シングルトンインスタンス */
export const slackNotifier = new SlackNotifier();

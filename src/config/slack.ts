/**
 * Slack設定
 * 環境変数からボットトークンとデフォルトチャンネルを読み込む
 */

export const SLACK_CONFIG = {
  /** Slack Bot Token */
  botToken: process.env.SLACK_BOT_TOKEN,
  /** デフォルト通知チャンネル */
  defaultChannel: process.env.SLACK_CHANNEL_AMAZON_TOOL ?? "amazon_tool",
};

/**
 * Slack設定の検証
 * 必須の設定が欠けている場合はエラーをスロー
 */
export function assertSlackConfig(): void {
  if (!SLACK_CONFIG.botToken) {
    throw new Error("SLACK_BOT_TOKEN が設定されていません");
  }
}

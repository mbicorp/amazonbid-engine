/**
 * Slack通知モジュールのテスト
 */

import { SlackNotifier, NotificationLevel } from "../src/lib/slackNotifier";
import {
  notifyLifecycleChange,
  notifyForcedHarvest,
  notifyLifecycleUpdateSummary,
  LifecycleChange,
  HarvestAlert,
} from "../src/lib/lifecycleNotifier";

// fetchをモック
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("SlackNotifier", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 環境変数をリセット
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_AMAZON_TOOL;
  });

  describe("send", () => {
    it("BOTトークンが未設定の場合はスキップしてfalseを返す", async () => {
      const notifier = new SlackNotifier();
      const result = await notifier.send("test message");
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("正常にメッセージを送信できる", async () => {
      process.env.SLACK_BOT_TOKEN = "test-token";
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: true, ts: "123456.789" }),
      });

      // 新しいインスタンスを作成（環境変数を読み込ませるため）
      jest.resetModules();
      const { SlackNotifier: FreshSlackNotifier } = await import("../src/lib/slackNotifier");
      const notifier = new FreshSlackNotifier();

      const result = await notifier.send("test message", "info");
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("レベルに応じた絵文字がつく", async () => {
      process.env.SLACK_BOT_TOKEN = "test-token";
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      });

      jest.resetModules();
      const { SlackNotifier: FreshSlackNotifier } = await import("../src/lib/slackNotifier");
      const notifier = new FreshSlackNotifier();

      await notifier.send("info message", "info");
      let body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("ℹ️");

      await notifier.send("warn message", "warn");
      body = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body.text).toContain("⚠️");

      await notifier.send("error message", "error");
      body = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(body.text).toContain("🚨");
    });

    it("Slack APIがエラーを返した場合はfalseを返す", async () => {
      process.env.SLACK_BOT_TOKEN = "test-token";
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
      });

      jest.resetModules();
      const { SlackNotifier: FreshSlackNotifier } = await import("../src/lib/slackNotifier");
      const notifier = new FreshSlackNotifier();

      const result = await notifier.send("test message");
      expect(result).toBe(false);
    });

    it("ネットワークエラーの場合はfalseを返す", async () => {
      process.env.SLACK_BOT_TOKEN = "test-token";
      mockFetch.mockRejectedValue(new Error("Network error"));

      jest.resetModules();
      const { SlackNotifier: FreshSlackNotifier } = await import("../src/lib/slackNotifier");
      const notifier = new FreshSlackNotifier();

      const result = await notifier.send("test message");
      expect(result).toBe(false);
    });

    it("指定したチャンネルに送信できる", async () => {
      process.env.SLACK_BOT_TOKEN = "test-token";
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      });

      jest.resetModules();
      const { SlackNotifier: FreshSlackNotifier } = await import("../src/lib/slackNotifier");
      const notifier = new FreshSlackNotifier();

      await notifier.send("test message", "info", "custom-channel");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.channel).toBe("custom-channel");
    });
  });

  describe("isConfigured", () => {
    it("BOTトークンが設定されていればtrueを返す", async () => {
      process.env.SLACK_BOT_TOKEN = "test-token";
      jest.resetModules();
      const { SlackNotifier: FreshSlackNotifier } = await import("../src/lib/slackNotifier");
      const notifier = new FreshSlackNotifier();
      expect(notifier.isConfigured()).toBe(true);
    });

    it("BOTトークンが未設定ならfalseを返す", () => {
      const notifier = new SlackNotifier();
      expect(notifier.isConfigured()).toBe(false);
    });
  });
});

describe("ライフサイクル通知ヘルパー", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SLACK_BOT_TOKEN = "test-token";
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    });
  });

  afterEach(() => {
    delete process.env.SLACK_BOT_TOKEN;
  });

  describe("notifyLifecycleChange", () => {
    it("ステージ変更を通知できる", async () => {
      jest.resetModules();
      const { notifyLifecycleChange: freshNotify } = await import("../src/lib/lifecycleNotifier");

      const change: LifecycleChange = {
        productId: "B0001234567",
        productName: "テスト商品",
        fromStage: "LAUNCH_HARD",
        toStage: "LAUNCH_SOFT",
        reason: "TACOS超過だがSEO改善中",
        seoScore: 55.5,
        monthlyProfit: -50000,
      };

      const result = await freshNotify(change);
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("ライフサイクルステージ変更");
      expect(body.text).toContain("テスト商品");
      expect(body.text).toContain("立ち上げ（強）");
      expect(body.text).toContain("立ち上げ（弱）");
      expect(body.text).toContain("55.5");
      expect(body.text).toContain("-50,000円");
    });

    it("HARVESTへの遷移はwarnレベルで通知される", async () => {
      jest.resetModules();
      const { notifyLifecycleChange: freshNotify } = await import("../src/lib/lifecycleNotifier");

      const change: LifecycleChange = {
        productId: "B0001234567",
        fromStage: "GROW",
        toStage: "HARVEST",
        reason: "TACOS超過 & SEO LOW",
      };

      await freshNotify(change);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("⚠️");
    });
  });

  describe("notifyForcedHarvest", () => {
    it("強制HARVESTアラートを通知できる", async () => {
      jest.resetModules();
      const { notifyForcedHarvest: freshNotify } = await import("../src/lib/lifecycleNotifier");

      const alert: HarvestAlert = {
        productId: "B0001234567",
        productName: "問題商品",
        trigger: "cumulative_loss",
        details: "累積赤字が200万円を超過",
        cumulativeLoss: -2500000,
      };

      const result = await freshNotify(alert);
      expect(result).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("🚨"); // errorレベル
      expect(body.text).toContain("強制HARVEST移行アラート");
      expect(body.text).toContain("累積赤字上限超過");
      expect(body.text).toContain("2,500,000円");
    });

    it("連続赤字トリガーを通知できる", async () => {
      jest.resetModules();
      const { notifyForcedHarvest: freshNotify } = await import("../src/lib/lifecycleNotifier");

      const alert: HarvestAlert = {
        productId: "B0001234567",
        trigger: "consecutive_loss",
        details: "2ヶ月連続赤字",
        consecutiveLossMonths: 2,
      };

      await freshNotify(alert);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("連続赤字");
      expect(body.text).toContain("2ヶ月");
    });

    it("レビュー崩壊トリガーを通知できる", async () => {
      jest.resetModules();
      const { notifyForcedHarvest: freshNotify } = await import("../src/lib/lifecycleNotifier");

      const alert: HarvestAlert = {
        productId: "B0001234567",
        trigger: "review_collapse",
        details: "レビュー評価が3.0未満に低下",
        reviewScore: 2.8,
        reviewCount: 50,
      };

      await freshNotify(alert);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("レビュー崩壊");
      expect(body.text).toContain("2.8");
      expect(body.text).toContain("50件");
    });
  });

  describe("notifyLifecycleUpdateSummary", () => {
    it("ジョブサマリーを通知できる", async () => {
      jest.resetModules();
      const { notifyLifecycleUpdateSummary: freshNotify } = await import("../src/lib/lifecycleNotifier");

      const result = await freshNotify({
        totalProducts: 100,
        transitioned: 5,
        forcedHarvest: 1,
        errors: 0,
        dryRun: false,
      });

      expect(result).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("ℹ️"); // infoレベル
      expect(body.text).toContain("ライフサイクル更新ジョブ完了");
      expect(body.text).toContain("100");
      expect(body.text).toContain("5件");
      expect(body.text).toContain("1件");
    });

    it("DRY RUNの場合はラベルが付く", async () => {
      jest.resetModules();
      const { notifyLifecycleUpdateSummary: freshNotify } = await import("../src/lib/lifecycleNotifier");

      await freshNotify({
        totalProducts: 10,
        transitioned: 2,
        forcedHarvest: 0,
        errors: 0,
        dryRun: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("[DRY RUN]");
    });

    it("エラーがある場合はwarnレベルになる", async () => {
      jest.resetModules();
      const { notifyLifecycleUpdateSummary: freshNotify } = await import("../src/lib/lifecycleNotifier");

      await freshNotify({
        totalProducts: 10,
        transitioned: 2,
        forcedHarvest: 0,
        errors: 3,
        dryRun: false,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain("⚠️");
      expect(body.text).toContain("エラー: 3件");
    });
  });
});

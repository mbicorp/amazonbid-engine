/**
 * AdminJS 管理画面モジュール
 *
 * 内部運用者向けの管理画面を提供する。
 * BigQuery専用アダプタ（BigQueryDatabase/BigQueryResource）を使用して
 * BigQueryテーブルの閲覧と、product_configの編集機能を提供する。
 *
 * 認証は環境変数で指定した管理者メールアドレスとパスワードで行う。
 * - ADMIN_EMAIL: 管理者メールアドレス
 * - ADMIN_PASSWORD: 管理者パスワード
 * - ADMIN_COOKIE_SECRET: Cookieの署名シークレット
 * - ADMIN_SESSION_SECRET: セッションシークレット
 */

import express from "express";
import AdminJS from "adminjs";
import AdminJSExpress from "@adminjs/express";
import { logger } from "../logger";
import { BigQueryDatabase, BigQueryResource, createProductConfigValidator } from "./bigquery";

// =============================================================================
// アダプタ登録
// =============================================================================

// BigQuery アダプタを AdminJS に登録
AdminJS.registerAdapter({
  Database: BigQueryDatabase,
  Resource: BigQueryResource,
});

// =============================================================================
// リソース定義
// =============================================================================

/**
 * product_config リソース（編集可能）
 */
const productConfigResource = new BigQueryResource({
  tableName: "product_config",
  datasetName: "amazon_bid_engine",
  idField: "asin",
  editableFields: ["lifecycle_state", "target_tacos", "max_bid", "profile_type"],
  validate: createProductConfigValidator(),
  properties: [
    { name: "asin", type: "string", isId: true, isTitle: true },
    { name: "is_active", type: "boolean" },
    { name: "revenue_model", type: "string" },
    { name: "lifecycle_state", type: "string" },
    { name: "margin_rate", type: "number" },
    { name: "expected_repeat_orders_assumed", type: "number" },
    { name: "launch_date", type: "date" },
    { name: "target_tacos", type: "number" },
    { name: "max_bid", type: "number" },
    { name: "profile_type", type: "string" },
    { name: "created_at", type: "datetime" },
    { name: "updated_at", type: "datetime" },
  ],
});

/**
 * executions リソース（読み取り専用）
 */
const executionsResource = new BigQueryResource({
  tableName: "executions",
  datasetName: "amazon_bid_engine",
  idField: "execution_id",
  editableFields: [],
  properties: [
    { name: "execution_id", type: "string", isId: true, isTitle: true },
    { name: "profile_id", type: "string" },
    { name: "mode", type: "string" },
    { name: "status", type: "string" },
    { name: "total_keywords", type: "number" },
    { name: "recommendations_count", type: "number" },
    { name: "applied_count", type: "number" },
    { name: "started_at", type: "datetime" },
    { name: "completed_at", type: "datetime" },
    { name: "error_message", type: "string" },
  ],
});

/**
 * bid_recommendations リソース（読み取り専用）
 */
const recommendationsResource = new BigQueryResource({
  tableName: "bid_recommendations",
  datasetName: "amazon_bid_engine",
  idField: "keyword_id",
  editableFields: [],
  properties: [
    { name: "execution_id", type: "string" },
    { name: "profile_id", type: "string" },
    { name: "campaign_id", type: "string" },
    { name: "ad_group_id", type: "string" },
    { name: "keyword_id", type: "string", isId: true, isTitle: true },
    { name: "keyword_text", type: "string" },
    { name: "match_type", type: "string" },
    { name: "asin", type: "string" },
    { name: "lifecycle_state", type: "string" },
    { name: "target_acos", type: "number" },
    { name: "current_bid", type: "number" },
    { name: "recommended_bid", type: "number" },
    { name: "bid_change", type: "number" },
    { name: "bid_change_ratio", type: "number" },
    { name: "reason_codes", type: "string" },
    { name: "impressions", type: "number" },
    { name: "clicks", type: "number" },
    { name: "orders", type: "number" },
    { name: "sales", type: "number" },
    { name: "cost", type: "number" },
    { name: "cvr", type: "number" },
    { name: "acos", type: "number" },
    { name: "created_at", type: "datetime" },
  ],
});

/**
 * loss_budget_7d リソース（読み取り専用）
 */
const lossBudgetResource = new BigQueryResource({
  tableName: "loss_budget_7d",
  datasetName: "amazon_bid_engine",
  idField: "asin",
  editableFields: [],
  properties: [
    { name: "asin", type: "string", isId: true, isTitle: true },
    { name: "profile_id", type: "string" },
    { name: "loss_budget", type: "number" },
    { name: "loss_so_far", type: "number" },
    { name: "ratio_stage", type: "number" },
    { name: "investment_state", type: "string" },
    { name: "rolling_loss_7d", type: "number" },
    { name: "rolling_budget_7d", type: "number" },
    { name: "rolling_ratio", type: "number" },
    { name: "calculated_at", type: "datetime" },
  ],
});

/**
 * negative_candidates_shadow リソース（読み取り専用）
 * ※ analytics_views データセットから参照
 */
const negativeCandidatesResource = new BigQueryResource({
  tableName: "negative_candidates_shadow",
  datasetName: "analytics_views",
  idField: "keyword_id",
  editableFields: [],
  properties: [
    { name: "execution_id", type: "string" },
    { name: "profile_id", type: "string" },
    { name: "campaign_id", type: "string" },
    { name: "ad_group_id", type: "string" },
    { name: "keyword_id", type: "string", isId: true, isTitle: true },
    { name: "keyword_text", type: "string" },
    { name: "match_type", type: "string" },
    { name: "asin", type: "string" },
    { name: "reason_code", type: "string" },
    { name: "score", type: "number" },
    { name: "clicks_7d", type: "number" },
    { name: "orders_7d", type: "number" },
    { name: "acos_7d", type: "number" },
    { name: "cost_7d", type: "number" },
    { name: "status", type: "string" },
    { name: "created_at", type: "datetime" },
  ],
});

// =============================================================================
// メインエクスポート
// =============================================================================

/**
 * AdminJS の rootPath
 *
 * 注意: "/admin" は既存の API ルート（/admin/negative-suggestions, /admin/executions など）
 * と競合するため、"/admin-panel" を使用する
 */
const ADMIN_ROOT_PATH = "/admin-panel";

/**
 * AdminJS 管理画面を Express アプリに登録する
 *
 * rootPath と Express のマウントパスを一致させることで、
 * 正しく /admin でアクセスできるようにする。
 *
 * @param app Express Application インスタンス
 * @throws Error - ADMIN_EMAIL または ADMIN_PASSWORD が未設定の場合
 */
export function registerAdmin(app: express.Application): void {
  // AdminJSインスタンスを作成
  const admin = new AdminJS({
    rootPath: ADMIN_ROOT_PATH,
    loginPath: `${ADMIN_ROOT_PATH}/login`,
    logoutPath: `${ADMIN_ROOT_PATH}/logout`,
    branding: {
      companyName: "Amazon広告ツール 管理画面",
    },
    locale: {
      language: "ja",
      translations: {
        labels: {
          product_config: "商品設定",
          executions: "実行ログ",
          bid_recommendations: "入札提案ログ",
          loss_budget_7d: "予算・損失モニタ（7日）",
          negative_candidates_shadow: "ネガ候補（シャドウ）",
        },
        resources: {
          product_config: {
            properties: {
              asin: "ASIN",
              is_active: "有効",
              revenue_model: "収益モデル",
              lifecycle_state: "ライフサイクル",
              margin_rate: "粗利率",
              expected_repeat_orders_assumed: "想定リピート注文数",
              launch_date: "発売日",
              target_tacos: "目標TACOS",
              max_bid: "入札上限",
              profile_type: "プロファイル種別",
              created_at: "作成日時",
              updated_at: "更新日時",
            },
          },
          executions: {
            properties: {
              execution_id: "実行ID",
              profile_id: "プロファイルID",
              mode: "モード",
              status: "ステータス",
              total_keywords: "総キーワード数",
              recommendations_count: "提案数",
              applied_count: "適用数",
              started_at: "開始日時",
              completed_at: "完了日時",
              error_message: "エラーメッセージ",
            },
          },
          bid_recommendations: {
            properties: {
              execution_id: "実行ID",
              profile_id: "プロファイルID",
              campaign_id: "キャンペーンID",
              ad_group_id: "広告グループID",
              keyword_id: "キーワードID",
              keyword_text: "キーワード",
              match_type: "マッチタイプ",
              asin: "ASIN",
              lifecycle_state: "ライフサイクル",
              target_acos: "目標ACOS",
              current_bid: "現在入札額",
              recommended_bid: "推奨入札額",
              bid_change: "入札変更額",
              bid_change_ratio: "入札変更率",
              reason_codes: "理由コード",
              impressions: "インプレッション",
              clicks: "クリック",
              orders: "注文",
              sales: "売上",
              cost: "コスト",
              cvr: "CVR",
              acos: "ACOS",
              created_at: "作成日時",
            },
          },
          loss_budget_7d: {
            properties: {
              asin: "ASIN",
              profile_id: "プロファイルID",
              loss_budget: "損失予算",
              loss_so_far: "累計損失",
              ratio_stage: "消化率",
              investment_state: "投資状態",
              rolling_loss_7d: "7日間損失",
              rolling_budget_7d: "7日間予算",
              rolling_ratio: "7日間消化率",
              calculated_at: "計算日時",
            },
          },
          negative_candidates_shadow: {
            properties: {
              execution_id: "実行ID",
              profile_id: "プロファイルID",
              campaign_id: "キャンペーンID",
              ad_group_id: "広告グループID",
              keyword_id: "キーワードID",
              keyword_text: "キーワード",
              match_type: "マッチタイプ",
              asin: "ASIN",
              reason_code: "理由コード",
              score: "スコア",
              clicks_7d: "7日間クリック",
              orders_7d: "7日間注文",
              acos_7d: "7日間ACOS",
              cost_7d: "7日間コスト",
              status: "ステータス",
              created_at: "作成日時",
            },
          },
        },
        actions: {
          list: "一覧",
          show: "詳細",
          edit: "編集",
          new: "新規作成",
          delete: "削除",
          bulkDelete: "一括削除",
        },
        buttons: {
          save: "保存",
          filter: "フィルタ",
          applyChanges: "変更を適用",
          resetFilter: "フィルタをリセット",
          confirmRemovalMany: "{{count}}件を削除",
          confirmRemovalMany_plural: "{{count}}件を削除",
        },
        messages: {
          successfullyDeleted: "正常に削除されました",
          successfullyUpdated: "正常に更新されました",
          thereWereValidationErrors: "入力エラーがあります",
          forbiddenError: "この操作は許可されていません",
        },
      },
    },
    resources: [
      // 商品設定（編集可能）
      {
        resource: productConfigResource,
        options: {
          id: "product_config",
          navigation: {
            name: "設定",
            icon: "Database",
          },
          listProperties: ["asin", "lifecycle_state", "target_tacos", "max_bid", "profile_type", "updated_at"],
          filterProperties: ["asin", "lifecycle_state", "profile_type", "is_active"],
          editProperties: ["lifecycle_state", "target_tacos", "max_bid", "profile_type"],
          showProperties: ["asin", "is_active", "revenue_model", "lifecycle_state", "target_tacos", "max_bid", "profile_type", "margin_rate", "created_at", "updated_at"],
          actions: {
            new: { isAccessible: false },
            delete: { isAccessible: false },
            bulkDelete: { isAccessible: false },
          },
        },
      },
      // 実行ログ（読み取り専用）
      {
        resource: executionsResource,
        options: {
          id: "executions",
          navigation: {
            name: "モニタリング",
            icon: "Activity",
          },
          listProperties: ["execution_id", "mode", "status", "total_keywords", "recommendations_count", "started_at"],
          filterProperties: ["execution_id", "profile_id", "mode", "status"],
          showProperties: ["execution_id", "profile_id", "mode", "status", "total_keywords", "recommendations_count", "applied_count", "started_at", "completed_at", "error_message"],
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
            delete: { isAccessible: false },
            bulkDelete: { isAccessible: false },
          },
        },
      },
      // 入札提案ログ（読み取り専用）
      {
        resource: recommendationsResource,
        options: {
          id: "bid_recommendations",
          navigation: {
            name: "モニタリング",
            icon: "TrendingUp",
          },
          listProperties: ["keyword_id", "asin", "keyword_text", "current_bid", "recommended_bid", "reason_codes", "created_at"],
          filterProperties: ["execution_id", "profile_id", "asin", "keyword_text", "lifecycle_state"],
          showProperties: ["execution_id", "profile_id", "asin", "keyword_id", "keyword_text", "match_type", "lifecycle_state", "current_bid", "recommended_bid", "bid_change", "reason_codes", "clicks", "orders", "acos", "created_at"],
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
            delete: { isAccessible: false },
            bulkDelete: { isAccessible: false },
          },
        },
      },
      // 予算・損失モニタ（読み取り専用）
      {
        resource: lossBudgetResource,
        options: {
          id: "loss_budget_7d",
          navigation: {
            name: "モニタリング",
            icon: "DollarSign",
          },
          listProperties: ["asin", "loss_budget", "loss_so_far", "rolling_loss_7d", "investment_state", "calculated_at"],
          filterProperties: ["profile_id", "asin", "investment_state"],
          showProperties: ["asin", "profile_id", "loss_budget", "loss_so_far", "ratio_stage", "investment_state", "rolling_loss_7d", "rolling_budget_7d", "rolling_ratio", "calculated_at"],
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
            delete: { isAccessible: false },
            bulkDelete: { isAccessible: false },
          },
        },
      },
      // ネガ候補（読み取り専用）
      {
        resource: negativeCandidatesResource,
        options: {
          id: "negative_candidates_shadow",
          navigation: {
            name: "ネガ管理",
            icon: "MinusCircle",
          },
          listProperties: ["keyword_id", "keyword_text", "asin", "reason_code", "score", "clicks_7d", "acos_7d", "created_at"],
          filterProperties: ["execution_id", "profile_id", "asin", "keyword_text", "reason_code", "status"],
          showProperties: ["execution_id", "profile_id", "keyword_id", "keyword_text", "match_type", "asin", "reason_code", "score", "clicks_7d", "orders_7d", "acos_7d", "cost_7d", "status", "created_at"],
          actions: {
            new: { isAccessible: false },
            edit: { isAccessible: false },
            delete: { isAccessible: false },
            bulkDelete: { isAccessible: false },
          },
        },
      },
    ],
  });

  // 環境変数から認証情報を取得
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  // 必須の環境変数チェック
  if (!adminEmail || !adminPassword) {
    throw new Error(
      "AdminJS: ADMIN_EMAIL と ADMIN_PASSWORD を環境変数に設定してください"
    );
  }

  // セキュリティ用シークレット（本番では必ず環境変数で上書きすること）
  const cookieSecret =
    process.env.ADMIN_COOKIE_SECRET || "change-this-cookie-secret";
  const sessionSecret =
    process.env.ADMIN_SESSION_SECRET || "change-this-session-secret";

  // 認証付きルーターを構築
  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email: string, password: string) => {
        // 環境変数で指定した認証情報と照合
        if (email === adminEmail && password === adminPassword) {
          return { email };
        }
        return null;
      },
      cookiePassword: cookieSecret,
    },
    null,
    {
      resave: false,
      saveUninitialized: false,
      secret: sessionSecret,
    }
  );

  // AdminJS のルーターを rootPath にマウント
  // 注意: app.use("/", router) ではなく app.use(rootPath, router) が正しい
  // これにより /admin/* へのリクエストがルーターに渡され、
  // ルーター内部では相対パス（/login など）として処理される
  app.use(admin.options.rootPath, router);

  logger.info("AdminJS admin panel registered", {
    rootPath: admin.options.rootPath,
    resources: 5,
  });
}

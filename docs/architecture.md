# Amazon自動入札エンジン - アーキテクチャ仕様書

> **Single Source of Truth** - このドキュメントはAmazon自動入札エンジンの技術仕様の唯一の情報源です

---

## 目次

1. [ディレクトリ構造](#1-ディレクトリ構造)
2. [compute_bid_recommendations 処理フロー](#2-compute_bid_recommendations-処理フロー)
3. [lifecycle_state / lifecycle_suggested_state の仕様](#3-lifecycle_state--lifecycle_suggested_state-の仕様)
4. [target_acos の仕様と LTV 計算の詳細](#4-target_acos-の仕様と-ltv-計算の詳細)
5. [AUTO→EXACT 昇格ロジック](#5-autoexact-昇格ロジック)
6. [SHADOW / APPLY モードの動作](#6-shadow--apply-モードの動作)
7. [BigQuery との連携](#7-bigquery-との連携)
8. [reason_code の一覧と判定ロジック](#8-reason_code-の一覧と判定ロジック)
9. [ネガティブキーワード候補サジェスト](#9-ネガティブキーワード候補サジェスト)
10. [自動ガードレール（Auto Guardrails）](#10-自動ガードレールauto-guardrails)
11. [ProductConfig 設定レイヤー](#11-productconfig-設定レイヤー)
12. [Slack 実行サマリー通知](#12-slack-実行サマリー通知)
13. [適応型E-Score最適化システム](#13-適応型e-score最適化システム)
14. [Jungle Scout連携](#14-jungle-scout連携)
15. [統合入札戦略（Unified Strategy）](#15-統合入札戦略unified-strategy)
16. [リトライ・サーキットブレーカー](#16-リトライサーキットブレーカー)
17. [掲載位置（Placement）最適化](#17-掲載位置placement最適化)
18. [日予算（Budget）最適化](#18-日予算budget最適化)
19. [バックテスト機能](#19-バックテスト機能)
20. [A/Bテスト機能](#20-abテスト機能)
21. [Dayparting（時間帯別入札最適化）](#21-dayparting時間帯別入札最適化)
22. [キーワード自動発見・拡張機能](#22-キーワード自動発見拡張機能)
23. [季節性予測による先行入札調整](#23-季節性予測による先行入札調整)
24. [プロ戦略モジュール](#24-プロ戦略モジュール)
25. [SEO目標順位ロジック](#25-seo目標順位ロジック)
26. [ビッグセール用イベントカレンダー](#26-ビッグセール用イベントカレンダー)
27. [SKU別ビッグセール戦略（bigSaleStrategy）](#27-sku別ビッグセール戦略bigsalestrategy)
28. [実測LTV（measuredLtv）](#28-実測ltvmeasuredltv)
29. [TACOS最適化と健全性スコア（tacosHealth）](#29-tacos最適化と健全性スコアtacoshealth)
30. [プレセール診断（Presale Diagnosis）](#30-プレセール診断presale-diagnosis)
31. [T_opt推定とライフサイクル別TACOS（Analytics）](#31-t_opt推定とライフサイクル別tacosanalytics)
32. [lossBudget評価（ASIN投資健全性）](#32-lossbudget評価asin投資健全性)
33. [SEOローンチ評価（Launch Exit Decision）](#33-seoローンチ評価launch-exit-decision)
34. [期待CVR計算ロジック（expectedCvr）](#34-期待cvr計算ロジックexpectedcvr)
35. [CORE_SEOキーワードスコアリング（coreSeoScore）](#35-core_seoキーワードスコアリングcoreseoscore)
36. [TACOS-ACOS統合モデル](#36-tacos-acos統合モデル)
37. [理論最大CPCガード](#37-理論最大cpcガード)
38. [セール用期待CVR（expectedCvr_sale）](#38-セール用期待cvrexpectedcvr_sale)
39. [ロール×ライフサイクル別ガードレール（roleGuardrails）](#39-ロールライフサイクル別ガードレールroleguardrails)
40. [管理画面（AdminJS）](#40-管理画面adminjs)
41. [サーバー起動フロー](#41-サーバー起動フロー)

---

## 17. 掲載位置（Placement）最適化

### 概要

Top of Search Impression Share を考慮した掲載位置入札調整比率の自動最適化エンジン。
「偽の限界点（Local Maximum）」を回避し、真の最適ポジションを探索する。

### ファイル

```
src/placement/
  index.ts                  # エクスポート
  types.ts                  # 型定義
  placement-calculator.ts   # 入札調整比率計算（純粋関数）
  placement-engine.ts       # メインエンジン
  bigquery-adapter.ts       # BigQuery連携
```

### ロジック概要

| パターン | 条件 | アクション |
|----------|------|------------|
| 勝ちパターン | ACOS < Target × 0.9 | BOOST (+15%) |
| オポチュニティ・ジャンプ | ACOS > Target かつ IS < 20% | TEST_BOOST (+40%) |
| 撤退判断 | ACOS > Target × 1.2 かつ IS > 50% | DECREASE (-20%) |
| 現状維持 | 上記以外 | NO_ACTION |

### 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `minClicksForDecision` | 20 | 判断に必要な最小クリック数 |
| `strongPerformanceThreshold` | 0.9 | 勝ちパターン判定閾値 |
| `opportunityJumpIsMax` | 20% | オポチュニティ・ジャンプのIS上限 |
| `trueWeaknessIsMin` | 50% | 撤退判断のIS下限 |
| `maxModifier` | 900% | 最大調整比率 |

### エンドポイント

```
POST /cron/run-placement-optimization
```

---

## 18. 日予算（Budget）最適化

### 概要

Lost Impression Share (Budget) と ACOS の健全性に基づいて、キャンペーンの日予算を動的に最適化するエンジン。

**コアコンセプト:**
「予算が足りない（Usageが高い または Lost ISがある）」かつ「利益が出ている（ACOSが低い）」場合のみ、予算を引き上げる。無駄遣いしているキャンペーンの予算は増やさない。

### ファイル

```
src/budget/
  index.ts                  # エクスポート
  types.ts                  # 型定義
  budget-calculator.ts      # 予算最適化ロジック（純粋関数）
  budget-engine.ts          # メインエンジン
  bigquery-adapter.ts       # BigQuery連携
```

### アクションタイプ

| アクション | 条件 | 変更幅 |
|------------|------|--------|
| BOOST | 高パフォーマンス（ACOS < Target × 0.9）かつ予算逼迫（Usage > 90% または Lost IS > 10%） | +20% |
| CURB | 低パフォーマンス（ACOS > Target × 1.5）かつ余剰予算継続（Usage < 50% が7日間） | -10% |
| KEEP | 上記以外 | 0% |

### 理由コード

| コード | 説明 |
|--------|------|
| HIGH_PERFORMANCE_LOST_IS | 高パフォーマンス＆Lost IS Budget が高い |
| HIGH_PERFORMANCE_HIGH_USAGE | 高パフォーマンス＆予算消化率が高い |
| MODERATE_PERFORMANCE | 目標付近のACOS、現状維持 |
| BUDGET_AVAILABLE | 予算に余裕がある |
| LOW_PERFORMANCE_SURPLUS | 低パフォーマンス＆余剰予算、削減推奨 |
| MAX_BUDGET_REACHED | 最大予算上限に到達 |
| MIN_BUDGET_REACHED | 最小予算下限に到達 |
| INSUFFICIENT_DATA | データ不足で判断不可 |

### ガードレール

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `globalMaxBudgetCap` | 20,000円 | キャンペーンごとの絶対上限額 |
| `maxBudgetMultiplier` | 2.0 | 現在予算に対する最大倍率 |
| `minBudget` | 500円 | 最小予算額 |
| `minOrdersForDecision` | 3 | 判断に必要な最小注文数 |

### 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `boostUsageThreshold` | 90% | 増額判定の予算消化率閾値 |
| `boostLostIsThreshold` | 10% | 増額判定のLost IS閾値 |
| `boostAcosRatio` | 0.9 | 増額判定のACOS比率（目標の90%以下） |
| `boostPercent` | 20 | 増額率 |
| `curbUsageThreshold` | 50% | 減額判定の予算消化率閾値 |
| `curbLowUsageDays` | 7 | 減額判定の低消化継続日数 |
| `curbAcosRatio` | 1.5 | 減額判定のACOS比率（目標の150%超） |
| `curbPercent` | 10 | 減額率 |

### BigQuery スキーマ

#### campaign_budget_metrics ビュー

予算判断に必要なメトリクスを集約するビュー。

| カラム | 型 | 説明 |
|--------|------|------|
| `campaign_id` | STRING | キャンペーンID |
| `daily_budget` | INT64 | 現在の日予算 |
| `today_spend` | FLOAT64 | 当日消化額 |
| `budget_usage_percent` | FLOAT64 | 予算消化率 |
| `lost_impression_share_budget` | FLOAT64 | 予算不足によるIS損失 |
| `acos_7d` | FLOAT64 | 7日ACOS |
| `acos_30d` | FLOAT64 | 30日ACOS |
| `target_acos` | FLOAT64 | 目標ACOS |
| `low_usage_days` | INT64 | 低消化継続日数 |

#### budget_recommendations テーブル

予算推奨ログを保存するテーブル。

| カラム | 型 | 説明 |
|--------|------|------|
| `execution_id` | STRING | 実行ID |
| `campaign_id` | STRING | キャンペーンID |
| `action` | STRING | アクション（BOOST/KEEP/CURB） |
| `old_budget` | INT64 | 変更前予算 |
| `new_budget` | INT64 | 推奨予算 |
| `reason_code` | STRING | 理由コード |
| `was_guard_clamped` | BOOL | ガードレールでクリップされたか |
| `is_applied` | BOOL | 適用されたか |

### エンドポイント

```
POST /cron/run-budget-optimization
```

リクエストボディ:
- `targetCampaignIds?: string[]` - 特定のキャンペーンのみ処理
- `dryRun?: boolean` - ドライラン

レスポンス:
- `success`, `executionId`, `mode`
- `totalCampaigns`, `recommendationsCount`
- `actionCounts: { BOOST, KEEP, CURB }`
- `totalBudgetIncrease`, `totalBudgetDecrease`, `netBudgetChange`

---

## 1. ディレクトリ構造

### ファイル構成

```
amazon-bid-engine/
   src/
      engine/                    # 入札エンジン本体
         index.ts               # エクスポート
         bidEngine.ts           # メイン関数（runBidEngine）

      ltv/                       # LTVベースACOS計算モジュール
         index.ts               # エクスポート
         types.ts               # 型定義（ProductConfig, RevenueModel, LtvMode等）
         ltv-calculator.ts      # ACOS計算ロジック
         product-config-builder.ts  # ProductConfig生成ヘルパー

      config/                    # 設定管理モジュール（Single Source of Truth）
         productConfigTypes.ts  # ProductConfig型定義
         productConfigValidator.ts # バリデーションロジック
         productConfigRepository.ts # リポジトリパターン
         productConfigLoader.ts # product_configテーブルからの読み込み（レガシー）
         index.ts               # エクスポート

      logging/                   # ログ・記録モジュール
         index.ts               # エクスポート
         types.ts               # ログ型定義（ReasonCode等）
         executionLogger.ts     # 実行ログ記録
         shadowMode.ts          # シャドウモード管理

      lifecycle/                 # ライフサイクル管理
         types.ts               # ライフサイクル型定義
         transition-logic.ts    # ステージ遷移ロジック
         lifecycleSuggestion.ts # ライフサイクル提案ロジック
         bid-integration.ts     # Bid連携モジュール

      seo/                       # SEO指標関連
         types.ts               # SEO型定義
         seoMetrics.ts          # SEO指標計算

      bigquery/                  # BigQuery連携
         schemas/
             product_config.sql           # 商品設定テーブル
             executions.sql               # 実行ログ
             keyword_recommendations_log.sql # キーワード推奨ログ
             search_term_stats_30d.sql    # 検索クエリ統計ビュー
             intent_cluster_stats_30d.sql # 検索意図クラスタ統計ビュー
             launch_exit_decisions.sql    # LAUNCH終了判定ログテーブル
             negative_keyword_suggestions.sql # ネガティブキーワード候補テーブル
             auto_exact_promotion_suggestions.sql # AUTO→EXACT昇格候補テーブル
             campaign_placement_metrics_30d.sql # 掲載位置メトリクスビュー
             placement_recommendations.sql # 掲載位置推奨ログテーブル
             campaign_budget_metrics.sql  # 予算メトリクスビュー
             budget_recommendations.sql   # 予算推奨ログテーブル

      negative-keywords/          # ネガティブキーワード候補検出
         index.ts                # エクスポート
         types.ts                # 型定義（NegativeKeywordCandidate等）
         negative-keyword-calculator.ts # メイン計算ロジック

      auto-exact/                 # AUTO→EXACT 昇格エンジン（SHADOWモード専用）
         index.ts                # エクスポート
         types.ts                # 型定義（PromotionCandidate, LifecycleState等）
         auto-exact-promotion-engine.ts  # 昇格候補計算ロジック（純粋関数）
         auto-exact-promotion-job.ts     # BigQueryジョブ実行

      guardrails/                 # 入札ガードレール管理
         index.ts                # エクスポート
         auto-guardrails.ts      # 自動ガードレール計算

      inventory/                  # 在庫ガードモジュール
         index.ts                # エクスポート
         types.ts                # 型定義（InventoryRiskStatus, AsinInventorySnapshot等）
         inventoryRepository.ts  # 在庫情報取得リポジトリ
         inventoryGuard.ts       # ハードキル・ソフトスロットルロジック

      adaptive-escore/            # 適応型E-Score最適化システム
         index.ts                # エクスポート
         types.ts                # 型定義（EScoreWeights, FeedbackRecord等）
         config.ts               # 設定・デフォルト値
         escore-calculator.ts    # E-Score計算ロジック
         success-evaluator.ts    # 成功評価ロジック
         weight-optimizer.ts     # 重み最適化（勾配降下法）
         safety-manager.ts       # 安全機構（異常検知・ロールバック）
         bigquery-adapter.ts     # BigQuery連携
         optimization-runner.ts  # 最適化ジョブランナー

      jungle-scout/               # Jungle Scout連携
         index.ts                # エクスポート
         types.ts                # 型定義
         client.ts               # APIクライアント
         bigquery-adapter.ts     # BigQuery連携
         strategy-analyzer.ts    # 戦略分析

      unified-strategy/           # 統合入札戦略エンジン
         index.ts                # エクスポート
         types.ts                # 型定義

      backtest/                   # バックテストエンジン
         index.ts                # エクスポート
         types.ts                # 型定義
         backtest-calculator.ts  # シミュレーション計算（純粋関数）
         backtest-engine.ts      # メインエンジン
         bigquery-adapter.ts     # BigQuery連携
         report-generator.ts     # レポート生成・Slack通知

      placement/                  # 掲載位置（Placement）最適化エンジン
         index.ts                # エクスポート
         types.ts                # 型定義（PlacementMetrics, PlacementAction等）
         placement-calculator.ts # 入札調整比率計算ロジック（純粋関数）
         placement-engine.ts     # メインエンジン
         bigquery-adapter.ts     # BigQuery連携

      budget/                     # 日予算（Budget）最適化エンジン
         index.ts                # エクスポート
         types.ts                # 型定義（BudgetMetrics, BudgetAction等）
         budget-calculator.ts    # 予算最適化ロジック（純粋関数）
         budget-engine.ts        # メインエンジン
         bigquery-adapter.ts     # BigQuery連携

      keywordDiscovery/           # キーワード自動発見・拡張エンジン
         index.ts                # エクスポート
         types.ts                # 型定義（CandidateKeyword, DiscoverySource等）
         engine.ts               # キーワード発見ロジック（純粋関数）
         jungleScoutClient.ts    # Jungle Scout API連携（フェーズ二用）
         repository.ts           # BigQuery連携
         httpHandler.ts          # HTTPエンドポイント

      apply/                      # APPLY モード安全制御
         index.ts                # エクスポート
         types.ts                # 型定義（ApplySkipReason, ApplySafetyConfig等）
         apply-filter.ts         # APPLYフィルタリングロジック
         apply-config.ts         # 設定読み込み

      slack/                      # Slack通知モジュール
         index.ts                # エクスポート
         executionSummaryNotifier.ts  # 実行サマリー通知

      lib/                        # 共通ライブラリ
         slackNotifier.ts        # Slackクライアント
         lifecycleNotifier.ts    # ライフサイクル変更通知

      errors/                     # カスタムエラークラス
         index.ts                # エラークラス・統一レスポンス形式

      utils/                      # ユーティリティ
         retry.ts                # リトライ・サーキットブレーカー
         notification.ts         # 通知設定管理
         field-mapper.ts         # 型安全なフィールドマッピング
         index.ts                # エクスポート

      schemas/                    # 外部APIスキーマ検証
         external-api.ts         # Amazon Ads/BigQuery応答のZodスキーマ

      jobs/                      # バッチジョブ
         aggregation/           # 集計ジョブ
         lifecycle/             # ライフサイクル更新ジョブ

      routes/                    # APIルート
          cron.ts                # 定期実行エンドポイント
          lifecycle.ts           # ライフサイクルAPI
          debug.ts               # デバッグエンドポイント
          escore.ts              # E-Score API
          jungle-scout.ts        # Jungle Scout API
          unified-strategy.ts    # 統合戦略API
          seo-investment.ts      # SEO投資API
          health.ts              # ヘルスチェック
          executions.ts          # 実行履歴API
          negative-suggestions.ts # ネガティブ候補API

   tests/                         # テスト
      ltv-calculator.test.ts
      product-config-builder.test.ts
      logging/
         shadowMode.test.ts
         executionLogger.test.ts
      config/
          productConfigLoader.test.ts

   docs/                          # ドキュメント
       architecture.md            # このドキュメント
       ARCHITECTURE.md            # 概要仕様書
       LTV.md                     # LTV仕様書
       LIFECYCLE.md               # ライフサイクル仕様書
       SETUP.md                   # セットアップガイド
```

### モジュール責務一覧

| モジュール | 責務 |
|-----------|------|
| **engine/** | 入札エンジンのメイン処理、ProductConfigの読み込みとAPI呼び出し統合、Slack実行サマリー通知のトリガー |
| **ltv/** | LTV計算のACOS目標算出（LTV/SINGLE_PURCHASE判定とLTVモード判定） |
| **config/** | ProductConfig型定義（Single Source of Truth）、バリデーション、リポジトリパターン |
| **logging/** | 実行ログ記録とシャドウモード管理 |
| **lifecycle/** | ライフサイクルステージの遷移判定とライフサイクル提案 |
| **seo/** | SEO順位の取得と分析 |
| **bigquery/schemas/** | BigQueryテーブルのスキーマ定義 |
| **negative-keywords/** | 統計的安全性に基づくネガティブキーワード候補検出（SHADOWモード専用） |
| **auto-exact/** | AUTOキャンペーンからEXACTキーワードへの昇格候補検出（SHADOWモード専用） |
| **keywordDiscovery/** | 検索語レポートから新規キーワード候補を自動発見（SHADOWモード専用、Jungle Scout連携はフェーズ二） |
| **seasonality/** | 季節性予測による先行入札調整（Jungle Scout検索ボリューム履歴+カテゴリヒントでピーク予測） |
| **guardrails/** | 入札の上下限（ガードレール）を管理、履歴データから自動計算 |
| **inventory/** | 在庫連動の入札ガード（在庫ゼロでハードキル、在庫薄でソフトスロットル） |
| **adaptive-escore/** | 適応型E-Score最適化（フィードバックループによる重み自動調整、異常検知・ロールバック） |
| **jungle-scout/** | Jungle Scout API連携（キーワードインテリジェンス、シェア・オブ・ボイス、戦略分析） |
| **unified-strategy/** | 統合入札戦略（市場データ+収益性+広告パフォーマンスの統合、SEO投資戦略） |
| **slack/** | Slack通知モジュール（実行サマリー通知、ライフサイクル変更通知） |
| **lib/** | 共通ライブラリ（Slackクライアント、ライフサイクル通知ヘルパー） |
| **utils/** | ユーティリティ（リトライ・サーキットブレーカー、通知設定管理、型安全フィールドマッピング） |
| **errors/** | カスタムエラークラス（AppError、RateLimitError等）と統一レスポンス形式 |
| **schemas/** | 外部API応答のZodスキーマ検証（Amazon Ads、BigQuery応答の型安全な検証） |
| **jobs/** | 定期実行の集計ジョブ |

---

## 2. compute_bid_recommendations 処理フロー

### 全体フロー

```

                       runBidEngine()
                     (src/engine/bidEngine.ts)

                                │
                                ▼

  1. 実行モード確認
     logExecutionModeOnStartup()
     - BID_ENGINE_EXECUTION_MODE 環境変数を確認
     - SHADOW または APPLY モードを判定

                                │
                                ▼

  2. 実行ログ開始
     executionLogger.start()
     - execution_id (UUID) を生成
     - executions テーブルに RUNNING ステータスで記録

                                │
                                ▼

  3. ProductConfig読込
     loadAllProductConfigs()
     - product_config テーブルから有効な商品設定を取得
     - ASINをキーとしたMapで返却

                                │
                                ▼

  4. キーワード指標取得
     fetchKeywordMetrics()
     - keyword_metrics_60d テーブルから 指標を取得
     - product_seo_rank_history からSEO順位も取得

                                │
                                ▼

  4.5. 在庫スナップショット取得
     inventoryRepo.getInventorySnapshots()
     - product_strategy テーブルから days_of_inventory を取得
     - ASINごとの InventoryRiskStatus を計算

                                │
                                ▼

  5. 商品・キーワードごとに推奨計算
     for each (product, keyword):
         computeRecommendation()
            getTargetAcosWithDetails()  # 目標ACOS算出
            determineBidAction()         # アクション決定
            calculateRecommendedBid()    # 推奨入札額算出
            applyInventoryGuard()        # 在庫ガード適用（ハードキル/ソフトスロットル）
            determineReasonCode()        # 理由コード決定
         executionLogger.logRecommendation()
         applyBidWithMode()              # API呼出（APPLYモードのみ）

                                │
                                ▼

  6. 実行ログ完了
     executionLogger.finish()
     - executions テーブルを SUCCESS/ERROR で更新
     - 統計情報（applied_count, skipped_count等）を記録

```

### 推奨計算の詳細（computeRecommendation）

```typescript
// src/engine/bidEngine.ts:292-345

function computeRecommendation(
  product: ProductConfig,
  metrics: KeywordMetrics,
  lifecycleConfig: LifecycleGlobalConfig
): BidRecommendation {
  // 1. 目標ACOS算出（LTV考慮）
  const acosDetails = getTargetAcosWithDetails(product);
  const targetAcos = acosDetails.targetAcos;

  // 2. アクション決定
  const isInvestMode =
    product.lifecycleState === "LAUNCH_HARD" ||
    product.lifecycleState === "LAUNCH_SOFT";
  const action = determineBidAction(
    metrics.currentAcos,
    targetAcos,
    metrics.clicks7d,
    isInvestMode
  );

  // 3. 推奨入札額算出
  const { recommendedBid, changeRate } = calculateRecommendedBid(
    metrics.currentBid || 100,
    action,
    lifecycleConfig
  );

  // 4. 理由コード決定
  const reasonCode = determineReasonCode(product, metrics, action);

  return { ... };
}
```

### アクション決定ロジック

| アクション | 条件 |
|-----------|------|
| STRONG_UP | クリック数 >= 閾値 & ACOS < target × 0.7 |
| MILD_UP | ACOS < target × 0.9 |
| KEEP | ACOS が target の±10% 以内 |
| MILD_DOWN | ACOS > target × 1.1 |
| STRONG_DOWN | ACOS > target × 1.5 |
| STOP | ACOS > target × 3.0（危険水準） |

---

## 3. lifecycle_state / lifecycle_suggested_state の仕様

### ライフサイクルステージ

```typescript
type LifecycleStage = "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST";
```

| ステージ | 説明 | ACOS上限 |
|---------|------|---------|
| LAUNCH_HARD | 投資最大（積極的赤字投資） | 約60% |
| LAUNCH_SOFT | やや赤字〜トントン | 約50% |
| GROW | バランス運用 | 約45% |
| HARVEST | 利益回収 | 約35% |

### lifecycle_state の仕様（遷移ロジック）

`src/lifecycle/transition-logic.ts` で定義

```

                   evaluateLifecycleTransition()

  入力:
  - product (ProductStrategy)
  - monthlyProfit (月次利益)
  - seoScore (SEOスコア)
  - prevProfits (過去の利益履歴)
  - globalCumulativeLossLimit (累積赤字上限)

                              │
                              ▼

  1. 安全装置チェック
     checkGlobalSafety()
     - 連続3ヶ月赤字継続 → 強制HARVEST
     - 累積赤字が上限超過 → 強制HARVEST
     - レビュー評価 < 3.5 (100件以上) → 強制HARVEST

                              │
                              ▼

  2. SEOレベル判定
     getSeoLevel(seoScore)
     - HIGH: SEOスコア >= 70
     - MID:  SEOスコア >= 40
     - LOW:  SEOスコア < 40

                              │
                              ▼

  3. ステージ別遷移判定

  LAUNCH_HARD から:
    → GROW: 期間満了 & SEO HIGH & 黒字
    → LAUNCH_SOFT: TACOS超過 or 赤字超過 or SEO改善遅い
    → HARVEST: 期間超過 & SEO LOW

  LAUNCH_SOFT から:
    → LAUNCH_HARD: SEO LOW回復 & TACOS良好 & 赤字余裕あり
    → GROW: SEO HIGH達成 & 黒字
    → HARVEST: 期間超過 & SEO未達 & 累積赤字

  GROW から:
    → HARVEST: SEO悪化 & 赤字継続
    → LAUNCH_SOFT: SEO低下 & 再投資許可あり

  HARVEST から:
    → 基本的に維持（手動でのみ変更可）

```

### lifecycle_suggested_state の仕様（ライフサイクル提案）

`src/lifecycle/lifecycleSuggestion.ts` で自動提案を生成

```typescript
// 入力
interface LifecycleSuggestionInput {
  product: ProductConfig;
  seo: SeoMetrics;            // SEO順位情報
  acosRecent: number | null;  // 直近30日のACOS
  cvrRecent: number | null;   // 直近のCVR
  cvrCategoryAvg: number | null;
  reviewCount: number | null;
  avgRating: number | null;
  daysOfInventory: number | null;
  isBeforeBigSale: boolean;   // 大型セール14日前かどうか
}

// 判定優先順位
1. HARVEST提案
   - クリック数 < 10件/週
   - ACOS > target × 1.3
   - SEO順位が改善の見込みなし

2. LAUNCH_HARD推奨
   - SEO順位がMID_ZONE内に複数
   - CVRがカテゴリ平均以上でまだ順位が低い
   - 大型セール前
   - 在庫十分かつCVRが良好で伸びしろあり

3. GROW 移行
   - SEOが安定/良好
   - クリック数が十分
   - ACOSが目標付近

4. LAUNCH_SOFT（デフォルト）
   - 上記に該当しない場合
```

### SEO順位ゾーン

| ゾーン | 順位範囲 | 説明 |
|-------|---------|------|
| TOP_ZONE | 1-7位 | 安定/良好 |
| MID_ZONE | 8-20位 | 投資価値あり |
| OUT_OF_RANGE | 21位以降 | 投資優先度低 |

### LAUNCH終了評価（SEOローンチ評価）

LAUNCH_HARD / LAUNCH_SOFT の ASIN について、GROW への移行判定を行う機能。
`docs/bid_core.md` の35章で定義されている仕様に基づき実装。

#### 処理フロー

```
LAUNCH期ASIN
    │
    ▼
evaluateLaunchExitForAsin()
├── computeLaunchExitThresholdsForAsin()
│   └── 日販数でスケーリングされた閾値を計算
└── decideLaunchExitWithScaling()
    └── SEO進捗、日数/データ、lossBudgetで判定
    │
    ▼
decideNextLifecycleStageForAsin()
├── shouldExitLaunch = true → GROW への遷移を返す
└── shouldExitLaunch = false → null（継続）
```

#### 実装ファイル

| ファイル | 役割 |
|---------|------|
| `src/lifecycle/seo-launch-evaluator.ts` | SEOローンチ評価、終了判定、`evaluateLaunchExitForAsin()` |
| `src/lifecycle/transition-logic.ts` | `decideNextLifecycleStageForAsin()` |
| `src/lifecycle/lifecycleSuggestion.ts` | `computeLifecycleSuggestionWithLaunchExit()` |
| `src/lifecycle/launchExitDecisionLogger.ts` | BigQueryログ出力 |

#### BigQueryテーブル

`launch_exit_decisions` テーブルにSHADOWモードでログを保存。

| カラム | 説明 |
|-------|------|
| `asin` | 評価対象ASIN |
| `current_lifecycle_stage` | 現在のステージ（LAUNCH_HARD/LAUNCH_SOFT） |
| `suggested_lifecycle_stage` | 提案されるステージ（GROWなど） |
| `should_exit_launch` | LAUNCH終了判定結果 |
| `is_emergency_exit` | 緊急終了かどうか（lossBudget超過等） |
| `seo_completion_ratio` | SEO完了率 |
| `days_since_launch` | ローンチ開始からの日数 |
| `loss_budget_ratio` | lossBudget消費率 |

---

## 4. target_acos の仕様と LTV 計算の詳細

### 計算フロー

```

                         ProductConfig
                   ┌─────────────────────────┐
    revenueModel          ltvMode        lifecycleState
   LTV/SINGLE_PURCH  ASSUMED/EARLY/     LAUNCH_HARD/SOFT
                     MEASURED           GROW/HARVEST


                              │
                              ▼

              computeBaseLtvTargetAcos()
  ┌──────────────────────────────────────────────────────────┐
   SINGLE_PURCHASE:
     marginRate × SINGLE_PURCHASE_SAFETY_FACTOR (0.8)
     例: 粗利率35% → 35% × 0.8 = 28%
  ├──────────────────────────────────────────────────────────┤
   LTV (MEASURED):
     marginRate × expectedRepeatOrdersMeasured × safety_m
     例: 45% × 2.8 × 0.85 = 107% → 上限適用で 90%
  ├──────────────────────────────────────────────────────────┤
   LTV (ASSUMED/EARLY_ESTIMATE):
     marginRate × expectedRepeatOrdersAssumed × safety_a
     例: 45% × 2.5 × 0.7 = 78.75%
  └──────────────────────────────────────────────────────────┘

                              │
                              ▼

              computeFinalTargetAcos()
  ┌──────────────────────────────────────────────────────────┐
   LAUNCH_HARD:  min(baseLtvAcos × 1.0, 0.60)
   LAUNCH_SOFT:  min(baseLtvAcos × 0.9, 0.50)
   GROW:         min(baseLtvAcos × 0.8, 0.45)
   HARVEST:      min(marginRate × 0.8, 0.35)
  └──────────────────────────────────────────────────────────┘

                              │
                              ▼
                         target_acos
```

### LTVモードの判定条件

```typescript
// src/ltv/ltv-calculator.ts:33-61

function determineLtvMode(
  daysSinceLaunch: number | null,
  newCustomersTotal: number,
  thresholds: LtvModeThresholds
): LtvMode {
  // 発売日情報がない場合はASSUMED
  if (daysSinceLaunch === null) {
    return "ASSUMED";
  }

  // MEASURED: 120日以上 & 200人以上
  if (
    daysSinceLaunch >= 120 &&
    newCustomersTotal >= 200
  ) {
    return "MEASURED";
  }

  // EARLY_ESTIMATE: 60日以上 & 50人以上
  if (
    daysSinceLaunch >= 60 &&
    newCustomersTotal >= 50
  ) {
    return "EARLY_ESTIMATE";
  }

  // その他はASSUMED
  return "ASSUMED";
}
```

| LTVモード | 発売日経過 | 新規顧客数 | 使用値 |
|----------|---------|-----------|-----------|
| ASSUMED | < 60日 or < 50人 | - | 仮定値（expectedRepeatOrdersAssumed） |
| EARLY_ESTIMATE | >= 60日 and >= 50人 | < 200人 | 仮定値（安全係数適用） |
| MEASURED | >= 120日 | >= 200人 | 実測値（expectedRepeatOrdersMeasured） |

### 計算例

#### サプリメント商品（LTV）

```
条件:
- revenueModel: "LTV"
- marginRate: 0.45 (45%)
- expectedRepeatOrdersAssumed: 2.5回
- safetyFactorAssumed: 0.7
- lifecycleState: "LAUNCH_HARD"

計算:
1. baseLtvAcos = 0.45 × 2.5 × 0.7 = 0.7875 (78.75%)
2. finalAcos = min(0.7875 × 1.0, 0.60) = 0.60 (60%)
```

#### シューズ商品（SINGLE_PURCHASE）

```
条件:
- revenueModel: "SINGLE_PURCHASE"
- marginRate: 0.35 (35%)
- lifecycleState: "GROW"

計算:
1. baseLtvAcos = 0.35 × 0.8 = 0.28 (28%)
2. finalAcos = min(0.28 × 0.8, 0.45) = 0.224 (22.4%)
```

### ACOS定数

```typescript
const ACOS_CONSTANTS = {
  // 単発購入商品の安全係数
  SINGLE_PURCHASE_SAFETY_FACTOR: 0.8,

  // ライフサイクルステージ別ACOS上限
  LAUNCH_HARD_TARGET_ACOS_CAP: 0.60,
  LAUNCH_SOFT_TARGET_ACOS_CAP: 0.50,
  GROW_TARGET_ACOS_CAP: 0.45,
  HARVEST_TARGET_ACOS_CAP: 0.35,

  // ACOS計算結果の最小/最大値
  MIN_ACOS: 0,
  MAX_ACOS: 0.9,

  // HARVESTモードの粗利率係数
  HARVEST_MARGIN_MULTIPLIER: 0.8,

  // ステージ別のLTV ACOS係数
  LAUNCH_SOFT_LTV_MULTIPLIER: 0.9,
  GROW_LTV_MULTIPLIER: 0.8,
};
```

---

## 5. AUTO→EXACT 昇格ロジック

### 概要

AUTOキャンペーンで良好なパフォーマンスを示した検索語をEXACTキーワードとして昇格させる候補を検出する機能です。
**SHADOWモード専用**であり、自動でAmazon Ads APIへの登録は行いません。

### アーキテクチャ

```
src/auto-exact/
├── index.ts                      # エクスポート
├── types.ts                      # 型定義
├── auto-exact-promotion-engine.ts # メイン計算ロジック（純粋関数）
└── auto-exact-promotion-job.ts   # BigQueryジョブ実行
```

### 処理フロー

```

              computeAutoExactPromotionCandidates()
            (src/auto-exact/auto-exact-promotion-engine.ts)

                                │
                                ▼

  1. ライフサイクル別の昇格設定を取得
     getPromotionConfigForLifecycle(lifecycleState)
     - LAUNCH_HARD: 緩和した閾値（積極的に昇格）
     - LAUNCH_SOFT: やや緩和
     - GROW: 標準設定
     - HARVEST: 厳格な閾値

                                │
                                ▼

  2. ベースラインCVRの計算
     effective_baseline_cvr = max(asin_baseline_cvr, portfolio_baseline_cvr)

                                │
                                ▼

  3. クラスタフィルタ（ステージ1）
     filterEligibleClusters()
     - cluster_clicks >= clusterMinClicks
     - cluster_orders >= clusterMinOrders
     - cluster_cvr >= effective_baseline_cvr × clusterCvrRatio
     - cluster_acos <= target_acos × clusterAcosRatio

                                │
                                ▼

  4. 検索語フィルタ（ステージ2）
     isSearchTermEligible()
     - keyword_clicks >= keywordMinClicks
     - keyword_orders >= keywordMinOrders
     - keyword_cvr >= max(cluster_cvr, effective_baseline_cvr) × keywordCvrRatio
     - keyword_acos <= target_acos × keywordAcosRatio

                                │
                                ▼

  5. 重複チェック
     isDuplicateExactKeyword()
     - 既存のMANUAL EXACTキーワードと重複していないか

                                │
                                ▼

  6. ネガティブ除外チェック
     isNegativeKeywordCandidate()
     - ネガティブキーワード候補として検出済みでないか

                                │
                                ▼

  7. スコア計算と理由コード決定
     calculatePromotionScore()
       score = cvr / (acos / target_acos)
     determineReasonCodes()

                                │
                                ▼

  8. BigQuery保存（SHADOWモードのみ）
     auto_exact_promotion_suggestions テーブルに INSERT

```

### ライフサイクル別昇格設定

| ライフサイクル | clusterMinClicks | clusterMinOrders | clusterCvrRatio | clusterAcosRatio | keywordMinClicks | keywordMinOrders | keywordCvrRatio | keywordAcosRatio |
|--------------|------------------|------------------|-----------------|------------------|------------------|------------------|-----------------|------------------|
| LAUNCH_HARD | 40 | 2 | 0.9 | 1.5 | 8 | 1 | 1.05 | 1.4 |
| LAUNCH_SOFT | 45 | 2 | 0.95 | 1.4 | 9 | 2 | 1.08 | 1.3 |
| GROW | 50 | 3 | 1.0 | 1.3 | 10 | 2 | 1.1 | 1.2 |
| HARVEST | 60 | 4 | 1.1 | 1.1 | 15 | 3 | 1.2 | 1.1 |

### BigQueryテーブル

#### auto_exact_promotion_suggestions（昇格候補テーブル）

```sql
CREATE TABLE auto_exact_promotion_suggestions (
  suggestion_id STRING NOT NULL,        -- UUID
  execution_id STRING NOT NULL,         -- 実行ID
  mode STRING NOT NULL,                 -- "SHADOW" 固定

  profile_id STRING NOT NULL,           -- Amazon Ads プロファイルID
  asin STRING NOT NULL,
  search_term STRING NOT NULL,          -- 昇格対象の検索語
  match_type STRING NOT NULL,           -- "EXACT" 固定

  campaign_id_auto STRING NOT NULL,     -- AUTO キャンペーンID
  ad_group_id_auto STRING NOT NULL,     -- AUTO 広告グループID
  campaign_id_manual_target STRING,     -- ターゲット MANUAL キャンペーンID
  ad_group_id_manual_target STRING,

  intent_cluster_id STRING,             -- 検索意図クラスタID
  intent_cluster_label STRING,

  lookback_days INT64 NOT NULL,         -- ルックバック日数（30日）

  -- 検索語パフォーマンス
  clicks INT64 NOT NULL,
  impressions INT64 NOT NULL,
  orders INT64 NOT NULL,
  sales NUMERIC NOT NULL,
  cost NUMERIC NOT NULL,
  cvr NUMERIC NOT NULL,
  acos NUMERIC NOT NULL,

  -- クラスタパフォーマンス
  cluster_clicks INT64,
  cluster_cvr NUMERIC,

  -- 基準値
  asin_baseline_cvr NUMERIC NOT NULL,
  portfolio_baseline_cvr NUMERIC NOT NULL,
  effective_baseline_cvr NUMERIC NOT NULL,
  target_acos NUMERIC NOT NULL,

  -- 判定情報
  score NUMERIC NOT NULL,               -- 昇格優先度スコア
  reason_codes ARRAY<STRING> NOT NULL,  -- ["HIGH_CVR", "LOW_ACOS", ...]
  reason_detail STRING,
  lifecycle_state STRING NOT NULL,

  -- 承認フロー
  status STRING NOT NULL DEFAULT 'PENDING',  -- PENDING/APPROVED/REJECTED/APPLIED
  approved_at TIMESTAMP,
  approved_by STRING,
  rejected_at TIMESTAMP,
  rejected_by STRING,
  rejection_reason STRING,

  is_applied BOOL NOT NULL DEFAULT FALSE,
  applied_at TIMESTAMP,
  apply_error STRING,

  suggested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(suggested_at)
CLUSTER BY asin, lifecycle_state, status;
```

### 型定義

```typescript
// src/auto-exact/types.ts

type LifecycleState = "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST";

type PromotionSuggestionStatus = "PENDING" | "APPROVED" | "REJECTED" | "APPLIED";

type PromotionReasonCode =
  | "HIGH_CVR"              // CVR が基準を上回る
  | "LOW_ACOS"              // ACOS が目標以下
  | "HIGH_VOLUME"           // クリック数・注文数が十分
  | "CLUSTER_PERFORMER"     // クラスタ内で特に優秀
  | "LIFECYCLE_BOOST";      // ライフサイクル緩和により昇格

interface PromotionConfig {
  clusterMinClicks: number;
  clusterMinOrders: number;
  clusterCvrRatio: number;
  clusterAcosRatio: number;
  keywordMinClicks: number;
  keywordMinOrders: number;
  keywordCvrRatio: number;
  keywordAcosRatio: number;
}

interface PromotionCandidate {
  profileId: string;
  asin: string;
  searchTerm: string;
  matchType: "EXACT";
  campaignIdAuto: string;
  adGroupIdAuto: string;
  campaignIdManualTarget: string | null;
  adGroupIdManualTarget: string | null;
  intentClusterId: string | null;
  intentClusterLabel: string | null;
  clicks: number;
  impressions: number;
  orders: number;
  sales: number;
  cost: number;
  cvr: number;
  acos: number;
  clusterClicks: number | null;
  clusterCvr: number | null;
  asinBaselineCvr: number;
  portfolioBaselineCvr: number;
  effectiveBaselineCvr: number;
  targetAcos: number;
  score: number;
  reasonCodes: PromotionReasonCode[];
  reasonDetail: string | null;
  lifecycleState: LifecycleState;
}
```

### スコア計算

```typescript
/**
 * 昇格優先度スコアを計算
 * score = cvr / (acos / target_acos)
 * CVR が高く、ACOS が低いほど高スコア
 */
function calculatePromotionScore(cvr: number, acos: number, targetAcos: number): number {
  if (targetAcos <= 0 || acos <= 0) {
    return cvr * 100;
  }
  const acosRatio = acos / targetAcos;
  return cvr / acosRatio;
}
```

### 理由コード判定

```typescript
function determineReasonCodes(
  cvr: number,
  acos: number,
  targetAcos: number,
  effectiveBaselineCvr: number,
  clusterCvr: number | null,
  clicks: number,
  orders: number,
  config: PromotionConfig,
  lifecycleState: LifecycleState
): PromotionReasonCode[] {
  const reasons: PromotionReasonCode[] = [];

  // HIGH_CVR: CVR が有効ベースラインの 1.5 倍以上
  if (cvr >= effectiveBaselineCvr * 1.5) {
    reasons.push("HIGH_CVR");
  }

  // LOW_ACOS: ACOS が目標の 0.8 倍以下
  if (acos <= targetAcos * 0.8) {
    reasons.push("LOW_ACOS");
  }

  // HIGH_VOLUME: クリック数・注文数が閾値の 2 倍以上
  if (clicks >= config.keywordMinClicks * 2 && orders >= config.keywordMinOrders * 2) {
    reasons.push("HIGH_VOLUME");
  }

  // CLUSTER_PERFORMER: クラスタCVRより 30% 以上高い
  if (clusterCvr && cvr >= clusterCvr * 1.3) {
    reasons.push("CLUSTER_PERFORMER");
  }

  // LIFECYCLE_BOOST: LAUNCH系で緩和閾値による昇格
  if (lifecycleState === "LAUNCH_HARD" || lifecycleState === "LAUNCH_SOFT") {
    reasons.push("LIFECYCLE_BOOST");
  }

  return reasons;
}
```

### APIエンドポイント

#### POST /cron/run-auto-exact-promotion

AUTO→EXACT昇格候補を計算してBigQueryに保存します（SHADOWモード専用）。

**リクエストボディ**:

```json
{
  "profileId": "1234567890",     // オプション（指定しない場合は全プロファイル）
  "targetAsins": ["B0XXXXXXXXX"], // オプション（指定しない場合は全ASIN）
  "lookbackDays": 30,            // オプション（デフォルト: 30）
  "dryRun": false                // オプション（true でテーブル保存しない）
}
```

**レスポンス**:

```json
{
  "success": true,
  "data": {
    "executionId": "uuid-xxxx",
    "mode": "SHADOW",
    "durationMs": 5234,
    "totalAsinsProcessed": 50,
    "totalClustersProcessed": 200,
    "clustersPassedFilter": 80,
    "totalSearchTermsProcessed": 1500,
    "searchTermsPassedFilter": 120,
    "duplicatesExcluded": 15,
    "negativesExcluded": 5,
    "candidatesGenerated": 100
  }
}
```

### 使用例

```typescript
import {
  computeAutoExactPromotionCandidates,
  runAutoExactPromotionJob,
} from "./auto-exact";

// 方法1: 純粋関数を直接使用（テスト用）
const result = computeAutoExactPromotionCandidates(
  searchTerms,
  clusters,
  baselines,
  productConfigs,
  targetCampaigns,
  existingKeywords,
  negativeKeywordQueries,
  profileId,
  "SHADOW"
);

console.log(`候補数: ${result.candidates.length}`);
console.log(`統計: `, result.stats);

// 方法2: ジョブを実行（BigQueryから読み込み・保存）
const jobResult = await runAutoExactPromotionJob({
  profileId: "1234567890",
  targetAsins: ["B0XXXXXXXXX"],
  lookbackDays: 30,
  dryRun: false,
});

console.log(`実行ID: ${jobResult.executionId}`);
console.log(`生成候補数: ${jobResult.candidatesGenerated}`);
```

### BigQueryビュー

- **auto_exact_promotion_suggestions_pending**: PENDINGステータスの候補一覧
- **auto_exact_promotion_suggestions_approved**: APPROVEDステータス（未適用）の候補一覧
- **auto_exact_promotion_suggestions_summary**: ASIN別・ライフサイクル別のサマリー
- **auto_exact_promotion_suggestions_top**: 上位100件のスコア順候補

### 管理用 API エンドポイント

```
GET  /admin/auto-exact-suggestions              # 候補一覧取得
GET  /admin/auto-exact-suggestions/summary      # ステータス別サマリー
GET  /admin/auto-exact-suggestions/top          # 高スコア候補トップN
GET  /admin/auto-exact-suggestions/:id          # 候補詳細
POST /admin/auto-exact-suggestions/approve      # 一括承認
POST /admin/auto-exact-suggestions/reject       # 一括却下
POST /admin/auto-exact-suggestions/apply-queued # APPROVED候補をAmazonに適用（プレースホルダー）
```

#### 一覧取得 クエリパラメータ

| パラメータ | 型 | 説明 |
|-----------|------|------|
| status | string | ステータスでフィルタ（PENDING, APPROVED, REJECTED, APPLIED） |
| asin | string | ASINでフィルタ |
| lifecycleState | string | ライフサイクルでフィルタ（LAUNCH_HARD, LAUNCH_SOFT, GROW, HARVEST） |
| minScore | number | 最小スコアでフィルタ |
| limit | number | 取得件数（デフォルト: 100, 最大: 1000） |
| offset | number | オフセット |

#### 承認リクエストボディ

```json
{
  "suggestionIds": ["uuid1", "uuid2"],
  "approvedBy": "user@example.com"
}
```

#### 却下リクエストボディ

```json
{
  "suggestionIds": ["uuid1", "uuid2"],
  "rejectedBy": "user@example.com",
  "reason": "Search term too generic"
}
```

#### apply-queued エンドポイント詳細

**リクエストボディ**:

```json
{
  "dryRun": true,      // true の場合、適用対象数のみ返却（デフォルト: false）
  "maxItems": 100      // 最大処理件数（デフォルト: 無制限）
}
```

**レスポンス（適用実行時）**:

```json
{
  "success": true,
  "data": {
    "approvedCount": 25,
    "wouldProcess": 25,
    "applyEnabled": true,
    "dryRun": false,
    "appliedCount": 23,           // 完全成功件数
    "partialSuccessCount": 1,     // 部分成功件数（キーワード作成のみ成功）
    "failedCount": 1,
    "skippedCount": 0,
    "results": [
      {
        "suggestionId": "uuid-1",
        "searchTerm": "example keyword",
        "keywordCreated": true,
        "keywordId": "12345",
        "negativeCreated": true,
        "negativeKeywordId": "67890"
      }
    ]
  }
}
```

**適用フロー**:
1. BigQuery から `status='APPROVED'` かつ `is_applied=FALSE` の候補を取得
2. `campaign_id_manual_target` と `ad_group_id_manual_target` が設定されている候補のみ処理
3. ターゲット MANUAL キャンペーンに EXACT キーワードを作成（Amazon Ads API `/sp/keywords`）
4. 元の AUTO キャンペーンにネガティブ EXACT を登録（カニバリゼーション防止）
5. 成功したら `status='APPLIED'`, `is_applied=TRUE`, `applied_at=現在時刻` に更新
6. 失敗したら `apply_error` に理由を記録

### フェーズ構成

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  フェーズ 1: SHADOW サジェスト ✅                                            │
│                                                                             │
│  ・2段階フィルタ（クラスタ→検索語）で昇格候補を検出                         │
│  ・BigQuery の auto_exact_promotion_suggestions テーブルに候補を保存        │
│  ・Amazon Ads API への自動登録は行わない（SHADOW モード専用）               │
├─────────────────────────────────────────────────────────────────────────────┤
│  フェーズ 2: 承認フロー ✅                                                   │
│                                                                             │
│  ・候補にステータス列（PENDING → APPROVED/REJECTED）を追加 ✅               │
│  ・管理用 REST API でレビュー・承認・却下操作 ✅                             │
│  ・人間によるレビューを必須とし、誤昇格を防止 ✅                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  フェーズ 3: APPLY モード ✅                                                 │
│                                                                             │
│  ・APPROVED 状態の候補を Amazon Ads API に自動適用 ✅                        │
│  ・EXACT キーワードの新規作成 (POST /sp/keywords) ✅                        │
│  ・AUTO キャンペーンへのネガティブ登録（カニバリ防止）✅                    │
│  ・適用後、ステータスを APPLIED に更新 ✅                                    │
│  ・MAX_APPLY_CHANGES_PER_RUN による適用件数上限 ✅                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. SHADOW / APPLY モードの動作

### モード定義

```typescript
type ExecutionMode = "APPLY" | "SHADOW";
```

| モード | 推奨計算 | ログ記録 | API呼び出し | 安全制限 |
|--------|---------|---------|------------|---------|
| SHADOW | ○ | ○ | × | - |
| APPLY | ○ | ○ | ○ | allowlist + 件数上限 |

### APPLYモードの安全設計

APPLYモードでは、以下の安全制限が適用されます：

1. **キャンペーン allowlist**: `APPLY_CAMPAIGN_ALLOWLIST` に含まれるキャンペーンのみAPI適用
2. **1回あたりの件数上限**: `MAX_APPLY_CHANGES_PER_RUN` を超える推奨はスキップ
3. **最小変更幅**: 変更幅が閾値未満の場合はスキップ

```
推奨計算 → APPLYフィルタリング → allowlistチェック → 件数上限チェック → API呼び出し
                                      ↓ NG               ↓ 超過
                                 スキップ(ログ)      スキップ(ログ)
```

### 環境変数設定

```bash
# シャドウモード（デフォルト）
BID_ENGINE_EXECUTION_MODE=SHADOW

# 本番適用モード
BID_ENGINE_EXECUTION_MODE=APPLY

# ========================================
# APPLY モード安全制限設定
# ========================================

# 1回のジョブ実行で実際にAPIへ送ってよいbid更新件数の上限
# デフォルト: 100
MAX_APPLY_CHANGES_PER_RUN=100

# APPLYを許可するcampaignIdのリスト（カンマ区切り）
# 空の場合は全キャンペーンがSHADOW扱い（安全デフォルト）
# 例: APPLY_CAMPAIGN_ALLOWLIST=12345678901234,98765432109876
APPLY_CAMPAIGN_ALLOWLIST=

# APPLYに必要な最小変更幅（円）
# デフォルト: 1
MIN_APPLY_CHANGE_AMOUNT=1

# APPLYに必要な最小変更率（比率）
# 例: 0.01 = 1%未満の変更はスキップ
# デフォルト: 0.01
MIN_APPLY_CHANGE_RATIO=0.01

# ネガティブキーワード APPLY モード（デフォルト: false）
# APPROVED 状態の候補を Amazon Ads API に適用する
NEGATIVE_APPLY_ENABLED=false

# ネガティブキーワード自動適用の最小クリック数閾値
NEGATIVE_AUTO_APPLY_MIN_CLICKS=50

# ネガティブキーワード自動適用の最小コスト閾値
NEGATIVE_AUTO_APPLY_MIN_COST=2000

# AUTO→EXACT昇格 APPLY モード（デフォルト: false）
# APPROVED 状態の候補を Amazon Ads API に適用する
AUTO_EXACT_APPLY_ENABLED=false

# AUTO→EXACT昇格時のデフォルト入札額
AUTO_EXACT_DEFAULT_BID=100
```

### APPLYスキップ理由

| スキップ理由 | 説明 |
|-------------|------|
| `SHADOW_MODE` | SHADOWモードのためスキップ |
| `NOT_IN_ALLOWLIST` | キャンペーンが `APPLY_CAMPAIGN_ALLOWLIST` に含まれていない |
| `APPLY_LIMIT_REACHED` | `MAX_APPLY_CHANGES_PER_RUN` の上限に達した |
| `NO_SIGNIFICANT_CHANGE` | 変更幅が閾値未満 |
| `API_ERROR` | API呼び出しエラー |

### APPLYフィルタリングのログ

各キーワード推奨ログに以下のフィールドが追加されます：

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `is_apply_candidate` | boolean | APPLY候補かどうか |
| `apply_skip_reason` | string | スキップ理由 |

実行単位ログには以下が追加されます：

| フィールド | 説明 |
|-----------|------|
| `total_apply_candidates` | APPLY候補件数 |
| `total_applied` | 実際にAPI適用した件数 |
| `total_apply_failed` | API呼び出し失敗件数 |
| `skip_count_*` | スキップ理由別件数 |

### NEGATIVE_APPLY_ENABLED 環境変数

ネガティブキーワード候補の Amazon Ads API への自動適用を制御するフラグです。

| 環境変数 | アプリ設定 | デフォルト | 説明 |
|---------|-----------|-----------|------|
| `NEGATIVE_APPLY_ENABLED` | `negativeApplyEnabled` | `false` | ネガティブキーワード APPLY モードの有効/無効 |

**動作**:
- `false`（デフォルト）: `/admin/negative-suggestions/apply-queued` エンドポイントは候補数のカウントのみを返し、実際の適用は行わない
- `true`: APPROVED 状態の候補を Amazon Ads API にネガティブキーワードとして登録し、BigQuery のステータスを APPLIED に更新する

**適用フロー**:
1. BigQuery から `status='APPROVED'` かつ `is_applied=FALSE` の候補を取得
2. `campaign_id` と `ad_group_id` が設定されている候補のみ処理
3. Amazon Ads API `/sp/negativeKeywords` にPOSTリクエスト
4. 成功したら `status='APPLIED'`, `is_applied=TRUE`, `applied_at=現在時刻` に更新
5. 失敗したら `apply_error` に理由を記録

**自動適用オプション**:
`includeAutoApply=true` パラメータを指定すると、以下の条件を満たす PENDING 候補も自動適用対象になる:
- `clicks_30d >= NEGATIVE_AUTO_APPLY_MIN_CLICKS` (デフォルト: 50)
- `cost_30d >= NEGATIVE_AUTO_APPLY_MIN_COST` (デフォルト: 2000)
- `cvr_30d = 0` (コンバージョンなし)

**設定方法**:

```bash
# 開発環境（.env）
NEGATIVE_APPLY_ENABLED=false

# 本番環境（Cloud Run）
gcloud run services update amazon-bid-engine \
  --update-env-vars NEGATIVE_APPLY_ENABLED=true
```

**アプリケーション内での参照**:

```typescript
// src/config.ts の EnvConfig に定義
negativeApplyEnabled: process.env.NEGATIVE_APPLY_ENABLED === "true"
```

### 実装詳細

```typescript
// src/logging/shadowMode.ts

/**
 * 実行モード取得
 */
export function getExecutionMode(): ExecutionMode {
  const mode = process.env.BID_ENGINE_EXECUTION_MODE?.toUpperCase();
  if (mode === "APPLY") {
    return "APPLY";
  }
  return "SHADOW"; // デフォルト
}

/**
 * シャドウモードかどうか判定
 */
export function isShadowMode(): boolean {
  return getExecutionMode() === "SHADOW";
}

/**
 * 入札適用をモードに応じて実行
 * - SHADOWモード: ログのみ記録、APIは呼ばない
 * - APPLYモード: ログ記録後にAPI呼び出し
 */
export async function applyBidWithMode<T>(
  applyFn: () => Promise<T>,
  context: { keywordId: string; keywordText: string; oldBid: number; newBid: number }
): Promise<{ wasApplied: boolean; result?: T; error?: Error }> {
  if (isShadowMode()) {
    logger.info("Shadow mode: Bid change logged but not applied", {
      keywordId: context.keywordId,
      keywordText: context.keywordText,
      oldBid: context.oldBid,
      newBid: context.newBid,
    });
    return { wasApplied: false };
  }

  try {
    const result = await applyFn();
    logger.info("Bid change applied", {
      keywordId: context.keywordId,
      keywordText: context.keywordText,
      oldBid: context.oldBid,
      newBid: context.newBid,
    });
    return { wasApplied: true, result };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error("Failed to apply bid change", {
      keywordId: context.keywordId,
      error: err.message,
    });
    return { wasApplied: false, error: err };
  }
}
```

### 使用例

```typescript
import {
  getExecutionMode,
  isShadowMode,
  applyBidWithMode,
  logExecutionModeOnStartup
} from "./logging";

// 起動時にモードをログ出力
logExecutionModeOnStartup();

// モード確認
if (isShadowMode()) {
  console.log("シャドウモードで実行中");
}

// API呼び出しのラップ
const { wasApplied, error } = await applyBidWithMode(
  async () => await amazonAdsClient.updateBid(keywordId, newBid),
  { keywordId, keywordText, oldBid, newBid }
);
```

---

## 7. BigQuery との連携

### 入力テーブル

#### product_config（商品設定テーブル - Single Source of Truth）

```sql
CREATE TABLE `{project_id}.{dataset}.product_config` (
  -- 識別子
  asin STRING NOT NULL,                    -- Amazon標準識別番号（主キー）
  product_id STRING,                       -- 内部商品ID
  sku STRING,                              -- SKU

  -- 有効フラグ
  is_active BOOL NOT NULL DEFAULT TRUE,    -- 入札エンジンの対象にするか

  -- 収益モデル
  revenue_model STRING NOT NULL DEFAULT 'LTV',
    -- "LTV": リピート購入前提
    -- "SINGLE_PURCHASE": 単発購入前提

  -- ライフサイクル
  lifecycle_state STRING NOT NULL DEFAULT 'GROW',

  -- ビジネスモード
  business_mode STRING NOT NULL DEFAULT 'PROFIT',
    -- "PROFIT": 利益優先
    -- "SHARE": シェア優先

  -- カテゴリ・ブランド
  category STRING,
  brand_type STRING NOT NULL DEFAULT 'GENERIC',

  -- 実験グループ
  experiment_group STRING NOT NULL DEFAULT 'CONTROL',

  -- LTV関連パラメータ
  margin_rate FLOAT64,
  expected_repeat_orders_assumed FLOAT64 DEFAULT 1.0,
  expected_repeat_orders_measured_180d FLOAT64,
  safety_factor_assumed FLOAT64 DEFAULT 0.7,
  safety_factor_measured FLOAT64 DEFAULT 0.85,
  launch_date DATE,
  new_customers_total INT64 DEFAULT 0,

  -- メタ情報
  created_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  PRIMARY KEY (asin) NOT ENFORCED
);
```

#### keyword_metrics_60d（キーワード指標）

```sql
-- 過去60日のキーワードパフォーマンスデータ
SELECT
  asin,
  keyword_id,
  keyword AS keyword_text,
  match_type,
  campaign_id,
  ad_group_id,
  current_bid,
  acos_7d AS current_acos,
  impressions_7d,
  clicks_7d,
  orders_7d AS conversions_7d,
  ad_spend_7d AS spend_7d,
  ad_sales_7d AS sales_7d,
  ctr_7d,
  cvr_7d
FROM `{project_id}.{dataset}.keyword_metrics_60d`
```

#### product_seo_rank_history（SEO順位履歴）

```sql
-- SEO順位の履歴データ
SELECT
  asin,
  keyword AS keyword_text,
  current_rank AS organic_rank,
  rank_trend AS organic_rank_trend,
  rank_zone AS organic_rank_zone
FROM `{project_id}.{dataset}.product_seo_rank_history`
```

### 出力テーブル

#### executions（実行ログ）

全ての実行（入札推奨計算、AUTO→EXACT昇格候補計算など）のログを記録するテーブルです。
`execution_id` を使って `bid_recommendations` および `auto_exact_promotion_suggestions` と紐付けます。

```sql
CREATE TABLE `{project_id}.{dataset}.executions` (
  -- 識別子
  id STRING NOT NULL,                      -- execution_id と同義
  profile_id STRING NOT NULL,              -- Amazon Ads プロファイルID
  mode STRING NOT NULL,                    -- "NORMAL" or "S_MODE"
  execution_type STRING NOT NULL,          -- "run-bid-normal", "run-bid-smode", "run-auto-exact-shadow" など
  status STRING NOT NULL,                  -- "SUCCESS", "ERROR"

  -- 時刻情報
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP NOT NULL,
  duration_ms INT64 NOT NULL,

  -- 処理統計
  total_keywords INT64,
  reco_count INT64,
  action_strong_up INT64,
  action_up INT64,
  action_down INT64,
  action_stop INT64,
  action_keep INT64,

  -- エラー・メモ
  error_message STRING,
  note STRING,
  config_snapshot STRING,

  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(started_at)
CLUSTER BY profile_id, execution_type;
```

**execution_type の種類**:

| execution_type | 説明 |
|----------------|------|
| run-bid-normal | NORMAL モードでの入札推奨計算 |
| run-bid-smode | S_MODE での入札推奨計算 |
| run-auto-exact-shadow | AUTO→EXACT 昇格候補計算（SHADOW） |

#### bid_recommendations（入札推奨テーブル - 新形式）

キーワード単位の入札推奨結果を記録するテーブルです。
`execution_id` で `executions` テーブルと紐付けます。

```sql
CREATE TABLE `{project_id}.{dataset}.bid_recommendations` (
  execution_id STRING NOT NULL,            -- executions.id と紐付け
  profile_id STRING NOT NULL,
  campaign_id STRING NOT NULL,
  ad_group_id STRING NOT NULL,
  keyword_id STRING NOT NULL,
  keyword_text STRING,
  match_type STRING,
  asin STRING,
  lifecycle_state STRING,
  target_acos NUMERIC,
  current_bid NUMERIC NOT NULL,
  recommended_bid NUMERIC NOT NULL,
  bid_change NUMERIC NOT NULL,             -- recommended - current
  bid_change_ratio NUMERIC NOT NULL,       -- recommended / current
  reason_codes STRING,                     -- カンマ区切り（例: "STRONG_UP,TOS_TARGETED"）
  impressions INT64,
  clicks INT64,
  orders INT64,
  sales NUMERIC,
  cost NUMERIC,
  cvr NUMERIC,
  acos NUMERIC,
  created_at TIMESTAMP NOT NULL,

  PRIMARY KEY (execution_id, keyword_id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY profile_id, asin;
```

#### 実行ログの紐付け

```
executions (1) ───── (N) bid_recommendations
    │
    └───── (N) auto_exact_promotion_suggestions

同一の execution_id で3つのテーブルを JOIN することで、
1回の実行で何が起きたかを完全に追跡できます。
```

**クエリ例**:

```sql
-- 特定の実行IDの全情報を取得
SELECT
  e.execution_id,
  e.execution_type,
  e.status,
  e.duration_ms,
  COUNT(DISTINCT br.keyword_id) AS bid_recommendations_count,
  COUNT(DISTINCT aeps.search_term) AS auto_exact_suggestions_count
FROM `{project}.amazon_bid_engine.executions` e
LEFT JOIN `{project}.amazon_bid_engine.bid_recommendations` br
  ON e.execution_id = br.execution_id
LEFT JOIN `{project}.amazon_bid_engine.auto_exact_promotion_suggestions` aeps
  ON e.execution_id = aeps.execution_id
WHERE e.execution_id = 'exec_xxxxx'
GROUP BY 1, 2, 3, 4;
```

#### keyword_recommendations_log（キーワード推奨ログ - 旧形式）

> **Note**: 旧形式です。新規実装では `bid_recommendations` テーブルを使用してください。

```sql
CREATE TABLE `{project_id}.{dataset}.keyword_recommendations_log` (
  -- 実行ID
  execution_id STRING NOT NULL,

  -- 対象識別子
  asin STRING NOT NULL,
  keyword_id STRING,
  keyword_text STRING NOT NULL,
  match_type STRING,
  campaign_id STRING,
  ad_group_id STRING,

  -- 入札額
  old_bid FLOAT64 NOT NULL,
  new_bid FLOAT64 NOT NULL,
  bid_change FLOAT64,
  bid_change_percent FLOAT64,

  -- ACOS関連
  target_acos FLOAT64,
  current_acos FLOAT64,
  acos_gap FLOAT64,

  -- 判定情報
  reason_code STRING NOT NULL,
  reason_detail STRING,

  -- 設定・ステータス情報
  lifecycle_state STRING,
  revenue_model STRING,
  ltv_mode STRING,
  business_mode STRING,
  brand_type STRING,
  experiment_group STRING,

  -- SEO情報
  seo_rank_current INT64,
  seo_rank_trend INT64,
  seo_rank_zone STRING,

  -- パフォーマンス指標
  impressions_7d INT64,
  clicks_7d INT64,
  conversions_7d INT64,
  spend_7d FLOAT64,
  sales_7d FLOAT64,
  ctr_7d FLOAT64,
  cvr_7d FLOAT64,

  -- 適用結果
  is_applied BOOL NOT NULL DEFAULT FALSE,
  applied_at DATETIME,
  apply_error STRING,

  -- メタ情報
  recommended_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),

  PRIMARY KEY (execution_id, asin, keyword_text) NOT ENFORCED
);
```

### データフロー図

```

                        入力テーブル
  ┌────────────────┐  ┌──────────────────┐  ┌────────────────┐
    product_config   keyword_metrics_60d   seo_rank_history
     (設定マスタ)         (指標集計)        (SEO順位)
  └────────────────┘  └──────────────────┘  └────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
                              ↓

                                 ▼

                       runCronJob() / runAutoExactShadowOnce()
    ┌────────────────────────────────────────────┐
    │  推奨計算・適用処理                         │
    │  - execution_id 生成                        │
    │  - ACOS目標算出                             │
    │  - アクション決定                           │
    │  - 入札額算出                               │
    │  - reason_code決定                          │
    └────────────────────────────────────────────┘

                                 │
                                 ▼
  ┌─────────────────────────┐  ┌────────────────────────────────┐
        executions                bid_recommendations (新)
     (実行単位のログ)              (キーワード単位のログ)
          │                       keyword_recommendations_log (旧)
          │                  └────────────────────────────────┘
          │
          └─────────────────┐
                            ▼
              ┌────────────────────────────────────────┐
                auto_exact_promotion_suggestions
                 (AUTO→EXACT昇格候補)
              └────────────────────────────────────────┘

  ※ 3つのテーブルは同一の execution_id で紐付けられる

```

### ダッシュボードレイヤー（実行結果閲覧API）

SHADOW 実行結果を参照するためのAPIエンドポイントとBigQueryビューを提供します。

#### API エンドポイント

すべてのエンドポイントはAPI Key認証が必要です。

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/admin/executions` | 実行履歴一覧 |
| GET | `/admin/executions/:executionId/asin-summary` | ASIN別サマリー |
| GET | `/admin/executions/:executionId/keyword-details` | キーワード詳細 |

##### GET /admin/executions

実行履歴の一覧を取得します。

**クエリパラメータ**:
- `limit` (optional): 取得件数（デフォルト20、最大100）
- `offset` (optional): オフセット（デフォルト0）
- `profile_id` (optional): プロファイルIDでフィルタ
- `execution_type` (optional): 実行タイプでフィルタ

**レスポンス例**:
```json
{
  "success": true,
  "data": [
    {
      "execution_id": "exec_20241126_123456",
      "profile_id": "1234567890",
      "execution_type": "run-auto-exact-shadow",
      "mode": "NORMAL",
      "status": "SUCCESS",
      "started_at": "2024-11-26T12:34:56.000Z",
      "ended_at": "2024-11-26T12:35:10.000Z",
      "duration_ms": 14000,
      "total_keywords": 500,
      "reco_count": 120,
      "action_strong_up": 10,
      "action_up": 40,
      "action_down": 30,
      "action_stop": 5,
      "action_keep": 35,
      "note": null
    }
  ],
  "pagination": {
    "total": 50,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

##### GET /admin/executions/:executionId/asin-summary

特定の実行のASIN別集計サマリーを取得します。

**クエリパラメータ**:
- `limit` (optional): 取得件数（デフォルト50、最大200）
- `offset` (optional): オフセット（デフォルト0）

**レスポンス例**:
```json
{
  "success": true,
  "data": [
    {
      "execution_id": "exec_20241126_123456",
      "profile_id": "1234567890",
      "execution_type": "run-auto-exact-shadow",
      "mode": "NORMAL",
      "started_at": "2024-11-26T12:34:56.000Z",
      "execution_status": "SUCCESS",
      "asin": "B0XXXXXXXXX",
      "total_keywords": 25,
      "action_up_count": 8,
      "action_down_count": 5,
      "action_keep_count": 12,
      "avg_bid_change_ratio": 1.05,
      "max_bid_change_ratio": 1.50,
      "min_bid_change_ratio": 0.70,
      "total_bid_change": 150,
      "total_impressions": 50000,
      "total_clicks": 500,
      "total_orders": 25,
      "total_sales": 125000,
      "total_cost": 25000,
      "calculated_acos": 0.20,
      "calculated_cvr": 0.05,
      "auto_exact_candidates": 3
    }
  ],
  "pagination": {
    "total": 15,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

##### GET /admin/executions/:executionId/keyword-details

特定の実行のキーワード別詳細を取得します。

**クエリパラメータ**:
- `limit` (optional): 取得件数（デフォルト100、最大500）
- `offset` (optional): オフセット（デフォルト0）
- `asin` (optional): 特定ASINでフィルタ
- `auto_exact_only` (optional): `true`でAUTO→EXACT候補のみ

**レスポンス例**:
```json
{
  "success": true,
  "data": [
    {
      "execution_id": "exec_20241126_123456",
      "profile_id": "1234567890",
      "execution_type": "run-auto-exact-shadow",
      "mode": "NORMAL",
      "started_at": "2024-11-26T12:34:56.000Z",
      "execution_status": "SUCCESS",
      "keyword_id": "kw_123",
      "keyword_text": "プロテイン おすすめ",
      "match_type": "BROAD",
      "campaign_id": "camp_001",
      "ad_group_id": "ag_001",
      "asin": "B0XXXXXXXXX",
      "lifecycle_state": "GROW",
      "current_bid": 100,
      "recommended_bid": 120,
      "bid_change": 20,
      "bid_change_ratio": 1.20,
      "target_acos": 0.25,
      "reason_codes": "ACOS_LOW,CVR_HIGH",
      "impressions": 1000,
      "clicks": 50,
      "orders": 5,
      "sales": 25000,
      "cost": 5000,
      "cvr": 0.10,
      "acos": 0.20,
      "is_auto_exact_candidate": true,
      "suggested_exact_keyword": "プロテイン おすすめ",
      "auto_exact_confidence": 0.85,
      "auto_exact_reason": "CVR > 5%, Orders > 3",
      "created_at": "2024-11-26T12:35:00.000Z"
    }
  ],
  "pagination": {
    "total": 500,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

#### BigQuery ビュー

オプションで BigQuery に集計ビューをデプロイすることで、より高速なクエリが可能になります。

**ファイル**:
- `sql/views/v_execution_asin_summary.sql` - ASIN別集計ビュー
- `sql/views/v_execution_keyword_details.sql` - キーワード詳細ビュー

**デプロイ方法**:
1. `${PROJECT_ID}` を実際のプロジェクトIDに置換
2. BigQueryコンソールまたはCLIでSQLを実行

```bash
# 例: bq コマンドでのデプロイ
sed 's/\${PROJECT_ID}/your-project-id/g' sql/views/v_execution_asin_summary.sql | bq query --use_legacy_sql=false
sed 's/\${PROJECT_ID}/your-project-id/g' sql/views/v_execution_keyword_details.sql | bq query --use_legacy_sql=false
```

---

## 8. reason_code の一覧と判定ロジック

### ReasonCode 一覧

```typescript
type ReasonCode =
  | "ACOS_HIGH"          // ACOSが目標より高い
  | "ACOS_LOW"           // ACOSが目標より低い（上げ余地あり）
  | "NO_CONVERSION"      // コンバージョンがない
  | "LOW_IMPRESSIONS"    // インプレッション不足
  | "ORGANIC_STRONG"     // オーガニック順位7位以内
  | "ORGANIC_WEAK"       // オーガニック順位21位以降
  | "LIFECYCLE_LAUNCH"   // ローンチ投資中
  | "LIFECYCLE_HARVEST"  // 回収モード
  | "NO_CHANGE"          // 変更なし
  | "BUDGET_CAP"         // 予算上限
  | "MIN_BID"            // 最低入札額制限
  | "MAX_BID";           // 最高入札額制限
```

### 判定ロジック

```typescript
// src/engine/bidEngine.ts:229-287

function determineReasonCode(
  product: ProductConfig,
  metrics: KeywordMetrics,
  action: string
): ReasonCode {
  // 1. ライフサイクルステージの判定（最優先）
  if (product.lifecycleState === "LAUNCH_HARD" ||
      product.lifecycleState === "LAUNCH_SOFT") {
    if (action === "STRONG_UP" || action === "MILD_UP") {
      return "LIFECYCLE_LAUNCH";
    }
  }

  if (product.lifecycleState === "HARVEST") {
    if (action === "MILD_DOWN" || action === "STRONG_DOWN") {
      return "LIFECYCLE_HARVEST";
    }
  }

  // 2. オーガニック順位による判定
  if (metrics.organicRank !== null) {
    if (metrics.organicRank <= 7 &&
        (action === "MILD_DOWN" || action === "STRONG_DOWN")) {
      return "ORGANIC_STRONG";
    }
    if (metrics.organicRank > 20 &&
        (action === "STRONG_UP" || action === "MILD_UP")) {
      return "ORGANIC_WEAK";
    }
  }

  // 3. インプレッション不足
  if (metrics.impressions7d < 100) {
    return "LOW_IMPRESSIONS";
  }

  // 4. コンバージョンがない
  if (metrics.conversions7d === 0 && metrics.clicks7d > 10) {
    return "NO_CONVERSION";
  }

  // 5. ACOS基準の判定
  if (metrics.currentAcos !== null) {
    const targetAcos = getTargetAcosWithDetails(product).targetAcos;
    if (metrics.currentAcos > targetAcos * 1.2) {
      return "ACOS_HIGH";
    }
    if (metrics.currentAcos < targetAcos * 0.7) {
      return "ACOS_LOW";
    }
  }

  // 6. 変更なし
  if (action === "KEEP") {
    return "NO_CHANGE";
  }

  // 7. デフォルト
  return metrics.currentAcos !== null && metrics.currentAcos > 0
    ? "ACOS_HIGH"
    : "NO_CHANGE";
}
```

### 判定の優先順位

| 優先度 | ReasonCode | 条件 |
|-------|------------|------|
| 1 | LIFECYCLE_LAUNCH | LAUNCH_HARD/SOFT で増額アクション |
| 1 | LIFECYCLE_HARVEST | HARVEST で減額アクション |
| 2 | ORGANIC_STRONG | オーガニック順位 <= 7 で減額アクション |
| 2 | ORGANIC_WEAK | オーガニック順位 > 20 で増額アクション |
| 3 | LOW_IMPRESSIONS | インプレッション < 100 |
| 4 | NO_CONVERSION | コンバージョン = 0 & クリック > 10 |
| 5 | ACOS_HIGH | ACOS > target × 1.2 |
| 5 | ACOS_LOW | ACOS < target × 0.7 |
| 6 | NO_CHANGE | アクション = KEEP |
| 7 | (デフォルト) | ACOS_HIGH または NO_CHANGE |

### 入札制限のReasonCode

以下のコードは入札額の上下限に達した場合に付与されます

| ReasonCode | 条件 |
|------------|------|
| MIN_BID | 推奨入札額が最低入札額（例: 10円）に達した |
| MAX_BID | 推奨入札額が最高入札額（例: 5000円）に達した |
| BUDGET_CAP | キャンペーン予算上限に達している |

---

## 9. ネガティブキーワード候補サジェスト

### 概要

統計的に安全な方法でネガティブキーワード候補をサジェストする機能です。
**SHADOWモード専用**であり、自動でキャンペーンにネガティブ登録は行いません。

### アーキテクチャ

```
src/negative-keywords/
├── index.ts                      # エクスポート
├── types.ts                      # 型定義
└── negative-keyword-calculator.ts # メイン計算ロジック
```

### 処理フロー

```

              computeNegativeKeywordCandidates()
            (src/negative-keywords/negative-keyword-calculator.ts)

                                │
                                ▼

  1. ライフサイクル除外チェック
     - LAUNCH_HARD / LAUNCH_SOFT の場合はスキップ
     - データ不足期間はネガティブ判定を行わない

                                │
                                ▼

  2. ASIN全体のベースラインCVR計算
     baselineAsinCvr30d = conversions_30d_total / clicks_30d_total
     - クリックが少ない場合は minimum_baseline_cvr (0.01) を下限

                                │
                                ▼

  3. ルールオブスリーによる必要クリック数
     requiredClicks = ceil(3 / (baselineAsinCvr30d × riskTolerance))
     - CVR=0 のとき、95%信頼上限のCVRは 3/N と近似

                                │
                                ▼

  4. 候補クラスタの特定
     intent_cluster_stats_30d から:
     - cluster_conversions_30d = 0
     - cluster_clicks_30d >= minClusterClicks
     - cluster_clicks_30d >= requiredClicks

                                │
                                ▼

  5. キーワード単位の候補生成
     search_term_stats_30d から:
     - conversions_30d = 0
     - clicks_30d >= minClicksByRole
     - cost_30d >= minWastedCost

                                │
                                ▼

  6. reasonCodes の付与
     - NG_NO_CONVERSION
     - NG_WASTED_SPEND
     - NG_CLUSTER_NO_CONVERSION
     - NG_INTENT_MISMATCH

                                │
                                ▼

  7. BigQuery保存（SHADOWモードのみ）
     negative_keyword_suggestions テーブルに INSERT

```

### BigQueryビュー/テーブル

#### search_term_stats_30d（検索クエリ統計ビュー）

```sql
-- 過去30日の検索クエリパフォーマンス
SELECT
  asin,
  query,
  match_type,
  intent_cluster_id,      -- product_core_terms を使用したクラスタID
  impressions_30d,
  clicks_30d,
  cost_30d,
  conversions_30d,
  revenue_30d,
  cpc_30d,
  cvr_30d,
  acos_30d
FROM search_term_stats_30d
```

#### intent_cluster_stats_30d（クラスタ統計ビュー）

```sql
-- intent_cluster_id 単位の集計
SELECT
  asin,
  intent_cluster_id,
  cluster_impressions_30d,
  cluster_clicks_30d,
  cluster_cost_30d,
  cluster_conversions_30d,
  cluster_revenue_30d,
  cluster_cpc_30d,
  cluster_cvr_30d,
  cluster_acos_30d
FROM intent_cluster_stats_30d
```

#### negative_keyword_suggestions（候補テーブル）

```sql
CREATE TABLE negative_keyword_suggestions (
  suggestion_id STRING NOT NULL,
  execution_id STRING NOT NULL,
  execution_mode STRING NOT NULL,  -- "SHADOW"

  asin STRING NOT NULL,
  query STRING NOT NULL,
  match_type STRING NOT NULL,      -- "AUTO", "PHRASE", "EXACT"
  intent_cluster_id STRING,
  role STRING NOT NULL,            -- "GENERIC", "BRAND_OWN", "BRAND_CONQUEST", "OTHER"

  clicks_30d INT64 NOT NULL,
  conversions_30d INT64 NOT NULL,
  cost_30d NUMERIC NOT NULL,
  cpc_30d NUMERIC,
  cvr_30d NUMERIC,
  acos_30d NUMERIC,

  cluster_clicks_30d INT64,
  cluster_conversions_30d INT64,
  cluster_cost_30d NUMERIC,
  cluster_cvr_30d NUMERIC,

  baseline_asin_cvr_30d NUMERIC NOT NULL,
  required_clicks INT64 NOT NULL,
  min_clicks_by_role INT64 NOT NULL,

  reason_codes ARRAY<STRING> NOT NULL,
  reason_detail STRING,

  -- 承認フロー情報
  status STRING NOT NULL DEFAULT 'PENDING',  -- "PENDING", "APPROVED", "REJECTED", "APPLIED"
  approved_at TIMESTAMP,
  approved_by STRING,
  rejected_at TIMESTAMP,
  rejected_by STRING,
  rejection_reason STRING,

  is_applied BOOL NOT NULL DEFAULT FALSE,
  lifecycle_state STRING,
  suggested_at TIMESTAMP NOT NULL
);
```

### 候補ステータスと承認フロー

ネガティブキーワード候補は承認フローを経て適用されます。

#### ステータス遷移

```
PENDING → APPROVED → APPLIED
    ↓
REJECTED
```

| ステータス | 説明 |
|-----------|------|
| PENDING | 新規生成された候補（レビュー待ち） |
| APPROVED | 人間によるレビューで承認済み（適用待ち） |
| REJECTED | 却下された候補 |
| APPLIED | Amazon Ads API に適用済み（将来実装） |

#### 承認フロー情報フィールド

| フィールド | 型 | 説明 |
|-----------|------|------|
| `status` | STRING | 現在のステータス |
| `approved_at` | TIMESTAMP | 承認日時 |
| `approved_by` | STRING | 承認者（ユーザーID/名前） |
| `rejected_at` | TIMESTAMP | 却下日時 |
| `rejected_by` | STRING | 却下者 |
| `rejection_reason` | STRING | 却下理由 |

#### 管理用 API エンドポイント

```
GET  /admin/negative-suggestions              # 候補一覧取得
GET  /admin/negative-suggestions/summary      # ステータス別サマリー
GET  /admin/negative-suggestions/:id          # 候補詳細
POST /admin/negative-suggestions/approve      # 一括承認
POST /admin/negative-suggestions/reject       # 一括却下
POST /admin/negative-suggestions/apply-queued # APPROVED候補をAmazonに適用（プレースホルダー）
```

##### apply-queued エンドポイント詳細

**リクエストボディ**:

```json
{
  "dryRun": true,      // true の場合、適用対象数のみ返却（デフォルト: true）
  "maxItems": 100      // 最大処理件数（デフォルト: 100）
}
```

**レスポンス**:

```json
{
  "success": true,
  "data": {
    "approvedCount": 25,     // 現在の APPROVED 候補数
    "wouldProcess": 25,      // 今回処理対象となる件数（min(approvedCount, maxItems)）
    "applyEnabled": false,   // NEGATIVE_APPLY_ENABLED の状態
    "message": "Apply mode is not enabled yet. Set NEGATIVE_APPLY_ENABLED=true to enable."
  }
}
```

> **Note**: このエンドポイントは現時点ではプレースホルダーであり、実際の Amazon Ads API への適用は行いません。`applyEnabled=true` の場合でも "not implemented yet" メッセージを返します。

##### 一覧取得 クエリパラメータ

| パラメータ | 型 | 説明 |
|-----------|------|------|
| status | string | ステータスでフィルタ（PENDING, APPROVED, REJECTED, APPLIED） |
| asin | string | ASINでフィルタ |
| role | string | ロールでフィルタ |
| limit | number | 取得件数（デフォルト: 100, 最大: 1000） |
| offset | number | オフセット |

##### 承認リクエストボディ

```json
{
  "suggestionIds": ["uuid1", "uuid2"],
  "approvedBy": "user@example.com"
}
```

##### 却下リクエストボディ

```json
{
  "suggestionIds": ["uuid1", "uuid2"],
  "rejectedBy": "user@example.com",
  "reason": "Not relevant to the product"
}
```

#### BigQueryビュー

- **negative_keyword_suggestions_pending**: PENDINGステータスの候補一覧
- **negative_keyword_suggestions_approved**: APPROVEDステータスの候補一覧
- **negative_keyword_suggestions_summary**: ASIN別のステータス集計
- **negative_keyword_approval_audit**: 承認フロー監査ログ

### 型定義

```typescript
// src/negative-keywords/types.ts

interface NegativeKeywordCandidate {
  asin: string;
  query: string;
  matchType: "AUTO" | "PHRASE" | "EXACT";
  intentClusterId: string | null;
  role: "GENERIC" | "BRAND_OWN" | "BRAND_CONQUEST" | "OTHER";
  clicks30d: number;
  conversions30d: number;
  cost30d: number;
  cpc30d: number;
  cvr30d: number | null;
  acos30d: number | null;
  clusterClicks30d?: number;
  clusterConversions30d?: number;
  clusterCost30d?: number;
  clusterCvr30d?: number;
  baselineAsinCvr30d: number;
  reasonCodes: NegativeReasonCode[];
}

interface NegativeSuggestConfig {
  minClicksGeneric: number;        // GENERIC最小クリック数（デフォルト: 30）
  minClicksBrandOwn: number;       // BRAND_OWN最小クリック数（デフォルト: 50）
  minClicksBrandConquest: number;  // BRAND_CONQUEST最小クリック数（デフォルト: 40）
  minClusterClicks: number;        // クラスタ最小クリック数（デフォルト: 50）
  riskTolerance: number;           // リスク許容度 0-1（デフォルト: 0.5）
}

type NegativeReasonCode =
  | "NG_NO_CONVERSION"           // CVR=0 かつクリック数しきい値超え
  | "NG_WASTED_SPEND"            // CPC高く、コストかさみ過ぎ
  | "NG_CLUSTER_NO_CONVERSION"   // クラスタ単位でCVR=0
  | "NG_INTENT_MISMATCH";        // 検索意図不一致
```

### 使用例

```typescript
import { computeNegativeKeywordCandidates } from "./negative-keywords";
import { ProductConfig } from "./ltv/types";

const productConfig: ProductConfig = { ... };

const result = await computeNegativeKeywordCandidates(
  "B0XXXXXXXXX",
  productConfig,
  {
    minClicksGeneric: 30,
    minClicksBrandOwn: 50,
    minClicksBrandConquest: 40,
    minClusterClicks: 50,
    riskTolerance: 0.5,
  },
  "SHADOW"  // SHADOWモード専用
);

console.log(`候補数: ${result.candidates.length}`);
console.log(`ベースラインCVR: ${(result.baselineAsinCvr30d * 100).toFixed(2)}%`);
console.log(`必要クリック数: ${result.requiredClicks}`);
```

### ルールオブスリー（Rule of Three）

CVR=0 のとき、真のCVRの95%信頼上限は `3/N` と近似できます。

```
例: N=100クリックでCVR=0の場合
  → 95%信頼上限CVR ≒ 3/100 = 3%

つまり「100クリックでCV=0なら、真のCVRは高くても3%程度」と統計的に言える

必要クリック数の計算:
  requiredClicks = ceil(3 / (baselineCvr × riskTolerance))

例: baselineCvr=2%, riskTolerance=0.5 の場合
  requiredClicks = ceil(3 / (0.02 × 0.5)) = ceil(300) = 300クリック
```

### role別の最小クリック数

| role | 固定しきい値 | 説明 |
|------|-------------|------|
| GENERIC | 30 | 一般キーワード（最も判定しやすい） |
| BRAND_OWN | 50 | 自社ブランド（慎重に判定） |
| BRAND_CONQUEST | 40 | 競合ブランド（やや慎重） |
| OTHER | 30 | その他 |

実際の閾値は `max(requiredClicks, 固定しきい値)` となります。

### 除外されるライフサイクルステート

以下のステートではネガティブ候補を生成しません：

- **LAUNCH_HARD**: データ不足、投資優先
- **LAUNCH_SOFT**: データ収集中

---

### 検索意図クラスターベース判定（v2）

v2では、ASIN×検索意図クラスター単位でのSTOP/NEG判定を導入し、精度と安全性を向上させています。

#### アーキテクチャ

```
src/negative-keywords/
├── index.ts                      # エクスポート
├── types.ts                      # 既存型定義
├── negative-keyword-calculator.ts # 既存計算ロジック
└── query-cluster/                # 新規: クラスターベース判定
    ├── index.ts                  # エクスポート
    ├── types.ts                  # 型定義
    ├── normalizer.ts             # クエリ正規化
    ├── intent-tagger.ts          # 検索意図タグ検出
    ├── cluster-judgment.ts       # クラスター判定ロジック
    └── hybrid-judgment.ts        # ハイブリッド判定
```

#### クラスターキー構造

検索意図クラスターは以下の二段階キーで構成されます：

```
queryClusterId = `${canonicalQuery}::${queryIntentTag}`
```

| 要素 | 説明 | 例 |
|------|------|-----|
| `canonicalQuery` | 正規化されたクエリ | `キッズ シャンプー` |
| `queryIntentTag` | 検索意図タグ | `child`, `adult`, `concern`, `info`, `generic` |

#### クエリ正規化ルール

| ルール | 変換前 | 変換後 |
|--------|--------|--------|
| 全角英数字→半角 | `ＡＢＣ１２３` | `abc123` |
| 大文字→小文字 | `ABC` | `abc` |
| ひらがな→カタカナ | `きっず` | `キッズ` |
| 半角カタカナ→全角 | `ｷｯｽﾞ` | `キッズ` |
| 全角空白→半角 | `キッズ　シャンプー` | `キッズ シャンプー` |
| 連続空白→単一 | `キッズ   シャンプー` | `キッズ シャンプー` |
| 長音符統一 | `シャンプ−` | `シャンプー` |

#### 検索意図タグ

| タグ | 説明 | キーワード例 |
|------|------|-------------|
| `child` | 子供向け | キッズ, 子供, ベビー, 3歳, 小学生 |
| `adult` | 大人向け | メンズ, レディース, 大人, 40代, シニア |
| `concern` | 悩み系 | かゆみ, フケ, 薄毛, 敏感肌, 対策 |
| `info` | 情報探索 | おすすめ, ランキング, 口コミ, 比較 |
| `generic` | 汎用 | 上記に該当しない |

**優先順位**: child > adult > concern > info > generic

#### 3フェーズ判定

クリック数に基づく3段階の判定フェーズ：

| フェーズ | クリック数 | 許可アクション |
|----------|-----------|---------------|
| LEARNING | < 20 | STOP/NEG禁止（データ蓄積中） |
| LIMITED_ACTION | 20-59 | MILD_DOWN/STRONG_DOWNのみ |
| STOP_CANDIDATE | ≥ 60 | STOP/NEG候補 |

```
設定パラメータ:
- clusterClicksMinLearning: 20
- clusterClicksMinStopCandidate: 60
```

#### 重要キーワードハイブリッド判定

重要キーワード（高投資キーワード）は、クラスター判定を**緩和方向のみ**オーバーライド可能。

**重要キーワードの定義**:
1. 広告費上位N件（autoDetectTopN: 20）
2. 手動ホワイトリスト（ASIN別）
3. グローバルホワイトリスト

**オーバーライドルール**:

| クラスター判定 | 単一KW判定 | 最終判定 | オーバーライド |
|--------------|----------|---------|--------------|
| STOP候補 | 非候補 | 非候補 | ✓ 緩和適用 |
| STOP候補 | STOP候補 | STOP候補 | なし |
| 非候補 | STOP候補 | 非候補 | ✗ 厳格化禁止 |

#### ロングテール判定

低インプレッション・低クリックのクラスターは自動停止せず、レビュー推奨。

```
ロングテール条件:
- インプレッション < 200
- クリック < 5
```

| 状態 | 推奨アクション |
|------|--------------|
| ロングテール + CV=0 | MANUAL_REVIEW |
| ロングテール + CV>0 | CONTINUE |
| 非ロングテール | 通常判定 |

---

### アトリビューション防御ロジック（Attribution Defense）

Amazon広告のCV計上遅延（2-3日）を考慮し、DOWN/STRONG_DOWN/STOP/NEGの判定を安定期間（stable期間）ベースで行う防御機能。

#### アーキテクチャ

```
src/engine/attribution-defense/
├── index.ts              # エクスポート
├── types.ts              # 型定義
├── metrics-builder.ts    # メトリクス構築
└── defense-judgment.ts   # 防御判定ロジック
```

#### 期間定義

| 期間 | 説明 | デフォルト |
|------|------|-----------|
| stable期間 | アトリビューション遅延が発生していない安定した期間 | 4-30日前 |
| recent期間 | 直近のアトリビューション遅延が発生しうる期間 | 直近3日 |
| total期間 | stable + recent の合計 | 過去30日全体 |

#### AttributionAwareMetrics

```typescript
interface AttributionAwareMetrics {
  asin: string;
  entityId: string;           // キーワードID or クラスターID
  entityType: "KEYWORD" | "SEARCH_TERM_CLUSTER";

  stable: PeriodMetrics;      // 安定期間のメトリクス
  recent: PeriodMetrics;      // 直近期間のメトリクス
  total: PeriodMetrics;       // 合計期間のメトリクス

  stableDays: number;         // stable期間の日数
  recentDays: number;         // recent期間の日数
  targetCpa: number;          // 目標CPA
}

interface PeriodMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
  sales: number;
  ctr: number | null;
  cvr: number | null;
  acos: number | null;
  cpc: number | null;
}
```

#### 防御閾値設定（DefenseThresholdConfig）

```typescript
interface DefenseThresholdConfig {
  stopNeg: SingleDefenseThreshold;     // STOP/NEG用（最も厳格）
  strongDown: SingleDefenseThreshold;  // STRONG_DOWN用
  down: SingleDefenseThreshold;        // DOWN用（最も緩い）
}

interface SingleDefenseThreshold {
  minStableClicks: number;              // 必要最小クリック数
  minStableCostToTargetCpaRatio: number; // コスト対CPA比率
}
```

**デフォルト閾値**:

| アクション | minStableClicks | minStableCostToTargetCpaRatio |
|-----------|-----------------|-------------------------------|
| STOP/NEG | 60 | 3.0 |
| STRONG_DOWN | 40 | 2.0 |
| DOWN | 20 | 1.0 |

#### 防御判定ルール

1. **クリック数チェック**: `stable.clicks >= 閾値`
2. **コスト対CPA比率チェック**: `stable.cost / targetCPA >= 閾値`
3. **パフォーマンスチェック**: CV=0 or ACOS高すぎ
4. **ライフサイクルポリシー**: LAUNCHフェーズでのブロック
5. **直近好調判定**: recent期間が好調なら緩和

```
判定フロー:
1. CV=0 かつ 閾値(STOP/NEG)を満たす → STOP/NEG
2. ACOS > targetAcos × 1.5 かつ 閾値(STRONG_DOWN)を満たす → STRONG_DOWN
3. ACOS > targetAcos × 1.2 かつ 閾値(DOWN)を満たす → DOWN
4. 上記以外 → 防御不要
```

#### ライフサイクル別防御ポリシー

| ライフサイクル | 乗数 | STOP/NEG | STRONG_DOWN | DOWN |
|---------------|------|----------|-------------|------|
| LAUNCH_HARD | 2.0x | ブロック | ブロック | ブロック |
| LAUNCH_SOFT | 1.5x | ブロック | ブロック | 許可 |
| GROWTH | 1.2x | 許可 | 許可 | 許可 |
| STEADY | 1.0x | 許可 | 許可 | 許可 |
| HARVEST | 0.8x | 許可 | 許可 | 許可 |
| ZOMBIE | 1.0x | 許可 | 許可 | 許可 |

#### 直近好調判定による緩和

直近期間（recent）が好調な場合、強い防御アクションを緩和:

| 判定条件 | 緩和後 |
|----------|--------|
| recent.conversions >= 1 | STOP/NEG → STRONG_DOWN |
| recent.cvr >= stable.cvr × 1.2 | STRONG_DOWN → DOWN |
| | DOWN → 見送り |

#### UP/STRONG_UP用 安定比率チェック

アップ判定時に、stable期間とtotal期間のACOS乖離をチェック:

```typescript
function checkStableRatioForUp(metrics: AttributionAwareMetrics): {
  allowUp: boolean;
  acosDivergenceRatio: number | null;
}

// 乖離率 = (totalAcos - stableAcos) / stableAcos
// 乖離率 > 25% の場合、アップを抑制
```

| 条件 | 結果 |
|------|------|
| stable.clicks < 15 | チェックスキップ（データ不足） |
| 乖離率 <= 25% | アップ許可 |
| 乖離率 > 25% | アップ抑制 |

#### 防御理由コード（DefenseReasonCode）

| コード | 説明 |
|--------|------|
| DEFENSE_STOP_NO_CONVERSION | stable期間でCV=0、STOP推奨 |
| DEFENSE_NEG_NO_CONVERSION | stable期間でCV=0、NEG推奨 |
| DEFENSE_STRONG_DOWN_HIGH_ACOS | stable期間でACOS高すぎ |
| DEFENSE_DOWN_HIGH_ACOS | stable期間でACOS高め |
| DEFENSE_BLOCKED_INSUFFICIENT_CLICKS | クリック不足で見送り |
| DEFENSE_BLOCKED_INSUFFICIENT_COST | コスト不足で見送り |
| DEFENSE_BLOCKED_LIFECYCLE_POLICY | ライフサイクルでブロック |
| DEFENSE_BLOCKED_RECENT_GOOD_PERFORMANCE | 直近好調で緩和 |
| DEFENSE_NOT_NEEDED_GOOD_PERFORMANCE | パフォーマンス良好 |

---

## 10. 自動ガードレール（Auto Guardrails）

### 概要

履歴データ（過去30日の入札バケット統計）に基づいて、ASIN × lifecycle_state 別に入札の上下限（min_bid / max_bid）を自動計算する機能です。

**主な特徴**:
- 「Rule of Three」に基づく統計的に安全な有望バケットの特定
- ACOS・CVR条件を満たすバケットから min/max を算出
- データ不足時は理論値（cpc_break_even）またはフォールバック値を使用
- `use_auto_min_max` フラグで商品単位で有効/無効を切り替え可能
- **GuardrailsMode** でガードレールの適用レベルを制御可能（OFF / SHADOW / ENFORCE）

### GuardrailsMode（ガードレール適用モード）

環境変数 `GUARDRAILS_MODE` で制御します。

| モード | 説明 | newBid | デフォルト |
|--------|------|--------|----------|
| **OFF** | ガードレール計算を行わない（トラブルシュート用） | rawBid（ガードレール未適用） | |
| **SHADOW** | 計算するがログのみ、実際の入札値には適用しない | rawBid（現状維持） | ✓ |
| **ENFORCE** | 計算結果を実際の入札値に適用する | guardedBid（クリップ後） | |

**安全設計**: デフォルトは **SHADOW** です。ENFORCE に切り替えるまで本番挙動は変わりません。

```bash
# 環境変数での設定例
GUARDRAILS_MODE=SHADOW   # デフォルト（ログのみ）
GUARDRAILS_MODE=ENFORCE  # 実際にクリップを適用
GUARDRAILS_MODE=OFF      # ガードレール計算をスキップ
```

### アーキテクチャ

```
src/guardrails/
├── index.ts                # エクスポート
└── auto-guardrails.ts      # メイン計算ロジック

src/bigquery/schemas/
├── search_term_bid_buckets_30d.sql  # 入札バケット統計ビュー
└── product_guardrails_auto.sql      # 自動ガードレールテーブル
```

### 処理フロー

```

         recomputeGuardrailsForAllProducts()
       (src/guardrails/auto-guardrails.ts)

                        │
                        ▼

  1. 商品設定の読み込み
     loadAllProductConfigs()
     - product_config から全 ASIN を取得

                        │
                        ▼

  2. 入札バケットデータの取得
     search_term_bid_buckets_30d ビューから:
     - 20円刻みの入札バケット別集計
     - ASIN × lifecycle_state ごとにグループ化

                        │
                        ▼

  3. 各 ASIN × lifecycle_state について計算
     computeGuardrailsForAsinLifecycle()

     有望バケットの判定（Rule of Three）:
       - clicks >= min_clicks_threshold (80)
       - acos <= target_acos × margin_acos (1.2)
       - cvr >= baseline_cvr × min_cvr_ratio (0.5)

     ┌─────────────────────────────────────────┐
     │ 有望バケットあり → HISTORICAL           │
     │   min_bid = min(avg_bid) × min_beta     │
     │   max_bid = max(avg_bid) × max_alpha    │
     ├─────────────────────────────────────────┤
     │ 有望バケットなし → THEORETICAL          │
     │   cpc_break_even = price × target_acos  │
     │                    × baseline_cvr       │
     │   min_bid = cpc_break_even × min_beta   │
     │   max_bid = cpc_break_even × max_alpha  │
     ├─────────────────────────────────────────┤
     │ データ不足 → FALLBACK                   │
     │   min_bid = 10                          │
     │   max_bid = 200                         │
     └─────────────────────────────────────────┘

                        │
                        ▼

  4. 結果の保存
     product_guardrails_auto テーブルに MERGE

```

### ライフサイクル別係数

| ライフサイクル | min_beta | max_alpha | 説明 |
|--------------|----------|-----------|------|
| LAUNCH_HARD | 0.7 | 1.5 | 広いレンジで積極投資 |
| LAUNCH_SOFT | 0.75 | 1.4 | やや広めのレンジ |
| GROW | 0.8 | 1.3 | バランス |
| HARVEST | 0.85 | 1.2 | 狭いレンジで効率重視 |

### BigQueryビュー/テーブル

#### search_term_bid_buckets_30d（入札バケット統計ビュー）

```sql
-- 過去30日の入札バケット別パフォーマンス
SELECT
  asin,
  lifecycle_state,
  bid_bucket,            -- "0-20", "20-40", "40-60"...
  bid_bucket_lower,
  bid_bucket_upper,
  impressions_30d,
  clicks_30d,
  cost_30d,
  conversions_30d,
  revenue_30d,
  avg_bid_30d,
  cpc_30d,
  cvr_30d,
  acos_30d,
  record_count
FROM search_term_bid_buckets_30d
```

#### product_guardrails_auto（自動ガードレールテーブル）

```sql
CREATE TABLE product_guardrails_auto (
  asin STRING NOT NULL,
  lifecycle_state STRING NOT NULL,
  min_bid_auto NUMERIC NOT NULL,
  max_bid_auto NUMERIC NOT NULL,
  data_source STRING NOT NULL,    -- "HISTORICAL" / "THEORETICAL" / "FALLBACK"
  clicks_used INT64 NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (asin, lifecycle_state) NOT ENFORCED
);
```

### 型定義

```typescript
// src/ltv/types.ts

interface GuardrailsPerLifecycle {
  min_bid: number;
  max_bid: number;
  max_up_ratio: number;
  max_down_ratio: number;
  use_auto_min_max: boolean;   // 自動ガードレールを使用するか
}

interface AutoGuardrailsConfig {
  min_clicks_threshold: number;      // 最小クリック数（80）
  margin_acos: number;               // ACOS許容マージン（1.2）
  min_cvr_ratio: number;             // CVR最小比率（0.5）
  baseline_cvr_estimate: number;     // ベースラインCVR（0.03）
  min_beta: Record<LifecycleState, number>;
  max_alpha: Record<LifecycleState, number>;
  fallback_min_bid: number;          // フォールバックmin（10）
  fallback_max_bid: number;          // フォールバックmax（200）
}

interface AutoGuardrailsResult {
  asin: string;
  lifecycle_state: LifecycleState;
  min_bid_auto: number;
  max_bid_auto: number;
  data_source: "HISTORICAL" | "THEORETICAL" | "FALLBACK";
  clicks_used: number;
}
```

### APIエンドポイント

#### POST /cron/recompute-guardrails

全商品の自動ガードレールを再計算します。

**リクエストボディ**:
```json
{
  "targetAsins": ["B0XXXXXXXXX"],  // 省略時は全商品
  "dryRun": false                   // true でテーブル更新しない
}
```

**レスポンス**:
```json
{
  "success": true,
  "durationMs": 5234,
  "totalProcessed": 120,
  "historicalCount": 80,
  "theoreticalCount": 30,
  "fallbackCount": 10,
  "errorCount": 0
}
```

### ガードレール適用

```typescript
// src/guardrails/auto-guardrails.ts

function applyGuardrails(input: ApplyGuardrailsInput): ApplyGuardrailsResult {
  // 0. OFF モードの場合はスキップ
  if (guardrailsMode === "OFF") {
    return { clippedBid: recommendedBid, wasClipped: false, guardrailsApplied: false, ... };
  }

  // 1. 変動率制限を適用
  //    max_up_ratio / max_down_ratio

  // 2. min_bid / max_bid 制限を適用
  //    use_auto_min_max が true かつ auto ガードレールがある場合:
  //      → product_guardrails_auto の値を使用
  //    それ以外:
  //      → デフォルトガードレールを使用

  // 3. guardrailsApplied を決定
  //    ENFORCE モードかつ wasClipped の場合のみ true
  const guardrailsApplied = guardrailsMode === "ENFORCE" && wasClipped;

  return {
    clippedBid,
    wasClipped,
    clipReason,
    effectiveMinBid,
    effectiveMaxBid,
    autoDataSource,      // "HISTORICAL" / "THEORETICAL" / "FALLBACK" / null
    guardrailsMode,      // "OFF" / "SHADOW" / "ENFORCE"
    guardrailsApplied,   // true なら newBid = clippedBid
  };
}
```

### Bid 計算フローにおけるガードレールの位置

```
calculateRecommendedBid()     // 入札アクションに基づく推奨値を計算
         ↓
イベントオーバーライド        // セール時の変動幅制限
         ↓
在庫ガード                   // ハードキル / ソフトスロットル
         ↓
applyGuardrails()            // min_bid / max_bid によるクリップ
         ↓
newBid 決定:
  - ENFORCE: guardedBid（クリップ後）
  - SHADOW/OFF: rawBid（クリップ前）
         ↓
Amazon Ads API に送信
```

### 使用例

```typescript
import {
  recomputeGuardrailsForAllProducts,
  loadAutoGuardrails,
  applyGuardrails,
  DEFAULT_GUARDRAILS_PER_LIFECYCLE,
} from "./guardrails";

// 1. 全商品の自動ガードレールを再計算
const result = await recomputeGuardrailsForAllProducts({
  projectId: "your-project",
  dataset: "amazon_bid_engine",
});
console.log(`処理件数: ${result.totalProcessed}`);
console.log(`HISTORICAL: ${result.historicalCount}`);

// 2. 自動ガードレールを取得
const autoGuardrails = await loadAutoGuardrails(
  { projectId: "your-project", dataset: "amazon_bid_engine" },
  "B0XXXXXXXXX",
  "GROW"
);

// 3. ガードレールを適用（モード指定）
const clipped = applyGuardrails({
  recommendedBid: 150,
  currentBid: 100,
  asin: "B0XXXXXXXXX",
  lifecycleState: "GROW",
  useAutoMinMax: true,
  autoGuardrails,
  defaultGuardrails: DEFAULT_GUARDRAILS_PER_LIFECYCLE.GROW,
  guardrailsMode: "ENFORCE",  // or "SHADOW" (default), "OFF"
});

console.log(`モード: ${clipped.guardrailsMode}`);
console.log(`クリップ後: ${clipped.clippedBid}円`);
console.log(`実際に適用: ${clipped.guardrailsApplied}`);
if (clipped.wasClipped) {
  console.log(`理由: ${clipped.clipReason}`);
}
```

### データソースの意味

| データソース | 説明 | 信頼性 |
|-------------|------|--------|
| HISTORICAL | 有望バケットから計算（実績ベース） | 高 |
| THEORETICAL | cpc_break_even から理論値で計算 | 中 |
| FALLBACK | 固定のフォールバック値 | 低 |

### 定期実行の推奨

Cloud Schedulerで毎日1回（深夜など）`/cron/recompute-guardrails` を呼び出すことを推奨します。

```yaml
# Cloud Scheduler設定例
name: recompute-guardrails-daily
schedule: "0 3 * * *"  # 毎日 3:00 AM
httpTarget:
  uri: https://your-service.run.app/cron/recompute-guardrails
  httpMethod: POST
  body: "{}"
```

### ガードレールログフィールド（ログ専用モード）

現在のフェーズでは、ガードレールは**ログ専用モード**で動作します。
実際のAPI送信には `rawNewBid`（= `newBid`）を使用し、`guardedNewBid` は分析用に記録のみ行います。

#### BidRecommendation のガードレールフィールド

```typescript
// src/engine/bidEngine.ts

interface BidRecommendation {
  // ... 既存フィールド ...

  // ガードレール情報（ログ用）
  rawNewBid: number;           // 入札ロジックが計算した生の推奨値（API送信用 = newBid と同値）
  guardedNewBid: number;       // ガードレール適用後の値（ログ用）
  wasGuardClamped: boolean;    // ガードでクリップされたかどうか
  guardClampReason: string | null;
  guardrailsMinBid: number | null;
  guardrailsMaxBid: number | null;
  guardrailsAutoDataSource: "HISTORICAL" | "THEORETICAL" | "FALLBACK" | null;
}
```

#### BigQuery ログカラム（keyword_recommendations_log）

| カラム名 | 型 | 説明 |
|----------|------|------|
| `raw_new_bid` | FLOAT64 | 入札ロジックが計算した生の推奨値 |
| `guarded_new_bid` | FLOAT64 | ガードレール適用後の値（ログ用） |
| `was_guard_clamped` | BOOL | ガードでクリップされたか |
| `guard_clamp_reason` | STRING | クランプ理由 |
| `guardrails_min_bid` | FLOAT64 | ガードレールの min_bid |
| `guardrails_max_bid` | FLOAT64 | ガードレールの max_bid |
| `guardrails_auto_data_source` | STRING | データソース |

#### 分析用ビュー

- **guardrail_simulation_summary**: 日別・ライフサイクル別のクランプ統計
- **guardrail_clamp_details**: クランプされた推奨の詳細一覧

#### 将来のガードレール有効化

ガードレールを実際の入札に適用する場合は、`bidEngine.ts` の以下を変更：

```typescript
// 現在（ログ専用モード）
newBid: recommendedBid,

// 将来（ガードレール適用モード）
newBid: guardrailResult.clippedBid,
```

---

## 11. ProductConfig 設定レイヤー

### 概要

ProductConfigは商品ごとの設定情報を管理する中核的なデータ構造です。
`src/config/productConfigTypes.ts` で定義される型を **Single Source of Truth** として、
全てのモジュールがこの型定義を参照します。

### ファイル構成

```
src/config/
   productConfigTypes.ts    # 型定義（Single Source of Truth）
   productConfigValidator.ts # バリデーションロジック
   productConfigRepository.ts # リポジトリパターン（BigQuery連携）
   productConfigLoader.ts    # レガシーローダー（非推奨）
   index.ts                  # エクスポート
```

### 型定義

#### ProductConfig

```typescript
interface ProductConfig {
  // 識別子
  profileId?: string;        // Amazon Ads プロファイルID（実行時設定）
  asin: string;              // ASIN（必須）
  productId?: string;        // 内部商品ID
  sku?: string;              // SKU

  // フラグ
  isActive: boolean;         // 入札エンジン対象フラグ

  // 収益モデル
  revenueModel: RevenueModel;  // "LTV" | "SINGLE_PURCHASE"

  // ライフサイクル
  lifecycleState: LifecycleState;  // "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST"

  // ビジネスモード
  businessMode: BusinessMode;      // "PROFIT" | "SHARE"
  brandType: BrandType;            // "BRANDED" | "GENERIC"
  experimentGroup: ExperimentGroup; // "CONTROL" | "TEST_A" | "TEST_B" | ...

  // LTV関連
  ltvMode: LtvMode;                // "ASSUMED" | "EARLY_ESTIMATE" | "MEASURED"
  marginRateNormal?: number;       // 平常時粗利率 (0-1) - LTV/TACOS計算用
  marginRateBlended?: number;      // セール込み実績粗利率 (0-1) - モニタリング用
  marginRate?: number;             // 【非推奨】後方互換用
  expectedRepeatOrdersAssumed: number;    // 想定リピート注文数
  expectedRepeatOrdersMeasured: number | null; // 実測リピート注文数
  safetyFactorAssumed: number;     // 想定安全係数
  safetyFactorMeasured: number;    // 実測安全係数

  // 新商品判定
  isNewProduct?: boolean;          // 新商品フラグ
  daysSinceFirstImpression?: number; // 初回インプレッションからの日数
  clicks30d?: number;              // 過去30日クリック数
  orders30d?: number;              // 過去30日注文数

  // 時間情報
  launchDate: Date | null;         // 発売日
  daysSinceLaunch: number;         // 発売からの日数
  newCustomersTotal: number;       // 新規顧客総数

  // オプション
  category?: string;               // カテゴリ
  riskLevel?: RiskLevel;           // "AGGRESSIVE" | "BALANCED" | "CONSERVATIVE"
  targetAcos?: number;             // 手動設定のACOS目標
  maxBidMultiplier?: number;       // 入札上限係数
  minBidMultiplier?: number;       // 入札下限係数
}
```

### バリデーションレイヤー

`productConfigValidator.ts` が設定値の妥当性をチェックします。

#### バリデーションルール

| フィールド | エラー条件 | 警告条件 |
|-----------|-----------|---------|
| `asin` | 空文字列 | - |
| `lifecycleState` | 無効な値 | - |
| `revenueModel` | 無効な値 | - |
| `marginRateNormal` | 0未満 or 1超 | 5%未満（利益率が低すぎる） |
| `marginRateBlended` | 0未満 or 1超 | 5%未満（利益率が低すぎる） |
| `marginRate` | 【非推奨】marginRateNormalを使用 | - |
| `targetAcos` | 0以下 or 1以上 | 80%超（高すぎる目標） |
| `expectedRepeatOrdersAssumed` | 1未満 | - |
| `safetyFactorAssumed` | 0以下 or 1超 | - |
| `maxBidMultiplier` | minBidMultiplierより小さい | 5超（極端に大きい） |

#### 使用例

```typescript
import { validateProductConfig, validateAllProductConfigs } from "./config";

// 単一設定のバリデーション
const result = validateProductConfig(config);
if (!result.ok) {
  console.error("Validation errors:", result.issues.filter(i => i.severity === "error"));
}

// 複数設定の一括バリデーション
const bulkResult = validateAllProductConfigs(configs);
if (bulkResult.hasError) {
  throw new Error(`${bulkResult.errorCount} configs have errors`);
}
```

### リポジトリパターン

`productConfigRepository.ts` がBigQueryとの連携を担当します。

```typescript
import { createProductConfigRepository } from "./config";

const repository = createProductConfigRepository({
  projectId: "my-project",
  dataset: "amazon_bid_engine",
  throwOnError: true,  // エラー時に例外をスロー
  logWarnings: true,   // 警告をログ出力
});

// 全設定を読み込み（バリデーション付き）
const allConfigs = await repository.loadAll();

// 特定ASINの設定を取得
const config = await repository.getByAsin("B0XXXXXXXXX");

// 複数ASINの設定を取得
const configMap = await repository.getByAsins(["B0000000001", "B0000000002"]);
```

### 後方互換性

既存コードとの互換性を維持するため、`ltv/types.ts` と `auto-exact/types.ts` から
同じ型を再エクスポートしています。

```typescript
// 推奨（新規コード）
import { ProductConfig, LifecycleState } from "../config/productConfigTypes";

// 後方互換（既存コード）
import { ProductConfig, LifecycleState } from "../ltv/types";
```

---

## 12. Slack 実行サマリー通知

### 概要

`runBidEngine()` の実行完了時に、Slack へ実行サマリーを自動送信する機能です。
SHADOW モードでの検証用と、APPLY モードでの本番監視用の両方を目的としています。

### ファイル構成

```
src/slack/
   index.ts                      # エクスポート
   executionSummaryNotifier.ts   # 実行サマリー通知の実装
```

### 環境変数

```bash
# 実行サマリー通知を有効にするモード（カンマ区切り）
ENABLE_SLACK_EXECUTION_SUMMARY_MODES=SHADOW,APPLY
```

### 処理フロー

```
runBidEngine() SUCCESS 完了
          │
          ▼
isSlackExecutionSummaryEnabledForMode(mode) で判定
          │
          ▼ (有効なモードの場合)
sendExecutionSummaryToSlack()
          │
          ├─ executions テーブルから実行情報を取得
          │
          ├─ bid_recommendations + auto_exact_promotion_suggestions
          │  から ASIN サマリーを集計
          │
          └─ Slack に送信（失敗してもエラーは投げない）
```

### 通知内容

1. **実行概要**
   - 実行ID、プロファイルID、モード、ステータス
   - 開始時刻、所要時間

2. **ASINサマリー（上位5件）**
   - キーワード件数
   - 平均入札変化率（攻め気味/抑え気味ラベル付き）
   - UP/DOWN/KEEP 件数
   - ACOS、CVR
   - AUTO→EXACT 昇格候補件数

### 攻め具合ラベルの閾値

```typescript
const AGGRESSIVE_THRESHOLD = 1.2;  // +20%以上 → [攻め気味]
const DEFENSIVE_THRESHOLD = 0.8;   // -20%以下 → [抑え気味]
```

### デバッグ用エンドポイント

過去の execution_id を指定して手動で通知をテストできます：

```
POST /debug/send-execution-summary
Content-Type: application/json

{
  "executionId": "abc-123-def",
  "maxAsins": 5
}
```

### APPLY 移行時の注意

**重要: このSlack実行サマリー通知は、APPLYモード本番運用時の監視にも重要な役割を果たします。**

APPLY に移行した後も、以下の理由から基本的に通知を有効のまま運用してください：

1. **入札ロジック暴走の早期検出**
   - 極端に攻め気味/抑え気味な ASIN を即座に把握できる
   - 異常な AUTO→EXACT 昇格候補数を検知できる

2. **日常的な入札傾向の把握**
   - どの ASIN に積極投資しているか
   - どの ASIN でコスト抑制しているか

通知を完全に無効にする前に、必ず以下を確認してください：

- BigQuery ダッシュボードなど、代替となる監視手段が整っているか
- 入札ロジック暴走時にすぐ気付ける体制になっているか

詳細は [SETUP.md](./SETUP.md) の「11. APPLY モードに切り替える前の確認事項」を参照してください。

---

## 12.1. 監視・アラート

### 概要

実行単位の「健康状態」を評価し、異常検出時にSlackへアラートを送信する機能です。
下記のような危険な挙動を早期に検出することを目的としています：

- 全体の半分以上が DOWN/UP 判定（ロジック暴走の可能性）
- ガードレールで多くの入札がクリップされている
- API適用失敗が多発している
- 極端な入札変更（300%以上）

### ファイル構成

```
src/monitoring/
   index.ts                 # エクスポート
   types.ts                 # 型定義（ExecutionHealthMetrics, AlertThresholds）
   config.ts                # 環境変数からの設定読み込み
   alertEvaluator.ts        # アラート評価ロジック
   metricsCollector.ts      # BigQueryからメトリクス収集
   alertNotifier.ts         # Slack通知

src/bigquery/schemas/
   execution_health_summary.sql  # 監視用ビュー
```

### 監視指標（ExecutionHealthMetrics）

| 指標 | 説明 |
|------|------|
| `totalKeywords` | 処理対象キーワード数 |
| `totalRecommendations` | 推奨を出したキーワード数 |
| `totalApplied` | 実際にAPIへ適用した件数 |
| `totalApplyFailed` | APIエラーなどで失敗した件数 |
| `strongUpCount` | 強いUP判定の件数（+50%以上） |
| `strongDownCount` | 強いDOWN判定の件数（-30%以下） |
| `upRatio` | UP比率（upCount / totalKeywords） |
| `downRatio` | DOWN比率（downCount / totalKeywords） |
| `guardrailsClippedRatio` | ガードレールクリップ比率 |
| `applyFailedRatio` | 適用失敗比率 |
| `avgBidChangeRatio` | 平均入札変更率 |
| `maxBidChangeRatio` | 最大入札変更率 |

### 異常判定の閾値（デフォルト値）

| 閾値 | デフォルト | 環境変数 |
|------|-----------|---------|
| DOWN比率上限 | 0.5 (50%) | `ALERT_MAX_DOWN_RATIO` |
| UP比率上限 | 0.5 (50%) | `ALERT_MAX_UP_RATIO` |
| ガードレールクリップ率上限 | 0.3 (30%) | `ALERT_MAX_GUARDRAILS_CLIPPED_RATIO` |
| 適用失敗率上限 | 0.2 (20%) | `ALERT_MAX_APPLY_FAILED_RATIO` |
| 適用失敗件数上限 | 10 | `ALERT_MAX_APPLY_FAILED_COUNT` |
| 最大入札変更率上限 | 3.0 (300%) | `ALERT_MAX_BID_CHANGE_RATIO` |

### 環境変数

```bash
# アラート機能の有効/無効（デフォルト: true）
ALERT_ENABLED=true

# 正常時もサマリーを送信するか（デフォルト: true）
ALERT_SEND_SUMMARY_ON_SUCCESS=true

# アラート専用チャンネル（省略時はデフォルトチャンネル）
ALERT_SLACK_CHANNEL=amazon_tool_alerts

# 閾値のカスタマイズ
ALERT_MAX_DOWN_RATIO=0.5
ALERT_MAX_UP_RATIO=0.5
ALERT_MAX_GUARDRAILS_CLIPPED_RATIO=0.3
ALERT_MAX_APPLY_FAILED_RATIO=0.2
ALERT_MAX_APPLY_FAILED_COUNT=10
ALERT_MAX_BID_CHANGE_RATIO=3.0
```

### 処理フロー

```
runBidEngine() SUCCESS 完了
          │
          ▼
alertConfig.enabled をチェック
          │
          ▼ (有効な場合)
collectExecutionHealthMetrics()
  └─ keyword_recommendations_log から監視指標を集計
          │
          ▼
evaluateExecutionHealth()
  └─ 閾値と比較して異常を検出
          │
          ▼
sendAlertNotification()
  ├─ 異常時: アラートメッセージを送信
  └─ 正常時: サマリーメッセージを送信（設定による）
```

### アラートメッセージ例

```
⚠️ *[ALERT] Amazon Bid Engine execution anomaly detected*

```
実行ID:         abc-123-def
実行時刻:       2024-01-15 10:30:45
モード:         APPLY
ガードレール:   ENFORCE
キーワード数:   1500
推奨件数:       1200
適用件数:       800
実行時間:       45 秒
```

*:warning: 検出された問題:*
• DOWN ratio too high: 65.3% (threshold: 50%)
• Guardrails clipped ratio high: 35.2% (threshold: 30%)

*詳細メトリクス:*
```
UP比率:             12.5% (150/1500)
DOWN比率:           65.3% (980/1500)
強いUP:             25 件
強いDOWN:           450 件
ガードレールクリップ: 35.2%
平均入札変更率:     x0.723
最大入札変更率:     x2.850
適用失敗:           5 件 (0.6%)
```

_詳細は BigQuery の `execution_health_summary` VIEW を参照してください_
```

### BigQuery監視ビュー

#### execution_health_summary

直近30日の実行の監視指標を計算し、`is_anomaly_basic` フラグで異常を判定。

```sql
SELECT *
FROM `{project}.{dataset}.execution_health_summary`
WHERE is_anomaly_basic = TRUE
ORDER BY execution_time DESC
LIMIT 10;
```

#### execution_health_recent

直近100回の実行サマリー（ダッシュボード用）。

#### execution_health_anomalies

異常実行のみを抽出したビュー。

#### execution_health_daily_summary

日別の実行統計と異常率。

### 既存通知との関係

| 条件 | 動作 |
|------|------|
| `ALERT_ENABLED=true` | 監視・アラート機能を使用（異常時はアラート、正常時はサマリー） |
| `ALERT_ENABLED=false` | 従来のSlack実行サマリー通知を使用（`ENABLE_SLACK_EXECUTION_SUMMARY_MODES` で制御） |

---

## 13. 適応型E-Score最適化システム

### 概要

過去の入札結果（成功/失敗）をフィードバックループで学習し、E-Score（成果・効率・ポテンシャル）の重みを自動最適化するシステム。

### アーキテクチャ

```
src/adaptive-escore/
├── types.ts              # 型定義
├── config.ts             # 設定・デフォルト重み
├── escore-calculator.ts  # E-Score計算
├── success-evaluator.ts  # 成功評価
├── weight-optimizer.ts   # 重み最適化（勾配降下法）
├── safety-manager.ts     # 安全機構
├── bigquery-adapter.ts   # BigQuery連携
└── optimization-runner.ts # 最適化ジョブ
```

### 主要機能

1. **E-Score計算**
   - パフォーマンススコア（成果）
   - 効率スコア（ACOS、CVR）
   - ポテンシャルスコア（成長可能性）
   - 重み付け合計でランク決定（S/A/B/C/D）

2. **フィードバックループ**
   - 入札アクション実行後、7日後のパフォーマンスを評価
   - 成功/失敗を判定し、FeedbackRecordとして記録
   - 成功率に基づいて重みを自動調整

3. **安全機構**
   - 異常検知（成功率低下、ACOS劣化）
   - ロールバック機能（前回の安定重みに復元）
   - 重み制約（最小/最大値、合計=1.0）

### 重み管理

| カテゴリ | 分類 | 用途 |
|---------|------|------|
| モード別 | NORMAL/S_MODE | 通常/セール期間 |
| ブランドタイプ別 | BRAND_OWN/CONQUEST/GENERIC | ブランド種別 |
| 季節別 | Q1/Q2/Q3/Q4 | 四半期 |

### APIエンドポイント

- `POST /escore/calculate` - E-Score計算
- `POST /escore/optimize` - 重み最適化実行
- `GET /escore/health` - ヘルスチェック

---

## 14. Jungle Scout連携

### 概要

Jungle Scout APIを使用したキーワードインテリジェンスと戦略分析機能。市場データを取得し、入札戦略に活用。

### アーキテクチャ

```
src/jungle-scout/
├── types.ts              # 型定義
├── client.ts             # APIクライアント
├── bigquery-adapter.ts   # BigQuery連携
└── strategy-analyzer.ts  # 戦略分析
```

### 主要機能

1. **キーワードインテリジェンス**
   - 検索ボリューム
   - 競合度
   - トレンド（前月比）

2. **シェア・オブ・ボイス**
   - 自社商品のキーワード占有率
   - 競合比較

3. **戦略分析**
   - キーワードごとの推奨アクション
   - 投資優先度スコア

### BigQueryテーブル

- `jungle_scout_keyword_intelligence` - キーワード情報
- `jungle_scout_share_of_voice` - シェア・オブ・ボイス
- `jungle_scout_volume_history` - 検索ボリューム履歴
- `jungle_scout_strategy_analysis` - 戦略分析結果

### APIエンドポイント

- `POST /jungle-scout/keywords` - キーワード情報取得
- `POST /jungle-scout/strategy` - 戦略分析

---

## 15. 統合入札戦略（Unified Strategy）

### 概要

Jungle Scout（市場データ）+ SP-API（商品収益性）+ Amazon Ads（広告パフォーマンス）を統合した入札戦略エンジン。

### アーキテクチャ

```
src/unified-strategy/
├── types.ts               # 型定義
├── config.ts              # 設定・戦略マトリクス
├── strategy-calculator.ts # 戦略計算
├── bigquery-adapter.ts    # BigQuery連携
└── seo-investment.ts      # SEO投資戦略
```

### 主要機能

1. **動的ACOS計算**
   - 市場競合度に応じたACOS調整
   - 収益性を考慮した上限設定

2. **優先度スコア計算**
   - 収益ポテンシャル
   - 競合優位性
   - 成長可能性

3. **統合戦略算出**
   - 3つのデータソースを統合
   - キーワードごとの推奨アクション
   - 推奨入札額

4. **SEO投資戦略（赤字許容モード）**
   - SEO順位改善のための戦略的赤字投資
   - 投資上限の動的計算
   - ROI追跡

### 戦略マトリクス

| 市場競合度 | 収益性 | 推奨戦略 |
|-----------|--------|---------|
| 高 | 高 | AGGRESSIVE（積極投資） |
| 高 | 低 | SELECTIVE（選択的投資） |
| 低 | 高 | EXPAND（拡大） |
| 低 | 低 | MAINTAIN（維持） |

### APIエンドポイント

- `POST /unified-strategy/calculate` - 統合戦略計算
- `GET /unified-strategy/summary/:asin` - 戦略サマリー
- `POST /seo-investment/evaluate` - SEO投資評価

---

## 16. エラーハンドリング・リトライ・サーキットブレーカー

### 概要

外部API（Amazon Ads, BigQuery, Jungle Scout）への呼び出しを安全にリトライし、障害時にサーキットブレーカーで保護するユーティリティ。カスタムエラークラスによりエラーの分類とリトライ戦略を最適化。

### ファイル構成

```
src/errors/
   index.ts                  # カスタムエラークラス・統一レスポンス形式

src/utils/
   retry.ts                  # リトライ・サーキットブレーカー
   field-mapper.ts           # 型安全フィールドマッピング

src/schemas/
   external-api.ts           # 外部API応答のZodスキーマ
```

### カスタムエラークラス

```typescript
// エラーコード
const ErrorCode = {
  UNAUTHORIZED: "UNAUTHORIZED",           // 認証エラー（リトライ不可）
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED", // レート制限（リトライ可）
  AMAZON_ADS_API_ERROR: "AMAZON_ADS_API_ERROR",
  BIGQUERY_ERROR: "BIGQUERY_ERROR",
  CIRCUIT_OPEN: "CIRCUIT_OPEN",           // サーキット開放
  VALIDATION_ERROR: "VALIDATION_ERROR",
  // ...
};

// 基底エラークラス
class AppError extends Error {
  code: ErrorCodeType;      // エラーコード
  statusCode: number;       // HTTPステータス
  retryable: boolean;       // リトライ可能か
  retryAfterMs?: number;    // リトライまでの待機時間
  details?: Record<string, unknown>;
}

// 特化エラークラス
class AuthenticationError extends AppError { /* 401 リトライ不可 */ }
class RateLimitError extends AppError { /* 429 リトライ可 */ }
class AmazonAdsApiError extends AppError { /* HTTPステータスから自動分類 */ }
class CircuitOpenError extends AppError { /* サーキット開放 */ }
class ValidationError extends AppError { /* バリデーションエラー */ }
```

### エラー分類によるリトライ戦略

| エラー種別 | HTTPステータス | リトライ | 待機時間 |
|-----------|---------------|---------|----------|
| 認証エラー | 401, 403 | 不可 | - |
| レート制限 | 429 | 可 | 60秒 |
| サーバーエラー | 500, 502, 503, 504 | 可 | 5秒〜 |
| バリデーション | 400 | 不可 | - |
| サーキット開放 | 503 | 可 | 30秒 |

### 統一レスポンス形式

```typescript
interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    retryAfterMs?: number;
  };
  meta?: {
    requestId?: string;
    timestamp: string;
    pagination?: { total, limit, offset, hasMore };
  };
}

// 使用例
ApiResponseBuilder.success(data, { pagination: { total: 100, limit: 10, offset: 0 } });
ApiResponseBuilder.error(new RateLimitError(60000));
ApiResponseBuilder.validationError([{ field: "asin", message: "Required" }]);
```

### リトライ設定

```typescript
interface RetryConfig {
  maxRetries: number;        // 最大リトライ回数（デフォルト: 3）
  baseDelayMs: number;       // 基本待機時間（デフォルト: 1000ms）
  maxDelayMs: number;        // 最大待機時間（デフォルト: 30000ms）
  backoffMultiplier: number; // 指数バックオフ乗数（デフォルト: 2）
  retryableErrors?: string[]; // リトライ対象エラーコード
}
```

### サーキットブレーカー

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;  // オープン閾値（デフォルト: 5）
  resetTimeoutMs: number;    // リセット時間（デフォルト: 60000ms）
  halfOpenRequests: number;  // ハーフオープン試行数（デフォルト: 3）
}
```

### 状態遷移

```
CLOSED → (failureThreshold超過) → OPEN
OPEN → (resetTimeout経過) → HALF_OPEN
HALF_OPEN → (成功) → CLOSED
HALF_OPEN → (失敗) → OPEN
```

### Amazon Ads APIへの適用

```typescript
// amazonAdsClient.ts
async function makeAmazonAdsRequest<T>(config, endpoint, method, body): Promise<T> {
  return withRetry(
    async () => {
      const response = await fetch(url, options);
      if (!response.ok) {
        // HTTPステータスに応じたエラーを投げる
        throw AmazonAdsApiError.fromHttpStatus(response.status, errorText, amazonRequestId);
      }
      return response.json();
    },
    {
      name: "amazon-ads-api",
      retryConfig: { maxRetries: 3, baseDelayMs: 1000 },
      circuitBreakerConfig: { failureThreshold: 5, resetTimeoutMs: 60000 },
    }
  );
}
```

### 型安全フィールドマッピング

```typescript
// BigQuery応答のマッピング
import { getString, getNumber, bothCases } from './utils/field-mapper';

const metrics = {
  keywordId: getString(row, bothCases("keyword_id")),
  clicks: getNumber(row, bothCases("clicks_30d"), 0),
};

// Zodスキーマ検証
import { mapWithSchema, BigQueryKeywordMetricsSchema } from './schemas/external-api';

const validated = mapWithSchema(row, BigQueryKeywordMetricsSchema);
```

### 外部API応答のZodスキーマ

```typescript
// Amazon Ads キーワードレポート
const AmazonKeywordReportSchema = z.object({
  keywordId: z.union([z.string(), z.number()]).transform(String),
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  // ...
});

// BigQuery ネガティブ候補
const BigQueryNegativeSuggestionSchema = z.object({
  suggestion_id: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "APPLIED"]),
  // ...
});
```

---

## 17. イベントオーバーライド（Event Override）

大型セール（プライムデー、ブラックフライデー等）期間中に「守りのロジック」が効きすぎて機会損失が発生することを防ぐ機構。

### 17.1 概要

通常時は ACOS 超過やコンバージョンなしの状態で入札を下げる「守りのロジック」が動作するが、大型セール時にはこれが過剰反応となりうる。イベントオーバーライドにより、セール期間中はダウン判定を緩和し、アップ方向のブーストを強化する。

### 17.2 イベントモード

| モード | 用途 | 特徴 |
|--------|------|------|
| `NONE` | 通常日（デフォルト） | 従来通りの判定 |
| `BIG_SALE_PREP` | セール準備期間（2-3日前） | やや緩和、アップブースト弱め |
| `BIG_SALE_DAY` | セール当日 | 大幅に緩和、強いダウンを禁止 |

### 17.3 設定方法

環境変数 `EVENT_MODE` で設定:

```bash
# 通常日
EVENT_MODE=NONE

# セール準備期間
EVENT_MODE=BIG_SALE_PREP

# セール当日
EVENT_MODE=BIG_SALE_DAY
```

### 17.4 オーバーライド効果

**BIG_SALE_DAY（セール当日）の場合:**

1. **ACOS判定閾値の緩和**: `targetAcos × 1.5` まで ACOS_HIGH 判定されない
2. **NO_CONVERSION判定の無効化**: コンバージョンがなくてもダウンしない
3. **強いダウンの抑制**: STRONG_DOWN/STOP が MILD_DOWN に緩和
4. **入札変動幅の拡大**: 1.5倍まで上げられる、10%減が下限

### 17.5 安全弁

イベントオーバーライド時でも以下は有効:

- 在庫ガード（`max_loss_daily` 等）
- 在庫ゼロ時のハードキル
- 最低入札額制限

### 17.6 関連ファイル

```
src/
├── event/
│   ├── types.ts       # EventMode, EventBidPolicy 定義
│   └── index.ts       # モジュールエクスポート
├── config.ts          # EnvConfig に eventMode 追加
└── engine/
    └── bidEngine.ts   # イベントポリシー適用ロジック
```

詳細は [bid_core.md Section 12](./bid_core.md#12-イベントオーバーライド-eventtypests) を参照。

---

## 19. バックテスト機能

### 概要

過去データを使って入札エンジンの成果をシミュレーションし、「このエンジンを使っていたら、実際と比べてどれだけ成果が改善していたか」を定量的に証明する機能。

**コアコンセプト:**
過去の入札推奨ログ（keyword_recommendations_log）と実際のパフォーマンスデータを突合し、「推奨入札額を適用していたら」のシミュレーションを行い、実績との差分を算出する。

### ファイル

```
src/backtest/
  index.ts                  # エクスポート
  types.ts                  # 型定義（BacktestConfig, BacktestResult等）
  backtest-calculator.ts    # シミュレーション計算（純粋関数）
  backtest-engine.ts        # メインエンジン（runBacktest）
  bigquery-adapter.ts       # BigQuery連携
  report-generator.ts       # Slack通知・レポート生成
```

### シミュレーションロジック

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `bidElasticity` | 0.5 | 入札弾力性（入札10%増でインプレッション5%増） |
| `cpcChangeRatio` | 0.3 | CPC変動係数（入札10%増でCPC3%増） |
| `assumeConstantCvr` | true | CVR一定と仮定するか |

**シミュレーション計算:**
```
impressions_sim = impressions * (1 + bid_change_rate × bidElasticity)
cpc_sim = cpc × (1 + bid_change_rate × cpcChangeRatio)
clicks_sim = impressions_sim × CTR（一定）
conversions_sim = clicks_sim × CVR（一定）
```

### 判定精度評価

| 判定タイプ | 正解条件 |
|------------|----------|
| UP（入札増加） | 売上5%以上増加、またはACOS 1pt以上改善 |
| DOWN（入札減少） | 広告費5%以上削減（売上維持）、またはACOS 1pt以上改善 |
| KEEP（維持） | ACOS変動3pt以内 |

### アクション分類

| アクション | 条件 |
|------------|------|
| STRONG_UP | bidChangePercent ≥ 25% |
| MILD_UP | bidChangePercent ≥ 10% |
| KEEP | -10% < bidChangePercent < 10% |
| MILD_DOWN | bidChangePercent ≤ -10% |
| STRONG_DOWN | bidChangePercent ≤ -25% |
| STOP | bidChangePercent ≤ -60% |

### BigQuery テーブル

#### backtest_executions

| カラム | 型 | 説明 |
|--------|------|------|
| `execution_id` | STRING | 実行ID |
| `config` | JSON | バックテスト設定 |
| `period_start` | DATE | 対象期間開始日 |
| `period_end` | DATE | 対象期間終了日 |
| `actual_spend` | NUMERIC | 実績広告費 |
| `simulated_spend` | NUMERIC | シミュレーション広告費 |
| `actual_acos` | NUMERIC | 実績ACOS |
| `simulated_acos` | NUMERIC | シミュレーションACOS |
| `acos_diff` | NUMERIC | ACOS差分（pt） |
| `estimated_profit_gain` | NUMERIC | 推定利益改善額 |
| `total_decisions` | INT64 | 総判定数 |
| `correct_decisions` | INT64 | 正解数 |
| `accuracy_rate` | NUMERIC | 正解率 |

#### backtest_daily_details

| カラム | 型 | 説明 |
|--------|------|------|
| `execution_id` | STRING | 実行ID |
| `date` | DATE | 日付 |
| `actual_spend` | NUMERIC | 実績広告費 |
| `simulated_spend` | NUMERIC | シミュレーション広告費 |
| `actual_acos` | NUMERIC | 実績ACOS |
| `simulated_acos` | NUMERIC | シミュレーションACOS |
| `decisions_count` | INT64 | 判定数 |
| `correct_decisions` | INT64 | 正解数 |

### エンドポイント

#### POST /backtest/run
バックテストを実行

リクエスト:
```json
{
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "targetAsins": ["B0XXXXXXXX"],
  "granularity": "DAILY",
  "saveResults": true,
  "notifySlack": true
}
```

#### GET /backtest/executions
過去のバックテスト実行一覧を取得

#### GET /backtest/executions/:executionId
バックテスト詳細結果を取得

#### GET /backtest/executions/:executionId/export
結果をJSON/CSVでエクスポート（`?format=csv`）

#### POST /backtest/setup
バックテスト用テーブルを作成

#### POST /backtest/weekly
週次定期実行（過去7日間のバックテスト）

### Slack通知

バックテスト完了時にSlack通知を送信:

```
📊 *バックテスト完了*

*期間:* 2024-01-01 〜 2024-01-31 (31日間)

━━━━━━━━━━━━━━━━━━━━━
*【実績 vs シミュレーション】*

*広告費:* ¥100,000 → ¥90,000 (▼10.0%)
*ACOS:* 33.3% → 30.0% (▼3.3pt)
*ROAS:* 3.00 → 3.33

*推定利益改善:* +¥13,000

━━━━━━━━━━━━━━━━━━━━━
*【判断精度】*

*正解率:* 75.0% (150/200件)
*アクション別:* 強UP: 80% / 軽UP: 70% / 維持: 90% / 軽DOWN: 65%
```

### 関連ファイル

```
src/
├── backtest/
│   ├── index.ts
│   ├── types.ts
│   ├── backtest-calculator.ts
│   ├── backtest-engine.ts
│   ├── bigquery-adapter.ts
│   └── report-generator.ts
├── routes/
│   └── backtest.ts
└── server.ts              # /backtest ルート登録
```

---

## 20. A/Bテスト機能

### 概要

入札ロジックの変更を安全にテストするためのA/Bテスト機能。
テストグループとコントロールグループを比較し、統計的有意性に基づいて新ロジックの効果を評価する。

**コアコンセプト:**
- MurmurHash3による一貫性のあるグループ割り当て
- Welch's t検定とCohen's dによる統計的評価
- BigQueryへのメトリクス永続化

### ファイル構造

```
src/
├── ab-test/
│   ├── index.ts                # モジュールエクスポート
│   ├── types.ts                # 型定義
│   ├── ab-test-assigner.ts     # グループ割り当てロジック
│   ├── ab-test-manager.ts      # テスト管理
│   ├── ab-test-evaluator.ts    # 統計評価・t検定・Cohen's d
│   └── bigquery-adapter.ts     # BigQuery連携
├── routes/
│   └── ab-test.ts              # APIルート
└── server.ts                   # /ab-test ルート登録
```

### テストステータス

| ステータス | 説明 |
|-----------|------|
| `DRAFT` | 下書き（まだ開始していない） |
| `RUNNING` | 実行中 |
| `PAUSED` | 一時停止 |
| `COMPLETED` | 完了（結果確定） |
| `CANCELLED` | キャンセル |

### グループ割り当て粒度

| 粒度 | 説明 | 用途 |
|------|------|------|
| `CAMPAIGN` | キャンペーン単位 | 大規模テスト |
| `ASIN` | 商品単位 | 商品別テスト |
| `KEYWORD` | キーワード単位 | 細粒度テスト |

### BidEngineOverrides（入札ロジックオーバーライド）

テストグループに適用する設定変更:

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `targetAcosMultiplier` | 1.0 | 目標ACOS乗数（1.1=10%緩和） |
| `acosHighMultiplier7dExcl` | 1.2 | ACOS高すぎ判定乗数（7日除外版） |
| `acosHighMultiplier30d` | 1.05 | ACOS高すぎ判定乗数（30日版） |
| `strongUpRate` | 0.30 | STRONG_UPの変動率 |
| `mildUpRate` | 0.15 | MILD_UPの変動率 |
| `mildDownRate` | -0.15 | MILD_DOWNの変動率 |
| `strongDownRate` | -0.30 | STRONG_DOWNの変動率 |
| `escoreWeightEnabled` | false | E-Score重み付けの有効化 |

### BigQueryスキーマ

#### ab_tests テーブル

```sql
CREATE TABLE IF NOT EXISTS ab_tests (
  test_id STRING NOT NULL,
  name STRING NOT NULL,
  description STRING NOT NULL,
  status STRING NOT NULL,
  assignment_level STRING NOT NULL,
  test_group_ratio FLOAT64 NOT NULL,
  test_overrides STRING NOT NULL,
  target_filters STRING,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  created_by STRING,
  notes STRING
);
```

#### ab_test_assignments テーブル

```sql
CREATE TABLE IF NOT EXISTS ab_test_assignments (
  test_id STRING NOT NULL,
  assignment_key STRING NOT NULL,
  assignment_level STRING NOT NULL,
  group STRING NOT NULL,
  assigned_at TIMESTAMP NOT NULL,
  hash_value INT64
);
```

#### ab_test_daily_metrics テーブル（日付パーティション）

```sql
CREATE TABLE IF NOT EXISTS ab_test_daily_metrics (
  test_id STRING NOT NULL,
  date DATE NOT NULL,
  group STRING NOT NULL,
  impressions INT64 NOT NULL,
  clicks INT64 NOT NULL,
  conversions INT64 NOT NULL,
  sales FLOAT64 NOT NULL,
  spend FLOAT64 NOT NULL,
  ctr FLOAT64,
  cvr FLOAT64,
  acos FLOAT64,
  roas FLOAT64,
  recommendation_count INT64 NOT NULL,
  bid_up_count INT64 NOT NULL,
  bid_down_count INT64 NOT NULL,
  no_change_count INT64 NOT NULL,
  avg_bid_change_percent FLOAT64
)
PARTITION BY date;
```

#### ab_test_evaluations テーブル

```sql
CREATE TABLE IF NOT EXISTS ab_test_evaluations (
  test_id STRING NOT NULL,
  evaluated_at TIMESTAMP NOT NULL,
  period_days INT64 NOT NULL,
  control_sample_size INT64 NOT NULL,
  test_sample_size INT64 NOT NULL,
  acos_evaluation STRING NOT NULL,
  roas_evaluation STRING NOT NULL,
  cvr_evaluation STRING NOT NULL,
  sales_evaluation STRING NOT NULL,
  overall_winner STRING NOT NULL,
  winner_reason STRING NOT NULL,
  has_adequate_sample_size BOOL NOT NULL,
  min_required_sample_size INT64 NOT NULL,
  achieved_power FLOAT64 NOT NULL,
  notes STRING
);
```

### APIエンドポイント

#### テスト管理

| メソッド | パス | 説明 | 認証 |
|----------|------|------|------|
| `POST` | `/ab-test/tests` | テスト作成 | 内部認証 |
| `GET` | `/ab-test/tests` | テスト一覧取得 | API Key |
| `GET` | `/ab-test/tests/running` | 実行中テスト取得 | API Key |
| `GET` | `/ab-test/tests/:testId` | テスト詳細取得 | API Key |
| `PATCH` | `/ab-test/tests/:testId` | テスト更新 | API Key |

#### ステータス操作

| メソッド | パス | 説明 | 認証 |
|----------|------|------|------|
| `POST` | `/ab-test/tests/:testId/start` | テスト開始 | 内部認証 |
| `POST` | `/ab-test/tests/:testId/pause` | テスト一時停止 | 内部認証 |
| `POST` | `/ab-test/tests/:testId/complete` | テスト完了 | 内部認証 |
| `POST` | `/ab-test/tests/:testId/cancel` | テストキャンセル | 内部認証 |

#### メトリクス・評価

| メソッド | パス | 説明 | 認証 |
|----------|------|------|------|
| `GET` | `/ab-test/tests/:testId/assignments` | 割り当て一覧取得 | API Key |
| `GET` | `/ab-test/tests/:testId/metrics` | 日次メトリクス取得 | API Key |
| `GET` | `/ab-test/tests/:testId/metrics/aggregate` | 集計メトリクス取得 | API Key |
| `POST` | `/ab-test/tests/:testId/evaluate` | テスト評価実行 | 内部認証 |
| `GET` | `/ab-test/tests/:testId/evaluations` | 評価結果一覧取得 | API Key |
| `GET` | `/ab-test/tests/:testId/evaluations/latest` | 最新評価結果取得 | API Key |

#### セットアップ

| メソッド | パス | 説明 | 認証 |
|----------|------|------|------|
| `POST` | `/ab-test/setup` | テーブル作成 | 内部認証 |

### 統計評価

#### Welch's t検定

等分散を仮定しないt検定:

```
t = (mean2 - mean1) / sqrt(se1² + se2²)

df = (var1/n1 + var2/n2)² / ((var1/n1)²/(n1-1) + (var2/n2)²/(n2-1))
```

#### 有意性判定

| レベル | p値 | 解釈 |
|--------|-----|------|
| `SIGNIFICANT_99` | < 0.01 | 99%信頼水準で有意 |
| `SIGNIFICANT_95` | < 0.05 | 95%信頼水準で有意 |
| `NOT_SIGNIFICANT` | >= 0.05 | 有意差なし |

#### Cohen's d（効果量）

```
d = (mean2 - mean1) / pooled_std_dev
```

| 効果量 | 閾値 | 解釈 |
|--------|------|------|
| `NEGLIGIBLE` | |d| < 0.2 | 無視できる |
| `SMALL` | 0.2 ≤ |d| < 0.5 | 小 |
| `MEDIUM` | 0.5 ≤ |d| < 0.8 | 中 |
| `LARGE` | |d| ≥ 0.8 | 大 |

### Slack通知

A/Bテスト評価完了時にSlack通知を送信:

```
🎉 A/Bテスト結果: ACOS閾値緩和テスト

*テストID:* `abc-123-def`
*テスト期間:* 14日間

*コントロール:* 150件
*テスト:* 145件

────────────────────

*📉 ACOS*
コントロール: 28.5% → テスト: 25.2%
差分: -11.6% (有意)

*📈 ROAS*
コントロール: 3.51 → テスト: 3.97
差分: +13.1% (有意)

────────────────────

*判定:* テストグループ勝利
テストグループのACOSが有意に改善（-11.6%、p=0.0023）
```

### 使用例

#### テスト作成

```bash
curl -X POST http://localhost:3000/ab-test/tests \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INTERNAL_TOKEN" \
  -d '{
    "name": "ACOS閾値緩和テスト",
    "description": "目標ACOSを10%緩和した場合の効果を検証",
    "assignmentLevel": "ASIN",
    "testGroupRatio": 0.5,
    "testOverrides": {
      "targetAcosMultiplier": 1.1
    },
    "startDate": "2025-01-01",
    "endDate": "2025-01-14"
  }'
```

#### テスト開始

```bash
curl -X POST http://localhost:3000/ab-test/tests/$TEST_ID/start \
  -H "Authorization: Bearer $INTERNAL_TOKEN"
```

#### 評価実行

```bash
curl -X POST http://localhost:3000/ab-test/tests/$TEST_ID/evaluate \
  -H "Authorization: Bearer $INTERNAL_TOKEN"
```

---

## 21. Dayparting（時間帯別入札最適化）

### 概要

時間帯別のパフォーマンス分析に基づき、統計的に有意な時間帯にのみ入札乗数を適用する機能。

### アーキテクチャ

```
src/dayparting/
├── types.ts                    # 型定義・定数
├── config.ts                   # 設定・デフォルト値
├── hourly-metrics-collector.ts # BigQueryからメトリクス収集
├── hourly-analyzer.ts          # 統計分析（t検定）
├── multiplier-calculator.ts    # 乗数計算
├── safety-manager.ts           # 安全機構・ロールバック
├── feedback-evaluator.ts       # フィードバック評価
├── bigquery-adapter.ts         # BigQuery CRUD
├── dayparting-engine.ts        # メインエンジン
└── index.ts                    # エクスポート
```

### 統計分析

#### One-Sample t-Test

各時間帯のCVR/ROASが全体平均と統計的に異なるかを検定：

```
t = (時間帯平均 - 全体平均) / (標準誤差)
p-value = 2 * (1 - tCdf(|t|, n-1))
```

#### 信頼度レベル

| レベル | サンプル数 | p値閾値 |
|-------|----------|---------|
| HIGH | ≥100 | <0.01 |
| MEDIUM | ≥50 | <0.05 |
| LOW | ≥30 | <0.10 |
| INSUFFICIENT | <30 | - |

#### 時間帯分類

| 分類 | 条件（平均比） | ベース乗数 |
|-----|--------------|-----------|
| PEAK | ≥150% | 1.3 |
| GOOD | ≥120% | 1.15 |
| AVERAGE | 80-120% | 1.0 |
| POOR | 50-80% | 0.85 |
| DEAD | <50% | 0.7 |

### 乗数計算

```typescript
// 分類ベース乗数 × 信頼度係数
baseMultiplier = CLASSIFICATION_BASE_MULTIPLIERS[classification]
confidenceFactor = CONFIDENCE_MULTIPLIER_FACTORS[confidence]
multiplier = 1.0 + (baseMultiplier - 1.0) * confidenceFactor

// 範囲制約
multiplier = clamp(multiplier, minMultiplier, maxMultiplier)
```

信頼度係数：
- HIGH: 1.0（フル適用）
- MEDIUM: 0.7
- LOW: 0.4
- INSUFFICIENT: 0.0（乗数=1.0）

### 安全機構

#### 安全チェック項目

1. **損失上限チェック**: 日次損失が設定上限を超えた場合
2. **パフォーマンス低下検知**: 前日比で一定以上の悪化
3. **連続悪化日数検知**: N日連続でパフォーマンス低下
4. **乗数範囲チェック**: 設定範囲外の乗数を検知

#### ロールバック

異常検知時に自動でデフォルト乗数(1.0)に戻す：

```typescript
interface RollbackInfo {
  asin: string;
  campaignId: string;
  reason: string;
  previousMultipliers: HourlyBidMultiplier[];
  rollbackMultipliers: HourlyBidMultiplier[];
  triggeredAt: Date;
  restoredAt: Date | null;
}
```

### SHADOW / APPLYモード

| モード | 動作 |
|-------|------|
| SHADOW | 計算のみ（実入札に反映しない） |
| APPLY | 実際の入札に乗数を適用 |

### BigQueryテーブル

| テーブル | 用途 |
|---------|------|
| dayparting_hourly_metrics | 時間帯別メトリクス |
| dayparting_multipliers | 計算された乗数 |
| dayparting_configs | 設定 |
| dayparting_feedback | フィードバック記録 |
| dayparting_rollbacks | ロールバック履歴 |

### APIエンドポイント

```
GET  /dayparting/configs/:asin/:campaignId    # 設定取得
POST /dayparting/configs                       # 設定作成/更新
POST /dayparting/analysis/:asin/:campaignId   # 分析実行
POST /dayparting/analysis/batch               # バッチ分析
GET  /dayparting/multipliers/:asin/:campaignId # 乗数取得
GET  /dayparting/feedback/:asin/:campaignId   # フィードバック取得
POST /dayparting/rollback/:asin/:campaignId   # ロールバック実行
GET  /dayparting/health/:asin/:campaignId     # ヘルスチェック
GET  /dayparting/status                        # システムステータス
```

### 環境変数

```
DAYPARTING_ENABLED=true
DAYPARTING_DEFAULT_MODE=SHADOW
DAYPARTING_MIN_SAMPLES=30
DAYPARTING_P_VALUE_THRESHOLD=0.05
DAYPARTING_MIN_MULTIPLIER=0.5
DAYPARTING_MAX_MULTIPLIER=2.0
DAYPARTING_LOOKBACK_DAYS=14
DAYPARTING_MAX_DAILY_LOSS=10000
```

### 導入フェーズ

1. **Phase 1**: SHADOW モードで全商品に対して分析実行
2. **Phase 2**: 少数の商品でAPPLYモード有効化
3. **Phase 3**: パフォーマンス確認後、段階的に拡大
4. **Phase 4**: 全商品でAPPLYモード

---

## 22. キーワード自動発見・拡張機能

### 概要

Amazon検索語レポートと将来的にはJungle Scout APIを活用し、新しい有望キーワード候補を自動的に発見・提案する機能。

**重要**: 本機能はSHADOWモード専用であり、発見されたキーワードは自動的にキャンペーンに追加されません。人間のレビューと承認を経てから手動で追加する運用フローとなります。

### フェーズ

| フェーズ | 内容 | ステータス |
|---------|------|-----------|
| Phase 1 | Amazon検索語レポートからの候補抽出 | 本番対応 |
| Phase 2 | Jungle Scout API統合 | 設計・ダミー実装のみ |

### アーキテクチャ

```
src/keywordDiscovery/
├── types.ts              # 型定義・設定定数
├── jungleScoutClient.ts  # Jungle Scout APIクライアント（ダミー）
├── engine.ts             # 発見・スコアリングエンジン
├── repository.ts         # BigQueryリポジトリ
├── httpHandler.ts        # Cronハンドラー
└── index.ts              # エクスポート
```

### 発見ソース

| ソース | 説明 | フェーズ |
|--------|------|---------|
| SEARCH_TERM | Amazon検索語レポートから抽出 | Phase 1 |
| JUNGLE_SCOUT | Jungle Scout API関連キーワード | Phase 2 |
| BOTH | 両方のソースで発見 | Phase 2 |

### 候補ステータス

| ステータス | 説明 |
|-----------|------|
| PENDING_REVIEW | レビュー待ち（初期状態） |
| APPROVED | 承認済み（キャンペーン追加待ち） |
| REJECTED | 却下 |
| APPLIED | キャンペーンに追加済み |

### スコアリングロジック

#### Phase 1: 検索語レポートベース

```typescript
// 基本スコア計算
let score = 0;

// クリック数ボーナス（最大30点）
score += Math.min(metrics.clicks7d * 3, 30);

// 注文数ボーナス（最大40点）
score += Math.min(metrics.orders7d * 10, 40);

// CVRボーナス（最大15点）
if (metrics.cvr7d > 0.1) score += 15;
else if (metrics.cvr7d > 0.05) score += 10;
else if (metrics.cvr7d > 0.02) score += 5;

// ACOSボーナス（最大15点）
if (metrics.acos7d > 0 && metrics.acos7d <= targetAcos * 0.5) score += 15;
else if (metrics.acos7d <= targetAcos * 0.8) score += 10;
else if (metrics.acos7d <= targetAcos) score += 5;
```

#### Phase 2: Jungle Scoutデータ統合（設計）

```typescript
// Jungle Scoutからの追加スコア
if (jungleScoutMetrics) {
  // 検索ボリュームボーナス
  if (monthlySearchVolume > 10000) score += 20;
  else if (monthlySearchVolume > 1000) score += 10;

  // 競合度ボーナス（低競合を優先）
  if (competitiveDensity < 0.3) score += 15;
  else if (competitiveDensity < 0.5) score += 10;
}
```

### マッチタイプ推奨ロジック

| 条件 | 推奨マッチタイプ |
|------|-----------------|
| CVR > 10% または 注文 ≥ 3 | EXACT |
| CVR > 5% または 注文 ≥ 1 | PHRASE |
| その他 | BROAD |

### BigQueryテーブル

#### keyword_discovery_candidates

| カラム | 型 | 説明 |
|--------|-----|------|
| profile_id | STRING | 広告プロファイルID |
| asin | STRING | 対象ASIN |
| query | STRING | キーワード文字列 |
| source | STRING | 発見ソース |
| state | STRING | 候補ステータス |
| score | FLOAT64 | 総合スコア |
| score_breakdown | JSON | スコア内訳 |
| suggested_match_type | STRING | 推奨マッチタイプ |
| search_term_metrics | JSON | 検索語メトリクス |
| jungle_scout_metrics | JSON | JSメトリクス（Phase 2） |
| discovered_at | TIMESTAMP | 発見日時 |
| reviewed_at | TIMESTAMP | レビュー日時 |
| reviewer_notes | STRING | レビューコメント |

#### v_keyword_discovery_pending_review（ビュー）

レビュー待ち候補をスコア降順で表示するビュー。

### APIエンドポイント

```
POST /cron/run-keyword-discovery   # 発見ジョブ実行
```

#### リクエストパラメータ

| パラメータ | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| profileId | string | - | 特定プロファイルのみ処理 |
| lookbackDays | number | 7 | 検索語ルックバック日数 |
| dryRun | boolean | false | 保存せずに結果のみ返す |
| enableJungleScout | boolean | false | JS統合を有効化（Phase 2） |
| skipSlackNotification | boolean | false | Slack通知を無効化 |

#### レスポンス

```json
{
  "success": true,
  "durationMs": 1234,
  "executionId": "uuid",
  "candidatesCount": 42,
  "stats": {
    "totalAsinsProcessed": 10,
    "totalSearchTermsProcessed": 500,
    "duplicatesExcluded": 150,
    "belowThresholdExcluded": 200,
    "searchTermCandidates": 42,
    "jungleScoutCandidates": 0,
    "finalCandidates": 42,
    "processingTimeMs": 1234
  },
  "slackNotificationSent": true
}
```

### 設定

```typescript
interface KeywordDiscoveryConfig {
  // 閾値設定
  minScore: number;           // 候補採用最低スコア（デフォルト: 20）
  minClicks: number;          // 最低クリック数（デフォルト: 2）
  minImpressions: number;     // 最低インプレッション（デフォルト: 100）
  maxAcos: number;            // 最大ACOS（デフォルト: 1.0 = 100%）

  // Phase 2設定
  enableJungleScout: boolean; // JS統合有効化（デフォルト: false）
  minSearchVolume: number;    // JS最低検索ボリューム
  maxCompetitiveDensity: number; // JS最大競合度

  // 除外設定
  excludePatterns: string[];  // 除外キーワードパターン
  minWordCount: number;       // 最小単語数（デフォルト: 1）
  maxWordCount: number;       // 最大単語数（デフォルト: 10）
}
```

### Slack通知

発見ジョブ完了時に以下の情報を通知：

- 実行ID・対象日・モード（DRY RUN / SHADOW）
- 新規候補キーワード数
- 対象ASIN数
- 処理統計（検索語数、重複除外数、閾値未満除外数）
- 上位候補例（スコア上位5件）

### 運用フロー

```
┌─────────────────────────────────────────────────────────────┐
│  1. Cloud Scheduler が日次で /cron/run-keyword-discovery    │
│     を呼び出し                                              │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  2. 検索語レポートから有望キーワードを抽出・スコアリング     │
│     → keyword_discovery_candidates テーブルに upsert        │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Slack通知でサマリーを送信                               │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  4. 運用者がBigQueryまたはダッシュボードで候補をレビュー     │
│     → APPROVED / REJECTED に更新                           │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  5. APPROVED候補を手動でAmazon広告キャンペーンに追加         │
│     → state を APPLIED に更新                              │
└─────────────────────────────────────────────────────────────┘
```

### 環境変数

```
# キーワード発見機能
KEYWORD_DISCOVERY_ENABLED=true
KEYWORD_DISCOVERY_MIN_SCORE=20
KEYWORD_DISCOVERY_MIN_CLICKS=2
KEYWORD_DISCOVERY_LOOKBACK_DAYS=7

# Jungle Scout（Phase 2用）
JUNGLE_SCOUT_API_KEY=xxx
JUNGLE_SCOUT_API_SECRET=xxx
KEYWORD_DISCOVERY_ENABLE_JUNGLE_SCOUT=false
```

### 今後の拡張予定

1. **Phase 2完全実装**: Jungle Scout API実統合
2. **レビューUI**: Webダッシュボードでの候補レビュー機能
3. **自動承認ルール**: 高スコア候補の条件付き自動承認
4. **キャンペーン自動追加**: APPLYモード実装（承認後の自動追加）

---

## 23. 季節性予測による先行入札調整

### 概要

Jungle Scoutの検索ボリューム履歴データを活用し、季節的なピークを予測して**ピーク到来前**に入札を調整する機能。
競合より先に入札を上げることで、ピーク時の広告枠獲得を有利に進める。

### 主な特徴

1. **先行調整**: ピーク当日ではなく、7-30日前から入札を徐々に上げる
2. **複数ピーク対応**: diet系は1月と5月の2回ピークなど、年間複数ピークをサポート
3. **カテゴリヒント活用**: データ不足時でもサプリメントカテゴリの事前知識で精度向上
4. **既存ガード尊重**: maxBid、LTV上限、在庫制限を絶対に超えない
5. **SHADOW/APPLYモード**: 本番適用前に十分なSHADOW期間でログ検証

### ファイル構成

```
src/seasonality/
├── types.ts              # 型定義
├── config.ts             # 設定とカテゴリヒント（サプリメント事前知識）
├── peak-detector.ts      # ピーク検出アルゴリズム
├── predictor.ts          # 予測ロジック
├── repository.ts         # BigQuery永続化
├── job.ts                # バッチジョブ
├── httpHandler.ts        # APIハンドラー
├── integration.ts        # bidEngine統合
└── index.ts              # Public API

src/bigquery/schemas/
└── seasonality_predictions.sql  # BigQueryスキーマ

tests/
└── seasonality.test.ts   # ユニットテスト（40テスト）
```

### カテゴリヒント（サプリメント事前知識）

```typescript
// src/seasonality/config.ts より抜粋
const SUPPLEMENT_CATEGORY_HINTS = {
  diet:       { months: [1, 5],          reason: "正月明け、GW前" },
  immune:     { months: [11, 12, 1],     reason: "風邪シーズン" },
  allergy:    { months: [2, 3, 4],       reason: "花粉シーズン" },
  uv:         { months: [4,5,6,7,8],     reason: "紫外線シーズン" },
  nmn:        { months: [12, 1],         reason: "年末年始" },
  gaba:       { months: [3, 4, 9],       reason: "新生活、異動シーズン" },
  vitamin_d:  { months: [10,11,12,1,2],  reason: "日照不足シーズン" },
  protein:    { months: [1, 4, 9],       reason: "トレーニング開始シーズン" },
  gift:       { months: [12, 2],         reason: "クリスマス、バレンタイン" },
};
```

### ピーク検出アルゴリズム

```
1. Jungle Scout Historical Search Volume API から過去24ヶ月のデータを取得
2. 月別に平均検索ボリュームと標準偏差を計算
3. baseline（全月平均）+ stdDev × 1.5 を超える月をピークと判定
4. カテゴリヒントがある場合は統合して信頼度を調整
5. 現在の日付から次のピークまでの日数を計算
6. Pre-peak期間（7-30日前）にある場合、入札倍率を計算
```

### 入札倍率計算

```typescript
// Pre-peak期間の進行度に応じて倍率を上げる
// 開始時: 1.0（調整なし）
// ピーク直前: maxMultiplier（デフォルト1.3 = 30%増）

const progress = (prePeakDaysMax - daysUntilPeak) / (prePeakDaysMax - prePeakDaysMin);
const easedProgress = progress ** 2;  // 二次関数でゆっくり立ち上がり
const multiplier = 1.0 + (maxMultiplier - 1.0) * easedProgress;
```

### APIエンドポイント

```
POST /cron/seasonality-update
  - 予測更新バッチジョブ
  - query: projectId, dataset, limit, forceRefresh

GET /cron/seasonality/:keyword
  - 個別キーワードの予測取得
  - query: projectId, dataset, forceRefresh, debug

GET /cron/seasonality/active-adjustments
  - アクティブな調整一覧
  - query: asin, minMultiplier, limit, offset

GET /cron/seasonality/stats
  - 調整ログ統計（SHADOW vs APPLY比較用）
  - query: daysBack
```

### BigQueryテーブル

```sql
-- seasonality_predictions
CREATE TABLE seasonality_predictions (
  keyword STRING NOT NULL,
  asin STRING,
  predicted_peaks STRING,        -- JSON配列
  current_multiplier FLOAT64,
  is_pre_peak_period BOOL,
  days_until_peak INT64,
  category_hint STRING,
  data_source STRING,            -- JS_ONLY, CATEGORY_HINT, COMBINED
  confidence_score FLOAT64,
  generated_at TIMESTAMP,
  expires_at TIMESTAMP
)
PARTITION BY DATE(generated_at)
CLUSTER BY keyword, asin, data_source;

-- seasonality_adjustment_log（調整履歴）
CREATE TABLE seasonality_adjustment_log (
  keyword STRING,
  mode STRING,                   -- SHADOW / APPLY
  original_bid FLOAT64,
  adjusted_bid FLOAT64,
  multiplier FLOAT64,
  applied BOOL,
  capped_by_max_bid BOOL,
  capped_by_ltv BOOL,
  capped_by_inventory BOOL,
  created_at TIMESTAMP
);
```

### 環境変数

```
# 季節性調整機能
SEASONALITY_ENABLED=false
SEASONALITY_MODE=SHADOW              # SHADOW / APPLY
SEASONALITY_MAX_MULTIPLIER=1.3
SEASONALITY_CONFIDENCE_THRESHOLD=0.6
SEASONALITY_PRE_PEAK_DAYS_MIN=7
SEASONALITY_PRE_PEAK_DAYS_MAX=30
SEASONALITY_DISABLE_DURING_EVENT=true   # S-MODE中は無効化
SEASONALITY_USE_CATEGORY_HINTS=true
```

### bidEngine統合

```typescript
// src/engine/bidEngine.ts の computeRecommendation 内
// inventoryGuard の後、guardrails の前に適用

import { applySeasonalityAdjustment } from "../seasonality";

const seasonalityResult = await applySeasonalityAdjustment({
  keyword,
  originalBid: recommendedBid,
  maxBid: productConfig.maxBid,
  ltvMaxBid: ltvConstraint.maxBid,
  inventoryMaxBid: inventoryConstraint.maxBid,
  isEventOverrideActive: eventOverride?.active,
});

if (seasonalityResult.applied) {
  recommendedBid = seasonalityResult.adjustedBid;
}
```

### SHADOW/APPLYモード運用

1. **初期導入**: `SEASONALITY_MODE=SHADOW` で開始
2. **ログ分析**: `seasonality_adjustment_log` で効果をシミュレーション
3. **段階的適用**: 特定ASINのみAPPLYモードに切り替え
4. **全面展開**: 効果確認後、全体をAPPLYモードに

---

## 24. プロ戦略モジュール

### 概要

Amazon広告のプロフェッショナルな運用ノウハウを実装した戦略モジュール。
アンカーキーワード戦略、Revenue-Based Bid、ローンチモード最適化、SKU選択、季節性追随、Bidding Lifecycle、キャンペーン保護、商品レベルTACOSコントローラの8つの戦略を提供。

### ファイル構成

```
src/strategies/
├── index.ts              # エクスポート
└── pro-strategies.ts     # プロ戦略ロジック
```

### 8つの戦略

#### 1. アンカーキーワード戦略

CVRがカテゴリ平均より高いキーワードを「アンカーキーワード」として特定し、重点的に投資する。

```typescript
// アンカースコア = CVR比率 × 関連性 × log(検索ボリューム) / 3
const isAnchor = cvr_vs_category >= 1.5 && relevance_score >= 0.7;
```

**判定条件:**
- CVRがカテゴリ平均の1.5倍以上
- 関連性スコア0.7以上

#### 2. Revenue-Based Bid（売上ベース最適入札額）

期待売上に基づいて最適入札額を計算する。

```typescript
// 最適入札額 = 平均注文単価 × CVR × 目標ACOS × 安全マージン
optimal_bid = avg_order_value × cvr × target_acos × safety_margin
// 例: 3000円 × 5% × 20% × 90% = 27円
```

**計算例:**
| 平均単価 | CVR | 目標ACOS | 安全マージン | 最適入札額 |
|---------|-----|---------|------------|-----------|
| 3,000円 | 5% | 20% | 90% | 27円 |
| 5,000円 | 4% | 25% | 80% | 40円 |
| 50,000円 | 2% | 15% | 90% | 135円 |

#### 3. ローンチ攻め最適化

新商品発売後14日間は、ACOS許容度を上げて積極的にインプレッションを獲得する。

| 経過日数 | ACOS許容度倍率 | 最小インプレッション/3h |
|----------|----------------|------------------------|
| 0-3日 | 3.0x | 100 |
| 4-7日 | 2.0x | 50 |
| 8-14日 | 1.5x | 30 |
| 15日以降 | 1.0x | - |

**入札調整:**
- インプレッション50%未満: +30%
- インプレッション50-80%: +15%
- インプレッション80%以上: 調整なし

#### 4. 広告SKU選択

バリエーション商品では、売上1位ではなく「広告効率が最高のSKU」を広告に使う。

```typescript
// SKUスコア = CTR × CVR × (1 + log10(impressions) / 4)
// インプレッション100未満のSKUは除外
```

**出力:**
- 推奨SKU
- 売上1位との差異フラグ
- 推奨理由

#### 5. 季節性追随

前年同期比でセッション数を比較し、需要フェーズを判定して入札戦略を調整。

| 前年比 | 需要フェーズ | ACOS倍率 | 入札姿勢 |
|--------|-------------|---------|---------|
| +20%以上 | DEMAND_RISING | 1.3x | AGGRESSIVE |
| ±10%以内 | PEAK | 1.2x | AGGRESSIVE |
| -10%〜-20% | POST_PEAK | 0.9x | MODERATE |
| -20%以下 | OFF_SEASON | 0.8x | CONSERVATIVE |

**注**: 季節性スコア0.3未満（通年型商品）は需要フェーズ判定をスキップ

#### 6. Bidding Lifecycle（入札ライフサイクル管理）

クリック数に基づいてキーワードのライフサイクルフェーズを判定し、適切な入札戦略を適用。

| フェーズ | クリック数 | 入札戦略 | ACOS許容 | 係数 |
|---------|-----------|----------|---------|------|
| Phase1（データ収集期） | < 100 | Inch Up | 目標の3倍 | 0.8 |
| Phase2（最適化期） | ≥ 100 | Revenue-Based | 目標の1.5倍 | 1.0 |
| Phase3（成長期） | ≥ 100 & ACOS良好 | Aggressive | 目標の1.2倍 | 1.3 |

**Phase1 Inch Up Bidding:**
- 50クリック未満: +15%/回
- 50-99クリック: +10%/回
- Revenue-Basedの上限（ACOS 3倍）を超えない

**Phase3移行条件:**
- クリック数100以上
- 現在のACOSが目標ACOSの80%未満

#### 7. キャンペーン保護

ROAS改善中の好調キャンペーンに保護フラグを立て、不要な構造変更を防ぐ。

**健全性スコア計算:**
```typescript
healthScore = (roas_last_7d / roas_last_30d) * 50 +
              (days_since_structure_change > 14 ? 30 : 0) +
              (total_sales_30d > 100000 ? 20 : 10);
```

**保護条件:**
- 健全性スコア70以上
- ROASトレンドがIMPROVINGまたはSTABLE

**変更制限:**
| 変更タイプ | 保護キャンペーン |
|-----------|-----------------|
| BID_CHANGE | 常に許可 |
| KEYWORD_ADD | 警告付きで許可 |
| KEYWORD_REMOVE | 拒否 |
| STRUCTURE_CHANGE | 拒否 |

#### 8. 商品レベル TACOS コントローラ

商品（ASIN）単位でTACOSを目標レンジに制御するための補正係数`productBidMultiplier`を計算。

**LTV倍率計算（サプリメント等）:**
```typescript
ltvMultiplierStage = 1 + expectedRepeatOrdersAssumed × stageCoefficient × ltvSafetyFactor
```

| ステージ | stageCoefficient | 目標利益率 | TACOS安全レンジ |
|----------|------------------|-----------|----------------|
| LAUNCH_HARD | 1.0 | 0% | 25-55% |
| LAUNCH_SOFT | 0.8 | 5% | 20-45% |
| GROW | 0.5 | 10% | 15-35% |
| HARVEST | 0.2 | 15% | 10-25% |

**目標TACOS計算:**
```typescript
// LTV/TACOS計算では marginRateNormal を使用する
maxTacosStageRaw = marginRateNormal × ltvMultiplierStage − targetProfitRateStage
targetTacosStage = clamp(maxTacosStageRaw, minTacosStage, maxTacosStage)
```

**ゾーン判定と補正係数:**

| ゾーン | 条件 | productBidMultiplier |
|--------|------|---------------------|
| 強い抑制 | TACOS > 目標120% かつ 自然検索不調 | 0.7 |
| 軽い抑制 | TACOS > 目標105% | max(0.8, 1 - k1 × tacosDiffRate) |
| 攻め | TACOS < 目標80% かつ 自然検索好調 | min(1.3, 1 + k2 × \|tacosDiffRate\|) |
| ニュートラル | それ以外 | 1.0 |

**自然検索成長率の閾値:**
- 好調 (goodOrganicGrowth): ≥ 10%
- 不調 (badOrganicGrowth): ≤ 2%

**最終入札値:**
```typescript
finalBid = keywordBaseBid × productBidMultiplier × 既存の補正係数
```

### 商品プロファイルタイプ

商品特性に応じたプリセットプロファイルを提供。

| プロファイル | 説明 | marginRateNormalDefault | expectedRepeatOrders | ltvSafetyFactor |
|--------------|------|-------------------------|----------------------|-----------------|
| `SUPPLEMENT_HIGH_LTV` | カカオPS系サプリ向け | 0.55 | 1.7 | 0.7 |
| `SUPPLEMENT_STANDARD` | 一般サプリ向け | 0.40 | 1.3 | 0.6 |
| `SINGLE_PURCHASE` | 単発購入商品向け | 0.30 | 1.0 | 1.0 |
| `DEFAULT` | デフォルト | 0.30 | 1.0 | 0.8 |

**SUPPLEMENT_HIGH_LTV 詳細:**
```typescript
{
  type: "SUPPLEMENT_HIGH_LTV",
  marginRateNormalDefault: 0.55,
  expectedRepeatOrdersAssumed: 1.7,
  ltvSafetyFactor: 0.7,
  tacosConfig: {
    LAUNCH_HARD: { minTacos: 0.25, maxTacos: 0.40 },
    LAUNCH_SOFT: { minTacos: 0.22, maxTacos: 0.38 },
    GROW: { minTacos: 0.20, maxTacos: 0.35 },
    HARVEST: { minTacos: 0.10, maxTacos: 0.20 },
  },
}
```

### 新商品（NEW_PRODUCT）ロジック

データ不足の新商品に対して保守的な入札制約を適用。

**判定条件（すべて満たす場合）:**
| 条件 | 閾値 |
|------|------|
| `daysSinceFirstImpression` | < 30日 |
| `clicks30d` | < 100クリック |
| `orders30d` | < 20件 |

**入札制約:**
| パラメータ | 値 |
|-----------|-----|
| `MAX_BID_CHANGE_RATE` | 15% |
| `MIN_PRODUCT_BID_MULTIPLIER` | 0.9 |
| `MAX_PRODUCT_BID_MULTIPLIER` | 1.1 |
| `DEFAULT_LTV_SAFETY_FACTOR` | 0.5 |

**昇格条件（すべて満たす）:**
- 30日経過
- クリック100以上
- 注文20以上

**昇格時の再推計:**
昇格時に直近90日の実績データを用いてパラメータを再推計し、カテゴリ標準値から商品固有値へ更新。

| 推計対象 | ロジック |
|----------|----------|
| `expectedRepeatOrders` | 1 + (リピート注文数 / 新規顧客数) |
| `ltvSafetyFactor` | データ量に応じて0.6〜0.8 |
| `ltvMode` | EARLY_ESTIMATE または MEASURED |

**関連関数:**
- `reestimateParameters()` - パラメータ再推計
- `executePromotion()` - 昇格処理実行

### 統合評価関数

全戦略を統合してキーワードを評価する。

```typescript
const result = evaluateKeywordWithStrategies(keywordInput, launchConfig);

// 結果:
// - anchor_score: アンカースコア
// - launch_adjustment: ローンチ調整率
// - demand_multiplier: 需要倍率
// - final_bid_multiplier: 最終入札倍率（全戦略の統合）
// - recommendations: 推奨アクションリスト
```

### 型定義

| 型名 | 説明 |
|------|------|
| `AnchorKeywordInput` | アンカーKW入力（CVR、カテゴリ平均CVR、関連性等） |
| `AnchorKeywordResult` | アンカーKW判定結果 |
| `LaunchModeConfig` | ローンチモード設定 |
| `SkuPerformance` | SKUパフォーマンス指標 |
| `RecommendedAdSku` | SKU推奨結果 |
| `DemandFollowingInput` | 季節性追随入力 |
| `DemandFollowingResult` | 需要フェーズ判定結果 |
| `CampaignHealthInput` | キャンペーン健全性入力 |
| `CampaignProtection` | キャンペーン保護状態 |
| `IntegratedKeywordEvaluation` | 統合評価結果 |
| `RevenueBasedBidInput` | Revenue-Based Bid入力 |
| `RevenueBasedBidResult` | Revenue-Based Bid結果 |
| `BiddingLifecyclePhase` | Lifecycle フェーズ (PHASE1/2/3) |
| `BiddingLifecycleInput` | Lifecycle判定入力 |
| `BiddingLifecycleResult` | Lifecycle判定結果 |
| `ProductLifecycleStage` | 商品ライフサイクル (LAUNCH_HARD/SOFT, GROW, HARVEST) |
| `TacosControllerInput` | TACOSコントローラ入力 |
| `TacosControllerResult` | TACOSコントローラ結果 |
| `TacosControllerConfig` | TACOSコントローラ設定 |
| `TacosZone` | TACOSゾーン判定 (STRONG_SUPPRESSION等) |
| `ProductProfileType` | 商品プロファイル種別 (SUPPLEMENT_HIGH_LTV等) |
| `ProductProfile` | 商品プロファイル設定 |
| `PromotionPerformanceData` | 昇格時再推計用の実績データ（90日分） |
| `ParameterReestimationResult` | パラメータ再推計結果 |
| `PromotionResult` | 昇格処理結果 |
| `CompetitionData` | 競合データ（Jungle Scout等から取得） |
| `CompetitionIntensityScore` | 激戦度スコア (0-3) |
| `ProfileAssignmentResult` | プロファイル自動割り当て結果 |
| `GrowthAssessmentData` | 成長判定用データ |
| `GrowthConditions` | 成長条件判定結果 |
| `GrowthCandidateResult` | 成長候補判定結果 |
| `RiskAssessment` | リスク評価結果 |
| `GlobalRiskConfig` | グローバルリスク設定 |

### LTV期待粗利・累積赤字管理

商品のLTV期待粗利に基づいて累積赤字上限を管理する。

**LTV期待粗利計算:**
```typescript
expectedLtvGrossProfit = price × marginRateNormal × (1 + expectedRepeatOrdersAssumed)
```

**累積赤字上限計算:**
```typescript
productCumulativeLossLimit = expectedLtvGrossProfit × lossBudgetMultiple
```

**プロファイル別赤字許容倍率:**
| プロファイル | Initial | Mature |
|-------------|---------|--------|
| SUPPLEMENT_HIGH_LTV | 0.6 | 0.4 |
| SUPPLEMENT_STANDARD | 0.4 | 0.25 |
| SINGLE_PURCHASE | 0.2 | 0.1 |
| DEFAULT | 0.3 | 0.2 |

**ライフサイクル別連続赤字許容月数（SUPPLEMENT_HIGH_LTV）:**
| ステージ | 許容月数 |
|----------|---------|
| LAUNCH_HARD | 6ヶ月 |
| LAUNCH_SOFT | 4ヶ月 |
| GROW | 3ヶ月 |
| HARVEST | 1ヶ月 |

### 激戦度判定・プロファイル自動割り当て

Jungle Scout等から取得した競合データに基づいて激戦度を判定し、プロファイルを自動割り当て。

**激戦度スコア計算（0-3）:**
| 条件 | 閾値 |
|------|------|
| 強い競合数 | >= 15社 |
| 中央CPC対価格比 | >= 5% |
| 大手ブランドシェア | >= 50% |

**スコアに基づくプロファイル推奨:**
| スコア | 推奨プロファイル |
|--------|------------------|
| 0-1 | SUPPLEMENT_HIGH_LTV |
| 2-3 | SUPPLEMENT_STANDARD |

### 成長判定条件（isGrowingCandidate）

3つの条件すべてを満たす場合に成長候補とみなす。

**条件1: conditionOrganicGrowing**
- オーガニック売上の前月比成長率 >= 5%

**条件2: conditionRatingHealthy**
- 自社評価 >= 3.8
- 競合との評価差 >= -0.3

**条件3: conditionAdsToOrganic**
- オーガニック売上/広告売上 >= 80%
- 広告依存度 <= 70%

**成長スコアに基づく推奨ライフサイクル:**
| スコア | 推奨ステート |
|--------|--------------|
| >= 80 | LAUNCH_HARD/SOFT維持 |
| >= 60 | GROW |
| >= 40 | 現状維持 |
| < 40 | HARVEST |

---

### 理論最大TACOS（theoreticalMaxTacos）

LTVベースで算出した「広告費として投じてよい上限」をTACOS形式で表現。

**計算式:**
```
theoreticalMaxTacos = marginRateNormal × (1 + expectedRepeatOrders) × ltvSafetyFactor
theoreticalMaxTacosCapped = min(theoreticalMaxTacos, tmaxCapGlobal)
```

**デフォルト設定:**
| パラメータ | デフォルト値 |
|------------|-------------|
| tmaxCapGlobal | 0.7 (70%) |

### TACOSゾーン制御

TACOSを3ゾーンに分類し、ゾーンに応じた制御を実行。

**ゾーン定義:**
| ゾーン | 条件 | 状態 |
|--------|------|------|
| GREEN | currentTacos ≤ tacosTargetMid | 健全 |
| ORANGE | tacosTargetMid < currentTacos ≤ tacosMax | 注意 |
| RED | currentTacos > tacosMax | 危険 |

**tacosTargetMid計算:**
```
tacosTargetMid = tacosMax × midFactor
```

**ステージ別midFactor例（SUPPLEMENT_HIGH_LTV）:**
| ステージ | midFactor | tacosAcuity |
|----------|-----------|-------------|
| LAUNCH_HARD | 0.70 | 0.8 |
| GROW | 0.75 | 1.0 |
| HARVEST | 0.80 | 1.2 |

### TACOS乖離によるtargetAcos調整

```
tacosDelta = (tacosTargetMid - currentTacos) / max(tacosTargetMid, epsilon)
adjustmentFactor = 1 + tacosAcuity × tacosDelta
rawTargetAcos = baseLtvAcos × adjustmentFactor
targetAcos = clamp(rawTargetAcos, stageAcosMin, stageAcosMax)
```

REDゾーン時は追加ペナルティ:
```
targetAcos = min(targetAcos, tacosMax × tacosPenaltyFactorRed)
```

### ライフサイクル × TACOSゾーン連動

| ステート | ORANGE許容 | RED許容 | ORANGE月数 | RED月数(成長候補) |
|----------|-----------|---------|------------|-------------------|
| LAUNCH_HARD | ○ | ○ | 3 | 2 |
| LAUNCH_SOFT | ○ | × | 2 | 1 |
| GROW | ○(一時的) | × | 1 | 0 |
| HARVEST | × | × | 0 | 0 |

**入札制御アクション:**
- REDゾーン: 入札20%削減
- ORANGEゾーン: 入札10%削減
- HARVESTでRED: 入札停止フラグ

---

## 25. SEO目標順位ロジック

### 概要

「TACOS × LTV × ライフサイクル制御」に「SEO目標順位（オーガニック順位）」の考え方を追加。
すべてのキーワードクラスタについて理想目標順位（idealRank）は原則「1位」とし、
競合状況や実績データに基づいて運用上の目標順位（targetRank）を段階的に下げる方針。

**重要**: targetRankの変更はツールが自動で行わず、「提案」として出力し、人間がproduct_config側で採用するフロー。

### ファイル

```
src/seo/
  seo-rank-target.types.ts      # 型定義（RankTargetConfig, SeoProgressMetrics等）
  seo-progress-calculator.ts    # SEO進捗スコア計算
  rank-adjustment-suggester.ts  # 目標順位ダウン提案ロジック
  seo-tacos-integration.ts      # SEO進捗とTACOS制御の統合
  index.ts                      # エクスポート

src/lifecycle/
  transition-logic.ts           # ライフサイクル遷移ロジック（SEO進捗統合）
```

### RankTargetConfig

キーワードクラスタ単位の目標順位設定。

```typescript
interface RankTargetConfig {
  idealRank: number      // 理想目標順位。原則1
  targetRank: number     // 運用上の目標順位。初期値はidealRankと同じ
  rankTolerance: number  // 許容誤差。例: 1〜2
}
```

**デフォルト値:**
| フィールド | デフォルト値 |
|-----------|-------------|
| `idealRank` | 1 |
| `targetRank` | 1 |
| `rankTolerance` | 2 |

**プロファイル別デフォルト:**
| プロファイル | idealRank | targetRank | rankTolerance |
|--------------|-----------|------------|---------------|
| SUPPLEMENT_HIGH_LTV | 1 | 1 | 2 |
| SINGLE_PURCHASE | 1 | 1 | 1 |
| DEFAULT | 1 | 1 | 2 |

### SeoProgressMetrics

キーワードクラスタ単位のSEO進捗メトリクス。

```typescript
interface SeoProgressMetrics {
  clusterId: string           // クラスタ識別子
  productId: string           // ASIN
  organicRank: number         // オーガニック順位（中央値）
  sov: number                 // Share of Voice（%）
  targetRank: number          // 運用目標順位
  rankTolerance: number       // 許容誤差
  seoProgressScore: number    // SEO進捗スコア（0〜約1.5）
  rankScoreComponent: number  // 順位コンポーネント
  sovScoreComponent: number   // SOVコンポーネント
  calculatedAt: Date
}
```

### seoProgressScore計算

**順位コンポーネント:**
```
rankScoreComponent = (targetRank + rankTolerance - organicRank) / max(targetRank, 1)
→ 0〜1.5にクランプ
```

**SOVコンポーネント:**
```
sovScoreComponent = sov / max(targetSov, epsilon)
→ 0〜1.5にクランプ
```

**合成スコア:**
```
seoProgressScore = wRank × clamp(rankScoreComponent, 0, 1.5)
                 + wSov  × clamp(sovScoreComponent, 0, 1.5)
```

**デフォルト重み:**
- wRank = 0.6（順位重視）
- wSov = 0.4

**スコア解釈:**
| スコア範囲 | レベル | 意味 |
|------------|--------|------|
| < 0.7 | LOW | まだ目標から遠い |
| 0.7〜1.1 | ON_TARGET | 目標レベル |
| > 1.1 | HIGH | 目標以上に取れている |

### RankAdjustmentSuggestion（目標順位ダウン提案）

「理想1位に対して無理筋」なクラスタを検出し、targetRankを下げる提案を生成。

```typescript
interface RankAdjustmentSuggestion {
  productId: string
  clusterId: string
  idealRank: number
  currentTargetRank: number
  suggestedTargetRank: number
  reasonCode: "UNREALISTIC_FOR_IDEAL" | "STABLE_ABOVE_TARGET"
  explanation: string    // 日本語メッセージ
  metrics: {
    medianOrganicRank90d: number
    seoProgressScore90d: number
    lossUsageRatio: number
    unhealthyTacosRatio: number
  }
  suggestedAt: Date
}
```

**無理筋判定条件（すべてConfig化）:**
| 条件 | デフォルト閾値 |
|------|---------------|
| 順位ギャップ | medianOrganicRank90d > idealRank + 5 |
| SEO進捗スコア | seoProgressScore90d < 0.7 |
| 累積赤字消化率 | lossUsageRatio >= 0.8 |
| TACOS不健全割合 | ORANGE+RED >= 60% |

2条件以上満たした場合に「UNREALISTIC_FOR_IDEAL」と判定。

**suggestedTargetRank決定ルール:**
| organicRank範囲 | 推奨targetRank |
|-----------------|----------------|
| 1〜5 | 提案なし |
| 6〜10 | 5 |
| 11〜20 | 10 |
| 21以上 | 15 |

**提案メッセージ例:**
```
過去90日間、オーガニック順位の中央値が11位で頭打ちになっており、
TACOSもオレンジ〜レッドゾーンが継続、累積投資もLTV上限の8割に達しています。
理想は1位ですが、このクラスタについては運用上の目標順位を5位→10位に下げることを検討してください。
```

### SEO進捗とTACOS制御の統合

seoProgressScoreに基づいてTACOS制御パラメータを調整。

**LOW（seoProgressScore < 0.7）:**
- 目標順位に届いていない → 「攻め続ける」方向にバイアス
- tacosTargetMidを10%上方シフト
- tacosAcuityを5%下げる（TACOS上振れに鈍感に）

**HIGH（seoProgressScore >= 1.1）:**
- 目標以上を安定して取れている → 「利益回収モード」
- tacosTargetMidを10%下方シフト
- tacosAcuityを5%上げる（TACOS上振れに敏感に）

**ON_TARGET:**
- 調整なし

### ライフサイクル判定との連携

LAUNCH_HARD/LAUNCH_SOFTで以下の状況の場合にシグナルを出力:
- seoProgressScoreが低いまま
- 累積損失が上限に近づいている
- RankAdjustmentSuggestion.UNREALISTIC_FOR_IDEALが発生している

→「今回のセールサイクルでは1位は狙わず、targetRankを下げることを検討」というシグナル

### SEOデータ取得フロー

```
Brand Analytics / Jungle Scout
        ↓
  organicRank, sov (キーワード別)
        ↓
  クラスタ単位で集計（中央値、平均）
        ↓
  SeoProgressMetrics計算
        ↓
  RankAdjustmentSuggestion生成
        ↓
  人間がレビュー → product_config更新
```

### 運用サイクル

1. **初期設定**: すべてのクラスタで idealRank=1, targetRank=1
2. **日次**: SEO進捗スコアを計算、TACOS制御パラメータを調整
3. **月次**: RankAdjustmentSuggestionを生成
4. **人間レビュー**: 提案を確認し、必要なクラスタのtargetRankをproduct_configで更新
5. **繰り返し**: 新しいtargetRankでSEO進捗を再評価

### 型定義一覧

| 型名 | 説明 |
|------|------|
| `RankTargetConfig` | 目標順位設定 |
| `SeoProgressMetrics` | SEO進捗メトリクス |
| `SeoProgressConfig` | SEO進捗計算設定 |
| `RankAdjustmentSuggestion` | 目標順位ダウン提案 |
| `RankAdjustmentConfig` | 提案判定設定 |
| `SuggestedRankRule` | 推奨targetRank決定ルール |
| `KeywordClusterConfig` | クラスタ設定 |
| `SeoProgressLevel` | 進捗レベル（LOW/ON_TARGET/HIGH） |
| `SeoAdjustedTacosParams` | SEO調整後TACOS制御パラメータ |
| `SeoIntegratedTacosContext` | SEO統合TACOSコンテキスト |
| `ProductLtvProfile` | 商品LTVプロファイル |

### LTVプロファイル別RankAdjustmentConfig

商品のLTVプロファイルに応じて、RankAdjustmentSuggestionの判定閾値を切り替える。SEO投資に対するマインドセットを明示的に反映し、HIGH_LTV商品は長期戦、LOW_LTV商品は早期撤退という方針を実装。

#### ProductLtvProfile

| プロファイル | 説明 |
|-------------|------|
| `SUPPLEMENT_HIGH_LTV` | 高LTV商品。粘り強くSEO投資を継続 |
| `SUPPLEMENT_NORMAL` | 標準的なサプリ。バランス型 |
| `LOW_LTV_SUPPLEMENT` | 低LTV商品。早期見切り型 |

#### プロファイル別閾値一覧

| 項目 | SUPPLEMENT_HIGH_LTV | SUPPLEMENT_NORMAL | LOW_LTV_SUPPLEMENT |
|------|---------------------|-------------------|-------------------|
| rankGapThreshold | 5 | 5 | 5 |
| seoProgressThreshold | 0.25 | 0.30 | 0.35 |
| lossUsageThreshold | 0.80 | 0.70 | 0.50 |
| unhealthyTacosMonths | 3 | 3 | 2 |
| evaluationPeriodDays | 90 | 90 | 90 |
| suggestedRankStep | 2 | 2 | 2 |

#### 設計意図

- **SUPPLEMENT_HIGH_LTV**: 「かなり粘ってから目標順位ダウン提案」
  - 累積損失上限の80%まで許容
  - seoProgressScoreが0.25未満のみ「進捗不足」と判定
  - TACOS不健全が3ヶ月連続で警戒

- **SUPPLEMENT_NORMAL**: 「バランス型（現状値をほぼ維持）」
  - 標準的な閾値設定
  - デフォルト設定と同等

- **LOW_LTV_SUPPLEMENT**: 「早めに見切って目標順位を下げる」
  - 累積損失上限の50%で警戒開始
  - seoProgressScoreが0.35未満で「進捗不足」（厳しめ）
  - TACOS不健全が2ヶ月連続で早期警戒

#### 使用例

```typescript
import {
  getRankAdjustmentConfigForProfile,
  generateRankAdjustmentSuggestion
} from "./seo";

// プロファイルを指定して提案を生成
const input: RankAdjustmentInput = {
  productId: "B123456789",
  clusterId: "cluster_1",
  productLtvProfile: "SUPPLEMENT_HIGH_LTV", // プロファイル指定
  // ... その他のフィールド
};

// プロファイルに応じた設定が自動適用される
const suggestion = generateRankAdjustmentSuggestion(input);

// 出力にプロファイル情報が含まれる
if (suggestion) {
  console.log(suggestion.productLtvProfile);             // 'SUPPLEMENT_HIGH_LTV'
  console.log(suggestion.rankAdjustmentProfileConfigName); // 'SUPPLEMENT_HIGH_LTV'
  console.log(suggestion.metrics.unhealthyTacosMonths);  // 連続不健全月数
}
```

---

## 26. ビッグセール用イベントカレンダー

### 概要

プライムデー、ブラックフライデーなど「毎年決まっている大型セール日」を手入力で管理し、日付ベースでEventModeを自動判定する機能。

### ファイル

```
src/event/
  calendar.ts   # イベントカレンダー・EventMode解決
  types.ts      # EventMode・EventBidPolicy定義
  index.ts      # エクスポート
```

### EventGrade（イベントグレード）

| グレード | 説明 | EventModeへの影響 |
|----------|------|------------------|
| S | 大型セール（Prime Day, Black Friday, Cyber Monday等） | applyToEventMode=trueで反映 |
| A | 中規模セール（タイムセール祭り等） | 通常はapplyToEventMode=false |
| B | 小さなキャンペーン | 通常はapplyToEventMode=false |

### SaleEventDefinition（セールイベント定義）

```typescript
interface SaleEventDefinition {
  id: string;              // 'prime_day_2025'
  label: string;           // 'Prime Day 2025'
  grade: EventGrade;       // 'S' | 'A' | 'B'
  timezone: string;        // 'Asia/Tokyo'
  start: string;           // '2025-07-15T00:00:00'
  end: string;             // '2025-07-16T23:59:59'
  prepDays: number;        // 準備期間（日数）
  applyToEventMode: boolean; // EventModeに反映するか
}
```

### EventMode決定フロー

```
現在日時（now）
    ↓
SALE_EVENT_CALENDAR をスキャン
    ↓
applyToEventMode === true のイベントを抽出
    ↓
各イベントについて期間判定:
  - prep期間: start - prepDays日 〜 start前日 → BIG_SALE_PREP
  - 本番期間: start 〜 end → BIG_SALE_DAY
  - それ以外 → NONE
    ↓
複数イベント該当時の優先度:
  1. グレード: S > A > B
  2. 同グレードは開始日が近い方を優先
    ↓
EventModeResolutionResult:
  - eventMode: 'NONE' | 'BIG_SALE_PREP' | 'BIG_SALE_DAY'
  - activeEvent: SaleEventDefinition | null
```

### EVENT_MODE_SOURCE環境変数

| 値 | 説明 |
|---|------|
| MANUAL | 環境変数EVENT_MODEから手動設定（デフォルト） |
| CALENDAR | イベントカレンダーから自動判定 |

### 使用例

```typescript
import { determineEventMode, SALE_EVENT_CALENDAR } from "./event";

const now = new Date();
const decision = determineEventMode(now, envConfig.eventMode, SALE_EVENT_CALENDAR);

console.log(decision.eventMode);   // 'BIG_SALE_DAY'
console.log(decision.source);      // 'CALENDAR'
console.log(decision.eventId);     // 'prime_day_2025'
console.log(decision.eventGrade);  // 'S'
```

### 運用ノート

- 毎年、`SALE_EVENT_CALENDAR`の日付を更新する（手入力）
- Sクラスのみ`applyToEventMode=true`を推奨
- A/Bクラスは参考情報として登録可能だが、EventModeには影響させない

---

## 27. SKU別ビッグセール戦略（bigSaleStrategy）

### 概要

SKUごとに「ビッグセール時にどこまで攻めるか」を制御するフラグ。GlobalConfig.mode（NORMAL/S_MODE）とEventModeの組み合わせに応じて、SKU単位の「effectiveMode」を決定する。

### ProductConfigへの追加

```typescript
interface ProductConfig {
  // ... 既存フィールド ...

  /**
   * ビッグセール戦略
   *
   * - NONE: 通常日と同じスタンス（S_MODEの攻めロジックを適用しない）
   * - LIGHT: 控えめに参加（S_MODEの攻め係数を半分程度にスケール）
   * - AGGRESSIVE: 本気で参加（S_MODEのフルパワーを活用）
   *
   * デフォルト: NONE
   */
  bigSaleStrategy?: BigSaleStrategy;
}
```

### effectiveMode決定ロジック

```
入力:
  - globalMode: 'NORMAL' | 'S_MODE'
  - eventMode: 'NONE' | 'BIG_SALE_PREP' | 'BIG_SALE_DAY'
  - bigSaleStrategy: 'NONE' | 'LIGHT' | 'AGGRESSIVE'

出力:
  - effectiveMode: 'NORMAL' | 'S_MODE' | 'S_MODE_LIGHT'
  - sModeScale: 0.0〜1.0
```

### effectiveMode決定表

| globalMode | eventMode | bigSaleStrategy | effectiveMode | sModeScale |
|------------|-----------|-----------------|---------------|------------|
| NORMAL | - | - | NORMAL | 0.0 |
| S_MODE | NONE | - | NORMAL | 0.0 |
| S_MODE | BIG_SALE_PREP | AGGRESSIVE | S_MODE_LIGHT | 0.5 |
| S_MODE | BIG_SALE_PREP | LIGHT | NORMAL | 0.0 |
| S_MODE | BIG_SALE_PREP | NONE | NORMAL | 0.0 |
| S_MODE | BIG_SALE_DAY | AGGRESSIVE | S_MODE | 1.0 |
| S_MODE | BIG_SALE_DAY | LIGHT | S_MODE_LIGHT | 0.5 |
| S_MODE | BIG_SALE_DAY | NONE | NORMAL | 0.0 |

### S_MODE攻め係数のスケーリング

effectiveModeに応じて、S_MODE用のパラメータをスケーリングする。

```typescript
// スケーリング式
scaledValue = normalValue + (sModeValue - normalValue) × sModeScale

// 例: maxBidUpMultiplier
// NORMAL=1.3, S_MODE=1.5 の場合
// sModeScale=1.0 → 1.5（フルS_MODE）
// sModeScale=0.5 → 1.4（S_MODE_LIGHT）
// sModeScale=0.0 → 1.3（NORMAL）
```

### スケーリング対象パラメータ

| パラメータ | NORMAL | S_MODE | スケーリング対象 |
|-----------|--------|--------|-----------------|
| maxBidUpMultiplier | 1.3 | 1.5 | ○ |
| maxBidDownMultiplier | 0.7 | 0.9 | ○ |
| acosHighMultiplierFor7dExcl | 1.2 | 1.5 | ○ |
| acosHighMultiplierFor30d | 1.05 | 1.15 | ○ |
| allowStrongDown | true | false | BIG_SALE_DAY時のみfalse |
| allowNoConversionDown | true | false | BIG_SALE_DAY時のみfalse |

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/strategies/effective-mode.ts` | effectiveMode決定ロジック |
| `src/config/productConfigTypes.ts` | BigSaleStrategy型定義 |
| `tests/strategies/effective-mode.test.ts` | テスト |

### 使用例

```typescript
import { determineEffectiveMode, calculateEffectiveEventBidParams } from "./strategies";

const effectiveModeResult = determineEffectiveMode({
  globalMode: "S_MODE",
  eventMode: "BIG_SALE_DAY",
  bigSaleStrategy: productConfig.bigSaleStrategy ?? "NONE",
});

const bidParams = calculateEffectiveEventBidParams(
  effectiveModeResult,
  eventMode
);

// effectiveModeResult.effectiveMode: 'S_MODE' | 'S_MODE_LIGHT' | 'NORMAL'
// effectiveModeResult.sModeScale: 1.0 | 0.5 | 0.0
// bidParams.maxBidUpMultiplier: スケーリング済みの値
```

### BigQuery出力

各SKUの処理結果に以下を含めて出力:

| フィールド | 説明 |
|-----------|------|
| event_mode | NONE / BIG_SALE_PREP / BIG_SALE_DAY |
| event_id | アクティブなイベントID（カレンダー使用時） |
| event_grade | イベントグレード（S/A/B） |
| event_mode_source | MANUAL / CALENDAR |
| big_sale_strategy | NONE / LIGHT / AGGRESSIVE |
| effective_mode | NORMAL / S_MODE / S_MODE_LIGHT |
| s_mode_scale | 0.0〜1.0 |

---

## 28. 実測LTV（measuredLtv）

### 概要

既存商品（販売実績のある商品）のLTVをBrand Analyticsのリピート率データと利益データから実測計算する機能。新商品は事前LTV（PRIOR/テンプレート値）を使用し、既存商品は実測LTV（MEASURED）を使用することで、より正確な累積損失上限の設定が可能になる。

### LTVソース

| ソース | 説明 | 適用条件 |
|-------|------|---------|
| PRIOR | 事前LTV（テンプレート値） | 新商品、または実測条件未達 |
| MEASURED | 実測LTV | 既存商品で実測条件達成 |

### 実測LTV条件

```typescript
interface MeasuredLtvConfig {
  minCustomersForMeasured: number;    // 300（デフォルト）
  minDaysActiveForMeasured: number;   // 180（デフォルト）
}
```

- 両方の条件を満たした場合のみMEASUREDを使用
- 条件を満たさない場合はPRIORにフォールバック

### 計算式

```
1. extraOrdersPerCustomer1y = max(0, (totalOrders1y - uniqueCustomers1y) / uniqueCustomers1y)
2. totalOrdersPerCustomer1y = 1 + extraOrdersPerCustomer1y
3. avgGrossProfitPerOrder1y = totalGrossProfit1y / totalOrders1y
4. measuredLtvGross = avgGrossProfitPerOrder1y × totalOrdersPerCustomer1y
5. ltvEffectiveGross = measuredLtvGross × ltvSafetyFactorMeasured
```

### プロファイル別安全係数

| プロファイル | ltvSafetyFactorMeasured |
|------------|------------------------|
| SUPPLEMENT_HIGH_LTV | 0.80 |
| SUPPLEMENT_NORMAL | 0.75 |
| LOW_LTV_SUPPLEMENT | 0.70 |

### 型定義

```typescript
// Brand Analyticsリピート率データ
interface RepeatMetrics1y {
  asin: string;
  uniqueCustomers1y: number;
  totalOrders1y: number;
  periodStart: Date;
  periodEnd: Date;
}

// 利益データ
interface ProfitMetrics1y {
  asin: string;
  totalGrossProfit1y: number;
  totalOrders1y: number;
  avgSellingPrice1y: number;
  avgMarginRate1y: number;
}

// 実測LTV計算結果
interface MeasuredLtvResult {
  asin: string;
  ltvSource: "PRIOR" | "MEASURED";
  avgGrossProfitPerOrder1y: number;
  extraOrdersPerCustomer1y: number;
  totalOrdersPerCustomer1y: number;
  measuredLtvGross: number;
  ltvSafetyFactorMeasured: number;
  ltvEffectiveGross: number;
  customersUsed: number;
  daysActive: number;
  calculationNote: string;
}

// LTV解決結果
interface ResolvedLtvResult {
  asin: string;
  ltvSource: "PRIOR" | "MEASURED";
  ltvEffectiveGross: number;
  measuredLtvGross: number | null;
  priorLtvGross: number;
  safetyFactorUsed: number;
  details: {
    measuredLtvResult?: MeasuredLtvResult;
    resolutionReason: string;
  };
}
```

### LTV解決フロー

```
resolveLtvForProduct(input)
  │
  ├─ isNewProduct=true → PRIOR を使用
  │
  ├─ measuredLtvInput なし → PRIOR を使用
  │
  └─ computeMeasuredLtv()
       │
       ├─ 条件達成 → MEASURED を使用
       │   - uniqueCustomers >= 300
       │   - daysActive >= 180
       │
       └─ 条件未達 → PRIOR を使用
```

### 累積損失上限への適用

```typescript
// LTV解決
const resolvedLtv = resolveLtvForProduct({
  asin: "B00XXXX",
  isNewProduct: false,
  priorLtvGross: 5000,
  priorSafetyFactor: 0.8,
  measuredLtvInput: { ... },
  productLtvProfile: "SUPPLEMENT_NORMAL",
});

// 累積損失上限の計算
const cumulativeLossLimit = calculateCumulativeLossLimitFromResolvedLtv(
  resolvedLtv,
  lossBudgetMultiple  // プロファイル別の倍率
);
```

### BigQuery出力フィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| ltv_source | STRING | PRIOR / MEASURED |
| measured_ltv_gross | FLOAT | 実測LTV粗利（MEASURED時） |
| ltv_effective_gross | FLOAT | 有効LTV粗利（安全係数適用後） |
| extra_orders_per_customer_1y | FLOAT | 顧客あたり追加注文数 |
| customers_used | INT | 計算に使用した顧客数 |
| days_active | INT | 販売開始からの日数 |

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/ltv/measuredLtv.ts` | 実測LTV計算ロジック |
| `src/ltv/index.ts` | エクスポート |
| `tests/ltv/measured-ltv.test.ts` | テスト |

---

## 29. TACOS最適化と健全性スコア（tacosHealth）

### 概要

TACOS（Total Advertising Cost of Sales）の最適値を過去データから推計し、現在のTACOSとの比較に基づいて健全性スコアを算出する機能。このスコアに応じてSTRONG_UP入札アクションの倍率を動的に調整する。

### 重要な設計原則: LTVベース上限とempirical上限の分離

TACOSには2つの独立した上限概念がある:

1. **theoreticalMaxTacosCapped (LTVベース)**: LTVから計算される理論上限。これは「広告費をかけても回収できるか」の財務的限界。
2. **tacosAggressiveCap (empiricalベース)**: 過去データの利益最大化TACOS + offset。これは「実際に利益が出るか」の実績ベース上限。

これらは別々のフィールドで管理し、制御用には両者のminを使用する:
```
tacosMaxForControl = min(theoreticalMaxTacosCapped, tacosAggressiveCap)
```

### 処理フロー

```
日次売上・広告費データ (90日分)
         ↓
   TACOSビン分け
   (binWidth=0.05, minDays=3)
         ↓
  各ビンの平均利益計算
  (Profit = revenue × (marginPotential - TACOS))
         ↓
   利益最大ビン選択
         ↓
   tacosTargetMid (最適TACOS)
         ↓
   tacosAggressiveCap = tacosTargetMid + offset  ← empirical推計
         ↓
   ┌──────────────────────────────────────────┐
   │  tacosMaxForControl計算                   │
   │  = min(theoreticalMaxTacosCapped,         │
   │        tacosAggressiveCap)                │
   └──────────────────────────────────────────┘
         ↓
   TACOSゾーン判定 (GREEN/ORANGE/RED)
         ↓
   tacosHealthScore計算 (-1〜+1)
         ↓
   STRONG_UP倍率計算 (1.0〜1.95)
         ↓
   STRONG_UPゲート適用
   (RED=1.0, ORANGE=max1.3, productBidMultiplier<1.0=max1.3)
         ↓
   入札計算に適用
```

### tacosTargetMid（利益最大化TACOS）の推計

過去の日次データをTACOS帯でビン分けし、各ビンの平均利益を比較して最も利益が高いTACOS帯を特定する。

```typescript
interface TacosOptimizationConfig {
  marginPotential: number;        // ポテンシャル粗利率（例: 0.55）
  binWidth: number;               // ビン幅（例: 0.05 = 5%刻み）
  minTacos: number;               // 評価TACOS下限（例: 0.05）
  maxTacos: number;               // 評価TACOS上限（例: 0.50）
  minDaysPerBin: number;          // ビンあたり最低日数（例: 3）
  theoreticalMaxOffset: number;   // offset（例: 0.06）
}

interface TacosOptimizationResult {
  tacosTargetMid: number | null;      // 利益最大化TACOS
  tacosAggressiveCap: number | null;  // tacosTargetMid + offset（empirical攻め上限）
  optimalBinCenter: number | null;
  optimalBinProfit: number | null;
  validBinCount: number;
  totalDaysUsed: number;
  calculationNote: string;
}
```

計算式:
```
Profit_d = revenue_d × (marginPotential - TACOS_d)
tacosTargetMid = 利益最大ビンの平均TACOS
tacosAggressiveCap = tacosTargetMid + theoreticalMaxOffset
```

### TACOSゾーン判定

```typescript
type TacosZone = "GREEN" | "ORANGE" | "RED";

interface TacosZoneContext {
  currentTacos: number;
  tacosTargetMidForControl: number;  // 利益最大化推計値 or デフォルト
  tacosMaxForControl: number;        // min(LTV上限, empirical上限)
}
```

ゾーン判定ルール:
```
GREEN:  currentTacos <= tacosTargetMidForControl（健全）
ORANGE: tacosTargetMidForControl < currentTacos <= tacosMaxForControl（注意）
RED:    currentTacos > tacosMaxForControl（危険）
```

### tacosHealthScore（健全性スコア）

```
スコアリング:
- tacos90d <= tacosLow → +1（EXCELLENT）
- tacos90d >= tacosHigh → -1（CRITICAL）
- tacosLow < tacos90d <= tacosMid → [1, 0] 線形マッピング
- tacosMid < tacos90d < tacosHigh → [0, -1] 線形マッピング

境界値:
- tacosLow = max(0, tacosTargetMidForControl - lowMargin)
- tacosMid = tacosTargetMidForControl
- tacosHigh = tacosMaxForControl
```

図解:
```
Score: +1 -------- 0 -------- -1
        |         |          |
     tacosLow  tacosMid  tacosHigh
      (超健康)  (目標)    (上限)

例: tacosTargetMidForControl=0.15, lowMargin=0.06, tacosMaxForControl=0.20
    tacosLow=0.09, tacosMid=0.15, tacosHigh=0.20
```

### STRONG_UP倍率とゲートロジック

基本倍率計算:
```typescript
const baseMultiplier = 1.3;
const alpha = 0.5;
const minMultiplier = 1.0;
const maxMultiplier = 1.95;
const orangeZoneMaxMultiplier = 1.3;

multiplier = baseMultiplier × (1 + alpha × score)
multiplier = clamp(multiplier, minMultiplier, maxMultiplier)
```

**STRONG_UPゲートルール:**

TACOSシグナルが「productBidMultiplier」「targetAcos」「STRONG_UP」の三重に効き過ぎないよう、ゲートを設ける:

| 条件 | ゲート動作 |
|------|-----------|
| REDゾーン | 強制的に1.0（STRONG_UP無効化） |
| ORANGEゾーン | max(orangeZoneMaxMultiplier, 1.3)に制限 |
| productBidMultiplier < 1.0 | max(orangeZoneMaxMultiplier, 1.3)に制限 |
| GREENゾーン & productBidMultiplier >= 1.0 | 制限なし |

| tacosHealthScore | raw計算 | ゲート前倍率 | REDゾーン | ORANGEゾーン |
|------------------|---------|-------------|-----------|--------------|
| +1 (超健康) | 1.3 × 1.5 = 1.95 | 1.95 | 1.0 | 1.3 |
| +0.5 (健康) | 1.3 × 1.25 = 1.625 | 1.625 | 1.0 | 1.3 |
| 0 (ニュートラル) | 1.3 × 1.0 = 1.3 | 1.3 | 1.0 | 1.3 |
| -0.5 (警告) | 1.3 × 0.75 = 0.975 | 1.0 | 1.0 | 1.0 |
| -1 (危険) | 1.3 × 0.5 = 0.65 | 1.0 | 1.0 | 1.0 |

### tacosMaxForControl計算

```typescript
interface TacosMaxForControlInput {
  theoreticalMaxTacosCapped: number;  // LTVベースの理論上限
  empiricalAggressiveCap: number | null;  // empirical推計（nullの場合はデフォルト使用）
  tacosAggressiveCapDefault: number;  // フォールバック用デフォルト
}

interface TacosMaxForControlResult {
  tacosMaxForControl: number;        // 制御用上限
  effectiveAggressiveCap: number;    // 実際に使用したempirical上限
  source: "EMPIRICAL" | "DEFAULT";   // empirical or デフォルトか
  ltvCapApplied: boolean;            // LTV上限が効いたか
}
```

### プロファイル別設定

| プロファイル | marginPotential | tacosTargetMidDefault | tacosAggressiveCapDefault | lowMargin |
|------------|-----------------|----------------------|--------------------------|-----------|
| SUPPLEMENT_HIGH_LTV | 0.55 | 0.18 | 0.25 | 0.08 |
| SUPPLEMENT_NORMAL | 0.50 | 0.15 | 0.21 | 0.06 |
| LOW_LTV_SUPPLEMENT | 0.45 | 0.12 | 0.17 | 0.05 |

### BigQuery出力フィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| tacos_target_mid_for_control | FLOAT | 制御用目標TACOS |
| tacos_aggressive_cap | FLOAT | empirical攻め上限 |
| tacos_max_for_control | FLOAT | 制御用上限（min of LTV上限 and empirical上限） |
| tacos_90d | FLOAT | 直近90日TACOS |
| tacos_zone | STRING | GREEN/ORANGE/RED |
| tacos_health_score | FLOAT | 健全性スコア（-1〜+1） |
| tacos_health_zone | STRING | EXCELLENT/HEALTHY/NEUTRAL/WARNING/CRITICAL |
| strong_up_multiplier_raw | FLOAT | ゲート前倍率 |
| strong_up_multiplier | FLOAT | ゲート後最終倍率 |
| strong_up_gate_applied | BOOLEAN | ゲートが適用されたか |
| strong_up_gate_reason | STRING | ゲート理由 |
| tacos_source | STRING | ESTIMATED / DEFAULT |

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/tacos/tacosHealth.ts` | TACOS健全性計算ロジック |
| `src/tacos/index.ts` | エクスポート |
| `tests/tacos/tacosHealth.test.ts` | テスト |

### LTVモジュールとの関係

```
┌───────────────────────────────────────────────────────────────────────┐
│                    入札決定フロー                                       │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────┐      ┌───────────────────────┐             │
│  │   LTVモジュール        │      │   TACOSモジュール       │             │
│  │                     │      │                       │             │
│  │ - priorLTV          │      │ - tacosTargetMid      │             │
│  │ - measuredLTV       │      │ - tacosAggressiveCap  │             │
│  │ - theoreticalMax    │      │ - tacosHealthScore    │             │
│  │   TacosCapped       │      │                       │             │
│  └─────────┬───────────┘      └───────────┬───────────┘             │
│            │                              │                          │
│            │  ┌────────────────────────────────────────┐             │
│            └─►│  tacosMaxForControl計算                │◄────────────┘
│               │  = min(theoreticalMaxTacosCapped,      │             │
│               │        tacosAggressiveCap)             │             │
│               └────────────────────────────────────────┘             │
│                               │                                      │
│                               ▼                                      │
│               ┌────────────────────────────────────────┐             │
│               │  TACOSゾーン判定 (GREEN/ORANGE/RED)     │             │
│               └────────────────────────────────────────┘             │
│                               │                                      │
│                               ▼                                      │
│               ┌────────────────────────────────────────┐             │
│               │  STRONG_UP倍率計算 + ゲート適用          │             │
│               │  - REDゾーン: 1.0                       │             │
│               │  - ORANGEゾーン: max 1.3               │             │
│               │  - productBidMultiplier<1.0: max 1.3   │             │
│               └────────────────────────────────────────┘             │
│                               │                                      │
│                               ▼                                      │
│               ┌────────────────────────────────────────┐             │
│               │  最終入札アクション決定                   │             │
│               └────────────────────────────────────────┘             │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 30. プレセール診断（Presale Diagnosis）

### 概要

Amazon広告の「先行セール（プレセール）」期間を診断し、「売れるプレセール」と「買い控えプレセール」を数値で判定する機能。プレセールのタイプに応じて、防御ロジック（DOWN/STOP/NEG）と攻めロジック（UP/STRONG_UP）の挙動を切り替える。

**コアコンセプト:**
- プレセール期間の実績データ（CVR/ACOS）を通常日（baseline）と比較
- 「売れる」「買い控え」「グレーゾーン」の3タイプに分類
- タイプに応じてDOWN/UP系アクションを制御

### ファイル

```
src/presale/
  types.ts                  # 型定義（SalePhase, PresaleType, ポリシー）
  diagnosis.ts              # 診断ロジック（diagnosePresaleType）
  defense-integration.ts    # 防御ロジック統合
  offense-integration.ts    # 攻めロジック統合
  index.ts                  # エクスポート
```

### SalePhase（セールフェーズ）

| フェーズ | 説明 | 診断対象 |
|---------|------|---------|
| NORMAL | 通常日（セール期間外） | × |
| PRE_SALE | プレセール期間（セール3-7日前程度） | ○ |
| MAIN_SALE | 本番セール期間 | × |
| COOL_DOWN | クールダウン期間（セール直後） | × |

### PresaleType（プレセールタイプ）

| タイプ | 条件 | 説明 |
|-------|------|------|
| NONE | PRE_SALEフェーズ以外 | 診断対象外 |
| BUYING | CVR比率≥90% かつ ACOS比率≤120% | 売れるプレセール |
| HOLD_BACK | CVR比率≤60% かつ ACOS比率≥130% | 買い控えプレセール |
| MIXED | 上記どちらでもない | グレーゾーン |

### 診断ロジック

```typescript
interface PresaleDiagnosisInput {
  baseline: PresalePeriodMetrics;  // 通常日（30日など）
  presale: PresalePeriodMetrics;   // プレセール期間（5日など）
}

interface PresaleDiagnosis {
  type: PresaleType;
  baselineCvr: number | null;
  presaleCvr: number | null;
  baselineAcos: number | null;
  presaleAcos: number | null;
  cvrRatio: number | null;    // presaleCvr / baselineCvr
  acosRatio: number | null;   // presaleAcos / baselineAcos
  reason: string;
}
```

計算式:
```
CVR比率 = presaleCvr / baselineCvr
ACOS比率 = presaleAcos / baselineAcos

BUYING: cvrRatio >= 0.9 AND acosRatio <= 1.2
HOLD_BACK: cvrRatio <= 0.6 AND acosRatio >= 1.3
MIXED: 上記以外
```

### PresaleBidPolicy（タイプ別ポリシー）

```typescript
interface PresaleBidPolicy {
  allowStopNeg: boolean;       // STOP/NEGを許可するか
  allowStrongDown: boolean;    // STRONG_DOWNを許可するか
  allowDown: boolean;          // DOWNを許可するか
  maxDownPercent: number;      // DOWN時の最大変動幅（%）
  allowStrongUp: boolean;      // STRONG_UPを許可するか
  maxUpMultiplier: number;     // UP時の最大倍率
  useBaselineAsPrimary: boolean; // baselineデータを主軸とするか
}
```

### タイプ別デフォルトポリシー

| タイプ | allowStopNeg | allowStrongDown | maxDownPercent | allowStrongUp | maxUpMultiplier | useBaselineAsPrimary |
|-------|--------------|-----------------|----------------|---------------|-----------------|---------------------|
| NONE | true | true | 15 | true | 1.30 | false |
| BUYING | true | true | 15 | true | 1.25 | false |
| HOLD_BACK | **false** | **false** | **7** | **false** | **1.10** | **true** |
| MIXED | false | false | 10 | false | 1.15 | true |

### 防御ロジック統合

HOLD_BACKの場合、以下のアクション変換が適用される:

| 元アクション | HOLD_BACK時 | MIXED時 |
|-------------|------------|---------|
| STOP | KEEP | KEEP |
| NEG | KEEP | KEEP |
| STRONG_DOWN | DOWN | DOWN |
| DOWN | DOWN（幅制限） | DOWN（幅制限） |
| KEEP | KEEP | KEEP |

**HOLD_BACK時の二重条件チェック:**

DOWNアクションは以下の二重条件を両方満たす場合のみ許可:
1. baselineでもACOSがtargetの120%超
2. presaleでさらに悪化継続

```typescript
function shouldAllowDownInHoldBack(
  baselineAcos: number | null,
  presaleAcos: number | null,
  targetAcos: number,
  baselineCvr: number | null,
  presaleCvr: number | null,
  targetCvr?: number
): { allowDown: boolean; reason: string }
```

### 攻めロジック統合

HOLD_BACKの場合、以下のアクション変換が適用される:

| 元アクション | HOLD_BACK時 | MIXED時 |
|-------------|------------|---------|
| STRONG_UP | MILD_UP（倍率1.1制限） | MILD_UP（倍率1.15制限） |
| MILD_UP | MILD_UP（倍率1.1制限） | MILD_UP（倍率1.15制限） |
| KEEP | KEEP | KEEP |

### 使用例

```typescript
import {
  createPresaleContext,
  applyPresaleDefense,
  applyPresaleOffense,
} from "./presale";

// 1. プレセールコンテキスト生成
const presaleContext = createPresaleContext(
  {
    baseline: { clicks: 500, cost: 25000, conversions: 25, revenue: 100000 },
    presale: { clicks: 80, cost: 5000, conversions: 2, revenue: 8000 },
  },
  { salePhase: "PRE_SALE", baselineMinClicks: 20, presaleMinClicks: 10, ... }
);

// presaleContext.diagnosis.type === "HOLD_BACK"

// 2. 防御アクションの調整
const defenseResult = applyPresaleDefense(
  "STRONG_DOWN",  // 元のアクション
  presaleContext,
  0.20  // targetAcos
);
// defenseResult.finalAction === "DOWN" (STRONG_DOWN禁止)
// defenseResult.adjustedByPresale === true

// 3. 攻めアクションの調整
const offenseResult = applyPresaleOffense(
  "STRONG_UP",
  1.4,  // 元の倍率
  presaleContext
);
// offenseResult.finalAction === "MILD_UP" (STRONG_UP禁止)
// offenseResult.finalMultiplier === 1.1 (上限制限)
```

### 設定パラメータ

#### SaleContextConfig

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| salePhase | NORMAL | 現在のセールフェーズ |
| baselineDays | 30 | baseline期間の長さ（日数） |
| presaleWindowDays | 5 | プレセールとみなす日数 |
| baselineMinClicks | 20 | baseline最小クリック数 |
| presaleMinClicks | 10 | presale最小クリック数 |

#### PresaleThresholdConfig

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| minCvrRatioForBuying | 0.9 | BUYING判定のCVR比率下限 |
| maxAcosRatioForBuying | 1.2 | BUYING判定のACOS比率上限 |
| maxCvrRatioForHoldBack | 0.6 | HOLD_BACK判定のCVR比率上限 |
| minAcosRatioForHoldBack | 1.3 | HOLD_BACK判定のACOS比率下限 |

### BigQuery出力フィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| sale_phase | STRING | NORMAL / PRE_SALE / MAIN_SALE / COOL_DOWN |
| presale_type | STRING | NONE / BUYING / HOLD_BACK / MIXED |
| presale_cvr_ratio | FLOAT | CVR比率（presale/baseline） |
| presale_acos_ratio | FLOAT | ACOS比率（presale/baseline） |
| presale_adjustment_applied | BOOLEAN | プレセール調整が適用されたか |
| presale_adjustment_reason | STRING | 調整理由 |
| presale_original_action | STRING | 調整前アクション |
| presale_final_action | STRING | 調整後アクション |

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/presale/types.ts` | 型定義、デフォルトポリシー |
| `src/presale/diagnosis.ts` | diagnosePresaleType、createPresaleContext |
| `src/presale/defense-integration.ts` | 防御アクション調整 |
| `src/presale/offense-integration.ts` | 攻めアクション調整 |
| `tests/presale/*.test.ts` | テスト |

### EventModeとの関係

プレセール診断はEventModeと独立して機能する。両方が適用される場合の優先順位:

```
1. EventMode（BIG_SALE_PREP/BIG_SALE_DAY）の設定が優先
2. EventModeがNONEの場合、プレセール診断の結果を適用
```

例: BIG_SALE_DAYでHOLD_BACKの場合
- EventMode由来の「攻め」設定が優先
- ただしプレセール診断のCVR/ACOS情報はログに記録

---

## 31. T_opt推定とライフサイクル別TACOS（Analytics）

### 概要

ASIN単位で利益最大化TACOS（T_opt）を推計し、ライフサイクルステージに応じた
TACOS目標値（T_launch, T_grow, T_harvest）を算出する分析モジュール。

**コアコンセプト:**
- 過去の日次データからTACOS帯別の利益を分析し、T_opt（利益最大化TACOS）を推計
- ライフサイクルに応じた適切なTACOS目標値を動的に算出
- g（ポテンシャル粗利率）から広告費を除外し、二重カウントを防止
- targetNetMargin_mid_product = g - T_opt で商品別のネットマージン目標を定義

### ファイル

```
src/analytics/
  optimalTacos.ts    # T_opt推計、ライフサイクルTACOS目標値計算
  index.ts           # エクスポート
```

### 数学的定義

#### ポテンシャル粗利率 g（marginPotential）

```
g = (売価 - 原価 - 手数料 - 配送費等) / 売価

注意: 広告費は含めない（二重カウント防止）
```

ProductConfigでは `marginRateNormal` として管理。

#### 日次利益の計算

```
netProfit_d = sales_d × g - adCost_d
            = sales_d × (g - TACOS_d)
```

#### T_opt推計ロジック

1. 有効データのフィルタリング（revenue > 0, minTacos <= TACOS <= maxTacos）
2. 各日の利益を計算: Profit_d = revenue_d × (g - TACOS_d)
3. TACOSをビン分け（例: 3%刻み）して各ビンの合計利益を計算
4. 合計利益が最大のビンの平均TACOSをT_optとして採用

```typescript
interface OptimalTacosConfig {
  marginPotential: number;    // g（ポテンシャル粗利率）
  binWidth: number;           // ビン幅（例: 0.03 = 3%刻み）
  minTacos: number;           // 評価TACOS下限（例: 0.02）
  maxTacos: number;           // 評価TACOS上限（例: 0.60）
  minDaysPerBin: number;      // ビンあたり最低日数（例: 3）
  fallbackTopt: number;       // 推計失敗時のフォールバック
}

interface OptimalTacosResult {
  tOpt: number;               // 推計されたT_opt
  confidence: "HIGH" | "MEDIUM" | "LOW";
  usedFallback: boolean;
  validDaysUsed: number;
  validBinCount: number;
  optimalBinProfit: number | null;
  optimalBinTacos: number | null;
  calculationNote: string;
}
```

#### 信頼度判定

| 信頼度 | 条件 |
|-------|------|
| HIGH | validDays >= 90 かつ validBins >= 5 |
| MEDIUM | validDays >= 30 かつ validBins >= 3 |
| LOW | 上記以外 or フォールバック使用 |

### ライフサイクル別TACOS目標値

```typescript
interface LifecycleTacosConfig {
  alphaLaunch: number;   // ローンチ攻めオフセット（例: 0.30 = +30%）
  alphaHarvest: number;  // ハーベスト絞りオフセット（例: 0.25 = -25%）
  softFactor: number;    // LAUNCH_SOFTの緩和係数（例: 0.5）
}
```

#### 計算式

| ステージ | TACOS目標 | 計算式 |
|---------|----------|--------|
| LAUNCH_HARD | T_launch | min(g, T_opt × (1 + α_L)) |
| LAUNCH_SOFT | T_soft | min(g, T_opt × (1 + α_L × softFactor)) |
| GROW | T_grow | T_opt |
| HARVEST | T_harvest | max(0, T_opt × (1 - α_H)) |

#### 数値例

```
g = 0.55 (55%の粗利率)
T_opt = 0.15 (15%が利益最大化TACOS)
α_L = 0.30, α_H = 0.25, softFactor = 0.5

T_launch = min(0.55, 0.15 × 1.30) = min(0.55, 0.195) = 19.5%
T_soft   = min(0.55, 0.15 × 1.15) = min(0.55, 0.1725) = 17.25%
T_grow   = 0.15 = 15%
T_harvest = max(0, 0.15 × 0.75) = 11.25%
```

### ターゲットネットマージン

```
targetNetMargin_mid_product = g - T_opt

例: g=0.55, T_opt=0.15 の場合
targetNetMargin_mid_product = 0.55 - 0.15 = 0.40 (40%)
```

これはGROWステージでの商品別目標純利益率を表す。

### ローンチ投資計算

#### LaunchInvest_total

ローンチ期間中のT_optを超えた追加投資額:

```
LaunchInvest_total = Σ(sales_d × (TACOS_d - T_opt))  [d ∈ ローンチ期間]
                   = 合計広告費 - 合計売上 × T_opt
```

```typescript
interface LaunchInvestmentMetrics {
  launchInvestTotal: number;       // ローンチ追加投資額
  launchSalesTotal: number;        // ローンチ期間売上
  launchTacosAverage: number;      // ローンチ期間平均TACOS
  estimatedRecoverySales: number | null;  // 投資回収必要売上
  estimatedRecoveryProfit: number | null; // 回収利益
  calculationNote: string;
}
```

#### 投資回収推定

```
netMargin = g - T_opt
投資回収必要売上 = LaunchInvest_total / netMargin
```

### 使用例

```typescript
import {
  estimateTopt,
  calculateLifecycleTacosTargets,
  calculateLaunchInvestment,
  optimizeAsinTacos,
} from "./analytics";

// 1. 日次データからT_optを推計
const tOptResult = estimateTopt(dailyData, {
  marginPotential: 0.55,
  binWidth: 0.03,
  minTacos: 0.02,
  maxTacos: 0.60,
  minDaysPerBin: 3,
  fallbackTopt: 0.15,
});
// tOptResult.tOpt === 0.15
// tOptResult.confidence === "HIGH"

// 2. ライフサイクル別TACOS目標値を計算
const targets = calculateLifecycleTacosTargets(
  tOptResult.tOpt,  // 0.15
  0.55,             // marginPotential
  "GROW",           // currentStage
  { alphaLaunch: 0.30, alphaHarvest: 0.25, softFactor: 0.5 }
);
// targets.tLaunch === 0.195
// targets.tGrow === 0.15
// targets.tHarvest === 0.1125
// targets.currentTarget === 0.15

// 3. ローンチ投資を計算
const launchMetrics = calculateLaunchInvestment(
  launchPeriodData,
  tOptResult.tOpt,
  0.55
);
// launchMetrics.launchInvestTotal === 3000 (円)
// launchMetrics.estimatedRecoverySales === 7500 (円)

// 4. 統合最適化
const optimization = optimizeAsinTacos(
  "B00TEST123",
  dailyData,
  "GROW",
  0.55,
  launchPeriodData
);
// optimization.targetNetMarginMidProduct === 0.40
```

### tacosHealth.tsとの関係

| モジュール | 役割 | 主な出力 |
|-----------|------|---------|
| tacosHealth.ts | TACOS健全性評価、ゾーン判定 | tacosHealthScore, TacosZone |
| optimalTacos.ts | T_opt推計、ライフサイクルTACOS目標 | T_opt, T_launch/grow/harvest |

両モジュールは相互補完的:
- tacosHealth.ts: 現在のTACOSが健全かを評価
- optimalTacos.ts: 目標とすべきTACOSを推計

### BigQuery出力フィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| t_opt | FLOAT | 推計された利益最大化TACOS |
| t_opt_confidence | STRING | 推計の信頼度（HIGH/MEDIUM/LOW） |
| t_opt_used_fallback | BOOLEAN | フォールバック値を使用したか |
| t_launch | FLOAT | ローンチ期TACOS目標 |
| t_grow | FLOAT | グロー期TACOS目標 |
| t_harvest | FLOAT | ハーベスト期TACOS目標 |
| lifecycle_tacos_target | FLOAT | 現在ステージのTACOS目標 |
| target_net_margin_mid | FLOAT | g - T_opt |
| launch_invest_total | FLOAT | ローンチ追加投資額 |

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/analytics/optimalTacos.ts` | T_opt推計、ライフサイクルTACOS計算 |
| `src/analytics/index.ts` | エクスポート |
| `tests/analytics/optimalTacos.test.ts` | テスト |

---

## 32. lossBudget評価（ASIN投資健全性）

### 概要

ASIN単位で投資の健全性を評価し、ライフサイクルステージ × 投資状態に基づいて
キーワードレベルの入札アクションを制御するモジュール。

### 主な機能

- **profitGap計算**: 目標利益との乖離を測定
- **lossBudget算出**: ライフサイクル別の許容損失枠を計算
- **InvestmentState判定**: SAFE/WATCH/LIMIT/BREACHの4段階で投資健全性を分類
- **ActionConstraints生成**: ライフサイクル × 投資状態に応じた入札アクション制約

### ファイル構成

```
src/analytics/
  lossBudgetEvaluator.ts   # 投資健全性評価、アクション制約
  index.ts                 # エクスポート（更新済み）

tests/analytics/
  lossBudgetEvaluator.test.ts  # テスト
```

### コア概念

#### profitGap（利益ギャップ）

```
profitGap = targetNetProfit - actualNetProfit

targetNetProfit = S × (g - T_opt)    // 目標利益
actualNetProfit = S × g - A          // 実際の利益

S = 評価期間内の売上
g = marginPotential（粗利ポテンシャル）
T_opt = 利益最大化TACOS
A = 評価期間内の広告費
```

#### lossBudget（許容損失枠）

```
lossBudget_stage = targetNetProfit × lossBudgetMultiple_stage

// ライフサイクル別倍率（デフォルト）
LAUNCH_HARD:  2.5  // 積極投資期、大きな許容枠
LAUNCH_SOFT:  2.0  // ローンチ後期、やや縮小
GROW:         1.5  // 成長期、バランス重視
HARVEST:      0.8  // 収穫期、利益確保重視
```

#### InvestmentState（投資状態）

```
ratioStage = profitGap / lossBudget_stage

| InvestmentState | 条件 | 意味 |
|-----------------|------|------|
| SAFE | ratioStage < 0.5 | 健全、余裕あり |
| WATCH | 0.5 ≤ ratioStage < 0.8 | 注意、監視強化 |
| LIMIT | 0.8 ≤ ratioStage < 1.0 | 警戒、投資抑制 |
| BREACH | ratioStage ≥ 1.0 | 超過、投資停止検討 |
```

### ActionConstraints（アクション制約）

ライフサイクルステージ × InvestmentStateの組み合わせで、キーワードレベルの
入札アクションを制御。

#### LAUNCH期（LAUNCH_HARD/LAUNCH_SOFT）

**重要**: LAUNCH期は**STOP/NEGを封印**し、ASIN単位のlossBudgetで全体制御。

| InvestmentState | STOP | NEG | STRONG_DOWN | DOWN | UP | STRONG_UP |
|-----------------|------|-----|-------------|------|-----|-----------|
| SAFE | × | × | △ | ○ | ○ | ○ |
| WATCH | × | × | △ | ○ | △ | △ |
| LIMIT | × | × | △ | ○ | △ | × |
| BREACH | × | × | △ | ○ | × | × |

```typescript
// LAUNCH期のActionConstraints例（SAFE）
{
  allowStop: false,       // STOP封印
  allowNeg: false,        // NEG封印
  allowStrongDown: false, // 慎重
  allowDown: true,
  allowUp: true,
  allowStrongUp: true,
  maxUpMultiplier: 1.3,
  maxDownPercent: 10,
}
```

#### GROW期

| InvestmentState | STOP | NEG | STRONG_DOWN | DOWN | UP | STRONG_UP |
|-----------------|------|-----|-------------|------|-----|-----------|
| SAFE | ○ | ○ | ○ | ○ | ○ | ○ |
| WATCH | ○ | ○ | ○ | ○ | △ | △ |
| LIMIT | ○ | ○ | ○ | ○ | △ | × |
| BREACH | ○ | ○ | ○ | ○ | × | × |

#### HARVEST期

| InvestmentState | STOP | NEG | STRONG_DOWN | DOWN | UP | STRONG_UP |
|-----------------|------|-----|-------------|------|-----|-----------|
| SAFE | ○ | ○ | ○ | ○ | △ | × |
| WATCH | ○ | ○ | ○ | ○ | △ | × |
| LIMIT | ○ | ○ | ○ | ○ | × | × |
| BREACH | ○ | ○ | ○++ | ○++ | × | × |

凡例: ○=許可、△=制限付き許可、×=禁止、++=積極的に実行

### 型定義

```typescript
export enum InvestmentState {
  SAFE = "SAFE",
  WATCH = "WATCH",
  LIMIT = "LIMIT",
  BREACH = "BREACH",
}

export interface AsinPeriodPerformance {
  asin: string;
  lifecycleStage: LifecycleState;
  periodStartDate: string;
  periodEndDate: string;
  totalSales: number;
  totalAdSpend: number;
  totalConversions: number;
}

export interface AsinLossBudgetMetrics {
  asin: string;
  lifecycleStage: LifecycleState;
  targetNetProfit: number;
  actualNetProfit: number;
  profitGap: number;
  lossBudget: number;
  ratioStage: number;
  investmentState: InvestmentState;
  periodStartDate: string;
  periodEndDate: string;
}

export interface ActionConstraints {
  allowStop: boolean;
  allowNeg: boolean;
  allowStrongDown: boolean;
  allowDown: boolean;
  allowUp: boolean;
  allowStrongUp: boolean;
  maxUpMultiplier: number;
  maxDownPercent: number;
}
```

### 使用例

```typescript
import {
  evaluateAsinLossBudget,
  evaluateAllAsins,
  getActionConstraints,
  InvestmentState,
  DEFAULT_LOSS_BUDGET_CONFIG,
} from "./analytics";

// 1. 単一ASIN評価
const metrics = evaluateAsinLossBudget(
  {
    asin: "B00TEST123",
    lifecycleStage: "GROW",
    periodStartDate: "2025-01-01",
    periodEndDate: "2025-01-30",
    totalSales: 100000,
    totalAdSpend: 20000,
    totalConversions: 50,
  },
  0.55,  // g（粗利ポテンシャル）
  0.15,  // T_opt
  DEFAULT_LOSS_BUDGET_CONFIG
);
// metrics.investmentState === "WATCH"
// metrics.ratioStage === 0.606...

// 2. 複数ASIN一括評価
const allMetrics = evaluateAllAsins(
  asinPerformances,
  marginPotentialMap,
  tOptMap,
  DEFAULT_LOSS_BUDGET_CONFIG
);

// 3. アクション制約取得
const constraints = getActionConstraints("GROW", InvestmentState.WATCH);
// constraints.allowStrongUp === false
// constraints.maxUpMultiplier === 1.15

// 4. bidEngineとの統合例
if (constraints.allowUp && bidChange > 0) {
  const cappedMultiplier = Math.min(
    1 + bidChange,
    constraints.maxUpMultiplier
  );
  newBid = currentBid * cappedMultiplier;
}
```

### ユーティリティ関数

```typescript
// 警告状態かチェック
isWarningState(InvestmentState.WATCH)  // true

// クリティカル状態かチェック
isCriticalState(InvestmentState.LIMIT)  // true

// ライフサイクル移行検討が必要か
shouldConsiderLifecycleTransition("LAUNCH_HARD", InvestmentState.BREACH)  // true

// アラートサマリー生成
generateAlertSummary(metrics)
// { level: "warning", message: "ASIN B00TEST123: LIMIT状態..." }
```

### BigQuery出力フィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| asin | STRING | ASIN |
| lifecycle_stage | STRING | ライフサイクルステージ |
| target_net_profit | FLOAT | 目標利益 |
| actual_net_profit | FLOAT | 実際の利益 |
| profit_gap | FLOAT | 利益ギャップ |
| loss_budget | FLOAT | 許容損失枠 |
| ratio_stage | FLOAT | lossBudget消費率 |
| investment_state | STRING | SAFE/WATCH/LIMIT/BREACH |

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/analytics/lossBudgetEvaluator.ts` | 投資健全性評価、アクション制約 |
| `src/analytics/lossBudgetRepository.ts` | BigQueryからのデータ取得 |
| `src/analytics/index.ts` | エクスポート |
| `tests/analytics/lossBudgetEvaluator.test.ts` | テスト |
| `tests/analytics/lossBudgetSummary.test.ts` | LossBudgetSummaryテスト |

---

### 32.1 LossBudgetState（簡易3状態）

InvestmentState（4状態）をシンプルな3状態にマッピングした型。roleGuardrailsとの統合に使用。

```typescript
export type LossBudgetState = "SAFE" | "WARNING" | "CRITICAL";

// マッピング
// SAFE → SAFE
// WATCH, LIMIT → WARNING
// BREACH → CRITICAL
```

### 32.2 LossBudgetSummary

ローリング期間とローンチ期間全体の両方の消費率を含むサマリー構造体。

```typescript
export interface LossBudgetSummary {
  asin: string;
  lossBudgetConsumptionRolling: number;  // 期間w（30日）の損失消費率
  lossBudgetConsumptionLaunch: number;   // ローンチ期間全体の損失消費率
  launchInvestUsageRatio: number;        // ローンチ追加投資枠の使用率
  state: LossBudgetState;                // 統合されたLossBudgetState
  maxConsumption: number;                // 最大消費率
  periodStart: string;
  periodEnd: string;
}
```

### 32.3 LossBudgetState判定ロジック

```typescript
function resolveLossBudgetState(
  rollingConsumption: number,
  launchConsumption: number,
  launchInvestUsage: number,
  config: LossBudgetStateConfig
): LossBudgetState {
  const maxConsumption = Math.max(rollingConsumption, launchConsumption, launchInvestUsage);

  // CRITICAL判定
  if (maxConsumption >= config.criticalThreshold ||
      launchInvestUsage >= config.launchInvestCriticalThreshold) {
    return "CRITICAL";
  }

  // WARNING判定
  if (maxConsumption >= config.warningThreshold ||
      launchInvestUsage >= config.launchInvestWarningThreshold) {
    return "WARNING";
  }

  return "SAFE";
}

// デフォルト設定
const DEFAULT_LOSS_BUDGET_STATE_CONFIG = {
  warningThreshold: 0.5,           // 50%以上でWARNING
  criticalThreshold: 0.9,          // 90%以上でCRITICAL
  launchInvestWarningThreshold: 0.5,
  launchInvestCriticalThreshold: 1.0,  // 100%以上でCRITICAL
};
```

### 32.4 BigQuery集計ビュー

#### asin_rolling_30d_summary

ASINごとに直近30日間の売上・広告費・利益指標を集計し、lossBudgetConsumption_wを計算。

```sql
-- 主要カラム
asin, period_start, period_end, lifecycle_stage_w,
g, t_opt, loss_budget_multiple_stage,
sales_w, ad_cost_w, impressions_w, clicks_w, orders_w,
target_net_margin_mid,     -- g - T_opt
net_profit_real_w,         -- sales_w × g - adCost_w
net_profit_target_w,       -- sales_w × (g - T_opt)
loss_gap_w,                -- GREATEST(target - real, 0)
loss_budget_allowed_w,     -- netProfit_target_w × lossBudgetMultiple_stage
loss_budget_consumption_w, -- lossGap_w / lossBudgetAllowed_w
tacos_w, acos_w
```

#### asin_launch_invest_summary

ローンチ期間全体のLaunchInvest指標を計算。

```sql
-- 主要カラム
asin, launch_start_date, launch_end_date, days_in_launch,
g, t_opt, t_launch,
sales_launch, ad_cost_launch,
ad_cost_opt_launch,            -- sales_launch × T_opt
extra_ad_cost_launch_real,     -- GREATEST(adCost_launch - adCost_opt_launch, 0)
launch_invest_total_design,    -- sales_launch × (T_launch - T_opt)
launch_invest_usage_ratio,     -- extraAdCost_launch_real / LaunchInvest_total_design
loss_budget_consumption_launch
```

### 32.5 LaunchInvest計算式

```
adCost_opt_launch = sales_launch × T_opt
extraAdCost_launch_real = GREATEST(adCost_launch - adCost_opt_launch, 0)
LaunchInvest_total_design = sales_launch × (T_launch - T_opt)
LaunchInvest_usage_ratio = extraAdCost_launch_real / LaunchInvest_total_design
```

---

## 33. SEOローンチ評価（Launch Exit Decision）

### 概要

LAUNCH期のASINについて、コアSEOキーワードの進捗状況とlossBudgetを監視し、
「いつLAUNCHを終えてGROWへ移行するか」を数値的に判定するモジュール。

**設計思想**:
- コアSEOキーワード集合について「上位達成」か「これ以上は無理」のどちらかになるまでSEOを押し上げる
- その間の赤字はlossBudgetの範囲内であれば許容
- lossBudgetを超えそうな場合は、SEO未完でも緊急撤退

### 主な機能

- **KeywordCoreRole**: キーワードのSEO重要度分類（CORE/SUPPORT/EXPERIMENT）
- **SeoLaunchStatus**: キーワード単位のローンチ進捗状態（ACTIVE/ACHIEVED/GAVE_UP）
- **AsinSeoLaunchProgress**: ASIN単位のコアSEO完了率計算
- **LaunchExitDecision**: 通常終了/緊急終了の判定

### ファイル構成

```
src/lifecycle/
  seo-launch-evaluator.ts   # SEOローンチ評価、終了判定
  transition-logic.ts       # ライフサイクル遷移との統合
  index.ts                  # エクスポート

tests/lifecycle/
  seo-launch-evaluator.test.ts  # テスト
```

### コア概念

#### KeywordCoreRole（キーワード重要度）

```typescript
export enum KeywordCoreRole {
  CORE = "CORE",           // 本気で上位を取りに行くコアSEOキーワード
  SUPPORT = "SUPPORT",     // 周辺や補助キーワード
  EXPERIMENT = "EXPERIMENT", // 実験枠や評価前
}

// コアキーワードのサブタイプ
export enum CoreKeywordType {
  BIG = "BIG",       // ビッグキーワード（1-3語）
  MIDDLE = "MIDDLE", // ミドルレンジ（3-7語）
  BRAND = "BRAND",   // ブランド名・指名系
}
```

**CORE選定の目安**:
- ビッグキーワード: 1-3語
- ミドルレンジ: 3-7語
- ブランド・指名系: 1-3語
- ASIN合計: 5-12語程度

#### SeoLaunchStatus（ローンチ進捗状態）

```typescript
export enum SeoLaunchStatus {
  ACTIVE = "ACTIVE",     // まだSEOを押し上げ中
  ACHIEVED = "ACHIEVED", // 目標順位帯まで到達
  GAVE_UP = "GAVE_UP",   // これ以上は現実的ではないと判断
}
```

**ACHIEVED判定条件**:
- coreRoleがCORE
- currentRank（直近7日平均）がtargetRankMax以下
- impressionsTotalがminImpressionsForRank以上
- clicksTotalがminClicksForRank以上

**GAVE_UP判定条件**:

以下の2つのパターンでGAVE_UPと判定される:

**パターン1: 順位が悪い場合**
- coreRoleがCORE
- clicksTotalがminClicksForGiveUp以上
- costTotalがtargetCPA × minCostMultiplierForGiveUp以上
- bestRankWindowがmaxBestRankForGiveUpより悪い（例: 20位以下）
- daysWithRankDataがminDaysActive以上

**パターン2: パフォーマンスが悪い場合**
- coreRoleがCORE
- clicksTotalがminClicksForGiveUp以上
- costTotalがtargetCPA × minCostMultiplierForGiveUp以上
- CVR（注文数/クリック数）がmaxCvrForGiveUp以下
- ACOS（広告費/売上）がmaxAcosForGiveUp以上

※ACOS定義: 広告費 ÷ 売上（標準的なAmazon広告のACOS定義）

#### volumeBucket ベースの動的 GAVE_UP 閾値

CORE_SEO キーワードの GAVE_UP 判定において、キーワードごとの検索ボリュームを考慮した動的閾値システムを採用しています。

**1. volumeRatio の計算と volumeBucket 分類**

各キーワードの検索ボリュームを、同一 ASIN の CORE キーワード群の中央値と比較します:

```typescript
volumeRatio_k = searchVolume_k / medianVolume_core
```

この比率に基づき、3段階の volumeBucket に分類:

| volumeBucket | 条件 | 意味 |
|-------------|------|------|
| HIGH_VOLUME | volumeRatio >= 2.0 | 中央値の2倍以上のビッグキーワード |
| MID_VOLUME | 0.5 <= volumeRatio < 2.0 | 標準的なボリュームのキーワード |
| LOW_VOLUME | volumeRatio < 0.5 | 中央値の半分未満のニッチキーワード |

**2. tier × volumeBucket による動的閾値計算**

GAVE_UP 判定の `minDays` と `minClicks` は、キーワードの tier（BIG/MIDDLE）と volumeBucket の組み合わせで動的に決定されます。

**ベース閾値（tier別）:**

| tier | baseDays | baseClicks |
|------|----------|------------|
| BIG | 60 | 150 |
| MIDDLE | 45 | 100 |

※ BRAND は MIDDLE として扱います

**volumeBucket 倍率:**

| volumeBucket | daysMultiplier | clicksMultiplier |
|-------------|----------------|------------------|
| HIGH_VOLUME | 1.3 | 1.3 |
| MID_VOLUME | 1.0 | 1.0 |
| LOW_VOLUME | 0.7 | 0.7 |

**最終閾値の計算:**

```typescript
minDays = Math.round(baseDays[tier] × daysMultiplier[bucket])
minClicks = Math.round(baseClicks[tier] × clicksMultiplier[bucket])
```

**計算例:**

| tier | volumeBucket | minDays | minClicks |
|------|-------------|---------|-----------|
| BIG | HIGH_VOLUME | 78 (60×1.3) | 195 (150×1.3) |
| BIG | MID_VOLUME | 60 (60×1.0) | 150 (150×1.0) |
| BIG | LOW_VOLUME | 42 (60×0.7) | 105 (150×0.7) |
| MIDDLE | HIGH_VOLUME | 59 (45×1.3) | 130 (100×1.3) |
| MIDDLE | MID_VOLUME | 45 (45×1.0) | 100 (100×1.0) |
| MIDDLE | LOW_VOLUME | 32 (45×0.7) | 70 (100×0.7) |

**3. giveUpRankThreshold の tier 固定 + 軽微調整**

順位閾値は tier ごとに基本値を固定し、volumeBucket による調整は ±5 位に抑えています:

| tier | 基本値 | HIGH_VOLUME | MID_VOLUME | LOW_VOLUME |
|------|--------|-------------|------------|------------|
| BIG | 45 | 50 (+5) | 45 (±0) | 40 (-5) |
| MIDDLE | 30 | 35 (+5) | 30 (±0) | 25 (-5) |

**設計意図:**

順位閾値を tier 固定に近づける理由:
- 検索ボリュームが大きくても、最終的に達成すべき順位帯は tier で決まる
- HIGH_VOLUME キーワードは競争が激しいため、やや緩い閾値を許容
- LOW_VOLUME キーワードはニッチなので、より厳しい順位を求める

**4. 設計思想**

この動的閾値システムの設計意図:

1. **公平な評価機会の提供**: 検索ボリュームの大きいキーワードは十分なデータ蓄積に時間がかかるため、より長い猶予期間を与える

2. **リソース効率の最適化**: ニッチキーワード（LOW_VOLUME）は早期に判断可能なため、無駄な投資を避けて素早く諦め判定を行う

3. **tier 特性の尊重**: BIG キーワードは本質的に難易度が高いため、MIDDLE より長い観察期間とクリック数を必要とする

4. **順位目標の一貫性**: 検索ボリュームに関わらず、tier が同じなら目指すべき順位帯は大きく変わらない（±5位の微調整のみ）

#### AsinSeoLaunchProgress（ASIN進捗）

```typescript
export interface AsinSeoLaunchProgress {
  asin: string;
  totalCoreKeywords: number;   // COREキーワード総数
  achievedCount: number;       // ACHIEVED数
  gaveUpCount: number;         // GAVE_UP数
  activeCount: number;         // ACTIVE数
  completionRatio: number;     // (achieved + gaveUp) / total
  successRatio: number;        // achieved / total
}
```

### ローンチ終了条件の三軸

> **参照**: 各指標の英語名と日本語名の対応は「[付録: ライフサイクル関連指標一覧](#付録-ライフサイクル関連指標一覧英語名--日本語名)」を参照してください。

#### A. SEO条件（必須）

```
completionRatio ≥ minCoreCompletionRatio (例: 0.7 = 70%)
```

コアSEOキーワード集合で「達成」か「諦め」のどちらかに到達したかを見る。

#### B. 時間/データ条件（早期終了防止）

以下のいずれか1つ以上:
```
daysSinceLaunch ≥ minLaunchDays (例: 45日)
OR
asinClicksTotal ≥ minAsinClicksTotal (例: 2500)
OR
asinOrdersTotal ≥ minAsinOrdersTotal (例: 80)
```

十分な試行をしたかを確認。

#### C. lossBudget条件（緊急ブレーキ）

```
investmentState = BREACH
OR
ratioStage > emergencyLossRatioThreshold (例: 1.2)
```

SEO未完でも破産を防ぐための緊急終了。

### LaunchExitDecision

```typescript
export interface LaunchExitDecision {
  asin: string;
  shouldExitLaunch: boolean;        // LAUNCHを抜けるか
  isEmergencyExit: boolean;         // 緊急終了か
  reasonCodes: LaunchExitReasonCode[];
  reasonMessage: string;
  recommendedNextStage: LifecycleStage;
  seoProgress: AsinSeoLaunchProgress;
  lossBudgetMetrics?: AsinLossBudgetMetrics;
}

export type LaunchExitReasonCode =
  | "CORE_COMPLETION"        // コアSEO完了率達成
  | "DAYS_OR_DATA"           // 時間/データ条件達成
  | "LOSS_BUDGET_EMERGENCY"  // lossBudget緊急終了
  | "NOT_READY";             // 終了条件未達
```

### 判定フロー

```
┌─────────────────────────────────────┐
│ LAUNCH期のASIN                      │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ 1. lossBudget緊急判定               │
│    BREACH or ratioStage > 1.2?     │
└─────────────────────────────────────┘
              │
       Yes    │    No
    ┌─────────┴─────────┐
    ▼                   ▼
┌────────────┐   ┌─────────────────────────────────────┐
│ 緊急終了   │   │ 2. 通常終了判定                     │
│ → GROW    │   │    SEO完了率 ≥ 70%                  │
└────────────┘   │    AND 試行条件クリア               │
                └─────────────────────────────────────┘
                            │
                     Yes    │    No
                  ┌─────────┴─────────┐
                  ▼                   ▼
           ┌────────────┐     ┌────────────┐
           │ 通常終了   │     │ LAUNCH継続 │
           │ → GROW    │     └────────────┘
           └────────────┘
```

### LAUNCH期の守りルール（維持）

SEOローンチ評価を導入しても、以下のルールは維持:

| アクション | LAUNCH_HARD | LAUNCH_SOFT |
|-----------|-------------|-------------|
| STOP | × 封印 | × 封印 |
| NEG | × 封印 | × 封印 |
| STRONG_DOWN | × 原則禁止 | × 原則禁止 |
| DOWN | △ 小幅 | △ 小幅 |

**ローンチの思想**: 芽を殺さない。終了タイミングは「SEO完了率 + 試行量」と「lossBudget」の二段構えで判定。

### 使用例

```typescript
import {
  evaluateKeywordSeoStatus,
  summarizeAsinSeoLaunchProgress,
  decideLaunchExit,
  DEFAULT_SEO_LAUNCH_CONFIG,
  DEFAULT_LAUNCH_EXIT_THRESHOLDS,
} from "./lifecycle";
import { evaluateAsinLossBudget } from "./analytics";

// 1. キーワード単位のSEOステータス評価
const keywordStatus = evaluateKeywordSeoStatus(
  keywordConfig,
  rankSummary,
  DEFAULT_SEO_LAUNCH_CONFIG,
  targetCpa
);
// keywordStatus.status === "ACHIEVED" | "GAVE_UP" | "ACTIVE"

// 2. ASIN進捗集計
const progress = summarizeAsinSeoLaunchProgress(
  asin,
  keywordConfigs,
  keywordStatusResults
);
// progress.completionRatio === 0.7

// 3. lossBudget評価
const lossBudget = evaluateAsinLossBudget(perf, g, tOpt);

// 4. ローンチ終了判定
const decision = decideLaunchExit(
  asin,
  "LAUNCH_HARD",
  daysSinceLaunch,
  asinClicksTotal,
  asinOrdersTotal,
  progress,
  lossBudget,
  DEFAULT_LAUNCH_EXIT_THRESHOLDS
);

if (decision.shouldExitLaunch) {
  if (decision.isEmergencyExit) {
    // Slack警告通知
    notifyEmergencyExit(decision);
  }
  // ライフサイクルをGROWへ移行
  transitionToGrow(asin);
}
```

### ASIN固有スケーリングロジック

ローンチ終了判定の閾値は、ASINの販売規模に応じて動的にスケーリングされます。
これにより、高日販ASINには厳しめの試行条件、低日販ASINには緩めの条件が適用されます。

#### volumeScale計算

```typescript
volumeRaw = avgDailySales30d ÷ refDailySales
volumeScale_asin = clamp(volumeRaw, minVolumeScale, maxVolumeScale)
```

- `refDailySales`: 基準日販数（デフォルト: 20）
- `minVolumeScale`: スケールの下限（デフォルト: 0.5）
- `maxVolumeScale`: スケールの上限（デフォルト: 2.0）

#### スケーリング対象と非対象

| パラメータ | スケーリング | 計算式 |
|-----------|-------------|--------|
| minAsinClicksTotal | ○ | base × volumeScale |
| minAsinOrdersTotal | ○ | base × volumeScale |
| minLaunchDays | × | 固定（時間は販売量に依存しない） |
| minCoreCompletionRatio | × | 固定（SEO完了率は販売量に依存しない） |
| emergencyLossRatioThreshold | × | 固定（緊急閾値は販売量に依存しない） |

#### 計算例

| 日販数 | volumeScale | クリック閾値 | 注文閾値 |
|--------|-------------|-------------|---------|
| 5 | 0.5 (下限) | 1,250 | 40 |
| 10 | 0.5 (下限) | 1,250 | 40 |
| 20 | 1.0 | 2,500 | 80 |
| 30 | 1.5 | 3,750 | 120 |
| 50+ | 2.0 (上限) | 5,000 | 160 |

#### インターフェース

```typescript
// プロファイルレベルのベース閾値
export interface LaunchExitBaseThresholds {
  baseMinLaunchDays: number;           // 45
  baseMinAsinClicksTotal: number;      // 2500
  baseMinAsinOrdersTotal: number;      // 80
  minCoreCompletionRatio: number;      // 0.7
  emergencyLossRatioThreshold: number; // 1.2
  refDailySales: number;               // 20
  minVolumeScale: number;              // 0.5
  maxVolumeScale: number;              // 2.0
}

// ASIN固有のスケーリング済み閾値
export interface LaunchExitThresholdsComputed {
  asin: string;
  volumeScale: number;
  avgDailySales30d: number;
  minLaunchDays: number;
  minAsinClicksTotal: number;
  minAsinOrdersTotal: number;
  minCoreCompletionRatio: number;
  emergencyLossRatioThreshold: number;
}
```

#### 使用例（スケーリング版）

```typescript
import {
  computeLaunchExitThresholdsForAsin,
  decideLaunchExitWithScaling,
  DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
} from "./lifecycle";

// 1. ASIN固有の閾値を計算
const computedThresholds = computeLaunchExitThresholdsForAsin(
  asin,
  DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
  avgDailySales30d  // 直近30日の平均日販数
);
// computedThresholds.volumeScale === 1.5 (日販30の場合)
// computedThresholds.minAsinClicksTotal === 3750

// 2. スケーリング済み閾値でローンチ終了判定
const decision = decideLaunchExitWithScaling(
  asin,
  "LAUNCH_HARD",
  daysSinceLaunch,
  asinClicksTotal,
  asinOrdersTotal,
  progress,
  lossBudget,
  computedThresholds
);

// 結果にvolumeScaleと使用した閾値が含まれる
console.log(decision.volumeScale);     // 1.5
console.log(decision.thresholdsUsed);  // { minAsinClicksTotal: 3750, ... }
```

### 設定パラメータ

```typescript
// SEOローンチ評価設定
export const DEFAULT_SEO_LAUNCH_CONFIG: SeoLaunchConfig = {
  minImpressionsForRank: 500,
  minClicksForRank: 30,
  recentDaysForCurrentRank: 7,
  giveUp: {
    minClicksForGiveUp: 200,
    minCostMultiplierForGiveUp: 10,  // targetCPA × 10
    maxBestRankForGiveUp: 20,
    minDaysActive: 30,
    maxCvrForGiveUp: 0.02,   // 2%
    maxAcosForGiveUp: 1.0,   // 100%
  },
};

// ローンチ終了ベース閾値（プロファイルレベル）
export const DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS: LaunchExitBaseThresholds = {
  baseMinLaunchDays: 45,
  baseMinAsinClicksTotal: 2500,
  baseMinAsinOrdersTotal: 80,
  minCoreCompletionRatio: 0.7,
  emergencyLossRatioThreshold: 1.2,
  refDailySales: 20,
  minVolumeScale: 0.5,
  maxVolumeScale: 2.0,
};

// コアキーワード上限
export const DEFAULT_CORE_KEYWORD_LIMITS: CoreKeywordLimits = {
  maxCoreBigPerAsin: 3,
  maxCoreMiddlePerAsin: 7,
  maxCoreBrandPerAsin: 3,
  maxCoreTotalPerAsin: 12,
};
```

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/lifecycle/seo-launch-evaluator.ts` | SEOローンチ評価、終了判定 |
| `src/lifecycle/transition-logic.ts` | ライフサイクル遷移統合 |
| `src/lifecycle/index.ts` | エクスポート |
| `tests/lifecycle/seo-launch-evaluator.test.ts` | テスト |
| `tests/lifecycle/threeAxisTransition.test.ts` | 三軸遷移テスト |

### 33.1 三軸ライフサイクル遷移判定（Three-Axis Transition）

LAUNCH期からGROW期への遷移を3つの軸で総合判定する拡張モジュール。

#### 三軸の定義

| 軸 | 名称 | 指標 | 説明 |
|----|------|------|------|
| A軸 | SEO完了 | seoCompletionRatio | コアSEOキーワードの完了率 |
| B軸 | 試行量 | minDaysSatisfied, sampleEnough | 最低日数とサンプル量 |
| C軸 | 損失予算 | lossBudgetSummary | ローリング・ローンチ・LaunchInvest消費率 |

#### 遷移判定ロジック

```typescript
function evaluateThreeAxisTransition(
  input: ThreeAxisTransitionInput,
  config: ThreeAxisTransitionConfig
): ThreeAxisTransitionResult {
  // 1. 非LAUNCHステージは即座にCONTINUE
  if (!input.currentStage.startsWith("LAUNCH")) {
    return { shouldTransition: false, reasonCode: "CONTINUE_LAUNCH" };
  }

  // 2. C軸: 緊急停止判定（CRITICAL状態）
  if (lossBudgetState === "CRITICAL") {
    return {
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "LOSS_BUDGET_EMERGENCY",
      isEmergencyStop: true,
    };
  }

  // 3. A+B軸: 通常完了判定
  if (seoConditionMet && trialConditionMet) {
    return {
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "NORMAL_COMPLETION",
      isEmergencyStop: false,
    };
  }

  // 4. C軸WARNING + A軸部分達成: 早期終了
  if (warningZone && seoPartiallyMet) {
    return {
      shouldTransition: true,
      nextStage: "GROW",
      reasonCode: "LOSS_BUDGET_EARLY_EXIT",
      isEmergencyStop: false,
    };
  }

  // 5. その他: LAUNCH継続
  return { shouldTransition: false, reasonCode: "CONTINUE_LAUNCH" };
}
```

#### 判定フロー図

```
┌──────────────────────────────────────────┐
│ LAUNCH期のASIN                           │
└──────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────┐
│ C軸: lossBudgetState判定                  │
│ - lossBudgetConsumptionRolling           │
│ - lossBudgetConsumptionLaunch            │
│ - launchInvestUsageRatio                 │
└──────────────────────────────────────────┘
              │
        CRITICAL?
       ┌──────┴──────┐
       ▼             ▼
   ┌────────┐  ┌──────────────────────────┐
   │緊急終了│  │ A軸: SEO完了率判定        │
   │→ GROW │  │ seoCompletionRatio >= 0.7│
   └────────┘  └──────────────────────────┘
                     │
              SEO完了 AND B軸完了?
              ┌──────┴──────┐
              ▼             ▼
         ┌────────┐  ┌─────────────────┐
         │通常終了│  │WARNING + SEO部分?│
         │→ GROW │  └─────────────────┘
         └────────┘         │
                    ┌───────┴───────┐
                    ▼               ▼
               ┌────────┐     ┌────────┐
               │早期終了│     │継続    │
               │→ GROW │     │LAUNCH  │
               └────────┘     └────────┘
```

#### 型定義

```typescript
export interface ThreeAxisTransitionInput {
  asin: string;
  currentStage: LifecycleStage;
  seoCompletionRatio: number;
  minDaysSatisfied: boolean;
  sampleEnough: boolean;
  lossBudgetSummary: LossBudgetSummary;
}

export interface ThreeAxisTransitionConfig {
  seoCompletionThreshold: number;         // 0.7（70%）
  seoCompletionWarningThreshold: number;  // 0.4（40%）
  lossBudgetStateConfig: LossBudgetStateConfig;
}

export interface ThreeAxisTransitionResult {
  asin: string;
  shouldTransition: boolean;
  nextStage: LifecycleStage;
  reasonCode: ThreeAxisReasonCode;
  reasonMessage: string;
  isEmergencyStop: boolean;
  axisEvaluation: {
    seoConditionMet: boolean;
    trialConditionMet: boolean;
    lossBudgetState: LossBudgetState;
    emergencyStop: boolean;
    warningZone: boolean;
  };
}

export type ThreeAxisReasonCode =
  | "LOSS_BUDGET_EMERGENCY"   // C軸CRITICAL: 緊急終了
  | "NORMAL_COMPLETION"       // A+B軸完了: 通常終了
  | "LOSS_BUDGET_EARLY_EXIT"  // C軸WARNING + A軸部分: 早期終了
  | "CONTINUE_LAUNCH";        // 継続
```

#### デフォルト設定

```typescript
export const DEFAULT_THREE_AXIS_TRANSITION_CONFIG: ThreeAxisTransitionConfig = {
  seoCompletionThreshold: 0.7,         // 70%でSEO完了
  seoCompletionWarningThreshold: 0.4,  // 40%で部分達成
  lossBudgetStateConfig: {
    warningThreshold: 0.5,             // 50%でWARNING
    criticalThreshold: 0.9,            // 90%でCRITICAL
    launchInvestWarningThreshold: 0.5,
    launchInvestCriticalThreshold: 1.0, // 100%でCRITICAL
  },
};
```

#### アラートサマリー生成

```typescript
export function generateThreeAxisAlertSummary(
  result: ThreeAxisTransitionResult
): ThreeAxisAlertSummary {
  if (result.isEmergencyStop) {
    return {
      shouldAlert: true,
      alertLevel: "critical",
      message: `[緊急終了] ${result.asin}: lossBudget超過のためGROWへ移行`,
    };
  }
  if (result.reasonCode === "LOSS_BUDGET_EARLY_EXIT") {
    return {
      shouldAlert: true,
      alertLevel: "warning",
      message: `[早期終了] ${result.asin}: WARNING状態でのSEO部分達成によりGROWへ移行`,
    };
  }
  if (result.reasonCode === "NORMAL_COMPLETION") {
    return {
      shouldAlert: true,
      alertLevel: "info",
      message: `[通常終了] ${result.asin}: SEO・試行条件達成によりGROWへ移行`,
    };
  }
  if (result.axisEvaluation.warningZone) {
    return {
      shouldAlert: true,
      alertLevel: "warning",
      message: `[WARNING継続] ${result.asin}: lossBudget WARNING状態、SEO未完了`,
    };
  }
  return { shouldAlert: false };
}
```

---

## 34. 期待CVR計算ロジック（expectedCvr）

### 概要

キーワードの「1クリックあたりの注文期待確率」を複数ソースのCVRから推計する共通ヘルパー。
入札上限CPC（break-even bid）の計算や、キーワード価値評価に使用される。

**主な特徴**:
- 複数ソース（キーワード7日/30日、ASIN広告、ASIN全体、カテゴリ平均）のCVRを統合
- データ量に応じた信頼度重み付け
- ライフサイクル別の補正（LAUNCH期は控えめ、HARVEST期は高め）

### ファイル構成

```
src/metrics/
  expectedCvr.ts      # 期待CVR計算ヘルパー
  coreSeoScoring.ts   # CORE_SEOスコア計算
  index.ts            # エクスポート

tests/metrics/
  expectedCvr.test.ts
  coreSeoScoring.test.ts
```

### 入力データソース

| ソース | 信頼度基準 | 基礎重み | 説明 |
|--------|-----------|---------|------|
| keyword7d | 20クリック | 3 | 直近7日のキーワード固有CVR（鮮度最重視） |
| keyword30d | 50クリック | 2 | 30日のキーワード固有CVR（安定性） |
| asinAds30d | 200クリック | 1.5 | ASIN広告全体のCVR（横断傾向） |
| asinTotal30d | 500セッション | 1 | ビジネスレポートのCVR（広告外含む） |
| categoryBaselineCvr | - | 0.5 | カテゴリ平均CVR（ベースライン） |

### 計算フロー

```
1. 各ソースの生CVRを計算
   cvrKw7d = orders / clicks
   cvrAsinTotal = orders / sessions

2. 信頼度を計算（0〜1）
   reliability = min(1, actual_data / base_threshold)

3. 実効重みを計算
   effectiveWeight = baseWeight × reliability

4. 重み付け平均
   baseExpected = Σ(effectiveWeight × cvr) / Σ(effectiveWeight)

5. ライフサイクル補正
   expectedCvr = baseExpected × lifecycleAdjust
```

### ライフサイクル補正

| ライフサイクル | 補正係数 | 理由 |
|---------------|---------|------|
| LAUNCH | 0.8 | 認知度が低く、CVRが実力より低く出やすい |
| GROW | 1.0 | 標準 |
| HARVEST | 1.1 | リピーター効果でCVRが高く出やすい |

### 使用例

```typescript
import { computeExpectedCvr, DEFAULT_EXPECTED_CVR_CONFIG } from "./metrics";

const result = computeExpectedCvr(
  {
    keyword7d: { clicks: 50, orders: 3 },
    keyword30d: { clicks: 150, orders: 8 },
    categoryBaselineCvr: 0.02,
  },
  DEFAULT_EXPECTED_CVR_CONFIG,
  "GROW"
);

console.log(result.expectedCvr);          // 0.052
console.log(result.breakdown.rawCvr);     // 各ソースの生CVR
console.log(result.breakdown.reliability); // 各ソースの信頼度
```

### break-even bid計算への応用

```typescript
// 理論上の損益分岐CPC
const breakEvenCpc = price × marginRate × expectedCvr;

// 例: 価格2000円、粗利率40%、期待CVR 5%
// breakEvenCpc = 2000 × 0.4 × 0.05 = 40円
```

---

## 35. CORE_SEOキーワードスコアリング（coreSeoScore）

### 概要

「このASINについて本気でSEO上位を取りに行くべきキーワード候補」をスコアリングするヘルパー。
LAUNCH期に最も優先的に投資し、オーガニック順位を押し上げることを目的とする。

**CORE_SEOキーワードとは**:
> このASINについて「本気でSEO上位を取りに行く」対象キーワードです。
> LAUNCH期に最も優先的に投資し、オーガニック順位を押し上げることを目的としています。
> 通常、ASIN当たり5〜12語を選定します。

### スコアリング要素

| 要素 | 重み（デフォルト） | 説明 |
|------|-------------------|------|
| 検索ボリューム（volNorm） | 2 | 対数スケールで正規化（0〜1） |
| テキスト関連度（relText） | 3 | 商品タイトル/説明との一致度（0〜1） |
| ブランド指名性（relBrand） | 2.5（変動） | ブランド名を含むか（0, 0.5, 1） |
| コンバージョンシェア（convNorm） | 1.5 | 自社のCV占有率（0〜1） |
| 競合度（compScore） | -1 | CPCパーセンタイルとスポンサー枠（ペナルティ） |

### ブランド成熟度による動的調整

ブランドの認知度に応じてブランドキーワードの重みを調整:

| ブランド検索ボリューム | ステージ | ブランド重み倍率 |
|---------------------|---------|----------------|
| < 3,000/月 | 未成熟 | 40%（0.4） |
| 3,000〜10,000/月 | 成長期 | 80%（0.8） |
| > 10,000/月 | 確立 | 100%（1.0） |

**設計思想**: ブランド未成熟期は指名検索が少ないため、ジェネリックキーワードでの認知獲得を優先。
ブランドが育つにつれて、指名キーワードの投資価値が高まる。

### スコア計算式

```
score = weightVolume × volNorm
      + weightText × relText
      + brandWeightEffective × relBrand
      + weightConv × convNorm
      - weightCompetition × compScore
```

### 使用例

```typescript
import { computeCoreSeoScore, rankCoreSeoKeywords, DEFAULT_CORE_SCORE_CONFIG } from "./metrics";

// 単一キーワードのスコア計算
const result = computeCoreSeoScore({
  searchVolumeMonth: 50000,
  relText: 0.9,
  relBrand: 0,
  convShare: 0.15,
  cpcPercentile: 0.5,
  sponsoredSlotsNorm: 0.5,
  brandSearchVolume: 3000,
});
console.log(result.score);           // 4.2
console.log(result.breakdown);       // 各要素の寄与

// 上位10件のCORE候補を抽出
const ranked = rankCoreSeoKeywords(keywordList, DEFAULT_CORE_SCORE_CONFIG, 10);
ranked.forEach(({ keyword, result }) => {
  console.log(`${keyword}: ${result.score.toFixed(2)}`);
});
```

### BigQueryテーブル

CORE候補のメトリクスとスコアを格納:

```sql
-- sql/keyword_core_candidate_metrics.sql
CREATE TABLE keyword_core_candidate_metrics (
  profile_id STRING,
  asin STRING,
  keyword STRING,
  match_type STRING,
  marketplace STRING,

  -- 入力メトリクス
  search_volume_month INT64,
  rel_text FLOAT64,
  rel_brand FLOAT64,
  conv_share FLOAT64,
  cpc_percentile FLOAT64,
  sponsored_slots_norm FLOAT64,
  brand_search_volume INT64,

  -- 計算済み値
  vol_norm FLOAT64,
  conv_norm FLOAT64,
  comp_score FLOAT64,
  score_core FLOAT64,

  -- 候補フラグ
  is_core_candidate BOOL,
  core_rank INT64,

  updated_at TIMESTAMP
);
```

### 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/metrics/expectedCvr.ts` | 期待CVR計算 |
| `src/metrics/coreSeoScoring.ts` | CORE_SEOスコア計算 |
| `sql/keyword_core_candidate_metrics.sql` | BigQueryスキーマ |

---

## 36. TACOS-ACOS統合モデル

### 概要

T_opt（利益最大化TACOS）とT_stage（ライフサイクル別TACOS）を用いたTACOSモデルをLTVモデルと統合し、最終的なターゲットACOSを計算する。TACOSモデルとLTVモデルの両方からACOS目標を算出し、より厳しい方を採用することで、利益と成長のバランスを取る。

### ファイル構成

```
src/tacos-acos/
  index.ts                    # エクスポート
  types.ts                    # 型定義
  target-acos-calculator.ts   # ターゲットACOS計算
  theoretical-max-cpc.ts      # 理論最大CPC計算
  sale-expected-cvr.ts        # セール用期待CVR計算
```

### 計算ロジック

#### 1. T_stage決定

ライフサイクルステージに応じた基本TACOSを決定:

| ステージ | T_stage |
|----------|---------|
| LAUNCH_HARD / LAUNCH_SOFT | T_launch = min(g, T_opt × 1.30) |
| GROW | T_grow = T_opt |
| HARVEST | T_harvest = max(0, T_opt × 0.75) |

#### 2. セールフェーズ考慮

MAIN_SALE時はセール用TACOSを適用:

```
T_stage_smode = stageTacos × sModeTacosMultiplier（デフォルト: 1.3）
```

#### 3. TACOSからACOSへ変換

広告売上シェアを用いて変換:

```
adSalesShare = adSales30d / salesTotal30d
targetAcosFromTacos = T_stage_used / adSalesShare
```

#### 4. LTVモデルとの統合

```
targetAcosFromLtv = baseLtvAcos × ltvStageFactor
finalTargetAcos = min(targetAcosFromTacos, targetAcosFromLtv)
```

### 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `sModeTacosMultiplier` | 1.3 | MAIN_SALE時のTACOS乗数 |
| `adSalesShareDefault` | 0.3 | salesTotal不足時のデフォルト広告売上シェア |
| `adSalesShareMin` | 0.1 | 広告売上シェアの最小値 |
| `salesTotalMinThreshold` | 100,000円 | 広告売上シェア計算の最小売上額 |
| `ltvLaunchFactor` | 1.1 | LAUNCH期のLTV ACOS乗数 |
| `ltvGrowFactor` | 1.0 | GROW期のLTV ACOS乗数 |
| `ltvHarvestFactor` | 0.9 | HARVEST期のLTV ACOS乗数 |
| `globalAcosMin` | 0.05 | グローバルACOS下限 |
| `globalAcosMax` | 0.80 | グローバルACOS上限 |

### 使用例

```typescript
import {
  computeIntegratedTargetAcos,
  TargetAcosContext,
} from "./tacos-acos";

const context: TargetAcosContext = {
  marginPotential: 0.55,
  tOpt: 0.15,
  tLaunch: 0.195,
  tGrow: 0.15,
  tHarvest: 0.1125,
  lifecycleStage: "GROW",
  salePhase: "NORMAL",
  salesTotal30d: 300000,
  adSales30d: 90000,
  baseLtvAcos: 0.40,
  ltvHardCap: null,
};

const result = computeIntegratedTargetAcos(context);
console.log(result.finalTargetAcos);        // 0.40
console.log(result.tacosModelSelected);     // false（LTVモデルが採用）
```

---

## 37. 理論最大CPCガード

### 概要

g（ポテンシャル粗利率）、T_stage、expectedCvrから理論的に許容できる最大CPCを計算し、入札ガードレールとして使用する。どんなに入札ロジックが攻め方向に振れても、このCPCを超えないようにクリップする。

### 計算式

```
theoreticalMaxCpc = price × T_stage × expectedCvr × cpcSafetyFactor
```

### セール時の制約

MAIN_SALE時のCPC上昇には上限を設ける:

```
theoreticalMaxCpc_current ≤ theoreticalMaxCpc_normal × cpcUpliftCap
```

### 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `cpcSafetyFactor` | 1.15 | CPC安全係数（理論値に対するマージン） |
| `cpcUpliftCap` | 2.0 | セール時CPC上昇上限（通常時理論CPCに対する倍率） |

### 入札ガードの適用

```typescript
import { applyTheoreticalMaxCpcGuard } from "./tacos-acos";

const result = applyTheoreticalMaxCpcGuard(recommendedBidRaw, {
  price: 3000,
  tStageNormal: 0.15,
  expectedCvrNormal: 0.03,
  salePhase: "NORMAL",
});

console.log(result.finalBid);           // ガード適用後の入札額
console.log(result.guardResult.wasCapped); // クリップされたか
```

### ユーティリティ関数

| 関数 | 説明 |
|------|------|
| `computeBreakEvenCpc` | 損益分岐CPC計算（price × marginPotential × expectedCvr） |
| `computeCpcUtilization` | 現在の入札額が理論最大CPCに対する使用率 |
| `computeCpcHeadroom` | 理論最大CPCに対する余裕度（円） |
| `isBidWithinTheoreticalLimit` | 入札額が理論上限内か判定 |

---

## 38. セール用期待CVR（expectedCvr_sale）

### 概要

ビッグセール時のCVR跳ね上がりを考慮した期待CVRを計算する。Amazonのビッグセールでは「開始直後」と「終了前」でCVRが高くなりやすいため、時間帯別のアップリフトスケジュールを用いる。

### 計算ロジック

#### 1. 時間帯別アップリフト uplift_schedule(h)

| 時間帯 | アップリフト | 説明 |
|--------|------------|------|
| 0〜2時間 | 1.8 | セール開始直後の駆け込み需要 |
| 2〜12時間 | 1.3 | 序盤の活況 |
| 12〜43時間 | 1.1 | 中盤の安定期 |
| 43〜48時間 | 1.7 | 終了間際の駆け込み需要 |

#### 2. 事前期待CVR

```
expectedCvr_sale_prior = expectedCvr_normal × uplift_schedule(h)
```

ただし、max_uplift（デフォルト: 2.5）でクリップ。

#### 3. 実績CVRとのブレンド

```
w_live_raw = clicks_sale / baseClicksSale
w_live = max(wMinSale, min(1.0, w_live_raw))

expectedCvr_sale = (1 - w_live) × expectedCvr_sale_prior + w_live × cvr_observed_sale
```

### 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `maxUplift` | 2.5 | 最大アップリフト倍率 |
| `baseClicksSale` | 50 | 実績CVR信頼度計算の基本クリック数 |
| `wMinSale` | 0.3 | w_liveの最小値（実績CVRの最低重み） |
| `saleDurationHours` | 48 | セール継続時間 |

### SalePhase定義

| フェーズ | 説明 |
|----------|------|
| NORMAL | 通常日 |
| PRE_SALE | セール準備期間（セール前2-3日） |
| MAIN_SALE | セール本番中 |
| COOL_DOWN | セール終了後のクールダウン期間 |

### 使用例

```typescript
import { computeExpectedCvrSale, getExpectedCvrForPhase } from "./tacos-acos";

// セール開始1時間後の期待CVR
const result = computeExpectedCvrSale({
  expectedCvrNormal: 0.03,
  hoursSinceMainSaleStart: 1,
  clicksSale: 30,
  cvrObservedSale: 0.05,
});
console.log(result.expectedCvrSale); // 0.05〜程度

// フェーズに応じた期待CVR取得
const { expectedCvrUsed, isSaleMode } = getExpectedCvrForPhase(
  "MAIN_SALE",
  0.03,
  { hoursSinceMainSaleStart: 1, clicksSale: 30, cvrObservedSale: 0.05 }
);
```

### 動的スケジュール生成

```typescript
import { generateDynamicUpliftSchedule } from "./tacos-acos";

// 24時間セール用のスケジュールを生成
const schedule = generateDynamicUpliftSchedule(24, {
  launchUplift: 1.8,
  earlyUplift: 1.3,
  midUplift: 1.1,
  finalUplift: 1.7,
  hoursBeforeEnd: 3,
});
```

### 設計思想

1. **時間帯別アップリフト**: セール中のCVR変動パターンを事前に組み込み、予測精度を向上
2. **w_live下限付きブレンド**: 実績が少ない序盤でも最低30%は実績を参照し、過度な事前期待依存を防止
3. **max_upliftクリップ**: 異常な上昇を防ぎ、入札の暴走を防止
4. **NORMAL日データ保護**: ビッグセール中の一時的なCVR爆上がりが通常日のT_optやexpectedCvr_normalを歪めないよう、T_opt推計や長期モデルではNORMAL日中心のデータを使用

---

## 39. ロール×ライフサイクル別ガードレール（roleGuardrails）

### 概要

キーワードの役割（CORE, SUPPORT, EXPERIMENT）、ライフサイクルステージ、セールフェーズ、プレセールタイプ、lossBudgetStateに応じて、DOWN/STRONG_DOWN/STOP/NEGの許可・禁止とそれぞれの閾値を一元的に制御するガードレールシステム。

### 設計思想

1. **CORE SEOキーワードをローンチ期に安易に殺さない**: LAUNCH期のCOREキーワードはSTOP/NEG/STRONG_DOWNを原則禁止
2. **SUPPORT/EXPERIMENTから優先的に調整する**: より軽いロールから先にダウン・ストップを許可
3. **PRE_SALEの買い控え期間にCVR悪化で暴走しない**: HOLD_BACK時はSTRONG_DOWN禁止、STOP閾値を強化

### ファイル

```
src/engine/
  roleGuardrails.ts         # 型定義・ガードレール計算
  index.ts                  # エクスポート

src/lifecycle/
  bid-integration.ts        # determineBidActionWithGuardrails追加

src/negative-keywords/
  negative-keyword-calculator.ts  # checkNegativeCandidateWithGuardrails追加
```

### 型定義

#### KeywordRole

| ロール | 説明 |
|--------|------|
| CORE | SEO押し上げのための主力キーワード（最も保護する） |
| SUPPORT | コアを補助するキーワード |
| EXPERIMENT | 実験的なキーワード（最も早く切りやすい） |

#### PresaleType

| タイプ | 説明 |
|--------|------|
| BUYING | 買い優先期間（セール前に在庫確保） |
| HOLD_BACK | 買い控え期間（セール待ち） |
| MIXED | 混合 |
| NONE | プレセール期間外 |

#### LossBudgetState

| 状態 | 説明 |
|------|------|
| SAFE | 健全（lossBudget使用率50%未満） |
| WARNING | 注意（lossBudget使用率50-80%） |
| CRITICAL | 危機（lossBudget使用率80%以上） |

#### RoleLifecycleGuardrails

```typescript
interface RoleLifecycleGuardrails {
  // アクション許可フラグ
  allowStop: boolean;
  allowNegative: boolean;
  allowStrongDown: boolean;

  // サンプル閾値（クリック数）
  minClicksDown: number;
  minClicksStrongDown: number;
  minClicksStop: number;

  // overspendRatio閾値（acos_w / targetAcos）
  overspendThresholdDown: number;
  overspendThresholdStrongDown: number;
  overspendThresholdStop: number;

  // 変動幅制限
  maxDownStepRatio: number;

  // メタ情報
  reason: string;
}
```

### ガードレールポリシー

#### ベース閾値定数

| 定数 | 値 | 説明 |
|------|-----|------|
| MIN_CLICKS_BASE_DOWN | 30 | DOWN用ベースクリック数 |
| MIN_CLICKS_BASE_STRONG_DOWN | 50 | STRONG_DOWN用ベースクリック数 |
| MIN_CLICKS_BASE_STOP | 80 | STOP用ベースクリック数 |
| SMALL_OVER | 1.1 | targetACOSの1.1倍以上 |
| MED_OVER | 1.3 | targetACOSの1.3倍以上 |
| HEAVY_OVER | 1.6 | targetACOSの1.6倍以上 |

#### CORE ロールのポリシー

| ライフサイクル | allowStop | allowNegative | allowStrongDown | minClicksDown | maxDownStepRatio |
|----------------|-----------|---------------|-----------------|---------------|------------------|
| LAUNCH | false | false | false | 90 | 0.10 |
| GROW (SAFE) | false | false | true | 60 | 0.15 |
| GROW (CRITICAL) | true | true | true | 60 | 0.15 |
| HARVEST (SAFE) | false | false | true | 30 | 0.20 |
| HARVEST (WARNING+) | true | ※CRITICALのみ | true | 30 | 0.20 |

#### SUPPORT ロールのポリシー

| ライフサイクル | allowStop | allowNegative | allowStrongDown | minClicksDown | maxDownStepRatio |
|----------------|-----------|---------------|-----------------|---------------|------------------|
| LAUNCH (SAFE) | false | false | true | 45 | 0.15 |
| LAUNCH (CRITICAL) | true | true | true | 45 | 0.15 |
| GROW | true | ※SAFEはfalse | true | 30 | 0.20 |
| HARVEST | true | true | true | 30 | 0.25 |

#### EXPERIMENT ロールのポリシー

| ライフサイクル | allowStop | allowNegative | allowStrongDown | minClicksDown | maxDownStepRatio |
|----------------|-----------|---------------|-----------------|---------------|------------------|
| 全ステージ | true | true | true | 21 | 0.30 |

### 共通補正ルール

#### PRE_SALE × HOLD_BACK 補正

PRE_SALEフェーズかつHOLD_BACKタイプの場合、SUPPORT/EXPERIMENTに対して:

- `allowStrongDown = false`
- `minClicksStop = max(現在値, 160)`
- `overspendThresholdStop = max(現在値, 1.6)`

#### lossBudgetState CRITICAL 補正

CRITICALの場合、SUPPORT/EXPERIMENTに対して:

- `allowStop = true`
- `allowNegative = true`
- `overspendThresholdStop = min(現在値, 1.3)`

### 使用例

```typescript
import {
  getRoleLifecycleGuardrails,
  computeOverspendRatio,
  meetsActionThreshold,
} from "./engine";

// ガードレールを取得
const guardrails = getRoleLifecycleGuardrails({
  role: "CORE",
  lifecycleStage: "LAUNCH_HARD",
  salePhase: "NORMAL",
  presaleType: "NONE",
  lossBudgetState: "SAFE",
});

// overspendRatioを計算
const overspendRatio = computeOverspendRatio(currentAcos, targetAcos);

// アクション閾値チェック
if (!guardrails.allowStop) {
  // STOP候補から除外
}

if (meetsActionThreshold("DOWN", clicksW, overspendRatio, guardrails)) {
  // DOWN条件を満たす
}
```

### determineBidActionWithGuardrails

ガードレール対応版の入札アクション決定関数:

```typescript
const result = determineBidActionWithGuardrails({
  currentAcos: 0.35,
  targetAcos: 0.25,
  clicksW: 50,
  investModeEnabled: false,
  keywordRole: "CORE",
  lifecycleStage: "LAUNCH_HARD",
  salePhase: "NORMAL",
  presaleType: "NONE",
  lossBudgetState: "SAFE",
});

console.log(result.action);              // 最終アクション（ガードレール適用後）
console.log(result.originalAction);       // 元のアクション（ガードレール適用前）
console.log(result.wasModifiedByGuardrails); // 変更されたか
console.log(result.modificationReason);   // 変更理由
```

### ネガティブ候補のガードレールチェック

```typescript
import { checkNegativeCandidateWithGuardrails } from "./negative-keywords";

const result = checkNegativeCandidateWithGuardrails({
  keywordRole: "CORE",
  lifecycleStage: "LAUNCH_HARD",
  salePhase: "NORMAL",
  presaleType: "NONE",
  lossBudgetState: "SAFE",
  clicksW: 100,
  acosW: 0.50,
  targetAcos: 0.25,
});

if (!result.isAllowed) {
  console.log(result.rejectionReason);
  // "ネガティブ禁止 (CORE×LAUNCH: STOP/NEG/STRONG_DOWN禁止...)"
}
```

---

## 付録: ライフサイクル関連指標一覧（英語名 → 日本語名）

本セクションでは、ライフサイクル管理・LAUNCH終了判定で使用する主要な指標について、英語名と日本語名の対応、および各指標の意味を整理します。

### A. SEO ローンチ進捗関連

| 英語名 | 日本語名 | 意味 |
|--------|----------|------|
| `AsinSeoLaunchProgress` | ASIN別SEOローンチ進捗 | 対象ASINについて、ローンチ期間中に追っているコアキーワードの決着状況をまとめた構造体 |
| `totalCoreKeywords` | コアキーワード総数 | ローンチ対象として定義しているコアキーワードの総数 |
| `achievedCount` | 達成キーワード数 | 目標順位やCVR基準を満たして「達成」と判定したコアキーワードの数 |
| `gaveUpCount` | 撤退キーワード数 | 損失予算超過や低CVRなどの理由で「追うのをやめる」と判定したコアキーワードの数 |
| `activeCount` | 進行中キーワード数 | まだ達成にも撤退にもなっていない、実験継続中のコアキーワードの数 |
| `completionRatio` | SEO完了率 | (達成キーワード数 + 撤退キーワード数) ÷ コアキーワード総数。コアキーワード集合のうち「すでに達成か撤退のどちらかに決着している割合」 |
| `successRatio` | SEO成功率 | 達成キーワード数 ÷ コアキーワード総数。コアキーワード集合のうち「勝ち切れた（達成できた）キーワードの割合」 |

### B. 日数・データ量関連

| 英語名 | 日本語名 | 意味 |
|--------|----------|------|
| `daysSinceLaunch` | ローンチ経過日数 | このASINがローンチステージに入ってからの経過日数 |
| `asinClicksTotal` | ASIN累計クリック数 | ライフサイクル判定に使用する「対象期間の累計クリック数」 |
| `asinOrdersTotal` | ASIN累計注文数 | ライフサイクル判定に使用する「対象期間の累計注文数」 |
| `daysWithRankData` | 順位データ取得日数 | 順位データが存在する日数（GAVE_UP判定に使用） |
| `minDaysActive` | 最低稼働日数 | GAVE_UP判定前に最低限必要な稼働日数 |

### C. 損失予算関連

| 英語名 | 日本語名 | 意味 |
|--------|----------|------|
| `AsinLossBudgetMetrics` | ASIN別損失予算メトリクス | 各ASINについて、事前に決めた損失予算をどれだけ消費しているかを集約した指標セット |
| `lossBudget` | 損失予算額 | そのASINに対して投資してよい累計赤字の上限 |
| `lossSoFar` | 累計損失額 | 現時点までに発生している累計赤字額 |
| `ratioStage` | 損失予算消化率 | lossSoFar ÷ lossBudget。1.0で損失予算をちょうど使い切り、1.2で120%超過を意味する |
| `investmentState` | 投資状態 | SAFE/WATCH/LIMIT/BREACH等の状態フラグ。SAFEは損失予算内、BREACHは損失予算を超過している状態 |
| `LossBudgetState` | 損失予算状態（簡易） | SAFE/WARNING/CRITICALの3状態。投資状態を簡易的に表現したもの |
| `LossBudgetSummary` | 損失予算サマリー | Rolling/Launch/LaunchInvestの3軸消化率と状態を統合したサマリー |
| `lossBudgetConsumptionRolling` | Rolling消化率 | 直近30日のローリング損失予算消化率 |
| `lossBudgetConsumptionLaunch` | Launch消化率 | ローンチ期間全体の損失予算消化率 |
| `launchInvestUsageRatio` | LaunchInvest使用率 | ローンチ投資枠の使用率 |

### D. ローンチ終了閾値関連

| 英語名 | 日本語名 | 意味 |
|--------|----------|------|
| `LaunchExitThresholdsComputed` | ローンチ終了閾値セット（計算済み） | 各ASINのボリュームや実績に応じて動的に計算された「ローンチ終了判定に使う最終的なしきい値セット」 |
| `minCoreCompletionRatio` | 最低SEO完了率 | この割合以上にSEO完了率が進んでいないと、通常終了ではLAUNCHを終えない |
| `minLaunchDays` | 最低ローンチ日数 | この日数に達するまでは、基本的にLAUNCHを終了させないための最低稼働日数 |
| `minAsinClicksTotal` | 最低必要クリック数 | クリックが一定以上溜まるまでは早期終了を避けるための最低クリック条件 |
| `minAsinOrdersTotal` | 最低必要注文数 | 注文数が一定以上溜まるまでは早期終了を避けるための最低注文条件 |
| `emergencyLossRatioThreshold` | 緊急終了損失比率閾値 | この比率を超えると、SEO完了率や日数条件に関係なく「損失予算の観点で緊急終了」と判定するための閾値 |

### E. volumeBucket関連（動的GAVE_UP閾値）

| 英語名 | 日本語名 | 意味 |
|--------|----------|------|
| `VolumeBucket` | 検索ボリューム区分 | HIGH_VOLUME/MID_VOLUME/LOW_VOLUMEの3段階。検索ボリュームに基づくキーワード分類 |
| `volumeRatio` | ボリューム比率 | 各キーワードの検索ボリューム ÷ ASIN内コアキーワードの中央値 |
| `computedMinDaysForGiveUp` | 動的GAVE_UP最小日数 | tier×volumeBucketから計算されたGAVE_UP判定用の最小日数閾値 |
| `computedMinClicksForGiveUp` | 動的GAVE_UP最小クリック数 | tier×volumeBucketから計算されたGAVE_UP判定用の最小クリック数閾値 |
| `computedRankThresholdForGiveUp` | 動的GAVE_UP順位閾値 | tier×volumeBucketから計算されたGAVE_UP判定用の順位閾値 |

### F. 三軸遷移判定関連

| 英語名 | 日本語名 | 意味 |
|--------|----------|------|
| `ThreeAxisTransitionInput` | 三軸遷移判定入力 | A軸（SEO）、B軸（時間/サンプル）、C軸（lossBudget）の3軸による遷移判定の入力データ |
| `ThreeAxisTransitionResult` | 三軸遷移判定結果 | 遷移すべきか、次のステージ、理由コードなどを含む判定結果 |
| `seoCompletionRatio` | SEO完了率（A軸） | コアキーワードの決着割合。通常終了には70%以上が必要 |
| `minDaysSatisfied` | 最低日数達成（B軸） | ローンチ期間として最低限必要な日数を満たしているか |
| `sampleEnough` | サンプル十分（B軸） | クリック数・注文数が判定に必要な量に達しているか |
| `isEmergencyStop` | 緊急終了フラグ | C軸CRITICALによる緊急終了かどうか |
| `ThreeAxisReasonCode` | 三軸遷移理由コード | LOSS_BUDGET_EMERGENCY/NORMAL_COMPLETION/LOSS_BUDGET_EARLY_EXIT/CONTINUE_LAUNCHの4種類 |

---

## 40. 管理画面（AdminJS）

### 概要

本ツールには内部運用者向けの管理画面が存在し、Cloud Run 上のアプリケーションの `/admin-panel` パスで提供される。
管理画面は AdminJS によって実装されており、BigQueryテーブルの閲覧と一部設定の編集機能を提供する。

**パス選択について**: `/admin` ではなく `/admin-panel` を使用している理由は、既存の API ルート（`/admin/negative-suggestions`, `/admin/auto-exact-suggestions`, `/admin/executions`）との競合を避けるため。

### 機能一覧

| リソース名 | 日本語表示名 | 編集可否 | データセット |
|------------|--------------|----------|--------------|
| product_config | 商品設定 | ○（一部列のみ） | amazon_bid_engine |
| executions | 実行ログ | × | amazon_bid_engine |
| recommendations | 入札提案ログ | × | amazon_bid_engine |
| loss_budget_7d | 予算・損失モニタ（7日） | × | amazon_bid_engine |
| negative_candidates_shadow | ネガ候補（シャドウ） | × | analytics_views |

### product_config 編集可能列

| 列名 | 日本語名 | バリデーション |
|------|----------|----------------|
| lifecycle_state | ライフサイクル | LAUNCH_HARD, LAUNCH_SOFT, GROW, HARVEST のいずれか |
| target_tacos | 目標TACOS | 0〜1の数値 |
| max_bid | 入札上限 | 0〜5の数値 |
| profile_type | プロファイル種別 | STANDARD, AGGRESSIVE, CONSERVATIVE, CUSTOM のいずれか |

### BigQuery アダプタ

AdminJS から BigQuery を扱うために、専用のアダプタ（BigQueryDatabase/BigQueryResource）を実装している。

- **BigQueryDatabase**: AdminJS の BaseDatabase を継承。データベース接続情報を管理
- **BigQueryResource**: AdminJS の BaseResource を継承。テーブル/ビュー単位のCRUD操作を実装

アダプタは AdminJS 起動時に `AdminJS.registerAdapter()` で登録される。

#### BigQueryResource 実装詳細

BigQueryResource は AdminJS v6 の BaseResource 仕様に準拠し、以下の設計で実装している：

- **プロパティ管理**: `_propertiesArray` (配列) と `_propertiesMap` (マップ) を内部で保持し、`properties()` と `property(path)` メソッドで返す
- **BaseResource 継承**: コンストラクタで `super({})` を呼び出し、AdminJS コアが期待しないフィールドを渡さない
- **フィールド命名**: AdminJS の内部フィールドとの衝突を避けるため、プライベートフィールドは `_` プレフィックスを使用（`_tableName`, `_propertyDefs` など）
- **防御的プログラミング**: `_propertyDefs` は常に配列として扱うため、`_getPropertyDefsArray()` ヘルパーメソッドで安全に取得。コンストラクタでも `Array.isArray()` チェックを実施

#### isAdapterFor の実装における注意事項

AdminJS の `resources-factory.js` は、アダプタが `isAdapterFor(rawResource)` で `true` を返した場合、`new Adapter.Resource(resourceObject)` を呼び出してリソースをラップする。

**問題**: BigQueryResource インスタンスを直接 `resources` 配列に渡した場合、`isAdapterFor` が `true` を返すと、AdminJS は `new BigQueryResource(既存のBigQueryResourceインスタンス)` を呼び出してしまい、空のリソースが生成されてしまう。

**解決策**: `isAdapterFor` は既存の BigQueryResource インスタンスに対して `false` を返すよう実装する：

```typescript
static isAdapterFor(rawResource: unknown): boolean {
  // 既存の BigQueryResource インスタンスは再ラップしない
  if (rawResource instanceof BigQueryResource) {
    return false;
  }
  // BigQueryResourceOptions として渡された場合のみアダプタを使用
  if (rawResource && typeof rawResource === "object" && "tableName" in rawResource && "idField" in rawResource) {
    return true;
  }
  return false;
}
```

この設計により、BigQueryResource インスタンスを直接 AdminJS の `resources` 配列に渡しても、AdminJS が再度ラップしようとすることを防ぐ。

```typescript
// BigQueryResource のプロパティ管理
class BigQueryResource extends BaseResource {
  private _propertyDefs: BigQueryPropertyDefinition[];
  private _propertiesArray: BaseProperty[] | null = null;
  private _propertiesMap: Record<string, BaseProperty> = {};

  constructor(options: BigQueryResourceOptions) {
    super({});
    // properties を安全に配列として初期化
    if (Array.isArray(options.properties)) {
      this._propertyDefs = options.properties;
    } else if (options.properties && typeof options.properties === "object") {
      this._propertyDefs = Object.values(options.properties);
    } else {
      this._propertyDefs = [];
    }
    this._buildProperties();
  }

  // 配列を安全に取得するヘルパー
  private _getPropertyDefsArray(): BigQueryPropertyDefinition[] {
    return Array.isArray(this._propertyDefs) ? this._propertyDefs : [];
  }

  properties(): BaseProperty[] {
    return this._propertiesArray || [];
  }

  property(path: string): BaseProperty | null {
    return this._propertiesMap[path] || null;
  }
}
```

### ファイル構成

```
src/
├── bigquery/
│   └── client.ts                       # BigQueryクライアント（ADC認証）
└── admin/
    ├── admin.ts                        # AdminJS初期化・アダプタ登録・認証付きルーター構築
    ├── bigquery/
    │   ├── index.ts                    # アダプタエクスポート
    │   ├── BigQueryDatabase.ts         # Database アダプタ
    │   └── BigQueryResource.ts         # Resource アダプタ（CRUD実装）
    └── repositories/                   # (参考用リポジトリ、アダプタ実装に移行済み)
        ├── productConfigRepo.ts
        ├── executionsRepo.ts
        ├── recommendationsRepo.ts
        ├── lossBudgetRepo.ts
        └── negativeCandidatesRepo.ts
```

### ルーターマウント

AdminJS の `rootPath` と Express のマウントパスを一致させるため、`registerAdmin(app)` パターンを採用している。
ルーターは `admin.options.rootPath` にマウントする。

```typescript
// src/admin/admin.ts
const ADMIN_ROOT_PATH = "/admin-panel";

export function registerAdmin(app: express.Application): void {
  const admin = new AdminJS({
    rootPath: ADMIN_ROOT_PATH,
    loginPath: `${ADMIN_ROOT_PATH}/login`,
    logoutPath: `${ADMIN_ROOT_PATH}/logout`,
    // ...
  });
  const router = AdminJSExpress.buildAuthenticatedRouter(admin, ...);
  // ルーターは rootPath にマウント
  app.use(admin.options.rootPath, router);
}

// src/server.ts
import { registerAdmin } from "./admin/admin";
registerAdmin(app);
```

**重要**: `loginPath` と `logoutPath` を明示的に指定しないと、AdminJS のデフォルト値（`/admin/login`）が使用され、リダイレクトループが発生する可能性がある。

### 認証

ログイン認証は環境変数で指定した管理者メールアドレスとパスワードで行う。

#### 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `ADMIN_EMAIL` | ○ | 管理者メールアドレス |
| `ADMIN_PASSWORD` | ○ | 管理者パスワード |
| `ADMIN_COOKIE_SECRET` | △ | Cookieの署名シークレット（本番では必須） |
| `ADMIN_SESSION_SECRET` | △ | セッションシークレット（本番では必須） |

**注意事項:**
- `ADMIN_EMAIL` と `ADMIN_PASSWORD` が設定されていない場合、管理画面は無効化される
- `ADMIN_COOKIE_SECRET` と `ADMIN_SESSION_SECRET` は本番運用では必ず環境変数で上書きすること
- デフォルト値は開発用のプレースホルダーのみ

### BigQuery認証

管理画面からのBigQueryアクセスはADC（Application Default Credentials）認証を使用する。

- **Cloud Run上**: サービスアカウントの認証情報を自動取得
- **ローカル開発**: `gcloud auth application-default login` で認証
- **必要なIAMロール**: BigQuery データ編集者（roles/bigquery.dataEditor）

### アクセス方法

- ローカル開発: `http://localhost:8080/admin-panel`
- 本番（Cloud Run）: `https://<service-url>/admin-panel`

### 制限事項

- 新規レコード作成（new）は全リソースで無効
- レコード削除（delete）は全リソースで無効
- 編集はproduct_configの指定列のみ許可
- 全リソースでページネーション有効（デフォルト50件/ページ）
- 一覧は日付降順で表示

---

## 41. サーバー起動フロー

### 概要

本アプリケーションは `src/server.ts` をエントリポイントとし、`startServer()` 関数によって HTTP サーバーを起動する。
このパターンにより、サーバー起動時のエラーハンドリングと非同期処理を適切に管理できる。

### エントリポイント構造

```typescript
// src/server.ts

// 1. dotenv で .env ファイルから環境変数を読み込み
import "dotenv/config";

// 2. startServer 関数を定義
async function startServer(): Promise<void> {
  // 2.1 Express app の作成
  const app = express();

  // 2.2 ミドルウェアの登録（CORS, JSON parser, rate limiting 等）
  app.use(cors(corsOptions));
  app.use(express.json({ limit: "10mb" }));

  // 2.3 API ルートの登録
  app.use("/cron", internalAuthMiddleware, cronRoutes);
  app.use("/escore", apiKeyAuthMiddleware, escoreRoutes);
  // ... その他のルート

  // 2.4 AdminJS 管理画面の登録
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    registerAdmin(app);
  }

  // 2.5 HTTP サーバーを起動
  return new Promise<void>((resolve) => {
    app.listen(PORT, () => {
      logger.info("Server started", { port: PORT });
      resolve();
    });
  });
}

// 3. サーバー起動を実行
startServer().catch((error) => {
  logger.error("Failed to start server", { error });
  process.exit(1);
});
```

### 起動フロー

1. **dotenv 読み込み**: `.env` ファイルから環境変数を `process.env` に設定
2. **環境変数検証**: 必須環境変数の存在チェック（開発環境では警告のみ、本番では起動停止）
3. **Express app 作成**: ミドルウェアとルートを登録
4. **AdminJS 登録**: 環境変数が設定されている場合のみ有効化
5. **HTTP サーバー起動**: `app.listen()` でポートをバインドし、待ち受け開始

### 重要な設計ポイント

- **プロセス継続**: `app.listen()` がソケットを保持し続けるため、`npm start` 後にプロセスは終了しない
- **エラーハンドリング**: `startServer()` が例外を投げた場合、`process.exit(1)` で異常終了
- **AdminJS 分離**: AdminJS の登録失敗は他の API 動作を妨げない

### ローカル開発

```bash
# 環境変数は .env ファイルで設定
npm run build
npm start
# → Server started {"port":8080} が表示され、プロセスが継続
```

### Cloud Run デプロイ

Cloud Run では同じ `src/server.ts` をエントリポイントとして使用する。
環境変数は Cloud Run のサービス設定で指定する。

```dockerfile
# Dockerfile
CMD ["node", "dist/src/server.js"]
```

---

## 関連ドキュメント

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 概要仕様書
- [LTV.md](./LTV.md) - LTV仕様書
- [LIFECYCLE.md](./LIFECYCLE.md) - ライフサイクル仕様書
- [SETUP.md](./SETUP.md) - セットアップガイド
- [API.md](./API.md) - API仕様書
- [bid_core.md](./bid_core.md) - 入札コアロジック仕様書
- [CODE_MAP.md](./CODE_MAP.md) - 機能・実装マッピング

---

*更新日: 2025年11月* - SEO目標順位ロジックを追加（RankTargetConfig, SeoProgressMetrics, seoProgressScore, RankAdjustmentSuggestion, SEO進捗とTACOS制御の統合） - TACOS×LTV×ライフサイクル制御を追加（theoreticalMaxTacos, TacosZone, TacosControlContext, adjustTargetAcosByTacos, judgeTacosBasedLifecycle, determineBidControlAction）、ステージ別TACOS制御パラメータ（StageTacosControlParams, TACOS_CONTROL_PARAMS_DEFAULTS）を追加、LTV期待粗利・累積赤字上限管理を追加（calculateExpectedLtvGrossProfit, calculateProductCumulativeLossLimit, assessProductRisk）、激戦度判定・プロファイル自動割り当てを追加（calculateCompetitionIntensity, assignProfileByCompetition）、成長判定条件（isGrowingCandidate）を追加（assessGrowthCandidate）、プロファイルにlossBudgetMultiple/expectedRepeatOrdersPrior/maxConsecutiveLossMonthsを追加、昇格時パラメータ再推計機能（reestimateParameters, executePromotion）を追加、marginRateNormal/marginRateBlendedによる粗利率2種類管理を追加、商品プロファイル（SUPPLEMENT_HIGH_LTV等）を追加、新商品（NEW_PRODUCT）ロジックを追加、キーワード自動発見・拡張機能を追加、季節性予測による先行入札調整機能を追加、プロ戦略モジュールを追加（Revenue-Based Bid、Bidding Lifecycle、商品レベルTACOSコントローラを追加）、係数を8→7に統合（risk_coeff→stats_coeff）

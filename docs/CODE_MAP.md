# CODE_MAP.md - 機能・実装マッピング

> 機能名から実装ファイル・関数を特定するための実装地図

---

## 目次

1. [入札エンジン (Bid Engine)](#1-入札エンジン-bid-engine)
2. [LTV計算 (LTV Calculator)](#2-ltv計算-ltv-calculator)
3. [ライフサイクル管理 (Lifecycle)](#3-ライフサイクル管理-lifecycle)
4. [在庫ガード (Inventory Guard)](#4-在庫ガード-inventory-guard)
5. [自動ガードレール (Auto Guardrails)](#5-自動ガードレール-auto-guardrails)
6. [ネガティブキーワード候補 (Negative Keywords)](#6-ネガティブキーワード候補-negative-keywords)
7. [AUTO→EXACT昇格 (Auto-Exact Promotion)](#7-autoexact昇格-auto-exact-promotion)
8. [SEO指標 (SEO Metrics)](#8-seo指標-seo-metrics)
9. [ProductConfig管理](#9-productconfig管理)
10. [ロギング・シャドウモード](#10-ロギングシャドウモード)
11. [Slack通知](#11-slack通知)
12. [適応型E-Score (Adaptive E-Score)](#12-適応型e-score-adaptive-e-score) ⚠️未ドキュメント
13. [Jungle Scout連携](#13-jungle-scout連携) ⚠️未ドキュメント
14. [統合入札戦略 (Unified Strategy)](#14-統合入札戦略-unified-strategy) ⚠️未ドキュメント
15. [共通ユーティリティ](#15-共通ユーティリティ)
16. [APIルート](#16-apiルート)
17. [バックテスト (Backtest)](#17-バックテスト-backtest)
18. [プロ戦略 (Pro Strategies)](#18-プロ戦略-pro-strategies)

---

## 1. 入札エンジン (Bid Engine)

### 概要
キーワード指標に基づいて入札額を計算し、推奨を生成するコアエンジン

### ファイル構成
```
src/engine/
├── index.ts              # エクスポート
└── bidEngine.ts          # メインエンジン
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `runBidEngine` | [bidEngine.ts:380](src/engine/bidEngine.ts#L380) | 入札エンジンのエントリポイント |
| `computeRecommendation` | [bidEngine.ts:292](src/engine/bidEngine.ts#L292) | 単一キーワードの推奨計算 |
| `determineBidAction` | [bidEngine.ts:245](src/engine/bidEngine.ts#L245) | UP/DOWN/KEEPアクション判定 |
| `calculateRecommendedBid` | [bidEngine.ts:301](src/engine/bidEngine.ts#L301) | 推奨入札額計算 |
| `isRecentPerformanceGood` | [bidEngine.ts:457](src/engine/bidEngine.ts#L457) | 直近パフォーマンス良好判定 |
| `shouldBeNoConversion` | [bidEngine.ts:489](src/engine/bidEngine.ts#L489) | NO_CONVERSION判定 |
| `shouldBeAcosHigh` | [bidEngine.ts:519](src/engine/bidEngine.ts#L519) | ACOS_HIGH判定 |
| `applyRecentGoodSafetyValve` | [bidEngine.ts:548](src/engine/bidEngine.ts#L548) | 直近良好時のセーフティバルブ |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `BidEngineConfig` | [bidEngine.ts:57](src/engine/bidEngine.ts#L57) | エンジン設定 |
| `KeywordMetrics` | [bidEngine.ts:73](src/engine/bidEngine.ts#L73) | キーワード指標 |
| `BidRecommendation` | [bidEngine.ts:191](src/engine/bidEngine.ts#L191) | 入札推奨結果 |
| `BidEngineResult` | [bidEngine.ts:243](src/engine/bidEngine.ts#L243) | エンジン実行結果 |
| `ATTRIBUTION_DELAY_CONFIG` | [bidEngine.ts:145](src/engine/bidEngine.ts#L145) | アトリビューション遅延設定 |

---

## 2. LTV計算 (LTV Calculator)

### 概要
顧客生涯価値（LTV）を考慮した目標ACOS計算

### ファイル構成
```
src/ltv/
├── index.ts                  # エクスポート
├── types.ts                  # 型定義
├── ltv-calculator.ts         # ACOS計算ロジック
└── product-config-builder.ts # ProductConfig生成ヘルパー
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `getTargetAcos` | [ltv-calculator.ts:260](src/ltv/ltv-calculator.ts#L260) | 目標ACOS取得（数値のみ） |
| `getTargetAcosWithDetails` | [ltv-calculator.ts:267](src/ltv/ltv-calculator.ts#L267) | 目標ACOS取得（詳細付き） |
| `computeBaseLtvTargetAcos` | [ltv-calculator.ts:100](src/ltv/ltv-calculator.ts#L100) | LTVベースACOS計算 |
| `computeFinalTargetAcos` | [ltv-calculator.ts:192](src/ltv/ltv-calculator.ts#L192) | 最終ACOS計算 |
| `determineLtvMode` | [ltv-calculator.ts:33](src/ltv/ltv-calculator.ts#L33) | LTVモード判定 |
| `calculateDaysSinceLaunch` | [ltv-calculator.ts:70](src/ltv/ltv-calculator.ts#L70) | 発売日からの経過日数 |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `LtvModeThresholds` | [types.ts:83](src/ltv/types.ts#L83) | LTVモード判定閾値 |
| `ACOS_CONSTANTS` | [types.ts:111](src/ltv/types.ts#L111) | ACOS定数 |
| `BaseLtvAcosDetails` | [types.ts:140](src/ltv/types.ts#L140) | ベースLTV ACOS詳細 |
| `FinalTargetAcosDetails` | [types.ts:153](src/ltv/types.ts#L153) | 最終ACOS詳細 |
| `GuardrailsPerLifecycle` | [types.ts:170](src/ltv/types.ts#L170) | ライフサイクル別ガードレール |

---

## 3. ライフサイクル管理 (Lifecycle)

### 概要
商品のライフサイクルステージ（LAUNCH→GROW→HARVEST）の遷移判定と提案

### ファイル構成
```
src/lifecycle/
├── index.ts              # エクスポート
├── types.ts              # 型定義
├── transition-logic.ts   # 遷移ロジック
├── lifecycleSuggestion.ts # ライフサイクル提案
├── bid-integration.ts    # Bid連携
└── suggestionApplicator.ts # 提案適用
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `evaluateLifecycleTransition` | [transition-logic.ts:404](src/lifecycle/transition-logic.ts#L404) | ライフサイクル遷移評価 |
| `checkGlobalSafety` | [transition-logic.ts:51](src/lifecycle/transition-logic.ts#L51) | グローバル安全装置チェック |
| `checkInvestmentExtension` | [transition-logic.ts:146](src/lifecycle/transition-logic.ts#L146) | 投資延長チェック |
| `getSeoLevel` | [transition-logic.ts:28](src/lifecycle/transition-logic.ts#L28) | SEOレベル判定 |
| `determineBidAction` | [bid-integration.ts:245](src/lifecycle/bid-integration.ts#L245) | アクション決定 |
| `calculateRecommendedBid` | [bid-integration.ts:301](src/lifecycle/bid-integration.ts#L301) | 推奨入札額計算 |
| `generateBidRecommendations` | [bid-integration.ts:458](src/lifecycle/bid-integration.ts#L458) | 推奨生成 |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `LifecycleStage` | [types.ts:14](src/lifecycle/types.ts#L14) | ライフサイクルステージ |
| `StrategyPattern` | [types.ts:23](src/lifecycle/types.ts#L23) | 戦略パターン |
| `ProductStrategy` | [types.ts:60](src/lifecycle/types.ts#L60) | 商品戦略 |
| `LifecycleTransitionInput` | [types.ts:259](src/lifecycle/types.ts#L259) | 遷移入力 |
| `LifecycleTransitionResult` | [types.ts:272](src/lifecycle/types.ts#L272) | 遷移結果 |
| `LifecycleConfig` | [types.ts:297](src/lifecycle/types.ts#L297) | ライフサイクル設定 |
| `DEFAULT_LIFECYCLE_CONFIG` | [types.ts:346](src/lifecycle/types.ts#L346) | デフォルト設定 |

---

## 4. 在庫ガード (Inventory Guard)

### 概要
在庫状況に応じた入札の自動調整（ハードキル・ソフトスロットル）

### ファイル構成
```
src/inventory/
├── index.ts              # エクスポート
├── types.ts              # 型定義
├── inventoryRepository.ts # 在庫情報取得
└── inventoryGuard.ts     # ガードロジック
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `applyInventoryGuard` | [inventoryGuard.ts:234](src/inventory/inventoryGuard.ts#L234) | 在庫ガード適用（統合） |
| `applyHardKill` | [inventoryGuard.ts:62](src/inventory/inventoryGuard.ts#L62) | ハードキル適用 |
| `calculateSoftThrottleParams` | [inventoryGuard.ts:126](src/inventory/inventoryGuard.ts#L126) | ソフトスロットル計算 |
| `extractInventoryGuardConfig` | [inventoryGuard.ts:315](src/inventory/inventoryGuard.ts#L315) | 設定抽出 |
| `calculateInventoryRiskStatus` | [inventoryRepository.ts:61](src/inventory/inventoryRepository.ts#L61) | リスクステータス計算 |
| `createInventoryRepository` | [inventoryRepository.ts:253](src/inventory/inventoryRepository.ts#L253) | リポジトリ作成 |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `InventoryRiskStatus` | [types.ts:22](src/inventory/types.ts#L22) | リスクステータス |
| `AsinInventorySnapshot` | [types.ts:61](src/inventory/types.ts#L61) | 在庫スナップショット |
| `INVENTORY_GUARD_DEFAULTS` | [types.ts:105](src/inventory/types.ts#L105) | デフォルト値 |
| `InventoryGuardMode` | [types.ts:158](src/inventory/types.ts#L158) | ガードモード |
| `OutOfStockBidPolicy` | [types.ts:191](src/inventory/types.ts#L191) | 在庫切れ時ポリシー |
| `InventoryGuardResult` | [types.ts:220](src/inventory/types.ts#L220) | ガード結果 |

---

## 5. 自動ガードレール (Auto Guardrails)

### 概要
履歴データに基づく入札上下限の自動計算

### ファイル構成
```
src/guardrails/
├── index.ts              # エクスポート
└── auto-guardrails.ts    # 自動ガードレール計算
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `applyGuardrails` | [auto-guardrails.ts:706](src/guardrails/auto-guardrails.ts#L706) | ガードレール適用 |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `RecomputeGuardrailsOptions` | [auto-guardrails.ts:28](src/guardrails/auto-guardrails.ts#L28) | 再計算オプション |
| `RecomputeGuardrailsResult` | [auto-guardrails.ts:40](src/guardrails/auto-guardrails.ts#L40) | 再計算結果 |
| `ApplyGuardrailsInput` | [auto-guardrails.ts:657](src/guardrails/auto-guardrails.ts#L657) | 適用入力 |
| `ApplyGuardrailsResult` | [auto-guardrails.ts:682](src/guardrails/auto-guardrails.ts#L682) | 適用結果 |

---

## 6. ネガティブキーワード候補 (Negative Keywords)

### 概要
統計的安全性に基づくネガティブキーワード候補検出（SHADOWモード専用）

### ファイル構成
```
src/negative-keywords/
├── index.ts                      # エクスポート
├── types.ts                      # 型定義
└── negative-keyword-calculator.ts # 計算ロジック
```

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `NegativeKeywordSuggestion` | [types.ts](src/negative-keywords/types.ts) | 候補型 |

---

## 7. AUTO→EXACT昇格 (Auto-Exact Promotion)

### 概要
AUTOキャンペーンからEXACTキーワードへの昇格候補検出（SHADOWモード専用）

### ファイル構成
```
src/auto-exact/
├── index.ts                      # エクスポート
├── types.ts                      # 型定義
├── auto-exact-promotion-engine.ts # 昇格候補計算（純粋関数）
└── auto-exact-promotion-job.ts   # BigQueryジョブ実行
```

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `PromotionCandidate` | [types.ts:239](src/auto-exact/types.ts#L239) | 昇格候補 |
| `PromotionCandidatesResult` | [types.ts:466](src/auto-exact/types.ts#L466) | 計算結果 |
| `RunAutoExactPromotionJobOptions` | [auto-exact-promotion-job.ts:528](src/auto-exact/auto-exact-promotion-job.ts#L528) | ジョブオプション |

---

## 8. SEO指標 (SEO Metrics)

### 概要
オーガニック検索順位の取得と分析

### ファイル構成
```
src/seo/
├── index.ts       # エクスポート
├── types.ts       # 型定義
└── seoMetrics.ts  # SEO指標計算
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `calculateSeoMetrics` | [seoMetrics.ts:79](src/seo/seoMetrics.ts#L79) | SEO指標計算 |
| `determineRankStatus` | [seoMetrics.ts:29](src/seo/seoMetrics.ts#L29) | ランクステータス判定 |
| `determineRankZone` | [seoMetrics.ts:51](src/seo/seoMetrics.ts#L51) | ランクゾーン判定 |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `RankStatus` | [types.ts:40](src/seo/types.ts#L40) | ランクステータス |
| `RankZone` | [types.ts:45](src/seo/types.ts#L45) | ランクゾーン |
| `SeoMetrics` | [types.ts:55](src/seo/types.ts#L55) | SEO指標 |
| `RANK_ZONE_THRESHOLDS` | [types.ts:19](src/seo/types.ts#L19) | ゾーン閾値 |

---

## 9. ProductConfig管理

### 概要
商品設定のSingle Source of Truth

### ファイル構成
```
src/config/
├── index.ts                  # エクスポート
├── productConfigTypes.ts     # 型定義（Single Source of Truth）
├── productConfigValidator.ts # バリデーション
├── productConfigRepository.ts # リポジトリパターン
├── productConfigLoader.ts    # レガシーローダー
└── slack.ts                  # Slack設定
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `validateProductConfig` | [productConfigValidator.ts:777](src/config/productConfigValidator.ts#L777) | 設定バリデーション |
| `validateAllProductConfigs` | [productConfigValidator.ts:827](src/config/productConfigValidator.ts#L827) | 一括バリデーション |
| `createProductConfigRepository` | [productConfigRepository.ts:305](src/config/productConfigRepository.ts#L305) | リポジトリ作成 |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `ProductConfig` | [productConfigTypes.ts:301](src/config/productConfigTypes.ts#L301) | 商品設定 |
| `LifecycleState` | [productConfigTypes.ts:20](src/config/productConfigTypes.ts#L20) | ライフサイクルステージ |
| `RevenueModel` | [productConfigTypes.ts:52](src/config/productConfigTypes.ts#L52) | 収益モデル |
| `LtvMode` | [productConfigTypes.ts:83](src/config/productConfigTypes.ts#L83) | LTVモード |
| `BusinessMode` | [productConfigTypes.ts:113](src/config/productConfigTypes.ts#L113) | ビジネスモード |
| `PRODUCT_CONFIG_DEFAULTS` | [productConfigTypes.ts:450](src/config/productConfigTypes.ts#L450) | デフォルト値 |
| `PRODUCT_CONFIG_BOUNDS` | [productConfigTypes.ts:481](src/config/productConfigTypes.ts#L481) | 値範囲 |

---

## 10. ロギング・シャドウモード

### 概要
実行ログ記録とシャドウ/APPLYモード管理

### ファイル構成
```
src/logging/
├── index.ts           # エクスポート
├── types.ts           # 型定義
├── executionLogger.ts # 実行ログ記録
└── shadowMode.ts      # シャドウモード管理
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `createExecutionLogger` | [executionLogger.ts:381](src/logging/executionLogger.ts#L381) | ロガー作成 |
| `getExecutionMode` | [shadowMode.ts:38](src/logging/shadowMode.ts#L38) | 実行モード取得 |
| `isShadowMode` | [shadowMode.ts:71](src/logging/shadowMode.ts#L71) | シャドウモード判定 |
| `isApplyMode` | [shadowMode.ts:80](src/logging/shadowMode.ts#L80) | APPLYモード判定 |
| `logExecutionModeOnStartup` | [shadowMode.ts:171](src/logging/shadowMode.ts#L171) | 起動時ログ |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `ExecutionMode` | [types.ts:14](src/logging/types.ts#L14) | 実行モード |
| `ExecutionStatus` | [types.ts:19](src/logging/types.ts#L19) | 実行ステータス |
| `ReasonCode` | [types.ts:72](src/logging/types.ts#L72) | 理由コード |
| `ExecutionLogEntry` | [types.ts:33](src/logging/types.ts#L33) | 実行ログエントリ |
| `KeywordRecommendationLogEntry` | [types.ts:91](src/logging/types.ts#L91) | キーワード推奨ログ |

---

## 11. Slack通知

### 概要
実行サマリーやライフサイクル変更のSlack通知

### ファイル構成
```
src/slack/
├── index.ts                     # エクスポート
└── executionSummaryNotifier.ts  # 実行サマリー通知

src/lib/
├── slackNotifier.ts             # Slackクライアント
└── lifecycleNotifier.ts         # ライフサイクル通知
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `notifyLifecycleChange` | [lifecycleNotifier.ts:43](src/lib/lifecycleNotifier.ts#L43) | ステージ変更通知 |
| `notifyForcedHarvest` | [lifecycleNotifier.ts:84](src/lib/lifecycleNotifier.ts#L84) | 強制HARVEST通知 |
| `notifyLifecycleUpdateSummary` | [lifecycleNotifier.ts:143](src/lib/lifecycleNotifier.ts#L143) | 更新サマリー通知 |

---

## 12. 適応型E-Score (Adaptive E-Score) ⚠️未ドキュメント

### 概要
過去の結果に基づいてE-Score（成果・効率・ポテンシャル）の重みを自動最適化するシステム

### ファイル構成
```
src/adaptive-escore/
├── index.ts              # エクスポート
├── types.ts              # 型定義
├── config.ts             # 設定
├── escore-calculator.ts  # E-Score計算
├── success-evaluator.ts  # 成功評価
├── weight-optimizer.ts   # 重み最適化
├── safety-manager.ts     # 安全機構（異常検知・ロールバック）
├── bigquery-adapter.ts   # BigQuery連携
└── optimization-runner.ts # 最適化ランナー
```

### 主要機能
- E-Score計算（成果・効率・ポテンシャルの重み付け）
- フィードバックループによる重み自動最適化
- 異常検知とロールバック機能
- モード別・ブランドタイプ別・季節別の重み管理

### 主要型定義

| 型名 | ファイル | 説明 |
|------|----------|------|
| `EScoreWeights` | [types.ts](src/adaptive-escore/types.ts) | E-Score重み |
| `EScoreResult` | [types.ts](src/adaptive-escore/types.ts) | E-Score結果 |
| `FeedbackRecord` | [types.ts](src/adaptive-escore/types.ts) | フィードバック記録 |
| `AdaptiveEScoreConfig` | [types.ts](src/adaptive-escore/types.ts) | 適応設定 |

### APIルート
- `POST /escore/calculate` - E-Score計算
- `POST /escore/optimize` - 重み最適化
- `GET /escore/health` - ヘルスチェック

---

## 13. Jungle Scout連携 ⚠️未ドキュメント

### 概要
Jungle Scout APIを使用したキーワードインテリジェンスと戦略分析

### ファイル構成
```
src/jungle-scout/
├── index.ts              # エクスポート
├── types.ts              # 型定義
├── client.ts             # APIクライアント
├── bigquery-adapter.ts   # BigQuery連携
└── strategy-analyzer.ts  # 戦略分析
```

### 主要機能
- キーワードインテリジェンス取得
- シェア・オブ・ボイス分析
- 検索ボリューム履歴
- 戦略分析・推奨

### 主要関数

| 関数名 | ファイル | 責務 |
|--------|----------|------|
| `createJungleScoutClient` | [client.ts](src/jungle-scout/client.ts) | クライアント作成 |
| `analyzeKeywordStrategy` | [strategy-analyzer.ts](src/jungle-scout/strategy-analyzer.ts) | 戦略分析 |
| `saveKeywordIntelligence` | [bigquery-adapter.ts](src/jungle-scout/bigquery-adapter.ts) | インテリジェンス保存 |

### APIルート
- `POST /jungle-scout/keywords` - キーワード情報取得
- `POST /jungle-scout/strategy` - 戦略分析

---

## 14. 統合入札戦略 (Unified Strategy) ⚠️未ドキュメント

### 概要
Jungle Scout（市場データ）+ SP-API（商品収益性）+ Amazon Ads（広告パフォーマンス）を統合した入札戦略

### ファイル構成
```
src/unified-strategy/
├── index.ts               # エクスポート
├── types.ts               # 型定義
├── config.ts              # 設定・戦略マトリクス
├── strategy-calculator.ts # 戦略計算
├── bigquery-adapter.ts    # BigQuery連携
└── seo-investment.ts      # SEO投資戦略（赤字許容モード）
```

### 主要機能
- 動的ACOS計算
- 優先度スコア計算
- 統合戦略算出
- SEO投資戦略（赤字許容モード）

### 主要関数

| 関数名 | ファイル | 責務 |
|--------|----------|------|
| `calculateDynamicAcos` | [strategy-calculator.ts](src/unified-strategy/strategy-calculator.ts) | 動的ACOS計算 |
| `calculateUnifiedStrategy` | [strategy-calculator.ts](src/unified-strategy/strategy-calculator.ts) | 統合戦略計算 |
| `evaluateSeoInvestmentOpportunity` | [seo-investment.ts](src/unified-strategy/seo-investment.ts) | SEO投資機会評価 |
| `calculateSeoInvestmentAcosLimit` | [seo-investment.ts](src/unified-strategy/seo-investment.ts) | SEO投資ACOS上限計算 |

### APIルート
- `POST /unified-strategy/calculate` - 統合戦略計算
- `GET /unified-strategy/summary/:asin` - 戦略サマリー
- `POST /seo-investment/evaluate` - SEO投資評価

---

## 15. 共通ユーティリティ

### エラーハンドリング

```
src/errors/
└── index.ts              # カスタムエラークラス・統一レスポンス
```

| クラス/関数名 | 責務 |
|--------------|------|
| `AppError` | 基底エラークラス（retryable, statusCode等を保持） |
| `AuthenticationError` | 認証エラー（401） |
| `AuthorizationError` | 認可エラー（403） |
| `ValidationError` | バリデーションエラー（400） |
| `NotFoundError` | リソース未検出（404） |
| `RateLimitError` | レート制限（429） |
| `AmazonAdsApiError` | Amazon Ads APIエラー |
| `BigQueryError` | BigQueryエラー |
| `CircuitOpenError` | サーキットオープンエラー（503） |
| `ConfigurationError` | 設定エラー |
| `ApiResponseBuilder` | 統一レスポンスビルダー |
| `isRetryableError` | リトライ可能判定 |
| `getRetryDelayMs` | リトライ待機時間取得 |
| `toAppError` | 汎用ErrorをAppErrorに変換 |

### 型安全なフィールドマッピング

```
src/utils/field-mapper.ts
```

| 関数名 | 責務 |
|--------|------|
| `getFieldValue` | 複数候補から値を取得 |
| `getString` | 文字列として取得 |
| `getNumber` | 数値として取得 |
| `getInteger` | 整数として取得 |
| `getBoolean` | 真偽値として取得 |
| `getDate` | 日付として取得 |
| `getArray` | 配列として取得 |
| `ObjectMapper` | 型安全なオブジェクトマッパークラス |
| `mapWithSchema` | Zodスキーマ検証付きマッピング |
| `mapManyWithSchema` | 配列のZodスキーマ検証付きマッピング |
| `snakeToCamel` | snake_case → camelCase変換 |
| `camelToSnake` | camelCase → snake_case変換 |
| `convertKeysToCamel` | オブジェクトキー一括変換（camelCase） |
| `convertKeysToSnake` | オブジェクトキー一括変換（snake_case） |
| `bothCases` | snake_case/camelCase両方の配列生成 |
| `assertInRange` | 数値範囲検証 |
| `assertPositive` | 正の数検証 |
| `assertOneOf` | 許可リスト検証 |

### 外部APIスキーマ

```
src/schemas/
└── external-api.ts       # 外部APIレスポンスのZodスキーマ
```

| スキーマ名 | 責務 |
|-----------|------|
| `AmazonKeywordReportSchema` | Amazon Ads キーワードレポート検証 |
| `AmazonCampaignSchema` | Amazon Ads キャンペーン検証 |
| `AmazonBidUpdateResponseSchema` | 入札更新レスポンス検証 |
| `BigQueryNegativeSuggestionSchema` | ネガティブ候補検証 |
| `BigQueryAutoExactCandidateSchema` | AUTO→EXACT候補検証 |
| `BigQueryProductMetricsSchema` | 商品メトリクス検証 |

### リトライ・サーキットブレーカー

```
src/utils/retry.ts
```

| 関数名 | 責務 |
|--------|------|
| `withRetry` | リトライ付き実行（サーキットブレーカー統合） |
| `withTimeout` | タイムアウト付き実行 |
| `withRetryAndTimeout` | リトライ+タイムアウト実行 |
| `getCircuitBreakerStatus` | ブレーカー状態取得 |
| `getAllCircuitBreakerStatuses` | 全ブレーカー状態取得 |
| `resetCircuitBreaker` | ブレーカーリセット |

### 通知ユーティリティ

```
src/utils/notification.ts
```

| 関数名 | 責務 |
|--------|------|
| `configureNotifications` | 通知設定 |
| `getNotificationConfig` | 設定取得 |

### ロガー

```
src/logger.ts
```

| エクスポート | 責務 |
|-------------|------|
| `logger` | 構造化ロガー（シングルトン） |
| `createChildLogger` | 子ロガー作成 |

### 定数

```
src/constants.ts
```

| 定数グループ | 責務 |
|-------------|------|
| `CVR_THRESHOLDS` | CVR閾値 |
| `ACOS_THRESHOLDS` | ACOS閾値 |
| `RISK_THRESHOLDS` | リスク閾値 |
| `BID_LIMITS` | 入札上下限 |
| `COEFFICIENTS` | 各種係数 |

---

## 16. APIルート

### ルート一覧

| ファイル | パス | 責務 |
|----------|------|------|
| [health.ts](src/routes/health.ts) | `GET /health` | ヘルスチェック |
| [cron.ts](src/routes/cron.ts) | `POST /cron/*` | 定期実行 |
| [executions.ts](src/routes/executions.ts) | `/executions` | 実行履歴 |
| [lifecycle.ts](src/routes/lifecycle.ts) | `/lifecycle` | ライフサイクル管理 |
| [debug.ts](src/routes/debug.ts) | `/debug` | デバッグ |
| [negative-suggestions.ts](src/routes/negative-suggestions.ts) | `/negative-suggestions` | ネガティブ候補 |
| [escore.ts](src/routes/escore.ts) | `/escore` | E-Score API |
| [jungle-scout.ts](src/routes/jungle-scout.ts) | `/jungle-scout` | Jungle Scout API |
| [unified-strategy.ts](src/routes/unified-strategy.ts) | `/unified-strategy` | 統合戦略 |
| [seo-investment.ts](src/routes/seo-investment.ts) | `/seo-investment` | SEO投資 |
| [backtest.ts](src/routes/backtest.ts) | `/backtest` | バックテスト |

---

## 17. バックテスト (Backtest)

### 概要
過去データを使って入札エンジンの成果をシミュレーションし、「このエンジンを使っていたら実際と比べてどれだけ成果が改善していたか」を定量的に証明する機能

### ファイル構成
```
src/backtest/
├── index.ts                # エクスポート
├── types.ts                # 型定義
├── backtest-calculator.ts  # シミュレーション計算（純粋関数）
├── backtest-engine.ts      # メインエンジン
├── bigquery-adapter.ts     # BigQuery連携
└── report-generator.ts     # Slack通知・レポート生成

tests/
└── backtest-calculator.test.ts  # ユニットテスト
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `runBacktest` | [backtest-engine.ts:59](src/backtest/backtest-engine.ts#L59) | バックテスト実行のエントリポイント |
| `runWeeklyBacktest` | [backtest-engine.ts:287](src/backtest/backtest-engine.ts#L287) | 週次バックテスト（定期実行用） |
| `simulateKeywordDay` | [backtest-calculator.ts:33](src/backtest/backtest-calculator.ts#L33) | キーワード×日のシミュレーション |
| `evaluateDecisionCorrectness` | [backtest-calculator.ts:144](src/backtest/backtest-calculator.ts#L144) | 判定精度評価 |
| `aggregateByDay` | [backtest-calculator.ts:256](src/backtest/backtest-calculator.ts#L256) | 日別集計 |
| `calculateDecisionAccuracy` | [backtest-calculator.ts:353](src/backtest/backtest-calculator.ts#L353) | 判定精度計算 |
| `sendBacktestNotification` | [report-generator.ts:19](src/backtest/report-generator.ts#L19) | Slack通知送信 |
| `generateConsoleReport` | [report-generator.ts:118](src/backtest/report-generator.ts#L118) | コンソールレポート生成 |
| `exportTimeSeriesDataToCsv` | [report-generator.ts:190](src/backtest/report-generator.ts#L190) | CSV出力 |

### 型定義

| 型名 | ファイル:行 | 説明 |
|------|-------------|------|
| `BacktestConfig` | [types.ts:16](src/backtest/types.ts#L16) | バックテスト設定 |
| `BacktestParameters` | [types.ts:32](src/backtest/types.ts#L32) | シミュレーションパラメータ |
| `BacktestResult` | [types.ts:321](src/backtest/types.ts#L321) | バックテスト結果 |
| `HistoricalRecommendation` | [types.ts:71](src/backtest/types.ts#L71) | 過去の入札推奨ログ |
| `HistoricalPerformance` | [types.ts:117](src/backtest/types.ts#L117) | 過去の実績データ |
| `SimulatedResult` | [types.ts:161](src/backtest/types.ts#L161) | シミュレーション結果 |
| `DecisionAccuracy` | [types.ts:256](src/backtest/types.ts#L256) | 判定精度 |
| `ImprovementSummary` | [types.ts:305](src/backtest/types.ts#L305) | 改善率サマリー |

### APIエンドポイント

| メソッド | パス | 責務 |
|----------|------|------|
| POST | `/backtest/run` | バックテスト実行 |
| GET | `/backtest/executions` | 実行一覧取得 |
| GET | `/backtest/executions/:id` | 詳細結果取得 |
| GET | `/backtest/executions/:id/export` | JSON/CSVエクスポート |
| POST | `/backtest/setup` | テーブル作成 |
| POST | `/backtest/weekly` | 週次実行 |

---

## 18. プロ戦略 (Pro Strategies)

### 概要
Amazon広告のプロフェッショナルな運用ノウハウを実装した戦略モジュール。
8つの戦略を提供：アンカーキーワード、Revenue-Based Bid、ローンチモード最適化、SKU選択、季節性追随、Bidding Lifecycle、キャンペーン保護、商品レベル TACOS コントローラ。

### ファイル構成
```
src/strategies/
├── index.ts              # エクスポート
└── pro-strategies.ts     # プロ戦略ロジック
```

### 主要関数

| 関数名 | ファイル:行 | 責務 |
|--------|-------------|------|
| `calculateAnchorKeywordScore` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | アンカーキーワードスコア計算 |
| `identifyAnchorKeywords` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | アンカーキーワード一括判定 |
| `calculateRevenueBasedBid` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | Revenue-Based Bid計算（詳細版） |
| `calculateRevenueBasedBidSimple` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | Revenue-Based Bid計算（シンプル版） |
| `calculateLaunchModeConfig` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | ローンチモード設定計算 |
| `calculateLaunchBidAdjustment` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | ローンチ時入札調整 |
| `calculateSkuPerformanceScore` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | SKUパフォーマンススコア計算 |
| `recommendAdSku` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 広告SKU推奨 |
| `determineDemandPhase` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 需要フェーズ判定 |
| `determineBiddingLifecycle` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | Biddingライフサイクルフェーズ判定 |
| `calculateBiddingLifecycleCoeff` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | ライフサイクル係数計算 |
| `calculateCampaignHealth` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | キャンペーン健全性計算 |
| `validateCampaignChange` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | キャンペーン変更検証 |
| `calculateLtvMultiplierStage` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | LTV倍率計算（ステージ別） |
| `calculateTargetTacosStage` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 目標TACOS計算（ステージ別） |
| `calculateProductBidMultiplier` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 商品レベル入札係数計算（詳細版） |
| `calculateProductBidMultiplierSimple` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 商品レベル入札係数計算（シンプル版） |
| `evaluateKeywordWithStrategies` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 統合キーワード評価 |

### 型定義

| 型名 | ファイル | 説明 |
|------|----------|------|
| `AnchorKeywordInput` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | アンカーKW入力 |
| `AnchorKeywordResult` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | アンカーKW結果 |
| `RevenueBasedBidInput` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | Revenue-Based Bid入力 |
| `RevenueBasedBidResult` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | Revenue-Based Bid結果 |
| `LaunchModeConfig` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | ローンチモード設定 |
| `SkuPerformance` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | SKUパフォーマンス |
| `RecommendedAdSku` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 推奨SKU |
| `DemandFollowingInput` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 季節性入力 |
| `DemandFollowingResult` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 季節性結果 |
| `BiddingLifecyclePhase` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | Biddingライフサイクルフェーズ |
| `BiddingLifecycleInput` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | Biddingライフサイクル入力 |
| `BiddingLifecycleResult` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | Biddingライフサイクル結果 |
| `CampaignHealthInput` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | キャンペーン健全性入力 |
| `CampaignProtection` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | キャンペーン保護 |
| `ProductLifecycleStage` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 商品ライフサイクルステージ |
| `TacosControllerInput` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | TACOSコントローラ入力 |
| `TacosControllerResult` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | TACOSコントローラ結果 |
| `TacosControllerConfig` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | TACOSコントローラ設定 |
| `TacosZone` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | TACOSゾーン判定結果 |
| `IntegratedKeywordEvaluation` | [pro-strategies.ts](src/strategies/pro-strategies.ts) | 統合評価結果 |

### 戦略一覧

| 戦略 | 概要 | 主要機能 |
|------|------|----------|
| **1. アンカーKW戦略** | CVRがカテゴリ平均の1.5倍以上のキーワードを特定 | スコア計算、候補判定 |
| **2. Revenue-Based Bid** | 収益ベースで理論的な入札上限を算出 | maxBid = avgOrderValue × CVR × targetACOS |
| **3. ローンチ最適化** | 発売後14日間の攻めの入札戦略 | ACOS許容度3倍、インプレッション目標 |
| **4. SKU選択** | 広告パフォーマンスが最高のSKUを推奨 | CTR×CVR×インプレッション係数 |
| **5. 季節性追随** | 前年比で需要フェーズを判定 | RISING/PEAK/POST_PEAK/OFF_SEASON |
| **6. Bidding Lifecycle** | キーワードの成熟度に応じた係数計算 | LEARNING→RAMPING→MATURE→DECLINING |
| **7. キャンペーン保護** | 好調キャンペーンの構造変更を制限 | ROAS改善中は保護フラグ |
| **8. TACOS コントローラ** | 商品レベルのTACOSに基づく入札係数 | ゾーン判定、LTV倍率、目標TACOS計算 |

---

## 未ドキュメント機能まとめ

以下の機能は `architecture.md` / `bid_core.md` に記載がありません：

| モジュール | 状態 | 推奨アクション |
|-----------|------|---------------|
| `adaptive-escore/` | 実装済み・未ドキュメント | architecture.mdに追加が必要 |
| `jungle-scout/` | 実装済み・未ドキュメント | architecture.mdに追加が必要 |
| `unified-strategy/` | 実装済み・未ドキュメント | architecture.mdに追加が必要 |
| `errors/` | 実装済み・ドキュメント済み | architecture.md セクション16に記載 |
| `utils/retry.ts` | 実装済み・ドキュメント済み | architecture.md セクション16に記載 |
| `utils/field-mapper.ts` | 実装済み・ドキュメント済み | architecture.md セクション16に記載 |
| `schemas/external-api.ts` | 実装済み・ドキュメント済み | architecture.md セクション16に記載 |
| `lib/lifecycleNotifier.ts` | 実装済み・未ドキュメント | slack/モジュールに統合記載 |

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2025-11-26 | 初版作成。在庫ガード追加後の全機能マッピング |
| 2025-11-26 | エラーハンドリング・型安全マッピング追加（errors/, field-mapper.ts, external-api.ts） |
| 2025-11-26 | バックテスト機能追加（backtest/, routes/backtest.ts） |
| 2025-11-27 | プロ戦略モジュール追加（strategies/pro-strategies.ts） |
| 2025-11-27 | プロ戦略：Revenue-Based Bid、Bidding Lifecycle、TACOSコントローラ追加 |

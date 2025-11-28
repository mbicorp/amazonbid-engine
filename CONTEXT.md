# CONTEXT.md - Amazon自動入札エンジン クイックリファレンス

## プロジェクトポインタ

### エントリーポイント
| ファイル | 説明 |
|---------|------|
| `src/server.ts` | HTTPサーバーエントリーポイント |
| `src/engine/index.ts` | 入札計算エンジンのメインエクスポート |
| `src/routes/cron.ts` | Cloud Run Jobsからのcronエンドポイント |

### コア機能
| モジュール | 説明 | 主要ファイル |
|-----------|------|-------------|
| 入札計算 | bid推奨値の算出 | `src/engine/index.ts` |
| ガードレール | 入札上限/下限制御 | `src/guardrails/auto-guardrails.ts` |
| LTV計算 | target_acos算出 | `src/ltv/ltv-calculator.ts` |
| APPLY制御 | 適用フィルタリング | `src/apply/apply-filter.ts` |
| 実行ログ | BigQuery書き込み | `src/logging/executionLogger.ts` |

### 拡張機能
| モジュール | 説明 | 主要ファイル |
|-----------|------|-------------|
| 季節性予測 | ピーク期間の入札調整 | `src/seasonality/predictor.ts` |
| 掲載位置最適化 | Placement別の最適化 | `src/placement/placement-engine.ts` |
| 日予算最適化 | Budget配分最適化 | `src/budget/budget-engine.ts` |
| AUTO→EXACT昇格 | 自動昇格候補検出 | `src/auto-exact/auto-exact-promotion-engine.ts` |
| 在庫ガード | 在庫状況による入札抑制 | `src/inventory/inventoryGuard.ts` |
| 適応型E-Score | 動的重み最適化 | `src/adaptive-escore/escore-calculator.ts` |
| 統合戦略 | 複合戦略計算 | `src/unified-strategy/strategy-calculator.ts` |

### 外部連携
| モジュール | 説明 | 主要ファイル |
|-----------|------|-------------|
| BigQuery | データ永続化 | `src/bigqueryClient.ts` |
| Slack | 通知送信 | `src/slack/executionSummaryNotifier.ts` |
| Jungle Scout | 市場データ取得 | `src/jungle-scout/client.ts` |

## ディレクトリマップ

```
amazon-bid-engine/
├── src/                    # ソースコード
│   ├── engine/             # 入札計算コア
│   ├── guardrails/         # 安全装置
│   ├── apply/              # APPLY制御
│   ├── logging/            # ログ機能
│   ├── slack/              # Slack通知
│   ├── seasonality/        # 季節性予測
│   ├── lifecycle/          # ライフサイクル管理
│   ├── ltv/                # LTV計算
│   ├── placement/          # 掲載位置最適化
│   ├── budget/             # 日予算最適化
│   ├── auto-exact/         # AUTO→EXACT昇格
│   ├── inventory/          # 在庫ガード
│   ├── adaptive-escore/    # 適応型E-Score
│   ├── unified-strategy/   # 統合戦略
│   ├── jungle-scout/       # Jungle Scout連携
│   ├── routes/             # HTTPルート
│   ├── jobs/               # バッチジョブ
│   ├── config/             # 設定管理
│   ├── lib/                # 共通ライブラリ
│   └── utils/              # ユーティリティ
├── tests/                  # テストファイル
├── docs/                   # ドキュメント
│   ├── architecture.md     # 全体アーキテクチャ
│   └── bid_core.md         # 入札コアロジック詳細
├── sql/                    # SQLスキーマ・ビュー
│   └── views/              # BigQueryビュー定義
├── dist/                   # ビルド出力
└── scripts/                # 運用スクリプト
```

## 設定ファイル

| ファイル | 用途 |
|---------|------|
| `package.json` | 依存関係・スクリプト |
| `tsconfig.json` | TypeScript設定 |
| `jest.config.js` | テスト設定（存在する場合） |
| `.env` | 環境変数（gitignore対象） |

## テストファイル対応表

| テストファイル | テスト対象 |
|---------------|-----------|
| `tests/compute-bid-recommendations.test.ts` | 入札計算メイン |
| `tests/ltv-calculator.test.ts` | LTV計算 |
| `tests/auto-exact-promotion-engine.test.ts` | AUTO→EXACT昇格 |
| `tests/inventory-guard.test.ts` | 在庫ガード |
| `tests/dayparting.test.ts` | 時間帯別入札 |
| `tests/seasonality.test.ts` | 季節性予測 |
| `tests/keyword-discovery.test.ts` | キーワード発見 |
| `tests/ab-test.test.ts` | A/Bテスト |
| `tests/backtest-calculator.test.ts` | バックテスト |

## 主要な型定義

### 入札関連
- `BidRecommendation` - 入札推奨結果
- `BidContext` - 入札計算コンテキスト
- `ReasonCode` - 入札理由コード

### ライフサイクル
- `LifecycleState` - キーワード状態（LEARNING, GROWTH, MATURE, DECLINE）
- `LifecycleSuggestion` - 状態遷移提案

### 実行管理
- `ExecutionMode` - SHADOW/APPLY
- `ExecutionStatus` - RUNNING/SUCCESS/ERROR/PARTIAL_ERROR

## HTTPエンドポイント概要

| パス | メソッド | 説明 |
|-----|---------|------|
| `/health` | GET | ヘルスチェック |
| `/cron/bid-recommendations` | POST | 入札推奨バッチ |
| `/cron/seasonality-update` | POST | 季節性予測更新 |
| `/cron/lifecycle-update` | POST | ライフサイクル更新 |
| `/api/escore/*` | - | E-Score関連API |
| `/api/unified-strategy/*` | - | 統合戦略API |

## クイックスタート

```bash
# 依存関係インストール
npm install

# ビルド
npm run build

# テスト実行
npm test

# 型チェック
npm run lint

# 開発サーバー起動
npm start
```

## 環境変数チェックリスト

### 必須
- [ ] `GCP_PROJECT_ID`
- [ ] `BQ_DATASET`

### 推奨
- [ ] `EXECUTION_MODE` (デフォルト: SHADOW)
- [ ] `SLACK_WEBHOOK_URL`
- [ ] `ENABLE_SLACK_EXECUTION_SUMMARY_MODES`

### 外部API
- [ ] `JUNGLE_SCOUT_API_KEY`

## トラブルシューティング

### ビルドエラー
1. `npm run lint` で型エラー確認
2. `tsconfig.json` の設定確認
3. `node_modules` 削除後、再インストール

### テストエラー
1. 個別テスト実行で原因特定: `npx jest <test-file>`
2. モックの設定確認
3. 環境変数の設定確認

### BigQueryエラー
1. `GCP_PROJECT_ID` と `BQ_DATASET` 確認
2. 認証情報（GOOGLE_APPLICATION_CREDENTIALS）確認
3. データセット・テーブルの存在確認

### Slack通知が届かない
1. `SLACK_WEBHOOK_URL` 確認
2. `ENABLE_SLACK_EXECUTION_SUMMARY_MODES` に対象モードが含まれているか確認
3. `src/slack/executionSummaryNotifier.ts` のログ確認

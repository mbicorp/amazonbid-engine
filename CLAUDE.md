# CLAUDE.md - Amazon自動入札エンジン メンテナンスガイド

## プロジェクト概要

Amazon広告の自動入札エンジン。TypeScript/Node.js製のサーバーアプリケーションで、BigQueryとの連携、Cloud Run Jobs でのスケジュール実行、Slack通知機能を持つ。

## 安全ルール（MUST）

### 絶対禁止事項
1. **APPLYモードでのテスト実行禁止** - 本番広告費に直接影響する
2. **BigQueryの本番データセット（`amazon_bid_engine`）への直接DELETE/UPDATE禁止**
3. **`guardrails/`配下のロジック変更時はレビュー必須** - 入札上限/下限を守る安全装置
4. **環境変数の本番値をログ出力しない** - API_KEY, SLACK_WEBHOOK_URL等
5. **`src/apply/`のフィルタロジック緩和禁止** - 意図しない大量適用を防ぐ

### SHADOW/APPLYモード
- **SHADOW**: 計算のみ、実際の入札変更なし（開発・検証用）
- **APPLY**: 実際にAmazon Ads APIへ入札変更を適用（本番運用）
- 環境変数 `EXECUTION_MODE` で制御

## コード規約

### ディレクトリ構造
```
src/
├── engine/          # 入札計算コアロジック
├── guardrails/      # 入札制限・安全装置
├── apply/           # APPLY時のフィルタリング
├── logging/         # 実行ログ・BigQuery書き込み
├── slack/           # Slack通知
├── seasonality/     # 季節性予測機能
├── lifecycle/       # キーワードライフサイクル管理
├── ltv/             # LTV計算・target_acos算出
├── placement/       # 掲載位置最適化
├── budget/          # 日予算最適化
├── auto-exact/      # AUTO→EXACT昇格
├── inventory/       # 在庫ガード
├── adaptive-escore/ # 適応型E-Score最適化
├── unified-strategy/# 統合入札戦略
├── jungle-scout/    # Jungle Scout API連携
├── routes/          # HTTPエンドポイント
└── jobs/            # バッチジョブ
```

### 命名規則
- **ファイル名**: kebab-case（例: `bid-engine.ts`）
- **クラス/型**: PascalCase（例: `BidRecommendation`）
- **関数/変数**: camelCase（例: `computeBidRecommendation`）
- **定数**: UPPER_SNAKE_CASE（例: `DEFAULT_MIN_BID`）

### TypeScript規約
- strict modeを維持（`tsconfig.json`で設定済み）
- 型アノテーション必須（any禁止）
- Zodでランタイムバリデーション

### エラーハンドリング
- カスタムエラークラスを使用（`src/errors/`）
- ログは`src/logger.ts`経由
- BigQuery書き込み失敗は実行を止めない（通知のみ）

## テスト要件

### 実行コマンド
```bash
npm test              # 全テスト実行
npm run test:watch    # ウォッチモード
npm run test:coverage # カバレッジレポート
```

### テストファイル配置
- `tests/` ディレクトリに配置
- ファイル名: `*.test.ts`
- 対応するソースと同じ構造を維持

### テスト必須の機能
1. **入札計算ロジック** - `engine/`配下の変更時
2. **ガードレールロジック** - `guardrails/`配下の変更時
3. **LTV計算** - `ltv/`配下の変更時
4. **APPLYフィルタ** - `apply/`配下の変更時

## ドキュメント更新ルール

### 必須更新対象
TypeScriptファイルに変更があった場合、以下を必ず更新：

1. **`docs/architecture.md`** - 全体アーキテクチャ、機能一覧
2. **`docs/bid_core.md`** - 入札計算コアロジックの詳細

### 更新が必要なケース
- 新機能追加
- 既存ロジックの変更
- 設定パラメータの追加/変更
- reason_codeの追加
- BigQueryスキーマ変更

## ビルド・デプロイ

### ローカル開発
```bash
npm install          # 依存関係インストール
npm run build        # TypeScriptコンパイル
npm run lint         # 型チェック（--noEmit）
npm test             # テスト実行
```

### 本番デプロイ前チェックリスト
1. `npm run build` が成功すること
2. `npm test` が全パスすること
3. `npm run lint` でエラーがないこと
4. `docs/architecture.md` が最新であること

## 環境変数

### 必須
- `GCP_PROJECT_ID` - Google Cloudプロジェクト
- `BQ_DATASET` - BigQueryデータセット名

### オプション
- `EXECUTION_MODE` - SHADOW/APPLY（デフォルト: SHADOW）
- `SLACK_WEBHOOK_URL` - Slack通知用
- `ENABLE_SLACK_EXECUTION_SUMMARY_MODES` - 通知対象モード（カンマ区切り）
- `JUNGLE_SCOUT_API_KEY` - Jungle Scout API用

## BigQuery連携

### 主要テーブル
- `executions` - 実行ログ
- `bid_recommendations` - 入札推奨
- `keyword_recommendations_log` - キーワード単位の詳細ログ
- `auto_exact_promotion_suggestions` - AUTO→EXACT昇格候補
- `seasonality_predictions` - 季節性予測

### スキーマ変更時
1. `sql/`配下にマイグレーションSQL作成
2. `docs/architecture.md`の「BigQueryとの連携」セクション更新
3. 対応するリポジトリクラスの型定義更新

## 監視・アラート

### Slack通知
- 実行サマリー（ASIN別の入札変更傾向）
- エラー通知
- `src/slack/executionSummaryNotifier.ts`で実装

### ログ
- `src/logger.ts` - 統一ログ出力
- `src/logging/executionLogger.ts` - 実行ログのBigQuery書き込み

## よくある操作

### 新機能追加時
1. `src/`に機能モジュール作成
2. `tests/`にテスト追加
3. `src/routes/`にエンドポイント追加（必要に応じて）
4. `docs/architecture.md`に機能説明追加
5. `npm test && npm run build` で確認

### デバッグ時
1. `EXECUTION_MODE=SHADOW`で実行
2. BigQueryの`executions`テーブルで実行履歴確認
3. `keyword_recommendations_log`で詳細確認
4. Slackサマリーで傾向確認

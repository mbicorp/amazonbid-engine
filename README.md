# Amazon広告自動入札提案エンジン

Amazon広告の入札額を自動的に最適化するための提案エンジンです。3時間ごとに実行されることを想定しており、複数のキーワード指標を分析して各キーワードの入札提案を生成します。

## 特徴

- **通常日とセール日の切り替え**: 通常運用とセール期間で異なる入札戦略を適用
- **フェーズ管理**: セール前、セール中、セール終盤など、フェーズごとに最適化
- **TOS攻め**: Top of Search（検索結果上位）を狙うキーワードに対して積極的な入札
- **SEO投資戦略**: 赤字許容モードでオーガニック順位向上を狙う長期投資戦略
- **ライフサイクル管理**: LAUNCH → GROW → HARVESTの自動ステージ遷移とSEOスコア追跡
- **多次元分析**: CVR、ACOS、順位、競合状況、ブランドタイプなど複数の指標を総合評価
- **理由の可視化**: Facts → Logic → Impact の三段構造で判断根拠を明確化
- **Jungle Scout統合**: キーワードインテリジェンスとShare of Voice分析
- **リトライ・サーキットブレーカー**: 外部API障害時の自動復旧機能
- **Slack通知**: 重要イベントのリアルタイム通知

## インストール

```bash
npm install
```

## ビルド

```bash
npm run build
```

## テスト実行

```bash
npm test
```

## 使用例の実行

```bash
npm run example
```

## 環境変数設定

`.env`ファイルを作成し、以下の環境変数を設定してください：

```env
# Amazon Ads API
AMAZON_ADS_CLIENT_ID=
AMAZON_ADS_CLIENT_SECRET=
AMAZON_ADS_REFRESH_TOKEN=
AMAZON_ADS_PROFILE_ID=

# Jungle Scout API
# フォーマット: KEY_NAME:API_KEY
JUNGLE_SCOUT_API_KEY=your_api_key
JUNGLE_SCOUT_KEY_NAME=your_key_name
JUNGLE_SCOUT_MARKETPLACE=jp

# Google Cloud / BigQuery
GOOGLE_CLOUD_PROJECT_ID=
BIGQUERY_DATASET=

# API認証
API_KEY=

# Slack通知（ライフサイクル通知用）
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxx
SLACK_CHANNEL_AMAZON_TOOL=amazon_tool
```

## 基本的な使い方

```typescript
import { compute_bid_recommendations, KeywordMetrics, GlobalConfig } from './index';

// グローバル設定
const config: GlobalConfig = {
  mode: "S_MODE", // "NORMAL" または "S_MODE"
  manual_mode: false,

  max_change_rate_normal: 0.6,
  max_change_rate_smode_default: 1.5,
  max_change_rate_smode_tos: 2.0,

  min_clicks_for_decision: 5,
  min_clicks_for_confident: 20,
  min_clicks_for_tos: 40,

  acos_hard_stop_multiplier: 3.0,
  acos_soft_down_multiplier: 1.5,

  currency: "JPY"
};

// キーワード指標（実際のデータに置き換えてください）
const keywords: KeywordMetrics[] = [
  {
    keyword_id: "kw001",
    campaign_id: "camp001",
    ad_group_id: "ag001",
    phase_type: "S_PRE1",
    brand_type: "BRAND_OWN",
    score_rank: "S",
    current_bid: 150,
    baseline_cpc: 120,
    acos_target: 0.20,
    acos_actual: 0.15,
    // ... その他の指標
  }
];

// 入札推奨を計算
const recommendations = compute_bid_recommendations(keywords, config);

// 結果を処理
recommendations.forEach(rec => {
  console.log(`キーワード ${rec.keyword_id}: ${rec.action}`);
  console.log(`推奨入札額: ${rec.new_bid}円`);
  console.log(`理由: ${rec.reason_logic}`);
});
```

## モジュール構成

### コアロジック
- **types.ts**: 型定義
- **action-logic.ts**: アクション決定ロジック
- **coefficients.ts**: 各種係数計算
- **tos-logic.ts**: TOS判定ロジック
- **bid-calculation.ts**: 入札額計算とクリップ処理
- **reason-generator.ts**: 理由テキスト生成
- **index.ts**: メインエントリーポイント

### 統合戦略
- **src/unified-strategy/**: 統合入札戦略
  - **types.ts**: 統合戦略の型定義
  - **seo-investment.ts**: SEO投資戦略ロジック
  - **product-analyzer.ts**: 商品分析
  - **keyword-analyzer.ts**: キーワード分析

### ライフサイクル管理
- **src/lifecycle/**: 商品ライフサイクル管理
  - **types.ts**: ライフサイクル型定義
  - **transition-logic.ts**: ステージ遷移ロジック
  - **bid-integration.ts**: Bidエンジン統合
- **src/jobs/**: バッチジョブ
  - **aggregation/**: 集計ジョブ（60日メトリクス、SEOスコア計算）
  - **lifecycle/**: ライフサイクル更新ジョブ
- **src/bigquery/schemas/**: BigQueryスキーマ定義

### Jungle Scout統合
- **src/jungle-scout/**: Jungle Scout API クライアント
  - **client.ts**: APIクライアント（リトライ・サーキットブレーカー付き）
  - **types.ts**: API型定義

### APIサーバー
- **src/server.ts**: Express APIサーバー
- **src/routes/**: APIルート
  - **health.ts**: ヘルスチェック
  - **seo-investment.ts**: SEO投資エンドポイント
  - **cron.ts**: Cronジョブエンドポイント
  - **escore.ts**: E-score最適化
  - **jungle-scout.ts**: Jungle Scoutエンドポイント
  - **unified-strategy.ts**: 統合戦略エンドポイント

### Slack通知
- **src/config/slack.ts**: Slack設定
- **src/lib/slackNotifier.ts**: Slack通知クラス
- **src/lib/lifecycleNotifier.ts**: ライフサイクル通知ヘルパー

### ユーティリティ
- **src/utils/retry.ts**: リトライ・サーキットブレーカー
- **src/utils/notification.ts**: Slack通知（レガシー）
- **src/logger.ts**: 構造化ログ

## APIエンドポイント

### ヘルスチェック
```
GET /health
```

### SEO投資戦略
```
POST /api/seo-investment/evaluate
POST /api/seo-investment/update-state
GET /api/seo-investment/states/:asin
```

### Jungle Scout
```
GET /api/jungle-scout/keywords/:asin
POST /api/jungle-scout/share-of-voice
```

### 統合戦略
```
POST /api/unified-strategy/analyze
POST /api/unified-strategy/generate-recommendations
```

### Cronジョブ
```
POST /api/cron/run
```

### ライフサイクル管理
```
GET /lifecycle/products           # 投資モード商品サマリー
GET /lifecycle/keywords/:productId # キーワードメトリクス
POST /lifecycle/update            # ライフサイクル更新ジョブ
POST /lifecycle/products/:id/stage # 手動ステージ変更
POST /lifecycle/aggregation       # 集計ジョブ
GET /lifecycle/config             # 設定取得
```

## アクション種別

- **STRONG_UP**: 大幅引き上げ（パフォーマンス良好）
- **MILD_UP**: 引き上げ（改善傾向）
- **KEEP**: 維持（現状維持）
- **MILD_DOWN**: 引き下げ（効率化）
- **STRONG_DOWN**: 大幅引き下げ（パフォーマンス悪化）
- **STOP**: 停止（ACOS基準超過）

## フェーズタイプ

### 通常日
- **NORMAL**: 通常運用

### セール日
- **S_PRE1**: セール開始3時間前
- **S_PRE2**: セール開始1時間前
- **S_FREEZE**: セール開始直後（入札凍結）
- **S_NORMAL**: セール中
- **S_FINAL**: セール終了6時間前（最終攻め）
- **S_REVERT**: セール終了後（通常復帰）

## SEO投資戦略

オーガニック順位向上を目的とした長期投資戦略です。

### 投資フェーズ
- **initial**: 初期フェーズ（最大14日）- 高ACOS許容で露出増加
- **acceleration**: 加速フェーズ（最大60日）- 順位改善時に投資強化
- **maintenance**: 維持フェーズ - 達成順位の維持
- **exit**: 撤退フェーズ - 投資終了・収益化
- **abandoned**: 中止 - 効果なしで撤退

### 投資判定基準
- 検索ボリューム: 500以上
- 利益率: 15%以上
- 現在順位: 目標順位（10位）未達
- 競合SOV: 40%以下

### ACOS許容上限（利益率30%の場合）
- initial: 60%（利益率の2倍）
- acceleration: 45%（利益率の1.5倍）
- maintenance: 36%（利益率の1.2倍）
- exit: 33%（利益率の1.1倍）

## ライフサイクル管理

商品のライフサイクルステージを自動管理し、SEOスコアと月次利益に基づいて入札戦略を最適化します。

### ライフサイクルステージ
| ステージ | 説明 | ACOS許容度 |
|----------|------|------------|
| **LAUNCH_HARD** | 投資強度最大（赤字許容） | 基準×2.5倍 |
| **LAUNCH_SOFT** | やや赤字〜トントン | 基準×1.8倍 |
| **GROW** | バランス運用 | 基準×1.2倍 |
| **HARVEST** | 利益回収 | 基準×0.7倍 |

### SEOスコア
- **HIGH (70+)**: SEO順位良好
- **MID (40-69)**: SEO順位改善中
- **LOW (<40)**: SEO順位要改善

### 強制HARVESTトリガー
1. 累積赤字200万円超過
2. 2ヶ月連続赤字
3. レビュー評価3.0未満（レビュー数20以上）

詳細は [docs/LIFECYCLE.md](docs/LIFECYCLE.md) を参照

## スコアランク

- **S**: 最優秀（積極的に投資）
- **A**: 優秀（投資推奨）
- **B**: 標準（慎重に判断）
- **C**: 要改善（抑制的に）

## ブランドタイプ

- **BRAND_OWN**: 自社ブランド（積極的）
- **BRAND_CONQUEST**: 競合ブランド（慎重に）
- **GENERIC**: 一般キーワード（標準）

## TOS（Top of Search）攻め

以下の条件を満たすキーワードはTOS攻め対象となり、より積極的な入札が許可されます：

- S_MODEである
- 十分なクリック数（min_clicks_for_tos以上）
- 高いPriorityScore（0.8以上）
- TOSValue（tos_ctr_mult × tos_cvr_mult）が1.5以上
- TOS Gap CPCが正
- 低いリスクペナルティ（0.4以下）

さらに厳しい条件を満たすと200%上限が許可されます。

## 係数の役割

入札額の変化率は以下の係数を乗算して決定されます：

1. **Phase係数**: フェーズに応じた調整
2. **CVR係数**: コンバージョン率の変化に応じた調整
3. **Rank Gap係数**: 目標順位との差に応じた調整
4. **Competitor係数**: 競合の入札状況に応じた調整
5. **Brand係数**: ブランドタイプに応じた調整
6. **Risk係数**: リスクペナルティに応じた調整
7. **Stats係数**: データの信頼性に応じた調整
8. **TOS係数**: TOS攻め対象かどうかに応じた調整

## クリップ処理

最終的な入札額は以下の制約を受けます：

- **変化率上限**:
  - 通常日: 60%（max_change_rate_normal）
  - セール日: 150%（max_change_rate_smode_default）
  - TOS攻め: 200%（max_change_rate_smode_tos）

- **CPC上限**:
  - 現在入札額の3倍
  - 競合CPCの1.15倍
  - ベースラインCPCの2.5倍

  上記の最小値が上限となります。

## リトライ・サーキットブレーカー

外部API呼び出しには自動リトライとサーキットブレーカーが適用されます。

### リトライ設定
- 最大リトライ回数: 3回
- 基本待機時間: 1000ms
- 最大待機時間: 30000ms
- 指数バックオフ乗数: 2
- リトライ対象: 408, 429, 500, 502, 503, 504, ETIMEDOUT, ECONNRESET

### サーキットブレーカー
- 失敗しきい値: 5回
- リセットタイムアウト: 60秒
- ハーフオープン試行回数: 3回

## Slack通知

SLACK_BOT_TOKENを設定すると、以下のイベントが自動通知されます：

### ライフサイクル通知
- **ステージ変更通知**: LAUNCH_HARD → LAUNCH_SOFT → GROW → HARVEST の遷移時
- **強制HARVESTアラート**: 累積赤字超過、連続赤字、レビュー崩壊時
- **ジョブ完了サマリー**: ライフサイクル更新ジョブの実行結果

### 通知レベル
| レベル | 絵文字 | 用途 |
|--------|--------|------|
| info | ℹ️ | 通常のステージ変更、ジョブ完了 |
| warn | ⚠️ | HARVESTへの遷移、エラーありのジョブ完了 |
| error | 🚨 | 強制HARVESTアラート |

### ステージ日本語ラベル
| ステージ | 日本語 |
|----------|--------|
| LAUNCH_HARD | 立ち上げ（強） |
| LAUNCH_SOFT | 立ち上げ（弱） |
| GROW | 通常運用 |
| HARVEST | 回収モード |

### その他の通知
- サーキットブレーカーのトリップ
- 日次レポート
- 重大エラー

## 理由テキストの構造

各推奨には3つの理由テキストが付与されます：

1. **Facts（事実）**: 現在の指標値（入札額、CVR、ACOS、クリック数など）
2. **Logic（判断根拠）**: なぜそのアクションが選ばれたか
3. **Impact（影響予測）**: 推奨を適用した場合の期待される効果

## 実行前提

- この関数は**3時間ごと**に外部スケジューラから呼び出される想定
- KeywordMetricsの中身は呼び出し側で最新値を埋めて渡す
- この関数は**推奨値と理由**を返すのみ
- Amazon Ads APIへの実際の書き込みは別レイヤーで実装してください

## フェーズの切り替え

呼び出し側で、現在が通常日かセール日かを判定し、以下のように設定してください：

```typescript
// 通常日
config.mode = "NORMAL";
metrics.phase_type = "NORMAL";

// セール日
config.mode = "S_MODE";
// sale_start−3h付近
metrics.phase_type = "S_PRE1";
// sale_start−1h付近
metrics.phase_type = "S_PRE2";
// sale_start〜2h
metrics.phase_type = "S_FREEZE";
// それ以降〜残6h手前
metrics.phase_type = "S_NORMAL";
// 残6h〜終了
metrics.phase_type = "S_FINAL";
// 終了後〜翌日
metrics.phase_type = "S_REVERT";
```

## ライセンス

MIT

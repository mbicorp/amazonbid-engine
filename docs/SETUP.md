# セットアップガイド

## 前提条件

- Node.js 16.0.0 以上
- npm または yarn
- Google Cloud アカウント（BigQuery, Cloud Run 使用時）
- Amazon Ads API アカウント

---

## 1. ローカル開発環境のセットアップ

### 1.1 リポジトリのクローン

```bash
git clone https://github.com/your-org/amazon-bid-engine.git
cd amazon-bid-engine
```

### 1.2 依存関係のインストール

```bash
npm install
```

### 1.3 環境変数の設定

`.env` ファイルを作成します：

```bash
# .env

# ========================================
# Amazon Ads API設定（必須）
# ========================================
AMAZON_ADS_CLIENT_ID=your_client_id
AMAZON_ADS_CLIENT_SECRET=your_client_secret
AMAZON_ADS_REFRESH_TOKEN=your_refresh_token
AMAZON_ADS_PROFILE_ID=your_profile_id

# ========================================
# Amazon Ads APIベースURL（オプション）
# ========================================
# デフォルト: https://advertising-api.amazon.com
# 日本: https://advertising-api-fe.amazon.com
AMAZON_ADS_API_BASE_URL=https://advertising-api-fe.amazon.com

# ========================================
# サーバー設定（オプション）
# ========================================
PORT=8080
NODE_ENV=development

# ========================================
# BigQuery設定（オプション）
# ========================================
BIGQUERY_PROJECT_ID=your-gcp-project
BIGQUERY_DATASET_ID=amazon_bid_engine

# ========================================
# 認証設定（オプション）
# ========================================
API_KEY=your-secure-api-key
ENABLE_OIDC_AUTH=false
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project

# ========================================
# Slack通知設定（オプション）
# ========================================
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxx
SLACK_CHANNEL_AMAZON_TOOL=amazon_tool
```

### 1.4 ビルド

```bash
npm run build
```

### 1.5 サーバー起動

```bash
npm start
```

サーバーが `http://localhost:8080` で起動します。

---

## 2. テスト実行

### 2.1 全テスト実行

```bash
npm test
```

### 2.2 ウォッチモード

```bash
npm run test:watch
```

### 2.3 カバレッジ付き

```bash
npm run test:coverage
```

---

## 3. Amazon Ads API の設定

### 3.1 API アクセス申請

1. [Amazon Ads API](https://advertising.amazon.com/API) にアクセス
2. 開発者アカウントを作成
3. API アクセスを申請

### 3.2 認証情報の取得

1. **Client ID / Client Secret**: Amazon Developer Console で取得
2. **Refresh Token**: OAuth 2.0 フローで取得
3. **Profile ID**: 広告アカウントの識別子

### 3.3 リージョン別 API URL

| リージョン | ベースURL |
|-----------|----------|
| 北米 (NA) | `https://advertising-api.amazon.com` |
| 欧州 (EU) | `https://advertising-api-eu.amazon.com` |
| 極東 (FE) | `https://advertising-api-fe.amazon.com` |

日本のアカウントは **FE (Far East)** を使用します。

---

## 4. BigQuery の設定

### 4.1 データセット作成

```sql
CREATE SCHEMA IF NOT EXISTS `your-project.amazon_bid_engine`;
```

### 4.2 テーブル作成

**executions テーブル**

```sql
CREATE TABLE IF NOT EXISTS `your-project.amazon_bid_engine.executions` (
  execution_id STRING NOT NULL,
  mode STRING NOT NULL,
  trigger_type STRING NOT NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  duration_ms INT64,
  total_keywords INT64,
  reco_count INT64,
  action_strong_up INT64,
  action_up INT64,
  action_down INT64,
  action_stop INT64,
  action_keep INT64,
  status STRING NOT NULL,
  error_message STRING,
  config_snapshot STRING
);
```

**recommendations テーブル**

```sql
CREATE TABLE IF NOT EXISTS `your-project.amazon_bid_engine.recommendations` (
  execution_id STRING NOT NULL,
  mode STRING NOT NULL,
  keyword_id STRING,
  campaign_id STRING,
  ad_group_id STRING,
  action STRING,
  old_bid FLOAT64,
  new_bid FLOAT64,
  change_rate FLOAT64,
  clipped BOOL,
  clip_reason STRING,
  priority_score FLOAT64,
  rank_current INT64,
  rank_target INT64,
  cvr_recent FLOAT64,
  cvr_baseline FLOAT64,
  ctr_recent FLOAT64,
  ctr_baseline FLOAT64,
  acos_actual FLOAT64,
  acos_target FLOAT64,
  tos_targeted BOOL,
  tos_eligible_200 BOOL,
  base_change_rate FLOAT64,
  phase_coeff FLOAT64,
  cvr_coeff FLOAT64,
  rank_gap_coeff FLOAT64,
  competitor_coeff FLOAT64,
  brand_coeff FLOAT64,
  -- risk_coeff は stats_coeff に統合されました (v1.1.0)
  stats_coeff FLOAT64,
  tos_coeff FLOAT64,
  reason_facts STRING,
  reason_logic STRING,
  reason_impact STRING,
  created_at TIMESTAMP
);
```

**product_ltv_metrics テーブル**

```sql
CREATE TABLE IF NOT EXISTS `your-project.amazon_bid_engine.product_ltv_metrics` (
  asin STRING NOT NULL,
  product_id STRING NOT NULL,
  margin_rate FLOAT64 NOT NULL,
  expected_repeat_orders_assumed FLOAT64 NOT NULL DEFAULT 1.0,
  expected_repeat_orders_measured_180d FLOAT64,
  safety_factor_assumed FLOAT64 NOT NULL DEFAULT 0.7,
  safety_factor_measured FLOAT64 NOT NULL DEFAULT 0.85,
  launch_date DATE,
  new_customers_total INT64 NOT NULL DEFAULT 0,
  revenue_model STRING,
  last_ltv_updated_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),
  PRIMARY KEY (product_id) NOT ENFORCED
);
```

### 4.3 サービスアカウント設定

1. GCP Console でサービスアカウントを作成
2. BigQuery Data Editor 権限を付与
3. JSON キーをダウンロード
4. `GOOGLE_APPLICATION_CREDENTIALS` 環境変数に設定

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

---

## 5. Cloud Run へのデプロイ

### 5.1 Dockerfile

```dockerfile
FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/src/server.js"]
```

### 5.2 デプロイコマンド

```bash
# ビルド
npm run build

# Cloud Run にデプロイ
gcloud run deploy amazon-bid-engine \
  --source . \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-secrets "AMAZON_ADS_CLIENT_ID=amazon-ads-client-id:latest,AMAZON_ADS_CLIENT_SECRET=amazon-ads-client-secret:latest,AMAZON_ADS_REFRESH_TOKEN=amazon-ads-refresh-token:latest,AMAZON_ADS_PROFILE_ID=amazon-ads-profile-id:latest,API_KEY=api-key:latest"
```

### 5.3 Secret Manager の設定

機密情報は Secret Manager に保存します：

```bash
# シークレット作成
echo -n "your-client-id" | gcloud secrets create amazon-ads-client-id --data-file=-
echo -n "your-client-secret" | gcloud secrets create amazon-ads-client-secret --data-file=-
echo -n "your-refresh-token" | gcloud secrets create amazon-ads-refresh-token --data-file=-
echo -n "your-profile-id" | gcloud secrets create amazon-ads-profile-id --data-file=-
echo -n "your-api-key" | gcloud secrets create api-key --data-file=-
```

---

## 6. Cloud Scheduler の設定

### 6.1 OIDC 認証用サービスアカウント作成

```bash
gcloud iam service-accounts create scheduler-invoker \
  --display-name="Cloud Scheduler Invoker"

gcloud run services add-iam-policy-binding amazon-bid-engine \
  --member="serviceAccount:scheduler-invoker@your-project.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=asia-northeast1
```

### 6.2 Scheduler ジョブ作成

**NORMAL モード（毎時）**

```bash
gcloud scheduler jobs create http amazon-bid-normal-hourly \
  --schedule="0 * * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://amazon-bid-engine-xxxxx.run.app/cron/run-normal" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body="{}" \
  --oidc-service-account-email="scheduler-invoker@your-project.iam.gserviceaccount.com" \
  --oidc-token-audience="https://amazon-bid-engine-xxxxx.run.app"
```

**S_MODE（セール期間中、30分ごと）**

```bash
gcloud scheduler jobs create http amazon-bid-smode-30min \
  --schedule="*/30 * * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://amazon-bid-engine-xxxxx.run.app/cron/run-smode" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body="{}" \
  --oidc-service-account-email="scheduler-invoker@your-project.iam.gserviceaccount.com" \
  --oidc-token-audience="https://amazon-bid-engine-xxxxx.run.app"
```

---

## 7. GlobalConfig 設定値

### 7.1 デフォルト値

```typescript
const defaultConfig: GlobalConfig = {
  mode: "NORMAL",
  manual_mode: false,
  max_change_rate_normal: 0.6,        // 60%
  max_change_rate_smode_default: 1.5, // 150%
  max_change_rate_smode_tos: 2.0,     // 200%
  min_clicks_for_decision: 5,
  min_clicks_for_confident: 20,
  min_clicks_for_tos: 40,
  acos_hard_stop_multiplier: 3.0,
  acos_soft_down_multiplier: 1.5,
  currency: "JPY",
};
```

### 7.2 設定項目の説明

| 項目 | 型 | 説明 |
|------|------|------|
| `mode` | "NORMAL" \| "S_MODE" | 動作モード |
| `manual_mode` | boolean | 手動モード（推奨のみで自動適用しない） |
| `max_change_rate_normal` | number | NORMAL モードの最大変化率 |
| `max_change_rate_smode_default` | number | S_MODE 通常の最大変化率 |
| `max_change_rate_smode_tos` | number | S_MODE TOS攻めの最大変化率 |
| `min_clicks_for_decision` | number | 判断に必要な最小クリック数 |
| `min_clicks_for_confident` | number | 高信頼度判断に必要なクリック数 |
| `min_clicks_for_tos` | number | TOS攻め判断に必要なクリック数 |
| `acos_hard_stop_multiplier` | number | ACOS停止判定の乗数 |
| `acos_soft_down_multiplier` | number | ACOS減額判定の乗数 |
| `currency` | "JPY" \| "USD" | 通貨 |

---

## 8. トラブルシューティング

### 8.1 環境変数エラー

```
Error: Missing required environment variables: AMAZON_ADS_CLIENT_ID
```

→ 必要な環境変数が設定されていません。`.env` ファイルを確認してください。

### 8.2 BigQuery 接続エラー

```
Error: BigQuery connection failed
```

→ サービスアカウントの権限と `GOOGLE_APPLICATION_CREDENTIALS` を確認してください。

### 8.3 Amazon Ads API エラー

```
Error: Amazon Ads API request failed: 401 Unauthorized
```

→ Refresh Token の有効期限が切れている可能性があります。再取得してください。

### 8.4 OIDC 認証エラー

```
Error: OIDC token verification failed
```

→ Cloud Scheduler のサービスアカウントに Cloud Run invoker 権限が付与されているか確認してください。

---

## 9. 開発用コマンド

```bash
# ビルド
npm run build

# ウォッチモードでビルド
npm run watch

# テスト
npm test

# テスト（ウォッチモード）
npm run test:watch

# テスト（カバレッジ）
npm run test:coverage

# 型チェック
npm run lint

# サーバー起動
npm start

# サンプル実行
npm run example
```

---

## 10. Slack通知設定

### 10.1 Slack Bot Token の取得

1. [Slack API](https://api.slack.com/apps) にアクセス
2. 「Create New App」をクリック
3. 「From scratch」を選択
4. App名とワークスペースを設定
5. 「OAuth & Permissions」で Bot Token Scopes に `chat:write` を追加
6. 「Install to Workspace」でインストール
7. Bot User OAuth Token (`xoxb-...`) をコピー

### 10.2 環境変数設定

```bash
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxx
SLACK_CHANNEL_AMAZON_TOOL=amazon_tool
```

### 10.3 通知内容

ライフサイクル更新ジョブ実行時に以下が通知されます：

| 通知タイプ | レベル | 絵文字 | 説明 |
|-----------|--------|--------|------|
| ステージ変更 | info | ℹ️ | 通常のステージ遷移 |
| HARVEST移行 | warn | ⚠️ | HARVESTへの遷移 |
| 強制HARVEST | error | 🚨 | 安全装置発動 |
| ジョブ完了 | info/warn | ℹ️/⚠️ | 実行サマリー |

### 10.4 通知例

```
ℹ️ *ライフサイクルステージ変更*
商品: B0XXXXXXXX
変更: 立ち上げ（強） → 立ち上げ（弱）
理由: TACOS超過だがSEO改善中
SEOスコア: 55.5
月次利益: -50,000円
```

### 10.5 実行サマリー通知設定

入札エンジン実行後に Slack へサマリー通知を送信する機能があります。

**環境変数設定**

```bash
# 実行サマリー通知を有効にするモード（カンマ区切り）
# 例: SHADOW のみ、または SHADOW と APPLY 両方
ENABLE_SLACK_EXECUTION_SUMMARY_MODES=SHADOW,APPLY
```

**通知内容**

- 実行ID、プロファイル、モード、ステータス
- 開始時刻と所要時間
- ASIN ごとのサマリー（上位5件）
  - キーワード提案件数
  - 平均入札変化率（攻め気味/抑え気味ラベル付き）
  - 平均ACOS
  - AUTO→EXACT 昇格候補件数

**通知例**

```
ℹ️ *Amazon Bid Engine 実行サマリー*

実行ID:      abc-123-def
プロファイル: 1234567890
モード:      SHADOW
タイプ:      BID_NORMAL
ステータス:  SUCCESS
開始時刻:    2025-01-15 10:30:00
所要時間:    15.3 秒

*ASIN サマリー（上位）*

• *B0XXXXXXXXX* [攻め気味]
  KW: 150 | 変化率: +12.5% | ACOS: 25.3% | AUTO→EXACT候補: 5
  (UP: 80 / DOWN: 30 / KEEP: 40)

• *B0YYYYYYYYY*
  KW: 100 | 変化率: -3.2% | ACOS: 18.7% | AUTO→EXACT候補: 2
  (UP: 20 / DOWN: 50 / KEEP: 30)
```

---

## 11. APPLY モードに切り替える前の確認事項

SHADOW モードでの検証が完了し、APPLY モード（実際に入札を変更するモード）に
切り替える前に、以下を必ず確認してください。

### 11.1 SHADOW 実行結果の確認

1. **BigQuery の実行ログを確認**
   - `executions` テーブルで直近の実行ステータスを確認
   - `bid_recommendations` テーブルで提案の分布を確認
   - `auto_exact_promotion_suggestions` テーブルで昇格候補を確認

2. **Slack 実行サマリー通知の確認**
   - 各 ASIN の平均入札変化率が妥当か
   - 極端に攻め気味/抑え気味な ASIN がないか
   - AUTO→EXACT 昇格候補が適切か

3. **入札変更の傾向分析**
   ```sql
   SELECT
     br.asin,
     COUNT(*) AS keyword_count,
     AVG(br.bid_change_ratio) AS avg_change_ratio,
     COUNTIF(br.bid_change > 0) AS up_count,
     COUNTIF(br.bid_change < 0) AS down_count
   FROM `project.amazon_bid_engine.bid_recommendations` br
   WHERE br.execution_id = 'YOUR_EXECUTION_ID'
   GROUP BY br.asin
   ORDER BY avg_change_ratio DESC;
   ```

### 11.2 Slack 実行サマリー通知の継続利用

**重要: Slack 実行サマリーは SHADOW だけでなく APPLY 本番運用の監視にも重要です。**

APPLY に切り替えた後も、Slack 実行サマリー通知は基本的に有効のまま運用してください。

```bash
# APPLY 運用時の推奨設定
ENABLE_SLACK_EXECUTION_SUMMARY_MODES=SHADOW,APPLY
```

この通知は以下の目的で使用します：

1. **入札ロジック暴走の早期検出**
   - 極端に攻め気味/抑え気味な ASIN を即座に把握
   - 異常な AUTO→EXACT 昇格候補数を検知

2. **日常的な入札傾向の把握**
   - どの ASIN に積極投資しているか
   - どの ASIN でコスト抑制しているか

### 11.3 Slack 実行サマリー通知を無効にする場合

通知を完全に無効にする前に、以下を必ず確認してください：

1. **代替監視手段の整備**
   - BigQuery ダッシュボード（Looker Studio 等）が稼働しているか
   - 同等以上の情報が定期的に確認できる状態か

2. **異常検知の仕組み**
   - 入札ロジック暴走時にアラートを出す仕組みがあるか
   - 担当者が異常に気付ける体制になっているか

3. **関係者への周知**
   - 通知が無効化されることを関係者が把握しているか
   - 代替手段の確認方法を全員が理解しているか

### 11.4 APPLY 切り替え手順

1. 環境変数 `BID_ENGINE_EXECUTION_MODE` を `APPLY` に変更
2. `ENABLE_SLACK_EXECUTION_SUMMARY_MODES` に `APPLY` が含まれていることを確認
3. 小規模な実行でテスト（特定 ASIN のみ等）
4. 問題なければ本番運用開始

```bash
# APPLY モードへの切り替え
BID_ENGINE_EXECUTION_MODE=APPLY
ENABLE_SLACK_EXECUTION_SUMMARY_MODES=SHADOW,APPLY
```

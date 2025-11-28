# Retool セットアップガイド

Amazon Bid Engine の管理UIをRetoolで構築するためのセットアップガイドです。

## 目次

1. [概要](#概要)
2. [REST API接続](#rest-api接続)
3. [BigQuery接続](#bigquery接続)
4. [推奨アプリ構成](#推奨アプリ構成)
5. [クエリサンプル](#クエリサンプル)

---

## 概要

このシステムでは、2種類のデータソースを利用できます：

| データソース | 用途 | 特徴 |
|------------|------|------|
| REST API | 候補の承認/却下、適用操作 | リアルタイム操作 |
| BigQuery | ダッシュボード、レポート | 大量データの集計・分析 |

**推奨構成**:
- **操作系（承認/却下/適用）**: REST API
- **閲覧・分析系**: BigQuery直接接続

---

## REST API接続

### 1. リソース作成

1. Retool左パネルの「Resources」→「Create new」→「REST API」
2. 以下を設定：

| 項目 | 値 |
|------|-----|
| Name | `AmazonBidEngineAPI` |
| Base URL | `https://your-service.a.run.app` |
| Authentication | Header |
| Header name | `X-API-Key` |
| Header value | `<your-api-key>` |

### 2. 主要エンドポイント

#### ネガティブキーワード候補

| 操作 | メソッド | エンドポイント |
|------|---------|---------------|
| 一覧取得 | GET | `/admin/negative-suggestions` |
| サマリー | GET | `/admin/negative-suggestions/summary` |
| 詳細取得 | GET | `/admin/negative-suggestions/:id` |
| 承認 | POST | `/admin/negative-suggestions/approve` |
| 却下 | POST | `/admin/negative-suggestions/reject` |
| 適用 | POST | `/admin/negative-suggestions/apply-queued` |

#### AUTO→EXACT昇格候補

| 操作 | メソッド | エンドポイント |
|------|---------|---------------|
| 一覧取得 | GET | `/admin/auto-exact-suggestions` |
| サマリー | GET | `/admin/auto-exact-suggestions/summary` |
| Top N | GET | `/admin/auto-exact-suggestions/top` |
| 詳細取得 | GET | `/admin/auto-exact-suggestions/:id` |
| 承認 | POST | `/admin/auto-exact-suggestions/approve` |
| 却下 | POST | `/admin/auto-exact-suggestions/reject` |
| 適用 | POST | `/admin/auto-exact-suggestions/apply-queued` |

### 3. クエリ例

#### 候補一覧取得（フィルタ付き）

```
GET /admin/negative-suggestions?status=PENDING&limit=100
```

#### 一括承認

```json
POST /admin/negative-suggestions/approve
{
  "suggestionIds": ["uuid-1", "uuid-2", "uuid-3"],
  "approvedBy": "{{ current_user.email }}"
}
```

#### Dry Run（適用シミュレーション）

```json
POST /admin/negative-suggestions/apply-queued
{
  "dryRun": true,
  "maxItems": 50
}
```

---

## BigQuery接続

### 1. リソース作成

1. Retool左パネルの「Resources」→「Create new」→「BigQuery」
2. サービスアカウントのJSONキーをアップロード

**必要な権限**:
- `bigquery.datasets.get`
- `bigquery.tables.getData`
- `bigquery.jobs.create`

### 2. 主要テーブル

| テーブル | 説明 |
|---------|------|
| `negative_keyword_suggestions` | ネガティブキーワード候補 |
| `auto_exact_promotion_suggestions` | AUTO→EXACT昇格候補 |
| `execution_log` | 実行履歴 |
| `keyword_recommendations` | キーワード入札提案 |
| `asin_lifecycle_states` | ASIN別ライフサイクル |
| `execution_health_metrics` | 実行ヘルスメトリクス |

### 3. 便利なビュー

以下のビューが事前定義されています：

```sql
-- 未処理のネガティブ候補（直近30日）
SELECT * FROM `project.dataset.negative_keyword_suggestions_pending`

-- 承認済み・未適用のネガティブ候補
SELECT * FROM `project.dataset.negative_keyword_suggestions_approved`

-- ASIN別サマリー
SELECT * FROM `project.dataset.negative_keyword_suggestions_summary`
```

---

## 推奨アプリ構成

### アプリ1: ネガティブキーワード管理

```
┌─────────────────────────────────────────────────────────┐
│  ネガティブキーワード管理                               │
├─────────────────────────────────────────────────────────┤
│  [サマリーカード] PENDING: 125  APPROVED: 42  APPLIED: 890  │
├─────────────────────────────────────────────────────────┤
│  フィルター: [ASIN] [ステータス▼] [役割▼] [検索]        │
├─────────────────────────────────────────────────────────┤
│  □ | ASIN       | クエリ      | Cost   | CVR  | 役割   │
│  ─────────────────────────────────────────────────────── │
│  ☑ | B0ABC123   | 競合ブランド | ¥5,230 | 0%   | BRAND  │
│  ☑ | B0ABC123   | 無関係ワード | ¥3,100 | 0%   | GENERIC│
│  □ | B0XYZ789   | 別カテゴリ   | ¥1,800 | 0%   | OTHER  │
├─────────────────────────────────────────────────────────┤
│  [選択した2件を承認] [選択した件を却下] [Dry Run] [適用]  │
└─────────────────────────────────────────────────────────┘
```

**コンポーネント**:
- Statistics（サマリーカード）: BigQueryクエリ
- Table（候補一覧）: REST API `GET /admin/negative-suggestions`
- Buttons: REST API `POST /approve`, `POST /reject`

### アプリ2: AUTO→EXACT昇格管理

```
┌─────────────────────────────────────────────────────────┐
│  AUTO→EXACT 昇格候補                                    │
├─────────────────────────────────────────────────────────┤
│  [高スコア候補Top 20]                                   │
├─────────────────────────────────────────────────────────┤
│  Score | ASIN     | 検索語句      | CVR   | ACOS  | LC  │
│  ─────────────────────────────────────────────────────── │
│  95    | B0ABC123 | 商品名 正規品 | 8.5%  | 12%   | GROW│
│  92    | B0ABC123 | カテゴリ 人気 | 7.2%  | 15%   | GROW│
│  88    | B0XYZ789 | ブランド名    | 6.8%  | 18%   | HARV│
├─────────────────────────────────────────────────────────┤
│  [一括承認] [詳細を見る]                                 │
└─────────────────────────────────────────────────────────┘
```

### アプリ3: 実行モニタリングダッシュボード

```
┌─────────────────────────────────────────────────────────┐
│  実行モニタリング                                       │
├─────────────────────────────────────────────────────────┤
│  [直近7日の実行サマリー]                                │
│  ┌─────────┬─────────┬─────────┐                       │
│  │ 総実行数│ 成功率  │ 平均処理│                       │
│  │   42    │  98%    │ 2.3分   │                       │
│  └─────────┴─────────┴─────────┘                       │
├─────────────────────────────────────────────────────────┤
│  [実行履歴グラフ - 日別]                                │
│  ████████████████████                                   │
│  ██████████████████████████                             │
├─────────────────────────────────────────────────────────┤
│  [最新実行一覧]                                         │
│  ID        | モード  | ステータス | 処理数 | 日時       │
│  exec-123  | SHADOW  | SUCCESS   | 1,250  | 2025-01-15 │
└─────────────────────────────────────────────────────────┘
```

---

## クエリサンプル

### BigQuery: ネガティブ候補サマリー

```sql
SELECT
  status,
  COUNT(*) AS count,
  SUM(cost_30d) AS total_cost,
  COUNT(DISTINCT asin) AS unique_asins
FROM `your-project.amazon_bid_engine.negative_keyword_suggestions`
WHERE suggested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY status
ORDER BY
  CASE status
    WHEN 'PENDING' THEN 1
    WHEN 'APPROVED' THEN 2
    WHEN 'APPLIED' THEN 3
    WHEN 'REJECTED' THEN 4
  END
```

### BigQuery: 高コストのPENDING候補

```sql
SELECT
  suggestion_id,
  asin,
  query,
  role,
  clicks_30d,
  cost_30d,
  cvr_30d,
  reason_codes,
  suggested_at
FROM `your-project.amazon_bid_engine.negative_keyword_suggestions`
WHERE status = 'PENDING'
  AND cost_30d >= 1000  -- ¥1,000以上
ORDER BY cost_30d DESC
LIMIT 100
```

### BigQuery: AUTO→EXACT高スコア候補

```sql
SELECT
  suggestion_id,
  asin,
  search_term,
  intent_cluster_label,
  clicks,
  orders,
  cvr,
  acos,
  target_acos,
  score,
  lifecycle_state
FROM `your-project.amazon_bid_engine.auto_exact_promotion_suggestions`
WHERE status = 'PENDING'
  AND score >= 70  -- スコア70以上
ORDER BY score DESC
LIMIT 50
```

### BigQuery: 実行ヘルスサマリー

```sql
SELECT
  DATE(execution_date) AS date,
  COUNT(*) AS executions,
  COUNTIF(status = 'SUCCESS') AS success_count,
  COUNTIF(status = 'FAILED') AS failed_count,
  AVG(processing_time_seconds) AS avg_processing_time,
  SUM(keywords_processed) AS total_keywords
FROM `your-project.amazon_bid_engine.execution_health_metrics`
WHERE execution_date >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY DATE(execution_date)
ORDER BY date DESC
```

### BigQuery: ASIN別パフォーマンス

```sql
SELECT
  asin,
  lifecycle_state,
  COUNT(*) AS total_suggestions,
  SUM(CASE WHEN status = 'APPLIED' THEN 1 ELSE 0 END) AS applied_count,
  SUM(cost_30d) AS total_wasted_cost,
  MIN(suggested_at) AS first_suggested,
  MAX(suggested_at) AS last_suggested
FROM `your-project.amazon_bid_engine.negative_keyword_suggestions`
GROUP BY asin, lifecycle_state
ORDER BY total_wasted_cost DESC
LIMIT 20
```

---

## トラブルシューティング

### CORS エラー

```
Access to XMLHttpRequest at 'https://...' from origin 'https://xxx.retool.com' has been blocked by CORS policy
```

**解決策**: サーバーのCORS設定を確認。`CORS_ALLOWED_ORIGINS` 環境変数にRetoolのドメインを追加。

### 認証エラー (401)

```json
{"error": "Unauthorized", "message": "Invalid or missing API key"}
```

**解決策**: Retoolリソースの `X-API-Key` ヘッダー設定を確認。

### BigQuery権限エラー

```
Access Denied: Project xxx: User does not have permission
```

**解決策**: サービスアカウントに以下のロールを付与:
- `roles/bigquery.dataViewer`
- `roles/bigquery.jobUser`

---

## 環境変数一覧

API側で設定が必要な環境変数：

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `API_KEY` | API認証キー | `your-secret-key` |
| `CORS_ALLOWED_ORIGINS` | 追加許可オリジン（カンマ区切り） | `https://custom.domain.com` |
| `NEGATIVE_APPLY_ENABLED` | ネガティブ適用を有効化 | `true` |
| `AUTO_EXACT_APPLY_ENABLED` | AUTO→EXACT適用を有効化 | `true` |
| `MAX_APPLY_CHANGES_PER_RUN` | 1回の適用最大件数 | `100` |

---

## 参考リンク

- [OpenAPI定義](./openapi.yaml) - API仕様の詳細
- [アーキテクチャ](./architecture.md) - システム全体の設計

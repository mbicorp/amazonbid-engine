# API リファレンス

## 概要

Amazon Bid Engine API は RESTful API として提供され、入札推奨の計算と定期実行を行います。

**ベースURL**: `https://your-service-url.run.app`

---

## 認証

### API Key 認証

外部クライアントからのアクセスに使用します。

```http
X-API-Key: your-api-key
```

または

```http
Authorization: Bearer your-api-key
```

### OIDC 認証（Google Cloud Scheduler）

Cloud Scheduler からの定期実行に使用します。

```http
Authorization: Bearer <oidc-token>
```

OIDC トークンは Google Cloud が自動的に付与します。

---

## エンドポイント一覧

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| GET | `/` | 不要 | サービス情報 |
| GET | `/health` | 不要 | ヘルスチェック |
| POST | `/recommend` | API Key | 入札推奨計算 |
| POST | `/cron/run` | OIDC/API Key | 汎用Cronジョブ |
| POST | `/cron/run-normal` | OIDC/API Key | NORMALモード定期実行 |
| POST | `/cron/run-smode` | OIDC/API Key | S_MODE定期実行 |
| GET | `/escore/stats` | API Key | E-score統計取得 |
| GET | `/escore/health` | API Key | E-scoreヘルスチェック |
| POST | `/escore/optimize` | OIDC | E-score最適化実行 |
| POST | `/jungle-scout/sync` | OIDC | Jungle Scoutデータ同期 |
| POST | `/jungle-scout/analyze` | OIDC | Jungle Scout分析実行 |
| GET | `/jungle-scout/keywords/:asin` | API Key | キーワード取得 |
| GET | `/jungle-scout/sov/:asin` | API Key | Share of Voice取得 |
| GET | `/jungle-scout/strategy/:asin` | API Key | 戦略取得 |
| POST | `/unified/calculate` | OIDC | 統合戦略計算 |
| POST | `/unified/product` | OIDC | 商品分析登録 |
| GET | `/unified/strategy/:asin` | API Key | 統合戦略取得 |
| GET | `/unified/summary/:asin` | API Key | 統合サマリー取得 |
| POST | `/seo-investment/evaluate` | OIDC | SEO投資評価 |
| POST | `/seo-investment/start` | OIDC | SEO投資開始 |
| GET | `/seo-investment/status/:asin` | OIDC | SEO投資状態取得 |
| GET | `/lifecycle/products` | API Key | 投資モード商品サマリー |
| GET | `/lifecycle/keywords/:productId` | API Key | キーワードメトリクス取得 |
| POST | `/lifecycle/update` | OIDC | ライフサイクル更新ジョブ |
| POST | `/lifecycle/products/:id/stage` | OIDC | 手動ステージ変更 |
| POST | `/lifecycle/aggregation` | OIDC | 集計ジョブ実行 |
| GET | `/lifecycle/config` | API Key | ライフサイクル設定取得 |
| POST | `/negative-keywords/suggest` | OIDC/API Key | ネガティブキーワード候補計算 |
| GET | `/negative-keywords/suggestions/:asin` | API Key | ASIN別ネガティブ候補一覧 |
| GET | `/negative-keywords/summary` | API Key | ネガティブ候補サマリー |

---

## エンドポイント詳細

### GET /

サービス情報を返します。

**リクエスト**
```http
GET / HTTP/1.1
Host: your-service-url.run.app
```

**レスポンス**
```json
{
  "service": "Amazon広告自動入札提案エンジン API",
  "version": "1.0.0",
  "endpoints": {
    "health": "GET /health",
    "recommend": "POST /recommend",
    "cron_run": "POST /cron/run",
    "cron_run_normal": "POST /cron/run-normal",
    "cron_run_smode": "POST /cron/run-smode"
  }
}
```

---

### GET /health

ヘルスチェックを行います。BigQuery への接続状態も確認します。

**リクエスト**
```http
GET /health HTTP/1.1
Host: your-service-url.run.app
```

**レスポンス（正常時）**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "amazon-bid-engine",
  "checks": {
    "bigquery": "ok"
  }
}
```

**レスポンス（異常時）**
```json
{
  "status": "degraded",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "service": "amazon-bid-engine",
  "checks": {
    "bigquery": "failed"
  }
}
```

**ステータスコード**
- `200`: 正常
- `503`: BigQuery 接続失敗

---

### POST /recommend

キーワードデータから入札推奨を計算します。

**認証**: API Key 必須

**リクエスト**
```http
POST /recommend HTTP/1.1
Host: your-service-url.run.app
Content-Type: application/json
X-API-Key: your-api-key

{
  "keywords": [
    {
      "keyword_id": "kw001",
      "campaign_id": "camp001",
      "ad_group_id": "ag001",
      "phase_type": "NORMAL",
      "brand_type": "GENERIC",
      "score_rank": "A",
      "current_bid": 150,
      "baseline_cpc": 120,
      "acos_target": 0.2,
      "acos_actual": 0.18,
      "cvr_recent": 0.05,
      "cvr_baseline": 0.04,
      "ctr_recent": 0.02,
      "ctr_baseline": 0.02,
      "clicks_1h": 10,
      "clicks_3h": 30,
      "impressions_1h": 500,
      "impressions_3h": 1500,
      "rank_current": 5,
      "rank_target": 3,
      "competitor_cpc_current": 160,
      "competitor_cpc_baseline": 150,
      "comp_strength": 0.5,
      "risk_penalty": 0.1,
      "priority_score": 0.8,
      "tos_ctr_mult": 1.2,
      "tos_cvr_mult": 1.3,
      "tos_gap_cpc": 20,
      "campaign_budget_remaining": 50000,
      "expected_clicks_3h": 35,
      "time_in_phase_minutes": 120
    }
  ],
  "config": {
    "mode": "NORMAL",
    "manual_mode": false,
    "max_change_rate_normal": 0.6,
    "max_change_rate_smode_default": 1.5,
    "max_change_rate_smode_tos": 2.0,
    "min_clicks_for_decision": 5,
    "min_clicks_for_confident": 20,
    "min_clicks_for_tos": 40,
    "acos_hard_stop_multiplier": 3.0,
    "acos_soft_down_multiplier": 1.5,
    "currency": "JPY"
  }
}
```

**レスポンス（成功）**
```json
{
  "success": true,
  "total": 1,
  "recommendations": [
    {
      "keyword_id": "kw001",
      "campaign_id": "camp001",
      "ad_group_id": "ag001",
      "action": "MILD_UP",
      "old_bid": 150,
      "new_bid": 165,
      "change_rate": 0.10,
      "clipped": false,
      "clip_reason": null,
      "priority_score": 0.8,
      "rank_current": 5,
      "rank_target": 3,
      "cvr_recent": 0.05,
      "cvr_baseline": 0.04,
      "ctr_recent": 0.02,
      "ctr_baseline": 0.02,
      "acos_actual": 0.18,
      "acos_target": 0.2,
      "tos_targeted": false,
      "tos_eligible_200": false,
      "base_change_rate": 0.10,
      "phase_coeff": 1.0,
      "cvr_coeff": 1.15,
      "rank_gap_coeff": 1.1,
      "competitor_coeff": 1.0,
      "brand_coeff": 1.0,
      "stats_coeff": 1.1,
      "tos_coeff": 1.0,
      "reason_facts": "CVR: 5.0% (基準: 4.0%, +25.0%), ACOS: 18.0% (目標: 20.0%)",
      "reason_logic": "CVR向上中 → ACOS良好 → MILD_UP",
      "reason_impact": "入札額: ¥150 → ¥165 (+10.0%)"
    }
  ]
}
```

**レスポンス（バリデーションエラー）**
```json
{
  "error": "Invalid request",
  "message": "Request validation failed",
  "details": [
    {
      "path": ["keywords", 0, "current_bid"],
      "message": "Required"
    }
  ]
}
```

**ステータスコード**
- `200`: 成功
- `400`: バリデーションエラー
- `401`: 認証エラー
- `500`: サーバーエラー

---

### POST /cron/run

汎用の Cron ジョブを実行します。モードを指定できます。

**認証**: OIDC または API Key

**リクエスト**
```http
POST /cron/run HTTP/1.1
Host: your-service-url.run.app
Content-Type: application/json
Authorization: Bearer <oidc-token>

{
  "mode": "NORMAL",
  "useMockData": false
}
```

**パラメータ**

| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| mode | string | Yes | "NORMAL" または "S_MODE" |
| useMockData | boolean | No | テスト用モックデータを使用 |

**レスポンス（成功）**
```json
{
  "success": true,
  "executionId": "exec_1705312200000_abc1234",
  "mode": "NORMAL",
  "count": 1500,
  "durationMs": 3245,
  "recommendations": [...]
}
```

**ステータスコード**
- `200`: 成功
- `400`: バリデーションエラー
- `401`: 認証エラー
- `500`: 実行エラー

---

### POST /cron/run-normal

NORMAL モード固定の定期実行です。

**認証**: OIDC または API Key

**リクエスト**
```http
POST /cron/run-normal HTTP/1.1
Host: your-service-url.run.app
Content-Type: application/json
Authorization: Bearer <oidc-token>

{
  "useMockData": false
}
```

**レスポンス**

`/cron/run` と同様

---

### POST /cron/run-smode

S_MODE 固定の定期実行です。セール期間中に使用します。

**認証**: OIDC または API Key

**リクエスト**
```http
POST /cron/run-smode HTTP/1.1
Host: your-service-url.run.app
Content-Type: application/json
Authorization: Bearer <oidc-token>

{
  "useMockData": false
}
```

**レスポンス**

`/cron/run` と同様

---

## エラーレスポンス

すべてのエラーは統一された `ApiResponse` 形式で返されます。

### 統一エラーレスポンス形式

```typescript
interface ApiResponse<T = never> {
  success: false;
  statusCode: number;
  error: {
    code: string;          // エラーコード（例: "UNAUTHORIZED", "VALIDATION_ERROR"）
    message: string;       // 人間が読めるエラーメッセージ
    details?: object;      // 追加の詳細情報
    retryable?: boolean;   // リトライ可能か
    retryAfterMs?: number; // リトライまでの待機時間（ミリ秒）
  };
  meta: {
    requestId?: string;    // リクエストID
    timestamp: string;     // タイムスタンプ
  };
}
```

### エラーコード一覧

| コード | HTTPステータス | 説明 | リトライ可能 |
|--------|---------------|------|-------------|
| `UNAUTHORIZED` | 401 | 認証失敗 | No |
| `FORBIDDEN` | 403 | アクセス拒否 | No |
| `VALIDATION_ERROR` | 400 | バリデーションエラー | No |
| `NOT_FOUND` | 404 | リソース未検出 | No |
| `RATE_LIMIT_EXCEEDED` | 429 | レート制限超過 | Yes |
| `AMAZON_ADS_API_ERROR` | 4xx/5xx | Amazon Ads APIエラー | 状況による |
| `BIGQUERY_ERROR` | 500 | BigQueryエラー | 状況による |
| `CIRCUIT_OPEN` | 503 | サーキットブレーカーオープン | Yes |
| `INTERNAL_ERROR` | 500 | 内部エラー | No |
| `CONFIGURATION_ERROR` | 500 | 設定エラー | No |

### 認証エラー (401)

```json
{
  "success": false,
  "statusCode": 401,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key",
    "retryable": false
  },
  "meta": {
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

### バリデーションエラー (400)

```json
{
  "success": false,
  "statusCode": 400,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "errors": [
        {
          "field": "keywords[0].acos_target",
          "message": "Number must be greater than 0"
        }
      ]
    },
    "retryable": false
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

### レート制限エラー (429)

```json
{
  "success": false,
  "statusCode": 429,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded",
    "retryable": true,
    "retryAfterMs": 60000
  },
  "meta": {
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

### サーキットブレーカーオープン (503)

```json
{
  "success": false,
  "statusCode": 503,
  "error": {
    "code": "CIRCUIT_OPEN",
    "message": "Circuit breaker is open for amazon-ads-api",
    "details": {
      "serviceName": "amazon-ads-api"
    },
    "retryable": true,
    "retryAfterMs": 30000
  },
  "meta": {
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

### Amazon Ads APIエラー

```json
{
  "success": false,
  "statusCode": 429,
  "error": {
    "code": "AMAZON_ADS_API_ERROR",
    "message": "Amazon Ads API rate limit exceeded",
    "details": {
      "amazonErrorCode": "RATE_LIMITED",
      "amazonRequestId": "amzn1.ads.req.xxx"
    },
    "retryable": true,
    "retryAfterMs": 60000
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

### サーバーエラー (500)

```json
{
  "success": false,
  "statusCode": 500,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred",
    "retryable": false
  },
  "meta": {
    "timestamp": "2025-01-15T10:30:00.000Z"
  }
}
```

### クライアント側リトライ実装例

```typescript
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    const data = await response.json();

    if (data.success) {
      return data;
    }

    // リトライ不可のエラーは即座に throw
    if (!data.error?.retryable) {
      throw new Error(data.error.message);
    }

    // リトライ可能な場合は待機してリトライ
    const delay = data.error.retryAfterMs || (1000 * Math.pow(2, attempt));
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  throw new Error('Max retries exceeded');
}
```

---

## Cloud Scheduler 設定例

### NORMAL モード定期実行（毎時）

```yaml
name: amazon-bid-normal-hourly
schedule: "0 * * * *"
time_zone: "Asia/Tokyo"
http_target:
  uri: "https://your-service-url.run.app/cron/run-normal"
  http_method: POST
  body: "{}"
  headers:
    Content-Type: "application/json"
  oidc_token:
    service_account_email: "scheduler@your-project.iam.gserviceaccount.com"
    audience: "https://your-service-url.run.app"
```

### S_MODE 定期実行（セール期間中、30分ごと）

```yaml
name: amazon-bid-smode-30min
schedule: "*/30 * * * *"
time_zone: "Asia/Tokyo"
http_target:
  uri: "https://your-service-url.run.app/cron/run-smode"
  http_method: POST
  body: "{}"
  headers:
    Content-Type: "application/json"
  oidc_token:
    service_account_email: "scheduler@your-project.iam.gserviceaccount.com"
    audience: "https://your-service-url.run.app"
```

---

## cURL 使用例

### 入札推奨取得

```bash
curl -X POST https://your-service-url.run.app/recommend \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "keywords": [...],
    "config": {...}
  }'
```

### ヘルスチェック

```bash
curl https://your-service-url.run.app/health
```

### Cron 手動実行（テスト）

```bash
curl -X POST https://your-service-url.run.app/cron/run \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"mode": "NORMAL", "useMockData": true}'
```

---

## ライフサイクル管理 API

### GET /lifecycle/products

投資モード商品のサマリーを取得します。

**レスポンス**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "product_id": "B0XXXXXX",
        "lifecycle_stage": "LAUNCH_HARD",
        "invest_mode_enabled": true,
        "keyword_count": 45,
        "total_ad_spend_60d": 150000,
        "avg_target_acos": 0.45,
        "actions_breakdown": {
          "STRONG_UP": 10,
          "MILD_UP": 15,
          "KEEP": 15,
          "MILD_DOWN": 5
        }
      }
    ],
    "total_products": 10,
    "invest_mode_products": 3
  }
}
```

### GET /lifecycle/keywords/:productId

商品のキーワードメトリクスと入札推奨を取得します。

**レスポンス**
```json
{
  "success": true,
  "data": {
    "product_id": "B0XXXXXX",
    "keyword_count": 45,
    "metrics": [...],
    "recommendations": [
      {
        "keyword_id": "kw001",
        "keyword": "サンプルキーワード",
        "current_bid": 100,
        "target_acos": 0.45,
        "recommended_bid": 130,
        "action": "MILD_UP",
        "lifecycle_stage": "LAUNCH_HARD",
        "keyword_role": "core",
        "invest_mode_enabled": true
      }
    ]
  }
}
```

### POST /lifecycle/update

ライフサイクル状態更新ジョブを実行します。

**リクエスト**
```json
{
  "dryRun": false
}
```

**レスポンス**
```json
{
  "success": true,
  "data": {
    "processedCount": 50,
    "transitionCount": 3,
    "forceHarvestCount": 1,
    "extensionCount": 2,
    "transitions": [
      {
        "product_id": "B0XXXXXX",
        "old_stage": "LAUNCH_HARD",
        "new_stage": "LAUNCH_SOFT",
        "transition_reason": "TACOS超過だがSEO改善中"
      }
    ]
  }
}
```

### POST /lifecycle/products/:productId/stage

商品のライフサイクルステージを手動変更します。

**リクエスト**
```json
{
  "stage": "GROW",
  "reason": "SEO安定のためGROWに移行",
  "dryRun": false
}
```

**レスポンス**
```json
{
  "success": true,
  "data": {
    "product_id": "B0XXXXXX",
    "new_stage": "GROW",
    "reason": "SEO安定のためGROWに移行",
    "dry_run": false
  }
}
```

### POST /lifecycle/aggregation

集計ジョブを実行します。

**リクエスト**
```json
{
  "dryRun": false,
  "skipKeywordMetrics": false,
  "skipSeoKeywordSelection": false,
  "skipSeoScoreCalculation": false
}
```

**レスポンス**
```json
{
  "success": true,
  "data": {
    "success": true,
    "startTime": "2024-01-15T10:00:00.000Z",
    "endTime": "2024-01-15T10:05:00.000Z",
    "durationMs": 300000,
    "keywordMetrics": { "processedCount": 5000 },
    "seoKeywordSelection": { "selectedCount": 150, "byRole": {...} },
    "seoScoreCalculation": { "processedCount": 50, "avgScore": 55.3 }
  }
}
```

### GET /lifecycle/config

現在のライフサイクル設定を取得します。

**レスポンス**
```json
{
  "success": true,
  "data": {
    "lifecycle_global_config": {
      "default_acos_target": 0.20,
      "stage_acos_multipliers": {
        "LAUNCH_HARD": 2.5,
        "LAUNCH_SOFT": 1.8,
        "GROW": 1.2,
        "HARVEST": 0.7
      },
      "role_acos_multipliers": {
        "brand": 0.8,
        "core": 1.3,
        "support": 1.0,
        "longtail_experiment": 0.9
      }
    }
  }
}
```

---

## ネガティブキーワード候補 API

> **Note**: SHADOWモード専用の機能です。自動でネガティブ登録は行いません。

### POST /negative-keywords/suggest

ネガティブキーワード候補を計算します。

**認証**: OIDC / API Key

**リクエスト**
```json
{
  "asin": "B0XXXXXXXXX",
  "config": {
    "minClicksGeneric": 30,
    "minClicksBrandOwn": 50,
    "minClicksBrandConquest": 40,
    "minClusterClicks": 50,
    "riskTolerance": 0.5
  },
  "dryRun": false
}
```

**レスポンス**
```json
{
  "success": true,
  "data": {
    "asin": "B0XXXXXXXXX",
    "mode": "SHADOW",
    "candidateCount": 15,
    "baselineAsinCvr30d": 0.025,
    "requiredClicks": 240,
    "candidates": [
      {
        "query": "sample keyword",
        "matchType": "AUTO",
        "intentClusterId": "core_term_1",
        "role": "GENERIC",
        "clicks30d": 45,
        "conversions30d": 0,
        "cost30d": 5000,
        "cpc30d": 111,
        "cvr30d": 0,
        "reasonCodes": ["NG_NO_CONVERSION", "NG_CLUSTER_NO_CONVERSION"]
      }
    ]
  }
}
```

### GET /negative-keywords/suggestions/:asin

ASIN別のネガティブキーワード候補一覧を取得します。

**認証**: API Key

**レスポンス**
```json
{
  "success": true,
  "data": {
    "asin": "B0XXXXXXXXX",
    "totalCandidates": 25,
    "pendingCount": 20,
    "appliedCount": 5,
    "suggestions": [
      {
        "suggestionId": "uuid-1234",
        "query": "sample keyword",
        "role": "GENERIC",
        "clicks30d": 45,
        "cost30d": 5000,
        "reasonCodes": ["NG_NO_CONVERSION"],
        "isApplied": false,
        "suggestedAt": "2025-01-15T10:00:00.000Z"
      }
    ]
  }
}
```

### GET /negative-keywords/summary

全ASINのネガティブキーワード候補サマリーを取得します。

**認証**: API Key

**レスポンス**
```json
{
  "success": true,
  "data": {
    "totalAsins": 50,
    "totalCandidates": 350,
    "totalWastedCost30d": 500000,
    "byRole": {
      "GENERIC": 200,
      "BRAND_OWN": 50,
      "BRAND_CONQUEST": 100
    },
    "byReasonCode": {
      "NG_NO_CONVERSION": 300,
      "NG_WASTED_SPEND": 150,
      "NG_CLUSTER_NO_CONVERSION": 100,
      "NG_INTENT_MISMATCH": 50
    }
  }
}
```

---

*更新日: 2025年1月*

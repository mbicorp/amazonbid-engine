# ライフサイクル管理システム

## 概要

商品のライフサイクルステージ（LAUNCH_HARD → LAUNCH_SOFT → GROW → HARVEST）を管理し、SEOスコアと月次利益に基づいて自動的にステージ遷移を行うシステムです。

**目的**: アカウント全体の月次利益最大化を目指しつつ、勝てる商品には長期的な赤字SEO投資を許容する

## ライフサイクルステージ

| ステージ | 説明 | ACOS許容度 | 投資モード |
|----------|------|------------|------------|
| **LAUNCH_HARD** | 投資強度最大：積極的な赤字投資でSEO獲得 | 基準×2.5倍 | 有効 |
| **LAUNCH_SOFT** | やや赤字〜トントン：投資継続 | 基準×1.8倍 | 有効 |
| **GROW** | sustainable_tacos周辺でバランス運用 | 基準×1.2倍 | 無効 |
| **HARVEST** | 利益回収フェーズ | 基準×0.7倍 | 無効 |

## データモデル

### BigQueryテーブル構成

```
product_strategy              # 商品戦略マスタ
├── daily_sales_by_product    # 日次売上データ
├── daily_ads_by_product      # 日次広告データ
├── monthly_profit_by_product # 月次利益（VIEW）
├── keyword_stats_daily       # キーワード日次データ
├── jungle_scout_keywords     # Jungle Scout市場データ
├── keyword_metrics_60d       # 60日集計メトリクス
├── seo_keywords_by_product   # SEO追跡キーワード
├── seo_score_by_product      # SEOスコア
├── search_term_stats_30d     # 検索クエリ統計（30日）VIEW
├── intent_cluster_stats_30d  # 検索意図クラスタ統計 VIEW
└── negative_keyword_suggestions # ネガティブキーワード候補
```

### 主要テーブル

#### product_strategy（商品戦略）

```sql
product_id STRING,              -- ASIN
lifecycle_stage STRING,         -- LAUNCH_HARD/LAUNCH_SOFT/GROW/HARVEST
sustainable_tacos FLOAT64,      -- 長期許容TACOS（例: 0.20）
invest_tacos_cap FLOAT64,       -- 投資フェーズ最大TACOS（例: 0.60）
invest_max_months_dynamic INT64, -- 動的投資期間上限
profit_margin FLOAT64,          -- 粗利率
brand_keywords ARRAY<STRING>,   -- ブランドキーワード
product_core_terms ARRAY<STRING> -- 商品コア用語
```

#### seo_score_by_product（SEOスコア）

```sql
product_id STRING,
year_month STRING,              -- YYYY-MM
seo_score FLOAT64,              -- 0-100
seo_level STRING,               -- HIGH(70+)/MID(40-69)/LOW(<40)
seo_score_trend STRING          -- UP/FLAT/DOWN（3ヶ月傾き）
```

## ステージ遷移ロジック

### 遷移条件マトリックス

```
LAUNCH_HARD:
├── → LAUNCH_HARD（継続）: SEO↗、月内、赤字許容内
├── → LAUNCH_SOFT: TACOS超過だがSEO改善中
└── → GROW: SEO HIGH & TACOS良好

LAUNCH_SOFT:
├── → LAUNCH_HARD: TACOS良好 & 赤字許容内
├── → LAUNCH_SOFT（継続）: 期間内
├── → GROW: SEO HIGH & TACOS安定
└── → HARVEST: 期間超過 or SEO悪化

GROW:
├── → GROW（継続）: TACOS安定
├── → LAUNCH_SOFT: SEO DOWN & 再投資許可
└── → HARVEST: TACOS超過 & SEO LOW

HARVEST:
└── → HARVEST（継続）: 維持
```

### 強制HARVESTトリガー（安全装置）

1. **累積赤字上限超過**: 200万円超過
2. **連続赤字**: 2ヶ月連続
3. **レビュー崩壊**: 評価3.0未満 & レビュー数20以上

### 投資期間自動延長

条件: 赤字が許容の70%以内 → +1ヶ月延長（最大12ヶ月）

## SEOスコア計算

### キーワード役割別重み

| 役割 | 重み | 説明 |
|------|------|------|
| brand | 30% | ブランドキーワード |
| core | 40% | コアジェネリック |
| support | 20% | サポートキーワード |
| longtail_experiment | 10% | ロングテール実験 |

### 順位→スコア変換

```
rank 1-3:   100点
rank 4-10:  70-99点（線形減衰）
rank 11-20: 40-69点
rank 21-50: 10-39点
rank 51+:   0-9点
NULL:       0点
```

## Bidエンジン統合

### 動的ACOS計算

```typescript
target_acos = min(
  base_acos × stage_multiplier × role_multiplier,
  profit_margin × 0.9
)

// 投資モード時
target_acos = invest_tacos_cap
```

### stage_multiplier（ステージ乗数）

```typescript
{
  LAUNCH_HARD: 2.5,
  LAUNCH_SOFT: 1.8,
  GROW: 1.2,
  HARVEST: 0.7,
}
```

### role_multiplier（役割乗数）

```typescript
{
  brand: 0.8,
  core: 1.3,
  support: 1.0,
  longtail_experiment: 0.9,
  other: 0.7,
}
```

## APIエンドポイント

### GET /lifecycle/products
投資モード商品のサマリーを取得

### GET /lifecycle/keywords/:productId
商品のキーワードメトリクスと入札推奨を取得

### POST /lifecycle/update
ライフサイクル状態更新ジョブを実行

```json
{
  "dryRun": false
}
```

### POST /lifecycle/products/:productId/stage
商品のライフサイクルステージを手動変更

```json
{
  "stage": "GROW",
  "reason": "SEO安定のためGROWに移行",
  "dryRun": false
}
```

### POST /lifecycle/aggregation
集計ジョブを実行

```json
{
  "dryRun": false,
  "skipKeywordMetrics": false,
  "skipSeoKeywordSelection": false,
  "skipSeoScoreCalculation": false
}
```

### GET /lifecycle/config
現在のライフサイクル設定を取得

## バッチジョブ

### 集計ジョブ（日次）

実行順序:
1. キーワードメトリクス集計（60日）
2. SEOキーワード選定
3. SEOスコア計算
4. 月次利益データ検証

```bash
# CLI実行
npx ts-node src/jobs/aggregation/index.ts --dry-run
```

### ライフサイクル更新ジョブ（月次）

```bash
# CLI実行
npx ts-node src/jobs/lifecycle/lifecycle-updater.ts --dry-run
```

## ディレクトリ構成

```
src/
├── lifecycle/
│   ├── types.ts              # 型定義
│   ├── transition-logic.ts   # 遷移ロジック
│   ├── bid-integration.ts    # Bidエンジン統合
│   └── index.ts
├── negative-keywords/        # ネガティブキーワード候補検出
│   ├── types.ts              # 型定義（NegativeKeywordCandidate等）
│   ├── negative-keyword-calculator.ts  # メイン計算ロジック
│   └── index.ts
├── jobs/
│   ├── aggregation/
│   │   ├── keyword-metrics-aggregator.ts
│   │   ├── seo-keyword-selector.ts
│   │   ├── seo-score-calculator.ts
│   │   ├── monthly-profit-aggregator.ts
│   │   └── index.ts
│   └── lifecycle/
│       ├── lifecycle-updater.ts
│       └── index.ts
├── bigquery/
│   ├── schemas/
│   │   ├── product_strategy.sql
│   │   ├── daily_sales_by_product.sql
│   │   ├── daily_ads_by_product.sql
│   │   ├── monthly_profit_by_product.sql
│   │   ├── keyword_stats_daily.sql
│   │   ├── jungle_scout_keywords.sql
│   │   ├── keyword_metrics_60d.sql
│   │   ├── seo_keywords_by_product.sql
│   │   ├── seo_score_by_product.sql
│   │   ├── search_term_stats_30d.sql       # 検索クエリ統計ビュー
│   │   ├── intent_cluster_stats_30d.sql    # 検索意図クラスタ統計ビュー
│   │   └── negative_keyword_suggestions.sql # ネガティブキーワード候補テーブル
│   └── migrate.ts
└── routes/
    └── lifecycle.ts
```

## Slack通知

ライフサイクル更新ジョブ実行時に自動でSlack通知が送信されます。

### 通知タイプ

| 通知 | レベル | 説明 |
|------|--------|------|
| ステージ変更 | info/warn | ステージ遷移時（HARVESTはwarn） |
| 強制HARVEST | error | 安全装置発動時 |
| ジョブ完了 | info/warn | 実行サマリー（エラーありはwarn） |

### ステージ日本語ラベル

| ステージ | 日本語 |
|----------|--------|
| LAUNCH_HARD | 立ち上げ（強） |
| LAUNCH_SOFT | 立ち上げ（弱） |
| GROW | 通常運用 |
| HARVEST | 回収モード |

### 通知例

```
ℹ️ *ライフサイクルステージ変更*
商品: B0XXXXXXXX
変更: 立ち上げ（強） → 立ち上げ（弱）
理由: TACOS超過だがSEO改善中
SEOスコア: 55.5
月次利益: -50,000円
```

```
🚨 *強制HARVEST移行アラート*
商品: B0XXXXXXXX
トリガー: 累積赤字上限超過
詳細: 累積赤字が200万円を超過
累積赤字: 2,500,000円
```

## 環境変数

```bash
# BigQuery設定
GOOGLE_CLOUD_PROJECT_ID=your-project-id
BIGQUERY_DATASET=amazon_bid_engine

# オプション
BIGQUERY_LOCATION=asia-northeast1

# Slack通知
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxx
SLACK_CHANNEL_AMAZON_TOOL=amazon_tool
```

## マイグレーション

```bash
# スキーマをデプロイ
npx ts-node src/bigquery/migrate.ts

# ドライラン
npx ts-node src/bigquery/migrate.ts --dry-run
```

## ネガティブキーワード候補検出との連携

ライフサイクルステージは、ネガティブキーワード候補検出において重要な役割を果たします。

### 除外されるライフサイクルステート

以下のステートではネガティブキーワード候補を生成しません：

- **LAUNCH_HARD**: データ不足、投資優先期間のためスキップ
- **LAUNCH_SOFT**: データ収集中のためスキップ

### GROW / HARVEST のみ対象

十分なデータがあり、投資フェーズを終えた商品のみがネガティブキーワード候補検出の対象となります。

詳細は [architecture.md](./architecture.md#9-ネガティブキーワード候補サジェスト) および [bid_core.md](./bid_core.md#7-ネガティブキーワード候補計算-negative-keyword-calculatorts) を参照してください。

---

*更新日: 2025年1月*

# Amazon Bid Engine 完全仕様書

**バージョン**: 1.0.0
**作成日**: 2024年1月
**対象**: Amazon広告（Sponsored Products）自動入札提案エンジン

---

# 目次

1. [システム概要](#1-システム概要)
2. [アーキテクチャ](#2-アーキテクチャ)
3. [データ型定義](#3-データ型定義)
4. [入札ロジック](#4-入札ロジック)
5. [係数計算](#5-係数計算)
6. [API仕様](#6-api仕様)
7. [設定・環境変数](#7-設定環境変数)
8. [ネガティブキーワード候補検出](#8-ネガティブキーワード候補検出)

---

# 1. システム概要

## 1.1 目的

Amazon Bid Engine は、Amazon広告の入札額を自動的に最適化するための提案エンジンです。

**解決する問題:**
- 数千〜数万のキーワードを人間が手動で最適化するのは不可能
- 競合状況やパフォーマンス変化への即座対応が必要
- セール期間中の攻めの入札戦略
- TOS（Top of Search）獲得のための入札最適化

## 1.2 システム構成図

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cloud Scheduler                          │
│                    (定期実行トリガー)                            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Cloud Run (API Server)                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    server.ts                             │   │
│  │  - /health          (ヘルスチェック)                     │   │
│  │  - /recommend       (API経由での入札提案)                │   │
│  │  - /cron/run        (汎用Cronジョブ)                     │   │
│  │  - /cron/run-normal (通常モード定期実行)                 │   │
│  │  - /cron/run-smode  (セールモード定期実行)               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │                                           │
          ▼                                           ▼
┌─────────────────────┐                 ┌─────────────────────────┐
│   Amazon Ads API    │                 │       BigQuery          │
│  (キーワードデータ)  │                 │  (実行履歴・推奨履歴)   │
└─────────────────────┘                 └─────────────────────────┘
```

## 1.3 処理フロー

```
入力: KeywordMetrics[] + GlobalConfig
              │
              ▼
┌─────────────────────────────────────┐
│ 1. アクション決定 (action-logic.ts) │
│    - CVR変化率計算                  │
│    - ACOS差分計算                   │
│    - アクションタイプ決定           │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ 2. TOS判定 (tos-logic.ts)           │
│    - TOS攻め対象判定                │
│    - TOS 200%許可判定               │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ 3. 係数計算 (coefficients.ts)       │
│    - 7種類の係数を計算              │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ 4. 入札額計算 (bid-calculation.ts)  │
│    - 基本変化率 × 係数              │
│    - クリップ処理                   │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│ 5. 理由生成 (reason-generator.ts)   │
│    - Facts / Logic / Impact         │
└─────────────────────────────────────┘
              │
              ▼
出力: BidRecommendation[]
```

---

# 2. アーキテクチャ

## 2.1 ファイル構成

```
amazon-bid-engine/
├── index.ts                 # メインエントリーポイント
├── types.ts                 # 型定義
├── action-logic.ts          # アクション決定ロジック
├── coefficients.ts          # 係数計算ロジック
├── tos-logic.ts             # TOS（Top of Search）ロジック
├── bid-calculation.ts       # 入札額計算ロジック
├── reason-generator.ts      # 理由テキスト生成
│
├── src/                     # サーバー関連
│   ├── server.ts            # Express APIサーバー
│   ├── bigqueryClient.ts    # BigQueryクライアント
│   ├── amazonAdsClient.ts   # Amazon Ads APIクライアント
│   ├── config.ts            # 環境変数設定
│   ├── constants.ts         # 定数定義
│   ├── schemas.ts           # Zodバリデーションスキーマ
│   ├── logger.ts            # 構造化ログ
│   └── middleware/
│       └── auth.ts          # 認証ミドルウェア
│
├── tests/                   # テスト
└── docs/                    # ドキュメント
```

## 2.2 技術スタック

| 項目 | 技術 |
|------|------|
| 言語 | TypeScript |
| ランタイム | Node.js 16+ |
| Webフレームワーク | Express 5 |
| バリデーション | Zod |
| データベース | BigQuery |
| 外部API | Amazon Ads API v3 |
| 認証 | API Key / Google OIDC |
| デプロイ | Cloud Run |
| 定期実行 | Cloud Scheduler |

---

# 3. データ型定義

## 3.1 入力: KeywordMetrics

キーワードごとのパフォーマンス指標。

| フィールド | 型 | 説明 |
|-----------|------|------|
| keyword_id | string | キーワードID |
| campaign_id | string | キャンペーンID |
| ad_group_id | string | 広告グループID |
| phase_type | PhaseType | フェーズタイプ |
| brand_type | BrandType | ブランドタイプ |
| score_rank | ScoreRank | スコアランク |
| current_bid | number | 現在の入札額 |
| baseline_cpc | number | ベースラインCPC |
| acos_target | number | 目標ACOS (例: 0.2 = 20%) |
| acos_actual | number | 実際のACOS |
| cvr_recent | number | 直近CVR |
| cvr_baseline | number | ベースラインCVR |
| ctr_recent | number | 直近CTR |
| ctr_baseline | number | ベースラインCTR |
| clicks_1h | number | 過去1時間のクリック |
| clicks_3h | number | 過去3時間のクリック |
| impressions_1h | number | 過去1時間のインプレッション |
| impressions_3h | number | 過去3時間のインプレッション |
| rank_current | number \| null | 現在のランク |
| rank_target | number \| null | 目標ランク |
| competitor_cpc_current | number | 競合の現在CPC |
| competitor_cpc_baseline | number | 競合のベースラインCPC |
| comp_strength | number | 競合強度 (0-1) |
| risk_penalty | number | リスクペナルティ (0-1) |
| priority_score | number | 優先度スコア (0-1) |
| tos_ctr_mult | number | TOS CTR乗数 |
| tos_cvr_mult | number | TOS CVR乗数 |
| tos_gap_cpc | number | TOS ギャップCPC |
| campaign_budget_remaining | number | キャンペーン残予算 |
| expected_clicks_3h | number | 予想クリック数(3h) |
| time_in_phase_minutes | number | フェーズ経過時間(分) |

## 3.2 出力: BidRecommendation

入札変更の推奨結果。

| フィールド | 型 | 説明 |
|-----------|------|------|
| keyword_id | string | キーワードID |
| campaign_id | string | キャンペーンID |
| ad_group_id | string | 広告グループID |
| action | ActionType | アクションタイプ |
| old_bid | number | 変更前の入札額 |
| new_bid | number | 推奨入札額 |
| change_rate | number | 変化率 (例: 0.15 = 15%増) |
| clipped | boolean | クリップされたか |
| clip_reason | string \| null | クリップ理由 |
| tos_targeted | boolean | TOS攻め対象か |
| tos_eligible_200 | boolean | TOS 200%許可対象か |
| base_change_rate | number | 基本変化率 |
| phase_coeff | number | フェーズ係数 |
| cvr_coeff | number | CVR係数 |
| rank_gap_coeff | number | ランクギャップ係数 |
| competitor_coeff | number | 競合係数 |
| brand_coeff | number | ブランド係数 |
| stats_coeff | number | 統計係数（リスク管理を統合） |
| tos_coeff | number | TOS係数 |
| reason_facts | string | 事実 |
| reason_logic | string | 判断根拠 |
| reason_impact | string | 影響予測 |

## 3.3 列挙型

### PhaseType（フェーズタイプ）

| 値 | 説明 |
|------|------|
| NORMAL | 通常フェーズ |
| S_PRE1 | セール準備期1 |
| S_PRE2 | セール準備期2 |
| S_FREEZE | セール開始直後（凍結） |
| S_NORMAL | セール通常期 |
| S_FINAL | セール終盤 |
| S_REVERT | セール終了後（復帰期） |

### BrandType（ブランドタイプ）

| 値 | 説明 |
|------|------|
| GENERIC | 一般キーワード |
| BRAND_OWN | 自社ブランドキーワード |
| BRAND_CONQUEST | 競合ブランドキーワード |

### ScoreRank（スコアランク）

| 値 | 条件 |
|------|------|
| S | ACOS < 20%, CVR > 2% |
| A | ACOS < 30%, CVR > 1% |
| B | ACOS < 50% |
| C | その他 |

### ActionType（アクションタイプ）

| 値 | 説明 | 基本変化率 |
|------|------|-----------|
| STRONG_UP | 大幅増額 | +25% |
| MILD_UP | 軽度増額 | +10% |
| KEEP | 維持 | 0% |
| MILD_DOWN | 軽度減額 | -10% |
| STRONG_DOWN | 大幅減額 | -25% |
| STOP | 停止 | -100% |

---

# 4. 入札ロジック

## 4.1 アクション決定フロー

```
                    ┌──────────────────┐
                    │  clicks_3h < 5?  │
                    └────────┬─────────┘
                             │
              ┌──── Yes ─────┼───── No ────┐
              ▼                            ▼
         ┌────────┐               ┌────────────────┐
         │  KEEP  │               │ ACOS Hard Stop │
         └────────┘               │ (ACOS > 3×目標)│
                                  └───────┬────────┘
                                          │
                           ┌──── Yes ─────┼───── No ────┐
                           ▼                            ▼
                      ┌────────┐              ┌─────────────────┐
                      │  STOP  │              │ ACOS Soft Down  │
                      └────────┘              │ (ACOS > 1.5×目標)│
                                              └────────┬────────┘
                                                       │
                                        ┌──── Yes ─────┼───── No ────┐
                                        ▼                            ▼
                                  ┌─────────────┐         ┌──────────────────┐
                                  │ STRONG_DOWN │         │ CVR/ACOS判定へ   │
                                  └─────────────┘         └──────────────────┘
```

## 4.2 CVRブースト計算

```
cvrBoost = (cvr_recent - cvr_baseline) / cvr_baseline

例: cvr_recent=0.06, cvr_baseline=0.05
→ cvrBoost = 0.20 (20%向上)
```

## 4.3 ACOS差分計算

```
acosDiff = acos_actual - acos_target

例: acos_actual=0.25, acos_target=0.20
→ acosDiff = 0.05 (目標より5%オーバー)
```

## 4.4 アクション決定条件

| 条件 | アクション |
|------|-----------|
| clicks < 5 | KEEP |
| ACOS > target × 3.0 | STOP |
| ACOS > target × 1.5 | STRONG_DOWN |
| CVR +30%以上 & ACOS良好 & ランクS/A | STRONG_UP |
| CVR +10%以上 & ACOS目標内 | MILD_UP |
| CVR -30%以上 | STRONG_DOWN |
| CVR -10%以上 OR ACOS悪化 | MILD_DOWN |
| その他 | KEEP |

## 4.5 TOS判定

### TOS攻め対象条件

1. S_MODE であること
2. clicks_3h ≥ 40
3. priority_score ≥ 0.8
4. risk_penalty ≤ 0.4
5. TOS Value (tos_ctr_mult × tos_cvr_mult) ≥ 1.5

### TOS 200%許可条件

- TOS攻め対象条件を満たす
- priority_score ≥ 0.9
- TOS Value ≥ 2.0

## 4.6 入札額計算式

```
最終変化率 = 基本変化率 × Π(7係数)

新入札額 = 現在入札額 × (1 + 最終変化率)
```

> **注**: v1.1.0でリスク係数(risk_coeff)は統計係数(stats_coeff)に統合されました（8係数→7係数）。

## 4.7 クリップ処理

| モード | 最大変化率 |
|--------|-----------|
| NORMAL | 60% |
| S_MODE (通常) | 150% |
| S_MODE (TOS対象) | 200% |

**その他の制限:**
- 最低入札額: 10円
- 現在入札額の3倍上限
- 競合CPCの1.15倍上限
- ベースラインCPCの2.5倍上限

---

# 5. 係数計算

## 5.1 係数一覧

| 係数 | 目的 | 範囲 |
|------|------|------|
| フェーズ係数 | セールフェーズに応じた調整 | 0.0 - 1.8 |
| CVR係数 | CVR変化に応じた調整 | 0.7 - 1.5 |
| ランクギャップ係数 | 目標ランクとの差に応じた調整 | 1.0 - 1.3 |
| 競合係数 | 競合CPC変動に応じた調整 | 1.0 - 1.25 |
| ブランド係数 | ブランド戦略に応じた調整 | 0.8 - 1.2 |
| 統計係数 | データ信頼性に応じた調整（リスク管理含む） | 0.5 - 1.1 |
| TOS係数 | TOS価値に応じた調整 | 1.0 - 1.8 |

## 5.2 フェーズ係数

| フェーズ | NORMAL | S_MODE |
|---------|--------|--------|
| NORMAL | 1.0 | 1.0 |
| S_PRE1 | 1.0 | **1.2** |
| S_PRE2 | 1.0 | **1.5** |
| S_FREEZE | 1.0 | **0.0** |
| S_NORMAL | 1.0 | **1.3** |
| S_FINAL | 1.0 | **1.8** |
| S_REVERT | 1.0 | **0.8** |

## 5.3 CVR係数

### NORMAL モード

| CVR変化 | 係数 |
|---------|------|
| +30%以上 | 1.15 |
| +10%以上 | 1.08 |
| -20%以下 | 0.85 |
| -10%以下 | 0.92 |
| その他 | 1.0 |

### S_MODE

| CVR変化 | 係数 |
|---------|------|
| +50%以上 | 1.5 |
| +30%以上 | 1.3 |
| +10%以上 | 1.15 |
| -30%以下 | 0.7 |
| -20%以下 | 0.85 |
| その他 | 1.0 |

## 5.4 ランクギャップ係数

```
gap = rank_current - rank_target
```

### UP系アクション

| gap | 係数 |
|-----|------|
| ≥5 | 1.3 |
| ≥3 | 1.2 |
| ≥1 | 1.1 |
| その他 | 1.0 |

### DOWN系アクション

| gap | 係数 |
|-----|------|
| ≤-3 | 1.15 |
| ≤-1 | 1.08 |
| その他 | 1.0 |

## 5.5 競合係数

```
cpcRatio = competitor_cpc_current / competitor_cpc_baseline
```

### UP系アクション

| cpcRatio | comp_strength | 係数 |
|----------|---------------|------|
| ≥1.2 | ≥0.6 | 1.25 |
| ≥1.1 | ≥0.5 | 1.15 |
| その他 | - | 1.0 |

### DOWN系アクション

| cpcRatio | 係数 |
|----------|------|
| ≤0.9 | 1.1 |
| その他 | 1.0 |

## 5.6 ブランド係数

| ブランドタイプ | UP系 | DOWN系 |
|---------------|------|--------|
| GENERIC | 1.0 | 1.0 |
| BRAND_OWN | **1.2** | **0.8** |
| BRAND_CONQUEST | **0.9** | 1.0 |

## 5.7 統計係数

| clicks_3h | STRONG系 | MILD系 |
|-----------|----------|--------|
| <5 | 0.5 | 0.5 |
| <20 | 0.7 | 0.85 |
| ≥20 | 1.1 | 1.1 |

## 5.8 TOS係数

**条件: S_MODE かつ TOS攻め対象**

```
tosValue = tos_ctr_mult × tos_cvr_mult
```

| tosValue | 係数 |
|----------|------|
| ≥2.0 | 1.8 |
| ≥1.5 | 1.5 |
| ≥1.2 | 1.3 |
| <1.2 | 1.2 |

**非適用時: 1.0**

## 5.9 計算例

```
高パフォーマンスキーワード（S_MODE, S_FINAL フェーズ）

基本変化率: 0.25 (STRONG_UP)

係数:
  フェーズ: 1.8 (S_FINAL)
  CVR: 1.5 (CVR大幅向上)
  ランクギャップ: 1.3 (大きなギャップ)
  競合: 1.25 (競合CPC上昇)
  ブランド: 1.0 (GENERIC)
  統計: 1.1 (高信頼)
  TOS: 1.8 (高TOS価値)

総係数 = 1.8 × 1.5 × 1.3 × 1.25 × 1.0 × 1.1 × 1.8 = 9.36

最終変化率 = 0.25 × 9.36 = 2.34 (234%)
→ クリップ後: 2.0 (200%, S_MODE TOS上限)
```

---

# 6. API仕様

## 6.1 エンドポイント一覧

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| GET | `/` | 不要 | サービス情報 |
| GET | `/health` | 不要 | ヘルスチェック |
| POST | `/recommend` | API Key | 入札推奨計算 |
| POST | `/cron/run` | OIDC/API Key | 汎用Cronジョブ |
| POST | `/cron/run-normal` | OIDC/API Key | NORMALモード定期実行 |
| POST | `/cron/run-smode` | OIDC/API Key | S_MODE定期実行 |

## 6.2 認証

### API Key認証

```http
X-API-Key: your-api-key
```
または
```http
Authorization: Bearer your-api-key
```

### OIDC認証（Google Cloud Scheduler）

```http
Authorization: Bearer <oidc-token>
```

## 6.3 POST /recommend

**リクエスト:**

```json
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

**レスポンス:**

```json
{
  "success": true,
  "total": 1,
  "recommendations": [
    {
      "keyword_id": "kw001",
      "action": "MILD_UP",
      "old_bid": 150,
      "new_bid": 165,
      "change_rate": 0.10,
      "clipped": false,
      "reason_facts": "CVR: 5.0% (基準: 4.0%, +25.0%)",
      "reason_logic": "CVR向上中 → ACOS良好 → MILD_UP",
      "reason_impact": "入札額: ¥150 → ¥165 (+10.0%)"
    }
  ]
}
```

## 6.4 POST /cron/run

**リクエスト:**

```json
{
  "mode": "NORMAL",
  "useMockData": false
}
```

**レスポンス:**

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

---

# 7. 設定・環境変数

## 7.1 必須環境変数

| 変数名 | 説明 |
|--------|------|
| AMAZON_ADS_CLIENT_ID | Amazon Ads API クライアントID |
| AMAZON_ADS_CLIENT_SECRET | Amazon Ads API クライアントシークレット |
| AMAZON_ADS_REFRESH_TOKEN | Amazon Ads API リフレッシュトークン |
| AMAZON_ADS_PROFILE_ID | Amazon Ads プロファイルID |

## 7.2 オプション環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| PORT | 8080 | サーバーポート |
| NODE_ENV | development | 環境 |
| AMAZON_ADS_API_BASE_URL | advertising-api.amazon.com | API URL |
| BIGQUERY_PROJECT_ID | rpptool | BigQueryプロジェクト |
| BIGQUERY_DATASET_ID | amazon_bid_engine | BigQueryデータセット |
| API_KEY | - | API認証キー |
| ENABLE_OIDC_AUTH | false | OIDC認証有効化 |
| GOOGLE_CLOUD_PROJECT_ID | - | GCPプロジェクトID |

## 7.3 GlobalConfig デフォルト値

```typescript
{
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
  currency: "JPY"
}
```

---

# 付録: 定数一覧

## しきい値

| カテゴリ | 定数名 | 値 |
|---------|--------|-----|
| CVR | SIGNIFICANT_BOOST | 0.3 |
| CVR | MILD_BOOST | 0.1 |
| CVR | MILD_DECLINE | -0.1 |
| CVR | SIGNIFICANT_DECLINE | -0.2 |
| ACOS | GOOD_MULTIPLIER | 0.2 |
| ACOS | WARNING_MULTIPLIER | 0.3 |
| ACOS | DANGER_MULTIPLIER | 0.5 |
| リスク | HIGH | 0.5 |
| リスク | MEDIUM | 0.3 |
| リスク | LOW | 0.2 |
| TOS | MIN_PRIORITY_SCORE | 0.8 |
| TOS | MIN_TOS_VALUE | 1.5 |

## 入札制限

| 定数名 | 値 | 説明 |
|--------|-----|------|
| MIN_BID | 10 | 最低入札額（円） |
| MAX_CURRENT_BID_MULTIPLIER | 3.0 | 現在入札額上限倍率 |
| MAX_COMPETITOR_CPC_MULTIPLIER | 1.15 | 競合CPC上限倍率 |
| MAX_BASELINE_CPC_MULTIPLIER | 2.5 | ベースラインCPC上限倍率 |

---

# 8. ネガティブキーワード候補検出

## 8.1 概要

統計的に安全な方法でネガティブキーワード候補をサジェストする機能です。
**SHADOWモード専用**であり、自動でキャンペーンにネガティブ登録は行いません。

## 8.2 ルールオブスリー（Rule of Three）

CVR=0 のとき、真のCVRの95%信頼上限は `3/N` と近似できます。

```
例: N=100クリックでCVR=0の場合
  → 95%信頼上限CVR ≒ 3/100 = 3%

必要クリック数の計算:
  requiredClicks = ceil(3 / (baselineCvr × riskTolerance))

例: baselineCvr=2%, riskTolerance=0.5 の場合
  requiredClicks = ceil(3 / (0.02 × 0.5)) = 300クリック
```

## 8.3 role別の最小クリック数

| role | 固定しきい値 | 説明 |
|------|-------------|------|
| GENERIC | 30 | 一般キーワード（最も判定しやすい） |
| BRAND_OWN | 50 | 自社ブランド（慎重に判定） |
| BRAND_CONQUEST | 40 | 競合ブランド（やや慎重） |
| OTHER | 30 | その他 |

## 8.4 NegativeReasonCode 一覧

| コード | 説明 |
|--------|------|
| NG_NO_CONVERSION | CVR=0 かつクリック数しきい値超え |
| NG_WASTED_SPEND | CPC高く、コストかさみ過ぎ |
| NG_CLUSTER_NO_CONVERSION | クラスタ単位でCVR=0 |
| NG_INTENT_MISMATCH | 検索意図不一致 |

## 8.5 除外されるライフサイクルステート

以下のステートではネガティブ候補を生成しません：

- **LAUNCH_HARD**: データ不足、投資優先
- **LAUNCH_SOFT**: データ収集中

## 8.6 BigQueryテーブル

### search_term_stats_30d（検索クエリ統計ビュー）

過去30日の検索クエリパフォーマンスを集計し、`product_core_terms` を使用して `intent_cluster_id` を付与。

### intent_cluster_stats_30d（クラスタ統計ビュー）

`intent_cluster_id` 単位でパフォーマンスを集計。

### negative_keyword_suggestions（候補テーブル）

SHADOWモードで検出されたネガティブキーワード候補を保存。

詳細は [architecture.md](./architecture.md#9-ネガティブキーワード候補サジェスト) および [bid_core.md](./bid_core.md#7-ネガティブキーワード候補計算-negative-keyword-calculatorts) を参照。

---

**ドキュメント終了**

*このドキュメントはAmazon Bid Engine v1.0.0 の完全仕様書です。*

*更新日: 2025年1月*

# LTV（顧客生涯価値）ベースのACOS計算

## 概要

Amazon広告の入札最適化において、商品の収益モデルに応じて適切なACOS（広告費売上比率）ターゲットを計算する機能です。

**収益モデルによる違い**

| 収益モデル | 例 | ACOS計算方針 |
|-----------|------|-------------|
| LTV | サプリメント | リピート購入を見込んでLTVベースで計算 |
| SINGLE_PURCHASE | シューズ | 単発購入前提で粗利率ベースで計算 |

---

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                         ProductConfig                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │  revenueModel   │  │     ltvMode     │  │ lifecycleState │  │
│  │ LTV/SINGLE_PURCH│  │ASSUMED/EARLY/   │  │LAUNCH_HARD/SOFT│  │
│  │                 │  │MEASURED         │  │GROW/HARVEST    │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              computeBaseLtvTargetAcos()                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ SINGLE_PURCHASE:                                          │  │
│  │   marginRate × SINGLE_PURCHASE_SAFETY_FACTOR (0.8)       │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ LTV (MEASURED):                                           │  │
│  │   marginRate × expectedRepeatOrdersMeasured × safety_m   │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ LTV (ASSUMED/EARLY_ESTIMATE):                            │  │
│  │   marginRate × expectedRepeatOrdersAssumed × safety_a    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              computeFinalTargetAcos()                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ LAUNCH_HARD:  min(baseLtvAcos × 1.0, 0.60)              │  │
│  │ LAUNCH_SOFT:  min(baseLtvAcos × 0.9, 0.50)              │  │
│  │ GROW:         min(baseLtvAcos × 0.8, 0.45)              │  │
│  │ HARVEST:      min(marginRate × 0.8, 0.35)               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                        target_acos
```

---

## 型定義

### RevenueModel

```typescript
type RevenueModel = "LTV" | "SINGLE_PURCHASE";
```

### LtvMode

```typescript
type LtvMode = "ASSUMED" | "EARLY_ESTIMATE" | "MEASURED";
```

**判定条件**

| モード | 経過日数 | 新規顧客数 | 説明 |
|--------|---------|-----------|------|
| ASSUMED | < 60日 or < 50人 | - | 仮定値ベース |
| EARLY_ESTIMATE | >= 60日 and >= 50人 | < 200人 | 早期推計 |
| MEASURED | >= 120日 and >= 200人 | - | 実測値ベース |

### ProductConfig

```typescript
interface ProductConfig {
  productId: string;
  asin: string;
  sku?: string;

  // 有効フラグ
  isActive: boolean;

  // 収益モデル
  revenueModel: RevenueModel;

  // ライフサイクル
  lifecycleState: "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST";

  // ビジネスモード
  businessMode: "PROFIT" | "SHARE";

  // カテゴリ・ブランド
  category?: string;
  brandType: "BRAND" | "GENERIC" | "CONQUEST";

  // 実験グループ
  experimentGroup: "CONTROL" | "VARIANT_A" | "VARIANT_B";

  // LTV関連
  ltvMode: LtvMode;
  marginRate: number;
  expectedRepeatOrdersAssumed: number;
  expectedRepeatOrdersMeasured: number | null;
  safetyFactorAssumed: number;
  safetyFactorMeasured: number;

  // 日付情報
  launchDate: Date | null;
  daysSinceLaunch: number | null;
  newCustomersTotal: number;

  // ライフサイクルサジェスト（オプション）
  lifecycleSuggestedState?: "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST";
  lastLifecycleSuggestedReason?: string;
}
```

---

## ACOS計算例

### サプリメント商品（LTV）

```
条件:
- revenueModel: "LTV"
- marginRate: 0.45 (45%)
- expectedRepeatOrdersAssumed: 2.5回
- safetyFactorAssumed: 0.7
- lifecycleState: "LAUNCH_HARD"

計算:
1. baseLtvAcos = 0.45 × 2.5 × 0.7 = 0.7875
2. finalAcos = min(0.7875 × 1.0, 0.60) = 0.60 (60%)
```

### シューズ商品（SINGLE_PURCHASE）

```
条件:
- revenueModel: "SINGLE_PURCHASE"
- marginRate: 0.35 (35%)
- lifecycleState: "GROW"

計算:
1. baseLtvAcos = 0.35 × 0.8 = 0.28
2. finalAcos = min(0.28 × 0.8, 0.45) = 0.224 (22.4%)
```

---

## 定数

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

## BigQueryテーブル

### product_config（唯一の正）

商品設定の**Single Source of Truth**。入札エンジンはこのテーブルから設定を読み込みます。

```sql
CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.product_config` (
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

### product_ltv_metrics（レガシー）

> **Note**: 新規実装では `product_config` テーブルを使用してください。

```sql
CREATE TABLE IF NOT EXISTS `{project_id}.{dataset}.product_ltv_metrics` (
  asin STRING NOT NULL,
  product_id STRING NOT NULL,
  margin_rate FLOAT64 NOT NULL,
  expected_repeat_orders_assumed FLOAT64 NOT NULL DEFAULT 1.0,
  expected_repeat_orders_measured_180d FLOAT64,
  safety_factor_assumed FLOAT64 NOT NULL DEFAULT 0.7,
  safety_factor_measured FLOAT64 NOT NULL DEFAULT 0.85,
  launch_date DATE,
  new_customers_total INT64 NOT NULL DEFAULT 0,
  revenue_model STRING,  -- "LTV" または "SINGLE_PURCHASE"
  last_ltv_updated_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_DATETIME(),
  PRIMARY KEY (product_id) NOT ENFORCED
);
```

---

## 使用方法

### 1. product_configから設定を読み込み（推奨）

```typescript
import { loadAllProductConfigs, loadProductConfigByAsin } from "./config/productConfigLoader";
import { getTargetAcos } from "./ltv";

// 全アクティブ商品の設定を読み込み
const configs = await loadAllProductConfigs({
  projectId: "your-project",
  dataset: "amazon_bid_engine",
});

// ASINでフィルタ
const config = configs.get("B0XXXXXXXXX");
if (config) {
  const targetAcos = getTargetAcos(config);
  console.log(`Target ACOS: ${(targetAcos * 100).toFixed(1)}%`);
}
```

### 2. 単一商品のACOS計算

```typescript
import { fetchProductConfig, getTargetAcos } from "./ltv";

const config = await fetchProductConfig(
  { projectId: "your-project", dataset: "amazon_bid_engine" },
  "product-001"
);

if (config) {
  const targetAcos = getTargetAcos(config);
  console.log(`Target ACOS: ${(targetAcos * 100).toFixed(1)}%`);
}
```

### 3. 詳細情報付きでACOS計算

```typescript
import { fetchProductConfig, getTargetAcosWithDetails } from "./ltv";

const config = await fetchProductConfig(
  { projectId: "your-project", dataset: "amazon_bid_engine" },
  "product-001"
);

if (config) {
  const result = getTargetAcosWithDetails(config);
  console.log(`Target ACOS: ${(result.targetAcos * 100).toFixed(1)}%`);
  console.log(`Revenue Model: ${result.baseLtvAcosDetails.revenueModel}`);
  console.log(`LTV Mode: ${result.baseLtvAcosDetails.ltvMode}`);
  console.log(`Lifecycle: ${result.finalAcosDetails.lifecycleState}`);
}
```

### 4. 複数商品のバルク取得

```typescript
import { fetchProductConfigs, getTargetAcos } from "./ltv";

const configs = await fetchProductConfigs(
  { projectId: "your-project", dataset: "amazon_bid_engine" },
  ["product-001", "product-002", "product-003"]
);

for (const [productId, config] of configs) {
  const targetAcos = getTargetAcos(config);
  console.log(`${productId}: ${(targetAcos * 100).toFixed(1)}%`);
}
```

---

## テスト

```bash
npm test -- --testPathPattern="ltv-calculator|product-config-builder|productConfigLoader"
```

**テストケース**

1. **LTVモード判定**
   - 経過日数と新規顧客数に基づくモード判定
   - カスタム閾値でのテスト

2. **ACOS計算**
   - SINGLE_PURCHASE商品: LTV値に関係なく粗利率ベース
   - LTV商品: モードに応じた計算
   - ライフサイクルステージによるキャップ適用

3. **ユーザー要件検証**
   - サプリ商品: LAUNCH_HARDとGROWでACOSが異なる
   - シューズ商品: サプリより低いACOS

4. **ProductConfigLoader**
   - product_configテーブルからの読み込み
   - 各フィールドのパース（RevenueModel, BusinessMode, BrandType等）
   - デフォルト値の適用

---

## 関連ドキュメント

- [ライフサイクル管理](./LIFECYCLE.md)
- [アーキテクチャ](./architecture.md)
- [入札コアロジック](./bid_core.md)
- [セットアップガイド](./SETUP.md)
- [ネガティブキーワード候補検出](./architecture.md#9-ネガティブキーワード候補サジェスト)

---

*更新日: 2025年1月*

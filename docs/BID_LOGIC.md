# 入札ロジック詳細

## 概要

入札ロジックは以下の4段階で構成されます：

1. **アクション決定** - パフォーマンス指標に基づいてアクションを決定
2. **係数計算** - 7種類の係数を計算
3. **入札額計算** - 基本変化率 × 係数 = 最終変化率
4. **クリップ処理** - 上限・下限によるクリッピング

> **注**: v1.1.0でリスク係数(risk_coeff)は統計係数(stats_coeff)に統合されました（8係数→7係数）。

---

## 1. アクション決定 (action-logic.ts)

### 決定フロー図

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

### CVRブースト計算

```typescript
cvrBoost = (cvr_recent - cvr_baseline) / cvr_baseline

// 例: cvr_recent=0.06, cvr_baseline=0.05
// cvrBoost = (0.06 - 0.05) / 0.05 = 0.2 (20%向上)
```

### ACOS差分計算

```typescript
acosDiff = acos_actual - acos_target

// 例: acos_actual=0.25, acos_target=0.20
// acosDiff = 0.25 - 0.20 = 0.05 (目標より5%オーバー)
```

### アクション決定マトリックス

| 条件 | アクション | 基本変化率 |
|------|-----------|-----------|
| clicks < min_clicks | KEEP | 0% |
| ACOS > target × 3.0 | STOP | -100% |
| ACOS > target × 1.5 | STRONG_DOWN | -30% |
| CVR向上30%+ & ACOS良好 & ランクS/A | STRONG_UP | +25% |
| CVR向上10%+ & ACOS目標内 | MILD_UP | +10% |
| CVR低下30%+ | STRONG_DOWN | -25% |
| CVR低下10%+ OR ACOS悪化 | MILD_DOWN | -10% |
| その他 | KEEP | 0% |

### ブランドタイプによる調整

```typescript
// BRAND_OWN（自社ブランド）の場合
if (brandType === "BRAND_OWN") {
  if (action === "STRONG_DOWN" || action === "STOP") {
    return "MILD_DOWN";  // 自社ブランドは守る
  }
}
```

---

## 2. TOS（Top of Search）判定 (tos-logic.ts)

### TOS攻め対象判定

```typescript
function isTOSTargeted(metrics: KeywordMetrics, config: GlobalConfig): boolean {
  // 条件1: S_MODEであること
  if (config.mode !== "S_MODE") return false;

  // 条件2: 十分なクリック数
  if (metrics.clicks_3h < config.min_clicks_for_tos) return false;

  // 条件3: 高い優先度スコア
  if (metrics.priority_score < 0.8) return false;

  // 条件4: 低いリスク
  if (metrics.risk_penalty > 0.4) return false;

  // 条件5: 高いTOS Value
  const tosValue = metrics.tos_ctr_mult * metrics.tos_cvr_mult;
  if (tosValue < 1.5) return false;

  return true;
}
```

### TOS 200%許可判定

```typescript
function isTOSEligible200(metrics: KeywordMetrics, config: GlobalConfig): boolean {
  // TOS攻め対象でなければNG
  if (!isTOSTargeted(metrics, config)) return false;

  // 条件1: より高い優先度スコア
  if (metrics.priority_score < 0.9) return false;

  // 条件2: より高いTOS Value
  const tosValue = metrics.tos_ctr_mult * metrics.tos_cvr_mult;
  if (tosValue < 2.0) return false;

  return true;
}
```

### TOS Value計算

```
TOS Value = TOS CTR乗数 × TOS CVR乗数

例: tos_ctr_mult=1.5, tos_cvr_mult=1.4
TOS Value = 1.5 × 1.4 = 2.1 → 200%許可対象
```

---

## 3. 入札額計算 (bid-calculation.ts)

### 計算式

```
最終変化率 = 基本変化率 × Π(係数)

新入札額 = 現在入札額 × (1 + 最終変化率)
```

### 基本変化率マッピング

| ActionType | 基本変化率 |
|------------|-----------|
| STRONG_UP | +0.25 (25%) |
| MILD_UP | +0.10 (10%) |
| KEEP | 0.00 (0%) |
| MILD_DOWN | -0.10 (-10%) |
| STRONG_DOWN | -0.25 (-25%) |
| STOP | -1.00 (-100%) |

### 係数適用例

```
基本変化率: +0.25 (STRONG_UP)
フェーズ係数: 1.2 (S_PRE1)
CVR係数: 1.15 (高CVR)
ランクギャップ係数: 1.3 (大きなギャップ)
競合係数: 1.25 (競合CPC上昇)
ブランド係数: 1.0 (GENERIC)
統計係数: 1.1 (高信頼)
TOS係数: 1.8 (高TOS Value)

最終変化率 = 0.25 × 1.2 × 1.15 × 1.3 × 1.25 × 1.0 × 1.1 × 1.8
           = 0.25 × 4.75
           = 1.19 (119%増)
```

---

## 4. クリップ処理

### 上限設定

| モード | 条件 | 最大変化率 |
|--------|------|-----------|
| NORMAL | - | 60% |
| S_MODE | 通常 | 150% |
| S_MODE | TOS対象 | 200% |

### 下限設定

```typescript
const MIN_BID = 10;  // 最低入札額（円）
```

### クリップ理由

| 理由コード | 説明 |
|-----------|------|
| `MAX_CHANGE_RATE` | 最大変化率でクリップ |
| `MIN_BID` | 最低入札額でクリップ |
| `MAX_CURRENT_BID_MULTIPLIER` | 現在入札額の3倍上限 |
| `MAX_COMPETITOR_CPC_MULTIPLIER` | 競合CPCの1.15倍上限 |
| `MAX_BASELINE_CPC_MULTIPLIER` | ベースラインCPCの2.5倍上限 |

### クリップ適用順序

```
1. 最大変化率クリップ
2. 絶対上限クリップ（3つの上限の最小値）
3. 最低入札額クリップ
```

---

## 5. 理由生成 (reason-generator.ts)

### Facts（事実）

数値ベースの事実情報：

```
例: "CVR: 5.0% (基準: 4.2%, +19.0%), ACOS: 18.0% (目標: 20.0%),
    ランク: 8位 (目標: 3位), スコアランク: A"
```

### Logic（判断根拠）

判断の論理的な説明：

```
例: "CVR向上中 → ACOS良好 → 高ランクキーワード → 増額余地あり → STRONG_UP"
```

### Impact（影響予測）

変更による影響の予測：

```
例: "入札額: ¥120 → ¥156 (+30.0%), クリップ: 最大変化率制限適用,
    予想効果: インプレッション増加、ランク上昇の可能性"
```

---

## 計算例

### 例1: 高パフォーマンスキーワード

**入力:**
```typescript
{
  current_bid: 100,
  cvr_recent: 0.06,      // 6%
  cvr_baseline: 0.04,    // 4%
  acos_actual: 0.15,     // 15%
  acos_target: 0.20,     // 20%
  clicks_3h: 50,
  score_rank: "A",
  risk_penalty: 0.1,
  // ... (S_MODEでTOS対象)
}
```

**計算:**
```
1. cvrBoost = (0.06 - 0.04) / 0.04 = 0.50 (50%向上)
2. acosDiff = 0.15 - 0.20 = -0.05 (目標より良い)
3. アクション = STRONG_UP (CVR大幅向上 & ACOS良好)
4. 基本変化率 = +0.25
5. 係数積 = 1.5 × 1.5 × ... = 約3.0
6. 最終変化率 = 0.25 × 3.0 = 0.75 (75%)
7. クリップ後 = 0.60 (NORMALモード上限)
8. 新入札額 = 100 × 1.60 = 160円
```

**出力:**
```typescript
{
  action: "STRONG_UP",
  old_bid: 100,
  new_bid: 160,
  change_rate: 0.60,
  clipped: true,
  clip_reason: "MAX_CHANGE_RATE",
  reason_facts: "CVR: 6.0% (基準: 4.0%, +50.0%), ACOS: 15.0% (目標: 20.0%)",
  reason_logic: "CVR大幅向上 → ACOS良好 → 高ランク → STRONG_UP",
  reason_impact: "入札額: ¥100 → ¥160 (+60.0%), 最大変化率制限適用"
}
```

### 例2: 低パフォーマンスキーワード

**入力:**
```typescript
{
  current_bid: 200,
  cvr_recent: 0.01,      // 1%
  cvr_baseline: 0.02,    // 2%
  acos_actual: 0.65,     // 65%
  acos_target: 0.20,     // 20%
  clicks_3h: 30,
  score_rank: "C",
  // ...
}
```

**計算:**
```
1. acosDiff = 0.65 - 0.20 = 0.45 (目標の3.25倍)
2. 0.65 > 0.20 × 3.0 (0.60) → ACOS Hard Stop
3. アクション = STOP
4. 基本変化率 = -1.00
5. 新入札額 = 10円 (最低入札額)
```

**出力:**
```typescript
{
  action: "STOP",
  old_bid: 200,
  new_bid: 10,
  change_rate: -0.95,
  clipped: true,
  clip_reason: "MIN_BID",
  reason_facts: "CVR: 1.0% (基準: 2.0%, -50.0%), ACOS: 65.0% (目標: 20.0%)",
  reason_logic: "ACOS危機的 (目標の3.25倍) → 即時停止 → STOP",
  reason_impact: "入札額: ¥200 → ¥10 (-95.0%), 出稿停止推奨"
}
```

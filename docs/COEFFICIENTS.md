# 係数計算ロジック詳細

## 概要

入札変化率は、基本変化率に7種類の係数を乗算して算出されます。

```
最終変化率 = 基本変化率 × フェーズ係数 × CVR係数 × ランクギャップ係数
                       × 競合係数 × ブランド係数 × 統計係数 × TOS係数
```

各係数は主に `1.0` を基準とし、条件によって増減します。

> **注**: v1.1.0でリスク係数(risk_coeff)は統計係数(stats_coeff)に統合されました。
> リスクペナルティとクリック数はどちらもデータの信頼性を表すため、統合することで簡潔になりました。

---

## 1. フェーズ係数 (Phase Coefficient)

### 目的
セールの各フェーズに応じて入札の積極度を調整します。

### 計算ロジック

| フェーズ | NORMAL モード | S_MODE |
|---------|--------------|--------|
| NORMAL | 1.0 | 1.0 |
| S_PRE1 | 1.0 | **1.2** |
| S_PRE2 | 1.0 | **1.5** |
| S_FREEZE | 1.0 | **0.0** |
| S_NORMAL | 1.0 | **1.3** |
| S_FINAL | 1.0 | **1.8** |
| S_REVERT | 1.0 | **0.8** |

### 詳細説明

| フェーズ | 係数 | 説明 |
|---------|------|------|
| **S_PRE1** | 1.2 | セール準備期1。徐々に入札を上げ始める |
| **S_PRE2** | 1.5 | セール準備期2。本格的に入札を上げる |
| **S_FREEZE** | 0.0 | セール開始直後。入札変更を凍結 |
| **S_NORMAL** | 1.3 | セール通常期。積極的に入札 |
| **S_FINAL** | 1.8 | セール終盤。最大限の攻め |
| **S_REVERT** | 0.8 | セール終了後。通常に戻す |

### コード

```typescript
export function calculatePhaseCoeff(
  phaseType: PhaseType,
  mode: OperationMode
): number {
  if (mode === "NORMAL") return 1.0;

  const phaseCoeffs: Record<PhaseType, number> = {
    NORMAL: 1.0,
    S_PRE1: 1.2,
    S_PRE2: 1.5,
    S_FREEZE: 0.0,
    S_NORMAL: 1.3,
    S_FINAL: 1.8,
    S_REVERT: 0.8,
  };

  return phaseCoeffs[phaseType] ?? 1.0;
}
```

---

## 2. CVR係数 (CVR Coefficient)

### 目的
CVR（コンバージョン率）の変化に応じて入札を調整します。

### 計算ロジック

```typescript
cvrChange = (cvr_recent - cvr_baseline) / cvr_baseline
```

#### NORMAL モード

| cvrChange | 係数 | 条件 |
|-----------|------|------|
| ≥ +30% | 1.15 | CVR大幅向上 |
| ≥ +10% | 1.08 | CVR向上 |
| ≤ -20% | 0.85 | CVR大幅低下 |
| ≤ -10% | 0.92 | CVR低下 |
| その他 | 1.0 | 変化なし |

#### S_MODE

| cvrChange | 係数 | 条件 |
|-----------|------|------|
| ≥ +50% | 1.5 | CVR大幅向上 |
| ≥ +30% | 1.3 | CVR中程度向上 |
| ≥ +10% | 1.15 | CVR軽度向上 |
| ≤ -30% | 0.7 | CVR大幅低下 |
| ≤ -20% | 0.85 | CVR中程度低下 |
| その他 | 1.0 | 変化なし |

### 例

```
cvr_recent = 0.065, cvr_baseline = 0.05
cvrChange = (0.065 - 0.05) / 0.05 = 0.30 (30%向上)

NORMAL モード → 係数 = 1.15
S_MODE → 係数 = 1.3
```

---

## 3. ランクギャップ係数 (Rank Gap Coefficient)

### 目的
現在のランクと目標ランクの差に応じて入札を調整します。

### 計算ロジック

```typescript
gap = rank_current - rank_target
// 正の値: 目標より下位（増額方向）
// 負の値: 目標より上位（減額方向）
```

#### UP系アクションの場合

| gap | 係数 | 条件 |
|-----|------|------|
| ≥ 5 | 1.3 | 大きなギャップ（目標より大幅下位） |
| ≥ 3 | 1.2 | 中程度のギャップ |
| ≥ 1 | 1.1 | 小さなギャップ |
| その他 | 1.0 | ギャップなし |

#### DOWN系アクションの場合

| gap | 係数 | 条件 |
|-----|------|------|
| ≤ -3 | 1.15 | 目標より大幅上位（減額余地大） |
| ≤ -1 | 1.08 | 目標より上位（減額余地あり） |
| その他 | 1.0 | ギャップなし |

### 例

```
rank_current = 10, rank_target = 3
gap = 10 - 3 = 7 (大きなギャップ)

アクション = STRONG_UP → 係数 = 1.3
```

---

## 4. 競合係数 (Competitor Coefficient)

### 目的
競合のCPC変動と競合強度に応じて入札を調整します。

### 計算ロジック

```typescript
cpcRatio = competitor_cpc_current / competitor_cpc_baseline
```

#### UP系アクションの場合

| cpcRatio | comp_strength | 係数 | 条件 |
|----------|---------------|------|------|
| ≥ 1.2 | ≥ 0.6 | 1.25 | 競合CPC大幅上昇 & 強い競合 |
| ≥ 1.1 | ≥ 0.5 | 1.15 | 競合CPC上昇 & 中程度の競合 |
| その他 | - | 1.0 | 変化なし |

#### DOWN系アクションの場合

| cpcRatio | 係数 | 条件 |
|----------|------|------|
| ≤ 0.9 | 1.1 | 競合CPC下落（追随して減額） |
| その他 | 1.0 | 変化なし |

### 例

```
competitor_cpc_current = 180, competitor_cpc_baseline = 150
cpcRatio = 180 / 150 = 1.2
comp_strength = 0.7

アクション = STRONG_UP → 係数 = 1.25
```

---

## 5. ブランド係数 (Brand Coefficient)

### 目的
キーワードのブランドタイプに応じて入札戦略を調整します。

### 計算ロジック

| ブランドタイプ | UP系アクション | DOWN系アクション |
|---------------|---------------|-----------------|
| GENERIC | 1.0 | 1.0 |
| BRAND_OWN | **1.2** | **0.8** |
| BRAND_CONQUEST | **0.9** | 1.0 |

### 詳細説明

| タイプ | UP時 | DOWN時 | 理由 |
|--------|------|--------|------|
| **BRAND_OWN** | 1.2 | 0.8 | 自社ブランドは守りたい。増額時は積極的、減額時は慎重 |
| **BRAND_CONQUEST** | 0.9 | 1.0 | 競合ブランドは攻めすぎない。ROAS確保を優先 |
| **GENERIC** | 1.0 | 1.0 | 一般キーワードは標準的な対応 |

---

## 6. 統計係数 (Stats Coefficient)

### 目的
データの信頼性（クリック数）に応じて入札変更の強度を調整します。

### 計算ロジック

| clicks_3h | STRONG系アクション | MILD系アクション |
|-----------|-------------------|-----------------|
| < min_clicks_for_decision (5) | 0.5 | 0.5 |
| < min_clicks_for_confident (20) | 0.7 | 0.85 |
| ≥ min_clicks_for_confident | 1.1 | 1.1 |

### 詳細説明

| 状態 | 係数 | 理由 |
|------|------|------|
| **データ不足** | 0.5 | 信頼性が低いため変更を大幅抑制 |
| **低信頼度** | 0.7/0.85 | 慎重に変更 |
| **高信頼度** | 1.1 | 十分なデータがあるため積極的に変更 |

---

## 7. TOS係数 (TOS Coefficient)

### 目的
TOS（Top of Search）攻め対象キーワードの入札を増強します。

### 計算ロジック

**適用条件**
1. S_MODE であること
2. TOS攻め対象であること（`tos_targeted = true`）

**TOS Value計算**

```typescript
tosValue = tos_ctr_mult * tos_cvr_mult
```

**係数マッピング**

| tosValue | 係数 | 条件 |
|----------|------|------|
| ≥ 2.0 | 1.8 | 高TOS価値 |
| ≥ 1.5 | 1.5 | 中TOS価値 |
| ≥ 1.2 | 1.3 | 標準TOS価値 |
| < 1.2 | 1.2 | 最低TOS価値 |

**非適用時: 1.0**

### 例

```
tos_ctr_mult = 1.5, tos_cvr_mult = 1.4
tosValue = 1.5 × 1.4 = 2.1

TOS攻め対象 & S_MODE → 係数 = 1.8
```

---

## 係数の相互作用

### 係数の掛け算による効果

各係数は独立して計算され、最終的に掛け合わされます。

```
例: 高パフォーマンスキーワード（S_MODE, S_FINAL フェーズ）

フェーズ係数: 1.8 (S_FINAL)
CVR係数: 1.5 (CVR大幅向上)
ランクギャップ係数: 1.3 (大きなギャップ)
競合係数: 1.25 (競合CPC上昇)
ブランド係数: 1.0 (GENERIC)
統計係数: 1.1 (高信頼)
TOS係数: 1.8 (高TOS価値)

総係数 = 1.8 × 1.5 × 1.3 × 1.25 × 1.0 × 1.1 × 1.8
       = 9.36

基本変化率 0.25 (STRONG_UP) × 9.36 = 2.34 (234%)
→ クリップ後: 2.0 (200%, S_MODE TOS上限)
```

### 係数の意図

| 係数 | 役割 |
|------|------|
| フェーズ係数 | セール期間の戦略的入札 |
| CVR係数 | パフォーマンスに連動 |
| ランクギャップ係数 | 順位目標の達成 |
| 競合係数 | 競合環境への適応 |
| ブランド係数 | ブランド戦略の反映 |
| 統計係数 | データ品質の考慮（リスク管理含む） |
| TOS係数 | TOS攻めの実現 |

---

## 定数一覧（src/constants.ts）

```typescript
export const COEFFICIENTS = {
  // フェーズ係数
  PHASE: {
    NORMAL: 1.0,
    S_PRE1: 1.2,
    S_PRE2: 1.5,
    S_FREEZE: 0.0,
    S_NORMAL: 1.3,
    S_FINAL: 1.8,
    S_REVERT: 0.8,
  },
  // CVR係数（NORMALモード）
  CVR_NORMAL: {
    HIGH_BOOST: 1.15,
    MILD_BOOST: 1.08,
    MILD_DECLINE: 0.92,
    HIGH_DECLINE: 0.85,
    NEUTRAL: 1.0,
  },
  // CVR係数（S_MODE）
  CVR_SMODE: {
    HIGH_BOOST: 1.5,
    MEDIUM_BOOST: 1.3,
    MILD_BOOST: 1.15,
    HIGH_DECLINE: 0.7,
    MEDIUM_DECLINE: 0.85,
    NEUTRAL: 1.0,
  },
  // ランクギャップ係数
  RANK_GAP: {
    LARGE_UP: 1.3,
    MEDIUM_UP: 1.2,
    SMALL_UP: 1.1,
    MEDIUM_DOWN: 1.15,
    SMALL_DOWN: 1.08,
    NEUTRAL: 1.0,
  },
  // 競合係数
  COMPETITOR: {
    HIGH_INCREASE: 1.25,
    MILD_INCREASE: 1.15,
    DECREASE: 1.1,
    NEUTRAL: 1.0,
  },
  // ブランド係数
  BRAND: {
    OWN_UP: 1.2,
    OWN_DOWN: 0.8,
    CONQUEST_UP: 0.9,
    NEUTRAL: 1.0,
  },
  // 統計係数（リスク管理を統合）
  STATS: {
    INSUFFICIENT: 0.5,
    LOW_CONFIDENCE: 0.7,
    MEDIUM_CONFIDENCE: 0.85,
    HIGH_CONFIDENCE: 1.1,
    NEUTRAL: 1.0,
  },
  // TOS係数
  TOS: {
    HIGH_VALUE: 1.8,
    MEDIUM_VALUE: 1.5,
    NORMAL_VALUE: 1.3,
    MIN_VALUE: 1.2,
    NEUTRAL: 1.0,
  },
};
```

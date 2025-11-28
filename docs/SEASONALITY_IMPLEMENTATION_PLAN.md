# 季節性予測による先行入札調整機能 - 実装計画

## 概要

Jungle Scoutの検索ボリューム履歴データを活用し、季節的なピークを予測して**ピーク到来前**に入札を調整する機能。

## 探索結果

### 既存コンポーネントの活用

1. **Jungle Scout Client** (`src/jungle-scout/client.ts`)
   - `getHistoricalSearchVolume()` メソッドが既に存在
   - RateLimiter、サーキットブレーカー、リトライロジック完備
   - 新規APIメソッド追加は不要

2. **bidEngine.ts統合パターン** (`src/engine/bidEngine.ts`)
   - `computeRecommendation()` 内でレイヤー適用
   - 適用順序: eventPolicy → recommendedBid → inventoryGuard → guardrails
   - **季節性レイヤーはinventoryGuardの後、guardrailsの前に配置**

3. **SHADOW/APPLYモードパターン** (`src/event/types.ts`)
   - EventModeパターンを参考にSHADOW/APPLY切り替え実装
   - `disableDuringEventOverride` でS-MODE時無効化

4. **モジュール構造パターン** (`src/guardrails/`, `src/keywordDiscovery/`)
   - types.ts → config.ts → core logic → repository.ts → job.ts → httpHandler.ts → index.ts

---

## 実装ファイル一覧

```
src/seasonality/
├── types.ts              # 型定義
├── config.ts             # 設定とカテゴリヒント
├── peak-detector.ts      # ピーク検出アルゴリズム
├── predictor.ts          # 予測ロジック
├── repository.ts         # BigQuery永続化
├── job.ts                # バッチジョブ
├── integration.ts        # bidEngine統合
└── index.ts              # Public API

src/bigquery/schemas/
└── seasonality_predictions.sql  # BigQueryスキーマ

tests/
└── seasonality.test.ts   # ユニットテスト
```

---

## 実装ステップ

### Phase 1: コアモジュール作成

#### Step 1.1: types.ts
- `SeasonalityPrediction` - 予測結果の型
- `PeakInfo` - ピーク情報
- `SeasonalityConfig` - 設定型
- `SeasonalityAdjustment` - 調整結果

#### Step 1.2: config.ts
- `SUPPLEMENT_CATEGORY_HINTS` - サプリメントカテゴリごとの事前知識
  - diet: [1, 5] (正月明け、GW前)
  - immune: [11, 12, 1] (風邪シーズン)
  - allergy: [2, 3, 4] (花粉シーズン)
  - uv: [4, 5, 6, 7, 8] (紫外線シーズン)
  - nmn: [12, 1] (年末年始)
  - gaba: [3, 4, 9] (新生活、異動シーズン)
  - vitamin_d: [10, 11, 12, 1, 2] (日照不足シーズン)
  - protein: [1, 4, 9] (トレーニング開始シーズン)
  - gift: [12, 2] (クリスマス、バレンタイン)
- `DEFAULT_SEASONALITY_CONFIG` - デフォルト設定

#### Step 1.3: peak-detector.ts
- `detectPeaks()` - 履歴データからピーク月を検出
- 月別統計（平均、標準偏差）計算
- baselineからの乖離でピーク判定
- confidenceスコア算出

#### Step 1.4: predictor.ts
- `predictSeasonality()` - メイン予測関数
- Jungle Scoutデータ取得 + カテゴリヒント統合
- Pre-peak期間判定（ピーク7-30日前）
- 入札倍率計算（1.0〜maxMultiplier）

### Phase 2: 永続化

#### Step 2.1: BigQueryスキーマ
```sql
CREATE TABLE seasonality_predictions (
  keyword STRING NOT NULL,
  asin STRING,
  predicted_peaks ARRAY<STRUCT<month INT64, confidence FLOAT64>>,
  current_multiplier FLOAT64,
  is_pre_peak_period BOOL,
  days_until_peak INT64,
  category_hint STRING,
  data_source STRING,  -- JS_ONLY, CATEGORY_HINT, COMBINED
  confidence_score FLOAT64,
  last_updated TIMESTAMP,
  raw_monthly_volumes ARRAY<STRUCT<month INT64, volume INT64>>
)
PARTITION BY DATE(last_updated)
CLUSTER BY keyword, asin
```

#### Step 2.2: repository.ts
- `savePredictions()` - 予測結果保存
- `getPrediction()` - 単一キーワード取得
- `getActivePredictions()` - アクティブな調整一覧
- `getExpiredPredictions()` - 期限切れ予測

### Phase 3: ジョブとAPI

#### Step 3.1: job.ts
- `runSeasonalityUpdateJob()` - バッチ更新ジョブ
- アクティブキーワード取得 → 予測更新 → 保存
- エラーハンドリングとリトライ

#### Step 3.2: httpHandler.ts
- `createSeasonalityUpdateHandler()` - Cronエンドポイント
- `createSeasonalityQueryHandler()` - 個別クエリ
- `createActiveAdjustmentsHandler()` - アクティブ一覧

#### Step 3.3: routes/cron.ts更新
```typescript
router.post("/cron/seasonality-update", createSeasonalityUpdateHandler());
```

### Phase 4: bidEngine統合

#### Step 4.1: integration.ts
- `applySeasonalityAdjustment()` - 入札調整適用関数
- SHADOW/APPLYモード切り替え
- S-MODE時は無効化
- 既存ガード（LTV, inventory, maxBid）を超えない

#### Step 4.2: bidEngine.ts修正
```typescript
// computeRecommendation内、inventoryGuardの後に追加
if (seasonalityConfig.enabled && !isEventOverrideActive) {
  recommendation = applySeasonalityAdjustment(
    recommendation,
    seasonalityPrediction,
    seasonalityConfig
  );
}
```

### Phase 5: テストと文書

#### Step 5.1: ユニットテスト
- peak-detector.ts: 各カテゴリのピーク検出
- predictor.ts: 倍率計算、confidence閾値
- integration.ts: SHADOW/APPLY動作、ガード連携

#### Step 5.2: ドキュメント更新
- docs/architecture.md
- docs/bid_core.md
- docs/SEASONALITY.md (新規)

---

## 設定項目

| 環境変数 | 説明 | デフォルト |
|---------|------|-----------|
| `SEASONALITY_ENABLED` | 機能有効化 | false |
| `SEASONALITY_MODE` | SHADOW/APPLY | SHADOW |
| `SEASONALITY_MAX_MULTIPLIER` | 最大倍率 | 1.3 |
| `SEASONALITY_CONFIDENCE_THRESHOLD` | 最低信頼度 | 0.6 |
| `SEASONALITY_PRE_PEAK_DAYS_MIN` | Pre-peak開始日 | 7 |
| `SEASONALITY_PRE_PEAK_DAYS_MAX` | Pre-peak終了日 | 30 |

---

## 重要な設計判断

1. **ピーク「前」の調整**: ピーク当日ではなく、7-30日前から入札を上げることで競合に先行
2. **複数ピーク対応**: diet系は1月と5月の2回ピークなど、年間複数ピークをサポート
3. **カテゴリヒント活用**: データ不足時でもサプリメントカテゴリの事前知識で精度向上
4. **既存ガード尊重**: maxBid、LTV上限、在庫制限を絶対に超えない
5. **SHADOW優先**: 本番適用前に十分なSHADOW期間でログ検証

---

## 見積もり工数

- Phase 1 (コアモジュール): 4ファイル
- Phase 2 (永続化): 2ファイル
- Phase 3 (ジョブとAPI): 2ファイル + routes更新
- Phase 4 (bidEngine統合): 1ファイル + bidEngine修正
- Phase 5 (テストと文書): 1テストファイル + ドキュメント3件

合計: 約10-12ファイルの新規作成/修正

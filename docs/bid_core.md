# 入札ロジック コアリファレンス

> compute_bid_recommendations と関連するTypeScriptコードの詳細リファレンス

---

## 目次

1. [メイン関数 (bidEngine.ts)](#1-メイン関数-bidenginets)
2. [推奨計算 (computeRecommendation)](#2-推奨計算-computerecommendation)
3. [理由コード判定 (determineReasonCode)](#3-理由コード判定-determinereasoncode)
4. [ACOS計算 (ltv-calculator.ts)](#4-acos計算-ltv-calculatorts)
5. [アクション決定 (bid-integration.ts)](#5-アクション決定-bid-integrationts)
6. [推奨入札額算出 (calculateRecommendedBid)](#6-推奨入札額算出-calculaterecommendedbid)
7. [ネガティブキーワード候補計算 (negative-keyword-calculator.ts)](#7-ネガティブキーワード候補計算-negative-keyword-calculatorts)
8. [自動ガードレール (auto-guardrails.ts)](#8-自動ガードレール-auto-guardrailsts)
9. [在庫ガード (inventoryGuard.ts)](#9-在庫ガード-inventoryguardts)
10. [AUTO→EXACT 昇格エンジン (auto-exact-promotion-engine.ts)](#10-autoexact-昇格エンジン-auto-exact-promotion-enginets)
11. [Slack 実行サマリー通知 (executionSummaryNotifier.ts)](#11-slack-実行サマリー通知-executionsummarynotifierts)
12. [イベントオーバーライド (event/types.ts)](#12-イベントオーバーライド-eventtypests)
13. [APPLY モード安全設計 (apply/)](#13-apply-モード安全設計-apply)
14. [掲載位置（Placement）最適化 (placement/)](#14-掲載位置placement最適化-placement)
15. [日予算（Budget）最適化 (budget/)](#15-日予算budget最適化-budget)
16. [運用監視・アラート (monitoring/)](#16-運用監視アラート-monitoring)
17. [キーワード自動発見 (keywordDiscovery/)](#17-キーワード自動発見-keyworddiscovery)
18. [商品レベル TACOS コントローラ](#18-商品レベル-tacos-コントローラ)
19. [商品プロファイル・新商品ロジック](#19-商品プロファイル新商品ロジック)
20. [LTV期待粗利・累積赤字管理](#20-ltv期待粗利累積赤字管理)
21. [激戦度判定・自動プロファイル割り当て](#21-激戦度判定自動プロファイル割り当て)
22. [成長判定条件（isGrowingCandidate）](#22-成長判定条件isgrowingcandidate)
23. [理論最大TACOS（theoreticalMaxTacos）](#23-理論最大tacostheoreticalmaxTacos)
24. [TACOSターゲットレンジとゾーン定義](#24-tacosターゲットレンジとゾーン定義)
25. [TACOS乖離によるtargetAcos調整](#25-tacos乖離によるtargetacos調整)
26. [ライフサイクルとTACOSゾーンの連動](#26-ライフサイクルとtacosゾーンの連動)
27. [SEO目標順位ロジック](#27-seo目標順位ロジック)
28. [商品レベルTACOSコントローラ](#28-商品レベルtacosコントローラ)
29. [新商品プロファイル](#29-新商品プロファイル)
30. [TACOS健全性評価](#30-tacos健全性評価)
31. [アトリビューション防御ロジック](#31-アトリビューション防御ロジックattribution-defense)
32. [プレセール診断（Presale Diagnosis）](#32-プレセール診断presale-diagnosis)
33. [T_opt推定とライフサイクル別TACOS（Analytics）](#33-t_opt推定とライフサイクル別tacosanalytics)
34. [lossBudget評価（ASIN投資健全性）](#34-lossbudget評価asin投資健全性)
35. [SEOローンチ評価（Launch Exit Decision）](#35-seoローンチ評価launch-exit-decision)
36. [期待CVR計算ロジック（expectedCvr）](#36-期待cvr計算ロジックexpectedcvr)
37. [CORE_SEOキーワードスコアリング（coreSeoScore）](#37-core_seoキーワードスコアリングcoreseoscore)
38. [TACOS-ACOS統合モデル](#38-tacos-acos統合モデル)
39. [理論最大CPCガード](#39-理論最大cpcガード)
40. [セール用期待CVR（expectedCvr_sale）](#40-セール用期待cvrexpectedcvr_sale)
41. [ロール×ライフサイクル別ガードレール](#41-ロールライフサイクル別ガードレール)

---

## 1. メイン関数 (bidEngine.ts)

```typescript
// src/engine/bidEngine.ts

/**
 * 入札エンジン実行
 */
export async function runBidEngine(config: BidEngineConfig): Promise<BidEngineResult> {
  // 実行モード確認・ログ出力
  logExecutionModeOnStartup();

  const mode = getExecutionMode();

  // ExecutionLogger初期化
  const executionLogger = createExecutionLogger({
    projectId: config.projectId,
    dataset: config.dataset,
    mode,
    triggerSource: config.triggerSource ?? "API",
    triggeredBy: config.triggeredBy,
  });

  const recommendations: BidRecommendation[] = [];

  try {
    // 実行ログ開始
    await executionLogger.start();

    // 1. 有効な全商品設定を取得
    const productConfigs = await loadAllProductConfigs({
      projectId: config.projectId,
      dataset: config.dataset,
    });

    executionLogger.updateStats({
      totalProductsCount: productConfigs.size,
    });

    if (productConfigs.size === 0) {
      await executionLogger.finish();
      return {
        executionId: executionLogger.getExecutionId(),
        mode,
        status: "SUCCESS",
        stats: { totalProducts: 0, totalKeywords: 0, recommendations: 0, applied: 0, skipped: 0, errors: 0 },
        recommendations: [],
      };
    }

    // 2. キーワード指標を取得
    const asins = Array.from(productConfigs.keys());
    const keywordMetricsMap = await fetchKeywordMetrics(config, asins);

    let totalKeywords = 0;
    for (const keywords of keywordMetricsMap.values()) {
      totalKeywords += keywords.length;
    }
    executionLogger.updateStats({ totalKeywordsCount: totalKeywords });

    // 3. 商品・キーワードごとに入札推奨を計算
    for (const [asin, product] of productConfigs) {
      const keywords = keywordMetricsMap.get(asin) || [];

      for (const keyword of keywords) {
        // 推奨計算
        const recommendation = computeRecommendation(product, keyword);
        recommendations.push(recommendation);

        // ログに記録
        await executionLogger.logRecommendation({
          asin: recommendation.asin,
          keywordId: recommendation.keywordId,
          keywordText: recommendation.keywordText,
          matchType: recommendation.matchType,
          campaignId: recommendation.campaignId,
          adGroupId: recommendation.adGroupId,
          oldBid: recommendation.oldBid,
          newBid: recommendation.newBid,
          bidChange: recommendation.bidChange,
          bidChangePercent: recommendation.bidChangePercent,
          targetAcos: recommendation.targetAcos,
          currentAcos: recommendation.currentAcos ?? undefined,
          reasonCode: recommendation.reasonCode,
          reasonDetail: recommendation.reasonDetail,
          lifecycleState: product.lifecycleState,
          revenueModel: product.revenueModel,
          ltvMode: product.ltvMode,
          isApplied: false,
        });

        // 4. 変更がある場合のみAPIを呼び出して適用
        if (recommendation.bidChange !== 0) {
          const { wasApplied, error } = await applyBidWithMode(
            async () => {
              // Amazon Ads API呼び出し
              // await amazonAdsClient.updateKeywordBid({ keywordId, newBid });
            },
            {
              keywordId: recommendation.keywordId,
              keywordText: recommendation.keywordText,
              oldBid: recommendation.oldBid,
              newBid: recommendation.newBid,
            }
          );

          if (wasApplied) {
            executionLogger.incrementStats("appliedCount");
          } else if (error) {
            executionLogger.incrementStats("errorCount");
          } else {
            executionLogger.incrementStats("skippedCount"); // SHADOWモード
          }
        }
      }
    }

    // 5. 完了
    await executionLogger.finish();

    return {
      executionId: executionLogger.getExecutionId(),
      mode,
      status: "SUCCESS",
      stats: { ... },
      recommendations,
    };
  } catch (error) {
    await executionLogger.finishWithError(error);
    return { executionId, mode, status: "ERROR", ... };
  }
}
```

---

## 2. 推奨計算 (computeRecommendation)

```typescript
// src/engine/bidEngine.ts:292-345

/**
 * 単一キーワードの入札推奨を計算
 */
function computeRecommendation(
  product: ProductConfig,
  metrics: KeywordMetrics,
  lifecycleConfig: LifecycleGlobalConfig = DEFAULT_LIFECYCLE_GLOBAL_CONFIG
): BidRecommendation {
  // 目標ACOS算出（LTV考慮）
  const acosDetails = getTargetAcosWithDetails(product);
  const targetAcos = acosDetails.targetAcos;

  // アクション決定
  const isInvestMode =
    product.lifecycleState === "LAUNCH_HARD" || product.lifecycleState === "LAUNCH_SOFT";
  const action = determineBidAction(
    metrics.currentAcos,
    targetAcos,
    metrics.clicks7d,
    isInvestMode
  );

  // 推奨入札額算出
  const { recommendedBid, changeRate } = calculateRecommendedBid(
    metrics.currentBid || 100,
    action,
    lifecycleConfig
  );

  const bidChange = recommendedBid - (metrics.currentBid || 100);
  const bidChangePercent =
    metrics.currentBid > 0 ? (bidChange / metrics.currentBid) * 100 : 0;

  const reasonCode = determineReasonCode(product, metrics, action);

  // 理由詳細を生成
  const reasonDetail = buildReasonDetail(product, metrics, action, targetAcos, reasonCode);

  return {
    asin: product.asin,
    keywordId: metrics.keywordId,
    keywordText: metrics.keywordText,
    matchType: metrics.matchType,
    campaignId: metrics.campaignId,
    adGroupId: metrics.adGroupId,
    oldBid: metrics.currentBid || 0,
    newBid: recommendedBid,
    bidChange,
    bidChangePercent,
    targetAcos,
    currentAcos: metrics.currentAcos,
    reasonCode,
    reasonDetail,
    product,
    metrics,
  };
}
```

---

## 3. 理由コード判定 (determineReasonCode)

```typescript
// src/engine/bidEngine.ts:229-287

/**
 * 入札推奨の理由コードを判定
 */
function determineReasonCode(
  product: ProductConfig,
  metrics: KeywordMetrics,
  action: string
): ReasonCode {
  // 1. ライフサイクルステージの判定（最優先）
  if (product.lifecycleState === "LAUNCH_HARD" || product.lifecycleState === "LAUNCH_SOFT") {
    if (action === "STRONG_UP" || action === "MILD_UP") {
      return "LIFECYCLE_LAUNCH";
    }
  }

  if (product.lifecycleState === "HARVEST") {
    if (action === "MILD_DOWN" || action === "STRONG_DOWN") {
      return "LIFECYCLE_HARVEST";
    }
  }

  // 2. オーガニック順位による判定
  if (metrics.organicRank !== null) {
    if (metrics.organicRank <= 7 && (action === "MILD_DOWN" || action === "STRONG_DOWN")) {
      return "ORGANIC_STRONG";
    }
    if (metrics.organicRank > 20 && (action === "STRONG_UP" || action === "MILD_UP")) {
      return "ORGANIC_WEAK";
    }
  }

  // 3. インプレッション不足
  if (metrics.impressions7d < 100) {
    return "LOW_IMPRESSIONS";
  }

  // 4. コンバージョンがない
  if (metrics.conversions7d === 0 && metrics.clicks7d > 10) {
    return "NO_CONVERSION";
  }

  // 5. ACOS基準の判定
  if (metrics.currentAcos !== null) {
    const targetAcos = getTargetAcosWithDetails(product).targetAcos;
    if (metrics.currentAcos > targetAcos * 1.2) {
      return "ACOS_HIGH";
    }
    if (metrics.currentAcos < targetAcos * 0.7) {
      return "ACOS_LOW";
    }
  }

  // 6. 変更なし
  if (action === "KEEP") {
    return "NO_CHANGE";
  }

  // 7. デフォルト
  return metrics.currentAcos !== null && metrics.currentAcos > 0
    ? "ACOS_HIGH"
    : "NO_CHANGE";
}
```

### ReasonCode 一覧

```typescript
type ReasonCode =
  | "ACOS_HIGH"          // ACOSが目標より高い
  | "ACOS_LOW"           // ACOSが目標より低い（上げ余地あり）
  | "NO_CONVERSION"      // コンバージョンがない
  | "LOW_IMPRESSIONS"    // インプレッション不足
  | "ORGANIC_STRONG"     // オーガニック順位7位以内
  | "ORGANIC_WEAK"       // オーガニック順位21位以降
  | "LIFECYCLE_LAUNCH"   // ローンチ投資中
  | "LIFECYCLE_HARVEST"  // 回収モード
  | "NO_CHANGE"          // 変更なし
  | "BUDGET_CAP"         // 予算上限
  | "MIN_BID"            // 最低入札額制限
  | "MAX_BID";           // 最高入札額制限
```

---

## 4. ACOS計算 (ltv-calculator.ts)

### LTVモード判定

```typescript
// src/ltv/ltv-calculator.ts:33-61

/**
 * LTVモードを判定
 */
export function determineLtvMode(
  daysSinceLaunch: number | null,
  newCustomersTotal: number,
  thresholds: LtvModeThresholds = DEFAULT_LTV_MODE_THRESHOLDS
): LtvMode {
  // 発売日情報がない場合はASSUMED
  if (daysSinceLaunch === null) {
    return "ASSUMED";
  }

  // MEASURED: 120日以上 & 200人以上
  if (
    daysSinceLaunch >= thresholds.MEASURED_DAYS_MIN &&
    newCustomersTotal >= thresholds.MEASURED_NEW_CUSTOMERS_MIN
  ) {
    return "MEASURED";
  }

  // EARLY_ESTIMATE: 60日以上 & 50人以上
  if (
    daysSinceLaunch >= thresholds.EARLY_ESTIMATE_DAYS_MIN &&
    newCustomersTotal >= thresholds.EARLY_ESTIMATE_NEW_CUSTOMERS_MIN
  ) {
    return "EARLY_ESTIMATE";
  }

  // その他はASSUMED
  return "ASSUMED";
}
```

### 基礎ACOS計算

```typescript
// src/ltv/ltv-calculator.ts:100-171

/**
 * 基礎LTV ACOS目標を計算
 */
export function computeBaseLtvTargetAcos(config: ProductConfig): {
  acos: number;
  details: BaseLtvAcosDetails;
} {
  const {
    revenueModel,
    ltvMode,
    expectedRepeatOrdersAssumed,
    expectedRepeatOrdersMeasured,
    safetyFactorAssumed,
    safetyFactorMeasured,
  } = config;

  // LTV計算では marginRateNormal を使用する
  const marginRateNormal = getMarginRateNormal(config);

  // 1. 単発購入（単発購入前提商品の場合）
  if (revenueModel === "SINGLE_PURCHASE") {
    const baseAcos = marginRateNormal * ACOS_CONSTANTS.SINGLE_PURCHASE_SAFETY_FACTOR;
    const clippedAcos = clipAcos(baseAcos);

    return {
      acos: clippedAcos,
      details: {
        revenueModel,
        ltvMode: null,
        marginRate: marginRateNormal,
        expectedRepeatOrders: 1,
        safetyFactor: ACOS_CONSTANTS.SINGLE_PURCHASE_SAFETY_FACTOR,
        calculatedAcos: baseAcos,
        clipped: baseAcos !== clippedAcos,
      },
    };
  }

  // 2. LTV（リピート購入前提商品の場合）
  if (ltvMode === "MEASURED" && expectedRepeatOrdersMeasured != null) {
    const baseAcos = marginRateNormal * expectedRepeatOrdersMeasured * safetyFactorMeasured;
    const clippedAcos = clipAcos(baseAcos);

    return {
      acos: clippedAcos,
      details: {
        revenueModel,
        ltvMode,
        marginRate: marginRateNormal,
        expectedRepeatOrders: expectedRepeatOrdersMeasured,
        safetyFactor: safetyFactorMeasured,
        calculatedAcos: baseAcos,
        clipped: baseAcos !== clippedAcos,
      },
    };
  }

  // ASSUMEDまたはEARLY_ESTIMATEの場合は仮定LTV値を使用
  const baseAcos = marginRateNormal * expectedRepeatOrdersAssumed * safetyFactorAssumed;
  const clippedAcos = clipAcos(baseAcos);

  return {
    acos: clippedAcos,
    details: {
      revenueModel,
      ltvMode,
      marginRate: marginRateNormal,
      expectedRepeatOrders: expectedRepeatOrdersAssumed,
      safetyFactor: safetyFactorAssumed,
      calculatedAcos: baseAcos,
      clipped: baseAcos !== clippedAcos,
    },
  };
}
```

### 最終ACOS計算（ライフサイクル適用）

```typescript
// src/ltv/ltv-calculator.ts:192-249

/**
 * 最終ACOS目標を計算（ライフサイクル適用）
 */
export function computeFinalTargetAcos(config: ProductConfig): {
  acos: number;
  details: FinalTargetAcosDetails;
} {
  const { acos: baseLtvAcos } = computeBaseLtvTargetAcos(config);
  const { lifecycleState } = config;
  // LTV計算では marginRateNormal を使用する
  const marginRateNormal = getMarginRateNormal(config);

  let finalAcos: number;
  let multiplier: number;
  let cap: number;

  switch (lifecycleState) {
    case "HARVEST":
      // 利益回収フェーズ: 粗利率ベースで保守的に
      multiplier = ACOS_CONSTANTS.HARVEST_MARGIN_MULTIPLIER;
      cap = ACOS_CONSTANTS.HARVEST_TARGET_ACOS_CAP;
      const harvestAcos = marginRateNormal * multiplier;
      finalAcos = Math.min(harvestAcos, cap);
      break;

    case "LAUNCH_HARD":
      // 投資最大フェーズ: baseLtvAcosそのまま使用
      multiplier = 1.0;
      cap = ACOS_CONSTANTS.LAUNCH_HARD_TARGET_ACOS_CAP;
      finalAcos = Math.min(baseLtvAcos, cap);
      break;

    case "LAUNCH_SOFT":
      // やや投資フェーズ: 少し抑制
      multiplier = ACOS_CONSTANTS.LAUNCH_SOFT_LTV_MULTIPLIER;
      cap = ACOS_CONSTANTS.LAUNCH_SOFT_TARGET_ACOS_CAP;
      finalAcos = Math.min(baseLtvAcos * multiplier, cap);
      break;

    case "GROW":
    default:
      // 通常フェーズ: 標準倍率
      multiplier = ACOS_CONSTANTS.GROW_LTV_MULTIPLIER;
      cap = ACOS_CONSTANTS.GROW_TARGET_ACOS_CAP;
      finalAcos = Math.min(baseLtvAcos * multiplier, cap);
      break;
  }

  return {
    acos: finalAcos,
    details: {
      baseLtvAcos,
      lifecycleState,
      multiplier,
      cap,
      finalAcos,
    },
  };
}

/**
 * ProductConfigから目標ACOSを取得
 */
export function getTargetAcos(config: ProductConfig): number {
  return computeFinalTargetAcos(config).acos;
}
```

### ACOS定数

```typescript
const ACOS_CONSTANTS = {
  SINGLE_PURCHASE_SAFETY_FACTOR: 0.8,
  LAUNCH_HARD_TARGET_ACOS_CAP: 0.60,
  LAUNCH_SOFT_TARGET_ACOS_CAP: 0.50,
  GROW_TARGET_ACOS_CAP: 0.45,
  HARVEST_TARGET_ACOS_CAP: 0.35,
  MIN_ACOS: 0,
  MAX_ACOS: 0.9,
  HARVEST_MARGIN_MULTIPLIER: 0.8,
  LAUNCH_SOFT_LTV_MULTIPLIER: 0.9,
  GROW_LTV_MULTIPLIER: 0.8,
};
```

---

## 5. アクション決定 (bid-integration.ts)

```typescript
// src/lifecycle/bid-integration.ts:245-296

/**
 * 入札アクションを決定
 */
export function determineBidAction(
  currentAcos: number | null,
  targetAcos: number,
  clicks: number,
  investModeEnabled: boolean
): "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP" {
  // データ不足の場合
  if (currentAcos === null || clicks < 10) {
    if (investModeEnabled) {
      return "MILD_UP"; // 投資モードなら増額傾向
    }
    return "KEEP";
  }

  const acosRatio = currentAcos / targetAcos;

  // 投資モードの場合
  if (investModeEnabled) {
    if (acosRatio < 0.7) {
      return "STRONG_UP"; // ACOSが大幅に低いなら強く増額
    }
    if (acosRatio < 0.9) {
      return "MILD_UP";
    }
    if (acosRatio < 1.1) {
      return "KEEP";
    }
    if (acosRatio < 1.3) {
      return "MILD_DOWN"; // 上限超過なら軽く減額
    }
    return "STRONG_DOWN";
  }

  // 通常モード
  if (acosRatio < 0.5) {
    return "STRONG_UP";
  }
  if (acosRatio < 0.8) {
    return "MILD_UP";
  }
  if (acosRatio < 1.2) {
    return "KEEP";
  }
  if (acosRatio < 1.5) {
    return "MILD_DOWN";
  }
  if (acosRatio < 2.0) {
    return "STRONG_DOWN";
  }
  return "STOP";
}
```

### アクション決定テーブル

| モード | ACOS比率 | アクション |
|--------|---------|-----------|
| **投資モード** | < 0.7 | STRONG_UP |
| | < 0.9 | MILD_UP |
| | < 1.1 | KEEP |
| | < 1.3 | MILD_DOWN |
| | >= 1.3 | STRONG_DOWN |
| **通常モード** | < 0.5 | STRONG_UP |
| | < 0.8 | MILD_UP |
| | < 1.2 | KEEP |
| | < 1.5 | MILD_DOWN |
| | < 2.0 | STRONG_DOWN |
| | >= 2.0 | STOP |

---

## 6. 推奨入札額算出 (calculateRecommendedBid)

```typescript
// src/lifecycle/bid-integration.ts:298-333

/**
 * 推奨入札額を算出
 */
export function calculateRecommendedBid(
  currentBid: number,
  action: "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP",
  config: LifecycleGlobalConfig = DEFAULT_LIFECYCLE_GLOBAL_CONFIG
): {
  recommendedBid: number;
  changeRate: number;
} {
  const actionRates: Record<string, number> = {
    STRONG_UP: 0.30,     // +30%
    MILD_UP: 0.15,       // +15%
    KEEP: 0,             // 0%
    MILD_DOWN: -0.15,    // -15%
    STRONG_DOWN: -0.30,  // -30%
    STOP: -0.80,         // -80%
  };

  let changeRate = actionRates[action] || 0;

  // 制限を適用
  changeRate = Math.max(changeRate, config.max_bid_decrease_rate);  // -80%
  changeRate = Math.min(changeRate, config.max_bid_increase_rate);  // +150%

  const recommendedBid = Math.max(
    currentBid * (1 + changeRate),
    config.min_bid  // 最低入札額
  );

  return {
    recommendedBid: Math.round(recommendedBid),
    changeRate,
  };
}
```

### 変更率一覧

| アクション | 変更率 |
|-----------|--------|
| STRONG_UP | +30% |
| MILD_UP | +15% |
| KEEP | 0% |
| MILD_DOWN | -15% |
| STRONG_DOWN | -30% |
| STOP | -80% |

### デフォルト設定

```typescript
export const DEFAULT_LIFECYCLE_GLOBAL_CONFIG: LifecycleGlobalConfig = {
  default_acos_target: 0.20,
  min_bid: 2,
  max_bid_increase_rate: 1.5,   // +150%
  max_bid_decrease_rate: -0.8,  // -80%

  lifecycle_enabled: true,

  stage_acos_multipliers: {
    LAUNCH_HARD: 2.5,
    LAUNCH_SOFT: 1.8,
    GROW: 1.2,
    HARVEST: 0.7,
  },

  role_acos_multipliers: {
    brand: 0.8,
    core: 1.3,
    support: 1.0,
    longtail_experiment: 0.9,
    other: 0.7,
  },

  invest_mode: {
    max_loss_per_keyword_daily: 5000,
    max_total_loss_daily: 50000,
  },
};
```

---

## 7. ネガティブキーワード候補計算 (negative-keyword-calculator.ts)

> **SHADOWモード専用**: 自動でのネガティブ登録は行いません

### メイン関数

```typescript
// src/negative-keywords/negative-keyword-calculator.ts

/**
 * ネガティブキーワード候補を計算
 *
 * 統計的に安全な方法（ルールオブスリー）でネガティブキーワード候補をサジェスト
 */
export async function computeNegativeKeywordCandidates(
  asin: string,
  productConfig: ProductConfig,
  negativeConfig: NegativeSuggestConfig = DEFAULT_NEGATIVE_SUGGEST_CONFIG,
  mode: ExecutionMode = "SHADOW",
  options: {
    projectId?: string;
    dataset?: string;
    executionId?: string;
  } = {}
): Promise<NegativeKeywordCandidatesResult> {
  // ライフサイクル除外チェック
  if (isExcludedLifecycleState(productConfig.lifecycleState)) {
    return { asin, mode, candidates: [], ... };
  }

  // 1. ASIN全体のベースラインCVRを計算
  const { cvr: baselineAsinCvr30d, totalClicks, totalConversions } =
    await fetchBaselineAsinCvr(projectId, dataset, asin, minimumBaselineCvr);

  // 2. ルールオブスリーによる必要クリック数
  const requiredClicks = calculateRequiredClicks(
    baselineAsinCvr30d,
    negativeConfig.riskTolerance
  );

  // 3. データ取得
  const [searchTermStats, clusterStatsMap, avgAsinCpc] = await Promise.all([
    fetchSearchTermStats(projectId, dataset, asin),
    fetchClusterStats(projectId, dataset, asin),
    fetchAverageAsinCpc(projectId, dataset, asin),
  ]);

  // 4. 候補クラスタの特定
  const candidateClusterIds = new Set<string>();
  for (const [clusterId, clusterStats] of clusterStatsMap) {
    if (
      clusterStats.cluster_conversions_30d === 0 &&
      clusterStats.cluster_clicks_30d >= negativeConfig.minClusterClicks &&
      clusterStats.cluster_clicks_30d >= requiredClicks
    ) {
      candidateClusterIds.add(clusterId);
    }
  }

  // 5. キーワード単位の候補生成
  const candidates: NegativeKeywordCandidate[] = [];
  for (const stats of searchTermStats) {
    // 候補クラスタに属するレコードのみ対象
    if (stats.intent_cluster_id && !candidateClusterIds.has(stats.intent_cluster_id)) {
      continue;
    }
    // CVR=0 でない場合はスキップ
    if (stats.conversions_30d > 0) continue;

    // role判定、閾値チェック、reasonCodes決定
    const role = determineQueryRole(stats.query, productConfig);
    const minClicksByRole = getMinClicksByRole(role, requiredClicks, negativeConfig);
    if (stats.clicks_30d < minClicksByRole) continue;

    const reasonCodes = determineReasonCodes(stats, clusterStats, avgAsinCpc, negativeConfig);
    if (reasonCodes.length === 0) continue;

    candidates.push({ ... });
  }

  // 6. SHADOWモードのみBigQueryに保存
  if (mode === "SHADOW" && candidates.length > 0) {
    await saveNegativeKeywordSuggestions(...);
  }

  return { asin, mode, candidates, baselineAsinCvr30d, requiredClicks, ... };
}
```

### ルールオブスリー計算

```typescript
/**
 * ルールオブスリーによる必要クリック数を計算
 *
 * CVR=0 のとき、95%信頼上限のCVRは 3/N と近似できる
 */
function calculateRequiredClicks(
  baselineCvr: number,
  riskTolerance: number
): number {
  if (baselineCvr <= 0 || riskTolerance <= 0) {
    return 100; // フォールバック値
  }
  return Math.ceil(3 / (baselineCvr * riskTolerance));
}

// 例: baselineCvr=2%, riskTolerance=0.5
// → requiredClicks = ceil(3 / (0.02 × 0.5)) = 300クリック
```

### role判定

```typescript
/**
 * クエリの役割を判定
 */
function determineQueryRole(
  query: string,
  productConfig: ProductConfig
): QueryRole {
  const lowerQuery = query.toLowerCase();

  if (productConfig.brandType === "BRAND") {
    if (lowerQuery.includes(productConfig.asin.toLowerCase())) {
      return "BRAND_OWN";
    }
  }

  if (productConfig.brandType === "CONQUEST") {
    return "BRAND_CONQUEST";
  }

  return "GENERIC";
}
```

### role別最小クリック数

```typescript
/**
 * role別の最小クリック数を取得
 */
function getMinClicksByRole(
  role: QueryRole,
  requiredClicks: number,
  config: NegativeSuggestConfig
): number {
  let roleMinClicks: number;

  switch (role) {
    case "BRAND_OWN":
      roleMinClicks = config.minClicksBrandOwn;      // デフォルト: 50
      break;
    case "BRAND_CONQUEST":
      roleMinClicks = config.minClicksBrandConquest; // デフォルト: 40
      break;
    case "GENERIC":
    default:
      roleMinClicks = config.minClicksGeneric;       // デフォルト: 30
      break;
  }

  // ルールオブスリーによる必要クリック数との大きい方を採用
  return Math.max(requiredClicks, roleMinClicks);
}
```

### reasonCodes判定

```typescript
/**
 * 理由コードを決定
 */
function determineReasonCodes(
  stats: SearchTermStats30dRow,
  clusterStats: IntentClusterStats30dRow | undefined,
  avgAsinCpc: number,
  config: NegativeSuggestConfig
): NegativeReasonCode[] {
  const reasons: NegativeReasonCode[] = [];

  // NG_NO_CONVERSION: CVR=0 かつクリック数しきい値超え
  if (stats.conversions_30d === 0 && stats.clicks_30d > 0) {
    reasons.push("NG_NO_CONVERSION");
  }

  // NG_WASTED_SPEND: CPCが全体より高く、コストがかさみ過ぎ
  if (
    stats.cpc_30d &&
    avgAsinCpc > 0 &&
    stats.cpc_30d > avgAsinCpc * config.cpcRatioThreshold &&
    stats.cost_30d >= config.minWastedCost
  ) {
    reasons.push("NG_WASTED_SPEND");
  }

  // NG_CLUSTER_NO_CONVERSION: クラスタ単位でCVR=0
  if (
    clusterStats &&
    clusterStats.cluster_conversions_30d === 0 &&
    clusterStats.cluster_clicks_30d > 0
  ) {
    reasons.push("NG_CLUSTER_NO_CONVERSION");
  }

  // NG_INTENT_MISMATCH: クラスタ未分類（検索意図不明）
  if (!stats.intent_cluster_id) {
    reasons.push("NG_INTENT_MISMATCH");
  }

  return reasons;
}
```

### NegativeReasonCode 一覧

```typescript
type NegativeReasonCode =
  | "NG_NO_CONVERSION"           // CVR=0 かつクリック数しきい値超え
  | "NG_WASTED_SPEND"            // CPC高く、コストかさみ過ぎ
  | "NG_CLUSTER_NO_CONVERSION"   // クラスタ単位でCVR=0
  | "NG_INTENT_MISMATCH";        // 検索意図不一致
```

### ネガティブキーワード候補のステータス管理

候補は承認フローを経て適用されます。

#### ステータス型定義

```typescript
type NegativeSuggestionStatus =
  | "PENDING"    // 未処理（レビュー待ち）
  | "APPROVED"   // 承認済（適用待ち）
  | "REJECTED"   // 却下
  | "APPLIED";   // Amazon Ads API に適用済
```

#### ステータス遷移

```
PENDING → APPROVED → APPLIED
    ↓
REJECTED
```

#### NegativeKeywordSuggestionRow（BigQueryテーブル行）

```typescript
interface NegativeKeywordSuggestionRow {
  // ... 基本フィールド ...

  // 承認フロー情報
  status: string;              // "PENDING", "APPROVED", "REJECTED", "APPLIED"
  approved_at: string | null;  // 承認日時
  approved_by: string | null;  // 承認者
  rejected_at: string | null;  // 却下日時
  rejected_by: string | null;  // 却下者
  rejection_reason: string | null; // 却下理由

  // 適用状態
  is_applied: boolean;
  applied_at: string | null;
  apply_error: string | null;
}
```

#### 管理用 API エンドポイント

```typescript
// 候補一覧取得
// GET /admin/negative-suggestions?status=PENDING&asin=B0XXX&limit=100
router.get("/", async (req, res) => { ... });

// ステータス別サマリー
// GET /admin/negative-suggestions/summary
router.get("/summary", async (req, res) => { ... });

// 一括承認
// POST /admin/negative-suggestions/approve
// Body: { suggestionIds: ["uuid1", "uuid2"], approvedBy: "user@example.com" }
router.post("/approve", async (req, res) => { ... });

// 一括却下
// POST /admin/negative-suggestions/reject
// Body: { suggestionIds: ["uuid1"], rejectedBy: "user", reason: "Not relevant" }
router.post("/reject", async (req, res) => { ... });

// 候補詳細
// GET /admin/negative-suggestions/:suggestionId
router.get("/:suggestionId", async (req, res) => { ... });
```

#### 使用例

```typescript
// 1. PENDING 候補の一覧を取得
const pendingResponse = await fetch(
  "/admin/negative-suggestions?status=PENDING",
  { headers: { "X-API-Key": apiKey } }
);
const { data: { suggestions } } = await pendingResponse.json();

// 2. レビュー後、承認する
const approveResponse = await fetch(
  "/admin/negative-suggestions/approve",
  {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      suggestionIds: ["uuid-1", "uuid-2"],
      approvedBy: "reviewer@example.com",
    }),
  }
);

// 3. 不要な候補を却下
const rejectResponse = await fetch(
  "/admin/negative-suggestions/reject",
  {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      suggestionIds: ["uuid-3"],
      rejectedBy: "reviewer@example.com",
      reason: "商品と関連性がある可能性",
    }),
  }
);
```

### ネガティブキーワードエンジンのフェーズ構成

ネガティブキーワード機能は段階的に展開されます。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  フェーズ 1: SHADOW サジェスト（現在）                                       │
│                                                                             │
│  ・統計的に安全な方法（ルールオブスリー）でネガティブ候補を検出              │
│  ・BigQuery の negative_keyword_suggestions テーブルに候補を保存            │
│  ・Amazon Ads API への自動登録は行わない（SHADOW モード専用）               │
│  ・候補の確認は BigQuery で直接クエリ                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  フェーズ 2: PENDING/APPROVED/REJECTED 承認フロー（現在）                   │
│                                                                             │
│  ・候補にステータス列を追加（PENDING → APPROVED/REJECTED）                  │
│  ・管理用 REST API でレビュー・承認・却下操作                               │
│    - GET  /admin/negative-suggestions                                       │
│    - GET  /admin/negative-suggestions/summary                               │
│    - POST /admin/negative-suggestions/approve                               │
│    - POST /admin/negative-suggestions/reject                                │
│  ・人間によるレビューを必須とし、誤除外を防止                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  フェーズ 3: APPLY モード（将来実装予定）                                   │
│                                                                             │
│  ・環境変数 NEGATIVE_APPLY_ENABLED=true で有効化                            │
│  ・APPROVED 状態の候補を Amazon Ads API に自動適用                          │
│  ・POST /admin/negative-suggestions/apply-queued エンドポイントで実行       │
│  ・適用後、ステータスを APPLIED に更新                                      │
│  ・Slack 通知で適用結果をレポート                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### フェーズ別の環境変数設定

| フェーズ | BID_ENGINE_EXECUTION_MODE | NEGATIVE_APPLY_ENABLED | 動作 |
|---------|---------------------------|------------------------|------|
| 1 | SHADOW | - | 候補を BigQuery に保存のみ |
| 2 | SHADOW | false（デフォルト） | 承認フローで人間がレビュー、API 適用なし |
| 3 | SHADOW | true | APPROVED 候補を Amazon Ads API に適用 |

#### 現在のステータス

- **フェーズ 1**: ✅ 完了
- **フェーズ 2**: ✅ 完了（承認 API 実装済み）
- **フェーズ 3**: 🚧 プレースホルダー実装済み（`apply-queued` エンドポイント）

#### 今後の拡張（将来実装）

- **APPROVED → APPLIED**: 承認済みの候補を Amazon Ads API に自動適用
- **Slack/Email通知**: 新規候補が生成された際の通知
- **バッチ適用ジョブ**: APPROVED 候補を定期的に一括適用

### NegativeSuggestConfig

```typescript
interface NegativeSuggestConfig {
  minClicksGeneric: number;        // GENERIC最小クリック数（デフォルト: 30）
  minClicksBrandOwn: number;       // BRAND_OWN最小クリック数（デフォルト: 50）
  minClicksBrandConquest: number;  // BRAND_CONQUEST最小クリック数（デフォルト: 40）
  minClusterClicks: number;        // クラスタ最小クリック数（デフォルト: 50）
  riskTolerance: number;           // リスク許容度 0-1（デフォルト: 0.5）
  minWastedCost?: number;          // 最小コスト閾値（デフォルト: 1000）
  cpcRatioThreshold?: number;      // CPC比率閾値（デフォルト: 1.5）
  minimumBaselineCvr?: number;     // 最小ベースラインCVR（デフォルト: 0.01）
}

const DEFAULT_NEGATIVE_SUGGEST_CONFIG: NegativeSuggestConfig = {
  minClicksGeneric: 30,
  minClicksBrandOwn: 50,
  minClicksBrandConquest: 40,
  minClusterClicks: 50,
  riskTolerance: 0.5,
  minWastedCost: 1000,
  cpcRatioThreshold: 1.5,
  minimumBaselineCvr: 0.01,
};
```

### 除外されるライフサイクルステート

```typescript
const EXCLUDED_LIFECYCLE_STATES = [
  "LAUNCH_HARD",  // データ不足、投資優先
  "LAUNCH_SOFT",  // データ収集中
] as const;

function isExcludedLifecycleState(state: string | null | undefined): boolean {
  if (!state) return false;
  return EXCLUDED_LIFECYCLE_STATES.includes(state as any);
}
```

### 使用例

```typescript
import {
  computeNegativeKeywordCandidates,
  DEFAULT_NEGATIVE_SUGGEST_CONFIG,
} from "./negative-keywords";

const result = await computeNegativeKeywordCandidates(
  "B0XXXXXXXXX",
  productConfig,
  {
    ...DEFAULT_NEGATIVE_SUGGEST_CONFIG,
    riskTolerance: 0.6,  // やや積極的に判定
  },
  "SHADOW"
);

for (const candidate of result.candidates) {
  console.log(`Query: ${candidate.query}`);
  console.log(`  Clicks: ${candidate.clicks30d}`);
  console.log(`  Cost: ¥${candidate.cost30d}`);
  console.log(`  Reasons: ${candidate.reasonCodes.join(", ")}`);
}
```

---

## 7.1. 検索意図クラスターベース判定（v2）

v2では、ASIN×検索意図クラスター単位でのSTOP/NEG判定を実装しています。

### クエリ正規化 (normalizer.ts)

```typescript
// src/negative-keywords/query-cluster/normalizer.ts

/**
 * 検索クエリを正規化してcanonicalQueryを生成
 *
 * 正規化ルール:
 * 1. 全角英数字 → 半角英数字
 * 2. 半角カタカナ → 全角カタカナ
 * 3. ひらがな → カタカナ
 * 4. 大文字 → 小文字
 * 5. 連続空白 → 単一空白
 * 6. 長音符統一
 */
export function normalizeQuery(
  query: string,
  config: QueryNormalizerConfig = DEFAULT_NORMALIZER_CONFIG
): string;

// 例
toCanonicalQuery("きっず　ＡＢＣシャンプー")
// => "キッズ abcシャンプー"
```

### 検索意図タグ検出 (intent-tagger.ts)

```typescript
// src/negative-keywords/query-cluster/intent-tagger.ts

type QueryIntentTag =
  | "child"    // 子供向け
  | "adult"    // 大人向け
  | "concern"  // 悩み系
  | "info"     // 情報探索
  | "generic"; // 汎用

/**
 * 検索クエリから検索意図タグを推定
 * 優先順位: child > adult > concern > info > generic
 */
export function detectQueryIntentTag(query: string): QueryIntentTag;

/**
 * クラスターIDを生成
 * 形式: `${canonicalQuery}::${queryIntentTag}`
 */
export function generateQueryClusterId(query: string): string;

// 例
generateQueryClusterId("キッズ シャンプー")
// => "キッズ シャンプー::child"
```

### クラスター判定 (cluster-judgment.ts)

```typescript
// src/negative-keywords/query-cluster/cluster-judgment.ts

type ClusterJudgmentPhase =
  | "LEARNING"          // クリック < 20: STOP/NEG禁止
  | "LIMITED_ACTION"    // 20 <= クリック < 60: DOWN系のみ許可
  | "STOP_CANDIDATE";   // クリック >= 60: STOP/NEG可能

/**
 * ルールオブスリーによる必要クリック数計算
 *
 * @param baselineCvr - ASINベースラインCVR
 * @param riskTolerance - リスク許容度（0-1）
 * @param minimumCvr - 最小CVR（下限）
 * @returns 必要クリック数
 */
export function calculateRequiredClicksByRuleOfThree(
  baselineCvr: number,
  riskTolerance: number = 0.5,
  minimumCvr: number = 0.01
): number;

// 例: CVR 5%, riskTolerance 0.5 → 60クリック必要

/**
 * クラスター判定を実行
 */
export function judgeCluster(
  clusterMetrics: QueryClusterMetrics,
  baselineCvr: number,
  config: ClusterBasedNegativeConfig
): ClusterJudgmentResult;
```

### ハイブリッド判定 (hybrid-judgment.ts)

```typescript
// src/negative-keywords/query-cluster/hybrid-judgment.ts

/**
 * 重要キーワードチェック
 *
 * 重要キーワードの定義:
 * 1. 広告費上位N件
 * 2. 手動ホワイトリスト（ASIN別）
 * 3. グローバルホワイトリスト
 */
export function checkImportantKeyword(
  query: string,
  asin: string,
  config: ImportantKeywordConfig,
  spendRanking?: Map<string, number>,
  querySpend?: number
): ImportantKeywordCheckResult;

/**
 * ハイブリッド判定を実行
 *
 * 重要キーワードは緩和方向のみオーバーライド可能
 * - クラスター: STOP候補 → 単一: 非候補 = 緩和適用
 * - クラスター: 非候補 → 単一: STOP候補 = 厳格化禁止
 */
export function executeHybridJudgment(
  query: string,
  asin: string,
  clusterJudgment: ClusterJudgmentResult,
  importantKeywordCheck: ImportantKeywordCheckResult,
  singleKeywordStats?: { clicks, conversions, cost, revenue },
  baselineCvr?: number,
  config?: ClusterBasedNegativeConfig
): HybridJudgmentResult;
```

### ClusterJudgmentReasonCode 一覧

```typescript
type ClusterJudgmentReasonCode =
  | "CLUSTER_LEARNING"              // 学習中（クリック不足）
  | "CLUSTER_LIMITED_ACTION"        // 限定アクション（中間フェーズ）
  | "CLUSTER_NO_CONVERSION"         // CVR=0
  | "CLUSTER_LOW_CVR"               // CVR低い
  | "CLUSTER_HIGH_ACOS"             // ACOS高い
  | "CLUSTER_OK"                    // 問題なし
  | "CLUSTER_LONG_TAIL_REVIEW";     // ロングテール（レビュー推奨）
```

### デフォルト設定

```typescript
const DEFAULT_CLUSTER_PHASE_THRESHOLDS = {
  clusterClicksMinLearning: 20,      // 学習フェーズ閾値
  clusterClicksMinStopCandidate: 60, // STOP候補フェーズ閾値
};

const DEFAULT_IMPORTANT_KEYWORD_CONFIG = {
  autoDetectEnabled: true,
  autoDetectTopN: 20,           // 広告費上位20件
  autoDetectMinSpend: 5000,     // 最小5,000円
  manualWhitelist: new Map(),   // ASIN別ホワイトリスト
  globalWhitelist: new Set(),   // グローバルホワイトリスト
};

const DEFAULT_LONG_TAIL_THRESHOLDS = {
  maxImpressions: 200,  // インプレッション上限
  maxClicks: 5,         // クリック上限
};
```

### 使用例

```typescript
import {
  toCanonicalQuery,
  generateQueryClusterId,
  detectQueryIntentTag,
  judgeCluster,
  executeHybridJudgment,
  aggregateClusterMetrics,
  checkImportantKeyword,
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG,
} from "../src/negative-keywords";

// 1. クエリ正規化とクラスターID生成
const clusterId = generateQueryClusterId("きっず しゃんぷー");
// => "キッズ シャンプー::child"

// 2. クラスターメトリクス集約
const clusterMetrics = aggregateClusterMetrics(
  "B0XXXXXXXXX",
  clusterId,
  "キッズ シャンプー",
  "child",
  searchTermStats,
  30
);

// 3. クラスター判定
const clusterResult = judgeCluster(
  clusterMetrics,
  0.05, // baselineCvr 5%
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG
);

// 4. 重要キーワードチェック
const importantCheck = checkImportantKeyword(
  "キッズ シャンプー",
  "B0XXXXXXXXX",
  DEFAULT_CLUSTER_BASED_NEGATIVE_CONFIG.importantKeywordConfig,
  spendRanking,
  5000
);

// 5. ハイブリッド判定
const hybridResult = executeHybridJudgment(
  "キッズ シャンプー",
  "B0XXXXXXXXX",
  clusterResult,
  importantCheck,
  singleKeywordStats,
  0.05
);

console.log(`Final STOP candidate: ${hybridResult.finalIsStopCandidate}`);
console.log(`Override applied: ${hybridResult.overrideApplied}`);
console.log(`Reason: ${hybridResult.finalReasonDetail}`);
```

---

## 8. 自動ガードレール (auto-guardrails.ts)

### 概要

履歴データから ASIN × lifecycle_state 別に min_bid / max_bid を自動計算する機能です。
`use_auto_min_max` フラグで有効化すると、デフォルトのガードレール代わりに自動計算値を使用します。

### メイン関数

```typescript
// src/guardrails/auto-guardrails.ts

/**
 * 全商品の自動ガードレールを再計算
 */
export async function recomputeGuardrailsForAllProducts(
  options: RecomputeGuardrailsOptions
): Promise<RecomputeGuardrailsResult> {
  const config = options.config ?? DEFAULT_AUTO_GUARDRAILS_CONFIG;
  const allLifecycleStates: LifecycleState[] = [
    "LAUNCH_HARD", "LAUNCH_SOFT", "GROW", "HARVEST"
  ];

  // 1. 商品設定を取得
  const productConfigs = await loadAllProductConfigs(options, true);

  // 2. 入札バケットデータを取得
  const bucketMap = await fetchBidBuckets(options, asins);

  // 3. 各 ASIN × lifecycle_state について計算
  for (const [asin, productConfig] of productConfigs) {
    for (const lifecycleState of allLifecycleStates) {
      const buckets = bucketMap.get(`${asin}|${lifecycleState}`) ?? [];

      const guardrailResult = computeGuardrailsForAsinLifecycle(
        asin,
        lifecycleState,
        buckets,
        productConfig,
        config
      );

      results.push(guardrailResult);
    }
  }

  // 4. 結果を保存
  if (!options.dryRun) {
    await saveGuardrailsToTable(options, results);
  }

  return { totalProcessed, historicalCount, theoreticalCount, fallbackCount, results, errors };
}
```

### 有望バケット判定（Rule of Three）

```typescript
/**
 * バケットが有望かどうかを判定
 *
 * Rule of Three 条件:
 * 1. clicks >= min_clicks_threshold (80)
 * 2. acos <= target_acos * margin_acos (1.2)
 * 3. cvr >= baseline_cvr * min_cvr_ratio (0.5)
 */
function isPromisingBucket(
  bucket: BidBucketRow,
  targetAcos: number,
  config: AutoGuardrailsConfig
): boolean {
  // 条件1: 最小クリック数
  if (bucket.clicks_30d < config.min_clicks_threshold) {
    return false;
  }

  // 条件2: ACOS条件
  if (bucket.acos_30d === null || bucket.acos_30d > targetAcos * config.margin_acos) {
    return false;
  }

  // 条件3: CVR条件
  if (bucket.cvr_30d === null || bucket.cvr_30d < config.baseline_cvr_estimate * config.min_cvr_ratio) {
    return false;
  }

  return true;
}
```

### ガードレール計算

```typescript
/**
 * 単一 ASIN × lifecycle_state のガードレールを計算
 */
function computeGuardrailsForAsinLifecycle(
  asin: string,
  lifecycleState: LifecycleState,
  buckets: BidBucketRow[],
  productConfig: ProductConfig,
  config: AutoGuardrailsConfig
): AutoGuardrailsResult {
  const targetAcos = getTargetAcos(productConfig);

  // 有望バケットをフィルタリング
  const promisingBuckets = filterPromisingBuckets(buckets, targetAcos, config);

  // Rule 1: 有望バケットが存在する場合 → HISTORICAL
  if (promisingBuckets.length > 0) {
    const sortedBuckets = [...promisingBuckets].sort((a, b) => a.avg_bid_30d - b.avg_bid_30d);
    const minBucket = sortedBuckets[0];
    const maxBucket = sortedBuckets[sortedBuckets.length - 1];

    const minBeta = config.min_beta[lifecycleState];
    const maxAlpha = config.max_alpha[lifecycleState];

    return {
      asin,
      lifecycle_state: lifecycleState,
      min_bid_auto: Math.round(minBucket.avg_bid_30d * minBeta),
      max_bid_auto: Math.round(maxBucket.avg_bid_30d * maxAlpha),
      data_source: "HISTORICAL",
      clicks_used: promisingBuckets.reduce((sum, b) => sum + b.clicks_30d, 0),
    };
  }

  // Rule 2: 有望バケットがないが、cpc_break_even を計算できる場合 → THEORETICAL
  if (productConfig.marginRate > 0) {
    const cpcBreakEven = estimatedPrice * targetAcos * config.baseline_cvr_estimate;
    const minBeta = config.min_beta[lifecycleState];
    const maxAlpha = config.max_alpha[lifecycleState];

    return {
      asin,
      lifecycle_state: lifecycleState,
      min_bid_auto: Math.round(cpcBreakEven * minBeta),
      max_bid_auto: Math.round(cpcBreakEven * maxAlpha),
      data_source: "THEORETICAL",
      clicks_used: 0,
    };
  }

  // Rule 3: 完全なフォールバック
  return {
    asin,
    lifecycle_state: lifecycleState,
    min_bid_auto: config.fallback_min_bid,
    max_bid_auto: config.fallback_max_bid,
    data_source: "FALLBACK",
    clicks_used: 0,
  };
}
```

### ガードレール適用

```typescript
/**
 * ガードレールを適用して入札額をクリップ
 *
 * 動作モード (guardrailsMode):
 * - OFF: 計算をスキップし、recommendedBid をそのまま返す
 * - SHADOW: 計算するがログのみ（guardrailsApplied = false）
 * - ENFORCE: 計算結果を実際に適用（guardrailsApplied = wasClipped）
 *
 * 適用順序:
 * 1. max_up_ratio / max_down_ratio による変動率制限
 * 2. min_bid / max_bid による絶対値制限
 */
export function applyGuardrails(input: ApplyGuardrailsInput): ApplyGuardrailsResult {
  const {
    recommendedBid,
    currentBid,
    useAutoMinMax,
    autoGuardrails,
    defaultGuardrails,
    guardrailsMode = "SHADOW",  // デフォルトは SHADOW（安全設計）
  } = input;

  // OFF モードの場合は計算をスキップ
  if (guardrailsMode === "OFF") {
    return {
      clippedBid: Math.round(recommendedBid),
      wasClipped: false,
      clipReason: null,
      effectiveMinBid: defaultGuardrails.min_bid,
      effectiveMaxBid: defaultGuardrails.max_bid,
      autoDataSource: null,
      guardrailsMode,
      guardrailsApplied: false,
    };
  }

  let clippedBid = recommendedBid;
  let wasClipped = false;
  let clipReason: string | null = null;

  // 1. 変動率制限を適用
  const maxUpBid = currentBid * defaultGuardrails.max_up_ratio;
  const minDownBid = currentBid * defaultGuardrails.max_down_ratio;

  if (clippedBid > maxUpBid) {
    clippedBid = maxUpBid;
    wasClipped = true;
    clipReason = `max_up_ratio (${defaultGuardrails.max_up_ratio})`;
  } else if (clippedBid < minDownBid) {
    clippedBid = minDownBid;
    wasClipped = true;
    clipReason = `max_down_ratio (${defaultGuardrails.max_down_ratio})`;
  }

  // 2. min_bid / max_bid 制限を適用
  let effectiveMinBid: number;
  let effectiveMaxBid: number;
  let autoDataSource = null;

  if (useAutoMinMax && autoGuardrails) {
    // 自動ガードレールを使用
    effectiveMinBid = autoGuardrails.min_bid_auto;
    effectiveMaxBid = autoGuardrails.max_bid_auto;
    autoDataSource = autoGuardrails.data_source;
  } else {
    // デフォルトガードレールを使用
    effectiveMinBid = defaultGuardrails.min_bid;
    effectiveMaxBid = defaultGuardrails.max_bid;
  }

  if (clippedBid < effectiveMinBid) {
    clippedBid = effectiveMinBid;
    wasClipped = true;
    clipReason = `min_bid (${effectiveMinBid}${autoDataSource ? ` [${autoDataSource}]` : ""})`;
  } else if (clippedBid > effectiveMaxBid) {
    clippedBid = effectiveMaxBid;
    wasClipped = true;
    clipReason = `max_bid (${effectiveMaxBid}${autoDataSource ? ` [${autoDataSource}]` : ""})`;
  }

  // ENFORCE モードの場合のみ guardrailsApplied = true
  const guardrailsApplied = guardrailsMode === "ENFORCE" && wasClipped;

  return {
    clippedBid: Math.round(clippedBid),
    wasClipped,
    clipReason,
    effectiveMinBid,
    effectiveMaxBid,
    autoDataSource,
    guardrailsMode,
    guardrailsApplied,
  };
}
```

### GuardrailsMode と newBid の関係

| モード | newBid の値 | ログ記録 | API送信値 |
|--------|-------------|----------|-----------|
| OFF | rawBid | guardrailsApplied=false | rawBid |
| SHADOW | rawBid | wasClipped, clipReason 等を記録 | rawBid |
| ENFORCE | guardedBid（クリップ後） | guardrailsApplied=true | guardedBid |

**環境変数**: `GUARDRAILS_MODE` で制御（デフォルト: SHADOW）

### AutoGuardrailsConfig

```typescript
interface AutoGuardrailsConfig {
  min_clicks_threshold: number;      // 最小クリック数（80）
  margin_acos: number;               // ACOS許容マージン（1.2）
  min_cvr_ratio: number;             // CVR最小比率（0.5）
  baseline_cvr_estimate: number;     // ベースラインCVR（0.03）
  min_beta: Record<LifecycleState, number>;   // min_bid係数
  max_alpha: Record<LifecycleState, number>;  // max_bid係数
  fallback_min_bid: number;          // フォールバックmin（10）
  fallback_max_bid: number;          // フォールバックmax（200）
}

const DEFAULT_AUTO_GUARDRAILS_CONFIG: AutoGuardrailsConfig = {
  min_clicks_threshold: 80,
  margin_acos: 1.2,
  min_cvr_ratio: 0.5,
  baseline_cvr_estimate: 0.03,
  min_beta: {
    LAUNCH_HARD: 0.7,
    LAUNCH_SOFT: 0.75,
    GROW: 0.8,
    HARVEST: 0.85,
  },
  max_alpha: {
    LAUNCH_HARD: 1.5,
    LAUNCH_SOFT: 1.4,
    GROW: 1.3,
    HARVEST: 1.2,
  },
  fallback_min_bid: 10,
  fallback_max_bid: 200,
};
```

### GuardrailsPerLifecycle

```typescript
interface GuardrailsPerLifecycle {
  min_bid: number;            // 最低入札額（円）
  max_bid: number;            // 最高入札額（円）
  max_up_ratio: number;       // 最大上昇比率（例: 1.2 = +20%まで）
  max_down_ratio: number;     // 最大下降比率（例: 0.7 = -30%まで）
  use_auto_min_max: boolean;  // 自動計算されたmin/maxを使用するか
}

const DEFAULT_GUARDRAILS_PER_LIFECYCLE: Record<LifecycleState, GuardrailsPerLifecycle> = {
  LAUNCH_HARD: {
    min_bid: 10,
    max_bid: 500,
    max_up_ratio: 1.3,
    max_down_ratio: 0.6,
    use_auto_min_max: false,
  },
  LAUNCH_SOFT: {
    min_bid: 10,
    max_bid: 400,
    max_up_ratio: 1.25,
    max_down_ratio: 0.65,
    use_auto_min_max: false,
  },
  GROW: {
    min_bid: 10,
    max_bid: 300,
    max_up_ratio: 1.2,
    max_down_ratio: 0.7,
    use_auto_min_max: false,
  },
  HARVEST: {
    min_bid: 10,
    max_bid: 200,
    max_up_ratio: 1.15,
    max_down_ratio: 0.75,
    use_auto_min_max: false,
  },
};
```

### データソースの意味

| データソース | 説明 | 信頼性 |
|-------------|------|--------|
| HISTORICAL | 有望バケットから計算（実績ベース） | 高 |
| THEORETICAL | cpc_break_even から理論値で計算 | 中 |
| FALLBACK | 固定のフォールバック値 | 低 |

### 使用例

```typescript
import {
  recomputeGuardrailsForAllProducts,
  loadAutoGuardrails,
  applyGuardrails,
  DEFAULT_GUARDRAILS_PER_LIFECYCLE,
} from "./guardrails";

// 1. 全商品の自動ガードレールを再計算
const result = await recomputeGuardrailsForAllProducts({
  projectId: "your-project",
  dataset: "amazon_bid_engine",
});

// 2. 自動ガードレールを取得
const autoGuardrails = await loadAutoGuardrails(
  { projectId: "your-project", dataset: "amazon_bid_engine" },
  "B0XXXXXXXXX",
  "GROW"
);

// 3. ガードレールを適用
const clipped = applyGuardrails({
  recommendedBid: 150,
  currentBid: 100,
  asin: "B0XXXXXXXXX",
  lifecycleState: "GROW",
  useAutoMinMax: true,
  autoGuardrails,
  defaultGuardrails: DEFAULT_GUARDRAILS_PER_LIFECYCLE.GROW,
});

console.log(`クリップ後: ${clipped.clippedBid}円`);
if (clipped.wasClipped) {
  console.log(`理由: ${clipped.clipReason}`);
}
```

### ログ専用モード

現在のフェーズでは、ガードレールは**ログ専用モード**で動作します。

```
calculateRecommendedBid()
        ↓
   recommendedBid（= rawNewBid = newBid）
        ↓
   applyGuardrails() 呼び出し
        ↓
   guardedNewBid / wasGuardClamped 等を BigQuery に記録
        ↓
   Amazon Ads API には newBid (= rawNewBid) を送信
```

- **API送信**: `newBid` = `rawNewBid` = `calculateRecommendedBid()` の結果（ガードレール適用前）
- **ログ記録**: `guardedNewBid`, `wasGuardClamped`, `guardClampReason` 等を BigQuery に保存

#### BidRecommendation のログフィールド

```typescript
// ガードレール情報（ログ用）
rawNewBid: number;           // 入札ロジックが計算した生の推奨値
guardedNewBid: number;       // ガードレール適用後の値（ログ用）
wasGuardClamped: boolean;    // ガードでクリップされたか
guardClampReason: string | null;
guardrailsMinBid: number | null;
guardrailsMaxBid: number | null;
guardrailsAutoDataSource: "HISTORICAL" | "THEORETICAL" | "FALLBACK" | null;
```

#### BigQuery ログカラム

| カラム名 | 説明 |
|----------|------|
| `raw_new_bid` | 入札ロジックが計算した生の推奨値 |
| `guarded_new_bid` | ガードレール適用後の値 |
| `was_guard_clamped` | クリップされたか |
| `guard_clamp_reason` | クランプ理由 |
| `guardrails_min_bid` | ガードレールの min_bid |
| `guardrails_max_bid` | ガードレールの max_bid |
| `guardrails_auto_data_source` | データソース |

---

## 9. 在庫ガード (inventoryGuard.ts)

### 概要

在庫状況に応じて入札を自動調整するガードシステムです。
2段階のガード（ハードキル・ソフトスロットル）により、在庫切れや在庫薄時に広告費の無駄遣いを防止します。

### 処理順序

```
1. 通常ロジックでnewBidを決定
2. アトリビューション遅延対策（ダウン方向の安全弁）
3. 在庫ガードロジック（ハードキル・ソフトスロットル） ← ここ
```

### 在庫リスクステータス

```typescript
type InventoryRiskStatus =
  | "OUT_OF_STOCK"      // 在庫ゼロ（days_of_inventory = 0）
  | "LOW_STOCK_STRICT"  // 非常に在庫が少ない（< minDaysForGrowth）
  | "LOW_STOCK"         // 在庫が少ない（< minDaysForNormal）
  | "NORMAL"            // 在庫十分
  | "UNKNOWN";          // 在庫情報なし
```

### ハードキル（在庫ゼロ時）

```typescript
// src/inventory/inventoryGuard.ts

/**
 * ハードキル（在庫ゼロ時の処理）
 *
 * OUT_OF_STOCK の場合:
 * - SET_ZERO ポリシー: 入札を0円に設定
 * - SKIP_RECOMMENDATION ポリシー: 推奨レコードを生成しない
 */
export function applyHardKill(
  inventory: AsinInventorySnapshot | null,
  originalBid: number,
  config: InventoryGuardConfig
): InventoryGuardResult {
  // 在庫ガードがOFFの場合は適用しない
  if (config.inventoryGuardMode === "OFF") {
    return createNoGuardResult(inventory, originalBid);
  }

  // 在庫情報がない、またはUNKNOWNの場合は適用しない
  if (!inventory || inventory.status === "UNKNOWN") {
    return createNoGuardResult(inventory, originalBid);
  }

  // OUT_OF_STOCKの場合のみハードキル適用
  if (inventory.status !== "OUT_OF_STOCK") {
    return createNoGuardResult(inventory, originalBid);
  }

  // SET_ZERO ポリシー
  if (config.outOfStockBidPolicy === "SET_ZERO") {
    return {
      adjustedBid: 0,
      wasApplied: true,
      guardType: "HARD_KILL",
      reason: "在庫ゼロのため入札をゼロに設定",
      shouldSkipRecommendation: false,
    };
  }

  // SKIP_RECOMMENDATION ポリシー
  return {
    adjustedBid: 0,
    wasApplied: true,
    guardType: "HARD_KILL",
    reason: "在庫ゼロのため推奨をスキップ",
    shouldSkipRecommendation: true,
  };
}
```

### ソフトスロットル（在庫薄時）

```typescript
/**
 * ソフトスロットル用のパラメータを計算
 *
 * LOW_STOCK_STRICT の場合:
 * - max_up_ratio を 1.05 に制限（ほぼ入札増加なし）
 * - targetAcos を 10% 下げ（より保守的に）
 *
 * LOW_STOCK の場合:
 * - max_up_ratio を 1.15 に制限
 * - targetAcos は変更なし
 */
export function calculateSoftThrottleParams(
  inventory: AsinInventorySnapshot | null,
  config: InventoryGuardConfig,
  originalMaxUpRatio: number,
  originalTargetAcos: number
): {
  adjustedMaxUpRatio: number;
  adjustedTargetAcos: number;
  wasAdjusted: boolean;
  reason: string | null;
} {
  // 在庫ガードがOFFの場合は適用しない
  if (config.inventoryGuardMode === "OFF") {
    return { adjustedMaxUpRatio: originalMaxUpRatio, adjustedTargetAcos: originalTargetAcos, wasAdjusted: false };
  }

  const status = inventory?.status ?? "UNKNOWN";

  switch (status) {
    case "LOW_STOCK_STRICT":
      return {
        adjustedMaxUpRatio: 1.05,  // ほぼ増加なし
        adjustedTargetAcos: originalTargetAcos * 0.9,  // 10%下げ
        wasAdjusted: true,
        reason: `在庫日数が非常に少ない（${inventory?.daysOfInventory}日）ため入札上昇を強く抑制`,
      };

    case "LOW_STOCK":
      return {
        adjustedMaxUpRatio: 1.15,  // 最大15%増加まで
        adjustedTargetAcos: originalTargetAcos,  // 変更なし
        wasAdjusted: true,
        reason: `在庫日数が少ない（${inventory?.daysOfInventory}日）ため入札上昇を抑制`,
      };

    default:
      return { adjustedMaxUpRatio: originalMaxUpRatio, adjustedTargetAcos: originalTargetAcos, wasAdjusted: false };
  }
}
```

### 統合関数

```typescript
/**
 * 在庫ガードを統合適用
 *
 * 1. ハードキルをチェック（OUT_OF_STOCK → 入札ゼロ or スキップ）
 * 2. ソフトスロットルを適用（LOW_STOCK_STRICT / LOW_STOCK → 入札上昇抑制）
 */
export function applyInventoryGuard(
  inventory: AsinInventorySnapshot | null,
  recommendedBid: number,
  currentBid: number,
  config: InventoryGuardConfig,
  originalMaxUpRatio: number,
  originalTargetAcos: number
): InventoryGuardResult {
  // 1. まずハードキルをチェック
  const hardKillResult = applyHardKill(inventory, recommendedBid, config);
  if (hardKillResult.wasApplied) {
    return hardKillResult;
  }

  // 2. ソフトスロットルパラメータを計算
  const throttleParams = calculateSoftThrottleParams(
    inventory, config, originalMaxUpRatio, originalTargetAcos
  );

  if (!throttleParams.wasAdjusted) {
    return createNoGuardResult(inventory, recommendedBid);
  }

  // 3. max_up_ratio を適用した上限を計算
  const maxAllowedBid = currentBid * throttleParams.adjustedMaxUpRatio;
  const adjustedBid = Math.min(recommendedBid, maxAllowedBid);

  return {
    adjustedBid,
    wasApplied: adjustedBid < recommendedBid,
    guardType: "SOFT_THROTTLE",
    reason: throttleParams.reason,
    adjustedMaxUpRatio: throttleParams.adjustedMaxUpRatio,
    adjustedTargetAcos: throttleParams.adjustedTargetAcos,
  };
}
```

### ProductConfigの在庫ガード設定

```typescript
// product_configテーブルに追加されるフィールド

interface ProductConfig {
  // ... 既存フィールド ...

  /** 在庫ガードモード（デフォルト: NORMAL） */
  inventoryGuardMode?: "OFF" | "NORMAL" | "STRICT";

  /** 「攻め」モード禁止閾値（デフォルト: 10日） */
  minDaysOfInventoryForGrowth?: number;

  /** 「通常」モード抑制閾値（デフォルト: 20日） */
  minDaysOfInventoryForNormal?: number;

  /** 在庫ゼロ時ポリシー（デフォルト: SET_ZERO） */
  outOfStockBidPolicy?: "SET_ZERO" | "SKIP_RECOMMENDATION";
}
```

### 閾値設定テーブル

| 設定 | デフォルト値 | 説明 |
|------|-------------|------|
| `minDaysOfInventoryForGrowth` | 10日 | これ未満は LOW_STOCK_STRICT |
| `minDaysOfInventoryForNormal` | 20日 | これ未満は LOW_STOCK |
| `LOW_STOCK_MAX_UP_RATIO` | 1.15 | LOW_STOCK時の最大上昇率 |
| `LOW_STOCK_STRICT_MAX_UP_RATIO` | 1.05 | LOW_STOCK_STRICT時の最大上昇率 |
| `LOW_STOCK_STRICT_ACOS_MULTIPLIER` | 0.9 | LOW_STOCK_STRICT時のACOS係数 |

### 在庫ガードモード

| モード | 動作 |
|--------|------|
| `OFF` | 在庫ガードを無効化（実験用） |
| `NORMAL` | 標準のガード設定 |
| `STRICT` | より保守的なガード（LOW_STOCKでもSTRICT並みの抑制） |

### ReasonCode

```typescript
// 在庫ガード関連のReasonCode
type ReasonCode =
  // ... 既存コード ...
  | "INVENTORY_OUT_OF_STOCK"  // 在庫ゼロ（ハードキル）
  | "INVENTORY_LOW_STOCK";    // 在庫薄（ソフトスロットル）
```

### BigQueryログフィールド

| カラム名 | 説明 |
|----------|------|
| `days_of_inventory` | 在庫日数 |
| `inventory_risk_status` | リスクステータス |
| `inventory_guard_applied` | ガードが適用されたか |
| `inventory_guard_type` | HARD_KILL / SOFT_THROTTLE / NONE |
| `inventory_guard_reason` | 適用理由 |

### 使用例

```typescript
import {
  applyInventoryGuard,
  extractInventoryGuardConfig,
} from "./inventory";

// 在庫情報取得
const inventory = await inventoryRepo.getInventorySnapshot(profileId, asin);

// ガード設定をProductConfigから抽出
const config = extractInventoryGuardConfig(productConfig);

// 在庫ガードを適用
const result = applyInventoryGuard(
  inventory,
  150,  // recommendedBid
  100,  // currentBid
  config,
  1.3,  // originalMaxUpRatio
  0.3   // originalTargetAcos
);

if (result.guardType === "HARD_KILL") {
  console.log("在庫ゼロのため入札停止");
} else if (result.guardType === "SOFT_THROTTLE") {
  console.log(`入札を ${result.adjustedBid} に抑制`);
}
```

---

## 10. AUTO→EXACT 昇格エンジン (auto-exact-promotion-engine.ts)

### 概要

AUTOキャンペーンで良好なパフォーマンスを示した検索語をEXACTキーワードへ昇格させる候補を検出するエンジンです。
**SHADOWモード専用**であり、Amazon Ads APIへの自動登録は行いません。

### メイン関数

```typescript
// src/auto-exact/auto-exact-promotion-engine.ts

/**
 * AUTO→EXACT昇格候補を計算
 *
 * 2段階フィルタリング:
 * 1. クラスタレベル: 良好なパフォーマンスのクラスタを特定
 * 2. 検索語レベル: クラスタ内で特に優秀な検索語を候補化
 */
export function computeAutoExactPromotionCandidates(
  searchTerms: SearchTermStats30dRow[],
  clusters: IntentClusterStats30dRow[],
  baselines: AsinBaselineStats30dRow[],
  productConfigs: ProductConfigForPromotion[],
  targetCampaigns: TargetManualCampaignRow[],
  existingKeywords: ExistingExactKeywordRow[],
  negativeKeywordQueries: Set<string>,
  profileId: string,
  mode: ExecutionMode
): PromotionCandidatesResult {
  // ... 実装
}
```

### ベースラインCVR計算

```typescript
/**
 * ASINベースラインCVRを取得
 */
export function getAsinBaselineCvr(
  baselines: AsinBaselineStats30dRow[],
  asin: string
): number {
  const baseline = baselines.find(b => b.asin === asin);
  return baseline?.cvr ?? 0;
}

/**
 * ポートフォリオベースラインCVRを取得
 */
export function getPortfolioBaselineCvr(
  productConfig: ProductConfigForPromotion
): number {
  return productConfig.portfolioBaselineCvr ?? 0;
}

/**
 * 有効ベースラインCVRを取得
 * effective_baseline_cvr = max(asin_baseline_cvr, portfolio_baseline_cvr)
 */
export function getEffectiveBaselineCvr(
  asinBaselineCvr: number,
  portfolioBaselineCvr: number
): number {
  return Math.max(asinBaselineCvr, portfolioBaselineCvr);
}
```

### ライフサイクル別設定

```typescript
/**
 * ライフサイクルに応じた昇格設定を取得
 */
export function getPromotionConfigForLifecycle(
  lifecycleState: LifecycleState
): PromotionConfig {
  return LIFECYCLE_PROMOTION_CONFIGS[lifecycleState] ?? DEFAULT_PROMOTION_CONFIG;
}

// ライフサイクル別設定
const LIFECYCLE_PROMOTION_CONFIGS: Record<LifecycleState, PromotionConfig> = {
  // LAUNCH_HARD: 積極的に昇格（緩和した閾値）
  LAUNCH_HARD: {
    clusterMinClicks: 40,
    clusterMinOrders: 2,
    clusterCvrRatio: 0.9,
    clusterAcosRatio: 1.5,
    keywordMinClicks: 8,
    keywordMinOrders: 1,
    keywordCvrRatio: 1.05,
    keywordAcosRatio: 1.4,
  },
  // LAUNCH_SOFT: やや緩和
  LAUNCH_SOFT: {
    clusterMinClicks: 45,
    clusterMinOrders: 2,
    clusterCvrRatio: 0.95,
    clusterAcosRatio: 1.4,
    keywordMinClicks: 9,
    keywordMinOrders: 2,
    keywordCvrRatio: 1.08,
    keywordAcosRatio: 1.3,
  },
  // GROW: 標準設定
  GROW: {
    clusterMinClicks: 50,
    clusterMinOrders: 3,
    clusterCvrRatio: 1.0,
    clusterAcosRatio: 1.3,
    keywordMinClicks: 10,
    keywordMinOrders: 2,
    keywordCvrRatio: 1.1,
    keywordAcosRatio: 1.2,
  },
  // HARVEST: 厳格な閾値
  HARVEST: {
    clusterMinClicks: 60,
    clusterMinOrders: 4,
    clusterCvrRatio: 1.1,
    clusterAcosRatio: 1.1,
    keywordMinClicks: 15,
    keywordMinOrders: 3,
    keywordCvrRatio: 1.2,
    keywordAcosRatio: 1.1,
  },
};
```

### クラスタフィルタ

```typescript
/**
 * クラスタが昇格対象かどうか判定
 */
export function isClusterEligible(
  cluster: IntentClusterStats30dRow,
  effectiveBaselineCvr: number,
  targetAcos: number,
  config: PromotionConfig
): boolean {
  // クリック数が閾値未満
  if (cluster.clicks < config.clusterMinClicks) return false;

  // 注文数が閾値未満
  if (cluster.orders < config.clusterMinOrders) return false;

  // CVR が基準未満
  const clusterCvr = cluster.cvr ?? 0;
  if (clusterCvr < effectiveBaselineCvr * config.clusterCvrRatio) return false;

  // ACOS が基準超過（ACOS=null は高コスト扱い）
  const clusterAcos = cluster.acos ?? Infinity;
  if (clusterAcos > targetAcos * config.clusterAcosRatio) return false;

  return true;
}

/**
 * 昇格対象のクラスタをフィルタリング
 */
export function filterEligibleClusters(
  clusters: IntentClusterStats30dRow[],
  effectiveBaselineCvr: number,
  targetAcos: number,
  config: PromotionConfig
): IntentClusterStats30dRow[] {
  return clusters.filter(cluster =>
    isClusterEligible(cluster, effectiveBaselineCvr, targetAcos, config)
  );
}
```

### 検索語フィルタ

```typescript
/**
 * 検索語が昇格対象かどうか判定
 */
export function isSearchTermEligible(
  searchTerm: SearchTermStats30dRow,
  clusterCvr: number | null,
  effectiveBaselineCvr: number,
  targetAcos: number,
  config: PromotionConfig
): boolean {
  // クリック数が閾値未満
  if (searchTerm.clicks < config.keywordMinClicks) return false;

  // 注文数が閾値未満
  if (searchTerm.orders < config.keywordMinOrders) return false;

  // CVR基準: max(cluster_cvr, effective_baseline_cvr) × keywordCvrRatio
  const searchTermCvr = searchTerm.cvr ?? 0;
  const cvrBaseline = Math.max(clusterCvr ?? 0, effectiveBaselineCvr);
  if (searchTermCvr < cvrBaseline * config.keywordCvrRatio) return false;

  // ACOS が基準超過
  const searchTermAcos = searchTerm.acos ?? Infinity;
  if (searchTermAcos > targetAcos * config.keywordAcosRatio) return false;

  return true;
}
```

### 重複・ネガティブチェック

```typescript
/**
 * 既存のEXACTキーワードと重複しているか判定
 */
export function isDuplicateExactKeyword(
  searchTerm: string,
  asin: string,
  existingKeywords: ExistingExactKeywordRow[]
): boolean {
  const normalizedSearchTerm = searchTerm.toLowerCase().trim();
  return existingKeywords.some(
    kw =>
      kw.asin === asin &&
      kw.keyword_text.toLowerCase().trim() === normalizedSearchTerm
  );
}

/**
 * ネガティブキーワード候補かどうか判定
 */
export function isNegativeKeywordCandidate(
  searchTerm: string,
  negativeKeywordQueries: Set<string>
): boolean {
  return negativeKeywordQueries.has(searchTerm.toLowerCase().trim());
}
```

### スコア計算

```typescript
/**
 * 昇格優先度スコアを計算
 * score = cvr / (acos / target_acos)
 * CVR が高く、ACOS が低いほど高スコア
 */
export function calculatePromotionScore(
  cvr: number,
  acos: number,
  targetAcos: number
): number {
  if (targetAcos <= 0 || acos <= 0) {
    // ACOS が 0 の場合は CVR を優先（高スコア）
    return cvr * 100;
  }
  const acosRatio = acos / targetAcos;
  return cvr / acosRatio;
}
```

### 理由コード決定

```typescript
/**
 * 昇格理由コードを決定
 */
export function determineReasonCodes(
  cvr: number,
  acos: number,
  targetAcos: number,
  effectiveBaselineCvr: number,
  clusterCvr: number | null,
  clicks: number,
  orders: number,
  config: PromotionConfig,
  lifecycleState: LifecycleState
): PromotionReasonCode[] {
  const reasons: PromotionReasonCode[] = [];

  // HIGH_CVR: CVR が有効ベースラインの 1.5 倍以上
  if (cvr >= effectiveBaselineCvr * 1.5) {
    reasons.push("HIGH_CVR");
  }

  // LOW_ACOS: ACOS が目標の 0.8 倍以下
  if (acos > 0 && acos <= targetAcos * 0.8) {
    reasons.push("LOW_ACOS");
  }

  // HIGH_VOLUME: クリック数・注文数が閾値の 2 倍以上
  if (clicks >= config.keywordMinClicks * 2 && orders >= config.keywordMinOrders * 2) {
    reasons.push("HIGH_VOLUME");
  }

  // CLUSTER_PERFORMER: クラスタCVRより 30% 以上高い
  if (clusterCvr != null && clusterCvr > 0 && cvr >= clusterCvr * 1.3) {
    reasons.push("CLUSTER_PERFORMER");
  }

  // LIFECYCLE_BOOST: LAUNCH系で緩和閾値による昇格
  if (lifecycleState === "LAUNCH_HARD" || lifecycleState === "LAUNCH_SOFT") {
    reasons.push("LIFECYCLE_BOOST");
  }

  return reasons;
}

/**
 * 理由詳細文を生成
 */
export function generateReasonDetail(
  reasonCodes: PromotionReasonCode[],
  cvr: number,
  acos: number,
  targetAcos: number,
  effectiveBaselineCvr: number
): string {
  const parts: string[] = [];

  if (reasonCodes.includes("HIGH_CVR")) {
    parts.push(`CVR ${(cvr * 100).toFixed(2)}% (基準の ${(cvr / effectiveBaselineCvr).toFixed(1)}倍)`);
  }

  if (reasonCodes.includes("LOW_ACOS")) {
    parts.push(`ACOS ${(acos * 100).toFixed(1)}% (目標 ${(targetAcos * 100).toFixed(1)}% の ${((acos / targetAcos) * 100).toFixed(0)}%)`);
  }

  if (reasonCodes.includes("HIGH_VOLUME")) {
    parts.push("高ボリューム");
  }

  if (reasonCodes.includes("CLUSTER_PERFORMER")) {
    parts.push("クラスタ内トップパフォーマー");
  }

  if (reasonCodes.includes("LIFECYCLE_BOOST")) {
    parts.push("ライフサイクル緩和適用");
  }

  return parts.join(", ") || "昇格候補";
}
```

### ターゲットキャンペーン検索

```typescript
/**
 * 昇格先のMANUALキャンペーンを検索
 */
export function findTargetManualCampaign(
  asin: string,
  profileId: string,
  targetCampaigns: TargetManualCampaignRow[]
): TargetManualCampaignRow | null {
  return targetCampaigns.find(
    c => c.asin === asin && c.profile_id === profileId
  ) ?? null;
}
```

### PromotionReasonCode 一覧

```typescript
type PromotionReasonCode =
  | "HIGH_CVR"              // CVR が有効ベースラインの 1.5 倍以上
  | "LOW_ACOS"              // ACOS が目標の 0.8 倍以下
  | "HIGH_VOLUME"           // クリック数・注文数が閾値の 2 倍以上
  | "CLUSTER_PERFORMER"     // クラスタCVRより 30% 以上高い
  | "LIFECYCLE_BOOST";      // ライフサイクル緩和により昇格
```

### PromotionConfig 型

```typescript
interface PromotionConfig {
  // クラスタフィルタ閾値
  clusterMinClicks: number;     // クラスタの最小クリック数
  clusterMinOrders: number;     // クラスタの最小注文数
  clusterCvrRatio: number;      // クラスタCVR比率（effective_baseline_cvr × この値以上）
  clusterAcosRatio: number;     // クラスタACOS比率（target_acos × この値以下）

  // 検索語フィルタ閾値
  keywordMinClicks: number;     // 検索語の最小クリック数
  keywordMinOrders: number;     // 検索語の最小注文数
  keywordCvrRatio: number;      // 検索語CVR比率
  keywordAcosRatio: number;     // 検索語ACOS比率
}
```

### 使用例

```typescript
import {
  computeAutoExactPromotionCandidates,
  getEffectiveBaselineCvr,
  getPromotionConfigForLifecycle,
  calculatePromotionScore,
} from "./auto-exact";

// 昇格候補を計算
const result = computeAutoExactPromotionCandidates(
  searchTerms,
  clusters,
  baselines,
  productConfigs,
  targetCampaigns,
  existingKeywords,
  negativeKeywordQueries,
  "1234567890",
  "SHADOW"
);

console.log(`処理ASIN数: ${result.stats.totalAsinsProcessed}`);
console.log(`クラスタ通過数: ${result.stats.clustersPassedFilter}`);
console.log(`検索語通過数: ${result.stats.searchTermsPassedFilter}`);
console.log(`候補数: ${result.candidates.length}`);

// 上位候補を表示
const topCandidates = result.candidates
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);

for (const candidate of topCandidates) {
  console.log(`${candidate.searchTerm}`);
  console.log(`  Score: ${candidate.score.toFixed(4)}`);
  console.log(`  CVR: ${(candidate.cvr * 100).toFixed(2)}%`);
  console.log(`  ACOS: ${(candidate.acos * 100).toFixed(1)}%`);
  console.log(`  Reasons: ${candidate.reasonCodes.join(", ")}`);
}
```

### AUTO→EXACT昇格候補のステータス管理

候補は承認フローを経て適用されます。

#### ステータス型定義

```typescript
type PromotionSuggestionStatus =
  | "PENDING"    // 未処理（レビュー待ち）
  | "APPROVED"   // 承認済（適用待ち）
  | "REJECTED"   // 却下
  | "APPLIED";   // Amazon Ads API に適用済
```

#### ステータス遷移

```
PENDING → APPROVED → APPLIED
    ↓
REJECTED
```

#### 管理用 API エンドポイント

```typescript
// 候補一覧取得
// GET /admin/auto-exact-suggestions?status=PENDING&asin=B0XXX&minScore=0.5&limit=100
router.get("/", async (req, res) => { ... });

// ステータス別サマリー
// GET /admin/auto-exact-suggestions/summary
router.get("/summary", async (req, res) => { ... });

// 高スコア候補トップN（クイックレビュー用）
// GET /admin/auto-exact-suggestions/top?limit=20
router.get("/top", async (req, res) => { ... });

// 一括承認
// POST /admin/auto-exact-suggestions/approve
// Body: { suggestionIds: ["uuid1", "uuid2"], approvedBy: "user@example.com" }
router.post("/approve", async (req, res) => { ... });

// 一括却下
// POST /admin/auto-exact-suggestions/reject
// Body: { suggestionIds: ["uuid1"], rejectedBy: "user", reason: "Too generic" }
router.post("/reject", async (req, res) => { ... });

// 候補詳細
// GET /admin/auto-exact-suggestions/:suggestionId
router.get("/:suggestionId", async (req, res) => { ... });

// APPROVED候補をAmazonに適用（プレースホルダー）
// POST /admin/auto-exact-suggestions/apply-queued
router.post("/apply-queued", async (req, res) => { ... });
```

#### 使用例

```typescript
// 1. 高スコアのPENDING候補を取得
const topResponse = await fetch(
  "/admin/auto-exact-suggestions/top?limit=20",
  { headers: { "X-API-Key": apiKey } }
);
const { data: { suggestions } } = await topResponse.json();

// 2. レビュー後、承認する
const approveResponse = await fetch(
  "/admin/auto-exact-suggestions/approve",
  {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      suggestionIds: ["uuid-1", "uuid-2"],
      approvedBy: "reviewer@example.com",
    }),
  }
);

// 3. 不要な候補を却下
const rejectResponse = await fetch(
  "/admin/auto-exact-suggestions/reject",
  {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      suggestionIds: ["uuid-3"],
      rejectedBy: "reviewer@example.com",
      reason: "検索語が汎用的すぎる",
    }),
  }
);
```

### AUTO→EXACTエンジンのフェーズ構成

AUTO→EXACT昇格機能は段階的に展開されます。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  フェーズ 1: SHADOW サジェスト ✅                                            │
│                                                                             │
│  ・2段階フィルタ（クラスタ→検索語）で昇格候補を検出                         │
│  ・BigQuery の auto_exact_promotion_suggestions テーブルに候補を保存        │
│  ・Amazon Ads API への自動登録は行わない（SHADOW モード専用）               │
├─────────────────────────────────────────────────────────────────────────────┤
│  フェーズ 2: PENDING/APPROVED/REJECTED 承認フロー ✅                         │
│                                                                             │
│  ・候補にステータス列を追加（PENDING → APPROVED/REJECTED）                  │
│  ・管理用 REST API でレビュー・承認・却下操作                               │
│    - GET  /admin/auto-exact-suggestions                                     │
│    - GET  /admin/auto-exact-suggestions/summary                             │
│    - GET  /admin/auto-exact-suggestions/top                                 │
│    - POST /admin/auto-exact-suggestions/approve                             │
│    - POST /admin/auto-exact-suggestions/reject                              │
│  ・人間によるレビューを必須とし、誤昇格を防止                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  フェーズ 3: APPLY モード（将来実装予定）                                   │
│                                                                             │
│  ・環境変数 AUTO_EXACT_APPLY_ENABLED=true で有効化                          │
│  ・APPROVED 状態の候補を Amazon Ads API に自動適用                          │
│  ・POST /admin/auto-exact-suggestions/apply-queued エンドポイントで実行     │
│  ・適用後、ステータスを APPLIED に更新                                      │
│  ・Slack 通知で適用結果をレポート                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### フェーズ別の環境変数設定

| フェーズ | BID_ENGINE_EXECUTION_MODE | AUTO_EXACT_APPLY_ENABLED | 動作 |
|---------|---------------------------|--------------------------|------|
| 1 | SHADOW | - | 候補を BigQuery に保存のみ |
| 2 | SHADOW | false（デフォルト） | 承認フローで人間がレビュー、API 適用なし |
| 3 | SHADOW | true | APPROVED 候補を Amazon Ads API に適用 |

#### 現在のステータス

- **フェーズ 1**: ✅ 完了
- **フェーズ 2**: ✅ 完了（承認 API 実装済み）
- **フェーズ 3**: 🚧 プレースホルダー実装済み（`apply-queued` エンドポイント）

---

## 11. Slack 実行サマリー通知 (executionSummaryNotifier.ts)

### 概要

入札エンジン実行後に、実行結果のサマリーを Slack に通知するモジュールです。
**SHADOWモード検証用**と**APPLYモード本番監視用**の両方を目的としています。

### 目的

1. **SHADOWモード検証用**
   - 入札ロジックが正しく動作しているか確認
   - 異常な提案がないかチェック

2. **APPLYモード本番運用時の監視用**
   - 実際に適用される入札変更の傾向を把握
   - ロジック暴走を早期検出

### 環境変数によるモード制御

```typescript
// src/slack/executionSummaryNotifier.ts

/**
 * 指定されたモードで Slack 実行サマリーが有効かどうかを判定
 *
 * 環境変数 ENABLE_SLACK_EXECUTION_SUMMARY_MODES にカンマ区切りでモードを指定
 * 例: "SHADOW,APPLY"
 */
export function isSlackExecutionSummaryEnabledForMode(mode: string): boolean {
  const enabledModes = process.env.ENABLE_SLACK_EXECUTION_SUMMARY_MODES ?? "";
  if (!enabledModes) {
    return false;
  }

  const modeList = enabledModes
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter((m) => m.length > 0);

  return modeList.includes(mode.toUpperCase());
}
```

### 設定例

```bash
# SHADOW モードのみ通知
ENABLE_SLACK_EXECUTION_SUMMARY_MODES=SHADOW

# SHADOW と APPLY 両方で通知（推奨）
ENABLE_SLACK_EXECUTION_SUMMARY_MODES=SHADOW,APPLY

# 通知を無効化（空文字または未設定）
ENABLE_SLACK_EXECUTION_SUMMARY_MODES=
```

### メイン関数

```typescript
// src/slack/executionSummaryNotifier.ts

/**
 * 実行サマリーを Slack に送信
 */
export async function sendExecutionSummaryToSlack(
  options: ExecutionSummaryOptions
): Promise<SendExecutionSummaryResult> {
  const {
    executionId,
    maxAsins = DEFAULT_MAX_ASINS, // デフォルト: 5
    projectId = process.env.GCP_PROJECT_ID ?? "",
    dataset = process.env.BQ_DATASET ?? "amazon_bid_engine",
  } = options;

  // 1. 実行情報を executions テーブルから取得
  const execution = await fetchExecutionInfo(bigquery, projectId, dataset, executionId);

  // 2. ASIN サマリーを bid_recommendations + auto_exact_promotion_suggestions から取得
  const asinSummaries = await fetchAsinSummaries(
    bigquery, projectId, dataset, executionId, maxAsins
  );

  // 3. メッセージを構築
  const message = buildSummaryMessage(execution, asinSummaries);

  // 4. Slack に送信
  const success = await slackNotifier.send(message, "info");

  return { success, asinCount: asinSummaries.length };
}
```

### 型定義

```typescript
/**
 * 実行サマリー送信オプション
 */
interface ExecutionSummaryOptions {
  /** 実行ID */
  executionId: string;
  /** 表示する ASIN の最大数（デフォルト: 5） */
  maxAsins?: number;
  /** BigQuery プロジェクトID */
  projectId?: string;
  /** BigQuery データセット */
  dataset?: string;
}

/**
 * 送信結果
 */
interface SendExecutionSummaryResult {
  success: boolean;
  asinCount: number;
  error?: string;
}

/**
 * ASIN サマリー（BigQuery から取得）
 */
interface AsinSummary {
  asin: string;
  total_keywords: number;
  avg_bid_change_ratio: number | null;
  action_up_count: number;
  action_down_count: number;
  action_keep_count: number;
  calculated_acos: number | null;
  calculated_cvr: number | null;
  auto_exact_candidates: number;
}
```

### 攻め/抑えラベル判定

```typescript
/**
 * 入札変更率に基づくラベル判定
 */
const AGGRESSIVE_THRESHOLD = 1.2;  // avg_bid_change_ratio >= 1.2 → 攻め気味
const DEFENSIVE_THRESHOLD = 0.8;   // avg_bid_change_ratio <= 0.8 → 抑え気味

function getBidDirectionLabel(avgBidChangeRatio: number | null): string {
  if (avgBidChangeRatio === null) {
    return "";
  }
  if (avgBidChangeRatio >= AGGRESSIVE_THRESHOLD) {
    return " [攻め気味]";  // 入札を +20% 以上上げている傾向
  }
  if (avgBidChangeRatio <= DEFENSIVE_THRESHOLD) {
    return " [抑え気味]";  // 入札を -20% 以上下げている傾向
  }
  return "";
}
```

### Slack メッセージ例

```
*Amazon Bid Engine 実行サマリー*

```
実行ID:      exec-2024-01-15-123456
プロファイル: 1234567890
モード:      SHADOW
タイプ:      SCHEDULED
ステータス:  SUCCESS
開始時刻:    2024-01-15 10:00:00
所要時間:    45.2 秒
```

*ASIN サマリー（上位）*

• *B0XXXXXXXXX* [攻め気味]
  KW: 150 | 変化率: +25.3% | ACOS: 18.5% | AUTO→EXACT候補: 12
  (UP: 80 / DOWN: 20 / KEEP: 50)

• *B0YYYYYYYYY*
  KW: 120 | 変化率: +5.2% | ACOS: 22.1% | AUTO→EXACT候補: 5
  (UP: 45 / DOWN: 35 / KEEP: 40)

• *B0ZZZZZZZZZ* [抑え気味]
  KW: 80 | 変化率: -15.8% | ACOS: 35.2% | AUTO→EXACT候補: 0
  (UP: 10 / DOWN: 55 / KEEP: 15)
```

### bidEngine.ts への統合

```typescript
// src/engine/bidEngine.ts

import {
  sendExecutionSummaryToSlack,
  isSlackExecutionSummaryEnabledForMode,
} from "../slack";

export async function runBidEngine(config: BidEngineConfig): Promise<BidEngineResult> {
  // ... 入札処理 ...

  // 正常終了時に Slack 通知
  await executionLogger.finish();

  // Slack 実行サマリー送信（モードが有効な場合のみ）
  if (isSlackExecutionSummaryEnabledForMode(mode)) {
    try {
      await sendExecutionSummaryToSlack({
        executionId,
        maxAsins: 5,
        projectId: config.projectId,
        dataset: config.dataset,
      });
    } catch (slackError) {
      // Slack 送信エラーはログのみ（メイン処理は成功として扱う）
      logger.warn("Slack実行サマリー送信失敗", {
        executionId,
        error: slackError instanceof Error ? slackError.message : String(slackError),
      });
    }
  }

  return { executionId, mode, status: "SUCCESS", ... };
}
```

### デバッグエンドポイント

```typescript
// POST /debug/send-execution-summary
// 過去の実行IDを指定して Slack サマリーを手動送信

router.post("/send-execution-summary", async (req: Request, res: Response) => {
  const { executionId, maxAsins } = req.body;

  // executionId は必須
  if (!executionId || typeof executionId !== "string") {
    return res.status(400).json({
      success: false,
      error: "bad-request",
      message: "executionId is required in request body",
    });
  }

  const result = await sendExecutionSummaryToSlack({
    executionId,
    maxAsins: typeof maxAsins === "number" ? maxAsins : undefined,
  });

  return res.status(result.success ? 200 : 500).json({
    success: result.success,
    executionId,
    asinCount: result.asinCount,
    ...(result.error && { message: result.error }),
  });
});
```

### 使用例

```typescript
import {
  sendExecutionSummaryToSlack,
  isSlackExecutionSummaryEnabledForMode,
} from "./slack";

// 1. モードチェック
if (isSlackExecutionSummaryEnabledForMode("SHADOW")) {
  console.log("SHADOW モードの通知が有効です");
}

// 2. 手動で通知を送信
const result = await sendExecutionSummaryToSlack({
  executionId: "exec-2024-01-15-123456",
  maxAsins: 10,
});

if (result.success) {
  console.log(`${result.asinCount} ASINのサマリーを送信しました`);
} else {
  console.error(`送信失敗: ${result.error}`);
}
```

### APPLYモード移行時の注意

> **重要**: APPLYモードに移行後も、この Slack 実行サマリー通知は基本的に有効のまま運用することを推奨します。

通知内容は、広告ロジックがどの ASIN に、どれくらい入札変更や AUTO→EXACT 昇格候補を出しているかを人間が確認するための重要な監視レイヤーです。

将来この通知を無効化したり頻度を下げる場合は、必ず以下を確認してください：

1. BigQuery ダッシュボードなど、代替となる監視手段が十分に整っているか
2. APPLY ロジックの挙動が安定しており、異常時にすぐ気付ける体制になっているか

---

## 12. イベントオーバーライド (event/types.ts)

大型セール（プライムデー、ブラックフライデー等）の期間中、通常の「守りのロジック」が効きすぎて機会損失が発生することを防ぐためのオーバーライド機構。

### 12.1 EventMode 型

```typescript
// src/event/types.ts

/**
 * イベントモード
 *
 * - NONE: 通常日（デフォルト）
 * - BIG_SALE_PREP: セール準備期間（セール前2-3日）
 * - BIG_SALE_DAY: セール当日
 */
export type EventMode = "NONE" | "BIG_SALE_PREP" | "BIG_SALE_DAY";
```

### 12.2 環境変数設定

```bash
# イベントオーバーライド設定
# 有効値: NONE, BIG_SALE_PREP, BIG_SALE_DAY
EVENT_MODE=NONE
```

- 不正な値や未設定の場合は `"NONE"` にフォールバック
- `runBidEngine()` 実行開始時にログ出力される

### 12.3 EventBidPolicy

各イベントモードにはデフォルトの入札ポリシーが定義されている。

```typescript
export interface EventBidPolicy {
  /** アップ方向の最大倍率（例: 1.5 = 現在の入札額の1.5倍まで上げられる） */
  maxBidUpMultiplier: number;

  /** ダウン方向の最大倍率（例: 0.9 = 現在の入札額の90%まで = 10%減が下限） */
  maxBidDownMultiplier: number;

  /** ACOS高すぎ判定の乗数（7日除外版）- 値が大きいほど判定が緩くなる */
  acosHighMultiplierFor7dExcl: number;

  /** ACOS高すぎ判定の乗数（30日版）- 値が大きいほど判定が緩くなる */
  acosHighMultiplierFor30d: number;

  /** 強いダウン（STRONG_DOWN, STOP）を許可するかどうか */
  allowStrongDown: boolean;

  /** NO_CONVERSION判定を許可するかどうか */
  allowNoConversionDown: boolean;
}
```

### 12.4 モード別デフォルトポリシー

| パラメータ | NONE | BIG_SALE_PREP | BIG_SALE_DAY |
|-----------|------|---------------|--------------|
| maxBidUpMultiplier | 1.3 | 1.4 | 1.5 |
| maxBidDownMultiplier | 0.7 | 0.85 | 0.9 |
| acosHighMultiplierFor7dExcl | 1.2 | 1.3 | 1.5 |
| acosHighMultiplierFor30d | 1.05 | 1.1 | 1.15 |
| allowStrongDown | true | true | **false** |
| allowNoConversionDown | true | true | **false** |

### 12.5 オーバーライドの効果

#### ダウン判定の緩和

`shouldBeAcosHigh()` で使用されるACOS閾値がモードに応じて調整される。

```
// 例: targetAcos = 20% の場合

// NONE（通常日）
acos7dExclRecent > 20% × 1.2 = 24% かつ acos30d > 20% × 1.05 = 21% → ACOS_HIGH判定

// BIG_SALE_DAY（セール当日）
acos7dExclRecent > 20% × 1.5 = 30% かつ acos30d > 20% × 1.15 = 23% → 閾値が緩く判定されにくい
```

#### NO_CONVERSION判定の無効化

`BIG_SALE_DAY` モードでは `allowNoConversionDown = false` により、コンバージョンがない状態でもダウン判定されない。

#### 強いダウンの抑制

`BIG_SALE_DAY` モードでは `allowStrongDown = false` により、`STRONG_DOWN` や `STOP` アクションが自動的に `MILD_DOWN` に緩和される。

#### 入札額変動幅の制御

`maxBidUpMultiplier` / `maxBidDownMultiplier` により、入札額の変動幅がクリップされる。

```typescript
// BIG_SALE_DAY の場合
const maxBid = currentBid * 1.5;   // 1.5倍まで上げられる
const minBid = currentBid * 0.9;   // 90%まで（10%減が下限）
recommendedBid = Math.min(Math.max(rawBid, minBid), maxBid);
```

### 12.6 運用時の注意

1. **セール前にモード変更**: セール開始の2-3日前に `BIG_SALE_PREP` に切り替え
2. **セール当日にモード変更**: セール開始時に `BIG_SALE_DAY` に切り替え
3. **セール終了後に戻す**: セール終了翌日に `NONE` に戻す
4. **安全弁は維持**: 在庫ガード（`max_loss_daily` 等）はセール時でも有効

### 12.7 カスタムポリシー

デフォルトポリシーを上書きするカスタム設定も可能：

```typescript
const customPolicies = {
  BIG_SALE_DAY: {
    maxBidUpMultiplier: 2.0,  // より積極的なアップを許可
  },
};

const policy = getEffectiveEventBidPolicy("BIG_SALE_DAY", customPolicies);
// → maxBidUpMultiplier=2.0、他はデフォルトを使用
```

---

## 13. APPLY モード安全設計 (apply/)

BidRecommendation 生成後、Amazon Ads API に実際に適用する前のフィルタリングと安全制限を行うモジュール。

### 13.1 APPLYフィルタリングフロー

```
推奨計算完了（BidRecommendation[]）
         ↓
  ┌──────────────────────────────────────────────────────────────────┐
  │  APPLY フィルタリング                                            │
  │                                                                  │
  │  1. ExecutionMode チェック                                       │
  │     SHADOW → 全件スキップ (reason: SHADOW_MODE)                  │
  │                                                                  │
  │  2. キャンペーン allowlist チェック                              │
  │     campaignId ∉ allowlist → スキップ (reason: NOT_IN_ALLOWLIST) │
  │                                                                  │
  │  3. 変更幅チェック                                               │
  │     |newBid - oldBid| < minApplyChangeAmount                     │
  │     or |(newBid - oldBid) / oldBid| < minApplyChangeRatio        │
  │     → スキップ (reason: NO_SIGNIFICANT_CHANGE)                   │
  │                                                                  │
  │  4. 件数上限チェック                                             │
  │     appliedCount >= maxApplyChangesPerRun                        │
  │     → スキップ (reason: APPLY_LIMIT_REACHED)                     │
  └──────────────────────────────────────────────────────────────────┘
         ↓
    ┌─────────┬───────────────────────────────┐
    ↓ 通過    ↓ スキップ
  API呼び出し   ログに記録（skip_reason付き）
```

### 13.2 ApplySafetyConfig

```typescript
// src/apply/types.ts

interface ApplySafetyConfig {
  /**
   * 1回のジョブ実行で実際にAPIへ送ってよいbid更新件数の上限
   * 環境変数: MAX_APPLY_CHANGES_PER_RUN
   * デフォルト: 100件
   */
  maxApplyChangesPerRun: number;

  /**
   * APPLYを許可するcampaignIdのリスト
   * 環境変数: APPLY_CAMPAIGN_ALLOWLIST (カンマ区切り)
   * デフォルト: 空配列（= 全キャンペーンSHADOW扱い）
   */
  applyCampaignAllowlist: string[];

  /**
   * APPLYに必要な最小変更幅（円）
   * 環境変数: MIN_APPLY_CHANGE_AMOUNT
   * デフォルト: 1円
   */
  minApplyChangeAmount: number;

  /**
   * APPLYに必要な最小変更率（比率）
   * 環境変数: MIN_APPLY_CHANGE_RATIO
   * デフォルト: 0.01 (1%)
   */
  minApplyChangeRatio: number;
}
```

### 13.3 ApplySkipReason

| 理由 | 説明 | いつ発生するか |
|------|------|---------------|
| `SHADOW_MODE` | SHADOWモードのため | `BID_ENGINE_EXECUTION_MODE=SHADOW` |
| `NOT_IN_ALLOWLIST` | allowlist外 | campaignId が `APPLY_CAMPAIGN_ALLOWLIST` に未含 |
| `APPLY_LIMIT_REACHED` | 件数上限到達 | 既に `maxApplyChangesPerRun` 件をAPI送信済み |
| `NO_SIGNIFICANT_CHANGE` | 変更幅不足 | 変更幅が閾値未満 |
| `API_ERROR` | API呼び出しエラー | Amazon Ads API がエラーを返した |

### 13.4 フィルタリング関数

```typescript
// src/apply/apply-filter.ts

/**
 * 単一の推奨がAPPLY候補かどうかを判定
 */
function checkApplyCandidate(
  campaignId: string,
  oldBid: number,
  newBid: number,
  config: ApplySafetyConfig
): { isCandidate: boolean; skipReason?: ApplySkipReason }

/**
 * 推奨リストをフィルタリングしてAPPLY対象を決定
 */
function filterApplyCandidates<T extends ApplyFilterItem>(
  items: T[],
  config: ApplySafetyConfig
): ApplyFilterResult<T>
// 返り値: { toApply: T[], skipped: Array<T & { skipReason }> }
```

### 13.5 設定ローダー

```typescript
// src/apply/apply-config.ts

/**
 * 環境変数からAPPLY安全制限設定を読み込む
 */
function loadApplySafetyConfig(): ApplySafetyConfig

/**
 * APPLY設定を起動時にログ出力
 */
function logApplySafetyConfigOnStartup(config: ApplySafetyConfig): void
```

### 13.6 ログ拡張

各キーワード推奨ログに追加されるフィールド:

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `is_apply_candidate` | boolean | APPLY候補かどうか |
| `apply_skip_reason` | string | スキップ理由 |

実行単位ログに追加されるフィールド:

| フィールド | 説明 |
|-----------|------|
| `total_apply_candidates` | APPLY候補件数 |
| `total_apply_failed` | API呼び出し失敗件数 |
| `skip_count_shadow_mode` | SHADOWモードでスキップした件数 |
| `skip_count_not_in_allowlist` | allowlist外でスキップした件数 |
| `skip_count_apply_limit_reached` | 件数上限でスキップした件数 |
| `skip_count_no_significant_change` | 変更幅不足でスキップした件数 |

### 13.7 運用ガイドライン

1. **初期導入**: `APPLY_CAMPAIGN_ALLOWLIST` を空のまま（全SHADOW）で運用開始
2. **段階的拡大**: 少数のキャンペーンを allowlist に追加してテスト
3. **件数上限**: `MAX_APPLY_CHANGES_PER_RUN=10` など低めの値からスタート
4. **モニタリング**: BigQuery の `apply_skip_reason` 分布を確認
5. **本格運用**: 安定を確認後、allowlist と件数上限を拡大

---

## 14. 掲載位置（Placement）最適化 (placement/)

キャンペーンの掲載位置（Top of Search等）の入札調整比率を自動最適化するモジュール。

### 14.1 コア概念

Top of Search Impression Share（TOS IS）を考慮し、「偽の限界点（Local Maximum）」を回避する:

- **勝ちパターン**: ACOS良好 → 入札調整比率を上げる（BOOST）
- **オポチュニティ・ジャンプ**: ACOS悪い + IS低い → テスト的に大幅アップ（TEST_BOOST）
- **撤退判断**: ACOS悪い + IS高い → 入札調整比率を下げる（DECREASE）

### 14.2 computePlacementRecommendation

```typescript
// src/placement/placement-calculator.ts

function computePlacementRecommendation(
  metrics: PlacementMetrics,
  config: PlacementOptimizerConfig
): PlacementRecommendation {
  // ACOSギャップ比率
  const acosGapRatio = metrics.acos30d / metrics.targetAcos;

  // 勝ちパターン: ACOS < target * 0.9
  if (acosGapRatio < config.strongPerformanceThreshold) {
    return {
      action: "BOOST",
      newModifier: Math.min(metrics.currentBidModifier + config.boostIncrement, config.maxModifier),
      reasonCode: "STRONG_PERFORMANCE",
    };
  }

  // オポチュニティ・ジャンプ: ACOS悪い + IS低い（真のパフォーマンス不明）
  if (
    acosGapRatio > config.opportunityJumpAcosMin &&
    metrics.topOfSearchImpressionShare < config.opportunityJumpIsMax
  ) {
    return {
      action: "TEST_BOOST",
      newModifier: Math.min(metrics.currentBidModifier + config.testBoostIncrement, config.maxModifier),
      reasonCode: "OPPORTUNITY_JUMP",
      isOpportunityJump: true,
    };
  }

  // 撤退判断: ACOS悪い + IS高い（本当に弱い）
  if (
    acosGapRatio > config.trueWeaknessAcosThreshold &&
    metrics.topOfSearchImpressionShare > config.trueWeaknessIsMin
  ) {
    return {
      action: "DECREASE",
      newModifier: Math.max(metrics.currentBidModifier - config.decreaseDecrement, config.minModifier),
      reasonCode: "TRUE_WEAKNESS",
    };
  }

  // 現状維持
  return { action: "NO_ACTION", reasonCode: "MODERATE_PERFORMANCE" };
}
```

### 14.3 PlacementReasonCode

| コード | 説明 |
|--------|------|
| `STRONG_PERFORMANCE` | ACOSが目標を達成、BOOSTする |
| `OPPORTUNITY_JUMP` | ISが低くACOSが悪い、テスト的にBOOSTする |
| `TRUE_WEAKNESS` | ISが高くACOSが悪い、撤退 |
| `MODERATE_PERFORMANCE` | ACOSが目標付近、現状維持 |
| `INSUFFICIENT_DATA` | データ不足で判断不可 |
| `BUDGET_LIMITED` | 予算制限のためテストブースト不可 |
| `MAX_MODIFIER_REACHED` | 最大調整比率に到達 |

---

## 15. 日予算（Budget）最適化 (budget/)

キャンペーンの日予算を「Lost IS Budget」と「ACOSの健全性」に基づいて動的に最適化するモジュール。

### 15.1 コアコンセプト

**「予算が足りない（Usage高い または Lost ISある）」かつ「利益が出ている（ACOS低い）」場合のみ増額。無駄遣いは増やさない。**

### 15.2 computeBudgetRecommendation

```typescript
// src/budget/budget-calculator.ts

function computeBudgetRecommendation(
  metrics: BudgetMetrics,
  config: BudgetOptimizerConfig
): BudgetRecommendation {
  const acosGapRatio = metrics.acos7d / metrics.targetAcos;

  // 増額判定: 高パフォーマンス + 予算逼迫
  const isHighPerformance = acosGapRatio < config.boostAcosRatio;
  const isBudgetConstrained =
    metrics.budgetUsagePercent > config.boostUsageThreshold ||
    metrics.lostImpressionShareBudget > config.boostLostIsThreshold;

  if (isHighPerformance && isBudgetConstrained) {
    const rawNewBudget = metrics.dailyBudget * (1 + config.boostPercent / 100);
    const clampedBudget = applyBudgetGuardrails(rawNewBudget, metrics.dailyBudget, config);
    return {
      action: "BOOST",
      newBudget: clampedBudget,
      reasonCode: metrics.lostImpressionShareBudget > config.boostLostIsThreshold
        ? "HIGH_PERFORMANCE_LOST_IS"
        : "HIGH_PERFORMANCE_HIGH_USAGE",
    };
  }

  // 減額判定: 低パフォーマンス + 余剰予算継続
  const isLowPerformance = acosGapRatio > config.curbAcosRatio;
  const isLongTermSurplus = metrics.lowUsageDays >= config.curbLowUsageDays;

  if (isLowPerformance && isLongTermSurplus) {
    const rawNewBudget = metrics.dailyBudget * (1 - config.curbPercent / 100);
    const clampedBudget = applyBudgetGuardrails(rawNewBudget, metrics.dailyBudget, config);
    return {
      action: "CURB",
      newBudget: clampedBudget,
      reasonCode: "LOW_PERFORMANCE_SURPLUS",
    };
  }

  return { action: "KEEP", reasonCode: "MODERATE_PERFORMANCE" };
}
```

### 15.3 ガードレール

```typescript
function applyBudgetGuardrails(
  rawNewBudget: number,
  currentBudget: number,
  config: BudgetOptimizerConfig
): number {
  // 上限: min(globalMaxBudgetCap, currentBudget * maxBudgetMultiplier)
  const maxBudget = Math.min(
    config.globalMaxBudgetCap,
    currentBudget * config.maxBudgetMultiplier
  );

  // 下限: minBudget
  const minBudget = config.minBudget;

  return Math.round(Math.min(Math.max(rawNewBudget, minBudget), maxBudget));
}
```

### 15.4 BudgetReasonCode

| コード | 説明 |
|--------|------|
| `HIGH_PERFORMANCE_LOST_IS` | 高パフォーマンス＆Lost IS Budget が高い |
| `HIGH_PERFORMANCE_HIGH_USAGE` | 高パフォーマンス＆予算消化率が高い |
| `MODERATE_PERFORMANCE` | 目標付近のACOS、現状維持 |
| `BUDGET_AVAILABLE` | 予算に余裕がある |
| `LOW_PERFORMANCE_SURPLUS` | 低パフォーマンス＆余剰予算、削減推奨 |
| `MAX_BUDGET_REACHED` | 最大予算上限に到達 |
| `MIN_BUDGET_REACHED` | 最小予算下限に到達 |
| `INSUFFICIENT_DATA` | データ不足で判断不可 |

### 15.5 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `boostUsageThreshold` | 90% | 増額判定の予算消化率閾値 |
| `boostLostIsThreshold` | 10% | 増額判定のLost IS閾値 |
| `boostAcosRatio` | 0.9 | 増額判定のACOS比率（目標の90%以下） |
| `boostPercent` | 20 | 増額率 |
| `curbUsageThreshold` | 50% | 減額判定の予算消化率閾値 |
| `curbLowUsageDays` | 7 | 減額判定の低消化継続日数 |
| `curbAcosRatio` | 1.5 | 減額判定のACOS比率（目標の150%超） |
| `curbPercent` | 10 | 減額率 |
| `globalMaxBudgetCap` | 20,000円 | 絶対上限額 |
| `maxBudgetMultiplier` | 2.0 | 現在予算からの最大倍率 |
| `minBudget` | 500円 | 最小予算額 |
| `minOrdersForDecision` | 3 | 判断に必要な最小注文数 |

---

## 16. 運用監視・アラート (monitoring/)

実行ログから「健康状態」を評価し、異常時にSlackアラートを送信するモジュール。

### 16.1 概要

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ bidEngine.ts    │ -> │ metricsCollector │ -> │ alertEvaluator  │
│ (実行完了後)     │    │ (BigQuery集計)   │    │ (閾値判定)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                       │
                                                       v
                                               ┌─────────────────┐
                                               │ alertNotifier   │
                                               │ (Slack送信)     │
                                               └─────────────────┘
```

### 16.2 監視指標 (ExecutionHealthMetrics)

```typescript
// src/monitoring/types.ts

export interface ExecutionHealthMetrics {
  executionId: string;
  executionTime: Date;
  mode: string;                      // SHADOW | APPLY
  guardrailsMode: string | null;     // OFF | SHADOW | ENFORCE

  // 件数系
  totalKeywords: number;
  totalRecommendations: number;
  totalApplied: number;
  totalApplyFailed: number;

  // アクション内訳
  strongUpCount: number;     // +50%超の大幅UP
  strongDownCount: number;   // -30%超の大幅DOWN
  upCount: number;
  downCount: number;
  keepCount: number;

  // 比率
  upRatio: number;                   // UP / total
  downRatio: number;                 // DOWN / total
  guardrailsClippedRatio: number;    // was_guard_clamped / total
  applyFailedRatio: number;          // apply_failed / applied

  // 入札変動
  avgBidChangeRatio: number;
  maxBidChangeRatio: number;
  minBidChangeRatio: number;

  executionDurationSec: number | null;
}
```

### 16.3 アラート閾値 (AlertThresholds)

```typescript
// src/monitoring/types.ts

export interface AlertThresholds {
  maxDownRatio: number;              // DOWN比率の上限
  maxUpRatio: number;                // UP比率の上限
  maxGuardrailsClippedRatio: number; // ガードレール適用比率の上限
  maxApplyFailedRatio: number;       // APPLY失敗比率の上限
  maxApplyFailedCount: number;       // APPLY失敗件数の上限
  maxBidChangeRatio: number;         // 入札変動倍率の上限
  strongUpThresholdPercent: number;  // 大幅UPの閾値(%)
  strongDownThresholdPercent: number; // 大幅DOWNの閾値(%)
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  maxDownRatio: 0.5,                 // 50%以上DOWNで警告
  maxUpRatio: 0.5,                   // 50%以上UPで警告
  maxGuardrailsClippedRatio: 0.3,    // 30%以上クリップで警告
  maxApplyFailedRatio: 0.2,          // 20%以上失敗で警告
  maxApplyFailedCount: 10,           // 10件以上失敗で警告
  maxBidChangeRatio: 3.0,            // 3倍以上の変動で警告
  strongUpThresholdPercent: 50,      // +50%以上を大幅UP
  strongDownThresholdPercent: -30,   // -30%以下を大幅DOWN
};
```

### 16.4 異常検出コード (AlertIssueCode)

| コード | 説明 |
|--------|------|
| `DOWN_RATIO_HIGH` | DOWN比率が閾値超過 |
| `UP_RATIO_HIGH` | UP比率が閾値超過 |
| `GUARDRAILS_CLIPPED_HIGH` | ガードレール適用比率が閾値超過 |
| `APPLY_FAILED_RATIO_HIGH` | APPLY失敗比率が閾値超過 |
| `APPLY_FAILED_COUNT_HIGH` | APPLY失敗件数が閾値超過 |
| `BID_CHANGE_RATIO_HIGH` | 入札変動倍率が閾値超過 |

### 16.5 評価ロジック

```typescript
// src/monitoring/alertEvaluator.ts

export function evaluateExecutionHealth(
  metrics: ExecutionHealthMetrics,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS
): AlertEvaluationResult {
  const issues: DetectedIssue[] = [];

  // DOWN比率チェック
  if (metrics.downRatio > thresholds.maxDownRatio) {
    issues.push({
      code: "DOWN_RATIO_HIGH",
      message: `DOWN比率 ${(metrics.downRatio * 100).toFixed(1)}% が閾値 ${thresholds.maxDownRatio * 100}% を超過`,
      severity: "warning",
      value: metrics.downRatio,
      threshold: thresholds.maxDownRatio,
    });
  }

  // ... 他の閾値チェック

  return {
    metrics,
    thresholds,
    isAnomaly: issues.length > 0,
    issues,
  };
}
```

### 16.6 環境変数

| 環境変数 | デフォルト | 説明 |
|----------|------------|------|
| `ALERT_ENABLED` | `false` | アラート機能の有効化 |
| `ALERT_SLACK_WEBHOOK_URL` | - | アラート専用Webhook URL |
| `ALERT_ALWAYS_NOTIFY` | `false` | 正常時もサマリー通知 |
| `ALERT_MAX_DOWN_RATIO` | `0.5` | DOWN比率の閾値 |
| `ALERT_MAX_UP_RATIO` | `0.5` | UP比率の閾値 |
| `ALERT_MAX_GUARDRAILS_CLIPPED_RATIO` | `0.3` | ガードレール適用比率の閾値 |
| `ALERT_MAX_APPLY_FAILED_RATIO` | `0.2` | APPLY失敗比率の閾値 |
| `ALERT_MAX_APPLY_FAILED_COUNT` | `10` | APPLY失敗件数の閾値 |
| `ALERT_MAX_BID_CHANGE_RATIO` | `3.0` | 入札変動倍率の閾値 |

### 16.7 bidEngine.ts との統合

```typescript
// src/engine/bidEngine.ts

import { evaluateAndNotify, getAlertConfig } from "../monitoring";

// 実行完了後
const alertConfig = getAlertConfig();
if (alertConfig.enabled) {
  try {
    await evaluateAndNotify(executionId, config.projectId, config.dataset);
  } catch (alertError) {
    logger.warn("アラート評価・通知に失敗しましたが、処理は正常完了しています", {
      error: alertError,
    });
  }
} else if (isSlackExecutionSummaryEnabledForMode(mode)) {
  // 従来のサマリー通知（フォールバック）
  await sendExecutionSummary({ ... });
}
```

### 16.8 BigQuery監視ビュー

`execution_health_summary` ビューで以下の集計を提供：

```sql
-- src/bigquery/schemas/execution_health_summary.sql

-- 異常フラグ判定
CASE
  WHEN down_ratio > 0.5 THEN TRUE
  WHEN up_ratio > 0.5 THEN TRUE
  WHEN guardrails_clipped_ratio > 0.3 THEN TRUE
  WHEN apply_failed_ratio > 0.2 THEN TRUE
  ELSE FALSE
END AS is_anomaly_basic
```

関連ビュー：
- `execution_health_summary`: 全実行の健康指標
- `execution_health_recent`: 直近100件
- `execution_health_anomalies`: 異常検出された実行のみ
- `execution_health_daily_summary`: 日次集計

---

## 17. キーワード自動発見 (keywordDiscovery/)

Amazon検索語レポートから新しい有望キーワード候補を自動的に発見・スコアリングするモジュール。

### 17.1 概要

```
┌───────────────────────────────────────────────────────────────────┐
│  Cloud Scheduler / HTTP                                           │
│  POST /cron/run-keyword-discovery                                 │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│  httpHandler.ts :: runKeywordDiscoveryJob()                       │
│  - リクエストパラメータ解析                                         │
│  - 設定マージ                                                      │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│  repository.ts                                                    │
│  - fetchSearchTermReport()    検索語レポート取得                    │
│  - fetchExistingKeywords()    既存キーワード取得                    │
│  - fetchProductConfigs()      商品設定取得                         │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│  engine.ts :: runKeywordDiscovery()                               │
│  1. discoverNewKeywordsFromSearchTerms()  検索語から候補抽出        │
│  2. discoverNewKeywordsFromJungleScout()  JS APIから候補抽出(Phase2)│
│  3. mergeAndScoreCandidates()             候補統合・最終スコア算出   │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│  repository.ts :: upsertCandidateKeywords()                       │
│  keyword_discovery_candidates テーブルへ保存                       │
└───────────────────────────┬───────────────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│  Slack通知                                                        │
│  - 新規候補数、対象ASIN数                                          │
│  - 上位候補例（スコア上位5件）                                      │
└───────────────────────────────────────────────────────────────────┘
```

### 17.2 メイン関数

```typescript
// src/keywordDiscovery/httpHandler.ts

export async function runKeywordDiscoveryJob(
  options: RunKeywordDiscoveryJobOptions = {}
): Promise<RunKeywordDiscoveryJobResult> {
  // 1. 検索語レポートを取得
  const searchTerms = await repository.fetchSearchTermReport(profileId, lookbackDays);

  // 2. 既存キーワードを取得
  const existingKeywords = await repository.fetchExistingKeywords(profileId);

  // 3. 商品設定を取得
  const productConfigs = await repository.fetchProductConfigs();

  // 4. キーワード発見を実行
  const { candidates, stats } = await runKeywordDiscovery(
    searchTerms,
    existingKeywords,
    productConfigs,
    config
  );

  // 5. BigQueryに保存（ドライランでなければ）
  if (!dryRun && candidates.length > 0) {
    await repository.upsertCandidateKeywords(candidates);
  }

  // 6. Slack通知
  if (!skipSlackNotification && candidates.length > 0) {
    await sendSlackNotification(...);
  }
}
```

### 17.3 スコア計算 (calculateSearchTermScore)

```typescript
// src/keywordDiscovery/engine.ts

function calculateSearchTermScore(
  metrics: SearchTermMetrics,
  targetAcos: number
): { score: number; breakdown: ScoreBreakdown } {
  let score = 0;
  const breakdown: ScoreBreakdown = {};

  // ============================
  // クリック数ボーナス（最大30点）
  // ============================
  // 1クリック = 3点、最大10クリックで30点
  const clickScore = Math.min(metrics.clicks7d * 3, 30);
  score += clickScore;
  breakdown.clicks = clickScore;

  // ============================
  // 注文数ボーナス（最大40点）
  // ============================
  // 1注文 = 10点、最大4注文で40点
  const orderScore = Math.min(metrics.orders7d * 10, 40);
  score += orderScore;
  breakdown.orders = orderScore;

  // ============================
  // CVRボーナス（最大15点）
  // ============================
  // CVR > 10%: 15点
  // CVR > 5%:  10点
  // CVR > 2%:  5点
  let cvrScore = 0;
  if (metrics.cvr7d > 0.1) cvrScore = 15;
  else if (metrics.cvr7d > 0.05) cvrScore = 10;
  else if (metrics.cvr7d > 0.02) cvrScore = 5;
  score += cvrScore;
  breakdown.cvr = cvrScore;

  // ============================
  // ACOSボーナス（最大15点）
  // ============================
  // ACOS <= targetAcos * 0.5: 15点（非常に効率的）
  // ACOS <= targetAcos * 0.8: 10点
  // ACOS <= targetAcos:       5点
  let acosScore = 0;
  if (metrics.acos7d > 0) {
    if (metrics.acos7d <= targetAcos * 0.5) acosScore = 15;
    else if (metrics.acos7d <= targetAcos * 0.8) acosScore = 10;
    else if (metrics.acos7d <= targetAcos) acosScore = 5;
  }
  score += acosScore;
  breakdown.acos = acosScore;

  return { score, breakdown };
}
```

### 17.4 マッチタイプ推奨ロジック (suggestMatchType)

```typescript
// src/keywordDiscovery/engine.ts

function suggestMatchType(metrics: SearchTermMetrics): SuggestedMatchType {
  // 高CVR or 複数注文 → EXACT（最も厳密なマッチ）
  if (metrics.cvr7d > 0.1 || metrics.orders7d >= 3) {
    return "EXACT";
  }

  // 中程度CVR or 注文あり → PHRASE
  if (metrics.cvr7d > 0.05 || metrics.orders7d >= 1) {
    return "PHRASE";
  }

  // その他 → BROAD（広いマッチで探索）
  return "BROAD";
}
```

### 17.5 キーワード候補抽出フロー

```typescript
// src/keywordDiscovery/engine.ts

export async function discoverNewKeywordsFromSearchTerms(
  searchTerms: SearchTermReportRow[],
  existingKeywords: ExistingKeyword[],
  productConfigs: Map<string, ProductConfigForDiscovery>,
  config: KeywordDiscoveryConfig
): Promise<CandidateKeyword[]> {
  const candidates: CandidateKeyword[] = [];

  // 既存キーワードをSetに変換（重複チェック用）
  const existingSet = new Set(
    existingKeywords.map((k) => `${k.asin}:${normalizeKeyword(k.keyword)}`)
  );

  for (const term of searchTerms) {
    // 1. 正規化
    const normalizedQuery = normalizeKeyword(term.query);

    // 2. 既存キーワードとの重複チェック
    const key = `${term.asin}:${normalizedQuery}`;
    if (existingSet.has(key)) continue;

    // 3. 商品設定を取得
    const productConfig = productConfigs.get(term.asin);
    if (!productConfig) continue;

    // 4. 除外パターンチェック
    if (shouldExclude(normalizedQuery, config)) continue;

    // 5. 最低閾値チェック
    if (term.clicks < config.minClicks) continue;
    if (term.impressions < config.minImpressions) continue;

    // 6. メトリクス構築
    const metrics: SearchTermMetrics = {
      impressions7d: term.impressions,
      clicks7d: term.clicks,
      orders7d: term.orders,
      sales7d: term.sales,
      spend7d: term.spend,
      acos7d: term.spend > 0 ? term.spend / term.sales : 0,
      cvr7d: term.clicks > 0 ? term.orders / term.clicks : 0,
    };

    // 7. スコア計算
    const targetAcos = productConfig.target_acos ?? DEFAULT_TARGET_ACOS;
    const { score, breakdown } = calculateSearchTermScore(metrics, targetAcos);

    // 8. 最低スコアチェック
    if (score < config.minScore) continue;

    // 9. マッチタイプ推奨
    const suggestedMatchType = suggestMatchType(metrics);

    // 10. 候補オブジェクト生成
    candidates.push({
      profileId: term.profile_id,
      asin: term.asin,
      query: normalizedQuery,
      source: "SEARCH_TERM",
      state: "PENDING_REVIEW",
      score,
      scoreBreakdown: breakdown,
      suggestedMatchType,
      searchTermMetrics: metrics,
      jungleScoutMetrics: null,
      discoveredAt: new Date(),
      reviewedAt: null,
      reviewerNotes: null,
    });
  }

  return candidates;
}
```

### 17.6 キーワード正規化 (normalizeKeyword)

```typescript
// src/keywordDiscovery/engine.ts

export function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()           // 小文字化
    .trim()                  // 前後空白除去
    .replace(/\s+/g, " ");   // 連続空白を単一空白に
}
```

### 17.7 設定パラメータ

```typescript
// src/keywordDiscovery/types.ts

export interface KeywordDiscoveryConfig {
  // スコア閾値
  minScore: number;           // 採用最低スコア (default: 20)
  minClicks: number;          // 最低クリック数 (default: 2)
  minImpressions: number;     // 最低インプレッション (default: 100)
  maxAcos: number;            // 最大ACOS (default: 1.0)

  // Phase 2: Jungle Scout統合
  enableJungleScout: boolean; // JS統合有効化 (default: false)
  minSearchVolume: number;    // JS最低検索ボリューム (default: 100)
  maxCompetitiveDensity: number; // JS最大競合度 (default: 0.8)

  // 除外設定
  excludePatterns: string[];  // 除外パターン（正規表現）
  minWordCount: number;       // 最小単語数 (default: 1)
  maxWordCount: number;       // 最大単語数 (default: 10)
}

export const DEFAULT_KEYWORD_DISCOVERY_CONFIG: KeywordDiscoveryConfig = {
  minScore: 20,
  minClicks: 2,
  minImpressions: 100,
  maxAcos: 1.0,
  enableJungleScout: false,
  minSearchVolume: 100,
  maxCompetitiveDensity: 0.8,
  excludePatterns: [],
  minWordCount: 1,
  maxWordCount: 10,
};
```

### 17.8 候補ステートマシン

```
┌─────────────────┐
│ PENDING_REVIEW  │  発見直後の初期状態
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌──────────┐
│APPROVED│ │ REJECTED │  人間によるレビュー結果
└───┬────┘ └──────────┘
    │
    ▼
┌─────────┐
│ APPLIED │  キャンペーンに追加完了
└─────────┘
```

### 17.9 統計情報 (KeywordDiscoveryStats)

```typescript
// src/keywordDiscovery/types.ts

export interface KeywordDiscoveryStats {
  totalAsinsProcessed: number;      // 処理したASIN数
  totalSearchTermsProcessed: number; // 処理した検索語数
  duplicatesExcluded: number;       // 既存キーワードとの重複で除外
  belowThresholdExcluded: number;   // 閾値未満で除外
  searchTermCandidates: number;     // 検索語から抽出した候補数
  jungleScoutCandidates: number;    // JSから抽出した候補数（Phase 2）
  finalCandidates: number;          // 最終候補数
  processingTimeMs: number;         // 処理時間（ミリ秒）
}
```

### 17.10 BigQueryスキーマ

```sql
-- src/bigquery/schemas/keyword_discovery_candidates.sql

CREATE TABLE IF NOT EXISTS `{project}.{dataset}.keyword_discovery_candidates` (
  profile_id STRING NOT NULL,
  asin STRING NOT NULL,
  query STRING NOT NULL,
  source STRING NOT NULL,           -- SEARCH_TERM | JUNGLE_SCOUT | BOTH
  state STRING NOT NULL,            -- PENDING_REVIEW | APPROVED | REJECTED | APPLIED
  score FLOAT64 NOT NULL,
  score_breakdown JSON,
  suggested_match_type STRING,      -- EXACT | PHRASE | BROAD
  search_term_metrics JSON,
  jungle_scout_metrics JSON,
  discovered_at TIMESTAMP NOT NULL,
  reviewed_at TIMESTAMP,
  reviewer_notes STRING,
  updated_at TIMESTAMP NOT NULL
);

-- 重複防止用ユニーク制約（BigQueryではクエリ時に対応）
-- PRIMARY KEY (profile_id, asin, query)
```

---

## 関連ファイル

- [src/engine/bidEngine.ts](../src/engine/bidEngine.ts) - メイン処理
- [src/ltv/ltv-calculator.ts](../src/ltv/ltv-calculator.ts) - ACOS計算
- [src/lifecycle/bid-integration.ts](../src/lifecycle/bid-integration.ts) - アクション決定
- [src/logging/types.ts](../src/logging/types.ts) - ReasonCode定義
- [src/config/productConfigLoader.ts](../src/config/productConfigLoader.ts) - 設定読込
- [src/negative-keywords/types.ts](../src/negative-keywords/types.ts) - ネガティブキーワード型定義
- [src/keywordDiscovery/engine.ts](../src/keywordDiscovery/engine.ts) - キーワード発見エンジン
- [src/keywordDiscovery/repository.ts](../src/keywordDiscovery/repository.ts) - BigQueryリポジトリ
- [src/keywordDiscovery/httpHandler.ts](../src/keywordDiscovery/httpHandler.ts) - HTTPハンドラー
- [src/negative-keywords/negative-keyword-calculator.ts](../src/negative-keywords/negative-keyword-calculator.ts) - ネガティブキーワード計算
- [src/guardrails/auto-guardrails.ts](../src/guardrails/auto-guardrails.ts) - 自動ガードレール計算
- [src/ltv/types.ts](../src/ltv/types.ts) - ガードレール型定義
- [src/auto-exact/types.ts](../src/auto-exact/types.ts) - AUTO→EXACT昇格エンジン型定義
- [src/auto-exact/auto-exact-promotion-engine.ts](../src/auto-exact/auto-exact-promotion-engine.ts) - AUTO→EXACT昇格エンジン計算
- [src/auto-exact/auto-exact-promotion-job.ts](../src/auto-exact/auto-exact-promotion-job.ts) - AUTO→EXACT昇格ジョブ
- [src/slack/executionSummaryNotifier.ts](../src/slack/executionSummaryNotifier.ts) - Slack実行サマリー通知
- [src/slack/index.ts](../src/slack/index.ts) - Slackモジュールエクスポート
- [src/event/types.ts](../src/event/types.ts) - イベントオーバーライド型定義
- [src/event/index.ts](../src/event/index.ts) - イベントモジュールエクスポート
- [src/apply/types.ts](../src/apply/types.ts) - APPLY安全設計型定義
- [src/apply/apply-filter.ts](../src/apply/apply-filter.ts) - APPLYフィルタリングロジック
- [src/apply/apply-config.ts](../src/apply/apply-config.ts) - APPLY設定ローダー
- [src/placement/types.ts](../src/placement/types.ts) - 掲載位置最適化型定義
- [src/placement/placement-calculator.ts](../src/placement/placement-calculator.ts) - 掲載位置推奨計算
- [src/placement/placement-engine.ts](../src/placement/placement-engine.ts) - 掲載位置エンジン
- [src/budget/types.ts](../src/budget/types.ts) - 日予算最適化型定義
- [src/budget/budget-calculator.ts](../src/budget/budget-calculator.ts) - 予算推奨計算
- [src/budget/budget-engine.ts](../src/budget/budget-engine.ts) - 予算エンジン
- [src/monitoring/types.ts](../src/monitoring/types.ts) - 監視・アラート型定義
- [src/monitoring/config.ts](../src/monitoring/config.ts) - アラート設定ローダー
- [src/monitoring/alertEvaluator.ts](../src/monitoring/alertEvaluator.ts) - 異常検出ロジック
- [src/monitoring/metricsCollector.ts](../src/monitoring/metricsCollector.ts) - BigQuery監視指標収集
- [src/monitoring/alertNotifier.ts](../src/monitoring/alertNotifier.ts) - Slackアラート通知
- [src/monitoring/index.ts](../src/monitoring/index.ts) - 監視モジュールエクスポート
- [src/bigquery/schemas/execution_health_summary.sql](../src/bigquery/schemas/execution_health_summary.sql) - 監視ビューDDL
- [src/strategies/pro-strategies.ts](../src/strategies/pro-strategies.ts) - プロ戦略ロジック（TACOSコントローラ、Revenue-Based Bid、Bidding Lifecycle等）
- [src/strategies/index.ts](../src/strategies/index.ts) - プロ戦略エクスポート

---

## 18. 商品レベル TACOS コントローラ

### 18.1 目的と位置付け

このセクションでは、商品単位の TACOS を一定レンジに保つための「商品レベル TACOS コントローラ」仕様を定義する。

#### 役割

1. キーワード単位の入札ロジックはこれまで通り ACOS や CVR などを見て決定する
2. 商品全体として TACOS が高すぎる、または低すぎる場合に、キーワード入札をまとめて増減させる
3. サプリメントのように LTV 前提で広告を打つ商品に対して、安全な TACOS レンジの中で攻め守りを調整する

このコントローラは「商品単位の補正係数 `productBidMultiplier` を計算し、各キーワードの推奨入札に掛ける」という形で既存ロジックに合流する。

#### 最終入札値のイメージ

```
finalBid = keywordBaseBid × productBidMultiplier × 既存のプロファイル別・モード別補正係数
```

`keywordBaseBid` は既存の入札ロジックで算出された値とする。

### 18.2 入力データ定義

#### 対象単位

商品（ASIN）ごとに過去30日分の集計データを持つ。

#### 集計値

**1. 売上・広告関連**

| 項目 | 説明 |
|------|------|
| `totalSales30d` | 過去30日の商品売上合計（広告経由売上と自然検索売上の合計値） |
| `adSales30d` | 過去30日の広告経由売上合計 |
| `adSpend30d` | 過去30日の広告費合計 |
| `organicSales30d` | `totalSales30d` から `adSales30d` を引いた値 |
| `organicSalesPrev30d` | 一つ前の30日間の自然検索売上合計（比較用に保持） |

**2. 利益関連（商品マスタから取得）**

| 項目 | 説明 |
|------|------|
| `marginRateNormal` | 平常時粗利率（0-1）。LTV計算とtargetTacosStageの算出に使用する。セールを除いた標準的な粗利率。 |
| `marginRateBlended` | セール込み実績粗利率（0-1）。実績の赤字判定やモニタリングに使用する。 |
| `marginRate` | 【非推奨】後方互換のため残存。新規実装では `marginRateNormal` を使用すること。 |
| `expectedRepeatOrdersAssumed` | 想定リピート回数（初回購入後に平均何回リピートするかの推定値、例: 1.8回など） |
| `ltvSafetyFactor` | LTV を保守的に見るための係数（標準レンジは0.6〜0.8程度） |

> **重要**: LTV・TACOS計算では必ず `marginRateNormal`（または `getMarginRateNormal()` ヘルパー関数）を使用する。`marginRateBlended` は実績モニタリング専用。

**3. 指標値**

| 項目 | 説明 |
|------|------|
| `tacos30d` | `adSpend30d ÷ totalSales30d`（totalSales30dが0または極端に小さい場合は未計算または上限値として扱う） |
| `organicGrowthRate` | 自然検索売上の成長率: `(organicSales30d − organicSalesPrev30d) ÷ max(organicSalesPrev30d, epsilon)`（epsilonは0割り防止用の小さな値） |

**4. ライフサイクル状態**

| 項目 | 説明 |
|------|------|
| `lifecycleStage` | 例: `LAUNCH_HARD`, `LAUNCH_SOFT`, `GROW`, `HARVEST` |
| `mode` | 通常日かセール日かを表す既存のモード（`NORMAL` か `S_MODE` など） |

### 18.3 ステージ別ターゲット TACOS の決め方

サプリメント前提で、許容できる TACOS をライフサイクル別に決める。

#### 1. 有効 LTV 倍率

有効 LTV 倍率 `ltvMultiplierStage` を次で定義する。

```
ltvMultiplierStage = 1 + expectedRepeatOrdersAssumed × stageCoefficient × ltvSafetyFactor
```

`stageCoefficient` はステージ別の攻め度合いを表す係数：

| ステージ | stageCoefficient |
|----------|------------------|
| LAUNCH_HARD | 1.0 |
| LAUNCH_SOFT | 0.8 |
| GROW | 0.5 |
| HARVEST | 0.2 |

#### 2. 目標最終利益率

ステージごとに「最終的に確保したい利益率 `targetProfitRateStage`」を設定する：

| ステージ | targetProfitRateStage |
|----------|----------------------|
| LAUNCH_HARD | 0% |
| LAUNCH_SOFT | 5% |
| GROW | 10% |
| HARVEST | 15% |

ここでの利益率は「全 LTV を回収し終わった時点での最終利益率」を指す。

#### 3. 理論上の TACOS 上限値

理屈は次の通りとする。

```
最終利益率 ≒ marginRateNormal × ltvMultiplierStage − TACOS
```

したがって、許容できる理論上の TACOS 上限値 `maxTacosStageRaw` は：

```
maxTacosStageRaw = marginRateNormal × ltvMultiplierStage − targetProfitRateStage
```

#### 4. 安全レンジへのクランプ

理論値が極端になり過ぎないよう、ステージごとに TACOS の安全レンジを設定し、その範囲に収める。

| ステージ | 最小 | 最大 |
|----------|------|------|
| LAUNCH_HARD | 0.25 | 0.55 |
| LAUNCH_SOFT | 0.20 | 0.45 |
| GROW | 0.15 | 0.35 |
| HARVEST | 0.10 | 0.25 |

最終的な `targetTacosStage` は：

```
targetTacosStage = clamp(maxTacosStageRaw, minTacosStage, maxTacosStage)
```

ここで `clamp` は、値が下限未満なら下限に、上限を超えたら上限に丸める関数とする。

### 18.4 商品レベル補正係数 productBidMultiplier の計算

このセクションでは、商品ごとの TACOS 状況と自然検索の成長率に応じて、入札の補正係数 `productBidMultiplier` を計算するルールを定義する。

#### 1. 偏差の計算

```
tacosDiff = tacos30d − targetTacosStage
tacosDiffRate = tacosDiff ÷ targetTacosStage
```

#### 2. 自然検索成長の評価

| 条件 | 説明 |
|------|------|
| `goodOrganicGrowth` | `organicGrowthRate` が10%以上のとき真 |
| `badOrganicGrowth` | `organicGrowthRate` が2%以下のとき真 |

閾値は後で調整可能とし、設定値として管理する。

#### 3. 補正ルール

`k1` と `k2` は調整用の係数で、初期値は0.5程度を想定する。

商品レベル補正係数 `productBidMultiplier` は次のルールで決定する。

**(a) 強い抑制ゾーン**

| 項目 | 内容 |
|------|------|
| 条件 | `tacos30d` が `targetTacosStage` の120%を超える、かつ `badOrganicGrowth` が真 |
| 挙動 | `productBidMultiplier` を0.6〜0.8の範囲で設定（初期値は0.7付近を想定） |
| 説明 | 商品全体として TACOS が高く、自然検索も伸びていないため、明確に守りに入るゾーン |

**(b) 軽い抑制ゾーン**

| 項目 | 内容 |
|------|------|
| 条件 | `tacos30d` が `targetTacosStage` の105%を超える、ただし強い抑制ゾーン条件は満たしていない |
| 挙動 | `productBidMultiplier = 1 − k1 × tacosDiffRate`（ただし下限0.8までとし、それ以下にはしない） |
| 説明 | TACOS がやや高めなので、緩やかに入札を下げていく |

**(c) 攻めゾーン**

| 項目 | 内容 |
|------|------|
| 条件 | `tacos30d` が `targetTacosStage` の80%未満、かつ `goodOrganicGrowth` が真 |
| 挙動 | `productBidMultiplier = 1 + k2 × abs(tacosDiffRate)`（ただし上限1.3までとする） |
| 説明 | TACOS はかなり低く、自然検索も伸びているため、安全に広告を強められるゾーン |

**(d) ニュートラルゾーン**

| 項目 | 内容 |
|------|------|
| 条件 | 上記いずれにも該当しない場合 |
| 挙動 | `productBidMultiplier = 1` |

#### 4. 補正の適用タイミング

`productBidMultiplier` は商品ごとに一度計算し、その値を同じ商品の全キーワードに適用する。

既存の入札提案ロジックで算出された `keywordBaseBid` に対して：

```
finalBid = keywordBaseBid × productBidMultiplier
```

として商品レベルの TACOS 制御を反映する。

### 18.5 実装上の注意点

#### 1. データ欠損時の扱い

`totalSales30d` が閾値未満、または観測期間が極端に短い商品の場合は、TACOS コントローラを無効化し、`productBidMultiplier` を常に 1 として扱う。

#### 2. サプリ以外の商品

`expectedRepeatOrdersAssumed` や `ltvSafetyFactor` が設定されていない商品は、`ltvMultiplierStage` を固定値 1 と見なし、単純に `marginRateNormal` と `targetProfitRateStage` から `targetTacosStage` を計算するなどのフォールバックを行う。

#### 3. 将来的な拡張

実測のリピート回数や定期継続回数が十分に蓄積された段階で、`expectedRepeatOrdersAssumed` を更新し、`targetTacosStage` を自動的に再計算することを想定する。

---

## 19. 商品プロファイル・新商品ロジック

### 19.1 粗利率の2種類管理

ProductConfig では、2種類の粗利率を管理する。

| 項目 | 用途 | 説明 |
|------|------|------|
| `marginRateNormal` | LTV・TACOS計算 | 平常時粗利率。セール時の値下げを除いた標準的な粗利率。 |
| `marginRateBlended` | モニタリング | セール込み実績粗利率。過去実績からの加重平均値。赤字判定等に使用。 |

ヘルパー関数:

```typescript
// marginRateNormal を安全に取得（フォールバック付き）
getMarginRateNormal(config: ProductConfig): number

// marginRateBlended を安全に取得（フォールバック付き）
getMarginRateBlended(config: ProductConfig): number
```

### 19.2 商品プロファイルタイプ

商品特性に応じたプリセットプロファイルを提供する。

| プロファイル | 説明 | marginRateNormalDefault | expectedRepeatOrders | ltvSafetyFactor |
|--------------|------|-------------------------|----------------------|-----------------|
| `SUPPLEMENT_HIGH_LTV` | カカオPS系サプリ向け高粗利・高LTVプロファイル | 0.55 | 1.7 | 0.7 |
| `SUPPLEMENT_STANDARD` | 一般的なサプリメント向けプロファイル | 0.40 | 1.3 | 0.6 |
| `SINGLE_PURCHASE` | 単発購入商品向けプロファイル | 0.30 | 1.0 | 1.0 |
| `DEFAULT` | デフォルトプロファイル | 0.30 | 1.0 | 0.8 |

#### SUPPLEMENT_HIGH_LTV プロファイル詳細

カカオPS系サプリメント向けの高LTVプロファイル。

```typescript
SUPPLEMENT_HIGH_LTV_PROFILE = {
  type: "SUPPLEMENT_HIGH_LTV",
  description: "カカオPS系サプリ向け高粗利・高LTVプロファイル",
  marginRateNormalDefault: 0.55,
  expectedRepeatOrdersAssumed: 1.7,
  ltvSafetyFactor: 0.7,
  tacosConfig: {
    LAUNCH_HARD: { minTacos: 0.25, maxTacos: 0.40 },
    LAUNCH_SOFT: { minTacos: 0.22, maxTacos: 0.38 },
    GROW: { minTacos: 0.20, maxTacos: 0.35 },
    HARVEST: { minTacos: 0.10, maxTacos: 0.20 },
  },
};
```

### 19.3 新商品（NEW_PRODUCT）ロジック

データ不足の新商品に対して、保守的な入札制約を適用する。

#### 新商品判定条件

以下の**すべて**を満たす場合、新商品として扱う：

| 条件 | 閾値 | 説明 |
|------|------|------|
| `daysSinceFirstImpression` | < 30日 | 初回インプレッションからの経過日数 |
| `clicks30d` | < 100クリック | 過去30日のクリック数 |
| `orders30d` | < 20件 | 過去30日の注文数 |

```typescript
function isNewProduct(config: ProductConfig): boolean {
  if (config.isNewProduct !== undefined) return config.isNewProduct;

  const days = config.daysSinceFirstImpression ?? 0;
  const clicks = config.clicks30d ?? 0;
  const orders = config.orders30d ?? 0;

  return (
    days < NEW_PRODUCT_THRESHOLDS.MIN_DAYS_SINCE_FIRST_IMPRESSION &&
    clicks < NEW_PRODUCT_THRESHOLDS.MIN_CLICKS_30D &&
    orders < NEW_PRODUCT_THRESHOLDS.MIN_ORDERS_30D
  );
}
```

#### 新商品の入札制約

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| `MAX_BID_CHANGE_RATE` | 15% | 1回の入札変更幅の上限 |
| `MIN_PRODUCT_BID_MULTIPLIER` | 0.9 | productBidMultiplier の下限 |
| `MAX_PRODUCT_BID_MULTIPLIER` | 1.1 | productBidMultiplier の上限 |
| `DEFAULT_LTV_SAFETY_FACTOR` | 0.5 | LTV安全係数のデフォルト（保守的） |

#### 新商品からの昇格条件

以下の**いずれか**を満たす場合、通常商品に昇格する：

```typescript
function canPromoteFromNewProduct(
  daysSinceFirstImpression: number | undefined | null,
  clicks30d: number | undefined | null,
  orders30d: number | undefined | null
): boolean {
  // すべての閾値を満たせば昇格可能
  return (
    daysSinceFirstImpression >= NEW_PRODUCT_THRESHOLDS.MIN_DAYS_SINCE_FIRST_IMPRESSION &&
    clicks30d >= NEW_PRODUCT_THRESHOLDS.MIN_CLICKS_30D &&
    orders30d >= NEW_PRODUCT_THRESHOLDS.MIN_ORDERS_30D
  );
}
```

### 19.4 昇格時のパラメータ再推計

昇格条件を満たした時点で、直近90日間の実績データを用いてパラメータを再推計し、カテゴリ標準値から商品固有値へ更新する。

#### 再推計に必要な実績データ

| フィールド | 説明 |
|-----------|------|
| `totalSales90d` | 直近90日の総売上（広告経由+オーガニック） |
| `adSales90d` | 直近90日の広告売上 |
| `adSpend90d` | 直近90日の広告費 |
| `clicks90d` | 直近90日のクリック数 |
| `orders90d` | 直近90日の注文数 |
| `impressions90d` | 直近90日のインプレッション数 |
| `newCustomers90d` | 直近90日の新規顧客数 |
| `repeatOrders90d` | 直近90日のリピート注文数 |

#### 再推計ロジック

**1. リピート回数の推計**

```typescript
// MEASURED判定: 十分なデータがある場合
if (newCustomers90d >= 30 && repeatOrders90d >= 50) {
  expectedRepeatOrders = 1 + (repeatOrders90d / newCustomers90d);
  estimationBasis = "MEASURED";
}
// EARLY_ESTIMATE判定: 限定的なデータ
else if (newCustomers90d >= 10 && repeatOrders90d > 0) {
  repeatRate = repeatOrders90d / newCustomers90d;
  expectedRepeatOrders = 1 + repeatRate * 0.8;  // 保守的に20%割引
  estimationBasis = "EARLY_ESTIMATE";
}
// データ不足: カテゴリ標準値を維持
else {
  expectedRepeatOrders = カテゴリ標準値;
  estimationBasis = "EARLY_ESTIMATE";
}
```

**2. LTV安全係数の推計**

| 条件 | 安全係数 |
|------|----------|
| MEASURED（十分なデータ） | 0.8 |
| EARLY_ESTIMATE（ある程度のデータ: newCustomers >= 20） | 0.7 |
| データ不足 | 0.6 |

**3. 信頼度計算**

```typescript
clicksConfidence = min(clicks90d / 500, 1);
ordersConfidence = min(orders90d / 100, 1);
customersConfidence = min(newCustomers90d / 50, 1);
confidence = (clicksConfidence + ordersConfidence + customersConfidence) / 3;
```

#### 更新ルール

| 条件 | 更新内容 |
|------|----------|
| 信頼度 >= 0.5 | `expectedRepeatOrdersAssumed`, `safetyFactorAssumed` を推計値で更新 |
| estimationBasis = MEASURED | `expectedRepeatOrdersMeasured`, `safetyFactorMeasured` も設定 |
| 信頼度 < 0.5 | カテゴリ標準値を維持（推計値での更新なし） |

#### 昇格処理フロー

```
1. 昇格条件チェック（canPromoteFromNewProduct）
   ↓ 昇格可能
2. 直近90日の実績データを取得
   ↓
3. パラメータ再推計（reestimateParameters）
   - CVR、CTR、ACOS、TACOS を計算
   - リピート回数を推計
   - LTV安全係数を決定
   - 信頼度を計算
   ↓
4. 昇格実行（executePromotion）
   - isNewProduct = false
   - ltvMode = EARLY_ESTIMATE または MEASURED
   - 信頼度が高ければ推計値でパラメータ更新
   ↓
5. ProductConfig を永続化
```

### 19.5 関連ファイル

- [src/config/productConfigTypes.ts](../src/config/productConfigTypes.ts) - ProductConfig型定義、プロファイル定義、ヘルパー関数

---

## 20. LTV期待粗利・累積赤字管理

### 20.1 LTV期待粗利の計算

商品のLTV期待粗利は、初回購入から将来のリピート購入までを考慮した期待総粗利益を表す。

```typescript
expectedLtvGrossProfit = price × marginRateNormal × (1 + expectedRepeatOrdersAssumed)
```

| パラメータ | 説明 |
|-----------|------|
| `price` | 商品単価（円） |
| `marginRateNormal` | 平常時粗利率（0-1） |
| `expectedRepeatOrdersAssumed` | 想定リピート回数 |

#### NEW_PRODUCT期間中の計算

NEW_PRODUCT期間中は、実測データがないため、プロファイルの事前期待値（prior値）を使用する。

```typescript
// NEW_PRODUCT期間中
expectedRepeatOrders = profile.expectedRepeatOrdersPrior;

// 昇格後
expectedRepeatOrders = config.expectedRepeatOrdersAssumed;
```

### 20.2 商品別累積赤字上限

商品ごとの累積赤字上限は、LTV期待粗利に赤字許容倍率を乗じて計算する。

```typescript
productCumulativeLossLimit = expectedLtvGrossProfit × lossBudgetMultiple
```

#### 赤字許容倍率（lossBudgetMultiple）

| 期間 | 使用する倍率 | 説明 |
|------|-------------|------|
| NEW_PRODUCT期間 | `lossBudgetMultipleInitial` | 初期投資として許容する累積赤字の割合 |
| 昇格後 | `lossBudgetMultipleMature` | 成熟期に許容する累積赤字の割合 |

#### プロファイル別の設定値

| プロファイル | Initial | Mature | 説明 |
|-------------|---------|--------|------|
| SUPPLEMENT_HIGH_LTV | 0.6 | 0.4 | 高LTV期待のため初期投資を許容 |
| SUPPLEMENT_STANDARD | 0.4 | 0.25 | 標準的な許容範囲 |
| SINGLE_PURCHASE | 0.2 | 0.1 | リピートなしのため保守的 |
| DEFAULT | 0.3 | 0.2 | デフォルト設定 |

### 20.3 グローバル累積赤字上限

全商品の累積赤字合計に対するグローバル上限を設定する。

```typescript
globalCumulativeLossLimit = 全商品のexpectedLtvGrossProfit合計 × globalLossBudgetRate
```

デフォルトの `globalLossBudgetRate` は 0.15（15%）。

### 20.4 連続赤字月数管理

ライフサイクルステートに応じて、許容する連続赤字月数を設定する。

#### SUPPLEMENT_HIGH_LTV_PROFILE の例

| ライフサイクル | maxConsecutiveLossMonths |
|---------------|--------------------------|
| LAUNCH_HARD | 6ヶ月 |
| LAUNCH_SOFT | 4ヶ月 |
| GROW | 3ヶ月 |
| HARVEST | 1ヶ月 |

### 20.5 リスク評価

```typescript
interface RiskAssessment {
  isOverCumulativeLoss: boolean;      // 累積赤字上限超過
  isOverConsecutiveLossMonths: boolean; // 連続赤字月数上限超過
  isAtRisk: boolean;                  // いずれかのリスク条件に該当
  cumulativeLossRatio: number;        // 累積赤字の上限に対する割合
  consecutiveLossMonthsRatio: number; // 連続赤字月数の上限に対する割合
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}
```

#### リスクレベル判定

| レベル | 条件 |
|--------|------|
| CRITICAL | 累積赤字超過 OR 連続赤字月数超過 |
| HIGH | いずれかの比率 >= 80% |
| MEDIUM | いずれかの比率 >= 50% |
| LOW | 上記以外 |

---

## 21. 激戦度判定・自動プロファイル割り当て

### 21.1 競合データ（CompetitionData）

Jungle Scout等の外部ツールから取得する競合情報。

| フィールド | 説明 |
|-----------|------|
| `strongCompetitorCount` | 強い競合数（月売上100万円以上かつ評価4.0以上） |
| `medianCpcToPriceRatio` | 中央CPC対価格比 = カテゴリ中央CPC / 自社商品価格 |
| `bigBrandShare` | 大手ブランドシェア（上位10商品中の大手ブランド売上シェア） |

### 21.2 激戦度スコア計算

以下の3条件をスコア化（0-3）：

| 条件 | 閾値 | スコア加算 |
|------|------|-----------|
| `strongCompetitorCount` >= 15 | 15社以上 | +1 |
| `medianCpcToPriceRatio` >= 0.05 | CPC比5%以上 | +1 |
| `bigBrandShare` >= 0.5 | 大手シェア50%以上 | +1 |

### 21.3 スコアに基づくプロファイル推奨

| スコア | 推奨プロファイル | 説明 |
|--------|------------------|------|
| 0-1 | SUPPLEMENT_HIGH_LTV | 低激戦度、高リピート期待可能 |
| 2 | SUPPLEMENT_STANDARD | 中激戦度、標準的な設定 |
| 3 | SUPPLEMENT_STANDARD | 超激戦度、保守的な設定 |

※ `revenueModel` が SINGLE_PURCHASE の場合は常に SINGLE_PURCHASE プロファイル。

### 21.4 自動割り当て結果

```typescript
interface ProfileAssignmentResult {
  profileType: ProductProfileType;          // 割り当てプロファイル
  competitionIntensityScore: 0 | 1 | 2 | 3; // 激戦度スコア
  assignmentMethod: "AUTO" | "MANUAL";      // 割り当て方法
  reason: string;                           // 割り当て理由
  assignedAt: Date;                         // 割り当て日時
}
```

---

## 22. 成長判定条件（isGrowingCandidate）

### 22.1 成長評価データ（GrowthAssessmentData）

| フィールド | 説明 |
|-----------|------|
| `organicGrowthRate` | オーガニック売上の前月比成長率 |
| `productRating` | 自社商品の評価（1-5） |
| `competitorMedianRating` | 競合商品の評価中央値 |
| `organicToAdSalesRatio` | 広告売上に対するオーガニック売上の比率 |
| `adDependencyRatio` | 広告依存度（広告売上 / 総売上） |
| `bsrTrend` | BSRトレンド方向（-1: 悪化, 0: 横ばい, 1: 改善） |

### 22.2 成長条件の判定

#### conditionOrganicGrowing（オーガニック成長）

```typescript
organicGrowthRate >= 0.05  // +5%以上で成長中
```

#### conditionRatingHealthy（評価健全性）

```typescript
productRating >= 3.8 AND (productRating - competitorMedianRating) >= -0.3
```

- 自社評価が3.8以上
- 競合との評価差が-0.3以内（競合より大幅に劣っていない）

#### conditionAdsToOrganic（広告→オーガニック転換）

```typescript
organicToAdSalesRatio >= 0.8 AND adDependencyRatio <= 0.7
```

- オーガニック売上が広告売上の80%以上
- 広告依存度が70%以下

### 22.3 成長候補判定

```typescript
isGrowingCandidate = conditionOrganicGrowing AND conditionRatingHealthy AND conditionAdsToOrganic
```

すべての条件を満たす場合のみ成長候補とみなす。

### 22.4 成長スコアと推奨ライフサイクル

#### 成長スコア（0-100）

- オーガニック成長: 最大40点
- 評価健全性: 最大30点
- 広告→オーガニック転換: 最大30点
- BSRトレンドボーナス: 最大10点（上限100点にクランプ）

#### スコアに基づく推奨ライフサイクル

| スコア | 推奨ステート |
|--------|--------------|
| >= 80 | LAUNCH_HARD / LAUNCH_SOFT を維持 |
| >= 60 | GROW |
| >= 40 | 現状維持 |
| < 40 | HARVEST |

### 22.5 閾値定数

```typescript
GROWTH_THRESHOLDS = {
  MIN_ORGANIC_GROWTH_RATE: 0.05,    // 成長判定の最小成長率
  HIGH_ORGANIC_GROWTH_RATE: 0.20,   // 急成長判定の成長率
  MIN_HEALTHY_RATING: 3.8,          // 健全評価の最小値
  MIN_RATING_ADVANTAGE: -0.3,       // 競合差の許容範囲
  MIN_ORGANIC_TO_AD_RATIO: 0.8,     // オーガニック比率の最小値
  MAX_AD_DEPENDENCY_RATIO: 0.7,     // 広告依存度の最大値
  MIN_REVIEW_COUNT: 10,             // 信頼性判定用の最小レビュー数
}
```

---

## 23. 理論最大TACOS（theoreticalMaxTacos）

### 23.1 概要

LTVベースの「広告費として投じてよい上限」をTACOS形式で表現したもの。
理論上、この値までの広告費投下は顧客獲得コストとしてLTV的にペイする。

### 23.2 計算式

```typescript
// 顧客一人当たり最大広告費
maxAdSpendPerUser = expectedLtvGrossProfit × ltvSafetyFactor
                  = price × marginRateNormal × (1 + expectedRepeatOrders) × ltvSafetyFactor

// 理論最大TACOS
theoreticalMaxTacos = marginRateNormal × (1 + expectedRepeatOrders) × ltvSafetyFactor

// グローバルキャップ適用
theoreticalMaxTacosCapped = min(theoreticalMaxTacos, tmaxCapGlobal)
```

### 23.3 計算例

```
SUPPLEMENT_HIGH_LTV の場合:
- marginRateNormal = 0.55
- expectedRepeatOrders = 1.7
- ltvSafetyFactor = 0.7

theoreticalMaxTacos = 0.55 × (1 + 1.7) × 0.7
                    = 0.55 × 2.7 × 0.7
                    = 1.0395 (103.95%)

→ tmaxCapGlobal = 0.7 でキャップ
→ theoreticalMaxTacosCapped = 0.7 (70%)
```

### 23.4 グローバルリスク設定

```typescript
GLOBAL_RISK_CONFIG_DEFAULTS = {
  globalLossBudgetRate: 0.15,  // 累積赤字上限率
  tmaxCapGlobal: 0.7,          // 理論最大TACOSの上限
}
```

---

## 24. TACOSターゲットレンジとゾーン定義

### 24.1 概要

TACOSを3つのゾーン（GREEN/ORANGE/RED）に分類し、ゾーンに応じた制御を行う。

### 24.2 ゾーン定義

```typescript
type TacosZone = "GREEN" | "ORANGE" | "RED";

// tacosMax = theoreticalMaxTacosCapped
// tacosTargetMid = tacosMax × midFactor

if (currentTacos <= tacosTargetMid) → GREEN   // 健全
else if (currentTacos <= tacosMax)  → ORANGE  // 注意
else                                → RED     // 危険
```

### 24.3 TACOS乖離率

```typescript
tacosDelta = (tacosTargetMid - currentTacos) / max(tacosTargetMid, epsilon)

// 正の値 = 余裕あり（GREENゾーン方向）
// 負の値 = 超過（ORANGE/REDゾーン方向）
```

### 24.4 ステージ別制御パラメータ

```typescript
interface StageTacosControlParams {
  midFactor: number;          // tacosTargetMid = tacosMax × midFactor
  tacosAcuity: number;        // TACOS乖離に対する感度
  tacosPenaltyFactorRed: number; // REDゾーンペナルティ係数
  stageAcosMin: number;       // ステージ別ACOS下限
  stageAcosMax: number;       // ステージ別ACOS上限
}
```

### 24.5 プロファイル別・ステージ別パラメータ例

| プロファイル | ステージ | midFactor | tacosAcuity | stageAcosMax |
|-------------|---------|-----------|-------------|--------------|
| SUPPLEMENT_HIGH_LTV | LAUNCH_HARD | 0.70 | 0.8 | 0.80 |
| SUPPLEMENT_HIGH_LTV | GROW | 0.75 | 1.0 | 0.60 |
| SUPPLEMENT_HIGH_LTV | HARVEST | 0.80 | 1.2 | 0.40 |
| SINGLE_PURCHASE | GROW | 0.70 | 1.2 | 0.35 |

---

## 25. TACOS乖離によるtargetAcos調整

### 25.1 概要

TACOSの乖離状況に応じてtargetAcosを動的に調整し、TACOS超過を防ぐ。

### 25.2 計算式

```typescript
// 調整係数
adjustmentFactor = 1 + tacosAcuity × tacosDelta

// 生のtargetAcos
rawTargetAcos = baseLtvAcos × adjustmentFactor

// クランプ
targetAcos = clamp(rawTargetAcos, stageAcosMin, stageAcosMax)

// REDゾーンペナルティ
if (tacosZone === "RED") {
  penaltyLimit = tacosMax × tacosPenaltyFactorRed
  targetAcos = min(targetAcos, penaltyLimit)
}
```

### 25.3 計算例

```
GREENゾーンの場合（余裕あり）:
- baseLtvAcos = 0.50
- tacosDelta = +0.43 (tacosTargetMid=0.525, currentTacos=0.30)
- tacosAcuity = 1.0

adjustmentFactor = 1 + 1.0 × 0.43 = 1.43
rawTargetAcos = 0.50 × 1.43 = 0.715
→ stageAcosMax=0.60でクランプ → targetAcos = 0.60
```

```
ORANGEゾーンの場合（超過気味）:
- baseLtvAcos = 0.50
- tacosDelta = -0.14 (tacosTargetMid=0.525, currentTacos=0.60)
- tacosAcuity = 1.0

adjustmentFactor = 1 + 1.0 × (-0.14) = 0.86
rawTargetAcos = 0.50 × 0.86 = 0.43
→ targetAcos = 0.43（引き締め方向に調整）
```

---

## 26. ライフサイクルとTACOSゾーンの連動

### 26.1 概要

ライフサイクルステートごとにTACOSゾーンの許容度が異なり、ゾーン状況に応じてライフサイクル移行や入札制御を行う。

### 26.2 ライフサイクル別TACOSゾーン許容設定

| ステート | ORANGE許容 | RED許容 | ORANGE許容月数 | RED許容月数(成長候補) |
|----------|-----------|---------|----------------|----------------------|
| LAUNCH_HARD | ○ | ○ | 3 | 2 |
| LAUNCH_SOFT | ○ | × | 2 | 1 |
| GROW | ○(一時的) | × | 1 | 0 |
| HARVEST | × | × | 0 | 0 |

### 26.3 判定ロジック

#### LAUNCH_HARD

```typescript
if (tacosZone === "GREEN") {
  // 継続
} else if (tacosZone === "ORANGE") {
  if (orangeZoneMonths <= 3) {
    // 許容範囲内
  } else {
    // targetAcos引き締め、LAUNCH_SOFT移行推奨
  }
} else if (tacosZone === "RED") {
  if (isGrowingCandidate && redZoneMonths <= 2) {
    // 成長候補のため許容、ただしtargetAcos引き締め
  } else {
    // 即座にLAUNCH_SOFT移行
  }
}
```

#### HARVEST

```typescript
if (tacosZone === "GREEN") {
  // 継続
} else if (tacosZone === "ORANGE") {
  // 入札削減推奨
} else if (tacosZone === "RED") {
  // 入札停止フラグ推奨
}
```

### 26.4 入札制御アクション

```typescript
interface BidControlAction {
  bidMultiplierAdjustment: number;  // 1.0 = 変更なし, < 1.0 = 削減
  stopBidding: boolean;             // 入札停止フラグ
  targetAcosAdjustment: number;     // < 1.0 = 引き締め
  reason: string;
}

// 例: REDゾーンでの入札削減
bidMultiplierAdjustment = 0.8  // 20%削減

// 例: TACOS超過時のtargetAcos引き締め
targetAcosAdjustment = 1 - min(abs(tacosDelta) × 0.5, 0.2)  // 最大20%引き締め
```

### 26.5 TacosControlContext

```typescript
interface TacosControlContext {
  tacosMax: number;           // 理論最大TACOS（キャップ後）
  tacosTargetMid: number;     // TACOSターゲット中央値
  currentTacos: number;       // 現在のTACOS
  tacosZone: TacosZone;       // 現在のゾーン
  tacosDelta: number;         // 乖離率
  controlParams: StageTacosControlParams;
  isGrowingCandidate?: boolean;
  orangeZoneMonths?: number;
  redZoneMonths?: number;
}
```

このコンテキストをライフサイクル判定やtargetAcos計算に渡すことで、一貫したTACOS制御が実現される。

---

## 27. SEO目標順位ロジック

「TACOS × LTV × ライフサイクル」制御に、SEO観点の目標順位（オーガニック順位）を組み込むロジック。

### 27.1 RankTargetConfig

```typescript
// src/seo/seo-rank-target.types.ts

/**
 * SEO目標順位設定
 *
 * キーワードクラスタ単位で、理想順位と実用目標順位を管理
 */
interface RankTargetConfig {
  /** 理想順位（原則常に1 = 1位を目指す） */
  idealRank: number;

  /** 実用目標順位（データに基づき下げることがある） */
  targetRank: number;

  /** 許容範囲（例: targetRank=3, rankTolerance=2 → 1〜5位が許容範囲） */
  rankTolerance: number;
}
```

#### 各フィールドの意味

| フィールド | 説明 | デフォルト値 |
|-----------|------|-------------|
| `idealRank` | 理想順位。原則として常に1（1位を目指す）。ツールが自動で変更しない | 1 |
| `targetRank` | 実用目標順位。初期値は`idealRank`と同じ。競合状況やコスト対効果を見て人間が下げる判断をする | 1 |
| `rankTolerance` | 順位許容幅。`targetRank ± rankTolerance`の範囲を許容範囲とする | 2 |

#### idealRankとtargetRankの関係

```
idealRank = 1（常に1位を目指す、変更不可）
    ↓
データ収集・競合分析
    ↓
targetRank = 1（初期値、idealRankと同じ）
    ↓
[条件を満たす場合]
RankAdjustmentSuggestion を出力
（「この商品/クラスタは1位を目指すのは無理筋」と提案）
    ↓
[人間が承認した場合のみ]
targetRank = 3（例: 3位を目標に変更）
```

### 27.2 SeoProgressMetrics

```typescript
/**
 * SEO進捗メトリクス
 */
interface SeoProgressMetrics {
  /** クラスタID */
  clusterId: string;

  /** 商品ID */
  productId: string;

  /** 現在のオーガニック順位 */
  organicRank: number;

  /** Share of Voice（SOV）- 0〜1の範囲 */
  sov: number;

  /** 目標順位 */
  targetRank: number;

  /** 順位許容範囲 */
  rankTolerance: number;

  /** SEO進捗スコア（0〜1.5の範囲） */
  seoProgressScore: number;

  /** 順位スコア成分 */
  rankScoreComponent: number;

  /** SOVスコア成分 */
  sovScoreComponent: number;

  /** 計算日時 */
  calculatedAt: Date;
}
```

### 27.3 seoProgressScore計算

SEO進捗スコアは、順位とSOVの2つの成分から計算される。

#### 数式

```
seoProgressScore = rankWeight × rankScoreComponent + sovWeight × sovScoreComponent
```

#### 各成分の計算

**rankScoreComponent（順位スコア）**:
```typescript
rankScoreComponent = (targetRank + rankTolerance - organicRank) / max(targetRank, 1)

// 範囲: 0〜1.5にクリップ
// 解釈:
// - organicRank = targetRank → スコア = rankTolerance / targetRank
// - organicRank < targetRank → スコア > rankTolerance / targetRank（目標より良い）
// - organicRank > targetRank + rankTolerance → スコア ≤ 0（許容範囲外）
```

**sovScoreComponent（SOVスコア）**:
```typescript
// SOV閾値
sovThresholdLow = 0.05   // 5%未満は低い
sovThresholdHigh = 0.20  // 20%以上は高い

// 計算
if (sov < sovThresholdLow) {
  sovScoreComponent = sov / sovThresholdLow  // 0〜1の範囲
} else if (sov >= sovThresholdHigh) {
  sovScoreComponent = 1.5  // 高SOV（最大値）
} else {
  // 線形補間
  sovScoreComponent = 1 + 0.5 × (sov - sovThresholdLow) / (sovThresholdHigh - sovThresholdLow)
}
```

#### デフォルトの重み

```typescript
rankWeight = 0.6  // 順位の重み
sovWeight = 0.4   // SOVの重み
```

#### 解釈ガイド

| seoProgressScore | 解釈 |
|------------------|------|
| 0.0 〜 0.3 | 低い：SEO順位獲得が進んでいない |
| 0.3 〜 0.7 | 中程度：進捗はあるが目標未達 |
| 0.7 〜 1.0 | 良好：目標に近づいている |
| 1.0 〜 1.5 | 優秀：目標達成または超過 |

### 27.4 RankAdjustmentSuggestion

targetRankを下げる提案を出力する構造体。**ツールは自動でtargetRankを変更しない**。人間の承認を必要とする。

```typescript
/**
 * 順位目標調整提案
 */
interface RankAdjustmentSuggestion {
  /** 商品ID */
  productId: string;

  /** クラスタID */
  clusterId: string;

  /** 理想順位（常に1） */
  idealRank: number;

  /** 現在のtargetRank */
  currentTargetRank: number;

  /** 提案するtargetRank */
  suggestedTargetRank: number;

  /** 理由コード */
  reasonCode: RankAdjustmentReasonCode;

  /** 説明文（人間向け） */
  explanation: string;

  /** 判断根拠となるメトリクス */
  metrics: {
    organicRank: number;
    sov: number;
    seoProgressScore: number;
    lossPercentageUsed: number;
    unhealthyTacosMonths: number;
    evaluationPeriodDays: number;
  };

  /** 提案日時 */
  suggestedAt: Date;
}

type RankAdjustmentReasonCode =
  | "UNREALISTIC_FOR_IDEAL"   // 1位目標が非現実的
  | "STABLE_ABOVE_TARGET";    // 目標より上位で安定（さらなる引き下げ提案）
```

### 27.5 提案生成条件

RankAdjustmentSuggestionは、以下の条件のうち**2つ以上**を満たす場合に生成される。

```typescript
interface RankAdjustmentConfig {
  // 順位ギャップ条件
  rankGapThreshold: number;        // デフォルト: 5（organicRank - targetRank > 5）

  // SEO進捗条件
  seoProgressThreshold: number;    // デフォルト: 0.3（seoProgressScore < 0.3）

  // 累積赤字消化条件
  lossUsageThreshold: number;      // デフォルト: 0.7（累積赤字の70%以上消化）

  // TACOSゾーン条件
  unhealthyTacosMonths: number;    // デフォルト: 3（3ヶ月以上RED/ORANGEゾーン）

  // 評価期間
  evaluationPeriodDays: number;    // デフォルト: 90日

  // 提案する順位変更幅
  suggestedRankStep: number;       // デフォルト: 2
}
```

#### 条件チェックロジック

```typescript
function shouldSuggestRankAdjustment(
  metrics: SeoProgressMetrics,
  productMetrics: ProductMetrics,
  config: RankAdjustmentConfig
): boolean {
  let conditionsMet = 0;

  // 条件1: 順位ギャップ
  if (metrics.organicRank - metrics.targetRank > config.rankGapThreshold) {
    conditionsMet++;
  }

  // 条件2: SEO進捗不足
  if (metrics.seoProgressScore < config.seoProgressThreshold) {
    conditionsMet++;
  }

  // 条件3: 累積赤字消化
  if (productMetrics.lossPercentageUsed > config.lossUsageThreshold) {
    conditionsMet++;
  }

  // 条件4: 不健全TACOSが継続
  if (productMetrics.unhealthyTacosMonths >= config.unhealthyTacosMonths) {
    conditionsMet++;
  }

  return conditionsMet >= 2;
}
```

### 27.5.1 LTVプロファイル別RankAdjustmentConfig

商品のLTVプロファイルに応じて、RankAdjustmentConfigの閾値を自動的に切り替える。

#### ProductLtvProfile

```typescript
type ProductLtvProfile =
  | "SUPPLEMENT_HIGH_LTV"   // 高LTV：粘り強く投資継続
  | "SUPPLEMENT_NORMAL"     // 標準：バランス型
  | "LOW_LTV_SUPPLEMENT";   // 低LTV：早期見切り型
```

#### プロファイル別閾値

| 項目 | SUPPLEMENT_HIGH_LTV | SUPPLEMENT_NORMAL | LOW_LTV_SUPPLEMENT |
|------|---------------------|-------------------|-------------------|
| rankGapThreshold | 5 | 5 | 5 |
| seoProgressThreshold | 0.25 | 0.30 | 0.35 |
| lossUsageThreshold | 0.80 | 0.70 | 0.50 |
| unhealthyTacosMonths | 3 | 3 | 2 |
| evaluationPeriodDays | 90 | 90 | 90 |
| suggestedRankStep | 2 | 2 | 2 |

#### 設計意図

- **SUPPLEMENT_HIGH_LTV**: 「かなり粘ってから目標順位ダウン提案」
  - 累積損失上限の80%まで許容（lossUsageThreshold=0.80）
  - seoProgressScoreが0.25未満のみ「進捗不足」と判定
  - TACOS不健全が3ヶ月連続して初めて警戒

- **SUPPLEMENT_NORMAL**: 「バランス型」
  - 標準的な閾値設定
  - デフォルト設定（DEFAULT_RANK_ADJUSTMENT_CONFIG）と同等

- **LOW_LTV_SUPPLEMENT**: 「早めに見切って目標順位を下げる」
  - 累積損失上限の50%で警戒開始（lossUsageThreshold=0.50）
  - seoProgressScoreが0.35未満で「進捗不足」（厳しめ）
  - TACOS不健全が2ヶ月連続で早期警戒

#### プロファイル指定方法

```typescript
interface RankAdjustmentInput {
  // ... 既存フィールド ...

  /** 商品のLTVプロファイル */
  productLtvProfile?: ProductLtvProfile;
}

// 使用例
const input: RankAdjustmentInput = {
  productId: "B123456789",
  clusterId: "cluster_1",
  productLtvProfile: "SUPPLEMENT_HIGH_LTV",  // プロファイル指定
  // ...
};

// プロファイルに応じた設定が自動適用される
const suggestion = generateRankAdjustmentSuggestion(input);
```

#### RankAdjustmentSuggestionへのログ出力

提案生成時に以下のフィールドが自動的に付与される:

```typescript
interface RankAdjustmentSuggestion {
  // ... 既存フィールド ...

  /** 使用したプロファイル */
  productLtvProfile?: ProductLtvProfile;

  /** 使用した設定名（"SUPPLEMENT_HIGH_LTV" or "DEFAULT"等） */
  rankAdjustmentProfileConfigName?: string;

  metrics: {
    // ... 既存フィールド ...

    /** TACOS不健全月数（連続） */
    unhealthyTacosMonths?: number;
  };
}
```

これにより、BigQueryやLooker Studioで以下の分析が可能になる:
- 「HIGH_LTVなのに早く諦めすぎていないか」
- 「LOW_LTV_SUPPLEMENTに対して提案が遅すぎないか」

### 27.6 TACOS制御との連携

SEO進捗スコアに応じて、TacosControlContextのパラメータを調整する。

```typescript
/**
 * SEO進捗に基づくTACOS調整
 */
function adjustTacosControlBySeoProgress(
  context: TacosControlContext,
  seoProgress: SeoProgressMetrics,
  config: SeoTacosIntegrationConfig
): TacosControlContext {
  const adjustedContext = { ...context };

  if (seoProgress.seoProgressScore < config.lowProgressThreshold) {
    // SEO進捗が低い場合：TACOS許容を広げ、感度を下げる
    // → 広告投資を続けてSEO順位獲得を促進
    adjustedContext.tacosTargetMid *= (1 + config.tacosTargetMidAdjustment);
    adjustedContext.tacosAcuity *= (1 - config.tacosAcuityAdjustment);
  } else if (seoProgress.seoProgressScore > config.highProgressThreshold) {
    // SEO進捗が高い場合：TACOS許容を引き締め、感度を上げる
    // → 広告依存度を下げ、収益性を重視
    adjustedContext.tacosTargetMid *= (1 - config.tacosTargetMidAdjustment);
    adjustedContext.tacosAcuity *= (1 + config.tacosAcuityAdjustment);
  }

  return adjustedContext;
}
```

#### デフォルト設定

```typescript
const DEFAULT_SEO_TACOS_INTEGRATION_CONFIG = {
  lowProgressThreshold: 0.3,      // これ未満は「低進捗」
  highProgressThreshold: 0.8,     // これ以上は「高進捗」
  tacosTargetMidAdjustment: 0.1,  // ±10%調整
  tacosAcuityAdjustment: 0.15,    // ±15%調整
};
```

### 27.7 ライフサイクルとの連携

LAUNCH_HARD/LAUNCH_SOFTステージで、SEO進捗が低い場合に警告シグナルを出力する。

```typescript
/**
 * SEO進捗に基づくライフサイクル警告評価
 */
function evaluateSeoRankProgressWarnings(
  lifecycleState: LifecycleState,
  seoProgress: SeoProgressMetrics,
  monthsInCurrentState: number
): SeoProgressWarning[] {
  const warnings: SeoProgressWarning[] = [];

  if (lifecycleState === "LAUNCH_HARD" || lifecycleState === "LAUNCH_SOFT") {
    // LAUNCHステージで3ヶ月以上経過してもSEO進捗が低い場合
    if (monthsInCurrentState >= 3 && seoProgress.seoProgressScore < 0.3) {
      warnings.push({
        type: "LOW_SEO_PROGRESS_IN_LAUNCH",
        message: `LAUNCHステージで${monthsInCurrentState}ヶ月経過したがSEO進捗が低い（score: ${seoProgress.seoProgressScore.toFixed(2)}）。targetRank引き下げを検討してください。`,
        severity: "WARNING",
        seoProgressScore: seoProgress.seoProgressScore,
        organicRank: seoProgress.organicRank,
        targetRank: seoProgress.targetRank,
      });
    }

    // 順位が大幅に乖離している場合
    if (seoProgress.organicRank - seoProgress.targetRank > 10) {
      warnings.push({
        type: "RANK_GAP_TOO_LARGE",
        message: `現在の順位（${seoProgress.organicRank}位）が目標（${seoProgress.targetRank}位）から大きく乖離しています。目標順位の見直しを推奨します。`,
        severity: "WARNING",
        seoProgressScore: seoProgress.seoProgressScore,
        organicRank: seoProgress.organicRank,
        targetRank: seoProgress.targetRank,
      });
    }
  }

  return warnings;
}
```

### 27.8 運用フロー

```
1. 商品登録時
   - idealRank = 1, targetRank = 1, rankTolerance = 2 で初期化

2. 日次バッチ実行
   - SeoProgressMetrics を計算
   - seoProgressScore を算出
   - 条件を満たす場合、RankAdjustmentSuggestion を生成
   - TACOS制御パラメータを調整

3. 週次/月次レビュー
   - 生成された RankAdjustmentSuggestion を人間がレビュー
   - 承認する場合のみ targetRank を更新

4. ライフサイクル移行判定
   - SEO進捗警告を考慮してステージ移行を判断
```

### 27.9 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/seo/seo-rank-target.types.ts` | 型定義 |
| `src/seo/seo-progress-calculator.ts` | seoProgressScore計算 |
| `src/seo/rank-adjustment-suggester.ts` | RankAdjustmentSuggestion生成 |
| `src/seo/seo-tacos-integration.ts` | TACOS制御連携 |
| `src/lifecycle/transition-logic.ts` | ライフサイクル連携（拡張） |
| `tests/seo/seo-rank-target.test.ts` | ユニットテスト |

---

## 28. ビッグセール戦略とイベントモード制御

### 28.1 概要

ビッグセール期間（Prime Day、Black Friday等）における入札戦略を制御するシステムです。グローバル設定（`globalMode`）、イベント状態（`eventMode`）、商品別戦略（`bigSaleStrategy`）の3層で入札行動を決定します。

### 28.2 EventMode（イベントモード）

イベントモードは現在のセール期間の状態を表します。

```typescript
type EventMode = "NONE" | "BIG_SALE_PREP" | "BIG_SALE_DAY";
```

| EventMode | 意味 | 入札への影響 |
|-----------|------|-------------|
| `NONE` | 通常期間 | 通常の入札ロジックを適用 |
| `BIG_SALE_PREP` | セール準備期間（数日前〜前日） | 戦略に応じて控えめに強化 |
| `BIG_SALE_DAY` | セール当日 | 戦略に応じて積極的に強化 |

### 28.3 bigSaleStrategy（商品別ビッグセール戦略）

商品ごとにビッグセールへの参加レベルを設定します。

```typescript
type BigSaleStrategy = "NONE" | "LIGHT" | "AGGRESSIVE";
```

| BigSaleStrategy | 意味 | 推奨ケース |
|-----------------|------|-----------|
| `NONE` | セールに参加しない | 利益率確保が最優先、在庫が少ない商品 |
| `LIGHT` | 控えめに参加 | 中程度の利益率、安定した商品 |
| `AGGRESSIVE` | 積極的に参加 | 売上拡大が最優先、在庫潤沢な主力商品 |

### 28.4 EffectiveMode（実効モード）決定ロジック

`globalMode`、`eventMode`、`bigSaleStrategy`の3要素から実効モードを決定します。

```typescript
type EffectiveMode = "NORMAL" | "S_MODE" | "S_MODE_LIGHT";

interface EffectiveModeResult {
  effectiveMode: EffectiveMode;
  reason: string;
  sModeScale: number;  // 0.0〜1.0
}
```

#### 決定表

| globalMode | eventMode | bigSaleStrategy | effectiveMode | sModeScale | 説明 |
|------------|-----------|-----------------|---------------|------------|------|
| `NORMAL` | *any* | *any* | `NORMAL` | 0.0 | グローバルがNORMALなら常にNORMAL |
| `S_MODE` | `NONE` | *any* | `NORMAL` | 0.0 | イベントがなければNORMAL |
| `S_MODE` | `BIG_SALE_DAY` | `AGGRESSIVE` | `S_MODE` | 1.0 | フルパワーで攻める |
| `S_MODE` | `BIG_SALE_DAY` | `LIGHT` | `S_MODE_LIGHT` | 0.5 | 中程度の強化 |
| `S_MODE` | `BIG_SALE_DAY` | `NONE` | `NORMAL` | 0.0 | この商品は参加しない |
| `S_MODE` | `BIG_SALE_PREP` | `AGGRESSIVE` | `S_MODE_LIGHT` | 0.5 | 準備期間は控えめ |
| `S_MODE` | `BIG_SALE_PREP` | `LIGHT` | `NORMAL` | 0.0 | LIGHTは準備期間は適用しない |
| `S_MODE` | `BIG_SALE_PREP` | `NONE` | `NORMAL` | 0.0 | この商品は参加しない |

### 28.5 S_MODEパラメータスケーリング

`sModeScale`に基づいてS_MODEのパラメータを線形補間します。

```typescript
/**
 * スケーリング計算式
 * effectiveValue = normalValue + (sModeValue - normalValue) × sModeScale
 */
function scaleSmodeParameter(
  sModeValue: number,
  normalValue: number,
  sModeScale: number
): number {
  const delta = sModeValue - normalValue;
  return normalValue + delta * sModeScale;
}
```

#### スケーリング例

| パラメータ | NORMAL値 | S_MODE値 | sModeScale=0.5時 | sModeScale=1.0時 |
|-----------|---------|---------|------------------|------------------|
| `maxBidUpMultiplier` | 1.3 | 1.5 | 1.4 | 1.5 |
| `maxBidDownMultiplier` | 0.7 | 0.9 | 0.8 | 0.9 |
| `acosToleranceMultiplier` | 1.2 | 1.5 | 1.35 | 1.5 |

### 28.6 イベント時入札ポリシー

```typescript
interface EventBidPolicy {
  maxBidUpMultiplier: number;
  maxBidDownMultiplier: number;
  acosToleranceMultiplier: number;
  allowStrongDown: boolean;
  allowNoConversionDown: boolean;
}

// デフォルトポリシー
const NORMAL_BID_POLICY: EventBidPolicy = {
  maxBidUpMultiplier: 1.3,
  maxBidDownMultiplier: 0.7,
  acosToleranceMultiplier: 1.2,
  allowStrongDown: true,
  allowNoConversionDown: true,
};

const S_MODE_BID_POLICY: EventBidPolicy = {
  maxBidUpMultiplier: 1.5,
  maxBidDownMultiplier: 0.9,
  acosToleranceMultiplier: 1.5,
  allowStrongDown: false,   // BIG_SALE時は大幅下げを抑制
  allowNoConversionDown: false,
};
```

### 28.7 ダウン入札抑制

ビッグセール期間中（`eventMode ≠ NONE`）かつS_MODEまたはS_MODE_LIGHTの場合、入札を下げるアクションを抑制します。

| 条件 | `allowStrongDown` | `allowNoConversionDown` |
|------|-------------------|-------------------------|
| eventMode=NONE | `true` | `true` |
| eventMode=BIG_SALE_*, effectiveMode=NORMAL | `true` | `true` |
| eventMode=BIG_SALE_*, effectiveMode=S_MODE | `false` | `false` |
| eventMode=BIG_SALE_*, effectiveMode=S_MODE_LIGHT | `false` | `false` |

### 28.8 イベントカレンダー

手動で管理するセールイベントカレンダーから自動的にEventModeを決定できます。

```typescript
interface SaleEventDefinition {
  id: string;           // イベント識別子
  label: string;        // 表示名
  grade: EventGrade;    // 'S' | 'A' | 'B'
  timezone: string;     // タイムゾーン
  start: string;        // 開始日時 (ISO8601)
  end: string;          // 終了日時 (ISO8601)
  prepDays: number;     // 準備期間日数
  applyToEventMode: boolean;  // EventModeに反映するか
}
```

#### イベントグレード

| グレード | 対象イベント例 | EventMode反映 |
|---------|---------------|---------------|
| `S` | Prime Day, Black Friday | `applyToEventMode=true`時に反映 |
| `A` | タイムセール祭り | 通常は反映しない |
| `B` | その他のイベント | 反映しない |

### 28.9 EventMode解決優先度

環境変数`EVENT_MODE_SOURCE`でEventModeの決定方法を制御します。

```typescript
type EventModeSource = "MANUAL" | "CALENDAR";
```

| EVENT_MODE_SOURCE | 動作 |
|-------------------|------|
| `MANUAL` | 環境変数`EVENT_MODE`の値をそのまま使用 |
| `CALENDAR` | カレンダーを優先し、該当イベントがなければ環境変数にフォールバック |

### 28.10 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/event/calendar.ts` | イベントカレンダー、EventMode解決 |
| `src/strategies/effective-mode.ts` | effectiveMode決定ロジック |
| `src/config/productConfigTypes.ts` | BigSaleStrategy型定義 |
| `src/config.ts` | eventModeSource設定 |
| `tests/event/calendar.test.ts` | カレンダーテスト |
| `tests/strategies/effective-mode.test.ts` | effectiveModeテスト |

### 28.11 使用例

```typescript
import { determineEffectiveMode } from "./strategies/effective-mode";
import { determineEventMode, SALE_EVENT_CALENDAR } from "./event/calendar";

// 1. EventModeを決定
const eventDecision = determineEventMode(
  new Date(),
  envConfig.eventMode,
  SALE_EVENT_CALENDAR
);

// 2. 商品ごとにeffectiveModeを計算
const effectiveResult = determineEffectiveMode({
  globalMode: envConfig.globalOperationMode,
  eventMode: eventDecision.effectiveEventMode,
  bigSaleStrategy: productConfig.bigSaleStrategy ?? "NONE",
});

// 3. 実効パラメータを取得
const bidParams = calculateEffectiveEventBidParams(
  effectiveResult,
  eventDecision.effectiveEventMode
);

// 4. 入札計算に適用
const recommendation = computeBidRecommendation({
  // ...
  maxBidUpMultiplier: bidParams.maxBidUpMultiplier,
  maxBidDownMultiplier: bidParams.maxBidDownMultiplier,
  allowStrongDown: bidParams.allowStrongDown,
  // ...
});
```

---

## 29. 実測LTV（measuredLtv）

### 29.1 概要

既存商品のLTVを実測データから計算する機能。新商品はテンプレート値（PRIOR）を使用し、既存商品で十分なデータがある場合は実測LTV（MEASURED）を使用する。

### 29.2 LTVソース

| ソース | 説明 | 適用条件 |
|-------|------|---------|
| PRIOR | 事前LTV（テンプレート値） | 新商品、または実測条件未達 |
| MEASURED | 実測LTV | 既存商品で実測条件達成 |

### 29.3 実測LTV条件

以下の両方を満たす場合のみMEASUREDを使用:

| 条件 | デフォルト値 |
|-----|------------|
| minCustomersForMeasured | 300人 |
| minDaysActiveForMeasured | 180日 |

### 29.4 計算式

```
extraOrdersPerCustomer1y = max(0, (totalOrders1y - uniqueCustomers1y) / uniqueCustomers1y)
totalOrdersPerCustomer1y = 1 + extraOrdersPerCustomer1y
avgGrossProfitPerOrder1y = totalGrossProfit1y / totalOrders1y
measuredLtvGross = avgGrossProfitPerOrder1y × totalOrdersPerCustomer1y
ltvEffectiveGross = measuredLtvGross × ltvSafetyFactorMeasured
```

### 29.5 プロファイル別安全係数

| ProductLtvProfile | ltvSafetyFactorMeasured |
|------------------|------------------------|
| SUPPLEMENT_HIGH_LTV | 0.80 |
| SUPPLEMENT_NORMAL | 0.75 |
| LOW_LTV_SUPPLEMENT | 0.70 |

### 29.6 LTV解決ロジック

```typescript
function resolveLtvForProduct(input: ResolveLtvInput): ResolvedLtvResult {
  // 1. 新商品 → PRIOR
  if (input.isNewProduct) {
    return { ltvSource: "PRIOR", ltvEffectiveGross: priorLtvGross × priorSafetyFactor };
  }

  // 2. 実測データなし → PRIOR
  if (!input.measuredLtvInput) {
    return { ltvSource: "PRIOR", ... };
  }

  // 3. 実測LTV計算
  const measured = computeMeasuredLtv(input.measuredLtvInput);

  // 4. 条件達成 → MEASURED
  if (measured.ltvSource === "MEASURED") {
    return { ltvSource: "MEASURED", ltvEffectiveGross: measured.ltvEffectiveGross };
  }

  // 5. 条件未達 → PRIOR
  return { ltvSource: "PRIOR", ... };
}
```

### 29.7 累積損失上限への適用

```typescript
// LTV解決
const resolvedLtv = resolveLtvForProduct({
  asin: "B00XXXX",
  isNewProduct: false,
  priorLtvGross: 5000,
  priorSafetyFactor: 0.8,
  measuredLtvInput: { repeatMetrics, profitMetrics, launchDate },
  productLtvProfile: "SUPPLEMENT_NORMAL",
});

// 累積損失上限の計算
const lossLimit = calculateCumulativeLossLimitFromResolvedLtv(
  resolvedLtv,
  profile.lossBudgetMultiple
);
// lossLimit = ltvEffectiveGross × lossBudgetMultiple
```

### 29.8 計算例

```
入力:
  - uniqueCustomers1y = 400人
  - totalOrders1y = 600件
  - totalGrossProfit1y = 600,000円
  - daysActive = 200日
  - productLtvProfile = SUPPLEMENT_NORMAL

計算:
  1. extraOrdersPerCustomer1y = (600 - 400) / 400 = 0.5
  2. totalOrdersPerCustomer1y = 1 + 0.5 = 1.5
  3. avgGrossProfitPerOrder1y = 600,000 / 600 = 1,000円
  4. measuredLtvGross = 1,000 × 1.5 = 1,500円
  5. ltvEffectiveGross = 1,500 × 0.75 = 1,125円

結果:
  - ltvSource = MEASURED
  - ltvEffectiveGross = 1,125円
```

### 29.9 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/ltv/measuredLtv.ts` | 実測LTV計算ロジック |
| `src/ltv/index.ts` | エクスポート |
| `tests/ltv/measured-ltv.test.ts` | テスト |

---

## 30. TACOS最適化と健全性スコア

### 30.1 概要

TACOS（Total Advertising Cost of Sales）の最適値を過去データから推計し、現在のTACOSと比較して健全性スコア（-1〜+1）を算出する。このスコアに基づいてSTRONG_UP入札アクションの倍率を動的に調整する。

### 30.2 LTVベース上限とempirical上限の分離

TACOSには2つの独立した上限概念がある:

```
1. theoreticalMaxTacosCapped (LTVベース)
   - LTVから計算される理論上限
   - 「広告費をかけても回収できるか」の財務的限界

2. tacosAggressiveCap (empiricalベース)
   - 過去データの利益最大化TACOS + offset
   - 「実際に利益が出るか」の実績ベース上限

制御用上限:
   tacosMaxForControl = min(theoreticalMaxTacosCapped, tacosAggressiveCap)
```

### 30.3 tacosTargetMid（利益最大化TACOS）の推計

過去90日の日次データをTACOS帯でビン分けし、各ビンの平均利益を計算して最も利益が高いTACOS帯を特定する。

```
入力: DailyTacosMetrics[] (90日分)
  - date: string
  - revenue: number
  - adSpend: number

処理:
1. 有効日フィルタ: revenue > 0, minTacos <= TACOS <= maxTacos
2. 日次利益計算: Profit_d = revenue × (marginPotential - TACOS_d)
3. TACOSをビン分け（例: 0.05刻み）
4. 各ビンの平均利益を計算（minDaysPerBin未満のビンは除外）
5. 平均利益最大のビンを選択

出力:
  tacosTargetMid = 最適ビンの平均TACOS
  tacosAggressiveCap = tacosTargetMid + offset  ← empirical攻め上限
```

### 30.4 TACOSゾーン判定

```typescript
type TacosZone = "GREEN" | "ORANGE" | "RED";

// 判定ルール
GREEN:  currentTacos <= tacosTargetMidForControl（健全）
ORANGE: tacosTargetMidForControl < currentTacos <= tacosMaxForControl（注意）
RED:    currentTacos > tacosMaxForControl（危険）
```

### 30.5 tacosHealthScore（健全性スコア）

```typescript
function computeTacosHealthScore(ctx: TacosHealthContext): TacosHealthResult

// 境界値
tacosLow = max(0, tacosTargetMidForControl - lowMargin)
tacosMid = tacosTargetMidForControl
tacosHigh = tacosMaxForControl

// スコアリング
if (tacos90d <= tacosLow) score = +1       // EXCELLENT
else if (tacos90d >= tacosHigh) score = -1 // CRITICAL
else if (tacos90d <= tacosMid)
  score = 1 - (tacos90d - tacosLow) / (tacosMid - tacosLow)  // [1, 0]
else
  score = 0 - (tacos90d - tacosMid) / (tacosHigh - tacosMid) // [0, -1]
```

### 30.6 STRONG_UP倍率とゲートロジック

```typescript
// 基本倍率計算
baseMultiplier = 1.3
alpha = 0.5
minMultiplier = 1.0
maxMultiplier = 1.95
orangeZoneMaxMultiplier = 1.3

raw = baseMultiplier × (1 + alpha × clampedScore)
multiplier = clamp(raw, minMultiplier, maxMultiplier)
```

**STRONG_UPゲートルール:**

TACOSシグナルが「productBidMultiplier」「targetAcos」「STRONG_UP」の三重に効き過ぎないよう、ゲートを設ける:

| 条件 | ゲート動作 |
|------|-----------|
| REDゾーン | 強制的に1.0（STRONG_UP無効化） |
| ORANGEゾーン | max 1.3に制限 |
| productBidMultiplier < 1.0 | max 1.3に制限 |
| GREENゾーン & productBidMultiplier >= 1.0 | 制限なし |

| tacosHealthScore | ゲート前倍率 | REDゾーン | ORANGEゾーン |
|------------------|-------------|-----------|--------------|
| +1 (超健康) | 1.95 | 1.0 | 1.3 |
| +0.5 (健康) | 1.625 | 1.0 | 1.3 |
| 0 (ニュートラル) | 1.30 | 1.0 | 1.3 |
| -0.5 (警告) | 1.0 | 1.0 | 1.0 |
| -1 (危険) | 1.0 | 1.0 | 1.0 |

### 30.7 入札エンジンへの統合

```typescript
// 1. 日次データ取得
const dailyMetrics90d = await fetchDailyTacosMetrics(asin, 90);

// 2. LTVベースの理論上限取得
const theoreticalMaxTacosCapped = calculateTheoreticalMaxTacosCapped(productConfig);

// 3. TACOS健全性評価
const evaluation = evaluateTacosHealth({
  dailyMetrics90d,
  theoreticalMaxTacosCapped,  // LTV上限を渡す
  productProfile: config.productLtvProfile,
  productBidMultiplier: currentProductBidMultiplier,
});

// 4. STRONG_UPアクション時の入札計算
if (action === "STRONG_UP") {
  // ゲート適用後の最終倍率を使用
  const strongUpMultiplier = evaluation.strongUpMultiplier.finalMultiplier;
  const newBid = currentBid * strongUpMultiplier;
}

// 5. 判定情報
console.log({
  tacosTargetMidForControl: evaluation.tacosTargetMidForControl,
  tacosMaxForControl: evaluation.tacosMaxForControl,
  tacosZone: evaluation.healthScore.tacosZone,
  gateApplied: evaluation.strongUpMultiplier.gateApplied,
  gateReason: evaluation.strongUpMultiplier.gateReason,
});
```

### 30.8 プロファイル別デフォルト設定

| プロファイル | marginPotential | tacosTargetMidDefault | tacosAggressiveCapDefault | lowMargin |
|------------|-----------------|----------------------|--------------------------|-----------|
| SUPPLEMENT_HIGH_LTV | 0.55 | 0.18 | 0.25 | 0.08 |
| SUPPLEMENT_NORMAL | 0.50 | 0.15 | 0.21 | 0.06 |
| LOW_LTV_SUPPLEMENT | 0.45 | 0.12 | 0.17 | 0.05 |

### 30.9 計算例

```
入力:
  - tacos90d = 0.12
  - tacosTargetMidForControl = 0.15  (empirical推計値)
  - tacosMaxForControl = 0.20        (min(LTV上限0.25, empirical上限0.21))
  - lowMargin = 0.06
  - productBidMultiplier = 1.1

境界値:
  tacosLow = 0.15 - 0.06 = 0.09
  tacosMid = 0.15
  tacosHigh = 0.20

ゾーン判定:
  tacos90d (0.12) <= tacosTargetMidForControl (0.15)
  → GREENゾーン

スコア計算:
  tacos90d (0.12) は tacosLow (0.09) と tacosMid (0.15) の間
  score = 1 - (0.12 - 0.09) / (0.15 - 0.09)
        = 1 - 0.03 / 0.06
        = 1 - 0.5
        = 0.5 (HEALTHY)

STRONG_UP倍率計算:
  raw = 1.3 × (1 + 0.5 × 0.5)
      = 1.3 × 1.25
      = 1.625

ゲート判定:
  - GREENゾーン & productBidMultiplier >= 1.0
  → ゲート適用なし
  → finalMultiplier = 1.625

結果:
  STRONG_UPアクション時は currentBid × 1.625 に増額
```

### 30.10 REDゾーンの例

```
入力:
  - tacos90d = 0.25
  - tacosTargetMidForControl = 0.15
  - tacosMaxForControl = 0.20
  - productBidMultiplier = 1.0

ゾーン判定:
  tacos90d (0.25) > tacosMaxForControl (0.20)
  → REDゾーン

スコア計算:
  score = -1 (CRITICAL)

STRONG_UP倍率計算:
  raw = 1.3 × (1 + 0.5 × -1)
      = 1.3 × 0.5
      = 0.65 → clamped to 1.0

ゲート判定:
  - REDゾーン → 強制的に1.0
  → gateApplied = true
  → gateReason = "REDゾーンのためSTRONG_UP無効化"
  → finalMultiplier = 1.0

結果:
  STRONG_UPアクション時でも currentBid × 1.0 = 増額なし
```

### 30.11 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/tacos/tacosHealth.ts` | TACOS健全性計算ロジック |
| `src/tacos/index.ts` | エクスポート |
| `tests/tacos/tacosHealth.test.ts` | テスト |

---

## 31. アトリビューション防御ロジック（Attribution Defense）

Amazon広告のCV計上遅延（2-3日）を考慮し、DOWN/STRONG_DOWN/STOP/NEGの判定を安定期間（stable期間）ベースで行う防御機能。

### 31.1 期間定義

```typescript
// src/engine/attribution-defense/types.ts

interface AttributionAwareMetrics {
  asin: string;
  entityId: string;           // キーワードID or クラスターID
  entityType: "KEYWORD" | "SEARCH_TERM_CLUSTER";

  stable: PeriodMetrics;      // 安定期間（デフォルト: 4-30日前）
  recent: PeriodMetrics;      // 直近期間（デフォルト: 直近3日）
  total: PeriodMetrics;       // 合計期間（stable + recent）

  stableDays: number;
  recentDays: number;
  targetCpa: number;
}

interface PeriodMetrics {
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
  sales: number;
  ctr: number | null;
  cvr: number | null;
  acos: number | null;
  cpc: number | null;
}
```

### 31.2 防御閾値設定

```typescript
interface DefenseThresholdConfig {
  stopNeg: SingleDefenseThreshold;     // STOP/NEG用（最も厳格）
  strongDown: SingleDefenseThreshold;  // STRONG_DOWN用
  down: SingleDefenseThreshold;        // DOWN用（最も緩い）
}

interface SingleDefenseThreshold {
  minStableClicks: number;              // 必要最小クリック数
  minStableCostToTargetCpaRatio: number; // コスト対CPA比率
}

// デフォルト設定
const DEFAULT_DEFENSE_THRESHOLD_CONFIG: DefenseThresholdConfig = {
  stopNeg: {
    minStableClicks: 60,
    minStableCostToTargetCpaRatio: 3.0,  // 目標CPA×3の広告費が必要
  },
  strongDown: {
    minStableClicks: 40,
    minStableCostToTargetCpaRatio: 2.0,
  },
  down: {
    minStableClicks: 20,
    minStableCostToTargetCpaRatio: 1.0,
  },
};
```

### 31.3 防御判定関数

```typescript
// src/engine/attribution-defense/defense-judgment.ts

function judgeDefense(
  metrics: AttributionAwareMetrics,
  targetAcos: number,
  lifecycleState: LifecycleState,
  thresholdConfig?: DefenseThresholdConfig,
  lifecyclePolicies?: Record<LifecycleState, LifecycleDefensePolicy>
): DefenseJudgmentResult {
  // 1. ライフサイクルポリシーチェック
  const policy = lifecyclePolicies[lifecycleState];

  // 2. STOP/NEG判定
  if (!policy.blockStopNeg && isNoConversionInStable(metrics)) {
    const threshold = applyLifecycleMultiplier(thresholdConfig.stopNeg, policy.thresholdMultiplier);
    if (metrics.stable.clicks >= threshold.minStableClicks &&
        (metrics.stable.cost / metrics.targetCpa) >= threshold.minStableCostToTargetCpaRatio) {
      // 直近好調チェック
      if (!isRecentPerformanceGood(metrics)) {
        return { shouldDefend: true, recommendedAction: "STOP" or "NEG" };
      }
    }
  }

  // 3. STRONG_DOWN判定（ACOS > targetAcos × 1.5）
  // 4. DOWN判定（ACOS > targetAcos × 1.2）
  // ...

  return { shouldDefend: false, reasonCode: "DEFENSE_NOT_NEEDED_GOOD_PERFORMANCE" };
}
```

### 31.4 ライフサイクル別防御ポリシー

```typescript
const DEFAULT_LIFECYCLE_DEFENSE_POLICIES: Record<LifecycleState, LifecycleDefensePolicy> = {
  LAUNCH_HARD: {
    thresholdMultiplier: 2.0,    // 閾値を2倍に厳格化
    blockStopNeg: true,          // STOP/NEG完全禁止
    blockStrongDown: true,       // STRONG_DOWN禁止
    blockDown: true,             // DOWN禁止
  },
  LAUNCH_SOFT: {
    thresholdMultiplier: 1.5,
    blockStopNeg: true,
    blockStrongDown: true,
    blockDown: false,            // DOWNのみ許可
  },
  GROWTH: {
    thresholdMultiplier: 1.2,
    blockStopNeg: false,
    blockStrongDown: false,
    blockDown: false,
  },
  STEADY: {
    thresholdMultiplier: 1.0,
    blockStopNeg: false,
    blockStrongDown: false,
    blockDown: false,
  },
  HARVEST: {
    thresholdMultiplier: 0.8,    // 閾値を0.8倍に緩和（早めの防御）
    blockStopNeg: false,
    blockStrongDown: false,
    blockDown: false,
  },
  ZOMBIE: {
    thresholdMultiplier: 1.0,
    blockStopNeg: false,
    blockStrongDown: false,
    blockDown: false,
  },
};
```

### 31.5 直近好調判定

```typescript
function isRecentPerformanceGood(metrics: AttributionAwareMetrics): boolean {
  // 条件1: 直近期間にコンバージョンがある
  if (metrics.recent.conversions >= 1) {
    return true;
  }

  // 条件2: 直近期間のCVRがstable期間より1.2倍以上良い
  if (metrics.recent.cvr !== null && metrics.stable.cvr !== null &&
      metrics.recent.cvr >= metrics.stable.cvr * 1.2) {
    return true;
  }

  return false;
}
```

### 31.6 UP/STRONG_UP用 安定比率チェック

```typescript
function checkStableRatioForUp(
  metrics: AttributionAwareMetrics,
  thresholds: StableRatioThresholds = DEFAULT_STABLE_RATIO_THRESHOLDS
): StableRatioCheckResult {
  // stable期間のデータ不足時はスキップ
  if (metrics.stable.clicks < thresholds.minStableClicks) {
    return { allowUp: true, reason: "データ不足でチェックスキップ" };
  }

  // ACOS乖離率を計算
  const divergenceRatio = (metrics.total.acos - metrics.stable.acos) / metrics.stable.acos;

  // 乖離率が閾値（デフォルト25%）を超える場合はアップを抑制
  if (divergenceRatio > thresholds.maxAcosDivergenceRatio) {
    return {
      allowUp: false,
      acosDivergenceRatio: divergenceRatio,
      reason: `total期間のACOSがstable期間より${(divergenceRatio * 100).toFixed(1)}%悪化`,
    };
  }

  return { allowUp: true, acosDivergenceRatio: divergenceRatio };
}

// デフォルト閾値
const DEFAULT_STABLE_RATIO_THRESHOLDS = {
  maxAcosDivergenceRatio: 0.25,  // 25%
  minStableClicks: 15,
};
```

### 31.7 メトリクス構築関数

```typescript
// 日次データからAttributionAwareMetricsを構築
function buildAttributionAwareMetrics(
  asin: string,
  entityId: string,
  entityType: "KEYWORD" | "SEARCH_TERM_CLUSTER",
  dailyData: DailyPerformanceData[],
  targetCpa: number,
  referenceDate: Date = new Date(),
  config: MetricsBuildConfig = DEFAULT_METRICS_BUILD_CONFIG
): AttributionAwareMetrics;

// KeywordMetrics（既存）から変換
function buildFromKeywordMetrics(
  asin: string,
  keywordId: string,
  metrics7dExclRecent: {...},
  metricsLast3d: {...},
  metrics7d: {...},
  targetCpa: number
): AttributionAwareMetrics;

// クラスターメトリクスから変換
function buildFromClusterMetrics(
  asin: string,
  clusterId: string,
  stableMetrics: {...},
  recentMetrics: {...} | null,
  targetCpa: number
): AttributionAwareMetrics;
```

### 31.8 防御理由コード一覧

| コード | 説明 |
|--------|------|
| `DEFENSE_STOP_NO_CONVERSION` | stable期間でCV=0、STOP推奨 |
| `DEFENSE_NEG_NO_CONVERSION` | stable期間でCV=0、NEG推奨 |
| `DEFENSE_STRONG_DOWN_HIGH_ACOS` | stable期間でACOS高すぎ（×1.5超過） |
| `DEFENSE_DOWN_HIGH_ACOS` | stable期間でACOS高め（×1.2超過） |
| `DEFENSE_BLOCKED_INSUFFICIENT_CLICKS` | stable期間のクリック数不足で見送り |
| `DEFENSE_BLOCKED_INSUFFICIENT_COST` | stable期間のコスト不足（CPA比率未達）で見送り |
| `DEFENSE_BLOCKED_LIFECYCLE_POLICY` | ライフサイクルポリシーでブロック |
| `DEFENSE_BLOCKED_RECENT_GOOD_PERFORMANCE` | 直近期間が好調なため緩和 |
| `DEFENSE_NOT_NEEDED_GOOD_PERFORMANCE` | パフォーマンス良好で防御不要 |

### 31.9 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/engine/attribution-defense/types.ts` | 型定義 |
| `src/engine/attribution-defense/metrics-builder.ts` | メトリクス構築 |
| `src/engine/attribution-defense/defense-judgment.ts` | 防御判定ロジック |
| `src/engine/attribution-defense/index.ts` | エクスポート |
| `tests/attribution-defense/*.test.ts` | テスト |

---

## 32. プレセール診断（Presale Diagnosis）

プレセール期間（セール前3-7日）の実績データを分析し、「売れるプレセール」か「買い控えプレセール」かを判定する機能。タイプに応じてDOWN/UP系アクションを動的に制御する。

### 32.1 SalePhase（セールフェーズ）

```typescript
// src/presale/types.ts

type SalePhase = "NORMAL" | "PRE_SALE" | "MAIN_SALE" | "COOL_DOWN";
```

| フェーズ | 説明 | プレセール診断 |
|---------|------|---------------|
| NORMAL | 通常日 | 対象外 |
| PRE_SALE | プレセール期間 | ○ 診断実行 |
| MAIN_SALE | 本番セール期間 | 対象外 |
| COOL_DOWN | クールダウン期間 | 対象外 |

### 32.2 PresaleType（プレセールタイプ）

```typescript
type PresaleType = "NONE" | "BUYING" | "HOLD_BACK" | "MIXED";
```

| タイプ | 判定条件 | 説明 |
|-------|---------|------|
| NONE | PRE_SALE以外 | 診断対象外 |
| BUYING | CVR比率≥0.9 AND ACOS比率≤1.2 | 売れるプレセール |
| HOLD_BACK | CVR比率≤0.6 AND ACOS比率≥1.3 | 買い控えプレセール |
| MIXED | 上記以外 | グレーゾーン |

### 32.3 診断ロジック

```typescript
// diagnosePresaleType の主要ロジック

function diagnosePresaleType(
  input: PresaleDiagnosisInput,
  saleContextConfig: SaleContextConfig,
  thresholdConfig: PresaleThresholdConfig
): PresaleDiagnosis {
  // 1. PRE_SALEフェーズ以外は NONE を返す
  if (saleContextConfig.salePhase !== "PRE_SALE") {
    return { type: "NONE", ... };
  }

  // 2. クリック数チェック
  if (baseline.clicks < baselineMinClicks || presale.clicks < presaleMinClicks) {
    return { type: "MIXED", reason: "クリック不足" };
  }

  // 3. CVR/ACOS計算
  const cvrRatio = presaleCvr / baselineCvr;
  const acosRatio = presaleAcos / baselineAcos;

  // 4. タイプ判定
  if (cvrRatio >= 0.9 && acosRatio <= 1.2) {
    return { type: "BUYING", ... };
  }
  if (cvrRatio <= 0.6 && acosRatio >= 1.3) {
    return { type: "HOLD_BACK", ... };
  }
  return { type: "MIXED", ... };
}
```

### 32.4 タイプ別ポリシー

```typescript
interface PresaleBidPolicy {
  allowStopNeg: boolean;        // STOP/NEG許可
  allowStrongDown: boolean;     // STRONG_DOWN許可
  allowDown: boolean;           // DOWN許可
  maxDownPercent: number;       // 最大DOWN幅（%）
  allowStrongUp: boolean;       // STRONG_UP許可
  maxUpMultiplier: number;      // 最大UP倍率
  useBaselineAsPrimary: boolean; // baseline主軸
}
```

#### デフォルトポリシー値

| タイプ | allowStopNeg | allowStrongDown | maxDownPercent | allowStrongUp | maxUpMultiplier |
|-------|--------------|-----------------|----------------|---------------|-----------------|
| NONE | true | true | 15 | true | 1.30 |
| BUYING | true | true | 15 | true | 1.25 |
| **HOLD_BACK** | **false** | **false** | **7** | **false** | **1.10** |
| **MIXED** | **false** | **false** | **10** | **false** | **1.15** |

### 32.5 防御アクション調整

```typescript
function adjustDefenseAction(
  originalAction: DefenseAction,
  presaleContext: PresaleContext
): PresaleAwareDefenseResult {
  const { policy, diagnosis } = presaleContext;

  // STOP/NEG → KEEP（HOLD_BACK/MIXED時）
  if ((originalAction === "STOP" || originalAction === "NEG") && !policy.allowStopNeg) {
    return { finalAction: "KEEP", adjustedByPresale: true, ... };
  }

  // STRONG_DOWN → DOWN（HOLD_BACK/MIXED時）
  if (originalAction === "STRONG_DOWN" && !policy.allowStrongDown) {
    return { finalAction: "DOWN", adjustedByPresale: true, ... };
  }

  // DOWN幅の制限は別途 applyPresaleDownLimit で適用
  return { finalAction: originalAction, adjustedByPresale: false, ... };
}
```

### 32.6 HOLD_BACK二重条件チェック

HOLD_BACKでDOWNを発動するには、以下の二重条件を両方満たす必要がある：

```typescript
function shouldAllowDownInHoldBack(
  baselineAcos, presaleAcos, targetAcos,
  baselineCvr, presaleCvr, targetCvr?
): { allowDown: boolean; reason: string } {
  // ACOS条件: baselineでもtargetの120%超、かつpresaleでさらに悪化
  const baselineAcosBad = baselineAcos > targetAcos * 1.2;
  const presaleAcosWorse = presaleAcos >= baselineAcos;

  // CVR条件: targetCvrがあればbaselineでも80%未満
  const baselineCvrBad = baselineCvr < targetCvr * 0.8;

  if (baselineAcosBad && presaleAcosWorse && (targetCvr === undefined || baselineCvrBad)) {
    return { allowDown: true, reason: "HOLD_BACK二重条件クリア" };
  }
  return { allowDown: false, reason: "HOLD_BACK二重条件未達" };
}
```

**設計意図**: プレセールの一時的なCVR低下でDOWNを発動すると、セール本番でインプレッションが取れなくなる。baselineでも悪い場合のみDOWNを許可。

### 32.7 攻めアクション調整

```typescript
function adjustOffenseAction(
  originalAction: OffenseAction,
  originalMultiplier: number,
  presaleContext: PresaleContext
): PresaleAwareOffenseResult {
  const { policy, diagnosis } = presaleContext;

  // STRONG_UP → MILD_UP（HOLD_BACK/MIXED時）
  if (originalAction === "STRONG_UP" && !policy.allowStrongUp) {
    const limitedMultiplier = Math.min(originalMultiplier, policy.maxUpMultiplier);
    return { finalAction: "MILD_UP", finalMultiplier: limitedMultiplier, ... };
  }

  // MILD_UPでも倍率は制限
  const limitedMultiplier = Math.min(originalMultiplier, policy.maxUpMultiplier);
  return { finalAction: originalAction, finalMultiplier: limitedMultiplier, ... };
}
```

### 32.8 使用例

```typescript
import {
  createPresaleContext,
  applyPresaleDefense,
  applyPresaleOffense,
} from "./presale";

// プレセールコンテキスト生成
const presaleContext = createPresaleContext(
  {
    baseline: { clicks: 500, cost: 25000, conversions: 25, revenue: 100000 },
    presale: { clicks: 80, cost: 5000, conversions: 2, revenue: 8000 },
  },
  { salePhase: "PRE_SALE", ... }
);
// → presaleContext.diagnosis.type === "HOLD_BACK"

// 防御アクション調整
const defense = applyPresaleDefense("STRONG_DOWN", presaleContext, 0.20);
// → defense.finalAction === "DOWN"（STRONG_DOWN禁止）
// → defense.adjustedByPresale === true

// 攻めアクション調整
const offense = applyPresaleOffense("STRONG_UP", 1.4, presaleContext);
// → offense.finalAction === "MILD_UP"（STRONG_UP禁止）
// → offense.finalMultiplier === 1.1（倍率制限）
```

### 32.9 設定パラメータ

#### SaleContextConfig

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| salePhase | NORMAL | 現在のセールフェーズ |
| baselineDays | 30 | baseline期間の長さ |
| presaleWindowDays | 5 | プレセール期間の長さ |
| baselineMinClicks | 20 | baseline最小クリック数 |
| presaleMinClicks | 10 | presale最小クリック数 |

#### PresaleThresholdConfig

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| minCvrRatioForBuying | 0.9 | BUYING判定CVR比率下限 |
| maxAcosRatioForBuying | 1.2 | BUYING判定ACOS比率上限 |
| maxCvrRatioForHoldBack | 0.6 | HOLD_BACK判定CVR比率上限 |
| minAcosRatioForHoldBack | 1.3 | HOLD_BACK判定ACOS比率下限 |

### 32.10 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/presale/types.ts` | 型定義、デフォルトポリシー |
| `src/presale/diagnosis.ts` | diagnosePresaleType、createPresaleContext |
| `src/presale/defense-integration.ts` | 防御アクション調整 |
| `src/presale/offense-integration.ts` | 攻めアクション調整 |
| `tests/presale/*.test.ts` | テスト |

---

## 33. T_opt推定とライフサイクル別TACOS（Analytics）

### 33.1 概要

ASIN単位で利益最大化TACOS（T_opt）を推計し、ライフサイクルステージに応じた
TACOS目標値（T_launch, T_grow, T_harvest）を動的に算出するモジュール。

```typescript
// src/analytics/optimalTacos.ts

/**
 * 主要機能:
 * 1. 過去データからT_opt（利益最大化TACOS）を推計
 * 2. ライフサイクル別TACOS目標値の算出
 * 3. LaunchInvest_total（ローンチ投資額）の計算
 * 4. targetNetMargin_mid_product = g - T_opt
 */
```

### 33.2 数学的定義

#### ポテンシャル粗利率 g

```
g = (売価 - 原価 - 手数料 - 配送費等) / 売価

注意: 広告費は含めない（二重カウント防止）
```

ProductConfigでは `marginRateNormal` として管理。

#### 日次利益の計算

```
netProfit_d = sales_d × g - adCost_d
            = sales_d × (g - TACOS_d)
```

### 33.3 T_opt推計ロジック

```typescript
interface OptimalTacosConfig {
  marginPotential: number;    // g
  binWidth: number;           // 例: 0.03 = 3%刻み
  minTacos: number;           // 例: 0.02
  maxTacos: number;           // 例: 0.60
  minDaysPerBin: number;      // 例: 3
  fallbackTopt: number;       // 例: 0.15
}

interface OptimalTacosResult {
  tOpt: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  usedFallback: boolean;
  validDaysUsed: number;
  validBinCount: number;
  optimalBinProfit: number | null;
  optimalBinTacos: number | null;
  calculationNote: string;
}
```

**推計アルゴリズム:**
1. 有効データをフィルタリング（revenue > 0, TACOS範囲内）
2. 各日の利益を計算: Profit_d = revenue_d × (g - TACOS_d)
3. TACOSをビン分けして各ビンの合計利益を計算
4. 合計利益最大のビンの平均TACOSをT_optとして採用

**信頼度判定:**

| 信頼度 | 条件 |
|-------|------|
| HIGH | validDays >= 90 かつ validBins >= 5 |
| MEDIUM | validDays >= 30 かつ validBins >= 3 |
| LOW | 上記以外 or フォールバック使用 |

### 33.4 ライフサイクル別TACOS目標値

```typescript
interface LifecycleTacosConfig {
  alphaLaunch: number;   // ローンチ攻めオフセット（例: 0.30）
  alphaHarvest: number;  // ハーベスト絞りオフセット（例: 0.25）
  softFactor: number;    // LAUNCH_SOFTの緩和係数（例: 0.5）
}
```

#### 計算式

| ステージ | 計算式 |
|---------|--------|
| LAUNCH_HARD | T_launch = min(g, T_opt × (1 + α_L)) |
| LAUNCH_SOFT | T_soft = min(g, T_opt × (1 + α_L × softFactor)) |
| GROW | T_grow = T_opt |
| HARVEST | T_harvest = max(0, T_opt × (1 - α_H)) |

#### 数値例

```
g = 0.55, T_opt = 0.15
α_L = 0.30, α_H = 0.25, softFactor = 0.5

T_launch  = min(0.55, 0.15 × 1.30) = 19.5%
T_soft    = min(0.55, 0.15 × 1.15) = 17.25%
T_grow    = 15%
T_harvest = max(0, 0.15 × 0.75) = 11.25%
```

### 33.5 ターゲットネットマージン

```
targetNetMargin_mid_product = g - T_opt

例: g=0.55, T_opt=0.15 → 0.40 (40%)
```

GROWステージでの商品別目標純利益率。

### 33.6 ローンチ投資計算

```typescript
interface LaunchInvestmentMetrics {
  launchInvestTotal: number;       // ローンチ追加投資額
  launchSalesTotal: number;        // ローンチ期間売上
  launchTacosAverage: number;      // 平均TACOS
  estimatedRecoverySales: number | null;
  estimatedRecoveryProfit: number | null;
  calculationNote: string;
}
```

#### 計算式

```
LaunchInvest_total = Σ(sales_d × (TACOS_d - T_opt))  [d ∈ ローンチ期間]

投資回収必要売上 = LaunchInvest_total / (g - T_opt)
```

### 33.7 使用例

```typescript
import {
  estimateTopt,
  calculateLifecycleTacosTargets,
  calculateLaunchInvestment,
  optimizeAsinTacos,
} from "./analytics";

// 1. T_opt推計
const tOptResult = estimateTopt(dailyData, {
  marginPotential: 0.55,
  binWidth: 0.03,
  minTacos: 0.02,
  maxTacos: 0.60,
  minDaysPerBin: 3,
  fallbackTopt: 0.15,
});
// tOptResult.tOpt === 0.15
// tOptResult.confidence === "HIGH"

// 2. ライフサイクル別TACOS目標
const targets = calculateLifecycleTacosTargets(
  tOptResult.tOpt,
  0.55,
  "GROW",
  { alphaLaunch: 0.30, alphaHarvest: 0.25, softFactor: 0.5 }
);
// targets.tLaunch === 0.195
// targets.tGrow === 0.15
// targets.currentTarget === 0.15

// 3. 統合最適化
const optimization = optimizeAsinTacos(
  "B00TEST123",
  dailyData,
  "GROW",
  0.55,
  launchPeriodData
);
// optimization.targetNetMarginMidProduct === 0.40
```

### 33.8 tacosHealth.tsとの関係

| モジュール | 役割 |
|-----------|------|
| tacosHealth.ts | 現在のTACOSが健全かを評価（tacosHealthScore, TacosZone） |
| optimalTacos.ts | 目標とすべきTACOSを推計（T_opt, T_launch/grow/harvest） |

両モジュールは相互補完的に動作。

### 33.9 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/analytics/optimalTacos.ts` | T_opt推計、ライフサイクルTACOS計算 |
| `src/analytics/index.ts` | エクスポート |
| `tests/analytics/optimalTacos.test.ts` | テスト |

---

## 34. lossBudget評価（ASIN投資健全性）

### 34.1 概要

ASIN単位で投資の健全性を評価し、ライフサイクルステージ × 投資状態に基づいて
キーワードレベルの入札アクションを制御するモジュール。

```typescript
// src/analytics/lossBudgetEvaluator.ts

/**
 * ASIN投資健全性評価モジュール
 *
 * 主な機能:
 * 1. profitGap計算（目標利益との乖離測定）
 * 2. lossBudget算出（ライフサイクル別許容損失枠）
 * 3. InvestmentState判定（SAFE/WATCH/LIMIT/BREACH）
 * 4. ActionConstraints生成（入札アクション制約）
 */
```

### 34.2 コア計算式

#### profitGap（利益ギャップ）

```
profitGap = targetNetProfit - actualNetProfit

where:
  targetNetProfit = S × (g - T_opt)    // 目標利益
  actualNetProfit = S × g - A          // 実際の利益

  S = 評価期間内の売上
  g = marginPotential（粗利ポテンシャル）
  T_opt = 利益最大化TACOS（セクション33参照）
  A = 評価期間内の広告費
```

#### lossBudget（許容損失枠）

```
lossBudget_stage = targetNetProfit × lossBudgetMultiple_stage

// ライフサイクル別倍率（デフォルト）
| ステージ | lossBudgetMultiple | 説明 |
|----------|-------------------|------|
| LAUNCH_HARD | 2.5 | 積極投資期、大きな許容枠 |
| LAUNCH_SOFT | 2.0 | ローンチ後期、やや縮小 |
| GROW | 1.5 | 成長期、バランス重視 |
| HARVEST | 0.8 | 収穫期、利益確保重視 |
```

#### ratioStage（lossBudget消費率）

```
ratioStage = profitGap / lossBudget_stage

// 特殊ケース
- profitGap ≤ 0（目標超過）: ratioStage = 0 → SAFE
- lossBudget ≤ 0: 最小フロア値 (0.01 * targetNetProfit) を適用
```

### 34.3 InvestmentState（投資状態）

```
| InvestmentState | 条件 | 意味 | 推奨アクション |
|-----------------|------|------|---------------|
| SAFE | ratioStage < 0.5 | 健全、余裕あり | 通常運用 |
| WATCH | 0.5 ≤ ratioStage < 0.8 | 注意、監視強化 | 上昇幅抑制 |
| LIMIT | 0.8 ≤ ratioStage < 1.0 | 警戒、投資抑制 | 積極投資停止 |
| BREACH | ratioStage ≥ 1.0 | 超過、投資停止 | 規模縮小検討 |
```

### 34.4 ActionConstraints（アクション制約）

ライフサイクルステージ × InvestmentStateの組み合わせで、キーワードレベルの
入札アクションを制御。

#### 34.4.1 LAUNCH期（LAUNCH_HARD/LAUNCH_SOFT）

**設計方針**: LAUNCH期は**STOP/NEGを封印**し、ASIN単位のlossBudgetで全体制御。
キーワード単位では「損切り」ではなく「入札調整」で対応。

```typescript
// LAUNCH_HARD + SAFE
{
  allowStop: false,       // STOP封印
  allowNeg: false,        // NEG封印
  allowStrongDown: false, // 急激な下げは避ける
  allowDown: true,        // 緩やかな調整は許可
  allowUp: true,
  allowStrongUp: true,
  maxUpMultiplier: 1.3,   // 最大130%まで
  maxDownPercent: 10,     // 最大10%下げ
}

// LAUNCH期 InvestmentState別制約
| State | STOP | NEG | STRONG_DOWN | DOWN | UP | STRONG_UP | maxUp | maxDown |
|-------|------|-----|-------------|------|-----|-----------|-------|---------|
| SAFE | × | × | × | ○ | ○ | ○ | 1.3 | 10% |
| WATCH | × | × | × | ○ | △ | △ | 1.2 | 10% |
| LIMIT | × | × | × | ○ | △ | × | 1.1 | 12% |
| BREACH | × | × | × | ○ | × | × | 1.0 | 15% |
```

#### 34.4.2 GROW期

```typescript
// GROW + SAFE: 全アクション許可
{
  allowStop: true,
  allowNeg: true,
  allowStrongDown: true,
  allowDown: true,
  allowUp: true,
  allowStrongUp: true,
  maxUpMultiplier: 1.3,
  maxDownPercent: 15,
}

// GROW期 InvestmentState別制約
| State | STOP | NEG | STRONG_DOWN | DOWN | UP | STRONG_UP | maxUp | maxDown |
|-------|------|-----|-------------|------|-----|-----------|-------|---------|
| SAFE | ○ | ○ | ○ | ○ | ○ | ○ | 1.3 | 15% |
| WATCH | ○ | ○ | ○ | ○ | △ | △ | 1.15 | 15% |
| LIMIT | ○ | ○ | ○ | ○ | △ | × | 1.1 | 18% |
| BREACH | ○ | ○ | ○ | ○ | × | × | 1.0 | 20% |
```

#### 34.4.3 HARVEST期

```typescript
// HARVEST + SAFE: 利益確保重視
{
  allowStop: true,
  allowNeg: true,
  allowStrongDown: true,
  allowDown: true,
  allowUp: true,
  allowStrongUp: false,   // 収穫期は強い上昇を抑制
  maxUpMultiplier: 1.15,  // 控えめ
  maxDownPercent: 15,
}

// HARVEST期 InvestmentState別制約
| State | STOP | NEG | STRONG_DOWN | DOWN | UP | STRONG_UP | maxUp | maxDown |
|-------|------|-----|-------------|------|-----|-----------|-------|---------|
| SAFE | ○ | ○ | ○ | ○ | △ | × | 1.15 | 15% |
| WATCH | ○ | ○ | ○ | ○ | △ | × | 1.1 | 18% |
| LIMIT | ○ | ○ | ○ | ○ | × | × | 1.0 | 20% |
| BREACH | ○ | ○ | ○++ | ○++ | × | × | 1.0 | 25% |
```

凡例: ○=許可、△=制限付き許可、×=禁止、++=積極的に実行

### 34.5 型定義

```typescript
export enum InvestmentState {
  SAFE = "SAFE",
  WATCH = "WATCH",
  LIMIT = "LIMIT",
  BREACH = "BREACH",
}

export interface AsinPeriodPerformance {
  asin: string;
  lifecycleStage: LifecycleState;  // "LAUNCH_HARD" | "LAUNCH_SOFT" | "GROW" | "HARVEST"
  periodStartDate: string;         // ISO8601形式
  periodEndDate: string;
  totalSales: number;
  totalAdSpend: number;
  totalConversions: number;
}

export interface LossBudgetConfig {
  evaluationWindowDays: number;    // デフォルト30日
  lossBudgetMultiples: {
    LAUNCH_HARD: number;  // 2.5
    LAUNCH_SOFT: number;  // 2.0
    GROW: number;         // 1.5
    HARVEST: number;      // 0.8
  };
  thresholdSafe: number;   // 0.5
  thresholdWatch: number;  // 0.8
}

export interface AsinLossBudgetMetrics {
  asin: string;
  lifecycleStage: LifecycleState;
  targetNetProfit: number;
  actualNetProfit: number;
  profitGap: number;
  lossBudget: number;
  ratioStage: number;
  investmentState: InvestmentState;
  periodStartDate: string;
  periodEndDate: string;
}

export interface ActionConstraints {
  allowStop: boolean;
  allowNeg: boolean;
  allowStrongDown: boolean;
  allowDown: boolean;
  allowUp: boolean;
  allowStrongUp: boolean;
  maxUpMultiplier: number;
  maxDownPercent: number;
}
```

### 34.6 主要関数

```typescript
// 単一ASIN評価
export function evaluateAsinLossBudget(
  perf: AsinPeriodPerformance,
  g: number,                                    // 粗利ポテンシャル
  tOpt: number,                                 // T_opt
  config?: LossBudgetConfig
): AsinLossBudgetMetrics;

// 複数ASIN一括評価
export function evaluateAllAsins(
  performances: AsinPeriodPerformance[],
  marginPotentialMap: Map<string, number>,      // ASIN → g
  tOptMap: Map<string, number>,                 // ASIN → T_opt
  config?: LossBudgetConfig
): AsinLossBudgetMap;

// アクション制約取得
export function getActionConstraints(
  lifecycleStage: LifecycleState,
  investmentState: InvestmentState
): ActionConstraints;
```

### 34.7 ユーティリティ関数

```typescript
// 警告状態か（WATCH以上）
export function isWarningState(state: InvestmentState): boolean;

// クリティカル状態か（LIMIT以上）
export function isCriticalState(state: InvestmentState): boolean;

// ライフサイクル移行検討が必要か
export function shouldConsiderLifecycleTransition(
  lifecycleStage: LifecycleState,
  investmentState: InvestmentState
): boolean;

// アラートサマリー生成
export function generateAlertSummary(
  metrics: AsinLossBudgetMetrics
): { level: "none" | "info" | "warning" | "critical"; message: string };
```

### 34.8 使用例

```typescript
import {
  evaluateAsinLossBudget,
  evaluateAllAsins,
  getActionConstraints,
  InvestmentState,
  DEFAULT_LOSS_BUDGET_CONFIG,
} from "./analytics";

// 1. 単一ASIN評価
const metrics = evaluateAsinLossBudget(
  {
    asin: "B00TEST123",
    lifecycleStage: "GROW",
    periodStartDate: "2025-01-01",
    periodEndDate: "2025-01-30",
    totalSales: 100000,
    totalAdSpend: 20000,
    totalConversions: 50,
  },
  0.55,  // g
  0.15,  // T_opt
  DEFAULT_LOSS_BUDGET_CONFIG
);
// metrics.investmentState === "WATCH"
// metrics.ratioStage === 0.606...

// 2. bidEngineとの統合
const constraints = getActionConstraints(
  metrics.lifecycleStage,
  metrics.investmentState
);

if (proposedAction === "STRONG_UP" && !constraints.allowStrongUp) {
  // STRONG_UPが禁止されている場合、UPに変更
  proposedAction = constraints.allowUp ? "UP" : "STAY";
}

if (proposedAction === "UP") {
  newBid = Math.min(
    currentBid * proposedMultiplier,
    currentBid * constraints.maxUpMultiplier
  );
}

// 3. LAUNCH期でのSTOP/NEG制御
if (metrics.lifecycleStage.startsWith("LAUNCH")) {
  if (proposedAction === "STOP" || proposedAction === "NEG") {
    // LAUNCH期はSTOP/NEGを封印、DOWNに変更
    proposedAction = "DOWN";
    logger.info(`LAUNCH期のためSTOP/NEGをDOWNに変更: ${metrics.asin}`);
  }
}
```

### 34.9 optimalTacos.tsとの関係

| モジュール | 入力 | 出力 | 役割 |
|-----------|------|------|------|
| optimalTacos.ts | 日次データ | T_opt, T_launch/grow/harvest | 目標TACOSを推計 |
| lossBudgetEvaluator.ts | T_opt, 期間パフォーマンス | InvestmentState, ActionConstraints | 投資健全性を評価、アクション制約 |

両モジュールは連携して動作:
1. optimalTacos.ts で T_opt を推計
2. lossBudgetEvaluator.ts で T_opt を使って targetNetProfit を計算
3. profitGap, lossBudget, ratioStage を算出
4. InvestmentState を判定
5. ActionConstraints を生成してbidEngineに渡す

### 34.10 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/analytics/lossBudgetEvaluator.ts` | 投資健全性評価、アクション制約 |
| `src/analytics/lossBudgetRepository.ts` | BigQueryからのデータ取得 |
| `src/analytics/index.ts` | エクスポート |
| `tests/analytics/lossBudgetEvaluator.test.ts` | テスト |
| `tests/analytics/lossBudgetSummary.test.ts` | LossBudgetSummaryテスト |

### 34.11 LossBudgetState（簡易3状態）

InvestmentState（4状態）をシンプルな3状態にマッピングした型。roleGuardrailsとの統合に使用。

```typescript
export type LossBudgetState = "SAFE" | "WARNING" | "CRITICAL";

// InvestmentState → LossBudgetState マッピング
// SAFE → SAFE
// WATCH, LIMIT → WARNING
// BREACH → CRITICAL
```

### 34.12 LossBudgetSummary

ローリング期間（30日）とローンチ期間全体の両方の消費率を含むサマリー構造体。

```typescript
export interface LossBudgetSummary {
  asin: string;
  lossBudgetConsumptionRolling: number;  // 期間w（30日）の損失消費率
  lossBudgetConsumptionLaunch: number;   // ローンチ期間全体の損失消費率
  launchInvestUsageRatio: number;        // ローンチ追加投資枠の使用率
  state: LossBudgetState;                // 統合されたLossBudgetState
  maxConsumption: number;                // 最大消費率
  periodStart: string;
  periodEnd: string;
}

export interface LossBudgetStateConfig {
  warningThreshold: number;              // 0.5（50%でWARNING）
  criticalThreshold: number;             // 0.9（90%でCRITICAL）
  launchInvestWarningThreshold: number;  // 0.5
  launchInvestCriticalThreshold: number; // 1.0（100%でCRITICAL）
}

export const DEFAULT_LOSS_BUDGET_STATE_CONFIG: LossBudgetStateConfig = {
  warningThreshold: 0.5,
  criticalThreshold: 0.9,
  launchInvestWarningThreshold: 0.5,
  launchInvestCriticalThreshold: 1.0,
};
```

### 34.13 LossBudgetState判定ロジック

```typescript
export function resolveLossBudgetState(
  rollingConsumption: number,
  launchConsumption: number,
  launchInvestUsage: number,
  config: LossBudgetStateConfig = DEFAULT_LOSS_BUDGET_STATE_CONFIG
): LossBudgetState {
  const maxConsumption = Math.max(
    rollingConsumption,
    launchConsumption,
    launchInvestUsage
  );

  // CRITICAL判定（緊急停止レベル）
  if (maxConsumption >= config.criticalThreshold ||
      launchInvestUsage >= config.launchInvestCriticalThreshold) {
    return "CRITICAL";
  }

  // WARNING判定（注意レベル）
  if (maxConsumption >= config.warningThreshold ||
      launchInvestUsage >= config.launchInvestWarningThreshold) {
    return "WARNING";
  }

  return "SAFE";
}

// ファクトリ関数
export function createLossBudgetSummary(
  asin: string,
  rollingConsumption: number,
  launchConsumption: number,
  launchInvestUsage: number,
  periodStart: string,
  periodEnd: string,
  config?: LossBudgetStateConfig
): LossBudgetSummary {
  const state = resolveLossBudgetState(
    rollingConsumption,
    launchConsumption,
    launchInvestUsage,
    config
  );
  return {
    asin,
    lossBudgetConsumptionRolling: rollingConsumption,
    lossBudgetConsumptionLaunch: launchConsumption,
    launchInvestUsageRatio: launchInvestUsage,
    state,
    maxConsumption: Math.max(rollingConsumption, launchConsumption, launchInvestUsage),
    periodStart,
    periodEnd,
  };
}
```

### 34.14 BigQuery集計ビュー

#### asin_rolling_30d_summary

ASINごとに直近30日間の売上・広告費・利益指標を集計し、lossBudgetConsumption_wを計算。

```sql
-- src/bigquery/schemas/asin_rolling_30d_summary.sql
-- 主要カラム
asin, period_start, period_end, lifecycle_stage_w,
g, t_opt, loss_budget_multiple_stage,
sales_w, ad_cost_w, impressions_w, clicks_w, orders_w,
target_net_margin_mid,     -- g - T_opt
net_profit_real_w,         -- sales_w × g - adCost_w
net_profit_target_w,       -- sales_w × (g - T_opt)
loss_gap_w,                -- GREATEST(target - real, 0)
loss_budget_allowed_w,     -- netProfit_target_w × lossBudgetMultiple_stage
loss_budget_consumption_w, -- lossGap_w / lossBudgetAllowed_w
tacos_w, acos_w
```

#### asin_launch_invest_summary

ローンチ期間全体のLaunchInvest指標を計算。

```sql
-- src/bigquery/schemas/asin_launch_invest_summary.sql
-- 主要カラム
asin, launch_start_date, launch_end_date, days_in_launch,
g, t_opt, t_launch,
sales_launch, ad_cost_launch,
ad_cost_opt_launch,            -- sales_launch × T_opt
extra_ad_cost_launch_real,     -- GREATEST(adCost_launch - adCost_opt_launch, 0)
launch_invest_total_design,    -- sales_launch × (T_launch - T_opt)
launch_invest_usage_ratio,     -- extraAdCost_launch_real / LaunchInvest_total_design
loss_budget_consumption_launch
```

### 34.15 LaunchInvest計算式

```
adCost_opt_launch = sales_launch × T_opt
extraAdCost_launch_real = GREATEST(adCost_launch - adCost_opt_launch, 0)
LaunchInvest_total_design = sales_launch × (T_launch - T_opt)
LaunchInvest_usage_ratio = extraAdCost_launch_real / LaunchInvest_total_design
```

| 指標 | 説明 | 例 |
|------|------|-----|
| adCost_opt_launch | T_opt運用だった場合の広告費 | 100万 × 0.15 = 15万 |
| extraAdCost_launch_real | 実際の追加広告投資額 | 25万 - 15万 = 10万 |
| LaunchInvest_total_design | 設計上のローンチ追加投資枠 | 100万 × (0.25 - 0.15) = 10万 |
| LaunchInvest_usage_ratio | 追加投資枠の使用率 | 10万 / 10万 = 1.0 (100%) |

---

## 35. SEOローンチ評価（Launch Exit Decision）

### 35.1 概要

LAUNCH期のASINについて、コアSEOキーワードの進捗状況とlossBudgetを監視し、
「いつLAUNCHを終えてGROWへ移行するか」を判定するモジュール。

```typescript
// src/lifecycle/seo-launch-evaluator.ts

/**
 * SEOローンチ評価モジュール
 *
 * 主な機能:
 * 1. KeywordCoreRole: キーワードのSEO重要度分類
 * 2. SeoLaunchStatus: キーワード単位のローンチ進捗状態
 * 3. AsinSeoLaunchProgress: ASIN単位のコアSEO完了率
 * 4. LaunchExitDecision: 通常終了/緊急終了の判定
 */
```

### 35.2 コアSEOキーワードの定義

#### KeywordCoreRole

```typescript
export enum KeywordCoreRole {
  CORE = "CORE",           // 本気で上位を取りに行くコアSEOキーワード
  SUPPORT = "SUPPORT",     // 周辺や補助キーワード
  EXPERIMENT = "EXPERIMENT", // 実験枠や評価前
}

export enum CoreKeywordType {
  BIG = "BIG",       // ビッグキーワード（1-3語）
  MIDDLE = "MIDDLE", // ミドルレンジ（3-7語）
  BRAND = "BRAND",   // ブランド名・指名系
}
```

#### CORE選定の目安

| タイプ | 目安数 | 特徴 |
|-------|--------|------|
| BIG | 1-3語 | 検索ボリューム大、競合激しい |
| MIDDLE | 3-7語 | バランス型、現実的な上位狙い |
| BRAND | 1-3語 | 指名検索、高CVR期待 |
| 合計 | 5-12語/ASIN | AEI・検索ボリュームで優先順位付け |

#### コアキーワード上限設定

```typescript
export interface CoreKeywordLimits {
  maxCoreBigPerAsin: number;     // デフォルト3
  maxCoreMiddlePerAsin: number;  // デフォルト7
  maxCoreBrandPerAsin: number;   // デフォルト3
  maxCoreTotalPerAsin: number;   // デフォルト12
}
```

### 35.3 SeoLaunchStatus（ローンチ進捗状態）

```typescript
export enum SeoLaunchStatus {
  ACTIVE = "ACTIVE",     // まだSEOを押し上げ中
  ACHIEVED = "ACHIEVED", // 目標順位帯まで到達
  GAVE_UP = "GAVE_UP",   // これ以上は現実的ではないと判断
}
```

#### ACHIEVED判定条件

```
coreRole = CORE
AND currentRank <= targetRankMax
AND impressionsTotal >= minImpressionsForRank
AND clicksTotal >= minClicksForRank
```

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| targetRankMax | 設定値 | BIG=3位、MIDDLE=5位など |
| minImpressionsForRank | 500 | 順位評価に必要な最小インプレッション |
| minClicksForRank | 30 | 順位評価に必要な最小クリック |

#### GAVE_UP判定条件

**パターン1: 順位が悪い場合**

```
coreRole = CORE
AND clicksTotal >= minClicksForGiveUp
AND costTotal >= targetCPA × minCostMultiplierForGiveUp
AND bestRankWindow > maxBestRankForGiveUp
AND daysWithRankData >= minDaysActive
```

**パターン2: パフォーマンスが悪い場合**

```
coreRole = CORE
AND clicksTotal >= minClicksForGiveUp
AND costTotal >= targetCPA × minCostMultiplierForGiveUp
AND cvr <= maxCvrForGiveUp
AND acos >= maxAcosForGiveUp
```

※CVR = 注文数 / クリック数
※ACOS = 広告費 / 売上（標準的なAmazon広告のACOS定義）

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| minClicksForGiveUp | 200 | 十分試したとみなすクリック数 |
| minCostMultiplierForGiveUp | 10 | targetCPA何倍相当まで燃やしたか |
| maxBestRankForGiveUp | 20 | これより悪い順位のままなら諦め |
| minDaysActive | 30 | 少なくとも何日試したか |
| maxCvrForGiveUp | 0.5% | これ以下のCVRは効率悪い |
| maxAcosForGiveUp | 200% | これ以上のACOSは効率悪い |

#### volumeBucket ベースの動的閾値

GAVE_UP の `minDays` および `minClicks` は、キーワードの検索ボリュームに応じて動的に調整されます。

**volumeBucket 分類:**

```
volumeRatio = searchVolume_k / medianVolume_core

HIGH_VOLUME: volumeRatio >= 2.0
MID_VOLUME:  0.5 <= volumeRatio < 2.0
LOW_VOLUME:  volumeRatio < 0.5
```

**動的閾値計算:**

```typescript
// ベース閾値（tier別）
baseDays  = tier === "BIG" ? 60 : 45
baseClicks = tier === "BIG" ? 150 : 100

// volumeBucket倍率
multiplier = bucket === "HIGH_VOLUME" ? 1.3
           : bucket === "LOW_VOLUME"  ? 0.7
           : 1.0

// 最終閾値
minDays   = Math.round(baseDays × multiplier)
minClicks = Math.round(baseClicks × multiplier)
```

**閾値早見表:**

| tier | volumeBucket | minDays | minClicks | rankThreshold |
|------|-------------|---------|-----------|---------------|
| BIG | HIGH_VOLUME | 78 | 195 | 50 |
| BIG | MID_VOLUME | 60 | 150 | 45 |
| BIG | LOW_VOLUME | 42 | 105 | 40 |
| MIDDLE | HIGH_VOLUME | 59 | 130 | 35 |
| MIDDLE | MID_VOLUME | 45 | 100 | 30 |
| MIDDLE | LOW_VOLUME | 32 | 70 | 25 |

**順位閾値 (giveUpRankThreshold):**

tier固定の基本値に対し、volumeBucket で ±5 の微調整:

```
BIG基本値: 45  → HIGH:50 / MID:45 / LOW:40
MIDDLE基本値: 30  → HIGH:35 / MID:30 / LOW:25
```

**設計思想:**

- **HIGH_VOLUME**: ビッグキーワードは競争が激しくデータ蓄積に時間がかかるため、より長い猶予期間を設定
- **LOW_VOLUME**: ニッチキーワードは早期判断が可能なため、素早く諦め判定を行いリソースを節約
- **順位は tier 固定基調**: 検索ボリュームに関わらず目指すべき順位帯は tier で決まるため、大きな変動を避ける

### 35.4 AsinSeoLaunchProgress（ASIN別SEOローンチ進捗）

```typescript
export interface AsinSeoLaunchProgress {
  asin: string;
  totalCoreKeywords: number;   // COREキーワード総数
  achievedCount: number;       // ACHIEVED数
  gaveUpCount: number;         // GAVE_UP数
  activeCount: number;         // ACTIVE数
  completionRatio: number;     // (achieved + gaveUp) / total
  successRatio: number;        // achieved / total
}
```

**completionRatio計算**:
```
completionRatio = (achievedCount + gaveUpCount) / totalCoreKeywords
```

「達成」または「諦め」で決着がついたキーワードの割合。

### 35.5 ローンチ終了条件の三軸

> **参照**: 各指標の詳細な日本語名と意味については `docs/architecture.md` の「付録: ライフサイクル関連指標一覧」を参照してください。

#### A. SEO条件（必須）

```
completionRatio >= minCoreCompletionRatio
```

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| minCoreCompletionRatio | 0.7 | 70%のCOREキーワードが決着 |

#### B. 時間/データ条件（早期終了防止）

以下のいずれか1つ以上:
```
daysSinceLaunch >= minLaunchDays
OR asinClicksTotal >= minAsinClicksTotal
OR asinOrdersTotal >= minAsinOrdersTotal
```

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| minLaunchDays | 45 | 最低継続日数 |
| minAsinClicksTotal | 2500 | ASIN累計クリック閾値 |
| minAsinOrdersTotal | 80 | ASIN累計注文閾値 |

#### C. lossBudget条件（緊急ブレーキ）

```
investmentState = BREACH
OR ratioStage > emergencyLossRatioThreshold
```

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| emergencyLossRatioThreshold | 1.2 | lossBudget120%超過で緊急終了 |

### 35.6 LaunchExitDecision（ローンチ終了判定）

```typescript
export interface LaunchExitDecision {
  asin: string;
  shouldExitLaunch: boolean;        // LAUNCHを抜けるか
  isEmergencyExit: boolean;         // 緊急終了か
  reasonCodes: LaunchExitReasonCode[];
  reasonMessage: string;
  recommendedNextStage: LifecycleStage;
  seoProgress: AsinSeoLaunchProgress;           // ASIN別SEOローンチ進捗
  lossBudgetMetrics?: AsinLossBudgetMetrics;    // ASIN別損失予算メトリクス
}

export type LaunchExitReasonCode =
  | "CORE_COMPLETION"        // コアSEO完了率達成
  | "DAYS_OR_DATA"           // 時間/データ条件達成
  | "LOSS_BUDGET_EMERGENCY"  // lossBudget緊急終了
  | "NOT_READY";             // 終了条件未達
```

### 35.7 判定ロジック

```typescript
export function decideLaunchExit(
  asin: string,
  lifecycleStage: LifecycleStage,
  daysSinceLaunch: number,
  asinClicksTotal: number,
  asinOrdersTotal: number,
  progress: AsinSeoLaunchProgress,
  lossBudget: AsinLossBudgetMetrics | null,
  thresholds: LaunchExitThresholds
): LaunchExitDecision {
  // 1. 緊急終了判定（優先）
  if (lossBudget?.investmentState === "BREACH" ||
      (lossBudget?.ratioStage ?? 0) > thresholds.emergencyLossRatioThreshold) {
    return {
      shouldExitLaunch: true,
      isEmergencyExit: true,
      reasonCodes: ["LOSS_BUDGET_EMERGENCY"],
      recommendedNextStage: "GROW",
      ...
    };
  }

  // 2. 通常終了判定
  const seoOk = progress.completionRatio >= thresholds.minCoreCompletionRatio;
  const trialOk = daysSinceLaunch >= thresholds.minLaunchDays ||
                  asinClicksTotal >= thresholds.minAsinClicksTotal ||
                  asinOrdersTotal >= thresholds.minAsinOrdersTotal;

  if (seoOk && trialOk) {
    return {
      shouldExitLaunch: true,
      isEmergencyExit: false,
      reasonCodes: ["CORE_COMPLETION", "DAYS_OR_DATA"],
      recommendedNextStage: "GROW",
      ...
    };
  }

  // 3. 継続
  return {
    shouldExitLaunch: false,
    isEmergencyExit: false,
    reasonCodes: ["NOT_READY"],
    ...
  };
}
```

### 35.8 LAUNCH期の守りルール

SEOローンチ評価導入後も、LAUNCH期の以下のルールは**必ず維持**:

| アクション | LAUNCH_HARD | LAUNCH_SOFT | 理由 |
|-----------|-------------|-------------|------|
| STOP | × 封印 | × 封印 | 芽を殺さない |
| NEG | × 封印 | × 封印 | 芽を殺さない |
| STRONG_DOWN | × 原則禁止 | × 原則禁止 | 急激な入札減を避ける |
| DOWN | △ 小幅のみ | △ 小幅のみ | 緩やかな調整は許可 |

**思想**:
- ローンチ中は「芽を殺さない」ことを最優先
- 終了タイミングは「SEO完了率 + 試行量」と「lossBudget」の二段構えで判定
- GROW移行後にSTOP/NEG/STRONG_DOWNを解禁

### 35.9 通常終了と緊急終了の違い

| 項目 | 通常終了 | 緊急終了 |
|------|---------|---------|
| トリガー | SEO完了率 + 試行条件 | lossBudget超過 |
| SEO完了率 | 70%以上必要 | 関係なし |
| 次ステージ | GROW | GROW |
| 通知 | info | critical |
| 意味 | 「やるだけやった」 | 「これ以上は危険」 |

### 35.10 ASIN固有スケーリングロジック

ローンチ終了判定の閾値は、ASINの販売規模に応じて動的にスケーリングされます。

#### volumeScale計算

```typescript
volumeRaw = avgDailySales30d ÷ refDailySales
volumeScale_asin = clamp(volumeRaw, minVolumeScale, maxVolumeScale)
```

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| refDailySales | 20 | 基準日販数 |
| minVolumeScale | 0.5 | スケールの下限 |
| maxVolumeScale | 2.0 | スケールの上限 |

#### スケーリング対象と非対象

| パラメータ | スケーリング | 計算式 |
|-----------|-------------|--------|
| minAsinClicksTotal | ○ | base × volumeScale |
| minAsinOrdersTotal | ○ | base × volumeScale |
| minLaunchDays | × | 固定 |
| minCoreCompletionRatio | × | 固定 |
| emergencyLossRatioThreshold | × | 固定 |

#### 計算例

| 日販数 | volumeScale | クリック閾値 | 注文閾値 |
|--------|-------------|-------------|---------|
| 5 | 0.5 | 1,250 | 40 |
| 20 | 1.0 | 2,500 | 80 |
| 30 | 1.5 | 3,750 | 120 |
| 50+ | 2.0 | 5,000 | 160 |

#### インターフェース

```typescript
// プロファイルレベルのベース閾値
export interface LaunchExitBaseThresholds {
  baseMinLaunchDays: number;           // 45
  baseMinAsinClicksTotal: number;      // 2500
  baseMinAsinOrdersTotal: number;      // 80
  minCoreCompletionRatio: number;      // 0.7
  emergencyLossRatioThreshold: number; // 1.2
  refDailySales: number;               // 20
  minVolumeScale: number;              // 0.5
  maxVolumeScale: number;              // 2.0
}

// ASIN固有のスケーリング済み閾値
export interface LaunchExitThresholdsComputed {
  asin: string;
  volumeScale: number;
  avgDailySales30d: number;
  minLaunchDays: number;
  minAsinClicksTotal: number;
  minAsinOrdersTotal: number;
  minCoreCompletionRatio: number;
  emergencyLossRatioThreshold: number;
}
```

#### スケーリング計算関数

```typescript
export function computeLaunchExitThresholdsForAsin(
  asin: string,
  base: LaunchExitBaseThresholds,
  avgDailySales30d: number
): LaunchExitThresholdsComputed {
  const volumeRaw = avgDailySales30d / base.refDailySales;
  const volumeScale = Math.max(
    base.minVolumeScale,
    Math.min(base.maxVolumeScale, volumeRaw)
  );

  return {
    asin,
    volumeScale,
    avgDailySales30d,
    minLaunchDays: base.baseMinLaunchDays,  // スケーリングなし
    minAsinClicksTotal: Math.round(base.baseMinAsinClicksTotal * volumeScale),
    minAsinOrdersTotal: Math.round(base.baseMinAsinOrdersTotal * volumeScale),
    minCoreCompletionRatio: base.minCoreCompletionRatio,
    emergencyLossRatioThreshold: base.emergencyLossRatioThreshold,
  };
}
```

#### スケーリング版の終了判定

```typescript
export function decideLaunchExitWithScaling(
  asin: string,
  lifecycleStage: LifecycleStage,
  daysSinceLaunch: number,
  asinClicksTotal: number,
  asinOrdersTotal: number,
  progress: AsinSeoLaunchProgress,
  lossBudget: AsinLossBudgetMetrics | null,
  computedThresholds: LaunchExitThresholdsComputed
): LaunchExitDecision {
  // 基本判定を実行し、volumeScaleとthresholdsUsedを追加
  const decision = decideLaunchExit(..., computedThresholds);
  return {
    ...decision,
    volumeScale: computedThresholds.volumeScale,
    thresholdsUsed: { ... },
  };
}
```

### 35.11 使用例

```typescript
import {
  evaluateKeywordSeoStatus,
  summarizeAsinSeoLaunchProgress,
  decideLaunchExitWithScaling,
  computeLaunchExitThresholdsForAsin,
  DEFAULT_SEO_LAUNCH_CONFIG,
  DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
} from "./lifecycle";
import { evaluateAsinLossBudget } from "./analytics";

// バッチ実行ごとに各ASIN評価
for (const asin of launchAsins) {
  // 1. キーワード単位のSEOステータス評価
  const keywordStatuses = keywordConfigs
    .filter(k => k.asin === asin)
    .map(k => evaluateKeywordSeoStatus(k, rankSummaries.get(k.keywordId)!, config, targetCpa));

  // 2. ASIN進捗集計
  const progress = summarizeAsinSeoLaunchProgress(asin, keywordConfigs, keywordStatuses);

  // 3. lossBudget評価
  const lossBudget = evaluateAsinLossBudget(asinPerf, g, tOpt);

  // 4. ASIN固有の閾値を計算（日販数でスケーリング）
  const computedThresholds = computeLaunchExitThresholdsForAsin(
    asin,
    DEFAULT_LAUNCH_EXIT_BASE_THRESHOLDS,
    avgDailySales30d
  );

  // 5. スケーリング済み閾値でローンチ終了判定
  const decision = decideLaunchExitWithScaling(
    asin,
    currentStage,
    daysSinceLaunch,
    asinClicksTotal,
    asinOrdersTotal,
    progress,
    lossBudget,
    computedThresholds
  );

  // 6. 結果に応じたアクション
  if (decision.shouldExitLaunch) {
    if (decision.isEmergencyExit) {
      // Slack警告通知
      await notifySlack({
        level: "critical",
        message: `[緊急終了] ${asin}: ${decision.reasonMessage}`,
      });
    }
    // ライフサイクルをGROWへ移行
    await updateLifecycleStage(asin, "GROW");
    // BigQueryにログ（volumeScaleも記録）
    await logLaunchExit(decision);
    console.log(`volumeScale: ${decision.volumeScale}, thresholds: ${JSON.stringify(decision.thresholdsUsed)}`);
  }
}
```

### 35.12 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/lifecycle/seo-launch-evaluator.ts` | SEOローンチ評価、終了判定 |
| `src/lifecycle/transition-logic.ts` | ライフサイクル遷移統合 |
| `src/lifecycle/index.ts` | エクスポート |
| `tests/lifecycle/seo-launch-evaluator.test.ts` | テスト |
| `tests/lifecycle/threeAxisTransition.test.ts` | 三軸遷移テスト |

### 35.13 三軸ライフサイクル遷移判定（Three-Axis Transition）

LAUNCH期からGROW期への遷移を3つの軸で総合判定する拡張ロジック。

#### 三軸の定義

| 軸 | 名称 | 指標 | 閾値（デフォルト） |
|----|------|------|-----------------|
| A軸 | SEO完了 | seoCompletionRatio | 完了=0.7、部分=0.4 |
| B軸 | 試行量 | minDaysSatisfied, sampleEnough | 条件両方達成 |
| C軸 | 損失予算 | LossBudgetSummary | WARNING=0.5、CRITICAL=0.9 |

#### 判定優先順位

```
1. C軸CRITICAL → 緊急終了（LOSS_BUDGET_EMERGENCY）
2. A軸+B軸完了 → 通常終了（NORMAL_COMPLETION）
3. C軸WARNING + A軸部分 → 早期終了（LOSS_BUDGET_EARLY_EXIT）
4. その他 → 継続（CONTINUE_LAUNCH）
```

#### 型定義

```typescript
export interface ThreeAxisTransitionInput {
  asin: string;
  currentStage: LifecycleStage;
  seoCompletionRatio: number;      // A軸: コアSEO完了率
  minDaysSatisfied: boolean;       // B軸: 最低日数
  sampleEnough: boolean;           // B軸: サンプル量
  lossBudgetSummary: LossBudgetSummary;  // C軸
}

export interface ThreeAxisTransitionConfig {
  seoCompletionThreshold: number;         // 0.7
  seoCompletionWarningThreshold: number;  // 0.4
  lossBudgetStateConfig: LossBudgetStateConfig;
}

export interface ThreeAxisTransitionResult {
  asin: string;
  shouldTransition: boolean;
  nextStage: LifecycleStage;
  reasonCode: ThreeAxisReasonCode;
  reasonMessage: string;
  isEmergencyStop: boolean;
  axisEvaluation: {
    seoConditionMet: boolean;      // A軸達成
    trialConditionMet: boolean;    // B軸達成
    lossBudgetState: LossBudgetState;  // C軸状態
    emergencyStop: boolean;        // 緊急停止フラグ
    warningZone: boolean;          // WARNING状態フラグ
  };
}

export type ThreeAxisReasonCode =
  | "LOSS_BUDGET_EMERGENCY"   // C軸CRITICAL: 緊急終了
  | "NORMAL_COMPLETION"       // A+B軸完了: 通常終了
  | "LOSS_BUDGET_EARLY_EXIT"  // C軸WARNING + A軸部分: 早期終了
  | "CONTINUE_LAUNCH";        // 継続
```

#### 使用例

```typescript
import {
  evaluateThreeAxisTransition,
  generateThreeAxisAlertSummary,
  DEFAULT_THREE_AXIS_TRANSITION_CONFIG,
} from "./lifecycle/seo-launch-evaluator";
import { createLossBudgetSummary } from "./analytics/lossBudgetEvaluator";

// LossBudgetSummaryを作成
const lossBudgetSummary = createLossBudgetSummary(
  asin,
  0.6,   // rollingConsumption
  0.55,  // launchConsumption
  0.7,   // launchInvestUsage
  "2024-01-01",
  "2024-01-30"
);

// 三軸遷移判定
const result = evaluateThreeAxisTransition({
  asin,
  currentStage: "LAUNCH_HARD",
  seoCompletionRatio: 0.45,   // A軸: 45%（部分達成）
  minDaysSatisfied: false,    // B軸: 未達
  sampleEnough: false,
  lossBudgetSummary,          // C軸: WARNING状態
}, DEFAULT_THREE_AXIS_TRANSITION_CONFIG);

// result.shouldTransition === true
// result.reasonCode === "LOSS_BUDGET_EARLY_EXIT"
// result.isEmergencyStop === false

// アラート生成
const alert = generateThreeAxisAlertSummary(result);
// alert.alertLevel === "warning"
// alert.message === "[早期終了] B00TEST123: WARNING状態でのSEO部分達成によりGROWへ移行"
```

#### デフォルト設定

```typescript
export const DEFAULT_THREE_AXIS_TRANSITION_CONFIG: ThreeAxisTransitionConfig = {
  seoCompletionThreshold: 0.7,         // 70%でSEO完了
  seoCompletionWarningThreshold: 0.4,  // 40%で部分達成
  lossBudgetStateConfig: {
    warningThreshold: 0.5,             // 50%でWARNING
    criticalThreshold: 0.9,            // 90%でCRITICAL
    launchInvestWarningThreshold: 0.5,
    launchInvestCriticalThreshold: 1.0, // 100%でCRITICAL
  },
};
```

### 35.14 実装詳細

本仕様に基づく実装は以下のファイルで提供される。

#### 主要関数

| 関数名 | ファイル | 役割 |
|--------|---------|------|
| `evaluateLaunchExitForAsin()` | `src/lifecycle/seo-launch-evaluator.ts` | ASIN単位のLAUNCH終了を評価する統合関数。閾値計算と判定をまとめて実行 |
| `decideNextLifecycleStageForAsin()` | `src/lifecycle/transition-logic.ts` | LaunchExitDecisionから次のライフサイクルステージを決定する純粋ロジック |
| `computeLifecycleSuggestionWithLaunchExit()` | `src/lifecycle/lifecycleSuggestion.ts` | LAUNCH終了評価を含むライフサイクルサジェストを計算 |

#### 型定義

```typescript
// evaluateLaunchExitForAsinの入力
interface EvaluateLaunchExitForAsinParams {
  asin: string;
  lifecycleStage: LifecycleStage;
  daysSinceLaunch: number;
  asinClicksTotal: number;
  asinOrdersTotal: number;
  avgDailySales30d: number;
  progress: AsinSeoLaunchProgress;
  lossBudget: AsinLossBudgetMetrics | null;
  baseThresholds: LaunchExitBaseThresholds;
}

// evaluateLaunchExitForAsinの出力
interface EvaluateLaunchExitForAsinResult {
  decision: LaunchExitDecision;
  thresholds: LaunchExitThresholdsComputed;
  progress: AsinSeoLaunchProgress;
}

// ライフサイクル遷移判定結果
interface LifecycleTransitionDecision {
  asin: string;
  from: LifecycleStage;
  to: LifecycleStage;
  isEmergency: boolean;
  reasonCodes: LaunchExitReasonCode[];
  reasonMessage: string;
}
```

#### BigQueryログ出力

`launch_exit_decisions` テーブルにSHADOWモードでログを保存。
スキーマは `sql/launch_exit_decisions.sql` を参照。

主要カラム:
- `asin`: 評価対象ASIN
- `current_lifecycle_stage`: 現在のステージ（LAUNCH_HARD/LAUNCH_SOFT）
- `suggested_lifecycle_stage`: 提案されるステージ（GROWなど）
- `should_exit_launch`: LAUNCH終了判定結果
- `is_emergency_exit`: 緊急終了かどうか（lossBudget超過等）
- `seo_completion_ratio`: SEO完了率
- `days_since_launch`: ローンチ開始からの日数
- `loss_budget_ratio`: lossBudget消費率

ログ出力は `src/lifecycle/launchExitDecisionLogger.ts` の `LaunchExitDecisionLogger` クラスで実装。

---

## 36. 期待CVR計算ロジック（expectedCvr）

### 36.1 概要

キーワードの「1クリックあたりの注文期待確率」を複数ソースのCVRから推計する共通ヘルパー。

```typescript
// src/metrics/expectedCvr.ts

/**
 * 複数ソースのCVRを信頼度付き重み付けで混合し、
 * ライフサイクル補正を適用して期待CVRを算出する。
 */
export function computeExpectedCvr(
  input: ExpectedCvrInput,
  config: ExpectedCvrConfig,
  lifecycleStage: ExpectedCvrLifecycle | LifecycleStage
): ExpectedCvrResult;
```

### 36.2 入力データソース

```typescript
export interface ExpectedCvrInput {
  keyword7d?: CvrSourceMetrics;      // キーワード直近7日
  keyword30d?: CvrSourceMetrics;     // キーワード直近30日
  asinAds30d?: CvrSourceMetrics;     // ASIN広告全体30日
  asinTotal30d?: {                   // ビジネスレポート
    sessions: number;
    orders: number;
  };
  categoryBaselineCvr?: number;      // カテゴリ平均CVR
}

export interface CvrSourceMetrics {
  clicks: number;
  orders: number;
}
```

### 36.3 設定パラメータ

```typescript
export const DEFAULT_EXPECTED_CVR_CONFIG: ExpectedCvrConfig = {
  // 信頼度が1になる基準
  baseClicksKeyword7d: 20,
  baseClicksKeyword30d: 50,
  baseClicksAsinAds: 200,
  baseSessionsAsinTotal: 500,

  // 各ソースの基礎重み
  weightKeyword7d: 3,    // 直近7日は最も重視
  weightKeyword30d: 2,
  weightAsinAds: 1.5,
  weightAsinTotal: 1,
  weightCategory: 0.5,   // 常に少し効かせる

  // ライフサイクル別補正
  lifecycleAdjust: {
    LAUNCH: 0.8,   // ローンチ期は低めに見積もる
    GROW: 1.0,
    HARVEST: 1.1,  // 収穫期は高めに見積もる
  },
};
```

### 36.4 計算フロー

```
1. 各ソースの生CVRを計算
   cvrKw7d = orders / clicks

2. 信頼度を計算（0〜1）
   reliability = min(1, actual_clicks / base_threshold)

3. 実効重みを計算
   effectiveWeight = baseWeight × reliability

4. 重み付け平均
   baseExpected = Σ(effectiveWeight × cvr) / Σ(effectiveWeight)

5. ライフサイクル補正
   expectedCvr = baseExpected × lifecycleAdjust
```

### 36.5 break-even bid計算への応用

```typescript
// 理論上の損益分岐CPC
const breakEvenCpc = price × marginRate × expectedCvr;

// 例: 価格2000円、粗利率40%、期待CVR 5%
// breakEvenCpc = 2000 × 0.4 × 0.05 = 40円
```

---

## 37. CORE_SEOキーワードスコアリング（coreSeoScore）

### 37.1 概要

「このASINについて本気でSEO上位を取りに行くべきキーワード候補」をスコアリングするヘルパー。

**CORE_SEOキーワードとは**:
このASINについて「本気でSEO上位を取りに行く」対象キーワードです。
LAUNCH期に最も優先的に投資し、オーガニック順位を押し上げることを目的としています。

```typescript
// src/metrics/coreSeoScoring.ts

export function computeCoreSeoScore(
  m: CoreKeywordMetrics,
  config: CoreScoreConfig
): CoreScoreResult;

export function rankCoreSeoKeywords(
  keywords: Array<{ keyword: string; metrics: CoreKeywordMetrics }>,
  config: CoreScoreConfig,
  topN: number = 10
): Array<{ keyword: string; result: CoreScoreResult }>;
```

### 37.2 入力メトリクス

```typescript
export interface CoreKeywordMetrics {
  searchVolumeMonth: number;     // 月間検索ボリューム
  relText: number;               // テキスト関連度（0〜1）
  relBrand: number;              // ブランド指名性（0, 0.5, 1）
  convShare: number;             // コンバージョンシェア（0〜1）
  cpcPercentile: number;         // CPCパーセンタイル（0〜1）
  sponsoredSlotsNorm: number;    // スポンサー枠の多さ（0〜1）
  brandSearchVolume: number;     // ブランド全体の検索ボリューム
}
```

### 37.3 設定パラメータ

```typescript
export const DEFAULT_CORE_SCORE_CONFIG: CoreScoreConfig = {
  maxSearchVolumeInCategory: 100000,  // 検索ボリューム正規化用
  convShareRef: 0.4,                  // シェア基準値

  // ブランド成熟度しきい値
  brandVolumeStage1: 3000,   // 未成熟
  brandVolumeStage2: 10000,  // 確立

  // 各要素の重み
  weightVolume: 2,
  weightText: 3,             // 最重要
  weightBrandBase: 2.5,      // 動的調整
  weightConv: 1.5,
  weightCompetition: 1,      // ペナルティ
};
```

### 37.4 スコア計算式

```
score = weightVolume × volNorm
      + weightText × relText
      + brandWeightEffective × relBrand
      + weightConv × convNorm
      - weightCompetition × compScore
```

### 37.5 ブランド成熟度による動的調整

| ブランド検索ボリューム | ステージ | ブランド重み倍率 |
|---------------------|---------|----------------|
| < 3,000/月 | 未成熟 | 40%（0.4） |
| 3,000〜10,000/月 | 成長期 | 80%（0.8） |
| > 10,000/月 | 確立 | 100%（1.0） |

**設計思想**: ブランド未成熟期は指名検索が少ないため、ジェネリックキーワードでの認知獲得を優先。
ブランドが育つにつれて、指名キーワードの投資価値が高まる。

### 37.6 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/metrics/expectedCvr.ts` | 期待CVR計算 |
| `src/metrics/coreSeoScoring.ts` | CORE_SEOスコア計算 |
| `src/metrics/index.ts` | エクスポート |
| `tests/metrics/expectedCvr.test.ts` | テスト |
| `tests/metrics/coreSeoScoring.test.ts` | テスト |

---

## 38. TACOS-ACOS統合モデル

### 38.1 概要

T_opt（利益最大化TACOS）とT_stage（ライフサイクル別TACOS）を用いたTACOSモデルをLTVモデルと統合し、
最終的なターゲットACOSを計算するモジュール。

```typescript
// src/tacos-acos/target-acos-calculator.ts

/**
 * TACOSモデルとLTVモデルの両方からACOS目標を算出し、
 * より厳しい方を採用することで、利益と成長のバランスを取る
 */
export function computeIntegratedTargetAcos(
  context: TargetAcosContext,
  config?: TargetAcosConfig
): TargetAcosResult;
```

### 38.2 計算ロジック

#### T_stage決定

ライフサイクルステージに応じた基本TACOSを決定:

| ステージ | 計算式 |
|----------|--------|
| LAUNCH_HARD / LAUNCH_SOFT | T_launch = min(g, T_opt × (1 + α_L)) |
| GROW | T_grow = T_opt |
| HARVEST | T_harvest = max(0, T_opt × (1 - α_H)) |

デフォルト: α_L = 0.30, α_H = 0.25

#### セールフェーズ考慮

```
T_stage_smode = stageTacos × sModeTacosMultiplier

T_stage_used =
  salePhase === "MAIN_SALE" ? T_stage_smode : stageTacos
```

#### TACOSからACOSへの変換

```
rawShare = adSales30d / salesTotal30d

effectiveShare =
  salesTotal30d < salesTotalMinThreshold
    ? adSalesShareDefault
    : max(rawShare, adSalesShareMin)

targetAcosFromTacos = T_stage_used / effectiveShare
```

#### LTVモデルとの統合

```
stageFactor = getLtvStageFactor(lifecycleStage)
  // LAUNCH: 1.1, GROW: 1.0, HARVEST: 0.9

adjustedLtvAcos = baseLtvAcos × stageFactor
cappedLtvAcos = min(adjustedLtvAcos, ltvHardCap)  // ltvHardCapがあれば

finalTargetAcos = min(targetAcosFromTacos, cappedLtvAcos)
finalTargetAcos = clip(finalTargetAcos, globalAcosMin, globalAcosMax)
```

### 38.3 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `sModeTacosMultiplier` | 1.3 | MAIN_SALE時のTACOS乗数 |
| `adSalesShareDefault` | 0.3 | salesTotal不足時のデフォルト広告売上シェア |
| `adSalesShareMin` | 0.1 | 広告売上シェアの最小値 |
| `salesTotalMinThreshold` | 100,000円 | 広告売上シェア計算の最小売上額 |
| `ltvLaunchFactor` | 1.1 | LAUNCH期のLTV ACOS乗数 |
| `ltvGrowFactor` | 1.0 | GROW期のLTV ACOS乗数 |
| `ltvHarvestFactor` | 0.9 | HARVEST期のLTV ACOS乗数 |
| `globalAcosMin` | 0.05 | グローバルACOS下限 |
| `globalAcosMax` | 0.80 | グローバルACOS上限 |

### 38.4 使用例

```typescript
import { computeIntegratedTargetAcos } from "./tacos-acos";

const result = computeIntegratedTargetAcos({
  marginPotential: 0.55,
  tOpt: 0.15,
  tLaunch: 0.195,
  tGrow: 0.15,
  tHarvest: 0.1125,
  lifecycleStage: "GROW",
  salePhase: "NORMAL",
  salesTotal30d: 300000,
  adSales30d: 90000,  // 30%シェア
  baseLtvAcos: 0.40,
  ltvHardCap: null,
});

// targetAcosFromTacos = 0.15 / 0.30 = 0.50
// targetAcosFromLtv = 0.40 × 1.0 = 0.40
// finalTargetAcos = min(0.50, 0.40) = 0.40
console.log(result.finalTargetAcos);        // 0.40
console.log(result.tacosModelSelected);     // false（LTVモデルが採用）
```

---

## 39. 理論最大CPCガード

### 39.1 概要

g（ポテンシャル粗利率）、T_stage、expectedCvrから理論的に許容できる最大CPCを計算し、
入札ガードレールとして使用する。

```typescript
// src/tacos-acos/theoretical-max-cpc.ts

/**
 * どんなに入札ロジックが攻め方向に振れても、
 * このCPCを超えないようにクリップする
 */
export function computeTheoreticalMaxCpc(
  input: TheoreticalMaxCpcInput,
  config?: TheoreticalMaxCpcConfig
): TheoreticalMaxCpcResult;

export function applyTheoreticalMaxCpcGuard(
  recommendedBidRaw: number,
  input: TheoreticalMaxCpcInput,
  config?: TheoreticalMaxCpcConfig
): { finalBid: number; cpcResult: TheoreticalMaxCpcResult; guardResult: CpcGuardResult };
```

### 39.2 計算式

```
maxCpcHard = price × T_stage × expectedCvr
theoreticalMaxCpc = maxCpcHard × cpcSafetyFactor
```

### 39.3 セール時の制約

MAIN_SALE時のCPC上昇には上限を設ける:

```
theoreticalMaxCpc_current ≤ theoreticalMaxCpc_normal × cpcUpliftCap
```

これにより、セール時でも通常時の2倍（デフォルト）を超えないようガードする。

### 39.4 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `cpcSafetyFactor` | 1.15 | CPC安全係数（理論値に対するマージン） |
| `cpcUpliftCap` | 2.0 | セール時CPC上昇上限（通常時理論CPCに対する倍率） |

### 39.5 入札ガードの適用

```typescript
import { applyTheoreticalMaxCpcGuard } from "./tacos-acos";

// 既存の入札ロジックで算出した推奨入札額
const recommendedBidRaw = 50;

const result = applyTheoreticalMaxCpcGuard(recommendedBidRaw, {
  price: 3000,
  tStageNormal: 0.15,
  expectedCvrNormal: 0.03,
  salePhase: "NORMAL",
});

// theoreticalMaxCpc = 3000 × 0.15 × 0.03 × 1.15 = 15.525円
// 50円 > 15.525円 なのでクリップ
console.log(result.finalBid);           // 16
console.log(result.guardResult.wasCapped); // true
```

### 39.6 bidEngineへの統合

```typescript
// 1. 通常の入札ロジックで推奨入札額を計算
const recommendedBidRaw = calculateRecommendedBid(...);

// 2. 理論最大CPCでガード
const { finalBid, guardResult } = applyTheoreticalMaxCpcGuard(
  recommendedBidRaw,
  {
    price,
    tStageNormal,
    expectedCvrNormal,
    salePhase,
    tStageSmode,        // MAIN_SALE時
    expectedCvrSale,    // MAIN_SALE時
  }
);

// 3. 既存のmin/maxガードも適用
const bidCappedByMinMax = applyGuardrails(...);

// 4. 最終入札額
const finalBidAmount = Math.min(finalBid, bidCappedByMinMax);
```

### 39.7 ユーティリティ関数

| 関数 | 説明 |
|------|------|
| `computeBreakEvenCpc(price, marginPotential, expectedCvr)` | 損益分岐CPC計算 |
| `computeCpcUtilization(currentBid, theoreticalMaxCpc)` | 理論最大CPCに対する使用率 |
| `computeCpcHeadroom(currentBid, theoreticalMaxCpc)` | 理論最大CPCに対する余裕度（円） |
| `isBidWithinTheoreticalLimit(bid, price, tStage, expectedCvr)` | 入札額が理論上限内か判定 |

---

## 40. セール用期待CVR（expectedCvr_sale）

### 40.1 概要

ビッグセール時のCVR跳ね上がりを考慮した期待CVRを計算するモジュール。

```typescript
// src/tacos-acos/sale-expected-cvr.ts

/**
 * Amazonのビッグセールでは「開始直後」と「終了前」でCVRが高くなりやすいため、
 * 時間帯別のアップリフトスケジュールを用いて期待CVRを計算
 */
export function computeExpectedCvrSale(
  input: SaleExpectedCvrInput,
  config?: SaleExpectedCvrConfig
): SaleExpectedCvrResult;

export function getExpectedCvrForPhase(
  salePhase: SalePhase,
  expectedCvrNormal: number,
  saleInput?: Omit<SaleExpectedCvrInput, "expectedCvrNormal">,
  config?: SaleExpectedCvrConfig
): { expectedCvrUsed: number; isSaleMode: boolean; saleResult?: SaleExpectedCvrResult };
```

### 40.2 SalePhase定義

```typescript
export type SalePhase = "NORMAL" | "PRE_SALE" | "MAIN_SALE" | "COOL_DOWN";
```

| フェーズ | 説明 | 適用するexpectedCvr |
|----------|------|---------------------|
| NORMAL | 通常日 | expectedCvr_normal |
| PRE_SALE | セール準備期間（セール前2-3日） | expectedCvr_normal |
| MAIN_SALE | セール本番中 | expectedCvr_sale(h) |
| COOL_DOWN | セール終了後のクールダウン期間 | expectedCvr_normal |

### 40.3 時間帯別アップリフト

```typescript
export const DEFAULT_SALE_EXPECTED_CVR_CONFIG = {
  upliftSchedule: [
    { startHour: 0, endHour: 2, uplift: 1.8 },    // 開始直後
    { startHour: 2, endHour: 12, uplift: 1.3 },   // 序盤
    { startHour: 12, endHour: 43, uplift: 1.1 },  // 中盤
    { startHour: 43, endHour: 48, uplift: 1.7 },  // 終了間際
  ],
  maxUplift: 2.5,
  baseClicksSale: 50,
  wMinSale: 0.3,
  saleDurationHours: 48,
};
```

### 40.4 計算ロジック

#### 1. 事前期待CVR

```
uplift = getUpliftScheduleValue(hoursSinceMainSaleStart)
expectedCvr_sale_prior_raw = expectedCvr_normal × uplift
expectedCvr_sale_prior = min(expectedCvr_sale_prior_raw, expectedCvr_normal × maxUplift)
```

#### 2. 実績CVRとのブレンド

```
w_live_raw = clicks_sale / baseClicksSale
w_live_clipped = min(1.0, w_live_raw)
w_live = max(wMinSale, w_live_clipped)

expectedCvr_sale = (1 - w_live) × expectedCvr_sale_prior + w_live × cvr_observed_sale
expectedCvr_sale = min(expectedCvr_sale, expectedCvr_normal × maxUplift)
```

### 40.5 設定パラメータ

| パラメータ | デフォルト | 説明 |
|------------|------------|------|
| `maxUplift` | 2.5 | 最大アップリフト倍率 |
| `baseClicksSale` | 50 | 実績CVR信頼度計算の基本クリック数 |
| `wMinSale` | 0.3 | w_liveの最小値（実績CVRの最低重み） |
| `saleDurationHours` | 48 | セール継続時間 |

### 40.6 使用例

```typescript
import { computeExpectedCvrSale, getExpectedCvrForPhase } from "./tacos-acos";

// セール開始1時間後の期待CVR
const result = computeExpectedCvrSale({
  expectedCvrNormal: 0.03,
  hoursSinceMainSaleStart: 1,
  clicksSale: 30,
  cvrObservedSale: 0.05,
});

// uplift = 1.8（0-2時間帯）
// prior = 0.03 × 1.8 = 0.054
// w_live = max(0.3, 30/50) = 0.6
// blended = 0.4 × 0.054 + 0.6 × 0.05 = 0.0516
console.log(result.expectedCvrSale);  // ≈ 0.05

// フェーズに応じた期待CVR取得
const { expectedCvrUsed, isSaleMode } = getExpectedCvrForPhase(
  "MAIN_SALE",
  0.03,
  { hoursSinceMainSaleStart: 1, clicksSale: 30, cvrObservedSale: 0.05 }
);
```

### 40.7 T_stageとexpectedCvrの連動

| salePhase | T_stage | expectedCvr |
|-----------|---------|-------------|
| NORMAL | stageTacos | expectedCvr_normal |
| PRE_SALE | stageTacos | expectedCvr_normal |
| MAIN_SALE | T_stage_smode | expectedCvr_sale(h) |
| COOL_DOWN | stageTacos | expectedCvr_normal |

### 40.8 設計思想

1. **時間帯別アップリフト**: セール中のCVR変動パターンを事前に組み込み、予測精度を向上
2. **w_live下限付きブレンド**: 実績が少ない序盤でも最低30%は実績を参照し、過度な事前期待依存を防止
3. **max_upliftクリップ**: 異常な上昇を防ぎ、入札の暴走を防止
4. **NORMAL日データ保護**: ビッグセール中の一時的なCVR爆上がりが通常日のT_optやexpectedCvr_normalを歪めないよう、T_opt推計や長期モデルではNORMAL日中心のデータを使用

### 40.9 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/tacos-acos/types.ts` | 型定義（SalePhase, TargetAcosContext等） |
| `src/tacos-acos/target-acos-calculator.ts` | ターゲットACOS計算 |
| `src/tacos-acos/theoretical-max-cpc.ts` | 理論最大CPC計算 |
| `src/tacos-acos/sale-expected-cvr.ts` | セール用期待CVR計算 |
| `src/tacos-acos/index.ts` | エクスポート |
| `tests/tacos-acos/*.test.ts` | テスト |

---

## 41. ロール×ライフサイクル別ガードレール

### 41.1 概要

キーワードの「ロール（役割）」と商品の「ライフサイクル」の組み合わせに応じて、入札アクションの許可/禁止およびしきい値を動的に調整するシステム。特にCOREキーワードをローンチ期に保護し、EXPERIMENTキーワードには柔軟な制御を許可する。

```typescript
// src/engine/roleGuardrails.ts

export function getRoleLifecycleGuardrails(ctx: GuardrailContext): RoleLifecycleGuardrails;
```

### 41.2 型定義

```typescript
export type KeywordRole = "CORE" | "SUPPORT" | "EXPERIMENT";
export type PresaleType = "BUYING" | "HOLD_BACK" | "MIXED" | "NONE";
export type LossBudgetState = "SAFE" | "WARNING" | "CRITICAL";

export interface GuardrailContext {
  role: KeywordRole;
  lifecycle: LifecycleState;
  salePhase: SalePhase;
  presaleType: PresaleType;
  lossBudgetState: LossBudgetState;
}

export interface RoleLifecycleGuardrails {
  allowStop: boolean;
  allowNegative: boolean;
  allowStrongDown: boolean;
  minClicksDown: number;
  minClicksStrongDown: number;
  minClicksStop: number;
  overspendThresholdDown: number;
  overspendThresholdStrongDown: number;
  overspendThresholdStop: number;
  maxDownStepRatio: number;
  reason: string;
}
```

### 41.3 基本定数

```typescript
// クリック数しきい値ベース
const MIN_CLICKS_BASE_DOWN = 30;
const MIN_CLICKS_BASE_STRONG_DOWN = 50;
const MIN_CLICKS_BASE_STOP = 80;

// overspendRatio しきい値
const SMALL_OVER = 1.1;   // 軽度超過
const MED_OVER = 1.3;     // 中度超過
const HEAVY_OVER = 1.6;   // 重度超過

// overspendRatio計算
overspendRatio = acos_w / targetAcos
```

### 41.4 ロール×ライフサイクル別ポリシー

#### COREロール

| lifecycle | allowStop | allowNegative | allowStrongDown | minClicksDown | minClicksStrongDown | minClicksStop | overspendDown | overspendStrongDown | overspendStop | maxDownStepRatio |
|-----------|-----------|---------------|-----------------|---------------|---------------------|---------------|---------------|---------------------|---------------|------------------|
| LAUNCH_HARD | ❌ | ❌ | ❌ | 90 | 120 | 160 | HEAVY_OVER | N/A | N/A | 0.1 |
| LAUNCH_SOFT | ❌ | ❌ | ❌ | 60 | 100 | 160 | MED_OVER | N/A | N/A | 0.15 |
| GROW | ※1 | ※1 | ❌ | 45 | 75 | 120 | MED_OVER | HEAVY_OVER | N/A | 0.2 |
| HARVEST | ✅ | ✅ | ※2 | 30 | 50 | 80 | SMALL_OVER | MED_OVER | HEAVY_OVER | 0.25 |

※1: lossBudgetState=CRITICAL の場合のみ許可
※2: lossBudgetState≠SAFE の場合のみ許可

#### SUPPORTロール

| lifecycle | allowStop | allowNegative | allowStrongDown | minClicksDown | minClicksStrongDown | minClicksStop | overspendDown | overspendStrongDown | overspendStop | maxDownStepRatio |
|-----------|-----------|---------------|-----------------|---------------|---------------------|---------------|---------------|---------------------|---------------|------------------|
| LAUNCH_HARD | ❌ | ❌ | ※2 | 45 | 60 | 120 | MED_OVER | HEAVY_OVER | N/A | 0.2 |
| LAUNCH_SOFT | ※1 | ※1 | ✅ | 30 | 50 | 100 | MED_OVER | MED_OVER | HEAVY_OVER | 0.25 |
| GROW | ✅ | ✅ | ✅ | 30 | 50 | 80 | SMALL_OVER | MED_OVER | HEAVY_OVER | 0.3 |
| HARVEST | ✅ | ✅ | ✅ | 21 | 35 | 56 | SMALL_OVER | MED_OVER | HEAVY_OVER | 0.35 |

※1: lossBudgetState=CRITICAL の場合のみ許可
※2: lossBudgetState≠SAFE の場合のみ許可

#### EXPERIMENTロール

| lifecycle | allowStop | allowNegative | allowStrongDown | minClicksDown | minClicksStrongDown | minClicksStop | overspendDown | overspendStrongDown | overspendStop | maxDownStepRatio |
|-----------|-----------|---------------|-----------------|---------------|---------------------|---------------|---------------|---------------------|---------------|------------------|
| 全て | ✅ | ✅ | ✅ | 21 | 35 | 56 | SMALL_OVER | MED_OVER | HEAVY_OVER | 0.4 |

EXPERIMENTは0.7×ベースしきい値を使用

### 41.5 共通ルール：PRE_SALE×HOLD_BACK補正

```typescript
if (salePhase === "PRE_SALE" && presaleType === "HOLD_BACK") {
  // STRONG_DOWN禁止
  guardrails.allowStrongDown = false;
  // STOPしきい値を1.5倍に引き上げ
  guardrails.minClicksStop *= 1.5;
  guardrails.overspendThresholdStop *= 1.2;
}
```

### 41.6 共通ルール：CRITICAL補正

```typescript
if (lossBudgetState === "CRITICAL") {
  // CORE以外はSTOP/NEGを強制許可
  if (role !== "CORE") {
    guardrails.allowStop = true;
    guardrails.allowNegative = true;
  }
  // しきい値を緩和（0.7倍）
  guardrails.minClicksStop *= 0.7;
  guardrails.overspendThresholdStop *= 0.85;
}
```

### 41.7 ユーティリティ関数

```typescript
// overspendRatio計算
export function computeOverspendRatio(acosW: number, targetAcos: number): number;

// アクションが許可されているか
export function isActionAllowed(
  action: "STOP" | "NEGATIVE" | "STRONG_DOWN" | "DOWN" | "UP" | "MAINTAIN",
  guardrails: RoleLifecycleGuardrails
): boolean;

// しきい値条件を満たすか
export function meetsActionThreshold(
  action: "STOP" | "STRONG_DOWN" | "DOWN",
  clicks: number,
  overspendRatio: number,
  guardrails: RoleLifecycleGuardrails
): boolean;

// ダウン幅をmaxDownStepRatioでクリップ
export function clipDownRatio(
  originalRatio: number,
  guardrails: RoleLifecycleGuardrails
): number;

// 禁止アクションを許可されたアクションにフォールバック
export function fallbackAction(
  originalAction: "STOP" | "NEGATIVE" | "STRONG_DOWN" | "DOWN" | "UP" | "MAINTAIN",
  guardrails: RoleLifecycleGuardrails
): { action: string; wasModified: boolean };
```

### 41.8 入札アクション統合

#### determineBidActionWithGuardrails

```typescript
// src/lifecycle/bid-integration.ts

export function determineBidActionWithGuardrails(
  input: DetermineBidActionWithGuardrailsInput
): DetermineBidActionWithGuardrailsResult {
  // 1. ガードレール取得
  const guardrails = getRoleLifecycleGuardrails({
    role: input.keywordRole,
    lifecycle: input.lifecycle,
    salePhase: input.salePhase,
    presaleType: input.presaleType,
    lossBudgetState: input.lossBudgetState,
  });

  // 2. overspendRatio計算
  const overspendRatio = computeOverspendRatio(input.acosW, input.targetAcos);

  // 3. 通常ロジックでアクション決定
  const originalAction = determineBidAction(input);

  // 4. しきい値チェック
  if (["STOP", "STRONG_DOWN", "DOWN"].includes(originalAction)) {
    if (!meetsActionThreshold(originalAction, input.clicks, overspendRatio, guardrails)) {
      return { action: "MAINTAIN", wasModifiedByGuardrails: true, ... };
    }
  }

  // 5. 許可チェック＆フォールバック
  if (!isActionAllowed(originalAction, guardrails)) {
    const { action: fallbackAct } = fallbackAction(originalAction, guardrails);
    return { action: fallbackAct, wasModifiedByGuardrails: true, ... };
  }

  return { action: originalAction, wasModifiedByGuardrails: false, ... };
}
```

### 41.9 ネガティブキーワード統合

#### checkNegativeCandidateWithGuardrails

```typescript
// src/negative-keywords/negative-keyword-calculator.ts

export function checkNegativeCandidateWithGuardrails(
  candidate: NegativeKeywordCandidate,
  ctx: NegativeGuardrailContext
): NegativeGuardrailCheckResult {
  const guardrails = getRoleLifecycleGuardrails({
    role: ctx.keywordRole,
    lifecycle: ctx.lifecycle,
    salePhase: ctx.salePhase,
    presaleType: ctx.presaleType,
    lossBudgetState: ctx.lossBudgetState,
  });

  // allowNegativeチェック
  if (!guardrails.allowNegative) {
    return { allowed: false, reason: "negative_forbidden_by_guardrails", ... };
  }

  // STOPしきい値チェック（NEGはSTOPと同等の慎重さが必要）
  const overspendRatio = computeOverspendRatio(ctx.acosW, ctx.targetAcos);
  if (!meetsActionThreshold("STOP", candidate.clicks, overspendRatio, guardrails)) {
    return { allowed: false, reason: "negative_threshold_not_met", ... };
  }

  return { allowed: true, reason: "negative_allowed", ... };
}

export function filterNegativeCandidatesWithGuardrails(
  candidates: NegativeKeywordCandidate[],
  ctx: NegativeGuardrailContext
): { allowed: NegativeKeywordCandidate[]; blocked: Array<{ candidate; reason }> };
```

### 41.10 フォールバック順序

```
STOP → STRONG_DOWN → DOWN → MAINTAIN
NEG → STRONG_DOWN → DOWN → MAINTAIN
STRONG_DOWN → DOWN → MAINTAIN
```

### 41.11 設計思想

1. **COREキーワード保護**: ローンチ期のCOREキーワードはブランド認知の中核。STOP/NEGを禁止して損失機会を防止
2. **段階的緩和**: ライフサイクルが進むにつれて制御を緩和（LAUNCH→GROW→HARVEST）
3. **EXPERIMENTの柔軟性**: 新規テストキーワードは早期に損切り可能
4. **CRITICAL時の強制介入**: lossBudgetが危機的な場合は保護を一部解除して損失拡大を防止
5. **PRE_SALE×HOLD_BACK保護**: セール前の買い控え期は誤った判断を防ぐため強い制御を禁止

### 41.12 実装ファイル

| ファイル | 内容 |
|---------|------|
| `src/engine/roleGuardrails.ts` | ガードレール取得ロジック |
| `src/engine/index.ts` | エクスポート |
| `src/lifecycle/bid-integration.ts` | 入札アクション統合 |
| `src/negative-keywords/negative-keyword-calculator.ts` | ネガティブキーワード統合 |
| `tests/engine/roleGuardrails.test.ts` | テスト |

---

## 補足: LAUNCH終了判定で使用する主要指標

LAUNCH終了判定（`decideLaunchExit`、`decideLaunchExitWithScaling`）で使用する主要な3つの構造体を以下にまとめます。

### AsinSeoLaunchProgress（ASIN別SEOローンチ進捗）

対象ASINについて、ローンチ期間中に追っているコアキーワードの決着状況をまとめた構造体。

| フィールド | 日本語名 | 意味 |
|-----------|----------|------|
| `totalCoreKeywords` | コアキーワード総数 | ローンチ対象のコアキーワード数 |
| `achievedCount` | 達成キーワード数 | 目標順位を達成したキーワード数 |
| `gaveUpCount` | 撤退キーワード数 | 追うのをやめたキーワード数 |
| `activeCount` | 進行中キーワード数 | まだ決着していないキーワード数 |
| `completionRatio` | SEO完了率 | (達成 + 撤退) ÷ 総数 |
| `successRatio` | SEO成功率 | 達成 ÷ 総数 |

### AsinLossBudgetMetrics（ASIN別損失予算メトリクス）

各ASINについて、事前に決めた損失予算をどれだけ消費しているかを集約した指標セット。

| フィールド | 日本語名 | 意味 |
|-----------|----------|------|
| `lossBudget` | 損失予算額 | 投資してよい累計赤字の上限 |
| `lossSoFar` | 累計損失額 | 現時点までの累計赤字額 |
| `ratioStage` | 損失予算消化率 | lossSoFar ÷ lossBudget |
| `investmentState` | 投資状態 | SAFE/WATCH/LIMIT/BREACH |

### LaunchExitThresholdsComputed（ローンチ終了閾値セット）

各ASINのボリュームや実績に応じて動的に計算された「ローンチ終了判定に使う最終的なしきい値セット」。

| フィールド | 日本語名 | 意味 |
|-----------|----------|------|
| `minCoreCompletionRatio` | 最低SEO完了率 | 通常終了に必要なSEO完了率（例: 0.7） |
| `minLaunchDays` | 最低ローンチ日数 | 最低稼働日数（例: 45日） |
| `minAsinClicksTotal` | 最低必要クリック数 | 最低クリック条件（例: 2500） |
| `minAsinOrdersTotal` | 最低必要注文数 | 最低注文条件（例: 80） |
| `emergencyLossRatioThreshold` | 緊急終了損失比率閾値 | 緊急終了トリガー（例: 1.2） |

> **詳細**: 各指標の詳細な説明については `docs/architecture.md` の「付録: ライフサイクル関連指標一覧（英語名 → 日本語名）」を参照してください。

---

## 補足: 管理画面（AdminJS）について

Amazon広告自動入札ロジック自体は本ドキュメントで定義されたバックエンド関数群で完結しており、管理画面 AdminJS はこれらのロジックを操作するための内部向け UI であり、ロジック仕様の一部ではない。

管理画面の構成や画面遷移は `docs/architecture.md` の「40. 管理画面（AdminJS）」セクションで管理する。

### AdminJS で編集可能なパラメータ

管理画面から編集可能なパラメータは以下の通り。これらの値は入札計算ロジックに直接影響する。

| パラメータ | 説明 | バリデーション範囲 | 影響するロジック |
|------------|------|-------------------|------------------|
| `lifecycle_state` | 商品のライフサイクルステージ | LAUNCH_HARD, LAUNCH_SOFT, GROW, HARVEST | ガードレール適用、TACOS制御、損失予算管理 |
| `target_tacos` | 目標TACOS（Total ACOS） | 0〜1（0%〜100%） | target_acos算出、入札上限計算 |
| `max_bid` | キーワード単位の最大入札額 | 0〜5（ドル） | 入札上限ガードレール |
| `profile_type` | 入札プロファイル種別 | STANDARD, AGGRESSIVE, CONSERVATIVE, CUSTOM | 係数選択、入札傾向 |

**注意**: これらのパラメータを変更すると、次回の入札計算から即座に反映される。特に `lifecycle_state` の変更は損失予算の扱いやガードレールの適用範囲に大きく影響するため、変更前に現在のパフォーマンスを確認すること。

### BigQuery アダプタ経由の編集

AdminJS による product_config の編集は、カスタム BigQuery アダプタ（`src/admin/bigquery/`）を経由して BigQuery の `product_config` テーブルに直接書き込まれる。

```
[AdminJS UI] → [BigQueryResource.update()] → [BigQuery executeDml()] → [product_config テーブル]
```

#### 編集フロー

1. 管理画面でパラメータを変更
2. `BigQueryResource.update()` が呼び出される
3. `createProductConfigValidator()` によるバリデーション実行
4. バリデーション通過後、BigQuery の `UPDATE` クエリを実行
5. `updated_at` カラムが自動更新される

#### バリデーション詳細

| パラメータ | 型 | 許容値 | エラーメッセージ例 |
|------------|-----|--------|-------------------|
| `lifecycle_state` | string | `LAUNCH_HARD`, `LAUNCH_SOFT`, `GROW`, `HARVEST` | 「ライフサイクルは LAUNCH_HARD, LAUNCH_SOFT, GROW, HARVEST のいずれかを指定してください」 |
| `target_tacos` | number | 0 ≤ x ≤ 1 | 「目標TACOSは0から1の範囲で指定してください」 |
| `max_bid` | number | 0 ≤ x ≤ 5 | 「入札上限は0から5の範囲で指定してください」 |
| `profile_type` | string | `STANDARD`, `AGGRESSIVE`, `CONSERVATIVE`, `CUSTOM` | 「プロファイル種別は STANDARD, AGGRESSIVE, CONSERVATIVE, CUSTOM のいずれかを指定してください」 |

#### 読み取り専用リソース

以下のリソースは AdminJS から閲覧のみ可能（編集不可）：

- `executions` - 実行履歴
- `bid_recommendations` - 入札推奨履歴
- `loss_budget_7d` - 直近7日間の累積損益サマリー
- `negative_candidates_shadow` - ネガティブキーワード候補（SHADOW）

---

*出典: amazon-bid-engine codebase*

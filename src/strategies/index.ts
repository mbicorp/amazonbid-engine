/**
 * プロ戦略モジュール エクスポート
 */

// =============================================================================
// effectiveMode（SKU単位のモード決定）
// =============================================================================

export {
  // 型定義
  OperationMode,
  EffectiveMode,
  EffectiveModeInput,
  EffectiveModeResult,
  SModeScaleConfig,
  EffectiveEventBidParams,
  EventBidPolicyPair,
  // バリデーション
  VALID_OPERATION_MODES,
  isValidOperationMode,
  // 定数
  DEFAULT_S_MODE_SCALE_CONFIG,
  DEFAULT_BIG_SALE_DAY_POLICY_PAIR,
  // 関数
  determineEffectiveMode,
  getBigSaleStrategy,
  scaleSmodeParameter,
  scaleBidUpMultiplier,
  scaleBidDownMultiplier,
  scaleAcosMultiplier,
  calculateEffectiveEventBidParams,
} from "./effective-mode";

// =============================================================================
// プロ戦略
// =============================================================================

export {
  // 型定義
  AnchorKeywordInput,
  AnchorKeywordResult,
  LaunchModeConfig,
  SkuPerformance,
  RecommendedAdSku,
  DemandFollowingInput,
  DemandFollowingResult,
  CampaignProtection,
  CampaignHealthInput,
  IntegratedKeywordEvaluation,
  // Revenue-Based Bid型
  RevenueBasedBidInput,
  RevenueBasedBidResult,
  // Bidding Lifecycle型
  BiddingLifecyclePhase,
  BiddingLifecycleInput,
  BiddingLifecycleResult,
  // TACOS コントローラ型
  ProductLifecycleStage,
  TacosControllerInput,
  TacosControllerResult,
  TacosControllerConfig,
  TacosZone,

  // 1. アンカーキーワード戦略
  calculateAnchorKeywordScore,
  identifyAnchorKeywords,

  // 2. Revenue-Based Bid
  calculateRevenueBasedBid,
  calculateRevenueBasedBidSimple,

  // 3. ローンチ攻め最適化
  calculateLaunchModeConfig,
  calculateLaunchBidAdjustment,

  // 4. 広告SKU選択
  calculateSkuPerformanceScore,
  recommendAdSku,

  // 5. 季節性追随
  determineDemandPhase,

  // 6. Bidding Lifecycle
  determineBiddingLifecycle,
  calculateBiddingLifecycleCoeff,

  // 7. キャンペーン保護
  calculateCampaignHealth,
  validateCampaignChange,

  // 8. 商品レベル TACOS コントローラ
  calculateLtvMultiplierStage,
  calculateTargetTacosStage,
  calculateProductBidMultiplier,
  calculateProductBidMultiplierSimple,

  // 統合評価
  evaluateKeywordWithStrategies,
} from "./pro-strategies";

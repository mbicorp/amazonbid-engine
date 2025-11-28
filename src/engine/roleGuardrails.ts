/**
 * ロール×ライフサイクル×セールフェーズ別ガードレール
 *
 * キーワードの役割（CORE, SUPPORT, EXPERIMENT）とライフサイクルステージ、
 * セールフェーズ、プレセールタイプ、lossBudgetStateに応じて、
 * DOWN/STRONG_DOWN/STOP/NEGの許可・禁止とそれぞれの閾値を制御する。
 *
 * 設計思想:
 * - CORE SEOキーワードをローンチ期に安易に殺さない
 * - SUPPORT/EXPERIMENTから優先的に調整する
 * - PRE_SALEの買い控え期間にCVR悪化で暴走しない
 */

import { LifecycleState } from "../config/productConfigTypes";
import { SalePhase } from "../tacos-acos/types";
// LossBudgetStateはlossBudgetEvaluatorからも再エクスポートされているが、
// 循環参照を避けるためここでも独自に定義する。型の互換性は保たれる。

// =============================================================================
// 型定義
// =============================================================================

/**
 * キーワードの役割
 *
 * - CORE: SEO押し上げのための主力キーワード（最も保護する）
 * - SUPPORT: コアを補助するキーワード
 * - EXPERIMENT: 実験的なキーワード（最も早く切りやすい）
 */
export type KeywordRole = "CORE" | "SUPPORT" | "EXPERIMENT";

/**
 * 有効なキーワードロール一覧
 */
export const VALID_KEYWORD_ROLES: readonly KeywordRole[] = [
  "CORE",
  "SUPPORT",
  "EXPERIMENT",
] as const;

/**
 * 値がKeywordRoleかどうかを判定
 */
export function isValidKeywordRole(value: unknown): value is KeywordRole {
  return (
    typeof value === "string" &&
    VALID_KEYWORD_ROLES.includes(value as KeywordRole)
  );
}

/**
 * プレセールタイプ
 *
 * - BUYING: 買い優先期間（セール前に在庫確保）
 * - HOLD_BACK: 買い控え期間（セール待ち）
 * - MIXED: 混合
 * - NONE: プレセール期間外
 */
export type PresaleType = "BUYING" | "HOLD_BACK" | "MIXED" | "NONE";

/**
 * 有効なプレセールタイプ一覧
 */
export const VALID_PRESALE_TYPES: readonly PresaleType[] = [
  "BUYING",
  "HOLD_BACK",
  "MIXED",
  "NONE",
] as const;

/**
 * 値がPresaleTypeかどうかを判定
 */
export function isValidPresaleType(value: unknown): value is PresaleType {
  return (
    typeof value === "string" &&
    VALID_PRESALE_TYPES.includes(value as PresaleType)
  );
}

/**
 * lossBudgetの状態
 *
 * InvestmentState (SAFE/WATCH/LIMIT/BREACH) を簡略化したもの
 * - SAFE: 健全（lossBudget使用率50%未満）
 * - WARNING: 注意（lossBudget使用率50-80%）
 * - CRITICAL: 危機（lossBudget使用率80%以上またはBREACH）
 */
export type LossBudgetState = "SAFE" | "WARNING" | "CRITICAL";

/**
 * 有効なlossBudgetState一覧
 */
export const VALID_LOSS_BUDGET_STATES: readonly LossBudgetState[] = [
  "SAFE",
  "WARNING",
  "CRITICAL",
] as const;

/**
 * 値がLossBudgetStateかどうかを判定
 */
export function isValidLossBudgetState(value: unknown): value is LossBudgetState {
  return (
    typeof value === "string" &&
    VALID_LOSS_BUDGET_STATES.includes(value as LossBudgetState)
  );
}

/**
 * ガードレールコンテキスト
 *
 * getRoleLifecycleGuardrailsに渡す入力パラメータ
 */
export interface GuardrailContext {
  /** キーワードの役割 */
  role: KeywordRole;
  /** ライフサイクルステージ */
  lifecycleStage: LifecycleState;
  /** セールフェーズ */
  salePhase: SalePhase;
  /** プレセールタイプ（PRE_SALEの場合に有効） */
  presaleType: PresaleType;
  /** lossBudget状態 */
  lossBudgetState: LossBudgetState;
}

/**
 * ロール×ライフサイクルごとのガードレール設定
 */
export interface RoleLifecycleGuardrails {
  // ===========================================
  // アクション許可フラグ
  // ===========================================
  /** STOPアクションを許可するか */
  allowStop: boolean;
  /** ネガティブキーワード候補を許可するか */
  allowNegative: boolean;
  /** STRONG_DOWNアクションを許可するか */
  allowStrongDown: boolean;

  // ===========================================
  // サンプル閾値（クリック数）
  // ===========================================
  /** DOWNアクションに必要な最小クリック数 */
  minClicksDown: number;
  /** STRONG_DOWNアクションに必要な最小クリック数 */
  minClicksStrongDown: number;
  /** STOPアクションに必要な最小クリック数 */
  minClicksStop: number;

  // ===========================================
  // overspendRatio閾値
  // overspendRatio = acos_w / targetAcos
  // ===========================================
  /** DOWNアクション発動のoverspendRatio閾値 */
  overspendThresholdDown: number;
  /** STRONG_DOWNアクション発動のoverspendRatio閾値 */
  overspendThresholdStrongDown: number;
  /** STOPアクション発動のoverspendRatio閾値 */
  overspendThresholdStop: number;

  // ===========================================
  // 変動幅制限
  // ===========================================
  /** 1回のDOWNで許される最大下げ幅（割合）
   * 例: 0.1 なら「最大1割DOWN」 */
  maxDownStepRatio: number;

  // ===========================================
  // メタ情報
  // ===========================================
  /** ガードレール判定の理由 */
  reason: string;
}

// =============================================================================
// 基本の閾値定数
// =============================================================================

/** DOWN用のベースとなるクリック数 */
const MIN_CLICKS_BASE_DOWN = 30;

/** STRONG_DOWN用のベースとなるクリック数 */
const MIN_CLICKS_BASE_STRONG_DOWN = 50;

/** STOP用のベースとなるクリック数 */
const MIN_CLICKS_BASE_STOP = 80;

/**
 * overspendRatio（acos_w / targetAcos）に対するラベル
 * - SMALL_OVER: targetACOSの1.1倍以上
 * - MED_OVER: targetACOSの1.3倍以上
 * - HEAVY_OVER: targetACOSの1.6倍以上
 */
const SMALL_OVER = 1.1;
const MED_OVER = 1.3;
const HEAVY_OVER = 1.6;

// =============================================================================
// デフォルトガードレール
// =============================================================================

/**
 * デフォルトのロールガードレール（最も緩い設定）
 */
export const DEFAULT_ROLE_LIFECYCLE_GUARDRAILS: RoleLifecycleGuardrails = {
  allowStop: true,
  allowNegative: true,
  allowStrongDown: true,
  minClicksDown: MIN_CLICKS_BASE_DOWN,
  minClicksStrongDown: MIN_CLICKS_BASE_STRONG_DOWN,
  minClicksStop: MIN_CLICKS_BASE_STOP,
  overspendThresholdDown: SMALL_OVER,
  overspendThresholdStrongDown: MED_OVER,
  overspendThresholdStop: HEAVY_OVER,
  maxDownStepRatio: 0.2,
  reason: "デフォルト設定",
};

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ライフサイクルステージをシンプルな形式に変換
 * LAUNCH_HARD/LAUNCH_SOFT → "LAUNCH"
 */
function getSimpleLifecycle(
  lifecycleStage: LifecycleState
): "LAUNCH" | "GROW" | "HARVEST" {
  if (lifecycleStage === "LAUNCH_HARD" || lifecycleStage === "LAUNCH_SOFT") {
    return "LAUNCH";
  }
  return lifecycleStage;
}

// =============================================================================
// CORE ロールのガードレール
// =============================================================================

function getCoreGuardrails(
  ctx: GuardrailContext
): RoleLifecycleGuardrails {
  const simpleLifecycle = getSimpleLifecycle(ctx.lifecycleStage);

  // -----------------------------------------
  // LAUNCH × CORE: 最も保護する
  // -----------------------------------------
  if (simpleLifecycle === "LAUNCH") {
    return {
      // STOP/NEG: 原則禁止
      allowStop: false,
      allowNegative: false,
      // STRONG_DOWN: 原則禁止
      allowStrongDown: false,
      // DOWNのみ慎重に許可
      minClicksDown: MIN_CLICKS_BASE_DOWN * 3, // 90クリック
      minClicksStrongDown: MIN_CLICKS_BASE_STRONG_DOWN * 3, // 使われないが設定
      minClicksStop: MIN_CLICKS_BASE_STOP * 3, // 使われないが設定
      overspendThresholdDown: MED_OVER, // 1.3倍以上の悪化でDOWN検討
      overspendThresholdStrongDown: HEAVY_OVER, // 使われないが設定
      overspendThresholdStop: 2.0, // 使われないが設定
      maxDownStepRatio: 0.1, // 1回のDOWNは最大1割
      reason: `CORE×LAUNCH: STOP/NEG/STRONG_DOWN禁止、慎重なDOWNのみ (lossBudget=${ctx.lossBudgetState})`,
    };
  }

  // -----------------------------------------
  // GROW × CORE
  // -----------------------------------------
  if (simpleLifecycle === "GROW") {
    // lossBudgetState が CRITICAL のときだけ例外的にSTOP/NEGを許可
    const allowStopNeg = ctx.lossBudgetState === "CRITICAL";

    // PRE_SALEかつHOLD_BACKのときはSTRONG_DOWN禁止
    const allowStrongDown = !(
      ctx.salePhase === "PRE_SALE" && ctx.presaleType === "HOLD_BACK"
    );

    return {
      allowStop: allowStopNeg,
      allowNegative: allowStopNeg,
      allowStrongDown,
      minClicksDown: MIN_CLICKS_BASE_DOWN * 2, // 60
      minClicksStrongDown: MIN_CLICKS_BASE_STRONG_DOWN * 2, // 100
      minClicksStop: MIN_CLICKS_BASE_STOP * 2, // 160
      overspendThresholdDown: SMALL_OVER, // 1.1倍からDOWN検討
      overspendThresholdStrongDown: MED_OVER, // 1.3倍からSTRONG_DOWN検討
      overspendThresholdStop: HEAVY_OVER, // 1.6倍以上でSTOP候補
      maxDownStepRatio: 0.15, // 1回最大15%DOWN
      reason: `CORE×GROW: STOP/NEG=${allowStopNeg ? "例外許可" : "禁止"} (lossBudget=${ctx.lossBudgetState})`,
    };
  }

  // -----------------------------------------
  // HARVEST × CORE: SUPPORT寄りの扱い
  // -----------------------------------------
  // lossBudgetStateがSAFEでなければSTOP許可
  const allowStop = ctx.lossBudgetState !== "SAFE";
  // CRITICALのときのみNEG許可
  const allowNegative = ctx.lossBudgetState === "CRITICAL";

  return {
    allowStop,
    allowNegative,
    allowStrongDown: true,
    minClicksDown: MIN_CLICKS_BASE_DOWN, // 30
    minClicksStrongDown: MIN_CLICKS_BASE_STRONG_DOWN, // 50
    minClicksStop: MIN_CLICKS_BASE_STOP, // 80
    overspendThresholdDown: SMALL_OVER,
    overspendThresholdStrongDown: MED_OVER,
    overspendThresholdStop: HEAVY_OVER,
    maxDownStepRatio: 0.2, // 1回最大20%DOWN
    reason: `CORE×HARVEST: STOP=${allowStop}, NEG=${allowNegative} (lossBudget=${ctx.lossBudgetState})`,
  };
}

// =============================================================================
// SUPPORT ロールのガードレール
// =============================================================================

function getSupportGuardrails(
  ctx: GuardrailContext
): RoleLifecycleGuardrails {
  const simpleLifecycle = getSimpleLifecycle(ctx.lifecycleStage);

  // -----------------------------------------
  // LAUNCH × SUPPORT
  // -----------------------------------------
  if (simpleLifecycle === "LAUNCH") {
    // STOP: CRITICALのときのみ許可
    const allowStop = ctx.lossBudgetState === "CRITICAL";
    // NEG: 原則禁止
    const allowNegative = false;
    // STRONG_DOWN: PRE_SALE×HOLD_BACKのときは禁止
    const allowStrongDown = !(
      ctx.salePhase === "PRE_SALE" && ctx.presaleType === "HOLD_BACK"
    );

    return {
      allowStop,
      allowNegative,
      allowStrongDown,
      minClicksDown: Math.round(MIN_CLICKS_BASE_DOWN * 1.5), // 45
      minClicksStrongDown: MIN_CLICKS_BASE_STRONG_DOWN * 2, // 100
      minClicksStop: MIN_CLICKS_BASE_STOP * 2, // 160
      overspendThresholdDown: SMALL_OVER, // 1.1倍でDOWN検討
      overspendThresholdStrongDown: MED_OVER, // 1.3倍でSTRONG_DOWN検討
      overspendThresholdStop: HEAVY_OVER, // 1.6倍
      maxDownStepRatio: 0.15,
      reason: `SUPPORT×LAUNCH: STOP=${allowStop}, STRONG_DOWN=${allowStrongDown} (lossBudget=${ctx.lossBudgetState})`,
    };
  }

  // -----------------------------------------
  // GROW × SUPPORT: メインの調整対象
  // -----------------------------------------
  if (simpleLifecycle === "GROW") {
    // 通常のオーバースペンドならSTOP候補にしてよい
    const allowNegative = ctx.lossBudgetState !== "SAFE";

    return {
      allowStop: true,
      allowNegative,
      allowStrongDown: true,
      minClicksDown: MIN_CLICKS_BASE_DOWN, // 30
      minClicksStrongDown: MIN_CLICKS_BASE_STRONG_DOWN, // 50
      minClicksStop: MIN_CLICKS_BASE_STOP, // 80
      overspendThresholdDown: SMALL_OVER,
      overspendThresholdStrongDown: MED_OVER,
      overspendThresholdStop: HEAVY_OVER,
      maxDownStepRatio: 0.2, // 1回20%DOWNまで
      reason: `SUPPORT×GROW: 標準調整対象、NEG=${allowNegative} (lossBudget=${ctx.lossBudgetState})`,
    };
  }

  // -----------------------------------------
  // HARVEST × SUPPORT: 利益優先
  // -----------------------------------------
  return {
    allowStop: true,
    allowNegative: true,
    allowStrongDown: true,
    minClicksDown: MIN_CLICKS_BASE_DOWN, // 30
    minClicksStrongDown: MIN_CLICKS_BASE_STRONG_DOWN, // 50
    minClicksStop: MIN_CLICKS_BASE_STOP, // 80
    overspendThresholdDown: SMALL_OVER,
    overspendThresholdStrongDown: SMALL_OVER, // 少し軽めに
    overspendThresholdStop: MED_OVER, // 1.3倍でSTOP検討
    maxDownStepRatio: 0.25, // 1回25%DOWNまで
    reason: `SUPPORT×HARVEST: 利益優先、積極的なSTOP/NEG (lossBudget=${ctx.lossBudgetState})`,
  };
}

// =============================================================================
// EXPERIMENT ロールのガードレール
// =============================================================================

function getExperimentGuardrails(
  ctx: GuardrailContext
): RoleLifecycleGuardrails {
  // 全ステージ共通で「最も早く切りやすい」対象
  return {
    allowStop: true,
    allowNegative: true,
    allowStrongDown: true,
    minClicksDown: Math.round(MIN_CLICKS_BASE_DOWN * 0.7), // 約21クリックからDOWN許可
    minClicksStrongDown: Math.round(MIN_CLICKS_BASE_STRONG_DOWN * 0.7), // 約35クリック
    minClicksStop: Math.round(MIN_CLICKS_BASE_STOP * 0.7), // 約56クリックからSTOP候補
    overspendThresholdDown: SMALL_OVER,
    overspendThresholdStrongDown: MED_OVER,
    overspendThresholdStop: HEAVY_OVER,
    maxDownStepRatio: 0.3, // 1回30%DOWNまで
    reason: `EXPERIMENT×${ctx.lifecycleStage}: 最も早く切りやすい対象`,
  };
}

// =============================================================================
// PRE_SALE × HOLD_BACK の共通補正
// =============================================================================

function applyPresaleHoldBackCorrection(
  guardrails: RoleLifecycleGuardrails,
  ctx: GuardrailContext
): RoleLifecycleGuardrails {
  // PRE_SALE × HOLD_BACK 以外は補正なし
  if (ctx.salePhase !== "PRE_SALE" || ctx.presaleType !== "HOLD_BACK") {
    return guardrails;
  }

  // CORE は既に個別ロジックで対応済みなのでスキップ
  if (ctx.role === "CORE") {
    return guardrails;
  }

  // SUPPORT, EXPERIMENT への補正
  return {
    ...guardrails,
    // STRONG_DOWNは禁止
    allowStrongDown: false,
    // STOP閾値を一段階厳しくする
    overspendThresholdStop: Math.max(guardrails.overspendThresholdStop, HEAVY_OVER),
    minClicksStop: Math.max(guardrails.minClicksStop, MIN_CLICKS_BASE_STOP * 2),
    reason: `${guardrails.reason} → PRE_SALE/HOLD_BACK補正: STRONG_DOWN禁止、STOP閾値強化`,
  };
}

// =============================================================================
// lossBudgetState CRITICAL の共通補正
// =============================================================================

function applyLossBudgetCriticalCorrection(
  guardrails: RoleLifecycleGuardrails,
  ctx: GuardrailContext
): RoleLifecycleGuardrails {
  // CRITICAL以外は補正なし
  if (ctx.lossBudgetState !== "CRITICAL") {
    return guardrails;
  }

  // CORE は個別ロジックで対応済み
  if (ctx.role === "CORE") {
    return guardrails;
  }

  // SUPPORT, EXPERIMENT への強制ブレーキ
  return {
    ...guardrails,
    allowStop: true,
    allowNegative: true,
    // overspendThresholdStopを一段階低くして早めにSTOP
    overspendThresholdStop: Math.min(guardrails.overspendThresholdStop, MED_OVER),
    reason: `${guardrails.reason} → CRITICAL補正: STOP/NEG強制許可、閾値緩和`,
  };
}

// =============================================================================
// メイン関数
// =============================================================================

/**
 * ロール×ライフサイクル×セールフェーズ別のガードレールを取得
 *
 * @param ctx - ガードレールコンテキスト
 * @returns ロールライフサイクルガードレール設定
 *
 * @example
 * ```typescript
 * const guardrails = getRoleLifecycleGuardrails({
 *   role: "CORE",
 *   lifecycleStage: "LAUNCH_HARD",
 *   salePhase: "NORMAL",
 *   presaleType: "NONE",
 *   lossBudgetState: "SAFE",
 * });
 *
 * if (!guardrails.allowStop) {
 *   // STOP候補から除外
 * }
 *
 * if (clicks_w >= guardrails.minClicksDown && overspendRatio >= guardrails.overspendThresholdDown) {
 *   // DOWN候補
 * }
 * ```
 */
export function getRoleLifecycleGuardrails(
  ctx: GuardrailContext
): RoleLifecycleGuardrails {
  // 1. ロール別の基本ガードレールを取得
  let guardrails: RoleLifecycleGuardrails;

  switch (ctx.role) {
    case "CORE":
      guardrails = getCoreGuardrails(ctx);
      break;
    case "SUPPORT":
      guardrails = getSupportGuardrails(ctx);
      break;
    case "EXPERIMENT":
      guardrails = getExperimentGuardrails(ctx);
      break;
    default:
      // フォールバック: SUPPORT扱い
      guardrails = getSupportGuardrails(ctx);
      break;
  }

  // 2. PRE_SALE × HOLD_BACK の共通補正
  guardrails = applyPresaleHoldBackCorrection(guardrails, ctx);

  // 3. lossBudgetState CRITICAL の共通補正
  guardrails = applyLossBudgetCriticalCorrection(guardrails, ctx);

  return guardrails;
}

// =============================================================================
// ユーティリティ関数
// =============================================================================

/**
 * overspendRatioを計算
 *
 * @param acosW - 加重ACOS（例: 7日間のACOS）
 * @param targetAcos - 目標ACOS
 * @returns overspendRatio（1.0以上なら目標超過）
 */
export function computeOverspendRatio(
  acosW: number | null,
  targetAcos: number
): number {
  if (acosW === null || targetAcos <= 0) {
    return 0;
  }
  return acosW / targetAcos;
}

/**
 * アクション候補が許可されているかチェック
 *
 * @param action - チェックするアクション
 * @param guardrails - ガードレール設定
 * @returns 許可されていればtrue
 */
export function isActionAllowed(
  action: "DOWN" | "STRONG_DOWN" | "STOP" | "NEGATIVE",
  guardrails: RoleLifecycleGuardrails
): boolean {
  switch (action) {
    case "DOWN":
      return true; // DOWNは常に許可（閾値で制御）
    case "STRONG_DOWN":
      return guardrails.allowStrongDown;
    case "STOP":
      return guardrails.allowStop;
    case "NEGATIVE":
      return guardrails.allowNegative;
    default:
      return false;
  }
}

/**
 * アクションの閾値条件を満たしているかチェック
 *
 * @param action - チェックするアクション
 * @param clicksW - 加重クリック数
 * @param overspendRatio - overspendRatio
 * @param guardrails - ガードレール設定
 * @returns 閾値条件を満たしていればtrue
 */
export function meetsActionThreshold(
  action: "DOWN" | "STRONG_DOWN" | "STOP",
  clicksW: number,
  overspendRatio: number,
  guardrails: RoleLifecycleGuardrails
): boolean {
  switch (action) {
    case "DOWN":
      return (
        clicksW >= guardrails.minClicksDown &&
        overspendRatio >= guardrails.overspendThresholdDown
      );
    case "STRONG_DOWN":
      return (
        clicksW >= guardrails.minClicksStrongDown &&
        overspendRatio >= guardrails.overspendThresholdStrongDown
      );
    case "STOP":
      return (
        clicksW >= guardrails.minClicksStop &&
        overspendRatio >= guardrails.overspendThresholdStop
      );
    default:
      return false;
  }
}

/**
 * DOWN幅をガードレールの制限内にクリップ
 *
 * @param requestedDownRatio - 要求されたDOWN幅（例: 0.3 = 30%ダウン）
 * @param guardrails - ガードレール設定
 * @returns クリップ後のDOWN幅
 */
export function clipDownRatio(
  requestedDownRatio: number,
  guardrails: RoleLifecycleGuardrails
): number {
  return Math.min(requestedDownRatio, guardrails.maxDownStepRatio);
}

/**
 * 禁止されているアクションを許可されているアクションにフォールバック
 *
 * @param action - 元のアクション
 * @param guardrails - ガードレール設定
 * @param role - キーワードロール（フォールバック時の判定に使用）
 * @returns フォールバック後のアクション
 */
export function fallbackAction(
  action: "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP",
  guardrails: RoleLifecycleGuardrails,
  role: KeywordRole
): "STRONG_UP" | "MILD_UP" | "KEEP" | "MILD_DOWN" | "STRONG_DOWN" | "STOP" {
  // UP系とKEEPはそのまま
  if (action === "STRONG_UP" || action === "MILD_UP" || action === "KEEP") {
    return action;
  }

  // MILD_DOWNはそのまま（制限対象外）
  if (action === "MILD_DOWN") {
    return action;
  }

  // STOPが禁止されている場合
  if (action === "STOP" && !guardrails.allowStop) {
    // COREならHOLDに、それ以外ならMILD_DOWNにフォールバック
    if (role === "CORE") {
      return "KEEP";
    }
    // STRONG_DOWNが許可されていればSTRONG_DOWN、そうでなければMILD_DOWN
    return guardrails.allowStrongDown ? "STRONG_DOWN" : "MILD_DOWN";
  }

  // STRONG_DOWNが禁止されている場合
  if (action === "STRONG_DOWN" && !guardrails.allowStrongDown) {
    return "MILD_DOWN";
  }

  return action;
}

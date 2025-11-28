/**
 * ガードレールモジュール
 *
 * 入札の上下限を管理するためのモジュール
 */

// 自動ガードレール計算
export {
  recomputeGuardrailsForAllProducts,
  loadAutoGuardrails,
  loadAutoGuardrailsBulk,
  applyGuardrails,
  RecomputeGuardrailsOptions,
  RecomputeGuardrailsResult,
  ApplyGuardrailsInput,
  ApplyGuardrailsResult,
} from "./auto-guardrails";

// 型定義を再エクスポート
export {
  GuardrailsPerLifecycle,
  GuardrailsConfig,
  DEFAULT_GUARDRAILS_PER_LIFECYCLE,
  AutoGuardrailsConfig,
  DEFAULT_AUTO_GUARDRAILS_CONFIG,
  ProductGuardrailsAutoRow,
  BidBucketRow,
  AutoGuardrailsResult,
  // ガードレールモード
  GuardrailsMode,
  VALID_GUARDRAILS_MODES,
  isValidGuardrailsMode,
  DEFAULT_GUARDRAILS_MODE,
} from "../ltv/types";

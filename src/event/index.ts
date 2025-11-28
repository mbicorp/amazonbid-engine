/**
 * イベントオーバーライド機構
 *
 * 大型セール時に「守りのロジック」が効きすぎることを防ぐための
 * イベントモード別の入札ポリシーを提供する
 *
 * See: architecture.md Section 17. Event Override
 */

export {
  // 型定義
  EventMode,
  EventBidPolicy,
  EventModeConfig,
  // バリデーション
  VALID_EVENT_MODES,
  isValidEventMode,
  // デフォルトポリシー
  EVENT_POLICY_NONE,
  EVENT_POLICY_BIG_SALE_PREP,
  EVENT_POLICY_BIG_SALE_DAY,
  DEFAULT_EVENT_MODE_CONFIG,
  // ポリシー取得関数
  getEventBidPolicy,
  getEffectiveEventBidPolicy,
} from "./types";

// =============================================================================
// イベントカレンダー（手入力によるEventMode自動判定）
// =============================================================================

export {
  // 型定義
  EventGrade,
  SaleEventDefinition,
  EventModeResolutionResult,
  EventModeSource,
  EventModeDecision,
  // バリデーション
  VALID_EVENT_GRADES,
  isValidEventGrade,
  VALID_EVENT_MODE_SOURCES,
  isValidEventModeSource,
  // イベントカレンダー定数
  SALE_EVENT_CALENDAR,
  // EventMode解決関数
  resolveEventModeFromCalendar,
  getEventModeSource,
  determineEventMode,
} from "./calendar";

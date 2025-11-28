/**
 * ビッグセール用イベントカレンダー
 *
 * プライムデー、ブラックフライデーなど「毎年決まっている大型セール日」を
 * 手入力で管理し、日付ベースで EventMode を自動判定する
 *
 * 本番運用時は毎年、カレンダー内の日付を更新すること
 */

import { EventMode } from "./types";

// =============================================================================
// 型定義
// =============================================================================

/**
 * イベントグレード
 *
 * - 'S': 大型セール（Prime Day / Black Friday / Cyber Monday など）
 * - 'A': 中規模セール（タイムセール祭りなど）
 * - 'B': 小さなキャンペーン
 */
export type EventGrade = "S" | "A" | "B";

/**
 * 有効なイベントグレード一覧
 */
export const VALID_EVENT_GRADES: readonly EventGrade[] = ["S", "A", "B"] as const;

/**
 * 値がEventGradeかどうかを判定
 */
export function isValidEventGrade(value: unknown): value is EventGrade {
  return (
    typeof value === "string" && VALID_EVENT_GRADES.includes(value as EventGrade)
  );
}

/**
 * セールイベント定義
 */
export interface SaleEventDefinition {
  /** ユニークなイベントID（例: 'prime_day_2025'） */
  id: string;

  /** 表示名（例: 'Prime Day 2025'） */
  label: string;

  /** イベントグレード */
  grade: EventGrade;

  /** タイムゾーン（基本は 'Asia/Tokyo'） */
  timezone: string;

  /** セール開始日時（ISO8601形式、例: '2025-07-15T00:00:00'） */
  start: string;

  /** セール終了日時（ISO8601形式、例: '2025-07-16T23:59:59'） */
  end: string;

  /** 準備期間（何日前から BIG_SALE_PREP とみなすか） */
  prepDays: number;

  /**
   * EventModeに反映するかどうか
   * true のイベントのみ EventMode に影響する
   * Sクラスのみ true にすることを推奨
   */
  applyToEventMode: boolean;
}

/**
 * EventMode解決結果
 */
export interface EventModeResolutionResult {
  /** 解決されたEventMode */
  eventMode: EventMode;

  /** アクティブなイベント（該当イベントがある場合） */
  activeEvent: SaleEventDefinition | null;
}

// =============================================================================
// イベントカレンダー定数
// =============================================================================

/**
 * セールイベントカレンダー
 *
 * 注意: 本番運用時は毎年、このカレンダーの日付を更新すること
 * 日付はダミー値（2025年の予想日程）を入れています
 */
export const SALE_EVENT_CALENDAR: SaleEventDefinition[] = [
  // ==========================================================================
  // Sクラス: 大型セール（EventModeに影響）
  // ==========================================================================
  {
    id: "prime_day_2025",
    label: "Prime Day 2025",
    grade: "S",
    timezone: "Asia/Tokyo",
    start: "2025-07-15T00:00:00",
    end: "2025-07-16T23:59:59",
    prepDays: 3,
    applyToEventMode: true,
  },
  {
    id: "black_friday_2025",
    label: "Black Friday 2025",
    grade: "S",
    timezone: "Asia/Tokyo",
    start: "2025-11-28T00:00:00",
    end: "2025-11-28T23:59:59",
    prepDays: 3,
    applyToEventMode: true,
  },
  {
    id: "cyber_monday_2025",
    label: "Cyber Monday 2025",
    grade: "S",
    timezone: "Asia/Tokyo",
    start: "2025-12-01T00:00:00",
    end: "2025-12-01T23:59:59",
    prepDays: 2,
    applyToEventMode: true,
  },
  {
    id: "new_life_sale_2025",
    label: "新生活セール 2025",
    grade: "S",
    timezone: "Asia/Tokyo",
    start: "2025-03-01T00:00:00",
    end: "2025-03-05T23:59:59",
    prepDays: 3,
    applyToEventMode: true,
  },

  // ==========================================================================
  // Aクラス: 中規模セール（EventModeには影響しない推奨）
  // ==========================================================================
  {
    id: "smile_sale_jan_2025",
    label: "スマイルSALE 2025年1月",
    grade: "A",
    timezone: "Asia/Tokyo",
    start: "2025-01-03T00:00:00",
    end: "2025-01-07T23:59:59",
    prepDays: 2,
    applyToEventMode: false,
  },
  {
    id: "time_sale_matsuri_apr_2025",
    label: "タイムセール祭り 2025年4月",
    grade: "A",
    timezone: "Asia/Tokyo",
    start: "2025-04-19T00:00:00",
    end: "2025-04-21T23:59:59",
    prepDays: 2,
    applyToEventMode: false,
  },

  // ==========================================================================
  // Bクラス: 小規模キャンペーン（サンプル）
  // ==========================================================================
  {
    id: "fashion_week_2025",
    label: "ファッションウィーク 2025",
    grade: "B",
    timezone: "Asia/Tokyo",
    start: "2025-09-15T00:00:00",
    end: "2025-09-21T23:59:59",
    prepDays: 1,
    applyToEventMode: false,
  },
];

// =============================================================================
// EventMode解決関数
// =============================================================================

/**
 * 日付文字列をDateオブジェクトに変換（タイムゾーン考慮）
 *
 * 簡易実装: ISO8601形式の文字列をパース
 * 本格的なタイムゾーン処理が必要な場合は luxon などを使用
 */
function parseEventDate(dateStr: string, _timezone: string): Date {
  // ISO8601形式をパース
  // 注意: 本格的なタイムゾーン処理には luxon などのライブラリを使用すること
  return new Date(dateStr);
}

/**
 * 準備期間の開始日時を計算
 *
 * @param eventStart - イベント開始日時
 * @param prepDays - 準備期間（日数）
 * @returns 準備期間開始日時
 */
function calculatePrepStart(eventStart: Date, prepDays: number): Date {
  const prepStart = new Date(eventStart);
  prepStart.setDate(prepStart.getDate() - prepDays);
  prepStart.setHours(0, 0, 0, 0);
  return prepStart;
}

/**
 * 現在時刻がイベントのどの期間に該当するかを判定
 *
 * @param now - 現在時刻
 * @param event - イベント定義
 * @returns 該当するEventMode（NONE / BIG_SALE_PREP / BIG_SALE_DAY）
 */
function determineEventPhase(now: Date, event: SaleEventDefinition): EventMode {
  const eventStart = parseEventDate(event.start, event.timezone);
  const eventEnd = parseEventDate(event.end, event.timezone);
  const prepStart = calculatePrepStart(eventStart, event.prepDays);

  // セール本番期間
  if (now >= eventStart && now <= eventEnd) {
    return "BIG_SALE_DAY";
  }

  // 準備期間（prepStart〜eventStartの前日23:59:59）
  if (now >= prepStart && now < eventStart) {
    return "BIG_SALE_PREP";
  }

  return "NONE";
}

/**
 * イベントグレードの優先度を数値化
 */
function getGradePriority(grade: EventGrade): number {
  switch (grade) {
    case "S":
      return 3;
    case "A":
      return 2;
    case "B":
      return 1;
    default:
      return 0;
  }
}

/**
 * カレンダーからEventModeを解決
 *
 * @param now - 現在時刻
 * @param calendar - イベントカレンダー（デフォルト: SALE_EVENT_CALENDAR）
 * @returns EventMode解決結果
 *
 * ロジック:
 * 1. applyToEventMode === true のイベントのみを対象
 * 2. 各イベントについて、準備期間または本番期間に該当するか判定
 * 3. 複数イベントが該当する場合:
 *    - gradeの優先順位: 'S' > 'A' > 'B'
 *    - gradeが同じ場合は開始日が最も近いイベントを優先
 * 4. 該当イベントなし → eventMode = 'NONE', activeEvent = null
 */
export function resolveEventModeFromCalendar(
  now: Date,
  calendar: SaleEventDefinition[] = SALE_EVENT_CALENDAR
): EventModeResolutionResult {
  // applyToEventMode === true のイベントのみフィルタ
  const applicableEvents = calendar.filter((e) => e.applyToEventMode);

  // 各イベントのフェーズを判定
  const matchedEvents: Array<{
    event: SaleEventDefinition;
    phase: EventMode;
    startDate: Date;
  }> = [];

  for (const event of applicableEvents) {
    const phase = determineEventPhase(now, event);
    if (phase !== "NONE") {
      matchedEvents.push({
        event,
        phase,
        startDate: parseEventDate(event.start, event.timezone),
      });
    }
  }

  // 該当イベントなし
  if (matchedEvents.length === 0) {
    return {
      eventMode: "NONE",
      activeEvent: null,
    };
  }

  // 複数イベントが該当する場合、優先度でソート
  matchedEvents.sort((a, b) => {
    // 1. グレード優先（S > A > B）
    const gradeDiff =
      getGradePriority(b.event.grade) - getGradePriority(a.event.grade);
    if (gradeDiff !== 0) return gradeDiff;

    // 2. 同グレードなら開始日が近い方を優先
    return a.startDate.getTime() - b.startDate.getTime();
  });

  // 最優先イベントを採用
  const topMatch = matchedEvents[0];
  return {
    eventMode: topMatch.phase,
    activeEvent: topMatch.event,
  };
}

// =============================================================================
// EVENT_MODE_SOURCE 関連
// =============================================================================

/**
 * EventMode決定ソース
 *
 * - 'MANUAL': 環境変数 EVENT_MODE から手動設定（従来の方式）
 * - 'CALENDAR': カレンダーから自動判定
 */
export type EventModeSource = "MANUAL" | "CALENDAR";

/**
 * 有効なEventModeSource一覧
 */
export const VALID_EVENT_MODE_SOURCES: readonly EventModeSource[] = [
  "MANUAL",
  "CALENDAR",
] as const;

/**
 * 値がEventModeSourceかどうかを判定
 */
export function isValidEventModeSource(value: unknown): value is EventModeSource {
  return (
    typeof value === "string" &&
    VALID_EVENT_MODE_SOURCES.includes(value as EventModeSource)
  );
}

/**
 * 環境変数からEventModeSourceを取得
 *
 * @returns EventModeSource（デフォルト: 'MANUAL'）
 */
export function getEventModeSource(): EventModeSource {
  const value = process.env.EVENT_MODE_SOURCE;
  if (value && isValidEventModeSource(value)) {
    return value;
  }
  return "MANUAL";
}

// =============================================================================
// 統合EventMode決定
// =============================================================================

/**
 * EventMode決定の詳細結果
 */
export interface EventModeDecision {
  /** 決定されたEventMode */
  eventMode: EventMode;

  /** 決定ソース（MANUAL / CALENDAR） */
  source: EventModeSource;

  /** アクティブなイベントID（カレンダー使用時） */
  eventId: string | null;

  /** アクティブなイベントグレード（カレンダー使用時） */
  eventGrade: EventGrade | null;

  /** アクティブなイベントラベル（カレンダー使用時） */
  eventLabel: string | null;
}

/**
 * EventModeを決定（統合関数）
 *
 * EVENT_MODE_SOURCE に応じて、手動設定またはカレンダーからEventModeを決定
 *
 * @param now - 現在時刻（カレンダー使用時）
 * @param manualEventMode - 手動設定のEventMode（環境変数 EVENT_MODE から）
 * @param calendar - イベントカレンダー
 * @returns EventMode決定結果
 */
export function determineEventMode(
  now: Date,
  manualEventMode: EventMode,
  calendar: SaleEventDefinition[] = SALE_EVENT_CALENDAR
): EventModeDecision {
  const source = getEventModeSource();

  if (source === "CALENDAR") {
    // カレンダーから自動判定
    const resolution = resolveEventModeFromCalendar(now, calendar);
    return {
      eventMode: resolution.eventMode,
      source: "CALENDAR",
      eventId: resolution.activeEvent?.id ?? null,
      eventGrade: resolution.activeEvent?.grade ?? null,
      eventLabel: resolution.activeEvent?.label ?? null,
    };
  }

  // 手動設定（従来の方式）
  return {
    eventMode: manualEventMode,
    source: "MANUAL",
    eventId: null,
    eventGrade: null,
    eventLabel: null,
  };
}

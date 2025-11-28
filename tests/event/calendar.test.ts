/**
 * イベントカレンダー テスト
 */

import {
  EventGrade,
  SaleEventDefinition,
  SALE_EVENT_CALENDAR,
  resolveEventModeFromCalendar,
  isValidEventGrade,
  isValidEventModeSource,
  determineEventMode,
} from "../../src/event/calendar";

describe("イベントカレンダー", () => {
  // テスト用カレンダー
  const testCalendar: SaleEventDefinition[] = [
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
      id: "smile_sale_jan_2025",
      label: "スマイルSALE 2025年1月",
      grade: "A",
      timezone: "Asia/Tokyo",
      start: "2025-01-03T00:00:00",
      end: "2025-01-07T23:59:59",
      prepDays: 2,
      applyToEventMode: false, // EventModeに影響しない
    },
  ];

  describe("isValidEventGrade", () => {
    it("有効なEventGradeを判定できる", () => {
      expect(isValidEventGrade("S")).toBe(true);
      expect(isValidEventGrade("A")).toBe(true);
      expect(isValidEventGrade("B")).toBe(true);
    });

    it("無効な値を判定できる", () => {
      expect(isValidEventGrade("C")).toBe(false);
      expect(isValidEventGrade("")).toBe(false);
      expect(isValidEventGrade(null)).toBe(false);
      expect(isValidEventGrade(undefined)).toBe(false);
    });
  });

  describe("isValidEventModeSource", () => {
    it("有効なEventModeSourceを判定できる", () => {
      expect(isValidEventModeSource("MANUAL")).toBe(true);
      expect(isValidEventModeSource("CALENDAR")).toBe(true);
    });

    it("無効な値を判定できる", () => {
      expect(isValidEventModeSource("AUTO")).toBe(false);
      expect(isValidEventModeSource("")).toBe(false);
      expect(isValidEventModeSource(null)).toBe(false);
    });
  });

  describe("resolveEventModeFromCalendar", () => {
    describe("セール本番期間（BIG_SALE_DAY）", () => {
      it("Prime Day当日はBIG_SALE_DAYを返す", () => {
        const now = new Date("2025-07-15T12:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("BIG_SALE_DAY");
        expect(result.activeEvent).not.toBeNull();
        expect(result.activeEvent?.id).toBe("prime_day_2025");
      });

      it("Prime Day 2日目もBIG_SALE_DAYを返す", () => {
        const now = new Date("2025-07-16T18:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("BIG_SALE_DAY");
        expect(result.activeEvent?.id).toBe("prime_day_2025");
      });

      it("Black Friday当日はBIG_SALE_DAYを返す", () => {
        const now = new Date("2025-11-28T10:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("BIG_SALE_DAY");
        expect(result.activeEvent?.id).toBe("black_friday_2025");
      });
    });

    describe("準備期間（BIG_SALE_PREP）", () => {
      it("Prime Day 3日前はBIG_SALE_PREPを返す", () => {
        const now = new Date("2025-07-12T12:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("BIG_SALE_PREP");
        expect(result.activeEvent?.id).toBe("prime_day_2025");
      });

      it("Prime Day 1日前はBIG_SALE_PREPを返す", () => {
        const now = new Date("2025-07-14T23:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("BIG_SALE_PREP");
        expect(result.activeEvent?.id).toBe("prime_day_2025");
      });

      it("Black Friday 2日前はBIG_SALE_PREPを返す", () => {
        const now = new Date("2025-11-26T12:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("BIG_SALE_PREP");
        expect(result.activeEvent?.id).toBe("black_friday_2025");
      });
    });

    describe("通常日（NONE）", () => {
      it("イベントがない日はNONEを返す", () => {
        const now = new Date("2025-06-01T12:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("NONE");
        expect(result.activeEvent).toBeNull();
      });

      it("Prime Day終了後はNONEを返す", () => {
        const now = new Date("2025-07-17T12:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("NONE");
        expect(result.activeEvent).toBeNull();
      });

      it("Prime Day準備期間より前はNONEを返す", () => {
        const now = new Date("2025-07-10T12:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        expect(result.eventMode).toBe("NONE");
        expect(result.activeEvent).toBeNull();
      });
    });

    describe("applyToEventMode = false のイベント", () => {
      it("applyToEventMode = false のイベントは無視される", () => {
        // スマイルSALE期間中
        const now = new Date("2025-01-05T12:00:00");
        const result = resolveEventModeFromCalendar(now, testCalendar);

        // applyToEventMode = false なのでNONEを返す
        expect(result.eventMode).toBe("NONE");
        expect(result.activeEvent).toBeNull();
      });
    });

    describe("複数イベント重複時の優先度", () => {
      it("グレードが高いイベントを優先する", () => {
        // Sクラスと Aクラスが重複する場合
        const overlappingCalendar: SaleEventDefinition[] = [
          {
            id: "a_class_event",
            label: "Aクラスイベント",
            grade: "A",
            timezone: "Asia/Tokyo",
            start: "2025-07-15T00:00:00",
            end: "2025-07-15T23:59:59",
            prepDays: 2,
            applyToEventMode: true,
          },
          {
            id: "s_class_event",
            label: "Sクラスイベント",
            grade: "S",
            timezone: "Asia/Tokyo",
            start: "2025-07-15T00:00:00",
            end: "2025-07-15T23:59:59",
            prepDays: 3,
            applyToEventMode: true,
          },
        ];

        const now = new Date("2025-07-15T12:00:00");
        const result = resolveEventModeFromCalendar(now, overlappingCalendar);

        expect(result.eventMode).toBe("BIG_SALE_DAY");
        expect(result.activeEvent?.id).toBe("s_class_event"); // Sクラスが優先
      });
    });
  });

  describe("determineEventMode", () => {
    const originalEnv = process.env.EVENT_MODE_SOURCE;

    afterEach(() => {
      if (originalEnv) {
        process.env.EVENT_MODE_SOURCE = originalEnv;
      } else {
        delete process.env.EVENT_MODE_SOURCE;
      }
    });

    it("EVENT_MODE_SOURCE = CALENDAR の場合、カレンダーからEventModeを決定する", () => {
      process.env.EVENT_MODE_SOURCE = "CALENDAR";

      const now = new Date("2025-07-15T12:00:00");
      const result = determineEventMode(now, "NONE", testCalendar);

      expect(result.source).toBe("CALENDAR");
      expect(result.eventMode).toBe("BIG_SALE_DAY");
      expect(result.eventId).toBe("prime_day_2025");
      expect(result.eventGrade).toBe("S");
    });

    it("EVENT_MODE_SOURCE = MANUAL の場合、手動設定のEventModeを使用する", () => {
      process.env.EVENT_MODE_SOURCE = "MANUAL";

      const now = new Date("2025-07-15T12:00:00");
      const result = determineEventMode(now, "BIG_SALE_PREP", testCalendar);

      expect(result.source).toBe("MANUAL");
      expect(result.eventMode).toBe("BIG_SALE_PREP"); // 手動設定値
      expect(result.eventId).toBeNull();
      expect(result.eventGrade).toBeNull();
    });

    it("EVENT_MODE_SOURCE が未設定の場合、MANUAL として扱う", () => {
      delete process.env.EVENT_MODE_SOURCE;

      const now = new Date("2025-07-15T12:00:00");
      const result = determineEventMode(now, "NONE", testCalendar);

      expect(result.source).toBe("MANUAL");
      expect(result.eventMode).toBe("NONE");
    });
  });

  describe("SALE_EVENT_CALENDAR", () => {
    it("デフォルトカレンダーが存在する", () => {
      expect(SALE_EVENT_CALENDAR).toBeDefined();
      expect(Array.isArray(SALE_EVENT_CALENDAR)).toBe(true);
      expect(SALE_EVENT_CALENDAR.length).toBeGreaterThan(0);
    });

    it("Sクラスイベントが含まれている", () => {
      const sClassEvents = SALE_EVENT_CALENDAR.filter(
        (e) => e.grade === "S" && e.applyToEventMode
      );
      expect(sClassEvents.length).toBeGreaterThan(0);
    });

    it("Prime Dayが含まれている", () => {
      const primeDay = SALE_EVENT_CALENDAR.find((e) =>
        e.id.includes("prime_day")
      );
      expect(primeDay).toBeDefined();
      expect(primeDay?.grade).toBe("S");
      expect(primeDay?.applyToEventMode).toBe(true);
    });

    it("Black Fridayが含まれている", () => {
      const blackFriday = SALE_EVENT_CALENDAR.find((e) =>
        e.id.includes("black_friday")
      );
      expect(blackFriday).toBeDefined();
      expect(blackFriday?.grade).toBe("S");
      expect(blackFriday?.applyToEventMode).toBe(true);
    });
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { computeAvailability, gridClaimKeys } from "./availability";
import { isAffected } from "./affected";
import { bookingRefusal, canTransition } from "./policy";
import { validateWeek } from "./schedule";
import type { AvailabilityInput, DayRule, SessionRule } from "./types";

const tz = "Asia/Kolkata";

function monday(): DateTime {
  let day = DateTime.fromISO("2026-10-12", { zone: tz }).startOf("day");
  while (day.weekday !== 1) day = day.plus({ days: 1 });
  return day;
}

function session(
  partial: Partial<SessionRule> & Pick<SessionRule, "id" | "start" | "end">
): SessionRule {
  return {
    name: partial.id,
    mode: "fixed",
    slotMinutes: 15,
    sessionCap: 20,
    bufferMinutes: 0,
    ...partial,
  };
}

function week(extra?: Partial<SessionRule>): DayRule[] {
  const morning = session({ id: "morning", name: "Morning", start: "10:00", end: "13:00", ...extra });
  const evening = session({ id: "evening", name: "Evening", start: "17:00", end: "20:00", ...extra });
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isWorking: weekday !== 0,
    sessions: weekday === 0 ? [] : weekday === 6 ? [morning] : [morning, evening],
  }));
}

function input(day: DateTime, overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    date: day.toISODate()!,
    now: day.set({ hour: 8 }).toJSDate(),
    timezone: tz,
    weekdayRules: week(),
    breaks: [],
    exceptions: [],
    busy: [],
    durationMinutes: 15,
    minNoticeMinutes: 60,
    maxAdvanceDays: 30,
    dailyCap: 40,
    bookingsOpen: true,
    gridMinutes: 5,
    ...overrides,
  };
}

function clocks(day: DateTime, overrides?: Partial<AvailabilityInput>): string[] {
  return computeAvailability(input(day, overrides)).slots.map((slot) =>
    DateTime.fromISO(slot.startAt).setZone(tz).toFormat("HH:mm")
  );
}

describe("fixed availability", () => {
  const day = monday();

  it("builds clock slots from the working sessions", () => {
    const slots = clocks(day);
    assert.equal(slots.length, 24);
    assert.deepEqual(slots.slice(0, 3), ["10:00", "10:15", "10:30"]);
    assert.equal(slots[11], "12:45");
    assert.equal(slots[12], "17:00");
    assert.equal(slots.at(-1), "19:45");
  });

  it("keeps Sunday closed and lets special hours reopen it", () => {
    const sunday = day.minus({ days: 1 });
    assert.equal(computeAvailability(input(sunday)).closedReason, "not_working");
    const opened = computeAvailability(
      input(sunday, {
        durationMinutes: 30,
        exceptions: [
          {
            type: "special_hours",
            startDate: sunday.toISODate()!,
            endDate: sunday.toISODate()!,
            sessions: [session({ id: "extra", name: "Extra", start: "09:00", end: "09:30", slotMinutes: 30 })],
          },
        ],
      })
    );
    assert.deepEqual(
      opened.slots.map((slot) => DateTime.fromISO(slot.startAt).setZone(tz).toFormat("HH:mm")),
      ["09:00"]
    );
  });

  it("lets leave beat special hours, and a holiday close a working day", () => {
    const date = day.toISODate()!;
    const leave = computeAvailability(
      input(day, {
        exceptions: [
          {
            type: "special_hours",
            startDate: date,
            endDate: date,
            sessions: [session({ id: "extra", start: "09:00", end: "12:00" })],
          },
          { type: "leave", startDate: date, endDate: date },
        ],
      })
    );
    assert.equal(leave.closedReason, "leave");
    assert.equal(
      computeAvailability(input(day, { exceptions: [{ type: "holiday", startDate: date, endDate: date }] }))
        .closedReason,
      "holiday"
    );
  });

  it("skips starts that land on a break, including a longer visit", () => {
    const withBreak = clocks(day, {
      breaks: [{ weekday: null, start: "12:00", end: "12:30", label: "Lunch" }],
    });
    assert.ok(withBreak.includes("11:45"));
    assert.ok(!withBreak.includes("12:00"));
    assert.ok(!withBreak.includes("12:15"));
    assert.ok(withBreak.includes("12:30"));

    const longVisit = clocks(day, {
      durationMinutes: 30,
      breaks: [{ weekday: 1, start: "12:00", end: "12:30", label: "Lunch" }],
    });
    assert.ok(!longVisit.includes("11:45"));
    assert.ok(longVisit.includes("11:30"));
  });

  it("treats the previous visit's buffer as occupied time", () => {
    const start = day.set({ hour: 10 }).toJSDate();
    const slots = clocks(day, {
      busy: [
        {
          startAt: start,
          endAt: day.set({ hour: 10, minute: 20 }).toJSDate(),
          sessionId: "morning",
          countsTowardCap: true,
        },
      ],
    });
    assert.ok(!slots.includes("10:00"));
    assert.ok(!slots.includes("10:15"));
    assert.ok(slots.includes("10:30"));
  });

  it("does not offer a visit that would run past the session end", () => {
    const slots = clocks(day, {
      durationMinutes: 30,
      weekdayRules: week({ end: "11:00" }).map((rule) =>
        rule.weekday === 1
          ? {
              ...rule,
              sessions: [session({ id: "morning", name: "Morning", start: "10:00", end: "11:00" })],
            }
          : { ...rule, isWorking: false, sessions: [] }
      ),
    });
    assert.deepEqual(slots, ["10:00", "10:15", "10:30"]);
  });

  it("enforces daily and session caps", () => {
    const booked = {
      startAt: day.set({ hour: 10 }).toJSDate(),
      endAt: day.set({ hour: 10, minute: 15 }).toJSDate(),
      sessionId: "morning",
      countsTowardCap: true,
    };
    assert.equal(
      computeAvailability(input(day, { dailyCap: 1, busy: [booked] })).closedReason,
      "full"
    );
    const eveningOnly = computeAvailability(
      input(day, {
        busy: [booked],
        weekdayRules: week({ sessionCap: 1 }),
      })
    );
    assert.ok(eveningOnly.slots.length > 0);
    assert.ok(eveningOnly.slots.every((slot) => slot.sessionId === "evening"));
    const orphaned = computeAvailability(
      input(day, {
        weekdayRules: week({ sessionCap: 1 }),
        busy: [{ ...booked, sessionId: "retired-morning-id" }],
      })
    );
    assert.ok(orphaned.slots.every((slot) => slot.sessionId === "evening"));
    assert.equal(
      computeAvailability(
        input(day, {
          busy: [booked],
          exceptions: [{ type: "daily_cap", startDate: day.toISODate()!, endDate: day.toISODate()!, dailyCap: 1 }],
        })
      ).closedReason,
      "full"
    );
  });

  it("applies the booking window and a pause", () => {
    const now = day.set({ hour: 9, minute: 30 });
    const slots = clocks(day, { now: now.toJSDate(), minNoticeMinutes: 60 });
    assert.ok(!slots.includes("10:00"));
    assert.ok(!slots.includes("10:15"));
    assert.equal(slots[0], "10:30");

    assert.equal(
      computeAvailability(input(day.plus({ days: 31 }), { now: day.set({ hour: 8 }).toJSDate() }))
        .closedReason,
      "outside_window"
    );
    assert.equal(
      computeAvailability(input(day.minus({ days: 1 }), { now: day.set({ hour: 8 }).toJSDate() }))
        .closedReason,
      "outside_window"
    );
    assert.equal(computeAvailability(input(day, { bookingsOpen: false })).closedReason, "bookings_paused");
  });

  it("removes a blocked range and keeps the edges", () => {
    const date = day.toISODate()!;
    const slots = clocks(day, {
      exceptions: [{ type: "block", startDate: date, endDate: date, startTime: "11:00", endTime: "12:00" }],
    });
    assert.ok(slots.includes("10:45"));
    assert.ok(!slots.includes("11:00"));
    assert.ok(!slots.includes("11:45"));
    assert.ok(slots.includes("12:00"));
  });
});

describe("token sessions", () => {
  const day = monday();

  function tokenInput(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
    return input(day, {
      weekdayRules: [
        {
          weekday: jsWeekday(day),
          isWorking: true,
          sessions: [
            session({
              id: "morning",
              name: "Morning",
              start: "10:00",
              end: "13:00",
              mode: "token",
              sessionCap: 5,
              bufferMinutes: 5,
            }),
          ],
        },
      ],
      ...overrides,
    });
  }

  function jsWeekday(dt: DateTime): number {
    return dt.weekday % 7;
  }

  it("offers the next token without treating estimates as exclusive clock slots", () => {
    const result = computeAvailability(tokenInput());
    assert.equal(result.slots.length, 1);
    assert.equal(result.slots[0].tokenPreview, 1);
    assert.equal(DateTime.fromISO(result.slots[0].startAt).setZone(tz).toFormat("HH:mm"), "10:00");

    const queued = computeAvailability(
      tokenInput({
        busy: [0, 1].map((index) => ({
          startAt: day.set({ hour: 10, minute: index * 20 }).toJSDate(),
          endAt: day.set({ hour: 10, minute: index * 20 + 20 }).toJSDate(),
          sessionId: "morning",
          countsTowardCap: true,
        })),
      })
    );
    assert.equal(queued.slots[0].tokenPreview, 3);
  });

  it("stops at the session cap and when the session is over", () => {
    const full = computeAvailability(
      tokenInput({
        busy: Array.from({ length: 5 }, () => ({
          startAt: day.set({ hour: 10 }).toJSDate(),
          endAt: day.set({ hour: 10, minute: 20 }).toJSDate(),
          sessionId: "morning",
          countsTowardCap: true,
        })),
      })
    );
    assert.equal(full.closedReason, "full");
    assert.equal(
      computeAvailability(tokenInput({ now: day.set({ hour: 14 }).toJSDate() })).closedReason,
      "notice"
    );
  });

  it("applies min notice before the session and clamps the estimate once it has started", () => {
    assert.equal(
      computeAvailability(tokenInput({ now: day.set({ hour: 9, minute: 30 }).toJSDate() })).closedReason,
      "notice"
    );
    const live = computeAvailability(
      tokenInput({ now: day.set({ hour: 11, minute: 7 }).toJSDate() })
    );
    assert.equal(DateTime.fromISO(live.slots[0].startAt).setZone(tz).toFormat("HH:mm"), "11:10");
  });
});

describe("claims", () => {
  it("claims each grid cell of the occupied window", () => {
    const start = DateTime.fromISO("2026-10-12T10:00:00+05:30").toJSDate();
    const until = DateTime.fromISO("2026-10-12T10:20:00+05:30").toJSDate();
    assert.deepEqual(gridClaimKeys(start, until, 5), [
      "2026-10-12T04:30:00.000Z",
      "2026-10-12T04:35:00.000Z",
      "2026-10-12T04:40:00.000Z",
      "2026-10-12T04:45:00.000Z",
    ]);
  });
});

describe("policy", () => {
  const limits = { dailyLimit: 1, futureLimit: 3, phoneDailyLimit: 3 };

  it("refuses flagged patients, day limits, and phone limits", () => {
    assert.match(
      bookingRefusal({ ...limits, sameDayCount: 0, futureCount: 0, phoneDayCount: 0, flagged: true, allowFlagged: false }) || "",
      /call the clinic/
    );
    assert.equal(
      bookingRefusal({ ...limits, sameDayCount: 0, futureCount: 0, phoneDayCount: 0, flagged: true, allowFlagged: true }),
      null
    );
    assert.match(
      bookingRefusal({ ...limits, sameDayCount: 1, futureCount: 0, phoneDayCount: 1, flagged: false, allowFlagged: false }) || "",
      /already has a booking/
    );
    assert.match(
      bookingRefusal({ ...limits, sameDayCount: 0, futureCount: 0, phoneDayCount: 3, flagged: false, allowFlagged: false }) || "",
      /phone number/
    );
  });

  it("only allows the live status moves", () => {
    assert.equal(canTransition("held", "confirmed"), true);
    assert.equal(canTransition("pending_approval", "confirmed"), true);
    assert.equal(canTransition("confirmed", "no_show"), true);
    assert.equal(canTransition("cancelled", "completed"), false);
    assert.equal(canTransition("held", "completed"), false);
  });
});

describe("affected visits and schedule rules", () => {
  const day = monday();

  it("finds visits hit by leave, a block, or hours that no longer cover them", () => {
    const visit = {
      date: day.toISODate()!,
      startAt: day.set({ hour: 11 }).toJSDate(),
      endAt: day.set({ hour: 11, minute: 30 }).toJSDate(),
      status: "confirmed",
    };
    assert.equal(
      isAffected(visit, { type: "leave", startDate: visit.date, endDate: visit.date }, tz),
      true
    );
    assert.equal(isAffected({ ...visit, status: "cancelled" }, { type: "leave", startDate: visit.date, endDate: visit.date }, tz), false);
    assert.equal(
      isAffected(visit, { type: "block", startDate: visit.date, endDate: visit.date, startTime: "11:00", endTime: "12:00" }, tz),
      true
    );
    assert.equal(
      isAffected(visit, { type: "block", startDate: visit.date, endDate: visit.date, startTime: "12:00", endTime: "13:00" }, tz),
      false
    );
    assert.equal(
      isAffected(
        visit,
        {
          type: "special_hours",
          startDate: visit.date,
          endDate: visit.date,
          sessions: [session({ id: "late", start: "17:00", end: "20:00" })],
        },
        tz
      ),
      true
    );
  });

  it("rejects overlapping sessions and steps that miss the grid", () => {
    const days = week();
    assert.equal(validateWeek(days, [], 5), null);
    const broken = days.map((rule) =>
      rule.weekday === 1
        ? {
            ...rule,
            sessions: [
              session({ id: "a", name: "A", start: "10:00", end: "12:00" }),
              session({ id: "b", name: "B", start: "11:00", end: "13:00" }),
            ],
          }
        : rule
    );
    assert.match(validateWeek(broken, [], 5) || "", /overlaps/);
    const step = days.map((rule) =>
      rule.weekday === 1
        ? { ...rule, sessions: [session({ id: "a", name: "A", start: "10:00", end: "12:00", slotMinutes: 12 })] }
        : rule
    );
    assert.match(validateWeek(step, [], 5) || "", /multiple of the 5-minute grid/);
  });
});

import { DateTime } from "luxon";
import type {
  AvailabilityInput,
  AvailabilityResult,
  BusyInterval,
  ClosedReason,
  ExceptionRule,
  SessionRule,
  SlotOffer,
} from "./types";
import { atTime, jsWeekday, overlaps, roundUpToGrid } from "./time";

/**
 * Slots are derived. `busy.endAt` is exclusive and already includes that
 * visit's buffer. A candidate also occupies its own buffer after `end`.
 * Ranges are half-open, so a visit ending at 12:00 does not hit a 12:00 break.
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const zone = input.timezone;
  const now = DateTime.fromJSDate(input.now, { zone });
  const day = DateTime.fromISO(input.date, { zone }).startOf("day");
  if (!day.isValid) return { slots: [], closedReason: "outside_window" };

  const today = now.startOf("day");
  const lastBookable = today.plus({ days: input.maxAdvanceDays });
  if (day.toMillis() < today.toMillis() || day.toMillis() > lastBookable.toMillis()) {
    return { slots: [], closedReason: "outside_window" };
  }
  if (!input.bookingsOpen) return { slots: [], closedReason: "bookings_paused" };

  const date = day.toISODate()!;
  const covering = input.exceptions.filter(
    (exception) => date >= exception.startDate && date <= exception.endDate
  );
  if (covering.some((exception) => exception.type === "holiday")) {
    return { slots: [], closedReason: "holiday" };
  }
  if (covering.some((exception) => exception.type === "leave")) {
    return { slots: [], closedReason: "leave" };
  }

  const special = covering.find((exception) => exception.type === "special_hours");
  const weekday = jsWeekday(day);
  const rule = input.weekdayRules.find((item) => item.weekday === weekday);
  const sessions = special ? special.sessions || [] : rule?.isWorking ? rule.sessions : [];
  if (!sessions.length) return { slots: [], closedReason: "not_working" };

  const override = [...covering]
    .reverse()
    .find((exception) => exception.type === "daily_cap" && exception.dailyCap != null);
  const dailyCap = override?.dailyCap ?? input.dailyCap;
  const capUsed = input.busy.filter((item) => item.countsTowardCap).length;
  if (capUsed >= dailyCap) return { slots: [], closedReason: "full" };

  const blocks = collectBlocks(day, covering, zone);
  const breaks = input.breaks
    .filter((item) => item.weekday == null || item.weekday === weekday)
    .map((item) => ({
      start: atTime(date, item.start, zone).toMillis(),
      end: atTime(date, item.end, zone).toMillis(),
    }))
    .filter((item) => item.start < item.end);

  const slots: SlotOffer[] = [];
  let removedByOccupancy = false;
  const knownSessionIds = new Set(sessions.map((session) => session.id));

  for (const session of sessions) {
    const sessionStart = atTime(date, session.start, zone);
    const sessionEnd = atTime(date, session.end, zone);
    if (!sessionStart.isValid || !sessionEnd.isValid || sessionEnd <= sessionStart) continue;

    const sessionStartMs = sessionStart.toMillis();
    const sessionEndMs = sessionEnd.toMillis();
    const sessionUsed = input.busy.filter((item) =>
      usesSession(item, session.id, knownSessionIds, sessionStartMs, sessionEndMs)
    ).length;
    if (sessionUsed >= session.sessionCap) {
      removedByOccupancy = true;
      continue;
    }

    if (session.mode === "token") {
      const offer = tokenOffer({
        session,
        sessionStart,
        sessionEnd,
        now,
        used: sessionUsed,
        input,
      });
      if (offer === "full") removedByOccupancy = true;
      else if (offer && offer !== "notice") slots.push(offer);
      continue;
    }

    let cursor = sessionStart;
    while (
      cursor.plus({ minutes: input.durationMinutes }).toMillis() <= sessionEnd.toMillis()
    ) {
      const end = cursor.plus({ minutes: input.durationMinutes });
      const bufferEnd = end.plus({ minutes: session.bufferMinutes });
      const startMs = cursor.toMillis();
      const endMs = end.toMillis();
      const noticeLine = now.plus({ minutes: input.minNoticeMinutes });

      if (cursor.toMillis() < noticeLine.toMillis()) {
        cursor = cursor.plus({ minutes: session.slotMinutes });
        continue;
      }

      const hitsBreak = breaks.some((item) => overlaps(startMs, endMs, item.start, item.end));
      const hitsBlock = blocks.some((item) => overlaps(startMs, endMs, item.start, item.end));
      const hitsBusy = input.busy.some((item) =>
        overlaps(startMs, bufferEnd.toMillis(), item.startAt.getTime(), item.endAt.getTime())
      );
      if (hitsBreak || hitsBlock || hitsBusy) {
        removedByOccupancy = true;
        cursor = cursor.plus({ minutes: session.slotMinutes });
        continue;
      }

      slots.push({
        sessionId: session.id,
        sessionName: session.name,
        mode: "fixed",
        startAt: cursor.toISO()!,
        endAt: end.toISO()!,
        label: cursor.toFormat("h:mm a"),
        bufferMinutes: session.bufferMinutes,
      });
      cursor = cursor.plus({ minutes: session.slotMinutes });
    }
  }

  if (slots.length) return { slots };
  const closedReason: ClosedReason = removedByOccupancy ? "full" : "notice";
  return { slots: [], closedReason };
}

function tokenOffer(args: {
  session: SessionRule;
  sessionStart: DateTime;
  sessionEnd: DateTime;
  now: DateTime;
  used: number;
  input: AvailabilityInput;
}): SlotOffer | "full" | "notice" | null {
  const { session, sessionStart, sessionEnd, now, used, input } = args;
  if (sessionEnd.toMillis() <= now.toMillis()) return "notice";
  const notStarted = now.toMillis() < sessionStart.toMillis();
  const noticeLine = now.plus({ minutes: input.minNoticeMinutes });
  if (notStarted && sessionStart.toMillis() < noticeLine.toMillis()) return "notice";
  if (used >= session.sessionCap) return "full";

  let approx = sessionStart.plus({
    minutes: used * (input.durationMinutes + session.bufferMinutes),
  });
  if (approx.toMillis() < now.toMillis()) {
    approx = roundUpToGrid(now, input.gridMinutes);
  }
  const end = approx.plus({ minutes: input.durationMinutes });
  return {
    sessionId: session.id,
    sessionName: session.name,
    mode: "token",
    startAt: approx.toISO()!,
    endAt: end.toISO()!,
    tokenPreview: used + 1,
    label: `#${used + 1} · about ${approx.toFormat("h:mm a")}`,
    bufferMinutes: session.bufferMinutes,
  };
}

function usesSession(
  item: BusyInterval,
  sessionId: string,
  knownSessionIds: Set<string>,
  sessionStart: number,
  sessionEnd: number
): boolean {
  if (!item.countsTowardCap) return false;
  if (item.sessionId === sessionId) return true;
  if (knownSessionIds.has(item.sessionId)) return false;
  return overlaps(item.startAt.getTime(), item.endAt.getTime(), sessionStart, sessionEnd);
}

function collectBlocks(
  day: DateTime,
  exceptions: ExceptionRule[],
  timezone: string
): { start: number; end: number }[] {
  const date = day.toISODate()!;
  const dayStart = day.toMillis();
  const dayEnd = day.plus({ days: 1 }).toMillis();
  const blocks: { start: number; end: number }[] = [];
  for (const exception of exceptions) {
    if (exception.type !== "block") continue;
    if (exception.startAt && exception.endAt) {
      const start = Math.max(new Date(exception.startAt).getTime(), dayStart);
      const end = Math.min(new Date(exception.endAt).getTime(), dayEnd);
      if (start < end) blocks.push({ start, end });
      continue;
    }
    if (!exception.startTime || !exception.endTime) continue;
    const start = atTime(date, exception.startTime, timezone).toMillis();
    const end = atTime(date, exception.endTime, timezone).toMillis();
    if (start < end) blocks.push({ start, end });
  }
  return blocks;
}

export function gridClaimKeys(start: Date, bufferUntil: Date, gridMinutes: number): string[] {
  const step = gridMinutes * 60 * 1000;
  const keys: string[] = [];
  for (let ms = start.getTime(); ms < bufferUntil.getTime(); ms += step) {
    keys.push(new Date(ms).toISOString());
  }
  return keys;
}

export function busyFromAppointment(appointment: {
  startAt: Date;
  endAt: Date;
  bufferUntil?: Date | null;
  sessionId: string;
}): BusyInterval {
  return {
    startAt: appointment.startAt,
    endAt: appointment.bufferUntil ?? appointment.endAt,
    sessionId: appointment.sessionId,
    countsTowardCap: true,
  };
}

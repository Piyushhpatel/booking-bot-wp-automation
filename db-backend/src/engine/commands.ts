import { DateTime } from "luxon";

export type DoctorCommand =
  | { type: "help" }
  | { type: "today" }
  | { type: "tomorrow" }
  | { type: "next" }
  | { type: "summary" }
  | { type: "close" }
  | { type: "open" }
  | { type: "day"; date: string }
  | { type: "done"; n: number }
  | { type: "noshow"; n: number }
  | { type: "cancel"; n: number }
  | { type: "limit"; n: number }
  | { type: "patient"; phone: string }
  | { type: "block"; date: string; start: string; end: string }
  | { type: "block_next"; hours: number }
  | { type: "leave"; startDate: string; endDate: string }
  | { type: "unknown" };

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function parseDoctorCommand(input: string, today: DateTime): DoctorCommand {
  const text = input.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  if (!lower) return { type: "unknown" };
  if (/^(help|\?|commands)$/.test(lower)) return { type: "help" };
  if (/^(today|aaj)$/.test(lower)) return { type: "today" };
  if (/^(tomorrow|kal)$/.test(lower)) return { type: "tomorrow" };
  if (lower === "next") return { type: "next" };
  if (/^(summary|count)$/.test(lower)) return { type: "summary" };
  if (/^(close bookings|close|pause bookings|pause)$/.test(lower)) return { type: "close" };
  if (/^(open bookings|open|resume bookings|resume)$/.test(lower)) return { type: "open" };

  const mark = lower.match(/^(done|complete|noshow|no-show|no show|cancel)\s+(\d+)$/);
  if (mark) {
    const n = Number(mark[2]);
    if (mark[1] === "done" || mark[1] === "complete") return { type: "done", n };
    if (mark[1] === "cancel") return { type: "cancel", n };
    return { type: "noshow", n };
  }

  const limit = lower.match(/^limit\s+(\d+)$/);
  if (limit) return { type: "limit", n: Number(limit[1]) };

  const patient = lower.match(/^patient\s+([+\d][\d\s-]{5,})$/);
  if (patient) {
    const phone = patient[1].replace(/\D/g, "");
    if (phone.length >= 8) return { type: "patient", phone };
  }

  const bookings = lower.match(/^bookings?\s+(.+)$/);
  if (bookings) {
    const date = parseLooseDate(bookings[1], today);
    if (date) return { type: "day", date };
  }

  const nextBlock = lower.match(/^block next (\d+)\s*(h|hr|hrs|hour|hours)$/);
  if (nextBlock) {
    const hours = Number(nextBlock[1]);
    if (hours >= 1 && hours <= 12) return { type: "block_next", hours };
  }

  const block = text.match(
    /^block\s+(.+?)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i
  );
  if (block) {
    const date = parseLooseDate(block[1], today);
    const start = parseClock(block[2]);
    const end = parseClock(block[3]);
    if (date && start && end && start < end) return { type: "block", date, start, end };
  }

  if (lower.startsWith("leave ")) {
    const range = splitDateRange(text.slice(6).trim(), today);
    if (range) return { type: "leave", startDate: range[0], endDate: range[1] };
  }

  return { type: "unknown" };
}

export function parseClock(raw: string): string | null {
  const source = raw.toLowerCase().replace(/\s+/g, "");
  const match = source.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] == null ? 0 : Number(match[2]);
  const suffix = match[3];
  if (minute > 59) return null;
  if (!suffix && match[2] == null) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "pm" && hour !== 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseLooseDate(raw: string, today: DateTime): string | null {
  const source = raw.trim().toLowerCase().replace(/,/g, "");
  if (!source) return null;
  if (source === "today" || source === "aaj") return today.toISODate();
  if (source === "tomorrow" || source === "kal") return today.plus({ days: 1 }).toISODate();

  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const dt = DateTime.fromObject(
      { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) },
      { zone: today.zone }
    );
    return dt.isValid ? dt.toISODate() : null;
  }

  const numeric = source.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (numeric) {
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : today.year;
    return rollDate(Number(numeric[1]), Number(numeric[2]), year, today, Boolean(numeric[3]));
  }

  const monthFirst = source.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (monthFirst && MONTHS[monthFirst[1]]) {
    const year = monthFirst[3] ? Number(monthFirst[3]) : today.year;
    return rollDate(
      Number(monthFirst[2]),
      MONTHS[monthFirst[1]],
      year,
      today,
      Boolean(monthFirst[3])
    );
  }

  const dayFirst = source.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if (dayFirst && MONTHS[dayFirst[2]]) {
    const year = dayFirst[3] ? Number(dayFirst[3]) : today.year;
    return rollDate(Number(dayFirst[1]), MONTHS[dayFirst[2]], year, today, Boolean(dayFirst[3]));
  }
  return null;
}

function rollDate(
  day: number,
  month: number,
  year: number,
  today: DateTime,
  yearWasExplicit: boolean
): string | null {
  let dt = DateTime.fromObject({ year, month, day }, { zone: today.zone });
  if (!dt.isValid || dt.day !== day) return null;
  if (!yearWasExplicit && dt.startOf("day") < today.startOf("day").minus({ days: 1 })) {
    dt = dt.plus({ years: 1 });
  }
  return dt.toISODate();
}

function splitDateRange(rest: string, today: DateTime): [string, string] | null {
  const withTo = rest.split(/\s+to\s+/i);
  if (withTo.length === 2) {
    const start = parseLooseDate(withTo[0], today);
    const end = parseLooseDate(withTo[1], today);
    if (start && end && start <= end) return [start, end];
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(rest)) {
    const only = parseLooseDate(rest, today);
    return only ? [only, only] : null;
  }
  const parts = rest.split(/\s*[-–]\s*/);
  if (parts.length === 2) {
    const start = parseLooseDate(parts[0], today);
    const end = parseLooseDate(parts[1], today);
    if (start && end && start <= end) return [start, end];
  }
  const only = parseLooseDate(rest, today);
  return only ? [only, only] : null;
}

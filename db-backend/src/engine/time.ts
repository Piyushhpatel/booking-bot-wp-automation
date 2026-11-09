import { DateTime } from "luxon";

export function clinicNow(timezone: string): DateTime {
  return DateTime.now().setZone(timezone);
}

export function parseClinicDate(isoDate: string, timezone: string): DateTime {
  return DateTime.fromISO(isoDate, { zone: timezone }).startOf("day");
}

export function atTime(isoDate: string, hhmm: string, timezone: string): DateTime {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return DateTime.invalid("bad time");
  return DateTime.fromISO(isoDate, { zone: timezone }).set({
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: 0,
    millisecond: 0,
  });
}

/** Luxon weekday is Monday=1 … Sunday=7. Clinic rules use Sunday=0 … Saturday=6. */
export function jsWeekday(dt: DateTime): number {
  return dt.weekday % 7;
}

export function isHHmm(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

export function roundUpToGrid(dt: DateTime, gridMinutes: number): DateTime {
  const base = dt.startOf("day");
  const minutes = dt.diff(base, "minutes").minutes;
  const rounded = Math.ceil(minutes / gridMinutes) * gridMinutes;
  return base.plus({ minutes: rounded });
}

export function formatWhen(iso: string, timezone: string, language: "en" | "hi"): string {
  const dt = DateTime.fromISO(iso).setZone(timezone);
  const locale = language === "hi" ? "hi-IN" : "en-IN";
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(dt.toJSDate());
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(dt.toJSDate());
  return `${date}, ${time}`;
}

export function formatDay(isoDate: string, timezone: string, language: "en" | "hi"): string {
  const dt = parseClinicDate(isoDate, timezone);
  return new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(dt.toJSDate());
}

export function formatClock(iso: string, timezone: string): string {
  const dt = DateTime.fromISO(iso).setZone(timezone);
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(dt.toJSDate());
}

export function formatInr(paise: number): string {
  const rupees = paise / 100;
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: whole ? 0 : 2,
    minimumFractionDigits: whole ? 0 : 2,
  }).format(rupees);
}

import type { BreakRule, DayRule, SessionRule } from "./types";
import { isHHmm } from "./time";

export function validateWeek(
  days: DayRule[],
  breaks: BreakRule[],
  gridMinutes: number
): string | null {
  if (!Number.isInteger(gridMinutes) || gridMinutes < 5 || gridMinutes > 60) {
    return "Grid must be a whole number of minutes from 5 to 60.";
  }
  if (days.length !== 7) return "A week needs all seven days.";
  const seen = new Set<number>();
  for (const day of days) {
    if (day.weekday < 0 || day.weekday > 6 || seen.has(day.weekday)) {
      return "Weekdays must be 0 (Sunday) through 6 (Saturday), once each.";
    }
    seen.add(day.weekday);
    if (!day.isWorking) continue;
    if (!day.sessions.length) return "A working day needs at least one session.";
    const sessions = [...day.sessions].sort((a, b) => a.start.localeCompare(b.start));
    let previousEnd = "";
    const ids = new Set<string>();
    for (const session of sessions) {
      const problem = validateSession(session, gridMinutes);
      if (problem) return problem;
      if (ids.has(session.id)) return "Session ids must be unique on a day.";
      ids.add(session.id);
      if (previousEnd && session.start < previousEnd) {
        return `${session.name} overlaps another session.`;
      }
      previousEnd = session.end;
    }
  }
  for (const item of breaks) {
    if (!isHHmm(item.start) || !isHHmm(item.end) || item.start >= item.end) {
      return "Each break needs a start before its end.";
    }
    if (item.weekday != null && (item.weekday < 0 || item.weekday > 6)) {
      return "Break weekday must be 0–6, or empty for every day.";
    }
  }
  return null;
}

export function validateSession(session: SessionRule, gridMinutes: number): string | null {
  if (!session.id.trim() || !session.name.trim()) return "Each session needs an id and a name.";
  if (!isHHmm(session.start) || !isHHmm(session.end) || session.start >= session.end) {
    return `${session.name || "Session"} needs a start before its end.`;
  }
  if (session.mode !== "fixed" && session.mode !== "token") {
    return `${session.name} has an unknown scheduling mode.`;
  }
  if (!divides(session.slotMinutes, gridMinutes) || session.slotMinutes < gridMinutes) {
    return `${session.name} slot step must be a multiple of the ${gridMinutes}-minute grid.`;
  }
  if (!divides(session.bufferMinutes, gridMinutes) || session.bufferMinutes < 0) {
    return `${session.name} buffer must be a multiple of the ${gridMinutes}-minute grid.`;
  }
  if (!Number.isInteger(session.sessionCap) || session.sessionCap < 1) {
    return `${session.name} needs a session cap of at least 1.`;
  }
  return null;
}

export function validateDuration(durationMinutes: number, gridMinutes: number): string | null {
  if (!divides(durationMinutes, gridMinutes) || durationMinutes < gridMinutes) {
    return `Duration must be a multiple of the ${gridMinutes}-minute grid.`;
  }
  return null;
}

function divides(value: number, grid: number): boolean {
  return Number.isInteger(value) && value % grid === 0;
}

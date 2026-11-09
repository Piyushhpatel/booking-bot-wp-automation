import { DateTime } from "luxon";
import { computeAvailability } from "../engine/availability";
import type { AvailabilityInput, AvailabilityResult, BusyInterval, ExceptionRule } from "../engine/types";
import { HttpError } from "../httpError";
import { Appointment, occupyingFilter } from "../models/booking";
import {
  AppointmentType,
  AppointmentTypeDoc,
  Doctor,
  DoctorDoc,
  ScheduleException,
  ScheduleRule,
} from "../models/clinic";

export async function requireClinic(doctorId: string): Promise<DoctorDoc> {
  const doctor = await Doctor.findById(doctorId);
  if (!doctor) throw new HttpError(404, "Clinic not found.");
  return doctor;
}

export async function resolveClinic(phoneNumberId?: string): Promise<DoctorDoc | null> {
  if (phoneNumberId) {
    const match = await Doctor.findOne({ whatsappPhoneNumberId: phoneNumberId, active: true });
    if (match) return match;
  }
  return Doctor.findOne({ active: true }).sort({ createdAt: 1 });
}

interface LoadedVisit {
  date: string;
  startAt: Date;
  endAt: Date;
  bufferUntil?: Date;
  sessionId: string;
}

interface LoadedException {
  type: ExceptionRule["type"];
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  startAt?: Date;
  endAt?: Date;
  sessions?: ExceptionRule["sessions"];
  dailyCap?: number;
  reason?: string;
}

export async function availabilityFor(
  doctorId: string,
  date: string,
  typeId: string,
  ignoreAppointmentId?: string
): Promise<AvailabilityResult> {
  const doctor = await requireClinic(doctorId);
  const type = await liveType(doctorId, typeId);
  const loaded = await loadRange(doctor, date, date, ignoreAppointmentId);
  return computeAvailability(toInput(doctor, date, type.durationMinutes, loaded));
}

export async function previewDates(
  doctorId: string,
  typeId: string,
  fromIso: string,
  needed = 8,
  scanDays = 31
): Promise<{ paused: boolean; dates: { date: string; count: number }[] }> {
  const doctor = await requireClinic(doctorId);
  if (!doctor.bookingsOpen) return { paused: true, dates: [] };
  const type = await liveType(doctorId, typeId);
  const start = DateTime.fromISO(fromIso, { zone: doctor.timezone }).startOf("day");
  if (!start.isValid) throw new HttpError(400, "That date is not valid.");
  const end = start.plus({ days: Math.max(0, scanDays - 1) });
  const loaded = await loadRange(doctor, start.toISODate()!, end.toISODate()!);
  const dates: { date: string; count: number }[] = [];
  for (let i = 0; i < scanDays && dates.length < needed; i += 1) {
    const iso = start.plus({ days: i }).toISODate()!;
    const result = computeAvailability(toInput(doctor, iso, type.durationMinutes, loaded));
    if (result.slots.length) dates.push({ date: iso, count: result.slots.length });
  }
  return { paused: false, dates };
}

async function liveType(doctorId: string, typeId: string): Promise<AppointmentTypeDoc> {
  const type = await AppointmentType.findOne({ _id: typeId, doctorId, active: true });
  if (!type) throw new HttpError(400, "Choose a visit type.");
  return type;
}

async function loadRange(doctor: DoctorDoc, from: string, to: string, ignoreAppointmentId?: string) {
  const [rules, exceptions, appointments] = await Promise.all([
    ScheduleRule.find({ doctorId: doctor._id }).lean(),
    ScheduleException.find({
      doctorId: doctor._id,
      startDate: { $lte: to },
      endDate: { $gte: from },
    }).lean(),
    Appointment.find({
      doctorId: doctor._id,
      date: { $gte: from, $lte: to },
      ...occupyingFilter(),
      ...(ignoreAppointmentId ? { _id: { $ne: ignoreAppointmentId } } : {}),
    }).lean(),
  ]);
  return {
    rules: rules.map((rule) => ({
      weekday: rule.weekday,
      isWorking: rule.isWorking,
      sessions: rule.sessions,
    })),
    exceptions: exceptions as unknown as LoadedException[],
    visits: appointments as unknown as LoadedVisit[],
  };
}

function toInput(
  doctor: DoctorDoc,
  date: string,
  durationMinutes: number,
  loaded: Awaited<ReturnType<typeof loadRange>>
): AvailabilityInput {
  const exceptions: ExceptionRule[] = loaded.exceptions
    .filter((item) => date >= item.startDate && date <= item.endDate)
    .map((item) => ({
      type: item.type,
      startDate: item.startDate,
      endDate: item.endDate,
      startTime: item.startTime,
      endTime: item.endTime,
      startAt: item.startAt ? new Date(item.startAt).toISOString() : undefined,
      endAt: item.endAt ? new Date(item.endAt).toISOString() : undefined,
      sessions: item.sessions,
      dailyCap: item.dailyCap,
      reason: item.reason,
    }));
  const busy: BusyInterval[] = loaded.visits
    .filter((visit) => visit.date === date)
    .map((visit) => ({
      startAt: new Date(visit.startAt),
      endAt: new Date(visit.bufferUntil || visit.endAt),
      sessionId: visit.sessionId,
      countsTowardCap: true,
    }));
  return {
    date,
    now: new Date(),
    timezone: doctor.timezone,
    weekdayRules: loaded.rules,
    breaks: doctor.breaks || [],
    exceptions,
    busy,
    durationMinutes,
    minNoticeMinutes: doctor.minNoticeMinutes,
    maxAdvanceDays: doctor.maxAdvanceDays,
    dailyCap: doctor.dailyCap,
    bookingsOpen: doctor.bookingsOpen,
    gridMinutes: doctor.gridMinutes,
  };
}

export function activeTypes(doctorId: string): Promise<AppointmentTypeDoc[]> {
  return AppointmentType.find({ doctorId, active: true }).sort({ sortOrder: 1, name: 1 });
}

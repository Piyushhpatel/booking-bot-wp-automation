import { DateTime } from "luxon";
import { gridClaimKeys } from "../engine/availability";
import type { AppointmentStatus, SlotOffer } from "../engine/types";
import { bookingRefusal, canTransition } from "../engine/policy";
import { HttpError } from "../httpError";
import {
  Appointment,
  AppointmentDoc,
  Claim,
  Patient,
  PatientDoc,
  Waitlist,
  nextBookingCode,
  occupyingFilter,
} from "../models/booking";
import { AppointmentType } from "../models/clinic";
import { recordAudit } from "./audit";
import { availabilityFor, requireClinic } from "./clinic";
import { bookingLock, withLock } from "./lock";

export interface BookInput {
  doctorId: string;
  patientId: string;
  typeId: string;
  date: string;
  sessionId: string;
  startAt?: string;
  source: "whatsapp" | "dashboard" | "walk_in";
  outcome: "hold" | "confirm";
  status?: AppointmentStatus;
  note?: string;
  allowFlagged?: boolean;
  ignoreAppointmentId?: string;
  actorId?: string;
  actorRole?: string;
}

const ACTIVE_FUTURE = ["pending_approval", "confirmed"] as const;

export async function bookSlot(input: BookInput): Promise<AppointmentDoc> {
  return withLock(bookingLock(input.doctorId), () => createBooking(input));
}

export async function confirmHold(doctorId: string, appointmentId: string): Promise<AppointmentDoc> {
  return withLock(bookingLock(doctorId), async () => {
    const appointment = await Appointment.findOne({ _id: appointmentId, doctorId });
    if (!appointment) throw new HttpError(404, "Booking not found.");
    if (appointment.status === "confirmed" || appointment.status === "pending_approval") return appointment;
    if (appointment.status !== "held") {
      throw new HttpError(409, "That booking is no longer waiting for confirmation.");
    }
    if (appointment.holdExpiresAt && appointment.holdExpiresAt.getTime() <= Date.now()) {
      await expireOne(appointment);
      throw new HttpError(409, "That hold expired. Please pick the time again.");
    }
    const stillOpen = await availabilityFor(
      doctorId,
      appointment.date,
      String(appointment.typeId),
      String(appointment._id)
    );
    const stillThere = stillOpen.slots.some((slot) => {
      if (slot.sessionId !== appointment.sessionId) return false;
      if (appointment.mode === "token") return slot.mode === "token";
      return Math.abs(DateTime.fromISO(slot.startAt).toMillis() - appointment.startAt.getTime()) < 1000;
    });
    if (!stillThere) {
      await expireOne(appointment);
      throw new HttpError(409, "That time is no longer available.");
    }
    const doctor = await requireClinic(doctorId);
    appointment.status = doctor.confirmationMode === "approval" ? "pending_approval" : "confirmed";
    appointment.holdExpiresAt = undefined;
    await appointment.save();
    await recordAudit({
      doctorId,
      actorRole: "patient",
      action: "appointment.confirm",
      entity: "appointment",
      entityId: String(appointment._id),
      summary: `${appointment.bookingCode} is now ${appointment.status}`,
    });
    return appointment;
  });
}

export async function releaseHold(doctorId: string, appointmentId: string, reason = "changed"): Promise<void> {
  await withLock(bookingLock(doctorId), async () => {
    const appointment = await Appointment.findOne({ _id: appointmentId, doctorId, status: "held" });
    if (!appointment) return;
    appointment.status = "cancelled";
    appointment.cancelReason = reason;
    appointment.holdExpiresAt = undefined;
    await appointment.save();
    await Claim.deleteMany({ appointmentId: appointment._id });
  });
}

export async function setAppointmentStatus(input: {
  doctorId: string;
  appointmentId: string;
  status: AppointmentStatus;
  actorId?: string;
  actorRole?: string;
  reason?: string;
  promote?: boolean;
}): Promise<AppointmentDoc> {
  return withLock(bookingLock(input.doctorId), async () => {
    const appointment = await Appointment.findOne({ _id: input.appointmentId, doctorId: input.doctorId });
    if (!appointment) throw new HttpError(404, "Booking not found.");
    if (!canTransition(appointment.status, input.status)) {
      throw new HttpError(409, "That status change isn't allowed.");
    }
    const previous = appointment.status;
    appointment.status = input.status;
    if (input.reason) appointment.cancelReason = input.reason;
    if (input.status === "cancelled" || input.status === "rescheduled") {
      appointment.holdExpiresAt = undefined;
      await Claim.deleteMany({ appointmentId: appointment._id });
    }
    if (input.status === "no_show") await flagNoShow(input.doctorId, String(appointment.patientId));
    await appointment.save();
    if (
      input.promote !== false &&
      input.status === "cancelled" &&
      (previous === "confirmed" || previous === "pending_approval")
    ) {
      await promoteWaitlist(input.doctorId, appointment.date);
    }
    await recordAudit({
      doctorId: input.doctorId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: "appointment.status",
      entity: "appointment",
      entityId: String(appointment._id),
      summary: `${appointment.bookingCode}: ${previous} → ${input.status}`,
    });
    return appointment;
  });
}

export async function rescheduleAppointment(
  doctorId: string,
  appointmentId: string,
  input: Omit<BookInput, "doctorId" | "patientId" | "outcome" | "ignoreAppointmentId">
): Promise<AppointmentDoc> {
  return withLock(bookingLock(doctorId), async () => {
    const current = await Appointment.findOne({ _id: appointmentId, doctorId });
    if (!current) throw new HttpError(404, "Booking not found.");
    if (!canTransition(current.status, "rescheduled")) {
      throw new HttpError(409, "This booking can't be moved.");
    }
    const previousClaims = await Claim.find({ appointmentId: current._id }).lean();
    await Claim.deleteMany({ appointmentId: current._id });
    try {
      const created = await createBooking({
        ...input,
        doctorId,
        patientId: String(current.patientId),
        outcome: "confirm",
        status: current.status === "pending_approval" ? "pending_approval" : "confirmed",
        ignoreAppointmentId: String(current._id),
      });
      current.status = "rescheduled";
      current.rescheduledToId = created._id;
      created.rescheduledFromId = current._id;
      await current.save();
      await created.save();
      await recordAudit({
        doctorId,
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "appointment.reschedule",
        entity: "appointment",
        entityId: String(created._id),
        summary: `${current.bookingCode} moved to ${created.bookingCode}`,
      });
      return created;
    } catch (err) {
      if (previousClaims.length) {
        await Claim.insertMany(
          previousClaims.map((claim) => ({
            doctorId,
            key: claim.key,
            appointmentId: current._id,
          }))
        );
      }
      throw err;
    }
  });
}

export async function releaseExpiredHolds(doctorId: string): Promise<number> {
  const expired = await Appointment.find({
    doctorId,
    status: "held",
    holdExpiresAt: { $lte: new Date() },
  });
  for (const appointment of expired) await expireOne(appointment);
  return expired.length;
}

export async function promoteWaitlist(doctorId: string, date: string): Promise<typeof Waitlist.prototype | null> {
  return Waitlist.findOneAndUpdate(
    { doctorId, date, status: "waiting" },
    { $set: { status: "notified", notifiedAt: new Date() } },
    { sort: { createdAt: 1 }, new: true }
  );
}

export async function joinWaitlist(doctorId: string, patientId: string, phone: string, date: string) {
  const existing = await Waitlist.findOne({ doctorId, patientId, date, status: "waiting" });
  if (existing) return { entry: existing, created: false };
  const entry = await Waitlist.create({ doctorId, patientId, phone, date, status: "waiting" });
  return { entry, created: true };
}

async function createBooking(input: BookInput): Promise<AppointmentDoc> {
  await releaseExpiredHolds(input.doctorId);
  const doctor = await requireClinic(input.doctorId);
  const patient = await Patient.findOne({ _id: input.patientId, doctorId: input.doctorId });
  if (!patient) throw new HttpError(404, "Patient not found.");
  const type = await AppointmentType.findOne({ _id: input.typeId, doctorId: input.doctorId, active: true });
  if (!type) throw new HttpError(400, "Choose a visit type.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new HttpError(400, "That date is not valid.");

  const result = await availabilityFor(
    input.doctorId,
    input.date,
    input.typeId,
    input.ignoreAppointmentId
  );
  const slot = pickSlot(result.slots, input);
  if (!slot) {
    throw new HttpError(409, result.slots.length ? "That time is no longer available." : closedText(result.closedReason));
  }

  await assertPatientAllowed(doctor, patient, input.date, Boolean(input.allowFlagged), input.ignoreAppointmentId);

  const start = DateTime.fromISO(slot.startAt);
  const end = DateTime.fromISO(slot.endAt);
  const bufferUntil = end.plus({ minutes: slot.bufferMinutes });
  const status = resolveStatus(input, doctor.confirmationMode);
  const bookingCode = await nextBookingCode(input.doctorId);
  const appointment = await Appointment.create({
    doctorId: input.doctorId,
    patientId: patient._id,
    bookerPhone: patient.bookerPhone,
    patientName: patient.name,
    typeId: type._id,
    typeName: type.name,
    durationMinutes: type.durationMinutes,
    feePaise: type.feePaise,
    date: input.date,
    startAt: start.toJSDate(),
    endAt: end.toJSDate(),
    bufferUntil: bufferUntil.toJSDate(),
    sessionId: slot.sessionId,
    sessionName: slot.sessionName,
    mode: slot.mode,
    tokenNumber: slot.tokenPreview,
    status,
    source: input.source,
    bookingCode,
    holdExpiresAt: status === "held" ? new Date(Date.now() + doctor.holdMinutes * 60_000) : undefined,
    note: (input.note || "").trim().slice(0, 500),
  });

  try {
    if (slot.mode === "fixed") {
      const keys = gridClaimKeys(start.toJSDate(), bufferUntil.toJSDate(), doctor.gridMinutes);
      if (!keys.length) throw new HttpError(409, "That time is no longer available.");
      await Claim.insertMany(
        keys.map((key) => ({ doctorId: input.doctorId, key, appointmentId: appointment._id }))
      );
    } else {
      await Claim.create({
        doctorId: input.doctorId,
        key: `token:${input.date}:${slot.sessionId}:${slot.tokenPreview}`,
        appointmentId: appointment._id,
      });
    }
  } catch (err: unknown) {
    await Claim.deleteMany({ appointmentId: appointment._id });
    await Appointment.deleteOne({ _id: appointment._id });
    if ((err as { code?: number }).code === 11000 || err instanceof HttpError) {
      throw new HttpError(409, "That slot was just taken.");
    }
    throw err;
  }

  await recordAudit({
    doctorId: input.doctorId,
    actorId: input.actorId,
    actorRole: input.actorRole || (input.source === "whatsapp" ? "patient" : "staff"),
    action: "appointment.create",
    entity: "appointment",
    entityId: String(appointment._id),
    summary: `${bookingCode} ${status} ${input.date} ${slot.label}`,
  });
  return appointment;
}

function pickSlot(slots: SlotOffer[], input: BookInput): SlotOffer | undefined {
  if (input.startAt) {
    const want = DateTime.fromISO(input.startAt).toMillis();
    return slots.find(
      (slot) => slot.sessionId === input.sessionId && Math.abs(DateTime.fromISO(slot.startAt).toMillis() - want) < 1000
    );
  }
  return slots.find((slot) => slot.sessionId === input.sessionId && slot.mode === "token");
}

function resolveStatus(input: BookInput, confirmationMode: "auto" | "approval"): AppointmentStatus {
  if (input.status) {
    if (!["held", "pending_approval", "confirmed"].includes(input.status)) {
      throw new HttpError(400, "That status can't be used for a new booking.");
    }
    return input.status;
  }
  if (input.outcome === "hold") return "held";
  if (input.source === "whatsapp" && confirmationMode === "approval") return "pending_approval";
  return "confirmed";
}

async function assertPatientAllowed(
  doctor: { _id: unknown; patientDailyLimit: number; patientFutureLimit: number; phoneDailyLimit: number },
  patient: PatientDoc,
  date: string,
  allowFlagged: boolean,
  ignoreAppointmentId?: string
): Promise<void> {
  const doctorId = doctor._id;
  const ignore = ignoreAppointmentId ? { _id: { $ne: ignoreAppointmentId } } : {};
  const now = new Date();
  const [sameDay, future, phoneMates] = await Promise.all([
    Appointment.countDocuments({
      doctorId,
      patientId: patient._id,
      date,
      ...occupyingFilter(now),
      ...ignore,
    }),
    Appointment.countDocuments({
      doctorId,
      patientId: patient._id,
      startAt: { $gte: now },
      ...ignore,
      $or: [
        { status: { $in: ACTIVE_FUTURE } },
        { status: "held", holdExpiresAt: { $gt: now } },
      ],
    }),
    Patient.find({ doctorId, bookerPhone: patient.bookerPhone }).select("_id"),
  ]);
  const phoneDay = await Appointment.countDocuments({
    doctorId,
    date,
    patientId: { $in: phoneMates.map((item) => item._id) },
    ...occupyingFilter(now),
    ...ignore,
  });
  const refusal = bookingRefusal({
    sameDayCount: sameDay,
    futureCount: future,
    phoneDayCount: phoneDay,
    flagged: patient.flagged,
    allowFlagged,
    dailyLimit: doctor.patientDailyLimit,
    futureLimit: doctor.patientFutureLimit,
    phoneDailyLimit: doctor.phoneDailyLimit,
  });
  if (refusal) throw new HttpError(409, refusal);
}

async function flagNoShow(doctorId: string, patientId: string): Promise<void> {
  const [patient, doctor] = await Promise.all([
    Patient.findOne({ _id: patientId, doctorId }),
    requireClinic(doctorId),
  ]);
  if (!patient) return;
  patient.noShowCount += 1;
  if (patient.noShowCount >= doctor.noShowFlagThreshold) patient.flagged = true;
  await patient.save();
}

async function expireOne(appointment: AppointmentDoc): Promise<void> {
  appointment.status = "cancelled";
  appointment.cancelReason = "hold_expired";
  appointment.holdExpiresAt = undefined;
  await appointment.save();
  await Claim.deleteMany({ appointmentId: appointment._id });
}

function closedText(reason?: string): string {
  switch (reason) {
    case "bookings_paused":
      return "Bookings are paused. Please call the clinic.";
    case "outside_window":
      return "That date is outside the booking window.";
    case "holiday":
      return "The clinic is closed that day.";
    case "leave":
      return "The doctor is on leave that day.";
    case "not_working":
      return "The clinic is not open that day.";
    case "notice":
      return "Those times are too soon or have already passed.";
    case "full":
      return "That day is fully booked.";
    default:
      return "That time is no longer available.";
  }
}

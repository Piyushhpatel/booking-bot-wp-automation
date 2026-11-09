import { Router } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { Appointment, Patient } from "../models/booking";
import { AppointmentType, ScheduleException, ScheduleRule } from "../models/clinic";
import { requireAuth, requireDoctor } from "../middleware/auth";
import { bookSlot, setAppointmentStatus } from "../services/booking";
import { requireClinic } from "../services/clinic";
import { findOrCreatePatient } from "../services/patients";
import { saveException } from "../services/exceptions";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bookingSchema = z.object({
  patientName: z.string().min(2).max(60),
  phone: z.string().min(8).max(20),
  typeId: z.string().min(1),
  date: dateSchema,
  sessionId: z.string().min(1).optional(),
  startAt: z.string().datetime({ offset: true }),
  note: z.string().max(500).optional(),
});
const statusSchema = z.object({ status: z.enum(["confirmed", "completed", "no_show", "cancelled"]) });

dashboardRouter.get("/overview", async (req, res, next) => {
  try {
    const doctor = await requireClinic(req.doctorId!);
    const date = requestedDate(req.query.date, doctor.timezone);
    const [appointments, pending, completed, types, patientsThisMonth] = await Promise.all([
      Appointment.find({ doctorId: doctor._id, date, status: { $in: ["held", "pending_approval", "confirmed", "completed", "no_show"] } }).sort({ startAt: 1 }).lean(),
      Appointment.countDocuments({ doctorId: doctor._id, date, status: "pending_approval" }),
      Appointment.countDocuments({ doctorId: doctor._id, date, status: "completed" }),
      AppointmentType.find({ doctorId: doctor._id, active: true }).sort({ sortOrder: 1, name: 1 }).lean(),
      Patient.countDocuments({ doctorId: doctor._id, createdAt: { $gte: DateTime.now().setZone(doctor.timezone).startOf("month").toJSDate() } }),
    ]);
    res.json({
      clinic: { name: doctor.clinicName, doctorName: doctor.doctorName, timezone: doctor.timezone, bookingsOpen: doctor.bookingsOpen, dailyCap: doctor.dailyCap },
      date,
      appointments: appointments.map(serializeAppointment),
      metrics: { appointments: appointments.length, pending, completed, newPatients: patientsThisMonth },
      types: types.map((type) => ({ id: String(type._id), name: type.name, durationMinutes: type.durationMinutes, feePaise: type.feePaise })),
    });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/appointments", async (req, res, next) => {
  try {
    const doctor = await requireClinic(req.doctorId!);
    const all = req.query.all === "true";
    const date = requestedDate(req.query.date, doctor.timezone);
    const appointments = await Appointment.find({
      doctorId: doctor._id,
      ...(all ? {} : { date }),
      status: { $nin: ["cancelled", "rescheduled"] },
    }).sort({ startAt: 1 }).limit(all ? 500 : 100).lean();
    res.json({ date: all ? "all" : date, appointments: appointments.map(serializeAppointment) });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get("/patients", async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const filter = query ? { $or: [{ name: new RegExp(query, "i") }, { bookerPhone: new RegExp(query.replace(/\D/g, ""), "i") }] } : {};
    const patients = await Patient.find({ doctorId: req.doctorId!, ...filter }).sort({ updatedAt: -1 }).limit(100).lean();
    const ids = patients.map((patient) => patient._id);
    const counts = await Appointment.aggregate([{ $match: { doctorId: patients[0]?.doctorId, patientId: { $in: ids } } }, { $group: { _id: "$patientId", count: { $sum: 1 } } }]);
    const countMap = new Map(counts.map((item) => [String(item._id), item.count]));
    res.json({ patients: patients.map((patient) => ({ id: String(patient._id), name: patient.name, phone: patient.bookerPhone, language: patient.language, flagged: patient.flagged, noShowCount: patient.noShowCount, notes: patient.notes, visits: countMap.get(String(patient._id)) || 0 })) });
  } catch (error) { next(error); }
});

dashboardRouter.get("/patients/:id", async (req, res, next) => {
  try {
    const patient = await Patient.findOne({ _id: req.params.id, doctorId: req.doctorId! }).lean();
    if (!patient) { res.status(404).json({ error: "Patient not found." }); return; }
    const appointments = await Appointment.find({ doctorId: req.doctorId!, patientId: patient._id }).sort({ startAt: -1 }).limit(50).lean();
    res.json({ patient: { id: String(patient._id), name: patient.name, phone: patient.bookerPhone, language: patient.language, flagged: patient.flagged, noShowCount: patient.noShowCount, notes: patient.notes }, appointments: appointments.map(serializeAppointment) });
  } catch (error) { next(error); }
});

dashboardRouter.get("/schedule", async (req, res, next) => {
  try {
    const [doctor, rules, exceptions] = await Promise.all([requireClinic(req.doctorId!), ScheduleRule.find({ doctorId: req.doctorId! }).sort({ weekday: 1 }).lean(), ScheduleException.find({ doctorId: req.doctorId!, endDate: { $gte: DateTime.now().toISODate() } }).sort({ startDate: 1 }).limit(50).lean()]);
    res.json({ rules, exceptions, timezone: doctor.timezone });
  } catch (error) { next(error); }
});

dashboardRouter.get("/settings", async (req, res, next) => {
  try {
    const doctor = await requireClinic(req.doctorId!);
    res.json({ settings: serializeSettings(doctor) });
  } catch (error) { next(error); }
});

dashboardRouter.patch("/settings", requireDoctor, async (req, res, next) => {
  try {
    const input = z.object({ clinicName: z.string().min(2).max(100).optional(), address: z.string().max(300).optional(), clinicPhone: z.string().max(30).optional(), greeting: z.string().max(500).optional(), bookingsOpen: z.boolean().optional(), confirmationMode: z.enum(["auto", "approval"]).optional(), dailyCap: z.number().int().min(0).max(200).optional(), minNoticeMinutes: z.number().int().min(0).max(1440).optional(), maxAdvanceDays: z.number().int().min(1).max(365).optional(), holdMinutes: z.number().int().min(1).max(30).optional(), reminderHours: z.array(z.number().int().min(0).max(168)).max(5).optional() }).parse(req.body);
    const doctor = await requireClinic(req.doctorId!);
    Object.assign(doctor, input);
    await doctor.save();
    res.json({ settings: serializeSettings(doctor) });
  } catch (error) { next(error); }
});

dashboardRouter.post("/schedule/exceptions", requireDoctor, async (req, res, next) => {
  try {
    const input = z.object({ type: z.enum(["leave", "holiday", "block", "daily_cap"]), startDate: dateSchema, endDate: dateSchema, startTime: z.string().optional(), endTime: z.string().optional(), dailyCap: z.number().int().min(0).max(200).optional(), reason: z.string().max(200).optional(), cancelAffected: z.boolean().optional() }).parse(req.body);
    const result = await saveException(req.doctorId!, { ...input, actorId: req.userId, actorRole: req.role });
    res.status(201).json({ exception: result.exception, affected: result.affected.length });
  } catch (error) { next(error); }
});

dashboardRouter.post("/appointments", requireDoctor, async (req, res, next) => {
  try {
    const input = bookingSchema.parse(req.body);
    const doctor = await requireClinic(req.doctorId!);
    const patient = await findOrCreatePatient({ doctorId: req.doctorId!, bookerPhone: input.phone, name: input.patientName, isSelf: true });
    const sessionId = input.sessionId || await inferSessionId(req.doctorId!, input.date, input.startAt, doctor.timezone);
    if (!sessionId) {
      res.status(400).json({ error: "The selected time is outside clinic hours." });
      return;
    }
    const appointment = await bookSlot({
      doctorId: req.doctorId!,
      patientId: String(patient._id),
      typeId: input.typeId,
      date: input.date,
      sessionId,
      startAt: input.startAt,
      source: "dashboard",
      outcome: "confirm",
      note: input.note,
      actorId: req.userId,
      actorRole: req.role,
    });
    res.status(201).json({ appointment: serializeAppointment(appointment) });
  } catch (error) {
    next(error);
  }
});

dashboardRouter.patch("/appointments/:id/status", requireDoctor, async (req, res, next) => {
  try {
    const { status } = statusSchema.parse(req.body);
    const appointment = await setAppointmentStatus({
      doctorId: req.doctorId!,
      appointmentId: req.params.id,
      status,
      actorId: req.userId,
      actorRole: req.role,
      reason: "dashboard",
    });
    res.json({ appointment: serializeAppointment(appointment) });
  } catch (error) {
    next(error);
  }
});

function requestedDate(value: unknown, timezone: string): string {
  if (typeof value === "string" && dateSchema.safeParse(value).success) return value;
  return DateTime.now().setZone(timezone).toISODate()!;
}

function serializeSettings(doctor: { _id: unknown; clinicName: string; doctorName: string; address: string; clinicPhone: string; timezone: string; bookingsOpen: boolean; confirmationMode: string; dailyCap: number; minNoticeMinutes: number; maxAdvanceDays: number; holdMinutes: number; greeting: string; reminderHours: number[] }) {
  return { id: String(doctor._id), clinicName: doctor.clinicName, doctorName: doctor.doctorName, address: doctor.address, clinicPhone: doctor.clinicPhone, timezone: doctor.timezone, bookingsOpen: doctor.bookingsOpen, confirmationMode: doctor.confirmationMode, dailyCap: doctor.dailyCap, minNoticeMinutes: doctor.minNoticeMinutes, maxAdvanceDays: doctor.maxAdvanceDays, holdMinutes: doctor.holdMinutes, greeting: doctor.greeting, reminderHours: doctor.reminderHours };
}

async function inferSessionId(doctorId: string, date: string, startAt: string, timezone: string): Promise<string | undefined> {
  const day = DateTime.fromISO(date, { zone: timezone });
  const start = DateTime.fromISO(startAt).setZone(timezone);
  const rule = await ScheduleRule.findOne({ doctorId, weekday: day.weekday % 7 }).lean();
  return rule?.sessions.find((session) => session.start <= start.toFormat("HH:mm") && start.toFormat("HH:mm") < session.end)?.id;
}

function serializeAppointment(appointment: {
  _id: unknown;
  bookingCode: string;
  patientName: string;
  bookerPhone: string;
  typeName: string;
  typeId: unknown;
  date: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  sessionId: string;
  status: string;
  source: string;
  note: string;
}) {
  return {
    id: String(appointment._id),
    bookingCode: appointment.bookingCode,
    patientName: appointment.patientName,
    phone: appointment.bookerPhone,
    type: appointment.typeName,
    typeId: String(appointment.typeId),
    date: appointment.date,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    durationMinutes: appointment.durationMinutes,
    sessionId: appointment.sessionId,
    status: appointment.status,
    source: appointment.source,
    note: appointment.note,
  };
}


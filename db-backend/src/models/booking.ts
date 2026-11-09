import mongoose, { Schema, Types } from "mongoose";
import type { AppointmentStatus, SessionMode } from "../engine/types";

export interface PatientDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  bookerPhone: string;
  name: string;
  nameKey: string;
  isSelf: boolean;
  age?: number;
  gender?: string;
  notes: string;
  tags: string[];
  language: "en" | "hi";
  noShowCount: number;
  flagged: boolean;
  consentAt?: Date;
}

export interface AppointmentDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  patientId: Types.ObjectId;
  bookerPhone: string;
  patientName: string;
  typeId: Types.ObjectId;
  typeName: string;
  durationMinutes: number;
  feePaise: number;
  date: string;
  startAt: Date;
  endAt: Date;
  bufferUntil: Date;
  sessionId: string;
  sessionName: string;
  mode: SessionMode;
  tokenNumber?: number;
  status: AppointmentStatus;
  source: "whatsapp" | "dashboard" | "walk_in";
  bookingCode: string;
  holdExpiresAt?: Date;
  note: string;
  cancelReason?: string;
  rescheduledFromId?: Types.ObjectId;
  rescheduledToId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  key: string;
  appointmentId: Types.ObjectId;
}

export interface WaitlistDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  patientId: Types.ObjectId;
  phone: string;
  date: string;
  status: "waiting" | "notified" | "booked";
  notifiedAt?: Date;
}

export interface CounterDoc {
  _id: string;
  seq: number;
}

const patientSchema = new Schema<PatientDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    bookerPhone: { type: String, required: true },
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    isSelf: { type: Boolean, default: false },
    age: Number,
    gender: String,
    notes: { type: String, default: "" },
    tags: { type: [String], default: [] },
    language: { type: String, enum: ["en", "hi"], default: "en" },
    noShowCount: { type: Number, default: 0 },
    flagged: { type: Boolean, default: false },
    consentAt: Date,
  },
  { timestamps: true }
);
patientSchema.index({ doctorId: 1, bookerPhone: 1, nameKey: 1 }, { unique: true });
patientSchema.index(
  { doctorId: 1, bookerPhone: 1 },
  { unique: true, partialFilterExpression: { isSelf: true } }
);

const appointmentSchema = new Schema<AppointmentDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    bookerPhone: { type: String, required: true },
    patientName: { type: String, required: true },
    typeId: { type: Schema.Types.ObjectId, ref: "AppointmentType", required: true },
    typeName: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    feePaise: { type: Number, default: 0 },
    date: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    bufferUntil: { type: Date, required: true },
    sessionId: { type: String, required: true },
    sessionName: { type: String, default: "" },
    mode: { type: String, enum: ["fixed", "token"], required: true },
    tokenNumber: Number,
    status: {
      type: String,
      enum: ["held", "pending_approval", "confirmed", "completed", "cancelled", "no_show", "rescheduled"],
      required: true,
    },
    source: { type: String, enum: ["whatsapp", "dashboard", "walk_in"], required: true },
    bookingCode: { type: String, required: true, unique: true },
    holdExpiresAt: Date,
    note: { type: String, default: "" },
    cancelReason: String,
    rescheduledFromId: Schema.Types.ObjectId,
    rescheduledToId: Schema.Types.ObjectId,
  },
  { timestamps: true }
);
appointmentSchema.index({ doctorId: 1, date: 1, startAt: 1 });
appointmentSchema.index({ doctorId: 1, patientId: 1, date: 1 });
appointmentSchema.index({ doctorId: 1, status: 1, startAt: 1 });

const claimSchema = new Schema<ClaimDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    appointmentId: { type: Schema.Types.ObjectId, required: true, index: true },
  },
  { timestamps: true }
);
claimSchema.index({ doctorId: 1, key: 1 }, { unique: true });

const waitSchema = new Schema<WaitlistDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, required: true },
    patientId: { type: Schema.Types.ObjectId, required: true },
    phone: { type: String, required: true },
    date: { type: String, required: true },
    status: { type: String, enum: ["waiting", "notified", "booked"], default: "waiting" },
    notifiedAt: Date,
  },
  { timestamps: true }
);
waitSchema.index({ doctorId: 1, date: 1, status: 1, createdAt: 1 });

const counterSchema = new Schema<CounterDoc>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export const Patient = mongoose.model<PatientDoc>("Patient", patientSchema);
export const Appointment = mongoose.model<AppointmentDoc>("Appointment", appointmentSchema);
export const Claim = mongoose.model<ClaimDoc>("Claim", claimSchema);
export const Waitlist = mongoose.model<WaitlistDoc>("Waitlist", waitSchema);
export const Counter = mongoose.model<CounterDoc>("Counter", counterSchema);

export function occupyingFilter(now = new Date()) {
  return {
    $or: [
      { status: { $in: ["pending_approval", "confirmed", "completed", "no_show"] } },
      { status: "held", holdExpiresAt: { $gt: now } },
    ],
  };
}

export async function nextBookingCode(doctorId: string): Promise<string> {
  const doc = await Counter.findOneAndUpdate(
    { _id: `booking:${doctorId}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  if (!doc) throw new Error("Could not allocate a booking id");
  return `DB-${1000 + doc.seq}`;
}

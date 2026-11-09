import mongoose, { Schema, Types } from "mongoose";
import type { ExceptionKind, SessionMode } from "../engine/types";

export type UserRole = "admin" | "doctor" | "staff";

export interface BreakDoc {
  weekday: number | null;
  start: string;
  end: string;
  label: string;
}

export interface SessionDoc {
  id: string;
  name: string;
  start: string;
  end: string;
  mode: SessionMode;
  slotMinutes: number;
  sessionCap: number;
  bufferMinutes: number;
}

export interface DoctorDoc extends mongoose.Document {
  clinicName: string;
  doctorName: string;
  address: string;
  mapsUrl: string;
  timezone: string;
  clinicPhone: string;
  displayNumber: string;
  whatsappPhoneNumberId: string;
  instructions: string;
  greeting: string;
  clinicInfo: string;
  bookingsOpen: boolean;
  confirmationMode: "auto" | "approval";
  dailyCap: number;
  gridMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  holdMinutes: number;
  patientDailyLimit: number;
  patientFutureLimit: number;
  phoneDailyLimit: number;
  noShowFlagThreshold: number;
  digestHour: number;
  reminderHours: number[];
  breaks: BreakDoc[];
  active: boolean;
}

export interface UserDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
}

export interface DoctorPhoneDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  phone: string;
  name: string;
}

export interface ScheduleRuleDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  weekday: number;
  isWorking: boolean;
  sessions: SessionDoc[];
}

export interface ScheduleExceptionDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  type: ExceptionKind;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  startAt?: Date;
  endAt?: Date;
  sessions?: SessionDoc[];
  dailyCap?: number;
  reason?: string;
  createdBy?: Types.ObjectId;
}

export interface AppointmentTypeDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  name: string;
  durationMinutes: number;
  feePaise: number;
  active: boolean;
  sortOrder: number;
}

const breakSchema = new Schema<BreakDoc>(
  {
    weekday: { type: Number, default: null },
    start: { type: String, required: true },
    end: { type: String, required: true },
    label: { type: String, default: "Break" },
  },
  { _id: false }
);

export const sessionSchema = new Schema<SessionDoc>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    start: { type: String, required: true },
    end: { type: String, required: true },
    mode: { type: String, enum: ["fixed", "token"], required: true },
    slotMinutes: { type: Number, required: true },
    sessionCap: { type: Number, required: true },
    bufferMinutes: { type: Number, required: true },
  },
  { _id: false }
);

const doctorSchema = new Schema<DoctorDoc>(
  {
    clinicName: { type: String, required: true },
    doctorName: { type: String, required: true },
    address: { type: String, default: "" },
    mapsUrl: { type: String, default: "" },
    timezone: { type: String, default: "Asia/Kolkata" },
    clinicPhone: { type: String, default: "" },
    displayNumber: { type: String, default: "" },
    whatsappPhoneNumberId: { type: String, default: "" },
    instructions: { type: String, default: "" },
    greeting: { type: String, default: "" },
    clinicInfo: { type: String, default: "" },
    bookingsOpen: { type: Boolean, default: true },
    confirmationMode: { type: String, enum: ["auto", "approval"], default: "auto" },
    dailyCap: { type: Number, default: 30 },
    gridMinutes: { type: Number, default: 5 },
    minNoticeMinutes: { type: Number, default: 60 },
    maxAdvanceDays: { type: Number, default: 30 },
    holdMinutes: { type: Number, default: 5 },
    patientDailyLimit: { type: Number, default: 1 },
    patientFutureLimit: { type: Number, default: 3 },
    phoneDailyLimit: { type: Number, default: 3 },
    noShowFlagThreshold: { type: Number, default: 3 },
    digestHour: { type: Number, default: 8 },
    reminderHours: { type: [Number], default: [24, 2] },
    breaks: { type: [breakSchema], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const userSchema = new Schema<UserDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ["admin", "doctor", "staff"], required: true },
  },
  { timestamps: true }
);

const phoneSchema = new Schema<DoctorPhoneDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    phone: { type: String, required: true },
    name: { type: String, default: "Doctor" },
  },
  { timestamps: true }
);
phoneSchema.index({ doctorId: 1, phone: 1 }, { unique: true });

const ruleSchema = new Schema<ScheduleRuleDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    weekday: { type: Number, required: true },
    isWorking: { type: Boolean, default: false },
    sessions: { type: [sessionSchema], default: [] },
  },
  { timestamps: true }
);
ruleSchema.index({ doctorId: 1, weekday: 1 }, { unique: true });

const exceptionSchema = new Schema<ScheduleExceptionDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    type: {
      type: String,
      enum: ["leave", "holiday", "block", "special_hours", "daily_cap"],
      required: true,
    },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    startTime: String,
    endTime: String,
    startAt: Date,
    endAt: Date,
    sessions: { type: [sessionSchema], default: undefined },
    dailyCap: Number,
    reason: String,
    createdBy: Schema.Types.ObjectId,
  },
  { timestamps: true }
);
exceptionSchema.index({ doctorId: 1, startDate: 1, endDate: 1 });

const typeSchema = new Schema<AppointmentTypeDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: true, index: true },
    name: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    feePaise: { type: Number, required: true, default: 0 },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Doctor = mongoose.model<DoctorDoc>("Doctor", doctorSchema);
export const User = mongoose.model<UserDoc>("User", userSchema);
export const DoctorPhone = mongoose.model<DoctorPhoneDoc>("DoctorPhone", phoneSchema);
export const ScheduleRule = mongoose.model<ScheduleRuleDoc>("ScheduleRule", ruleSchema);
export const ScheduleException = mongoose.model<ScheduleExceptionDoc>("ScheduleException", exceptionSchema);
export const AppointmentType = mongoose.model<AppointmentTypeDoc>("AppointmentType", typeSchema);

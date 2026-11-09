import mongoose, { Schema, Types } from "mongoose";

export interface Draft {
  patientId?: string;
  patientName?: string;
  isSelf?: boolean;
  typeId?: string;
  date?: string;
  dateCursor?: string;
  sessionId?: string;
  slotStart?: string;
  holdId?: string;
  rescheduleFromId?: string;
  appointmentId?: string;
  page?: number;
  listedDate?: string;
  pendingExceptionId?: string;
}

export interface ConversationDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  waPhone: string;
  role: "patient" | "doctor";
  state: string;
  language: "en" | "hi";
  consentAt?: Date;
  draft: Draft;
}

export interface NotificationDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  patientId?: Types.ObjectId;
  phone: string;
  kind: string;
  dedupeKey: string;
  status: "sent" | "failed" | "skipped";
  attempts: number;
  detail?: string;
  sentAt?: Date;
}

export interface AuditDoc extends mongoose.Document {
  doctorId: Types.ObjectId;
  actorId?: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId?: string;
  summary: string;
}

export interface LockDoc extends mongoose.Document<string> {
  _id: string;
  lockedUntil: Date;
}

const conversationSchema = new Schema<ConversationDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, required: true },
    waPhone: { type: String, required: true },
    role: { type: String, enum: ["patient", "doctor"], default: "patient" },
    state: { type: String, default: "menu" },
    language: { type: String, enum: ["en", "hi"], default: "en" },
    consentAt: Date,
    draft: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
conversationSchema.index({ doctorId: 1, waPhone: 1 }, { unique: true });

const notificationSchema = new Schema<NotificationDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, required: true },
    appointmentId: Schema.Types.ObjectId,
    patientId: Schema.Types.ObjectId,
    phone: { type: String, default: "" },
    kind: { type: String, required: true },
    dedupeKey: { type: String, required: true, unique: true },
    status: { type: String, enum: ["sent", "failed", "skipped"], default: "failed" },
    attempts: { type: Number, default: 0 },
    detail: String,
    sentAt: Date,
  },
  { timestamps: true }
);

const auditSchema = new Schema<AuditDoc>(
  {
    doctorId: { type: Schema.Types.ObjectId, required: true, index: true },
    actorId: String,
    actorRole: { type: String, default: "system" },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: String,
    summary: { type: String, default: "" },
  },
  { timestamps: true }
);

const lockSchema = new Schema<LockDoc>({
  _id: { type: String, required: true },
  lockedUntil: { type: Date, required: true },
});

const processedSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    source: { type: String, required: true },
    processedAt: { type: Date, default: Date.now },
  }
);

export const Conversation = mongoose.model<ConversationDoc>("Conversation", conversationSchema);
export const Notification = mongoose.model<NotificationDoc>("Notification", notificationSchema);
export const AuditLog = mongoose.model<AuditDoc>("AuditLog", auditSchema);
export const Lock = mongoose.model<LockDoc>("Lock", lockSchema);
export const ProcessedEvent = mongoose.model("ProcessedEvent", processedSchema);

export async function claimEvent(eventId: string, source: string): Promise<boolean> {
  try {
    await ProcessedEvent.create({ eventId, source, processedAt: new Date() });
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 11000) return false;
    throw err;
  }
}

export async function loadConversation(doctorId: string, waPhone: string, role: "patient" | "doctor") {
  let convo = await Conversation.findOne({ doctorId, waPhone });
  if (!convo) {
    convo = await Conversation.create({ doctorId, waPhone, role, state: "menu", draft: {} });
  }
  if (convo.role !== role) {
    convo.role = role;
    convo.state = "menu";
    convo.draft = {};
  }
  return convo;
}

export async function saveDraft(convo: ConversationDoc): Promise<void> {
  convo.markModified("draft");
  await convo.save();
}

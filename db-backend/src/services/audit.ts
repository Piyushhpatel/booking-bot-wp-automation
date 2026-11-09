import { AuditLog } from "../models/system";

export async function recordAudit(entry: {
  doctorId: string;
  actorId?: string;
  actorRole?: string;
  action: string;
  entity: string;
  entityId?: string;
  summary: string;
}): Promise<void> {
  try {
    await AuditLog.create({
      doctorId: entry.doctorId,
      actorId: entry.actorId,
      actorRole: entry.actorRole || "system",
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      summary: entry.summary,
    });
  } catch (err) {
    console.error("[audit]", err);
  }
}

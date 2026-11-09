import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { config, isDev } from "./config";
import { handleIncoming } from "./bot";
import { claimEvent } from "./models/system";
import { markAsRead, verifyWhatsAppSignature } from "./services/whatsapp";
import { normalizePhone } from "./utils/phone";
import { authRouter } from "./routes/auth";
import { dashboardRouter } from "./routes/dashboard";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: isDev ? true : config.frontendOrigin }));
  app.use(morgan(isDev ? "dev" : "combined"));
  app.use(express.json({ verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; } }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/dashboard", dashboardRouter);

  app.get("/webhooks/whatsapp", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === config.whatsapp.verifyToken) {
      res.status(200).send(String(req.query["hub.challenge"] || ""));
      return;
    }
    res.sendStatus(403);
  });

  app.post("/webhooks/whatsapp", async (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (raw && !verifyWhatsAppSignature(raw, req.header("x-hub-signature-256"))) {
      res.sendStatus(401);
      return;
    }
    res.sendStatus(200);
    try {
      const body = req.body as WaPayload;
      for (const message of extractMessages(body)) {
        if (!(await claimEvent(message.id, "whatsapp"))) continue;
        const parsed = parseMessage(message);
        if (!parsed) continue;
        await handleIncoming(normalizePhone(message.from), parsed, message.phoneNumberId);
        await markAsRead(message.id);
      }
    } catch (error) {
      console.error("[wa] webhook handler error", error);
    }
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    if (error instanceof ZodError) {
      res.status(400).json({ error: "Invalid input", details: error.errors });
      return;
    }
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    res.status(status).json({ error: status === 500 ? "Server error" : (error as { message?: string }).message || "Request failed" });
  });
  return app;
}

type WaPayload = { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; messages?: WaMessage[] } }[] }[] };
type WaMessage = { from: string; id: string; type: string; phoneNumberId?: string; text?: { body?: string }; interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } } };

function extractMessages(body: WaPayload): WaMessage[] {
  const messages: WaMessage[] = [];
  for (const entry of body.entry || []) for (const change of entry.changes || []) {
    const value = change.value;
    for (const message of value?.messages || []) messages.push({ ...message, phoneNumberId: value?.metadata?.phone_number_id });
  }
  return messages;
}

function parseMessage(message: WaMessage) {
  if (message.type === "text") return { kind: "text" as const, text: message.text?.body || "" };
  if (message.type !== "interactive") return null;
  if (message.interactive?.type === "button_reply") return { kind: "button" as const, id: message.interactive.button_reply?.id, text: message.interactive.button_reply?.title };
  if (message.interactive?.type === "list_reply") return { kind: "list" as const, id: message.interactive.list_reply?.id, text: message.interactive.list_reply?.title };
  return null;
}
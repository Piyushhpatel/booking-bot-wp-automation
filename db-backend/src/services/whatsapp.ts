import crypto from "crypto";
import axios from "axios";
import { config, whatsappConfigured } from "../config";

function graphMessagesUrl(): string {
  const { apiVersion, phoneNumberId } = config.whatsapp;
  return `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
}

export function toWaUser(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return `+${digits}`;
}

async function graphPost(payload: object): Promise<void> {
  if (!whatsappConfigured) {
    console.log("[wa:dry]", JSON.stringify(payload).slice(0, 700));
    return;
  }
  try {
    await axios.post(graphMessagesUrl(), payload, {
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  } catch (err) {
    const e = err as { response?: { data?: unknown }; message?: string };
    console.error("[wa] send failed", JSON.stringify(e.response?.data || e.message));
    throw err;
  }
}

function base(to: string) {
  return {
    messaging_product: "whatsapp" as const,
    recipient_type: "individual" as const,
    to: toWaUser(to),
  };
}

export async function sendText(to: string, body: string): Promise<void> {
  await graphPost({
    ...base(to),
    type: "text",
    text: { preview_url: true, body: body.slice(0, 4096) },
  });
}

export async function sendButtons(
  to: string,
  body: string,
  buttons: { id: string; title: string }[],
  opts?: { header?: string; footer?: string }
): Promise<void> {
  await graphPost({
    ...base(to),
    type: "interactive",
    interactive: {
      type: "button",
      ...(opts?.header ? { header: { type: "text", text: opts.header.slice(0, 60) } } : {}),
      body: { text: body.slice(0, 1024) },
      ...(opts?.footer ? { footer: { text: opts.footer.slice(0, 60) } } : {}),
      action: {
        buttons: buttons.slice(0, 3).map((button) => ({
          type: "reply",
          reply: { id: button.id.slice(0, 256), title: button.title.slice(0, 20) },
        })),
      },
    },
  });
}

export async function sendList(
  to: string,
  body: string,
  buttonText: string,
  rows: { id: string; title: string; description?: string }[],
  opts?: { header?: string; footer?: string; section?: string }
): Promise<void> {
  await graphPost({
    ...base(to),
    type: "interactive",
    interactive: {
      type: "list",
      ...(opts?.header ? { header: { type: "text", text: opts.header.slice(0, 60) } } : {}),
      body: { text: body.slice(0, 4096) },
      ...(opts?.footer ? { footer: { text: opts.footer.slice(0, 60) } } : {}),
      action: {
        button: buttonText.slice(0, 20),
        sections: [
          {
            title: (opts?.section || "Options").slice(0, 24),
            rows: rows.slice(0, 10).map((row) => ({
              id: row.id.slice(0, 200),
              title: row.title.slice(0, 24),
              ...(row.description ? { description: row.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  });
}

export async function sendTemplate(
  to: string,
  name: string,
  language: string,
  bodyParams: string[]
): Promise<void> {
  await graphPost({
    ...base(to),
    type: "template",
    template: {
      name,
      language: { code: language },
      components: [
        {
          type: "body",
          parameters: bodyParams.map((text) => ({ type: "text", text })),
        },
      ],
    },
  });
}

export async function markAsRead(messageId: string): Promise<void> {
  if (!whatsappConfigured) return;
  try {
    await graphPost({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  } catch (err) {
    console.error("mark as read failed", err);
  }
}

export function verifyWhatsAppSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!config.whatsapp.appSecret) {
    console.warn("WHATSAPP_APP_SECRET is not set; skipping signature check");
    return true;
  }
  if (!header || !header.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", config.whatsapp.appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function ensureWabaSubscription(): Promise<void> {
  const { accessToken, businessAccountId, appId, apiVersion } = config.whatsapp;
  if (!accessToken || !businessAccountId) return;
  const url = `https://graph.facebook.com/${apiVersion}/${businessAccountId}/subscribed_apps`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    const listed = await axios.get(url, { headers, timeout: 15000 });
    const apps = (listed.data?.data || []) as {
      whatsapp_business_api_data?: { id?: string; name?: string };
    }[];
    const ours = appId ? apps.some((app) => app.whatsapp_business_api_data?.id === appId) : apps.length > 0;
    if (appId && !ours) {
      await axios.post(url, {}, { headers, timeout: 15000 });
      console.log("[wa] subscribed this app to the WhatsApp Business Account");
    }
  } catch (err) {
    const e = err as { response?: { data?: unknown }; message?: string };
    console.error("[wa] could not check WABA subscription", e.response?.data || e.message);
  }
}

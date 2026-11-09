import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

const nodeEnv = env("NODE_ENV", "development");

export const config = {
  port: Number(env("PORT", "4100")),
  nodeEnv,
  mongoUri: env("MONGODB_URI", "mongodb://127.0.0.1:27017/doc-booking"),
  jwtSecret: env("JWT_SECRET", "dev-only-change-me"),
  frontendOrigin: env("FRONTEND_ORIGIN", "http://localhost:5173"),
  seedOnBoot: env("SEED_ON_BOOT", nodeEnv === "production" ? "false" : "true") === "true",
  doctor: {
    email: env("DOCTOR_EMAIL", "doctor@demo.local").toLowerCase(),
    password: env("DOCTOR_PASSWORD", "changeme"),
    name: env("DOCTOR_NAME", "Dr. A. Mehta"),
  },
  staff: {
    email: env("STAFF_EMAIL", "staff@demo.local").toLowerCase(),
    password: env("STAFF_PASSWORD", "changeme"),
    name: env("STAFF_NAME", "Reception"),
  },
  clinic: {
    name: env("CLINIC_NAME", "Mehta Clinic"),
    timezone: env("CLINIC_TIMEZONE", "Asia/Kolkata"),
    phone: env("CLINIC_PHONE", "01140000000"),
  },
  doctorWhatsapp: env("DOCTOR_WHATSAPP"),
  whatsapp: {
    accessToken: env("WHATSAPP_ACCESS_TOKEN"),
    appId: env("WHATSAPP_APP_ID"),
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
    businessAccountId: env("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    verifyToken: env("WHATSAPP_VERIFY_TOKEN", "doc-booking-verify"),
    appSecret: env("WHATSAPP_APP_SECRET"),
    displayNumber: env("WHATSAPP_DISPLAY_NUMBER"),
    apiVersion: env("WHATSAPP_API_VERSION", "v25.0"),
  },
};

export const isDev = config.nodeEnv !== "production";
export const whatsappConfigured = Boolean(
  config.whatsapp.accessToken && config.whatsapp.phoneNumberId
);

# Clinic Booking Bot

A WhatsApp appointment-booking system for clinics. Patients book appointments through the Meta WhatsApp Cloud API, while doctors and staff manage the schedule from a React dashboard.

The booking engine is the core of the application. It calculates availability from clinic hours, exceptions, existing bookings, buffers, caps, and notice rules instead of storing pre-generated slots.

## What is included

- Patient booking conversations in English and Hindi
- Fixed clock-slot and token/queue sessions
- Appointment holds with expiry and double-booking protection
- Doctor approval or automatic confirmation flows
- Doctor commands over WhatsApp for day-to-day operations
- React dashboard for appointments, patients, schedules, time off, and settings
- MongoDB persistence with audit records
- Meta webhook signature verification and duplicate-event protection
- Reminder and digest hooks for WhatsApp notifications

See [`SPEC.md`](./SPEC.md) for the detailed product and scheduling rules.

## Architecture

```text
Patient WhatsApp
       │
       ▼
Meta WhatsApp Cloud API ──► db-backend (Express + TypeScript)
                                  │
                                  ▼
                                MongoDB
                                  ▲
                                  │
                 db-frontend (React + Vite dashboard)
```

| Directory | Purpose |
| --- | --- |
| [`db-backend`](./db-backend) | API, booking engine, WhatsApp webhook, MongoDB models, authentication |
| [`db-frontend`](./db-frontend) | Doctor/staff dashboard |

## Requirements

- Node.js 20 or newer
- npm
- MongoDB 7+ running locally or a reachable MongoDB deployment
- A Meta WhatsApp Business app for real WhatsApp messaging

## Quick start

### 1. Start MongoDB

Use a local MongoDB instance, or provide a remote connection string in the backend environment.

### 2. Configure the backend

```bash
cd db-backend
cp .env.sample .env
```

At minimum, set a non-default `JWT_SECRET` before using the application outside local development. The sample file contains demo credentials and safe local defaults; change all passwords for shared or production environments.

### 3. Install dependencies and start the API

```bash
npm install
npm run dev
```

The API listens on `http://localhost:3000` when `PORT=3000` is set in `.env`. If `PORT` is omitted, the application default is `4100`.

In development, the server seeds one clinic, a doctor account, a staff account, a consultation type, and weekday schedule rules on startup. To seed explicitly:

```bash
npm run seed
```

Set `SEED_ON_BOOT=false` when the application must not update seed data at startup.

### 4. Start the dashboard

In a second terminal:

```bash
cd db-frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

The dashboard derives the backend URL from the browser host and port 3000 by default. To point it at another API:

```bash
echo 'VITE_API_URL=http://localhost:4100' > .env.local
```

### 5. Sign in

The development seed creates the accounts configured by `DOCTOR_*` and `STAFF_*`:

```text
Doctor: doctor@demo.local / changeme
Staff:  staff@demo.local  / changeme
```

Change these values in `.env` before sharing the environment.

## Backend configuration

Copy [`db-backend/.env.sample`](./db-backend/.env.sample) to `db-backend/.env`. Important settings include:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `PORT` | Backend HTTP port |
| `FRONTEND_ORIGIN` | Dashboard origin used by CORS outside development |
| `JWT_SECRET` | Secret used to sign dashboard login tokens |
| `SEED_ON_BOOT` | Whether to run the demo/upsert seed on startup |
| `CLINIC_*` | Clinic name, timezone, and phone |
| `DOCTOR_*`, `STAFF_*` | Seeded dashboard users |
| `DOCTOR_WHATSAPP` | Whitelisted doctor number for doctor commands |
| `WHATSAPP_*` | Meta Cloud API credentials and webhook settings |

WhatsApp is optional for local dashboard development. When `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are not set, outbound messages are logged as dry-run payloads instead of being sent.

## Connecting WhatsApp

1. Create/configure a Meta WhatsApp Business app and obtain a phone number ID and access token.
2. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, and `WHATSAPP_APP_ID`.
3. Set a private `WHATSAPP_VERIFY_TOKEN` and configure the same value in Meta.
4. Set `WHATSAPP_APP_SECRET` so incoming webhook signatures are verified.
5. Expose the backend publicly over HTTPS. For local development, the optional tunnel command is:

   ```bash
   npm run tunnel
   ```

6. Configure Meta's callback URL as:

   ```text
   https://<public-host>/webhooks/whatsapp
   ```

The webhook verification endpoint is `GET /webhooks/whatsapp`; incoming events use `POST /webhooks/whatsapp`.

## Useful commands

### Backend

```bash
npm run dev       # Watch mode
npm test          # Booking engine and bot tests
npm run build     # TypeScript build to dist/
npm start         # Run the compiled server
npm run seed      # Seed the configured clinic and users
npm run tunnel    # Cloudflare tunnel to localhost:3000
```

### Frontend

```bash
npm run dev       # Vite development server
npm run build     # Type-check and production build
npm run lint      # Oxlint
npm run preview   # Serve the production build locally
```

## API overview

The backend exposes:

- `GET /health` — health check
- `POST /api/auth/login` and `GET /api/auth/me` — dashboard authentication
- `/api/dashboard/*` — authenticated appointments, patients, schedule, settings, and exceptions
- `GET/POST /webhooks/whatsapp` — Meta webhook verification and incoming messages

Dashboard API requests use a bearer token stored by the frontend after login.

## Production notes

- Run behind HTTPS and restrict `FRONTEND_ORIGIN` to the actual dashboard origin.
- Use a strong, unique `JWT_SECRET`; do not use the sample passwords.
- Keep MongoDB encrypted, backed up, and inaccessible from the public internet.
- Configure `WHATSAPP_APP_SECRET` rather than relying on the development signature-check bypass.
- Run one application process for v1 scheduled work, or add a shared deduplication/lock strategy before scaling horizontally.
- The application stores appointment fees as snapshots in paise; it does not collect payments.

## Status

This repository is an active v1 implementation. Payments, OTP login, and field-level encryption are intentionally out of scope; the current product decisions are recorded in [`SPEC.md`](./SPEC.md).

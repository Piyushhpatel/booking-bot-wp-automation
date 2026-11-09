# WhatsApp Clinic Booking — Spec

Living source of truth for `doc-booking`. The booking engine is the product. WhatsApp and the dashboard are clients of it.

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Tenancy | `doctorId` on every record. v1 seeds one clinic. |
| Backend | Node.js, TypeScript, Express, MongoDB. Same shape as `wp-bot`. |
| Dashboard | React + Vite, not Next.js. Same operating model as the order bot. |
| WhatsApp | Meta Cloud API. Idempotent webhooks. |
| Slots | Computed from rules + exceptions + existing bookings. No pre-generated slot rows. |
| Scheduling | Both models. Each session is `fixed` (clock slots) or `token` (queue number). |
| Holds | Picking a slot holds it. Default 5 minutes. Confirm converts the hold. |
| Double booking | Per-clinic lock, plus unique claims on the occupied grid. |
| Time | Instants stored in UTC. All rules evaluated in the clinic timezone. |
| Money | Fee stored in paise on the appointment. v1 does not collect payment. |
| Login | Email + password for doctor and staff. OTP later. |
| Languages | English and Hindi in the patient chat. Doctor commands are English. |
| Medical data | Chat collects name and visit type, not a diagnosis. Consent before the first booking. |

Payments, OTP login, and field-level encryption are intentionally out of v1. Production should still run MongoDB with disk encryption, HTTPS, and backups.

## 2. Actors

- **Patient** books on the clinic WhatsApp number. One phone can hold several people (self, parent, child).
- **Doctor** sets rules, and can run the day from WhatsApp if the sender phone is whitelisted.
- **Staff** uses the dashboard to book walk-ins, mark visits, and record leave. Staff cannot change weekly rules or bot settings.
- **Scheduler** expires holds, sends reminders, and sends the morning digest.

## 3. When a slot is bookable

A fixed start time is offered only when all of these are true:

1. Bookings are open for the clinic.
2. The date is today through today + max advance (default 30 days), in the clinic timezone.
3. The date is not a holiday or leave. Leave and holiday beat special hours. Special hours replace the weekday rule.
4. The start falls inside a working session, the visit ends before the session ends, and the visit does not overlap a break or a block.
5. The occupied window `[start, end + buffer)` does not overlap another occupying appointment.
6. The daily cap and that session's cap are not reached.
7. The start is at least `minNoticeMinutes` away (default 60). Equal to the cutoff is allowed.

Occupying statuses: `held` (only while the hold is unexpired), `pending_approval`, `confirmed`, `completed`, `no_show`.

`cancelled` and `rescheduled` do not occupy time and do not count toward caps. Walk-ins are normal appointments, so they consume capacity.

Token sessions ignore the clock grid. The patient is offered the next token if the session cap allows it. Min notice applies to the session start when the session has not begun. Once the session has started, a patient can still take a token until the session end. The approximate time is an estimate, not an exclusive clock claim.

Intervals are half-open: a visit that ends at 12:00 does not overlap a break that starts at 12:00. The buffer after a visit does occupy time, so the next fixed slot cannot start inside it.

Grid claims use the clinic `gridMinutes` (default 5). Slot steps, visit durations, and buffers must be multiples of that grid. Claims are written only for real holds and bookings.

## 4. Statuses

`held → pending_approval → confirmed → completed`

Side exits: `cancelled`, `no_show`, `rescheduled`.

- Auto-confirm clinics skip `pending_approval`.
- Approval clinics land on `pending_approval` until the dashboard or a doctor command confirms.
- Dashboard and walk-in bookings are confirmed immediately.
- `no_show` is only from `confirmed`. The patient no-show count increments. At the clinic threshold the patient is flagged and cannot book online. The chat does not announce the flag. Staff can still book and can clear the flag.
- Reschedule creates a new appointment and marks the old one `rescheduled`. The old one is excluded from caps so a full session can still be rearranged.

## 5. Patient rules

- First booking asks for consent. Consent covers the phone number.
- Same patient: at most `patientDailyLimit` occupying bookings per date (default 1), and at most `patientFutureLimit` future active bookings (default 3).
- Same phone, all people combined: at most `phoneDailyLimit` occupying bookings per date (default 3), so a family can book and a script cannot fill the day.
- "Book for" lists people already saved on that phone, plus someone new.

## 6. Exceptions

| Type | Effect |
|---|---|
| `holiday`, `leave` | Whole dates closed. |
| `block` | A time range on those dates, or an absolute range ("next 2 hours"). |
| `special_hours` | Replaces that date's sessions. |
| `daily_cap` | Replaces the daily cap for those dates. Doctor command `limit`. |

Saving leave or a block lists affected `held`, `pending_approval`, and `confirmed` appointments. Cancelling them is a separate confirm, and those patients are notified. New bookings stop as soon as the exception is saved.

Waitlist is offered only when a date is full. Cancelling a confirmed or pending visit notifies the oldest waiting patient. They still book the freed slot themselves. Expired holds do not ping the waitlist.

## 7. Patient chat

Menu: Book / My appointments / Clinic info. `MENU` (or hi / hello / नमस्ते) returns to the menu from anywhere.

Book: who → name if needed → visit type (skipped when only one type exists) → date → slot list → summary. The slot is held when they pick it, then Confirm / Change / Cancel.

Emergency words (`emergency`, `chest pain`, `heart attack`, `can't breathe`, and the Hindi equivalents) leave the booking flow and tell the person to call emergency services or go to a hospital. This does not apply to the doctor's whitelisted number.

Free text still works for yes/no, a date, a clock time, and the menu words.

## 8. Doctor chat

The sender must be on the clinic whitelist. Examples:

`today`, `tomorrow`, `bookings 15 Oct`, `next`, `done 5`, `noshow 5`, `cancel 5`, `block today 2pm-4pm`, `leave 20 Oct-22 Oct`, `close bookings`, `open bookings`, `limit 20`, `summary`, `patient 98xxxxxx`.

Numbers in `done` / `noshow` / `cancel` are the position in that day's list, not the booking id.

A digest of today's list is sent to every whitelisted phone once the local clock reaches `digestHour` (default 8), with a three-hour catch-up if the process was down.

Reminders go out for confirmed visits at the configured hours before (default 24 and 2). A reminder is skipped when the booking was made after that threshold, because the confirmation message already covered it.

## 9. Dashboard

- Today: day list, week counts, status actions, waitlist.
- Book: walk-in or phone booking, and reschedule.
- Patients: search, notes, flag, visit history.
- Insights: volume, no-show rate, peak hour, new vs returning, expected fees from snapshots. Fees are not collected payments.
- Schedule and appointment types: doctor only.
- Time off: leave, holiday, block, affected patients.
- Settings: window, caps, confirmation mode, greeting, whitelist. Doctor only.
- Audit log of dashboard and doctor-command changes.

## 10. Non-functional

- Availability is a pure function. Tests cover caps, buffers, leave, blocks, notice, and token mode.
- Webhook duplicate message ids are ignored.
- Booking mutations for one clinic run under a short lock so two taps cannot both succeed.
- If sending a WhatsApp message fails, the API still returns and the patient-facing fallback is to call the clinic.
- Holds, reminders, and the digest are safe to run on a timer. A second process skips work that is already sent via a dedupe key. Run one app process in v1.

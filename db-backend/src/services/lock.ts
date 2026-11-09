import { Lock } from "../models/system";
import { HttpError } from "../httpError";

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  try {
    await Lock.updateOne({ _id: key }, { $setOnInsert: { lockedUntil: new Date(0) } }, { upsert: true });
  } catch (err: unknown) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }

  const started = Date.now();
  while (Date.now() - started < 4000) {
    const now = new Date();
    const res = await Lock.updateOne(
      { _id: key, lockedUntil: { $lte: now } },
      { $set: { lockedUntil: new Date(now.getTime() + 8000) } }
    );
    if (res.modifiedCount === 1) {
      try {
        return await fn();
      } finally {
        await Lock.updateOne({ _id: key }, { $set: { lockedUntil: new Date(0) } });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new HttpError(503, "The clinic is busy. Please try again in a moment.");
}

export function bookingLock(doctorId: string): string {
  return `book:${doctorId}`;
}

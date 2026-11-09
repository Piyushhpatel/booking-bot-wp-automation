import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { User, UserRole } from "../models/clinic";

export interface AuthedRequest extends Request {
  userId?: string;
  doctorId?: string;
  role?: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      doctorId?: string;
      role?: UserRole;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    const user = await User.findById(payload.sub);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = String(user._id);
    req.doctorId = String(user.doctorId);
    req.role = user.role;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireDoctor(req: Request, res: Response, next: NextFunction): void {
  if (req.role !== "doctor" && req.role !== "admin") {
    res.status(403).json({ error: "Only the doctor can change this." });
    return;
  }
  next();
}

export function signToken(user: { id: string; doctorId: string; role: UserRole }): string {
  return jwt.sign({ sub: user.id, doctorId: user.doctorId, role: user.role }, config.jwtSecret, {
    expiresIn: "7d",
  });
}

// src/middleware/serviceAuth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const SERVICE_KEYS = (process.env.SERVICE_API_KEYS || process.env.SERVICE_KEY || "").split(",").map(s => s.trim()).filter(Boolean);

export interface WorkerRequest extends Request {
  service?: boolean;
}

export function verifyServiceKey(req: Request, res: Response, next: NextFunction) {
  const header = (req.headers["x-service-key"] || req.headers.authorization || "") as string;
  // Accept either x-service-key: key OR Authorization: Bearer <key>
  let key = "";
  if (header.startsWith("Bearer ")) key = header.split("Bearer ")[1].trim();
  else if (req.headers["x-service-key"]) key = String(req.headers["x-service-key"]);
  else key = "";
  if (!key || !SERVICE_KEYS.includes(key)) return res.status(401).json({ error: "Invalid service key" });
  // mark request as from service
  (req as any).service = true;
  return next();
}

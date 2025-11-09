// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt, { SignOptions, Secret } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

if (!JWT_SECRET) {
  // fail fast in dev; in prod, use proper secret management
  throw new Error("JWT_SECRET is not set in environment");
}

/** Payload shape for our tokens */
export interface AuthPayload {
  uid: string;
  email: string;
  role?: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload | null;
}

/** Generate a signed JWT (access token) */
export function generateAccessToken(payload: AuthPayload): string {
  // build options typed as SignOptions
  // cast expiresIn to any to satisfy @types/jsonwebtoken mismatch with string environment values
  const options: SignOptions = { expiresIn: JWT_EXPIRES_IN as any };
  // ensure secret is typed as jwt.Secret
  const secret: Secret = JWT_SECRET as Secret;
  // jwt.sign accepts payload as string | object | Buffer
  return jwt.sign(payload as string | object | Buffer, secret, options);
}

/** Express middleware to verify incoming Bearer tokens */
export async function verifyToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Authorization header (Bearer token required)" });
  }
  const token = authHeader.split("Bearer ")[1].trim();

  try {
    // jwt.verify returns string | object, cast to our payload type
    const decoded = jwt.verify(token, JWT_SECRET as Secret) as AuthPayload;
    req.user = { uid: decoded.uid, email: decoded.email, role: decoded.role };
    return next();
  } catch (err) {
    console.error("JWT verification failed:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
// keep your existing exports, then add:
export { verifyToken as verifyFirebaseToken };

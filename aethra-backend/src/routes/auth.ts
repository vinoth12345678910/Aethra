// src/routes/auth.ts
import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { User } from "../models/user";
import { generateAccessToken, verifyToken } from "../middleware/auth";

const router = Router();
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8), // enforce min length
  name: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Rate limiter for login
const loginLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 10, // max 10 attempts per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/auth/register
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.format() });

    const { email, password, name } = parsed.data;
    const existing = await User.findOne({ email }).lean();
    if (existing) return res.status(409).json({ error: "User already exists" });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ email, passwordHash: hash, name });

    const uid = (user._id as mongoose.Types.ObjectId).toString();
    const token = generateAccessToken({ uid, email: user.email, role: user.role });

    return res.status(201).json({
      token,
      user: { id: uid, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * POST /api/auth/login
 */
router.post("/login", loginLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.format() });

    const { email, password } = parsed.data;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const uid = (user._id as mongoose.Types.ObjectId).toString();
    const token = generateAccessToken({ uid, email: user.email, role: user.role });
    return res.json({ token, user: { id: uid, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/**
 * GET /api/auth/me
 */
router.get("/me", verifyToken, async (req: Request & { user?: any }, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const user = await User.findById(req.user.uid).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({
      id: (user._id as mongoose.Types.ObjectId).toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    console.error("Auth me error:", err);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;

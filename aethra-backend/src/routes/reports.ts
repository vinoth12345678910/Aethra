// src/routes/reports.ts
import { Router, Response } from "express";
import { verifyFirebaseToken, AuthRequest } from "../middleware/auth";
import { Report } from "../models/report";
import { generateMockResult } from "../utils/mockResults";
import mongoose from "mongoose";

const router = Router();

/**
 * Helper: check for service key in headers.
 * Accepts either:
 *  - x-service-key: <key>
 *  - Authorization: Bearer <key>
 * Service keys are read from env SERVICE_API_KEYS (comma-separated).
 */
function getServiceKeyFromHeaders(headers: any): string | null {
  const rawKeyHeader = headers["x-service-key"] || headers["authorization"] || "";
  if (!rawKeyHeader) return null;
  if (typeof rawKeyHeader !== "string") return null;
  if (rawKeyHeader.startsWith("Bearer ")) return rawKeyHeader.split("Bearer ")[1].trim();
  return rawKeyHeader;
}

function isValidServiceKey(key: string | null): boolean {
  if (!key) return false;
  const env = process.env.SERVICE_API_KEYS || process.env.SERVICE_KEY || "";
  if (!env) return false;
  const keys = env.split(",").map((s) => s.trim()).filter(Boolean);
  return keys.includes(key);
}

/**
 * Wrapper middleware: accept either a valid service key OR a normal user JWT.
 * If service key is present and valid -> mark req.service = true and continue.
 * Otherwise call verifyFirebaseToken to validate user token as before.
 */
function verifyWorkerOrUser(req: any, res: Response, next: any) {
  try {
    const key = getServiceKeyFromHeaders(req.headers);
    if (key && isValidServiceKey(key)) {
      // mark request as from service (worker)
      req.service = true;
      return next();
    }
    // fallback to standard JWT auth
    return verifyFirebaseToken(req, res, next);
  } catch (err) {
    console.error("verifyWorkerOrUser error:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/* ---------------------------
   Report creation endpoints
   --------------------------- */

router.post("/audit", verifyFirebaseToken, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, metadata, fileUrl } = req.body;
    const ownerUid = req.user!.uid;

    const report = await Report.create({
      type: "audit",
      ownerUid,
      title,
      description,
      fileUrl,
      metadata,
      status: "pending",
      result: {}
    });

    // Keep mock behavior for now (you can switch to pending-only later)
    const result = generateMockResult("audit");
    report.result = result;
    report.status = "completed";
    await report.save();

    return res.status(201).json(report);
  } catch (err) {
    console.error("Create audit error:", err);
    return res.status(500).json({ error: "failed to create audit" });
  }
});

router.post("/deepfake", verifyFirebaseToken, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, metadata, fileUrl } = req.body;
    const ownerUid = req.user!.uid;

    const report = await Report.create({
      type: "deepfake",
      ownerUid,
      title,
      description,
      fileUrl,
      metadata,
      status: "pending",
      result: {}
    });

    const result = generateMockResult("deepfake");
    report.result = result;
    report.status = "completed";
    await report.save();

    return res.status(201).json(report);
  } catch (err) {
    console.error("Create deepfake error:", err);
    return res.status(500).json({ error: "failed to create deepfake" });
  }
});

/* ---------------------------
   Listing & fetching
   --------------------------- */

router.get("/", verifyFirebaseToken, async (req: AuthRequest, res: Response) => {
  try {
    const ownerUid = req.user!.uid;
    const type = (req.query.type as string) || "all";
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.skip) || 0;

    const filter: any = { ownerUid };
    if (type === "audit" || type === "deepfake") filter.type = type;

    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return res.json({ count: reports.length, reports });
  } catch (err) {
    console.error("Fetch reports error:", err);
    return res.status(500).json({ error: "failed to fetch reports" });
  }
});

router.get("/:id", verifyFirebaseToken, async (req: AuthRequest, res: Response) => {
  try {
    const ownerUid = req.user!.uid;
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID" });

    const report = await Report.findById(id).lean();
    if (!report) return res.status(404).json({ error: "Report not found" });
    if (report.ownerUid !== ownerUid) return res.status(403).json({ error: "Access denied" });

    return res.json(report);
  } catch (err) {
    console.error("Get report error:", err);
    return res.status(500).json({ error: "failed to get report" });
  }
});

/* ---------------------------
   Update (PATCH) - worker OR owner
   --------------------------- */

router.patch("/:id", verifyWorkerOrUser, async (req: any, res: Response) => {
  try {
    const id = req.params.id;
    const { result, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid ID" });

    const report = await Report.findById(id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    // If request is NOT a service (worker), enforce owner check
    if (!req.service) {
      const ownerUid = req.user!.uid;
      if (report.ownerUid !== ownerUid) return res.status(403).json({ error: "Access denied" });
    }

    if (result) report.result = result;
    if (status && ["pending", "completed", "failed"].includes(status)) report.status = status;

    await report.save();

    return res.json(report);
  } catch (err) {
    console.error("Update report error:", err);
    return res.status(500).json({ error: "failed to update report" });
  }
});

export default router;

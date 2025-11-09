import { Router } from "express";
import { bucket } from "../config/gcs";
import { v4 as uuidv4 } from "uuid";
import { verifyToken } from "../middleware/auth";
import { Request, Response } from "express";

const router = Router();
const DEFAULT_EXPIRE = Number(process.env.GCS_SIGNED_URL_EXPIRE_SECONDS || 900);

router.post("/signed-url", verifyToken, async (req: Request, res: Response) => {
  try {
    if (!bucket) return res.status(500).json({ error: "GCS bucket not configured" });

    const { filename, contentType } = req.body;
    if (!filename) return res.status(400).json({ error: "filename is required" });

    const uniqueName = `${Date.now()}_${uuidv4()}_${filename}`;
    const file = bucket.file(uniqueName);

    const options = {
      version: "v4" as const,
      action: "write" as const,
      expires: Date.now() + DEFAULT_EXPIRE * 1000,
      contentType: contentType || "application/octet-stream",
    };

    const [url] = await file.getSignedUrl(options);

    return res.json({ uploadUrl: url, objectName: uniqueName, expiresIn: DEFAULT_EXPIRE });
  } catch (err) {
    console.error("Signed URL error:", err);
    return res.status(500).json({ error: "signed url generation failed" });
  }
});

export default router;

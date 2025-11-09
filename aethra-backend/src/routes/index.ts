import { Router } from "express";
import authRoutes from "./auth";
import uploadRoutes from "./upload";
import reportsRoutes from "./reports";

const router = Router();

router.use("/auth", authRoutes);
router.use("/upload", uploadRoutes);
router.use("/reports", reportsRoutes);

export default router;

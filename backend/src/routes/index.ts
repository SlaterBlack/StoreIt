import { Router } from "express";
import { sequelize } from "../config/database";
import { asyncHandler } from "../utils/asyncHandler";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import clockItRoutes from "./clockit.routes";
import manageItRoutes from "./manageit.routes";
import reportRoutes from "./report.routes";
import splatItRoutes from "./splatit.routes";
import serviceRoutes from "./services.routes";

const router = Router();

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    await sequelize.authenticate();
    res.json({ status: "ok", database: "connected" });
  }),
);
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/clockit", clockItRoutes);
router.use("/manageit", manageItRoutes);
router.use("/report", reportRoutes);
router.use("/splatit", splatItRoutes);
router.use("/services", serviceRoutes);

export default router;

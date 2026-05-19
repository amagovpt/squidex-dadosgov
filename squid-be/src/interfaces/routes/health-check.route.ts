import { Router } from "express";
import HealthCheckController from "../controllers/health-check.controller";

const router = Router();

router.get("/healthcheck", (req, res) => {
  HealthCheckController.healthCheck(req, res);
});

export default router;

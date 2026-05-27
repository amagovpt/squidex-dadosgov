import { Router } from 'express';
import HealthCheckController from '../controllers/health-check.controller';

const router = Router();

router.get('/healthcheck', HealthCheckController.healthCheck);
router.get('/readiness', HealthCheckController.readyCheck);

export default router;

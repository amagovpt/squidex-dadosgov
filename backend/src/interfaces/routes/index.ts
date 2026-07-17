import { Router } from 'express';
import HealthCheckRoutes from './health-check.route';

const router = Router({ mergeParams: true });

router.use(HealthCheckRoutes);

export default router;

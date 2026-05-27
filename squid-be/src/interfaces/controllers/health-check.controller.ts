import { Response, Request } from 'express';
import { isGatewayReady } from '@lib/gatewayState';

// Liveness: the process is up and serving.
const healthCheck = async (_req: Request, res: Response) => {
  return res.status(200).json({ status: 'Server running' });
};

// Readiness: the gateway schema has been built from Squidex and can serve
// GraphQL. Returns 503 until ready so orchestrators don't route traffic early.
const readyCheck = async (_req: Request, res: Response) => {
  const ready = isGatewayReady();
  return res
    .status(ready ? 200 : 503)
    .json({ status: ready ? 'ready' : 'not ready' });
};

export default { healthCheck, readyCheck };

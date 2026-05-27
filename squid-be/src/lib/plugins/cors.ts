import cors from 'cors';
import { envParser } from '../envParser';

const { NODE_ENV, FRONTEND_ORIGIN } = envParser;

// localhost is only trusted outside production; production trusts the
// configured frontend origin(s) exactly. Empty values are filtered out.
const allowedOrigins = [
  ...(NODE_ENV === 'production' ? [] : ['http://localhost:3000']),
  ...FRONTEND_ORIGIN.split(',').map((o) => o.trim()),
].filter(Boolean);

export default cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'Accept',
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Api-Key',
  ],
});

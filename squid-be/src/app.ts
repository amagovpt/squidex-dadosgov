import 'reflect-metadata';
import express from 'express';
import http from 'http';
import logger from 'morgan';
import { createYoga } from 'graphql-yoga';
import { stitchSchemas } from '@graphql-tools/stitch';
import type { GraphQLSchema } from 'graphql';

import { createProxyMiddleware } from 'http-proxy-middleware';
import routes from './interfaces/routes';
import cors from './lib/plugins/cors';
import errorHandler from '@/middleware/errorHandler';
import {
  getRemoteSchema,
  getToken,
  type GatewayContext,
} from '@infrastructure/cms/remote-schema';
import { loggingMiddleware } from '@lib/plugins/logger';
import { useDepthLimit } from '@lib/plugins/depthLimit';
import { rateLimit } from '@lib/plugins/rateLimit';
import { setGatewayReady } from '@lib/gatewayState';
import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import { envParser } from '@lib/envParser';

const { CMS_URL, NODE_ENV, GRAPHQL_MAX_DEPTH, SCHEMA_REFRESH_MS } = envParser;
const isProduction = NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);

// Request logging to stdout (let the container runtime handle rotation):
// machine-parseable "combined" format in production, human-readable colored
// logger in development. A single source avoids duplicate log lines.
if (isProduction) {
  app.use(logger('combined'));
} else {
  app.use(loggingMiddleware);
}

// Middleware setup
app.use(cors);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Trust proxy (correct client IP for rate-limiting and secure cookies).
app.set('trust proxy', 1);

// Routes
app.use('/api', routes);

// Asset passthrough to Squidex.
app.use(
  '/api/assets',
  createProxyMiddleware({
    target: CMS_URL,
    changeOrigin: true,
    secure: false,
    pathRewrite: (path) => `/squidex/api/assets/dados-gov${path}`,
  }),
);

// --- GraphQL gateway schema (cached + periodically refreshed) ---------------

let gatewaySchema: GraphQLSchema | null = null;

async function buildGatewaySchema(): Promise<GraphQLSchema> {
  return stitchSchemas({
    subschemas: [await getRemoteSchema()],
    typeDefs: 'type Query { heartbeat: String! }',
    resolvers: {
      Query: {
        heartbeat: () => 'OK',
      },
    },
  });
}

/**
 * Builds the gateway schema once and, when SCHEMA_REFRESH_MS > 0, refreshes it
 * on an interval so newly-published Squidex schemas are picked up without a
 * restart. A failed refresh keeps the previously working schema.
 */
export async function initGateway(): Promise<void> {
  gatewaySchema = await buildGatewaySchema();
  setGatewayReady(true);

  if (SCHEMA_REFRESH_MS > 0) {
    const timer = setInterval(async () => {
      try {
        gatewaySchema = await buildGatewaySchema();
        console.log('Gateway schema refreshed');
      } catch (error) {
        console.error('Schema refresh failed, keeping previous schema:', error);
      }
    }, SCHEMA_REFRESH_MS);
    timer.unref();
  }
}

const yoga = createYoga<GatewayContext>({
  schema: () => {
    if (!gatewaySchema) {
      throw new Error('Gateway schema not initialized yet');
    }
    return gatewaySchema;
  },
  graphqlEndpoint: '/graphql',
  logging: true,
  graphiql: isProduction ? false : { endpoint: '/graphql' },
  plugins: [
    // Introspection is allowed only outside production.
    useDisableIntrospection({ isDisabled: () => isProduction }),
    useDepthLimit(GRAPHQL_MAX_DEPTH),
  ],
  // Resolve a fresh (cached) token per request so delegation to Squidex always
  // carries a valid Authorization header.
  context: async ({ request }) => ({ request, token: await getToken() }),
});

app.use(
  '/graphql',
  rateLimit({ windowMs: 60_000, max: 120 }),
  // graphql-yoga is a WHATWG handler; Express 5's stricter handler types don't
  // model it, so bridge it explicitly.
  yoga as unknown as express.RequestHandler,
);

// 404 Handler
app.use((req, res) => {
  console.warn(`404 - Not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    message: 'Not found',
  });
});

// Error handling middleware
app.use(errorHandler);

export { server };

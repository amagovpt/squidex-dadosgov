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

const { CMS_URL, NODE_ENV, GRAPHQL_MAX_DEPTH, SCHEMA_REFRESH_MS, TRUST_PROXY } =
  envParser;
const isProduction = NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);

// Trust proxy (correct client IP for rate-limiting and secure cookies). The
// hop count must match the number of reverse proxies in front of the gateway.
app.set('trust proxy', TRUST_PROXY);

// Request logging to stdout (let the container runtime handle rotation):
// machine-parseable "combined" format in production, human-readable colored
// logger in development. A single source avoids duplicate log lines.
if (isProduction) {
  app.use(logger('combined'));
} else {
  app.use(loggingMiddleware);
}

app.use(cors);

// Asset passthrough to Squidex — MUST be registered before the body parsers,
// otherwise express.json()/urlencoded() drain the request stream and proxied
// uploads (POST/PUT) hang with an empty body. A generous limiter bounds abuse
// of the proxy without throttling normal image-heavy browsing.
app.use(
  '/api/assets',
  rateLimit({ windowMs: 60_000, max: 600 }),
  createProxyMiddleware({
    target: CMS_URL,
    changeOrigin: true,
    secure: false,
    pathRewrite: (path) => `/squidex/api/assets/dados-gov${path}`,
  }),
);

// Body parsers (after the asset proxy so uploads stream through untouched).
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.use('/api', routes);

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
    // Recursive setTimeout (not setInterval) so a slow introspection can never
    // overlap with the next refresh and clobber a newer schema.
    const scheduleRefresh = () => {
      const timer = setTimeout(async () => {
        try {
          gatewaySchema = await buildGatewaySchema();
          console.log('Gateway schema refreshed');
        } catch (error) {
          console.error(
            'Schema refresh failed, keeping previous schema:',
            error,
          );
        } finally {
          scheduleRefresh();
        }
      }, SCHEMA_REFRESH_MS);
      timer.unref();
    };
    scheduleRefresh();
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
  // carries a valid Authorization header. If the token endpoint is briefly
  // unavailable, still serve the request (local fields like `heartbeat` work;
  // Squidex-backed fields surface their own auth error) instead of failing it.
  context: async ({ request }) => {
    try {
      return { request, token: await getToken() };
    } catch (error) {
      console.error('Token unavailable; serving request without auth:', error);
      return { request };
    }
  },
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

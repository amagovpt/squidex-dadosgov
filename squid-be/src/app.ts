import 'reflect-metadata';
import express from 'express';
import * as dotenv from 'dotenv';
import http from 'http';
import logger from 'morgan';
import fs from 'fs';
import { createYoga } from 'graphql-yoga';
import { stitchSchemas } from '@graphql-tools/stitch';

import { createProxyMiddleware } from 'http-proxy-middleware';
import routes from './interfaces/routes';
import cors from './lib/plugins/cors';
import errorHandler from '@/middleware/errorHandler';
import { getRemoteSchema } from '@infrastructure/cms/remote-schema';
import { loggingMiddleware } from '@lib/plugins/logger';
import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import { envParser } from '@lib/envParser';

const { CMS_URL } = envParser;

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

// Logger to file
app.use(
  logger('common', {
    stream: fs.createWriteStream('./access.log', { flags: 'a' }),
  }),
);

// Logger to console
app.use(
  logger('dev', {
    skip: (req) => {
      const skipPaths = ['/healthcheck', '/metrics', '/favicon.ico'];
      return skipPaths.some((path) => req.url === path || req.path === path);
    },
  }),
);

// Middleware setup
app.use(cors);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Trust proxy (rate-limiting, secure cookies)
app.set('trust proxy', 1);

// Custom request logger
app.use(loggingMiddleware);

// Routes
app.use('/api', routes);

async function makeGatewayShema() {
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

app.use(
  '/api/assets',
  createProxyMiddleware({
    target: CMS_URL,
    changeOrigin: true,
    secure: false,
    pathRewrite: (path) => `/squidex/api/assets/dados-gov${path}`,
  }),
);

// GraphQL Yoga server

const yoga = createYoga({
  schema: makeGatewayShema(),
  graphqlEndpoint: '/graphql',
  logging: true,
  graphiql:
    process.env.NODE_ENV === 'production'
      ? false
      : {
          endpoint: '/graphql',
        },
  plugins: [
    useDisableIntrospection({
      // Set production env to allow introspection for local development, and disable in prod
      isDisabled: () => process.env.NODE_ENV === 'production',
    }),
  ],
  context: ({ request }) => ({ request }),
});

app.use('/graphql', yoga);

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

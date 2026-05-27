import { z } from 'zod';

const envSchema = z.object({
  //GENERAL
  NODE_ENV: z
    .enum(['production', 'development', 'test'])
    .optional()
    .default('development'),
  PORT: z.coerce.number().optional().default(3333),
  FRONTEND_ORIGIN: z.string().optional().default(''),

  //CMS
  CMS_URL: z.string().min(1, 'CMS_URL is required'),
  API_KEY: z.string().default(''),
  CLIENT_ID: z.string().min(1, 'CLIENT_ID is required'),
  CLIENT_SECRET: z.string().min(1, 'CLIENT_SECRET is required'),
  APP_NAME: z.string().min(1, 'APP_NAME is required'),

  //GATEWAY
  // Maximum allowed GraphQL query nesting depth (DoS guard).
  GRAPHQL_MAX_DEPTH: z.coerce.number().optional().default(12),
  // Interval (ms) to re-introspect the Squidex schema. 0 disables refresh.
  SCHEMA_REFRESH_MS: z.coerce.number().optional().default(300_000),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

/**
 * Parsed environment variables. Use this to access environment variables.
 */
export const envParser = parseEnv();

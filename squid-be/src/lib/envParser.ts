import { z } from 'zod';

// Treat a declared-but-blank env var ('' or whitespace) as "unset" so that
// `.default()` applies, instead of zod coercing '' to 0.
const blankToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

/** Positive integer env var (>= 1) with a default; blank → default. */
const positiveIntEnv = (def: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(def));

/** Non-negative integer env var (>= 0, 0 allowed to disable) with a default. */
const nonNegativeIntEnv = (def: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce.number().int().nonnegative().default(def),
  );

const envSchema = z
  .object({
    //GENERAL
    NODE_ENV: z
      .enum(['production', 'development', 'test'])
      .optional()
      .default('development'),
    PORT: positiveIntEnv(3333),
    FRONTEND_ORIGIN: z.string().optional().default(''),
    // Number of proxy hops to trust for client IP (X-Forwarded-For). Set to the
    // count of reverse proxies in front of the gateway (e.g. F5/WAF + ingress).
    TRUST_PROXY: nonNegativeIntEnv(1),

    //CMS
    CMS_URL: z.string().min(1, 'CMS_URL is required'),
    API_KEY: z.string().default(''),
    CLIENT_ID: z.string().min(1, 'CLIENT_ID is required'),
    CLIENT_SECRET: z.string().min(1, 'CLIENT_SECRET is required'),
    APP_NAME: z.string().min(1, 'APP_NAME is required'),

    //GATEWAY
    // Maximum allowed GraphQL query nesting depth (DoS guard).
    GRAPHQL_MAX_DEPTH: positiveIntEnv(12),
    // Interval (ms) to re-introspect the Squidex schema. 0 disables refresh.
    SCHEMA_REFRESH_MS: nonNegativeIntEnv(300_000),
  })
  // A wide-open or empty CORS allowlist in production silently breaks the
  // frontend, so require at least one origin there.
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' || env.FRONTEND_ORIGIN.trim().length > 0,
    {
      message: 'FRONTEND_ORIGIN is required in production',
      path: ['FRONTEND_ORIGIN'],
    },
  );

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

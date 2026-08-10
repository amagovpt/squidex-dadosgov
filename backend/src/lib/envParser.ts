import { z } from 'zod';

const envSchema = z.object({
  //GENERAL
  NODE_ENV: z
    .enum(['production', 'development'])
    .optional()
    .default('development'),
  PORT: z.coerce.number().optional().default(3333),
  FRONTEND_ORIGIN: z.string(),
  LOG_DIR: z.string().optional().default('./logs'),

  //CMS
  CMS_URL: z.string().default(''),
  API_KEY: z.string().default(''),
  CLIENT_ID: z.string().default(''),
  CLIENT_SECRET: z.string().default(''),
  APP_NAME: z.string().default(''),
  SCHEMA_POLL_INTERVAL_MS: z.coerce.number().optional().default(300_000),
  SCHEMA_FETCH_RETRIES: z.coerce.number().optional().default(5),
  SCHEMA_FETCH_RETRY_DELAY_MS: z.coerce.number().optional().default(1_000),
});

/**
 * Parsed environment variables. Use this to access environment variables.
 */
export const envParser = envSchema.parse(process.env);

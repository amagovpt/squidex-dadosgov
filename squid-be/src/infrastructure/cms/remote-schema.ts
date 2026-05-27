import { buildHTTPExecutor } from '@graphql-tools/executor-http';
import type { ExecutionRequest } from '@graphql-tools/utils';
import { envParser } from '@lib/envParser';
import { schemaFromExecutor } from '@graphql-tools/wrap';

const { CMS_URL, CLIENT_ID, CLIENT_SECRET, APP_NAME } = envParser;

/** Context carried through schema delegation so the executor can read the token. */
export interface GatewayContext {
  token?: string;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseDelayMs = 500 }: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      const delay = baseDelayMs * 2 ** attempt;
      console.warn(`Retry ${attempt + 1}/${retries} in ${delay}ms:`, error);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

function isTokenExpired(cache: TokenCache): boolean {
  const BUFFER_MS = 30_000;
  return Date.now() >= cache.expiresAt - BUFFER_MS;
}

export async function getToken(): Promise<string> {
  if (tokenCache && !isTokenExpired(tokenCache)) {
    return tokenCache.token;
  }

  try {
    return await withRetry(async () => {
      const res = await fetch(
        CMS_URL + '/squidex/identity-server/connect/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: CLIENT_ID || '',
            client_secret: CLIENT_SECRET || '',
            scope: 'squidex-api',
          }),
        },
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const { access_token, expires_in } = await res.json();

      tokenCache = {
        token: access_token,
        expiresAt: Date.now() + expires_in * 1000,
      };

      return tokenCache.token;
    });
  } catch (error) {
    console.error('Error fetching token:', error);
    throw new Error('Failed to fetch token');
  }
}

export async function getRemoteSchema() {
  if (!CMS_URL) {
    throw new Error('CMS_URL environment variable is not defined');
  }

  try {
    // The Authorization header is resolved per-request from the delegation
    // context, so an expired token never gets pinned into the executor.
    const remoteExecutor = buildHTTPExecutor({
      endpoint: CMS_URL + `/squidex/api/content/${APP_NAME}/graphql`,
      headers: (executorRequest?: ExecutionRequest): Record<string, string> => {
        const token = (executorRequest?.context as GatewayContext | undefined)
          ?.token;
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    });

    // Introspection runs at boot with no request context, so feed it a token
    // explicitly via the context argument.
    const introspectionContext: GatewayContext = { token: await getToken() };
    const schema = await withRetry(async () =>
      schemaFromExecutor(remoteExecutor, introspectionContext),
    );

    return { schema, executor: remoteExecutor };
  } catch (error) {
    console.error('Error getting remote schema:', error);
    throw new Error('Failed to get remote schema');
  }
}

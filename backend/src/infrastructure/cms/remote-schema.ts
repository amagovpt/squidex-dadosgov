import { buildHTTPExecutor } from '@graphql-tools/executor-http';
import { envParser } from '@lib/envParser';
import { schemaFromExecutor } from '@graphql-tools/wrap';

const {
  CMS_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  APP_NAME,
  SCHEMA_FETCH_RETRIES,
  SCHEMA_FETCH_RETRY_DELAY_MS,
} = envParser;

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
    const res = await fetch(
      CMS_URL + '/identity-server/connect/token',
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
  } catch (error) {
    console.error('Error fetching token:', error);
    throw new Error('Failed to fetch token');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getRemoteSchema() {
  if (!CMS_URL) {
    throw new Error('CMS_URL environment variable is not defined');
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= SCHEMA_FETCH_RETRIES; attempt++) {
    try {
      const remoteExecutor = buildHTTPExecutor({
        endpoint: CMS_URL + `/api/content/${APP_NAME}/graphql`,
        headers: { Authorization: `Bearer ${await getToken()}` },
      });

      return {
        schema: await schemaFromExecutor(remoteExecutor),
        executor: remoteExecutor,
      };
    } catch (error) {
      lastError = error;
      const isLast = attempt === SCHEMA_FETCH_RETRIES;
      console.error(
        `Error getting remote schema (attempt ${attempt + 1}/${
          SCHEMA_FETCH_RETRIES + 1
        }):`,
        error,
      );
      if (!isLast) {
        await sleep(SCHEMA_FETCH_RETRY_DELAY_MS * 2 ** attempt);
      }
    }
  }

  console.error('Error getting remote schema: all retries exhausted', lastError);
  throw new Error('Failed to get remote schema');
}

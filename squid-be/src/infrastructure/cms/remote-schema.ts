import { buildHTTPExecutor } from '@graphql-tools/executor-http';
import { envParser } from '@lib/envParser';
import { schemaFromExecutor } from '@graphql-tools/wrap';

const { CMS_URL, CLIENT_ID, CLIENT_SECRET, APP_NAME } = envParser;

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
  } catch (error) {
    console.error('Error fetching token:', error);
    throw new Error('Failed to fetch token');
  }
}

export async function getRemoteSchema() {
  try {
    if (!CMS_URL) {
      throw new Error('CMS_URL environment variable is not defined');
    }
    const remoteExecutor = buildHTTPExecutor({
      endpoint: CMS_URL + `/squidex/api/content/${APP_NAME}/graphql`,
      headers: { Authorization: `Bearer ${await getToken()}` },
    });

    return {
      schema: await schemaFromExecutor(remoteExecutor),
      executor: remoteExecutor,
    };
  } catch (error) {
    console.error('Error getting remote schema:', error);
    throw new Error('Failed to get remote schema');
  }
}

/**
 * Authenticated WebSocket URL & Token Refresh Helpers
 * ===================================================
 * Shared modular helper so every authenticated WebSocket hook/component
 * passes a fresh JWT access token and refreshes expired tokens cleanly.
 */

export function getStoredAccessToken(): string | null {
  try {
    return sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string, skewSeconds = 15): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return false;
  }
}

let inflightTokenRefresh: Promise<string | null> | null = null;

export async function getValidAccessToken(): Promise<string | null> {
  const token = getStoredAccessToken();
  if (!token) return null;
  if (!isJwtExpired(token)) return token;

  if (inflightTokenRefresh) {
    return inflightTokenRefresh;
  }

  inflightTokenRefresh = (async () => {
    try {
      const isSessionStorage = Boolean(sessionStorage.getItem('refreshToken'));
      const refreshToken =
        sessionStorage.getItem('refreshToken') || localStorage.getItem('refreshToken');
      if (!refreshToken) return null;

      const res = await fetch('/api/v1/auth/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { access_token?: string; refresh_token?: string };
      if (!data?.access_token) return null;

      if (isSessionStorage) {
        sessionStorage.setItem('accessToken', data.access_token);
        if (data.refresh_token) sessionStorage.setItem('refreshToken', data.refresh_token);
      } else {
        localStorage.setItem('accessToken', data.access_token);
        if (data.refresh_token) localStorage.setItem('refreshToken', data.refresh_token);
      }
      return data.access_token;
    } catch {
      return null;
    } finally {
      inflightTokenRefresh = null;
    }
  })();

  return inflightTokenRefresh;
}

export function appendWsToken(url: string, token: string | null): string {
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export async function buildAuthenticatedWsUrl(
  pathOrUrl: string,
  baseOverride?: string
): Promise<string | null> {
  const token = await getValidAccessToken();
  if (!token) return null;

  if (pathOrUrl.startsWith('ws://') || pathOrUrl.startsWith('wss://')) {
    return appendWsToken(pathOrUrl, token);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = (baseOverride || `${protocol}//${window.location.host}`).replace(/\/+$/, '');
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return appendWsToken(`${base}${normalizedPath}`, token);
}

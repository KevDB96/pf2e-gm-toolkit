// Explicit GM control seam for the separately hosted Player Companion service.
// Endpoint configuration is device-local; credentials and tokens never enter campaign state.
export const PFPC_BASE_URL_KEY = 'pf2e-gm-toolkit/pfpc-base-url';
const TOKEN_KEY = 'pf2e-gm-toolkit/pfpc-session-token';

export function normalizePfpcBaseUrl(value, { production = globalThis.location?.protocol !== 'http:' && globalThis.location?.protocol !== 'file:' } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('PFPC base URL is required');
  let url;
  try { url = new URL(value.trim()); } catch { throw new TypeError('PFPC base URL must be absolute'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(localHttp && !production)) throw new TypeError('PFPC base URL must use HTTPS');
  const authorityAndRest = value.trim().match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)(.*)$/i);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('PFPC base URL cannot contain credentials, path, query, or fragment');
  }
  if (!authorityAndRest || (authorityAndRest[2] !== '' && authorityAndRest[2] !== '/')) {
    throw new TypeError('PFPC base URL cannot contain credentials, path, query, or fragment');
  }
  return url.origin;
}

function statusModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid status');
  if (value.state === 'offline' && Object.keys(value).length === 1) return { state: 'offline' };
  if (value.state !== 'active' || Object.keys(value).sort().join(',') !== 'activeUntil,remainingSeconds,startedAt,state' ||
      typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt)) ||
      typeof value.activeUntil !== 'string' || !Number.isFinite(Date.parse(value.activeUntil)) ||
      !Number.isInteger(value.remainingSeconds) || value.remainingSeconds < 0) throw new TypeError('Invalid status');
  return { state: 'active', startedAt: value.startedAt, activeUntil: value.activeUntil, remainingSeconds: value.remainingSeconds };
}

async function json(response) {
  try { return await response.json(); } catch { return null; }
}

export function createPfpcClient({ fetchImpl = globalThis.fetch, localStore = globalThis.localStorage, sessionStore = globalThis.sessionStorage } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');

  function baseUrl() {
    const value = localStore?.getItem(PFPC_BASE_URL_KEY);
    return value ? normalizePfpcBaseUrl(value) : null;
  }
  function configureBaseUrl(value) {
    const normalized = normalizePfpcBaseUrl(value);
    localStore?.setItem(PFPC_BASE_URL_KEY, normalized);
    return normalized;
  }
  function clearSession() { sessionStore?.removeItem(TOKEN_KEY); }
  function token() { return sessionStore?.getItem(TOKEN_KEY) || null; }
  function unavailable() { return { state: 'unconfigured' }; }

  async function request(path, options = {}) {
    const base = baseUrl();
    if (!base) return { state: 'unconfigured' };
    try {
      return await fetchImpl(`${base}${path}`, options);
    } catch {
      return { state: 'unreachable' };
    }
  }
  async function mappedError(response) {
    if (response.state === 'unreachable' || response.state === 'unconfigured') return response;
    if (response.status === 401) { clearSession(); return { state: 'auth-required' }; }
    if (response.status === 403) return { state: 'admin-required' };
    return { state: 'unreachable' };
  }

  async function getStatus({ retries = 0 } = {}) {
    if (!baseUrl()) return unavailable();
    const attempts = Number.isInteger(retries) ? Math.max(0, Math.min(3, retries)) + 1 : 1;
    let result;
    for (let i = 0; i < attempts; i += 1) {
      const response = await request('/companion/status');
      if (response.state === 'unreachable' || response.state === 'unconfigured') result = response;
      else if (!response.ok) return mappedError(response);
      else {
        try { return statusModel(await response.json()); }
        catch { return { state: 'unreachable' }; }
      }
    }
    return result || { state: 'unreachable' };
  }

  async function login(username, password) {
    if (!baseUrl()) return unavailable();
    if (typeof username !== 'string' || typeof password !== 'string') return { state: 'auth-required' };
    const response = await request('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
    });
    if (response.state) return response;
    if (!response.ok) return mappedError(response);
    const data = await json(response);
    if (typeof data?.accessToken !== 'string' || !data.accessToken) return { state: 'auth-required' };
    sessionStore?.setItem(TOKEN_KEY, data.accessToken);
    return { state: 'authenticated' };
  }

  async function write(path) {
    if (!baseUrl()) return unavailable();
    const accessToken = token();
    if (!accessToken) return { state: 'auth-required' };
    const response = await request(path, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.state) return response;
    if (path.endsWith('/start') && response.status === 409) {
      try {
        const conflict = await response.json();
        if (conflict?.code !== 'lease_active') throw new TypeError('Invalid conflict');
        const { code, ...leasePayload } = conflict;
        return { state: 'active-start-conflict', lease: statusModel(leasePayload) };
      }
      catch { return { state: 'unreachable' }; }
    }
    if (!response.ok) return mappedError(response);
    try { return statusModel(await response.json()); }
    catch { return { state: 'unreachable' }; }
  }

  return Object.freeze({ configureBaseUrl, getBaseUrl: baseUrl, clearSession, getStatus, login,
    start: () => write('/admin/companion/start'), stop: () => write('/admin/companion/stop') });
}

// Explicit GM control seam for the separately hosted Player Companion service.
// Endpoint configuration is device-local; credentials and tokens never enter campaign state.
export const PFPC_BASE_URL_KEY = 'pf2e-gm-toolkit/pfpc-base-url';
const TOKEN_KEY = 'pf2e-gm-toolkit/pfpc-session-token';

/** @typedef {{revision:number,state:{phase:string,storyEra?:string,storyReveal?:string,encounter?:object,exploration?:object}}} PfpcSessionState */
/** @typedef {{revision:number,month:number,characters:readonly {characterId:string,conditions:readonly {id:string,name:string,value?:number}[],exploration:{activityId:string,activityName:string}|null,downtime:{activityId:string,activityName:string,notes?:string}|null}[],advances?:readonly object[]}} PfpcWorkflow */
/** @typedef {{revision:number,map:{party:string|null,flags:object,enemies:readonly object[],factions?:readonly object[]}}} PfpcCampaignMap */

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
    if (value) return normalizePfpcBaseUrl(value);
    if (globalThis.location?.hostname === 'kevdb96.github.io'
      && globalThis.location?.pathname?.startsWith('/pf2e-gm-toolkit/')) {
      return 'https://pf2e-player-companion-production.up.railway.app';
    }
    return null;
  }
  function configureBaseUrl(value) {
    const normalized = normalizePfpcBaseUrl(value);
    if (baseUrl() !== normalized) clearSession();
    localStore?.setItem(PFPC_BASE_URL_KEY, normalized);
    return normalized;
  }
  // Clear tokens saved by old versions; the private device credential is no longer accepted.
  localStore?.removeItem('pf2e-gm-toolkit/pfpc-device-access');
  function clearSession() { sessionStore?.removeItem(TOKEN_KEY); }
  function token() { return sessionStore?.getItem(TOKEN_KEY) || null; }
  function hasSession() { return Boolean(token()); }
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
    if (response.status === 409) {
      const data = await json(response);
      return { state: 'conflict', currentRevision: Number.isInteger(data?.details?.currentRevision) ? data.details.currentRevision : null, current: data?.details?.current ?? null };
    }
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

  async function api(path, method = 'GET', body, { retries = 0 } = {}) {
    if (!baseUrl()) return unavailable();
    const accessToken = token();
    if (!accessToken) return { state: 'auth-required' };
    const attempts = method === 'GET' && Number.isInteger(retries) ? Math.max(0, Math.min(3, retries)) + 1 : 1;
    let last;
    for (let index = 0; index < attempts; index += 1) {
      const options = { method, headers: { Authorization: `Bearer ${accessToken}` } };
      if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      const response = await request(path, options);
      if (response.state) { last = response; continue; }
      if (!response.ok) return mappedError(response);
      try { return { state: 'ok', data: await response.json() }; }
      catch { return { state: 'unreachable' }; }
    }
    return last || { state: 'unreachable' };
  }
  const campaignPath = (campaignId, resource) => `/gm/campaigns/${encodeURIComponent(campaignId)}/${resource}`;
  async function getCampaigns(options) { return api('/gm/campaigns', 'GET', undefined, options); }
  async function getSessionState(campaignId, options) { return api(campaignPath(campaignId, 'session-state'), 'GET', undefined, options); }
  async function setSessionState(campaignId, revision, state) { return api(campaignPath(campaignId, 'session-state'), 'PUT', { revision, state }); }
  async function getWorkflow(campaignId, options) { return api(campaignPath(campaignId, 'workflow'), 'GET', undefined, options); }
  async function mutateWorkflow(campaignId, mutation) { return api(campaignPath(campaignId, 'workflow'), 'POST', mutation); }
  async function getCampaignMap(campaignId, options) { return api(campaignPath(campaignId, 'map'), 'GET', undefined, options); }
  async function setCampaignMap(campaignId, revision, map) { return api(campaignPath(campaignId, 'map'), 'PUT', { revision, map }); }

  return Object.freeze({ configureBaseUrl, getBaseUrl: baseUrl, clearSession, hasSession, getStatus, login,
    getCampaigns, getSessionState, setSessionState, getWorkflow, mutateWorkflow, getCampaignMap, setCampaignMap,
    setCondition: (campaignId, revision, characterId, condition) => mutateWorkflow(campaignId, { revision, action: 'condition-set', characterId, condition }),
    removeCondition: (campaignId, revision, characterId, conditionId) => mutateWorkflow(campaignId, { revision, action: 'condition-remove', characterId, conditionId }),
    setExploration: (campaignId, revision, characterId, activityId) => mutateWorkflow(campaignId, { revision, action: 'exploration-set', characterId, activityId }),
    setDowntime: (campaignId, revision, characterId, choice) => mutateWorkflow(campaignId, { revision, action: 'downtime-set', characterId, choice }),
    advanceMonth: (campaignId, expectedMonth, operationId) => mutateWorkflow(campaignId, { action: 'advance-month', expectedMonth, operationId }),
    start: () => write('/admin/companion/start'), stop: () => write('/admin/companion/stop') });
}

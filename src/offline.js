// Browser-side client for the narrowly scoped offline-data service-worker protocol.
// No persisted state lives here: Cache Storage remains the authority.
const TYPE = 'PF2E_OFFLINE';

function worker() { return navigator.serviceWorker?.controller; }

export async function offlineStatus() {
  if (!('serviceWorker' in navigator)) return { supported: false, categories: [], core: [] };
  await navigator.serviceWorker.ready;
  const target = worker();
  if (!target) return { supported: false, categories: [], core: [] };
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ supported: false, categories: [], core: [] }), 3000);
    channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
    target.postMessage({ type: TYPE, action: 'status' }, [channel.port2]);
  });
}

export async function offlineDownload(files, id) {
  await navigator.serviceWorker.ready;
  const target = worker();
  if (target) target.postMessage({ type: TYPE, action: 'download', files, id });
  return !!target;
}

export function cancelOfflineDownload(id) {
  worker()?.postMessage({ type: TYPE, action: 'cancel', id });
}

export function listenOffline(listener) {
  if (!('serviceWorker' in navigator)) return () => {};
  const receive = event => {
    if (event.data?.type === TYPE) listener(event.data);
  };
  navigator.serviceWorker.addEventListener('message', receive);
  return () => navigator.serviceWorker.removeEventListener('message', receive);
}

export async function storageStatus() {
  if (!navigator.storage) return {};
  try {
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate?.(), navigator.storage.persisted?.()
    ]);
    return { usage: estimate?.usage, quota: estimate?.quota, persisted };
  } catch { return {}; }
}

// Called only from the user-operated control. A denial is ordinary and nonfatal.
export async function requestPersistentStorage() {
  try { return !!(await navigator.storage?.persist?.()); } catch { return false; }
}

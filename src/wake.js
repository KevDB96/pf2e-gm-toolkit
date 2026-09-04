// Screen wake lock: keeps the phone from dimming and locking while a screen a GM leaves
// open mid-fight — Combat, BGM — is showing. Everything here is defensive on purpose:
// `navigator.wakeLock` does not exist on older iOS or on any non-secure context, a
// request can reject even where the API exists (another app holding the lock, a battery
// saver mode, low power state), and — the one the caller cannot forget — the browser
// releases the lock on its own the instant the page is hidden, whether that is a phone's
// own screen lock or the GM switching apps to check a rule. So the lock has to be
// re-acquired on `visibilitychange` if it is still wanted when the page comes back, and
// every one of these is a normal outcome rather than an error: a missing API or a
// rejected request means the phone dims a bit sooner, not that anything broke, so nothing
// here ever throws into a caller or logs noise for an unsupported browser.
//
// `acquire()` is async, and `lock` is only assigned after the request resolves — so
// checking just `lock` at the top guards nothing while a request is in flight: two calls
// close together (a double-tap on the Combat tab re-renders and calls `keepAwake(true)`
// twice) both see `lock === null`, both await a request, and the second overwrites the
// first with nothing left referencing it to ever release. `acquiring` closes that window
// by making the in-flight request itself visible to a concurrent caller. That in turn
// opens the opposite gap — `keepAwake(false)` can arrive while a request from an earlier
// `keepAwake(true)` is still pending, so `release()` runs against a `lock` that is still
// null and does nothing, and the request then resolves into a lock nobody asked for
// anymore. `acquire()` re-checks `wanted` after the await for exactly that case and
// releases the just-resolved lock instead of storing it — otherwise it is the same leak
// this guard exists to prevent, just arriving from the other direction.

let lock = null;
let wanted = false;
let acquiring = false;

async function acquire() {
  if (lock || acquiring || !wanted) return;
  if (document.visibilityState !== 'visible') return;
  acquiring = true;
  let acquired;
  try {
    acquired = await navigator.wakeLock?.request?.('screen');
  } catch {
    acquired = null;
  } finally {
    acquiring = false;
  }
  if (!wanted) {
    // Lost the race: something already called keepAwake(false) while this request was
    // in flight. There is no second `lock` slot to stash this in — release it straight
    // away rather than leave it held with nothing referencing it.
    try {
      await acquired?.release?.();
    } catch {
      /* already gone */
    }
    return;
  }
  lock = acquired;
  if (lock) {
    lock.addEventListener('release', () => { lock = null; });
  }
}

async function release() {
  const held = lock;
  lock = null;
  try {
    await held?.release?.();
  } catch {
    /* already gone */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire();
  // Hidden: the browser has already released or is about to — nothing to do here but
  // let acquire() re-request next time the page is visible and still wanted.
});

/**
 * Ask for the lock (`wanted: true`) or give it up (`wanted: false`). Safe to call on
 * every render — requesting while a lock is already held is a no-op, not a second lock.
 */
export function keepAwake(next) {
  wanted = Boolean(next);
  if (wanted) acquire();
  else release();
}

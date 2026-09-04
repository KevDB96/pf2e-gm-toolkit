// Tests for the wake lock's acquire race: node --test tests/
//
// wake.js reads `document` and `navigator` at import time and registers a
// visibilitychange listener as a side effect of the import itself, so the stubs below
// must be installed on globalThis BEFORE that import runs. A static `import` is hoisted
// above any setup code and would see the real (missing) globals instead, so the module
// is loaded with a dynamic `import()` after the stubs are in place.
//
// wake.js keeps lock/wanted/acquiring at module scope and can only be imported once per
// process, so the five cases below share that one import and MUST run in the order
// they are written — each one restores the module to rest (wanted false, lock null,
// nothing in flight) before the next begins. They are not independent tests that happen
// to share a file; treat the whole file as one sequential scenario.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- document stub ---------------------------------------------------------------
// Only visibilityState and the one listener wake.js registers are needed. The handler
// is captured so a test can fire a visibilitychange without a real DOM.
let visibilityHandler = null;
globalThis.document = {
  visibilityState: 'visible',
  addEventListener(type, cb) {
    if (type === 'visibilitychange') visibilityHandler = cb;
  }
};

// --- navigator.wakeLock stub -------------------------------------------------------
// request() hands back a promise the test controls directly (via the captured
// `resolve`), so a case can hold an acquire in flight across several keepAwake() calls
// and settle it whenever the case needs that. requestCalls.length is the call count;
// releaseCalls counts every lock's release() across the whole stub.
let requestCalls = [];
let releaseCalls = 0;

function request() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  requestCalls.push(resolve);
  return promise;
}

// A fake WakeLockSentinel: release() is the thing under test, and the real API fires a
// 'release' event on the sentinel itself whenever it is released, which is what lets
// wake.js's own `lock = null` listener run.
function makeLock() {
  const lock = { released: false, listeners: [] };
  lock.addEventListener = (type, cb) => {
    if (type === 'release') lock.listeners.push(cb);
  };
  lock.release = async () => {
    releaseCalls += 1;
    if (!lock.released) {
      lock.released = true;
      lock.listeners.forEach((cb) => cb());
    }
  };
  return lock;
}

function resetStub() {
  requestCalls = [];
  releaseCalls = 0;
}

// navigator is a getter-only global in Node (it exists even without a DOM), so a plain
// `globalThis.navigator = ...` throws TypeError: Cannot set property navigator of
// #<Object>. defineProperty replaces it outright.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: { wakeLock: { request } }
});

const { keepAwake } = await import('../src/wake.js');

// Drains every pending microtask (an already-settled promise's whole .then chain,
// including the nested await inside acquire()'s post-await release) before a test
// makes assertions. A macrotask boundary guarantees this regardless of how many hops
// the chain happens to need, which a fixed count of `await Promise.resolve()` does not.
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('two keepAwake(true) calls with the first request still pending issue one request, not two', async () => {
  resetStub();
  keepAwake(true);
  keepAwake(true);
  await flush();
  assert.equal(requestCalls.length, 1);

  // Restore rest before the next case: let the request resolve and give the lock back.
  const lock = makeLock();
  requestCalls[0](lock);
  await flush();
  keepAwake(false);
  await flush();
  assert.equal(releaseCalls, 1);
});

test('keepAwake(false) before the request resolves ends with no lock held, and the resolved lock is released', async () => {
  resetStub();
  keepAwake(true);
  keepAwake(false);
  await flush();
  // This is the case a naive `if (lock) release()` guard gets wrong: at this point the
  // request is still in flight, lock is still null, so a release call right now would
  // find nothing to release.
  assert.equal(releaseCalls, 0);

  // Now let the request resolve into a caller who no longer wants it. acquire()'s
  // post-await `wanted` re-check must catch this and release it rather than store it.
  const lock = makeLock();
  requestCalls[0](lock);
  await flush();
  assert.equal(releaseCalls, 1);
  assert.equal(lock.released, true);

  // Already at rest: wanted is false and nothing is held or in flight.
});

test('a visibilitychange to visible while a request is in flight does not issue a second request', async () => {
  resetStub();
  keepAwake(true);
  await flush();
  assert.equal(requestCalls.length, 1);

  // document.visibilityState is already 'visible' in this stub, matching the real case:
  // the page was never hidden, but some other visibilitychange still fired.
  visibilityHandler();
  await flush();
  assert.equal(requestCalls.length, 1);

  // Restore rest before the next case.
  const lock = makeLock();
  requestCalls[0](lock);
  await flush();
  keepAwake(false);
  await flush();
  assert.equal(releaseCalls, 1);
});

test('a normal acquire followed by keepAwake(false) releases the lock', async () => {
  resetStub();
  keepAwake(true);
  await flush();
  const lock = makeLock();
  requestCalls[0](lock);
  await flush();

  keepAwake(false);
  await flush();
  assert.equal(releaseCalls, 1);
  assert.equal(lock.released, true);
});

test('with navigator.wakeLock absent, keepAwake(true) and keepAwake(false) neither throw nor reject', async () => {
  resetStub();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {} // no wakeLock property at all, as on older iOS or a non-secure context
  });

  assert.doesNotThrow(() => keepAwake(true));
  await flush();
  assert.doesNotThrow(() => keepAwake(false));
  await flush();
  // Nothing to assert about requestCalls here — navigator.wakeLock?.request?.(...)
  // short-circuits to undefined, and that undefined is what must not throw or reject.
});

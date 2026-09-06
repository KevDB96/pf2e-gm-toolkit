import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class FakeClassList {
  toggle() {}
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.children = [];
    this.parentNode = null;
    this.inert = false;
    this.hidden = false;
  }

  set innerHTML(value) {
    this.children = [new FakeElement('div')];
    this.children[0].className = 'sheet';
    this.children[0].children = [new FakeElement('button')];
    this.children[0].children[0].dataset = { close: '' };
    this.children.forEach(child => { child.parentNode = this; });
  }

  querySelector(selector) {
    if (selector === '.sheet') return this.children[0];
    if (selector === '[data-close]') return this.children[0]?.children[0];
    return null;
  }

  querySelectorAll() { return []; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  dispatchEvent(event) { this.listeners.get(event.type)?.(event); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.isConnected = false; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) {
    return selector === '[data-close]' && this.dataset?.close !== undefined ? this : null;
  }
  toggleAttribute() {}
  focus() { globalThis.document.activeElement = this; }
  getClientRects() { return [{ width: 1 }]; }
}

const documentFixture = {
  activeElement: new FakeElement('button'),
  documentElement: new FakeElement('html'),
  body: new FakeElement('body'),
  createElement: tag => new FakeElement(tag),
  querySelector: () => null,
  querySelectorAll: () => []
};
const listeners = new Map();
const windowFixture = {
  addEventListener(type, fn) { listeners.set(type, fn); },
  dispatchEvent(event) { listeners.get(event.type)?.(event); }
};
const historyFixture = {
  entries: [],
  index: 0,
  pending: [],
  get state() { return this.entries[this.index].state; },
  pushState(state, unused, url = location.href) {
    this.entries.splice(this.index + 1);
    this.entries.push({ state, url });
    this.index++;
    locationFixture.href = url;
  },
  back() { this.go(-1); },
  go(delta) { this.pending.push(delta); },
  flush() {
    while (this.pending.length) {
      const next = this.index + this.pending.shift();
      if (next < 0 || next >= this.entries.length) continue;
      this.index = next;
      locationFixture.href = this.entries[next].url;
      windowFixture.dispatchEvent({ type: 'popstate', state: this.state });
    }
  }
};
const locationFixture = { href: 'https://example.test/#/home', hash: '#/home' };

globalThis.document = documentFixture;
globalThis.window = windowFixture;
globalThis.history = historyFixture;
globalThis.location = locationFixture;
globalThis.requestAnimationFrame = fn => fn();

const { sheet, closeSheets, hasHorizontalOverflow } = await import('../src/dom.js?sheet-test');

beforeEach(() => {
  historyFixture.entries = [
    { state: { route: 'previous' }, url: 'https://example.test/#/previous' },
    { state: { route: 'home' }, url: 'https://example.test/#/home' }
  ];
  historyFixture.index = 1;
  historyFixture.pending = [];
  locationFixture.href = historyFixture.entries[1].url;
  documentFixture.body.children = [];
  documentFixture.activeElement = new FakeElement('button');
});

function goBack() {
  historyFixture.back();
  historyFixture.flush();
}

test('top sheet closes on popstate without changing the route', () => {
  const opened = sheet('One', '<p>one</p>');
  const route = location.href;
  assert.equal(documentFixture.body.children.length, 1);
  goBack();
  assert.equal(documentFixture.body.children.length, 0);
  assert.equal(location.href, route);
  assert.equal(opened.node.isConnected, false);
});

test('nested sheets unwind one layer at a time', () => {
  sheet('One', '<p>one</p>');
  sheet('Two', '<p>two</p>');
  goBack();
  assert.equal(documentFixture.body.children.length, 1);
  goBack();
  assert.equal(documentFixture.body.children.length, 0);
});

test('X close restores the current route state without navigating', () => {
  const opened = sheet('One', '<p>one</p>');
  const route = location.href;
  const closeButton = opened.node.querySelector('[data-close]');
  opened.node.dispatchEvent({ type: 'click', target: closeButton });
  assert.equal(documentFixture.body.children.length, 0);
  historyFixture.flush();
  assert.deepEqual(historyFixture.state, { route: 'home' });
  assert.equal(location.href, route);
  assert.equal(historyFixture.index, 1);
});

test('repeated dismissals do not add Back presses before leaving the route', async () => {
  for (let i = 0; i < 5; i++) {
    const opened = sheet('One', '');
    const settled = opened.close();
    historyFixture.flush();
    await settled;
    assert.equal(historyFixture.index, 1);
  }
  goBack();
  assert.equal(historyFixture.state.route, 'previous');
});

test('Escape and backdrop dismissal each consume one history entry', () => {
  const escape = sheet('Escape', '');
  escape.node.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  historyFixture.flush();
  assert.equal(historyFixture.index, 1);
  const backdrop = sheet('Backdrop', '');
  backdrop.node.dispatchEvent({ type: 'click', target: backdrop.node });
  historyFixture.flush();
  assert.equal(historyFixture.index, 1);
  assert.equal(documentFixture.body.children.length, 0);
});

test('dismissing a nested sheet does not close its parent on the queued popstate', () => {
  const parent = sheet('Parent', '');
  sheet('Child', '').close();
  historyFixture.flush();
  assert.deepEqual(documentFixture.body.children, [parent.node]);
  assert.equal(historyFixture.index, 2);
  goBack();
  assert.equal(documentFixture.body.children.length, 0);
  assert.equal(historyFixture.index, 1);
});

test('replacement sheet waits for pending dismissal before pushing history', () => {
  sheet('Old', '').close();
  const replacement = sheet('Replacement', '');
  historyFixture.flush();
  assert.deepEqual(documentFixture.body.children, [replacement.node]);
  assert.equal(historyFixture.index, 2);
  goBack();
  assert.equal(documentFixture.body.children.length, 0);
  assert.equal(historyFixture.index, 1);
});

test('closing every sheet consumes all nested entries', async () => {
  sheet('Parent', '');
  sheet('Child', '');
  const settled = closeSheets();
  assert.equal(documentFixture.body.children.length, 0);
  historyFixture.flush();
  await settled;
  assert.equal(historyFixture.index, 1);
  goBack();
  assert.equal(historyFixture.state.route, 'previous');
});

test('closing a covered parent also removes its entry after its child closes', () => {
  const parent = sheet('Parent', '');
  const child = sheet('Child', '');
  parent.close();
  assert.deepEqual(documentFixture.body.children, [child.node]);
  child.close();
  historyFixture.flush();
  assert.equal(historyFixture.index, 1);
});

test('awaiting close allows route navigation after the queued traversal', async () => {
  const opened = sheet('Record', '');
  const navigate = async () => {
    await opened.close();
    historyFixture.pushState({ route: 'encounters' }, '', 'https://example.test/#/encounters');
  };
  const done = navigate();
  assert.equal(historyFixture.state.route, 'home');
  historyFixture.flush();
  await done;
  assert.equal(historyFixture.state.route, 'encounters');
  goBack();
  assert.equal(historyFixture.index, 1);
});

test('viewport helper reports only real overflow', () => {
  assert.equal(hasHorizontalOverflow({ scrollWidth: 412, clientWidth: 412 }), false);
  assert.equal(hasHorizontalOverflow({ scrollWidth: 413, clientWidth: 412 }), true);
});

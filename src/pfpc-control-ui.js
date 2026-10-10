import { createPfpcClient } from './pfpc-control.js';

export function pfpcControlView(model, now = Date.now()) {
  return model.state === 'active' && Date.parse(model.activeUntil) <= now ? { state: 'offline' } : model;
}

export function pfpcControlMarkup(rawModel, now = Date.now()) {
  const model = pfpcControlView(rawModel, now);
  const retry = '<button class="ghost" type="button" data-pfpc-retry>Retry</button>';
  if (model.state === 'active' && Date.parse(model.activeUntil) > now) {
    const seconds = Math.ceil((Date.parse(model.activeUntil) - now) / 1000);
    const duration = `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    const end = new Date(model.activeUntil);
    return `<span class="pfpc-state active">Player Companion: ACTIVE</span><span class="pfpc-time"><span data-pfpc-countdown>${duration}</span> · ends <time datetime="${end.toISOString()}">${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></span><button class="danger" type="button" data-pfpc-stop>Stop Now</button><button class="ghost" type="button" data-pfpc-logout>Sign out</button>`;
  }
  if (model.state === 'offline' || model.state === 'active') return '<span class="pfpc-state">Player Companion: OFFLINE</span><button class="primary" type="button" data-pfpc-start>Start Player Companion</button>';
  if (model.state === 'unconfigured') return `<span class="pfpc-state">Player Companion: Set service URL</span><form data-pfpc-config class="pfpc-config"><input name="url" type="url" placeholder="https://player-companion.example" aria-label="Player Companion URL" required><button type="submit">Save</button></form>`;
  if (model.state === 'auth-required') return `<span class="pfpc-state">GM sign-in</span><form data-pfpc-login class="pfpc-config"><input name="username" type="text" placeholder="GM username" aria-label="GM username" autocomplete="username" required><input name="password" type="password" placeholder="Password" aria-label="GM password" autocomplete="current-password" required><button class="primary" type="submit">Sign in</button></form>${model.invalid ? '<span class="pfpc-login-error" role="alert">Invalid GM credentials.</span>' : ''}`;
  if (model.state === 'admin-required') return '<span class="pfpc-state">Player Companion: Admin access required</span><button class="ghost" type="button" data-pfpc-logout>Sign out</button>';
  return `<span class="pfpc-state unavailable">Player Companion unavailable</span>${retry}`;
}

export function bindPfpcControl(root, { client = createPfpcClient(), now = Date.now, tickMs = 1000 } = {}) {
  let model = { state: 'unconfigured' };
  let busy = false;
  const draw = () => {
    const display = (model.state === 'offline' || model.state === 'active') && !client.hasSession()
      ? { state: 'auth-required' } : model;
    root.innerHTML = pfpcControlMarkup(display, now());
  };
  const readStatus = async () => {
    if (busy) return;
    busy = true;
    try { model = await client.getStatus(); } finally { busy = false; draw(); }
  };
  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.matches('[data-pfpc-retry]')) { await readStatus(); return; }
    if (button.matches('[data-pfpc-logout]')) { client.clearSession(); model = { state: 'auth-required' }; draw(); return; }
    if (button.matches('[data-pfpc-start]')) {
      busy = true;
      try {
        model = await client.start();
        if (model.state === 'active-start-conflict') model = model.lease;
      } finally { busy = false; draw(); }
      return;
    }
    if (button.matches('[data-pfpc-stop]')) {
      busy = true;
      try { model = await client.stop(); } finally { busy = false; draw(); }
    }
  });
  root.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('form')) return;
    event.preventDefault();
    if (busy) return;
    if (form.matches('[data-pfpc-login]')) {
      const data = new FormData(form);
      busy = true;
      let result;
      try { result = await client.login(data.get('username'), data.get('password')); }
      finally { busy = false; }
      if (result.state === 'authenticated') { await readStatus(); return; }
      model = result.state === 'unreachable' ? result : { state: 'auth-required', invalid: result.state === 'auth-required' };
      draw();
      return;
    }
    if (form.matches('[data-pfpc-config]')) {
      try { client.configureBaseUrl(new FormData(form).get('url')); await readStatus(); }
      catch { model = { state: 'unreachable' }; draw(); }
    }
  });
  draw();
  void readStatus();
  const timer = setInterval(() => {
    if (model.state === 'active' && Date.parse(model.activeUntil) <= now()) model = { state: 'offline' };
    if (model.state === 'active' || model.state === 'offline') draw();
  }, tickMs);
  return () => clearInterval(timer);
}

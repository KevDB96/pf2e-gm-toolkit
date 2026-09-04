// BGM: keep named YouTube links and hand playback to the YouTube app.

import { state, save, uid } from '../store.js';
import { esc, on, qs } from '../dom.js';
import { soundtrack } from '../data.js';
import { youtubeExternalUrl } from '../youtube.js';

export function mount(root) {
  root.innerHTML = `
    <section class="card sound-card">
      <h2>YouTube BGM</h2>
      <form class="sound-form" id="sound-form">
        <label for="sound-url">Video or playlist link</label>
        <input id="sound-url" type="text" inputmode="url"
          autocomplete="url" placeholder="https://youtu.be/…"
          value="${esc(state.sound.url)}">
        <label for="sound-name">Name for saving</label>
        <input id="sound-name" type="text" maxlength="80"
          placeholder="Tavern ambience">
        <div class="sound-actions">
          <button class="primary" type="button" data-save-sound>Save track</button>
        </div>
      </form>
      <p class="sound-help">Saved tracks open in the YouTube app when available.</p>
      <p class="form-error" id="sound-error" role="alert" hidden></p>
    </section>
    <section class="card sound-library">
      <h2>Saved tracks</h2>
      <div id="sound-builtin"><p class="empty">Loading tracks&hellip;</p></div>
      <div id="sound-saved"></div>
    </section>`;

  on(root, 'click', '[data-save-sound]', () => {
    const input = qs('#sound-url', root);
    const name = qs('#sound-name', root).value.trim();
    const url = youtubeExternalUrl(input.value);
    if (!url || !name) {
      showError(root, !url
        ? 'Paste a valid YouTube video or playlist link.'
        : 'Give the saved track a name.');
      return;
    }

    const existing = state.sound.saved.find(item => item.url === url);
    if (existing) existing.name = name;
    else state.sound.saved.push({ id: uid('sound'), name, url });
    state.sound.url = input.value.trim();
    save();
    qs('#sound-name', root).value = '';
    qs('#sound-error', root).hidden = true;
    renderSaved(root);
  });

  on(root, 'click', '[data-delete-sound]', (event, el) => {
    state.sound.saved = state.sound.saved.filter(item => item.id !== el.dataset.deleteSound);
    save();
    renderSaved(root);
  });

  renderSaved(root);
  soundtrack()
    .then(tracks => renderBuiltIns(root, tracks))
    .catch(() => renderBuiltIns(root, []));
}

function showError(root, message) {
  const error = qs('#sound-error', root);
  error.textContent = message;
  error.hidden = false;
}

function renderSaved(root) {
  const host = qs('#sound-saved', root);
  if (!state.sound.saved.length) {
    host.innerHTML = '<p class="empty">No other saved tracks.</p>';
    return;
  }
  host.innerHTML = state.sound.saved.map(item => `
    <div class="sound-saved-item">
      <strong>${esc(item.name)}</strong>
      <div class="sound-saved-actions">
        <a class="button-link primary" href="${esc(item.url)}" target="_blank"
          rel="noopener">Open in YouTube</a>
        <button class="icon danger" type="button" data-delete-sound="${esc(item.id)}"
          aria-label="Delete ${esc(item.name)}">✕</button>
      </div>
    </div>`).join('');
}

function renderBuiltIns(root, tracks) {
  const host = qs('#sound-builtin', root);
  const rows = tracks.map(track => {
    const url = youtubeExternalUrl(track.url);
    if (!url) return '';
    return `<div class="sound-saved-item">
      <strong class="grow">${esc(track.label)}</strong>
      <a class="button-link primary" href="${esc(url)}" target="_blank"
        rel="noopener">Open in YouTube</a>
    </div>`;
  }).join('');
  host.innerHTML = rows || '<p class="empty">No built-in tracks found.</p>';
}

export function update() {
  // Saved tracks are rendered by their own mutations and the initial data load.
}

// Sound: play a YouTube video from a pasted link using YouTube's supported embed.

import { state, save, uid } from '../store.js';
import { esc, on, qs } from '../dom.js';
import { youtubeExternalUrl, youtubeSource } from '../youtube.js';

export function mount(root) {
  root.innerHTML = `
    <section class="card sound-card">
      <h2>YouTube sound</h2>
      <form class="sound-form" id="sound-form">
        <label for="sound-url">Video or playlist link</label>
        <input id="sound-url" type="text" inputmode="url"
          autocomplete="url" placeholder="https://youtu.be/…"
          value="${esc(state.sound.url)}">
        <label for="sound-name">Name for saving</label>
        <input id="sound-name" type="text" maxlength="80"
          placeholder="Tavern ambience">
        <div class="sound-actions">
          <button class="primary" type="submit">Play here</button>
          <button type="button" data-save-sound>Save link</button>
        </div>
      </form>
      <p class="sound-help">Playback needs an internet connection and starts after you tap the button. Keep this tab open while it plays.</p>
      <p class="form-error" id="sound-error" role="alert" hidden></p>
    </section>
    <section class="card sound-library">
      <h2>Saved sounds</h2>
      <div id="sound-saved"></div>
    </section>
    <section class="sound-player" id="sound-player"></section>`;

  on(root, 'submit', '#sound-form', (event) => {
    event.preventDefault();
    const input = qs('#sound-url', root);
    const source = youtubeSource(input.value);
    const error = qs('#sound-error', root);
    if (!source) {
      error.textContent = 'Paste a valid YouTube video or playlist link.';
      error.hidden = false;
      return;
    }

    error.hidden = true;
    state.sound.url = input.value.trim();
    save();
    showPlayer(root, source);
  });

  on(root, 'click', '[data-save-sound]', () => {
    const input = qs('#sound-url', root);
    const name = qs('#sound-name', root).value.trim();
    const url = youtubeExternalUrl(input.value);
    if (!url || !name) {
      showError(root, !url
        ? 'Paste a valid YouTube video or playlist link.'
        : 'Give the saved sound a name.');
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

  on(root, 'click', '[data-play-sound]', (event, el) => {
    const item = state.sound.saved.find(saved => saved.id === el.dataset.playSound);
    const source = youtubeSource(item?.url);
    if (!item || !source) return;
    qs('#sound-url', root).value = item.url;
    state.sound.url = item.url;
    save();
    showPlayer(root, source);
  });

  on(root, 'click', '[data-delete-sound]', (event, el) => {
    state.sound.saved = state.sound.saved.filter(item => item.id !== el.dataset.deleteSound);
    save();
    renderSaved(root);
  });

  renderSaved(root);
}

function showError(root, message) {
  const error = qs('#sound-error', root);
  error.textContent = message;
  error.hidden = false;
}

function renderSaved(root) {
  const host = qs('#sound-saved', root);
  if (!state.sound.saved.length) {
    host.innerHTML = '<p class="empty">No saved sounds yet.</p>';
    return;
  }
  host.innerHTML = state.sound.saved.map(item => `
    <div class="sound-saved-item">
      <strong>${esc(item.name)}</strong>
      <div class="sound-saved-actions">
        <button type="button" data-play-sound="${esc(item.id)}">Play here</button>
        <a class="button-link primary" href="${esc(item.url)}" target="_blank"
          rel="noopener">Open in YouTube</a>
        <button class="icon danger" type="button" data-delete-sound="${esc(item.id)}"
          aria-label="Delete ${esc(item.name)}">✕</button>
      </div>
    </div>`).join('');
}

function showPlayer(root, source) {
  const host = qs('#sound-player', root);
  host.innerHTML = `
    <iframe
      src="${esc(source)}"
      title="YouTube sound player"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowfullscreen></iframe>`;
}

export function update() {
  // The iframe must not be rebuilt while it is playing.
}

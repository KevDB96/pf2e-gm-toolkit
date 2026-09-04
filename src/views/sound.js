// Sound: play a YouTube video from a pasted link using YouTube's supported embed.

import { state, save } from '../store.js';
import { esc, on, qs } from '../dom.js';
import { youtubeSource } from '../youtube.js';

export function mount(root) {
  root.innerHTML = `
    <section class="card sound-card">
      <h2>YouTube sound</h2>
      <form class="sound-form" id="sound-form">
        <label for="sound-url">Video or playlist link</label>
        <input id="sound-url" type="text" inputmode="url"
          autocomplete="url" placeholder="https://youtu.be/…"
          value="${esc(state.sound.url)}">
        <button class="primary" type="submit">Load and play</button>
      </form>
      <p class="sound-help">Playback needs an internet connection and starts after you tap the button. Keep this tab open while it plays.</p>
      <p class="form-error" id="sound-error" role="alert" hidden></p>
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

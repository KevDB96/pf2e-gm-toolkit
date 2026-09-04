// BGM: keep named YouTube links and hand playback to the YouTube app.
//
// The screen is two halves. Up top are three dice for the controls a GM actually
// reaches for mid-session: Combat, Boss, and Victory. Underneath, collapsed, are
// folders holding every track — including Situational and Ambience, which are picked
// by hand rather than rolled — for the times you want a particular one. The built-in
// set is ~160 links and listing them flat filled the screen several times over.
//
// A pool's die and a hand-picked list are different tools. Combat and Boss hold single
// videos of at least half an hour, so one roll covers a whole fight; Victory holds
// fanfares measured in seconds. Situational is never rolled — when a character dies the
// moment has already chosen the music.

import { state, save, uid } from '../store.js';
import { esc, on, qs } from '../dom.js';
import { soundtrack } from '../data.js';
import { youtubeExternalUrl } from '../youtube.js';

// View state: which folders are open, the next pick for each pool, and the pick each
// pool last handed out. None of it belongs in localStorage — it is where the screen is,
// not what the GM owns. `handed` is separate from `rolled` because opening a folder
// re-renders the head, and the line naming what is playing has to survive that.
const open = new Set();
const rolled = new Map();
const handed = new Map();

let groups = [];

const find = key => groups.find(g => g.key === key);
const playable = group => (group?.tracks || [])
  .map(t => ({ ...t, href: youtubeExternalUrl(t.url) }))
  .filter(t => t.href);

export function mount(root) {
  root.innerHTML = `
    <section class="card sound-card">
      <h2>YouTube BGM</h2>
      <div id="bgm-play"><p class="empty">Loading tracks&hellip;</p></div>
    </section>
    <section class="card sound-library">
      <h2>All tracks</h2>
      <div id="bgm-folders"></div>
    </section>
    <section class="card sound-card">
      <h2>Save a link</h2>
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
      <p class="form-error" id="sound-error" role="alert" hidden></p>
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
    open.add('device');
    render(root);
  });

  on(root, 'click', '[data-delete-sound]', (event, el) => {
    state.sound.saved = state.sound.saved.filter(item => item.id !== el.dataset.deleteSound);
    save();
    render(root);
  });

  on(root, 'click', '[data-folder]', (event, el) => {
    const key = el.dataset.folder;
    if (open.has(key)) open.delete(key); else open.add(key);
    render(root);
  });

  // A die is a real link whose target is already chosen, so the tap that rolls it is
  // the tap that opens YouTube. It was a button calling window.open() first, which a
  // phone blocks as a popup — the one device that matters was the one where nothing
  // happened. Re-rolling waits for the navigation to be handed off.
  on(root, 'click', '[data-roll]', (event, el) => {
    const key = el.dataset.roll;
    const track = rolled.get(key);
    if (track) {
      handed.set(key, track);
      const note = qs(`[data-rolled="${key}"]`, root);
      if (note) note.textContent = rollNote(track);
    }
    setTimeout(() => {
      reroll(key);
      const next = rolled.get(key);
      if (next?.href) el.href = next.href;
    }, 0);
  });

  render(root);
  soundtrack()
    .then(loaded => { groups = loaded; })
    .catch(() => { groups = []; })
    .then(() => {
      groups.forEach(group => reroll(group.key));
      render(root);
    });
}

function showError(root, message) {
  const error = qs('#sound-error', root);
  error.textContent = message;
  error.hidden = false;
}

/** How long a track runs, in the unit that tells you something about it. */
function length(track) {
  if (track.mins) return `${track.mins} min`;
  if (track.secs) return track.secs >= 60
    ? `${Math.floor(track.secs / 60)}:${String(track.secs % 60).padStart(2, '0')}`
    : `${track.secs}s`;
  return '';
}

/** What a die last opened, named the way a track row names itself. */
function rollNote(track) {
  const meta = [track.by, length(track)].filter(Boolean).join(' · ');
  return meta ? `${track.label} · ${meta}` : track.label;
}

/** Pick a fresh track for a pool, never the one it just handed out. */
function reroll(key) {
  const tracks = playable(find(key));
  if (!tracks.length) return;
  const last = rolled.get(key);
  let pick = tracks[Math.floor(Math.random() * tracks.length)];
  if (tracks.length > 1) {
    while (pick.url === last?.url) pick = tracks[Math.floor(Math.random() * tracks.length)];
  }
  rolled.set(key, pick);
}

function render(root) {
  qs('#bgm-play', root).innerHTML = controls();
  qs('#bgm-folders', root).innerHTML = folders();
}

// --- the controls, in reach ---------------------------------------------------

/** The three dice: Combat, Boss, Victory. */
function controls() {
  const top = groups.filter(g => g.random && playable(g).length);
  if (!top.length) return '<p class="empty">No tracks found.</p>';

  return top.map(die).join('');
}

/** One roll-and-open control. */
function die(group) {
  const pick = rolled.get(group.key);
  if (!pick?.href) return '';
  return `
    <a class="bgm-die" data-roll="${esc(group.key)}" href="${esc(pick.href)}"
      target="_blank" rel="noopener"
      aria-label="Open a random ${esc(group.label)} track in YouTube">
      <span class="dice">&#127922;</span>
      <span class="grow">
        <span class="name">${esc(group.label)}</span>
        <span class="bgm-last" data-rolled="${esc(group.key)}">${
          handed.has(group.key) ? esc(rollNote(handed.get(group.key))) : ''}</span>
      </span>
    </a>`;
}

// --- every track, folded away -------------------------------------------------

function folders() {
  const html = [...groups.map(folder), deviceFolder()].filter(Boolean).join('');
  return html || '<p class="empty">No tracks found.</p>';
}

function folder(group) {
  const tracks = playable(group);
  if (!tracks.length) return '';
  const key = group.key;
  const isOpen = open.has(key);
  return `
    <div class="bgm-folder">
      <button class="bgm-open" type="button" data-folder="${esc(key)}" aria-expanded="${isOpen}">
        <span class="grow">
          <span class="name">${esc(group.label)}</span>
          <span class="sub">${tracks.length} tracks</span>
        </span>
        <span class="chev">${isOpen ? '&minus;' : '+'}</span>
      </button>
      ${isOpen ? `<div class="bgm-body">${tracks.map(row).join('')}</div>` : ''}
    </div>`;
}

/** One track. The whole row is the link, so the play glyph can stay small. */
function row(track) {
  const meta = [track.by, length(track)].filter(Boolean).join(' &middot; ');
  return `
    <a class="bgm-row" href="${esc(track.href)}" target="_blank" rel="noopener">
      <span class="grow">
        <span class="name">${esc(track.label)}</span>
        ${meta ? `<span class="sub">${meta}</span>` : ''}
      </span>
      <span class="bgm-go">&#9654;</span>
    </a>`;
}

/** The links saved on this device, in a folder of their own so they are never lost
 *  among the built-ins. Each row needs a delete button, so it is not a bare anchor. */
function deviceFolder() {
  const saved = state.sound.saved
    .map(item => ({ ...item, href: youtubeExternalUrl(item.url) }))
    .filter(item => item.href);
  if (!saved.length) return '';

  const isOpen = open.has('device');
  return `
    <div class="bgm-folder">
      <button class="bgm-open" type="button" data-folder="device" aria-expanded="${isOpen}">
        <span class="grow">
          <span class="name">On this device</span>
          <span class="sub">${saved.length} track${saved.length === 1 ? '' : 's'} saved here</span>
        </span>
        <span class="chev">${isOpen ? '&minus;' : '+'}</span>
      </button>
      ${isOpen ? `<div class="bgm-body">${saved.map(item => `
        <div class="bgm-row-wrap">
          <a class="bgm-row grow" href="${esc(item.href)}" target="_blank" rel="noopener">
            <span class="grow"><span class="name">${esc(item.name)}</span></span>
            <span class="bgm-go">&#9654;</span>
          </a>
          <button class="icon danger" type="button" data-delete-sound="${esc(item.id)}"
            aria-label="Delete ${esc(item.name)}">&#10005;</button>
        </div>`).join('')}</div>` : ''}
    </div>`;
}

export function update() {
  // Folders are rendered by their own mutations and the initial data load.
}

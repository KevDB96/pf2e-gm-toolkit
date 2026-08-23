// Minimal DOM helpers. Views build HTML strings and delegate events from a root node.

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escape a value for safe interpolation into an HTML string. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * A label for display: hyphens and underscores become spaces, and every word gets a
 * capital. The data files store these lowercase or hyphenated — `class-feature`,
 * `uncommon`, `heavy` — and a sheet reads better with them capitalised.
 */
export function caps(s) {
  return String(s ?? '').replace(/[-_]/g, ' ').replace(/\b[a-z]/g, ch => ch.toUpperCase());
}

// --- hover descriptions ------------------------------------------------------

/** How long a hover description may be. One or two sentences, not a paragraph. */
const TIP_LIMIT = 150;

// Sentences, each keeping its own full stop.
const sentences = s => (s.match(/[^.!?]+(?:[.!?]+|$)/g) || []).map(x => x.trim()).filter(Boolean);

/**
 * Does this sentence say something mechanical? Numbers, penalties, DCs, what you can't do.
 * Written to under-match rather than over-match: a flavour sentence kept by mistake is
 * only noise, while a rules sentence dropped by mistake loses the thing worth reading.
 */
const MECHANICAL =
  /\d|\bcan(?:not|'t)\b|\bmust\b|\bDC\b|penalt|bonus|status|circumstance|immun|resist|weakness|damage|\bsaves?\b|check|speed|\bAC\b|\bHP\b|off-guard|conceal|undetect|precise sense|difficult terrain|critical/i;

const clip = (s, limit) =>
  s.length <= limit ? s : s.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';

/**
 * The mechanical part of a description, short.
 *
 * Rules prose opens with flavour and gets to the mechanics afterwards — "You're lying on
 * the ground. You are off-guard and take a –2 circumstance penalty to attack rolls." — so
 * this skips whole sentences until one says something mechanical, then keeps sentences
 * until the limit. What a thing *does* is what a GM hovers a row to find out; the scene
 * setting is what the detail sheet is for.
 *
 * Two rules keep the result honest. A sentence AoN itself cut off mid-way is dropped once
 * there is something to show, so a description never trails off into an ellipsis. And when
 * nothing in the text is mechanical — most spell and feat summaries are one plain sentence
 * of what the thing does — the opening sentence is kept rather than returning nothing.
 */
export function brief(text, limit = TIP_LIMIT) {
  const parts = sentences(String(text ?? '').replace(/\s+/g, ' ').trim());
  if (!parts.length) return '';

  const first = Math.max(0, parts.findIndex(p => MECHANICAL.test(p)));
  const kept = [];
  for (const part of parts.slice(first)) {
    if (kept.length && !/[.!?]$/.test(part)) break;
    if ([...kept, part].join(' ').length > limit) break;
    kept.push(part);
  }
  return kept.length ? kept.join(' ') : clip(parts[first], limit);
}

/**
 * The attribute that gives an element a hover description, or '' when there is nothing
 * worth showing. Interpolate it inside the tag: `<button class="item"${tip(summary)}>`.
 *
 * The text goes through brief(), so every call site gets the mechanical summary rather
 * than the opening of a blurb. Records have a better source than their blurb — see
 * recordTip() in src/records.js — and callers that compose their own text (the condition
 * chips) call brief() themselves to leave room for what they add.
 */
export function tip(text) {
  const t = brief(text);
  if (!t) return '';
  return ` data-tip="${esc(t)}"`;
}

let tipNode = null;

function placeTip(el) {
  tipNode.textContent = el.dataset.tip;
  tipNode.hidden = false;
  const gap = 6;
  const edge = 8;
  const at = el.getBoundingClientRect();
  const box = tipNode.getBoundingClientRect();
  const below = at.bottom + gap;
  const top = below + box.height > window.innerHeight - edge
    ? Math.max(edge, at.top - box.height - gap)
    : below;
  tipNode.style.left =
    Math.min(Math.max(edge, at.left), window.innerWidth - box.width - edge) + 'px';
  tipNode.style.top = top + 'px';
}

/**
 * Show `data-tip` text on hover and on keyboard focus, from one reused element.
 *
 * Delegated from the document because rows are rebuilt constantly and bottom sheets come
 * and go. The tooltip is `position:fixed` for the same reason a CSS-only tooltip could
 * not be used here: a sheet scrolls its own content, so anything absolutely positioned
 * inside one is clipped at the sheet's edge.
 *
 * Pointer devices only. On a touch screen a tap fires mouseover with nothing to fire
 * mouseout, which would leave the card stuck over the thing it describes.
 */
export function installTips() {
  if (tipNode || !window.matchMedia?.('(hover: hover)').matches) return;
  tipNode = document.createElement('div');
  tipNode.className = 'tip';
  tipNode.hidden = true;
  document.body.appendChild(tipNode);

  const hide = () => { tipNode.hidden = true; };
  const show = e => {
    const el = e.target.closest?.('[data-tip]');
    if (el) placeTip(el);
  };
  document.addEventListener('mouseover', show);
  document.addEventListener('focusin', show);
  document.addEventListener('mouseout', hide);
  document.addEventListener('focusout', hide);
  document.addEventListener('click', hide, true);
  // Capture, so a sheet scrolling its own content takes the card with it.
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}

/** Bold and italic runs inside one line of rules text, escaped first. */
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>');
}

/**
 * Render the light markdown data/codex.json stores for rules text: blank lines between
 * paragraphs, `## ` sub-headings, `- ` bullets, `**bold**` and `*italic*`.
 *
 * Rules text is escaped before any of that is put back, so this stays safe on text
 * regardless of where it came from. Paragraphs matter more here than they look: a feat
 * that reads as one wall of prose on a phone is a feat nobody reads at the table.
 */
export function rich(text) {
  if (!text) return '';
  const out = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    let lines = [];
    let bullets = [];
    const para = () => {
      if (lines.length) out.push(`<p>${lines.join('<br>')}</p>`);
      lines = [];
    };
    const list = () => {
      if (bullets.length) out.push(`<ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>`);
      bullets = [];
    };
    for (const line of block.split('\n')) {
      const heading = line.match(/^#{1,4} +(.+)$/);
      const bullet = line.match(/^[-*] +(.+)$/);
      if (heading) {
        para(); list();
        out.push(`<h4>${inline(heading[1])}</h4>`);
      } else if (bullet) {
        para();
        bullets.push(inline(bullet[1]));
      } else if (line.trim()) {
        list();
        lines.push(inline(line));
      }
    }
    para();
    list();
  }
  return out.join('');
}

/**
 * Delegate an event on `root` to elements matching `sel`.
 * The handler gets (event, matchedElement).
 */
export function on(root, event, sel, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(sel);
    if (target && root.contains(target)) handler(e, target);
  });
}

/** Show a bottom-sheet modal. `build` returns the inner HTML; resolves on close. */
export function sheet(title, innerHTML, wire) {
  const node = document.createElement('div');
  node.className = 'modal';
  node.innerHTML = `
    <div class="sheet">
      <div class="row spread"><h2>${esc(title)}</h2><button class="icon ghost" data-close>✕</button></div>
      ${innerHTML}
    </div>`;
  const close = () => node.remove();
  node.addEventListener('click', (e) => {
    if (e.target === node || e.target.closest('[data-close]')) close();
  });
  document.body.appendChild(node);
  if (wire) wire(node, close);
  return { node, close };
}

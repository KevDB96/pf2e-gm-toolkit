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

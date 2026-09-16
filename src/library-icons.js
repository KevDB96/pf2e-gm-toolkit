import { esc } from './dom.js';

const LIBRARY_ICON_ROOT = './assets/icons/library/';

/** Resolve a manifest category name to its matching local Library artwork. */
export function libraryIconPath(name) {
  return `${LIBRARY_ICON_ROOT}${encodeURIComponent(String(name ?? ''))}.png`;
}

/** Render category artwork with the manifest glyph available if the image is absent. */
export function libraryIcon(category) {
  const glyph = esc(category?.glyph || '');
  if (typeof category?.name !== 'string' || !category.name) {
    return `<span class="library-icon-fallback" aria-hidden="true">${glyph}</span>`;
  }
  return `<span class="library-icon-wrap" aria-hidden="true">
    <img class="library-icon" src="${esc(libraryIconPath(category.name))}" alt=""
         onerror="this.hidden=true;this.nextElementSibling.hidden=false">
    <span class="library-icon-fallback" hidden>${glyph}</span>
  </span>`;
}

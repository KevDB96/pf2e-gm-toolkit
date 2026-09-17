// Turns the supplied badge art into the app's launcher icons and the five tab-bar icons.
//
// The batch-03 tiles are 1254x1254 RGB PNGs: a shaded rounded-rect badge — textured ground,
// an ornate metal ring, the drawing on top — sitting on a dark surround with a soft glow.
//
// That is a different kind of art from the flat tiles this tool used to consume, and it is
// why the app no longer ships tinted silhouettes. The old pipeline cut the glyph out by
// luminance and painted it with `currentColor`, which worked because those tiles had three
// clean levels (dark fill, dim ring, bright glyph). Here the ground is as bright as the
// drawing — purple texture with highlights, a silver ring over it — so there is no
// luminance cut that separates them: run against this art the old analysis returned 267 and
// 276 "glyph" fragments for two of the icons, which is the texture, not the drawing.
//
// So the icons ship as colour art and this tool's job is geometry rather than analysis:
// crop the surround away, resample, encode. The crop is centred and shared across the set,
// so the icons keep the weight they were drawn with instead of each being scaled to fill
// its own frame, and the badge inside the tile supplies the silhouette.
//
// The output is 8-bit palette PNG, not truecolour. Both are lossless, but this art is a
// shaded illustration built from a handful of ramps, and 256 colours with an error-diffused
// dither cost about a third of the bytes while being indistinguishable at the 40px the tab
// bar draws them at — 43 kB down to 13 kB per tab icon, and the launcher pair fall by the
// same factor. Size is the point: five of these are in the tab bar, so they are on the
// critical path of every cold load, and all nine used to be precached at install.
//
// The launcher icons come out of the same run — the plain pair straight from the art, and
// the maskable pair inset so the badge lands inside the middle 80%, which is the safe zone
// Android's circular adaptive mask leaves.
//
// So does the favicon, at 48px. It is written as its own file rather than the pages
// pointing a `<link rel="icon">` at icon-192.png: that file is 28 kB of shaded art for
// something the browser draws at 16-48px in a tab, and the favicon is fetched on every
// cold load in a browser tab. 48 is the largest size a tab, a bookmark or a shortcut asks
// for, and area-averaging down to it here beats each browser rescaling the 192 by itself.
//
// Usage:  node tools/nav-icons.mjs [--src <dir>] [--out <dir>] [--size N] [--crop F]
//                                  [--colours N] [--report]
// See README, "Icons".

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const DEFAULT_SRC = 'C:/Users/kevin/Documents/ChatGPT/PF2E GM Toolkit/' +
  'pf2e_gm_toolkit_assets_batch_03_nav';

/** Tab id -> source file. The id is what the shell routes on and what styles.css names. */
const NAV = [
  { name: 'home', file: 'nav-home.png' },
  { name: 'run', file: 'nav-run.png' },
  { name: 'table', file: 'nav-table.png' },
  { name: 'library', file: 'nav-library.png' },
  { name: 'bgm', file: 'nav-bgm.png' }
];

/** The launcher icon, and the two sizes the manifest lists. */
const APP = { file: 'app-icon.png', sizes: [192, 512] };

/**
 * The favicon, cut from the same art as the launcher pair.
 *
 * Not one of `APP.sizes` on purpose: the manifest's icons are drawn by the launcher at
 * install time, where 192 and 512 are the sizes it wants, while this one is drawn by the
 * browser in a tab and belongs in `index.html` rather than in the manifest. Adding it to
 * the manifest as well would offer a launcher a 48px icon to blow up over a whole screen.
 */
const FAVICON = { name: 'favicon-48.png', size: 48 };

/**
 * Fraction of the tile kept, measured from the centre.
 *
 * The badge itself spans about 88% of the frame and the rest is its own dark surround and
 * glow. Cropping to that trims the surround without cutting into the drawing, and leaves
 * each icon as a square of badge rather than a badge floating in a black box.
 */
const CROP = 0.88;

/**
 * How much of a maskable icon the badge may occupy. Android masks an adaptive icon to a
 * shape of its own choosing — a circle on most launchers — and only the middle 80% is
 * guaranteed to survive, so the art is inset until the *badge* fits that, not the frame:
 * the frame's own margin is already part of what has to fit.
 */
const SAFE_ZONE = 0.80;

/**
 * How many palette entries the icons are written with.
 *
 * 256 is the most an 8-bit index can address, and the art needs most of them: it is a
 * shaded illustration, so a small palette shows up as banding across the ground and around
 * the ring rather than as anything the dither can hide.
 */
const COLOURS = 256;

// ---------- args ----------
function parseArgs(argv) {
  const out = { src: DEFAULT_SRC, out: null, size: 128, crop: CROP, colours: COLOURS, report: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--src') out.src = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else if (arg === '--size') out.size = Number(argv[++i]);
    else if (arg === '--crop') out.crop = Number(argv[++i]);
    else if (arg === '--colours') out.colours = Number(argv[++i]);
    else if (arg === '--report') out.report = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(out.size) || out.size < 16) throw new Error('--size must be an integer >= 16');
  if (!(out.crop > 0.5 && out.crop <= 1)) throw new Error('--crop must be greater than 0.5 and at most 1');
  if (!Number.isInteger(out.colours) || out.colours < 2 || out.colours > 256) {
    throw new Error('--colours must be an integer between 2 and 256');
  }
  return out;
}

// ---------- PNG decode ----------
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Samples per pixel per colour type. Everything is expanded to RGBA after unfiltering, so
// the rest of the tool only ever sees one layout: an art export that drops the alpha
// channel decodes the same way as an RGBA one, just with alpha pinned to opaque.
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let pos = 8;
  let header = null;
  const idat = [];
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  if (!header) throw new Error('missing IHDR');
  if (header.depth !== 8) throw new Error(`unsupported bit depth ${header.depth}`);
  const channels = CHANNELS[header.colorType];
  if (!channels) throw new Error(`unsupported colour type ${header.colorType}`);
  if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported');

  const { width, height, colorType } = header;
  const bpp = channels;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const samples = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = samples.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? samples.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`unknown filter ${filter}`);
      cur[x] = v & 255;
    }
  }

  // Normalise to RGBA, which is this tool's working format: the resampler reads a known
  // four-byte stride, and the encoder writes the same layout back out.
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const from = i * channels;
    const to = i * 4;
    if (colorType === 6) {
      samples.copy(pixels, to, from, from + 4);
    } else if (colorType === 2) {
      samples.copy(pixels, to, from, from + 3);
      pixels[to + 3] = 255;
    } else if (colorType === 4) {
      pixels[to] = samples[from];
      pixels[to + 1] = samples[from];
      pixels[to + 2] = samples[from];
      pixels[to + 3] = samples[from + 1];
    } else {
      pixels[to] = samples[from];
      pixels[to + 1] = samples[from];
      pixels[to + 2] = samples[from];
      pixels[to + 3] = 255;
    }
  }
  return { width, height, pixels };
}

// ---------- PNG encode (RGBA, colour type 6) ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const pa = Math.abs(b - c);
  const pb = Math.abs(a - c);
  const pc = Math.abs(a + b - 2 * c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Builds a palette of at most `max` colours by median cut over a stride sample.
 *
 * The sample matters: a 512px icon is a quarter of a million pixels, and cutting over every
 * one of them costs seconds and buys nothing, because the palette stops changing once a few
 * tens of thousands of pixels have been seen. The per-pixel pass afterwards is the one that
 * has to visit everything.
 */
function buildPalette(rgba, width, height, max) {
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 24000));
  const pixels = [];
  for (let i = 0; i < total; i += step) {
    const at = i * 4;
    pixels.push((rgba[at] << 16) | (rgba[at + 1] << 8) | rgba[at + 2]);
  }

  const makeBox = (items) => {
    const lo = [255, 255, 255];
    const hi = [0, 0, 0];
    for (const value of items) {
      const c = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
      for (let i = 0; i < 3; i++) {
        if (c[i] < lo[i]) lo[i] = c[i];
        if (c[i] > hi[i]) hi[i] = c[i];
      }
    }
    let channel = 0;
    for (let i = 1; i < 3; i++) {
      if (hi[i] - lo[i] > hi[channel] - lo[channel]) channel = i;
    }
    return { items, channel, range: hi[channel] - lo[channel] };
  };

  const boxes = [makeBox(pixels)];
  while (boxes.length < max) {
    // Always split the widest remaining range, which is what median cut is. Weighting by
    // box size as well spends the palette on the flat ground and starves the drawing,
    // which is the part that has to survive.
    let pick = -1;
    let widest = 0;
    boxes.forEach((box, index) => {
      if (box.items.length < 2 || box.range <= widest) return;
      widest = box.range;
      pick = index;
    });
    if (pick < 0) break;
    const box = boxes[pick];
    const shift = (2 - box.channel) * 8;
    box.items.sort((a, b) => ((a >> shift) & 255) - ((b >> shift) & 255));
    const mid = box.items.length >> 1;
    boxes.splice(pick, 1, makeBox(box.items.slice(0, mid)), makeBox(box.items.slice(mid)));
  }

  return boxes.map(box => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const value of box.items) {
      r += (value >> 16) & 255;
      g += (value >> 8) & 255;
      b += value & 255;
    }
    const n = box.items.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

/**
 * Maps the image onto the palette, pushing each pixel's error into its neighbours
 * (Floyd–Steinberg).
 *
 * The dither is not decoration: the ground is most of the icon and it is a smooth ramp, so
 * a 256-colour cut of it bands visibly without one. Nearest-colour lookups are cached on a
 * 15-bit key, which is finer than the palette can resolve anyway, and turn the per-pixel
 * search into a map hit.
 */
function quantise(rgba, width, height, max) {
  const palette = buildPalette(rgba, width, height, max);
  const work = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    work[i * 3] = rgba[i * 4];
    work[i * 3 + 1] = rgba[i * 4 + 1];
    work[i * 3 + 2] = rgba[i * 4 + 2];
  }

  const indices = Buffer.alloc(width * height);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      // Clamp before matching. The diffused error can push a channel outside the byte
      // range, and matching on that value both picks an arbitrary palette entry and —
      // because the lookup cache is keyed on the quantised colour — poisons the cache for
      // the whole bucket it collides with. Left unclamped this shows as white speckle over
      // the dark end of the artwork, which is a far bigger change to it than the
      // quantisation the dither is supposed to be hiding.
      const r = Math.max(0, Math.min(255, Math.round(work[at])));
      const g = Math.max(0, Math.min(255, Math.round(work[at + 1])));
      const b = Math.max(0, Math.min(255, Math.round(work[at + 2])));
      const q = nearest(r, g, b);
      indices[y * width + x] = q;
      const p = palette[q];
      const er = r - p[0];
      const eg = g - p[1];
      const eb = b - p[2];
      const push = (dx, dy, weight) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const to = (ny * width + nx) * 3;
        work[to] += er * weight;
        work[to + 1] += eg * weight;
        work[to + 2] += eb * weight;
      };
      push(1, 0, 7 / 16);
      push(-1, 1, 3 / 16);
      push(0, 1, 5 / 16);
      push(1, 1, 1 / 16);
    }
  }
  return { palette, indices };
}

/**
 * Writes an 8-bit palette PNG (colour type 3).
 *
 * Rows are still filtered for size, the same way the truecolour encoder filtered them:
 * palette indices are bytes like any other, and picking the filter per row is worth about a
 * fifth of the file.
 */
function encodePalettePng(width, height, palette, indices) {
  const stride = width;
  const raw = Buffer.alloc((stride + 1) * height);
  const prior = Buffer.alloc(stride);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const src = indices.subarray(y * stride, (y + 1) * stride);
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 1 ? src[x - 1] : 0;
        const b = prior[x];
        const c = x >= 1 ? prior[x - 1] : 0;
        const s = src[x];
        const v = filter === 0 ? s
          : filter === 1 ? s - a
            : filter === 2 ? s - b
              : filter === 3 ? s - ((a + b) >> 1)
                : s - paeth(a, b, c);
        const byte = v & 255;
        candidate[x] = byte;
        score += Math.abs((byte << 24) >> 24);
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        candidate.copy(raw, y * (stride + 1) + 1);
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    src.copy(prior);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 3;    // colour type: palette
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((colour, i) => {
    plte[i * 3] = colour[0];
    plte[i * 3 + 1] = colour[1];
    plte[i * 3 + 2] = colour[2];
  });
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * The whole pipeline for one finished square of RGBA pixels.
 *
 * The opacity check is not paranoia: palette output has no alpha channel, so art with a
 * transparent background would come out with that background painted into the palette —
 * a black square behind the badge, which is exactly the kind of failure that looks like a
 * rendering bug rather than a build one.
 */
function encodeIcon(rgba, size, colours) {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) throw new Error('the icon art is not opaque; palette output cannot carry alpha');
  }
  const { palette, indices } = quantise(rgba, size, size, colours);
  return encodePalettePng(size, size, palette, indices);
}

// ---------- geometry ----------
/** The centred square a crop fraction cuts out of a frame. */
function centreCrop(image, fraction) {
  const span = Math.round(Math.min(image.width, image.height) * fraction);
  const minX = Math.floor((image.width - span) / 2);
  const minY = Math.floor((image.height - span) / 2);
  return { minX, minY, maxX: minX + span - 1, maxY: minY + span - 1 };
}

/**
 * Area-averages a rectangle of the source into a square of `size` pixels.
 *
 * Every source pixel is counted once, at its centre, so cells never double-count the
 * pixels along a shared edge. Averaging rather than point-sampling matters here because
 * the ratio is large — 1104 px into 128 — and dropping to nearest-neighbour would alias
 * the ring's fine metalwork into noise.
 */
function resampleRect(image, rect, size) {
  const { width, height, pixels } = image;
  const stepX = (rect.maxX - rect.minX + 1) / size;
  const stepY = (rect.maxY - rect.minY + 1) / size;
  const out = Buffer.alloc(size * size * 4);
  for (let dy = 0; dy < size; dy++) {
    const y0 = rect.minY + dy * stepY;
    const y1 = y0 + stepY;
    for (let dx = 0; dx < size; dx++) {
      const x0 = rect.minX + dx * stepX;
      const x1 = x0 + stepX;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        if (sy < 0 || sy >= height || sy + 0.5 < y0 || sy + 0.5 >= y1) continue;
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          if (sx < 0 || sx >= width || sx + 0.5 < x0 || sx + 0.5 >= x1) continue;
          const at = (sy * width + sx) * 4;
          r += pixels[at];
          g += pixels[at + 1];
          b += pixels[at + 2];
          a += pixels[at + 3];
          n++;
        }
      }
      const to = (dy * size + dx) * 4;
      if (!n) continue;
      out[to] = Math.round(r / n);
      out[to + 1] = Math.round(g / n);
      out[to + 2] = Math.round(b / n);
      out[to + 3] = Math.round(a / n);
    }
  }
  return out;
}

/**
 * The colour of the frame's own border, taken as the median of a sampled ring.
 *
 * A maskable icon is painted on a canvas of this colour before the art goes on top, so the
 * letterbox around the inset badge continues the art's own ground rather than showing a
 * different shade of near-black at the corners. The median rather than the mean because
 * the border fades into the artwork's glow on some tiles, and one bright edge should not
 * drag the whole fill up with it.
 */
function borderColour(image) {
  const { width, height, pixels } = image;
  const values = [[], [], []];
  const push = (x, y) => {
    const at = (y * width + x) * 4;
    values[0].push(pixels[at]);
    values[1].push(pixels[at + 1]);
    values[2].push(pixels[at + 2]);
  };
  for (let x = 0; x < width; x += 4) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 4) {
    push(0, y);
    push(width - 1, y);
  }
  return values.map(channel => {
    channel.sort((a, b) => a - b);
    return channel[Math.floor(channel.length / 2)];
  });
}

/** Paints `inner` (a square RGBA buffer) centred on a flat canvas of the given colour. */
function padTo(inner, innerSize, size, colour) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const at = i * 4;
    canvas[at] = colour[0];
    canvas[at + 1] = colour[1];
    canvas[at + 2] = colour[2];
    canvas[at + 3] = 255;
  }
  const offset = Math.floor((size - innerSize) / 2);
  for (let y = 0; y < innerSize; y++) {
    const from = y * innerSize * 4;
    const to = ((y + offset) * size + offset) * 4;
    inner.copy(canvas, to, from, from + innerSize * 4);
  }
  return canvas;
}

// ---------- run ----------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const navOut = args.out ?? join(REPO, 'icons', 'nav');
  const appOut = args.out ?? join(REPO, 'icons');
  mkdirSync(navOut, { recursive: true });
  mkdirSync(appOut, { recursive: true });

  for (const { name, file } of NAV) {
    const image = decodePng(readFileSync(join(args.src, file)));
    const rect = centreCrop(image, args.crop);
    const png = encodeIcon(resampleRect(image, rect, args.size), args.size, args.colours);
    const out = join(navOut, `${name}.png`);
    writeFileSync(out, png);
    if (args.report) {
      console.log(`${name.padEnd(8)} ${image.width}x${image.height} -> crop ` +
        `${rect.maxX - rect.minX + 1}px -> ${args.size}px, ${(png.length / 1024).toFixed(1)} kB`);
    }
  }

  const app = decodePng(readFileSync(join(args.src, APP.file)));
  const full = { minX: 0, minY: 0, maxX: app.width - 1, maxY: app.height - 1 };
  const ground = borderColour(app);
  for (const size of APP.sizes) {
    const plain = encodeIcon(resampleRect(app, full, size), size, args.colours);
    writeFileSync(join(appOut, `icon-${size}.png`), plain);
    // The badge covers `crop` of the art's frame, so the art has to be drawn at
    // safe/crop of the canvas for the badge to land on the safe zone exactly.
    const inner = Math.round(size * (SAFE_ZONE / args.crop));
    const maskable = encodeIcon(padTo(resampleRect(app, full, inner), inner, size, ground),
      size, args.colours);
    writeFileSync(join(appOut, `icon-maskable-${size}.png`), maskable);
    if (args.report) {
      console.log(`app ${size}  icon-${size}.png ${(plain.length / 1024).toFixed(1)} kB, ` +
        `maskable ${(maskable.length / 1024).toFixed(1)} kB ` +
        `(art ${inner}px on rgb(${ground}) canvas)`);
    }
  }
  if (!args.report) console.log(`${NAV.length} tab icons and ${APP.sizes.length * 2} launcher icons written`);

  // The same full frame as the plain launcher pair — the favicon is the badge on its own
  // ground, with no maskable inset, because a tab icon is never masked to a shape.
  const favicon = encodeIcon(resampleRect(app, full, FAVICON.size), FAVICON.size, args.colours);
  writeFileSync(join(appOut, FAVICON.name), favicon);
  if (args.report) {
    console.log(`app ${FAVICON.size}  ${FAVICON.name} ${(favicon.length / 1024).toFixed(1)} kB ` +
      `(the badge art at tab size, not the 192px launcher rescaled)`);
  } else {
    console.log(`${NAV.length} tab icons, ${APP.sizes.length * 2} launcher icons and ${FAVICON.name} written`);
  }
}

main();

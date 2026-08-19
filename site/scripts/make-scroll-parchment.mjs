#!/usr/bin/env node
/**
 * Builds a tileable 宣纸 texture and ages the parchment pixels in the
 * scroll cap images so the hanging paper reads as one piece of old paper.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '../src/assets');

const BASE = { r: 196, g: 158, b: 112 };
const TEX_W = 256;
const TEX_H = 512;

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodePng(buf) {
  let offset = 8;
  const idats = [];
  let w;
  let h;
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    offset += 4;
    const type = buf.toString('ascii', offset, offset + 4);
    offset += 4;
    const data = buf.slice(offset, offset + len);
    offset += len + 4;
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    } else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const bpp = 4;
  const stride = w * bpp;
  const raw = Buffer.alloc(h * stride);
  let i = 0;
  for (let y = 0; y < h; y++) {
    const filter = inflated[i++];
    const row = inflated.slice(i, i + stride);
    i += stride;
    const prev = y === 0 ? Buffer.alloc(stride) : raw.slice((y - 1) * stride, y * stride);
    const dest = raw.slice(y * stride, (y + 1) * stride);
    if (filter === 0) row.copy(dest);
    else if (filter === 1) {
      for (let x = 0; x < stride; x++) dest[x] = (row[x] + (x >= bpp ? dest[x - bpp] : 0)) & 255;
    } else if (filter === 2) {
      for (let x = 0; x < stride; x++) dest[x] = (row[x] + prev[x]) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < stride; x++) {
        dest[x] = (row[x] + Math.floor(((x >= bpp ? dest[x - bpp] : 0) + prev[x]) / 2)) & 255;
      }
    } else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? dest[x - bpp] : 0;
        const b = prev[x];
        const c = x >= bpp ? prev[x - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        dest[x] = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
  }
  return { w, h, raw };
}

function hash2(ix, iy) {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, periodX, periodY) {
  const wx = ((x % periodX) + periodX) % periodX;
  const wy = ((y % periodY) + periodY) % periodY;
  const x0 = Math.floor(wx);
  const y0 = Math.floor(wy);
  const x1 = (x0 + 1) % periodX;
  const y1 = (y0 + 1) % periodY;
  const tx = fade(wx - x0);
  const ty = fade(wy - y0);
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function fbm(x, y, px, py, octaves) {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(x * freq, y * freq, px * freq, py * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / norm;
}

function clamp(n) {
  return n < 0 ? 0 : n > 255 ? 255 : n | 0;
}

function makeTexture() {
  const rgba = Buffer.alloc(TEX_W * TEX_H * 4);
  for (let y = 0; y < TEX_H; y++) {
    for (let x = 0; x < TEX_W; x++) {
      const cloud = fbm(x / 32, y / 32, TEX_W / 32, TEX_H / 32, 5);
      const fiber = fbm(x / 2, y / 16, TEX_W / 2, TEX_H / 16, 4);
      const grain = fbm(x, y, TEX_W, TEX_H, 3);
      const laid = Math.sin((y / TEX_H) * Math.PI * 2 * 16) * 0.5 + 0.5;
      const speckle = hash2(x * 13 + 7, y * 29 + 3);
      const fox = speckle > 0.987 ? (speckle - 0.987) / 0.013 : 0;
      const mottle = (cloud - 0.5) * 52;
      const fib = (fiber - 0.5) * 38;
      const g = (grain - 0.5) * 16;
      const line = (laid - 0.5) * 8;
      const stain = fox * -58;

      const r = clamp(BASE.r + mottle + fib * 0.6 + g + line + stain * 0.7);
      const gg = clamp(BASE.g + mottle * 0.9 + fib * 0.45 + g * 0.85 + line + stain * 0.85);
      const b = clamp(BASE.b + mottle * 0.7 + fib * 0.25 + g * 0.7 + line * 0.6 + stain);

      const o = (y * TEX_W + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = gg;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

function isParchment(r, g, b, a) {
  if (a < 180) return false;
  const dist = Math.hypot(r - 196, g - 162, b - 118);
  return dist < 48;
}

function ageCaps(srcPath, destPath, tex) {
  const { w, h, raw } = decodePng(fs.readFileSync(srcPath));
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = raw[o];
      const g = raw[o + 1];
      const b = raw[o + 2];
      const a = raw[o + 3];
      if (!isParchment(r, g, b, a)) continue;
      const tx = ((x / w) * TEX_W) | 0;
      const ty = ((y / 80) * TEX_H) % TEX_H | 0;
      const to = ((((ty % TEX_H) + TEX_H) % TEX_H) * TEX_W + (tx % TEX_W)) * 4;
      const tr = tex[to];
      const tg = tex[to + 1];
      const tb = tex[to + 2];
      raw[o] = clamp(r * 0.28 + tr * 0.72);
      raw[o + 1] = clamp(g * 0.28 + tg * 0.72);
      raw[o + 2] = clamp(b * 0.28 + tb * 0.72);
      n += 1;
    }
  }
  fs.writeFileSync(destPath, encodePng(w, h, raw));
  return n;
}

const tex = makeTexture();
const texPath = path.join(ASSETS, 'scroll-parchment.png');
fs.writeFileSync(texPath, encodePng(TEX_W, TEX_H, tex));
console.log('wrote', texPath);

for (const name of ['scroll-top', 'scroll-bottom']) {
  const orig = path.join(ASSETS, `${name}.orig.png`);
  const dest = path.join(ASSETS, `${name}.png`);
  const src = fs.existsSync(orig) ? orig : dest;
  const n = ageCaps(src, dest, tex);
  console.log('aged', name, 'from', path.basename(src), n, 'parchment pixels');
}

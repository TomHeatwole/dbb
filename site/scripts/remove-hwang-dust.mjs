#!/usr/bin/env node
/**
 * Strip trailing dust puffs from Hwang running APNG frames.
 * Dust is semi-transparent and never reaches full opacity in any frame.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'public/hwang_running_clean_transparent_dust.png');
const OUTPUT = INPUT;
const TMP = fs.mkdtempSync(path.join('/tmp', 'hwang-dust-'));

function isDustTint(r, g, b, a) {
  if (a < 15) return false;
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const sat = maxc - minc;
  const mid = (r + g + b) / 3;
  if (a <= 140 && r >= 170 && g >= 150 && b >= 110 && b <= 175) return true;
  if (a <= 200 && sat < 35 && mid >= 120 && mid <= 250) return true;
  if (sat < 30 && mid >= 40 && mid <= 170) return true;
  return false;
}

function loadFrames() {
  execFileSync(
    'ffmpeg',
    ['-y', '-i', INPUT, '-fps_mode', 'passthrough', path.join(TMP, 'frame_%02d.png')],
    { stdio: 'pipe' },
  );
  const files = fs.readdirSync(TMP).filter((f) => f.startsWith('frame_')).sort();
  return files.map((f) => PNG.sync.read(fs.readFileSync(path.join(TMP, f))));
}

function buildMasks(frames) {
  const { width, height } = frames[0];
  const maxA = new Uint8Array(width * height);
  for (const png of frames) {
    const d = png.data;
    for (let p = 0; p < width * height; p++) {
      maxA[p] = Math.max(maxA[p], d[(p << 2) + 3]);
    }
  }

  const solid = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (maxA[p] > 180) solid[p] = 1;
  }

  const protectedMask = new Uint8Array(solid);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (solid[p]) continue;
      outer: for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (solid[(y + dy) * width + (x + dx)]) {
            protectedMask[p] = 1;
            break outer;
          }
        }
      }
    }
  }

  return { width, height, maxA, protectedMask };
}

function cleanFrame(png, masks) {
  const { width, height, maxA, protectedMask } = masks;
  const d = png.data;
  let cleared = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (protectedMask[p]) continue;

      const i = p << 2;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const a = d[i + 3];
      if (a < 15) continue;

      const trail = x < 220 && y > 530;
      const neverSolid = maxA[p] < 100;
      const dustTint = isDustTint(r, g, b, a);
      const farTrail = x < 145 && y > 580;

      if (farTrail || (trail && neverSolid) || (trail && dustTint)) {
        d[i] = d[i + 1] = d[i + 2] = 0;
        d[i + 3] = 0;
        cleared++;
      }
    }
  }

  return cleared;
}

const frames = loadFrames();
const masks = buildMasks(frames);
const cleanedDir = path.join(TMP, 'clean');
fs.mkdirSync(cleanedDir);

frames.forEach((frame, idx) => {
  const cleared = cleanFrame(frame, masks);
  const out = path.join(cleanedDir, `frame_${String(idx + 1).padStart(2, '0')}.png`);
  fs.writeFileSync(out, PNG.sync.write(frame));
  console.log(`frame ${idx + 1}: cleared ${cleared} px`);
});

execFileSync(
  'ffmpeg',
  [
    '-y',
    '-framerate',
    '110/12',
    '-i',
    path.join(cleanedDir, 'frame_%02d.png'),
    '-plays',
    '0',
    '-f',
    'apng',
    OUTPUT,
  ],
  { stdio: 'inherit' },
);

console.log(`Wrote ${OUTPUT}`);
fs.rmSync(TMP, { recursive: true, force: true });

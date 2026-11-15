import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  codesFromTree,
  decodeText,
  encodeBytes,
  decodeToBytes,
  encodeText,
  reviveTree,
} from '../sb/lib/huffman.mjs';

// English unigram weights, then bent so a textbook tree cannot read the bits.
// Space, e, t, and a are the symbols a generic English Huffman tree makes shortest.
// This salt and the branch flip live only in this repo. The deployed site loads
// the finished tree, not these weights.
const SALT = 'eepybee montreality tree v1 — not the textbook english huffman';

const LETTER = {
  e: 1270, t: 906, a: 817, o: 750, i: 697, n: 675, s: 633, h: 609, r: 599,
  d: 425, l: 403, c: 278, u: 276, m: 241, w: 236, f: 223, g: 202, y: 197,
  p: 193, b: 149, v: 98, k: 77, j: 15, x: 15, q: 10, z: 7,
};

function saltByte(i) {
  let h = 2166136261;
  for (let k = 0; k < SALT.length; k++) {
    h = Math.imul(h ^ SALT.charCodeAt(k), 16777619);
  }
  h = Math.imul(h ^ (i + 1), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return h >>> 0;
}

function commonWeight(byte) {
  if (byte === 32) return 1900;
  if (byte === 10) return 80;
  if (byte === 13) return 10;
  if (byte === 46) return 90;
  if (byte === 44) return 70;
  if (byte === 39) return 40;
  const ch = String.fromCharCode(byte);
  if (LETTER[ch]) return LETTER[ch];
  if (ch >= 'A' && ch <= 'Z' && LETTER[ch.toLowerCase()]) {
    return Math.max(8, Math.round(LETTER[ch.toLowerCase()] / 8));
  }
  if (byte >= 48 && byte <= 57) return 40;
  if (byte < 128) return 12;
  return 4;
}

function tweakedWeight(byte) {
  const base = commonWeight(byte);
  const salt = saltByte(byte);
  let weight = base * ((3 + (salt % 29)) / 10);
  if (byte === 32 || byte === 101 || byte === 116 || byte === 97) weight *= 0.18;
  if (byte === 113 || byte === 122 || byte === 120 || byte === 106) weight *= 8;
  if (byte === 33 || byte === 63) weight *= 4;
  return weight + (salt % 97) + 1;
}

function buildTree(weightOf, { flip }) {
  const nodes = [];
  for (let byte = 0; byte < 256; byte++) {
    nodes.push({ w: weightOf(byte), leaf: byte, min: byte, tie: byte });
  }
  let tie = 256;
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.w - b.w || a.min - b.min || a.tie - b.tie);
    const a = nodes.shift();
    const b = nodes.shift();
    let left = a;
    let right = b;
    if (flip) {
      const salt = saltByte((a.min * 131) ^ (b.min * 17) ^ nodes.length);
      if (salt % 3 !== 0) [left, right] = [right, left];
    } else if (a.min > b.min) {
      left = b;
      right = a;
    }
    nodes.push({
      w: a.w + b.w,
      min: Math.min(a.min, b.min),
      left,
      right,
      tie: tie++,
    });
  }
  return nodes[0];
}

function serialize(node) {
  if (node.leaf !== undefined) return node.leaf;
  return [serialize(node.left), serialize(node.right)];
}

function shortest(codes) {
  let byte = 0;
  for (let i = 1; i < 256; i++) {
    if (codes[i].length < codes[byte].length) byte = i;
  }
  return byte;
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const tweaked = buildTree(tweakedWeight, { flip: true });
const generic = buildTree(commonWeight, { flip: false });
const tweakedCodes = codesFromTree(tweaked);
const genericCodes = codesFromTree(generic);
const tweakedJson = serialize(tweaked);
const genericRoot = reviveTree(serialize(generic));
const tweakedRoot = reviveTree(tweakedJson);

const samples = [
  '',
  'e',
  'the',
  'hello eepybee',
  'the cat sat on the mat. ETA: good morning.\n',
  'qzxj !?',
  '🎂 sleepy bee — “quotes” and tabs\there',
  'a'.repeat(4000),
  Buffer.from(Array.from({ length: 256 }, (_, i) => i)).toString('latin1'),
];

for (const sample of samples) {
  const encoded = encodeText(sample, tweakedRoot);
  assert(decodeText(encoded, tweakedRoot) === sample, 'tweaked tree failed to round-trip');
  assert(!encoded.includes(sample) || sample.length < 2, 'payload still contains the plaintext');
  let genericText = null;
  let genericThrew = false;
  try {
    genericText = decodeText(encoded, genericRoot);
  } catch {
    genericThrew = true;
  }
  if (sample.length > 8) {
    assert(genericThrew || genericText !== sample, 'textbook English tree decoded a tweaked payload');
  }
}

const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
assert(
  decodeToBytes(encodeBytes(allBytes, tweakedRoot), tweakedRoot).equals(allBytes),
  'byte alphabet failed to round-trip',
);

const shortTweaked = shortest(tweakedCodes);
assert(shortTweaked !== 32 && shortTweaked !== 101 && shortTweaked !== 116, 'shortest symbol is still a textbook letter');
assert(tweakedCodes[32].join('') !== genericCodes[32].join(''), 'space code matches the textbook tree');
assert(tweakedCodes[101].join('') !== genericCodes[101].join(''), 'e code matches the textbook tree');

const outPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../private/eepybee-huffman-tree.json',
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(tweakedJson));

const loaded = encodeText('the sleepy bee left a note');
assert(decodeText(loaded) === 'the sleepy bee left a note', 'tree file failed to load');

const spaceLen = tweakedCodes[32].length;
const eLen = tweakedCodes[101].length;
const qLen = tweakedCodes[113].length;
console.log(
  JSON.stringify({
    bytes: fs.statSync(outPath).size,
    shortest: shortTweaked,
    lengths: { space: spaceLen, e: eLen, q: qLen },
    genericSpace: genericCodes[32].length,
    genericE: genericCodes[101].length,
  }),
);

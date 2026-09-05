#!/usr/bin/env node
/** Check exported LightGBM fixtures match the JS walker. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = JSON.parse(readFileSync(join(root, 'site/src/drives/driveResultModel.json'), 'utf8'));

function walk(node, x) {
  if (node.f == null) return node.v;
  const v = x[node.f];
  const goLeft = !Number.isFinite(v) ? node.dl : v <= node.t;
  return walk(goLeft ? node.l : node.r, x);
}

function score(layerName, featureMap) {
  const { features, classes, trees } = model[layerName].lgbm;
  const x = features.map((name) => {
    const v = featureMap[name];
    return Number.isFinite(v) ? v : NaN;
  });
  const raw = new Array(classes.length).fill(0);
  for (const tree of trees) raw[tree.c] += walk(tree.n, x);
  const max = Math.max(...raw);
  const ex = raw.map((v) => Math.exp(v - max));
  const sum = ex.reduce((a, b) => a + b, 0);
  return Object.fromEntries(classes.map((k, i) => [k, ex[i] / sum]));
}

let failed = 0;
for (const [i, fix] of (model.fixtures ?? []).entries()) {
  const got = score(fix.layer, fix.x);
  const ok = fix.p.every((want, j) => Math.abs(got[model[fix.layer].lgbm.classes[j]] - want) < 1e-4);
  console.log(`${ok ? 'ok' : 'FAIL'} fixture ${i} ${fix.layer}`, Object.values(got).map((p) => p.toFixed(4)));
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log('fixtures ok');

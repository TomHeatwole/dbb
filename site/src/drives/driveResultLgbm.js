/**
 * Score the exported LightGBM multiclass trees in driveResultModel.json.
 * Leaf values already include shrinkage. Missing features follow default_left.
 */

import model from './driveResultModel.json';

export const DRIVE_RESULT_MODEL = model;

function walk(node, x) {
  if (node.f == null) return node.v;
  const v = x[node.f];
  const goLeft = !Number.isFinite(v) ? node.dl : v <= node.t;
  return walk(goLeft ? node.l : node.r, x);
}

function softmax(raw) {
  let max = raw[0];
  for (let i = 1; i < raw.length; i += 1) if (raw[i] > max) max = raw[i];
  let sum = 0;
  const ex = raw.map((v) => {
    const e = Math.exp(v - max);
    sum += e;
    return e;
  });
  return ex.map((e) => e / sum);
}

export function scoreLgbmLayer(layerName, featureMap) {
  const pack = model[layerName];
  if (!pack?.lgbm) return null;
  const { features, classes, trees } = pack.lgbm;
  const x = features.map((name) => {
    const v = featureMap[name];
    return Number.isFinite(v) ? v : NaN;
  });
  const raw = new Array(classes.length).fill(0);
  for (const tree of trees) {
    raw[tree.c] += walk(tree.n, x);
  }
  const p = softmax(raw);
  const out = {};
  classes.forEach((key, i) => {
    out[key] = p[i];
  });
  return { p: out, classes, features };
}

export function verifyDriveModelFixtures(eps = 1e-4) {
  const fixtures = model.fixtures ?? [];
  return fixtures.map((fix, i) => {
    const got = scoreLgbmLayer(fix.layer, fix.x);
    const ok = Boolean(
      got && fix.p.every((want, j) => Math.abs(got.p[got.classes[j]] - want) < eps),
    );
    return { i, layer: fix.layer, ok };
  });
}

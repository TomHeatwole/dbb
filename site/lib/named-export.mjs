/**
 * Read a binding from a module Vercel may have compiled to CommonJS.
 * Named ESM imports then fail; namespace import + this helper still works.
 */
export function pickExport(mod, key) {
  if (mod != null && mod[key] !== undefined) return mod[key];
  const def = mod?.default;
  if (def != null && typeof def === 'object' && def[key] !== undefined) return def[key];
  throw new Error(`${key} is not exported`);
}

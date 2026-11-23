// Minimal .env loader. Reads KEY=VALUE lines from one or more files (later files
// do not override keys already set). Values are never logged or printed.
import { readFileSync, existsSync } from "node:fs";

export function loadEnvFiles(paths) {
  const out = {};
  for (const p of paths) {
    if (!p || !existsSync(p)) continue;
    for (const rawLine of readFileSync(p, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}

export function requireEnv(env, keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`missing required config: ${missing.join(", ")}`);
  }
}

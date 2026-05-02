import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

let loaded = false;

export const loadRootEnv = (): void => {
  if (loaded) return;
  loaded = true;

  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      try {
        const content = readFileSync(candidate, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq < 0) continue;
          const key = trimmed.slice(0, eq).trim();
          let value = trimmed.slice(eq + 1).trim();
          const last = value.length - 1;
          if (
            value.length >= 2 &&
            ((value[0] === '"' && value[last] === '"') ||
              (value[0] === "'" && value[last] === "'"))
          ) {
            value = value.slice(1, -1);
          }
          if (process.env[key] === undefined) process.env[key] = value;
        }
      } catch {}
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
};

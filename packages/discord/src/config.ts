import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type EventKind = string;
export type ChannelSlot = string;

export interface RuntimeConfig {
  messages: Record<string, string | null>;
  channels: Record<string, string | null>;
}

export const emptyConfig = (): RuntimeConfig => ({
  messages: {},
  channels: {},
});

let path: string | null = null;
let current: RuntimeConfig = emptyConfig();

export const initConfig = async (filePath: string): Promise<void> => {
  path = filePath;
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
    current = {
      messages: { ...(parsed.messages ?? {}) },
      channels: { ...(parsed.channels ?? {}) },
    };
  } catch {
    current = emptyConfig();
  }
};

export const getConfig = (): RuntimeConfig => current;

export const updateConfig = async (
  mutate: (cfg: RuntimeConfig) => void,
): Promise<RuntimeConfig> => {
  if (!path) throw new Error("config not initialized");
  const next: RuntimeConfig = JSON.parse(JSON.stringify(current));
  mutate(next);
  current = next;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), "utf8");
  return next;
};

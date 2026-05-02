import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnyEvent } from "./types.js";
import { parseEvents, type EventsResponse } from "./wire.js";

interface PollerOptions {
  indexerUrl: string;
  cursorFile: string;
  intervalMs: number;
  onEvent: (event: AnyEvent) => Promise<void>;
  onError?: (err: unknown) => void;
}

const readCursor = async (path: string): Promise<bigint> => {
  try {
    const raw = await readFile(path, "utf8");
    const value = JSON.parse(raw).cursor;
    return typeof value === "string" ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
};

const writeCursor = async (path: string, cursor: bigint): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ cursor: cursor.toString() }), "utf8");
};

export const startPoller = (opts: PollerOptions): { stop: () => void } => {
  let stopped = false;
  let cursor = 0n;
  let initialized = false;

  const tick = async () => {
    if (stopped) return;
    try {
      if (!initialized) {
        cursor = await readCursor(opts.cursorFile);
        initialized = true;
      }
      const url = `${opts.indexerUrl}/api/events?since=${cursor.toString()}&limit=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`indexer ${res.status}`);
      const json = (await res.json()) as EventsResponse;
      const events = parseEvents(json);
      for (const ev of events) {
        await opts.onEvent(ev);
        cursor = ev.cursor;
        await writeCursor(opts.cursorFile, cursor);
      }
    } catch (err) {
      opts.onError?.(err);
    } finally {
      if (!stopped) setTimeout(tick, opts.intervalMs);
    }
  };

  tick();

  return { stop: () => { stopped = true; } };
};

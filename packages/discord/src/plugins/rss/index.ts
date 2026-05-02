import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_RSS_POLL_INTERVAL_MS, pluginConfig } from "@abotbasho/shared";
import { channelIdForSlot, resolveChannel } from "../../channels.js";
import { registerChannelSlot } from "../extensions.js";
import type { DiscordPlugin, PluginContext } from "../types.js";
import { fetchFeed, type FeedEntry } from "./feed.js";
import { contentForFeedEntry } from "./poster.js";
import { blog } from "./commands/blog.js";

export const RSS_PLUGIN_NAME = "rss";

registerChannelSlot({
  id: "blog",
  envVar: "DISCORD_BLOG_CHANNEL_ID",
  description: "Channel for RSS feed entries",
});

export interface RssPluginConfig {
  url: string;
  pollIntervalMs?: number;
}

const validate = (raw: unknown): RssPluginConfig | null => {
  if (raw === undefined) return null;
  if (!raw || typeof raw !== "object") {
    throw new Error("plugins.rss must be an object");
  }
  const cfg = raw as Partial<RssPluginConfig>;
  if (!cfg.url || typeof cfg.url !== "string") {
    throw new Error("plugins.rss.url is required");
  }
  if (
    cfg.pollIntervalMs !== undefined &&
    (typeof cfg.pollIntervalMs !== "number" || cfg.pollIntervalMs <= 0)
  ) {
    throw new Error("plugins.rss.pollIntervalMs must be a positive number");
  }
  return { url: cfg.url, pollIntervalMs: cfg.pollIntervalMs };
};

const cfg = validate(pluginConfig<unknown>(RSS_PLUGIN_NAME));
const pollIntervalMs = cfg?.pollIntervalMs ?? DEFAULT_RSS_POLL_INTERVAL_MS;

const SEEN_CAP = 500;

const seenPath = (ctx: PluginContext) => join(ctx.dataDir, "seen.json");

const readSeen = async (path: string): Promise<Set<string>> => {
  try {
    const raw = await readFile(path, "utf8");
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
};

const writeSeen = async (path: string, ids: Iterable<string>): Promise<void> => {
  const arr = [...ids].slice(-SEEN_CAP);
  await writeFile(path, JSON.stringify(arr), "utf8");
};

const pollFeed = async (ctx: PluginContext): Promise<void> => {
  if (!cfg) return;

  let entries: FeedEntry[];
  try {
    entries = await fetchFeed(cfg.url);
  } catch (err) {
    ctx.errorLog("fetchFeed failed:", (err as Error).message);
    return;
  }

  const path = seenPath(ctx);
  const seen = await readSeen(path);
  const isFirstRun = seen.size === 0;

  if (isFirstRun) {
    for (const e of entries) seen.add(e.id);
    await writeSeen(path, seen);
    ctx.log(`first run: marked ${entries.length} existing entries as seen`);
    return;
  }

  const channelId = channelIdForSlot("blog");
  const channel = await resolveChannel(ctx.client, channelId);
  if (!channel) {
    ctx.errorLog(`blog channel ${channelId} not text-based, skipping ${entries.length} entries`);
    return;
  }

  // Post oldest-first so feed order in Discord is chronological.
  const fresh = entries.filter((e) => !seen.has(e.id)).reverse();
  for (const entry of fresh) {
    try {
      await channel.send({ content: contentForFeedEntry(entry) });
      seen.add(entry.id);
      ctx.log(`posted "${entry.title}" -> ${channelId}`);
    } catch (err) {
      ctx.errorLog(`post failed for "${entry.title}":`, err);
      break;
    }
  }
  if (fresh.length > 0) await writeSeen(path, seen);
};

export const rssPlugin: DiscordPlugin = {
  name: RSS_PLUGIN_NAME,
  description: "Polls an RSS/Atom feed and posts new entries; /blog command for manual posts",
  init: async (ctx) => {
    if (!cfg) {
      ctx.log("plugins.rss not set in abotbasho.config.ts; auto-posting disabled, /blog still available");
    } else {
      ctx.log(`watching ${cfg.url} every ${pollIntervalMs}ms`);
    }
  },
  intervals: cfg
    ? [
        {
          name: "poll-feed",
          intervalMs: pollIntervalMs,
          runImmediately: true,
          handler: pollFeed,
        },
      ]
    : [],
  commands: [blog],
};

import type { AnyEvent } from "@abotbasho/shared";
import type { Client, TextChannel } from "discord.js";
import { env } from "./env.js";
import { getConfig } from "./config.js";
import {
  DEFAULT_CHANNEL_SLOT,
  channelSlotFor,
  handlerForEvent,
} from "./plugins/extensions.js";

const envForSlot = (slot: string): string | undefined => {
  const spec = channelSlotFor(slot);
  if (!spec?.envVar) return undefined;
  const v = process.env[spec.envVar];
  return v && v.length > 0 ? v : undefined;
};

export const channelIdForSlot = (slot: string): string => {
  const cfg = getConfig();
  const fromConfig = cfg.channels[slot];
  if (fromConfig) return fromConfig;
  const fromEnv = envForSlot(slot);
  if (fromEnv) return fromEnv;
  if (slot !== DEFAULT_CHANNEL_SLOT) {
    return cfg.channels[DEFAULT_CHANNEL_SLOT] ?? env.DISCORD_CHANNEL_ID;
  }
  return env.DISCORD_CHANNEL_ID;
};

export const channelIdFor = (event: AnyEvent): string => {
  const handler = handlerForEvent(event);
  if (!handler) return channelIdForSlot(DEFAULT_CHANNEL_SLOT);
  return channelIdForSlot(handler.channelSlot);
};

const cache = new Map<string, TextChannel>();

export const resolveChannel = async (
  client: Client,
  channelId: string,
): Promise<TextChannel | null> => {
  const hit = cache.get(channelId);
  if (hit) return hit;
  const ch = await client.channels.fetch(channelId);
  if (!ch || !ch.isTextBased() || !("send" in ch)) return null;
  cache.set(channelId, ch as TextChannel);
  return ch as TextChannel;
};

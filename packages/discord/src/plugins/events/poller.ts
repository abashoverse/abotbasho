import type { Client } from "discord.js";
import {
  DEFAULT_POLL_INTERVAL_MS,
  getProjectConfig,
  startPoller,
  type AnyEvent,
} from "@abotbasho/shared";
import { env } from "../../env.js";
import { messageFor } from "../../messages.js";
import { channelIdForSlot, resolveChannel } from "../../channels.js";
import { handlerForEvent } from "../extensions.js";
import type { PluginContext } from "../types.js";

let stopFn: (() => void) | null = null;

const onEvent = async (
  client: Client,
  ctx: PluginContext,
  event: AnyEvent,
) => {
  const handler = handlerForEvent(event);
  if (!handler) {
    ctx.log(`no handler for event type=${event.type}, skipping`);
    return;
  }
  const channelId = channelIdForSlot(handler.channelSlot);
  const channel = await resolveChannel(client, channelId);
  if (!channel) {
    ctx.errorLog(`channel ${channelId} not text-based, skipping`);
    return;
  }
  try {
    const embed = await handler.buildEmbed(
      event,
      env.MAINNET_RPC_URL,
      messageFor(handler.messageKind),
    );
    await channel.send({ embeds: [embed] });
    ctx.log(`posted ${event.type} cursor=${event.cursor} -> ${channelId}`);
  } catch (err) {
    ctx.errorLog("post failed:", err);
    throw err;
  }
};

export const startEventPoller = (ctx: PluginContext): void => {
  const intervalMs =
    getProjectConfig().pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (intervalMs <= 0) {
    ctx.log("indexer poller disabled (pollIntervalMs <= 0)");
    return;
  }
  const { stop } = startPoller({
    indexerUrl: env.INDEXER_API_URL,
    cursorFile: env.CURSOR_FILE,
    intervalMs,
    onEvent: (e) => onEvent(ctx.client, ctx, e),
    onError: (err) => ctx.errorLog("poll error:", err),
  });
  stopFn = stop;
};

export const stopEventPoller = (): void => {
  stopFn?.();
  stopFn = null;
};

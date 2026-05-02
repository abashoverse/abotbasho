import type { EmbedBuilder } from "discord.js";
import type { AnyEvent } from "@abotbasho/shared";

export interface ChannelSlotSpec {
  id: string;
  envVar?: string;
  description?: string;
}

export interface MessageKindSpec {
  id: string;
  description?: string;
  sample?: () => AnyEvent;
}

export interface EventHandlerSpec {
  match: (event: AnyEvent) => boolean;
  channelSlot: string;
  messageKind: string;
  buildEmbed: (
    event: AnyEvent,
    rpcUrl: string,
    customMessage: string | undefined,
  ) => Promise<EmbedBuilder>;
  recentChoice?: { name: string; value: string };
  debugChoice?: { name: string; value: string; sample: () => AnyEvent };
}

const slots = new Map<string, ChannelSlotSpec>();
const kinds = new Map<string, MessageKindSpec>();
const handlers: EventHandlerSpec[] = [];

export const DEFAULT_CHANNEL_SLOT = "default";

slots.set(DEFAULT_CHANNEL_SLOT, {
  id: DEFAULT_CHANNEL_SLOT,
  envVar: "DISCORD_CHANNEL_ID",
  description: "Fallback channel when no slot-specific override is set",
});

export const registerChannelSlot = (spec: ChannelSlotSpec): void => {
  slots.set(spec.id, spec);
};

export const registerMessageKind = (spec: MessageKindSpec): void => {
  kinds.set(spec.id, spec);
};

export const registerEventHandler = (spec: EventHandlerSpec): void => {
  handlers.push(spec);
};

export const allChannelSlots = (): ChannelSlotSpec[] => [...slots.values()];

export const allMessageKinds = (): MessageKindSpec[] => [...kinds.values()];

export const allEventHandlers = (): EventHandlerSpec[] => [...handlers];

export const channelSlotFor = (id: string): ChannelSlotSpec | undefined =>
  slots.get(id);

export const messageKindFor = (id: string): MessageKindSpec | undefined =>
  kinds.get(id);

export const handlerForEvent = (
  event: AnyEvent,
): EventHandlerSpec | undefined => handlers.find((h) => h.match(event));

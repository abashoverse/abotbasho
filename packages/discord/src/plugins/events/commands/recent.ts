import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { parseEvents, type EventsResponse } from "@abotbasho/shared";
import { env } from "../../../env.js";
import { messageFor } from "../../../messages.js";
import { allEventHandlers, handlerForEvent } from "../../extensions.js";

const buildData = () => {
  const choices: { name: string; value: string }[] = [
    { name: "all", value: "all" },
  ];
  for (const h of allEventHandlers()) {
    if (h.recentChoice) choices.push(h.recentChoice);
  }

  return new SlashCommandBuilder()
    .setName("recent")
    .setDescription("Show recent NFT events")
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Filter by event type")
        .setRequired(false)
        .addChoices(...choices),
    )
    .addIntegerOption((o) =>
      o
        .setName("count")
        .setDescription("How many to show (1-10)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10),
    );
};

export const recent = {
  data: {
    name: "recent",
    toJSON: () => buildData().toJSON(),
  },
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    const type = interaction.options.getString("type") ?? "all";
    const count = interaction.options.getInteger("count") ?? 5;

    const url = `${env.INDEXER_API_URL}/api/recent?limit=${count}&type=${type}`;
    let json: EventsResponse;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        await interaction.editReply(`Indexer error: HTTP ${res.status}`);
        return;
      }
      json = (await res.json()) as EventsResponse;
    } catch (err) {
      await interaction.editReply("Could not reach the indexer.");
      console.error("[discord] /recent fetch failed:", err);
      return;
    }

    const events = parseEvents(json)
      .sort((a, b) => (a.cursor < b.cursor ? 1 : a.cursor > b.cursor ? -1 : 0))
      .slice(0, count);

    if (events.length === 0) {
      await interaction.editReply("No events to show.");
      return;
    }

    const embeds = await Promise.all(
      events.map(async (ev) => {
        const handler = handlerForEvent(ev);
        if (!handler) {
          throw new Error(`no handler for event type=${ev.type}`);
        }
        return handler.buildEmbed(
          ev,
          env.MAINNET_RPC_URL,
          messageFor(handler.messageKind),
        );
      }),
    );

    await interaction.editReply({ embeds });
  },
};

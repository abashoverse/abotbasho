import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { env } from "../../../env.js";
import { messageFor } from "../../../messages.js";
import { channelIdForSlot, resolveChannel } from "../../../channels.js";
import { allEventHandlers, handlerForEvent } from "../../extensions.js";

const debuggableHandlers = () => allEventHandlers().filter((h) => h.debugChoice);

const buildData = () => {
  const handlers = debuggableHandlers();
  const choices = handlers.map((h) => ({
    name: h.debugChoice!.name,
    value: h.debugChoice!.value,
  }));
  if (handlers.length > 1) {
    choices.push({ name: "all", value: "all" });
  }

  return new SlashCommandBuilder()
    .setName("debug")
    .setDescription("Post a sample event through the routing pipeline")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Which sample event to post")
        .setRequired(true)
        .addChoices(...choices),
    );
};

export const debug = {
  data: {
    name: "debug",
    toJSON: () => buildData().toJSON(),
  },
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const which = interaction.options.getString("type", true);
    const handlers = debuggableHandlers();

    const events =
      which === "all"
        ? handlers.map((h) => h.debugChoice!.sample())
        : [
            handlers.find((h) => h.debugChoice!.value === which)?.debugChoice?.sample(),
          ].filter((e): e is NonNullable<typeof e> => !!e);

    const lines: string[] = [];

    for (const ev of events) {
      const handler = handlerForEvent(ev);
      const label =
        ev.type === "sale"
          ? "sale"
          : ((ev as unknown as { kind?: string }).kind ?? ev.type);
      if (!handler) {
        lines.push(`unknown handler for ${label}`);
        continue;
      }
      const channelId = channelIdForSlot(handler.channelSlot);
      const channel = await resolveChannel(interaction.client, channelId);
      if (!channel) {
        lines.push(`${label} -> <#${channelId}> (channel not text-based / not accessible)`);
        continue;
      }
      try {
        const embed = await handler.buildEmbed(
          ev,
          env.MAINNET_RPC_URL,
          messageFor(handler.messageKind),
        );
        await channel.send({ embeds: [embed] });
        lines.push(`${label} -> <#${channelId}>`);
      } catch (err) {
        lines.push(`${label} -> <#${channelId}> (${(err as Error).message})`);
      }
    }

    await interaction.editReply({
      content: `Posted via routing pipeline:\n${lines.join("\n")}`,
    });
  },
};

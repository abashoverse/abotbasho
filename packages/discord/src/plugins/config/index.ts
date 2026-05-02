import {
  ChannelType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { getProjectConfig } from "@abotbasho/shared";
import { env } from "../../env.js";
import {
  type ChannelSlot,
  type EventKind,
  getConfig,
  updateConfig,
} from "../../config.js";
import { allMessages, messageFor } from "../../messages.js";
import {
  allChannelSlots,
  allMessageKinds,
  channelSlotFor,
  handlerForEvent,
  messageKindFor,
} from "../extensions.js";
import type { DiscordPlugin } from "../types.js";

const projectMessageFor = (kind: string): string | undefined =>
  (getProjectConfig().messages as Record<string, string | undefined> | undefined)?.[kind];

const envChannelFor = (slot: string): string | undefined => {
  const spec = channelSlotFor(slot);
  if (!spec?.envVar) return undefined;
  const v = process.env[spec.envVar];
  return v && v.length > 0 ? v : undefined;
};

const renderValue = (
  runtimeValue: string | null | undefined,
  fallbackValue: string | undefined,
  fallbackLabel: string,
  formatter: (v: string) => string = (v) => v,
): string => {
  if (runtimeValue) return `${formatter(runtimeValue)} *(runtime)*`;
  if (fallbackValue) return `${formatter(fallbackValue)} *(${fallbackLabel})*`;
  return "*not set*";
};

const handleView = async (interaction: ChatInputCommandInteraction) => {
  const cfg = getConfig();

  const messageLines = allMessageKinds().map(
    (k) =>
      `**${k.id}**: ${renderValue(cfg.messages[k.id] ?? null, projectMessageFor(k.id), "config.ts")}`,
  );

  const channelLines = allChannelSlots().map((s) =>
    `**${s.id}**: ${renderValue(cfg.channels[s.id] ?? null, envChannelFor(s.id), "env", (v) => `<#${v}>`)}`,
  );

  const embed = new EmbedBuilder()
    .setTitle(`${getProjectConfig().project.name} configuration`)
    .setColor(0x5865f2)
    .addFields(
      {
        name: "Messages",
        value: messageLines.length > 0 ? messageLines.join("\n") : "*none registered*",
        inline: false,
      },
      {
        name: "Channels",
        value: channelLines.length > 0 ? channelLines.join("\n") : "*none registered*",
        inline: false,
      },
    )
    .setFooter({
      text: "runtime overrides take precedence; clear a value to fall back to its source",
    });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
};

const handleMessage = async (interaction: ChatInputCommandInteraction) => {
  const kind = interaction.options.getString("type", true) as EventKind;
  const text = interaction.options.getString("text") ?? null;

  const next = await updateConfig((cfg) => {
    cfg.messages[kind] = text && text.length > 0 ? text : null;
  });

  const value = next.messages[kind];
  await interaction.reply({
    content: value
      ? `Set **${kind}** message to: ${value}`
      : `Cleared **${kind}** message (will fall back to abotbasho.config.ts: ${projectMessageFor(kind) ?? "none"}).`,
    flags: MessageFlags.Ephemeral,
  });
};

const handleChannel = async (interaction: ChatInputCommandInteraction) => {
  const slot = interaction.options.getString("type", true) as ChannelSlot;
  const channel = interaction.options.getChannel("channel");

  const next = await updateConfig((cfg) => {
    cfg.channels[slot] = channel?.id ?? null;
  });

  const value = next.channels[slot];
  const fallback = envChannelFor(slot);
  await interaction.reply({
    content: value
      ? `Set **${slot}** channel to <#${value}>.`
      : `Cleared **${slot}** channel (will fall back to env: ${fallback ? `<#${fallback}>` : "none"}).`,
    flags: MessageFlags.Ephemeral,
  });
};

const handlePreview = async (interaction: ChatInputCommandInteraction) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const kind = interaction.options.getString("type", true);
  const spec = messageKindFor(kind);
  if (!spec || !spec.sample) {
    await interaction.editReply(`No sample available for kind "${kind}".`);
    return;
  }
  const event = spec.sample();
  const handler = handlerForEvent(event);
  if (!handler) {
    await interaction.editReply(`No handler registered for kind "${kind}".`);
    return;
  }
  const messages = allMessages();
  const embed = await handler.buildEmbed(
    event,
    env.MAINNET_RPC_URL,
    messageFor(handler.messageKind),
  );
  const summary = allMessageKinds()
    .map((k) => `${k.id}: ${messages[k.id] ?? "none"}`)
    .join(", ");
  await interaction.editReply({
    content: `Preview using current config (${summary}):`,
    embeds: [embed],
  });
};

const buildData = () => {
  const messageKindChoices = allMessageKinds().map((k) => ({
    name: k.id,
    value: k.id,
  }));
  const channelSlotChoices = allChannelSlots().map((s) => ({
    name: s.id,
    value: s.id,
  }));

  return new SlashCommandBuilder()
    .setName("config")
    .setDescription("Manage runtime configuration")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s.setName("view").setDescription("Show current effective configuration"),
    )
    .addSubcommand((s) =>
      s
        .setName("message")
        .setDescription("Set or clear a custom message")
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Event type")
            .setRequired(true)
            .addChoices(...messageKindChoices),
        )
        .addStringOption((o) =>
          o
            .setName("text")
            .setDescription("New text. Omit to clear and fall back to env.")
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("channel")
        .setDescription("Route an event type to a channel")
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Slot to set")
            .setRequired(true)
            .addChoices(...channelSlotChoices),
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Target channel. Omit to clear and fall back to env.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("preview")
        .setDescription("Preview a sample embed with current config")
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Event type")
            .setRequired(true)
            .addChoices(...messageKindChoices),
        ),
    );
};

const config = {
  data: {
    name: "config",
    toJSON: () => buildData().toJSON(),
  },
  execute: async (interaction: ChatInputCommandInteraction) => {
    const sub = interaction.options.getSubcommand();
    if (sub === "view") return handleView(interaction);
    if (sub === "message") return handleMessage(interaction);
    if (sub === "channel") return handleChannel(interaction);
    if (sub === "preview") return handlePreview(interaction);
  },
};

export const configPlugin: DiscordPlugin = {
  name: "config",
  description: "Admin /config command for runtime overrides",
  commands: [config],
};

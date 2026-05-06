import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { getProjectConfig } from "@abotbasho/shared";
import { startSiwe } from "./client.js";

// Shared by the /verify slash command and the verify:start button. Issues a
// fresh SIWE link bound to the invoker's discord id and replies ephemerally
// (visible only to the user). No DMs; keeps the link inside the same
// surface the user clicked from.
export const replyWithVerifyLink = async (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> => {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This action can only be used in a guild.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const cfg = getProjectConfig();

  try {
    const { url } = await startSiwe({
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
    });
    await interaction.editReply(
      [
        `Sign in to verify your **${cfg.project.name}** holdings.`,
        "",
        `Open the link below (valid for 10 minutes):`,
        `<${url}>`,
        "",
        "delegate.cash hot/cold delegation is supported on the page.",
      ].join("\n"),
    );
  } catch (err) {
    console.error("[verify] startSiwe failed:", err);
    await interaction.editReply("Verification is currently unavailable.");
  }
};

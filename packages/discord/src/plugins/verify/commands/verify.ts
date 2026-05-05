import {
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { getProjectConfig } from "@abotbasho/shared";
import { startSiwe } from "../client.js";

export const verify = {
  data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify NFT holdings to get the holder role"),
  execute: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a guild.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const cfg = getProjectConfig();
    let result: { url: string; expiresAt: string };
    try {
      result = await startSiwe({
        discordUserId: interaction.user.id,
        guildId: interaction.guildId,
      });
    } catch (err) {
      console.error("[verify] startSiwe failed:", err);
      await interaction.editReply("Verification is currently unavailable.");
      return;
    }
    const lines = [
      `Sign in to verify your **${cfg.project.name}** holdings.`,
      "",
      "Open the link below (valid for 10 minutes):",
      `<${result.url}>`,
      "",
      "delegate.cash hot/cold delegation is supported on the page.",
    ];
    try {
      const dm = await interaction.user.createDM();
      await dm.send(lines.join("\n"));
      await interaction.editReply(
        "Sent you a DM with the verification link. Open it on any device.",
      );
    } catch {
      await interaction.editReply(lines.join("\n"));
    }
  },
};

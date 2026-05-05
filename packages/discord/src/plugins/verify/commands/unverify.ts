import {
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { unlink } from "../client.js";

export const unverify = {
  data: new SlashCommandBuilder()
    .setName("unverify")
    .setDescription("Remove all your verified wallet links and the holder role"),
  execute: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a guild.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await unlink({
        discordUserId: interaction.user.id,
        guildId: interaction.guildId,
      });
      await interaction.editReply(
        "Your wallet links have been removed. The holder role will be revoked shortly.",
      );
    } catch (err) {
      console.error("[unverify]", err);
      await interaction.editReply("Unverify is currently unavailable.");
    }
  },
};

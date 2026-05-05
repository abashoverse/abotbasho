import {
  type ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { getProjectConfig } from "@abotbasho/shared";
import { finalizeBio, startBio } from "../client.js";

export const verifyBio = {
  data: new SlashCommandBuilder()
    .setName("verify-bio")
    .setDescription("Verify holdings via OpenSea bio (no signature required)")
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Get a code to put in your OpenSea bio"),
    )
    .addSubcommand((s) =>
      s
        .setName("submit")
        .setDescription("Submit your wallet after adding the code to your bio")
        .addStringOption((o) =>
          o
            .setName("wallet")
            .setDescription("Your 0x wallet address")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("code")
            .setDescription("The code we DM'd you when you ran /verify-bio start")
            .setRequired(true),
        ),
    ),
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
    const sub = interaction.options.getSubcommand();

    if (sub === "start") {
      try {
        const { code } = await startBio({
          discordUserId: interaction.user.id,
          guildId: interaction.guildId,
        });
        const message = [
          `Add this code anywhere in your **OpenSea bio** for the wallet that holds **${cfg.project.name}**:`,
          "",
          `\`${code}\``,
          "",
          "Then run `/verify-bio submit` with your wallet address and this code.",
          "Code expires in 24 hours.",
        ].join("\n");
        try {
          const dm = await interaction.user.createDM();
          await dm.send(message);
          await interaction.editReply(
            "Sent you a DM with the code and instructions.",
          );
        } catch {
          await interaction.editReply(message);
        }
      } catch (err) {
        console.error("[verify-bio start]", err);
        await interaction.editReply(
          "Bio verification is currently unavailable.",
        );
      }
      return;
    }

    if (sub === "submit") {
      const wallet = interaction.options.getString("wallet", true);
      const code = interaction.options.getString("code", true);
      if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
        await interaction.editReply(
          "That doesn't look like a valid 0x wallet address.",
        );
        return;
      }
      try {
        const result = await finalizeBio({
          discordUserId: interaction.user.id,
          guildId: interaction.guildId,
          walletAddress: wallet,
          code,
        });
        if ("ok" in result && result.ok) {
          await interaction.editReply(
            `Verified — wallet \`${result.holder_address}\` linked. Your role appears shortly.`,
          );
        } else {
          await interaction.editReply(`Verification failed: ${result.error}`);
        }
      } catch (err) {
        console.error("[verify-bio submit]", err);
        await interaction.editReply(
          "Bio verification is currently unavailable.",
        );
      }
    }
  },
};

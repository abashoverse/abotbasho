import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { getProjectConfig } from "@abotbasho/shared";
import { getLinks, unlink } from "../client.js";
import { applyRoleEvent } from "../role.js";
import { VERIFY_BUTTON_ID } from "../buttons.js";

const EMBED_COLOR = 0x5865f2;

export const verifyAdmin = {
  data: new SlashCommandBuilder()
    .setName("verify-admin")
    .setDescription("Admin tools for the verify feature")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName("status")
        .setDescription("Show a user's verified wallet links")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("User to inspect")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("force-revoke")
        .setDescription("Force-remove a user's links and role immediately")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("User to revoke")
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("post")
        .setDescription("Post the persistent Verify embed in this channel"),
    ),
  execute: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Guild only.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();

    if (sub === "post") {
      const cfg = getProjectConfig();
      const channel = interaction.channel;
      if (!channel || !(channel instanceof TextChannel)) {
        await interaction.editReply(
          "Run this in a regular text channel where the bot can send messages.",
        );
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`${cfg.project.name} verification`)
        .setDescription(
          [
            `Click **Verify** to prove on-chain ownership of a **${cfg.project.name}** NFT and unlock the holder role.`,
            "",
            "Your private key never leaves your wallet. Verification is a signed message via SIWE (sign-in with Ethereum). delegate.cash hot/cold delegation is supported on the page.",
          ].join("\n"),
        );
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(VERIFY_BUTTON_ID)
          .setLabel("Verify")
          .setStyle(ButtonStyle.Primary),
      );
      if (cfg.verify?.sourceCodeUrl) {
        row.addComponents(
          new ButtonBuilder()
            .setLabel("Source code")
            .setStyle(ButtonStyle.Link)
            .setURL(cfg.verify.sourceCodeUrl),
        );
      }
      try {
        await channel.send({ embeds: [embed], components: [row] });
        await interaction.editReply("Posted.");
      } catch (err) {
        console.error("[verify-admin post]", err);
        await interaction.editReply(
          "Failed to post. Check the bot has Send Messages + Embed Links here.",
        );
      }
      return;
    }

    const target = interaction.options.getUser("user", true);

    if (sub === "status") {
      try {
        const links = await getLinks(target.id);
        if (links.length === 0) {
          await interaction.editReply(`<@${target.id}> has no verified links.`);
          return;
        }
        const lines = links.map(
          (l) =>
            `• \`${l.holder_address}\` (${l.method})` +
            (l.signer_address ? ` (signer \`${l.signer_address}\`)` : "") +
            `, verified ${l.verified_at}`,
        );
        await interaction.editReply(
          [`<@${target.id}> links:`, ...lines].join("\n"),
        );
      } catch (err) {
        console.error("[verify-admin status]", err);
        await interaction.editReply("Failed to fetch links.");
      }
      return;
    }

    if (sub === "force-revoke") {
      try {
        await unlink({
          discordUserId: target.id,
          guildId: interaction.guildId,
        });
        const cfg = getProjectConfig();
        const roleId = cfg.verify?.roleId;
        if (roleId) {
          const r = await applyRoleEvent(interaction.client, {
            guildId: interaction.guildId,
            roleId,
            userId: target.id,
            desiredState: "revoke",
          });
          if (!r.ok) {
            await interaction.editReply(
              `Unlink succeeded but role removal hit: ${r.reason}. Poller will retry.`,
            );
            return;
          }
        }
        await interaction.editReply(`Force-revoked <@${target.id}>.`);
      } catch (err) {
        console.error("[verify-admin force-revoke]", err);
        await interaction.editReply("Force-revoke failed.");
      }
    }
  },
};

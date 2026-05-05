import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { getProjectConfig } from "@abotbasho/shared";
import { getLinks, unlink } from "../client.js";
import { applyRoleEvent } from "../role.js";

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
            `• \`${l.holder_address}\` — ${l.method}` +
            (l.signer_address ? ` (signer \`${l.signer_address}\`)` : "") +
            ` — verified ${l.verified_at}`,
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

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
import { getAllLinks, getLinks, unlink } from "../client.js";
import { applyRoleEvent } from "../role.js";
import { VERIFY_BUTTON_ID } from "../buttons.js";

const EMBED_COLOR = 0x5865f2;
const SWEEP_GAP_MS = 100; // ~10 ops/s, same cadence as the role-events poller.

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
    )
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("List users verified through abotbasho"),
    )
    .addSubcommand((s) =>
      s
        .setName("sweep")
        .setDescription(
          "Find/remove the holder role from members not in verification.links",
        )
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("dry-run reports; apply removes roles")
            .setRequired(true)
            .addChoices(
              { name: "dry-run", value: "dry-run" },
              { name: "apply", value: "apply" },
            ),
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

    if (sub === "list") {
      try {
        const data = await getAllLinks();
        if (data.total === 0) {
          await interaction.editReply(
            "No users verified through abotbasho yet.",
          );
          return;
        }
        const methodCounts = new Map<string, number>();
        for (const u of data.users) {
          for (const m of u.methods) {
            methodCounts.set(m, (methodCounts.get(m) ?? 0) + 1);
          }
        }
        const methodSummary =
          [...methodCounts.entries()]
            .map(([m, n]) => `${n} ${m}`)
            .join(", ") || "none";
        const sample = data.users
          .slice(0, 20)
          .map(
            (u) =>
              `• <@${u.platform_user_id}> (${u.methods.join("/")}, ${u.wallets} wallet${u.wallets === 1 ? "" : "s"})`,
          )
          .join("\n");
        const more =
          data.users.length > 20 ? `\n…and ${data.users.length - 20} more` : "";
        await interaction.editReply(
          [
            `**${data.total}** user${data.total === 1 ? "" : "s"} verified through abotbasho`,
            `By method: ${methodSummary}`,
            `First verification: ${data.users[0]!.first_verified.slice(0, 10)}`,
            "",
            sample + more,
          ].join("\n"),
        );
      } catch (err) {
        console.error("[verify-admin list]", err);
        await interaction.editReply("Failed to fetch verified users.");
      }
      return;
    }

    if (sub === "sweep") {
      const cfg = getProjectConfig();
      const roleId = cfg.verify?.discord?.roleId;
      if (!roleId) {
        await interaction.editReply("verify.discord.roleId not configured.");
        return;
      }
      const mode = interaction.options.getString("mode", true) as
        | "dry-run"
        | "apply";

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply("Guild not found.");
        return;
      }
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        await interaction.editReply(
          "Configured holder role not found in this guild.",
        );
        return;
      }
      const me = await guild.members.fetchMe().catch(() => null);
      if (!me) {
        await interaction.editReply("Bot self-fetch failed.");
        return;
      }
      if (me.roles.highest.position <= role.position) {
        await interaction.editReply(
          "Bot's highest role is at or below the holder role; cannot manage it.",
        );
        return;
      }

      let allMembers;
      try {
        // Requires GuildMembers privileged intent. Without it this rejects
        // with an intent error and the catch below explains the fix.
        allMembers = await guild.members.fetch();
      } catch (err) {
        console.error("[verify-admin sweep] members.fetch failed:", err);
        await interaction.editReply(
          "Couldn't enumerate guild members. Enable SERVER MEMBERS INTENT in the Discord Developer Portal (Bot → toggle on) and restart the bot.",
        );
        return;
      }
      const roleHolders = allMembers.filter((m) => m.roles.cache.has(roleId));

      let verified;
      try {
        verified = await getAllLinks();
      } catch (err) {
        console.error("[verify-admin sweep] getAllLinks failed:", err);
        await interaction.editReply(
          "Couldn't fetch verified users from the indexer.",
        );
        return;
      }
      const verifiedSet = new Set(verified.users.map((u) => u.platform_user_id));

      // Skip the bot itself (defensive; it shouldn't have the holder role
      // but some moderators assign roles oddly).
      const toRemove = roleHolders.filter(
        (m) => !verifiedSet.has(m.id) && m.id !== me.id,
      );

      if (toRemove.size === 0) {
        await interaction.editReply(
          `All ${roleHolders.size} role holder${roleHolders.size === 1 ? "" : "s"} are verified. Nothing to remove.`,
        );
        return;
      }

      if (mode === "dry-run") {
        const sample = [...toRemove.values()]
          .slice(0, 20)
          .map((m) => `• <@${m.id}>`)
          .join("\n");
        const more =
          toRemove.size > 20 ? `\n…and ${toRemove.size - 20} more` : "";
        await interaction.editReply(
          [
            `**Dry-run**`,
            `Role holders: ${roleHolders.size}`,
            `Verified through abotbasho: ${verified.total}`,
            `Would remove role from: **${toRemove.size}** member${toRemove.size === 1 ? "" : "s"}`,
            "",
            sample + more,
            "",
            "Run `/verify-admin sweep mode:apply` to actually remove.",
          ].join("\n"),
        );
        return;
      }

      // apply mode
      let removed = 0;
      let failed = 0;
      const errors: string[] = [];
      for (const member of toRemove.values()) {
        try {
          await member.roles.remove(
            roleId,
            "verify-admin sweep: not in verification.links",
          );
          removed++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          if (errors.length < 5) errors.push(`<@${member.id}>: ${msg}`);
          console.error(
            `[verify-admin sweep apply] failed for ${member.id}:`,
            err,
          );
        }
        await new Promise((r) => setTimeout(r, SWEEP_GAP_MS));
      }
      const lines = [
        `**Sweep complete**`,
        `Removed: ${removed}`,
        `Failed: ${failed}`,
      ];
      if (errors.length > 0) {
        lines.push("", "First failures:", ...errors);
      }
      await interaction.editReply(lines.join("\n"));
      return;
    }

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
        const roleId = cfg.verify?.discord?.roleId;
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

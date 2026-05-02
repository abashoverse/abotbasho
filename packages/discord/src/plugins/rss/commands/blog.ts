import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { getProjectConfig, pluginConfig } from "@abotbasho/shared";
import { channelIdForSlot, resolveChannel } from "../../../channels.js";
import { fetchFeed } from "../feed.js";
import { contentForFeedEntry, contentForUnfurl } from "../poster.js";
import { UnsafeUrlError, unfurl } from "../unfurl.js";
import { RSS_PLUGIN_NAME, type RssPluginConfig } from "../index.js";

const userAgent = (): string => {
  const cfg = getProjectConfig();
  const url = cfg.project.url ? ` +${cfg.project.url}` : "";
  return `Mozilla/5.0 (compatible; ${cfg.project.name}/1.0;${url})`;
};

const isHttpUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeUrl = (u: string): string => {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.hostname}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};

const sameHost = (a: string, b: string): boolean => {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
};

const matchFeedEntry = async (postUrl: string): Promise<string | null> => {
  const feedUrl = pluginConfig<RssPluginConfig>(RSS_PLUGIN_NAME)?.url;
  if (!feedUrl || !sameHost(feedUrl, postUrl)) return null;
  try {
    const entries = await fetchFeed(feedUrl);
    const target = normalizeUrl(postUrl);
    const entry = entries.find((e) => normalizeUrl(e.link) === target);
    if (entry) return contentForFeedEntry(entry);
  } catch {
    // fall through to unfurl
  }
  return null;
};

export const blog = {
  data: new SlashCommandBuilder()
    .setName("blog")
    .setDescription("Post a blog post (or any URL) to the blog channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName("url")
        .setDescription("URL of the post to share")
        .setRequired(true),
    ),
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const url = interaction.options.getString("url", true).trim();

    if (!isHttpUrl(url)) {
      await interaction.editReply("Please provide a valid http(s) URL.");
      return;
    }

    let content = await matchFeedEntry(url);
    let source = "feed";
    if (!content) {
      try {
        const data = await unfurl(url, userAgent());
        content = contentForUnfurl(data);
        source = "unfurl";
      } catch (err) {
        if (err instanceof UnsafeUrlError) {
          await interaction.editReply(`Refused: ${err.message}`);
          return;
        }
        await interaction.editReply(`Failed to fetch URL: ${(err as Error).message}`);
        return;
      }
    }

    const channelId = channelIdForSlot("blog");
    const channel = await resolveChannel(interaction.client, channelId);
    if (!channel) {
      await interaction.editReply(
        `Blog channel <#${channelId}> not text-based or not accessible.`,
      );
      return;
    }

    await channel.send({ content });
    await interaction.editReply(`Posted to <#${channelId}> (source: ${source}).`);
  },
};

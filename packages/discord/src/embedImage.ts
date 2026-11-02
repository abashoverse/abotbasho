import { AttachmentBuilder, type EmbedBuilder } from "discord.js";
import type { TokenImage } from "@abotbasho/shared";

/**
 * An embed plus the files it references. Token images are uploaded as message
 * attachments and shown via `attachment://<name>`, because Discord can't
 * render SVG or data: URIs, and the old IPFS gateway URLs no longer resolve.
 */
export interface BuiltEmbed {
  embed: EmbedBuilder;
  files: AttachmentBuilder[];
}

export const withTokenImage = (
  embed: EmbedBuilder,
  image: TokenImage | null,
): BuiltEmbed => {
  if (!image) return { embed, files: [] };
  embed.setImage(`attachment://${image.fileName}`);
  return { embed, files: [new AttachmentBuilder(image.data, { name: image.fileName })] };
};

/**
 * Message payload for one or more built embeds. File names derive from the
 * token id, so two embeds for the same token share one upload.
 */
export const embedPayload = (
  built: BuiltEmbed | BuiltEmbed[],
): { embeds: EmbedBuilder[]; files: AttachmentBuilder[] } => {
  const list = Array.isArray(built) ? built : [built];
  const files = new Map<string, AttachmentBuilder>();
  for (const b of list) for (const f of b.files) if (f.name) files.set(f.name, f);
  return { embeds: list.map((b) => b.embed), files: [...files.values()] };
};

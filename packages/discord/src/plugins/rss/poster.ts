import type { FeedEntry } from "./feed.js";
import type { Unfurled } from "./unfurl.js";

const DESC_LIMIT = 400;

const truncate = (s: string | undefined, max: number): string | undefined => {
  if (!s) return undefined;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const escapeMarkdown = (s: string): string =>
  s.replace(/([\\*_`~|])/g, "\\$1");

export const contentForFeedEntry = (entry: FeedEntry): string => {
  const lines = [`New post on ${hostOf(entry.link)}!`];
  if (entry.title) lines.push(`**${escapeMarkdown(entry.title)}**`);
  const desc = truncate(entry.description, DESC_LIMIT);
  if (desc) lines.push(desc);
  lines.push(entry.link);
  return lines.join("\n");
};

export const contentForUnfurl = (data: Unfurled): string => {
  const lines = [`New post on ${hostOf(data.url)}!`];
  if (data.title) lines.push(`**${escapeMarkdown(data.title)}**`);
  const desc = truncate(data.description, DESC_LIMIT);
  if (desc) lines.push(desc);
  lines.push(data.url);
  return lines.join("\n");
};

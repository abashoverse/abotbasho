import type { DiscordPlugin } from "./types.js";
import { eventsPlugin } from "./events/index.js";
import { wrapperPlugin } from "./wrapper/index.js";
import { tokensPlugin } from "./tokens/index.js";
import { configPlugin } from "./config/index.js";
import { rssPlugin } from "./rss/index.js";

export const plugins: DiscordPlugin[] = [
  eventsPlugin,
  wrapperPlugin,
  tokensPlugin,
  configPlugin,
  rssPlugin,
];

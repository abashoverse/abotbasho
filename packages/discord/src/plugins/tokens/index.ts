import type { DiscordPlugin } from "../types.js";
import { view } from "./commands/view.js";

export const tokensPlugin: DiscordPlugin = {
  name: "tokens",
  description: "Token info commands; provides /view <id>",
  commands: [view],
};

import type { DiscordPlugin } from "../types.js";
import {
  registerChannelSlot,
  registerEventHandler,
  registerMessageKind,
} from "../extensions.js";
import { saleHandler, sampleSale } from "./handlers/sale.js";
import { startEventPoller, stopEventPoller } from "./poller.js";
import { recent } from "./commands/recent.js";
import { debug } from "./commands/debug.js";

registerChannelSlot({
  id: "sales",
  envVar: "DISCORD_SALES_CHANNEL_ID",
  description: "Channel for sale events",
});
registerMessageKind({ id: "sale", sample: sampleSale });
registerEventHandler(saleHandler);

export const eventsPlugin: DiscordPlugin = {
  name: "events",
  description: "Posts NFT events from the indexer; provides /recent and /debug",
  init: async (ctx) => {
    startEventPoller(ctx);
  },
  shutdown: async () => {
    stopEventPoller();
  },
  commands: [recent, debug],
};

import { getProjectConfig } from "@abotbasho/shared";
import {
  registerChannelSlot,
  registerEventHandler,
  registerMessageKind,
} from "../extensions.js";
import { unwrapHandler, wrapHandler } from "./handlers.js";
import { sampleUnwrap, sampleWrap } from "./samples.js";
import { wrapped } from "./commands/wrapped.js";
import type { DiscordPlugin } from "../types.js";

const enabled = !!getProjectConfig().wrapper;

if (enabled) {
  registerChannelSlot({
    id: "wraps",
    envVar: "DISCORD_WRAPS_CHANNEL_ID",
    description: "Channel for wrap events",
  });
  registerChannelSlot({
    id: "unwraps",
    envVar: "DISCORD_UNWRAPS_CHANNEL_ID",
    description: "Channel for unwrap events",
  });
  registerMessageKind({ id: "wrap", sample: sampleWrap });
  registerMessageKind({ id: "unwrap", sample: sampleUnwrap });
  registerEventHandler(wrapHandler);
  registerEventHandler(unwrapHandler);
}

export const wrapperPlugin: DiscordPlugin = {
  name: "wrapper",
  description:
    "Wrap/unwrap event posting and /wrapped <id> command (active when abotbasho.config.ts has a wrapper)",
  enabled,
  commands: enabled ? [wrapped] : [],
};

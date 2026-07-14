import {
  DEFAULT_VERIFY_POLL_INTERVAL_MS,
  getProjectConfig,
} from "@abotbasho/shared";
import type { DiscordPlugin } from "../types.js";
import { env } from "../../env.js";
import { drainRoleEvents } from "./poller.js";
import { verifyButton } from "./buttons.js";
import { verify } from "./commands/verify.js";
import { unverify } from "./commands/unverify.js";
import { verifyAdmin } from "./commands/verify-admin.js";

export const VERIFY_PLUGIN_NAME = "verify";

const cfg = getProjectConfig().verify;
// The discord plugin only activates when verify itself is on AND a discord
// block is present. Telegram-only deployments leave this dormant.
const enabled = cfg?.enabled === true && cfg.discord !== undefined;
const intervalMs = cfg?.pollIntervalMs ?? DEFAULT_VERIFY_POLL_INTERVAL_MS;

const commands = enabled ? [verify, unverify, verifyAdmin] : [];

export const verifyPlugin: DiscordPlugin = {
  name: VERIFY_PLUGIN_NAME,
  description: "NFT holder verification: SIWE / delegate.cash / OpenSea bio",
  enabled,
  init: async (ctx) => {
    if (!cfg || !cfg.discord) return;
    if (!env.VERIFY_INTERNAL_SECRET) {
      ctx.errorLog(
        "VERIFY_INTERNAL_SECRET is not set; /verify commands will fail",
      );
    }
    ctx.log(
      `enabled (role=${cfg.discord.roleId}, poll=${intervalMs}ms, delegate=${
        cfg.delegateCash !== false
      }, bio=${cfg.openseaBio === true})`,
    );
  },
  intervals: enabled
    ? [
        {
          name: "role-poller",
          intervalMs,
          runImmediately: false,
          handler: async (ctx) => {
            await drainRoleEvents({
              client: ctx.client,
              ctx,
              roleId: cfg!.discord!.roleId,
            });
          },
        },
      ]
    : [],
  commands,
  buttons: enabled ? [verifyButton] : [],
};

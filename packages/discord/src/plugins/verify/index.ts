import {
  DEFAULT_VERIFY_POLL_INTERVAL_MS,
  getProjectConfig,
} from "@abotbasho/shared";
import type { DiscordPlugin } from "../types.js";
import { env } from "../../env.js";
import { drainRoleEvents } from "./poller.js";
import { verify } from "./commands/verify.js";
import { verifyBio } from "./commands/verify-bio.js";
import { unverify } from "./commands/unverify.js";
import { verifyAdmin } from "./commands/verify-admin.js";

export const VERIFY_PLUGIN_NAME = "verify";

const cfg = getProjectConfig().verify;
const enabled = cfg?.enabled === true;
const intervalMs = cfg?.pollIntervalMs ?? DEFAULT_VERIFY_POLL_INTERVAL_MS;

const commands = enabled
  ? [
      verify,
      ...(cfg!.openseaBio ? [verifyBio] : []),
      unverify,
      verifyAdmin,
    ]
  : [];

export const verifyPlugin: DiscordPlugin = {
  name: VERIFY_PLUGIN_NAME,
  description: "NFT holder verification: SIWE / delegate.cash / OpenSea bio",
  enabled,
  init: async (ctx) => {
    if (!cfg) return;
    if (!env.VERIFY_INTERNAL_SECRET) {
      ctx.errorLog(
        "VERIFY_INTERNAL_SECRET is not set; /verify commands will fail",
      );
    }
    ctx.log(
      `enabled (role=${cfg.roleId}, poll=${intervalMs}ms, delegate=${
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
              roleId: cfg!.roleId,
            });
          },
        },
      ]
    : [],
  commands,
};

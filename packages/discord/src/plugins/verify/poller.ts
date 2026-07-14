import type { Client } from "discord.js";
import {
  getRoleEvents,
  markRoleEventApplied,
  type RoleEvent,
} from "./client.js";
import { applyRoleEvent } from "./role.js";
import type { PluginContext } from "../types.js";

const APPLY_GAP_MS = 100; // ~10 ops/s ceiling on top of discord.js's own queue

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

interface PollerArgs {
  client: Client;
  ctx: PluginContext;
  roleId: string;
}

export const drainRoleEvents = async (cfg: PollerArgs): Promise<void> => {
  let events: RoleEvent[];
  try {
    // since=0 always; the indexer filters on applied_at IS NULL so settled
    // events are excluded. Failed applies stay visible and are retried next
    // tick. No client-side cursor to keep in sync.
    events = await getRoleEvents({ since: 0n, limit: 200 });
  } catch (err) {
    cfg.ctx.errorLog("role-events fetch failed:", err);
    return;
  }
  if (events.length === 0) return;

  // Compress: per (guild,user), keep only the latest event; mark all merged
  // event ids applied once we apply the final state.
  const groups = new Map<string, { last: RoleEvent; ids: string[] }>();
  for (const ev of events) {
    const k = `${ev.platform_scope_id}:${ev.platform_user_id}`;
    const entry = groups.get(k);
    if (entry) {
      entry.last = ev;
      entry.ids.push(ev.id);
    } else {
      groups.set(k, { last: ev, ids: [ev.id] });
    }
  }

  let i = 0;
  for (const { last, ids } of groups.values()) {
    if (i > 0) await sleep(APPLY_GAP_MS);
    i++;
    const result = await applyRoleEvent(cfg.client, {
      guildId: last.platform_scope_id,
      roleId: cfg.roleId,
      userId: last.platform_user_id,
      desiredState: last.desired_state,
    });
    if (!result.ok) {
      cfg.ctx.errorLog(
        `apply ${last.desired_state} for ${last.platform_user_id} failed: ${result.reason}`,
      );
      continue;
    }
    for (const id of ids) {
      try {
        await markRoleEventApplied(id);
      } catch (err) {
        cfg.ctx.errorLog(`mark applied for ${id} failed:`, err);
      }
    }
    cfg.ctx.log(
      `applied ${last.desired_state} role to ${last.platform_user_id}` +
        (ids.length > 1 ? ` (compressed ${ids.length} events)` : ""),
    );
  }
};

import type { Bot } from "grammy";
import {
  getRoleEvents,
  markRoleEventApplied,
  type RoleEvent,
} from "./client.js";
import { applyAccessEvent } from "./access.js";

// ~10 ops/s ceiling, same cadence as the Discord poller, well under
// Telegram's per-chat rate limits.
const APPLY_GAP_MS = 100;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export interface DrainArgs {
  bot: Bot;
  chatId: string;
  inviteLinkExpirySec: number;
  kickSemantics: boolean;
  log: (...args: unknown[]) => void;
  errorLog: (...args: unknown[]) => void;
}

export const drainRoleEvents = async (cfg: DrainArgs): Promise<void> => {
  let events: RoleEvent[];
  try {
    // since=0 always; the indexer filters on applied_at IS NULL so settled
    // events are excluded. Failed applies stay visible and are retried.
    events = await getRoleEvents({ since: 0n, limit: 200 });
  } catch (err) {
    cfg.errorLog("role-events fetch failed:", err);
    return;
  }
  if (events.length === 0) return;

  // Compress: per (chat,user), keep only the latest event; mark all merged
  // event ids applied once the final state lands.
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

    // role_events scoped per (platform_scope_id) carry the chat id the
    // indexer originally bound the link to. We pin actuation to the bot's
    // configured chatId so a stale event for a different chat (e.g. config
    // changed) can't ban/invite into a chat the bot isn't supposed to
    // touch. Skip mismatched scopes (mark applied so they don't pile up).
    if (last.platform_scope_id !== cfg.chatId) {
      for (const id of ids) {
        try {
          await markRoleEventApplied(id);
        } catch (err) {
          cfg.errorLog(`mark applied for ${id} failed:`, err);
        }
      }
      cfg.log(
        `skipping ${last.desired_state} for user ${last.platform_user_id}: event scope_id ${last.platform_scope_id} != configured chat ${cfg.chatId}`,
      );
      continue;
    }

    const result = await applyAccessEvent(cfg.bot, {
      chatId: cfg.chatId,
      userId: last.platform_user_id,
      desiredState: last.desired_state,
      inviteLinkExpirySec: cfg.inviteLinkExpirySec,
      kickSemantics: cfg.kickSemantics,
    });
    if (!result.ok) {
      cfg.errorLog(
        `apply ${last.desired_state} for ${last.platform_user_id} failed: ${result.reason}`,
      );
      continue;
    }
    for (const id of ids) {
      try {
        await markRoleEventApplied(id);
      } catch (err) {
        cfg.errorLog(`mark applied for ${id} failed:`, err);
      }
    }
    cfg.log(
      `applied ${last.desired_state} to ${last.platform_user_id}` +
        (result.reason ? ` (${result.reason})` : "") +
        (ids.length > 1 ? ` (compressed ${ids.length} events)` : ""),
    );
  }
};

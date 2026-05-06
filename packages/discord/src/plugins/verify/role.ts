import type { Client } from "discord.js";

export interface RoleApplyResult {
  ok: boolean;
  reason?: string;
}

export const applyRoleEvent = async (
  client: Client,
  params: {
    guildId: string;
    roleId: string;
    userId: string;
    desiredState: "grant" | "revoke";
  },
): Promise<RoleApplyResult> => {
  const guild = await client.guilds.fetch(params.guildId).catch(() => null);
  if (!guild) return { ok: false, reason: "guild_unavailable" };

  const role = await guild.roles.fetch(params.roleId).catch(() => null);
  if (!role) return { ok: false, reason: "role_not_found" };

  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return { ok: false, reason: "self_unavailable" };
  if (me.roles.highest.position <= role.position) {
    return { ok: false, reason: "bot_role_below_target" };
  }

  const member = await guild.members.fetch(params.userId).catch(() => null);
  if (!member) {
    // User left guild. Nothing to apply, treat as success so the event is
    // marked applied and we stop retrying.
    return { ok: true, reason: "member_not_in_guild" };
  }

  try {
    // Always issue the call. discord.js's role cache can drift (no
    // GUILD_MEMBER_UPDATE events without the GuildMembers intent, periodic
    // cache sweeps, restarts), so a `cache.has` guard would short-circuit
    // an actual role mutation when the cache says the member doesn't have a
    // role they actually do have (or vice versa). Discord returns 204 for
    // add-already-has and remove-already-doesnt-have, so unconditional calls
    // are idempotent.
    if (params.desiredState === "grant") {
      await member.roles.add(role.id);
    } else {
      await member.roles.remove(role.id);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
};

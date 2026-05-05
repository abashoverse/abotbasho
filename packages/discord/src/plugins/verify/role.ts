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
    // User left guild — nothing to apply, treat as success so the event is
    // marked applied and we stop retrying.
    return { ok: true, reason: "member_not_in_guild" };
  }

  try {
    if (params.desiredState === "grant") {
      if (!member.roles.cache.has(role.id)) await member.roles.add(role.id);
    } else {
      if (member.roles.cache.has(role.id)) await member.roles.remove(role.id);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
};

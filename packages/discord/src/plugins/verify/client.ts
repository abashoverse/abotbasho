import { env } from "../../env.js";

const headers = (): Record<string, string> => ({
  "content-type": "application/json",
  accept: "application/json",
  "x-verify-auth": env.VERIFY_INTERNAL_SECRET,
});

const url = (path: string): string => {
  const base = env.INDEXER_API_URL.replace(/\/$/, "");
  return `${base}${path}`;
};

export const startSiwe = async (params: {
  discordUserId: string;
  guildId: string;
}): Promise<{ url: string; expiresAt: string }> => {
  const res = await fetch(url("/verify/start"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      discord_user_id: params.discordUserId,
      guild_id: params.guildId,
    }),
  });
  if (!res.ok) throw new Error(`/verify/start ${res.status}`);
  const data = (await res.json()) as { url: string; expires_at: string };
  return { url: data.url, expiresAt: data.expires_at };
};

export const startBio = async (params: {
  discordUserId: string;
  guildId: string;
}): Promise<{ code: string; expiresAt: string }> => {
  const res = await fetch(url("/verify/bio/start"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      discord_user_id: params.discordUserId,
      guild_id: params.guildId,
    }),
  });
  if (!res.ok) throw new Error(`/verify/bio/start ${res.status}`);
  const data = (await res.json()) as { code: string; expires_at: string };
  return { code: data.code, expiresAt: data.expires_at };
};

export interface FinalizeBioOk {
  ok: true;
  holder_address: string;
  method: "bio";
}
export interface FinalizeBioError {
  ok?: false;
  error: string;
  status: number;
}

export const finalizeBio = async (params: {
  discordUserId: string;
  guildId: string;
  walletAddress: string;
  code: string;
}): Promise<FinalizeBioOk | FinalizeBioError> => {
  const res = await fetch(url("/verify/finalize-bio"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      discord_user_id: params.discordUserId,
      guild_id: params.guildId,
      wallet_address: params.walletAddress,
      code: params.code,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (res.ok && data.ok === true) {
    return {
      ok: true,
      holder_address: String(data.holder_address),
      method: "bio",
    };
  }
  return {
    error: typeof data.error === "string" ? data.error : "unknown_error",
    status: res.status,
  };
};

export const unlink = async (params: {
  discordUserId: string;
  guildId: string;
  holderAddress?: string;
}): Promise<void> => {
  const res = await fetch(url("/verify/unlink"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      discord_user_id: params.discordUserId,
      guild_id: params.guildId,
      holder_address: params.holderAddress,
    }),
  });
  if (!res.ok) throw new Error(`/verify/unlink ${res.status}`);
};

export interface LinkRow {
  holder_address: string;
  signer_address: string | null;
  method: string;
  verified_at: string;
  last_checked_at: string;
}

export const getLinks = async (discordUserId: string): Promise<LinkRow[]> => {
  const res = await fetch(
    url(`/verify/links/${encodeURIComponent(discordUserId)}`),
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`/verify/links ${res.status}`);
  const data = (await res.json()) as { links: LinkRow[] };
  return data.links;
};

export interface RoleEvent {
  id: string;
  discord_user_id: string;
  guild_id: string;
  desired_state: "grant" | "revoke";
  reason: string;
  created_at: string;
}

export const getRoleEvents = async (params: {
  since: bigint;
  limit: number;
}): Promise<RoleEvent[]> => {
  const u = new URL(url("/verify/role-events"));
  u.searchParams.set("since", params.since.toString());
  u.searchParams.set("limit", String(params.limit));
  const res = await fetch(u.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`/verify/role-events ${res.status}`);
  const data = (await res.json()) as { events: RoleEvent[] };
  return data.events;
};

export const markRoleEventApplied = async (id: string): Promise<void> => {
  const res = await fetch(
    url(`/verify/role-events/${encodeURIComponent(id)}`),
    { method: "PATCH", headers: headers() },
  );
  if (!res.ok) throw new Error(`/verify/role-events/${id} PATCH ${res.status}`);
};

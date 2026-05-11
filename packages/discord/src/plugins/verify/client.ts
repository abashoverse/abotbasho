import { env } from "../../env.js";

const DISCORD_PLATFORM = "discord" as const;

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
      platform: DISCORD_PLATFORM,
      platform_user_id: params.discordUserId,
      platform_scope_id: params.guildId,
    }),
  });
  if (!res.ok) throw new Error(`/verify/start ${res.status}`);
  const data = (await res.json()) as { url: string; expires_at: string };
  return { url: data.url, expiresAt: data.expires_at };
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
      platform: DISCORD_PLATFORM,
      platform_user_id: params.discordUserId,
      platform_scope_id: params.guildId,
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
    url(
      `/verify/links/${DISCORD_PLATFORM}/${encodeURIComponent(discordUserId)}`,
    ),
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`/verify/links ${res.status}`);
  const data = (await res.json()) as { links: LinkRow[] };
  return data.links;
};

export interface VerifiedUser {
  platform: "discord";
  platform_user_id: string;
  wallets: number;
  methods: string[];
  first_verified: string;
  last_checked: string;
}

export const getAllLinks = async (): Promise<{
  total: number;
  users: VerifiedUser[];
}> => {
  const res = await fetch(
    url(`/verify/all-links?platform=${DISCORD_PLATFORM}`),
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`/verify/all-links ${res.status}`);
  return (await res.json()) as { total: number; users: VerifiedUser[] };
};

export interface RoleEvent {
  id: string;
  platform: "discord";
  platform_user_id: string;
  platform_scope_id: string;
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
  u.searchParams.set("platform", DISCORD_PLATFORM);
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

import { env } from "../env.js";

const TELEGRAM_PLATFORM = "telegram" as const;

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
  telegramUserId: string;
  chatId: string;
}): Promise<{ url: string; expiresAt: string }> => {
  const res = await fetch(url("/verify/start"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      platform: TELEGRAM_PLATFORM,
      platform_user_id: params.telegramUserId,
      platform_scope_id: params.chatId,
    }),
  });
  if (!res.ok) throw new Error(`/verify/start ${res.status}`);
  const data = (await res.json()) as { url: string; expires_at: string };
  return { url: data.url, expiresAt: data.expires_at };
};

export const unlink = async (params: {
  telegramUserId: string;
  chatId: string;
}): Promise<void> => {
  const res = await fetch(url("/verify/unlink"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      platform: TELEGRAM_PLATFORM,
      platform_user_id: params.telegramUserId,
      platform_scope_id: params.chatId,
    }),
  });
  if (!res.ok) throw new Error(`/verify/unlink ${res.status}`);
};

export interface RoleEvent {
  id: string;
  platform: "telegram";
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
  u.searchParams.set("platform", TELEGRAM_PLATFORM);
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

export interface VerifyLink {
  holder_address: string;
  signer_address: string | null;
  method: string;
  verified_at: string;
  last_checked_at: string;
}

export const getLinks = async (params: {
  telegramUserId: string;
}): Promise<VerifyLink[]> => {
  const res = await fetch(
    url(
      `/verify/links/${TELEGRAM_PLATFORM}/${encodeURIComponent(
        params.telegramUserId,
      )}`,
    ),
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`/verify/links ${res.status}`);
  const data = (await res.json()) as { links: VerifyLink[] };
  return data.links;
};

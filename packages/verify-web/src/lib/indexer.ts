import { env } from "$env/dynamic/private";

const indexerUrl = (): string => {
  const url = env.INDEXER_URL ?? "http://localhost:42069";
  return url.replace(/\/$/, "");
};

export interface SessionInfo {
  discord_user_id: string;
  guild_id: string;
  nonce: string;
  statement: string;
  domain: string;
  chain_id: number;
  project_name: string;
  primary_address: string;
  delegate_cash_enabled: boolean;
}

export const fetchSession = async (
  token: string,
): Promise<SessionInfo | null> => {
  const res = await fetch(
    `${indexerUrl()}/verify/session/${encodeURIComponent(token)}`,
    { headers: { accept: "application/json" } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`indexer session fetch failed: ${res.status}`);
  return (await res.json()) as SessionInfo;
};

export interface FinalizeSiweRequest {
  token: string;
  message: string;
  signature: string;
  delegated_from?: string;
}

export interface FinalizeSiweOk {
  ok: true;
  holder_address: string;
  method: "siwe" | "delegate";
}

export interface FinalizeSiweError {
  ok?: false;
  error: string;
  status: number;
}

export const finalizeSiwe = async (
  body: FinalizeSiweRequest,
): Promise<FinalizeSiweOk | FinalizeSiweError> => {
  const res = await fetch(`${indexerUrl()}/verify/finalize-siwe`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (res.ok && json.ok === true) {
    return {
      ok: true,
      holder_address: String(json.holder_address),
      method: json.method as "siwe" | "delegate",
    };
  }
  return {
    error: typeof json.error === "string" ? json.error : "unknown_error",
    status: res.status,
  };
};

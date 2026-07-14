import { env } from "$env/dynamic/private";

const indexerUrl = (): string => {
  const url = env.INDEXER_URL ?? "http://localhost:42069";
  return url.replace(/\/$/, "");
};

export interface SessionInfo {
  platform: "discord" | "telegram";
  nonce: string;
  statement: string;
  domain: string;
  chain_id: number;
  project_name: string;
  primary_address: string;
  delegate_cash_enabled: boolean;
  opensea_bio_enabled: boolean;
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

export interface StartBioOk {
  ok: true;
  code: string;
  expires_at: string;
}
export interface StartBioError {
  ok?: false;
  error: string;
  status: number;
}

export const startBio = async (
  token: string,
): Promise<StartBioOk | StartBioError> => {
  const res = await fetch(`${indexerUrl()}/verify/bio/start`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (res.ok && typeof json.code === "string") {
    return {
      ok: true,
      code: json.code,
      expires_at: String(json.expires_at),
    };
  }
  return {
    error: typeof json.error === "string" ? json.error : "unknown_error",
    status: res.status,
  };
};

export interface FinalizeBioRequest {
  token: string;
  wallet_address: string;
  code: string;
  delegated_from?: string;
}

export interface FinalizeBioOk {
  ok: true;
  holder_address: string;
  method: "bio" | "delegate";
}
export interface FinalizeBioError {
  ok?: false;
  error: string;
  status: number;
}

export const finalizeBio = async (
  body: FinalizeBioRequest,
): Promise<FinalizeBioOk | FinalizeBioError> => {
  const res = await fetch(`${indexerUrl()}/verify/finalize-bio`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (res.ok && json.ok === true) {
    return {
      ok: true,
      holder_address: String(json.holder_address),
      method: (json.method as "bio" | "delegate") ?? "bio",
    };
  }
  return {
    error: typeof json.error === "string" ? json.error : "unknown_error",
    status: res.status,
  };
};

import { Hono, type Context, type Next } from "hono";
import { createPublicClient, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { getProjectConfig } from "@abotbasho/shared";
import { getVerificationPool } from "../verification/db.js";
import {
  buildSiweStatement,
  consumeLinkToken,
  issueLinkToken,
  peekLinkToken,
  SiweVerifyError,
  verifySiwe,
} from "../verification/siwe.js";
import { isDelegatedHolderOf } from "../verification/delegate.js";
import {
  bioContainsCode,
  fetchOpenseaBio,
  findBioCodeForUser,
  issueBioCode,
  matchBioCode,
} from "../verification/opensea.js";

const cfg = getProjectConfig();
const verifyCfg = cfg.verify;

// ---- viem client for finalize-time canonical balance reads -------------

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.PONDER_RPC_URL_1),
});

const ERC721_BALANCE_OF_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const balanceAcross = async (holder: Address): Promise<bigint> => {
  const baseCall = {
    abi: ERC721_BALANCE_OF_ABI,
    functionName: "balanceOf" as const,
    args: [holder] as const,
  };
  const contracts = cfg.wrapper
    ? [
        { ...baseCall, address: cfg.primary.address },
        { ...baseCall, address: cfg.wrapper.address },
      ]
    : [{ ...baseCall, address: cfg.primary.address }];
  const results = await publicClient.multicall({ contracts, allowFailure: true });
  let total = 0n;
  for (const r of results) {
    if (r.status === "success") total += r.result as bigint;
  }
  return total;
};

// ---- middlewares -------------------------------------------------------

const verifyEnabledGate = async (c: Context, next: Next) => {
  if (!verifyCfg?.enabled) return c.json({ error: "verify_disabled" }, 404);
  await next();
};

const requireVerifyAuth = async (c: Context, next: Next) => {
  const expected = process.env.VERIFY_INTERNAL_SECRET;
  const got = c.req.header("x-verify-auth");
  if (!expected || !got) return c.json({ error: "unauthorized" }, 401);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

interface RateBucket {
  tokens: number;
  lastRefill: number;
}
const rateBuckets = new Map<string, RateBucket>();
const tryConsumeRate = (
  key: string,
  capacity: number,
  refillPerSec: number,
): boolean => {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b) {
    b = { tokens: capacity, lastRefill: now };
    rateBuckets.set(key, b);
  }
  const elapsedSec = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
  b.lastRefill = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
};

const ipOf = (c: Context): string => {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? "unknown";
};

const rateLimitPublic = async (c: Context, next: Next) => {
  if (!tryConsumeRate(`ip:${ipOf(c)}`, 20, 20 / 60)) {
    return c.json({ error: "rate_limited" }, 429);
  }
  await next();
};

// ---- helpers -----------------------------------------------------------

const domainOf = (): string => {
  if (process.env.VERIFY_PUBLIC_DOMAIN) return process.env.VERIFY_PUBLIC_DOMAIN;
  if (!verifyCfg?.publicUrl) return "";
  try {
    return new URL(verifyCfg.publicUrl).host;
  } catch {
    return "";
  }
};

const buildPublicVerifyUrl = (token: string): string => {
  const base = verifyCfg!.publicUrl.replace(/\/$/, "");
  return `${base}/v/${token}`;
};

const addrToBytes = (addr: Address): Buffer =>
  Buffer.from(addr.slice(2), "hex");

const audit = async (
  pool: Pool,
  params: {
    discordUserId?: string;
    holderAddress?: Address;
    signerAddress?: Address;
    method?: string;
    action: string;
    detail?: string;
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO verification.audit
       (discord_user_id, holder_address, signer_address, method, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.discordUserId ?? null,
      params.holderAddress ? addrToBytes(params.holderAddress) : null,
      params.signerAddress ? addrToBytes(params.signerAddress) : null,
      params.method ?? null,
      params.action,
      params.detail ?? null,
    ],
  );
};

const insertOrRefreshLink = async (
  pool: Pool,
  params: {
    discordUserId: string;
    guildId: string;
    holderAddress: Address;
    signerAddress?: Address;
    method: "siwe" | "delegate" | "bio";
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO verification.links
       (discord_user_id, holder_address, signer_address, method, guild_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_user_id, holder_address) DO UPDATE SET
       signer_address = EXCLUDED.signer_address,
       method = EXCLUDED.method,
       last_checked_at = now()`,
    [
      params.discordUserId,
      addrToBytes(params.holderAddress),
      params.signerAddress ? addrToBytes(params.signerAddress) : null,
      params.method,
      params.guildId,
    ],
  );
  await pool.query(
    `INSERT INTO verification.role_events
       (discord_user_id, guild_id, desired_state, reason)
     VALUES ($1, $2, 'grant', $3)`,
    [params.discordUserId, params.guildId, params.method],
  );
};

// ---- app + routes ------------------------------------------------------

const verifyApp = new Hono();

verifyApp.use("/*", verifyEnabledGate);

verifyApp.post("/start", requireVerifyAuth, async (c) => {
  const body = await c.req.json<{ discord_user_id?: string; guild_id?: string }>();
  const discordUserId = body.discord_user_id;
  const guildId = body.guild_id;
  if (!discordUserId || !guildId) {
    return c.json({ error: "discord_user_id_and_guild_id_required" }, 400);
  }
  if (!tryConsumeRate(`start:${discordUserId}`, 5, 5 / 60)) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const pool = await getVerificationPool();
  const { token, expiresAt } = await issueLinkToken(pool, {
    discordUserId,
    guildId,
    ttlSec: 600,
  });
  await audit(pool, { discordUserId, action: "siwe_started" });
  return c.json({
    url: buildPublicVerifyUrl(token),
    expires_at: expiresAt.toISOString(),
  });
});

verifyApp.get("/session/:token", rateLimitPublic, async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "invalid_or_expired" }, 404);
  const pool = await getVerificationPool();
  const row = await peekLinkToken(pool, token);
  if (!row) return c.json({ error: "invalid_or_expired" }, 404);
  return c.json({
    discord_user_id: row.discordUserId,
    guild_id: row.guildId,
    nonce: row.nonce,
    statement: buildSiweStatement(cfg.project.name, row.discordUserId),
    domain: domainOf(),
    chain_id: 1,
    project_name: cfg.project.name,
    primary_address: cfg.primary.address,
    delegate_cash_enabled: verifyCfg!.delegateCash !== false,
  });
});

verifyApp.post("/finalize-siwe", rateLimitPublic, async (c) => {
  const body = await c.req.json<{
    token?: string;
    message?: string;
    signature?: string;
    delegated_from?: string;
  }>();
  if (!body.token || !body.message || !body.signature) {
    return c.json({ error: "token_message_signature_required" }, 400);
  }
  const pool = await getVerificationPool();
  const consumed = await consumeLinkToken(pool, body.token);
  if (!consumed) return c.json({ error: "invalid_or_expired" }, 404);

  const expectedStatement = buildSiweStatement(
    cfg.project.name,
    consumed.discordUserId,
  );
  let signer: Address;
  try {
    const r = await verifySiwe({
      message: body.message,
      signature: body.signature,
      expectedDomain: domainOf(),
      expectedStatement,
      expectedNonce: consumed.nonce,
      expectedChainId: 1,
    });
    signer = r.recoveredAddress;
  } catch (err) {
    const reason = err instanceof SiweVerifyError ? err.reason : "verify_failed";
    await audit(pool, {
      discordUserId: consumed.discordUserId,
      action: "siwe_rejected",
      detail: reason,
    });
    return c.json({ error: reason }, 400);
  }

  let holder: Address;
  let method: "siwe" | "delegate";
  if (body.delegated_from) {
    if (verifyCfg!.delegateCash === false) {
      await audit(pool, {
        discordUserId: consumed.discordUserId,
        signerAddress: signer,
        action: "delegate_rejected",
        detail: "delegate_cash_disabled",
      });
      return c.json({ error: "delegate_cash_disabled" }, 400);
    }
    const cold = body.delegated_from as Address;
    const ok = await isDelegatedHolderOf(publicClient, {
      signer,
      coldWallet: cold,
      collectionContract: cfg.primary.address,
    });
    if (!ok) {
      await audit(pool, {
        discordUserId: consumed.discordUserId,
        signerAddress: signer,
        holderAddress: cold,
        action: "delegate_rejected",
        detail: "not_delegated",
      });
      return c.json({ error: "not_delegated" }, 400);
    }
    holder = cold;
    method = "delegate";
  } else {
    holder = signer;
    method = "siwe";
  }

  const balance = await balanceAcross(holder);
  if (balance <= 0n) {
    await audit(pool, {
      discordUserId: consumed.discordUserId,
      holderAddress: holder,
      signerAddress: signer,
      method,
      action: "rejected",
      detail: "no_holdings",
    });
    return c.json({ error: "no_holdings" }, 400);
  }

  await insertOrRefreshLink(pool, {
    discordUserId: consumed.discordUserId,
    guildId: consumed.guildId,
    holderAddress: holder,
    signerAddress: signer,
    method,
  });
  await audit(pool, {
    discordUserId: consumed.discordUserId,
    holderAddress: holder,
    signerAddress: signer,
    method,
    action: "linked",
  });

  return c.json({ ok: true, holder_address: holder, method });
});

verifyApp.post("/bio/start", requireVerifyAuth, async (c) => {
  if (!verifyCfg!.openseaBio) return c.json({ error: "bio_disabled" }, 404);
  const body = await c.req.json<{ discord_user_id?: string; guild_id?: string }>();
  if (!body.discord_user_id || !body.guild_id) {
    return c.json({ error: "discord_user_id_and_guild_id_required" }, 400);
  }
  const pool = await getVerificationPool();
  const { code, expiresAt } = await issueBioCode(pool, {
    discordUserId: body.discord_user_id,
    guildId: body.guild_id,
  });
  await audit(pool, {
    discordUserId: body.discord_user_id,
    action: "bio_started",
  });
  return c.json({ code, expires_at: expiresAt.toISOString() });
});

verifyApp.post("/finalize-bio", requireVerifyAuth, async (c) => {
  if (!verifyCfg!.openseaBio) return c.json({ error: "bio_disabled" }, 404);
  const body = await c.req.json<{
    discord_user_id?: string;
    guild_id?: string;
    wallet_address?: string;
    code?: string;
  }>();
  if (
    !body.discord_user_id ||
    !body.guild_id ||
    !body.wallet_address ||
    !body.code
  ) {
    return c.json(
      { error: "discord_user_id_guild_id_wallet_address_code_required" },
      400,
    );
  }
  const pool = await getVerificationPool();
  const stored = await findBioCodeForUser(pool, body.discord_user_id);
  if (!stored || !matchBioCode(body.code, stored.codeHash)) {
    await audit(pool, {
      discordUserId: body.discord_user_id,
      action: "bio_rejected",
      detail: "code_mismatch_or_expired",
    });
    return c.json({ error: "code_mismatch_or_expired" }, 400);
  }

  const wallet = body.wallet_address as Address;
  const bio = await fetchOpenseaBio(wallet);
  if (!bioContainsCode(bio, body.code)) {
    await audit(pool, {
      discordUserId: body.discord_user_id,
      holderAddress: wallet,
      action: "bio_rejected",
      detail: "code_not_in_bio",
    });
    return c.json({ error: "code_not_in_bio" }, 400);
  }

  const balance = await balanceAcross(wallet);
  if (balance <= 0n) {
    await audit(pool, {
      discordUserId: body.discord_user_id,
      holderAddress: wallet,
      method: "bio",
      action: "rejected",
      detail: "no_holdings",
    });
    return c.json({ error: "no_holdings" }, 400);
  }

  await insertOrRefreshLink(pool, {
    discordUserId: body.discord_user_id,
    guildId: body.guild_id,
    holderAddress: wallet,
    method: "bio",
  });
  await audit(pool, {
    discordUserId: body.discord_user_id,
    holderAddress: wallet,
    method: "bio",
    action: "linked",
  });
  return c.json({ ok: true, holder_address: wallet, method: "bio" });
});

verifyApp.get("/role-events", requireVerifyAuth, async (c) => {
  const since = parseInt(c.req.query("since") ?? "0", 10) || 0;
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1),
    500,
  );
  const pool = await getVerificationPool();
  const { rows } = await pool.query<{
    id: string;
    discord_user_id: string;
    guild_id: string;
    desired_state: "grant" | "revoke";
    reason: string;
    created_at: Date;
  }>(
    `SELECT id::text, discord_user_id, guild_id, desired_state, reason, created_at
     FROM verification.role_events
     WHERE id > $1 AND applied_at IS NULL
     ORDER BY id ASC
     LIMIT $2`,
    [since, limit],
  );
  return c.json({
    events: rows.map((r) => ({
      id: r.id,
      discord_user_id: r.discord_user_id,
      guild_id: r.guild_id,
      desired_state: r.desired_state,
      reason: r.reason,
      created_at: r.created_at.toISOString(),
    })),
  });
});

verifyApp.patch("/role-events/:id", requireVerifyAuth, async (c) => {
  const id = c.req.param("id");
  if (!id || !/^\d+$/.test(id)) return c.json({ error: "invalid_id" }, 400);
  const pool = await getVerificationPool();
  await pool.query(
    `UPDATE verification.role_events
     SET applied_at = now()
     WHERE id = $1::bigint AND applied_at IS NULL`,
    [id],
  );
  return c.json({ ok: true });
});

verifyApp.post("/unlink", requireVerifyAuth, async (c) => {
  const body = await c.req.json<{
    discord_user_id?: string;
    guild_id?: string;
    holder_address?: string;
  }>();
  if (!body.discord_user_id || !body.guild_id) {
    return c.json({ error: "discord_user_id_and_guild_id_required" }, 400);
  }
  const pool = await getVerificationPool();
  if (body.holder_address) {
    await pool.query(
      `DELETE FROM verification.links
       WHERE discord_user_id = $1 AND holder_address = $2`,
      [body.discord_user_id, addrToBytes(body.holder_address as Address)],
    );
  } else {
    await pool.query(
      `DELETE FROM verification.links WHERE discord_user_id = $1`,
      [body.discord_user_id],
    );
  }
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM verification.links WHERE discord_user_id = $1
     ) AS "exists"`,
    [body.discord_user_id],
  );
  if (rows[0]?.exists !== true) {
    await pool.query(
      `INSERT INTO verification.role_events
         (discord_user_id, guild_id, desired_state, reason)
       VALUES ($1, $2, 'revoke', 'user_unlinked')`,
      [body.discord_user_id, body.guild_id],
    );
  }
  await audit(pool, {
    discordUserId: body.discord_user_id,
    action: "unlinked",
    detail: body.holder_address ?? "all",
  });
  return c.json({ ok: true });
});

verifyApp.get("/links/:discord_user_id", requireVerifyAuth, async (c) => {
  const discordUserId = c.req.param("discord_user_id");
  const pool = await getVerificationPool();
  const { rows } = await pool.query<{
    holder_address: Buffer;
    signer_address: Buffer | null;
    method: string;
    verified_at: Date;
    last_checked_at: Date;
  }>(
    `SELECT holder_address, signer_address, method, verified_at, last_checked_at
     FROM verification.links
     WHERE discord_user_id = $1
     ORDER BY verified_at ASC`,
    [discordUserId],
  );
  return c.json({
    discord_user_id: discordUserId,
    links: rows.map((r) => ({
      holder_address: `0x${r.holder_address.toString("hex")}`,
      signer_address: r.signer_address
        ? `0x${r.signer_address.toString("hex")}`
        : null,
      method: r.method,
      verified_at: r.verified_at.toISOString(),
      last_checked_at: r.last_checked_at.toISOString(),
    })),
  });
});

export default verifyApp;

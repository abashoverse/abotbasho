import { Hono, type Context, type Next } from "hono";
import { createPublicClient, http, type Address } from "viem";
import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { getChain, getChainRpcUrl, getProjectConfig } from "@abotbasho/shared";
import { getVerificationPool } from "../verification/db.js";
import {
  buildSiweStatement,
  consumeLinkToken,
  issueLinkToken,
  peekLinkToken,
  type Platform,
  SiweVerifyError,
  verifySiwe,
} from "../verification/siwe.js";

const PLATFORMS: readonly Platform[] = ["discord", "telegram"] as const;
const isPlatform = (v: unknown): v is Platform =>
  typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
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
const chain = getChain();

// ---- viem client for finalize-time canonical balance reads -------------

const publicClient = createPublicClient({
  chain: chain.viemChain,
  transport: http(getChainRpcUrl()),
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

// Lazy idle-eviction so a long-running indexer doesn't accumulate one
// entry per unique IP forever. Sweep at most every 5 minutes; evict
// buckets untouched for over an hour (well past any reasonable refill
// horizon for the configured limits).
const RATE_BUCKET_IDLE_MS = 60 * 60 * 1000;
const RATE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastRateSweep = 0;

const tryConsumeRate = (
  key: string,
  capacity: number,
  refillPerSec: number,
): boolean => {
  const now = Date.now();
  if (now - lastRateSweep > RATE_SWEEP_INTERVAL_MS) {
    lastRateSweep = now;
    const cutoff = now - RATE_BUCKET_IDLE_MS;
    for (const [k, v] of rateBuckets) {
      if (v.lastRefill < cutoff) rateBuckets.delete(k);
    }
  }
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
    platform?: Platform;
    platformUserId?: string;
    holderAddress?: Address;
    signerAddress?: Address;
    method?: string;
    action: string;
    detail?: string;
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO verification.audit
       (platform, platform_user_id, holder_address, signer_address, method, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.platform ?? null,
      params.platformUserId ?? null,
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
    platform: Platform;
    platformUserId: string;
    platformScopeId: string;
    holderAddress: Address;
    signerAddress?: Address;
    method: "siwe" | "delegate" | "bio";
  },
): Promise<void> => {
  await pool.query(
    `INSERT INTO verification.links
       (platform, platform_user_id, holder_address, signer_address, method, platform_scope_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (platform, platform_user_id, holder_address) DO UPDATE SET
       signer_address = EXCLUDED.signer_address,
       method = EXCLUDED.method,
       last_checked_at = now()`,
    [
      params.platform,
      params.platformUserId,
      addrToBytes(params.holderAddress),
      params.signerAddress ? addrToBytes(params.signerAddress) : null,
      params.method,
      params.platformScopeId,
    ],
  );
  await pool.query(
    `INSERT INTO verification.role_events
       (platform, platform_user_id, platform_scope_id, desired_state, reason)
     VALUES ($1, $2, $3, 'grant', $4)`,
    [
      params.platform,
      params.platformUserId,
      params.platformScopeId,
      params.method,
    ],
  );
};

// ---- app + routes ------------------------------------------------------

const verifyApp = new Hono();

verifyApp.use("/*", verifyEnabledGate);

verifyApp.post("/start", requireVerifyAuth, async (c) => {
  const body = await c.req.json<{
    platform?: string;
    platform_user_id?: string;
    platform_scope_id?: string;
  }>();
  const platform = body.platform;
  const platformUserId = body.platform_user_id;
  const platformScopeId = body.platform_scope_id;
  if (!isPlatform(platform) || !platformUserId || !platformScopeId) {
    return c.json(
      { error: "platform_platform_user_id_platform_scope_id_required" },
      400,
    );
  }
  if (!tryConsumeRate(`start:${platform}:${platformUserId}`, 5, 5 / 60)) {
    return c.json({ error: "rate_limited" }, 429);
  }
  const pool = await getVerificationPool();
  const { token, expiresAt } = await issueLinkToken(pool, {
    platform,
    platformUserId,
    platformScopeId,
    ttlSec: 600,
  });
  await audit(pool, { platform, platformUserId, action: "siwe_started" });
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
  // platform_user_id and platform_scope_id are intentionally NOT in the
  // response. The page doesn't need them client-side; the SIWE statement
  // (which includes the platform-bound id) is server-built. Keeps the URL
  // token from implicitly disclosing the bound user/scope to anyone who
  // opens it.
  return c.json({
    nonce: row.nonce,
    statement: buildSiweStatement(
      cfg.project.name,
      row.platform,
      row.platformUserId,
    ),
    domain: domainOf(),
    chain_id: chain.id,
    project_name: cfg.project.name,
    primary_address: cfg.primary.address,
    delegate_cash_enabled: verifyCfg!.delegateCash !== false,
    opensea_bio_enabled: verifyCfg!.openseaBio === true,
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
  // Peek (don't consume) so the user can retry with a different wallet if
  // SIWE fails or the wallet doesn't hold. Token is consumed atomically on
  // success below. Spam is bounded by rateLimitPublic + the 10-min token
  // lifetime + the per-attempt cost of producing a wallet signature.
  const tokenRow = await peekLinkToken(pool, body.token);
  if (!tokenRow) return c.json({ error: "invalid_or_expired" }, 404);

  const expectedStatement = buildSiweStatement(
    cfg.project.name,
    tokenRow.platform,
    tokenRow.platformUserId,
  );
  let signer: Address;
  try {
    const r = await verifySiwe({
      message: body.message,
      signature: body.signature,
      expectedDomain: domainOf(),
      expectedStatement,
      expectedNonce: tokenRow.nonce,
      expectedChainId: chain.id,
    });
    signer = r.recoveredAddress;
  } catch (err) {
    const reason = err instanceof SiweVerifyError ? err.reason : "verify_failed";
    await audit(pool, {
      platform: tokenRow.platform,
      platformUserId: tokenRow.platformUserId,
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
        platform: tokenRow.platform,
        platformUserId: tokenRow.platformUserId,
        signerAddress: signer,
        action: "delegate_rejected",
        detail: "delegate_cash_disabled",
      });
      return c.json({ error: "delegate_cash_disabled" }, 400);
    }
    const cold = body.delegated_from as Address;
    const collectionContracts: Address[] = cfg.wrapper
      ? [cfg.primary.address, cfg.wrapper.address]
      : [cfg.primary.address];
    const ok = await isDelegatedHolderOf(publicClient, {
      signer,
      coldWallet: cold,
      collectionContracts,
    });
    if (!ok) {
      await audit(pool, {
        platform: tokenRow.platform,
        platformUserId: tokenRow.platformUserId,
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
      platform: tokenRow.platform,
      platformUserId: tokenRow.platformUserId,
      holderAddress: holder,
      signerAddress: signer,
      method,
      action: "rejected",
      detail: "no_holdings",
    });
    return c.json({ error: "no_holdings" }, 400);
  }

  // All checks passed. Atomically consume the token now. Lost race (token
  // was consumed by a concurrent successful attempt) returns invalid_or_expired.
  const consumed = await consumeLinkToken(pool, body.token);
  if (!consumed) return c.json({ error: "invalid_or_expired" }, 404);

  await insertOrRefreshLink(pool, {
    platform: consumed.platform,
    platformUserId: consumed.platformUserId,
    platformScopeId: consumed.platformScopeId,
    holderAddress: holder,
    signerAddress: signer,
    method,
  });
  await audit(pool, {
    platform: consumed.platform,
    platformUserId: consumed.platformUserId,
    holderAddress: holder,
    signerAddress: signer,
    method,
    action: "linked",
  });

  return c.json({ ok: true, holder_address: holder, method });
});

// Bio start + finalize are token-authed (URL path token). The verify-web
// page calls these directly via its server-side proxy. Bot is no longer in
// the bio loop; a single URL token covers both SIWE and bio paths.
verifyApp.post("/bio/start", rateLimitPublic, async (c) => {
  if (!verifyCfg!.openseaBio) return c.json({ error: "bio_disabled" }, 404);
  if (!process.env.OPENSEA_API_KEY) {
    return c.json({ error: "bio_misconfigured" }, 500);
  }
  const body = await c.req.json<{ token?: string }>();
  if (!body.token) return c.json({ error: "token_required" }, 400);
  const pool = await getVerificationPool();
  const tokenRow = await peekLinkToken(pool, body.token);
  if (!tokenRow) return c.json({ error: "invalid_or_expired" }, 404);

  const { code, expiresAt } = await issueBioCode(pool, {
    platform: tokenRow.platform,
    platformUserId: tokenRow.platformUserId,
    platformScopeId: tokenRow.platformScopeId,
  });
  await audit(pool, {
    platform: tokenRow.platform,
    platformUserId: tokenRow.platformUserId,
    action: "bio_started",
  });
  return c.json({ code, expires_at: expiresAt.toISOString() });
});

verifyApp.post("/finalize-bio", rateLimitPublic, async (c) => {
  if (!verifyCfg!.openseaBio) return c.json({ error: "bio_disabled" }, 404);
  if (!process.env.OPENSEA_API_KEY) {
    return c.json({ error: "bio_misconfigured" }, 500);
  }
  const body = await c.req.json<{
    token?: string;
    wallet_address?: string;
    code?: string;
    delegated_from?: string;
  }>();
  if (!body.token || !body.wallet_address || !body.code) {
    return c.json({ error: "token_wallet_address_code_required" }, 400);
  }
  const pool = await getVerificationPool();
  // Peek (don't consume) so failed bio submissions don't burn the token.
  const tokenRow = await peekLinkToken(pool, body.token);
  if (!tokenRow) return c.json({ error: "invalid_or_expired" }, 404);

  const stored = await findBioCodeForUser(
    pool,
    tokenRow.platform,
    tokenRow.platformUserId,
  );
  if (!stored || !matchBioCode(body.code, stored.codeHash)) {
    await audit(pool, {
      platform: tokenRow.platform,
      platformUserId: tokenRow.platformUserId,
      action: "bio_rejected",
      detail: "code_mismatch_or_expired",
    });
    return c.json({ error: "code_mismatch_or_expired" }, 400);
  }

  const bioWallet = body.wallet_address as Address;
  const bio = await fetchOpenseaBio(bioWallet);
  if (!bioContainsCode(bio, body.code)) {
    await audit(pool, {
      platform: tokenRow.platform,
      platformUserId: tokenRow.platformUserId,
      holderAddress: bioWallet,
      action: "bio_rejected",
      detail: "code_not_in_bio",
    });
    return c.json({ error: "code_not_in_bio" }, 400);
  }

  // Bio match proves control of bioWallet. If delegated_from is supplied,
  // bioWallet plays the same role as the SIWE signer (the proven-control
  // wallet) and the cold wallet is the holder we check the balance on.
  let holder: Address;
  let signer: Address | undefined;
  let method: "bio" | "delegate";
  if (body.delegated_from) {
    if (verifyCfg!.delegateCash === false) {
      await audit(pool, {
        platform: tokenRow.platform,
        platformUserId: tokenRow.platformUserId,
        signerAddress: bioWallet,
        action: "delegate_rejected",
        detail: "delegate_cash_disabled",
      });
      return c.json({ error: "delegate_cash_disabled" }, 400);
    }
    const cold = body.delegated_from as Address;
    const collectionContracts: Address[] = cfg.wrapper
      ? [cfg.primary.address, cfg.wrapper.address]
      : [cfg.primary.address];
    const ok = await isDelegatedHolderOf(publicClient, {
      signer: bioWallet,
      coldWallet: cold,
      collectionContracts,
    });
    if (!ok) {
      await audit(pool, {
        platform: tokenRow.platform,
        platformUserId: tokenRow.platformUserId,
        signerAddress: bioWallet,
        holderAddress: cold,
        action: "delegate_rejected",
        detail: "not_delegated",
      });
      return c.json({ error: "not_delegated" }, 400);
    }
    holder = cold;
    signer = bioWallet;
    method = "delegate";
  } else {
    holder = bioWallet;
    method = "bio";
  }

  const balance = await balanceAcross(holder);
  if (balance <= 0n) {
    await audit(pool, {
      platform: tokenRow.platform,
      platformUserId: tokenRow.platformUserId,
      holderAddress: holder,
      signerAddress: signer,
      method,
      action: "rejected",
      detail: "no_holdings",
    });
    return c.json({ error: "no_holdings" }, 400);
  }

  // All checks passed. Consume the URL token atomically.
  const consumed = await consumeLinkToken(pool, body.token);
  if (!consumed) return c.json({ error: "invalid_or_expired" }, 404);

  await insertOrRefreshLink(pool, {
    platform: consumed.platform,
    platformUserId: consumed.platformUserId,
    platformScopeId: consumed.platformScopeId,
    holderAddress: holder,
    signerAddress: signer,
    method,
  });
  await audit(pool, {
    platform: consumed.platform,
    platformUserId: consumed.platformUserId,
    holderAddress: holder,
    signerAddress: signer,
    method,
    action: "linked",
  });
  // Tidy: drop any outstanding bio codes for this user. They're only useful
  // before linking; rows would otherwise sit until 24h TTL expiry.
  await pool.query(
    `DELETE FROM verification.bio_codes WHERE platform = $1 AND platform_user_id = $2`,
    [consumed.platform, consumed.platformUserId],
  );
  return c.json({ ok: true, holder_address: holder, method });
});

verifyApp.get("/all-links", requireVerifyAuth, async (c) => {
  // Aggregated list of every (platform, user) with at least one
  // verification.links row. Used by /verify-admin list (visibility) and
  // /verify-admin sweep (cross-reference against role holders during transition).
  // Optional ?platform=<p> filter keeps platform-specific bots from having to
  // scan rows that don't belong to them.
  const platformFilter = c.req.query("platform");
  if (platformFilter && !isPlatform(platformFilter)) {
    return c.json({ error: "invalid_platform" }, 400);
  }
  const pool = await getVerificationPool();
  const { rows } = await pool.query<{
    platform: Platform;
    platform_user_id: string;
    wallets: string;
    methods: string[];
    first_verified: Date;
    last_checked: Date;
  }>(
    platformFilter
      ? `SELECT
           platform,
           platform_user_id,
           COUNT(*)::text AS wallets,
           ARRAY_AGG(DISTINCT method) AS methods,
           MIN(verified_at) AS first_verified,
           MAX(last_checked_at) AS last_checked
         FROM verification.links
         WHERE platform = $1
         GROUP BY platform, platform_user_id
         ORDER BY first_verified ASC`
      : `SELECT
           platform,
           platform_user_id,
           COUNT(*)::text AS wallets,
           ARRAY_AGG(DISTINCT method) AS methods,
           MIN(verified_at) AS first_verified,
           MAX(last_checked_at) AS last_checked
         FROM verification.links
         GROUP BY platform, platform_user_id
         ORDER BY first_verified ASC`,
    platformFilter ? [platformFilter] : [],
  );
  return c.json({
    total: rows.length,
    users: rows.map((r) => ({
      platform: r.platform,
      platform_user_id: r.platform_user_id,
      wallets: Number(r.wallets),
      methods: r.methods,
      first_verified: r.first_verified.toISOString(),
      last_checked: r.last_checked.toISOString(),
    })),
  });
});

verifyApp.get("/role-events", requireVerifyAuth, async (c) => {
  const since = parseInt(c.req.query("since") ?? "0", 10) || 0;
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1),
    500,
  );
  // Bots filter on their own platform so each consumer only drains its own
  // events. ?platform=discord on the discord bot, ?platform=telegram on the
  // telegram bot. Without the filter, the response includes all platforms.
  const platformFilter = c.req.query("platform");
  if (platformFilter && !isPlatform(platformFilter)) {
    return c.json({ error: "invalid_platform" }, 400);
  }
  const pool = await getVerificationPool();
  const { rows } = await pool.query<{
    id: string;
    platform: Platform;
    platform_user_id: string;
    platform_scope_id: string;
    desired_state: "grant" | "revoke";
    reason: string;
    created_at: Date;
  }>(
    platformFilter
      ? `SELECT id::text, platform, platform_user_id, platform_scope_id, desired_state, reason, created_at
         FROM verification.role_events
         WHERE id > $1 AND applied_at IS NULL AND platform = $3
         ORDER BY id ASC
         LIMIT $2`
      : `SELECT id::text, platform, platform_user_id, platform_scope_id, desired_state, reason, created_at
         FROM verification.role_events
         WHERE id > $1 AND applied_at IS NULL
         ORDER BY id ASC
         LIMIT $2`,
    platformFilter ? [since, limit, platformFilter] : [since, limit],
  );
  return c.json({
    events: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      platform_user_id: r.platform_user_id,
      platform_scope_id: r.platform_scope_id,
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
    platform?: string;
    platform_user_id?: string;
    platform_scope_id?: string;
    holder_address?: string;
  }>();
  const platform = body.platform;
  const platformUserId = body.platform_user_id;
  const platformScopeId = body.platform_scope_id;
  if (!isPlatform(platform) || !platformUserId || !platformScopeId) {
    return c.json(
      { error: "platform_platform_user_id_platform_scope_id_required" },
      400,
    );
  }
  const pool = await getVerificationPool();
  if (body.holder_address) {
    await pool.query(
      `DELETE FROM verification.links
       WHERE platform = $1 AND platform_user_id = $2 AND holder_address = $3`,
      [
        platform,
        platformUserId,
        addrToBytes(body.holder_address as Address),
      ],
    );
  } else {
    await pool.query(
      `DELETE FROM verification.links
       WHERE platform = $1 AND platform_user_id = $2`,
      [platform, platformUserId],
    );
  }
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM verification.links
       WHERE platform = $1 AND platform_user_id = $2
     ) AS "exists"`,
    [platform, platformUserId],
  );
  if (rows[0]?.exists !== true) {
    await pool.query(
      `INSERT INTO verification.role_events
         (platform, platform_user_id, platform_scope_id, desired_state, reason)
       VALUES ($1, $2, $3, 'revoke', 'user_unlinked')`,
      [platform, platformUserId, platformScopeId],
    );
  }
  await audit(pool, {
    platform,
    platformUserId,
    action: "unlinked",
    detail: body.holder_address ?? "all",
  });
  return c.json({ ok: true });
});

verifyApp.get("/links/:platform/:platform_user_id", requireVerifyAuth, async (c) => {
  const platform = c.req.param("platform");
  const platformUserId = c.req.param("platform_user_id");
  if (!isPlatform(platform)) {
    return c.json({ error: "invalid_platform" }, 400);
  }
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
     WHERE platform = $1 AND platform_user_id = $2
     ORDER BY verified_at ASC`,
    [platform, platformUserId],
  );
  return c.json({
    platform,
    platform_user_id: platformUserId,
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

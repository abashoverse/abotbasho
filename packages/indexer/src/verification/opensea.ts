import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

const BIO_CODE_PREFIX = "abot-";
const BIO_CODE_TTL_SEC = 24 * 60 * 60;

const hashCode = (code: string): Buffer =>
  createHash("sha256").update(code).digest();

export const issueBioCode = async (
  pool: Pool,
  params: { discordUserId: string; guildId: string },
): Promise<{ code: string; expiresAt: Date }> => {
  // 8 random bytes = 64 bits. With our public rate limits, brute-forcing
  // a code is computationally infeasible regardless, but the longer string
  // also rules out trivial copy/typo collisions.
  const code = `${BIO_CODE_PREFIX}${randomBytes(8).toString("hex")}`;
  const expiresAt = new Date(Date.now() + BIO_CODE_TTL_SEC * 1000);
  await pool.query(
    `INSERT INTO verification.bio_codes (code_hash, discord_user_id, guild_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashCode(code), params.discordUserId, params.guildId, expiresAt],
  );
  return { code, expiresAt };
};

/**
 * Returns the most recent unexpired bio code row for this user, or null.
 * The code itself is never stored; only its sha256 hash. The caller compares
 * a candidate code's hash against `codeHash` to confirm a match.
 */
export const findBioCodeForUser = async (
  pool: Pool,
  discordUserId: string,
): Promise<{ codeHash: Buffer; expiresAt: Date } | null> => {
  const { rows } = await pool.query<{ code_hash: Buffer; expires_at: Date }>(
    `SELECT code_hash, expires_at
     FROM verification.bio_codes
     WHERE discord_user_id = $1 AND expires_at > now()
     ORDER BY created_at DESC
     LIMIT 1`,
    [discordUserId],
  );
  const row = rows[0];
  if (!row) return null;
  return { codeHash: row.code_hash, expiresAt: row.expires_at };
};

export const matchBioCode = (
  candidateCode: string,
  storedHash: Buffer,
): boolean => Buffer.compare(hashCode(candidateCode), storedHash) === 0;

const FETCH_TIMEOUT_MS = 8_000;
const RETRY_BASE_MS = 400;

const inFlight = new Map<string, Promise<string | null>>();

const fetchBioOnce = async (address: string): Promise<string | null> => {
  const apiKey = process.env.OPENSEA_API_KEY;
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.opensea.io/api/v2/accounts/${address}`,
      {
        headers: { "x-api-key": apiKey, accept: "application/json" },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { bio?: string | null };
    return data.bio ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Fetch the OpenSea bio for an address with one jittered retry. Concurrent
 * calls for the same address share a single fetch (single-flight). Any
 * failure (timeout, network, 4xx, 5xx, 429) returns null. Callers treat
 * null as "no match" and the user can retry from the verify page.
 */
export const fetchOpenseaBio = async (
  address: string,
): Promise<string | null> => {
  const key = address.toLowerCase();
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const first = await fetchBioOnce(address);
    if (first !== null) return first;
    const jitter = RETRY_BASE_MS + Math.floor(Math.random() * RETRY_BASE_MS);
    await new Promise((r) => setTimeout(r, jitter));
    return fetchBioOnce(address);
  })();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
};

export const bioContainsCode = (
  bio: string | null,
  code: string,
): boolean => {
  if (!bio) return false;
  return bio.includes(code);
};

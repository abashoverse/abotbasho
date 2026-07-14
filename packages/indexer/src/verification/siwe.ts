import { createHash, randomBytes } from "node:crypto";
import { SiweMessage } from "siwe";
import type { Address } from "viem";
import type { Pool } from "pg";

export type Platform = "discord" | "telegram";

const formatPlatformName = (platform: Platform): string => {
  if (platform === "discord") return "Discord";
  return "Telegram";
};

// Title-casing the platform name preserves byte-equality with the v1 statement
// "Verify your <project> NFT holdings for Discord user <id>" so that link
// tokens issued before this deploy still verify after the cutover.
export const buildSiweStatement = (
  projectName: string,
  platform: Platform,
  platformUserId: string,
): string =>
  `Verify your ${projectName} NFT holdings for ${formatPlatformName(platform)} user ${platformUserId}`;

const hashToken = (token: string): Buffer =>
  createHash("sha256").update(token).digest();

export interface LinkTokenRow {
  platform: Platform;
  platformUserId: string;
  platformScopeId: string;
  nonce: string;
}

export const issueLinkToken = async (
  pool: Pool,
  params: {
    platform: Platform;
    platformUserId: string;
    platformScopeId: string;
    ttlSec: number;
  },
): Promise<{ token: string; nonce: string; expiresAt: Date }> => {
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + params.ttlSec * 1000);
  await pool.query(
    `INSERT INTO verification.link_tokens
       (token_hash, platform, platform_user_id, platform_scope_id, nonce, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      hashToken(token),
      params.platform,
      params.platformUserId,
      params.platformScopeId,
      nonce,
      expiresAt,
    ],
  );
  return { token, nonce, expiresAt };
};

export const peekLinkToken = async (
  pool: Pool,
  token: string,
): Promise<LinkTokenRow | null> => {
  const { rows } = await pool.query<{
    platform: Platform;
    platform_user_id: string;
    platform_scope_id: string;
    nonce: string;
  }>(
    `SELECT platform, platform_user_id, platform_scope_id, nonce
     FROM verification.link_tokens
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    platform: row.platform,
    platformUserId: row.platform_user_id,
    platformScopeId: row.platform_scope_id,
    nonce: row.nonce,
  };
};

export const consumeLinkToken = async (
  pool: Pool,
  token: string,
): Promise<LinkTokenRow | null> => {
  const { rows } = await pool.query<{
    platform: Platform;
    platform_user_id: string;
    platform_scope_id: string;
    nonce: string;
  }>(
    `UPDATE verification.link_tokens
     SET consumed_at = now()
     WHERE token_hash = $1
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING platform, platform_user_id, platform_scope_id, nonce`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    platform: row.platform,
    platformUserId: row.platform_user_id,
    platformScopeId: row.platform_scope_id,
    nonce: row.nonce,
  };
};

export interface SiweVerifyParams {
  message: string;
  signature: string;
  expectedDomain: string;
  expectedStatement: string;
  expectedNonce: string;
  expectedChainId: number;
  clockSkewSec?: number;
}

export interface SiweVerifyResult {
  recoveredAddress: Address;
  issuedAt: Date;
}

export class SiweVerifyError extends Error {
  constructor(
    public readonly reason: string,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

export const verifySiwe = async (
  params: SiweVerifyParams,
): Promise<SiweVerifyResult> => {
  const skewMs = (params.clockSkewSec ?? 120) * 1000;

  let parsed: SiweMessage;
  try {
    parsed = new SiweMessage(params.message);
  } catch (err) {
    throw new SiweVerifyError("malformed_message", String(err));
  }

  // siwe.verify also re-checks signature, domain and nonce. We re-check
  // chainId, statement and timestamps independently so audit logs record
  // the precise reject reason.
  const result = await parsed.verify({
    signature: params.signature,
    domain: params.expectedDomain,
    nonce: params.expectedNonce,
  });
  if (!result.success) {
    throw new SiweVerifyError(result.error?.type ?? "verify_failed");
  }
  const data = result.data;

  if (data.chainId !== params.expectedChainId) {
    throw new SiweVerifyError("chain_mismatch");
  }
  if (data.statement !== params.expectedStatement) {
    throw new SiweVerifyError("statement_mismatch");
  }

  if (!data.issuedAt) {
    throw new SiweVerifyError("issued_at_missing");
  }
  const issuedAt = new Date(data.issuedAt);
  if (Number.isNaN(issuedAt.getTime())) {
    throw new SiweVerifyError("issued_at_invalid");
  }
  const now = Date.now();
  if (issuedAt.getTime() > now + skewMs) {
    throw new SiweVerifyError("issued_in_future");
  }
  if (data.expirationTime) {
    const exp = new Date(data.expirationTime).getTime();
    if (Number.isFinite(exp) && exp + skewMs < now) {
      throw new SiweVerifyError("message_expired");
    }
  }
  return {
    recoveredAddress: data.address as Address,
    issuedAt,
  };
};

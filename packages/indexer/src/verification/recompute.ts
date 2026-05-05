import type { Pool, PoolClient } from "pg";
import type { Address } from "viem";

const ERC721_BALANCE_OF_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const LISTEN_CHANNEL = "verification_link_changes";

// Hot-set: lowercased holder addresses → ref count of active links on that
// wallet. A wallet with refcount > 0 has at least one user still linked to it.
const hotSet = new Map<string, number>();
let initPromise: Promise<void> | null = null;
let listenerClient: PoolClient | null = null;

const lower = (addr: string): string => addr.toLowerCase();

const seedHotSet = async (pool: Pool): Promise<void> => {
  const { rows } = await pool.query<{ holder_address: Buffer }>(
    `SELECT holder_address FROM verification.links`,
  );
  hotSet.clear();
  for (const row of rows) {
    const k = lower(`0x${row.holder_address.toString("hex")}`);
    hotSet.set(k, (hotSet.get(k) ?? 0) + 1);
  }
};

const startListener = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  listenerClient = client;
  client.on("notification", (msg) => {
    if (msg.channel !== LISTEN_CHANNEL || !msg.payload) return;
    const sep = msg.payload.indexOf(":");
    if (sep < 0) return;
    const op = msg.payload.slice(0, sep);
    const hex = msg.payload.slice(sep + 1);
    if (!hex || (op !== "add" && op !== "del")) return;
    const k = lower(`0x${hex}`);
    if (op === "add") {
      hotSet.set(k, (hotSet.get(k) ?? 0) + 1);
    } else {
      const next = (hotSet.get(k) ?? 0) - 1;
      if (next <= 0) hotSet.delete(k);
      else hotSet.set(k, next);
    }
  });
  client.on("error", (err) => {
    console.error("[verify] LISTEN client error; will reconnect:", err);
    listenerClient = null;
    initPromise = null;
    setTimeout(() => {
      init(pool).catch((e) =>
        console.error("[verify] LISTEN reconnect failed:", e),
      );
    }, 2_000);
  });
  await client.query(`LISTEN ${LISTEN_CHANNEL}`);
};

const init = (pool: Pool): Promise<void> => {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await seedHotSet(pool);
    await startListener(pool);
  })();
  return initPromise;
};

interface RecomputeContext {
  pool: Pool;
  // Ponder's read-only client; effectively a viem PublicClient subset.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  primaryAddress: Address;
  wrapperAddress?: Address;
}

const balanceAcross = async (
  ctx: RecomputeContext,
  holder: Address,
): Promise<bigint> => {
  const baseCall = {
    abi: ERC721_BALANCE_OF_ABI,
    functionName: "balanceOf" as const,
    args: [holder] as const,
  };
  const contracts = ctx.wrapperAddress
    ? [
        { ...baseCall, address: ctx.primaryAddress },
        { ...baseCall, address: ctx.wrapperAddress },
      ]
    : [{ ...baseCall, address: ctx.primaryAddress }];
  const results = await ctx.client.multicall({ contracts, allowFailure: true });
  let total = 0n;
  for (const r of results) {
    if (r.status === "success") total += r.result as bigint;
  }
  return total;
};

/**
 * Maintains the hot-set & runs the per-link revocation policy.
 *
 * Called from Ponder's Transfer handler with the addresses involved in the
 * transfer. Fast path is O(1): if neither address is in the hot-set, return.
 *
 * Per-link policy: if a linked holder's balance across {primary, wrapper}
 * drops to 0, delete that holder's link rows. If a user thereby has no
 * remaining links, emit a `role_events` revoke. We never insert grants here
 * — grants only come from the verify routes after a fresh proof of control.
 */
export const maybeRecomputeForVerification = async (
  affected: readonly Address[],
  ctx: RecomputeContext,
): Promise<void> => {
  await init(ctx.pool);

  const touched = new Set<Address>();
  for (const a of affected) {
    if (hotSet.has(lower(a))) touched.add(a);
  }
  if (touched.size === 0) return;

  for (const addr of touched) {
    const balance = await balanceAcross(ctx, addr);
    if (balance > 0n) continue;

    const holderBytes = Buffer.from(addr.slice(2), "hex");
    const { rows: linkRows } = await ctx.pool.query<{
      discord_user_id: string;
      guild_id: string;
    }>(
      `SELECT discord_user_id, guild_id FROM verification.links
       WHERE holder_address = $1`,
      [holderBytes],
    );

    if (linkRows.length === 0) {
      // Hot-set drift — reconcile and continue.
      hotSet.delete(lower(addr));
      continue;
    }

    await ctx.pool.query(
      `DELETE FROM verification.links WHERE holder_address = $1`,
      [holderBytes],
    );

    for (const row of linkRows) {
      const { rows: remaining } = await ctx.pool.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM verification.links WHERE discord_user_id = $1
         ) AS "exists"`,
        [row.discord_user_id],
      );
      const hasRemaining = remaining[0]?.exists === true;
      await ctx.pool.query(
        `INSERT INTO verification.audit
           (discord_user_id, holder_address, action, detail)
         VALUES ($1, $2, 'link_revoked', $3)`,
        [
          row.discord_user_id,
          holderBytes,
          hasRemaining
            ? "balance=0; user has other active links"
            : "balance=0; last link",
        ],
      );
      if (!hasRemaining) {
        await ctx.pool.query(
          `INSERT INTO verification.role_events
             (discord_user_id, guild_id, desired_state, reason)
           VALUES ($1, $2, 'revoke', 'last_link_zero')`,
          [row.discord_user_id, row.guild_id],
        );
      }
    }
  }
};

/** Test-only — reset module state between integration tests. */
export const __resetForTests = (): void => {
  hotSet.clear();
  initPromise = null;
  listenerClient = null;
};

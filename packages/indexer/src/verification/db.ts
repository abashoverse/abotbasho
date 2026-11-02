import { Pool } from "pg";
import { runMigrations } from "./migrations.js";

let poolPromise: Promise<Pool> | null = null;

const resolveConnectionString = (): string => {
  const url = process.env.VERIFICATION_DB_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "verify: neither VERIFICATION_DB_URL nor DATABASE_URL is set; cannot open verification pool",
    );
  }
  return url;
};

export const getVerificationPool = (): Promise<Pool> => {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    const pool = new Pool({
      connectionString: resolveConnectionString(),
      max: 5,
      // pg waits forever for a free client by default. Fail fast instead, so
      // a stuck pool surfaces as a 500 in the logs rather than a silent hang
      // that nginx turns into a 504.
      connectionTimeoutMillis: 10_000,
      // Same idea for a query on a half-dead connection.
      query_timeout: 30_000,
    });
    pool.on("error", (err) => {
      console.error("[verify] verification pool client error:", err);
    });
    try {
      await runMigrations(pool);
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
    return pool;
  })();
  // Don't cache a failure: a rejected promise here would break every verify
  // route until the next restart. Clear it so the next call retries.
  poolPromise.catch(() => {
    poolPromise = null;
  });
  return poolPromise;
};

export const closeVerificationPool = async (): Promise<void> => {
  if (!poolPromise) return;
  const pool = await poolPromise;
  poolPromise = null;
  await pool.end();
};

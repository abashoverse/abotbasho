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
    });
    pool.on("error", (err) => {
      console.error("[verify] verification pool client error:", err);
    });
    await runMigrations(pool);
    return pool;
  })();
  return poolPromise;
};

export const closeVerificationPool = async (): Promise<void> => {
  if (!poolPromise) return;
  const pool = await poolPromise;
  poolPromise = null;
  await pool.end();
};

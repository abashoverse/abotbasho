import { loadConfig, loadRootEnv } from "@abotbasho/shared";

loadRootEnv();
await loadConfig();

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};

// INDEXER_API_URL is derived from INDEXER_SQL_URL by stripping the /sql
// suffix (matches the Discord package's convention so a single env var
// covers both consumers).
const indexerSqlUrl =
  process.env.INDEXER_SQL_URL ?? "http://localhost:42069/sql";

export const env = {
  TELEGRAM_BOT_TOKEN: required("TELEGRAM_BOT_TOKEN"),
  DATA_DIR: process.env.TELEGRAM_DATA_DIR ?? "./data",
  INDEXER_SQL_URL: indexerSqlUrl,
  INDEXER_API_URL: indexerSqlUrl.replace(/\/sql\/?$/, ""),
  VERIFY_INTERNAL_SECRET: process.env.VERIFY_INTERNAL_SECRET ?? "",
};

import { loadConfig, loadRootEnv } from "@abotbasho/shared";

loadRootEnv();
await loadConfig();

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};

export const env = {
  TWITTER_API_KEY: required("TWITTER_API_KEY"),
  TWITTER_API_SECRET: required("TWITTER_API_SECRET"),
  TWITTER_ACCESS_TOKEN: required("TWITTER_ACCESS_TOKEN"),
  TWITTER_ACCESS_SECRET: required("TWITTER_ACCESS_SECRET"),
  INDEXER_SQL_URL: process.env.INDEXER_SQL_URL ?? "http://localhost:42069/sql",
  INDEXER_API_URL: (process.env.INDEXER_SQL_URL ?? "http://localhost:42069/sql").replace(/\/sql\/?$/, ""),
  MAINNET_RPC_URL: required("PONDER_RPC_URL_1"),
  CURSOR_FILE: process.env.CURSOR_FILE ?? "./data/cursor.json",
};

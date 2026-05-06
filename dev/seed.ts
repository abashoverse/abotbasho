// Seeds the local anvil fork so the dev wallet (anvil's account 0,
// 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) holds a token from
// cfg.primary.address. Run after `compose.dev.yml` is up:
//
//   bun run dev:seed          # seeds tokenId 1
//   bun run dev:seed 4242     # seeds a specific tokenId
//
// State lives in anvil memory; re-run if you restart the fork.
import { loadConfig, loadRootEnv } from "@abotbasho/shared";
import { seedToken } from "./lib.js";

loadRootEnv();
const cfg = await loadConfig();
const tokenId = process.argv[2] ? BigInt(process.argv[2]) : 1n;

await seedToken({
  contract: cfg.primary.address,
  contractLabel: "primary",
  tokenId,
});

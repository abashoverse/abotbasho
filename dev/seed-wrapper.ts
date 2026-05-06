// Same as `dev:seed`, but targets cfg.wrapper.address. Useful for testing
// the verification flow when a holder's qualifying NFT is the wrapped
// version (e.g. a delegate.cash cold wallet that holds the wrapper).
//
//   bun run dev:seed-wrapper          # seeds tokenId 1
//   bun run dev:seed-wrapper 4242     # specific tokenId
import { loadConfig, loadRootEnv } from "@abotbasho/shared";
import { seedToken } from "./lib.js";

loadRootEnv();
const cfg = await loadConfig();
if (!cfg.wrapper) {
  console.error(
    "cfg.wrapper is not configured. Add a `wrapper` block to abotbasho.config.ts to use this script.",
  );
  process.exit(1);
}
const tokenId = process.argv[2] ? BigInt(process.argv[2]) : 1n;

await seedToken({
  contract: cfg.wrapper.address,
  contractLabel: "wrapper",
  tokenId,
});

// Same as `dev:unseed`, but targets cfg.wrapper.address.
//
//   bun run dev:unseed-wrapper                           # tokenId 1 → 0x…dEaD
//   bun run dev:unseed-wrapper 4242                      # specific tokenId
//   bun run dev:unseed-wrapper 4242 0x1234…              # specific recipient
import type { Address } from "viem";
import { loadConfig, loadRootEnv } from "@abotbasho/shared";
import { BURN, unseedToken } from "./lib.js";

loadRootEnv();
const cfg = await loadConfig();
if (!cfg.wrapper) {
  console.error(
    "cfg.wrapper is not configured. Add a `wrapper` block to abotbasho.config.ts to use this script.",
  );
  process.exit(1);
}
const tokenId = process.argv[2] ? BigInt(process.argv[2]) : 1n;
const recipient = (process.argv[3] ?? BURN) as Address;

await unseedToken({
  contract: cfg.wrapper.address,
  contractLabel: "wrapper",
  tokenId,
  recipient,
});

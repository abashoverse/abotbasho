// Transfers a primary token away from the dev wallet to trigger
// Transfer-driven revocation.
//
//   bun run dev:unseed                           # tokenId 1 → 0x…dEaD
//   bun run dev:unseed 4242                      # specific tokenId → 0x…dEaD
//   bun run dev:unseed 4242 0x1234…              # specific tokenId → specific recipient
import type { Address } from "viem";
import { loadConfig, loadRootEnv } from "@abotbasho/shared";
import { BURN, unseedToken } from "./lib.js";

loadRootEnv();
const cfg = await loadConfig();
const tokenId = process.argv[2] ? BigInt(process.argv[2]) : 1n;
const recipient = (process.argv[3] ?? BURN) as Address;

await unseedToken({
  contract: cfg.primary.address,
  contractLabel: "primary",
  tokenId,
  recipient,
});

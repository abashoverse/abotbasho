import { createConfig } from "ponder";
import { getChain, getChainRpcUrls, loadConfig, loadRootEnv } from "@abotbasho/shared";
import { Erc721Abi, WrapperAbi } from "@abotbasho/shared/abis";

loadRootEnv();

const cfg = await loadConfig();
const chain = getChain();

const contracts: Record<string, unknown> = {
  [cfg.primary.label]: {
    abi: Erc721Abi,
    chain: chain.ponderName,
    address: cfg.primary.address,
    startBlock: Number(cfg.primary.deployBlock),
  },
};

if (cfg.wrapper) {
  contracts[cfg.wrapper.label] = {
    abi: WrapperAbi,
    chain: chain.ponderName,
    address: cfg.wrapper.address,
    startBlock: Number(cfg.wrapper.deployBlock),
  };
}

export default createConfig({
  chains: {
    [chain.ponderName]: {
      id: chain.id,
      rpc: getChainRpcUrls(),
      // Cap requests/sec to stay under the RPC tier's rate limit. Ponder
      // defaults to 50, which overruns free tiers: Alchemy free 429s the
      // backfill burst, Ponder retries those silently, and the historical sync
      // stalls with no log output. Lower PONDER_MAX_RPS until the 429s stop.
      maxRequestsPerSecond: Number(process.env.PONDER_MAX_RPS) || 50,
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contracts: contracts as any,
});

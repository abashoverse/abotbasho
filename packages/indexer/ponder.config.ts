import { createConfig } from "ponder";
import { getChain, getChainRpcUrl, loadConfig, loadRootEnv } from "@abotbasho/shared";
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
      rpc: getChainRpcUrl(),
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contracts: contracts as any,
});

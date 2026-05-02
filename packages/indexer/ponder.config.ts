import { createConfig } from "ponder";
import { loadConfig, loadRootEnv } from "@abotbasho/shared";
import { Erc721Abi, WrapperAbi } from "@abotbasho/shared/abis";

loadRootEnv();

const cfg = await loadConfig();

const contracts: Record<string, unknown> = {
  [cfg.primary.label]: {
    abi: Erc721Abi,
    chain: "mainnet",
    address: cfg.primary.address,
    startBlock: Number(cfg.primary.deployBlock),
  },
};

if (cfg.wrapper) {
  contracts[cfg.wrapper.label] = {
    abi: WrapperAbi,
    chain: "mainnet",
    address: cfg.wrapper.address,
    startBlock: Number(cfg.wrapper.deployBlock),
  };
}

export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1!,
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contracts: contracts as any,
});

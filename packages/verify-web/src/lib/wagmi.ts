import { http, createConfig } from "@wagmi/core";
import { injected, walletConnect } from "@wagmi/connectors";
import { env } from "$env/dynamic/public";
import { getChainProfile } from "@abotbasho/shared/chain";

const projectId = env.PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const chainId = Number(env.PUBLIC_INDEXER_CHAIN_ID ?? "1");
const chain = getChainProfile(chainId).viemChain;

const connectors = projectId
  ? [injected(), walletConnect({ projectId, showQrModal: true })]
  : [injected()];

export const wagmiConfig = createConfig({
  chains: [chain],
  transports: { [chain.id]: http() },
  connectors,
});

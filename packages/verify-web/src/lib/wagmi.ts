import { http, createConfig } from "@wagmi/core";
import { mainnet } from "@wagmi/core/chains";
import { injected, walletConnect } from "@wagmi/connectors";
import { env } from "$env/dynamic/public";

const projectId = env.PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

const connectors = projectId
  ? [injected(), walletConnect({ projectId, showQrModal: true })]
  : [injected()];

export const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
  connectors,
});

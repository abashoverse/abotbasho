import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";

const abi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "holdingDuration",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

let client: PublicClient | null = null;

const getClient = (rpcUrl: string): PublicClient => {
  if (!client) {
    client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  }
  return client;
};

export const tokenOwner = (
  rpcUrl: string,
  contract: Address,
  tokenId: bigint,
): Promise<Address> =>
  getClient(rpcUrl).readContract({
    address: contract,
    abi,
    functionName: "ownerOf",
    args: [tokenId],
  });

export const tokenHoldingDuration = (
  rpcUrl: string,
  contract: Address,
  tokenId: bigint,
): Promise<bigint> =>
  getClient(rpcUrl).readContract({
    address: contract,
    abi,
    functionName: "holdingDuration",
    args: [tokenId],
  });

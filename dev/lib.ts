// Shared helpers for the dev/seed*.ts and dev/unseed*.ts scripts.
//
// All scripts target the local anvil fork (http://127.0.0.1:8545 by default,
// override with ANVIL_RPC_URL). Seeding impersonates a current holder via
// anvil cheatcodes and transfers a token to the well-known dev account.
// Unseeding signs with the dev account's known private key and transfers
// out, triggering the indexer's Transfer hook for revocation testing.

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ANVIL_CHAIN } from "@abotbasho/shared";

export const ANVIL_RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
export const DEV_ACCOUNT: Address =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const DEV_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const BURN: Address = "0x000000000000000000000000000000000000dEaD";

export const erc721Abi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const anvilRpc = async (
  method: string,
  params: unknown[],
): Promise<unknown> => {
  const res = await fetch(ANVIL_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`anvil RPC ${method} failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (json.error) throw new Error(`anvil RPC ${method} failed: ${json.error.message}`);
  return json.result;
};

export const makePublicClient = () =>
  createPublicClient({ chain: ANVIL_CHAIN, transport: http(ANVIL_RPC) });

export const printDevWalletInstructions = (): void => {
  console.log(``);
  console.log(`Import this private key into MetaMask (anvil's account 0, public):`);
  console.log(`  ${DEV_PRIVATE_KEY}`);
  console.log(``);
  console.log(`Then add a custom network in MetaMask:`);
  console.log(`  Name:     Anvil`);
  console.log(`  RPC URL:  http://127.0.0.1:8545`);
  console.log(`  Chain ID: 31337`);
  console.log(`  Symbol:   ETH`);
};

/**
 * Impersonate the current owner of `tokenId` on `contract`, fund them so
 * they can pay gas, and transfer the token to the dev account.
 */
export const seedToken = async (params: {
  contract: Address;
  contractLabel: string;
  tokenId: bigint;
}): Promise<void> => {
  const publicClient = makePublicClient();

  let owner: Address;
  try {
    owner = (await publicClient.readContract({
      address: params.contract,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [params.tokenId],
    })) as Address;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `ownerOf(${params.tokenId}) reverted on ${params.contractLabel} ${params.contract}. Pick a tokenId that exists in the collection.\n\n${msg}`,
    );
    process.exit(1);
  }

  console.log(
    `${params.contractLabel} tokenId ${params.tokenId} held by ${owner} on the fork`,
  );
  console.log(`impersonating ${owner} and transferring to ${DEV_ACCOUNT}…`);

  await anvilRpc("anvil_impersonateAccount", [owner]);
  // 1 ETH so the impersonated account can pay gas.
  await anvilRpc("anvil_setBalance", [owner, "0xDE0B6B3A7640000"]);

  const walletClient = createWalletClient({
    account: owner,
    chain: ANVIL_CHAIN,
    transport: http(ANVIL_RPC),
  });

  const hash = await walletClient.writeContract({
    address: params.contract,
    abi: erc721Abi,
    functionName: "transferFrom",
    args: [owner, DEV_ACCOUNT, params.tokenId],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  await anvilRpc("anvil_stopImpersonatingAccount", [owner]);

  console.log(`done. tx ${hash}`);
  console.log(``);
  console.log(
    `${params.contractLabel} tokenId ${params.tokenId} of ${params.contract} is now held by`,
  );
  console.log(`  ${DEV_ACCOUNT}`);
  printDevWalletInstructions();
};

/**
 * Sign with the dev account's known private key and transfer the token
 * away. Triggers the indexer's Transfer hook for revocation testing.
 */
export const unseedToken = async (params: {
  contract: Address;
  contractLabel: string;
  tokenId: bigint;
  recipient: Address;
}): Promise<void> => {
  const account = privateKeyToAccount(DEV_PRIVATE_KEY);
  const publicClient = makePublicClient();

  let owner: Address;
  try {
    owner = (await publicClient.readContract({
      address: params.contract,
      abi: erc721Abi,
      functionName: "ownerOf",
      args: [params.tokenId],
    })) as Address;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `ownerOf(${params.tokenId}) reverted on ${params.contractLabel} ${params.contract}.\n\n${msg}`,
    );
    process.exit(1);
  }

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(
      `${params.contractLabel} tokenId ${params.tokenId} is owned by ${owner}, not the dev wallet ${account.address}.`,
    );
    console.error(
      `Run the matching seed script first, or pass a tokenId the dev wallet holds.`,
    );
    process.exit(1);
  }

  console.log(
    `transferring ${params.contractLabel} tokenId ${params.tokenId} from ${account.address} → ${params.recipient}…`,
  );

  const walletClient = createWalletClient({
    account,
    chain: ANVIL_CHAIN,
    transport: http(ANVIL_RPC),
  });

  const hash = await walletClient.writeContract({
    address: params.contract,
    abi: erc721Abi,
    functionName: "transferFrom",
    args: [account.address, params.recipient, params.tokenId],
  });

  await publicClient.waitForTransactionReceipt({ hash });

  console.log(`done. tx ${hash}`);
  console.log(``);
  console.log(
    `Indexer's Transfer hook should now fire and the role drop within ~5s.`,
  );
};

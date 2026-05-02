import { ponder } from "ponder:registry";
import { saleEvents, wrapEvents, wrapperHoldings } from "ponder:schema";
import {
  ZERO_ADDRESS,
  cursorOf,
  decodeMarketplaceSale,
  loadConfig,
} from "@abotbasho/shared";
import type { Address } from "viem";

const cfg = await loadConfig();

const wrapperAddrLower = cfg.wrapper?.address.toLowerCase();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventArgs = { event: any; context: any };

const trackWrapperHolding = async ({ event, context }: EventArgs) => {
  const to = event.args.to as Address;
  const tokenId = event.args.tokenId as bigint;
  const id = tokenId.toString();

  if (to === ZERO_ADDRESS) {
    await context.db.delete(wrapperHoldings, { id });
    return;
  }

  const blockNumber = event.block.number as bigint;
  const timestamp = event.block.timestamp as bigint;

  const existing = await context.db.find(wrapperHoldings, { id });
  if (existing) {
    await context.db
      .update(wrapperHoldings, { id })
      .set({ owner: to, holdingSince: timestamp, blockNumber });
  } else {
    await context.db.insert(wrapperHoldings).values({
      id,
      tokenId,
      owner: to,
      holdingSince: timestamp,
      blockNumber,
    });
  }
};

const handleTransfer = async (
  args: EventArgs,
  contractLabel: string,
  contractAddress: Address,
) => {
  const { event, context } = args;
  const from = event.args.from as Address;
  const to = event.args.to as Address;
  const tokenId = event.args.tokenId as bigint;

  if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) return;

  // Skip transfers where the wrapper is one of the parties: those are wraps/unwraps,
  // not sales, and are handled by the Wrapped/Unwrapped event handlers.
  if (
    wrapperAddrLower &&
    (from.toLowerCase() === wrapperAddrLower || to.toLowerCase() === wrapperAddrLower)
  ) {
    return;
  }

  const receipt = await context.client.getTransactionReceipt({
    hash: event.transaction.hash,
  });

  const sale = decodeMarketplaceSale(receipt.logs, contractAddress, tokenId);
  if (!sale) return;

  const blockNumber = event.block.number as bigint;
  const logIndex = Number(event.log.logIndex);
  const id = `${blockNumber}-${logIndex}`;

  await context.db.insert(saleEvents).values({
    id,
    contract: contractLabel,
    contractAddress,
    tokenId,
    fromAddress: from,
    toAddress: to,
    priceWei: sale.priceWei,
    currency: sale.currency,
    marketplace: sale.marketplace,
    txHash: event.transaction.hash,
    blockNumber,
    logIndex,
    timestamp: event.block.timestamp as bigint,
    cursor: cursorOf(blockNumber, logIndex),
  });
};

const handleWrap = async (args: EventArgs, kind: "wrap" | "unwrap") => {
  const { event, context } = args;
  const owner = event.args.owner as Address;
  const tokenId = event.args.tokenId as bigint;
  const blockNumber = event.block.number as bigint;
  const logIndex = Number(event.log.logIndex);
  const id = `${blockNumber}-${logIndex}`;

  await context.db.insert(wrapEvents).values({
    id,
    kind,
    tokenId,
    owner,
    txHash: event.transaction.hash,
    blockNumber,
    logIndex,
    timestamp: event.block.timestamp as bigint,
    cursor: cursorOf(blockNumber, logIndex),
  });
};

// Ponder's `ponder.on` is typed against the contract names declared in
// ponder.config.ts. We register names dynamically from the project config,
// so cast to a permissive signature. The `.bind(ponder)` is required because
// `ponder.on` reads `this.fns` internally; extracting it without binding
// detaches `this` and crashes at runtime.
type AnyHandler = (args: EventArgs) => Promise<void>;
const on = ponder.on.bind(ponder) as unknown as (event: string, handler: AnyHandler) => void;

on(`${cfg.primary.label}:Transfer`, async (args) => {
  await handleTransfer(args, cfg.primary.label, cfg.primary.address);
});

if (cfg.wrapper) {
  const wrapper = cfg.wrapper;
  on(`${wrapper.label}:Transfer`, async (args) => {
    await trackWrapperHolding(args);
    await handleTransfer(args, wrapper.label, wrapper.address);
  });
  on(`${wrapper.label}:Wrapped`, async (args) => {
    await handleWrap(args, "wrap");
  });
  on(`${wrapper.label}:Unwrapped`, async (args) => {
    await handleWrap(args, "unwrap");
  });
}

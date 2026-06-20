import { ponder } from "ponder:registry";
import { saleEvents, wrapEvents, wrapperHoldings } from "ponder:schema";
import {
  ZERO_ADDRESS,
  cursorOf,
  decodeMarketplaceSale,
  loadConfig,
} from "@abotbasho/shared";
import {
  TransactionReceiptNotFoundError,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { getVerificationPool } from "./verification/db.js";
import { maybeRecomputeForVerification } from "./verification/recompute.js";

const cfg = await loadConfig();
const verifyEnabled = cfg.verify?.enabled === true;

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

type ReceiptClient = {
  getTransactionReceipt: (args: { hash: Hash }) => Promise<TransactionReceipt>;
};

// dRPC (and other load-balanced RPC endpoints) spread requests across many
// backend nodes. When a Transfer lands in a fresh tip block, the node that
// served eth_getLogs can be a block or two ahead of the one that serves the
// follow-up eth_getTransactionReceipt, which then replies "receipt not found".
// A null receipt is a *successful* RPC response, so Ponder's network-level
// retry never kicks in: the error propagates out of the handler, Ponder marks
// it a fatal indexing error, and the process crash-loops re-processing the same
// block forever. Retry with capped backoff so the lagging backend can catch up;
// if the receipt still never shows (persistent lag or a reorged-out tx), skip
// sale detection for this transfer rather than taking the whole indexer down.
const RECEIPT_MAX_ATTEMPTS = 6;

const fetchReceipt = async (
  client: ReceiptClient,
  hash: Hash,
): Promise<TransactionReceipt | null> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (err) {
      if (!(err instanceof TransactionReceiptNotFoundError)) throw err;
      if (attempt >= RECEIPT_MAX_ATTEMPTS) {
        console.warn(
          `[indexer] receipt for ${hash} still missing after ${attempt} attempts; ` +
            `skipping sale detection (RPC tip lag or reorged tx)`,
        );
        return null;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)),
      );
    }
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

  // Verification per-link revocation. Runs before the ZERO_ADDRESS skip so
  // burns also trigger recompute. No-op if verify is disabled or neither
  // address is in the in-process hot-set.
  if (verifyEnabled) {
    await maybeRecomputeForVerification([from, to], {
      pool: await getVerificationPool(),
      client: context.client,
      primaryAddress: cfg.primary.address,
      wrapperAddress: cfg.wrapper?.address,
    });
  }

  if (from === ZERO_ADDRESS || to === ZERO_ADDRESS) return;

  // Skip transfers where the wrapper is one of the parties: those are wraps/unwraps,
  // not sales, and are handled by the Wrapped/Unwrapped event handlers.
  if (
    wrapperAddrLower &&
    (from.toLowerCase() === wrapperAddrLower || to.toLowerCase() === wrapperAddrLower)
  ) {
    return;
  }

  const receipt = await fetchReceipt(context.client, event.transaction.hash as Hash);
  if (!receipt) return;

  const sale = decodeMarketplaceSale(receipt.logs, contractAddress, tokenId);
  if (!sale) return;

  const blockNumber = event.block.number as bigint;
  const logIndex = Number(event.log.logIndex);
  const id = `${blockNumber}-${logIndex}`;

  // Idempotent insert. On crash recovery or a reorg, Ponder replays handlers
  // over blocks whose rows may already be committed (an unfinalized row that its
  // revert didn't remove). The PK is (block, logIndex), unique per log, so a
  // conflict always means "this exact event was already indexed". Skip it
  // instead of throwing, which Ponder treats as fatal and crash-loops on.
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
  }).onConflictDoNothing();
};

const handleWrap = async (args: EventArgs, kind: "wrap" | "unwrap") => {
  const { event, context } = args;
  const owner = event.args.owner as Address;
  const tokenId = event.args.tokenId as bigint;
  const blockNumber = event.block.number as bigint;
  const logIndex = Number(event.log.logIndex);
  const id = `${blockNumber}-${logIndex}`;

  // Idempotent insert: a replayed or reorged block must not crash-loop the
  // indexer on a duplicate PK. See handleTransfer's sale insert for the full
  // rationale.
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
  }).onConflictDoNothing();
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

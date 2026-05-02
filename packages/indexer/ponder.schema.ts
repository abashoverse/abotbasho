import { onchainTable, index } from "ponder";

export const saleEvents = onchainTable(
  "sale_events",
  (t) => ({
    id: t.text().primaryKey(),
    contract: t.text().notNull(),
    contractAddress: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    fromAddress: t.hex().notNull(),
    toAddress: t.hex().notNull(),
    priceWei: t.bigint().notNull(),
    currency: t.text().notNull(),
    marketplace: t.text().notNull(),
    txHash: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    cursor: t.bigint().notNull(),
  }),
  (t) => ({
    cursorIdx: index().on(t.cursor),
    timestampIdx: index().on(t.timestamp),
  }),
);

export const wrapperHoldings = onchainTable(
  "wrapper_holdings",
  (t) => ({
    id: t.text().primaryKey(),
    tokenId: t.bigint().notNull(),
    owner: t.hex().notNull(),
    holdingSince: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
  }),
  (t) => ({
    ownerIdx: index().on(t.owner),
  }),
);

export const wrapEvents = onchainTable(
  "wrap_events",
  (t) => ({
    id: t.text().primaryKey(),
    kind: t.text().notNull(),
    tokenId: t.bigint().notNull(),
    owner: t.hex().notNull(),
    txHash: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    cursor: t.bigint().notNull(),
  }),
  (t) => ({
    cursorIdx: index().on(t.cursor),
    timestampIdx: index().on(t.timestamp),
  }),
);

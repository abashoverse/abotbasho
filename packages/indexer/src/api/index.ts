import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client } from "ponder";
import { asc, desc, eq, gt } from "drizzle-orm";

const app = new Hono();

app.use("/sql/*", client({ db, schema }));

const stringifyBigints = (rows: Record<string, unknown>[]) =>
  rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === "bigint" ? v.toString() : v;
    }
    return out;
  });

app.get("/api/events", async (c) => {
  const sinceParam = c.req.query("since") ?? "0";
  let since: bigint;
  try {
    since = BigInt(sinceParam);
  } catch {
    return c.json({ error: "invalid 'since' parameter" }, 400);
  }
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 200);

  const [sales, wraps] = await Promise.all([
    db
      .select()
      .from(schema.saleEvents)
      .where(gt(schema.saleEvents.cursor, since))
      .orderBy(asc(schema.saleEvents.cursor))
      .limit(limit),
    db
      .select()
      .from(schema.wrapEvents)
      .where(gt(schema.wrapEvents.cursor, since))
      .orderBy(asc(schema.wrapEvents.cursor))
      .limit(limit),
  ]);

  return c.json({
    sales: stringifyBigints(sales),
    wraps: stringifyBigints(wraps),
  });
});

app.get("/api/holding", async (c) => {
  const tokenIdStr = c.req.query("tokenId");
  if (!tokenIdStr) return c.json({ error: "tokenId required" }, 400);
  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdStr);
  } catch {
    return c.json({ error: "invalid tokenId" }, 400);
  }

  const rows = await db
    .select()
    .from(schema.wrapperHoldings)
    .where(eq(schema.wrapperHoldings.id, tokenId.toString()))
    .limit(1);

  if (rows.length === 0) return c.json({ holding: null });
  return c.json({ holding: stringifyBigints(rows)[0] });
});

app.get("/api/recent", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "5", 10) || 5, 1), 50);
  const type = (c.req.query("type") ?? "all").toLowerCase();

  const wantSales = type === "all" || type === "sales";
  const wantWraps = type === "all" || type === "wraps";
  const wantUnwraps = type === "all" || type === "unwraps";

  const [sales, wraps] = await Promise.all([
    wantSales
      ? db
          .select()
          .from(schema.saleEvents)
          .orderBy(desc(schema.saleEvents.cursor))
          .limit(limit)
      : Promise.resolve([]),
    wantWraps && wantUnwraps
      ? db
          .select()
          .from(schema.wrapEvents)
          .orderBy(desc(schema.wrapEvents.cursor))
          .limit(limit)
      : wantWraps
        ? db
            .select()
            .from(schema.wrapEvents)
            .where(eq(schema.wrapEvents.kind, "wrap"))
            .orderBy(desc(schema.wrapEvents.cursor))
            .limit(limit)
        : wantUnwraps
          ? db
              .select()
              .from(schema.wrapEvents)
              .where(eq(schema.wrapEvents.kind, "unwrap"))
              .orderBy(desc(schema.wrapEvents.cursor))
              .limit(limit)
          : Promise.resolve([]),
  ]);

  return c.json({
    sales: stringifyBigints(sales),
    wraps: stringifyBigints(wraps),
  });
});

export default app;

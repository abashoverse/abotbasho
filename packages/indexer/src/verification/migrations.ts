import type { Pool } from "pg";

// Namespaced pg_advisory_lock keys for the verification migration runner.
// Stable forever. Never reuse this (key1, key2) pair anywhere else.
const ADVISORY_LOCK_KEY1 = 0x4b07ba50;
const ADVISORY_LOCK_KEY2 = 1;

export const LINK_CHANGES_CHANNEL = "verification_link_changes";

interface Migration {
  version: number;
  description: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "initial verification schema",
    sql: `
      CREATE TABLE IF NOT EXISTS verification.link_tokens (
        token_hash      BYTEA       PRIMARY KEY,
        discord_user_id TEXT        NOT NULL,
        guild_id        TEXT        NOT NULL,
        nonce           TEXT        NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at      TIMESTAMPTZ NOT NULL,
        consumed_at     TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS verification.links (
        discord_user_id TEXT        NOT NULL,
        holder_address  BYTEA       NOT NULL,
        signer_address  BYTEA,
        method          TEXT        NOT NULL CHECK (method IN ('siwe','delegate','bio')),
        guild_id        TEXT        NOT NULL,
        verified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (discord_user_id, holder_address)
      );
      CREATE INDEX IF NOT EXISTS links_holder_idx ON verification.links (holder_address);

      CREATE TABLE IF NOT EXISTS verification.role_events (
        id              BIGSERIAL   PRIMARY KEY,
        discord_user_id TEXT        NOT NULL,
        guild_id        TEXT        NOT NULL,
        desired_state   TEXT        NOT NULL CHECK (desired_state IN ('grant','revoke')),
        reason          TEXT        NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_at      TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS role_events_pending_idx
        ON verification.role_events (id) WHERE applied_at IS NULL;

      CREATE TABLE IF NOT EXISTS verification.bio_codes (
        code_hash       BYTEA       PRIMARY KEY,
        discord_user_id TEXT        NOT NULL,
        guild_id        TEXT        NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at      TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verification.audit (
        id              BIGSERIAL   PRIMARY KEY,
        discord_user_id TEXT,
        holder_address  BYTEA,
        signer_address  BYTEA,
        method          TEXT,
        action          TEXT        NOT NULL,
        detail          TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS audit_user_idx ON verification.audit (discord_user_id);

      CREATE OR REPLACE FUNCTION verification.notify_link_change() RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          PERFORM pg_notify('verification_link_changes', 'add:' || encode(NEW.holder_address, 'hex'));
        ELSIF TG_OP = 'DELETE' THEN
          PERFORM pg_notify('verification_link_changes', 'del:' || encode(OLD.holder_address, 'hex'));
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS verification_links_change_notify ON verification.links;
      CREATE TRIGGER verification_links_change_notify
        AFTER INSERT OR DELETE ON verification.links
        FOR EACH ROW EXECUTE FUNCTION verification.notify_link_change();
    `,
  },
  {
    version: 2,
    description:
      "generalize discord_user_id/guild_id to (platform, platform_user_id, platform_scope_id)",
    sql: `
      -- 1. Add platform column. DEFAULT 'discord' backfills existing rows.
      ALTER TABLE verification.link_tokens
        ADD COLUMN platform TEXT NOT NULL DEFAULT 'discord'
        CHECK (platform IN ('discord','telegram'));
      ALTER TABLE verification.links
        ADD COLUMN platform TEXT NOT NULL DEFAULT 'discord'
        CHECK (platform IN ('discord','telegram'));
      ALTER TABLE verification.role_events
        ADD COLUMN platform TEXT NOT NULL DEFAULT 'discord'
        CHECK (platform IN ('discord','telegram'));
      ALTER TABLE verification.bio_codes
        ADD COLUMN platform TEXT NOT NULL DEFAULT 'discord'
        CHECK (platform IN ('discord','telegram'));
      -- audit.platform is nullable to match the existing nullable audit.discord_user_id.
      ALTER TABLE verification.audit
        ADD COLUMN platform TEXT
        CHECK (platform IS NULL OR platform IN ('discord','telegram'));
      UPDATE verification.audit
        SET platform = 'discord'
        WHERE discord_user_id IS NOT NULL;

      -- 2. discord_user_id -> platform_user_id
      ALTER TABLE verification.link_tokens RENAME COLUMN discord_user_id TO platform_user_id;
      ALTER TABLE verification.links       RENAME COLUMN discord_user_id TO platform_user_id;
      ALTER TABLE verification.role_events RENAME COLUMN discord_user_id TO platform_user_id;
      ALTER TABLE verification.bio_codes   RENAME COLUMN discord_user_id TO platform_user_id;
      ALTER TABLE verification.audit       RENAME COLUMN discord_user_id TO platform_user_id;

      -- 3. guild_id -> platform_scope_id (audit has no guild_id, skip).
      ALTER TABLE verification.link_tokens RENAME COLUMN guild_id TO platform_scope_id;
      ALTER TABLE verification.links       RENAME COLUMN guild_id TO platform_scope_id;
      ALTER TABLE verification.role_events RENAME COLUMN guild_id TO platform_scope_id;
      ALTER TABLE verification.bio_codes   RENAME COLUMN guild_id TO platform_scope_id;

      -- 4. Repoint the links PK to include platform.
      ALTER TABLE verification.links DROP CONSTRAINT links_pkey;
      ALTER TABLE verification.links
        ADD CONSTRAINT links_pkey PRIMARY KEY (platform, platform_user_id, holder_address);

      -- 5. Audit user index now includes platform.
      DROP INDEX IF EXISTS verification.audit_user_idx;
      CREATE INDEX audit_user_idx ON verification.audit (platform, platform_user_id);

      -- 6. Drop the DEFAULT so future inserts must specify platform explicitly.
      ALTER TABLE verification.link_tokens ALTER COLUMN platform DROP DEFAULT;
      ALTER TABLE verification.links       ALTER COLUMN platform DROP DEFAULT;
      ALTER TABLE verification.role_events ALTER COLUMN platform DROP DEFAULT;
      ALTER TABLE verification.bio_codes   ALTER COLUMN platform DROP DEFAULT;
    `,
  },
];

export const runMigrations = async (pool: Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      ADVISORY_LOCK_KEY1,
      ADVISORY_LOCK_KEY2,
    ]);
    try {
      await client.query("CREATE SCHEMA IF NOT EXISTS verification");
      await client.query(`
        CREATE TABLE IF NOT EXISTS verification.schema_version (
          version    INT          PRIMARY KEY,
          applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
        )
      `);
      const { rows } = await client.query<{ version: number }>(
        "SELECT version FROM verification.schema_version",
      );
      const applied = new Set(rows.map((r) => r.version));
      for (const m of MIGRATIONS) {
        if (applied.has(m.version)) continue;
        await client.query("BEGIN");
        try {
          await client.query(m.sql);
          await client.query(
            "INSERT INTO verification.schema_version (version) VALUES ($1)",
            [m.version],
          );
          await client.query("COMMIT");
          console.log(`[verify] applied migration v${m.version}: ${m.description}`);
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        ADVISORY_LOCK_KEY1,
        ADVISORY_LOCK_KEY2,
      ]);
    }
  } finally {
    client.release();
  }
};

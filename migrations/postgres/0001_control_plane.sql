-- AMV CONTROL PLANE - the records that must be true, in one transactional
-- database (owner decision 30, Oct 26). Postgres 15+, reached from the Worker
-- through Cloudflare Hyperdrive. See docs/DATA-TIER.md for what moves, in what
-- order, and how each step is checked before the next.
--
-- Rules this schema keeps:
--   * Money is never one mutable number. Every credit and debit is a row in a
--     ledger that is only ever appended to; a balance is derived from it, and
--     the cached balance on the account is checked against it nightly.
--   * Every write that arrives from outside (a payment webhook, a SCIM call)
--     carries the provider's own id, and that id is UNIQUE - a second delivery
--     is a constraint violation, not a second charge.
--   * Emails are stored lower-cased and compared as given: lower() is applied
--     on the way in, never in a WHERE, so every lookup can use its index.
--   * Times are timestamptz. Amounts are numeric(14,6) US dollars - never float.

BEGIN;

-- A ledger row, once written, is history. Changing one is refused loudly -
-- not ignored, which is what a DO INSTEAD NOTHING rule would do, and a money
-- write that silently does nothing is the failure this whole design is for.
CREATE FUNCTION refuse_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only: write a correcting row instead', TG_TABLE_NAME;
END $$;

CREATE TABLE accounts (
  email            text PRIMARY KEY CHECK (email = lower(email)),
  name             text NOT NULL DEFAULT '',
  provider         text NOT NULL DEFAULT 'email',          -- email | google | sso
  pw_hash          text,                                   -- null for google/sso
  pw_salt          text,
  pw_iter          integer,
  email_verified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,                            -- erasure: row kept as a tombstone only
  extra            jsonb NOT NULL DEFAULT '{}'::jsonb       -- fields not yet given a column
);

-- What the account may use. One row per account; history is in billing_events.
CREATE TABLE entitlements (
  email            text PRIMARY KEY REFERENCES accounts(email),
  plan             text NOT NULL DEFAULT 'free',
  source           text NOT NULL DEFAULT 'none',           -- stripe | paypal | team | grant | none
  period_start     timestamptz,
  period_end       timestamptz,
  lapsed_at        timestamptz,
  blocked          boolean NOT NULL DEFAULT false,
  blocked_reason   text,
  custom_cfg       jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Every event from a payment provider, once. The UNIQUE is the idempotency.
CREATE TABLE billing_events (
  provider         text NOT NULL,                          -- stripe | paypal
  event_id         text NOT NULL,
  email            text REFERENCES accounts(email),
  kind             text NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  applied_at       timestamptz,
  payload_digest   text NOT NULL,                          -- sha-256 of the body; the body itself is not kept
  PRIMARY KEY (provider, event_id)
);

-- Paid credits: append-only. balance = sum(amount_usd) per email.
CREATE TABLE credit_ledger (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email            text NOT NULL REFERENCES accounts(email),
  amount_usd       numeric(14,6) NOT NULL,                 -- + purchase/refund-reversal, - spend/refund
  reason           text NOT NULL,                          -- purchase | spend | refund | dispute | grant | correction
  idempotency_key  text NOT NULL UNIQUE,                   -- provider event id, or request id for a spend
  at               timestamptz NOT NULL DEFAULT now(),
  note             text
);
CREATE INDEX credit_ledger_email_at ON credit_ledger (email, at);
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION refuse_ledger_change();

-- Marketplace seller money: the same shape, its own ledger.
CREATE TABLE seller_ledger (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email            text NOT NULL REFERENCES accounts(email),
  amount_usd       numeric(14,6) NOT NULL,                 -- + sale, - payout, - reversal
  reason           text NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  hold_until       timestamptz,                            -- a sale is not withdrawable until then
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_ledger_email_at ON seller_ledger (email, at);
CREATE TRIGGER seller_ledger_append_only BEFORE UPDATE OR DELETE ON seller_ledger
  FOR EACH ROW EXECUTE FUNCTION refuse_ledger_change();

-- API keys: only the hash is stored. Revocation is a timestamp, never a delete,
-- and the request path also asks the key's Durable Object (apikeyrev:<hash>).
CREATE TABLE api_keys (
  id               text PRIMARY KEY,
  email            text NOT NULL REFERENCES accounts(email),
  key_hash         text NOT NULL UNIQUE,
  name             text NOT NULL DEFAULT 'API key',
  scopes           text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz
);
CREATE INDEX api_keys_email ON api_keys (email);

CREATE TABLE teams (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  owner_email      text NOT NULL REFERENCES accounts(email),
  created_at       timestamptz NOT NULL DEFAULT now(),
  settings         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE team_members (
  team_id          text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email            text NOT NULL REFERENCES accounts(email),
  role             text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL DEFAULT 'invite',         -- invite | scim | sso
  PRIMARY KEY (team_id, email)
);
-- One team per person today; the index makes that a rule rather than a habit.
CREATE UNIQUE INDEX team_members_one_team ON team_members (email);

-- Company sign-in: a domain is proved before it is used.
CREATE TABLE sso_domains (
  domain           text PRIMARY KEY CHECK (domain = lower(domain)),
  team_id          text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  proved_at        timestamptz,
  required         boolean NOT NULL DEFAULT false,
  oidc             jsonb NOT NULL                          -- issuer, client id; the secret stays in Worker secrets
);

CREATE TABLE families (
  id               text PRIMARY KEY,
  owner_email      text NOT NULL REFERENCES accounts(email),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE family_members (
  family_id        text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email            text NOT NULL REFERENCES accounts(email),
  monthly_cap_usd  numeric(14,6),
  PRIMARY KEY (family_id, email)
);

-- The migration's own bookkeeping: where each account is read from, and where
-- the backfill has got to. An account moves only when its row says so.
CREATE TABLE migration_accounts (
  email            text PRIMARY KEY,
  read_from        text NOT NULL DEFAULT 'kv' CHECK (read_from IN ('kv','shadow','postgres')),
  backfilled_at    timestamptz,
  kv_digest        text,                                   -- what the KV records hashed to when copied
  mismatches       integer NOT NULL DEFAULT 0,
  last_mismatch    text
);
CREATE TABLE migration_cursor (
  kind             text PRIMARY KEY,                       -- acct | ent | team | apikeys | wallet | ...
  cursor           text,
  copied           bigint NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMIT;

-- AMV CONTROL PLANE - the records that must be true, in one transactional
-- database (owner decision 30, Oct 26). Postgres 15+, reached from the Worker
-- through Cloudflare Hyperdrive. See docs/DATA-TIER.md for what moves, in what
-- order, and how each step is checked before the next.
--
-- Second pass (Oct 31 production audit), before anything was applied:
--   * An account is an id, not an email. Emails change; the id every other
--     row points at does not.
--   * A person belongs to many organizations (their own, their company, a
--     client's), each with workspaces. "One team per email" is gone.
--   * Payment records carry the provider's own durable ids (customer,
--     subscription, invoice, event), and every amount carries its currency.
--
-- Rules this schema keeps:
--   * Money is never one mutable number. Every credit and debit is a row in a
--     ledger that is only ever appended to; a balance is derived from it, per
--     currency, and any cached balance is checked against it nightly.
--   * Every write that arrives from outside (a payment webhook, a SCIM call)
--     carries the provider's own id, and that id is UNIQUE - a second delivery
--     is a constraint violation, not a second charge.
--   * Emails are stored lower-cased and compared as given: lower() is applied
--     on the way in, never in a WHERE, so every lookup can use its index.
--   * Times are timestamptz. Amounts are numeric(18,6) in the row's own
--     currency (ISO 4217, upper case) - never float, never an implied dollar.

BEGIN;

-- A ledger row, once written, is history. Changing one is refused loudly -
-- not ignored, which is what a DO INSTEAD NOTHING rule would do, and a money
-- write that silently does nothing is the failure this whole design is for.
CREATE FUNCTION refuse_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only: write a correcting row instead', TG_TABLE_NAME;
END $$;

CREATE DOMAIN currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');

-- ── People ──────────────────────────────────────────────────────────────
CREATE TABLE accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE CHECK (email = lower(email)),
  name             text NOT NULL DEFAULT '',
  provider         text NOT NULL DEFAULT 'email',          -- email | google | sso
  pw_hash          text,                                   -- null for google/sso
  pw_salt          text,
  pw_algo          text,                                   -- pbkdf2-sha256 | argon2id: rehashed on sign-in when it changes
  pw_iter          integer,
  email_verified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,                            -- erasure: row kept as a tombstone only
  extra            jsonb NOT NULL DEFAULT '{}'::jsonb       -- fields not yet given a column
);

-- ── Organizations, workspaces, memberships ──────────────────────────────
-- Every account has a personal organization; a company is another; a client
-- that invites a consultant is a third. Policies attach at organization,
-- workspace or membership level.
CREATE TABLE organizations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  kind             text NOT NULL DEFAULT 'company' CHECK (kind IN ('personal','company','family','school')),
  created_by       uuid NOT NULL REFERENCES accounts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  policy           jsonb NOT NULL DEFAULT '{}'::jsonb      -- engines allowed, spend ceilings, retention
);
CREATE TABLE memberships (
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id),
  role             text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  source           text NOT NULL DEFAULT 'invite',         -- invite | scim | sso | personal
  monthly_cap      numeric(18,6),                          -- a family or company ceiling for this member
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, account_id)
);
CREATE INDEX memberships_account ON memberships (account_id);
-- One personal organization per account, and only its creator in it as owner.
CREATE UNIQUE INDEX one_personal_org ON organizations (created_by) WHERE kind = 'personal';

CREATE TABLE workspaces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  policy           jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (org_id, name)
);
-- A workspace is open to the organization's members unless it lists its own;
-- a row here narrows or raises one member's role inside one workspace.
CREATE TABLE workspace_members (
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id),
  role             text NOT NULL CHECK (role IN ('admin','member','viewer')),
  PRIMARY KEY (workspace_id, account_id)
);

-- Company sign-in: a domain is proved before it is used, and belongs to one org.
CREATE TABLE sso_domains (
  domain           text PRIMARY KEY CHECK (domain = lower(domain)),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proved_at        timestamptz,
  required         boolean NOT NULL DEFAULT false,
  oidc             jsonb NOT NULL                          -- issuer, client id; the secret stays in Worker secrets
);

-- ── What an account or organization may use ─────────────────────────────
-- Exactly one of account_id / org_id: a personal plan, or a company's seats.
CREATE TABLE entitlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid REFERENCES accounts(id),
  org_id           uuid REFERENCES organizations(id),
  plan             text NOT NULL DEFAULT 'free',
  seats            integer,
  source           text NOT NULL DEFAULT 'none',           -- stripe | paypal | org | grant | none
  period_start     timestamptz,
  period_end       timestamptz,
  lapsed_at        timestamptz,
  blocked          boolean NOT NULL DEFAULT false,
  blocked_reason   text,
  custom_cfg       jsonb,
  extra            jsonb NOT NULL DEFAULT '{}'::jsonb,     -- fields not yet given a column (shadow reads compare them too)
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((account_id IS NULL) <> (org_id IS NULL))
);
CREATE UNIQUE INDEX entitlements_account ON entitlements (account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX entitlements_org ON entitlements (org_id) WHERE org_id IS NOT NULL;

-- ── Payment providers, by their own durable ids ─────────────────────────
CREATE TABLE billing_customers (
  provider         text NOT NULL,                          -- stripe | paypal
  provider_customer_id text NOT NULL,
  account_id       uuid REFERENCES accounts(id),
  org_id           uuid REFERENCES organizations(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_customer_id),
  CHECK ((account_id IS NULL) <> (org_id IS NULL))
);
CREATE TABLE subscriptions (
  provider         text NOT NULL,
  provider_subscription_id text NOT NULL,
  provider_customer_id text NOT NULL,
  plan             text NOT NULL,
  status           text NOT NULL,                          -- active | past_due | canceled | ...
  currency         currency_code NOT NULL,
  amount           numeric(18,6) NOT NULL,                 -- per period, in currency
  interval         text NOT NULL CHECK (interval IN ('month','year')),
  current_period_end timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subscription_id),
  FOREIGN KEY (provider, provider_customer_id) REFERENCES billing_customers (provider, provider_customer_id)
);
-- Every event from a payment provider, once. The PRIMARY KEY is the idempotency.
CREATE TABLE billing_events (
  provider         text NOT NULL,
  event_id         text NOT NULL,
  provider_customer_id text,
  invoice_id       text,
  kind             text NOT NULL,                          -- checkout | invoice.paid | refund | dispute | ...
  currency         currency_code,
  amount           numeric(18,6),
  tax              numeric(18,6),
  received_at      timestamptz NOT NULL DEFAULT now(),
  applied_at       timestamptz,
  payload_digest   text NOT NULL,                          -- sha-256 of the body; the body itself is not kept
  PRIMARY KEY (provider, event_id)
);

-- ── Money ───────────────────────────────────────────────────────────────
-- Paid credits: append-only. balance = sum(amount) per (account, currency).
CREATE TABLE credit_ledger (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES accounts(id),
  currency         currency_code NOT NULL,
  amount           numeric(18,6) NOT NULL,                 -- + purchase/refund-reversal, - spend/refund
  reason           text NOT NULL CHECK (reason IN ('purchase','spend','refund','dispute','grant','correction','expiry')),
  idempotency_key  text NOT NULL UNIQUE,                   -- provider event id, or request id for a spend
  source_event     text,                                   -- '<provider>:<event_id>' when one caused it
  at               timestamptz NOT NULL DEFAULT now(),
  note             text
);
CREATE INDEX credit_ledger_account_at ON credit_ledger (account_id, currency, at);
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION refuse_ledger_change();

-- Marketplace seller money: the same shape, its own ledger.
CREATE TABLE seller_ledger (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES accounts(id),
  currency         currency_code NOT NULL,
  amount           numeric(18,6) NOT NULL,                 -- + sale, - payout, - reversal, - fee
  reason           text NOT NULL CHECK (reason IN ('sale','payout','reversal','fee','correction')),
  idempotency_key  text NOT NULL UNIQUE,
  hold_until       timestamptz,                            -- a sale is not withdrawable until then
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_ledger_account_at ON seller_ledger (account_id, currency, at);
CREATE TRIGGER seller_ledger_append_only BEFORE UPDATE OR DELETE ON seller_ledger
  FOR EACH ROW EXECUTE FUNCTION refuse_ledger_change();

-- ── Credentials for machines ────────────────────────────────────────────
-- API keys: only the hash is stored. Revocation is a timestamp, never a
-- delete, and the request path also asks the key's Durable Object
-- (apikeyrev:<hash>). A key may be scoped to one organization.
CREATE TABLE api_keys (
  id               text PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES accounts(id),
  org_id           uuid REFERENCES organizations(id),
  key_hash         text NOT NULL UNIQUE,
  name             text NOT NULL DEFAULT 'API key',
  scopes           text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz
);
CREATE INDEX api_keys_account ON api_keys (account_id);

-- ── The migration's own bookkeeping ─────────────────────────────────────
-- Keyed by email because KV is: where each account is read from, and where
-- the backfill has got to. An account moves only when its row says so.
CREATE TABLE migration_accounts (
  email            text PRIMARY KEY CHECK (email = lower(email)),
  account_id       uuid REFERENCES accounts(id),
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

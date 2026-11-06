-- MONEY CONSTRAINTS (Nov 3 audit DATA-017).
-- Amounts are exact NUMERIC(18,6) already, never floating point. This adds
-- what a ledger row must also be: a currency AMV supports, with its number of
-- minor units; a non-zero amount (an opening row may be zero, and is written
-- once to record that the balance was measured); a bounded size; and, for
-- seller money that is actually paid out, whole minor units. Credit usage is
-- metered below a cent on purpose (a message costs fractions of one), so the
-- credit ledger keeps six places.
BEGIN;

CREATE TABLE IF NOT EXISTS currencies (
  code        currency_code PRIMARY KEY,
  minor_units smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 4)
);
INSERT INTO currencies (code, minor_units) VALUES
  ('USD', 2), ('EUR', 2), ('GBP', 2), ('CAD', 2), ('AUD', 2), ('CHF', 2), ('SEK', 2), ('NOK', 2), ('DKK', 2),
  ('JPY', 0), ('KRW', 0), ('INR', 2), ('BRL', 2), ('MXN', 2), ('SGD', 2), ('HKD', 2), ('NZD', 2), ('ZAR', 2)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE credit_ledger
  ADD CONSTRAINT credit_ledger_currency_known FOREIGN KEY (currency) REFERENCES currencies(code),
  ADD CONSTRAINT credit_ledger_amount_nonzero CHECK (amount <> 0 OR reason = 'correction'),
  ADD CONSTRAINT credit_ledger_amount_bounded CHECK (abs(amount) < 1000000000);

ALTER TABLE seller_ledger
  ADD CONSTRAINT seller_ledger_currency_known FOREIGN KEY (currency) REFERENCES currencies(code),
  ADD CONSTRAINT seller_ledger_amount_nonzero CHECK (amount <> 0 OR reason = 'correction'),
  ADD CONSTRAINT seller_ledger_amount_bounded CHECK (abs(amount) < 1000000000);

-- Seller money is paid out, so it is whole minor units of its currency.
CREATE OR REPLACE FUNCTION seller_amount_in_minor_units() RETURNS trigger AS $$
DECLARE mu smallint;
BEGIN
  SELECT minor_units INTO mu FROM currencies WHERE code = NEW.currency;
  IF NEW.amount <> round(NEW.amount, mu) THEN
    RAISE EXCEPTION 'seller amount % is not whole minor units of %', NEW.amount, NEW.currency;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER seller_ledger_minor_units BEFORE INSERT ON seller_ledger
  FOR EACH ROW EXECUTE FUNCTION seller_amount_in_minor_units();

COMMIT;

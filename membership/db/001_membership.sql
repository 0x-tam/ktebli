-- Apply only to an isolated Neon branch with the migration owner. Runtime uses
-- non-owner roles, never neon_auth or the Data API. No changes to Supabase.
CREATE SCHEMA IF NOT EXISTS membership;
REVOKE ALL ON SCHEMA membership FROM PUBLIC;
DO $$ BEGIN CREATE ROLE membership_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE membership_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA membership TO membership_runtime, membership_worker;
CREATE TABLE membership.profiles (
 user_id text PRIMARY KEY, organization_name text NOT NULL DEFAULT '', organization_type text NOT NULL DEFAULT 'company' CHECK (organization_type IN ('company','ngo','individual','public_body')),
 sectors text[] NOT NULL DEFAULT '{}', capabilities text NOT NULL DEFAULT '', locations text[] NOT NULL DEFAULT ARRAY['Lebanon'],
 alerts_enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(), revision integer NOT NULL DEFAULT 1,
 CHECK(length(organization_name)<=160 AND length(capabilities)<=4000 AND cardinality(sectors)<=12 AND cardinality(locations)<=10)
);
CREATE TABLE membership.opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL CHECK(source IN ('cdr','ppa','japan-ggp','australia-dap','czech-ssp','canada-cfli','eeas','aics','undp','ungm')), source_key text NOT NULL,
 source_url text NOT NULL CHECK(source_url LIKE 'https://%'), title text NOT NULL, description text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK(kind IN ('procurement','grant','unknown')), published_at date, deadline date,
 evidence jsonb NOT NULL DEFAULT '[]', locales jsonb NOT NULL DEFAULT '[]', content_hash text NOT NULL,
 fetched_at timestamptz NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source,source_key),
 CHECK(length(title)<=2000 AND length(description)<=60000 AND jsonb_typeof(evidence)='array' AND jsonb_typeof(locales)='array')
);
CREATE INDEX opportunities_deadline_idx ON membership.opportunities(deadline);
CREATE TABLE membership.saved_opportunities (
 user_id text NOT NULL, opportunity_id uuid NOT NULL REFERENCES membership.opportunities(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,opportunity_id)
);
CREATE TABLE membership.customers(user_id text PRIMARY KEY, stripe_customer_id text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE membership.subscriptions (
 user_id text PRIMARY KEY REFERENCES membership.customers(user_id), stripe_subscription_id text UNIQUE NOT NULL,
 state text NOT NULL CHECK(state IN ('active','inactive','canceled','past_due')), paid_until timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE membership.webhook_events(event_id text PRIMARY KEY,event_type text NOT NULL,processed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE membership.credits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES membership.customers(user_id), invoice_id text UNIQUE NOT NULL,
 amount_cents integer NOT NULL DEFAULT 2000 CHECK(amount_cents=2000), valid_from timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'available' CHECK(state IN ('available','reserved','redeemed','revoked')),
 reservation_id uuid UNIQUE, order_reference text UNIQUE, reserved_at timestamptz, redeemed_at timestamptz,
 CHECK(expires_at>valid_from), CHECK((state IN ('reserved','redeemed'))=(reservation_id IS NOT NULL)),
 CHECK(state<>'redeemed' OR (order_reference IS NOT NULL AND redeemed_at IS NOT NULL))
);
CREATE INDEX credits_user_expiry_idx ON membership.credits(user_id,expires_at DESC);
CREATE TABLE membership.matches (
 user_id text NOT NULL, opportunity_id uuid NOT NULL REFERENCES membership.opportunities(id) ON DELETE CASCADE,
 profile_revision integer NOT NULL, content_hash text NOT NULL, fit numeric NOT NULL CHECK(fit BETWEEN 0 AND 100),
 confidence numeric NOT NULL CHECK(confidence BETWEEN 0 AND 1), eligibility text NOT NULL CHECK(eligibility IN ('possible','unclear','excluded')),
 reasons jsonb NOT NULL, model text NOT NULL, matched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,opportunity_id)
);
CREATE INDEX matches_user_fit_idx ON membership.matches(user_id,fit DESC);
CREATE TABLE membership.alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text NOT NULL, opportunity_id uuid NOT NULL REFERENCES membership.opportunities(id) ON DELETE CASCADE,
 content_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 UNIQUE(user_id,opportunity_id,content_hash)
);
CREATE INDEX alerts_user_created_idx ON membership.alerts(user_id,created_at DESC);
CREATE TABLE membership.matching_spend (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, opportunity_id uuid NOT NULL,
 reserved_usd numeric NOT NULL CHECK(reserved_usd>0), actual_usd numeric CHECK(actual_usd>=0),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','completed','failed')), usage jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['profiles','saved_opportunities','customers','subscriptions','credits','matches','alerts','matching_spend'] LOOP
  EXECUTE format('ALTER TABLE membership.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE membership.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY tenant ON membership.%I TO membership_runtime USING (user_id = current_setting(''app.user_id'',true)) WITH CHECK (user_id = current_setting(''app.user_id'',true))',tab);
  EXECUTE format('CREATE POLICY worker ON membership.%I TO membership_worker USING (true) WITH CHECK (true)',tab);
 END LOOP;
END $$;
ALTER TABLE membership.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY catalogue_read ON membership.opportunities FOR SELECT TO membership_runtime USING(true);
CREATE POLICY catalogue_worker ON membership.opportunities TO membership_worker USING(true) WITH CHECK(true);
ALTER TABLE membership.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_worker ON membership.webhook_events TO membership_worker USING(true) WITH CHECK(true);
GRANT SELECT ON membership.opportunities,membership.customers,membership.subscriptions,membership.credits,membership.matches,membership.alerts TO membership_runtime;
GRANT SELECT,INSERT,UPDATE ON membership.profiles TO membership_runtime;
GRANT SELECT,INSERT,DELETE ON membership.saved_opportunities TO membership_runtime;
GRANT UPDATE(read_at) ON membership.alerts TO membership_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA membership TO membership_worker;
-- Grant one of the above roles to dedicated logins outside this migration.
CREATE TABLE membership.checkouts(user_id text PRIMARY KEY REFERENCES membership.customers(user_id),attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),stripe_session_id text UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE membership.checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.checkouts FORCE ROW LEVEL SECURITY;
CREATE POLICY checkout_worker ON membership.checkouts TO membership_worker USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON membership.checkouts TO membership_worker;
ALTER TABLE membership.profiles ADD COLUMN qualifications text[] NOT NULL DEFAULT '{}', ADD COLUMN interests text[] NOT NULL DEFAULT '{}', ADD COLUMN excluded_work text[] NOT NULL DEFAULT '{}', ADD COLUMN opportunity_types text[] NOT NULL DEFAULT ARRAY['procurement','grant'];
ALTER TABLE membership.profiles ADD CHECK(cardinality(qualifications)<=20 AND cardinality(interests)<=20 AND cardinality(excluded_work)<=20 AND cardinality(opportunity_types)<=2);

ALTER TABLE membership.opportunities ADD COLUMN detail_status text NOT NULL DEFAULT 'not_fetched', ADD COLUMN deadline_conflict boolean NOT NULL DEFAULT false, ADD COLUMN application_status text NOT NULL DEFAULT 'needs_verification';
CREATE TABLE membership.source_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),coverage jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE membership.source_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.source_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY source_runs_worker ON membership.source_runs TO membership_worker USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON membership.source_runs TO membership_worker;

DO $$ BEGIN CREATE ROLE membership_billing NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA membership TO membership_billing;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['customers','subscriptions','credits','webhook_events','checkouts'] LOOP
 EXECUTE format('CREATE POLICY billing ON membership.%I TO membership_billing USING(true) WITH CHECK(true)',tab);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON membership.%I TO membership_billing',tab);
 END LOOP;
END $$;
ALTER TABLE membership.credits ADD CONSTRAINT one_credit_per_cycle UNIQUE(user_id,valid_from);
ALTER TABLE membership.credits ADD COLUMN checkout_token text, ADD COLUMN tier text CHECK(tier IN ('draft','competitive','full')), ADD COLUMN stripe_session_id text UNIQUE, ADD COLUMN buyer_email text;
CREATE UNIQUE INDEX credits_checkout_token_idx ON membership.credits(checkout_token) WHERE checkout_token IS NOT NULL;
CREATE TABLE membership.bridge_nonces(nonce uuid PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE membership.bridge_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.bridge_nonces FORCE ROW LEVEL SECURITY;
CREATE POLICY nonce_billing ON membership.bridge_nonces TO membership_billing USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,DELETE ON membership.bridge_nonces TO membership_billing;

ALTER TABLE membership.matching_spend ADD COLUMN profile_revision integer NOT NULL,ADD COLUMN content_hash text NOT NULL;
ALTER TABLE membership.matching_spend ADD CONSTRAINT matching_version_once UNIQUE(user_id,opportunity_id,profile_revision,content_hash);
ALTER TABLE membership.credits ADD COLUMN checkout_expires_at bigint;
CREATE TABLE membership.payment_reversals(invoice_id text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE membership.payment_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.payment_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY reversals_billing ON membership.payment_reversals TO membership_billing USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON membership.payment_reversals TO membership_billing;
CREATE TABLE membership.rate_limits(user_id text NOT NULL,action text NOT NULL,window_start timestamptz NOT NULL,hits integer NOT NULL CHECK(hits>0),PRIMARY KEY(user_id,action));
ALTER TABLE membership.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY limits_tenant ON membership.rate_limits TO membership_runtime USING(user_id=current_setting('app.user_id',true)) WITH CHECK(user_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE ON membership.rate_limits TO membership_runtime;
ALTER TABLE membership.credits ADD COLUMN checkout_request jsonb;
ALTER TABLE membership.profiles ADD COLUMN past_work text NOT NULL DEFAULT '' CHECK(length(past_work)<=2000),ADD COLUMN team_capacity text NOT NULL DEFAULT '' CHECK(length(team_capacity)<=500),ADD COLUMN languages text[] NOT NULL DEFAULT '{}',ADD COLUMN budget_min integer CHECK(budget_min>=0),ADD COLUMN budget_max integer CHECK(budget_max>=budget_min);
-- Standalone jobs cannot mint, change or reset billing entitlements or budgets.
REVOKE ALL ON ALL TABLES IN SCHEMA membership FROM membership_worker;
GRANT SELECT ON membership.profiles,membership.subscriptions TO membership_worker;
GRANT SELECT,INSERT,UPDATE ON membership.opportunities,membership.matches,membership.alerts TO membership_worker;
GRANT SELECT,INSERT ON membership.source_runs,membership.matching_spend TO membership_worker;
GRANT UPDATE(status,usage,actual_usd) ON membership.matching_spend TO membership_worker;
CREATE TABLE membership.matching_blocks(user_id text NOT NULL,opportunity_id uuid NOT NULL,profile_revision integer NOT NULL,content_hash text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,opportunity_id,profile_revision,content_hash));
ALTER TABLE membership.matching_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership.matching_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY matching_blocks_worker ON membership.matching_blocks TO membership_worker USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON membership.matching_blocks TO membership_worker;
REVOKE DELETE ON ALL TABLES IN SCHEMA membership FROM membership_billing;

ALTER TABLE membership.credits ADD COLUMN checkout_resolution text CHECK(checkout_resolution IN ('expired','paid_review'));

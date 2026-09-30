-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926050000_accounts_and_refresh_tokens
--
-- Phase 2 identity: the api's own login accounts replace the Supabase
-- auth.users that officers.user_id / applicants.user_id used to reference.
--   1. accounts        - one row per login identity (email + argon2 hash)
--   2. refresh_tokens  - SHA-256 hashes of issued refresh tokens (never raw)
--   3. officers.user_id and applicants.user_id -> accounts.id foreign keys
--      (their existing unique constraints are unchanged)
--
-- New tables are created by the migration owner, so the default privileges
-- from migration 20260926030000 give app_user SELECT/INSERT/UPDATE/DELETE on
-- them automatically. No RLS policy or audit trigger is added or changed.
-- ============================================================================

-- 1. accounts ----------------------------------------------------------------
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
    -- The api lower-cases emails; enforce it so uniqueness is case-insensitive.
    CONSTRAINT "accounts_email_lowercase_check" CHECK ("email" = lower("email"))
);

CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- 2. refresh_tokens ----------------------------------------------------------
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_account_id_idx" ON "refresh_tokens"("account_id");

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. identity foreign keys ---------------------------------------------------
-- RESTRICT: an account that owns an officer or applicant row cannot be deleted
-- out from under it (deactivate via accounts.is_active instead).
ALTER TABLE "officers" ADD CONSTRAINT "officers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "applicants" ADD CONSTRAINT "applicants_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260927010000_notifications
--
-- Phase 8. One row per (recipient account, channel) delivery. No existing
-- migration, RLS policy or audit function is changed.
--
-- Recipient: always a resolved account. An officer-audience intent (role +
-- jurisdiction) is resolved to the individual officer accounts it covers
-- when dispatched, so every row has one reader, the in-app endpoint needs
-- no jurisdiction logic (it filters by the caller's own account id), and
-- read / delivery state is per person. The audience the row was resolved
-- from is kept in recipient_role / recipient_jurisdiction_* for traceability.
--
-- Content: the rendered text as PERSISTED. Templates render twice: once for
-- live delivery, once for storage, where any template parameter named by
-- Phase 3's SENSITIVE_PROFILE_KEYS is replaced by "[redacted]". (No current
-- domain event carries a sensitive value; the rule is enforced anyway.)
--
-- Not audited: these rows are communications about decisions, not inputs to
-- them (Phase 1 precedent), and are high volume. Not RLS-protected: the only
-- read path is the api's own endpoint, which filters by the authenticated
-- caller's account id; writes come from the in-process listener (no actor).
-- ============================================================================

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient_account_id" UUID NOT NULL,
    "recipient_address" TEXT,
    "recipient_role" TEXT,
    "recipient_jurisdiction_state" TEXT,
    "recipient_jurisdiction_district" TEXT,
    "application_id" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "redacted_params" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_channel_check" CHECK ("channel" IN ('IN_APP', 'EMAIL', 'SMS')),
    CONSTRAINT "notifications_status_check" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED')),
    CONSTRAINT "notifications_delivered_check" CHECK (("status" = 'SENT') = ("delivered_at" IS NOT NULL))
);

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_account_id_fkey"
    FOREIGN KEY ("recipient_account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- In-app inbox: newest first for one account.
CREATE INDEX "notifications_recipient_channel_created_idx"
    ON "notifications"("recipient_account_id", "channel", "created_at" DESC);
-- Consistency de-duplication: latest notification per application and event type.
CREATE INDEX "notifications_application_event_created_idx"
    ON "notifications"("application_id", "event_type", "created_at" DESC);

-- ============================================================
-- NeuroBusiness™ — Subscriptions-Tabelle
-- Supabase SQL Editor:
-- https://supabase.com/dashboard/project/psqfrdpitjmfwvupmfdp/sql/new
--
-- Voraussetzungen: coaches-Tabelle und profiles-Tabelle existieren bereits.
-- ============================================================

-- ── 1. Tabelle anlegen ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stripe-IDs (eindeutig, für Upserts genutzt)
  stripe_subscription_id  TEXT        NOT NULL UNIQUE,
  stripe_customer_id      TEXT        NOT NULL,

  -- Wer hat abonniert?
  client_email            TEXT,                       -- Email aus Stripe Checkout
  profile_id              UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  coach_id                UUID        REFERENCES public.coaches(id)  ON DELETE SET NULL,

  -- Abo-Status (Werte spiegeln Stripe 1:1)
  status                  TEXT        NOT NULL DEFAULT 'incomplete'
                          CHECK (status IN ('active','past_due','canceled','incomplete','trialing')),

  -- Laufzeit
  current_period_end      TIMESTAMPTZ,

  -- Timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ
);

-- ── 2. Indizes ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx
  ON public.subscriptions (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS subscriptions_coach_idx
  ON public.subscriptions (coach_id);

CREATE INDEX IF NOT EXISTS subscriptions_profile_idx
  ON public.subscriptions (profile_id);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON public.subscriptions (status);

-- ── 3. Auto-updated_at Trigger ────────────────────────────────────────────
-- Nutzt dieselbe Funktion wie coaches-Tabelle (set_updated_at muss existieren)
-- Falls noch nicht vorhanden:
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. RLS aktivieren ─────────────────────────────────────────────────────
-- Tabelle ist server-seitig (nur über service_role / SECURITY DEFINER).
-- Kein direkter Zugriff vom Browser → RLS enabled aber KEINE öffentliche Policy.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Admin-Lesezugriff: nur Eva (wird von get_coaches_admin() genutzt)
-- Kein INSERT/UPDATE/DELETE über anon/authenticated — nur der Webhook-Handler
-- mit dem service_role-Key darf schreiben.

SELECT 'subscriptions table OK' AS status;

-- Bounties: a separate marketplace primitive from gigs. A creator posts a
-- bounty with a structured questionnaire and a fixed per-submission payout.
-- Submitters answer the questionnaire; the creator approves/rejects each one,
-- and pays approved submissions via CoinPayPortal (manual pay flow, mirroring
-- gig_invoices).

CREATE TABLE IF NOT EXISTS bounties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  payout_usd numeric NOT NULL CHECK (payout_usd > 0),
  payout_currency text NOT NULL DEFAULT 'USD',
  -- questions: jsonb array of
  --   { id: string, type: 'short_text'|'long_text'|'multiple_choice',
  --     label: string, required: boolean, options?: string[] }
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_submissions int CHECK (max_submissions IS NULL OR max_submissions > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'paused', 'closed')),
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bounties_creator_id ON bounties(creator_id);
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bounties_created_at ON bounties(created_at DESC);

CREATE TABLE IF NOT EXISTS bounty_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
  submitter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- answers: jsonb array of { question_id: string, value: string|string[] }
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id),
  -- Payout tracking; separate from approval status so we can show
  -- "approved but unpaid" in the dashboard.
  payout_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payout_status IN ('unpaid', 'invoiced', 'paid')),
  coinpay_invoice_id text,
  pay_url text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bounty_id, submitter_id)
);

CREATE INDEX idx_bounty_submissions_bounty_id ON bounty_submissions(bounty_id);
CREATE INDEX idx_bounty_submissions_submitter_id ON bounty_submissions(submitter_id);
CREATE INDEX idx_bounty_submissions_status ON bounty_submissions(status);
CREATE INDEX idx_bounty_submissions_payout_status ON bounty_submissions(payout_status);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION set_bounty_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bounties_updated_at
  BEFORE UPDATE ON bounties
  FOR EACH ROW EXECUTE FUNCTION set_bounty_updated_at();

CREATE TRIGGER trg_bounty_submissions_updated_at
  BEFORE UPDATE ON bounty_submissions
  FOR EACH ROW EXECUTE FUNCTION set_bounty_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_submissions ENABLE ROW LEVEL SECURITY;

-- Bounties: anyone (anon or authed) can read non-closed bounties; the creator
-- can always read their own (including closed). Only the creator can mutate.
CREATE POLICY "Bounties are publicly readable when not closed"
  ON bounties FOR SELECT
  USING (status <> 'closed' OR auth.uid() = creator_id);

CREATE POLICY "Creators can insert their own bounties"
  ON bounties FOR INSERT
  WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update their own bounties"
  ON bounties FOR UPDATE
  USING (auth.uid() = creator_id);

CREATE POLICY "Creators can delete their own bounties"
  ON bounties FOR DELETE
  USING (auth.uid() = creator_id);

-- Submissions: visible to the submitter (own rows) and to the bounty creator
-- (all rows on their bounty). Submitter inserts own. Submitter can update only
-- their own pending submission (e.g. withdraw). Creator can update any
-- submission on their bounty (approve/reject/pay).
CREATE POLICY "Submissions visible to submitter and bounty creator"
  ON bounty_submissions FOR SELECT
  USING (
    auth.uid() = submitter_id
    OR auth.uid() IN (SELECT creator_id FROM bounties WHERE id = bounty_id)
  );

CREATE POLICY "Users can submit their own answers"
  ON bounty_submissions FOR INSERT
  WITH CHECK (auth.uid() = submitter_id);

CREATE POLICY "Submitters can update their pending submission"
  ON bounty_submissions FOR UPDATE
  USING (auth.uid() = submitter_id AND status = 'pending');

CREATE POLICY "Creators can update submissions on their bounty"
  ON bounty_submissions FOR UPDATE
  USING (
    auth.uid() IN (SELECT creator_id FROM bounties WHERE id = bounty_id)
  );

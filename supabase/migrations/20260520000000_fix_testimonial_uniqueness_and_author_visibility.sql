-- Fix testimonial uniqueness so the three legitimate cases can coexist:
--   1. Profile-only testimonial   (profile_id NOT NULL, gig_id NULL)        — 1 per author per profile
--   2. Gig-only testimonial       (profile_id NULL,     gig_id NOT NULL)    — 1 per author per gig
--   3. Per-worker gig review      (profile_id NOT NULL, gig_id NOT NULL)    — 1 per author per (profile, gig)
--
-- Previously:
--   * Table-level UNIQUE(profile_id, author_id) blocked having a profile-only review
--     coexist with a per-worker gig review for the same person.
--   * idx_testimonials_author_gig UNIQUE(author_id, gig_id) blocked the gig poster
--     from leaving reviews for multiple workers on the same gig.
--
-- Also extend the SELECT RLS policy so authors can see their own pending testimonials.

-- 1. Drop the over-broad table-level uniqueness on (profile_id, author_id).
ALTER TABLE testimonials DROP CONSTRAINT IF EXISTS testimonials_profile_id_author_id_key;

-- 2. Drop the old per-gig uniqueness that ignored worker identity.
DROP INDEX IF EXISTS idx_testimonials_author_gig;

-- 3. Add partial indexes enforcing the three cases.
CREATE UNIQUE INDEX IF NOT EXISTS idx_testimonials_author_profile_only
  ON testimonials(author_id, profile_id)
  WHERE profile_id IS NOT NULL AND gig_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_testimonials_author_gig_only
  ON testimonials(author_id, gig_id)
  WHERE profile_id IS NULL AND gig_id IS NOT NULL;

-- idx_testimonials_author_profile_gig already exists from 20260321093000 and
-- enforces the per-worker per-gig case.

-- 4. Extend SELECT policy: authors can see their own testimonials at any status.
DROP POLICY IF EXISTS "Anyone can view approved testimonials" ON testimonials;
CREATE POLICY "Anyone can view approved testimonials" ON testimonials
  FOR SELECT USING (
    status = 'approved'
    OR auth.uid() = author_id
    OR auth.uid() = profile_id
    OR gig_id IN (SELECT id FROM gigs WHERE poster_id = auth.uid())
  );

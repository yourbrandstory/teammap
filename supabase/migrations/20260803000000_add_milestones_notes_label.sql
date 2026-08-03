-- ============================================================================
-- TeamMap — Add missing milestones columns (notes, label_id)
--
-- PROBLEM:
--   The app's msToRow/msFromRow and MilestoneModal have always referenced
--   `notes` and `label_id`, but neither migration added them to the DB
--   (migrate_milestones.sql added everything else; add_milestones_notes.sql
--   was never applied). Every upsertMilestone() therefore failed with
--   PGRST204/42703 (missing column), and the fallback wrote ONLY `substeps`,
--   silently dropping mood / deadline / display_days / title / etc. on every
--   save. This is why substeps persisted but Mood, Deadline and the
--   "appears on specific days" field reverted on reload.
--
-- FIX: add the two missing columns so the full payload persists.
-- ============================================================================

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS notes    TEXT DEFAULT '';
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS label_id TEXT DEFAULT 'milestone';

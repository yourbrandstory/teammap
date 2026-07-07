-- ============================================================================
-- TeamMap — Strip HTML tags from existing task notes
-- The notes column on the tasks table previously received HTML-rich content
-- (e.g. <p>, <br> tags) from a rich-text source. This migration converts
-- those to plain text so they render cleanly in the plain-<textarea> Notes field.
--
-- INSTRUCTIONS:
-- 1. First run supabase/check_html_notes.sql to preview affected rows
-- 2. Confirm the preview looks correct
-- 3. Then run this script to perform the cleanup
-- ============================================================================

UPDATE tasks
SET notes = trim(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(notes,
            '<br\s*/?>',    E'\n', 'gi'
          ),
          '</p>\s*<p>',   E'\n', 'gi'
        ),
        '<p>',            '',   'gi'
      ),
      '</p>',             '',   'gi'
    ),
    '<[^>]+>',            '',   'gi'
  )
)
WHERE notes ~ '<[^>]+>';

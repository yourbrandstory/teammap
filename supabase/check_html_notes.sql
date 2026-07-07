-- Step 1: Preview affected rows (run this first)
SELECT id, name, left(notes, 200) AS notes_preview
FROM tasks
WHERE notes ~ '<[^>]+>'
ORDER BY updated_at DESC NULLS LAST
LIMIT 20;

-- Step 2: Count total affected
SELECT COUNT(*) AS total_affected FROM tasks WHERE notes ~ '<[^>]+>';

-- Step 3: Breakdown by tag type
SELECT
  SUM(CASE WHEN notes ~ '<p>' THEN 1 ELSE 0 END) AS has_p_tags,
  SUM(CASE WHEN notes ~ '<br' THEN 1 ELSE 0 END) AS has_br_tags,
  SUM(CASE WHEN notes ~ '<[^>]+>' THEN 1 ELSE 0 END) AS total_with_html
FROM tasks;

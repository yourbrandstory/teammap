-- Reset all showOnDashboard: true → false in milestone substeps linkedTasks JSONB
-- New default is false (user must explicitly opt-in to dashboard visibility)

-- Before count: milestones where at least one linkedTask has showOnDashboard: true
DO $$
DECLARE
  before_count INTEGER;
  after_count  INTEGER;
BEGIN
  SELECT count(*) INTO before_count
  FROM milestones
  WHERE substeps IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(substeps) AS ss,
           jsonb_array_elements_text(COALESCE(ss->'linkedTasks', '[]'::jsonb)) AS lt_raw
      WHERE (lt_raw::jsonb)->>'showOnDashboard' = 'true'
    );

  RAISE NOTICE 'Before: % milestone(s) have showOnDashboard: true in linkedTasks', before_count;

  -- Update: walk every linkedTask and set showOnDashboard to false where it was true
  UPDATE milestones
  SET substeps = (
    SELECT jsonb_agg(
      jsonb_set(
        ss,
        '{linkedTasks}',
        (
          SELECT jsonb_agg(
            CASE WHEN (lt->>'showOnDashboard') = 'true'
                 THEN jsonb_set(lt, '{showOnDashboard}', 'false'::jsonb)
                 ELSE lt
            END
          )
          FROM jsonb_array_elements(COALESCE(ss->'linkedTasks', '[]'::jsonb)) AS lt
        )
      )
    )
    FROM jsonb_array_elements(substeps) AS ss
  )
  WHERE substeps IS NOT NULL;

  SELECT count(*) INTO after_count
  FROM milestones
  WHERE substeps IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(substeps) AS ss,
           jsonb_array_elements_text(COALESCE(ss->'linkedTasks', '[]'::jsonb)) AS lt_raw
      WHERE (lt_raw::jsonb)->>'showOnDashboard' = 'true'
    );

  RAISE NOTICE 'After: % milestone(s) still have showOnDashboard: true (should be 0)', after_count;
END $$;

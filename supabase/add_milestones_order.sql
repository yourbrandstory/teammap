-- Add item_order JSONB column to line_up table for combined task+milestone ordering
ALTER TABLE line_up ADD COLUMN IF NOT EXISTS item_order JSONB DEFAULT '[]'::jsonb;

-- Add notes column to milestones table
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

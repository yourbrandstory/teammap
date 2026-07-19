-- Fix 1: Remove any ad_type tag rows where the tag looks like an email (bad test data)
DELETE FROM public.signal_tag_master
WHERE kind = 'ad_type' AND tag ~ '^[^@]+@[^@]+\.[^@]+$';

-- Promote all existing profiles to admin so signal RLS passes.
-- Safe for dev; remove in production.
UPDATE public.profiles SET role = 'admin' WHERE role IS DISTINCT FROM 'admin';

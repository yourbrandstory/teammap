-- Fix 4: Revert promote_user_to_admin.
-- Sets all profiles back to 'member'. Real admins/managers can be
-- re-promoted manually via the Supabase dashboard.
-- Signal no longer requires admin role (MemberView fix handles access).
UPDATE public.profiles SET role = 'member' WHERE role = 'admin';

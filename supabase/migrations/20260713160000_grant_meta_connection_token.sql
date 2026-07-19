-- Allow authenticated role to write access_token (RLS already restricts to admin/manager)
GRANT INSERT(account_id, access_token, ad_account_id, api_version, results_action_type, updated_at)
  ON public.signal_meta_connections TO authenticated;
GRANT UPDATE(account_id, access_token, ad_account_id, api_version, results_action_type, updated_at)
  ON public.signal_meta_connections TO authenticated;

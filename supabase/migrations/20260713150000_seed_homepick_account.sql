-- Seed a default "Homepick" account so the Signal tab has something to work with.
-- Idempotent: only inserts if no accounts exist yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.signal_accounts LIMIT 1) THEN
    INSERT INTO public.signal_accounts (name, is_default) VALUES ('Homepick', true);
  END IF;
END
$$;

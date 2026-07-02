-- ============================================================================
-- TeamMap — Add line_up table for per-member, per-date task ordering
--
-- Previously, task order was stored globally in app_state (lineUpOrder key).
-- Now we use a dedicated table with (member_id, date) as composite PK, so
-- each member can have their own ordering and it syncs in real time.
-- ============================================================================

-- ── 1. Create the line_up table ────────────────────────────────────────────
create table if not exists line_up (
  member_id   text not null,
  date        text not null,
  task_order  text[] not null default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  primary key (member_id, date)
);

-- ── 2. Enable RLS ──────────────────────────────────────────────────────────
alter table line_up enable row level security;

-- ── 3. All authenticated users can read/write (shared workspace state) ─────
drop policy if exists line_up_all on line_up;
create policy line_up_all on line_up
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

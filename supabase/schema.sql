-- ============================================================================
-- TeamMap — Supabase schema
-- Run in Supabase → SQL Editor. Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- IDs are TEXT to preserve the legacy ids from your JSON backup (e.g. "m1",
-- "xmpqxcw9r5mt"). Do not switch these to uuid or the import will break links.
-- ============================================================================

-- ── profiles: maps an auth user to a role + (optionally) a team member ──────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'member',   -- 'admin' | 'manager' | 'member'
  member_id   text,                              -- links a login to a members.id
  created_at  timestamptz default now()
);

-- ── core tables (TEXT ids to match the legacy backup) ───────────────────────
create table if not exists members (
  id        text primary key,
  name      text not null,
  role      text,
  color     text,
  capacity  int default 6
);

create table if not exists clients (
  id        text primary key,
  name      text not null,
  industry  text default '',
  color     text,
  ord       int default 0
);

create table if not exists links (
  id         text primary key,
  member_id  text references members(id) on delete cascade,
  client_id  text references clients(id) on delete cascade,
  roles      jsonb default '[]'::jsonb        -- nested roles kept as jsonb
);

create table if not exists tasks (
  id            text primary key,
  name          text not null,
  client_id     text,
  date          date,
  mood          text,
  status        text default 'Not Started',
  assigned_to   jsonb default '[]'::jsonb,
  tags          jsonb default '[]'::jsonb,
  est_h         int default 0,
  est_m         int default 0,
  notes         text default '',
  subtasks      jsonb default '[]'::jsonb,
  links         jsonb default '[]'::jsonb,
  created_by    text,                           -- auth.uid() of the manager who created it
  is_milestone  boolean default false,
  milestone_id  text,
  deleted       boolean default false,
  created_at    bigint,
  updated_at    bigint
);
create index if not exists tasks_date_idx on tasks(date);
create index if not exists tasks_deleted_idx on tasks(deleted);

-- add subtasks/links columns if upgrading from a schema that lacks them
alter table tasks add column if not exists subtasks jsonb default '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS posting_date TEXT DEFAULT NULL;
alter table tasks add column if not exists links jsonb default '[]'::jsonb;

create table if not exists milestones (
  id           text primary key,
  name         text not null,
  description  text default '',
  assigned_to  jsonb default '[]'::jsonb,
  color        text,
  created_at   bigint
);

create table if not exists tags (
  id     text primary key,
  label  text not null,
  color  text
);

-- ── app_state: one row per config singleton (settings, moods, navOrder, ...) ─
create table if not exists app_state (
  key    text primary key,
  value  jsonb
);

-- ── line_up: per-member, per-date task ordering (shared across all users) ────
create table if not exists line_up (
  member_id   text not null,
  date        text not null,
  task_order  text[] not null default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  primary key (member_id, date)
);

-- ── helpers: role checks ────────────────────────────────────────────────────
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function is_manager() returns boolean
language sql security definer stable as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'manager');
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table profiles   enable row level security;
alter table members    enable row level security;
alter table clients    enable row level security;
alter table links      enable row level security;
alter table tasks      enable row level security;
alter table milestones enable row level security;
alter table tags       enable row level security;
alter table app_state  enable row level security;
alter table line_up    enable row level security;

-- profiles: a user can read their own profile; admins can read all.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select
  using (id = auth.uid() or is_admin());

-- Everything below: any authenticated user can READ.
-- Admins can WRITE everything. Managers can write business tables (tasks, clients, etc.)
-- but NOT manage users (profiles, members). Members can update their own tasks (status etc.).

do $$
declare t text;
begin
  alter table tasks add column if not exists created_by text;
  foreach t in array array['members','clients','links','milestones','tags','app_state']
  loop
    execute format('drop policy if exists %1$s_read on %1$s;', t);
    execute format('create policy %1$s_read on %1$s for select using (auth.role() = ''authenticated'');', t);
    execute format('drop policy if exists %1$s_write on %1$s;', t);
    execute format('create policy %1$s_write on %1$s for all using (is_admin() or is_manager()) with check (is_admin() or is_manager());', t);
  end loop;
end $$;

-- tasks: read for all authenticated; admin/manager full write; members read assigned, update own.
drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select using (
  is_admin() or is_manager() or exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.member_id is not null
      and tasks.assigned_to ? p.member_id
  )
);

drop policy if exists tasks_admin_write on tasks;
create policy tasks_admin_write on tasks for all using (is_admin() or is_manager()) with check (is_admin() or is_manager());

drop policy if exists tasks_member_update on tasks;
create policy tasks_member_update on tasks for update
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.member_id is not null
        and tasks.assigned_to ? p.member_id
    )
  );

-- profiles: only admins can manage all profiles; users can read their own.
drop policy if exists profiles_write on profiles;
create policy profiles_write on profiles for all
  using (is_admin())
  with check (is_admin());

-- members: only admins can write (managers read-only).
drop policy if exists members_write on members;
create policy members_write on members for all
  using (is_admin())
  with check (is_admin());

-- line_up: all authenticated users can read/write (shared workspace state)
drop policy if exists line_up_all on line_up;
create policy line_up_all on line_up for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ── make yourself admin after creating your auth user ───────────────────────
-- 1) Authentication → Users → Add user (email + password) — that's your admin login.
-- 2) Run (replace the email):
--    insert into profiles (id, role)
--    select id, 'admin' from auth.users where email = 'you@agency.com'
--    on conflict (id) do update set role = 'admin';
-- 3) Sign in, go to Settings → Import JSON backup.

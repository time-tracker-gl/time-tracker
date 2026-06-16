-- rpc Zeiterfassung – Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It creates the tables for projects and bookings (segments) and locks them down
-- with Row Level Security so each user can only see and change their own rows.

-- ============================ projects ============================
create table if not exists public.projects (
  id         text primary key,                       -- client-generated id
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code       text not null,
  name       text not null,
  color      text not null,
  created_at timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects (user_id, created_at);

alter table public.projects enable row level security;

drop policy if exists "projects are owned" on public.projects;
create policy "projects are owned"
  on public.projects
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================ segments ============================
create table if not exists public.segments (
  id         text primary key,                       -- client-generated id
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pid        text not null references public.projects (id) on delete cascade,
  day        date not null default current_date,     -- the day this booking belongs to
  start_min  integer not null,                       -- minutes since midnight
  end_min    integer not null,
  activity   text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists segments_user_day_idx on public.segments (user_id, day);

alter table public.segments enable row level security;

drop policy if exists "segments are owned" on public.segments;
create policy "segments are owned"
  on public.segments
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

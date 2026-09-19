-- Apply this through a Supabase migration after creating the dedicated project.
-- No service_role key is exposed to the browser; all access is constrained by RLS.
create table if not exists public.place_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  category text,
  country_code text not null default 'KR' check (country_code ~ '^[A-Z]{2}$'),
  address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  website_url text,
  note text check (char_length(note) <= 1200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.place_submissions enable row level security;
revoke all on public.place_submissions from anon;
grant select, insert, update on public.place_submissions to authenticated;

create policy "Users view own restaurant suggestions"
on public.place_submissions for select to authenticated
using ((select auth.uid()) = submitted_by);

create policy "Users submit pending restaurant suggestions"
on public.place_submissions for insert to authenticated
with check ((select auth.uid()) = submitted_by and status = 'pending');

create policy "Users update own pending restaurant suggestions"
on public.place_submissions for update to authenticated
using ((select auth.uid()) = submitted_by and status = 'pending')
with check ((select auth.uid()) = submitted_by and status = 'pending');

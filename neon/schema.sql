-- Run from the Neon SQL Editor after creating the database project.
-- The application API is the only database client. DATABASE_URL is never sent to browsers.
create table if not exists place_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null check (char_length(name) between 2 and 160),
  category text,
  country_code text not null default 'KR' check (country_code ~ '^[A-Z]{2}$'),
  address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  website_url text,
  note text check (char_length(note) <= 1200),
  broadcast_program text,
  broadcast_episode text,
  broadcast_aired_on date,
  broadcast_source_url text,
  check (
    (broadcast_program is null and broadcast_episode is null and broadcast_aired_on is null and broadcast_source_url is null)
    or (broadcast_program is not null and broadcast_source_url is not null)
  ),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists place_submissions_owner_created_idx
on place_submissions (owner_id, created_at desc);

alter table place_submissions
  add column if not exists broadcast_program text,
  add column if not exists broadcast_episode text,
  add column if not exists broadcast_aired_on date,
  add column if not exists broadcast_source_url text;

alter table place_submissions
  add constraint place_submissions_broadcast_source_check
  check (
    (broadcast_program is null and broadcast_episode is null and broadcast_aired_on is null and broadcast_source_url is null)
    or (broadcast_program is not null and broadcast_source_url is not null)
  );

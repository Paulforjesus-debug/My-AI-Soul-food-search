update place_submissions
set status = 'approved'
where status = 'pending';

alter table place_submissions
  alter column status set default 'approved';

create index if not exists place_submissions_owner_status_created_idx
  on place_submissions (owner_id, status, created_at desc);

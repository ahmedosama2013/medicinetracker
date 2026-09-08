-- Keep the source household on photo suggestions for developer review.
alter table public.community_photo_suggestions
  add column if not exists submitted_by_household_id uuid references public.households(id) on delete set null,
  add column if not exists submitted_by_name text;

create index if not exists community_photo_suggestions_submitter_idx
  on public.community_photo_suggestions (submitted_by_household_id);

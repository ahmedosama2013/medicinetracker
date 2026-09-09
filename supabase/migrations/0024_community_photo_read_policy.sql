-- Community reference photos are shared catalogue assets. Authenticated elders
-- need to download them directly for Today and the organiser.
create policy community_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'community-med-photos');

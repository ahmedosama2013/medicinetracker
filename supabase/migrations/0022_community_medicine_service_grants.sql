-- The community Edge Function uses service_role and must explicitly receive privileges on tables created after the base migration.
grant select, insert, update on public.community_medicine_references to service_role;
grant select, insert, update on public.community_photo_suggestions to service_role;

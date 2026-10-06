-- Validate metadata and prevent references to another account's photo.
alter table public.photos
  add constraint photos_dimensions_positive check (width > 0 and height > 0),
  add constraint photos_owned_storage_path check (storage_path = user_id::text || '/' || id::text || '.jpg');
alter table public.treatments
  add constraint treatments_name_present check (length(trim(name)) between 1 and 120);

drop policy "own analyses" on public.analyses;
create policy "read own analyses" on public.analyses
  for select using (user_id = auth.uid());
create policy "insert own analyses" on public.analyses
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.photos p where p.id = photo_id and p.user_id = auth.uid())
    and (previous_photo_id is null or exists (
      select 1 from public.photos p where p.id = previous_photo_id and p.user_id = auth.uid()
    ))
  );
create policy "delete own analyses" on public.analyses
  for delete using (user_id = auth.uid());

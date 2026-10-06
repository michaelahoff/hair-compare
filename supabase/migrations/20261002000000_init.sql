-- Hair Compare: photos of the scalp over time, their AI assessments, and treatments.
-- Every row is owned by the signed-in user; RLS keeps users to their own data.

create type public.scalp_view as enum ('top', 'crown', 'hairline', 'left_temple', 'right_temple');
create type public.hair_length as enum ('buzzed', 'short', 'medium', 'long');

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  view public.scalp_view not null,
  taken_at timestamptz not null default now(),
  -- Object path inside the `scalp-photos` bucket: "<user_id>/<photo id>.jpg".
  storage_path text not null,
  width integer not null,
  height integer not null,
  hair_length public.hair_length,
  hair_wet boolean not null default false,
  notes text,
  -- Similarity transform mapping the view's baseline photo onto this one:
  -- { "refPhotoId", "tx", "ty", "rotation", "scale", "score" }. Null for the baseline.
  alignment jsonb,
  created_at timestamptz not null default now()
);

create index photos_user_view_taken_idx on public.photos (user_id, view, taken_at);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  photo_id uuid not null references public.photos (id) on delete cascade,
  -- Earlier photo of the same view the model compared against, if any.
  previous_photo_id uuid references public.photos (id) on delete set null,
  model text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index analyses_photo_idx on public.analyses (photo_id, created_at desc);

create type public.treatment_kind as enum ('oral', 'topical', 'procedure', 'supplement', 'other');

create table public.treatments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind public.treatment_kind not null default 'other',
  dosage text,
  started_on date not null,
  ended_on date,
  notes text,
  created_at timestamptz not null default now(),
  constraint treatments_dates_ordered check (ended_on is null or ended_on >= started_on)
);

create index treatments_user_started_idx on public.treatments (user_id, started_on);

alter table public.photos enable row level security;
alter table public.analyses enable row level security;
alter table public.treatments enable row level security;

create policy "own photos" on public.photos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own analyses" on public.analyses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own treatments" on public.treatments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private bucket; objects live under a folder named after the owner's user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scalp-photos', 'scalp-photos', false, 10485760, array['image/jpeg']);

create policy "own photo objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'scalp-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'scalp-photos' and (storage.foldername(name))[1] = auth.uid()::text);

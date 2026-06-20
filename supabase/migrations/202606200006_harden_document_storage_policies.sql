begin;

insert into storage.buckets (id, name, public)
values
  ('order-documents', 'order-documents', false),
  ('request-reports', 'request-reports', false)
on conflict (id) do nothing;

update storage.buckets
set public = false
where id in ('order-documents', 'request-reports')
  and public is distinct from false;

drop policy if exists "Users can read own order documents" on storage.objects;
create policy "Users can read own order documents" on storage.objects
for select to authenticated using (
  bucket_id = 'order-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can upload own order documents" on storage.objects;
create policy "Users can upload own order documents" on storage.objects
for insert to authenticated with check (
  bucket_id = 'order-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own order documents" on storage.objects;
create policy "Users can update own order documents" on storage.objects
for update to authenticated
using (
  bucket_id = 'order-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'order-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own order documents" on storage.objects;
create policy "Users can delete own order documents" on storage.objects
for delete to authenticated using (
  bucket_id = 'order-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can read own request reports" on storage.objects;
create policy "Users can read own request reports" on storage.objects
for select to authenticated using (
  bucket_id = 'request-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or left(name, length('talep_listesi_' || auth.uid()::text || '_'))
      = ('talep_listesi_' || auth.uid()::text || '_')
  )
);

drop policy if exists "Users can upload own request reports" on storage.objects;
create policy "Users can upload own request reports" on storage.objects
for insert to authenticated with check (
  bucket_id = 'request-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or left(name, length('talep_listesi_' || auth.uid()::text || '_'))
      = ('talep_listesi_' || auth.uid()::text || '_')
  )
);

drop policy if exists "Users can update own request reports" on storage.objects;
create policy "Users can update own request reports" on storage.objects
for update to authenticated
using (
  bucket_id = 'request-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or left(name, length('talep_listesi_' || auth.uid()::text || '_'))
      = ('talep_listesi_' || auth.uid()::text || '_')
  )
)
with check (
  bucket_id = 'request-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or left(name, length('talep_listesi_' || auth.uid()::text || '_'))
      = ('talep_listesi_' || auth.uid()::text || '_')
  )
);

drop policy if exists "Users can delete own request reports" on storage.objects;
create policy "Users can delete own request reports" on storage.objects
for delete to authenticated using (
  bucket_id = 'request-reports'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or left(name, length('talep_listesi_' || auth.uid()::text || '_'))
      = ('talep_listesi_' || auth.uid()::text || '_')
  )
);

commit;

-- Ekip desteği provası: canlı şemanın kopyasında 0047 uygulandıktan sonra çalışır.
-- Üç sahte kullanıcı: A (hesap sahibi), B (A'nın ekibine katılır), C (yabancı).
\set ON_ERROR_STOP 1
\set QUIET 1

-- auth.uid()/auth.jwt() oturum ayarından okunur (Supabase gibi).
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

grant usage on schema public, auth, extensions to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'prova-a@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'prova-b@example.com'),
  ('cccccccc-0000-4000-8000-000000000003', 'prova-c@example.com');

-- Canlıda yazma için aktif lisans şartı var ("Active license required"): A'ya lisans.
delete from public.user_licenses where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
insert into public.user_licenses (user_id, plan_type, license_status, expires_at, activated_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'active', 'active', now() + interval '10 days', now());

create temp table sonuc (ad text, ok boolean, ayrinti text);
grant all on sonuc to authenticated;

create or replace function pg_temp.olarak(uid text, mail text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'email', mail, 'role', 'authenticated')::text, false);
end $$;

-- 1) Kalan auth.uid() kullanan politika: yalnız kişiye bağlı tablolar.
insert into sonuc
select 'Politikalar hesap kimliğine dönüştü', count(*) = 0, string_agg(tablename || '.' || policyname, ', ')
from pg_policies
where schemaname in ('public', 'storage')
  and tablename not in ('support_admins', 'support_tickets', 'support_messages', 'account_members', 'account_invitations')
  and (coalesce(qual, '') like '%auth.uid()%' or coalesce(with_check, '') like '%auth.uid()%');

-- 2) A bir ürün kartı açar.
set role authenticated;
select pg_temp.olarak('aaaaaaaa-0000-4000-8000-000000000001', 'prova-a@example.com');
insert into public.products (user_id, product_code, product_name) values (public.current_account_id(), 'PROVA-1', 'Prova ürünü');
insert into sonuc select 'A kendi kartını görüyor', count(*) = 1, count(*)::text from public.products where product_code = 'PROVA-1';
insert into sonuc select 'A yönetici', public.is_account_admin(), '';

-- 3) B katılmadan önce göremez.
select pg_temp.olarak('bbbbbbbb-0000-4000-8000-000000000002', 'prova-b@example.com');
insert into sonuc select 'B katılmadan A''nın kartını göremiyor', count(*) = 0, count(*)::text from public.products where product_code = 'PROVA-1';

-- 4) A, B'yi davet eder; B kabul eder.
select pg_temp.olarak('aaaaaaaa-0000-4000-8000-000000000001', 'prova-a@example.com');
create temp table davet as select (public.create_account_invitation('prova-b@example.com', 'member'))->>'token' as token;
grant select on davet to authenticated;
select pg_temp.olarak('bbbbbbbb-0000-4000-8000-000000000002', 'prova-b@example.com');
select public.accept_account_invitation((select token from davet));
insert into sonuc select 'B katıldıktan sonra kartı görüyor', count(*) = 1, count(*)::text from public.products where product_code = 'PROVA-1';
insert into sonuc select 'B hesap kimliği A', public.current_account_id() = 'aaaaaaaa-0000-4000-8000-000000000001', public.current_account_id()::text;
insert into sonuc select 'B yönetici değil', not public.is_account_admin(), '';
insert into public.products (user_id, product_code, product_name) values (public.current_account_id(), 'PROVA-2', 'B''nin açtığı kart');
update public.products set current_stock = 7 where product_code = 'PROVA-1';

do $$ begin
  perform public.create_account_invitation('baska@example.com', 'member');
  insert into sonuc values ('B davet gönderemiyor', false, 'gönderebildi');
exception when others then
  insert into sonuc values ('B davet gönderemiyor', true, sqlerrm);
end $$;

do $$ begin
  insert into public.products (user_id, product_code, product_name) values ('cccccccc-0000-4000-8000-000000000003', 'PROVA-X', 'Yabancıya yazma');
  insert into sonuc values ('B başka hesaba yazamıyor', false, 'yazabildi');
exception when others then
  insert into sonuc values ('B başka hesaba yazamıyor', true, sqlerrm);
end $$;

-- 5) A, B'nin değişikliklerini görür; C hiçbir şey görmez.
select pg_temp.olarak('aaaaaaaa-0000-4000-8000-000000000001', 'prova-a@example.com');
insert into sonuc select 'A, B''nin açtığı kartı ve güncellemesini görüyor',
  count(*) = 2 and sum(current_stock) = 7, count(*) || ' kart, stok ' || sum(current_stock)
from public.products where product_code in ('PROVA-1', 'PROVA-2');
insert into sonuc select 'A ekipte B''yi görüyor', count(*) = 1, count(*)::text from public.account_members;

select pg_temp.olarak('cccccccc-0000-4000-8000-000000000003', 'prova-c@example.com');
insert into sonuc select 'C (yabancı) kartları göremiyor', count(*) = 0, count(*)::text from public.products where product_code like 'PROVA-%';
insert into sonuc select 'C ekip listesini göremiyor', count(*) = 0, count(*)::text from public.account_members;

-- 6) Koltuk sınırı: A + 4 üye + bekleyen davet = 5.
select pg_temp.olarak('aaaaaaaa-0000-4000-8000-000000000001', 'prova-a@example.com');
select public.create_account_invitation('u3@example.com', 'member');
select public.create_account_invitation('u4@example.com', 'member');
select public.create_account_invitation('u5@example.com', 'member');
do $$ begin
  perform public.create_account_invitation('u6@example.com', 'member');
  insert into sonuc values ('6. kişiye davet reddedilir', false, 'gönderildi');
exception when others then
  insert into sonuc values ('6. kişiye davet reddedilir', true, sqlerrm);
end $$;

-- 7) Çıkarılan üye erişimini kaybeder.
select public.remove_account_member('bbbbbbbb-0000-4000-8000-000000000002');
select pg_temp.olarak('bbbbbbbb-0000-4000-8000-000000000002', 'prova-b@example.com');
insert into sonuc select 'Çıkarılan B artık göremiyor', count(*) = 0, count(*)::text from public.products where product_code like 'PROVA-%';

-- 8) Lisans hesaba bağlı: üye, sahibin lisansını kullanır.
select pg_temp.olarak('aaaaaaaa-0000-4000-8000-000000000001', 'prova-a@example.com');
do $$ declare t text; begin
  t := (public.create_account_invitation('prova-b@example.com', 'member'))->>'token';
  perform pg_temp.olarak('bbbbbbbb-0000-4000-8000-000000000002', 'prova-b@example.com');
  perform public.accept_account_invitation(t);
end $$;
reset role;
delete from public.user_licenses where user_id in ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.user_licenses (user_id, plan_type, license_status, expires_at, activated_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'active', 'active', now() + interval '10 days', now());
set role authenticated;
select pg_temp.olarak('bbbbbbbb-0000-4000-8000-000000000002', 'prova-b@example.com');
insert into sonuc select 'Üye, sahibin lisansıyla aktif', public.has_active_license(), '';
reset role;

\pset format unaligned
\pset tuples_only on
select (case when ok then '✓ ' else '✗ ' end) || ad || coalesce(' — ' || nullif(ayrinti, ''), '') from sonuc;
select 'TOPLAM ' || count(*) filter (where ok) || '/' || count(*) from sonuc;
select case when bool_and(ok) then 'PROVA_BASARILI' else 'PROVA_BASARISIZ' end from sonuc;

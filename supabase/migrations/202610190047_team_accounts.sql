begin;

-- Ekip desteği: bir firma hesabını (account) en fazla 5 kişi kullanır.
-- Hesap kimliği = hesabı açan kişinin auth kullanıcı kimliğidir; mevcut tüm
-- kayıtların user_id alanı zaten bu kimliktir, veri taşıması gerekmez.
-- Ekibe katılan kişi, kendi kimliğiyle giriş yapar; RLS ve fonksiyonlar
-- auth.uid() yerine public.current_account_id() ile hesabın verisine bakar.
-- Tek kişilik hesaplarda current_account_id() = auth.uid(): davranış aynıdır.

create table if not exists public.account_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  account_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  email text,
  created_at timestamptz not null default now(),
  constraint account_members_not_self check (user_id <> account_id)
);
create index if not exists account_members_account_idx on public.account_members (account_id);

create table if not exists public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
create index if not exists account_invitations_account_idx on public.account_invitations (account_id);

create or replace function public.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select member.account_id from public.account_members member where member.user_id = auth.uid()),
    auth.uid()
  );
$$;

-- Hesap sahibi her zaman yöneticidir; ekipten yönetici rolündekiler de.
create or replace function public.is_account_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    not exists (select 1 from public.account_members member where member.user_id = auth.uid())
    or exists (select 1 from public.account_members member where member.user_id = auth.uid() and member.role = 'admin')
  );
$$;

grant execute on function public.current_account_id() to authenticated;
grant execute on function public.is_account_admin() to authenticated;

alter table public.account_members enable row level security;
alter table public.account_invitations enable row level security;

drop policy if exists "Team members can view their team" on public.account_members;
create policy "Team members can view their team" on public.account_members
  for select to authenticated using (account_id = public.current_account_id());

drop policy if exists "Account admins manage invitations" on public.account_invitations;
create policy "Account admins manage invitations" on public.account_invitations
  for all to authenticated
  using (account_id = public.current_account_id() and public.is_account_admin())
  with check (account_id = public.current_account_id() and public.is_account_admin());

-- Ekip değişiklikleri yalnız bu fonksiyonlarla yapılır (doğrudan yazma yok).
create or replace function public.team_seat_limit()
returns integer language sql immutable as $$ select 5 $$;

create or replace function public.accept_account_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  actor_email text := lower(coalesce(auth.jwt()->>'email', ''));
  invite public.account_invitations%rowtype;
  used integer;
begin
  if actor is null then raise exception 'Oturum bulunamadı.'; end if;
  select * into invite from public.account_invitations where token = p_token for update;
  if not found then raise exception 'Davet bulunamadı.'; end if;
  if invite.accepted_at is not null then raise exception 'Bu davet daha önce kullanılmış.'; end if;
  if invite.expires_at < now() then raise exception 'Davetin süresi dolmuş. Yöneticiden yeni davet isteyin.'; end if;
  if lower(invite.email) <> actor_email then
    raise exception 'Bu davet % adresi için. Lütfen o adresle giriş yapın.', invite.email;
  end if;
  if invite.account_id = actor then raise exception 'Kendi hesabınıza davet edilemezsiniz.'; end if;
  if exists (select 1 from public.account_members where user_id = actor) then
    raise exception 'Zaten bir ekibe bağlısınız.';
  end if;
  if exists (select 1 from public.account_members where account_id = actor) then
    raise exception 'Sizin hesabınızda ekip üyeleri var; başka bir ekibe katılamazsınız.';
  end if;
  select 1 + count(*) into used from public.account_members where account_id = invite.account_id;
  if used >= public.team_seat_limit() then
    raise exception 'Ekip dolu (en fazla % kişi).', public.team_seat_limit();
  end if;
  insert into public.account_members (user_id, account_id, role, email)
  values (actor, invite.account_id, invite.role, actor_email);
  update public.account_invitations set accepted_at = now(), accepted_by = actor where id = invite.id;
  return jsonb_build_object('account_id', invite.account_id, 'role', invite.role);
end;
$$;

create or replace function public.create_account_invitation(p_email text, p_role text default 'member')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account uuid := public.current_account_id();
  used integer;
  pending integer;
  invite public.account_invitations%rowtype;
  normalized text := lower(trim(coalesce(p_email, '')));
begin
  if auth.uid() is null then raise exception 'Oturum bulunamadı.'; end if;
  if not public.is_account_admin() then raise exception 'Ekibe yalnız yöneticiler davet gönderebilir.'; end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Geçerli bir e-posta adresi girin.'; end if;
  if p_role not in ('admin', 'member') then raise exception 'Geçersiz rol.'; end if;
  select 1 + count(*) into used from public.account_members where account_id = account;
  select count(*) into pending from public.account_invitations
    where account_id = account and accepted_at is null and expires_at > now() and lower(email) <> normalized;
  if used + pending >= public.team_seat_limit() then
    raise exception 'Ekip dolu: en fazla % kişi (bekleyen davetler dahil).', public.team_seat_limit();
  end if;
  delete from public.account_invitations
    where account_id = account and lower(email) = normalized and accepted_at is null;
  insert into public.account_invitations (account_id, email, role, invited_by)
  values (account, normalized, p_role, auth.uid())
  returning * into invite;
  return jsonb_build_object('id', invite.id, 'token', invite.token, 'expires_at', invite.expires_at);
end;
$$;

create or replace function public.remove_account_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_account_admin() then raise exception 'Üyeyi yalnız yöneticiler çıkarabilir.'; end if;
  delete from public.account_members where user_id = p_user_id and account_id = public.current_account_id();
end;
$$;

create or replace function public.set_account_member_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_account_admin() then raise exception 'Rolü yalnız yöneticiler değiştirebilir.'; end if;
  if p_role not in ('admin', 'member') then raise exception 'Geçersiz rol.'; end if;
  update public.account_members set role = p_role where user_id = p_user_id and account_id = public.current_account_id();
end;
$$;

-- Üye ekipten kendisi ayrılabilir.
create or replace function public.leave_account()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.account_members where user_id = auth.uid();
$$;

grant execute on function public.accept_account_invitation(text) to authenticated;
grant execute on function public.create_account_invitation(text, text) to authenticated;
grant execute on function public.remove_account_member(uuid) to authenticated;
grant execute on function public.set_account_member_role(uuid, text) to authenticated;
grant execute on function public.leave_account() to authenticated;

-- Mevcut RLS politikaları: auth.uid() → current_account_id(). Canlıdaki
-- politikalar depo dosyalarından farklı olabildiği için metin yerinde dönüştürülür.
-- Destek, yönetici ve ekip tabloları kişiye bağlı kalır.
do $$
declare
  pol record;
  new_qual text;
  new_check text;
  sql text;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and tablename not in ('support_admins', 'support_tickets', 'support_messages',
                            'account_members', 'account_invitations')
      and (coalesce(qual, '') like '%auth.uid()%' or coalesce(with_check, '') like '%auth.uid()%')
  loop
    new_qual := replace(pol.qual, 'auth.uid()', 'public.current_account_id()');
    new_check := replace(pol.with_check, 'auth.uid()', 'public.current_account_id()');
    sql := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    if new_qual is not null then sql := sql || format(' using (%s)', new_qual); end if;
    if new_check is not null then sql := sql || format(' with check (%s)', new_check); end if;
    execute sql;
  end loop;
end;
$$;

-- Fonksiyonlar: hesap verisine dokunanlarda auth.uid() → current_account_id().
-- Denetim kaydı (kim yaptı), destek ve yönetici fonksiyonları kişiye bağlı kalır.
do $$
declare
  fn record;
  def text;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%auth.uid()%'
      and p.proname not in (
        'current_account_id', 'is_account_admin', 'accept_account_invitation',
        'create_account_invitation', 'remove_account_member', 'set_account_member_role', 'leave_account',
        'audit_order_change', 'audit_document_change', 'prevent_audit_log_mutation',
        'is_support_admin', 'add_support_message', 'create_support_ticket',
        'mark_support_ticket_read', 'set_support_ticket_status', 'set_support_updated_at',
        'create_trial_license_for_new_user'
      )
  loop
    def := replace(pg_get_functiondef(fn.oid), 'auth.uid()', 'public.current_account_id()');
    execute def;
  end loop;
end;
$$;

commit;

begin;

create table if not exists public.support_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_admins_role_check check (role in ('admin', 'super_admin'))
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  customer_email text,
  customer_name text,
  company_name text,
  subject text not null,
  category text not null,
  priority text not null,
  status text not null default 'Açık',
  last_message_at timestamptz not null default now(),
  last_admin_reply_at timestamptz,
  last_customer_reply_at timestamptz,
  unread_for_admin integer not null default 1,
  unread_for_customer integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_subject_not_blank check (length(btrim(subject)) > 0),
  constraint support_tickets_category_check
    check (category in ('Hata Bildirimi', 'Kullanım Desteği', 'Lisans', 'Finans', 'Öneri', 'Diğer')),
  constraint support_tickets_priority_check
    check (priority in ('Düşük', 'Orta', 'Yüksek', 'Kritik')),
  constraint support_tickets_status_check
    check (status in ('Açık', 'İnceleniyor', 'Yanıtlandı', 'Çözüldü', 'Kapandı')),
  constraint support_tickets_unread_admin_nonnegative check (unread_for_admin >= 0),
  constraint support_tickets_unread_customer_nonnegative check (unread_for_customer >= 0)
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null,
  message text not null,
  attachments jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint support_messages_sender_role_check check (sender_role in ('customer', 'admin')),
  constraint support_messages_message_not_blank check (length(btrim(message)) > 0),
  constraint support_messages_attachments_array_check
    check (attachments is null or jsonb_typeof(attachments) = 'array')
);

create index if not exists support_admins_active_idx
  on public.support_admins(active, role);

create index if not exists support_tickets_tenant_status_idx
  on public.support_tickets(tenant_id, status, last_message_at desc);

create index if not exists support_tickets_admin_queue_idx
  on public.support_tickets(status, priority, last_message_at desc);

create index if not exists support_tickets_unread_admin_idx
  on public.support_tickets(unread_for_admin)
  where unread_for_admin > 0;

create index if not exists support_tickets_unread_customer_idx
  on public.support_tickets(tenant_id, unread_for_customer)
  where unread_for_customer > 0;

create index if not exists support_messages_ticket_created_idx
  on public.support_messages(ticket_id, created_at);

create or replace function public.set_support_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_support_admins_updated_at on public.support_admins;
create trigger set_support_admins_updated_at
before update on public.support_admins
for each row
execute function public.set_support_updated_at();

drop trigger if exists set_support_tickets_updated_at on public.support_tickets;
create trigger set_support_tickets_updated_at
before update on public.support_tickets
for each row
execute function public.set_support_updated_at();

create or replace function public.is_support_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.support_admins admin_user
    where admin_user.user_id = auth.uid()
      and admin_user.active = true
      and admin_user.role in ('admin', 'super_admin')
  );
$$;

create or replace function public.create_support_ticket(
  p_subject text,
  p_category text,
  p_priority text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  ticket_id uuid;
  jwt jsonb := auth.jwt();
begin
  if actor_id is null then
    raise exception 'Oturum bulunamadı. Lütfen tekrar giriş yapın.';
  end if;

  if length(btrim(coalesce(p_subject, ''))) = 0 then
    raise exception 'Konu alanı boş olamaz.';
  end if;

  if length(btrim(coalesce(p_message, ''))) = 0 then
    raise exception 'Mesaj alanı boş olamaz.';
  end if;

  if p_category not in ('Hata Bildirimi', 'Kullanım Desteği', 'Lisans', 'Finans', 'Öneri', 'Diğer') then
    raise exception 'Geçersiz destek kategorisi.';
  end if;

  if p_priority not in ('Düşük', 'Orta', 'Yüksek', 'Kritik') then
    raise exception 'Geçersiz destek önceliği.';
  end if;

  insert into public.support_tickets (
    tenant_id,
    created_by,
    customer_email,
    customer_name,
    company_name,
    subject,
    category,
    priority,
    status,
    last_message_at,
    last_customer_reply_at,
    unread_for_admin,
    unread_for_customer
  )
  values (
    actor_id,
    actor_id,
    nullif(btrim(jwt ->> 'email'), ''),
    nullif(btrim(coalesce(jwt #>> '{user_metadata,full_name}', jwt #>> '{user_metadata,name}')), ''),
    nullif(btrim(jwt #>> '{user_metadata,company_name}'), ''),
    btrim(p_subject),
    p_category,
    p_priority,
    'Açık',
    now(),
    now(),
    1,
    0
  )
  returning id into ticket_id;

  insert into public.support_messages (
    ticket_id,
    sender_id,
    sender_role,
    message,
    attachments
  )
  values (
    ticket_id,
    actor_id,
    'customer',
    btrim(p_message),
    null
  );

  return ticket_id;
end;
$$;

create or replace function public.add_support_message(
  p_ticket_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  is_admin boolean := public.is_support_admin();
  ticket_record public.support_tickets%rowtype;
  message_id uuid;
begin
  if actor_id is null then
    raise exception 'Oturum bulunamadı. Lütfen tekrar giriş yapın.';
  end if;

  if length(btrim(coalesce(p_message, ''))) = 0 then
    raise exception 'Mesaj alanı boş olamaz.';
  end if;

  select *
  into ticket_record
  from public.support_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Destek talebi bulunamadı.';
  end if;

  if not is_admin and ticket_record.tenant_id <> actor_id then
    raise exception 'Bu destek talebine erişim yetkiniz yok.';
  end if;

  if ticket_record.status = 'Kapandı' then
    raise exception 'Kapalı destek talebine yeni mesaj eklenemez.';
  end if;

  insert into public.support_messages (
    ticket_id,
    sender_id,
    sender_role,
    message,
    attachments
  )
  values (
    p_ticket_id,
    actor_id,
    case when is_admin then 'admin' else 'customer' end,
    btrim(p_message),
    null
  )
  returning id into message_id;

  if is_admin then
    update public.support_tickets
    set
      status = case when status = 'Çözüldü' then status else 'Yanıtlandı' end,
      last_message_at = now(),
      last_admin_reply_at = now(),
      unread_for_customer = unread_for_customer + 1
    where id = p_ticket_id;
  else
    update public.support_tickets
    set
      status = case when status in ('Yanıtlandı', 'Çözüldü') then 'Açık' else status end,
      last_message_at = now(),
      last_customer_reply_at = now(),
      unread_for_admin = unread_for_admin + 1
    where id = p_ticket_id;
  end if;

  return message_id;
end;
$$;

create or replace function public.set_support_ticket_status(
  p_ticket_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_support_admin() then
    raise exception 'Destek talebi durumunu değiştirme yetkiniz yok.';
  end if;

  if p_status not in ('İnceleniyor', 'Yanıtlandı', 'Çözüldü', 'Kapandı') then
    raise exception 'Geçersiz destek talebi durumu.';
  end if;

  update public.support_tickets
  set status = p_status
  where id = p_ticket_id;

  if not found then
    raise exception 'Destek talebi bulunamadı.';
  end if;
end;
$$;

create or replace function public.mark_support_ticket_read(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  is_admin boolean := public.is_support_admin();
  ticket_record public.support_tickets%rowtype;
begin
  if actor_id is null then
    raise exception 'Oturum bulunamadı. Lütfen tekrar giriş yapın.';
  end if;

  select *
  into ticket_record
  from public.support_tickets
  where id = p_ticket_id
  for update;

  if not found then
    return;
  end if;

  if not is_admin and ticket_record.tenant_id <> actor_id then
    raise exception 'Bu destek talebine erişim yetkiniz yok.';
  end if;

  if is_admin then
    update public.support_tickets
    set unread_for_admin = 0
    where id = p_ticket_id;

    update public.support_messages
    set read_at = coalesce(read_at, now())
    where ticket_id = p_ticket_id
      and sender_role = 'customer';
  else
    update public.support_tickets
    set unread_for_customer = 0
    where id = p_ticket_id;

    update public.support_messages
    set read_at = coalesce(read_at, now())
    where ticket_id = p_ticket_id
      and sender_role = 'admin';
  end if;
end;
$$;

alter table public.support_admins enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "Support admins can read own admin role" on public.support_admins;
create policy "Support admins can read own admin role"
on public.support_admins
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Support ticket tenant and admins can read" on public.support_tickets;
create policy "Support ticket tenant and admins can read"
on public.support_tickets
for select
to authenticated
using (
  public.is_support_admin()
  or auth.uid() = tenant_id
  or auth.uid() = created_by
);

drop policy if exists "Support messages tenant and admins can read" on public.support_messages;
create policy "Support messages tenant and admins can read"
on public.support_messages
for select
to authenticated
using (
  public.is_support_admin()
  or exists (
    select 1
    from public.support_tickets ticket
    where ticket.id = support_messages.ticket_id
      and (ticket.tenant_id = auth.uid() or ticket.created_by = auth.uid())
  )
);

revoke all on public.support_admins from anon, authenticated;
revoke all on public.support_tickets from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;

grant select on public.support_admins to authenticated;
grant select on public.support_tickets to authenticated;
grant select on public.support_messages to authenticated;

grant all on public.support_admins to service_role;
grant all on public.support_tickets to service_role;
grant all on public.support_messages to service_role;

revoke all on function public.set_support_updated_at() from public;
revoke all on function public.is_support_admin() from public;
revoke all on function public.create_support_ticket(text, text, text, text) from public;
revoke all on function public.add_support_message(uuid, text) from public;
revoke all on function public.set_support_ticket_status(uuid, text) from public;
revoke all on function public.mark_support_ticket_read(uuid) from public;

grant execute on function public.is_support_admin() to authenticated, service_role;
grant execute on function public.create_support_ticket(text, text, text, text) to authenticated, service_role;
grant execute on function public.add_support_message(uuid, text) to authenticated, service_role;
grant execute on function public.set_support_ticket_status(uuid, text) to authenticated, service_role;
grant execute on function public.mark_support_ticket_read(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

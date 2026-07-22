begin;

create table if not exists public.support_email_events (
  webhook_id text primary key,
  provider_email_id text not null unique,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid not null unique references public.support_messages(id) on delete cascade,
  processed_at timestamptz not null default now(),
  constraint support_email_events_webhook_not_blank check (length(btrim(webhook_id)) > 0),
  constraint support_email_events_provider_not_blank check (length(btrim(provider_email_id)) > 0)
);

alter table public.support_email_events enable row level security;
revoke all on public.support_email_events from public, anon, authenticated;
grant all on public.support_email_events to service_role;

create or replace function public.add_support_admin_email_reply(
  p_webhook_id text,
  p_provider_email_id text,
  p_ticket_id uuid,
  p_admin_user_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  message_id uuid := gen_random_uuid();
  existing_message_id uuid;
  ticket_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Bu işlem yalnızca servis rolü tarafından çalıştırılabilir.';
  end if;

  select event_record.message_id
  into existing_message_id
  from public.support_email_events event_record
  where event_record.webhook_id = p_webhook_id
     or event_record.provider_email_id = p_provider_email_id
  limit 1;

  if existing_message_id is not null then
    return existing_message_id;
  end if;

  if length(btrim(coalesce(p_message, ''))) = 0 then
    raise exception 'E-posta cevabı boş olamaz.';
  end if;

  if not exists (
    select 1
    from public.support_admins admin_user
    where admin_user.user_id = p_admin_user_id
      and admin_user.active = true
      and admin_user.role in ('admin', 'super_admin')
  ) then
    raise exception 'Geçerli bir destek admini bulunamadı.';
  end if;

  select ticket.status
  into ticket_status
  from public.support_tickets ticket
  where ticket.id = p_ticket_id
  for update;

  if ticket_status is null then
    raise exception 'Destek talebi bulunamadı.';
  end if;

  if ticket_status = 'Kapandı' then
    raise exception 'Kapalı destek talebine e-posta cevabı eklenemez.';
  end if;

  insert into public.support_messages (
    id,
    ticket_id,
    sender_id,
    sender_role,
    message,
    attachments
  )
  values (
    message_id,
    p_ticket_id,
    p_admin_user_id,
    'admin',
    btrim(p_message),
    null
  );

  update public.support_tickets
  set status = 'Yanıtlandı',
      last_message_at = now(),
      last_admin_reply_at = now(),
      unread_for_customer = unread_for_customer + 1
  where id = p_ticket_id;

  insert into public.support_email_events (
    webhook_id,
    provider_email_id,
    ticket_id,
    message_id
  )
  values (
    btrim(p_webhook_id),
    btrim(p_provider_email_id),
    p_ticket_id,
    message_id
  );

  return message_id;
end;
$$;

revoke all on function public.add_support_admin_email_reply(text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_support_admin_email_reply(text, text, uuid, uuid, text) to service_role;

commit;

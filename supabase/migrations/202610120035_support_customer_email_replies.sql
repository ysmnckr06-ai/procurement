begin;

-- Müşterinin destek bildirim e-postasına "Yanıtla" ile verdiği cevabı
-- destek talebine müşteri mesajı olarak ekler. Yalnızca gelen e-posta
-- webhook'u (servis rolü) çağırabilir; gönderen adres talebin müşteri
-- e-postasıyla birebir eşleşmelidir.
create or replace function public.add_support_customer_email_reply(
  p_webhook_id text,
  p_provider_email_id text,
  p_ticket_id uuid,
  p_sender_email text,
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
  ticket_record public.support_tickets%rowtype;
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

  select *
  into ticket_record
  from public.support_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Destek talebi bulunamadı.';
  end if;

  if ticket_record.status = 'Kapandı' then
    raise exception 'Kapalı destek talebine e-posta cevabı eklenemez.';
  end if;

  if length(btrim(coalesce(ticket_record.customer_email, ''))) = 0
     or lower(btrim(ticket_record.customer_email)) <> lower(btrim(coalesce(p_sender_email, ''))) then
    raise exception 'Gönderen adres bu destek talebinin müşterisine ait değil.';
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
    ticket_record.created_by,
    'customer',
    btrim(p_message),
    null
  );

  update public.support_tickets
  set
    status = case when status in ('Yanıtlandı', 'Çözüldü') then 'Açık' else status end,
    last_message_at = now(),
    last_customer_reply_at = now(),
    unread_for_admin = unread_for_admin + 1
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

revoke all on function public.add_support_customer_email_reply(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.add_support_customer_email_reply(text, text, uuid, text, text) to service_role;

notify pgrst, 'reload schema';

commit;

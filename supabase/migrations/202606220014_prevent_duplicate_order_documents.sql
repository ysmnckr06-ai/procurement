begin;

alter table public.documents
  add column if not exists content_sha256 text;

do $$
declare
  duplicate_hash_count bigint;
  duplicate_link_count bigint;
begin
  select count(*)
  into duplicate_hash_count
  from (
    select user_id, content_sha256
    from public.documents
    where content_sha256 is not null and btrim(content_sha256) <> ''
    group by user_id, content_sha256
    having count(*) > 1
  ) duplicate_hashes;

  if duplicate_hash_count > 0 then
    raise exception
      'documents icinde ayni kullanici ve dosya hash degeri icin % mukerrer grup var; unique index olusturulmadi',
      duplicate_hash_count;
  end if;

  select count(*)
  into duplicate_link_count
  from (
    select user_id, document_id, order_id
    from public.document_links
    where order_id is not null
    group by user_id, document_id, order_id
    having count(*) > 1
  ) duplicate_links;

  if duplicate_link_count > 0 then
    raise exception
      'document_links icinde ayni belge/siparis icin % mukerrer grup var; unique index olusturulmadi',
      duplicate_link_count;
  end if;
end;
$$;

create unique index if not exists documents_user_content_sha256_unique_idx
  on public.documents(user_id, content_sha256)
  where content_sha256 is not null and btrim(content_sha256) <> '';

create unique index if not exists document_links_user_document_order_unique_idx
  on public.document_links(user_id, document_id, order_id)
  where order_id is not null;

comment on column public.documents.content_sha256 is
  'Ayni fiziksel siparis belgesinin tekrar yuklenmesini engelleyen SHA-256 ozeti.';

commit;

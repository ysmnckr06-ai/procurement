begin;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null default 'diger',
  original_file_name text not null default '',
  storage_bucket text not null default 'order-documents',
  storage_path text not null,
  mime_type text,
  file_size bigint,
  document_number text,
  document_date date,
  supplier_name text,
  supplier_tax_number text,
  invoice_total numeric(18,4),
  currency text default 'TRY',
  verification_status text default 'pending',
  approval_status text default 'bekliyor',
  approval_note text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  ocr_status text default 'pending',
  ocr_text text,
  ocr_result jsonb,
  ocr_confidence numeric(5,4),
  ocr_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists document_type text default 'diger',
  add column if not exists original_file_name text default '',
  add column if not exists storage_bucket text default 'order-documents',
  add column if not exists storage_path text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists document_number text,
  add column if not exists document_date date,
  add column if not exists supplier_name text,
  add column if not exists supplier_tax_number text,
  add column if not exists invoice_total numeric(18,4),
  add column if not exists currency text default 'TRY',
  add column if not exists verification_status text default 'pending',
  add column if not exists approval_status text default 'bekliyor',
  add column if not exists approval_note text,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists ocr_status text default 'pending',
  add column if not exists ocr_text text,
  add column if not exists ocr_result jsonb,
  add column if not exists ocr_confidence numeric(5,4),
  add column if not exists ocr_processed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.document_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.document_links
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists document_id uuid references public.documents(id) on delete cascade,
  add column if not exists order_id uuid references public.orders(id) on delete cascade,
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists created_at timestamptz not null default now();

do $$
declare
  invalid_document_count bigint;
  invalid_link_count bigint;
begin
  select count(*) into invalid_document_count
  from public.documents
  where user_id is null;

  if invalid_document_count > 0 then
    raise exception 'documents icinde user_id bos % satir var; veri silinmedi', invalid_document_count;
  end if;

  select count(*) into invalid_link_count
  from public.document_links link
  left join public.documents document on document.id = link.document_id
  left join public.orders linked_order on linked_order.id = link.order_id
  left join public.projects linked_project on linked_project.id = link.project_id
  where link.user_id is null
     or document.id is null
     or document.user_id::text is distinct from link.user_id::text
     or (link.order_id is not null and (
       linked_order.id is null or linked_order.user_id::text is distinct from link.user_id::text
     ))
     or (link.project_id is not null and (
       linked_project.id is null or linked_project.user_id::text is distinct from link.user_id::text
     ));

  if invalid_link_count > 0 then
    raise exception 'document_links icinde orphan veya user_id uyumsuz % satir var; veri silinmedi', invalid_link_count;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_links'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (document_id)%'
  ) then
    alter table public.document_links
      add constraint document_links_document_id_fkey
      foreign key (document_id) references public.documents(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_links'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (order_id)%'
  ) then
    alter table public.document_links
      add constraint document_links_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_links'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (project_id)%'
  ) then
    alter table public.document_links
      add constraint document_links_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade;
  end if;
end;
$$;

create index if not exists documents_user_id_idx on public.documents(user_id);
create index if not exists documents_user_type_idx on public.documents(user_id, document_type);
create index if not exists documents_created_at_idx on public.documents(created_at desc);
create index if not exists document_links_user_id_idx on public.document_links(user_id);
create index if not exists document_links_document_id_idx on public.document_links(document_id);
create index if not exists document_links_order_id_idx on public.document_links(order_id);
create index if not exists document_links_project_id_idx on public.document_links(project_id);

alter table public.documents enable row level security;
alter table public.document_links enable row level security;

drop policy if exists "Users can read own documents" on public.documents;
create policy "Users can read own documents" on public.documents
for select to authenticated using (auth.uid()::text = user_id::text);

drop policy if exists "Users can insert own documents" on public.documents;
create policy "Users can insert own documents" on public.documents
for insert to authenticated with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can update own documents" on public.documents;
create policy "Users can update own documents" on public.documents
for update to authenticated using (auth.uid()::text = user_id::text)
with check (auth.uid()::text = user_id::text);

drop policy if exists "Users can delete own documents" on public.documents;
create policy "Users can delete own documents" on public.documents
for delete to authenticated using (auth.uid()::text = user_id::text);

drop policy if exists "Users can read own document links" on public.document_links;
create policy "Users can read own document links" on public.document_links
for select to authenticated using (
  auth.uid()::text = user_id::text
  and exists (
    select 1 from public.documents linked_document
    where linked_document.id = document_links.document_id
      and linked_document.user_id::text = auth.uid()::text
  )
);

drop policy if exists "Users can insert own document links" on public.document_links;
create policy "Users can insert own document links" on public.document_links
for insert to authenticated with check (
  auth.uid()::text = user_id::text
  and exists (
    select 1 from public.documents linked_document
    where linked_document.id = document_links.document_id
      and linked_document.user_id::text = auth.uid()::text
  )
  and (document_links.order_id is null or exists (
    select 1 from public.orders linked_order
    where linked_order.id = document_links.order_id
      and linked_order.user_id::text = auth.uid()::text
  ))
  and (document_links.project_id is null or exists (
    select 1 from public.projects linked_project
    where linked_project.id = document_links.project_id
      and linked_project.user_id::text = auth.uid()::text
  ))
);

drop policy if exists "Users can update own document links" on public.document_links;
create policy "Users can update own document links" on public.document_links
for update to authenticated using (auth.uid()::text = user_id::text)
with check (
  auth.uid()::text = user_id::text
  and exists (
    select 1 from public.documents linked_document
    where linked_document.id = document_links.document_id
      and linked_document.user_id::text = auth.uid()::text
  )
  and (document_links.order_id is null or exists (
    select 1 from public.orders linked_order
    where linked_order.id = document_links.order_id
      and linked_order.user_id::text = auth.uid()::text
  ))
  and (document_links.project_id is null or exists (
    select 1 from public.projects linked_project
    where linked_project.id = document_links.project_id
      and linked_project.user_id::text = auth.uid()::text
  ))
);

drop policy if exists "Users can delete own document links" on public.document_links;
create policy "Users can delete own document links" on public.document_links
for delete to authenticated using (auth.uid()::text = user_id::text);

create or replace function public.set_documents_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at before update on public.documents
for each row execute function public.set_documents_updated_at();

grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_links to authenticated;

commit;

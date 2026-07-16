alter table public.suppliers
  add column if not exists procurement_trust_level text not null default 'auto',
  add column if not exists procurement_quality_history text not null default 'auto';

alter table public.suppliers
  drop constraint if exists suppliers_procurement_trust_level_check,
  add constraint suppliers_procurement_trust_level_check
    check (procurement_trust_level in ('auto', 'high', 'medium', 'low')),
  drop constraint if exists suppliers_procurement_quality_history_check,
  add constraint suppliers_procurement_quality_history_check
    check (procurement_quality_history in ('auto', 'good', 'medium', 'bad'));

comment on column public.suppliers.procurement_trust_level is
  'Supplier-specific procurement trust. auto uses recorded status/history without granting an unsupported positive score.';

comment on column public.suppliers.procurement_quality_history is
  'Supplier-specific quality history. auto remains neutral until delivery/return history is available.';

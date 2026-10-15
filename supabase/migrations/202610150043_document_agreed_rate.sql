-- Faturada anlaşılan kur: sipariş para birimi ile fatura para birimi farklıysa
-- (ör. EUR sipariş, TL fatura) hangi günün kuruyla anlaşıldığı saklanır.
-- exchange_rate = 1 sipariş para birimi kaç fatura para birimi.
alter table public.documents
  add column if not exists exchange_rate numeric,
  add column if not exists exchange_rate_date date,
  add column if not exists exchange_rate_basis text;

notify pgrst, 'reload schema';

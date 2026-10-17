-- public şemasındaki her tablonun satır sayısı (yedek ve geri yükleme karşılaştırması için)
select table_name || E'\t' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;

# Corvian v1.0 Backup and Restore Runbook

This runbook is a production preflight document. Do not run destructive restore
steps on the live database unless a rollback decision has been approved.

## Scope

Database tables:

- `projects`
- `project_items`
- `suppliers`
- `products`
- `orders`
- `order_receipts`
- `requests`
- `offers`
- `reports`
- `stock_movements`
- `documents`
- `document_links`
- `document_items`
- `project_payments`
- `order_payments`
- `project_expenses`
- `company_settings`
- `user_licenses`

Storage buckets:

- `order-documents`
- `request-reports`

Auth data:

- `auth.users`
- user metadata required for company and license setup

## Pre-release Backup Checklist

1. Open Supabase Dashboard.
2. Go to Database > Backups.
3. Confirm the latest automatic backup timestamp.
4. If the current plan supports it, create or mark a manual restore point before
   deploying migrations.
5. Record the timestamp, migration version, deploy commit, and operator name in
   the release notes.
6. Confirm `order-documents` and `request-reports` buckets are private.
7. Export or snapshot storage files before any migration that touches document
   metadata, document links, receipts, or order relations.
8. Confirm no cleanup SQL will physically delete production customer data unless
   the affected rows were archived first.

## Restore Drill Procedure

Use a staging Supabase project or a Supabase branch. Do not test restore on the
production project.

1. Restore the selected database backup into staging.
2. Restore or copy the required storage bucket objects into staging buckets.
3. Configure staging environment variables with staging Supabase URL and keys.
4. Run schema verification:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'projects',
    'project_items',
    'suppliers',
    'products',
    'orders',
    'order_receipts',
    'requests',
    'offers',
    'reports',
    'stock_movements',
    'documents',
    'document_links',
    'document_items',
    'project_payments',
    'order_payments',
    'project_expenses',
    'company_settings',
    'user_licenses'
  )
order by table_name;
```

5. Run data sanity checks:

```sql
select 'orders_without_user' as check_name, count(*) from public.orders where user_id is null
union all
select 'products_negative_stock', count(*) from public.products where current_stock < 0
union all
select 'receipts_non_positive', count(*) from public.order_receipts where quantity <= 0
union all
select 'documents_without_storage_path', count(*) from public.documents where storage_path is null or btrim(storage_path) = '';
```

6. Log in with a staging test user.
7. Verify dashboard, stock list, project detail, order detail, document preview,
   receipt history, and finance pages.
8. Verify storage access with a signed URL. Public direct access should fail for
   private documents.
9. Verify tenant isolation with a second staging user.

## Emergency Rollback Decision

Rollback should be considered if one of these happens after release:

- users cannot log in;
- RLS blocks all normal tenant reads;
- receipt RPC creates wrong stock or duplicate receipts;
- documents cannot be accessed through signed URLs;
- finance totals become inconsistent with source orders/payments.

Expected rollback time:

- database-only rollback: 30-90 minutes;
- database plus storage restore: depends on storage volume and must be measured
  during staging drill;
- auth/user rollback: manual validation required.

## Data Loss Notes

- Database point-in-time restore can roll back valid customer changes made after
  the selected timestamp.
- Storage restore must be coordinated with document rows. A restored
  `documents.storage_path` value is only useful if the object also exists in the
  matching bucket.
- Cleanup scripts must archive affected rows before deleting from live tables.
- For pilot customers, prefer tenant-scoped correction SQL over full project
  restore whenever the incident is limited to one tenant.

## Release Evidence Template

```text
Release:
Commit:
Migration range:
Supabase backup timestamp:
Storage snapshot/export timestamp:
Operator:
Staging restore tested: yes/no
Tenant isolation tested after restore: yes/no
Notes:
```

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from public, anon, authenticated, service_role;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on functions from public, anon, authenticated, service_role;

grant select on public.organizations, public.memberships, public.units, public.tenants,
  public.leases, public.invoices, public.payments, public.payment_allocations,
  public.gateway_bills, public.audit_log to authenticated;
grant update (phone) on public.tenants to authenticated;

create function private.member_org_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select org_id from public.memberships where user_id = (select auth.uid());
$$;

create function private.manager_org_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select org_id from public.memberships
  where user_id = (select auth.uid()) and role = 'manager';
$$;

create function private.tenant_org_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select org_id from public.tenants where user_id = (select auth.uid());
$$;

create function private.tenant_lease_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select l.id from public.leases as l
  join public.tenants as t on t.id = l.tenant_id
  where t.user_id = (select auth.uid());
$$;

create function private.tenant_unit_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select l.unit_id from public.leases as l
  join public.tenants as t on t.id = l.tenant_id
  where t.user_id = (select auth.uid());
$$;

revoke execute on function private.member_org_ids(), private.manager_org_ids(),
  private.tenant_org_ids(), private.tenant_lease_ids(), private.tenant_unit_ids()
  from public, anon, service_role;
grant execute on function private.member_org_ids(), private.manager_org_ids(),
  private.tenant_org_ids(), private.tenant_lease_ids(), private.tenant_unit_ids()
  to authenticated;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.units enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.gateway_bills enable row level security;
alter table public.audit_log enable row level security;

create policy organizations_read on public.organizations for select to authenticated
  using (id in (select private.member_org_ids()) or id in (select private.tenant_org_ids()));
create policy memberships_read on public.memberships for select to authenticated
  using (org_id in (select private.member_org_ids()));
create policy units_read on public.units for select to authenticated
  using (org_id in (select private.member_org_ids()) or id in (select private.tenant_unit_ids()));
create policy tenants_read on public.tenants for select to authenticated
  using (org_id in (select private.member_org_ids()) or user_id = (select auth.uid()));
create policy tenants_update_phone on public.tenants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy leases_read on public.leases for select to authenticated
  using (org_id in (select private.member_org_ids()) or id in (select private.tenant_lease_ids()));
create policy invoices_read on public.invoices for select to authenticated
  using (org_id in (select private.member_org_ids()) or lease_id in (select private.tenant_lease_ids()));
create policy payments_read on public.payments for select to authenticated
  using (org_id in (select private.member_org_ids()) or lease_id in (select private.tenant_lease_ids()));
create policy payment_allocations_read on public.payment_allocations for select to authenticated
  using (org_id in (select private.member_org_ids()) or lease_id in (select private.tenant_lease_ids()));
create policy gateway_bills_read on public.gateway_bills for select to authenticated
  using (org_id in (select private.member_org_ids()) or lease_id in (select private.tenant_lease_ids()));
create policy audit_log_read on public.audit_log for select to authenticated
  using (org_id in (select private.manager_org_ids()));

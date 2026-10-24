create extension if not exists btree_gist with schema extensions;
create schema private;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  role text not null check (role in ('manager', 'staff')),
  created_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  name text not null,
  unique (org_id, name),
  unique (id, org_id)
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  user_id uuid references auth.users(id),
  full_name text not null,
  email text not null,
  phone text check (phone is null or char_length(phone) between 1 and 30),
  unique (id, org_id)
);
create index tenants_user_id_idx on public.tenants(user_id);

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  unit_id uuid not null,
  tenant_id uuid not null,
  start_date date not null,
  end_date date not null,
  monthly_rent_sen bigint not null check (monthly_rent_sen > 0),
  deposit_sen bigint not null check (deposit_sen >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  foreign key (unit_id, org_id) references public.units(id, org_id),
  foreign key (tenant_id, org_id) references public.tenants(id, org_id),
  unique (id, org_id),
  constraint leases_no_overlap exclude using gist
    (unit_id with =, daterange(start_date, end_date, '[]') with &&)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  lease_id uuid not null,
  kind text not null check (kind in ('deposit', 'rent')),
  period_index integer,
  period_start date,
  period_end date,
  due_date date not null,
  amount_sen bigint not null check (amount_sen >= 0),
  created_at timestamptz not null default now(),
  foreign key (lease_id, org_id) references public.leases(id, org_id),
  unique (id, lease_id, org_id),
  check (
    (kind = 'deposit' and period_index is null and period_start is null and period_end is null)
    or (kind = 'rent' and period_index >= 0 and period_start is not null
        and period_end is not null and period_end >= period_start)
  )
);
create unique index invoices_rent_period_key on public.invoices(lease_id, period_index) where kind = 'rent';
create unique index invoices_one_deposit_key on public.invoices(lease_id) where kind = 'deposit';

create table public.gateway_bills (
  id text primary key check (id ~ '^bill_[0-9a-f]{32}$'),
  org_id uuid not null references public.organizations(id),
  lease_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  transaction_id text,
  paid_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lease_id, org_id) references public.leases(id, org_id),
  unique (id, lease_id, org_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  lease_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  unapplied_sen bigint not null default 0,
  method text not null check (method in ('cash', 'bank_transfer', 'online')),
  status text not null check (status in ('pending_verification', 'approved', 'rejected', 'voided')),
  received_at timestamptz not null,
  slip_path text,
  gateway_bill_id text,
  recorded_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  foreign key (lease_id, org_id) references public.leases(id, org_id),
  foreign key (gateway_bill_id, lease_id, org_id) references public.gateway_bills(id, lease_id, org_id),
  unique (id, lease_id, org_id),
  check (unapplied_sen >= 0 and unapplied_sen <= amount_sen),
  check (unapplied_sen = 0 or method = 'online'),
  check ((method = 'online') = (gateway_bill_id is not null)),
  check ((method = 'bank_transfer') = (slip_path is not null)),
  check (slip_path is null or split_part(slip_path, '/', 1) = org_id::text)
);
create unique index payments_gateway_bill_key on public.payments(gateway_bill_id) where gateway_bill_id is not null;
create index payments_lease_status_idx on public.payments(lease_id, status);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  lease_id uuid not null,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_sen bigint not null check (amount_sen > 0),
  created_at timestamptz not null default now(),
  foreign key (payment_id, lease_id, org_id) references public.payments(id, lease_id, org_id),
  foreign key (invoice_id, lease_id, org_id) references public.invoices(id, lease_id, org_id),
  unique (payment_id, invoice_id)
);
create index payment_allocations_invoice_id_idx on public.payment_allocations(invoice_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  actor_id uuid,
  action text not null,
  entity_id text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

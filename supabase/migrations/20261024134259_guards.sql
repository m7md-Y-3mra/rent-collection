create function private.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_append_only_rows
before update or delete on public.audit_log
for each row execute function private.audit_log_append_only();

create trigger audit_log_append_only_truncate
before truncate on public.audit_log
for each statement execute function private.audit_log_append_only();

create function private.payments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payments cannot be deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('pending_verification', 'approved') then
      raise exception 'payments must start pending_verification or approved';
    end if;
    if new.slip_path is not null and not exists (
      select 1 from storage.objects
      where bucket_id = 'payment-slips' and name = new.slip_path
    ) then
      raise exception 'payment slip does not exist';
    end if;
  else
    if row(new.id, new.org_id, new.lease_id, new.amount_sen, new.method,
           new.received_at, new.slip_path, new.gateway_bill_id, new.created_at)
       is distinct from
       row(old.id, old.org_id, old.lease_id, old.amount_sen, old.method,
           old.received_at, old.slip_path, old.gateway_bill_id, old.created_at) then
      raise exception 'payment amount and target fields are immutable';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'pending_verification' and new.status in ('approved', 'rejected'))
      or (old.status = 'approved' and new.status = 'voided')
    ) then
      raise exception 'invalid payment status transition';
    end if;
  end if;
  return new;
end;
$$;

create trigger payments_guard
before insert or update or delete on public.payments
for each row execute function private.payments_guard();

create function private.gateway_bills_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.id, new.org_id, new.lease_id, new.amount_sen)
     is distinct from row(old.id, old.org_id, old.lease_id, old.amount_sen) then
    raise exception 'gateway bill amount and target are immutable';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'pending' and new.status in ('paid', 'failed'))
    or (old.status = 'failed' and new.status = 'paid')
  ) then
    raise exception 'invalid gateway bill status transition';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger gateway_bills_guard
before update on public.gateway_bills
for each row execute function private.gateway_bills_guard();

-- The original invoices CHECK evaluates to NULL (and so passes) when a rent
-- invoice has a null period_index or period_start. This constraint is null-safe.
alter table public.invoices add constraint invoices_kind_shape check (
  case kind
    when 'deposit' then period_index is null and period_start is null and period_end is null
    when 'rent' then period_index is not null and period_index >= 0
      and period_start is not null and period_end is not null and period_end >= period_start
    else false
  end
);

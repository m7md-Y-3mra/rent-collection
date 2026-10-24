insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-slips', 'payment-slips', false, 5242880,
        array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy payment_slips_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] in
      (select org_id::text from private.member_org_ids() as org_id)
  );

create policy payment_slips_select on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-slips'
    and (storage.foldername(name))[1] in
      (select org_id::text from private.member_org_ids() as org_id)
  );

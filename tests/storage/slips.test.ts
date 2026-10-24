import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { createWorld, publicClient, type World } from '../helpers/world';
let w: World;
const pdf = Buffer.from('%PDF-1.4\n%%EOF');
let path: string;
beforeAll(async () => {
  w = await createWorld(); path = `${w.orgA.id}/${randomUUID()}.pdf`;
});
it('E29 staff may upload only into their org folder', async () => {
  const staff = (await w.asUser(w.staffA)).storage.from('payment-slips');
  expect((await staff.upload(path, pdf, { contentType: 'application/pdf' })).error).toBeNull();
  expect((await staff.upload(`${w.orgB.id}/${randomUUID()}.pdf`, pdf, { contentType: 'application/pdf' })).error).not.toBeNull();
});
it('E30 tenant, anon, other-org cannot read/list/upload Northwind slips', async () => {
  for (const client of [publicClient(), await w.asUser(w.tenantA1), await w.asUser(w.managerB)]) {
    const bucket = client.storage.from('payment-slips');
    expect((await bucket.download(path)).error).not.toBeNull();
    const listed = await bucket.list(w.orgA.id);
    expect(listed.error !== null || listed.data?.length === 0).toBe(true);
    expect((await bucket.upload(`${w.orgA.id}/${randomUUID()}.pdf`, pdf, { contentType: 'application/pdf' })).error).not.toBeNull();
  }
});
it('E31 manager signed URL works; update/remove not allowed', async () => {
  const bucket = (await w.asUser(w.managerA)).storage.from('payment-slips');
  const signed = await bucket.createSignedUrl(path, 60);
  expect(signed.error).toBeNull();
  expect((await fetch(signed.data!.signedUrl)).status).toBe(200);
  expect((await bucket.update(path, pdf, { contentType: 'application/pdf' })).error).not.toBeNull();
  const removed = await bucket.remove([path]);
  expect(removed.error !== null || removed.data?.length === 0).toBe(true);
  expect((await bucket.download(path)).error).toBeNull();
});
it('E32 bucket rejects oversized and unapproved MIME uploads', async () => {
  const bucket = (await w.asUser(w.staffA)).storage.from('payment-slips');
  expect((await bucket.upload(`${w.orgA.id}/large.pdf`, Buffer.alloc(5242881), { contentType: 'application/pdf' })).error).not.toBeNull();
  expect((await bucket.upload(`${w.orgA.id}/plain.txt`, Buffer.from('text'), { contentType: 'text/plain' })).error).not.toBeNull();
});

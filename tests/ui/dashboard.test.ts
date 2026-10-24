import { beforeAll,expect,it } from 'vitest';
import { countOverdueInvoices } from '@/lib/services/dashboard';
import { getLease } from '@/lib/services/leases';
import { createWorld,type World } from '../helpers/world';
let w:World;beforeAll(async()=>{w=await createWorld();});
it('E97 overdue count matches invoiceStatus for scoped member records',async()=>{for(const role of ['manager','staff'] as const){const actor={kind:'member' as const,userId:w.managerA.id,orgId:w.orgA.id,role};const leases=await Promise.all([getLease(actor,w.a1.lease.id),getLease(actor,w.a2.lease.id)]);expect(await countOverdueInvoices(actor,new Date())).toBe(leases.flatMap(l=>l.invoices).filter(i=>i.status==='overdue').length);}await expect(countOverdueInvoices({kind:'tenant',userId:w.tenantA1.id,orgIds:[w.orgA.id],tenantIds:[w.a1.tenant.id]},new Date())).rejects.toMatchObject({status:403});});

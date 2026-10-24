import { expect, it, vi } from 'vitest';
import { validateReason } from '@/lib/ui/format';
import { submitDecision } from '@/lib/ui/decide';
it('E98 reason and decision toast messages', async () => {
  expect(validateReason('abcd')).toBeTruthy();
  expect(validateReason('abcde')).toBeNull();
  expect(validateReason('     ')).toBeNull();
  for (const action of ['approve', 'reject', 'void'] as const) {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await submitDecision(f, 'p', action, 'abcde')).toMatchObject({
      ok: true,
      message: `Payment ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'voided'}.`,
    });
    if (action !== 'approve')
      expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({
        reason: 'abcde',
      });
  }
  const f = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ error: 'Payment is not pending' }, { status: 409 })
    );
  expect(await submitDecision(f, 'p', 'approve')).toEqual({
    ok: false,
    message: 'Payment is not pending',
  });
  const html = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('<html>oops</html>', { status: 500 }));
  expect(await submitDecision(html, 'p', 'void', 'abcde')).toEqual({
    ok: false,
    message: 'Request failed (500).',
  });
});

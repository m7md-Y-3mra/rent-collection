import { spawnSync } from 'node:child_process';

for (const TZ of ['UTC', 'Asia/Kuala_Lumpur', 'America/New_York']) {
  console.log(`\nBilling tests: TZ=${TZ}`);
  const result = spawnSync('npx', ['vitest', 'run', 'tests/billing'], {
    env: { ...process.env, TZ },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

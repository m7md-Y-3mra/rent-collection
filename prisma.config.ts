import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '.env.local' });

// `prisma generate` runs on `npm install`, before .env.local exists on a fresh clone,
// so a missing DIRECT_URL must not fail the config. Commands that connect still need it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DIRECT_URL ?? '' },
});

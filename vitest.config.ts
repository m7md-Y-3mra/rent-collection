import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), 'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)) } },
  test: { environment: 'node', setupFiles: ['tests/setup.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 60000, exclude: ['tests/security/**', 'node_modules/**'] },
});

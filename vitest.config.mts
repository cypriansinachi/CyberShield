import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      // `server-only` throws outside React Server Components; tests run server code directly.
      'server-only': path.join(root, 'test/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    setupFiles: ['test/setup.ts'],
    env: {
      SESSION_SECRET: 'test-session-secret',
      AUDIT_HMAC_KEY: 'test-audit-key',
      DATA_ENCRYPTION_KEY: '0'.repeat(63) + '1',
    },
  },
});

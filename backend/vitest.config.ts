import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ['./tests/globalSetup.ts'],
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'test-secret'
    }
  },
});

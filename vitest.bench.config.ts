import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/bench/**/*.bench.ts'],
    testTimeout: 120_000,
    pool: 'forks',
    reporters: ['verbose'],
  },
});

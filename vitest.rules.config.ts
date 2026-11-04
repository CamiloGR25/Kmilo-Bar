import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.rules.test.ts'],
    testTimeout: 15000,
    fileParallelism: false,
  },
})

import react from '@vitejs/plugin-react'

export default {
  // Export a plain config object here instead of using defineConfig because
  // Vitest 3 and @vitejs/plugin-react currently pull incompatible Vite types.
  // Runtime behavior is correct; avoiding defineConfig keeps TS/build green.
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: [
      './src/test/**/*.test.ts',
      './src/test/**/*.test.tsx',
      './src/test/**/*.spec.ts',
      './src/test/**/*.spec.tsx',
    ],
    exclude: ['node_modules', 'dist', 'e2e', 'playwright-report', 'test-results'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      exclude: ['e2e/**', 'dist/**', 'playwright-report/**', 'test-results/**'],
    },
  },
}

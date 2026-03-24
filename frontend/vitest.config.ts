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
    exclude: ['node_modules', 'dist'],
  },
}
